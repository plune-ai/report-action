// GitHub Action · report-action · the whole script, with a fake CLI in place of npx. Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runImport, writeOutputs, npxCommand } from '../scripts/run-import.mjs';

const dir = mkdtempSync(join(tmpdir(), 'report-action-'));
const fake = join(dir, 'fake-cli.mjs');
// Prints what the real one would, and the facts the test wants to check (arguments, env).
writeFileSync(
  fake,
  `console.log(JSON.stringify({ argv: process.argv.slice(2), token: process.env.PLUNE_TOKEN, title: process.env.PLUNE_RUN_TITLE }));
console.log('Read 2 result(s) from a junit report: 1 accepted, 0 already there, 0 unmatched, 1 not delivered.');
console.log('http://x/v1/runs/r1');
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`,
);
const env = { INPUT_TOKEN: 'tok-secret', INPUT_REPORT: 'my reports/r.xml', INPUT_CLI_VERSION: '0.24.0', INPUT_RUN_TITLE: 'a b', FAKE_EXIT: '1', PATH: process.env.PATH };

test('GitHub Action · report-action · script · outputs and exit code come from the CLI; the token is masked first', async () => {
  let log = '';
  const { code, outputs } = await runImport(env, { cli: { command: process.execPath, leadingArgs: [fake] }, write: (s) => (log += s) });
  assert.equal(code, 1);
  assert.deepEqual(outputs, { runUrl: 'http://x/v1/runs/r1', uploaded: 1, failed: 1, filesUploaded: 0, missingAttachments: 0, cliSilent: false });
  assert.ok(log.startsWith('::add-mask::tok-secret\n'));
  const seen = JSON.parse(log.split('\n')[1]);
  assert.deepEqual(seen.argv, ['-y', '@plune-ai/cli@0.24.0', 'run', 'import', 'my reports/r.xml']);
  assert.equal(seen.token, 'tok-secret');
  assert.equal(seen.title, 'a b');
  assert.ok(!seen.argv.join(' ').includes('tok-secret'));
});

test('GitHub Action · report-action · call · Windows runs npm\'s npx-cli.js with node, not npx.cmd; Linux and macOS run npx', () => {
  assert.deepEqual(npxCommand('linux', '/opt/hostedtoolcache/node/20.19.5/x64/bin/node'), { command: 'npx', leadingArgs: [] });
  assert.deepEqual(npxCommand('darwin', '/usr/local/bin/node'), { command: 'npx', leadingArgs: [] });
  const npxCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
  assert.deepEqual(npxCommand('win32', 'C:\\Program Files\\nodejs\\node.exe', (p) => p === npxCli), {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    leadingArgs: [npxCli],
  });
});

test('GitHub Action · report-action · call · Windows without npx-cli.js next to node is refused with the path, before anything runs', () => {
  assert.throws(() => npxCommand('win32', 'C:\\tools\\node.exe', () => false), {
    message: "npm's npx-cli.js not found next to C:\\tools\\node.exe (looked for C:\\tools\\node_modules\\npm\\bin\\npx-cli.js).",
  });
});

test('GitHub Action · report-action · call · npxCommand() with no arguments is the one for this platform and this node, however node was named', () => {
  assert.deepEqual(npxCommand(), npxCommand(process.platform, process.execPath));
  // cmd.exe starts node as plain `node` (argv0); Git Bash and node --test pass the full path, so check that case in a child.
  const src = `import(${JSON.stringify(new URL('../scripts/run-import.mjs', import.meta.url).href)}).then((m) => console.log(JSON.stringify(m.npxCommand())))`;
  const child = spawnSync(process.execPath, ['-e', src], { argv0: 'node', encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), npxCommand(process.platform, process.execPath));
});

test('GitHub Action · report-action · script · with no cli given, runImport starts npx the way npxCommand() picks for this platform', async () => {
  let seen;
  const fakeSpawn = (command, args) => {
    seen = { command, args };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  await runImport(env, { write: () => {}, spawnImpl: fakeSpawn });
  const npx = npxCommand(process.platform, process.execPath);
  assert.deepEqual(seen, { command: npx.command, args: [...npx.leadingArgs, '-y', '@plune-ai/cli@0.24.0', 'run', 'import', 'my reports/r.xml'] });
});

test('GitHub Action · report-action · script · started through a symlink or junction, it runs as it does by its real path (#8)', () => {
  // A self-hosted runner's work folder can be a link: the script must not take that for "imported, not run".
  const link = join(dir, 'linked-scripts');
  symlinkSync(fileURLToPath(new URL('../scripts', import.meta.url)), link, 'junction');
  const run = (script) => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  const direct = run(fileURLToPath(new URL('../scripts/run-import.mjs', import.meta.url)));
  const linked = run(join(link, 'run-import.mjs'));
  assert.equal(direct.status, 2, direct.stderr);
  assert.match(direct.stdout, /^::error::/);
  assert.deepEqual({ status: linked.status, stdout: linked.stdout }, { status: direct.status, stdout: direct.stdout });
});

test('GitHub Action · report-action · script · GITHUB_OUTPUT gets name=value lines', () => {
  const file = join(dir, 'out');
  writeFileSync(file, '');
  writeOutputs({ runUrl: 'u', uploaded: 1, failed: 2, filesUploaded: 3, missingAttachments: 4 }, file);
  assert.equal(readFileSync(file, 'utf8'), 'run-url=u\nuploaded=1\nfailed=2\nfiles-uploaded=3\nmissing-attachments=4\n');
});
