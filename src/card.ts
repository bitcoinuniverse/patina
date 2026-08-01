/**
 * Share card payload.
 *
 * The card is the small, self contained view an API hands to a renderer. It is
 * pinned to a height and a block hash so that a card can be checked later, and
 * it carries the specification hash so that a stale renderer is visible.
 *
 * The card is an API surface, so it is built directly in the wire form: snake
 * case names, satoshi values as decimal strings, heights as numbers.
 */

import type { Network } from './constants.js';
import { blocksToNextTier, depthAt, nextTier, tierFor } from './depth.js';
import type { Artifact, ArtifactStatus } from './types.js';

/** The context an API adds around one artifact. */
export interface ShareCardContext {
  readonly network: Network;
  /** SHA-256 of patina-protocol.md, lowercase hex. */
  readonly specSha256: string;
  /** Height the card speaks for. */
  readonly asOfHeight: number;
  /** Hash of that block, display order. */
  readonly asOfBlockHash: string;
}

/** The carrier as it appears inside a share card. */
export interface ShareCardCarrier {
  readonly txid: string;
  readonly vout: number;
  readonly height: number;
  readonly value: string;
}

/** The share card payload. */
export interface ShareCard {
  readonly protocol: 'PTNA';
  readonly network: Network;
  readonly spec_sha256: string;
  readonly artifact_id: string;
  readonly status: ArtifactStatus;
  readonly founding: boolean;
  readonly birth_txid: string;
  readonly birth_height: number;
  readonly endowment_sats: string;
  readonly depth: number;
  readonly tier: number;
  readonly tier_name: string;
  readonly next_tier_name: string | null;
  readonly blocks_to_next_tier: number | null;
  readonly rings_total: number;
  readonly longest_ring_depth: number;
  readonly carrier: ShareCardCarrier | null;
  readonly as_of_height: number;
  readonly as_of_block_hash: string;
}

/** Build the share card payload for one artifact at one height. */
export function buildShareCard(artifact: Artifact, context: ShareCardContext): ShareCard {
  if (!/^[0-9a-f]{64}$/.test(context.specSha256)) throw new TypeError('specSha256 must be 64 lowercase hex characters');
  if (!/^[0-9a-f]{64}$/.test(context.asOfBlockHash)) throw new TypeError('asOfBlockHash must be 64 lowercase hex characters');
  if (!Number.isInteger(context.asOfHeight) || context.asOfHeight < 0) {
    throw new RangeError(`asOfHeight must be a non negative integer, got ${context.asOfHeight}`);
  }

  const depth = depthAt(artifact, context.asOfHeight);
  const tier = tierFor(depth);
  const next = nextTier(depth);
  let longestRingDepth = 0;
  for (const ring of artifact.rings) if (ring.depth > longestRingDepth) longestRingDepth = ring.depth;

  return Object.freeze({
    protocol: 'PTNA',
    network: context.network,
    spec_sha256: context.specSha256,
    artifact_id: artifact.artifactId,
    status: artifact.status,
    founding: artifact.founding,
    birth_txid: artifact.birthTxid,
    birth_height: artifact.birthHeight,
    endowment_sats: String(artifact.endowmentSats),
    depth,
    tier: tier.index,
    tier_name: tier.name,
    next_tier_name: next === null ? null : next.name,
    blocks_to_next_tier: blocksToNextTier(depth),
    rings_total: artifact.rings.length,
    longest_ring_depth: longestRingDepth,
    carrier:
      artifact.carrier === null
        ? null
        : Object.freeze({
            txid: artifact.carrier.txid,
            vout: artifact.carrier.vout,
            height: artifact.carrier.height,
            value: String(artifact.carrier.value),
          }),
    as_of_height: context.asOfHeight,
    as_of_block_hash: context.asOfBlockHash,
  }) as ShareCard;
}
