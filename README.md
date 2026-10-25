# Plune report: GitHub Action

[![@plune-ai/cli](https://img.shields.io/npm/v/@plune-ai/cli?label=%40plune-ai%2Fcli)](https://www.npmjs.com/package/@plune-ai/cli)
[![license](https://img.shields.io/github/license/plune-ai/report-action)](./LICENSE)

Send the report your test framework already writes (JUnit XML, Playwright JSON or an Allure results
folder) to [Plune](https://plune.ai) in one step. No package to install in your project, no
interactive login: a token from a repository secret is enough.

> **Not on the GitHub Marketplace yet.** Marketplace publication is not done. Use the action by
> repository and tag, `plune-ai/report-action@v1`, as in the examples below.

It is a thin wrapper over [`@plune-ai/cli`](https://github.com/plune-ai/cli): the step runs
`plune run import` from a pinned CLI version and reads the numbers for its outputs from the CLI's own
output. For a PR comment with an eval diff, see [`eval-action`](https://github.com/plune-ai/eval-action);
the two are independent.

## Quick start

1. Create an API token in Plune (Account, API tokens) and save it as the repository secret `PLUNE_TOKEN`.
2. Add one step after your tests. `if: always()` matters: failed tests are the reason to report.

```yaml
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... build and run your tests, writing a report ...
      - uses: plune-ai/report-action@v1
        if: ${{ always() }}
        with:
          token: ${{ secrets.PLUNE_TOKEN }}
          report: reports/junit.xml
```

Secrets are not given to workflows triggered by pull requests from forks; the step then fails with a
message saying the token is empty.

## Examples

Full workflows are in [`examples/`](./examples).

### pytest (JUnit XML)

```yaml
- run: pytest --junitxml=reports/junit.xml -o junit_logging=system-out
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: reports/junit.xml
```

To attach a file to a test, have the test print `[[ATTACHMENT|shots/cart.png]]` on a line of its own
(`print(...)` in pytest). The path is relative to the report's folder; a path that leads outside it
(`..`, absolute, symlink) is refused by the CLI.

### Java: JUnit 5 with Maven or Gradle (Allure results)

Surefire and Gradle write one XML file per test class, and the import takes one file, so for Java use
the Allure results folder: add `allure-junit5` to the build and point `report` at the folder. Tests,
steps and `Allure.addAttachment(...)` files all travel with it.

```yaml
- run: mvn -B test            # or: ./gradlew test
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: target/allure-results   # Gradle: build/allure-results
```

If you do have a single JUnit XML file, print the same `[[ATTACHMENT|path]]` line from the test
(`System.out.println`) and pass the file as `report`.

### Playwright (JSON report)

```yaml
- run: npx playwright test --reporter=json
  env:
    PLAYWRIGHT_JSON_OUTPUT_NAME: playwright-report.json
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: playwright-report.json
```

### Several jobs, one run

Give every job the same `key`, and put the attempt in it, so that **Re-run failed jobs** starts a new
run instead of joining the first attempt's:

```yaml
key: ${{ github.run_id }}-${{ github.run_attempt }}
shared-run: 'true'   # leave the run open for the jobs still reporting
```

`shared-run` goes on every job except the one that ends the run (see
[`examples/shards.yml`](./examples/shards.yml)). Without `key`, each import is its own run.

### Sharded runs that close themselves

When you know how many shards there are, pass `shard: k/N` instead of `shared-run` and a final job.
Each shard reports its results and then tells Plune it is done; the run closes once, when all N shards
have said so, in whatever order and however often a shard is re-run. Needs `@plune-ai/cli` 0.25.0 or
newer, which the default `cli-version` is.

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --reporter=json --shard=${{ matrix.shard }}/4
  - uses: plune-ai/report-action@v1
    if: ${{ always() }}
    with:
      token: ${{ secrets.PLUNE_TOKEN }}
      report: shard.json
      key: ${{ github.run_id }}-${{ github.run_attempt }}
      shard: ${{ matrix.shard }}/4
```

`shard` must be `k/N` with `1 <= k <= N <= 1000`; anything else fails the step before the import runs.
Every shard of a run must use the same N. A shard that never runs leaves the run open.
See [`examples/shards-auto-close.yml`](./examples/shards-auto-close.yml).

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `token` | required | Plune API token, from a secret. Passed to the CLI as `PLUNE_TOKEN` in the environment and masked in the log. |
| `report` | required | A JUnit XML file, a Playwright JSON file or an `allure-results` folder, relative to `working-directory`. The format is detected. |
| `run-title` | | Title of the run (`PLUNE_RUN_TITLE`). |
| `env` | | Environment the tests ran against, e.g. `staging` (`PLUNE_ENV`). |
| `labels` | | Run labels (`PLUNE_LABELS`), comma-separated or one per line. |
| `api-url` | | Plune API address (`PLUNE_API_URL`). Empty: the CLI default. |
| `key` | | Run key shared by several jobs (`--key`). Include `github.run_attempt`. |
| `shared-run` | `false` | Leave the run open for the jobs still reporting (`PLUNE_SHARED_RUN`). |
| `shard` | | This job is shard `k/N`, for example `2/4` (`PLUNE_SHARD`). Plune closes the run when all N shards have reported. Use with `key`. |
| `create` | `false` | Offer tests that match no case to the review queue (`--create`). |
| `fail-on-missing-attachments` | `false` | Fail the step when a file the report names is not there. The results are sent either way. |
| `fail-on-failures` | `false` | Fail the step on the platform's verdict (a failed or broken result that is not muted, or an expected case that never ran). Off: a red test does not fail the import. |
| `working-directory` | `.` | Directory the `report` path is relative to. |
| `cli-version` | `0.30.2` | Exact version of `@plune-ai/cli` to run. Pinned; floating tags such as `latest` are refused. |

## Outputs

| Output | Description |
| --- | --- |
| `run-url` | Address of the run in Plune. Empty when the CLI printed none: no run was opened, or the import timed out. |
| `uploaded` | Results Plune accepted. |
| `failed` | Results that did not reach Plune: not delivered, conflicted or refused. |
| `files-uploaded` | Files (screenshots, traces, logs) uploaded with the results. |
| `missing-attachments` | Files the report names that were not found, so were not uploaded. |

The outputs are set even when the step fails. A partial failure is also written to the step log as a
warning (`N of M result(s) did not reach Plune`), and a summary table goes to the run's job summary.

## Missing files

A report can name a file that is no longer there (the workspace was cleaned, the test never wrote it).
The import does **not** fail on that: the results are sent, the CLI prints one line per file (the test
and the path from the report), and `missing-attachments` counts them. Set
`fail-on-missing-attachments: 'true'` if you want that to turn the step red; the results are still sent.

## Security

- The token is read from `inputs.token` into the environment of one step. It is never put on a
  command line, never echoed, and is masked with `::add-mask::`.
- No input is spliced into a shell script: every value goes through `env:`, and the CLI is started with
  an argument list, not through a shell.
- The action needs no GitHub token and no write permission: `permissions: contents: read` is enough
  (and `contents: read` is only needed for `actions/checkout`).
- `cli-version` must be an exact version; pin the action itself to a tag (`@v1`) or a commit.

## Limits

- Linux and macOS runners. Windows runners are not tested.
- Since CLI 0.27 the import gives up after 600 s and exits 1, after trying for up to 15 s to terminate
  the run if it is not shared with other jobs. Set `PLUNE_IMPORT_TIMEOUT` (seconds, `0` = no limit) in
  the job's `env:`.
- `run-url`, `uploaded` and `failed` are read from the lines the CLI prints for people (`Read N result(s)
  ...`, the run address), because `plune run import` has no machine-readable output. A CLI release that
  rewords them shows up in this repository's tests and smoke workflow when `cli-version` is bumped.
- What runs live: `self-test.yml` runs the action from this repository on a GitHub-hosted Ubuntu runner
  against a Plune test project on beta, on every push to `main`, by hand, and on pull requests from
  branches of this repository (not forks: they get no secrets). It proves the JUnit fixture arrives
  whole (3 results, 1 file, nothing lost), that a second import with the same `key` lands in the same
  run instead of opening another and counts nothing twice, and that a report naming a missing file still
  sends its results, keeps the step green and leaves a warning on the job. The runs are deleted afterwards.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to work on the action.

## License

[MIT](./LICENSE)
