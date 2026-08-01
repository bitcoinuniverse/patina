/**
 * Conformance verifier for vectors/golden.json.
 *
 * Every recorded value is recomputed from the built library and compared. The
 * CLI and the test suite both call this, so `patina vectors verify` and
 * `npm test` check exactly the same things.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  artifactId,
  attestationMessage,
  blocksToNextTier,
  buildLegacyCommitLeafScript,
  buildScriptPubKey,
  commitCommitment,
  decodeScriptPubKey,
  depthAt,
  encodeMarker,
  loadShippedDeployment,
  nextTier,
  replay,
  REASON_CODES,
  tierFor,
} from '../../dist/index.js';

import { readSpecBytes, specSha256 } from '../verify-spec.mjs';

const GOLDEN_PATH = fileURLToPath(new URL('../../vectors/golden.json', import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL('../../vectors/manifest.json', import.meta.url));

/** Stable stringify with sorted object keys, used for structural comparison. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

class Checker {
  constructor() {
    this.passed = 0;
    this.failures = [];
  }

  equal(label, actual, expected) {
    const a = canonical(actual);
    const b = canonical(expected);
    if (a === b) {
      this.passed += 1;
      return true;
    }
    this.failures.push(`${label}\n    actual   ${a.slice(0, 400)}\n    expected ${b.slice(0, 400)}`);
    return false;
  }

  true(label, condition) {
    if (condition === true) {
      this.passed += 1;
      return true;
    }
    this.failures.push(label);
    return false;
  }
}

function stepView(step) {
  return {
    height: step.height,
    blockHash: step.blockHash,
    eventRoot: step.eventRoot,
    stateRoot: step.stateRoot,
    events: step.events,
    invalidEvents: step.invalidEvents,
  };
}

function artifactView(state, height) {
  return Object.keys(state.artifacts)
    .sort()
    .map((id) => {
      const a = state.artifacts[id];
      const depth = depthAt(a, height);
      const tier = tierFor(depth);
      const next = nextTier(depth);
      return {
        artifactId: a.artifactId,
        birthTxid: a.birthTxid,
        birthHeight: a.birthHeight,
        birthVout: a.birthVout,
        endowmentSats: a.endowmentSats,
        founding: a.founding,
        status: a.status,
        carrier: a.carrier,
        rings: a.rings,
        depth,
        tierIndex: tier.index,
        tierName: tier.name,
        nextTierIndex: next === null ? null : next.index,
        blocksToNextTier: blocksToNextTier(depth),
      };
    });
}

function carrierView(state) {
  const outp = {};
  for (const key of Object.keys(state.carriers).sort()) outp[key] = [...state.carriers[key]];
  return outp;
}

/** Read the shipped fixture and manifest, with their raw bytes. */
export function readVectors() {
  const goldenBytes = readFileSync(GOLDEN_PATH);
  const manifestBytes = readFileSync(MANIFEST_PATH);
  return {
    golden: JSON.parse(goldenBytes.toString('utf8')),
    goldenBytes,
    manifest: JSON.parse(manifestBytes.toString('utf8')),
  };
}

/**
 * Verify every case in the fixture.
 * Returns the number of checks that passed and the list of failures.
 */
export function verifyVectors(input = readVectors()) {
  const { golden, goldenBytes, manifest } = input;
  const check = new Checker();
  const deployments = { regtest: loadShippedDeployment('regtest') };

  const specHash = specSha256(readSpecBytes());
  check.equal('manifest.specSha256 matches the specification file', manifest.specSha256, specHash);
  check.equal('golden.specSha256 matches the specification file', golden.specSha256, specHash);
  check.equal(
    'manifest.fixtureSha256 matches golden.json',
    manifest.fixtureSha256,
    createHash('sha256').update(goldenBytes).digest('hex'),
  );
  check.equal('golden.protocol', golden.protocol, 'PTNA');
  check.equal('golden.markerVersion', golden.markerVersion, 1);
  check.equal('regtest deployment record', golden.deployments.regtest, deployments.regtest);

  for (const item of golden.derivations.commitCommitment) {
    check.equal(
      `commitCommitment ${item.name}`,
      commitCommitment(item.claimantXOnly, item.salt).toString('hex'),
      item.expected,
    );
  }
  for (const item of golden.derivations.artifactId) {
    check.equal(`artifactId ${item.name}`, artifactId(item.revealTxidDisplay, item.carrierVout), item.expected);
  }
  for (const item of golden.derivations.commitLeaf) {
    check.equal(
      `commitLeaf ${item.name}`,
      buildLegacyCommitLeafScript(item.claimantXOnly, item.commitment).toString('hex'),
      item.scriptHex,
    );
  }
  for (const item of golden.derivations.attestation) {
    check.equal(`attestation ${item.name}`, attestationMessage(item.artifactId, item.blockHash), item.message);
  }

  for (const item of golden.markerRoundTrips) {
    const payload = encodeMarker(item.marker);
    check.equal(`marker ${item.name} payload`, payload.toString('hex'), item.payloadHex);
    const script = buildScriptPubKey(payload);
    check.equal(`marker ${item.name} script`, script.toString('hex'), item.scriptHex);
    check.equal(`marker ${item.name} script bytes`, script.length, item.scriptBytes);
    const decoded = decodeScriptPubKey(item.scriptHex);
    check.true(`marker ${item.name} decodes`, decoded !== null && decoded.ok === true);
    if (decoded !== null && decoded.ok) check.equal(`marker ${item.name} decoded value`, decoded.marker, item.decoded);
  }

  for (const item of golden.markerFailures) {
    const decoded = decodeScriptPubKey(item.scriptHex);
    check.true(`markerFailure ${item.name} is a candidate`, decoded !== null);
    if (decoded === null) continue;
    check.true(`markerFailure ${item.name} does not decode`, decoded.ok === false);
    check.equal(`markerFailure ${item.name} reason`, decoded.reason, item.reason);
    check.equal(`markerFailure ${item.name} detail`, decoded.detail, item.detail);
  }

  for (const item of golden.nonMarkers) {
    check.true(`nonMarker ${item.name} is not a candidate`, decodeScriptPubKey(item.scriptHex) === null);
  }

  for (const item of golden.tierSamples) {
    const tier = tierFor(item.depth);
    const next = nextTier(item.depth);
    check.equal(`tier at depth ${item.depth}`, {
      depth: item.depth,
      tierIndex: tier.index,
      tierName: tier.name,
      nextTierIndex: next === null ? null : next.index,
      blocksToNextTier: blocksToNextTier(item.depth),
    }, item);
  }

  for (const scenario of golden.scenarios) {
    const deployment = deployments[scenario.deployment];
    check.true(`scenario ${scenario.name} names a known deployment`, deployment !== undefined);
    if (deployment === undefined) continue;
    const result = replay(scenario.blocks, deployment);
    check.equal(`scenario ${scenario.name} step count`, result.steps.length, scenario.steps.length);
    for (let i = 0; i < scenario.steps.length; i += 1) {
      const actual = result.steps[i];
      check.true(`scenario ${scenario.name} has step ${i}`, actual !== undefined);
      if (actual === undefined) continue;
      check.equal(`scenario ${scenario.name} step ${actual.height}`, stepView(actual), scenario.steps[i]);
    }
    const finalHeight = scenario.blocks[scenario.blocks.length - 1].height;
    check.equal(`scenario ${scenario.name} counters`, result.state.counters, scenario.finalCounters);
    check.equal(`scenario ${scenario.name} carriers`, carrierView(result.state), scenario.finalCarriers);
    check.equal(`scenario ${scenario.name} artifacts`, artifactView(result.state, finalHeight), scenario.finalArtifacts);
  }

  const reorg = golden.reorg;
  const deployment = deployments[reorg.deployment];
  const common = replay(reorg.commonBlocks, deployment);
  check.equal('reorg common steps', common.steps.map(stepView), reorg.commonSteps);
  check.equal('reorg fork state root', common.steps[common.steps.length - 1].stateRoot, reorg.forkStateRoot);
  check.equal(
    'reorg fork height',
    common.steps[common.steps.length - 1].height,
    reorg.forkHeight,
  );

  const runA = replay(reorg.branchA.blocks, deployment, common.state);
  const runB = replay(reorg.branchB.blocks, deployment, common.state);
  check.equal('reorg branch A steps', runA.steps.map(stepView), reorg.branchA.steps);
  check.equal('reorg branch B steps', runB.steps.map(stepView), reorg.branchB.steps);
  check.equal('reorg branch A counters', runA.state.counters, reorg.branchA.finalCounters);
  check.equal('reorg branch B counters', runB.state.counters, reorg.branchB.finalCounters);
  check.equal('reorg branch A artifacts', artifactView(runA.state, 3005), reorg.branchA.finalArtifacts);
  check.equal('reorg branch B artifacts', artifactView(runB.state, 3005), reorg.branchB.finalArtifacts);
  check.true(
    'reorg branches end at different state roots',
    runA.steps[runA.steps.length - 1].stateRoot !== runB.steps[runB.steps.length - 1].stateRoot,
  );
  check.true(
    'replaying branch A twice from the fork snapshot is stable',
    replay(reorg.branchA.blocks, deployment, common.state).steps.at(-1).stateRoot === runA.steps.at(-1).stateRoot,
  );

  for (const code of REASON_CODES) {
    check.true(`reason code ${code} appears in the fixture`, Array.isArray(golden.reasonCoverage[code]) && golden.reasonCoverage[code].length > 0);
  }

  return { passed: check.passed, failures: check.failures };
}
