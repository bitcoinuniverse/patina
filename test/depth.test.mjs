import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blocksToNextTier, depthAt, MAX_TIER_INDEX, nextTier, tierByIndex, tierFor, TIERS } from '../dist/index.js';

const alive = (carrierHeight) => ({
  status: 'ALIVE',
  carrier: { txid: '00'.repeat(32), vout: 0, height: carrierHeight, value: 100000 },
  rings: [],
});

const relic = (depth) => ({
  status: 'RELIC',
  carrier: null,
  rings: [
    { index: 0, startHeight: 100, endHeight: 150, depth: 50, carriedValue: 1, successorTxid: null, successorVout: null, relic: false },
    { index: 1, startHeight: 150, endHeight: 150 + depth, depth, carriedValue: 1, successorTxid: null, successorVout: null, relic: true },
  ],
});

test('the tier ladder holds the frozen thresholds', () => {
  assert.deepEqual(
    TIERS.map((t) => [t.index, t.name, t.threshold]),
    [
      [0, 'Raw', null],
      [1, 'Sheen', 1008],
      [2, 'Cast', 4032],
      [3, 'Verdigris', 12960],
      [4, 'Umber', 26280],
      [5, 'Bronze', 52560],
      [6, 'Oxide', 105120],
      [7, 'Elder', 210000],
    ],
  );
  assert.equal(MAX_TIER_INDEX, 7);
});

test('depth of a live artifact is the blocks since its carrier was created', () => {
  assert.equal(depthAt(alive(1000), 1000), 0);
  assert.equal(depthAt(alive(1000), 1001), 1);
  assert.equal(depthAt(alive(1000), 1000 + 210000), 210000);
});

test('depth never goes negative when a height before the carrier is asked for', () => {
  assert.equal(depthAt(alive(1000), 999), 0);
  assert.equal(depthAt(alive(1000), 0), 0);
});

test('depth of a relic is frozen at its final ring', () => {
  const artifact = relic(4321);
  assert.equal(depthAt(artifact, 200), 4321);
  assert.equal(depthAt(artifact, 999999), 4321);
});

test('a relic with no rings reports depth zero', () => {
  assert.equal(depthAt({ status: 'RELIC', carrier: null, rings: [] }, 5000), 0);
});

test('depthAt rejects a non integer height', () => {
  assert.throws(() => depthAt(alive(10), 1.5), /integer/);
});

test('every threshold is exact on both sides', () => {
  for (const tier of TIERS) {
    if (tier.threshold === null) continue;
    assert.equal(tierFor(tier.threshold - 1).index, tier.index - 1, `just below ${tier.name}`);
    assert.equal(tierFor(tier.threshold).index, tier.index, `exactly at ${tier.name}`);
    assert.equal(tierFor(tier.threshold + 1).index, tier.index, `just above ${tier.name}`);
  }
});

test('depth zero is Raw and a huge depth is Elder', () => {
  assert.equal(tierFor(0).name, 'Raw');
  assert.equal(tierFor(1).name, 'Raw');
  assert.equal(tierFor(1_000_000).name, 'Elder');
});

test('tierFor rejects a negative or fractional depth', () => {
  assert.throws(() => tierFor(-1), /non negative/);
  assert.throws(() => tierFor(1.5), /non negative/);
});

test('next tier and blocks to next tier line up with the ladder', () => {
  assert.equal(nextTier(0).name, 'Sheen');
  assert.equal(blocksToNextTier(0), 1008);
  assert.equal(blocksToNextTier(1007), 1);
  assert.equal(nextTier(1008).name, 'Cast');
  assert.equal(blocksToNextTier(1008), 4032 - 1008);
  assert.equal(blocksToNextTier(4031), 1);
  assert.equal(blocksToNextTier(209999), 1);
});

test('the top of the ladder has no next tier', () => {
  assert.equal(nextTier(210000), null);
  assert.equal(blocksToNextTier(210000), null);
  assert.equal(nextTier(500000), null);
  assert.equal(blocksToNextTier(500000), null);
});

test('tierByIndex reads the ladder and rejects anything outside it', () => {
  assert.equal(tierByIndex(0).name, 'Raw');
  assert.equal(tierByIndex(7).name, 'Elder');
  assert.throws(() => tierByIndex(8), /no tier/);
  assert.throws(() => tierByIndex(-1), /no tier/);
});
