// Used by .github/workflows/smoke.yml: compare what the action reported (outputs, passed in as env) and what
// the local stub of the Plune API actually received. Exits 1 with every mismatch listed.
//   EXPECT='{"uploaded":"3","failed":"0","files-uploaded":"1","missing-attachments":"0","results":3,"files":1}'
import { argv, env, exit } from 'node:process';

const expect = JSON.parse(env.EXPECT);
const state = await (await fetch(`${argv[2]}/__state`)).json();
const actual = {
  uploaded: env.UPLOADED,
  failed: env.FAILED,
  'files-uploaded': env.FILES_UPLOADED,
  'missing-attachments': env.MISSING,
  results: state.results.length,
  files: state.files.length,
};
const bad = [];
for (const [k, v] of Object.entries(expect)) if (String(actual[k]) !== String(v)) bad.push(`${k}: expected ${v}, got ${actual[k]}`);
if (!/^http:\/\/127\.0\.0\.1:\d+\/v1\/runs\/stub-run-1$/.test(env.RUN_URL ?? '')) bad.push(`run-url: unexpected "${env.RUN_URL}"`);
if (!state.auth.length || state.auth.some((a) => a !== `Bearer ${env.TOKEN}`)) bad.push('the stub did not see the token as a bearer header on every request');
if (state.closed !== 1) bad.push(`the run was closed ${state.closed} times, expected 1`);
for (const b of bad) console.log(`::error::${b}`);
console.log(JSON.stringify({ actual, expect }));
exit(bad.length ? 1 : 0);
