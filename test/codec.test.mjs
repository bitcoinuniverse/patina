import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMarkerScript,
  buildScriptPubKey,
  decodeMarker,
  decodeScriptPubKey,
  encodeMarker,
  hasMagic,
  isOpReturnScript,
  MAX_KEEP_ENTRIES,
  MAX_MARKER_PAYLOAD_BYTES,
  scanScriptPubKey,
} from '../dist/index.js';

const SALT = '000102030405060708090a0b0c0d0e0f';
const seed = (carrierVout = 1, salt = SALT) => ({ op: 'SEED', salt, flags: 0, carrierVout });
const keep = (entries) => ({ op: 'KEEP', entries });
const payloadScript = (hex) => buildScriptPubKey(Buffer.from(hex, 'hex')).toString('hex');

test('SEED round trips through payload and script', () => {
  const payload = encodeMarker(seed(1));
  assert.equal(payload.length, 24);
  assert.equal(payload.subarray(0, 6).toString('hex'), '50544e410101');
  const script = buildScriptPubKey(payload);
  assert.equal(script.length, 26);
  assert.equal(script[0], 0x6a);
  assert.equal(script[1], 24);
  const decoded = decodeScriptPubKey(script);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.marker, { op: 'SEED', salt: SALT, flags: 0, carrierVout: 1 });
});

test('SEED carries carrier vout 0 through 255', () => {
  for (const vout of [0, 1, 127, 254, 255]) {
    const decoded = decodeScriptPubKey(buildMarkerScript(seed(vout)));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.marker.carrierVout, vout);
  }
});

test('KEEP round trips for every allowed entry count', () => {
  for (let count = 1; count <= MAX_KEEP_ENTRIES; count += 1) {
    const entries = Array.from({ length: count }, (_, i) => ({ inputIndex: i, vout: i + 10 }));
    const script = buildMarkerScript(keep(entries));
    assert.equal(script.length, 9 + 2 * count, `script length for count ${count}`);
    const decoded = decodeScriptPubKey(script);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.marker.entries, entries);
  }
});

test('KEEP entry order is preserved and is not required to be sorted', () => {
  const entries = [
    { inputIndex: 5, vout: 1 },
    { inputIndex: 0, vout: 9 },
    { inputIndex: 3, vout: 3 },
  ];
  const decoded = decodeScriptPubKey(buildMarkerScript(keep(entries)));
  assert.deepEqual(decoded.marker.entries, entries);
});

test('a non minimal push is a grammar failure but still a candidate', () => {
  const payload = encodeMarker(seed(1));
  const script = Buffer.concat([Buffer.from([0x6a, 0x4c, payload.length]), payload]);
  const scan = scanScriptPubKey(script);
  assert.equal(scan.marker, true);
  assert.equal(scan.ok, false);
  assert.equal(scan.reason, 'SEED_BAD_GRAMMAR');
  assert.match(scan.detail, /minimal/);
});

test('OP_PUSHDATA2 is never minimal at marker sizes', () => {
  const payload = encodeMarker(seed(1));
  const script = Buffer.concat([Buffer.from([0x6a, 0x4d, payload.length, 0x00]), payload]);
  const decoded = decodeScriptPubKey(script);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'SEED_BAD_GRAMMAR');
});

test('a byte after the marker push is a grammar failure', () => {
  const script = Buffer.concat([buildMarkerScript(seed(1)), Buffer.from([0x51])]);
  const decoded = decodeScriptPubKey(script);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'SEED_BAD_GRAMMAR');
  assert.match(decoded.detail, /after the marker push/);
});

test('a second push after the marker push is a grammar failure', () => {
  const script = Buffer.concat([buildMarkerScript(keep([{ inputIndex: 0, vout: 1 }])), Buffer.from([0x01, 0xff])]);
  const decoded = decodeScriptPubKey(script);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'KEEP_BAD_GRAMMAR');
});

test('a non zero SEED flags byte is rejected', () => {
  for (const flags of [0x01, 0x80, 0xff]) {
    const body = Buffer.concat([Buffer.from(SALT, 'hex'), Buffer.from([flags, 1])]);
    const payload = Buffer.concat([Buffer.from('50544e410101', 'hex'), body]);
    const decoded = decodeMarker(payload);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.reason, 'SEED_BAD_GRAMMAR');
  }
});

test('SEED payload lengths other than 18 are rejected', () => {
  for (const length of [0, 1, 17, 19, 32]) {
    const payload = Buffer.concat([Buffer.from('50544e410101', 'hex'), Buffer.alloc(length)]);
    const decoded = decodeMarker(payload);
    assert.equal(decoded.ok, false, `length ${length}`);
    assert.equal(decoded.reason, 'SEED_BAD_GRAMMAR');
  }
});

test('KEEP count outside 1 to 8 is rejected', () => {
  for (const count of [0, 9, 20, 36]) {
    const entries = Buffer.alloc(count * 2);
    const payload = Buffer.concat([Buffer.from('50544e410102', 'hex'), Buffer.from([count]), entries]);
    assert.ok(payload.length <= MAX_MARKER_PAYLOAD_BYTES, `count ${count} stays inside the payload ceiling`);
    const decoded = decodeMarker(payload);
    assert.equal(decoded.ok, false, `count ${count}`);
    assert.equal(decoded.reason, 'KEEP_BAD_GRAMMAR');
  }
});

test('the size check runs before the op grammar check', () => {
  const payload = Buffer.concat([Buffer.from('50544e410102', 'hex'), Buffer.from([255]), Buffer.alloc(510)]);
  assert.equal(decodeMarker(payload).reason, 'MARKER_TOO_LARGE');
});

test('a KEEP length that disagrees with its count is rejected', () => {
  const payload = Buffer.concat([Buffer.from('50544e410102', 'hex'), Buffer.from([3, 0, 1, 1, 2])]);
  const decoded = decodeMarker(payload);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'KEEP_BAD_GRAMMAR');
});

test('a KEEP naming the same input twice is rejected', () => {
  const payload = Buffer.concat([Buffer.from('50544e410102', 'hex'), Buffer.from([2, 4, 1, 4, 2])]);
  const decoded = decodeMarker(payload);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'KEEP_DUPLICATE_INPUT');
});

test('unknown version and unknown op are separated', () => {
  const wrongVersion = Buffer.concat([Buffer.from('50544e410201', 'hex'), Buffer.alloc(18)]);
  assert.equal(decodeMarker(wrongVersion).reason, 'MARKER_UNKNOWN_VERSION');

  const wrongOp = Buffer.concat([Buffer.from('50544e410105', 'hex'), Buffer.alloc(4)]);
  assert.equal(decodeMarker(wrongOp).reason, 'MARKER_UNKNOWN_OP');

  assert.equal(decodeMarker(Buffer.from('50544e41', 'hex')).reason, 'MARKER_UNKNOWN_VERSION');
  assert.equal(decodeMarker(Buffer.from('50544e4101', 'hex')).reason, 'MARKER_UNKNOWN_OP');
});

test('the version check runs before the op check', () => {
  const bothWrong = Buffer.concat([Buffer.from('50544e410909', 'hex'), Buffer.alloc(4)]);
  assert.equal(decodeMarker(bothWrong).reason, 'MARKER_UNKNOWN_VERSION');
});

test('an oversized marker script reports MARKER_TOO_LARGE', () => {
  const big = Buffer.concat([Buffer.from('50544e410101', 'hex'), Buffer.alloc(76, 0x11)]);
  const script = Buffer.concat([Buffer.from([0x6a, 0x4c, big.length]), big]);
  assert.equal(script.length, 85);
  const decoded = decodeScriptPubKey(script);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'MARKER_TOO_LARGE');
});

test('a payload above the payload ceiling reports MARKER_TOO_LARGE', () => {
  const payload = Buffer.concat([Buffer.from('50544e410101', 'hex'), Buffer.alloc(MAX_MARKER_PAYLOAD_BYTES)]);
  assert.equal(decodeMarker(payload).reason, 'MARKER_TOO_LARGE');
});

test('an 80 byte payload is inside the ceiling and fails on op grammar instead', () => {
  const payload = Buffer.concat([Buffer.from('50544e410101', 'hex'), Buffer.alloc(74)]);
  assert.equal(payload.length, MAX_MARKER_PAYLOAD_BYTES);
  assert.equal(decodeMarker(payload).reason, 'SEED_BAD_GRAMMAR');
});

test('scripts that are not markers return null', () => {
  const notMarkers = [
    '0014' + '11'.repeat(20),
    '5120' + '22'.repeat(32),
    '6a',
    '6a00',
    '6a0350544e',
    '6a0a6e6f746170617469',
    '',
  ];
  for (const hex of notMarkers) {
    assert.equal(decodeScriptPubKey(hex), null, hex);
    assert.equal(scanScriptPubKey(hex).marker, false, hex);
  }
});

test('helpers agree with the script shape rules', () => {
  assert.equal(isOpReturnScript(Buffer.from('6a01ff', 'hex')), true);
  assert.equal(isOpReturnScript(Buffer.from('0014' + '11'.repeat(20), 'hex')), false);
  assert.equal(hasMagic(Buffer.from('50544e4101', 'hex')), true);
  assert.equal(hasMagic(Buffer.from('50544e42', 'hex')), false);
  assert.equal(hasMagic(Buffer.from('50544e', 'hex')), false);
});

test('decodeMarker accepts hex strings as well as buffers', () => {
  const payload = encodeMarker(seed(2)).toString('hex');
  const fromHex = decodeMarker(payload);
  const fromBuffer = decodeMarker(Buffer.from(payload, 'hex'));
  assert.deepEqual(fromHex, fromBuffer);
});

test('encodeMarker rejects malformed input', () => {
  assert.throws(() => encodeMarker({ op: 'SEED', salt: 'aa', flags: 0, carrierVout: 0 }), /16 bytes/);
  assert.throws(() => encodeMarker({ op: 'SEED', salt: SALT, flags: 1, carrierVout: 0 }), /flags must be 0/);
  assert.throws(() => encodeMarker({ op: 'SEED', salt: SALT, flags: 0, carrierVout: 256 }), /carrierVout/);
  assert.throws(() => encodeMarker(keep([])), /1 to 8/);
  assert.throws(() => encodeMarker(keep(Array.from({ length: 9 }, (_, i) => ({ inputIndex: i, vout: 0 })))), /1 to 8/);
  assert.throws(() => encodeMarker(keep([{ inputIndex: 0, vout: 0 }, { inputIndex: 0, vout: 1 }])), /duplicate/);
  assert.throws(() => encodeMarker(keep([{ inputIndex: 0, vout: 256 }])), /vout out of range/);
  assert.throws(() => encodeMarker({ op: 'NOPE' }), /unknown marker op/);
});

test('buildScriptPubKey enforces the payload ceiling and picks a minimal push', () => {
  assert.equal(buildScriptPubKey(Buffer.alloc(75, 1))[1], 75);
  assert.equal(buildScriptPubKey(Buffer.alloc(76, 1))[1], 0x4c);
  assert.equal(buildScriptPubKey(Buffer.alloc(80, 1)).length, 83);
  assert.throws(() => buildScriptPubKey(Buffer.alloc(0)), /1 to 80/);
  assert.throws(() => buildScriptPubKey(Buffer.alloc(81, 1)), /1 to 80/);
});

test('payloadScript helper produces the same script as buildMarkerScript', () => {
  const payload = encodeMarker(seed(3)).toString('hex');
  assert.equal(payloadScript(payload), buildMarkerScript(seed(3)).toString('hex'));
});
