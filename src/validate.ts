/**
 * Pure validation of SEED and KEEP against a resolved transaction.
 *
 * Nothing here reads the clock, the network or the filesystem. Every failure
 * carries a code from the frozen reason registry.
 */

import { MIN_SUCCESSOR, OP_RETURN, type ReasonCode } from './constants.js';
import { fromHex } from './hash.js';
import { commitCommitment, extractTapscript, isTaprootScriptPubKey, parseCommitLeafScript } from './ids.js';
import type { KeepEntry, SeedMarker } from './codec.js';
import type { DeploymentRecord, OutputView, TxView } from './types.js';

/** A validation failure. */
export interface Invalid {
  readonly ok: false;
  readonly reason: ReasonCode;
  readonly detail: string;
  /** Output index the failure concerns, or null. */
  readonly vout: number | null;
}

/** A SEED that passed every check. */
export interface SeedValid {
  readonly ok: true;
  /** Output index of the new carrier. */
  readonly carrierVout: number;
  /** Carrier value in satoshis. */
  readonly carrierValue: number;
  /** True when the founding window rules were met. */
  readonly founding: boolean;
  /** Height of the block that created the commit output. */
  readonly commitHeight: number;
  /** Input index that revealed the qualifying commit leaf. */
  readonly commitInputIndex: number;
  /** Claimant x only key from the commit leaf, lowercase hex. */
  readonly claimantXOnly: string;
  /** Minimum carrier value that applied, in satoshis. */
  readonly minCarrier: number;
}

/** SEED validation result. */
export type SeedResult = SeedValid | Invalid;

/** A KEEP entry that passed every check. */
export interface KeepEntryValid {
  readonly ok: true;
  readonly inputIndex: number;
  readonly vout: number;
}

/** KEEP entry validation result. */
export type KeepEntryResult = KeepEntryValid | Invalid;

function invalid(reason: ReasonCode, detail: string, vout: number | null = null): Invalid {
  return { ok: false, reason, detail, vout };
}

/** True when an output is an OP_RETURN output. */
export function isOpReturnOutput(output: OutputView): boolean {
  const script = fromHex(output.scriptPubKey);
  return script.length > 0 && script[0] === OP_RETURN;
}

/**
 * Default rule successor.
 * The lowest index output that is not an OP_RETURN and holds at least
 * MIN_SUCCESSOR satoshis. Returns null when no output qualifies.
 */
export function defaultSuccessorVout(tx: TxView, minSuccessor: number = MIN_SUCCESSOR): number | null {
  for (let i = 0; i < tx.outputs.length; i += 1) {
    const output = tx.outputs[i];
    if (isOpReturnOutput(output)) continue;
    if (output.value < minSuccessor) continue;
    return i;
  }
  return null;
}

/** A commit leaf found in a transaction input. */
export interface CommitInput {
  readonly inputIndex: number;
  readonly claimantXOnly: string;
  readonly commitment: string;
  readonly height: number;
}

/**
 * Collect every input that reveals a PATINA shaped commit leaf.
 * The input must spend a taproot output through the script path, and the
 * revealed leaf must match the exact commit leaf shape.
 */
export function findCommitInputs(tx: TxView): CommitInput[] {
  const found: CommitInput[] = [];
  for (let i = 0; i < tx.inputs.length; i += 1) {
    const input = tx.inputs[i];
    if (!isTaprootScriptPubKey(input.prevout.scriptPubKey)) continue;
    const spend = extractTapscript(input.witness);
    if (spend === null) continue;
    const leaf = parseCommitLeafScript(spend.script);
    if (leaf === null) continue;
    found.push({
      inputIndex: i,
      claimantXOnly: leaf.claimantXOnly,
      commitment: leaf.commitment,
      height: input.prevout.height,
    });
  }
  return found;
}

/**
 * Founding classification.
 * Founding is true when the commit output was created inside the window and the
 * reveal landed no later than the end of the grace period.
 */
export function isFounding(commitHeight: number, revealHeight: number, deployment: DeploymentRecord): boolean {
  const { hOpen, hClose, graceEnd } = deployment;
  if (hOpen === null || hClose === null || graceEnd === null) return false;
  if (commitHeight < hOpen || commitHeight >= hClose) return false;
  return revealHeight <= graceEnd;
}

/**
 * Validate a SEED marker against its transaction.
 *
 * Check order is fixed by the specification:
 *   carrier range, carrier is OP_RETURN, commit input, commitment match,
 *   commit age, founding classification, carrier minimum.
 */
export function validateSeed(
  tx: TxView,
  marker: SeedMarker,
  revealHeight: number,
  deployment: DeploymentRecord,
): SeedResult {
  const { carrierVout } = marker;

  if (carrierVout >= tx.outputs.length) {
    return invalid('SEED_CARRIER_OUT_OF_RANGE', `carrier vout ${carrierVout} is beyond the ${tx.outputs.length} outputs`, carrierVout);
  }

  const carrier = tx.outputs[carrierVout];
  if (isOpReturnOutput(carrier)) {
    return invalid('SEED_CARRIER_IS_OPRETURN', `carrier vout ${carrierVout} is an OP_RETURN output`, carrierVout);
  }

  const commitInputs = findCommitInputs(tx);
  if (commitInputs.length === 0) {
    return invalid('SEED_NO_COMMIT_INPUT', 'no input reveals a PATINA commit leaf', carrierVout);
  }

  const matches = commitInputs.filter((candidate) => {
    const expected = commitCommitment(candidate.claimantXOnly, marker.salt).toString('hex');
    return expected === candidate.commitment;
  });

  if (matches.length === 0) {
    return invalid(
      'SEED_COMMITMENT_MISMATCH',
      `${commitInputs.length} commit leaf reveal(s), none commit to this salt and claimant key`,
      carrierVout,
    );
  }
  if (matches.length > 1) {
    return invalid(
      'SEED_NO_COMMIT_INPUT',
      `${matches.length} inputs reveal a qualifying commit leaf, exactly one is required`,
      carrierVout,
    );
  }

  const commit = matches[0];
  const age = revealHeight - commit.height;
  if (age < deployment.commitMinAge) {
    return invalid(
      'SEED_COMMIT_TOO_YOUNG',
      `commit age is ${age} blocks, minimum is ${deployment.commitMinAge}`,
      carrierVout,
    );
  }

  const founding = isFounding(commit.height, revealHeight, deployment);
  const minCarrier = founding ? deployment.minCarrierFounding : deployment.minCarrierOpen;
  if (carrier.value < minCarrier) {
    return invalid(
      'SEED_CARRIER_BELOW_MIN',
      `carrier holds ${carrier.value} sats, ${founding ? 'founding' : 'open era'} minimum is ${minCarrier}`,
      carrierVout,
    );
  }

  return {
    ok: true,
    carrierVout,
    carrierValue: carrier.value,
    founding,
    commitHeight: commit.height,
    commitInputIndex: commit.inputIndex,
    claimantXOnly: commit.claimantXOnly,
    minCarrier,
  };
}

/**
 * Validate one KEEP entry against its transaction.
 * A void entry does not void the marker. It falls through to the default rule.
 */
export function validateKeepEntry(
  entry: KeepEntry,
  tx: TxView,
  carrierInputIndexes: ReadonlySet<number>,
  minSuccessor: number = MIN_SUCCESSOR,
): KeepEntryResult {
  if (!carrierInputIndexes.has(entry.inputIndex)) {
    return invalid('KEEP_ENTRY_NOT_CARRIER', `input ${entry.inputIndex} does not spend a live carrier`, null);
  }
  if (entry.vout >= tx.outputs.length) {
    return invalid('KEEP_ENTRY_OUT_OF_RANGE', `vout ${entry.vout} is beyond the ${tx.outputs.length} outputs`, entry.vout);
  }
  const output = tx.outputs[entry.vout];
  if (isOpReturnOutput(output)) {
    return invalid('KEEP_ENTRY_IS_OPRETURN', `vout ${entry.vout} is an OP_RETURN output`, entry.vout);
  }
  if (output.value < minSuccessor) {
    return invalid('KEEP_ENTRY_BELOW_MIN', `vout ${entry.vout} holds ${output.value} sats, minimum is ${minSuccessor}`, entry.vout);
  }
  return { ok: true, inputIndex: entry.inputIndex, vout: entry.vout };
}
