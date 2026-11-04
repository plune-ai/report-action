# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public issue.

Use GitHub's private vulnerability reporting on this repository: open the
[**Security**](https://github.com/plune-ai/report-action/security/advisories/new) tab and choose
**Report a vulnerability**. We aim to acknowledge new reports within a few business days.

Please include the version you used, the steps to reproduce, and the impact you expect.

## Scope

This action runs in your CI and sends test results to Plune with a token you provide. In scope:

- The composite action in [`action.yml`](action.yml) and the script
  [`scripts/run-import.mjs`](scripts/run-import.mjs)
- The `token` input (a Plune API token) printed to the log, or sent anywhere other than the
  configured Plune API address
- A workflow input (`report`, `run-title`, `env`, `labels`, `api-url`, `key`, `shard`,
  `working-directory`, `cli-version`, ...) that can inject shell commands

## Out of scope

- Vulnerabilities in `@plune-ai/cli`, which this action runs from npm — please report those on
  the [cli repository](https://github.com/plune-ai/cli/security/advisories/new)
- Vulnerabilities in third-party actions or dependencies — please report those to the upstream project
- Workflows that pass untrusted input to this action in a way the workflow itself makes unsafe
- Contents of the report file you choose to upload
