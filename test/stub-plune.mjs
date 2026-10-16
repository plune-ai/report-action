// A local stand-in for the Plune API, just enough for `plune run import`: it knows every test, stores
// every result and file, and closes the run with a frozen summary. It exists so the action can be
// exercised end to end with no token and no network. `GET /__state` reports what it received.
//
//   node test/stub-plune.mjs [port]        prints "listening <url>" and serves until killed
//   import { startStub } from './stub-plune.mjs'

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startStub(port = 0) {
  const state = { auth: [], runs: 0, results: [], files: [], meta: [], closed: 0 };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = req.url ?? '';
      const reply = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (url === '/__state') return reply(200, state);
      if (req.headers.authorization) state.auth.push(req.headers.authorization);
      const body = raw.length === 0 || !String(req.headers['content-type']).includes('json') ? {} : JSON.parse(raw.toString('utf8'));
      if (url === '/v1/runs') {
        state.runs += 1;
        state.meta.push(body);
        return reply(201, { run: { id: 'stub-run-1' }, joined: false });
      }
      if (url === '/v1/test-cases/resolve') {
        return reply(200, { results: (body.keys ?? []).map((key) => ({ key, testCaseId: 'tc-1' })) });
      }
      if (url.endsWith('/results')) {
        const sent = body.results ?? [];
        state.results.push(...sent.map((r) => ({ resultKey: r.resultKey, rawStatus: r.rawStatus })));
        return reply(200, {
          items: sent.map((r, index) => ({ index, resultKey: r.resultKey, status: 'accepted', id: `res-${state.results.length}-${index}` })),
          counts: { accepted: sent.length, duplicate: 0, conflict: 0, rejected: 0 },
        });
      }
      // No bucket: every file goes to the platform itself (the `direct` road).
      if (url === '/v1/files/uploads-batch') {
        return reply(200, { items: (body.items ?? []).map((f, index) => ({ index, status: 'direct', name: f.name })) });
      }
      if (url === '/v1/files/direct-batch') {
        return reply(200, {
          items: (body.items ?? []).map((f, index) => {
            state.files.push({ name: f.name, bytes: Buffer.from(f.data, 'base64').length });
            return { index, status: 'stored', id: `f-${state.files.length}`, name: f.name, contentType: f.contentType, size: 1 };
          }),
        });
      }
      if (url.endsWith('/events')) {
        state.closed += 1;
        const failed = state.results.filter((r) => /fail|broken|error/i.test(r.rawStatus)).length;
        return reply(200, {
          run: { id: 'stub-run-1' },
          changed: true,
          summary: { counts: { passed: state.results.length - failed, failed }, notRun: [], total: state.results.length },
        });
      }
      return reply(500, { error: `stub: unexpected ${req.method} ${url}` });
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stub = await startStub(Number(process.argv[2] ?? 0));
  console.log(`listening ${stub.url}`);
}
