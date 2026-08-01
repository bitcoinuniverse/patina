/**
 * Deterministic fixture builders.
 *
 * Every identifier here is derived from a label with SHA-256, so regenerating
 * the vectors on any machine produces byte identical output. Nothing in this
 * file is random and nothing reads the clock.
 *
 * The keys and signatures are structurally correct but are not real secp256k1
 * material. PATINA never verifies signatures, because Bitcoin consensus already
 * did that before the block was accepted. See section 3 of the specification.
 */

import { createHash } from 'node:crypto';

import {
  buildCommitLeafScript,
  buildScriptPubKey,
  commitCommitment,
  encodeMarker,
  MARKER_MAGIC,
  MARKER_VERSION,
  OP_KEEP,
  OP_SEED,
} from '../../dist/index.js';

const digest = (label) => createHash('sha256').update(`patina-fixture/${label}`, 'utf8').digest();

/** Deterministic display order txid for a label. */
export const txidFor = (label) => digest(`txid/${label}`).toString('hex');

/** Deterministic block hash for a label. */
export const blockHashFor = (label) => digest(`block/${label}`).toString('hex');

/** Deterministic x only public key for a label. */
export const xonlyFor = (label) => digest(`xonly/${label}`).toString('hex');

/** Deterministic 16 byte salt for a label. */
export const saltFor = (label) => digest(`salt/${label}`).subarray(0, 16).toString('hex');

/** Deterministic P2TR scriptPubKey for a label. */
export const p2trFor = (label) => `5120${digest(`p2tr/${label}`).toString('hex')}`;

/** Deterministic P2WPKH scriptPubKey for a label. */
export const p2wpkhFor = (label) => `0014${digest(`p2wpkh/${label}`).subarray(0, 20).toString('hex')}`;

/** A plain value output. */
export function out(value, label) {
  return { value, scriptPubKey: p2wpkhFor(label) };
}

/** An OP_RETURN output carrying arbitrary data that is not a PATINA marker. */
export function opReturnOut(dataHex = '6e6f7461706174696e61') {
  const data = Buffer.from(dataHex, 'hex');
  return { value: 0, scriptPubKey: Buffer.concat([Buffer.from([0x6a, data.length]), data]).toString('hex') };
}

/** An output carrying a marker built from a decoded marker object. */
export function markerOut(marker) {
  return { value: 0, scriptPubKey: buildScriptPubKey(encodeMarker(marker)).toString('hex') };
}

/** An output carrying a raw marker scriptPubKey. */
export function rawScriptOut(scriptHex, value = 0) {
  return { value, scriptPubKey: scriptHex };
}

/** Wrap a raw marker payload in a minimal push OP_RETURN script. */
export function scriptFromPayload(payloadHex) {
  return buildScriptPubKey(Buffer.from(payloadHex, 'hex')).toString('hex');
}

/** Build a raw marker payload from parts, bypassing every encoder check. */
export function rawPayload({ magic = Buffer.from(MARKER_MAGIC), version = MARKER_VERSION, op, body = Buffer.alloc(0) }) {
  return Buffer.concat([Buffer.from(magic), Buffer.from([version, op]), Buffer.from(body)]).toString('hex');
}

/** A SEED marker payload with a chosen flags byte, used for negative cases. */
export function seedPayloadWithFlags(saltHex, flags, carrierVout) {
  return rawPayload({
    op: OP_SEED,
    body: Buffer.concat([Buffer.from(saltHex, 'hex'), Buffer.from([flags, carrierVout])]),
  });
}

/** A KEEP marker payload built from a raw count and raw entry bytes. */
export function keepPayloadRaw(count, entryBytes) {
  return rawPayload({ op: OP_KEEP, body: Buffer.concat([Buffer.from([count]), Buffer.from(entryBytes)]) });
}

/**
 * An input that spends a taproot commit output through the script path.
 * Pass `commitment` to break the binding on purpose.
 */
export function commitInput({ label, height, salt, key, commitment, value = 200000 }) {
  const claimant = key ?? xonlyFor(label);
  const commit = commitment ?? commitCommitment(claimant, salt).toString('hex');
  const leaf = buildCommitLeafScript(claimant, commit).toString('hex');
  const control = `c0${digest(`internal/${label}`).toString('hex')}`;
  return {
    txid: txidFor(`commit/${label}`),
    vout: 0,
    witness: ['00'.repeat(64), leaf, control],
    prevout: { value, scriptPubKey: p2trFor(label), height },
  };
}

/** An ordinary funding input that reveals nothing. */
export function plainInput({ label, height, value = 50000 }) {
  return {
    txid: txidFor(`plain/${label}`),
    vout: 0,
    witness: [],
    prevout: { value, scriptPubKey: p2wpkhFor(label), height },
  };
}

/** An input that spends a named outpoint, used to spend carriers. */
export function spendInput({ txid, vout, value, scriptPubKey, height }) {
  return { txid, vout, witness: [], prevout: { value, scriptPubKey, height } };
}

/** Assemble a transaction view. */
export function tx({ label, inputs, outputs }) {
  return { txid: txidFor(label), inputs, outputs };
}

/** Assemble a block view. */
export function block({ height, label, txs }) {
  return { height, hash: blockHashFor(label ?? String(height)), txs };
}
