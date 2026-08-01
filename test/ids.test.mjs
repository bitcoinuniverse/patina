import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  artifactId,
  attestationMessage,
  buildCommitLeafScript,
  commitCommitment,
  extractTapscript,
  isTaprootScriptPubKey,
  outpointKey,
  parseCommitLeafScript,
  parseOutpointKey,
  txidToWire,
  wireToTxid,
} from '../dist/index.js';

const TXID = '9d0ff1a0b4c2d3e4f50617283a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d';
const XONLY = '11'.repeat(32);
const SALT = '000102030405060708090a0b0c0d0e0f';

/** An independent reimplementation of the derivation, written from the spec. */
function specArtifactId(displayTxid, vout) {
  const wire = Buffer.from(displayTxid, 'hex').reverse();
  const voutLe = Buffer.alloc(4);
  voutLe.writeUInt32LE(vout, 0);
  return createHash('sha256').update(Buffer.from('PTNA/artifact', 'ascii')).update(wire).update(voutLe).digest('hex');
}

function specCommitCommitment(xonly, salt) {
  return createHash('sha256')
    .update(Buffer.from('PTNA/commit', 'ascii'))
    .update(Buffer.from(xonly, 'hex'))
    .update(Buffer.from(salt, 'hex'))
    .digest('hex');
}

test('txid byte order converts both ways', () => {
  const wire = txidToWire(TXID);
  assert.equal(wire.length, 32);
  assert.equal(wire.toString('hex'), Buffer.from(TXID, 'hex').reverse().toString('hex'));
  assert.equal(wireToTxid(wire), TXID);
  assert.notEqual(wire.toString('hex'), TXID);
});

test('wireToTxid rejects the wrong length', () => {
  assert.throws(() => wireToTxid(Buffer.alloc(31)), /32 bytes/);
});

test('artifact id matches an independent implementation of the spec', () => {
  for (const vout of [0, 1, 2, 255, 65535]) {
    assert.equal(artifactId(TXID, vout), specArtifactId(TXID, vout));
  }
});

test('artifact id depends on txid byte order', () => {
  const reversed = txidToWire(TXID).toString('hex');
  assert.notEqual(artifactId(TXID, 0), artifactId(reversed, 0));
});

test('artifact id depends on the carrier vout', () => {
  assert.notEqual(artifactId(TXID, 0), artifactId(TXID, 1));
});

test('artifact id rejects an out of range vout', () => {
  assert.throws(() => artifactId(TXID, -1), /out of range/);
  assert.throws(() => artifactId(TXID, 2 ** 32), /out of range/);
});

test('commit commitment matches an independent implementation of the spec', () => {
  assert.equal(commitCommitment(XONLY, SALT).toString('hex'), specCommitCommitment(XONLY, SALT));
  assert.equal(commitCommitment('00'.repeat(32), '00'.repeat(16)).toString('hex'), specCommitCommitment('00'.repeat(32), '00'.repeat(16)));
});

test('commit commitment binds the claimant key, not just the salt', () => {
  const a = commitCommitment(XONLY, SALT).toString('hex');
  const b = commitCommitment('22'.repeat(32), SALT).toString('hex');
  assert.notEqual(a, b);
});

test('commit commitment rejects wrong sized inputs', () => {
  assert.throws(() => commitCommitment('11'.repeat(31), SALT), /32 bytes/);
  assert.throws(() => commitCommitment(XONLY, '00'.repeat(15)), /16 bytes/);
});

test('the commit leaf script has the exact shape from the spec', () => {
  const commitment = commitCommitment(XONLY, SALT);
  const script = buildCommitLeafScript(XONLY, commitment);
  assert.equal(script.length, 70);
  assert.equal(script[0], 0x20);
  assert.equal(script.subarray(1, 33).toString('hex'), XONLY);
  assert.equal(script[33], 0xac);
  assert.equal(script[34], 0x00);
  assert.equal(script[35], 0x63);
  assert.equal(script[36], 0x20);
  assert.equal(script.subarray(37, 69).toString('hex'), commitment.toString('hex'));
  assert.equal(script[69], 0x68);
});

test('the commit leaf script round trips', () => {
  const commitment = commitCommitment(XONLY, SALT).toString('hex');
  const script = buildCommitLeafScript(XONLY, commitment);
  assert.deepEqual(parseCommitLeafScript(script), { claimantXOnly: XONLY, commitment });
  assert.deepEqual(parseCommitLeafScript(script.toString('hex')), { claimantXOnly: XONLY, commitment });
});

test('the commit leaf parser rejects near misses', () => {
  const good = buildCommitLeafScript(XONLY, '33'.repeat(32));
  assert.equal(parseCommitLeafScript(Buffer.concat([good, Buffer.from([0x51])])), null, 'trailing byte');
  assert.equal(parseCommitLeafScript(good.subarray(0, 69)), null, 'truncated');
  assert.equal(parseCommitLeafScript(Buffer.concat([Buffer.from([0x51]), good.subarray(1)])), null, 'wrong first push');

  for (const [offset, byte] of [[33, 0xad], [34, 0x51], [35, 0x64], [36, 0x21], [69, 0x69]]) {
    const bad = Buffer.from(good);
    bad[offset] = byte;
    assert.equal(parseCommitLeafScript(bad), null, `byte ${offset}`);
  }
});

test('taproot output detection is exact', () => {
  assert.equal(isTaprootScriptPubKey('5120' + '11'.repeat(32)), true);
  assert.equal(isTaprootScriptPubKey('5120' + '11'.repeat(31)), false);
  assert.equal(isTaprootScriptPubKey('5220' + '11'.repeat(32)), false);
  assert.equal(isTaprootScriptPubKey('0014' + '11'.repeat(20)), false);
});

test('tapscript extraction handles the annex, the key path and bad control blocks', () => {
  const script = buildCommitLeafScript(XONLY, '44'.repeat(32)).toString('hex');
  const control = 'c0' + '55'.repeat(32);

  const plain = extractTapscript(['00'.repeat(64), script, control]);
  assert.equal(plain.script, script);
  assert.equal(plain.controlBlock, control);
  assert.equal(plain.leafVersion, 0xc0);

  const withAnnex = extractTapscript(['00'.repeat(64), script, control, '50' + 'ab'.repeat(8)]);
  assert.deepEqual(withAnnex, plain);

  assert.equal(extractTapscript(['00'.repeat(64)]), null, 'key path spend');
  assert.equal(extractTapscript([]), null, 'empty witness');
  assert.equal(extractTapscript(undefined), null, 'missing witness');
  assert.equal(extractTapscript([script, 'aa']), null, 'control block too short');
  assert.equal(extractTapscript([script, 'c0' + '55'.repeat(33)]), null, 'control block length not 33 plus a multiple of 32');
  assert.equal(extractTapscript([script, 'zz'.repeat(33)]), null, 'control block is not hex');
});

test('a deep merkle path in the control block is still accepted', () => {
  const script = buildCommitLeafScript(XONLY, '44'.repeat(32)).toString('hex');
  const control = 'c0' + '55'.repeat(32) + '66'.repeat(32 * 3);
  assert.equal(extractTapscript([script, control]).controlBlock, control);
});

test('the attestation message is the tag then two lowercase hex strings', () => {
  const id = artifactId(TXID, 1);
  const blockHash = '77'.repeat(32);
  const message = attestationMessage(id, blockHash);
  assert.equal(message, `PTNA/attest${id}${blockHash}`);
  assert.equal(message.length, 139);
});

test('outpoint keys round trip', () => {
  assert.equal(outpointKey(TXID, 3), `${TXID}:3`);
  assert.deepEqual(parseOutpointKey(`${TXID}:3`), { txid: TXID, vout: 3 });
  assert.throws(() => parseOutpointKey('nope'), /outpoint key/);
  assert.throws(() => parseOutpointKey('abcd:1'), /outpoint key/);
});
