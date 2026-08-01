import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMMIT_MIN_AGE,
  deploymentFor,
  DeploymentError,
  GRACE_LENGTH,
  loadDeployment,
  loadDeploymentFile,
  loadShippedDeployment,
  MIN_CARRIER_FOUNDING,
  MIN_CARRIER_OPEN,
  toWireDeployment,
  windowStateAt,
  WINDOW_LENGTH,
} from '../dist/index.js';

const SPEC_HASH = 'a'.repeat(64);

const base = (overrides = {}) => ({
  network: 'signet',
  protocol_id: 'PTNA',
  spec_sha256: SPEC_HASH,
  h_open: 1000,
  h_close: 1000 + WINDOW_LENGTH,
  grace_end: 1000 + WINDOW_LENGTH + GRACE_LENGTH,
  min_carrier_founding: MIN_CARRIER_FOUNDING,
  min_carrier_open: MIN_CARRIER_OPEN,
  commit_min_age: COMMIT_MIN_AGE,
  ...overrides,
});

test('the shipped regtest and signet records load', () => {
  for (const network of ['regtest', 'signet']) {
    const record = loadShippedDeployment(network);
    assert.equal(record.network, network);
    assert.equal(record.protocolId, 'PTNA');
    assert.match(record.specSha256, /^[0-9a-f]{64}$/);
    assert.equal(record.hClose - record.hOpen, WINDOW_LENGTH);
    assert.equal(record.graceEnd - record.hClose, GRACE_LENGTH);
    assert.equal(record.minCarrierFounding, MIN_CARRIER_FOUNDING);
    assert.equal(record.minCarrierOpen, MIN_CARRIER_OPEN);
    assert.equal(record.commitMinAge, COMMIT_MIN_AGE);
  }
});

test('the shipped record is frozen against edits', () => {
  const record = loadShippedDeployment('regtest');
  assert.throws(() => {
    record.hOpen = 0;
  }, TypeError);
});

test('the shipped mainnet record is refused', () => {
  assert.throws(() => loadShippedDeployment('mainnet'), DeploymentError);
  assert.throws(() => loadShippedDeployment('mainnet'), /mainnet deployment refused/);
});

test('mainnet is refused without an explicit authorization', () => {
  const record = base({ network: 'mainnet', approvers: ['first approver', 'second approver'] });
  assert.throws(() => loadDeployment(record), /pass mainnetAuthorized true/);
});

test('mainnet is refused when the record names fewer than two approvers', () => {
  assert.throws(
    () => loadDeployment(base({ network: 'mainnet', approvers: ['only one'] }), { mainnetAuthorized: true }),
    /at least two approvers/,
  );
  assert.throws(
    () => loadDeployment(base({ network: 'mainnet' }), { mainnetAuthorized: true }),
    /at least two approvers/,
  );
});

test('mainnet is refused when the record has no activation heights', () => {
  assert.throws(
    () =>
      loadDeployment(base({ network: 'mainnet', h_open: null, h_close: null, grace_end: null, approvers: ['a', 'b'] }), {
        mainnetAuthorized: true,
      }),
    /no activation heights/,
  );
});

test('mainnet loads once it is authorized and fully named', () => {
  const record = loadDeployment(base({ network: 'mainnet', approvers: ['first approver', 'second approver'] }), {
    mainnetAuthorized: true,
  });
  assert.equal(record.network, 'mainnet');
  assert.deepEqual(record.approvers, ['first approver', 'second approver']);
});

test('deploymentFor refuses to build a mainnet deployment', () => {
  assert.throws(() => deploymentFor('mainnet', 1000, SPEC_HASH, ['a', 'b']), /mainnet deployment refused/);
  const signet = deploymentFor('signet', 5000, SPEC_HASH);
  assert.equal(signet.hClose, 5000 + WINDOW_LENGTH);
  assert.equal(signet.graceEnd, 5000 + WINDOW_LENGTH + GRACE_LENGTH);
});

test('a record with a bad shape is refused', () => {
  assert.throws(() => loadDeployment(null), /must be an object/);
  assert.throws(() => loadDeployment(base({ network: 'testnet' })), /network must be one of/);
  assert.throws(() => loadDeployment(base({ protocol_id: 'PATN' })), /protocol_id must be PTNA/);
  assert.throws(() => loadDeployment(base({ spec_sha256: 'nope' })), /64 lowercase hex/);
  assert.throws(() => loadDeployment(base({ spec_sha256: SPEC_HASH.toUpperCase() })), /64 lowercase hex/);
  assert.throws(() => loadDeployment(base({ approvers: [''] })), /non empty strings/);
});

test('frozen constants cannot be tuned through a deployment record', () => {
  assert.throws(() => loadDeployment(base({ min_carrier_founding: 50000 })), /frozen at 100000/);
  assert.throws(() => loadDeployment(base({ min_carrier_open: 1 })), /frozen at 10000/);
  assert.throws(() => loadDeployment(base({ commit_min_age: 6 })), /frozen at 144/);
});

test('window heights must be consistent or all absent', () => {
  assert.throws(() => loadDeployment(base({ h_close: 9999 })), /WINDOW_LENGTH/);
  assert.throws(() => loadDeployment(base({ grace_end: 9999 })), /GRACE_LENGTH/);
  assert.throws(() => loadDeployment(base({ h_open: null })), /all be set or all be null/);
  const unset = loadDeployment(base({ h_open: null, h_close: null, grace_end: null }));
  assert.equal(unset.hOpen, null);
});

test('the caller can pin the specification hash', () => {
  assert.throws(() => loadDeployment(base(), { expectSpecSha256: 'b'.repeat(64) }), /caller expected/);
  assert.equal(loadDeployment(base(), { expectSpecSha256: SPEC_HASH }).specSha256, SPEC_HASH);
});

test('a record loads from a file path', () => {
  const path = fileURLToPath(new URL('../deployments/signet.json', import.meta.url));
  const fromFile = loadDeploymentFile(path);
  const fromDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(fromFile.hOpen, fromDisk.h_open);
  assert.equal(fromFile.graceEnd, fromDisk.grace_end);
});

test('a record also loads from the camelCase form the library uses in memory', () => {
  const wire = base();
  const camel = {
    network: wire.network,
    protocolId: wire.protocol_id,
    specSha256: wire.spec_sha256,
    hOpen: wire.h_open,
    hClose: wire.h_close,
    graceEnd: wire.grace_end,
    minCarrierFounding: wire.min_carrier_founding,
    minCarrierOpen: wire.min_carrier_open,
    commitMinAge: wire.commit_min_age,
  };
  assert.deepEqual(loadDeployment(camel), loadDeployment(wire));
});

test('a deployment round trips through the wire form', () => {
  const record = loadShippedDeployment('regtest');
  const wire = toWireDeployment(record);
  assert.deepEqual(Object.keys(wire), [
    'network',
    'protocol_id',
    'spec_sha256',
    'h_open',
    'h_close',
    'grace_end',
    'min_carrier_founding',
    'min_carrier_open',
    'commit_min_age',
  ]);
  assert.deepEqual(loadDeployment(wire), record);
  assert.deepEqual(wire, JSON.parse(readFileSync(fileURLToPath(new URL('../deployments/regtest.json', import.meta.url)), 'utf8')));
});

test('the window state machine follows the tip', () => {
  const record = loadDeployment(base());
  const { hOpen, hClose, graceEnd } = record;
  assert.equal(windowStateAt(record, hOpen - 1), 'PENDING');
  assert.equal(windowStateAt(record, hOpen), 'OPEN');
  assert.equal(windowStateAt(record, hClose - 1), 'OPEN');
  assert.equal(windowStateAt(record, hClose), 'GRACE');
  assert.equal(windowStateAt(record, graceEnd), 'GRACE');
  assert.equal(windowStateAt(record, graceEnd + 1), 'CLOSED');

  const unset = loadDeployment(base({ h_open: null, h_close: null, grace_end: null }));
  assert.equal(windowStateAt(unset, 1_000_000), 'PENDING');
});
