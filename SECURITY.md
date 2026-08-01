# Security policy

## Reporting a vulnerability

Report privately. Do not open a public issue, a pull request, or a discussion
thread for anything that could be exploited before a fix ships.

Use GitHub private vulnerability reporting on `bitcoinuniverse/patina`, under the
Security tab, Report a vulnerability. If that is unavailable, email
`bitcoinuniversecorp@gmail.com` with `PATINA security` in the subject.

Include what you have:

- what breaks, and the smallest input that breaks it,
- the commit or published version you tested,
- the specification section you believe is violated, if you know it,
- whether the issue is in the specification, the reference implementation, or
  both.

A reproduction as a failing vector is the most useful thing you can send. The
fixture format is in `vectors/golden.json` and the generator is
`scripts/generate-vectors.mjs`.

## What we consider a vulnerability

PATINA holds no keys and moves no funds, so the risk here is disagreement rather
than theft. These count:

- two conforming implementations reaching different state roots from the same
  blocks,
- a marker or a transaction shape that the specification does not decide,
- a decoder that accepts a marker the specification rejects, or rejects one it
  accepts,
- a case where the reducer is not a pure function of its inputs,
- a way to make an artifact change after it became a relic,
- anything that lets one party force another party's artifact into a state the
  specification does not allow,
- a mainnet deployment being constructed without an explicit authorization.

These do not count on their own, though we still want to hear about them:

- a wallet losing an artifact by spending its carrier badly. The default rule is
  documented and dull on purpose.
- fee estimation, coin selection, or anything else outside the protocol.
- an indexer being slow.

## Response

We will acknowledge a report within three working days and tell you whether we
can reproduce it. If it is valid we will agree a disclosure date with you before
publishing. We will credit you unless you ask us not to.

Do not run tests against other people's infrastructure. Regtest and signet exist
for this.

## Scope

This policy covers the `bitcoinuniverse/patina` repository and the published
`@bitcoinuniverse/patina` package. Issues in the indexer or in the application
belong to their own repositories, but if you are unsure, send it here and we will
route it.
