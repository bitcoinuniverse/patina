/**
 * The deterministic state reducer.
 *
 * applyBlock is a pure function of the previous snapshot, one resolved block and
 * the deployment record. It reads no clock, opens no socket, touches no disk and
 * draws no randomness. Given the same inputs it returns the same outputs on
 * every machine, forever.
 */

import { MIN_SUCCESSOR, type ReasonCode } from './constants.js';
import { decodeMarker, scanScriptPubKey, type Marker } from './codec.js';
import { artifactId as deriveArtifactId, outpointKey } from './ids.js';
import { defaultSuccessorVout, validateKeepEntry, validateSeed } from './validate.js';
import { eventRoot, stateRoot } from './roots.js';
import type {
  Artifact,
  BlockView,
  Counters,
  DeploymentRecord,
  InvalidEvent,
  PatinaEvent,
  Ring,
  Snapshot,
  TxView,
} from './types.js';

/** What applyBlock returns. */
export interface ApplyResult {
  /** The snapshot after the block. The input snapshot is never mutated. */
  readonly state: Snapshot;
  /** State changing events in emission order. */
  readonly events: readonly PatinaEvent[];
  /** Rejected attempts in the order they were seen. */
  readonly invalidEvents: readonly InvalidEvent[];
}

/** A mutable working copy of the snapshot, used only inside applyBlock. */
interface WorkState {
  height: number;
  blockHash: string | null;
  artifacts: Record<string, MutableArtifact>;
  carriers: Record<string, string[]>;
}

interface MutableArtifact {
  artifactId: string;
  birthTxid: string;
  birthHeight: number;
  birthVout: number;
  endowmentSats: number;
  founding: boolean;
  status: 'ALIVE' | 'RELIC';
  carrier: { txid: string; vout: number; height: number; value: number } | null;
  rings: Ring[];
}

const ZERO_COUNTERS: Counters = Object.freeze({
  artifactsAlive: 0,
  artifactsRelic: 0,
  foundingTotal: 0,
  ringsTotal: 0,
  deepestLiveDepth: 0,
  endowmentTotalSats: 0,
});

/** An empty snapshot. Height -1 means no block has been applied yet. */
export function initialState(): Snapshot {
  return Object.freeze({
    height: -1,
    blockHash: null,
    artifacts: Object.freeze({}),
    carriers: Object.freeze({}),
    counters: ZERO_COUNTERS,
  });
}

function toWork(state: Snapshot): WorkState {
  return {
    height: state.height,
    blockHash: state.blockHash,
    artifacts: structuredClone(state.artifacts) as Record<string, MutableArtifact>,
    carriers: structuredClone(state.carriers) as Record<string, string[]>,
  };
}

function recomputeCounters(work: WorkState, height: number): Counters {
  let artifactsAlive = 0;
  let artifactsRelic = 0;
  let foundingTotal = 0;
  let ringsTotal = 0;
  let deepestLiveDepth = 0;
  let endowmentTotalSats = 0;
  for (const id of Object.keys(work.artifacts).sort()) {
    const artifact = work.artifacts[id];
    if (artifact.status === 'ALIVE') {
      artifactsAlive += 1;
      const depth = artifact.carrier === null ? 0 : height - artifact.carrier.height;
      if (depth > deepestLiveDepth) deepestLiveDepth = depth;
    } else {
      artifactsRelic += 1;
    }
    if (artifact.founding) foundingTotal += 1;
    ringsTotal += artifact.rings.length;
    endowmentTotalSats += artifact.endowmentSats;
  }
  return { artifactsAlive, artifactsRelic, foundingTotal, ringsTotal, deepestLiveDepth, endowmentTotalSats };
}

function freezeState(work: WorkState, height: number, blockHash: string): Snapshot {
  const artifacts: Record<string, Artifact> = {};
  for (const id of Object.keys(work.artifacts).sort()) {
    const a = work.artifacts[id];
    artifacts[id] = Object.freeze({
      artifactId: a.artifactId,
      birthTxid: a.birthTxid,
      birthHeight: a.birthHeight,
      birthVout: a.birthVout,
      endowmentSats: a.endowmentSats,
      founding: a.founding,
      status: a.status,
      carrier: a.carrier === null ? null : Object.freeze({ ...a.carrier }),
      rings: Object.freeze(a.rings.map((r) => Object.freeze({ ...r }))),
    }) as Artifact;
  }
  const carriers: Record<string, readonly string[]> = {};
  for (const key of Object.keys(work.carriers).sort()) {
    const ids = work.carriers[key];
    if (ids.length === 0) continue;
    carriers[key] = Object.freeze([...ids].sort());
  }
  return Object.freeze({
    height,
    blockHash,
    artifacts: Object.freeze(artifacts),
    carriers: Object.freeze(carriers),
    counters: Object.freeze(recomputeCounters(work, height)),
  }) as Snapshot;
}

interface MarkerSlot {
  /** The decoded marker, or null when the slot is empty or void. */
  marker: Marker | null;
  /** Output index the marker sits at, or null when there is no candidate. */
  vout: number | null;
}

/**
 * Find the marker of a transaction.
 * The marker is the OP_RETURN output with the lowest vout whose push payload
 * starts with the PTNA magic. More than one candidate voids the marker.
 */
function findMarker(tx: TxView, push: (reason: ReasonCode, detail: string, vout: number | null) => void): MarkerSlot {
  const candidates: number[] = [];
  const scans = new Map<number, ReturnType<typeof scanScriptPubKey>>();
  for (let i = 0; i < tx.outputs.length; i += 1) {
    const scan = scanScriptPubKey(tx.outputs[i].scriptPubKey);
    if (scan.marker) {
      candidates.push(i);
      scans.set(i, scan);
    }
  }
  if (candidates.length === 0) return { marker: null, vout: null };
  if (candidates.length > 1) {
    push('VOID_DUPLICATE_MARKER', `outputs ${candidates.join(', ')} all carry a PTNA payload`, candidates[0]);
    return { marker: null, vout: candidates[0] };
  }
  const vout = candidates[0];
  const scan = scans.get(vout)!;
  if (scan.marker && !scan.ok) {
    push(scan.reason, scan.detail, vout);
    return { marker: null, vout };
  }
  const decoded = decodeMarker((scan as { payload: Buffer }).payload);
  if (!decoded.ok) {
    push(decoded.reason, decoded.detail, vout);
    return { marker: null, vout };
  }
  return { marker: decoded.marker, vout };
}

function processTx(
  work: WorkState,
  tx: TxView,
  txIndex: number,
  height: number,
  deployment: DeploymentRecord,
  events: PatinaEvent[],
  invalidEvents: InvalidEvent[],
): void {
  const push = (reason: ReasonCode, detail: string, vout: number | null): void => {
    invalidEvents.push({ height, txIndex, txid: tx.txid, vout, reason, detail });
  };

  const slot = findMarker(tx, push);
  const marker = slot.marker;

  // Step one: every input that spends a live carrier, in input index order.
  const spends: Array<{ inputIndex: number; key: string; artifactIds: string[] }> = [];
  for (let i = 0; i < tx.inputs.length; i += 1) {
    const key = outpointKey(tx.inputs[i].txid, tx.inputs[i].vout);
    const ids = work.carriers[key];
    if (ids !== undefined && ids.length > 0) {
      spends.push({ inputIndex: i, key, artifactIds: [...ids].sort() });
    }
  }

  // Step two: routing named by a valid KEEP marker.
  const routes = new Map<number, number>();
  if (marker !== null && marker.op === 'KEEP') {
    if (spends.length === 0) {
      push('KEEP_NO_CARRIER_INPUT', 'no input of this transaction spends a live carrier', slot.vout);
    } else {
      const carrierInputs = new Set(spends.map((s) => s.inputIndex));
      for (const entry of marker.entries) {
        const result = validateKeepEntry(entry, tx, carrierInputs, MIN_SUCCESSOR);
        if (!result.ok) push(result.reason, `input ${entry.inputIndex}: ${result.detail}`, result.vout);
        else routes.set(result.inputIndex, result.vout);
      }
    }
  }

  // Step three: close a ring for every artifact on every spent carrier.
  for (const spend of spends) {
    const named = routes.get(spend.inputIndex);
    const successorVout = named !== undefined ? named : defaultSuccessorVout(tx, MIN_SUCCESSOR);
    delete work.carriers[spend.key];

    for (const id of spend.artifactIds) {
      const artifact = work.artifacts[id];
      if (artifact === undefined || artifact.carrier === null) continue;
      const carrier = artifact.carrier;
      const ring: Ring = {
        index: artifact.rings.length,
        startHeight: carrier.height,
        endHeight: height,
        depth: height - carrier.height,
        carriedValue: carrier.value,
        successorTxid: successorVout === null ? null : tx.txid,
        successorVout,
        relic: successorVout === null,
      };
      artifact.rings.push(ring);

      if (successorVout === null) {
        artifact.status = 'RELIC';
        artifact.carrier = null;
        events.push({
          kind: 'RELIC',
          height,
          txIndex,
          txid: tx.txid,
          artifactId: id,
          vout: null,
          value: 0,
          ringIndex: ring.index,
          founding: false,
        });
      } else {
        const output = tx.outputs[successorVout];
        artifact.carrier = { txid: tx.txid, vout: successorVout, height, value: output.value };
        const key = outpointKey(tx.txid, successorVout);
        const bucket = work.carriers[key] ?? [];
        bucket.push(id);
        bucket.sort();
        work.carriers[key] = bucket;
        events.push({
          kind: 'MOVED',
          height,
          txIndex,
          txid: tx.txid,
          artifactId: id,
          vout: successorVout,
          value: output.value,
          ringIndex: ring.index,
          founding: false,
        });
      }
    }
  }

  // Step four: creation. A SEED carrier is an output of this same transaction,
  // so it can never be one of the carriers this transaction just spent.
  if (marker !== null && marker.op === 'SEED') {
    const result = validateSeed(tx, marker, height, deployment);
    if (!result.ok) {
      push(result.reason, result.detail, result.vout);
      return;
    }
    const id = deriveArtifactId(tx.txid, result.carrierVout);
    if (work.artifacts[id] !== undefined) return;
    work.artifacts[id] = {
      artifactId: id,
      birthTxid: tx.txid,
      birthHeight: height,
      birthVout: result.carrierVout,
      endowmentSats: result.carrierValue,
      founding: result.founding,
      status: 'ALIVE',
      carrier: { txid: tx.txid, vout: result.carrierVout, height, value: result.carrierValue },
      rings: [],
    };
    const key = outpointKey(tx.txid, result.carrierVout);
    const bucket = work.carriers[key] ?? [];
    bucket.push(id);
    bucket.sort();
    work.carriers[key] = bucket;
    events.push({
      kind: 'CREATED',
      height,
      txIndex,
      txid: tx.txid,
      artifactId: id,
      vout: result.carrierVout,
      value: result.carrierValue,
      ringIndex: 0,
      founding: result.founding,
    });
  }
}

/**
 * Apply one resolved block to a snapshot.
 * Blocks must arrive in order. The first block applied to a fresh snapshot may
 * start at any height, after which each block must be the direct successor.
 */
export function applyBlock(state: Snapshot, block: BlockView, deployment: DeploymentRecord): ApplyResult {
  if (!Number.isInteger(block.height) || block.height < 0) {
    throw new RangeError(`block height must be a non negative integer, got ${block.height}`);
  }
  if (state.height >= 0 && block.height !== state.height + 1) {
    throw new RangeError(`block ${block.height} does not follow snapshot height ${state.height}`);
  }
  if (deployment.hOpen === null || deployment.hClose === null || deployment.graceEnd === null) {
    throw new Error(`deployment for ${deployment.network} has no activation heights`);
  }

  const work = toWork(state);
  const events: PatinaEvent[] = [];
  const invalidEvents: InvalidEvent[] = [];

  for (let txIndex = 0; txIndex < block.txs.length; txIndex += 1) {
    const tx = block.txs[txIndex];
    if (tx.coinbase === true) continue;
    processTx(work, tx, txIndex, block.height, deployment, events, invalidEvents);
  }

  return {
    state: freezeState(work, block.height, block.hash),
    events,
    invalidEvents,
  };
}

/** One applied block in a replay. */
export interface ReplayStep {
  readonly height: number;
  readonly blockHash: string;
  readonly state: Snapshot;
  readonly events: readonly PatinaEvent[];
  readonly invalidEvents: readonly InvalidEvent[];
  readonly eventRoot: string;
  readonly stateRoot: string;
}

/** What replay returns. */
export interface ReplayResult {
  readonly steps: readonly ReplayStep[];
  readonly state: Snapshot;
}

/** Apply a run of blocks in order, keeping the snapshot and roots at each height. */
export function replay(
  blocks: readonly BlockView[],
  deployment: DeploymentRecord,
  from: Snapshot = initialState(),
): ReplayResult {
  const steps: ReplayStep[] = [];
  let state = from;
  for (const block of blocks) {
    const applied = applyBlock(state, block, deployment);
    state = applied.state;
    steps.push({
      height: block.height,
      blockHash: block.hash,
      state,
      events: applied.events,
      invalidEvents: applied.invalidEvents,
      eventRoot: eventRoot(applied.events),
      stateRoot: stateRoot(state),
    });
  }
  return { steps, state };
}

/**
 * Pick the snapshot at a height out of a replay.
 * A reorg is handled by taking the snapshot at the fork height and replaying the
 * new branch on top of it. Nothing is undone in place, so a rollback can never
 * leave partial state behind.
 */
export function snapshotAtHeight(result: ReplayResult, height: number): Snapshot | null {
  for (const step of result.steps) {
    if (step.height === height) return step.state;
  }
  return null;
}
