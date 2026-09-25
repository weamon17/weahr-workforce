import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
  value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
));

// i18next resolves `key` from `key_one` / `key_other` when a count is passed.
const baseKey = key => key.replace(/_(zero|one|two|few|many|other)$/, '');

const sourceFiles = async (directory = 'src/') => {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => (entry.isDirectory()
    ? sourceFiles(`${directory}${entry.name}/`)
    : [`${directory}${entry.name}`])));
  return nested.flat().filter(path => /\.(jsx?|tsx?)$/.test(path));
};

test('Vietnamese and English translations define the same keys', async () => {
  const [vi, en] = await Promise.all([readJson('src/locales/vi.json'), readJson('src/locales/en.json')]);
  const viKeys = new Set(flatten(vi));
  const enKeys = new Set(flatten(en));
  assert.deepEqual([...viKeys].filter(key => !enKeys.has(key)), [], 'missing in en.json');
  assert.deepEqual([...enKeys].filter(key => !viKeys.has(key)), [], 'missing in vi.json');
});

test('every literal translation key used in the app exists', async () => {
  const vi = await readJson('src/locales/vi.json');
  const defined = new Set(flatten(vi).flatMap(key => [key, baseKey(key)]));
  const missing = [];
  for (const path of await sourceFiles()) {
    const source = await readFile(new URL(path, root), 'utf8');
    for (const [, key] of source.matchAll(/\bt\(\s*'([a-z_]+\.[a-zA-Z0-9_.]+)'/g)) {
      if (!defined.has(key)) missing.push(`${path}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
