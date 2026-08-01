/**
 * Canonical encodings and roots.
 *
 * Two roots are defined. The event root commits to the state changing events of
 * one block in emission order. The state root commits to the whole snapshot
 * after a block, over artifact facts sorted by artifact id.
 *
 * Every encoding here is fixed width. There are no length prefixes to guess and
 * no textual forms, so two independent implementations either agree byte for
 * byte or they do not.
 */

import { TAG_EVENT, TAG_LEAF, TAG_NODE, TAG_STATE } from './constants.js';
import { domainHash, fromHex, toHex, u32le, u64le } from './hash.js';
import { txidToWire } from './ids.js';
import type { Artifact, PatinaEvent, Ring, Snapshot } from './types.js';

/** Sentinel written where an output index is absent. */
export const NO_VOUT = 0xffffffff;

/** Thirty two zero bytes, written where a txid is absent. */
const ZERO32 = Buffer.alloc(32);

/** Event kind bytes, part of the canonical encoding. */
export const EVENT_KIND_BYTE = Object.freeze({ CREATED: 0x01, MOVED: 0x02, RELIC: 0x03 });

/** Artifact status bytes, part of the canonical encoding. */
export const STATUS_BYTE = Object.freeze({ ALIVE: 0x01, RELIC: 0x02 });

/** Byte length of one canonical event encoding. */
export const EVENT_ENCODING_BYTES = 86;

/** Byte length of one canonical ring encoding. */
export const RING_ENCODING_BYTES = 61;

/** Byte length of a canonical artifact fact, excluding its rings. */
export const ARTIFACT_FACT_HEADER_BYTES = 134;

/** Byte length of the canonical snapshot encoding. */
export const SNAPSHOT_ENCODING_BYTES = 88;

/**
 * Canonical event encoding, 86 fixed bytes:
 *   kind(1) height_le(4) txid_wire(32) artifact_id(32)
 *   vout_le(4) value_le(8) ring_index_le(4) flags(1)
 */
export function encodeEvent(event: PatinaEvent): Buffer {
  const kind = EVENT_KIND_BYTE[event.kind];
  if (kind === undefined) throw new TypeError(`unknown event kind: ${event.kind}`);
  const out = Buffer.concat([
    Buffer.from([kind]),
    u32le(event.height),
    txidToWire(event.txid),
    fromHex(event.artifactId, 32),
    u32le(event.vout === null ? NO_VOUT : event.vout),
    u64le(event.value),
    u32le(event.ringIndex),
    Buffer.from([event.founding ? 0x01 : 0x00]),
  ]);
  if (out.length !== EVENT_ENCODING_BYTES) throw new Error(`event encoding is ${out.length} bytes`);
  return out;
}

/** Event leaf digest, SHA256("PTNA/event" || canonical event encoding). */
export function eventLeaf(event: PatinaEvent): Buffer {
  return domainHash(TAG_EVENT, encodeEvent(event));
}

/**
 * Merkle root over already ordered leaves.
 * Internal nodes are SHA256("PTNA/node" || left || right). An odd node at the
 * end of a level is promoted unchanged rather than paired with itself, so no
 * two distinct leaf lists can share a root by duplication. An empty list has a
 * root of thirty two zero bytes.
 */
export function merkleRoot(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32);
  let level: Buffer[] = leaves.slice();
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(domainHash(TAG_NODE, level[i], level[i + 1]));
      else next.push(level[i]);
    }
    level = next;
  }
  return level[0];
}

/** Event root for one block, in emission order. Lowercase hex. */
export function eventRoot(events: readonly PatinaEvent[]): string {
  return toHex(merkleRoot(events.map(eventLeaf)));
}

/**
 * Canonical ring encoding, 61 fixed bytes:
 *   index_le(4) start_le(4) end_le(4) depth_le(4) carried_value_le(8)
 *   successor_txid_wire(32) successor_vout_le(4) relic(1)
 */
export function encodeRing(ring: Ring): Buffer {
  const out = Buffer.concat([
    u32le(ring.index),
    u32le(ring.startHeight),
    u32le(ring.endHeight),
    u32le(ring.depth),
    u64le(ring.carriedValue),
    ring.successorTxid === null ? ZERO32 : txidToWire(ring.successorTxid),
    u32le(ring.successorVout === null ? NO_VOUT : ring.successorVout),
    Buffer.from([ring.relic ? 0x01 : 0x00]),
  ]);
  if (out.length !== RING_ENCODING_BYTES) throw new Error(`ring encoding is ${out.length} bytes`);
  return out;
}

/**
 * Canonical artifact fact, 134 fixed bytes followed by its rings:
 *   artifact_id(32) status(1) founding(1) birth_height_le(4) birth_txid_wire(32)
 *   birth_vout_le(4) endowment_le(8) carrier_txid_wire(32) carrier_vout_le(4)
 *   carrier_height_le(4) carrier_value_le(8) ring_count_le(4) rings...
 * A relic writes zeroed carrier fields with an absent vout sentinel.
 */
export function encodeArtifactFact(artifact: Artifact): Buffer {
  const status = STATUS_BYTE[artifact.status];
  if (status === undefined) throw new TypeError(`unknown status: ${artifact.status}`);
  const carrier = artifact.carrier;
  const header = Buffer.concat([
    fromHex(artifact.artifactId, 32),
    Buffer.from([status, artifact.founding ? 0x01 : 0x00]),
    u32le(artifact.birthHeight),
    txidToWire(artifact.birthTxid),
    u32le(artifact.birthVout),
    u64le(artifact.endowmentSats),
    carrier === null ? ZERO32 : txidToWire(carrier.txid),
    u32le(carrier === null ? NO_VOUT : carrier.vout),
    u32le(carrier === null ? 0 : carrier.height),
    u64le(carrier === null ? 0 : carrier.value),
    u32le(artifact.rings.length),
  ]);
  if (header.length !== ARTIFACT_FACT_HEADER_BYTES) throw new Error(`artifact fact header is ${header.length} bytes`);
  return Buffer.concat([header, ...artifact.rings.map(encodeRing)]);
}

/** Artifact fact leaf digest, SHA256("PTNA/leaf" || canonical artifact fact). */
export function artifactLeaf(artifact: Artifact): Buffer {
  return domainHash(TAG_LEAF, encodeArtifactFact(artifact));
}

/** Merkle root over artifact facts sorted by artifact id ascending. Lowercase hex. */
export function artifactsRoot(snapshot: Snapshot): string {
  const ids = Object.keys(snapshot.artifacts).sort();
  return toHex(merkleRoot(ids.map((id) => artifactLeaf(snapshot.artifacts[id]))));
}

/**
 * Canonical snapshot encoding, 88 fixed bytes:
 *   height_le(4) artifact_count_le(4) artifacts_root(32)
 *   artifacts_alive_le(8) artifacts_relic_le(8) founding_total_le(8)
 *   rings_total_le(8) deepest_live_depth_le(8) endowment_total_sats_le(8)
 */
export function encodeSnapshot(snapshot: Snapshot): Buffer {
  const ids = Object.keys(snapshot.artifacts).sort();
  const c = snapshot.counters;
  const out = Buffer.concat([
    u32le(snapshot.height < 0 ? 0 : snapshot.height),
    u32le(ids.length),
    fromHex(artifactsRoot(snapshot), 32),
    u64le(c.artifactsAlive),
    u64le(c.artifactsRelic),
    u64le(c.foundingTotal),
    u64le(c.ringsTotal),
    u64le(c.deepestLiveDepth),
    u64le(c.endowmentTotalSats),
  ]);
  if (out.length !== SNAPSHOT_ENCODING_BYTES) throw new Error(`snapshot encoding is ${out.length} bytes`);
  return out;
}

/** State root, SHA256("PTNA/state" || canonical snapshot encoding). Lowercase hex. */
export function stateRoot(snapshot: Snapshot): string {
  return toHex(domainHash(TAG_STATE, encodeSnapshot(snapshot)));
}
