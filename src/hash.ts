/**
 * Hash helpers.
 *
 * PATINA uses single SHA-256 everywhere. A domain tag is the ASCII bytes of the
 * tag string prepended to the message with no separator byte. This is not the
 * BIP-340 tagged hash construction, and the two must not be confused.
 */

import { createHash } from 'node:crypto';

/** Byte input accepted by the hash helpers. */
export type Bytes = Uint8Array | Buffer;

/** Single SHA-256 over the concatenation of every part. */
export function sha256(...parts: Bytes[]): Buffer {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
}

/** Single SHA-256 over ASCII(tag) followed by every part. */
export function domainHash(tag: string, ...parts: Bytes[]): Buffer {
  return sha256(Buffer.from(tag, 'ascii'), ...parts);
}

/** Lowercase hex of a byte array. */
export function toHex(bytes: Bytes): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Parse a lowercase or uppercase hex string into a Buffer.
 * Throws when the string is not hex or when an expected length is not met.
 */
export function fromHex(hex: string, expectedBytes?: number): Buffer {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new TypeError(`not a hex string: ${String(hex)}`);
  }
  const buf = Buffer.from(hex, 'hex');
  if (expectedBytes !== undefined && buf.length !== expectedBytes) {
    throw new RangeError(`expected ${expectedBytes} bytes, got ${buf.length}`);
  }
  return buf;
}

/** Little endian unsigned 32 bit encoding. */
export function u32le(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`u32 out of range: ${value}`);
  }
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value, 0);
  return b;
}

/** Little endian unsigned 64 bit encoding. */
export function u64le(value: number | bigint): Buffer {
  const v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  if (v < 0n || v > 0xffffffffffffffffn) {
    throw new RangeError(`u64 out of range: ${String(value)}`);
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

/** Constant time equality for two byte arrays of any length. */
export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
