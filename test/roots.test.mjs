import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  artifactLeaf,
  artifactsRoot,
  ARTIFACT_FACT_HEADER_BYTES,
  encodeArtifactFact,
  encodeEvent,
  encodeRing,
  encodeSnapshot,
  eventLeaf,
  eventRoot,
  EVENT_ENCODING_BYTES,
  merkleRoot,
  NO_VOUT,
  RING_ENCODING_BYTES,
  SNAPSHOT_ENCODING_BYTES,
  stateRoot,
  txidToWire,
} from '../dist/index.js';

const TXID = '9d0ff1a0b4c2d3e4f50617283a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d';
const ID_A = 'aa'.repeat(32);
const ID_B = 'bb'.repeat(32);

const created = {
  kind: 'CREATED',
  height: 1000,
  txIndex: 0,
  txid: TXID,
  artifactId: ID_A,
  vout: 1,
  value: 100000,
  ringIndex: 0,
  founding: true,
};

const ring = (index, relic = false) => ({
  index,
  startHeight: 1000 + index,
  endHeight: 1010 + index,
  depth: 10,
  carriedValue: 100000,
  successorTxid: relic ? null : TXID,
  successorVout: relic ? null : 2,
  relic,
});

const artifact = (id, overrides = {}) => ({
  artifactId: id,
  birthTxid: TXID,
  birthHeight: 1000,
  birthVout: 1,
  endowmentSats: 100000,
  founding: true,
  status: 'ALIVE',
  carrier: { txid: TXID, vout: 1, height: 1000, value: 100000 },
  rings: [],
  ...overrides,
});

const snapshot = (artifacts, height = 2000) => ({
  height,
  blockHash: '11'.repeat(32),
  artifacts: Object.fromEntries(artifacts.map((a) => [a.artifactId, a])),
  carriers: {},
  counters: {
    artifactsAlive: artifacts.filter((a) => a.status === 'ALIVE').length,
    artifactsRelic: artifacts.filter((a) => a.status === 'RELIC').length,
    foundingTotal: artifacts.filter((a) => a.founding).length,
    ringsTotal: artifacts.reduce((n, a) => n + a.rings.length, 0),
    deepestLiveDepth: 0,
    endowmentTotalSats: artifacts.reduce((n, a) => n + a.endowmentSats, 0),
  },
});

test('the event encoding is 86 bytes with the documented field offsets', () => {
  const bytes = encodeEvent(created);
  assert.equal(bytes.length, EVENT_ENCODING_BYTES);
  assert.equal(bytes[0], 0x01);
  assert.equal(bytes.readUInt32LE(1), 1000);
  assert.equal(bytes.subarray(5, 37).toString('hex'), txidToWire(TXID).toString('hex'));
  assert.equal(bytes.subarray(37, 69).toString('hex'), ID_A);
  assert.equal(bytes.readUInt32LE(69), 1);
  assert.equal(bytes.readBigUInt64LE(73), 100000n);
  assert.equal(bytes.readUInt32LE(81), 0);
  assert.equal(bytes[85], 0x01);
});

test('a relic event writes the absent vout sentinel and a zero value', () => {
  const bytes = encodeEvent({ ...created, kind: 'RELIC', vout: null, value: 0, ringIndex: 3, founding: false });
  assert.equal(bytes[0], 0x03);
  assert.equal(bytes.readUInt32LE(69), NO_VOUT);
  assert.equal(bytes.readBigUInt64LE(73), 0n);
  assert.equal(bytes.readUInt32LE(81), 3);
  assert.equal(bytes[85], 0x00);
});

test('a moved event uses kind 2', () => {
  assert.equal(encodeEvent({ ...created, kind: 'MOVED', founding: false })[0], 0x02);
});

test('an unknown event kind is refused', () => {
  assert.throws(() => encodeEvent({ ...created, kind: 'SOMETHING' }), /unknown event kind/);
});

test('the event leaf is the domain tagged hash of the encoding', () => {
  const expected = createHash('sha256')
    .update(Buffer.from('PTNA/event', 'ascii'))
    .update(encodeEvent(created))
    .digest('hex');
  assert.equal(eventLeaf(created).toString('hex'), expected);
});

test('the merkle rule matches the specification', () => {
  assert.equal(merkleRoot([]).toString('hex'), '00'.repeat(32));

  const a = Buffer.alloc(32, 1);
  const b = Buffer.alloc(32, 2);
  const c = Buffer.alloc(32, 3);
  assert.equal(merkleRoot([a]).toString('hex'), a.toString('hex'));

  const node = (l, r) => createHash('sha256').update(Buffer.from('PTNA/node', 'ascii')).update(l).update(r).digest();
  assert.equal(merkleRoot([a, b]).toString('hex'), node(a, b).toString('hex'));
  assert.equal(merkleRoot([a, b, c]).toString('hex'), node(node(a, b), c).toString('hex'));
  assert.equal(
    merkleRoot([a, b, c, a]).toString('hex'),
    node(node(a, b), node(c, a)).toString('hex'),
  );
});

test('an odd leaf is promoted, not paired with itself', () => {
  const a = Buffer.alloc(32, 7);
  const b = Buffer.alloc(32, 8);
  const three = merkleRoot([a, b, a]);
  const four = merkleRoot([a, b, a, a]);
  assert.notEqual(three.toString('hex'), four.toString('hex'));
});

test('the event root follows emission order', () => {
  const second = { ...created, kind: 'MOVED', artifactId: ID_B, founding: false };
  assert.notEqual(eventRoot([created, second]), eventRoot([second, created]));
  assert.equal(eventRoot([]), '00'.repeat(32));
});

test('the ring encoding is 61 bytes with the documented offsets', () => {
  const bytes = encodeRing(ring(2));
  assert.equal(bytes.length, RING_ENCODING_BYTES);
  assert.equal(bytes.readUInt32LE(0), 2);
  assert.equal(bytes.readUInt32LE(4), 1002);
  assert.equal(bytes.readUInt32LE(8), 1012);
  assert.equal(bytes.readUInt32LE(12), 10);
  assert.equal(bytes.readBigUInt64LE(16), 100000n);
  assert.equal(bytes.subarray(24, 56).toString('hex'), txidToWire(TXID).toString('hex'));
  assert.equal(bytes.readUInt32LE(56), 2);
  assert.equal(bytes[60], 0x00);
});

test('a terminal ring writes zeroed successor fields', () => {
  const bytes = encodeRing(ring(0, true));
  assert.equal(bytes.subarray(24, 56).toString('hex'), '00'.repeat(32));
  assert.equal(bytes.readUInt32LE(56), NO_VOUT);
  assert.equal(bytes[60], 0x01);
});

test('the artifact fact is 134 bytes plus 61 for every ring', () => {
  assert.equal(encodeArtifactFact(artifact(ID_A)).length, ARTIFACT_FACT_HEADER_BYTES);
  assert.equal(encodeArtifactFact(artifact(ID_A, { rings: [ring(0), ring(1)] })).length, ARTIFACT_FACT_HEADER_BYTES + 2 * RING_ENCODING_BYTES);
});

test('a relic artifact writes zeroed carrier fields', () => {
  const bytes = encodeArtifactFact(artifact(ID_A, { status: 'RELIC', carrier: null, rings: [ring(0, true)] }));
  assert.equal(bytes[32], 0x02);
  assert.equal(bytes.subarray(82, 114).toString('hex'), '00'.repeat(32));
  assert.equal(bytes.readUInt32LE(114), NO_VOUT);
  assert.equal(bytes.readUInt32LE(118), 0);
  assert.equal(bytes.readBigUInt64LE(122), 0n);
  assert.equal(bytes.readUInt32LE(130), 1);
});

test('the artifact leaf is the domain tagged hash of the fact', () => {
  const expected = createHash('sha256')
    .update(Buffer.from('PTNA/leaf', 'ascii'))
    .update(encodeArtifactFact(artifact(ID_A)))
    .digest('hex');
  assert.equal(artifactLeaf(artifact(ID_A)).toString('hex'), expected);
});

test('the artifacts root sorts by artifact id, not by insertion order', () => {
  const a = artifact(ID_A);
  const b = artifact(ID_B);
  const forward = snapshot([a, b]);
  const backward = { ...forward, artifacts: { [ID_B]: b, [ID_A]: a } };
  assert.deepEqual(Object.keys(forward.artifacts), [ID_A, ID_B]);
  assert.deepEqual(Object.keys(backward.artifacts), [ID_B, ID_A]);
  assert.equal(artifactsRoot(forward), artifactsRoot(backward));
  assert.equal(stateRoot(forward), stateRoot(backward));
});

test('the snapshot encoding is 88 bytes with the documented offsets', () => {
  const snap = snapshot([artifact(ID_A), artifact(ID_B)], 2500);
  const bytes = encodeSnapshot(snap);
  assert.equal(bytes.length, SNAPSHOT_ENCODING_BYTES);
  assert.equal(bytes.readUInt32LE(0), 2500);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.subarray(8, 40).toString('hex'), artifactsRoot(snap));
  assert.equal(bytes.readBigUInt64LE(40), 2n);
  assert.equal(bytes.readBigUInt64LE(48), 0n);
  assert.equal(bytes.readBigUInt64LE(56), 2n);
  assert.equal(bytes.readBigUInt64LE(64), 0n);
  assert.equal(bytes.readBigUInt64LE(72), 0n);
  assert.equal(bytes.readBigUInt64LE(80), 200000n);
});

test('the state root is the domain tagged hash of the snapshot encoding', () => {
  const snap = snapshot([artifact(ID_A)]);
  const expected = createHash('sha256')
    .update(Buffer.from('PTNA/state', 'ascii'))
    .update(encodeSnapshot(snap))
    .digest('hex');
  assert.equal(stateRoot(snap), expected);
});

test('the state root moves with the height even when nothing else changed', () => {
  const at2000 = snapshot([artifact(ID_A)], 2000);
  const at2001 = snapshot([artifact(ID_A)], 2001);
  assert.notEqual(stateRoot(at2000), stateRoot(at2001));
});

test('a snapshot at height -1 encodes its height as zero', () => {
  const empty = { ...snapshot([], -1) };
  assert.equal(encodeSnapshot(empty).readUInt32LE(0), 0);
  assert.equal(encodeSnapshot(empty).subarray(8, 40).toString('hex'), '00'.repeat(32));
});

test('the state root reacts to a counter that does not match the artifacts', () => {
  const honest = snapshot([artifact(ID_A)]);
  const lying = { ...honest, counters: { ...honest.counters, artifactsAlive: 99 } };
  assert.notEqual(stateRoot(honest), stateRoot(lying));
});
