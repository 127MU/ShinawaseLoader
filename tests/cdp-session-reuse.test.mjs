// Regression for the lyrics page flashing every injectIntervalMs: the Loader
// opened and closed a DevTools session on every injection cycle, and ECHO
// re-created its lyrics provider each time (approach from PR #37). The Loader
// now keeps one session per renderer target, and must still replace it at once
// when the socket dies (a closed WebSocket drops send() silently, so a stale
// session would otherwise stall every cycle for cdpTimeoutMs and never inject
// again). Runs the real CLI against a minimal in-process CDP endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const loaderCli = fileURLToPath(new URL('../ShinawaseLoader/ShinawaseLoader.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const freePort = () => new Promise((resolvePromise) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolvePromise(port)); });
});

// Just enough of RFC 6455 for CDP: unfragmented text frames, masked from the client.
const frame = (text) => {
  const data = Buffer.from(text);
  const header = data.length < 126 ? Buffer.from([0x81, data.length])
    : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(data.length), 2); return h; })();
  return Buffer.concat([header, data]);
};
const readFrames = (buffer) => {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 6) {
    const opcode = buffer[offset] & 15;
    let length = buffer[offset + 1] & 127;
    let cursor = offset + 2;
    if (length === 126) { length = buffer.readUInt16BE(cursor); cursor += 2; } else if (length === 127) { length = Number(buffer.readBigUInt64BE(cursor)); cursor += 8; }
    if (buffer.length < cursor + 4 + length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    const payload = Buffer.from(buffer.subarray(cursor + 4, cursor + 4 + length)).map((byte, index) => byte ^ mask[index % 4]);
    messages.push({ opcode, text: payload.toString('utf8') });
    offset = cursor + 4 + length;
  }
  return { messages, rest: buffer.subarray(offset) };
};

const fakeCdp = async () => {
  const port = await freePort();
  const state = { connections: 0, evaluations: 0, sockets: new Set() };
  const server = createServer((request, response) => {
    if (request.url.startsWith('/json/list') || request.url === '/json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ id: 'main', type: 'page', title: 'ECHO', url: 'file:///echo/resources/app.asar/out/renderer/index.html', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/main` }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.connections += 1;
    state.sockets.add(socket);
    socket.on('close', () => state.sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const parsed = readFrames(Buffer.concat([pending, chunk]));
      pending = parsed.rest;
      for (const message of parsed.messages) {
        if (message.opcode === 8) { socket.end(); return; }
        if (message.opcode !== 1) continue;
        const call = JSON.parse(message.text);
        if (call.method === 'Runtime.evaluate') state.evaluations += 1;
        // Never "ready": the Loader keeps probing on its fast startup cadence.
        socket.write(frame(JSON.stringify({ id: call.id, result: { result: { type: 'object', value: { ready: false } } } })));
      }
    });
  });
  await new Promise((resolvePromise) => server.listen(port, '127.0.0.1', resolvePromise));
  return { port, state, close: () => { for (const socket of state.sockets) socket.destroy(); server.close(); } };
};

test('the Loader keeps one DevTools session per renderer and replaces a dead one at once', { timeout: 60000 }, async (t) => {
  const cdp = await fakeCdp();
  t.after(() => cdp.close());
  const base = mkdtempSync(join(tmpdir(), 'shinawase-cdp-reuse-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'ShinawaseLoader');
  const game = join(base, 'game');
  for (const dir of [home, join(game, 'Mods'), join(game, 'Plugins')]) mkdirSync(dir, { recursive: true });
  const loader = spawn(process.execPath, [loaderCli, 'attach', '--port', String(await freePort()), '--debug-port', String(cdp.port), '--inspect-port', String(await freePort()), '--inject-interval', '1000', '--startup-delay', '0', '--locale', 'en'], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ECHO_MOD_HOME: home, ECHO_GAME_ROOT: game, ECHO_MODS_HOME: join(game, 'Mods'), ECHO_PLUGINS_HOME: join(game, 'Plugins'), ECHO_LOGS_HOME: join(home, 'Logs'), ECHO_SKIP_SELF_UPDATE: '1' },
  });
  t.after(() => loader.kill());

  const waitFor = async (check, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (check()) return true; await sleep(100); }
    return check();
  };
  assert.ok(await waitFor(() => cdp.state.evaluations >= 4, 20000), `the Loader probed ${cdp.state.evaluations} time(s)`);
  assert.equal(cdp.state.connections, 1, 'several injection cycles share one DevTools session');

  // The renderer side drops the connection; the next cycle must reconnect
  // promptly instead of waiting out the 15s call timeout on a dead socket.
  for (const socket of cdp.state.sockets) socket.destroy();
  const before = cdp.state.evaluations;
  assert.ok(await waitFor(() => cdp.state.connections === 2 && cdp.state.evaluations > before, 6000), `reconnected: connections=${cdp.state.connections}`);
  const settled = cdp.state.evaluations;
  assert.ok(await waitFor(() => cdp.state.evaluations >= settled + 2, 6000));
  assert.equal(cdp.state.connections, 2, 'the new session is reused as well');
});
