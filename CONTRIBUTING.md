# Contributing

Thanks for looking. This repository is the canonical definition of PATINA, and
other implementations are checked against it, so the bar here is higher than for
ordinary application code.

## Before you start

Read `patina-protocol.md`. Most questions are answered there, and a change that
disagrees with it is a specification change, not a code change.

Open an issue before writing code for anything that touches the specification,
the constants, the reason codes, the canonical encodings, or the vectors. Those
are the parts other people depend on.

## What is frozen

Marker version 1 is frozen. The following cannot change without a new version
byte, and a new version byte is a large decision, not a pull request:

- the marker grammar and its byte layouts,
- the four derivations and their domain tags,
- every constant in section 5 of the specification,
- the eighteen reason codes,
- the canonical event, ring, artifact fact and snapshot encodings,
- the tier ladder.

Bug fixes to the reference implementation that bring it back in line with the
specification are always welcome and are not version changes.

## Local loop

```
npm ci
npm run spec:check
npm run typecheck
npm run build
npm test
npm run vectors:verify
```

All five must pass before you open a pull request. Continuous integration runs
exactly these, on Ubuntu with Node 24.

## If you change the specification

1. Edit `patina-protocol.md`.
2. Run `npm run spec:check`. The file must be UTF-8, LF only, with no tabs, no
   trailing whitespace and exactly one trailing newline.
3. Run `npm run spec:stamp` to write the new hash into every deployment record.
4. Run `npm run vectors:generate`, then `npm test`.
5. Include the new specification hash in your pull request description.

## If you change behaviour

Add a vector. The fixture is generated, never hand edited, so the change goes in
`scripts/generate-vectors.mjs`. Then run `npm run vectors:generate` and commit
the regenerated `vectors/golden.json` and `vectors/manifest.json` alongside your
code.

Generation is deterministic. If running it twice produces two different files,
that is a bug in your change.

## Tests

Use the Node built in runner. A test that would pass against a broken
implementation is not worth writing. Prefer:

- both sides of every boundary, not just the happy side,
- an independent reimplementation of a derivation rather than a comparison
  against the same code path,
- real replays through the reducer rather than hand built state.

## Style

- No dependencies at runtime. Development dependencies are TypeScript and the
  Node type definitions, and that list should stay that way.
- Plain English in comments and prose. Short sentences, active voice, concrete
  facts. Say what the code does and why the rule exists.
- No em dashes anywhere, in code, comments, documentation or copy.
- No version labels in file names, folder names, package names, URLs or exported
  symbols. The numeric version byte inside a marker is protocol data, which is a
  different thing.
- Comments earn their place. Explain the reason behind a rule, not the syntax.

## Commits and pull requests

One concern per pull request. Describe what changed and what you ran. If you
changed the specification or the vectors, say so in the first line of the
description, because those reviews are different.

## License

By contributing you agree that your work is licensed under the MIT License in
`LICENSE`.
