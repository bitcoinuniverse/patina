/**
 * Depth and tiers.
 *
 * Depth is never stored per block. It is computed from the current carrier at
 * query time, so a node that replays the chain and a node that serves an API
 * always agree.
 */

import { MAX_TIER_INDEX, TIERS, type Tier } from './constants.js';
import type { Artifact } from './types.js';

/**
 * Depth of an artifact at a height.
 * ALIVE: height minus the height its current carrier was created, floored at 0.
 * RELIC: the depth of its final ring, which never grows again.
 */
export function depthAt(artifact: Pick<Artifact, 'status' | 'carrier' | 'rings'>, height: number): number {
  if (!Number.isInteger(height)) throw new TypeError(`height must be an integer, got ${height}`);
  if (artifact.status === 'RELIC' || artifact.carrier === null) {
    const last = artifact.rings.length > 0 ? artifact.rings[artifact.rings.length - 1] : null;
    return last === null ? 0 : last.depth;
  }
  const depth = height - artifact.carrier.height;
  return depth > 0 ? depth : 0;
}

/** The tier held at a depth. Returns the highest tier whose threshold fits. */
export function tierFor(depth: number): Tier {
  if (!Number.isInteger(depth) || depth < 0) throw new RangeError(`depth must be a non negative integer, got ${depth}`);
  let held = TIERS[0];
  for (const tier of TIERS) {
    if (tier.threshold !== null && depth >= tier.threshold) held = tier;
  }
  return held;
}

/** The tier above the one held at a depth, or null at the top of the ladder. */
export function nextTier(depth: number): Tier | null {
  const held = tierFor(depth);
  if (held.index >= MAX_TIER_INDEX) return null;
  return TIERS[held.index + 1];
}

/** Blocks remaining until the next tier, or null at the top of the ladder. */
export function blocksToNextTier(depth: number): number | null {
  const next = nextTier(depth);
  if (next === null || next.threshold === null) return null;
  const remaining = next.threshold - depth;
  return remaining > 0 ? remaining : 0;
}

/** Look up a tier by index. Throws for an index outside the ladder. */
export function tierByIndex(index: number): Tier {
  const tier = TIERS[index];
  if (tier === undefined) throw new RangeError(`no tier with index ${index}`);
  return tier;
}
