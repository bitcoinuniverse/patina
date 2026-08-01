#!/usr/bin/env node
/**
 * Generate vectors/golden.json and vectors/manifest.json.
 *
 * The generator is deterministic. Running it twice on two machines produces
 * byte identical files. It reads the built library from dist, so run the build
 * first.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  artifactId,
  attestationMessage,
  blocksToNextTier,
  buildLegacyCommitLeafScript,
  buildScriptPubKey,
  commitCommitment,
  COMMIT_MIN_AGE,
  decodeScriptPubKey,
  depthAt,
  encodeMarker,
  GRACE_LENGTH,
  loadShippedDeployment,
  MAX_KEEP_ENTRIES,
  MIN_CARRIER_FOUNDING,
  MIN_CARRIER_OPEN,
  MIN_SUCCESSOR,
  nextTier,
  replay,
  tierFor,
  TIERS,
  txidToWire,
  WINDOW_LENGTH,
} from '../dist/index.js';

import {
  block,
  commitInput,
  keepPayloadRaw,
  markerOut,
  opReturnOut,
  out,
  p2wpkhFor,
  plainInput,
  rawPayload,
  rawScriptOut,
  saltFor,
  scriptFromPayload,
  seedPayloadWithFlags,
  spendInput,
  tx,
  txidFor,
  xonlyFor,
} from './lib/fixtures.mjs';

import { readSpecBytes, specSha256 } from './verify-spec.mjs';

const VECTORS_DIR = new URL('../vectors/', import.meta.url);
const EXAMPLES_DIR = new URL('../examples/', import.meta.url);
const deployment = loadShippedDeployment('regtest');

const seedMarker = (label, carrierVout) => ({ op: 'SEED', salt: saltFor(label), flags: 0, carrierVout });
const keepMarker = (entries) => ({ op: 'KEEP', entries });

/** Build a SEED transaction with one commit input and one carrier output. */
function seedTx({ label, commitHeight, carrierValue, carrierVout = 1, extraOutputs = [], key }) {
  const salt = saltFor(label);
  const outputs = [markerOut(seedMarker(label, carrierVout))];
  outputs.push(out(carrierValue, `${label}/carrier`));
  for (const extra of extraOutputs) outputs.push(extra);
  return tx({
    label,
    inputs: [commitInput({ label, height: commitHeight, salt, key })],
    outputs,
  });
}

/** The outpoint a SEED transaction creates. */
function carrierOf(label, carrierVout = 1) {
  return { txid: txidFor(label), vout: carrierVout };
}

/** An input that spends the carrier a SEED created. */
function spendCarrier(label, { value, height, carrierVout = 1 }) {
  const point = carrierOf(label, carrierVout);
  return spendInput({
    txid: point.txid,
    vout: point.vout,
    value,
    scriptPubKey: p2wpkhFor(`${label}/carrier`),
    height,
  });
}

/** An input that spends an arbitrary outpoint that currently holds artifacts. */
function spendOutpoint(txid, vout, value, scriptLabel, height) {
  return spendInput({ txid, vout, value, scriptPubKey: p2wpkhFor(scriptLabel), height });
}

function summarizeArtifacts(state, height) {
  return Object.keys(state.artifacts)
    .sort()
    .map((id) => {
      const a = state.artifacts[id];
      const depth = depthAt(a, height);
      const tier = tierFor(depth);
      const next = nextTier(depth);
      return {
        artifactId: a.artifactId,
        birthTxid: a.birthTxid,
        birthHeight: a.birthHeight,
        birthVout: a.birthVout,
        endowmentSats: a.endowmentSats,
        founding: a.founding,
        status: a.status,
        carrier: a.carrier,
        rings: a.rings,
        depth,
        tierIndex: tier.index,
        tierName: tier.name,
        nextTierIndex: next === null ? null : next.index,
        blocksToNextTier: blocksToNextTier(depth),
      };
    });
}

function summarizeCarriers(state) {
  const outp = {};
  for (const key of Object.keys(state.carriers).sort()) outp[key] = [...state.carriers[key]];
  return outp;
}

const scenarios = [];

function scenario(name, description, blocks) {
  const result = replay(blocks, deployment);
  const finalHeight = blocks[blocks.length - 1].height;
  scenarios.push({
    name,
    description,
    deployment: 'regtest',
    blocks,
    steps: result.steps.map((step) => ({
      height: step.height,
      blockHash: step.blockHash,
      eventRoot: step.eventRoot,
      stateRoot: step.stateRoot,
      events: step.events,
      invalidEvents: step.invalidEvents,
    })),
    finalCounters: result.state.counters,
    finalCarriers: summarizeCarriers(result.state),
    finalArtifacts: summarizeArtifacts(result.state, finalHeight),
  });
  return result;
}

// ---------------------------------------------------------------------------
// Scenario 1: founding mint at the window open edge, plus a carrier one satoshi
// short of the founding minimum.
// ---------------------------------------------------------------------------
scenario(
  'founding-carrier-minimum',
  'A commit created exactly at h_open reveals a founding artifact. A second reveal in the same block holds one satoshi less than MIN_CARRIER_FOUNDING and is rejected.',
  [
    block({
      height: 344,
      label: 's1',
      txs: [
        seedTx({ label: 's1-founding-at-min', commitHeight: 200, carrierValue: MIN_CARRIER_FOUNDING }),
        seedTx({ label: 's1-founding-below-min', commitHeight: 200, carrierValue: MIN_CARRIER_FOUNDING - 1 }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 2: the 143 against 144 commit age boundary.
// ---------------------------------------------------------------------------
scenario(
  'commit-age-boundary',
  'Reveal height minus commit height must be at least COMMIT_MIN_AGE. An age of 143 fails, an age of 144 passes.',
  [
    block({
      height: 500,
      label: 's2',
      txs: [
        seedTx({ label: 's2-age-143', commitHeight: 500 - (COMMIT_MIN_AGE - 1), carrierValue: MIN_CARRIER_FOUNDING }),
        seedTx({ label: 's2-age-144', commitHeight: 500 - COMMIT_MIN_AGE, carrierValue: MIN_CARRIER_FOUNDING }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 3: open era carrier minimum, below and at.
// ---------------------------------------------------------------------------
scenario(
  'open-era-carrier-minimum',
  'A commit created before h_open is never founding, so the open era minimum applies. One satoshi short fails, exactly MIN_CARRIER_OPEN passes.',
  [
    block({
      height: 300,
      label: 's3',
      txs: [
        seedTx({ label: 's3-open-below-min', commitHeight: 100, carrierValue: MIN_CARRIER_OPEN - 1 }),
        seedTx({ label: 's3-open-at-min', commitHeight: 100, carrierValue: MIN_CARRIER_OPEN }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 4: founding window edges, commit at h_open, at h_close - 1, at h_close.
// ---------------------------------------------------------------------------
scenario(
  'founding-window-edges',
  'The window is half open. A commit at h_open is inside, a commit at h_close - 1 is inside, a commit at h_close is outside and mints an open era artifact.',
  [
    block({
      height: 4400,
      label: 's4',
      txs: [
        seedTx({ label: 's4-commit-at-open', commitHeight: deployment.hOpen, carrierValue: MIN_CARRIER_FOUNDING }),
        seedTx({ label: 's4-commit-at-close-minus-one', commitHeight: deployment.hClose - 1, carrierValue: MIN_CARRIER_FOUNDING }),
        seedTx({ label: 's4-commit-at-close', commitHeight: deployment.hClose, carrierValue: MIN_CARRIER_OPEN }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 5: reveal inside the grace period and one block after it.
// ---------------------------------------------------------------------------
scenario(
  'grace-boundary',
  'A reveal at grace_end is still founding. The same shape one block later is a valid open era artifact with founding false.',
  [
    block({
      height: deployment.graceEnd,
      label: 's5-a',
      txs: [seedTx({ label: 's5-reveal-at-grace-end', commitHeight: 4000, carrierValue: MIN_CARRIER_FOUNDING })],
    }),
    block({
      height: deployment.graceEnd + 1,
      label: 's5-b',
      txs: [seedTx({ label: 's5-reveal-after-grace', commitHeight: 4001, carrierValue: MIN_CARRIER_FOUNDING })],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 6: duplicate marker voids, on a mint and on a spend.
// ---------------------------------------------------------------------------
{
  const seedLabel = 's6-seed';
  const dupSeedTx = tx({
    label: 's6-dup-mint',
    inputs: [commitInput({ label: 's6-dup-mint', height: 400, salt: saltFor('s6-dup-mint') })],
    outputs: [
      markerOut(seedMarker('s6-dup-mint', 2)),
      markerOut(seedMarker('s6-dup-mint-second', 2)),
      out(MIN_CARRIER_FOUNDING, 's6-dup-mint/carrier'),
    ],
  });
  const dupSpendTx = tx({
    label: 's6-dup-spend',
    inputs: [spendCarrier(seedLabel, { value: MIN_CARRIER_FOUNDING, height: 600 })],
    outputs: [
      markerOut(keepMarker([{ inputIndex: 0, vout: 2 }])),
      out(50000, 's6-spend/a'),
      out(30000, 's6-spend/b'),
      markerOut(keepMarker([{ inputIndex: 0, vout: 1 }])),
    ],
  });
  scenario(
    'duplicate-marker-void',
    'Two PTNA payloads in one transaction void the marker. On a mint nothing is created. On a spend the KEEP is ignored and the default rule picks the successor.',
    [
      block({ height: 600, label: 's6-a', txs: [seedTx({ label: seedLabel, commitHeight: 400, carrierValue: MIN_CARRIER_FOUNDING }), dupSeedTx] }),
      block({ height: 601, label: 's6-b', txs: [dupSpendTx] }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Scenario 7: KEEP with one entry routes away from the default output.
// ---------------------------------------------------------------------------
scenario(
  'keep-single-entry',
  'A KEEP entry names output 2 while the default rule would have picked output 0. The named output wins.',
  [
    block({ height: 700, label: 's7-a', txs: [seedTx({ label: 's7-seed', commitHeight: 500, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 701,
      label: 's7-b',
      txs: [
        tx({
          label: 's7-move',
          inputs: [spendCarrier('s7-seed', { value: MIN_CARRIER_FOUNDING, height: 700 })],
          outputs: [out(20000, 's7/a'), out(30000, 's7/b'), out(40000, 's7/c'), markerOut(keepMarker([{ inputIndex: 0, vout: 2 }]))],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 8: KEEP with eight entries, the maximum.
// ---------------------------------------------------------------------------
{
  const labels = Array.from({ length: MAX_KEEP_ENTRIES }, (_, i) => `s8-seed-${i}`);
  const mintBlock = block({
    height: 800,
    label: 's8-a',
    txs: labels.map((label) => seedTx({ label, commitHeight: 600, carrierValue: MIN_CARRIER_FOUNDING })),
  });
  const entries = labels.map((_, i) => ({ inputIndex: i, vout: MAX_KEEP_ENTRIES - 1 - i }));
  const moveTx = tx({
    label: 's8-move',
    inputs: labels.map((label) => spendCarrier(label, { value: MIN_CARRIER_FOUNDING, height: 800 })),
    outputs: [
      ...Array.from({ length: MAX_KEEP_ENTRIES }, (_, i) => out(MIN_SUCCESSOR + i * 1000, `s8/out-${i}`)),
      markerOut(keepMarker(entries)),
    ],
  });
  scenario(
    'keep-eight-entries',
    'Eight carriers spent by one transaction, routed by a KEEP marker with the maximum eight entries. Input i goes to output 7 minus i.',
    [mintBlock, block({ height: 801, label: 's8-b', txs: [moveTx] })],
  );
}

// ---------------------------------------------------------------------------
// Scenario 9: every KEEP entry failure, each falling through to the default rule.
// ---------------------------------------------------------------------------
{
  const labels = ['s9-seed-0', 's9-seed-1', 's9-seed-2', 's9-seed-3'];
  const mintBlock = block({
    height: 900,
    label: 's9-a',
    txs: labels.map((label) => seedTx({ label, commitHeight: 700, carrierValue: MIN_CARRIER_FOUNDING })),
  });
  const moveTx = tx({
    label: 's9-move',
    inputs: [
      ...labels.map((label) => spendCarrier(label, { value: MIN_CARRIER_FOUNDING, height: 900 })),
      plainInput({ label: 's9-plain', height: 899 }),
    ],
    outputs: [
      out(20000, 's9/a'),
      out(30000, 's9/b'),
      out(MIN_SUCCESSOR - 1, 's9/small'),
      opReturnOut(),
      markerOut(
        keepMarker([
          { inputIndex: 4, vout: 0 },
          { inputIndex: 0, vout: 9 },
          { inputIndex: 1, vout: 3 },
          { inputIndex: 2, vout: 2 },
          { inputIndex: 3, vout: 1 },
        ]),
      ),
    ],
  });
  scenario(
    'keep-entry-failures',
    'One KEEP marker carrying an entry for a non carrier input, an out of range output, an OP_RETURN output and an output below MIN_SUCCESSOR. Each void entry falls through to the default rule while the one good entry still routes.',
    [mintBlock, block({ height: 901, label: 's9-b', txs: [moveTx] })],
  );
}

// ---------------------------------------------------------------------------
// Scenario 10: KEEP in a transaction that spends no carrier.
// ---------------------------------------------------------------------------
scenario(
  'keep-no-carrier-input',
  'A KEEP marker in a transaction that spends no live carrier is inert and records KEEP_NO_CARRIER_INPUT once.',
  [
    block({
      height: 1000,
      label: 's10',
      txs: [
        tx({
          label: 's10-keep',
          inputs: [plainInput({ label: 's10-plain', height: 999 })],
          outputs: [out(40000, 's10/a'), markerOut(keepMarker([{ inputIndex: 0, vout: 0 }]))],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 11: KEEP naming the same input twice.
// ---------------------------------------------------------------------------
scenario(
  'keep-duplicate-input',
  'A KEEP payload naming input 0 twice fails to decode. The whole marker is inert, so the default rule picks the successor.',
  [
    block({ height: 1100, label: 's11-a', txs: [seedTx({ label: 's11-seed', commitHeight: 900, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 1101,
      label: 's11-b',
      txs: [
        tx({
          label: 's11-move',
          inputs: [spendCarrier('s11-seed', { value: MIN_CARRIER_FOUNDING, height: 1100 })],
          outputs: [
            rawScriptOut(scriptFromPayload(keepPayloadRaw(2, [0, 1, 0, 2]))),
            out(15000, 's11/a'),
            out(25000, 's11/b'),
          ],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 12: KEEP grammar failures.
// ---------------------------------------------------------------------------
scenario(
  'keep-bad-grammar',
  'A KEEP count of nine and a KEEP count of zero both fail to decode. The marker is inert and the default rule applies.',
  [
    block({
      height: 1200,
      label: 's12-a',
      txs: [
        seedTx({ label: 's12-seed-a', commitHeight: 1000, carrierValue: MIN_CARRIER_FOUNDING }),
        seedTx({ label: 's12-seed-b', commitHeight: 1000, carrierValue: MIN_CARRIER_FOUNDING }),
      ],
    }),
    block({
      height: 1201,
      label: 's12-b',
      txs: [
        tx({
          label: 's12-count-nine',
          inputs: [spendCarrier('s12-seed-a', { value: MIN_CARRIER_FOUNDING, height: 1200 })],
          outputs: [
            rawScriptOut(scriptFromPayload(keepPayloadRaw(9, [0, 1, 1, 1, 2, 1, 3, 1, 4, 1, 5, 1, 6, 1, 7, 1, 8, 1]))),
            out(20000, 's12/a'),
          ],
        }),
        tx({
          label: 's12-count-zero',
          inputs: [spendCarrier('s12-seed-b', { value: MIN_CARRIER_FOUNDING, height: 1200 })],
          outputs: [rawScriptOut(scriptFromPayload(keepPayloadRaw(0, []))), out(21000, 's12/b')],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 13: SEED grammar failures.
// ---------------------------------------------------------------------------
{
  const goodPayload = encodeMarker(seedMarker('s13-good', 1));
  const nonMinimal = Buffer.concat([Buffer.from([0x6a, 0x4c, goodPayload.length]), goodPayload]).toString('hex');
  const trailing = Buffer.concat([buildScriptPubKey(goodPayload), Buffer.from([0x51])]).toString('hex');
  const shortBody = rawPayload({ op: 0x01, body: Buffer.alloc(17) });
  scenario(
    'seed-bad-grammar',
    'A non zero flags byte, a short payload, a non minimal push and a byte after the push all report SEED_BAD_GRAMMAR.',
    [
      block({
        height: 1300,
        label: 's13',
        txs: [
          tx({
            label: 's13-flags-set',
            inputs: [commitInput({ label: 's13-flags-set', height: 1100, salt: saltFor('s13-flags-set') })],
            outputs: [rawScriptOut(scriptFromPayload(seedPayloadWithFlags(saltFor('s13-flags-set'), 0x01, 1))), out(MIN_CARRIER_FOUNDING, 's13/a')],
          }),
          tx({
            label: 's13-short-payload',
            inputs: [plainInput({ label: 's13-short', height: 1100 })],
            outputs: [rawScriptOut(scriptFromPayload(shortBody)), out(MIN_CARRIER_FOUNDING, 's13/b')],
          }),
          tx({
            label: 's13-non-minimal-push',
            inputs: [plainInput({ label: 's13-nonmin', height: 1100 })],
            outputs: [rawScriptOut(nonMinimal), out(MIN_CARRIER_FOUNDING, 's13/c')],
          }),
          tx({
            label: 's13-trailing-opcode',
            inputs: [plainInput({ label: 's13-trail', height: 1100 })],
            outputs: [rawScriptOut(trailing), out(MIN_CARRIER_FOUNDING, 's13/d')],
          }),
        ],
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Scenario 14: unknown op and unknown version.
// ---------------------------------------------------------------------------
scenario(
  'marker-unknown-op-and-version',
  'An op byte of 0x03, a version byte of 0x02, a payload with no op byte and a payload with no version byte.',
  [
    block({
      height: 1400,
      label: 's14',
      txs: [
        tx({
          label: 's14-unknown-op',
          inputs: [plainInput({ label: 's14-a', height: 1300 })],
          outputs: [rawScriptOut(scriptFromPayload(rawPayload({ op: 0x03, body: Buffer.alloc(4) }))), out(50000, 's14/a')],
        }),
        tx({
          label: 's14-unknown-version',
          inputs: [plainInput({ label: 's14-b', height: 1300 })],
          outputs: [rawScriptOut(scriptFromPayload(rawPayload({ version: 0x02, op: 0x01, body: Buffer.alloc(18) }))), out(50000, 's14/b')],
        }),
        tx({
          label: 's14-no-op-byte',
          inputs: [plainInput({ label: 's14-c', height: 1300 })],
          outputs: [rawScriptOut(scriptFromPayload('50544e4101')), out(50000, 's14/c')],
        }),
        tx({
          label: 's14-no-version-byte',
          inputs: [plainInput({ label: 's14-d', height: 1300 })],
          outputs: [rawScriptOut(scriptFromPayload('50544e41')), out(50000, 's14/d')],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 15: an oversized marker script.
// ---------------------------------------------------------------------------
{
  const big = Buffer.concat([Buffer.from('50544e41', 'hex'), Buffer.from([0x01, 0x01]), Buffer.alloc(76, 0x11)]);
  const oversized = Buffer.concat([Buffer.from([0x6a, 0x4c, big.length]), big]).toString('hex');
  scenario(
    'marker-too-large',
    'An OP_RETURN carrying an 82 byte PTNA payload makes an 85 byte scriptPubKey, above the 83 byte ceiling.',
    [
      block({
        height: 1500,
        label: 's15',
        txs: [
          tx({
            label: 's15-oversized',
            inputs: [plainInput({ label: 's15', height: 1400 })],
            outputs: [rawScriptOut(oversized), out(MIN_CARRIER_FOUNDING, 's15/a')],
          }),
        ],
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Scenario 16: SEED semantic failures.
// ---------------------------------------------------------------------------
{
  const sharedKey = xonlyFor('s16-shared');
  const sharedSalt = saltFor('s16-two-commits');
  const twoCommitTx = tx({
    label: 's16-two-commits',
    inputs: [
      commitInput({ label: 's16-two-commits-a', height: 1200, salt: sharedSalt, key: sharedKey }),
      commitInput({ label: 's16-two-commits-b', height: 1200, salt: sharedSalt, key: sharedKey }),
    ],
    outputs: [markerOut({ op: 'SEED', salt: sharedSalt, flags: 0, carrierVout: 1 }), out(MIN_CARRIER_FOUNDING, 's16/two')],
  });
  scenario(
    'seed-semantic-failures',
    'Carrier out of range, carrier naming the marker output, no commit input at all, a commit leaf that does not bind this salt, and two qualifying commit inputs.',
    [
      block({
        height: 1600,
        label: 's16',
        txs: [
          tx({
            label: 's16-carrier-out-of-range',
            inputs: [commitInput({ label: 's16-oor', height: 1400, salt: saltFor('s16-oor') })],
            outputs: [markerOut(seedMarker('s16-oor', 5)), out(MIN_CARRIER_FOUNDING, 's16/oor')],
          }),
          tx({
            label: 's16-carrier-is-opreturn',
            inputs: [commitInput({ label: 's16-opret', height: 1400, salt: saltFor('s16-opret') })],
            outputs: [markerOut(seedMarker('s16-opret', 0)), out(MIN_CARRIER_FOUNDING, 's16/opret')],
          }),
          tx({
            label: 's16-no-commit-input',
            inputs: [plainInput({ label: 's16-nocommit', height: 1400 })],
            outputs: [markerOut(seedMarker('s16-nocommit', 1)), out(MIN_CARRIER_FOUNDING, 's16/nocommit')],
          }),
          tx({
            label: 's16-commitment-mismatch',
            inputs: [
              commitInput({
                label: 's16-mismatch',
                height: 1400,
                salt: saltFor('s16-mismatch'),
                commitment: commitCommitment(xonlyFor('s16-mismatch'), saltFor('s16-other-salt')).toString('hex'),
              }),
            ],
            outputs: [markerOut(seedMarker('s16-mismatch', 1)), out(MIN_CARRIER_FOUNDING, 's16/mismatch')],
          }),
          twoCommitTx,
        ],
      }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Scenario 17: the default rule skips OP_RETURN and thin outputs.
// ---------------------------------------------------------------------------
scenario(
  'default-rule-successor',
  'With no marker at all the default rule picks the lowest index output that is not an OP_RETURN and holds at least MIN_SUCCESSOR.',
  [
    block({ height: 1700, label: 's17-a', txs: [seedTx({ label: 's17-seed', commitHeight: 1500, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 1701,
      label: 's17-b',
      txs: [
        tx({
          label: 's17-move',
          inputs: [spendCarrier('s17-seed', { value: MIN_CARRIER_FOUNDING, height: 1700 })],
          outputs: [opReturnOut(), out(MIN_SUCCESSOR - 5000, 's17/thin'), out(20000, 's17/fat')],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 18: relic creation.
// ---------------------------------------------------------------------------
scenario(
  'relic-creation',
  'A carrier spent into nothing but an OP_RETURN and a thin output leaves no eligible successor. The artifact becomes a relic and never changes again.',
  [
    block({ height: 1800, label: 's18-a', txs: [seedTx({ label: 's18-seed', commitHeight: 1600, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 1801,
      label: 's18-b',
      txs: [
        tx({
          label: 's18-burn',
          inputs: [spendCarrier('s18-seed', { value: MIN_CARRIER_FOUNDING, height: 1800 })],
          outputs: [opReturnOut(), out(MIN_SUCCESSOR - 1, 's18/thin')],
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Scenario 19: a bundle of three artifacts moving together.
// ---------------------------------------------------------------------------
{
  const labels = ['s19-seed-0', 's19-seed-1', 's19-seed-2'];
  const gatherTx = tx({
    label: 's19-gather',
    inputs: labels.map((label) => spendCarrier(label, { value: MIN_CARRIER_FOUNDING, height: 1900 })),
    outputs: [out(290000, 's19/bundle')],
  });
  const moveTx = tx({
    label: 's19-move-bundle',
    inputs: [spendOutpoint(txidFor('s19-gather'), 0, 290000, 's19/bundle', 1901)],
    outputs: [out(280000, 's19/bundle-next')],
  });
  scenario(
    'bundle-of-three',
    'Three artifacts land on one output and become a bundle. One input carries one routing decision, so the next spend moves all three together and each appends its own ring.',
    [
      block({ height: 1900, label: 's19-a', txs: labels.map((label) => seedTx({ label, commitHeight: 1700, carrierValue: MIN_CARRIER_FOUNDING })) }),
      block({ height: 1901, label: 's19-b', txs: [gatherTx] }),
      block({ height: 1902, label: 's19-c', txs: [moveTx] }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Scenario 20: a five block replay with a state root at every height.
// ---------------------------------------------------------------------------
{
  const blocks = [
    block({ height: 2000, label: 's20-0', txs: [seedTx({ label: 's20-seed-a', commitHeight: 1800, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 2001,
      label: 's20-1',
      txs: [
        tx({
          label: 's20-move-a',
          inputs: [spendCarrier('s20-seed-a', { value: MIN_CARRIER_FOUNDING, height: 2000 })],
          outputs: [out(90000, 's20/a1'), markerOut(keepMarker([{ inputIndex: 0, vout: 0 }]))],
        }),
      ],
    }),
    block({ height: 2002, label: 's20-2', txs: [] }),
    block({
      height: 2003,
      label: 's20-3',
      txs: [
        seedTx({ label: 's20-seed-b', commitHeight: 1850, carrierValue: MIN_CARRIER_FOUNDING }),
        tx({
          label: 's20-move-a-again',
          inputs: [spendOutpoint(txidFor('s20-move-a'), 0, 90000, 's20/a1', 2001)],
          outputs: [out(80000, 's20/a2')],
        }),
      ],
    }),
    block({
      height: 2004,
      label: 's20-4',
      txs: [
        tx({
          label: 's20-relic-a',
          inputs: [spendOutpoint(txidFor('s20-move-a-again'), 0, 80000, 's20/a2', 2003)],
          outputs: [opReturnOut()],
        }),
      ],
    }),
  ];
  scenario(
    'multi-block-replay',
    'Five consecutive blocks that mint, move by KEEP, idle, mint again and move, then end one artifact as a relic. Every height carries its own state root.',
    blocks,
  );
}

// ---------------------------------------------------------------------------
// Reorg: common blocks, then two different branches from the same fork height.
// ---------------------------------------------------------------------------
const reorg = (() => {
  const common = [
    block({ height: 3001, label: 'r-common-1', txs: [seedTx({ label: 'r-seed', commitHeight: 2800, carrierValue: MIN_CARRIER_FOUNDING })] }),
    block({
      height: 3002,
      label: 'r-common-2',
      txs: [
        tx({
          label: 'r-move-1',
          inputs: [spendCarrier('r-seed', { value: MIN_CARRIER_FOUNDING, height: 3001 })],
          outputs: [out(95000, 'r/step1')],
        }),
      ],
    }),
    block({ height: 3003, label: 'r-common-3', txs: [] }),
  ];
  const branchA = [
    block({
      height: 3004,
      label: 'r-a-4',
      txs: [
        tx({
          label: 'r-a-move',
          inputs: [spendOutpoint(txidFor('r-move-1'), 0, 95000, 'r/step1', 3002)],
          outputs: [out(90000, 'r/a-step2')],
        }),
      ],
    }),
    block({
      height: 3005,
      label: 'r-a-5',
      txs: [
        tx({
          label: 'r-a-burn',
          inputs: [spendOutpoint(txidFor('r-a-move'), 0, 90000, 'r/a-step2', 3004)],
          outputs: [opReturnOut()],
        }),
      ],
    }),
  ];
  const branchB = [
    block({
      height: 3004,
      label: 'r-b-4',
      txs: [
        tx({
          label: 'r-b-move',
          inputs: [spendOutpoint(txidFor('r-move-1'), 0, 95000, 'r/step1', 3002)],
          outputs: [markerOut(keepMarker([{ inputIndex: 0, vout: 1 }])), out(91000, 'r/b-step2')],
        }),
      ],
    }),
    block({ height: 3005, label: 'r-b-5', txs: [] }),
  ];

  const commonRun = replay(common, deployment);
  const forkState = commonRun.state;
  const runA = replay(branchA, deployment, forkState);
  const runB = replay(branchB, deployment, forkState);

  const step = (s) => ({
    height: s.height,
    blockHash: s.blockHash,
    eventRoot: s.eventRoot,
    stateRoot: s.stateRoot,
    events: s.events,
    invalidEvents: s.invalidEvents,
  });

  return {
    name: 'reorg-at-fork-height',
    description:
      'Blocks 3001 through 3005 are applied, then the chain rolls back to 3003 and an alternate 3004 and 3005 are applied. The two branches end at different state roots, and the fork height root is shared.',
    deployment: 'regtest',
    forkHeight: 3003,
    commonBlocks: common,
    commonSteps: commonRun.steps.map(step),
    forkStateRoot: commonRun.steps[commonRun.steps.length - 1].stateRoot,
    branchA: { blocks: branchA, steps: runA.steps.map(step), finalCounters: runA.state.counters, finalArtifacts: summarizeArtifacts(runA.state, 3005) },
    branchB: { blocks: branchB, steps: runB.steps.map(step), finalCounters: runB.state.counters, finalArtifacts: summarizeArtifacts(runB.state, 3005) },
    rootsDiffer: runA.steps[runA.steps.length - 1].stateRoot !== runB.steps[runB.steps.length - 1].stateRoot,
  };
})();

// ---------------------------------------------------------------------------
// Marker round trips.
// ---------------------------------------------------------------------------
const markerRoundTrips = [];
function roundTrip(name, marker) {
  const payload = encodeMarker(marker);
  const script = buildScriptPubKey(payload);
  const decoded = decodeScriptPubKey(script);
  if (!decoded || !decoded.ok) throw new Error(`round trip failed for ${name}`);
  markerRoundTrips.push({
    name,
    marker,
    payloadHex: payload.toString('hex'),
    scriptHex: script.toString('hex'),
    scriptBytes: script.length,
    decoded: decoded.marker,
  });
}

roundTrip('seed-carrier-0', { op: 'SEED', salt: '00000000000000000000000000000000', flags: 0, carrierVout: 0 });
roundTrip('seed-carrier-1', { op: 'SEED', salt: saltFor('rt-a'), flags: 0, carrierVout: 1 });
roundTrip('seed-carrier-255', { op: 'SEED', salt: 'ffffffffffffffffffffffffffffffff', flags: 0, carrierVout: 255 });
for (let count = 1; count <= MAX_KEEP_ENTRIES; count += 1) {
  roundTrip(
    `keep-${count}-entries`,
    { op: 'KEEP', entries: Array.from({ length: count }, (_, i) => ({ inputIndex: i, vout: (i * 3 + 1) % 256 })) },
  );
}
roundTrip('keep-max-indexes', { op: 'KEEP', entries: [{ inputIndex: 255, vout: 255 }] });

// ---------------------------------------------------------------------------
// Marker decode failures, one per reason that the codec can raise on its own.
// ---------------------------------------------------------------------------
const markerFailures = [];
function failure(name, scriptHex, expectedReason) {
  const decoded = decodeScriptPubKey(scriptHex);
  if (decoded === null) throw new Error(`${name} was not detected as a marker candidate`);
  if (decoded.ok) throw new Error(`${name} unexpectedly decoded`);
  if (decoded.reason !== expectedReason) throw new Error(`${name} gave ${decoded.reason}, expected ${expectedReason}`);
  markerFailures.push({ name, scriptHex, reason: decoded.reason, detail: decoded.detail });
}

const seedPayloadHex = encodeMarker(seedMarker('failure-base', 1)).toString('hex');
failure('seed-flags-not-zero', scriptFromPayload(seedPayloadWithFlags(saltFor('failure-base'), 0x80, 1)), 'SEED_BAD_GRAMMAR');
failure('seed-payload-short', scriptFromPayload(rawPayload({ op: 0x01, body: Buffer.alloc(17) })), 'SEED_BAD_GRAMMAR');
failure('seed-payload-long', scriptFromPayload(rawPayload({ op: 0x01, body: Buffer.alloc(19) })), 'SEED_BAD_GRAMMAR');
failure(
  'seed-push-not-minimal',
  Buffer.concat([Buffer.from([0x6a, 0x4c, seedPayloadHex.length / 2]), Buffer.from(seedPayloadHex, 'hex')]).toString('hex'),
  'SEED_BAD_GRAMMAR',
);
failure(
  'seed-trailing-opcode',
  Buffer.concat([buildScriptPubKey(Buffer.from(seedPayloadHex, 'hex')), Buffer.from([0x51])]).toString('hex'),
  'SEED_BAD_GRAMMAR',
);
failure('keep-count-zero', scriptFromPayload(keepPayloadRaw(0, [])), 'KEEP_BAD_GRAMMAR');
failure('keep-count-nine', scriptFromPayload(keepPayloadRaw(9, new Array(18).fill(1))), 'KEEP_BAD_GRAMMAR');
failure('keep-length-mismatch', scriptFromPayload(keepPayloadRaw(2, [0, 1])), 'KEEP_BAD_GRAMMAR');
failure('keep-duplicate-input', scriptFromPayload(keepPayloadRaw(2, [0, 1, 0, 2])), 'KEEP_DUPLICATE_INPUT');
failure('marker-unknown-op', scriptFromPayload(rawPayload({ op: 0x03, body: Buffer.alloc(4) })), 'MARKER_UNKNOWN_OP');
failure('marker-no-op-byte', scriptFromPayload('50544e4101'), 'MARKER_UNKNOWN_OP');
failure('marker-unknown-version', scriptFromPayload(rawPayload({ version: 0x02, op: 0x01, body: Buffer.alloc(18) })), 'MARKER_UNKNOWN_VERSION');
failure('marker-no-version-byte', scriptFromPayload('50544e41'), 'MARKER_UNKNOWN_VERSION');
failure(
  'marker-too-large',
  Buffer.concat([
    Buffer.from([0x6a, 0x4c, 82]),
    Buffer.from('50544e410101', 'hex'),
    Buffer.alloc(76, 0x11),
  ]).toString('hex'),
  'MARKER_TOO_LARGE',
);

// Scripts that are not markers at all.
const nonMarkers = [
  { name: 'p2wpkh-output', scriptHex: p2wpkhFor('non-marker') },
  { name: 'op-return-other-protocol', scriptHex: opReturnOut().scriptPubKey },
  { name: 'bare-op-return', scriptHex: '6a' },
  { name: 'op-return-short-magic', scriptHex: '6a0350544e' },
];
for (const entry of nonMarkers) {
  if (decodeScriptPubKey(entry.scriptHex) !== null) throw new Error(`${entry.name} was detected as a marker`);
}

// ---------------------------------------------------------------------------
// Derivations.
// ---------------------------------------------------------------------------
const derivationTxid = txidFor('derivation-reveal');
const derivations = {
  commitCommitment: [
    {
      name: 'zero-key-zero-salt',
      claimantXOnly: '00'.repeat(32),
      salt: '00'.repeat(16),
      expected: commitCommitment('00'.repeat(32), '00'.repeat(16)).toString('hex'),
    },
    {
      name: 'derived-key-derived-salt',
      claimantXOnly: xonlyFor('derivation'),
      salt: saltFor('derivation'),
      expected: commitCommitment(xonlyFor('derivation'), saltFor('derivation')).toString('hex'),
    },
    {
      name: 'salt-binds-to-key',
      claimantXOnly: xonlyFor('derivation-other'),
      salt: saltFor('derivation'),
      expected: commitCommitment(xonlyFor('derivation-other'), saltFor('derivation')).toString('hex'),
    },
  ],
  artifactId: [
    {
      name: 'vout-0',
      revealTxidDisplay: derivationTxid,
      revealTxidWire: txidToWire(derivationTxid).toString('hex'),
      carrierVout: 0,
      expected: artifactId(derivationTxid, 0),
    },
    {
      name: 'vout-1',
      revealTxidDisplay: derivationTxid,
      revealTxidWire: txidToWire(derivationTxid).toString('hex'),
      carrierVout: 1,
      expected: artifactId(derivationTxid, 1),
    },
    {
      name: 'vout-255',
      revealTxidDisplay: derivationTxid,
      revealTxidWire: txidToWire(derivationTxid).toString('hex'),
      carrierVout: 255,
      expected: artifactId(derivationTxid, 255),
    },
    {
      name: 'byte-order-matters',
      revealTxidDisplay: txidToWire(derivationTxid).toString('hex'),
      revealTxidWire: derivationTxid,
      carrierVout: 0,
      expected: artifactId(txidToWire(derivationTxid).toString('hex'), 0),
    },
  ],
  commitLeaf: [
    {
      name: 'derived',
      claimantXOnly: xonlyFor('leaf'),
      commitment: commitCommitment(xonlyFor('leaf'), saltFor('leaf')).toString('hex'),
      scriptHex: buildLegacyCommitLeafScript(xonlyFor('leaf'), commitCommitment(xonlyFor('leaf'), saltFor('leaf'))).toString('hex'),
      scriptBytes: 70,
    },
    {
      name: 'all-zero',
      claimantXOnly: '00'.repeat(32),
      commitment: '00'.repeat(32),
      scriptHex: buildLegacyCommitLeafScript('00'.repeat(32), '00'.repeat(32)).toString('hex'),
      scriptBytes: 70,
    },
  ],
  attestation: [
    {
      name: 'derived',
      artifactId: artifactId(derivationTxid, 1),
      blockHash: '00'.repeat(32),
      message: attestationMessage(artifactId(derivationTxid, 1), '00'.repeat(32)),
    },
  ],
};

// ---------------------------------------------------------------------------
// Tier ladder samples, including both sides of every threshold.
// ---------------------------------------------------------------------------
const tierSamples = [];
const depths = new Set([0, 1]);
for (const tier of TIERS) {
  if (tier.threshold === null) continue;
  depths.add(tier.threshold - 1);
  depths.add(tier.threshold);
  depths.add(tier.threshold + 1);
}
depths.add(500000);
for (const depth of [...depths].sort((a, b) => a - b)) {
  const tier = tierFor(depth);
  const next = nextTier(depth);
  tierSamples.push({
    depth,
    tierIndex: tier.index,
    tierName: tier.name,
    nextTierIndex: next === null ? null : next.index,
    blocksToNextTier: blocksToNextTier(depth),
  });
}

// ---------------------------------------------------------------------------
// Reason coverage, checked here so a missing code fails generation.
// ---------------------------------------------------------------------------
const reasonCoverage = {};
for (const scen of scenarios) {
  for (const step of scen.steps) {
    for (const invalid of step.invalidEvents) {
      (reasonCoverage[invalid.reason] ??= []).push(`${scen.name}#${invalid.txid.slice(0, 8)}`);
    }
  }
}
for (const f of markerFailures) {
  (reasonCoverage[f.reason] ??= []).push(`markerFailures#${f.name}`);
}

const golden = {
  protocol: 'PTNA',
  markerVersion: 1,
  specSha256: specSha256(readSpecBytes()),
  generator: 'scripts/generate-vectors.mjs',
  note: 'Every value in this file is derived from the built library. Regenerating on any machine produces identical bytes.',
  constants: {
    COMMIT_MIN_AGE,
    WINDOW_LENGTH,
    GRACE_LENGTH,
    MIN_CARRIER_FOUNDING,
    MIN_CARRIER_OPEN,
    MIN_SUCCESSOR,
    MAX_KEEP_ENTRIES,
  },
  deployments: { regtest: deployment },
  derivations,
  markerRoundTrips,
  markerFailures,
  nonMarkers,
  tierSamples,
  scenarios,
  reorg,
  reasonCoverage: Object.fromEntries(Object.keys(reasonCoverage).sort().map((k) => [k, reasonCoverage[k]])),
};

const goldenJson = `${JSON.stringify(golden, null, 2)}\n`;
writeFileSync(fileURLToPath(new URL('golden.json', VECTORS_DIR)), goldenJson, 'utf8');

const manifest = {
  fixture: 'golden.json',
  fixtureSha256: createHash('sha256').update(goldenJson, 'utf8').digest('hex'),
  specSha256: golden.specSha256,
  counts: {
    derivations: Object.values(derivations).reduce((n, list) => n + list.length, 0),
    markerRoundTrips: markerRoundTrips.length,
    markerFailures: markerFailures.length,
    nonMarkers: nonMarkers.length,
    tierSamples: tierSamples.length,
    scenarios: scenarios.length,
    scenarioBlocks: scenarios.reduce((n, s) => n + s.blocks.length, 0),
    reorgBranches: 2,
    reasonCodesCovered: Object.keys(golden.reasonCoverage).length,
  },
};
writeFileSync(fileURLToPath(new URL('manifest.json', VECTORS_DIR)), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// A runnable example for `patina replay`, taken from the multi block scenario so
// that it can never drift from the fixture.
const example = {
  deployment: 'regtest',
  blocks: scenarios.find((s) => s.name === 'multi-block-replay').blocks,
};
mkdirSync(fileURLToPath(EXAMPLES_DIR), { recursive: true });
writeFileSync(fileURLToPath(new URL('blocks.json', EXAMPLES_DIR)), `${JSON.stringify(example, null, 2)}\n`, 'utf8');

process.stdout.write('vectors written\n');
for (const [key, value] of Object.entries(manifest.counts)) process.stdout.write(`  ${key.padEnd(20)} ${value}\n`);
process.stdout.write(`  fixture sha256       ${manifest.fixtureSha256}\n`);
process.stdout.write(`  spec sha256          ${manifest.specSha256}\n`);
if (!reorg.rootsDiffer) {
  process.stdout.write('reorg branches produced the same state root, which defeats the purpose of the case\n');
  process.exitCode = 1;
}
