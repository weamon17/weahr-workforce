import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PWA manifest exposes an installable standalone application', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name.startsWith('WeaHR'), true);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url.startsWith('/'), true);
  assert.equal(manifest.icons.some(icon => icon.purpose.includes('maskable')), true);
});

test('service worker never caches cross-origin Firebase or API traffic', async () => {
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.doesNotMatch(worker, /firebaseio|googleapis|cloudfunctions/);
});

test('offline fallback explains that attendance requires a connection', async () => {
  const offlinePage = await readFile(new URL('../public/offline.html', import.meta.url), 'utf8');
  assert.match(offlinePage, /Chấm công và các thay đổi nhân sự cần kết nối/);
});
