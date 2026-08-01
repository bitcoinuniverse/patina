# PATINA

PATINA records how long a value carrying Bitcoin output stays unspent.

An artifact is created by a commit and a reveal. It then rests on a carrier
output. Every confirmed spend of that carrier closes a stretch of time, called a
ring, and either moves the artifact to a successor output or ends its life.
Depth is the number of blocks the current carrier has survived. Tier is a name
for a depth band, from Raw up to Elder at 210000 blocks.

PATINA changes nothing about Bitcoin. It needs no soft fork, holds no keys, and
moves no funds. Every PATINA fact is a deterministic function of confirmed blocks
and one deployment record, so two independent implementations either agree byte
for byte or one of them has a bug.

This repository is the canonical source. It holds the normative specification,
the reference implementation, and the conformance vectors that other
implementations are checked against.

- Specification: [patina-protocol.md](patina-protocol.md)
- Package: `@bitcoinuniverse/patina`
- Genesis asset: Firstlight Seals

## What is in here

| Path | What it is |
| --- | --- |
| `patina-protocol.md` | The normative specification. Complete enough to write a parser from. |
| `src/` | TypeScript reference implementation. |
| `cli.mjs` | The `patina` command line tool. |
| `vectors/golden.json` | Conformance fixture. Every case is generated, never hand written. |
| `vectors/manifest.json` | SHA-256 of the fixture and of the specification. |
| `schemas/` | JSON Schema for the deployment record, artifact record, invalid event and share card. |
| `deployments/` | Shipped deployment records. Mainnet is deliberately unset. |
| `examples/blocks.json` | A five block resolved chain you can replay. |
| `docs/deviations.md` | Every place this implementation had to interpret the frozen baseline. |

## Install

```
npm install @bitcoinuniverse/patina
```

Node 22 or newer. No runtime dependencies.

## Use

```js
import {
  applyBlock,
  artifactId,
  buildCommitLeafScript,
  buildCommitLeafScriptForMode,
  buildMarkerScript,
  decodeScriptPubKey,
  initialState,
  loadShippedDeployment,
  replay,
  stateRoot,
} from '@bitcoinuniverse/patina';

const deployment = loadShippedDeployment('regtest');

// New commits use the BIP-110-compatible reduced-data leaf.
const commitLeaf = buildCommitLeafScript(claimantXOnly, commitment);

// A pending job must retain and reuse the exact mode used by its commit.
const pendingLeaf = buildCommitLeafScriptForMode(
  claimantXOnly,
  commitment,
  persistedEnvelopeMode,
);

// Build a SEED marker output.
const script = buildMarkerScript({
  op: 'SEED',
  salt: '000102030405060708090a0b0c0d0e0f',
  flags: 0,
  carrierVout: 1,
});

// Read one back.
const decoded = decodeScriptPubKey(script);
// { ok: true, marker: { op: 'SEED', salt: '0001...', flags: 0, carrierVout: 1 } }

// Replay resolved blocks.
const { steps, state } = replay(blocks, deployment);
console.log(stateRoot(state));
```

`applyBlock(state, block, deployment)` is pure. It reads no clock, opens no
socket, touches no disk and draws no randomness. Feed it the same inputs and it
returns the same outputs on every machine, forever.

## Command line

```
patina marker encode --op seed --salt <hex32> --carrier-vout <n>
patina marker encode --op keep --entries 0:2,1:3
patina marker decode <scriptPubKeyHex or payloadHex>
patina artifact-id --txid <displayTxid> --vout <n>
patina commit-commitment --xonly <hex64> --salt <hex32>
patina spec-hash
patina vectors verify
patina replay examples/blocks.json
```

Add `--json` to any command for machine readable output.

## How to verify this repository

Nothing here asks to be trusted. Check it:

```
npm ci
npm run spec:check      # UTF-8, LF only, one trailing newline, prints the spec hash
npm run typecheck
npm run build
npm test
npm run vectors:verify  # replays every golden case against the built library
```

`npm run spec:check` prints the SHA-256 of `patina-protocol.md`. That hash
appears in `vectors/manifest.json` and in every record under `deployments/`. If
the three disagree, something has drifted and the tests say so.

`npm run vectors:generate` regenerates the fixture. It is deterministic, so on a
clean tree it produces a byte identical file and `git diff` stays empty.

## How to build a compatible implementation

The specification is the contract, not this code. The shortest correct path:

1. Implement the four derivations in section 4 of the specification. Check them
   against `derivations` in `vectors/golden.json`.
2. Implement the marker codec in section 6, including the failures. Half the
   fixture is negative cases on purpose, because a decoder that accepts too much
   is worse than one that accepts too little.
3. Build resolved block views. In a real indexer most of the work lives here, not
   in the protocol. Every input needs its prevout value, scriptPubKey and
   creation height, plus the witness stack.
4. Implement the reducer in section 11.4 and compare state roots per height
   against the `scenarios` in the fixture.
5. Only then build an API. The reason code strings, the record shapes and the
   snake_case wire names are what other tools depend on.

The conformance bar is simple: for every case in `vectors/golden.json`, produce
the recorded output exactly.

Two things catch most bugs early. First, txid byte order. PATINA digests consume
wire order, which is the reverse of the txid you see in an explorer, and the
fixture has a case that fails loudly if you mix them up. Second, the commit age
boundary, which is 144 and not 143.

## What this repository will not do

- It will not build a mainnet deployment. `loadDeployment` refuses a mainnet
  record unless the caller passes an explicit authorization and the record names
  at least two approvers. The shipped mainnet record has null heights, so it
  fails to load by design.
- It will not verify signatures or taproot commitments. Bitcoin consensus already
  did that before the block existed. See section 3 of the specification.
- It will not read the mempool into state. An unconfirmed transaction has no
  PATINA effect at all.

## License

MIT. See [LICENSE](LICENSE).
