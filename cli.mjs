#!/usr/bin/env node
/**
 * patina command line tool.
 *
 * Everything here is a thin shell over the library. No command reaches the
 * network, and no command writes outside the paths you name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  artifactId,
  buildScriptPubKey,
  commitCommitment,
  decodeScriptPubKey,
  decodeMarker,
  depthAt,
  encodeMarker,
  loadDeploymentFile,
  loadShippedDeployment,
  NETWORKS,
  replay,
  tierFor,
} from './dist/index.js';

import { readSpecBytes, specSha256, checkSpecBytes } from './scripts/verify-spec.mjs';
import { readVectors, verifyVectors } from './scripts/lib/verify-vectors.mjs';

const USAGE = `patina

Usage:
  patina marker encode --op seed --salt <hex32> --carrier-vout <n> [--flags 0]
  patina marker encode --op keep --entries <input:vout,input:vout,...>
  patina marker decode <scriptPubKeyHex or payloadHex>
  patina artifact-id --txid <displayTxid> --vout <n>
  patina commit-commitment --xonly <hex64> --salt <hex32>
  patina spec-hash
  patina vectors verify
  patina replay <blocks.json> [--deployment <${NETWORKS.join('|')}|path>]

Options:
  --json      print machine readable output where a command supports it
  --help      print this text

The replay file is either an array of resolved blocks or an object of the shape
{ "deployment": "regtest", "blocks": [ ... ] }. A resolved block carries, for
every input, the value, scriptPubKey and creation height of the output it spends,
plus the witness stack. See patina-protocol.md section 3.
`;

function fail(message) {
  process.stderr.write(`patina: ${message}\n`);
  process.exitCode = 1;
}

/** Parse `--name value` and `--flag` pairs out of an argument list. */
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return { flags, rest };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') throw new Error(`missing --${name}`);
  return value;
}

function requireInt(flags, name) {
  const value = Number(requireFlag(flags, name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non negative integer`);
  return value;
}

function print(json, human, wantJson) {
  if (wantJson) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else process.stdout.write(human);
}

function cmdMarkerEncode(flags) {
  const op = String(flags.op ?? '').toLowerCase();
  let marker;
  if (op === 'seed') {
    marker = {
      op: 'SEED',
      salt: requireFlag(flags, 'salt'),
      flags: flags.flags === undefined ? 0 : Number(flags.flags),
      carrierVout: requireInt(flags, 'carrier-vout'),
    };
  } else if (op === 'keep') {
    const raw = requireFlag(flags, 'entries');
    const entries = raw.split(',').map((part) => {
      const [a, b] = part.split(':');
      const inputIndex = Number(a);
      const vout = Number(b);
      if (!Number.isInteger(inputIndex) || !Number.isInteger(vout)) throw new Error(`bad entry: ${part}`);
      return { inputIndex, vout };
    });
    marker = { op: 'KEEP', entries };
  } else {
    throw new Error('--op must be seed or keep');
  }
  const payload = encodeMarker(marker);
  const script = buildScriptPubKey(payload);
  print(
    { marker, payloadHex: payload.toString('hex'), scriptPubKeyHex: script.toString('hex'), scriptBytes: script.length },
    `payload      ${payload.toString('hex')}\nscriptPubKey ${script.toString('hex')}\nscript bytes ${script.length}\n`,
    flags.json === true,
  );
}

function cmdMarkerDecode(rest, flags) {
  const hex = rest[0];
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('give one hex string, either a scriptPubKey or a marker payload');
  }
  const normalized = hex.toLowerCase();
  const asScript = decodeScriptPubKey(normalized);
  const result = asScript === null ? decodeMarker(normalized) : asScript;
  const source = asScript === null ? 'payload' : 'scriptPubKey';
  if (!result.ok) {
    print(
      { source, ok: false, reason: result.reason, detail: result.detail },
      `source ${source}\nresult invalid\nreason ${result.reason}\ndetail ${result.detail}\n`,
      flags.json === true,
    );
    process.exitCode = 1;
    return;
  }
  const marker = result.marker;
  const human =
    marker.op === 'SEED'
      ? `source ${source}\nop     SEED\nsalt   ${marker.salt}\nflags  ${marker.flags}\ncarrier vout ${marker.carrierVout}\n`
      : `source ${source}\nop     KEEP\ncount  ${marker.entries.length}\n${marker.entries
          .map((e) => `  input ${e.inputIndex} -> vout ${e.vout}\n`)
          .join('')}`;
  print({ source, ok: true, marker }, human, flags.json === true);
}

function cmdArtifactId(flags) {
  const txid = requireFlag(flags, 'txid');
  const vout = requireInt(flags, 'vout');
  const id = artifactId(txid, vout);
  print({ txid, vout, artifactId: id }, `${id}\n`, flags.json === true);
}

function cmdCommitCommitment(flags) {
  const xonly = requireFlag(flags, 'xonly');
  const salt = requireFlag(flags, 'salt');
  const commitment = commitCommitment(xonly, salt).toString('hex');
  print({ claimantXOnly: xonly, salt, commitment }, `${commitment}\n`, flags.json === true);
}

function cmdSpecHash(flags) {
  const bytes = readSpecBytes();
  const problems = checkSpecBytes(bytes);
  const hash = specSha256(bytes);
  print(
    { specSha256: hash, bytes: bytes.length, byteContractOk: problems.length === 0, problems },
    `${hash}\n`,
    flags.json === true,
  );
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`patina: spec byte contract: ${p}\n`);
    process.exitCode = 1;
  }
}

function cmdVectorsVerify(flags) {
  const vectors = readVectors();
  const { passed, failures } = verifyVectors(vectors);
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ passed, failed: failures.length, failures }, null, 2)}\n`);
  } else {
    process.stdout.write(`fixture      vectors/golden.json\n`);
    process.stdout.write(`spec sha256  ${vectors.manifest.specSha256}\n`);
    process.stdout.write(`checks       ${passed} passed, ${failures.length} failed\n`);
    for (const f of failures) process.stdout.write(`  FAIL ${f}\n`);
  }
  if (failures.length > 0) process.exitCode = 1;
}

function resolveDeployment(name) {
  if (name === undefined || name === true) return loadShippedDeployment('regtest');
  if (NETWORKS.includes(name)) return loadShippedDeployment(name);
  return loadDeploymentFile(name);
}

function cmdReplay(rest, flags) {
  const path = rest[0];
  if (typeof path !== 'string') throw new Error('give a path to a blocks JSON file');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const blocks = Array.isArray(parsed) ? parsed : parsed.blocks;
  if (!Array.isArray(blocks)) throw new Error('the file must be an array of blocks or an object with a blocks array');
  const deploymentName = flags.deployment ?? (Array.isArray(parsed) ? undefined : parsed.deployment);
  const deployment = resolveDeployment(deploymentName);

  const result = replay(blocks, deployment);
  const tip = result.state.height;
  const summary = {
    network: deployment.network,
    blocks: blocks.length,
    tipHeight: tip,
    stateRoot: result.steps.length > 0 ? result.steps[result.steps.length - 1].stateRoot : null,
    counters: result.state.counters,
    perHeight: result.steps.map((s) => ({
      height: s.height,
      stateRoot: s.stateRoot,
      eventRoot: s.eventRoot,
      events: s.events.length,
      invalidEvents: s.invalidEvents.length,
    })),
    artifacts: Object.keys(result.state.artifacts)
      .sort()
      .map((id) => {
        const a = result.state.artifacts[id];
        const depth = depthAt(a, tip);
        return {
          artifactId: id,
          status: a.status,
          founding: a.founding,
          endowmentSats: a.endowmentSats,
          depth,
          tier: tierFor(depth).index,
          tierName: tierFor(depth).name,
          rings: a.rings.length,
        };
      }),
  };

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`network      ${summary.network}\n`);
  process.stdout.write(`blocks       ${summary.blocks}\n`);
  process.stdout.write(`tip height   ${summary.tipHeight}\n`);
  process.stdout.write(`state root   ${summary.stateRoot ?? 'none'}\n`);
  process.stdout.write(`\nheight       state root                                                       events invalid\n`);
  for (const step of summary.perHeight) {
    process.stdout.write(
      `${String(step.height).padEnd(12)} ${step.stateRoot} ${String(step.events).padStart(6)} ${String(step.invalidEvents).padStart(7)}\n`,
    );
  }
  const c = summary.counters;
  process.stdout.write(`\ncounters\n`);
  process.stdout.write(`  artifacts alive      ${c.artifactsAlive}\n`);
  process.stdout.write(`  artifacts relic      ${c.artifactsRelic}\n`);
  process.stdout.write(`  founding total       ${c.foundingTotal}\n`);
  process.stdout.write(`  rings total          ${c.ringsTotal}\n`);
  process.stdout.write(`  deepest live depth   ${c.deepestLiveDepth}\n`);
  process.stdout.write(`  endowment total sats ${c.endowmentTotalSats}\n`);
}

function main(argv) {
  const { flags, rest } = parseFlags(argv);
  if (flags.help === true || rest.length === 0) {
    process.stdout.write(USAGE);
    return;
  }
  const [command, sub] = rest;
  try {
    switch (command) {
      case 'marker':
        if (sub === 'encode') return cmdMarkerEncode(flags);
        if (sub === 'decode') return cmdMarkerDecode(rest.slice(2), flags);
        throw new Error('marker takes encode or decode');
      case 'artifact-id':
        return cmdArtifactId(flags);
      case 'commit-commitment':
        return cmdCommitCommitment(flags);
      case 'spec-hash':
        return cmdSpecHash(flags);
      case 'vectors':
        if (sub === 'verify') return cmdVectorsVerify(flags);
        throw new Error('vectors takes verify');
      case 'replay':
        return cmdReplay(rest.slice(1), flags);
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
