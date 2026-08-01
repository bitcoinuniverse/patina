/**
 * PATINA frozen constants.
 *
 * Every value in this file comes from the frozen implementation baseline.
 * Nothing here may be changed without a new protocol version byte.
 */

/** Human readable protocol name. */
export const PROTOCOL_NAME = 'PATINA';

/** Lowercase slug used in paths, package names and route segments. */
export const PROTOCOL_SLUG = 'patina';

/** Four byte protocol id carried in every marker payload. */
export const PROTOCOL_ID = 'PTNA';

/** Marker magic bytes, ASCII "PTNA". */
export const MARKER_MAGIC = Uint8Array.from([0x50, 0x54, 0x4e, 0x41]);

/** Marker version byte understood by this implementation. */
export const MARKER_VERSION = 0x01;

/** Marker operation byte for SEED. */
export const OP_SEED = 0x01;

/** Marker operation byte for KEEP. */
export const OP_KEEP = 0x02;

/** Bitcoin script opcode OP_RETURN. */
export const OP_RETURN = 0x6a;

/** Bitcoin script opcode OP_CHECKSIG. */
export const OP_CHECKSIG = 0xac;

/** Bitcoin script opcode OP_0 (also the empty push). */
export const OP_0 = 0x00;

/** Bitcoin script opcode OP_IF. */
export const OP_IF = 0x63;

/** Bitcoin script opcode OP_ENDIF. */
export const OP_ENDIF = 0x68;

/** Bitcoin script opcode OP_1, the taproot witness version. */
export const OP_1 = 0x51;

/** Bitcoin script opcode OP_PUSHDATA1. */
export const OP_PUSHDATA1 = 0x4c;

/** Bitcoin script opcode OP_PUSHDATA2. */
export const OP_PUSHDATA2 = 0x4d;

/** Bitcoin script opcode OP_PUSHDATA4. */
export const OP_PUSHDATA4 = 0x4e;

/** Largest byte count a direct push opcode can carry. */
export const MAX_DIRECT_PUSH = 0x4b;

/** Reveal height minus commit output creation height must be at least this. */
export const COMMIT_MIN_AGE = 144;

/** Length in blocks of the founding commit window. */
export const WINDOW_LENGTH = 4032;

/** Length in blocks of the reveal grace period after the window closes. */
export const GRACE_LENGTH = 4032;

/** Minimum carrier value in satoshis for a founding artifact. */
export const MIN_CARRIER_FOUNDING = 100000;

/** Minimum carrier value in satoshis for an open era artifact. */
export const MIN_CARRIER_OPEN = 10000;

/** Minimum value in satoshis for an output to be an eligible successor. */
export const MIN_SUCCESSOR = 10000;

/** Maximum number of entries a KEEP marker may carry. */
export const MAX_KEEP_ENTRIES = 8;

/** Confirmations after which a PATINA fact is treated as final. */
export const CONFIRMATIONS_FINAL = 6;

/** Standardness ceiling for a marker scriptPubKey, in bytes. */
export const MAX_SCRIPT_PUBKEY_BYTES = 83;

/**
 * Largest marker push payload that still fits the scriptPubKey ceiling.
 * A payload of 76 to 80 bytes uses OP_PUSHDATA1, so the overhead is 3 bytes.
 */
export const MAX_MARKER_PAYLOAD_BYTES = 80;

/** Byte length of the SEED payload that follows magic, version and op. */
export const SEED_PAYLOAD_BYTES = 18;

/** Byte length of a complete SEED marker push. */
export const SEED_PUSH_BYTES = 24;

/** Byte length of the marker header: magic, version, op. */
export const MARKER_HEADER_BYTES = 6;

/** Byte length of the salt carried in a SEED payload. */
export const SALT_BYTES = 16;

/** Byte length of an x only public key. */
export const XONLY_BYTES = 32;

/** Byte length of a commit commitment digest. */
export const COMMITMENT_BYTES = 32;

/** Byte length of the tapscript leaf that carries a PATINA commitment. */
export const COMMIT_LEAF_BYTES = 70;

/** Domain tag for the commit commitment digest. */
export const TAG_COMMIT = 'PTNA/commit';

/** Domain tag for the artifact id digest. */
export const TAG_ARTIFACT = 'PTNA/artifact';

/** Domain tag for an event leaf digest. */
export const TAG_EVENT = 'PTNA/event';

/** Domain tag for the state root digest. */
export const TAG_STATE = 'PTNA/state';

/** Domain tag for the off chain attestation message. */
export const TAG_ATTEST = 'PTNA/attest';

/** Domain tag for an internal Merkle node digest. */
export const TAG_NODE = 'PTNA/node';

/** Domain tag for a canonical artifact fact leaf digest. */
export const TAG_LEAF = 'PTNA/leaf';

/** A single patina tier. */
export interface Tier {
  /** Tier index, 0 through 7. */
  readonly index: number;
  /** Tier name. */
  readonly name: string;
  /** Minimum depth in blocks required to hold this tier. Tier 0 has no threshold. */
  readonly threshold: number | null;
}

/** Frozen tier ladder, ordered by ascending threshold. */
export const TIERS: readonly Tier[] = Object.freeze([
  Object.freeze({ index: 0, name: 'Raw', threshold: null }),
  Object.freeze({ index: 1, name: 'Sheen', threshold: 1008 }),
  Object.freeze({ index: 2, name: 'Cast', threshold: 4032 }),
  Object.freeze({ index: 3, name: 'Verdigris', threshold: 12960 }),
  Object.freeze({ index: 4, name: 'Umber', threshold: 26280 }),
  Object.freeze({ index: 5, name: 'Bronze', threshold: 52560 }),
  Object.freeze({ index: 6, name: 'Oxide', threshold: 105120 }),
  Object.freeze({ index: 7, name: 'Elder', threshold: 210000 }),
]) as readonly Tier[];

/** Highest tier index in the ladder. */
export const MAX_TIER_INDEX = 7;

/** Networks a deployment record may name. */
export const NETWORKS = Object.freeze(['regtest', 'signet', 'mainnet'] as const);

/** Network name union. */
export type Network = (typeof NETWORKS)[number];

/** The frozen reason code registry. Order is the registry order. */
export const REASON_CODES = Object.freeze([
  'SEED_BAD_GRAMMAR',
  'SEED_NO_COMMIT_INPUT',
  'SEED_COMMITMENT_MISMATCH',
  'SEED_COMMIT_TOO_YOUNG',
  'SEED_CARRIER_OUT_OF_RANGE',
  'SEED_CARRIER_IS_OPRETURN',
  'SEED_CARRIER_BELOW_MIN',
  'KEEP_BAD_GRAMMAR',
  'KEEP_NO_CARRIER_INPUT',
  'KEEP_ENTRY_NOT_CARRIER',
  'KEEP_ENTRY_OUT_OF_RANGE',
  'KEEP_ENTRY_IS_OPRETURN',
  'KEEP_ENTRY_BELOW_MIN',
  'KEEP_DUPLICATE_INPUT',
  'VOID_DUPLICATE_MARKER',
  'MARKER_UNKNOWN_OP',
  'MARKER_UNKNOWN_VERSION',
  'MARKER_TOO_LARGE',
] as const);

/** Reason code union. */
export type ReasonCode = (typeof REASON_CODES)[number];

/** True when the given string is a registered reason code. */
export function isReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value);
}
