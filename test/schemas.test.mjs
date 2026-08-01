import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildShareCard, loadShippedDeployment, replay, toWireArtifact, toWireInvalidEvent } from '../dist/index.js';
import { readSpecBytes, specSha256 } from '../scripts/verify-spec.mjs';
import { readVectors } from '../scripts/lib/verify-vectors.mjs';

const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
const DEPLOYMENT_DIR = fileURLToPath(new URL('../deployments/', import.meta.url));

const loadSchema = (name) => JSON.parse(readFileSync(`${SCHEMA_DIR}${name}`, 'utf8'));

/**
 * A validator for the JSON Schema subset these files use.
 * Keywords handled: type, const, enum, pattern, minimum, maximum, minLength,
 * minItems, required, properties, additionalProperties, items, oneOf, $ref.
 */
function validate(schema, value, root = schema, path = '$') {
  const errors = [];
  if (schema.$ref !== undefined) {
    const target = schema.$ref.replace('#/$defs/', '');
    return validate(root.$defs[target], value, root, path);
  }
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((option) => validate(option, value, root, path).length === 0);
    if (matches.length !== 1) errors.push(`${path} matched ${matches.length} of ${schema.oneOf.length} oneOf branches`);
    return errors;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual =
      value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.some((t) => (t === 'integer' ? actual === 'integer' : t === 'number' ? typeof value === 'number' : t === actual));
    if (!ok) {
      errors.push(`${path} is ${actual}, schema wants ${types.join(' or ')}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} is not the const ${schema.const}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) errors.push(`${path} is not in the enum`);
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(String(value))) {
    errors.push(`${path} does not match ${schema.pattern}`);
  }
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above ${schema.maximum}`);
  if (schema.minLength !== undefined && String(value).length < schema.minLength) errors.push(`${path} is too short`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.items !== undefined) {
      value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)));
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path} is missing ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (schema.properties?.[key] === undefined) errors.push(`${path} carries unexpected property ${key}`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(sub, value[key], root, `${path}.${key}`));
    }
  }
  return errors;
}

test('the validator itself rejects and accepts as expected', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: { a: { type: 'integer', minimum: 1 }, b: { type: 'string', pattern: '^x+$' } },
  };
  assert.deepEqual(validate(schema, { a: 1, b: 'xx' }), []);
  assert.equal(validate(schema, { b: 'xx' }).length, 1);
  assert.equal(validate(schema, { a: 0 }).length, 1);
  assert.equal(validate(schema, { a: 1, c: true }).length, 1);
  assert.equal(validate(schema, { a: 1, b: 'y' }).length, 1);
});

test('every schema file is well formed and carries the fields a reader needs', () => {
  const files = readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual(files, ['artifact.schema.json', 'deployment.schema.json', 'invalid-event.schema.json', 'share-card.schema.json']);
  for (const name of files) {
    const schema = loadSchema(name);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
    assert.ok(schema.$id.endsWith(name), name);
    assert.ok(typeof schema.title === 'string' && schema.title.length > 0, name);
    assert.ok(typeof schema.description === 'string' && schema.description.length > 0, name);
    assert.equal(schema.type, 'object', name);
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0, name);
    assert.equal(/v[0-9]/i.test(name), false, 'file names carry no version label');
  }
});

test('every shipped deployment record validates', () => {
  const schema = loadSchema('deployment.schema.json');
  for (const name of readdirSync(DEPLOYMENT_DIR).filter((f) => f.endsWith('.json'))) {
    const record = JSON.parse(readFileSync(`${DEPLOYMENT_DIR}${name}`, 'utf8'));
    assert.deepEqual(validate(schema, record), [], name);
  }
});

test('the deployment schema rejects records the loader would also reject', () => {
  const schema = loadSchema('deployment.schema.json');
  const good = JSON.parse(readFileSync(`${DEPLOYMENT_DIR}regtest.json`, 'utf8'));
  assert.ok(validate(schema, { ...good, protocolId: 'PATN' }).length > 0);
  assert.ok(validate(schema, { ...good, network: 'testnet' }).length > 0);
  assert.ok(validate(schema, { ...good, minCarrierOpen: 1 }).length > 0);
  assert.ok(validate(schema, { ...good, specSha256: 'AA'.repeat(32) }).length > 0);
  assert.ok(validate(schema, { ...good, approvers: ['only one'] }).length > 0);
});

test('every artifact the reducer produces validates in its wire form', () => {
  const schema = loadSchema('artifact.schema.json');
  const deployment = loadShippedDeployment('regtest');
  const { golden } = readVectors();
  let checked = 0;
  let withRings = 0;
  for (const scenario of golden.scenarios) {
    const state = replay(scenario.blocks, deployment).state;
    for (const artifact of Object.values(state.artifacts)) {
      const wire = toWireArtifact(artifact);
      assert.deepEqual(validate(schema, wire), [], `${scenario.name} ${artifact.artifactId}`);
      assert.equal(wire.endowment_sats, String(artifact.endowmentSats));
      assert.equal(typeof wire.birth_height, 'number');
      if (wire.rings.length > 0) {
        withRings += 1;
        assert.equal(wire.rings[0].carried_value, String(artifact.rings[0].carriedValue));
      }
      checked += 1;
    }
  }
  assert.ok(checked > 20, `expected many artifacts, checked ${checked}`);
  assert.ok(withRings > 0, 'at least one artifact carried a ring');
});

test('every invalid event in the fixture validates in its wire form', () => {
  const schema = loadSchema('invalid-event.schema.json');
  const { golden } = readVectors();
  let checked = 0;
  for (const scenario of golden.scenarios) {
    for (const step of scenario.steps) {
      for (const event of step.invalidEvents) {
        const wire = toWireInvalidEvent(event);
        assert.deepEqual(validate(schema, wire), [], `${scenario.name} ${event.reason}`);
        assert.equal(wire.tx_index, event.txIndex);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 18, `expected at least one per reason code, checked ${checked}`);
});

test('a share card built from a real artifact validates', () => {
  const schema = loadSchema('share-card.schema.json');
  const deployment = loadShippedDeployment('regtest');
  const { golden } = readVectors();
  const hash = specSha256(readSpecBytes());
  let alive = 0;
  let relic = 0;

  for (const scenario of golden.scenarios) {
    const run = replay(scenario.blocks, deployment);
    const last = run.steps[run.steps.length - 1];
    for (const artifact of Object.values(run.state.artifacts)) {
      const card = buildShareCard(artifact, {
        network: 'regtest',
        specSha256: hash,
        asOfHeight: last.height,
        asOfBlockHash: last.blockHash,
      });
      assert.deepEqual(validate(schema, card), [], `${scenario.name} ${artifact.artifactId}`);
      assert.equal(card.endowment_sats, String(artifact.endowmentSats));
      if (artifact.status === 'ALIVE') {
        alive += 1;
        assert.equal(card.carrier.value, String(artifact.carrier.value));
      } else {
        relic += 1;
        assert.equal(card.carrier, null);
      }
    }
  }
  assert.ok(alive > 0 && relic > 0, 'both a live artifact and a relic were covered');
});

test('buildShareCard refuses a malformed context', () => {
  const deployment = loadShippedDeployment('regtest');
  const { golden } = readVectors();
  const scenario = golden.scenarios.find((s) => s.name === 'relic-creation');
  const state = replay(scenario.blocks, deployment).state;
  const artifact = Object.values(state.artifacts)[0];
  const good = { network: 'regtest', specSha256: specSha256(readSpecBytes()), asOfHeight: 1801, asOfBlockHash: '11'.repeat(32) };

  assert.throws(() => buildShareCard(artifact, { ...good, specSha256: 'nope' }), /specSha256/);
  assert.throws(() => buildShareCard(artifact, { ...good, asOfBlockHash: 'nope' }), /asOfBlockHash/);
  assert.throws(() => buildShareCard(artifact, { ...good, asOfHeight: -1 }), /asOfHeight/);
  assert.equal(buildShareCard(artifact, good).status, 'RELIC');
});

test('the share card tier fields agree with the ladder', () => {
  const deployment = loadShippedDeployment('regtest');
  const { golden } = readVectors();
  const scenario = golden.scenarios.find((s) => s.name === 'keep-single-entry');
  const state = replay(scenario.blocks, deployment).state;
  const artifact = Object.values(state.artifacts)[0];
  const hash = specSha256(readSpecBytes());

  const early = buildShareCard(artifact, { network: 'regtest', specSha256: hash, asOfHeight: 701, asOfBlockHash: '11'.repeat(32) });
  assert.equal(early.depth, 0);
  assert.equal(early.tier, 0);
  assert.equal(early.tier_name, 'Raw');
  assert.equal(early.next_tier_name, 'Sheen');
  assert.equal(early.blocks_to_next_tier, 1008);

  const later = buildShareCard(artifact, { network: 'regtest', specSha256: hash, asOfHeight: 701 + 1008, asOfBlockHash: '11'.repeat(32) });
  assert.equal(later.depth, 1008);
  assert.equal(later.tier, 1);
  assert.equal(later.tier_name, 'Sheen');
  assert.equal(later.blocks_to_next_tier, 4032 - 1008);
});
