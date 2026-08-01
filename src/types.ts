/**
 * Views and records.
 *
 * A BlockView is a fully resolved block. Every input carries its prevout value,
 * scriptPubKey and creation height, and the witness stack as revealed on chain.
 * With that, the reducer needs no chain access and no I/O at all.
 *
 * Satoshi values are plain numbers. The whole money supply is 2.1e15 satoshis,
 * which is below Number.MAX_SAFE_INTEGER, so no value in a view can lose
 * precision. API layers still serialize satoshis as decimal strings.
 */

import type { Network, ReasonCode } from './constants.js';

/** A resolved transaction output. */
export interface OutputView {
  /** Value in satoshis. */
  readonly value: number;
  /** Raw scriptPubKey, lowercase hex. */
  readonly scriptPubKey: string;
}

/** The prevout an input spends, resolved from the chain. */
export interface PrevoutView {
  /** Value in satoshis. */
  readonly value: number;
  /** Raw scriptPubKey, lowercase hex. */
  readonly scriptPubKey: string;
  /** Height of the block that created this output. */
  readonly height: number;
}

/** A resolved transaction input. */
export interface InputView {
  /** Prevout txid in display order. */
  readonly txid: string;
  /** Prevout index. */
  readonly vout: number;
  /** Witness stack items, lowercase hex, in stack order. Empty for legacy inputs. */
  readonly witness?: readonly string[];
  /** The resolved prevout. */
  readonly prevout: PrevoutView;
}

/** A resolved transaction. */
export interface TxView {
  /** Transaction id in display order. */
  readonly txid: string;
  /** Inputs in index order. */
  readonly inputs: readonly InputView[];
  /** Outputs in index order. */
  readonly outputs: readonly OutputView[];
  /** True for the block's coinbase transaction. Coinbase is ignored by PATINA. */
  readonly coinbase?: boolean;
}

/** A resolved block. */
export interface BlockView {
  /** Block height. */
  readonly height: number;
  /** Block hash in display order. */
  readonly hash: string;
  /** Parent block hash in display order. Optional but recommended. */
  readonly prevHash?: string;
  /** Transactions in block order. */
  readonly txs: readonly TxView[];
}

/** Where an artifact currently rests. */
export interface Carrier {
  /** Txid of the transaction that created the carrier, display order. */
  readonly txid: string;
  /** Output index of the carrier. */
  readonly vout: number;
  /** Height of the block that created the carrier. */
  readonly height: number;
  /** Carrier value in satoshis. */
  readonly value: number;
}

/** One closed stretch in an artifact's life. */
export interface Ring {
  /** Zero based ring index, in the order the rings closed. */
  readonly index: number;
  /** Height the carrier that just closed was created. */
  readonly startHeight: number;
  /** Height the carrier was spent. */
  readonly endHeight: number;
  /** endHeight minus startHeight. */
  readonly depth: number;
  /** Value of the carrier that was spent, in satoshis. */
  readonly carriedValue: number;
  /** Txid of the successor carrier, display order, or null when the ring is terminal. */
  readonly successorTxid: string | null;
  /** Output index of the successor carrier, or null when the ring is terminal. */
  readonly successorVout: number | null;
  /** True when this ring ended the artifact's life. */
  readonly relic: boolean;
}

/** Artifact lifecycle status. */
export type ArtifactStatus = 'ALIVE' | 'RELIC';

/** A PATINA artifact. */
export interface Artifact {
  /** Artifact id, lowercase hex. */
  readonly artifactId: string;
  /** Txid of the SEED reveal, display order. */
  readonly birthTxid: string;
  /** Height of the SEED reveal. */
  readonly birthHeight: number;
  /** Carrier output index at birth. */
  readonly birthVout: number;
  /** Carrier value at birth, in satoshis. */
  readonly endowmentSats: number;
  /** True when the artifact met the founding window rules. */
  readonly founding: boolean;
  /** Lifecycle status. */
  readonly status: ArtifactStatus;
  /** Current carrier, or null once the artifact is a relic. */
  readonly carrier: Carrier | null;
  /** Closed stretches, oldest first. */
  readonly rings: readonly Ring[];
}

/** A state changing event emitted by the reducer. */
export type EventKind = 'CREATED' | 'MOVED' | 'RELIC';

/** A state changing event. */
export interface PatinaEvent {
  readonly kind: EventKind;
  /** Height of the block that produced the event. */
  readonly height: number;
  /** Index of the transaction inside the block. */
  readonly txIndex: number;
  /** Txid that produced the event, display order. */
  readonly txid: string;
  /** Artifact the event concerns. */
  readonly artifactId: string;
  /**
   * Output index the event points at.
   * CREATED points at the new carrier, MOVED points at the successor,
   * RELIC has no output and carries null.
   */
  readonly vout: number | null;
  /**
   * Satoshi value the event points at.
   * CREATED and MOVED carry the carrier value, RELIC carries 0.
   */
  readonly value: number;
  /** Ring index the event closed. CREATED carries 0. */
  readonly ringIndex: number;
  /** True on CREATED when the artifact is founding. Zero otherwise. */
  readonly founding: boolean;
}

/** A rejected protocol attempt, kept for auditability. */
export interface InvalidEvent {
  /** Height of the block that contained the attempt. */
  readonly height: number;
  /** Index of the transaction inside the block. */
  readonly txIndex: number;
  /** Txid of the attempt, display order. */
  readonly txid: string;
  /** Output index the failure concerns, or null when it concerns no single output. */
  readonly vout: number | null;
  /** Frozen reason code. */
  readonly reason: ReasonCode;
  /** Human readable detail. Never parsed by consumers. */
  readonly detail: string;
}

/** Aggregate counters carried in the snapshot. */
export interface Counters {
  readonly artifactsAlive: number;
  readonly artifactsRelic: number;
  readonly foundingTotal: number;
  readonly ringsTotal: number;
  readonly deepestLiveDepth: number;
  readonly endowmentTotalSats: number;
}

/** The full deterministic state. */
export interface Snapshot {
  /** Height of the last applied block, or -1 when nothing has been applied. */
  readonly height: number;
  /** Hash of the last applied block, display order, or null. */
  readonly blockHash: string | null;
  /** Artifacts keyed by artifact id. */
  readonly artifacts: Readonly<Record<string, Artifact>>;
  /** Live carriers keyed by outpoint, each holding the artifact ids that rest there. */
  readonly carriers: Readonly<Record<string, readonly string[]>>;
  /** Aggregate counters. */
  readonly counters: Counters;
}

/** A deployment record binds the protocol to one network and one window. */
export interface DeploymentRecord {
  readonly network: Network;
  /** Always "PTNA". */
  readonly protocolId: string;
  /** SHA-256 of patina-protocol.md, lowercase hex. */
  readonly specSha256: string;
  /** First height at which a commit output counts toward the founding window. */
  readonly hOpen: number | null;
  /** First height at which a commit output no longer counts, exclusive bound. */
  readonly hClose: number | null;
  /** Last height at which a founding reveal is accepted. Equals hClose + GRACE_LENGTH. */
  readonly graceEnd: number | null;
  readonly minCarrierFounding: number;
  readonly minCarrierOpen: number;
  readonly commitMinAge: number;
  /** Names of the approvers who authorized a mainnet deployment. */
  readonly approvers?: readonly string[];
}

/** Founding window lifecycle state at a given tip. */
export type WindowState = 'PENDING' | 'OPEN' | 'GRACE' | 'CLOSED';

/** Confirmation status for a fact an indexer reports. */
export type ConfirmationStatus = 'MEMPOOL' | 'PENDING' | 'FINAL';
