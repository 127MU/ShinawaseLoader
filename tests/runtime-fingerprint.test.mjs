// Regression: the Loader UI polls /api/status every few seconds, and each poll
// fingerprinted the stock install by reading all of app.asar into one buffer
// and hashing it. The fingerprint is now hashed in chunks and reused until the
// stat of an input file changes; a replaced archive must still be detected.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintStock } from '../ShinawaseLoader/runtime-sync.mjs';
import { LINUX_EXE_NAMES } from '../ShinawaseLoader/platform.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

test('stock fingerprint hashes the archive and follows archive changes', { skip: process.platform === 'darwin' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'shinawase-fingerprint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'resources'), { recursive: true });
  writeFileSync(join(root, process.platform === 'linux' ? LINUX_EXE_NAMES[0] : 'ECHO.exe'), 'exe');
  const asar = join(root, 'resources', 'app.asar');
  // Larger than one 4MB hashing chunk, with a partial final chunk.
  const first = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
  writeFileSync(asar, first);

  const a = fingerprintStock(root);
  assert.equal(a.asarSha256, sha256(first));
  assert.equal(a.asarSize, first.length);

  const b = fingerprintStock(root);
  assert.equal(b.asarSha256, a.asarSha256);
  b.asarSha256 = 'mutated';
  assert.equal(fingerprintStock(root).asarSha256, a.asarSha256, 'callers get a copy, not the cached object');

  const second = Buffer.alloc(4 * 1024 * 1024, 9);
  writeFileSync(asar, second);
  assert.equal(fingerprintStock(root).asarSha256, sha256(second), 'a rewritten archive is hashed again');
});
