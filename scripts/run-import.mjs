// The logic of plune-ai/report-action, kept out of action.yml so it can be tested with plain node.
//
// It runs `plune run import` from the pinned CLI, lets its output through unchanged, and reads the
// numbers for the action's outputs from the CLI's own lines. The CLI has no machine-readable mode for
// `run import`, so these lines are the contract: if a CLI release rewords one, test/parse-output.test.mjs
// is where it shows (the smoke workflow runs the real, pinned CLI against it too).

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Read the CLI's output into the action's outputs. Anything it does not find stays empty or zero. */
export function parseOutput(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out = { runUrl: '', uploaded: 0, failed: 0, filesUploaded: 0, missingAttachments: 0 };

  // «Read 3 result(s) from a junit report: 3 accepted, 0 already there, 0 unmatched, 0 not delivered.»
  const read = text.match(/^Read \d+ result\(s\) from an? \S+ report: (\d+) accepted, \d+ already there, \d+ unmatched, (\d+) not delivered\./m);
  if (read) {
    out.uploaded = Number(read[1]);
    out.failed = Number(read[2]);
  }
  // «2 conflicted and 1 were refused.» — results the platform saw and did not take.
  const refused = text.match(/^(\d+) conflicted and (\d+) were refused\./m);
  if (refused) out.failed += Number(refused[1]) + Number(refused[2]);

  // «Imported 3 results · 1 files uploaded · 1 files not found», printed when the report names files.
  const files = text.match(/^Imported \d+ results · (\d+) files uploaded/m);
  if (files) out.filesUploaded = Number(files[1]);
  // One line per file, whether or not the summary line follows.
  out.missingAttachments = lines.filter((l) => l.startsWith('plune: attachment not found')).length;

  // The run's address is the last line that is a bare URL with /runs/ in it.
  out.runUrl = [...lines].reverse().find((l) => /^https?:\/\/\S+\/runs\/\S+$/.test(l)) ?? '';
  return out;
}

/** The environment the CLI gets and the arguments it is called with, from the action's inputs. */
export function buildInvocation(env) {
  const input = (name) => (env[`INPUT_${name}`] ?? '').trim();
  const version = input('CLI_VERSION');
  if (!SEMVER.test(version)) throw new Error(`cli-version must be an exact version such as 0.24.0, got "${version}".`);
  if (input('REPORT') === '') throw new Error('report is required: the path of a JUnit XML or Playwright JSON file, or an allure-results folder.');
  if (input('TOKEN') === '') {
    throw new Error('token is empty. Pass a Plune API token from a secret: token: ${{ secrets.PLUNE_TOKEN }} (secrets are not available to pull requests from forks).');
  }

  const args = ['-y', `@plune-ai/cli@${version}`, 'run', 'import', input('REPORT')];
  if (input('KEY') !== '') args.push('--key', input('KEY'));
  if (input('CREATE') === 'true') args.push('--create');
  if (input('FAIL_ON_MISSING_ATTACHMENTS') === 'true') args.push('--fail-on-missing-attachments');
  if (input('FAIL_ON_FAILURES') === 'true') args.push('--fail-on-failures');

  const set = (name, value) => (value === '' ? {} : { [name]: value });
  const cliEnv = {
    ...env,
    PLUNE_TOKEN: input('TOKEN'),
    ...set('PLUNE_API_URL', input('API_URL')),
    ...set('PLUNE_RUN_TITLE', input('RUN_TITLE')),
    ...set('PLUNE_ENV', input('ENV')),
    // Commas or one label per line, whichever the workflow finds easier to write.
    ...set('PLUNE_LABELS', input('LABELS').split(/[\n,]/).map((s) => s.trim()).filter(Boolean).join(',')),
    ...(input('SHARED_RUN') === 'true' ? { PLUNE_SHARED_RUN: '1' } : {}),
  };
  return { args, env: cliEnv };
}

/**
 * Run the import, pass the output through, and return `{ code, outputs }`.
 * `command` and `leadingArgs` are replaceable so tests can put a fake CLI in the way.
 */
export function runImport(env, { command = 'npx', leadingArgs = [], write = (s) => process.stdout.write(s) } = {}) {
  const inv = buildInvocation(env);
  // The token is masked before anything is printed. Secrets are masked by the runner already; this
  // covers a token that was typed into a workflow by hand.
  write(`::add-mask::${inv.env.PLUNE_TOKEN}\n`);
  return new Promise((resolve, reject) => {
    // An argument list, no shell: the report path and the key are never parsed as shell syntax.
    const child = spawn(command, [...leadingArgs, ...inv.args], { env: inv.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const take = (chunk) => {
      text += chunk;
      write(chunk.toString());
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, outputs: parseOutput(text) }));
  });
}

/** What the action tells the person about a partial failure, in the step's own log. */
export function annotations(o, code) {
  const lines = [];
  if (o.failed > 0) lines.push(`::warning::${o.failed} of ${o.uploaded + o.failed} result(s) did not reach Plune (${o.uploaded} did). See the lines above for why.`);
  if (o.missingAttachments > 0) lines.push(`::warning::${o.missingAttachments} file(s) the report names were not found and were not uploaded.`);
  if (code !== 0) lines.push(`::error::plune run import exited with code ${code}.`);
  return lines;
}

export function writeOutputs(o, file) {
  if (!file) return;
  appendFileSync(file, `run-url=${o.runUrl}\nuploaded=${o.uploaded}\nfailed=${o.failed}\nfiles-uploaded=${o.filesUploaded}\nmissing-attachments=${o.missingAttachments}\n`);
}

export function summaryMarkdown(o) {
  return [
    '### Plune report import',
    '',
    o.runUrl ? `Run: ${o.runUrl}` : 'Run: none (no run was opened)',
    '',
    '| Results sent | Results not delivered | Files uploaded | Files not found |',
    '| ---: | ---: | ---: | ---: |',
    `| ${o.uploaded} | ${o.failed} | ${o.filesUploaded} | ${o.missingAttachments} |`,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { code, outputs } = await runImport(process.env);
    writeOutputs(outputs, process.env.GITHUB_OUTPUT);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(outputs));
    for (const line of annotations(outputs, code)) console.log(line);
    process.exitCode = code;
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exitCode = 2;
  }
}
