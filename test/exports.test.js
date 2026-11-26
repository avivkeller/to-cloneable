import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { exports } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const subpath of Object.keys(exports).filter((key) => key !== './package.json')) {
  test(`to-cloneable${subpath.slice(1)} loads and sanitizes plain data`, async () => {
    const { toCloneable } = await import(`to-cloneable${subpath.slice(1)}`);
    const output = toCloneable({ a: [1, () => {}], m: new Map([['k', Symbol('s')]]), d: new Date(0) });
    assert.deepEqual(output, { a: [1, undefined], m: new Map(), d: new Date(0) });
    structuredClone(output);
  });
}

test('every conditional export points at a file', () => {
  const targets = JSON.stringify(exports).match(/\.\/src\/[\w.]+/g);
  for (const target of new Set(targets)) readFileSync(new URL(`../${target}`, import.meta.url));
});
