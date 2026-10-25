// The logic of plune-ai/report-action, kept out of action.yml so it can be tested with plain node.
//
// It runs `plune run import` from the pinned CLI, lets its output through unchanged, and reads the
// numbers for the action's outputs from the CLI's own lines. The CLI has no machine-readable mode for
// `run import`, so these lines are the contract: if a CLI release rewords one, test/parse-output.test.mjs
// is where it shows (the smoke workflow runs the real, pinned CLI against it too).

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { win32 } from 'node:path';
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
  // Nothing but npm's own warnings: npx does not show a failed install script's output, so the CLI never spoke.
  out.cliSilent = !lines.some((l) => l !== '' && !/^npm (warn|notice)\b/i.test(l));
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

  // PLUNE_SHARD=k/N closes the run when N shards have reported. The CLI refuses a bad value too, but a CLI
  // older than 0.25.0 ignores it silently, so it is checked here, before anything is sent.
  const shard = input('SHARD');
  if (shard !== '') {
    const m = /^(\d+)\/(\d+)$/.exec(shard);
    const k = m ? Number(m[1]) : 0;
    const n = m ? Number(m[2]) : 0;
    if (!m || k < 1 || k > n || n > 1000) {
      throw new Error(`shard must be k/N with 1 <= k <= N <= 1000, for example 2/4, got "${shard}".`);
    }
    const [major, minor] = version.split(/[.-]/).map(Number);
    if (major === 0 && minor < 25) throw new Error(`shard needs @plune-ai/cli 0.25.0 or newer, cli-version is ${version}.`);
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
    ...set('PLUNE_SHARD', input('SHARD')),
    ...(input('SHARED_RUN') === 'true' ? { PLUNE_SHARED_RUN: '1' } : {}),
  };
  return { args, env: cliEnv };
}

/**
 * How the action starts npx: an argument list, with no shell of its own. On Windows npx is npx.cmd, which node
 * (20.12.2 and newer, CVE-2024-27980) starts only through cmd.exe, and the action would have to quote the
 * report path and the key for it. So on Windows node runs npx-cli.js of the npm bundled with this node.
 * npx.cmd would prefer a globally updated npm (npm i -g npm) when there is one; this always takes the bundled one.
 * npx itself then starts the CLI's bin through sh -c or cmd.exe /d /s /c and quotes the arguments itself.
 */
export function npxCommand(platform = process.platform, execPath = process.execPath, exists = existsSync) {
  if (platform !== 'win32') return { command: 'npx', leadingArgs: [] };
  const npxCli = win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!exists(npxCli)) throw new Error(`npm's npx-cli.js not found next to ${execPath} (looked for ${npxCli}).`);
  return { command: execPath, leadingArgs: [npxCli] };
}

/**
 * Run the import, pass the output through, and return `{ code, outputs }`.
 * `cli` (`{ command, leadingArgs }`, default npxCommand()) and `spawnImpl` are replaceable so tests can put
 * a fake CLI in the way.
 */
export function runImport(env, { cli = npxCommand(), write = (s) => process.stdout.write(s), spawnImpl = spawn } = {}) {
  const inv = buildInvocation(env);
  // The token is masked before anything is printed. Secrets are masked by the runner already; this
  // covers a token that was typed into a workflow by hand.
  write(`::add-mask::${inv.env.PLUNE_TOKEN}\n`);
  return new Promise((resolve, reject) => {
    // An argument list and no shell of the action's own; see npxCommand for the shell npx uses.
    const child = spawnImpl(cli.command, [...cli.leadingArgs, ...inv.args], { env: inv.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (code !== 0 && o.cliSilent) {
    lines.push(
      "::error::npx printed nothing from the CLI, so @plune-ai/cli did not install or did not start. npm does not show the output of a failed install script; set npm_config_foreground_scripts: 'true' in the job's env to see it.",
    );
  }
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
