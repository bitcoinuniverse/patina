import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCommitLeafScript,
  commitCommitment,
  defaultSuccessorVout,
  findCommitInputs,
  isFounding,
  isOpReturnOutput,
  loadShippedDeployment,
  MIN_CARRIER_FOUNDING,
  MIN_CARRIER_OPEN,
  MIN_SUCCESSOR,
  validateKeepEntry,
  validateSeed,
} from '../dist/index.js';

import { commitInput, markerOut, opReturnOut, out, plainInput, saltFor, tx, xonlyFor } from '../scripts/lib/fixtures.mjs';

const deployment = loadShippedDeployment('regtest');
const seedMarker = (label, carrierVout = 1) => ({ op: 'SEED', salt: saltFor(label), flags: 0, carrierVout });

function seedTx(label, { commitHeight, carrierValue, carrierVout = 1, inputs, outputs }) {
  return tx({
    label,
    inputs: inputs ?? [commitInput({ label, height: commitHeight, salt: saltFor(label) })],
    outputs: outputs ?? [markerOut(seedMarker(label, carrierVout)), out(carrierValue, `${label}/carrier`)],
  });
}

test('OP_RETURN outputs are recognised whatever they carry', () => {
  assert.equal(isOpReturnOutput(opReturnOut()), true);
  assert.equal(isOpReturnOutput(markerOut(seedMarker('x'))), true);
  assert.equal(isOpReturnOutput(out(1000, 'y')), false);
});

test('the default rule skips OP_RETURN outputs and thin outputs', () => {
  const transaction = tx({
    label: 'default-rule',
    inputs: [],
    outputs: [opReturnOut(), out(MIN_SUCCESSOR - 1, 'a'), out(MIN_SUCCESSOR, 'b'), out(999999, 'c')],
  });
  assert.equal(defaultSuccessorVout(transaction), 2);
});

test('the default rule returns null when nothing qualifies', () => {
  const transaction = tx({
    label: 'default-rule-none',
    inputs: [],
    outputs: [opReturnOut(), out(MIN_SUCCESSOR - 1, 'a')],
  });
  assert.equal(defaultSuccessorVout(transaction), null);
});

test('the default rule accepts an output exactly at the minimum', () => {
  const transaction = tx({ label: 'default-rule-exact', inputs: [], outputs: [out(MIN_SUCCESSOR, 'a')] });
  assert.equal(defaultSuccessorVout(transaction), 0);
});

test('a valid founding SEED passes every check', () => {
  const transaction = seedTx('good', { commitHeight: 300, carrierValue: MIN_CARRIER_FOUNDING });
  const result = validateSeed(transaction, seedMarker('good'), 300 + deployment.commitMinAge, deployment);
  assert.equal(result.ok, true);
  assert.equal(result.founding, true);
  assert.equal(result.carrierVout, 1);
  assert.equal(result.carrierValue, MIN_CARRIER_FOUNDING);
  assert.equal(result.commitHeight, 300);
  assert.equal(result.commitInputIndex, 0);
  assert.equal(result.minCarrier, MIN_CARRIER_FOUNDING);
  assert.equal(result.claimantXOnly, xonlyFor('good'));
});

test('SEED rejects a carrier vout beyond the outputs', () => {
  const transaction = seedTx('oor', { commitHeight: 300, carrierValue: MIN_CARRIER_FOUNDING, carrierVout: 7 });
  const result = validateSeed(transaction, seedMarker('oor', 7), 500, deployment);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEED_CARRIER_OUT_OF_RANGE');
  assert.equal(result.vout, 7);
});

test('SEED rejects a carrier that is the marker output', () => {
  const transaction = seedTx('opret', { commitHeight: 300, carrierValue: MIN_CARRIER_FOUNDING, carrierVout: 0 });
  const result = validateSeed(transaction, seedMarker('opret', 0), 500, deployment);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEED_CARRIER_IS_OPRETURN');
});

test('SEED rejects a transaction with no commit input', () => {
  const transaction = seedTx('nocommit', {
    carrierValue: MIN_CARRIER_FOUNDING,
    inputs: [plainInput({ label: 'nocommit', height: 300 })],
  });
  const result = validateSeed(transaction, seedMarker('nocommit'), 500, deployment);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEED_NO_COMMIT_INPUT');
});

test('a commit leaf revealed from a non taproot prevout does not count', () => {
  const good = commitInput({ label: 'wrongtype', height: 300, salt: saltFor('wrongtype') });
  const wrongType = { ...good, prevout: { ...good.prevout, scriptPubKey: '0014' + '11'.repeat(20) } };
  const transaction = seedTx('wrongtype', { carrierValue: MIN_CARRIER_FOUNDING, inputs: [wrongType] });
  assert.deepEqual(findCommitInputs(transaction), []);
  const result = validateSeed(transaction, seedMarker('wrongtype'), 500, deployment);
  assert.equal(result.reason, 'SEED_NO_COMMIT_INPUT');
});

test('a key path spend of a taproot commit output reveals nothing', () => {
  const good = commitInput({ label: 'keypath', height: 300, salt: saltFor('keypath') });
  const keyPath = { ...good, witness: ['00'.repeat(64)] };
  const transaction = seedTx('keypath', { carrierValue: MIN_CARRIER_FOUNDING, inputs: [keyPath] });
  const result = validateSeed(transaction, seedMarker('keypath'), 500, deployment);
  assert.equal(result.reason, 'SEED_NO_COMMIT_INPUT');
});

test('SEED rejects a commit leaf that does not bind this salt', () => {
  const wrong = commitInput({
    label: 'mismatch',
    height: 300,
    salt: saltFor('mismatch'),
    commitment: commitCommitment(xonlyFor('mismatch'), saltFor('other')).toString('hex'),
  });
  const transaction = seedTx('mismatch', { carrierValue: MIN_CARRIER_FOUNDING, inputs: [wrong] });
  const result = validateSeed(transaction, seedMarker('mismatch'), 500, deployment);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEED_COMMITMENT_MISMATCH');
});

test('SEED rejects a commit leaf that binds the salt to a different key', () => {
  const salt = saltFor('otherkey');
  const wrong = commitInput({
    label: 'otherkey',
    height: 300,
    salt,
    key: xonlyFor('otherkey-a'),
    commitment: commitCommitment(xonlyFor('otherkey-b'), salt).toString('hex'),
  });
  const transaction = seedTx('otherkey', { carrierValue: MIN_CARRIER_FOUNDING, inputs: [wrong] });
  const result = validateSeed(transaction, { op: 'SEED', salt, flags: 0, carrierVout: 1 }, 500, deployment);
  assert.equal(result.reason, 'SEED_COMMITMENT_MISMATCH');
});

test('SEED rejects two qualifying commit inputs', () => {
  const salt = saltFor('two');
  const key = xonlyFor('two');
  const transaction = seedTx('two', {
    carrierValue: MIN_CARRIER_FOUNDING,
    inputs: [
      commitInput({ label: 'two-a', height: 300, salt, key }),
      commitInput({ label: 'two-b', height: 300, salt, key }),
    ],
  });
  const result = validateSeed(transaction, { op: 'SEED', salt, flags: 0, carrierVout: 1 }, 500, deployment);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEED_NO_COMMIT_INPUT');
  assert.match(result.detail, /exactly one/);
});

test('one qualifying commit input beside one that does not qualify is accepted', () => {
  const salt = saltFor('mixed');
  const key = xonlyFor('mixed');
  const transaction = seedTx('mixed', {
    carrierValue: MIN_CARRIER_FOUNDING,
    inputs: [
      commitInput({ label: 'mixed-noise', height: 300, salt, key, commitment: '99'.repeat(32) }),
      commitInput({ label: 'mixed-real', height: 300, salt, key }),
    ],
  });
  const result = validateSeed(transaction, { op: 'SEED', salt, flags: 0, carrierVout: 1 }, 500, deployment);
  assert.equal(result.ok, true);
  assert.equal(result.commitInputIndex, 1);
});

test('the commit age boundary is exact at 143 and 144', () => {
  const transaction = seedTx('age', { commitHeight: 1000, carrierValue: MIN_CARRIER_FOUNDING });
  const tooYoung = validateSeed(transaction, seedMarker('age'), 1143, deployment);
  assert.equal(tooYoung.ok, false);
  assert.equal(tooYoung.reason, 'SEED_COMMIT_TOO_YOUNG');
  assert.match(tooYoung.detail, /143 blocks/);

  const oldEnough = validateSeed(transaction, seedMarker('age'), 1144, deployment);
  assert.equal(oldEnough.ok, true);
});

test('the carrier minimum follows the founding flag', () => {
  const founding = seedTx('min-f', { commitHeight: 300, carrierValue: MIN_CARRIER_FOUNDING - 1 });
  const foundingResult = validateSeed(founding, seedMarker('min-f'), 500, deployment);
  assert.equal(foundingResult.ok, false);
  assert.equal(foundingResult.reason, 'SEED_CARRIER_BELOW_MIN');
  assert.match(foundingResult.detail, /founding minimum is 100000/);

  const open = seedTx('min-o', { commitHeight: 100, carrierValue: MIN_CARRIER_OPEN - 1 });
  const openResult = validateSeed(open, seedMarker('min-o'), 500, deployment);
  assert.equal(openResult.ok, false);
  assert.equal(openResult.reason, 'SEED_CARRIER_BELOW_MIN');
  assert.match(openResult.detail, /open era minimum is 10000/);

  const openOk = seedTx('min-ok', { commitHeight: 100, carrierValue: MIN_CARRIER_OPEN });
  const openOkResult = validateSeed(openOk, seedMarker('min-ok'), 500, deployment);
  assert.equal(openOkResult.ok, true);
  assert.equal(openOkResult.founding, false);
});

test('the founding window is half open and the grace period is inclusive', () => {
  const { hOpen, hClose, graceEnd } = deployment;
  assert.equal(isFounding(hOpen - 1, hClose, deployment), false);
  assert.equal(isFounding(hOpen, hClose, deployment), true);
  assert.equal(isFounding(hClose - 1, hClose, deployment), true);
  assert.equal(isFounding(hClose, hClose + 1, deployment), false);
  assert.equal(isFounding(hOpen, graceEnd, deployment), true);
  assert.equal(isFounding(hOpen, graceEnd + 1, deployment), false);
});

test('founding is false when the deployment has no heights', () => {
  const unset = { ...deployment, hOpen: null, hClose: null, graceEnd: null };
  assert.equal(isFounding(500, 700, unset), false);
});

test('KEEP entries are checked one at a time', () => {
  const transaction = tx({
    label: 'keep-entries',
    inputs: [],
    outputs: [out(20000, 'a'), out(MIN_SUCCESSOR - 1, 'b'), opReturnOut()],
  });
  const carriers = new Set([0, 1]);

  assert.deepEqual(validateKeepEntry({ inputIndex: 0, vout: 0 }, transaction, carriers), {
    ok: true,
    inputIndex: 0,
    vout: 0,
  });
  assert.equal(validateKeepEntry({ inputIndex: 5, vout: 0 }, transaction, carriers).reason, 'KEEP_ENTRY_NOT_CARRIER');
  assert.equal(validateKeepEntry({ inputIndex: 0, vout: 9 }, transaction, carriers).reason, 'KEEP_ENTRY_OUT_OF_RANGE');
  assert.equal(validateKeepEntry({ inputIndex: 0, vout: 2 }, transaction, carriers).reason, 'KEEP_ENTRY_IS_OPRETURN');
  assert.equal(validateKeepEntry({ inputIndex: 0, vout: 1 }, transaction, carriers).reason, 'KEEP_ENTRY_BELOW_MIN');
});

test('a KEEP entry naming an output exactly at the minimum passes', () => {
  const transaction = tx({ label: 'keep-exact', inputs: [], outputs: [out(MIN_SUCCESSOR, 'a')] });
  assert.equal(validateKeepEntry({ inputIndex: 0, vout: 0 }, transaction, new Set([0])).ok, true);
});
