/**
 * Marker codec.
 *
 * A PATINA marker is an OP_RETURN output whose script is exactly:
 *
 *   OP_RETURN PUSH(n) [ "PTNA" | version(1) | op(1) | payload ]
 *
 * The push must be a single minimal data push. Anything else is a grammar
 * failure. Every failure maps to a code from the frozen reason registry.
 */

import {
  MARKER_MAGIC,
  MARKER_VERSION,
  MARKER_HEADER_BYTES,
  MAX_DIRECT_PUSH,
  MAX_KEEP_ENTRIES,
  MAX_MARKER_PAYLOAD_BYTES,
  MAX_SCRIPT_PUBKEY_BYTES,
  OP_KEEP,
  OP_PUSHDATA1,
  OP_PUSHDATA2,
  OP_PUSHDATA4,
  OP_RETURN,
  OP_SEED,
  SALT_BYTES,
  SEED_PAYLOAD_BYTES,
  type ReasonCode,
} from './constants.js';
import { fromHex, toHex, type Bytes } from './hash.js';

/** A decoded SEED marker. */
export interface SeedMarker {
  readonly op: 'SEED';
  /** Sixteen byte commitment salt, lowercase hex. */
  readonly salt: string;
  /** Reserved flags byte. Must be zero at version 1. */
  readonly flags: number;
  /** Output index of the carrier the SEED creates. */
  readonly carrierVout: number;
}

/** A single KEEP routing entry. */
export interface KeepEntry {
  /** Index of the transaction input that spends the carrier. */
  readonly inputIndex: number;
  /** Output index the artifact on that carrier routes to. */
  readonly vout: number;
}

/** A decoded KEEP marker. */
export interface KeepMarker {
  readonly op: 'KEEP';
  readonly entries: readonly KeepEntry[];
}

/** Any decoded marker. */
export type Marker = SeedMarker | KeepMarker;

/** Successful decode. */
export interface DecodeOk {
  readonly ok: true;
  readonly marker: Marker;
}

/** Failed decode, carrying a frozen reason code. */
export interface DecodeErr {
  readonly ok: false;
  readonly reason: ReasonCode;
  readonly detail: string;
}

/** Decode result. */
export type DecodeResult = DecodeOk | DecodeErr;

/** Result of scanning a raw scriptPubKey for a marker candidate. */
export type ScanResult =
  /** The script is not a PATINA marker candidate. It plays no protocol role. */
  | { readonly marker: false }
  /** The script is a candidate and its grammar is exact. */
  | { readonly marker: true; readonly ok: true; readonly payload: Buffer }
  /** The script is a candidate but its grammar is wrong. */
  | { readonly marker: true; readonly ok: false; readonly reason: ReasonCode; readonly detail: string };

function err(reason: ReasonCode, detail: string): DecodeErr {
  return { ok: false, reason, detail };
}

/** True when a script begins with OP_RETURN. */
export function isOpReturnScript(script: Bytes): boolean {
  return script.length > 0 && script[0] === OP_RETURN;
}

/**
 * Read the first data push after OP_RETURN without enforcing minimality.
 * Used for candidate detection only. Returns null when no push can be read.
 */
function readFirstPush(script: Buffer): { data: Buffer; consumed: number; minimal: boolean } | null {
  if (script.length < 2) return null;
  const opcode = script[1];
  let start = 2;
  let len: number;
  let minimal: boolean;
  if (opcode >= 0x01 && opcode <= MAX_DIRECT_PUSH) {
    len = opcode;
    minimal = true;
  } else if (opcode === OP_PUSHDATA1) {
    if (script.length < 3) return null;
    len = script[2];
    start = 3;
    minimal = len > MAX_DIRECT_PUSH;
  } else if (opcode === OP_PUSHDATA2) {
    if (script.length < 4) return null;
    len = script.readUInt16LE(2);
    start = 4;
    minimal = len > 0xff;
  } else if (opcode === OP_PUSHDATA4) {
    if (script.length < 6) return null;
    len = script.readUInt32LE(2);
    start = 6;
    minimal = len > 0xffff;
  } else {
    return null;
  }
  if (start + len > script.length) return null;
  return { data: script.subarray(start, start + len), consumed: start + len, minimal };
}

/** True when a byte array starts with the PATINA magic. */
export function hasMagic(data: Bytes): boolean {
  if (data.length < MARKER_MAGIC.length) return false;
  for (let i = 0; i < MARKER_MAGIC.length; i += 1) {
    if (data[i] !== MARKER_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Pick the reason code that a grammar failure reports for a given payload.
 * The ladder is version, then op, then op specific grammar.
 */
function grammarReason(payload: Buffer): ReasonCode {
  if (payload.length < 5) return 'MARKER_UNKNOWN_VERSION';
  if (payload[4] !== MARKER_VERSION) return 'MARKER_UNKNOWN_VERSION';
  if (payload.length < MARKER_HEADER_BYTES) return 'MARKER_UNKNOWN_OP';
  if (payload[5] === OP_SEED) return 'SEED_BAD_GRAMMAR';
  if (payload[5] === OP_KEEP) return 'KEEP_BAD_GRAMMAR';
  return 'MARKER_UNKNOWN_OP';
}

/**
 * Scan a raw scriptPubKey. Candidate detection is deliberately loose so that a
 * malformed marker still occupies the marker slot of its transaction, while
 * grammar enforcement stays strict.
 */
export function scanScriptPubKey(script: Bytes | string): ScanResult {
  const buf = typeof script === 'string' ? fromHex(script) : Buffer.from(script);
  if (!isOpReturnScript(buf)) return { marker: false };
  const push = readFirstPush(buf);
  if (push === null || !hasMagic(push.data)) return { marker: false };
  const payload = Buffer.from(push.data);
  if (buf.length > MAX_SCRIPT_PUBKEY_BYTES) {
    return { marker: true, ok: false, reason: 'MARKER_TOO_LARGE', detail: `scriptPubKey is ${buf.length} bytes, ceiling is ${MAX_SCRIPT_PUBKEY_BYTES}` };
  }
  if (!push.minimal) {
    return { marker: true, ok: false, reason: grammarReason(payload), detail: 'push is not minimal' };
  }
  if (push.consumed !== buf.length) {
    return { marker: true, ok: false, reason: grammarReason(payload), detail: 'script carries data after the marker push' };
  }
  return { marker: true, ok: true, payload };
}

/** Decode a marker push payload. The payload starts with the magic bytes. */
export function decodeMarker(payload: Bytes | string): DecodeResult {
  const buf = typeof payload === 'string' ? fromHex(payload) : Buffer.from(payload);
  if (!hasMagic(buf)) return err('MARKER_UNKNOWN_OP', 'payload does not start with the PTNA magic');
  if (buf.length > MAX_MARKER_PAYLOAD_BYTES) {
    return err('MARKER_TOO_LARGE', `payload is ${buf.length} bytes, ceiling is ${MAX_MARKER_PAYLOAD_BYTES}`);
  }
  if (buf.length < 5) return err('MARKER_UNKNOWN_VERSION', 'payload has no version byte');
  if (buf[4] !== MARKER_VERSION) return err('MARKER_UNKNOWN_VERSION', `version byte is 0x${buf[4].toString(16).padStart(2, '0')}`);
  if (buf.length < MARKER_HEADER_BYTES) return err('MARKER_UNKNOWN_OP', 'payload has no op byte');

  const op = buf[5];
  const body = buf.subarray(MARKER_HEADER_BYTES);

  if (op === OP_SEED) {
    if (body.length !== SEED_PAYLOAD_BYTES) {
      return err('SEED_BAD_GRAMMAR', `SEED payload is ${body.length} bytes, expected ${SEED_PAYLOAD_BYTES}`);
    }
    const flags = body[SALT_BYTES];
    if (flags !== 0x00) return err('SEED_BAD_GRAMMAR', `flags byte is 0x${flags.toString(16).padStart(2, '0')}, every bit is reserved at version 1`);
    return {
      ok: true,
      marker: {
        op: 'SEED',
        salt: toHex(body.subarray(0, SALT_BYTES)),
        flags,
        carrierVout: body[SALT_BYTES + 1],
      },
    };
  }

  if (op === OP_KEEP) {
    if (body.length < 1) return err('KEEP_BAD_GRAMMAR', 'KEEP payload has no count byte');
    const count = body[0];
    if (count < 1 || count > MAX_KEEP_ENTRIES) {
      return err('KEEP_BAD_GRAMMAR', `KEEP count is ${count}, allowed range is 1 to ${MAX_KEEP_ENTRIES}`);
    }
    const expected = 1 + count * 2;
    if (body.length !== expected) {
      return err('KEEP_BAD_GRAMMAR', `KEEP payload is ${body.length} bytes, expected ${expected} for count ${count}`);
    }
    const entries: KeepEntry[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < count; i += 1) {
      const inputIndex = body[1 + i * 2];
      const vout = body[2 + i * 2];
      if (seen.has(inputIndex)) {
        return err('KEEP_DUPLICATE_INPUT', `input index ${inputIndex} appears more than once`);
      }
      seen.add(inputIndex);
      entries.push({ inputIndex, vout });
    }
    return { ok: true, marker: { op: 'KEEP', entries } };
  }

  return err('MARKER_UNKNOWN_OP', `op byte is 0x${op.toString(16).padStart(2, '0')}`);
}

/** Encode a marker into its push payload. */
export function encodeMarker(marker: Marker): Buffer {
  if (marker.op === 'SEED') {
    const salt = fromHex(marker.salt, SALT_BYTES);
    const flags = marker.flags ?? 0;
    if (!Number.isInteger(flags) || flags !== 0) {
      throw new RangeError('SEED flags must be 0 at version 1');
    }
    if (!Number.isInteger(marker.carrierVout) || marker.carrierVout < 0 || marker.carrierVout > 0xff) {
      throw new RangeError(`carrierVout out of range: ${marker.carrierVout}`);
    }
    return Buffer.concat([
      Buffer.from(MARKER_MAGIC),
      Buffer.from([MARKER_VERSION, OP_SEED]),
      salt,
      Buffer.from([flags, marker.carrierVout]),
    ]);
  }

  if (marker.op === 'KEEP') {
    const entries = marker.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_KEEP_ENTRIES) {
      throw new RangeError(`KEEP needs 1 to ${MAX_KEEP_ENTRIES} entries, got ${entries?.length}`);
    }
    const seen = new Set<number>();
    const body = Buffer.alloc(1 + entries.length * 2);
    body[0] = entries.length;
    entries.forEach((entry, i) => {
      for (const field of ['inputIndex', 'vout'] as const) {
        const v = entry[field];
        if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RangeError(`KEEP ${field} out of range: ${v}`);
      }
      if (seen.has(entry.inputIndex)) throw new RangeError(`KEEP duplicate input index: ${entry.inputIndex}`);
      seen.add(entry.inputIndex);
      body[1 + i * 2] = entry.inputIndex;
      body[2 + i * 2] = entry.vout;
    });
    return Buffer.concat([Buffer.from(MARKER_MAGIC), Buffer.from([MARKER_VERSION, OP_KEEP]), body]);
  }

  throw new TypeError(`unknown marker op: ${(marker as { op: string }).op}`);
}

/** Wrap a marker payload in its OP_RETURN scriptPubKey with a minimal push. */
export function buildScriptPubKey(payload: Bytes): Buffer {
  const data = Buffer.from(payload);
  if (data.length === 0 || data.length > MAX_MARKER_PAYLOAD_BYTES) {
    throw new RangeError(`marker payload must be 1 to ${MAX_MARKER_PAYLOAD_BYTES} bytes, got ${data.length}`);
  }
  const prefix =
    data.length <= MAX_DIRECT_PUSH
      ? Buffer.from([OP_RETURN, data.length])
      : Buffer.from([OP_RETURN, OP_PUSHDATA1, data.length]);
  const script = Buffer.concat([prefix, data]);
  if (script.length > MAX_SCRIPT_PUBKEY_BYTES) {
    throw new RangeError(`scriptPubKey would be ${script.length} bytes, ceiling is ${MAX_SCRIPT_PUBKEY_BYTES}`);
  }
  return script;
}

/** Build a complete marker scriptPubKey in one call. */
export function buildMarkerScript(marker: Marker): Buffer {
  return buildScriptPubKey(encodeMarker(marker));
}

/** Scan and decode a raw scriptPubKey. Returns null when it is not a candidate. */
export function decodeScriptPubKey(script: Bytes | string): DecodeResult | null {
  const scan = scanScriptPubKey(script);
  if (!scan.marker) return null;
  if (!scan.ok) return err(scan.reason, scan.detail);
  return decodeMarker(scan.payload);
}
