import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readVectors, verifyVectors } from '../scripts/lib/verify-vectors.mjs';
import { REASON_CODES } from '../dist/index.js';

const vectors = readVectors();

test('every golden case reproduces from the library', () => {
  const { passed, failures } = verifyVectors(vectors);
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(passed > 300, `expected a substantial number of checks, got ${passed}`);
});

test('the manifest counts match the fixture', () => {
  const { golden, manifest } = vectors;
  assert.equal(manifest.counts.markerRoundTrips, golden.markerRoundTrips.length);
  assert.equal(manifest.counts.markerFailures, golden.markerFailures.length);
  assert.equal(manifest.counts.nonMarkers, golden.nonMarkers.length);
  assert.equal(manifest.counts.tierSamples, golden.tierSamples.length);
  assert.equal(manifest.counts.scenarios, golden.scenarios.length);
  assert.equal(
    manifest.counts.scenarioBlocks,
    golden.scenarios.reduce((n, s) => n + s.blocks.length, 0),
  );
  assert.equal(manifest.counts.reasonCodesCovered, REASON_CODES.length);
});

test('every reason code appears at least once', () => {
  for (const code of REASON_CODES) {
    const cases = vectors.golden.reasonCoverage[code];
    assert.ok(Array.isArray(cases) && cases.length > 0, `${code} has no case`);
  }
});

test('the fixture carries the cases the specification promises', () => {
  const names = vectors.golden.scenarios.map((s) => s.name);
  for (const required of [
    'founding-carrier-minimum',
    'commit-age-boundary',
    'open-era-carrier-minimum',
    'founding-window-edges',
    'grace-boundary',
    'duplicate-marker-void',
    'keep-single-entry',
    'keep-eight-entries',
    'keep-entry-failures',
    'keep-no-carrier-input',
    'keep-duplicate-input',
    'keep-bad-grammar',
    'seed-bad-grammar',
    'marker-unknown-op-and-version',
    'marker-too-large',
    'seed-semantic-failures',
    'default-rule-successor',
    'relic-creation',
    'bundle-of-three',
    'multi-block-replay',
  ]) {
    assert.ok(names.includes(required), `missing scenario ${required}`);
  }
});

test('the commit age boundary case really sits at 143 and 144', () => {
  const scenario = vectors.golden.scenarios.find((s) => s.name === 'commit-age-boundary');
  const heights = scenario.blocks[0].txs.map((t) => scenario.blocks[0].height - t.inputs[0].prevout.height);
  assert.deepEqual(heights, [143, 144]);
  assert.deepEqual(scenario.steps[0].invalidEvents.map((e) => e.reason), ['SEED_COMMIT_TOO_YOUNG']);
  assert.equal(scenario.steps[0].events.length, 1);
});

test('the KEEP maximum case really carries eight entries', () => {
  const scenario = vectors.golden.scenarios.find((s) => s.name === 'keep-eight-entries');
  const moved = scenario.steps[1].events.filter((e) => e.kind === 'MOVED');
  assert.equal(moved.length, 8);
  assert.deepEqual(moved.map((e) => e.vout).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('the bundle case moves three artifacts on one carrier', () => {
  const scenario = vectors.golden.scenarios.find((s) => s.name === 'bundle-of-three');
  assert.equal(scenario.finalArtifacts.length, 3);
  assert.equal(Object.keys(scenario.finalCarriers).length, 1);
  assert.equal(Object.values(scenario.finalCarriers)[0].length, 3);
  for (const artifact of scenario.finalArtifacts) assert.equal(artifact.rings.length, 2);
});

test('the reorg branches share a fork root and end apart', () => {
  const reorg = vectors.golden.reorg;
  assert.equal(reorg.rootsDiffer, true);
  assert.equal(reorg.commonBlocks.length, 3);
  assert.equal(reorg.branchA.blocks.length, 2);
  assert.equal(reorg.branchB.blocks.length, 2);
  assert.equal(reorg.branchA.blocks[0].height, reorg.branchB.blocks[0].height);
  assert.notEqual(reorg.branchA.blocks[0].hash, reorg.branchB.blocks[0].hash);
  const lastA = reorg.branchA.steps[reorg.branchA.steps.length - 1].stateRoot;
  const lastB = reorg.branchB.steps[reorg.branchB.steps.length - 1].stateRoot;
  assert.notEqual(lastA, lastB);
  assert.notEqual(lastA, reorg.forkStateRoot);
});
