# PATINA protocol specification

Status: frozen at marker version 1.
Protocol id: `PTNA`.
Genesis asset: Firstlight Seals.

This document is normative. An implementation that follows it produces the same
artifacts, the same rings, the same reason codes and the same roots as every
other implementation that follows it, for every Bitcoin block.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as
described in RFC 2119.

## 1. Scope

PATINA records how long a value carrying Bitcoin output stays unspent.

An artifact is created by a two step commit and reveal. It then rests on a
carrier output. Every confirmed spend of that carrier closes a stretch of time,
called a ring, and either moves the artifact to a successor output or ends the
artifact's life. Depth is the number of blocks the current carrier has survived.
Tier is a name for a depth band.

PATINA is an interpretation layer. It never changes Bitcoin consensus, never
requires a soft fork, and never moves funds by itself. Every PATINA fact is a
deterministic function of confirmed blocks and one deployment record.

In scope:

- the marker grammar carried in an OP_RETURN output,
- the commit output shape and the commit reveal,
- artifact creation, movement and termination,
- the deterministic state reducer and its canonical roots,
- the reason code registry for rejected attempts.

Out of scope:

- wallet construction, fee policy and coin selection,
- transport, storage and API framing beyond the canonical shapes named here,
- any notion of price, ownership transfer or off chain trade.

## 2. Notation and primitives

All integers in this document are unsigned unless stated otherwise.

- `u8`, `u16`, `u32`, `u64` name fixed width integers.
- `_le` marks little endian byte order.
- `||` is byte concatenation.
- `SHA256(x)` is a single SHA-256 pass over `x`. PATINA never double hashes.
- ASCII means the byte values of the printable characters, with no terminator.
- Hex in this document and in every PATINA identifier is lowercase.

Two byte orders for transaction ids are in use and they must not be mixed:

- Display order is the order printed by Bitcoin Core, block explorers and the
  JSON views in this specification. It is the reverse of wire order.
- Wire order, also called internal order, is the order the bytes appear inside a
  transaction. PATINA digests always consume wire order.

`txid_wire(t)` converts a display order txid to its 32 wire order bytes by
reversing them. `txid_display(b)` reverses back.

Satoshi values are non negative integers below 2 100 000 000 000 000. That is
below 2^53, so a JSON number carries a satoshi value without loss. JSON APIs
still serialize satoshi values as decimal strings so that consumers with 32 bit
integers cannot silently truncate. Heights serialize as JSON numbers.

A domain tag is the ASCII bytes of a tag string placed directly in front of the
message, with no separator and no length prefix. This is not the BIP-340 tagged
hash construction. `SHA256("PTNA/commit" || x)` means exactly the 11 ASCII bytes
`PTNA/commit` followed by `x`.

## 3. Consensus preconditions

PATINA is defined over confirmed blocks only. An implementation MUST treat the
following as already checked by Bitcoin consensus and MUST NOT recheck them:

- every input in a confirmed block spends an existing unspent output,
- a taproot script path spend carries a control block that commits the revealed
  leaf script to the output key,
- signature validity, locktime and sequence rules.

The practical consequence is that PATINA needs no elliptic curve arithmetic. A
revealed tapscript leaf found in a confirmed block is a leaf that consensus has
already bound to the output being spent.

An implementation MUST have, for every input of every transaction it evaluates,
the value, the scriptPubKey and the creation height of the output that input
spends, plus the witness stack as it appeared on chain. A block carrying that
information is called a resolved block. The reducer is a pure function of a
resolved block, so an implementation that can produce resolved blocks needs no
other chain access.

## 4. Identity and derivations

All four derivations below are single SHA-256 over a domain tag and fixed width
fields. There are no optional fields and no variable length parts.

### 4.1 Commit commitment

```
commitment = SHA256( "PTNA/commit" || claimant_xonly(32) || salt(16) )
```

`claimant_xonly` is the 32 byte x only public key the claimant will place in the
commit leaf. `salt` is the 16 bytes the SEED payload will carry.

### 4.2 Artifact id

```
artifact_id = SHA256( "PTNA/artifact" || reveal_txid_wire(32) || carrier_vout_le(4) )
```

`reveal_txid_wire` is the txid of the SEED transaction in wire order.
`carrier_vout_le` is the carrier output index as a little endian u32, even though
the marker carries that index in a single byte.

An artifact id is 32 bytes and is displayed as 64 lowercase hex characters. Two
artifacts can never share an id, because a txid and an output index name at most
one output in the chain.

### 4.3 Event leaf

```
event_leaf = SHA256( "PTNA/event" || canonical_event_encoding(86) )
```

Section 15 defines the canonical event encoding.

### 4.4 State root

```
state_root = SHA256( "PTNA/state" || canonical_snapshot_encoding(88) )
```

Section 15 defines the canonical snapshot encoding.

### 4.5 Attestation message

An artifact holder MAY prove control of the carrier address off chain with a
BIP-322 signature over the ASCII string:

```
"PTNA/attest" || artifact_id_hex(64) || block_hash_hex(64)
```

Both hex strings are lowercase. `block_hash_hex` is the display order hash of a
block the signer names, which pins the claim to a point in the chain. The total
message length is 139 characters. Attestation is off chain and never affects
artifact state.

## 5. Constants

These values are frozen for marker version 1.

| Name | Value | Meaning |
| --- | --- | --- |
| `MARKER_MAGIC` | `50 54 4e 41` | ASCII `PTNA` |
| `MARKER_VERSION` | `0x01` | version byte carried in every marker |
| `OP_SEED` | `0x01` | marker op that creates an artifact |
| `OP_KEEP` | `0x02` | marker op that routes carriers |
| `COMMIT_MIN_AGE` | 144 | blocks a commit output must age before a reveal |
| `WINDOW_LENGTH` | 4032 | length of the founding commit window in blocks |
| `GRACE_LENGTH` | 4032 | reveal grace after the window closes, in blocks |
| `MIN_CARRIER_FOUNDING` | 100000 | minimum carrier value for a founding artifact, in satoshis |
| `MIN_CARRIER_OPEN` | 10000 | minimum carrier value for an open era artifact, in satoshis |
| `MIN_SUCCESSOR` | 10000 | minimum value for an output to be an eligible successor, in satoshis |
| `MAX_KEEP_ENTRIES` | 8 | most entries a KEEP marker may carry |
| `CONFIRMATIONS_FINAL` | 6 | confirmations after which a fact is reported final |
| `MAX_SCRIPT_PUBKEY_BYTES` | 83 | ceiling on a marker scriptPubKey |
| `MAX_MARKER_PAYLOAD_BYTES` | 80 | ceiling on a marker push payload |
| `SALT_BYTES` | 16 | salt length in a SEED payload |
| `COMMIT_LEAF_BYTES` | 70 | length of the legacy commit leaf script |
| `REDUCED_DATA_COMMIT_LEAF_BYTES` | 68 | length of the reduced-data commit leaf script |

Tier ladder. Tier is the highest index whose threshold is not greater than the
depth. Tier 0 has no threshold and applies to every depth below 1008.

| Index | Name | Threshold in blocks |
| --- | --- | --- |
| 0 | Raw | none |
| 1 | Sheen | 1008 |
| 2 | Cast | 4032 |
| 3 | Verdigris | 12960 |
| 4 | Umber | 26280 |
| 5 | Bronze | 52560 |
| 6 | Oxide | 105120 |
| 7 | Elder | 210000 |

## 6. Marker grammar

### 6.1 Script shape

A PATINA marker is an output whose scriptPubKey is exactly:

```
OP_RETURN PUSH(n) [ "PTNA" | version(1) | op(1) | payload ]
```

Rules:

1. Byte 0 MUST be `0x6a`, OP_RETURN.
2. Exactly one data push MUST follow, and it MUST be minimal. For a payload of
   1 to 75 bytes the push opcode is the payload length itself. For a payload of
   76 to 80 bytes the push opcode is `0x4c` OP_PUSHDATA1 followed by the length
   byte. `OP_PUSHDATA1` for a payload of 75 bytes or fewer is not minimal.
   `OP_PUSHDATA2` and `OP_PUSHDATA4` are never minimal at these sizes.
3. No opcode and no byte may follow the push.
4. The whole scriptPubKey MUST be at most `MAX_SCRIPT_PUBKEY_BYTES` bytes.

### 6.2 Marker selection

An output is a marker candidate when its scriptPubKey starts with OP_RETURN and
the first data push that can be read from it starts with the four magic bytes.
Candidate detection deliberately ignores minimality, so a malformed marker still
occupies the marker slot of its transaction and cannot be hidden behind a second
well formed one.

- The marker of a transaction is the candidate with the lowest output index.
- If a transaction has more than one candidate, the marker is void. The
  implementation MUST record `VOID_DUPLICATE_MARKER` and MUST then treat the
  transaction as carrying no marker, which means the default rule of section 10
  applies to every carrier the transaction spends.
- A transaction with no candidate carries no marker.

### 6.3 Decode ladder

A candidate payload is decoded in this fixed order. The first failure decides
the reason code.

1. Script larger than `MAX_SCRIPT_PUBKEY_BYTES`: `MARKER_TOO_LARGE`.
2. Payload larger than `MAX_MARKER_PAYLOAD_BYTES`: `MARKER_TOO_LARGE`. A decoder
   handed a bare payload rather than a script applies this bound directly.
3. Remaining script grammar per section 6.1, that is minimality and no trailing
   bytes. A failure here reports the code that the payload's version and op bytes
   select, using steps 4 to 6 below. If those bytes are absent or unknown, the
   version or op code applies.
4. Payload shorter than 5 bytes, or byte 4 not equal to `0x01`:
   `MARKER_UNKNOWN_VERSION`.
5. Payload shorter than 6 bytes: `MARKER_UNKNOWN_OP`.
6. Byte 5 not in `{0x01, 0x02}`: `MARKER_UNKNOWN_OP`.
7. Op specific rules of sections 6.4 and 6.5.

Size is checked first because a payload that cannot fit a standard output is not
worth parsing further, and because that keeps the bound on how much a decoder
reads before it decides.

A marker that fails to decode is inert. It creates nothing and routes nothing.
The transaction is then treated as carrying no marker for routing purposes.

### 6.4 SEED, op `0x01`

Payload after the header is 18 bytes:

```
salt(16) | flags(1) | carrier_vout(1)
```

Complete scriptPubKey, 26 bytes:

```
offset  size  value
0       1     6a            OP_RETURN
1       1     18            minimal push of 24 bytes
2       4     50 54 4e 41   "PTNA"
6       1     01            version
7       1     01            op SEED
8      16     ..            salt
24      1     00            flags
25      1     ..            carrier_vout
```

- The push is exactly 24 bytes. Any other length is `SEED_BAD_GRAMMAR`.
- Every bit of `flags` is reserved at version 1 and MUST be zero. A non zero
  flags byte is `SEED_BAD_GRAMMAR`.
- `carrier_vout` is a single byte, so a SEED can only name outputs 0 to 255. A
  transaction whose carrier sits beyond output 255 cannot carry a SEED.

### 6.5 KEEP, op `0x02`

Payload after the header is `1 + 2 * count` bytes:

```
count(1) | count entries of ( input_index(1), vout(1) )
```

Complete scriptPubKey for count `c`, `9 + 2c` bytes:

```
offset  size  value
0       1     6a            OP_RETURN
1       1     ..            minimal push of 7 + 2c bytes
2       4     50 54 4e 41   "PTNA"
6       1     01            version
7       1     02            op KEEP
8       1     ..            count, 1 to 8
9       2c    ..            entries, each input_index then vout
```

- `count` outside 1 to `MAX_KEEP_ENTRIES` is `KEEP_BAD_GRAMMAR`.
- A payload length other than `1 + 2 * count` is `KEEP_BAD_GRAMMAR`.
- The same `input_index` appearing in two entries is `KEEP_DUPLICATE_INPUT`, and
  the whole marker is inert. One input can only be spent once, so a second entry
  naming it can never be an accident of encoding.
- Entries are not required to be sorted. Order carries no meaning.
- `input_index` and `vout` are single bytes, so KEEP can only name inputs and
  outputs 0 to 255.

## 7. Commit output shape

A qualifying commit is a P2TR output whose spend reveals one of two exact
tapscript leaves. New construction uses the reduced-data envelope:

```
<claimant_xonly(32)> OP_CHECKSIG PUSH32(commitment) OP_DROP
```

Exact bytes, 68 total:

```
offset  size  value
0       1     20            push 32 bytes
1      32     ..            claimant_xonly
33      1     ac            OP_CHECKSIG
34      1     20            push 32 bytes
35     32     ..            commitment
67      1     75            OP_DROP
```

`OP_CHECKSIG` leaves its truth value on the stack. The commitment is pushed and
dropped afterwards, leaving the authorization result unchanged and executing
no conditional opcode.

The permanent legacy envelope is:

```
<claimant_xonly(32)> OP_CHECKSIG OP_0 OP_IF PUSH32(commitment) OP_ENDIF
```

Exact bytes, 70 total:

```
offset  size  value
0       1     20            push 32 bytes
1      32     ..            claimant_xonly
33      1     ac            OP_CHECKSIG
34      1     00            OP_0
35      1     63            OP_IF
36      1     20            push 32 bytes
37     32     ..            commitment
69      1     68            OP_ENDIF
```

The legacy `OP_IF` is reached even though its false branch body does not run.
That form therefore cannot be used for a post-activation, non-grandfathered
reveal under active BIP-110 rules. It remains valid PATINA history and remains
parseable so confirmed preactivation commitments and post-expiry operation are
not stranded. Both forms enforce the same claimant signature and bind the same
commitment digest.

An input reveals a commit leaf when all of the following hold:

1. The output it spends has a scriptPubKey of exactly `51 20` followed by 32
   bytes, that is a version 1 taproot output.
2. The witness is a script path spend. Strip a trailing annex, which is any final
   stack item whose first byte is `0x50` when the stack holds at least two items.
   The last remaining item is the control block and the item before it is the
   revealed script.
3. The control block is at least 33 bytes, at most 33 plus 32 times 128 bytes,
   and its length minus 33 is a multiple of 32.
4. The revealed script matches either the 68 byte reduced-data shape or the 70
   byte legacy shape above exactly.

An implementation MUST NOT accept a leaf that merely contains the shape as a
prefix or a suffix. The length check is part of the match.

A revealed commit leaf qualifies for a given SEED when

```
commitment == SHA256( "PTNA/commit" || claimant_xonly || salt )
```

where `claimant_xonly` and `commitment` come from that same leaf and `salt` comes
from the SEED payload. Binding the key into the commitment stops a third party
from reusing an observed salt with a different key.

## 8. SEED validity

A transaction whose marker decodes as SEED is evaluated in this fixed order. The
first failure decides the reason code, the transaction creates nothing, and an
invalid event is recorded.

1. `carrier_vout` MUST be less than the number of outputs, else
   `SEED_CARRIER_OUT_OF_RANGE`.
2. The carrier output MUST NOT start with OP_RETURN, else
   `SEED_CARRIER_IS_OPRETURN`. A SEED that names its own marker output is
   therefore invalid.
3. At least one input MUST reveal a commit leaf per section 7, else
   `SEED_NO_COMMIT_INPUT`.
4. At least one revealed commit leaf MUST qualify for this salt, else
   `SEED_COMMITMENT_MISMATCH`.
5. Exactly one revealed commit leaf may qualify. Two or more qualifying leaves
   is `SEED_NO_COMMIT_INPUT`, which in this registry means "not exactly one
   qualifying commit input".
6. `reveal_height - commit_output_height` MUST be at least `COMMIT_MIN_AGE`,
   else `SEED_COMMIT_TOO_YOUNG`. `commit_output_height` is the height of the
   block that created the output the qualifying input spends. A commit created
   at height 1000 is first spendable as a valid PATINA commit at height 1144.
   A reveal at height 1143 fails.
7. Founding is decided, see section 8.1. It selects the carrier minimum.
8. The carrier value MUST be at least the selected minimum, else
   `SEED_CARRIER_BELOW_MIN`.

On success the artifact is created with:

- `artifact_id` from section 4.2,
- `birth_txid` the SEED txid, `birth_height` the reveal height,
- `birth_vout` and the carrier equal to `carrier_vout`,
- `endowment_sats` the carrier value at birth, which never changes,
- `founding` from step 7,
- `status` ALIVE, empty ring list.

### 8.1 Founding classification

A deployment names `h_open`, `h_close` and `grace_end`, where
`h_close = h_open + WINDOW_LENGTH` and `grace_end = h_close + GRACE_LENGTH`.

An artifact is founding when both hold:

```
h_open <= commit_output_height < h_close
reveal_height <= grace_end
```

Note what each edge means:

- A commit created exactly at `h_open` is inside the window.
- A commit created exactly at `h_close` is outside the window. The bound is
  exclusive.
- A reveal exactly at `grace_end` is inside the grace period.
- A reveal at `grace_end + 1` is outside it. The artifact is still created if
  every other check passes, but it is not founding, and it is therefore held to
  `MIN_CARRIER_OPEN` rather than `MIN_CARRIER_FOUNDING`.

SEED validity does not otherwise depend on the window. A SEED before `h_open`
and a SEED long after `grace_end` are both valid open era artifacts. Only the
founding flag and the carrier minimum move with the window.

### 8.2 Coinbase

A coinbase transaction is skipped entirely. It cannot spend a commit output and
it cannot spend a carrier, so evaluating it could only produce noise.

## 9. KEEP rules

A KEEP marker routes artifacts on carriers that its own transaction spends. It
never creates and never destroys.

Let `carrier_inputs` be the set of input indexes of the transaction that spend an
output currently holding at least one live artifact.

1. If `carrier_inputs` is empty, the whole marker is inert and
   `KEEP_NO_CARRIER_INPUT` is recorded once.
2. Otherwise each entry is checked independently, in payload order:
   - `input_index` not in `carrier_inputs`: `KEEP_ENTRY_NOT_CARRIER`.
   - `vout` not less than the number of outputs: `KEEP_ENTRY_OUT_OF_RANGE`.
   - the named output starts with OP_RETURN: `KEEP_ENTRY_IS_OPRETURN`.
   - the named output holds less than `MIN_SUCCESSOR` satoshis:
     `KEEP_ENTRY_BELOW_MIN`.
3. A failing entry is void. It is recorded as an invalid event and it does not
   void the other entries. The carrier it named, if it is a carrier at all,
   falls through to the default rule of section 10.
4. A passing entry routes every artifact resting on that carrier to the named
   output.

Two entries MAY name the same output. The artifacts on both carriers then land
on one output and become a single bundle.

`KEEP_BAD_GRAMMAR` and `KEEP_DUPLICATE_INPUT` are decode failures, not entry
failures. They make the whole marker inert, so every spent carrier falls to the
default rule.

## 10. Default rule

When a carrier is spent and no valid KEEP entry names its input, the successor is
chosen by the default rule:

> the lowest index output that does not start with OP_RETURN and holds at least
> `MIN_SUCCESSOR` satoshis.

If no output qualifies, there is no successor and the artifact becomes a relic.

The rule looks only at the spending transaction. It does not consider addresses,
does not track change, and does not prefer larger outputs. It is deliberately
dull so that a wallet with no PATINA support still moves an artifact somewhere
predictable.

## 11. State model and state machine

### 11.1 Records

An artifact record:

```
{
  artifact_id, birth_txid, birth_height, birth_vout,
  endowment_sats, founding,
  status: ALIVE | RELIC,
  carrier: { txid, vout, height, value } | null,
  rings: Ring[]
}
```

A ring record:

```
{
  index, start_height, end_height, depth, carried_value,
  successor_txid | null, successor_vout | null, relic
}
```

A snapshot:

```
{
  height, block_hash,
  artifacts: map from artifact_id to artifact,
  carriers: map from "txid:vout" to a sorted list of artifact ids,
  counters
}
```

Counters:

```
{
  artifacts_alive, artifacts_relic, founding_total,
  rings_total, deepest_live_depth, endowment_total_sats
}
```

`deepest_live_depth` is the largest depth held by any live artifact at the
snapshot height. `endowment_total_sats` is the sum of `endowment_sats` over every
artifact ever created, relics included, because an endowment is a birth fact that
never changes.

### 11.2 Serialization

The field names above are the wire names. Every implementation MUST serialize
with exactly these names, in snake_case, whatever it calls them internally.

- Satoshi values serialize as decimal strings, with no leading zero and no sign.
  `"100000"`, never `100000` and never `"0x186a0"`.
- Heights, output indexes, input indexes, ring indexes and counters other than
  `endowment_total_sats` serialize as JSON numbers.
- Txids, block hashes, artifact ids and any other digest serialize as lowercase
  hex strings with no prefix.
- An absent txid or output index serializes as `null`, never as an empty string
  and never as `-1`.

The reference implementation keeps camelCase names in memory because that is what
its host language expects, and converts at the boundary. That is allowed. The
names that leave the process are the ones this section fixes.

### 11.3 State machine

An artifact has two states.

```
            SEED accepted
   (none) -----------------> ALIVE
                              |  \
        carrier spent with a  |   \  carrier spent with no
        successor, ring closed|    \ eligible successor
                              |     \
                              +------> RELIC
                            (stays ALIVE)
```

- ALIVE to ALIVE: the carrier is spent, a ring closes, and the artifact rests on
  the successor output. This may happen any number of times.
- ALIVE to RELIC: the carrier is spent and no successor is eligible. A ring
  closes with `relic: true`, the carrier becomes null, and the artifact never
  changes again.
- RELIC is terminal. There is no path out of it.

### 11.4 Block procedure

For each block, in transaction order, skipping the coinbase:

1. Find the marker per section 6.2 and decode it per section 6.3.
2. Collect `carrier_inputs`, the inputs that spend a live carrier, in input index
   order.
3. If the marker is KEEP, build the routing map per section 9.
4. For each spent carrier in input index order, and for each artifact on it in
   artifact id order, close a ring per section 12 and either move the artifact or
   make it a relic.
5. If the marker is SEED, validate it per section 8 and create the artifact.

Step 4 runs before step 5. A SEED carrier is an output of the same transaction,
so it can never be a carrier that transaction spends, but fixing the order keeps
event emission deterministic when one transaction both moves and creates.

A transaction may both spend carriers and carry a SEED marker. In that case there
is no KEEP marker, because a transaction has exactly one marker, so every spent
carrier follows the default rule. If the default rule picks the same output the
SEED names as its carrier, the moved artifacts and the new artifact share one
carrier and become a bundle.

State is updated as the block is walked, so a transaction may spend a carrier
that an earlier transaction in the same block created.

## 12. Ring semantics

A ring is a closed stretch of survival. Rings are appended, never edited.

When a carrier created at height `c` is spent at height `s`, every artifact
resting on it appends:

```
index          = number of rings the artifact already has
start_height   = c
end_height     = s
depth          = s - c
carried_value  = value of the carrier that was spent
successor_txid = the spending txid, or null when there is no successor
successor_vout = the successor output index, or null
relic          = true when there is no successor
```

`depth` is a block count, not a time. A carrier created at height 100 and spent
at height 101 has depth 1.

The stretch an artifact is living through right now is not a ring. It becomes one
only when the carrier is spent. An implementation MUST NOT write a ring for a
live artifact.

### 12.1 Bundles

More than one artifact may rest on one carrier. That set is a bundle.

A KEEP entry names an input, not an artifact. One input carries one routing
decision. Every artifact on that carrier therefore follows the same decision, and
a bundle cannot be split by a single transaction.

To split a bundle, spend the carrier once, which moves the whole bundle to a new
carrier, then spend that carrier again to move the whole bundle again. There is
no transaction shape that sends artifact A to output 0 and artifact B to output 1
when A and B share a carrier. This is a deliberate consequence of routing by
input rather than by artifact, and it keeps the routing map small enough to fit
in an OP_RETURN.

Bundles form when two carriers route to the same output, or when a SEED names an
output that a spent carrier also routes to.

## 13. Depth and tiers

For an artifact at height `H`:

```
depth(ALIVE) = max(0, H - carrier.height)
depth(RELIC) = depth of the final ring
```

Depth is never stored per block. It is recomputed from the carrier height at
query time, so a replaying node and an API server cannot disagree.

Tier is the highest ladder index whose threshold is not greater than the depth.
The next tier is the ladder entry above the held tier, or none at Elder. Blocks
to next tier is the next threshold minus the depth, floored at zero, or none at
Elder.

Worked examples:

| Depth | Tier | Name | Next tier | Blocks to next |
| --- | --- | --- | --- | --- |
| 0 | 0 | Raw | 1 | 1008 |
| 1007 | 0 | Raw | 1 | 1 |
| 1008 | 1 | Sheen | 2 | 3024 |
| 4031 | 1 | Sheen | 2 | 1 |
| 4032 | 2 | Cast | 3 | 8928 |
| 209999 | 6 | Oxide | 7 | 1 |
| 210000 | 7 | Elder | none | none |

## 14. Reason code registry

Eighteen codes, frozen. An implementation MUST use these exact strings and MUST
NOT invent others. Free text detail may accompany a code and MUST NOT be parsed.

| Code | Raised when |
| --- | --- |
| `SEED_BAD_GRAMMAR` | a SEED marker payload is the wrong length, its push is not minimal, the script carries extra bytes, or its flags byte is not zero |
| `SEED_NO_COMMIT_INPUT` | the transaction does not have exactly one qualifying commit input, either none reveal a commit leaf or more than one qualifies |
| `SEED_COMMITMENT_MISMATCH` | a commit leaf was revealed but none commits to this salt and claimant key |
| `SEED_COMMIT_TOO_YOUNG` | the reveal height minus the commit output height is below `COMMIT_MIN_AGE` |
| `SEED_CARRIER_OUT_OF_RANGE` | `carrier_vout` names an output the transaction does not have |
| `SEED_CARRIER_IS_OPRETURN` | `carrier_vout` names an OP_RETURN output |
| `SEED_CARRIER_BELOW_MIN` | the carrier holds less than the applicable carrier minimum |
| `KEEP_BAD_GRAMMAR` | a KEEP marker payload has a bad count, the wrong length, a non minimal push, or extra bytes after the push |
| `KEEP_NO_CARRIER_INPUT` | a KEEP marker appears in a transaction that spends no live carrier |
| `KEEP_ENTRY_NOT_CARRIER` | an entry names an input that does not spend a live carrier |
| `KEEP_ENTRY_OUT_OF_RANGE` | an entry names an output the transaction does not have |
| `KEEP_ENTRY_IS_OPRETURN` | an entry names an OP_RETURN output |
| `KEEP_ENTRY_BELOW_MIN` | an entry names an output holding less than `MIN_SUCCESSOR` |
| `KEEP_DUPLICATE_INPUT` | two entries name the same input index |
| `VOID_DUPLICATE_MARKER` | more than one output of the transaction carries a PTNA payload |
| `MARKER_UNKNOWN_OP` | the op byte is absent or is not `0x01` or `0x02` |
| `MARKER_UNKNOWN_VERSION` | the version byte is absent or is not `0x01` |
| `MARKER_TOO_LARGE` | the marker scriptPubKey exceeds 83 bytes or the payload exceeds 80 bytes |

An invalid event record:

```
{ height, tx_index, txid, vout | null, reason, detail }
```

Invalid events are a reporting surface. They never change artifact state. They
are not committed to by the event root, because a node that prunes them must
still reach the same state root as a node that keeps them.

## 15. Canonical encodings and roots

Every encoding here is fixed width. There is nothing to guess.

### 15.1 Event encoding, 86 bytes

```
offset  size  field
0       1     kind: 01 CREATED, 02 MOVED, 03 RELIC
1       4     height_le
5      32     txid_wire
37     32     artifact_id
69      4     vout_le, ffffffff when absent
73      8     value_le
81      4     ring_index_le
85      1     flags: bit 0 is founding, other bits zero
```

Per kind:

- CREATED: `txid` is the SEED txid, `vout` is the carrier, `value` is the
  endowment, `ring_index` is 0, bit 0 of flags is the founding flag.
- MOVED: `txid` is the spending txid, `vout` is the successor, `value` is the
  successor value, `ring_index` is the index of the ring just closed, flags is 0.
- RELIC: `txid` is the spending txid, `vout` is `ffffffff`, `value` is 0,
  `ring_index` is the index of the ring just closed, flags is 0.

Event leaf, event root:

```
event_leaf = SHA256( "PTNA/event" || event_encoding )
event_root = merkle( event leaves in emission order )
```

### 15.2 Merkle rule

```
merkle([])  = 32 zero bytes
merkle([x]) = x
node(l, r)  = SHA256( "PTNA/node" || l || r )
```

Each level pairs items left to right. A level with an odd count promotes its last
item unchanged to the next level. It is never paired with itself, so two
different leaf lists can never collide by duplication.

### 15.3 Ring encoding, 61 bytes

```
offset  size  field
0       4     index_le
4       4     start_height_le
8       4     end_height_le
12      4     depth_le
16      8     carried_value_le
24     32     successor_txid_wire, 32 zero bytes when absent
56      4     successor_vout_le, ffffffff when absent
60      1     relic: 00 or 01
```

### 15.4 Artifact fact, 134 bytes plus rings

```
offset  size  field
0      32     artifact_id
32      1     status: 01 ALIVE, 02 RELIC
33      1     founding: 00 or 01
34      4     birth_height_le
38     32     birth_txid_wire
70      4     birth_vout_le
74      8     endowment_sats_le
82     32     carrier_txid_wire, 32 zero bytes for a relic
114     4     carrier_vout_le, ffffffff for a relic
118     4     carrier_height_le, 0 for a relic
122     8     carrier_value_le, 0 for a relic
130     4     ring_count_le
134     ..    ring encodings in index order
```

```
artifact_leaf = SHA256( "PTNA/leaf" || artifact_fact )
artifacts_root = merkle( artifact leaves sorted by artifact_id ascending )
```

Sorting is over the 32 raw id bytes, which for lowercase hex is the same as
sorting the hex strings.

### 15.5 Snapshot encoding, 88 bytes

```
offset  size  field
0       4     height_le
4       4     artifact_count_le
8      32     artifacts_root
40      8     artifacts_alive_le
48      8     artifacts_relic_le
56      8     founding_total_le
64      8     rings_total_le
72      8     deepest_live_depth_le
80      8     endowment_total_sats_le
```

```
state_root = SHA256( "PTNA/state" || snapshot_encoding )
```

A snapshot at height -1, meaning nothing applied, encodes its height as 0. That
state has no artifacts and is distinguished by its empty artifacts root.

Counters are included in the encoding even though they are derivable. A node with
a counter bug then fails at the root comparison rather than silently serving a
wrong number.

## 16. Reorg behavior

PATINA state is a pure function of the block sequence, so a reorg is handled by
replacing the block sequence and recomputing.

An implementation MUST:

1. Keep enough history to rebuild the snapshot at the fork height. Keeping the
   snapshot at each of the last `CONFIRMATIONS_FINAL` heights is enough for
   ordinary reorgs, and keeping more is cheap.
2. On a reorg, take the snapshot at the last common height, then apply the new
   branch on top of it.
3. Never undo events in place. There is no inverse operation for a ring append,
   and attempting one is how implementations drift apart.

Facts from the discarded branch MUST disappear. Artifacts created on it stop
existing. Rings closed on it stop existing. An implementation MAY keep an audit
log of what it withdrew, but that log MUST NOT contribute to any root.

Two branches of equal length produce different state roots whenever they differ
in any PATINA fact. Comparing state roots at a height is therefore the correct
way for two indexers to check that they agree.

## 17. Mempool and confirmation status

PATINA validity is defined over confirmed blocks only. An unconfirmed
transaction has no PATINA effect at all.

An implementation MAY show a provisional reading of an unconfirmed transaction so
that a user can see what is about to happen. If it does:

- the reading MUST be labelled unconfirmed,
- it MUST NOT be written into the snapshot,
- it MUST NOT contribute to any counter or any root,
- it MUST be dropped when the transaction is replaced or evicted.

Three statuses are defined for reporting:

| Status | Meaning |
| --- | --- |
| `MEMPOOL` | seen but not in a block, no protocol effect |
| `PENDING` | in a block with fewer than `CONFIRMATIONS_FINAL` confirmations |
| `FINAL` | in a block with at least `CONFIRMATIONS_FINAL` confirmations |

A commit output in the mempool does not start ageing. `COMMIT_MIN_AGE` counts
from the height of the block that confirmed the commit output.

## 18. Deployment records

A deployment binds the protocol to one network and one window.

```
{
  network: "regtest" | "signet" | "mainnet",
  protocol_id: "PTNA",
  spec_sha256,
  h_open, h_close, grace_end,
  min_carrier_founding, min_carrier_open, commit_min_age,
  approvers?
}
```

Rules:

1. `protocol_id` MUST be `PTNA`.
2. `spec_sha256` MUST be 64 lowercase hex characters and MUST be the SHA-256 of
   the bytes of this file.
3. `min_carrier_founding`, `min_carrier_open` and `commit_min_age` MUST equal the
   frozen constants. They are carried in the record so that a deployment is self
   describing, not so that they can be tuned.
4. `h_open`, `h_close` and `grace_end` are either all set or all null.
5. When set, `h_close - h_open` MUST equal `WINDOW_LENGTH` and
   `grace_end - h_close` MUST equal `GRACE_LENGTH`.
6. A mainnet record MUST be refused unless the caller passes an explicit mainnet
   authorization and the record names at least two approvers. An implementation
   MUST fail closed here. Refusing to run is the correct outcome.

Regtest and signet records ship with this package. The mainnet record ships with
null heights and no approvers, so loading it always fails until an activation
authorization exists.

Window state at a tip height:

| Condition | State |
| --- | --- |
| heights unset, or tip below `h_open` | `PENDING` |
| `h_open <= tip < h_close` | `OPEN` |
| `h_close <= tip <= grace_end` | `GRACE` |
| `tip > grace_end` | `CLOSED` |

## 19. Invariants

An implementation SHOULD assert these. A violation is a bug in the
implementation, never a property of the chain.

1. An artifact id appears at most once in a snapshot.
2. A live artifact has a carrier. A relic has none.
3. `carriers[key]` holds only live artifact ids, and every live artifact id
   appears in exactly one carrier bucket, at the key naming its own carrier.
4. Ring indexes of an artifact are `0, 1, 2, ...` with no gap.
5. For rings `i` and `i+1` of one artifact, `rings[i].end_height` equals
   `rings[i+1].start_height`.
6. `rings[0].start_height` equals `birth_height`.
7. `depth` of a ring equals `end_height - start_height`, and is never negative.
8. At most one ring per artifact has `relic: true`, and it is the last one.
9. `endowment_sats` never changes after birth.
10. `artifacts_alive + artifacts_relic` equals the artifact count.
11. Applying the same blocks to the same starting snapshot always yields the same
    state root.
12. A snapshot at height `H` computed by replaying from genesis equals the
    snapshot computed by replaying from any earlier snapshot at height `G < H`
    plus blocks `G+1 .. H`.

## 20. Upgrade boundary

The version byte is the only upgrade lever.

- Version 1 is this document. Its grammar, constants, derivations and reason
  codes are frozen.
- A marker whose version byte is not `0x01` decodes to
  `MARKER_UNKNOWN_VERSION`. It is inert, but it still occupies the marker slot of
  its transaction and still counts for the duplicate marker rule. A version 1
  implementation therefore treats a future marker as no marker, which means the
  default rule applies to any carrier that transaction spends.
- The same holds for an unknown op byte inside version 1. `MARKER_UNKNOWN_OP` is
  inert and occupies the slot.
- The SEED flags byte is reserved at version 1 and MUST be zero. It is not a
  forward compatibility channel. A future version that wants flags will carry a
  different version byte.

Every artifact carries the deployment it was created under, through the state its
implementation replayed. A future version MUST NOT retroactively change an
artifact created under version 1. Artifacts and rings are append only history.

## 21. Building a compatible implementation

The shortest correct path:

1. Implement the four derivations of section 4 and check them against
   `vectors/golden.json`.
2. Implement the codec of section 6, including the negative cases. Half the
   vectors are decode failures on purpose.
3. Implement resolved block views. Most of the work in a real indexer lives here,
   not in the protocol.
4. Implement the reducer of section 11.4 and compare state roots per height with
   the replay vectors.
5. Only then build an API. The reason code strings and the record shapes above
   are the contract other tools depend on.

The conformance bar is: for every case in `vectors/golden.json`, produce the
recorded output byte for byte.

## 22. Test vectors

`vectors/golden.json` carries the conformance cases. `vectors/manifest.json`
carries the SHA-256 of the fixture file and the SHA-256 of this specification.
The fixture covers every reason code, both sides of the commit age boundary, both
carrier minimums, the founding window edges, the grace boundary, bundles, relics,
a multi block replay with a state root at each height, and a reorg that produces a
different root on each branch.
