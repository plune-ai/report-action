// GitHub Action · report-action · output parsing and the call it builds. Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutput, buildInvocation, annotations, summaryMarkdown } from '../scripts/run-import.mjs';

// Lines as @plune-ai/cli 0.24.0 prints them.
const OK = `plune: files — 1 uploaded, 0 skipped, 0 already there (skipped), 0 retried, 0 dropped, in 0.0 s (4 at once, 2 request(s) to Plune)
plune: 3 accepted · 1 screenshot(s) uploaded
Read 3 result(s) from a junit report: 3 accepted, 0 already there, 0 unmatched, 0 not delivered.
Imported 3 results · 1 files uploaded · 0 files not found
https://beta.plune.ai/runs/abc-123
`;
const PARTIAL = `plune: attachment not found — "shop.Cart › adds_item": gone.png
plune: attachment not found — "shop.Cart › pays": traces/t.zip
Read 5 result(s) from an allure report: 2 accepted, 1 already there, 0 unmatched, 2 not delivered.
1 conflicted and 3 were refused.
Imported 2 results · 4 files uploaded · 2 files not found · 1 files not sent (their result was not stored)
http://127.0.0.1:8791/v1/runs/stub-run-1
plune: gate failed — 1 failed · 0 broken · 0 not run · 0 muted
`;

test('GitHub Action · report-action · parse · a clean import', () => {
  assert.deepEqual(parseOutput(OK), { runUrl: 'https://beta.plune.ai/runs/abc-123', uploaded: 3, failed: 0, filesUploaded: 1, missingAttachments: 0 });
});

test('GitHub Action · report-action · parse · partial failure counts not delivered, conflicted and refused', () => {
  assert.deepEqual(parseOutput(PARTIAL), { runUrl: 'http://127.0.0.1:8791/v1/runs/stub-run-1', uploaded: 2, failed: 6, filesUploaded: 4, missingAttachments: 2 });
});

test('GitHub Action · report-action · parse · no run opened leaves the URL empty, not invented', () => {
  const o = parseOutput('Read 3 result(s) from a junit report: 0 accepted, 0 already there, 0 unmatched, 3 not delivered.\n');
  assert.equal(o.runUrl, '');
  assert.equal(o.failed, 3);
});

test('GitHub Action · report-action · parse · an unrelated URL is not taken for the run', () => {
  assert.equal(parseOutput('see https://plune.ai/docs\nhttps://plune.ai/docs/x\n').runUrl, '');
});

const base = { INPUT_TOKEN: 'tok-secret', INPUT_REPORT: 'out/report.xml', INPUT_CLI_VERSION: '0.24.0', PATH: '/bin' };

test('GitHub Action · report-action · call · minimal inputs; the token is in env and never in the arguments', () => {
  const { args, env } = buildInvocation(base);
  assert.deepEqual(args, ['-y', '@plune-ai/cli@0.24.0', 'run', 'import', 'out/report.xml']);
  assert.equal(env.PLUNE_TOKEN, 'tok-secret');
  assert.ok(!args.join(' ').includes('tok-secret'));
  assert.equal(env.PLUNE_RUN_TITLE, undefined);
});

test('GitHub Action · report-action · call · every input reaches the CLI as its flag or variable', () => {
  const { args, env } = buildInvocation({
    ...base,
    INPUT_RUN_TITLE: 'nightly; rm -rf /',
    INPUT_ENV: 'staging',
    INPUT_LABELS: 'smoke, nightly\nunit',
    INPUT_API_URL: 'http://127.0.0.1:1',
    INPUT_KEY: '77-2',
    INPUT_SHARED_RUN: 'true',
    INPUT_CREATE: 'true',
    INPUT_FAIL_ON_MISSING_ATTACHMENTS: 'true',
    INPUT_FAIL_ON_FAILURES: 'true',
  });
  assert.deepEqual(args.slice(5), ['--key', '77-2', '--create', '--fail-on-missing-attachments', '--fail-on-failures']);
  assert.equal(env.PLUNE_RUN_TITLE, 'nightly; rm -rf /'); // a value, never shell text
  assert.equal(env.PLUNE_ENV, 'staging');
  assert.equal(env.PLUNE_LABELS, 'smoke,nightly,unit');
  assert.equal(env.PLUNE_API_URL, 'http://127.0.0.1:1');
  assert.equal(env.PLUNE_SHARED_RUN, '1');
});

test('GitHub Action · report-action · call · refuses an empty token, an empty report and a floating version', () => {
  assert.throws(() => buildInvocation({ ...base, INPUT_TOKEN: '' }), /token is empty/);
  assert.throws(() => buildInvocation({ ...base, INPUT_REPORT: ' ' }), /report is required/);
  assert.throws(() => buildInvocation({ ...base, INPUT_CLI_VERSION: 'latest' }), /exact version/);
  assert.throws(() => buildInvocation({ ...base, INPUT_CLI_VERSION: '0.24.0 --yes' }), /exact version/);
});

test('GitHub Action · report-action · log · a partial failure and missing files are said in the step log', () => {
  const lines = annotations(parseOutput(PARTIAL), 1);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^::warning::6 of 8 result\(s\) did not reach Plune \(2 did\)/);
  assert.match(lines[1], /2 file\(s\)/);
  assert.match(lines[2], /exited with code 1/);
  assert.deepEqual(annotations(parseOutput(OK), 0), []);
  assert.match(summaryMarkdown(parseOutput(OK)), /\| 3 \| 0 \| 1 \| 0 \|/);
});

test('GitHub Action · report-action · log · an import that timed out after opening a run is not summed up as "no run was opened"', () => {
  // As @plune-ai/cli 0.30.2 prints it (src/cli/commands/run-import.ts, timeoutMessage) before exiting 1.
  const timedOut = parseOutput(
    'plune: run import did not finish in 600 s (--timeout / PLUNE_IMPORT_TIMEOUT; 0 turns the limit off); the platform may have received part of the results; run r-1 was terminated - import the report again.\n',
  );
  assert.equal(timedOut.runUrl, '');
  const summary = summaryMarkdown(timedOut);
  assert.match(summary, /^Run: not in the CLI output/m);
  assert.doesNotMatch(summary, /no run was opened/);
});

test('GitHub Action · report-action · shard · k/N goes to the CLI as PLUNE_SHARD', () => {
  const ok = { ...base, INPUT_CLI_VERSION: '0.25.0' };
  assert.equal(buildInvocation({ ...ok, INPUT_SHARD: ' 2/4 ' }).env.PLUNE_SHARD, '2/4');
  assert.equal(buildInvocation({ ...ok, INPUT_SHARD: '1000/1000' }).env.PLUNE_SHARD, '1000/1000');
  assert.equal('PLUNE_SHARD' in buildInvocation(ok).env, false);
});

test('GitHub Action · report-action · shard · anything but k/N with 1 <= k <= N is refused', () => {
  for (const bad of ['0/4', '5/4', '2', 'a/b', '2/', '/4', '-1/4', '1/4/4', '1/1001', '2 / 4']) {
    assert.throws(() => buildInvocation({ ...base, INPUT_CLI_VERSION: '0.25.0', INPUT_SHARD: bad }), /shard must be k\/N/, bad);
  }
  assert.throws(() => buildInvocation({ ...base, INPUT_SHARD: '2/4' }), /0\.25\.0 or newer/);
});
