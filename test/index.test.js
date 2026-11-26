import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCloneable } from 'to-cloneable';

const fn = () => {};
const url = () => new URL('https://example.com/');
// V8 and SpiderMonkey clone an error's `cause`; JavaScriptCore drops it.
const clonesCause = structuredClone(new Error('e', { cause: 1 })).cause === 1;

test('primitives pass through', () => {
  for (const value of [undefined, null, true, 0, -0, NaN, 1n, 'text']) {
    assert.ok(Object.is(toCloneable(value), value));
  }
});

test('a removed top-level value becomes undefined', () => {
  assert.equal(toCloneable(fn), undefined);
  assert.equal(toCloneable(Symbol('s')), undefined);
  assert.equal(toCloneable(url()), undefined);
  assert.equal(toCloneable(class {}), undefined);
});

test('object properties that cannot clone are dropped', () => {
  const input = { a: 1, fn, sym: Symbol('s'), url: url(), [Symbol('key')]: 1, nested: { fn, b: 2 } };
  assert.deepEqual(toCloneable(input), { a: 1, nested: { b: 2 } });
  assert.deepEqual(Reflect.ownKeys(toCloneable(input)), ['a', 'nested']);
});

test('the input is not modified', () => {
  const input = { fn, list: [fn], map: new Map([['k', fn]]) };
  toCloneable(input);
  assert.equal(input.fn, fn);
  assert.equal(input.list[0], fn);
  assert.equal(input.map.get('k'), fn);
});

test('removed array elements keep their slot', () => {
  assert.deepEqual(toCloneable([1, fn, 3]), [1, undefined, 3]);
});

test('arrays keep holes, length and named properties', () => {
  const input = Object.assign([1, , 3], { named: 'x', fn });
  input.length = 5;
  const output = toCloneable(input);
  assert.equal(output.length, 5);
  assert.equal(1 in output, false);
  assert.equal(output.named, 'x');
  assert.equal('fn' in output, false);
  assert.deepEqual(structuredClone(output), structuredClone(Object.assign([1, , 3, , ,], { named: 'x' })));
});

test('Map entries and Set members that cannot clone are dropped', () => {
  const key = { k: 1, fn };
  const output = toCloneable(new Map([['a', 1], ['b', fn], [fn, 2], [key, new Set([1, fn, url()])]]));
  assert.deepEqual([...output.keys()], ['a', { k: 1 }]);
  assert.deepEqual([...output.values()], [1, new Set([1])]);
});

test('Map and Set subclasses become Map and Set, as in a structured clone', () => {
  class MyMap extends Map {}
  const output = toCloneable(new MyMap([[1, fn], [2, 2]]));
  assert.equal(Object.getPrototypeOf(output), Map.prototype);
  assert.deepEqual([...output], [[2, 2]]);
});

test('cycles and shared references are preserved', () => {
  const shared = { fn, v: 1 };
  const input = { a: shared, b: shared, list: [shared] };
  input.self = input;
  const output = toCloneable(input);
  assert.equal(output.self, output);
  assert.equal(output.a, output.b);
  assert.equal(output.list[0], output.a);
  assert.deepEqual(output.a, { v: 1 });
  structuredClone(output);
});

test('cloneable built-ins pass through by reference', () => {
  const values = [
    new Date(0),
    /x/gi,
    new ArrayBuffer(8),
    new Uint8Array(4),
    new DataView(new ArrayBuffer(2)),
    new Boolean(true),
    new Number(1),
    new String('s'),
    Object(1n),
    new Error('e'),
    new TypeError('t'),
    new Blob(['x']),
    Buffer.from('hi'),
  ];
  const output = toCloneable(values);
  values.forEach((value, i) => assert.equal(output[i], value));
  structuredClone(output);
});

test('uncloneable built-ins are removed', () => {
  const values = [
    url(),
    new URLSearchParams(),
    new Headers(),
    Promise.resolve(),
    new WeakMap(),
    new WeakSet(),
    new WeakRef({}),
    Object(Symbol('s')),
    new Request('https://example.com/'),
    new Intl.NumberFormat(),
    [].values(),
    (function* () {})(),
    new ReadableStream(),
  ];
  assert.deepEqual(toCloneable(values), values.map(() => undefined));
});

test('subclasses of uncloneable built-ins are removed', () => {
  class MyURL extends URL {}
  class MyPromise extends Promise {}
  assert.deepEqual(toCloneable({ a: new MyURL('https://example.com/'), b: MyPromise.resolve() }), {});
});

test('class instances become plain objects of their own enumerable properties', () => {
  class Point {
    #secret = 1;
    x = 1;
    y = 2;
    handler = fn;
    get sum() {
      return this.x + this.y;
    }
    method() {}
  }
  const output = toCloneable(new Point());
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.deepEqual(output, { x: 1, y: 2 });
});

test('getters are read once', () => {
  let reads = 0;
  const input = {
    get value() {
      reads++;
      return reads === 1 ? 'data' : fn;
    },
  };
  const output = toCloneable(input);
  assert.equal(reads, 1);
  assert.deepEqual(structuredClone(output), { value: 'data' });
});

test('null-prototype objects and a "__proto__" key', () => {
  const input = Object.create(null);
  input.a = 1;
  input.fn = fn;
  Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
  const output = toCloneable(input);
  assert.deepEqual(Object.keys(output), ['a', '__proto__']);
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(output.polluted, undefined);
});

test('proxies are read through into plain data', () => {
  const state = new Proxy({ a: 1, fn, list: new Proxy([1, fn], {}) }, {});
  assert.throws(() => structuredClone(state));
  assert.deepEqual(toCloneable(state), { a: 1, list: [1, undefined] });
});

test('objects that only inherit from a built-in are ordinary objects', () => {
  function LegacyError(message) {
    this.message = message;
    this.handler = fn;
  }
  LegacyError.prototype = Object.create(Error.prototype);
  const date = Object.create(Date.prototype);
  date.fn = fn;
  date.v = 1;
  const output = toCloneable({ date, array: Object.create(Array.prototype) });
  assert.deepEqual(output, { date: { v: 1 }, array: {} });
  structuredClone(output);
  structuredClone(toCloneable(new LegacyError('m')));
  if (Error.isError) assert.deepEqual(toCloneable(new LegacyError('m')), { message: 'm' });
});

test('errors with a cloneable cause pass through by reference', () => {
  const inner = new RangeError('inner');
  const outer = new Error('outer', { cause: inner });
  assert.equal(toCloneable(outer), outer);
  assert.equal(toCloneable(new Error('m', { cause: 'text' })).cause, 'text');
});

test('errors with an uncloneable cause are rebuilt', { skip: !clonesCause }, () => {
  const input = new RangeError('boom', { cause: { fn, code: 7 } });
  assert.throws(() => structuredClone(input));
  const output = toCloneable(input);
  assert.notEqual(output, input);
  assert.ok(output instanceof RangeError);
  assert.equal(output.message, 'boom');
  assert.equal(output.stack, input.stack);
  assert.deepEqual(output.cause, { code: 7 });
  const clone = structuredClone(output);
  assert.ok(clone instanceof RangeError);
  assert.deepEqual(clone.cause, { code: 7 });

  const dropped = toCloneable(new Error('boom', { cause: fn }));
  assert.equal('cause' in dropped, false);
  structuredClone(dropped);
});

test('a chain of errors is rebuilt up to the uncloneable cause', { skip: !clonesCause }, () => {
  const root = new Error('root', { cause: fn });
  const top = new Error('top', { cause: new TypeError('middle', { cause: root }) });
  const clone = structuredClone(toCloneable(top));
  assert.equal(clone.message, 'top');
  assert.ok(clone.cause instanceof TypeError);
  assert.equal(clone.cause.cause.message, 'root');
  assert.equal('cause' in clone.cause.cause, false);
});

test('errors whose causes form a cycle', { skip: !clonesCause }, () => {
  const a = new Error('a');
  const b = new Error('b', { cause: a });
  a.cause = b;
  const clone = structuredClone(toCloneable({ a }));
  assert.equal(clone.a.cause.cause, clone.a);
});

test('detached buffers and views over them are removed', { skip: !('detached' in ArrayBuffer.prototype) }, () => {
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  assert.throws(() => structuredClone(buffer));
  assert.deepEqual(toCloneable({ buffer, view, ok: 1 }), { ok: 1 });
});

test('transferables are removed unless listed in options.transfer', () => {
  const { port1, port2 } = new MessageChannel();
  try {
    assert.deepEqual(toCloneable({ port: port1 }), {});
    const output = toCloneable({ port: port1, fn }, { transfer: [port1] });
    assert.deepEqual(Object.keys(output), ['port']);
    assert.equal(output.port, port1);
    const buffer = new ArrayBuffer(8);
    assert.equal(toCloneable({ buffer }, { transfer: [buffer] }).buffer, buffer);
  } finally {
    port1.close();
    port2.close();
  }
});

test('deeply nested input does not overflow the stack', () => {
  const root = {};
  let node = root;
  for (let i = 0; i < 200_000; i++) node = node.next = { fn };
  let depth = 0;
  for (node = toCloneable(root); node.next; node = node.next) depth++;
  assert.equal(depth, 200_000);
});

test('objects from another realm', async () => {
  const { runInNewContext } = await import('node:vm');
  const foreign = runInNewContext('({ a: 1, fn() {}, list: [1, () => {}], date: new Date(0), url: new URL("https://example.com/") })', { URL });
  const output = toCloneable(foreign);
  assert.equal(output.a, 1);
  assert.equal('fn' in output, false);
  assert.equal(output.list.length, 2);
  assert.equal(output.list[1], undefined);
  assert.equal(output.date, foreign.date);
  assert.equal('url' in output, false);
  structuredClone(output);
});

test('the result of a cloneable input clones to the same thing', () => {
  const shared = { n: 1 };
  const inputs = [
    { a: [1, 'two', 3n, null, undefined, { deep: [new Date(1), /re/g] }] },
    new Map([[shared, new Set([shared, 1])]]),
    [new Uint16Array([1, 2]), new ArrayBuffer(4), new Error('e', { cause: new TypeError('c') })],
    Object.assign(Object.create({ inherited: 1 }), { own: 1 }),
    [, 1, , 2],
    { nested: { nested: { nested: [new Boolean(false), new String('s')] } } },
  ];
  for (const input of inputs) {
    assert.deepEqual(structuredClone(toCloneable(input)), structuredClone(input));
  }
});

test('survives a page that replaces array iteration', () => {
  // Built first: `new Map(entries)` itself iterates an array.
  const input = { list: [1, fn], map: new Map([[1, { fn }]]), error: new Error('e', { cause: { fn } }) };
  const original = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = () => {
    throw new Error('patched');
  };
  try {
    const output = toCloneable(input);
    assert.equal(output.list.length, 2);
    assert.equal(output.list[1], undefined);
    assert.equal(output.map.size, 1);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
});

test('a class without a brand check is not trusted by prototype alone', () => {
  const real = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  assert.equal(toCloneable(real), real);
  const impostor = Object.create(WebAssembly.Module.prototype);
  impostor.fn = fn;
  impostor.v = 1;
  assert.deepEqual(toCloneable(impostor), { v: 1 });
  structuredClone(toCloneable({ impostor }));
});
