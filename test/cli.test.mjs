import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { artifactId, commitCommitment } from '../dist/index.js';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

function run(args, options = {}) {
  return execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', ...options });
}

function runExpectingFailure(args) {
  try {
    run(args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
  throw new Error(`expected ${args.join(' ')} to exit non zero`);
}

const SALT = '000102030405060708090a0b0c0d0e0f';
const XONLY = '11'.repeat(32);
const TXID = '9d0ff1a0b4c2d3e4f50617283a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d';

test('the bare command prints usage', () => {
  const out = run([]);
  assert.match(out, /Usage:/);
  assert.match(out, /patina marker encode/);
});

test('marker encode seed produces the documented script', () => {
  const out = JSON.parse(run(['marker', 'encode', '--op', 'seed', '--salt', SALT, '--carrier-vout', '1', '--json']));
  assert.equal(out.payloadHex, `50544e410101${SALT}0001`);
  assert.equal(out.scriptPubKeyHex, `6a18${out.payloadHex}`);
  assert.equal(out.scriptBytes, 26);
});

test('marker encode keep parses the entry list', () => {
  const out = JSON.parse(run(['marker', 'encode', '--op', 'keep', '--entries', '0:2,3:4', '--json']));
  assert.deepEqual(out.marker.entries, [
    { inputIndex: 0, vout: 2 },
    { inputIndex: 3, vout: 4 },
  ]);
  assert.equal(out.payloadHex, '50544e41010202000203 04'.replace(/\s/g, ''));
});

test('marker decode reads a script and a bare payload', () => {
  const fromScript = JSON.parse(run(['marker', 'decode', `6a1850544e410101${SALT}0001`, '--json']));
  assert.equal(fromScript.source, 'scriptPubKey');
  assert.deepEqual(fromScript.marker, { op: 'SEED', salt: SALT, flags: 0, carrierVout: 1 });

  const fromPayload = JSON.parse(run(['marker', 'decode', `50544e410101${SALT}0001`, '--json']));
  assert.equal(fromPayload.source, 'payload');
  assert.deepEqual(fromPayload.marker, fromScript.marker);
});

test('marker decode prints a human readable form by default', () => {
  const out = run(['marker', 'decode', '6a0b50544e4101020200010203']);
  assert.match(out, /op\s+KEEP/);
  assert.match(out, /input 0 -> vout 1/);
  assert.match(out, /input 2 -> vout 3/);
});

test('marker decode reports a reason code and exits non zero on a bad marker', () => {
  const result = runExpectingFailure(['marker', 'decode', '50544e410105' + '00'.repeat(4), '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'MARKER_UNKNOWN_OP');
});

test('artifact-id matches the library', () => {
  assert.equal(run(['artifact-id', '--txid', TXID, '--vout', '1']).trim(), artifactId(TXID, 1));
});

test('commit-commitment matches the library', () => {
  assert.equal(
    run(['commit-commitment', '--xonly', XONLY, '--salt', SALT]).trim(),
    commitCommitment(XONLY, SALT).toString('hex'),
  );
});

test('spec-hash prints a 64 character hash', () => {
  assert.match(run(['spec-hash']).trim(), /^[0-9a-f]{64}$/);
});

test('vectors verify passes with zero failures', () => {
  const out = run(['vectors', 'verify']);
  assert.match(out, /0 failed/);
  const json = JSON.parse(run(['vectors', 'verify', '--json']));
  assert.equal(json.failed, 0);
  assert.ok(json.passed > 300);
});

test('replay reports a state root at every height and the final counters', () => {
  const json = JSON.parse(run(['replay', 'examples/blocks.json', '--json']));
  assert.equal(json.network, 'regtest');
  assert.equal(json.blocks, json.perHeight.length);
  assert.equal(json.stateRoot, json.perHeight[json.perHeight.length - 1].stateRoot);
  for (const step of json.perHeight) assert.match(step.stateRoot, /^[0-9a-f]{64}$/);
  assert.equal(json.counters.artifactsAlive + json.counters.artifactsRelic, json.artifacts.length);

  const human = run(['replay', 'examples/blocks.json']);
  assert.match(human, /network\s+regtest/);
  assert.match(human, /state root\s+[0-9a-f]{64}/);
  assert.match(human, /endowment total sats/);
});

test('replay refuses a mainnet deployment', () => {
  const result = runExpectingFailure(['replay', 'examples/blocks.json', '--deployment', 'mainnet']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mainnet deployment refused/);
});

test('unknown commands and missing flags fail loudly', () => {
  assert.match(runExpectingFailure(['nope']).stderr, /unknown command/);
  assert.match(runExpectingFailure(['marker', 'nope']).stderr, /encode or decode/);
  assert.match(runExpectingFailure(['marker', 'encode', '--op', 'seed']).stderr, /missing --salt/);
  assert.match(runExpectingFailure(['artifact-id', '--txid', TXID]).stderr, /missing --vout/);
  assert.match(runExpectingFailure(['replay']).stderr, /path to a blocks JSON file/);
});
