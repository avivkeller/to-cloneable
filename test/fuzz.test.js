import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCloneable } from 'to-cloneable';

// mulberry32: failures must be reproducible from the seed alone.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cloneable = [
  () => 1,
  () => 'text',
  () => null,
  () => undefined,
  () => 10n,
  () => new Date(0),
  () => /x/g,
  () => new Uint8Array(2),
  () => new ArrayBuffer(2),
  () => new Error('e'),
  () => new Boolean(true),
];
const uncloneable = [
  () => () => {},
  () => Symbol('s'),
  () => new URL('https://example.com/'),
  () => Promise.resolve(),
  () => new WeakMap(),
  () => class {},
  () => new Proxy({}, {}),
  () => new Error('e', { cause: () => {} }),
];

function build(next, leaves, depth = 0, made = []) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const child = () => build(next, leaves, depth + 1, made);
  const roll = next();
  if (depth > 4 || roll < 0.3) return pick(leaves)();
  if (roll < 0.36 && made.length > 0) return pick(made);
  const size = Math.floor(next() * 4);
  let value;
  if (roll < 0.6) {
    value = {};
    made.push(value);
    for (let i = 0; i < size; i++) value[`k${i}`] = child();
  } else if (roll < 0.8) {
    value = [];
    made.push(value);
    for (let i = 0; i < size; i++) value[i * (next() < 0.2 ? 2 : 1)] = child();
  } else if (roll < 0.9) {
    value = new Map();
    made.push(value);
    for (let i = 0; i < size; i++) value.set(next() < 0.5 ? i : child(), child());
  } else {
    value = new Set();
    made.push(value);
    for (let i = 0; i < size; i++) value.add(child());
  }
  return value;
}

// Bun's deepEqual cannot match some Maps and Sets keyed by objects, even
// between two clones of one value. Such a value proves nothing either way.
function assertSameClone(actual, expected, message) {
  try {
    assert.deepEqual(structuredClone(expected), structuredClone(expected));
  } catch {
    return;
  }
  assert.deepEqual(structuredClone(actual), structuredClone(expected), message);
}

test('whatever goes in, the result clones', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const input = build(random(seed), [...cloneable, ...uncloneable]);
    let output;
    try {
      output = toCloneable(input);
      structuredClone(output);
    } catch (error) {
      assert.fail(`seed ${seed}: ${error.message}`);
    }
    assertSameClone(toCloneable(output), output, `seed ${seed}`);
  }
});

test('cloneable input clones to exactly what it would have without the library', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const input = build(random(seed), cloneable);
    assertSameClone(toCloneable(input), input, `seed ${seed}`);
  }
});
