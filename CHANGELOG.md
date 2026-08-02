# Changelog

This project follows semantic versioning for the package. The protocol itself is
versioned by the marker version byte, which is a separate and much slower moving
number.

## Unreleased

The public site and the documentation were rebuilt as one product. The protocol,
the reference implementation, the vectors and the specification hash are
untouched.

Added:

- Three public pages: how depth works, the tier journey, and Firstlight Seals.
- An interactive artifact on the public site: a cut section whose filled radius
  is its depth, driven by one artifact model that also feeds the tier ladder,
  the passage of blocks and the ring history.
- An anatomy explorer covering the ten parts of an artifact record, a mint
  wizard over the six steps of a claim, and a fee estimator over the transaction
  sizes the protocol requires.
- Reader orientation across the documentation: a badge saying whether a page is
  introductory, operational, normative or generated, its position in its
  section, a reading time, and a summary of what the page leaves you able to do.
- Intent routes on the documentation front page, and links in both directions
  between the public site and the documentation.
- `site/tools/verify.mjs`, `site/tools/check-behaviour.mjs`,
  `site/tools/build-cards.mjs`, `site/tools/serve.mjs` and
  `docs/tools/stamp-meta.mjs`.

Changed:

- One design system across both trees. The two stylesheets declare the same
  token names with the same values, and `site/tools/check-site.mjs` fails if
  they drift apart.
- The brand marks and all eight social cards are generated from the palette
  rather than drawn by hand, so a colour change cannot leave them behind.
- The public navigation collapses into a drawer rather than scrolling sideways,
  and the documentation contents list became an overlay rather than a block that
  pushes the page down.
- `docs/tools/check-contrast.mjs` now covers both stylesheets and the tier ramp,
  280 pairs in total. `docs/tools/check-links.mjs` and
  `site/tools/check-site.mjs` understand that the two trees publish into one.

Fixed:

- The public protocol page stated the SEED checks in the wrong order, defined a
  tier as a threshold rather than a ladder index, implied the SEED flags byte
  carried meaningful bits, and described the mainnet refusal as a construction
  rule rather than a load rule. All four now match the specification.

## 1.1.0

Added:

- BIP-110-compatible PATINA commit leaves using
  `<claimant_xonly> OP_CHECKSIG <commitment> OP_DROP`.
- Permanent dual parsing for reduced-data and historical conditional commit
  leaves.
- Explicit legacy, reduced-data, and persisted-mode builders so a pending
  reveal can never be rebuilt against a different Taproot commitment.
- Conformance tests and updated protocol, operator, and byte-vector
  documentation for both encodings.

Changed:

- New `buildCommitLeafScript` construction uses the reduced-data envelope.
  Existing jobs use `buildCommitLeafScriptForMode` with their stored mode.
- Deployment records are stamped to the updated normative specification hash.

## 1.0.0

First release. Marker version 1 is frozen.

Added:

- `patina-protocol.md`, the normative specification. Scope, primitives,
  consensus preconditions, the four derivations, the frozen constants, the marker
  grammar with exact byte layouts, the commit output shape, SEED validity, KEEP
  rules, the default rule, the state machine, ring semantics, bundles, depth and
  tiers, the reason code registry, canonical encodings and roots, reorg
  behaviour, mempool status, deployment records, invariants and the upgrade
  boundary.
- The reference implementation: constants, hash helpers, marker codec, identity
  derivations, resolved block views, validation, the deterministic reducer,
  depth and tiers, canonical roots, deployment loading, wire serialization and
  the share card builder.
- `cli.mjs`, the `patina` command line tool: marker encode, marker decode,
  artifact-id, commit-commitment, spec-hash, vectors verify and replay.
- `vectors/golden.json` and `vectors/manifest.json`. Twenty replay scenarios, a
  reorg case with two branches from one fork height, marker round trips, marker
  failures, non markers, derivations and tier samples. Every one of the eighteen
  reason codes appears at least once.
- JSON Schema for the deployment record, the artifact record, the invalid event
  and the share card.
- Shipped deployment records for regtest and signet. The mainnet record ships
  with null heights and no approvers, so loading it fails until an activation
  authorization exists.
- Continuous integration on Ubuntu with Node 24: install, specification byte
  check, typecheck, build, tests, vector verification.

Notes:

- The specification hash is stamped into every deployment record. Editing the
  specification without running `npm run spec:stamp` fails the test suite on
  purpose.
- `docs/deviations.md` records every place the frozen baseline left a gap and how
  this implementation closed it.
