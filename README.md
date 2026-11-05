# Plune report: GitHub Action

[![@plune-ai/cli](https://img.shields.io/npm/v/@plune-ai/cli?label=%40plune-ai%2Fcli)](https://www.npmjs.com/package/@plune-ai/cli)
[![license](https://img.shields.io/github/license/plune-ai/report-action)](./LICENSE)

Send the report your test framework already writes (a JUnit XML file or a folder of them, Playwright
JSON, or an Allure results folder) to [Plune](https://plune.ai) in one step. No package to install in your project, no
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

### Java: JUnit 5 with Maven or Gradle

Surefire and Gradle write a JUnit XML file per test class (`TEST-<class>.xml`). Point `report` at their
folder and the files arrive as one run; nothing to add to the build. Every `*.xml` directly in the folder
that is a JUnit report is read. Subfolders (Gradle's `binary/`) and other files (Surefire's `*.txt`) are
not, and an `*.xml` that is not JUnit is skipped with a line in the log. Needs `@plune-ai/cli` 0.32.0 or
newer, which the default `cli-version` is.

Maven:

```yaml
- run: mvn -B test
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: target/surefire-reports
```

Gradle:

```yaml
- run: ./gradlew test
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: build/test-results/test
```

Before you switch:

- **Keys.** A test is matched to its case by `classname#name`. Gradle keeps the method's parentheses
  (`cart.CartTest#addsAnItem()`), Surefire does not (`cart.CartTest#addsAnItem`), and Allure's JUnit 5
  names keep them as Gradle's do. So a project that moves between Surefire and Gradle, or between Surefire
  and Allure, meets its cases under other keys.
- **Duration.** Gradle writes a `timestamp` on a suite, and a test's span starts there. Surefire writes
  none, so from `@plune-ai/cli` 0.32.1 ([plune-ai/plune#2310](https://github.com/plune-ai/plune/issues/2310))
  a Maven test's span ends when the import reads the report. Either way the duration is the test's own `time`.
- **Files.** A file reaches a test only through a `[[ATTACHMENT|path]]` line in that test's own output
  (`System.out.println`), and the path counts from the folder the XML file is in (`target/surefire-reports`,
  `build/test-results/test`), so the file has to be below it. Gradle puts a test's output into its test
  case only with `reports.junitXml.outputPerTestCase = true`; by default it keeps it at suite level, where
  the import does not look for the line. Surefire moves the output out of the XML when
  `redirectTestOutputToFile` is `true`, and the line does not reach the report either.

#### With Allure, for steps and attached files

Allure adds the steps a test made with `Allure.step(...)` and the files it added with
`Allure.addAttachment(...)`, with no line to print. Add `io.qameta.allure:allure-jupiter` to the test
dependencies (before 2.35.1 it was `allure-junit5`; from 2.35.1 that name is only a relocation POM with no
jar of its own), set `allure.results.directory` (Allure's default is `allure-results` in the working
directory) and point `report` at that folder instead. Those two calls need nothing else. The `@Step` and
`@Attachment` annotations also need the AspectJ agent, set up as Allure's documentation describes. The
smoke workflow checks the attachment only.

Maven: the dependency in `pom.xml`, the folder in `src/test/resources/allure.properties`.

```xml
<dependency>
  <groupId>io.qameta.allure</groupId>
  <artifactId>allure-jupiter</artifactId>
  <version>2.35.5</version>
  <scope>test</scope>
</dependency>
```

```properties
allure.results.directory=target/allure-results
```

```yaml
- run: mvn -B test
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: target/allure-results
```

Gradle: both in `build.gradle.kts`.

```kotlin
dependencies {
    testImplementation("io.qameta.allure:allure-jupiter:2.35.5")
}
tasks.test {
    useJUnitPlatform()
    systemProperty("allure.results.directory", layout.buildDirectory.dir("allure-results").get().asFile.path)
}
```

```yaml
- run: ./gradlew test
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: build/allure-results
```

### .NET: xUnit with `dotnet test` (JUnit XML)

Add the [`JunitXml.TestLogger`](https://www.nuget.org/packages/JunitXml.TestLogger) package to the test
project; `dotnet test` then writes a JUnit XML file.

```yaml
# bash. Under pwsh (the default shell on Windows runners) write $env:RESULTS_DIR in run:, or set shell: bash.
- run: dotnet test --logger "junit;LogFilePath=$RESULTS_DIR/report.xml"
  env:
    RESULTS_DIR: ${{ github.workspace }}/test-results
- uses: plune-ai/report-action@v1
  if: ${{ always() }}
  with:
    token: ${{ secrets.PLUNE_TOKEN }}
    report: test-results/report.xml
```

There is no Windows job for .NET in the smoke workflow: the command above is run on Ubuntu only.

A fixed name such as `report.xml` holds one file: with several test projects, or a project with several
`TargetFrameworks`, each run of the logger writes it again and one overwrites the other. Put the
logger's tokens into the path, `LogFilePath=$RESULTS_DIR/{assembly}.xml`, and add `{framework}`
(`{assembly}.{framework}.xml`) when a project targets several frameworks; the logger replaces them with
the test assembly's name and the target framework (see its
[configuration page](https://github.com/spekt/testlogger/wiki/Logger-Configuration)). Then pass the
folder as `report` (`test-results`): every JUnit file in it arrives as one run, as for Java above. A
test whose `classname` and `name` are the same in two frameworks' files has one key (`<class>#<name>`)
in that run, so Plune keeps the first result and counts the second as already there. The
smoke workflow runs one project with the fixed name `report.xml`: these tokens and a folder of .NET
reports are not run there.

To attach a file, have the test save it in the report's folder (it can read `RESULTS_DIR` from the
environment) and write `[[ATTACHMENT|cart.png]]` through `ITestOutputHelper.WriteLine`: xUnit v2 does not
capture `Console.WriteLine`, so a line printed that way never reaches the report.

The smoke workflow runs the commands above on a GitHub-hosted Ubuntu runner, on the projects in
`fixtures/`: jobs `maven-junit` and `gradle-junit` import the Surefire and Gradle folders, `maven` and
`gradle` the Allure folders of the same two projects, and `dotnet` the file of `dotnet test --logger …`.
Two differences: Gradle runs as `gradle test`, with no wrapper, and the test step has
`continue-on-error: true` (so the job stays green while one test fails on purpose) instead of
`if: always()` on the report step. Not run or checked there: a `[[ATTACHMENT|…]]` line printed by a Java
test, `outputPerTestCase`, durations, and the `@Step` and `@Attachment` annotations.

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
| `report` | required | A JUnit XML file, a Playwright JSON file, an `allure-results` folder or a folder of JUnit XML files (`target/surefire-reports`, `build/test-results/test`; CLI 0.32.0 or newer), relative to `working-directory`. The format is detected. |
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
| `cli-version` | `0.33.0` | Exact version of `@plune-ai/cli` to run. Pinned; floating tags such as `latest` are refused. |

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
- No input is spliced into a shell script: every value goes through `env:`. The action starts `npx` with
  an argument list and no shell of its own; npx then starts the CLI's binary through `sh` or `cmd.exe` and
  quotes the arguments itself.
- The action needs no GitHub token and no write permission: `permissions: contents: read` is enough
  (and `contents: read` is only needed for `actions/checkout`).
- `cli-version` must be an exact version; pin the action itself to a tag (`@v1`) or a commit.

## Limits

- Runners: Linux, macOS and Windows. The step runs in `bash`: on Windows that must be Git Bash, which
  GitHub-hosted runners have. On a self-hosted Windows runner put Git Bash on `PATH` ahead of
  `C:\Windows\System32\bash.exe` (WSL), or the step runs inside WSL. On Windows, use `cli-version`
  0.28.0 or newer: 0.25.0 to 0.27.0 need `better-sqlite3`, which has no prebuilt binary for the action's
  node 20, so npx compiles it, and on `windows-latest` that fails after about 90 s; from 0.28.0 it is
  optional and `run import` does not load it. When npx fails before the CLI prints anything, set
  `npm_config_foreground_scripts: 'true'` in the job's `env:` to see why. The smoke workflow runs the
  action on Linux and, for a JUnit report, on Windows; macOS is not run.
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
  sends its results, keeps the step green and leaves a warning on the job. It also checks that the repeated
  imports made no second case for any of the three tests. Afterwards the runs are deleted: the ones the
  CLI printed an address for and the ones Plune finds by the job's keys, so a run that opened and then
  failed or timed out is deleted too.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to work on the action.

## License

[MIT](./LICENSE)
