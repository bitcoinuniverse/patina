# Deviations and interpretations

The frozen implementation baseline is authoritative. No value in it was changed.
This file records every place where the baseline was silent and a decision had to
be made, plus every concern worth revisiting at the next version byte.

Each entry says what the baseline gives, what this implementation does, and why.

## 1. The SEED flags byte has no defined semantics

Baseline: the SEED payload is `salt(16) | flags(1) | carrier_vout(1)`. Nothing
says what any bit of `flags` means.

Implementation: at marker version 1 every bit is reserved and must be zero. A non
zero flags byte decodes to `SEED_BAD_GRAMMAR`.

Why: a reserved field that decoders ignore is a field that different decoders
will eventually treat differently. Requiring zero makes the byte useless today
and unambiguous forever. The upgrade lever is the version byte, not this field.

Concern: this closes off in place forward compatibility inside version 1. That is
the intended trade.

## 2. No reason code for more than one qualifying commit input

Baseline: "Exactly one input must reveal a qualifying commit leaf." The registry
has `SEED_NO_COMMIT_INPUT` but nothing for the case where two inputs qualify.

Implementation: `SEED_NO_COMMIT_INPUT` is read as "the transaction does not have
exactly one qualifying commit input". Zero qualifying leaves and two or more both
report it. A transaction that reveals commit leaves where none binds this salt
reports `SEED_COMMITMENT_MISMATCH` instead, so the two failures stay
distinguishable.

Why: the registry is frozen, so inventing a code is not an option. Widening the
meaning of an existing code is the smaller change, and the specification states
the widened meaning explicitly.

## 3. No reason code for a payload that is too short to name a version or an op

Baseline: `MARKER_UNKNOWN_VERSION` and `MARKER_UNKNOWN_OP` describe wrong values,
not absent ones.

Implementation: a payload with no version byte reports
`MARKER_UNKNOWN_VERSION`. A payload with a correct version byte but no op byte
reports `MARKER_UNKNOWN_OP`. Absent is treated as unknown.

Why: a decoder has to return something, and these are the closest fits. The
alternative, treating a short payload as not a marker at all, would let a
transaction hide a real marker behind a four byte stub, because the marker of a
transaction is the lowest indexed candidate.

## 4. SEED validity outside the founding window

Baseline: defines founding as a property of the commit height and the reveal
height. It does not say whether a SEED outside the window is valid at all.

Implementation: a SEED is valid at any height. The window decides only the
founding flag and, through it, which carrier minimum applies. A commit created
before `h_open` and a reveal after `grace_end` both produce ordinary open era
artifacts.

Why: the baseline names an open era minimum, `MIN_CARRIER_OPEN`, which only has a
purpose if minting continues outside the window. Reading the window as a gate on
validity would make that constant dead.

Concern: this allows minting before `h_open`. Anyone doing so pays the open era
minimum and gets `founding: false`, so nothing about the founding set is
affected.

## 5. The marker payload ceiling

Baseline: "Total scriptPubKey stays at or below 83 bytes." It does not state a
payload ceiling.

Implementation: `MAX_MARKER_PAYLOAD_BYTES` is 80. A payload of 1 to 75 bytes uses
a direct push, costing 2 bytes of overhead. A payload of 76 to 80 bytes uses
`OP_PUSHDATA1`, costing 3. Either way 80 is the largest payload that fits inside
83 bytes.

Why: it follows arithmetically from the frozen 83 and the minimal push rule. It
is derived, not chosen. Real markers are 24 bytes for SEED and at most 23 for
KEEP, so the ceiling only matters for rejecting junk.

## 6. Order of the decode ladder

Baseline: lists reason codes but not the order in which checks run. Order is
observable, because it decides which code a doubly broken marker reports.

Implementation: size, then script grammar, then version, then op, then op
specific rules. Section 6.3 of the specification fixes it.

Why: two implementations that check in different orders disagree on the reason
code for markers that are broken twice. The fixture pins several of these.

## 7. Domain tags for Merkle nodes and state leaves

Baseline: freezes four domain tags, `PTNA/commit`, `PTNA/artifact`, `PTNA/event`
and `PTNA/state`, plus `PTNA/attest` for off chain use. A Merkle tree needs an
internal node hash, and a state root over sorted facts needs a leaf hash. Neither
is named.

Implementation: adds `PTNA/node` for internal Merkle nodes and `PTNA/leaf` for
artifact fact leaves. No frozen tag changed meaning.

Why: without distinct tags, a leaf could be presented as an internal node. The
tags are additions, not substitutions.

## 8. Canonical encodings

Baseline: names the event leaf and state root digests but not the byte layouts
they consume.

Implementation: section 15 of the specification defines fixed width encodings for
an event (86 bytes), a ring (61 bytes), an artifact fact (134 bytes plus rings)
and a snapshot (88 bytes), plus the Merkle rule with odd node promotion.

Why: the derivations are useless without them. Fixed width was chosen over any
textual or length prefixed form so that two implementations either agree or fail
loudly.

## 9. Counters were named but not defined

Baseline: `{ artifacts_alive, artifacts_relic, founding_total, rings_total,
deepest_live_depth, endowment_total_sats }` with no definitions.

Implementation:

- `deepest_live_depth` is the largest depth held by any live artifact at the
  snapshot height. Relics do not count, because their depth no longer grows.
- `endowment_total_sats` sums `endowment_sats` over every artifact ever created,
  relics included, because an endowment is a birth fact that never changes.
- The rest are plain counts.

The counters are inside the snapshot encoding, so a node with a counter bug fails
at the root comparison instead of silently serving a wrong number.

## 10. Coinbase transactions

Baseline: silent.

Implementation: the coinbase is skipped entirely.

Why: it cannot spend a commit output and cannot spend a carrier, so evaluating it
could only produce invalid events that mean nothing.

## 11. Field naming between the wire and the reference implementation

Baseline: writes record shapes in snake_case, for example `artifact_id` and
`h_open`, and says satoshi values serialize as decimal strings.

Implementation: snake_case is the wire form, and it is what the shipped
deployment records, the JSON Schemas and the share card use. The TypeScript
library uses camelCase in memory and converts at the boundary in `src/wire.ts`.
The deployment loader accepts either form and prefers the wire form.

Why: the baseline fixes what crosses a process boundary. Inside a TypeScript
process, camelCase is what callers expect, and mixing the two silently is the
failure this split prevents. Section 11.2 of the specification states the rule.

Note: `vectors/golden.json` records the camelCase form, because it is a
conformance fixture for the reducer rather than an API response. Its field names
map one to one onto the wire names.

## 12. Taproot commitments are not verified

Baseline: describes the commit leaf and says it must be revealed in the SEED
transaction's witness through a script path spend.

Implementation: the input's prevout must be a version 1 taproot output and the
witness must carry a control block of a legal length, but the control block is
not checked against the output key.

Why: PATINA is defined over confirmed blocks. Bitcoin consensus already verified
that the control block commits the revealed script to the output key, and
rechecking it would require elliptic curve arithmetic in every implementation for
no gain. Section 3 of the specification states this as a precondition.

Concern: an implementation that evaluates unconfirmed or unvalidated blocks must
not rely on this. That is out of scope by design, and section 17 says so.

## 13. Regtest and signet window heights

Baseline: says regtest and signet deployments ship in the repository but does not
give heights.

Implementation: regtest opens at 200 and signet at 260000. Both derive
`h_close` and `grace_end` from the frozen window and grace lengths.

Why: they had to be some number. Regtest 200 leaves room for a coinbase maturity
warm up. Signet 260000 sits ahead of the chain at the time of writing. Neither is
a protocol value, and both are checked for internal consistency by the loader.

## 14. Invalid events are outside the event root

Baseline: silent on whether rejected attempts contribute to any root.

Implementation: they do not. The event root covers state changing events only.

Why: an indexer that prunes its invalid event log must still reach the same state
root as one that keeps it. Roots commit to state, and a rejected attempt is not
state.
