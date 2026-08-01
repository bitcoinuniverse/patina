/**
 * Wire serialization.
 *
 * The record shapes in the specification use snake_case field names, satoshi
 * values as decimal strings and heights as numbers. That is the contract other
 * implementations read.
 *
 * This library uses camelCase internally because that is what TypeScript callers
 * expect. Everything that crosses a process boundary goes through this file, so
 * the two naming worlds never mix by accident.
 */

import type { Network } from './constants.js';
import type {
  Artifact,
  Counters,
  DeploymentRecord,
  InvalidEvent,
  Ring,
} from './types.js';

/** A ring as it appears on the wire. */
export interface WireRing {
  index: number;
  start_height: number;
  end_height: number;
  depth: number;
  carried_value: string;
  successor_txid: string | null;
  successor_vout: number | null;
  relic: boolean;
}

/** A carrier as it appears on the wire. */
export interface WireCarrier {
  txid: string;
  vout: number;
  height: number;
  value: string;
}

/** An artifact as it appears on the wire. */
export interface WireArtifact {
  artifact_id: string;
  birth_txid: string;
  birth_height: number;
  birth_vout: number;
  endowment_sats: string;
  founding: boolean;
  status: 'ALIVE' | 'RELIC';
  carrier: WireCarrier | null;
  rings: WireRing[];
}

/** An invalid event as it appears on the wire. */
export interface WireInvalidEvent {
  height: number;
  tx_index: number;
  txid: string;
  vout: number | null;
  reason: string;
  detail: string;
}

/** The counters object as it appears on the wire. */
export interface WireCounters {
  artifacts_alive: number;
  artifacts_relic: number;
  founding_total: number;
  rings_total: number;
  deepest_live_depth: number;
  endowment_total_sats: string;
}

/** A deployment record as it appears on the wire and on disk. */
export interface WireDeployment {
  network: Network;
  protocol_id: string;
  spec_sha256: string;
  h_open: number | null;
  h_close: number | null;
  grace_end: number | null;
  min_carrier_founding: number;
  min_carrier_open: number;
  commit_min_age: number;
  approvers?: string[];
}

/** Serialize a ring. */
export function toWireRing(ring: Ring): WireRing {
  return {
    index: ring.index,
    start_height: ring.startHeight,
    end_height: ring.endHeight,
    depth: ring.depth,
    carried_value: String(ring.carriedValue),
    successor_txid: ring.successorTxid,
    successor_vout: ring.successorVout,
    relic: ring.relic,
  };
}

/** Serialize an artifact. */
export function toWireArtifact(artifact: Artifact): WireArtifact {
  return {
    artifact_id: artifact.artifactId,
    birth_txid: artifact.birthTxid,
    birth_height: artifact.birthHeight,
    birth_vout: artifact.birthVout,
    endowment_sats: String(artifact.endowmentSats),
    founding: artifact.founding,
    status: artifact.status,
    carrier:
      artifact.carrier === null
        ? null
        : {
            txid: artifact.carrier.txid,
            vout: artifact.carrier.vout,
            height: artifact.carrier.height,
            value: String(artifact.carrier.value),
          },
    rings: artifact.rings.map(toWireRing),
  };
}

/** Serialize an invalid event. */
export function toWireInvalidEvent(event: InvalidEvent): WireInvalidEvent {
  return {
    height: event.height,
    tx_index: event.txIndex,
    txid: event.txid,
    vout: event.vout,
    reason: event.reason,
    detail: event.detail,
  };
}

/** Serialize the counters object. */
export function toWireCounters(counters: Counters): WireCounters {
  return {
    artifacts_alive: counters.artifactsAlive,
    artifacts_relic: counters.artifactsRelic,
    founding_total: counters.foundingTotal,
    rings_total: counters.ringsTotal,
    deepest_live_depth: counters.deepestLiveDepth,
    endowment_total_sats: String(counters.endowmentTotalSats),
  };
}

/** Serialize a deployment record. */
export function toWireDeployment(record: DeploymentRecord): WireDeployment {
  const out: WireDeployment = {
    network: record.network,
    protocol_id: record.protocolId,
    spec_sha256: record.specSha256,
    h_open: record.hOpen,
    h_close: record.hClose,
    grace_end: record.graceEnd,
    min_carrier_founding: record.minCarrierFounding,
    min_carrier_open: record.minCarrierOpen,
    commit_min_age: record.commitMinAge,
  };
  if (record.approvers !== undefined) out.approvers = [...record.approvers];
  return out;
}

/**
 * Read a field that may arrive under its wire name or its camelCase name.
 * The wire name wins when both are present.
 */
export function readField(source: Record<string, unknown>, wireName: string, camelName: string): unknown {
  if (wireName in source) return source[wireName];
  return source[camelName];
}
