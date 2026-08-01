/**
 * Identity derivations and the commit leaf script.
 *
 * Byte order matters here. A txid as printed by Bitcoin Core, block explorers
 * and this library's JSON views is in display order, which is the reverse of
 * the internal wire order used inside transactions and inside PATINA digests.
 */

import {
  COMMITMENT_BYTES,
  COMMIT_LEAF_BYTES,
  OP_0,
  OP_1,
  OP_CHECKSIG,
  OP_ENDIF,
  OP_IF,
  SALT_BYTES,
  TAG_ARTIFACT,
  TAG_ATTEST,
  TAG_COMMIT,
  XONLY_BYTES,
} from './constants.js';
import { domainHash, fromHex, toHex, u32le, type Bytes } from './hash.js';

/** Convert a display order txid to internal wire order bytes. */
export function txidToWire(displayTxid: string): Buffer {
  return fromHex(displayTxid, 32).reverse();
}

/** Convert internal wire order bytes to a display order txid. */
export function wireToTxid(wire: Bytes): string {
  if (wire.length !== 32) throw new RangeError(`expected 32 bytes, got ${wire.length}`);
  return toHex(Buffer.from(wire).reverse());
}

/**
 * Commit commitment.
 * SHA256("PTNA/commit" || claimant_xonly(32) || salt(16))
 */
export function commitCommitment(claimantXOnly: string | Bytes, salt: string | Bytes): Buffer {
  const key = typeof claimantXOnly === 'string' ? fromHex(claimantXOnly, XONLY_BYTES) : Buffer.from(claimantXOnly);
  const s = typeof salt === 'string' ? fromHex(salt, SALT_BYTES) : Buffer.from(salt);
  if (key.length !== XONLY_BYTES) throw new RangeError(`claimant key must be ${XONLY_BYTES} bytes`);
  if (s.length !== SALT_BYTES) throw new RangeError(`salt must be ${SALT_BYTES} bytes`);
  return domainHash(TAG_COMMIT, key, s);
}

/**
 * Artifact id.
 * SHA256("PTNA/artifact" || reveal_txid_wire(32) || carrier_vout_le(4))
 * The input txid is in display order. Returns lowercase hex.
 */
export function artifactId(revealTxidDisplay: string, carrierVout: number): string {
  if (!Number.isInteger(carrierVout) || carrierVout < 0 || carrierVout > 0xffffffff) {
    throw new RangeError(`carrier vout out of range: ${carrierVout}`);
  }
  return toHex(domainHash(TAG_ARTIFACT, txidToWire(revealTxidDisplay), u32le(carrierVout)));
}

/**
 * Build the tapscript leaf that carries a PATINA commitment.
 *
 *   <claimant_xonly(32)> OP_CHECKSIG OP_0 OP_IF PUSH32(commitment) OP_ENDIF
 */
export function buildCommitLeafScript(claimantXOnly: string | Bytes, commitment: string | Bytes): Buffer {
  const key = typeof claimantXOnly === 'string' ? fromHex(claimantXOnly, XONLY_BYTES) : Buffer.from(claimantXOnly);
  const c = typeof commitment === 'string' ? fromHex(commitment, COMMITMENT_BYTES) : Buffer.from(commitment);
  if (key.length !== XONLY_BYTES) throw new RangeError(`claimant key must be ${XONLY_BYTES} bytes`);
  if (c.length !== COMMITMENT_BYTES) throw new RangeError(`commitment must be ${COMMITMENT_BYTES} bytes`);
  return Buffer.concat([
    Buffer.from([XONLY_BYTES]),
    key,
    Buffer.from([OP_CHECKSIG, OP_0, OP_IF, COMMITMENT_BYTES]),
    c,
    Buffer.from([OP_ENDIF]),
  ]);
}

/** A commit leaf that parsed cleanly. */
export interface CommitLeaf {
  /** Claimant x only public key, lowercase hex. */
  readonly claimantXOnly: string;
  /** Commitment digest, lowercase hex. */
  readonly commitment: string;
}

/** Parse a tapscript leaf. Returns null when the shape does not match exactly. */
export function parseCommitLeafScript(script: Bytes | string): CommitLeaf | null {
  const buf = typeof script === 'string' ? fromHex(script) : Buffer.from(script);
  if (buf.length !== COMMIT_LEAF_BYTES) return null;
  if (buf[0] !== XONLY_BYTES) return null;
  if (buf[33] !== OP_CHECKSIG) return null;
  if (buf[34] !== OP_0) return null;
  if (buf[35] !== OP_IF) return null;
  if (buf[36] !== COMMITMENT_BYTES) return null;
  if (buf[69] !== OP_ENDIF) return null;
  return {
    claimantXOnly: toHex(buf.subarray(1, 33)),
    commitment: toHex(buf.subarray(37, 69)),
  };
}

/** True when a scriptPubKey is a version 1 taproot output. */
export function isTaprootScriptPubKey(script: Bytes | string): boolean {
  const buf = typeof script === 'string' ? fromHex(script) : Buffer.from(script);
  return buf.length === 34 && buf[0] === OP_1 && buf[1] === XONLY_BYTES;
}

/** A tapscript spend split out of a witness stack. */
export interface TapscriptSpend {
  /** The revealed leaf script, lowercase hex. */
  readonly script: string;
  /** The control block, lowercase hex. */
  readonly controlBlock: string;
  /** Leaf version taken from the control block, with the parity bit cleared. */
  readonly leafVersion: number;
}

/**
 * Split a witness stack into its tapscript parts per BIP-341.
 * The optional annex is stripped first. Returns null for a key path spend or a
 * stack that cannot be a script path spend.
 */
export function extractTapscript(witness: readonly string[] | undefined): TapscriptSpend | null {
  if (!Array.isArray(witness) || witness.length < 2) return null;
  let stack = witness.slice();
  const last = stack[stack.length - 1];
  if (stack.length >= 2 && typeof last === 'string' && last.length >= 2 && last.slice(0, 2).toLowerCase() === '50') {
    stack = stack.slice(0, -1);
  }
  if (stack.length < 2) return null;
  const controlBlock = stack[stack.length - 1];
  const script = stack[stack.length - 2];
  if (typeof controlBlock !== 'string' || typeof script !== 'string') return null;
  let control: Buffer;
  try {
    control = fromHex(controlBlock);
  } catch {
    return null;
  }
  if (control.length < 33 || control.length > 33 + 32 * 128 || (control.length - 33) % 32 !== 0) return null;
  return { script: script.toLowerCase(), controlBlock: controlBlock.toLowerCase(), leafVersion: control[0] & 0xfe };
}

/**
 * Off chain attestation message for BIP-322 signing.
 * "PTNA/attest" || artifact_id_hex || block_hash_hex
 */
export function attestationMessage(artifactIdHex: string, blockHashHex: string): string {
  const id = fromHex(artifactIdHex, 32).toString('hex');
  const hash = fromHex(blockHashHex, 32).toString('hex');
  return `${TAG_ATTEST}${id}${hash}`;
}

/** Canonical outpoint key, "txid:vout" with the txid in display order. */
export function outpointKey(txid: string, vout: number): string {
  return `${txid.toLowerCase()}:${vout}`;
}

/** Split a canonical outpoint key back into its parts. */
export function parseOutpointKey(key: string): { txid: string; vout: number } {
  const at = key.lastIndexOf(':');
  if (at < 0) throw new TypeError(`not an outpoint key: ${key}`);
  const txid = key.slice(0, at);
  const vout = Number(key.slice(at + 1));
  if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0) {
    throw new TypeError(`not an outpoint key: ${key}`);
  }
  return { txid, vout };
}
