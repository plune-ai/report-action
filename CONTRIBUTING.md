# Contributing to plune-ai/report-action

This is a thin composite GitHub Action over [`@plune-ai/cli`](https://github.com/plune-ai/cli). It has
**no import logic of its own**: `action.yml` runs the pinned CLI through
`scripts/run-import.mjs`, which builds the call and reads the CLI's output.

## What's here

- `action.yml`: the input/output contract and one composite step.
- `scripts/run-import.mjs`: builds the CLI call, runs it, parses its output, writes the outputs. No
  dependencies; testable without GitHub.
- `test/`: node tests (`npm test`, node 20+) and `stub-plune.mjs`, a local stand-in for the Plune API.
- `fixtures/`: a JUnit report, one with a missing attachment, and an `allure-results` folder.
- `examples/`: copy-paste consumer workflows.
- `.github/workflows/`: `ci.yml` (unit tests), `smoke.yml` (the action, from the working tree, against
  the stub and the real pinned CLI, no secret), `release.yml` (tag, release and moving major tag).

## Tests

Names start with `GitHub Action · report-action · ` and then what is tested (`parse`, `call`, `script`,
`JUnit`, `Allure`), so a red check says what broke.

```
npm test
```

Smoke runs on every pull request. To try it by hand: `node test/stub-plune.mjs 8791`, then run the CLI
with `PLUNE_API_URL=http://127.0.0.1:8791 PLUNE_TOKEN=x`.

## Public contract

Inputs and outputs are a **public contract**. Changing or removing one is a breaking change: bump the
major tag (`v1` to `v2`) and say so in the release notes. Adding an optional input or an output is not.

## Versioning

Consumers use a moving major tag (`plune-ai/report-action@v1`). Pushing a full tag (`v1.2.0`) runs
`release.yml`, which creates the release and moves `v1`. The action pins an exact `@plune-ai/cli`
version in `cli-version`. Bump it in its own pull request: change the default in `action.yml`, the table
in the README and the version in the tests, and let `smoke.yml` check the new CLI's output lines.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/).

## Security

Report vulnerabilities privately via this repository's **Security** tab, not in public issues.
