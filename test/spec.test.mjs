import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkSpecBytes, readSpecBytes, specSha256 } from '../scripts/verify-spec.mjs';
import { REASON_CODES } from '../dist/index.js';

const DEPLOYMENT_DIR = fileURLToPath(new URL('../deployments/', import.meta.url));

test('the specification meets its byte contract', () => {
  assert.deepEqual(checkSpecBytes(readSpecBytes()), []);
});

test('the byte contract catches the failures it claims to catch', () => {
  assert.deepEqual(checkSpecBytes(Buffer.from('', 'utf8')), ['file is empty']);
  assert.ok(checkSpecBytes(Buffer.from('a\r\nb\n', 'utf8')).some((p) => p.includes('carriage return')));
  assert.ok(checkSpecBytes(Buffer.from('a\tb\n', 'utf8')).some((p) => p.includes('tab')));
  assert.ok(checkSpecBytes(Buffer.from('no newline', 'utf8')).some((p) => p.includes('end with a newline')));
  assert.ok(checkSpecBytes(Buffer.from('two\n\n', 'utf8')).some((p) => p.includes('more than one newline')));
  assert.ok(checkSpecBytes(Buffer.from('trailing  \nfine\n', 'utf8')).some((p) => p.includes('trailing whitespace')));
  assert.ok(checkSpecBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x\n', 'utf8')])).some((p) => p.includes('byte order mark')));
});

test('every shipped deployment binds to the current specification hash', () => {
  const hash = specSha256(readSpecBytes());
  const files = readdirSync(DEPLOYMENT_DIR).filter((name) => name.endsWith('.json'));
  assert.ok(files.length >= 3, 'regtest, signet and mainnet records ship');
  for (const name of files) {
    const record = JSON.parse(readFileSync(`${DEPLOYMENT_DIR}${name}`, 'utf8'));
    assert.equal(record.spec_sha256, hash, `${name} is stamped with a stale specification hash, run npm run spec:stamp`);
  }
});

test('the specification names every reason code in the registry', () => {
  const text = readSpecBytes().toString('utf8');
  for (const code of REASON_CODES) {
    assert.ok(text.includes(`\`${code}\``), `the specification does not document ${code}`);
  }
});

test('the specification carries no em dash and no version label', () => {
  const text = readSpecBytes().toString('utf8');
  assert.equal(text.includes('—'), false, 'em dash found');
  assert.equal(/\bv[0-9]+\b/i.test(text.replace(/version 1/g, '')), false, 'version label found');
});
