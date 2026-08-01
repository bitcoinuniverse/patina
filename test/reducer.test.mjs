import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyBlock,
  artifactId,
  initialState,
  loadShippedDeployment,
  MIN_CARRIER_FOUNDING,
  MIN_SUCCESSOR,
  outpointKey,
  replay,
  snapshotAtHeight,
  stateRoot,
} from '../dist/index.js';

import {
  block,
  commitInput,
  markerOut,
  opReturnOut,
  out,
  p2wpkhFor,
  plainInput,
  saltFor,
  spendInput,
  tx,
  txidFor,
} from '../scripts/lib/fixtures.mjs';

const deployment = loadShippedDeployment('regtest');
const seedMarker = (label, carrierVout = 1) => ({ op: 'SEED', salt: saltFor(label), flags: 0, carrierVout });
const keepMarker = (entries) => ({ op: 'KEEP', entries });

function seedTx(label, commitHeight, carrierValue = MIN_CARRIER_FOUNDING, extra = []) {
  return tx({
    label,
    inputs: [commitInput({ label, height: commitHeight, salt: saltFor(label) })],
    outputs: [markerOut(seedMarker(label, 1)), out(carrierValue, `${label}/carrier`), ...extra],
  });
}

function spendCarrier(label, value, height, vout = 1) {
  return spendInput({ txid: txidFor(label), vout, value, scriptPubKey: p2wpkhFor(`${label}/carrier`), height });
}

function spendPoint(label, vout, value, scriptLabel, height) {
  return spendInput({ txid: txidFor(label), vout, value, scriptPubKey: p2wpkhFor(scriptLabel), height });
}

function onlyArtifact(state) {
  const ids = Object.keys(state.artifacts);
  assert.equal(ids.length, 1, 'expected exactly one artifact');
  return state.artifacts[ids[0]];
}

test('the initial state is empty and sits at height -1', () => {
  const state = initialState();
  assert.equal(state.height, -1);
  assert.equal(state.blockHash, null);
  assert.deepEqual(state.artifacts, {});
  assert.deepEqual(state.carriers, {});
  assert.deepEqual(state.counters, {
    artifactsAlive: 0,
    artifactsRelic: 0,
    foundingTotal: 0,
    ringsTotal: 0,
    deepestLiveDepth: 0,
    endowmentTotalSats: 0,
  });
});

test('applyBlock never mutates the snapshot it is given', () => {
  const first = applyBlock(initialState(), block({ height: 400, label: 'p0', txs: [seedTx('p-seed', 200)] }), deployment);
  const before = JSON.stringify(first.state);
  applyBlock(
    first.state,
    block({
      height: 401,
      label: 'p1',
      txs: [tx({ label: 'p-move', inputs: [spendCarrier('p-seed', MIN_CARRIER_FOUNDING, 400)], outputs: [out(90000, 'p/next')] })],
    }),
    deployment,
  );
  assert.equal(JSON.stringify(first.state), before);
});

test('blocks must arrive in order', () => {
  const first = applyBlock(initialState(), block({ height: 400, label: 'g0', txs: [] }), deployment);
  assert.throws(() => applyBlock(first.state, block({ height: 402, label: 'g2', txs: [] }), deployment), /does not follow/);
  assert.throws(() => applyBlock(first.state, block({ height: 400, label: 'g0b', txs: [] }), deployment), /does not follow/);
  assert.throws(() => applyBlock(initialState(), block({ height: -1, label: 'gneg', txs: [] }), deployment), /non negative/);
});

test('a deployment with no heights cannot be replayed', () => {
  const unset = { ...deployment, hOpen: null, hClose: null, graceEnd: null };
  assert.throws(() => applyBlock(initialState(), block({ height: 400, label: 'u0', txs: [] }), unset), /activation heights/);
});

test('the coinbase transaction is skipped entirely', () => {
  const coinbase = { ...seedTx('cb-seed', 200), coinbase: true };
  const applied = applyBlock(initialState(), block({ height: 400, label: 'cb', txs: [coinbase] }), deployment);
  assert.equal(applied.events.length, 0);
  assert.equal(applied.invalidEvents.length, 0);
  assert.deepEqual(applied.state.artifacts, {});
});

test('a SEED creates one artifact resting on its carrier', () => {
  const applied = applyBlock(initialState(), block({ height: 400, label: 'c0', txs: [seedTx('c-seed', 200)] }), deployment);
  const artifact = onlyArtifact(applied.state);
  const expectedId = artifactId(txidFor('c-seed'), 1);
  assert.equal(artifact.artifactId, expectedId);
  assert.equal(artifact.status, 'ALIVE');
  assert.equal(artifact.founding, true);
  assert.equal(artifact.endowmentSats, MIN_CARRIER_FOUNDING);
  assert.deepEqual(artifact.carrier, { txid: txidFor('c-seed'), vout: 1, height: 400, value: MIN_CARRIER_FOUNDING });
  assert.deepEqual(artifact.rings, []);
  assert.deepEqual(applied.state.carriers[outpointKey(txidFor('c-seed'), 1)], [expectedId]);
  assert.deepEqual(applied.events.map((e) => e.kind), ['CREATED']);
  assert.equal(applied.events[0].founding, true);
});

test('a carrier created and spent inside one block is handled', () => {
  const move = tx({
    label: 'same-block-move',
    inputs: [spendCarrier('same-block-seed', MIN_CARRIER_FOUNDING, 400)],
    outputs: [out(90000, 'same-block/next')],
  });
  const applied = applyBlock(
    initialState(),
    block({ height: 400, label: 'sb', txs: [seedTx('same-block-seed', 200), move] }),
    deployment,
  );
  const artifact = onlyArtifact(applied.state);
  assert.equal(artifact.rings.length, 1);
  assert.deepEqual(artifact.rings[0], {
    index: 0,
    startHeight: 400,
    endHeight: 400,
    depth: 0,
    carriedValue: MIN_CARRIER_FOUNDING,
    successorTxid: txidFor('same-block-move'),
    successorVout: 0,
    relic: false,
  });
  assert.deepEqual(applied.events.map((e) => e.kind), ['CREATED', 'MOVED']);
});

test('spending an output that holds nothing produces no events', () => {
  const applied = applyBlock(
    initialState(),
    block({
      height: 400,
      label: 'nc',
      txs: [tx({ label: 'nc-move', inputs: [plainInput({ label: 'nc', height: 399 })], outputs: [out(50000, 'nc/out')] })],
    }),
    deployment,
  );
  assert.equal(applied.events.length, 0);
  assert.equal(applied.invalidEvents.length, 0);
});

test('a relic is terminal and its old carrier is gone from the index', () => {
  const result = replay(
    [
      block({ height: 500, label: 'r0', txs: [seedTx('r-seed', 300)] }),
      block({
        height: 501,
        label: 'r1',
        txs: [
          tx({
            label: 'r-burn',
            inputs: [spendCarrier('r-seed', MIN_CARRIER_FOUNDING, 500)],
            outputs: [opReturnOut(), out(MIN_SUCCESSOR - 1, 'r/thin')],
          }),
        ],
      }),
    ],
    deployment,
  );
  const artifact = onlyArtifact(result.state);
  assert.equal(artifact.status, 'RELIC');
  assert.equal(artifact.carrier, null);
  assert.equal(artifact.rings.length, 1);
  assert.equal(artifact.rings[0].relic, true);
  assert.equal(artifact.rings[0].successorTxid, null);
  assert.equal(artifact.rings[0].successorVout, null);
  assert.deepEqual(result.state.carriers, {});
  assert.equal(result.state.counters.artifactsAlive, 0);
  assert.equal(result.state.counters.artifactsRelic, 1);
});

test('a SEED transaction that also spends a carrier moves it by the default rule', () => {
  const combined = tx({
    label: 'combined',
    inputs: [
      spendCarrier('combined-old', MIN_CARRIER_FOUNDING, 600),
      commitInput({ label: 'combined-new', height: 400, salt: saltFor('combined-new') }),
    ],
    outputs: [markerOut(seedMarker('combined-new', 1)), out(150000, 'combined/shared')],
  });
  const result = replay(
    [
      block({ height: 600, label: 'k0', txs: [seedTx('combined-old', 400)] }),
      block({ height: 601, label: 'k1', txs: [combined] }),
    ],
    deployment,
  );
  const key = outpointKey(txidFor('combined'), 1);
  assert.equal(result.state.carriers[key].length, 2, 'the moved artifact and the new one share one carrier');
  assert.equal(Object.keys(result.state.artifacts).length, 2);
  assert.deepEqual(
    result.steps[1].events.map((e) => e.kind),
    ['MOVED', 'CREATED'],
    'spends are processed before creation',
  );
});

test('a bundle moves together and each member appends its own ring', () => {
  const labels = ['b0', 'b1', 'b2'];
  const gather = tx({
    label: 'b-gather',
    inputs: labels.map((label) => spendCarrier(label, MIN_CARRIER_FOUNDING, 700)),
    outputs: [out(280000, 'b/bundle')],
  });
  const move = tx({
    label: 'b-move',
    inputs: [spendPoint('b-gather', 0, 280000, 'b/bundle', 701)],
    outputs: [out(270000, 'b/bundle-next')],
  });
  const result = replay(
    [
      block({ height: 700, label: 'b-a', txs: labels.map((label) => seedTx(label, 500)) }),
      block({ height: 701, label: 'b-b', txs: [gather] }),
      block({ height: 702, label: 'b-c', txs: [move] }),
    ],
    deployment,
  );
  const ids = Object.keys(result.state.artifacts).sort();
  assert.equal(ids.length, 3);
  assert.deepEqual(result.state.carriers[outpointKey(txidFor('b-move'), 0)], ids);
  for (const id of ids) {
    const artifact = result.state.artifacts[id];
    assert.equal(artifact.rings.length, 2);
    assert.deepEqual(artifact.rings.map((r) => r.index), [0, 1]);
    assert.equal(artifact.rings[0].endHeight, artifact.rings[1].startHeight);
    assert.equal(artifact.carrier.txid, txidFor('b-move'));
  }
  assert.equal(result.state.counters.ringsTotal, 6);
});

test('a KEEP entry beats the default rule and a void entry falls back to it', () => {
  const move = tx({
    label: 'kv-move',
    inputs: [spendCarrier('kv-a', MIN_CARRIER_FOUNDING, 800), spendCarrier('kv-b', MIN_CARRIER_FOUNDING, 800)],
    outputs: [
      out(20000, 'kv/0'),
      out(30000, 'kv/1'),
      out(40000, 'kv/2'),
      markerOut(keepMarker([{ inputIndex: 0, vout: 2 }, { inputIndex: 1, vout: 9 }])),
    ],
  });
  const result = replay(
    [
      block({ height: 800, label: 'kv-a', txs: [seedTx('kv-a', 600), seedTx('kv-b', 600)] }),
      block({ height: 801, label: 'kv-b', txs: [move] }),
    ],
    deployment,
  );
  const idA = artifactId(txidFor('kv-a'), 1);
  const idB = artifactId(txidFor('kv-b'), 1);
  assert.equal(result.state.artifacts[idA].carrier.vout, 2, 'the KEEP entry routed input 0');
  assert.equal(result.state.artifacts[idB].carrier.vout, 0, 'the void entry fell through to the default rule');
  assert.deepEqual(result.steps[1].invalidEvents.map((e) => e.reason), ['KEEP_ENTRY_OUT_OF_RANGE']);
});

test('a duplicate marker voids the KEEP and the default rule applies', () => {
  const move = tx({
    label: 'dm-move',
    inputs: [spendCarrier('dm-seed', MIN_CARRIER_FOUNDING, 900)],
    outputs: [
      markerOut(keepMarker([{ inputIndex: 0, vout: 2 }])),
      out(25000, 'dm/1'),
      out(35000, 'dm/2'),
      markerOut(keepMarker([{ inputIndex: 0, vout: 1 }])),
    ],
  });
  const result = replay(
    [block({ height: 900, label: 'dm-a', txs: [seedTx('dm-seed', 700)] }), block({ height: 901, label: 'dm-b', txs: [move] })],
    deployment,
  );
  assert.deepEqual(result.steps[1].invalidEvents.map((e) => e.reason), ['VOID_DUPLICATE_MARKER']);
  assert.equal(onlyArtifact(result.state).carrier.vout, 1);
});

test('an unknown marker version is inert and leaves routing to the default rule', () => {
  const payload = Buffer.concat([Buffer.from('50544e410201', 'hex'), Buffer.alloc(18)]);
  const script = Buffer.concat([Buffer.from([0x6a, payload.length]), payload]).toString('hex');
  const move = tx({
    label: 'uv-move',
    inputs: [spendCarrier('uv-seed', MIN_CARRIER_FOUNDING, 1000)],
    outputs: [{ value: 0, scriptPubKey: script }, out(45000, 'uv/1')],
  });
  const result = replay(
    [block({ height: 1000, label: 'uv-a', txs: [seedTx('uv-seed', 800)] }), block({ height: 1001, label: 'uv-b', txs: [move] })],
    deployment,
  );
  assert.deepEqual(result.steps[1].invalidEvents.map((e) => e.reason), ['MARKER_UNKNOWN_VERSION']);
  assert.equal(onlyArtifact(result.state).carrier.vout, 1);
});

test('a KEEP with no carrier input records one invalid event and nothing else', () => {
  const applied = applyBlock(
    initialState(),
    block({
      height: 1100,
      label: 'nk',
      txs: [
        tx({
          label: 'nk-tx',
          inputs: [plainInput({ label: 'nk', height: 1099 })],
          outputs: [out(40000, 'nk/0'), markerOut(keepMarker([{ inputIndex: 0, vout: 0 }]))],
        }),
      ],
    }),
    deployment,
  );
  assert.deepEqual(applied.invalidEvents.map((e) => e.reason), ['KEEP_NO_CARRIER_INPUT']);
  assert.equal(applied.events.length, 0);
});

test('replay is deterministic and its state root does not depend on the starting point', () => {
  const blocks = [
    block({ height: 1200, label: 'd0', txs: [seedTx('d-a', 1000)] }),
    block({
      height: 1201,
      label: 'd1',
      txs: [tx({ label: 'd-move', inputs: [spendCarrier('d-a', MIN_CARRIER_FOUNDING, 1200)], outputs: [out(80000, 'd/1')] })],
    }),
    block({ height: 1202, label: 'd2', txs: [seedTx('d-b', 1000)] }),
    block({
      height: 1203,
      label: 'd3',
      txs: [tx({ label: 'd-burn', inputs: [spendPoint('d-move', 0, 80000, 'd/1', 1201)], outputs: [opReturnOut()] })],
    }),
  ];
  const full = replay(blocks, deployment);
  const again = replay(blocks, deployment);
  assert.deepEqual(full.steps.map((s) => s.stateRoot), again.steps.map((s) => s.stateRoot));

  const partial = replay(blocks.slice(0, 2), deployment);
  const rest = replay(blocks.slice(2), deployment, partial.state);
  assert.equal(rest.steps[rest.steps.length - 1].stateRoot, full.steps[full.steps.length - 1].stateRoot);
  assert.equal(stateRoot(rest.state), stateRoot(full.state));
});

test('a reorg is a replay from the fork snapshot and the branches differ', () => {
  const common = [
    block({ height: 1300, label: 'x0', txs: [seedTx('x-seed', 1100)] }),
    block({ height: 1301, label: 'x1', txs: [] }),
  ];
  const branchA = [
    block({
      height: 1302,
      label: 'xa',
      txs: [tx({ label: 'xa-move', inputs: [spendCarrier('x-seed', MIN_CARRIER_FOUNDING, 1300)], outputs: [out(90000, 'x/a')] })],
    }),
  ];
  const branchB = [
    block({
      height: 1302,
      label: 'xb',
      txs: [tx({ label: 'xb-burn', inputs: [spendCarrier('x-seed', MIN_CARRIER_FOUNDING, 1300)], outputs: [opReturnOut()] })],
    }),
  ];
  const base = replay(common, deployment);
  const fork = snapshotAtHeight(base, 1301);
  assert.notEqual(fork, null);
  assert.equal(snapshotAtHeight(base, 1999), null);

  const a = replay(branchA, deployment, fork);
  const b = replay(branchB, deployment, fork);
  assert.notEqual(a.steps[0].stateRoot, b.steps[0].stateRoot);
  assert.equal(onlyArtifact(a.state).status, 'ALIVE');
  assert.equal(onlyArtifact(b.state).status, 'RELIC');

  const replayedA = replay(branchA, deployment, fork);
  assert.equal(replayedA.steps[0].stateRoot, a.steps[0].stateRoot, 'the fork snapshot was not consumed');
});

test('counters follow the state', () => {
  const result = replay(
    [
      block({ height: 1400, label: 'ct0', txs: [seedTx('ct-a', 1200), seedTx('ct-b', 100, 20000)] }),
      block({
        height: 1401,
        label: 'ct1',
        txs: [tx({ label: 'ct-burn', inputs: [spendCarrier('ct-a', MIN_CARRIER_FOUNDING, 1400)], outputs: [opReturnOut()] })],
      }),
    ],
    deployment,
  );
  assert.deepEqual(result.state.counters, {
    artifactsAlive: 1,
    artifactsRelic: 1,
    foundingTotal: 1,
    ringsTotal: 1,
    deepestLiveDepth: 1,
    endowmentTotalSats: MIN_CARRIER_FOUNDING + 20000,
  });
});

test('the invalid event record carries the block position of the attempt', () => {
  const applied = applyBlock(
    initialState(),
    block({
      height: 1500,
      label: 'ie',
      txs: [seedTx('ie-ok', 1300), seedTx('ie-bad', 1300, MIN_CARRIER_FOUNDING - 1)],
    }),
    deployment,
  );
  assert.equal(applied.invalidEvents.length, 1);
  assert.deepEqual(
    { ...applied.invalidEvents[0], detail: undefined },
    { height: 1500, txIndex: 1, txid: txidFor('ie-bad'), vout: 1, reason: 'SEED_CARRIER_BELOW_MIN', detail: undefined },
  );
});
