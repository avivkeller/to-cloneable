# to-cloneable

Makes any value safe for `structuredClone`, `postMessage` and worker threads.
Whatever would throw a `DataCloneError` is removed; everything else is left as
a structured clone would see it.

```js
import { toCloneable } from 'to-cloneable';

const state = {
  user: { name: 'Ada', joined: new Date() },
  onChange() {},
  endpoint: new URL('https://example.com/'),
  tags: new Set(['a', Symbol('b')]),
};

worker.postMessage(state); // DataCloneError
worker.postMessage(toCloneable(state)); // { user: { name, joined }, tags: Set { 'a' } }
```

Zero dependencies. Works in Node.js, Deno, Bun and browsers.

## Behavior

| Input                                                         | Result                                           |
| ------------------------------------------------------------- | ------------------------------------------------ |
| Functions, symbols, uncloneable built-ins (`URL`, `Promise`…) | Removed                                          |
| Cloneable built-ins (`Date`, buffers, `Blob`, `CryptoKey`…)   | Passed through by reference                      |
| Objects, class instances, proxies                             | New plain object of own enumerable properties    |
| Arrays, `Map`, `Set`                                          | New container, contents sanitized                |
| Errors                                                        | Passed through; rebuilt if their `cause` changed |

A removed property, `Map` entry or `Set` member disappears. A removed array
element becomes `undefined`, so indices do not shift. Cycles and shared
references are preserved, and the input is never modified.

It sanitizes without cloning, because whatever receives the result clones
anyway. For a copy, use `structuredClone(toCloneable(value))`.

Transferables such as `MessagePort` are removed unless you pass the same
transfer list you give `postMessage`:

```js
port.postMessage(toCloneable(message, { transfer }), transfer);
```

## Per-runtime tables

Which built-ins clone differs between runtimes. Each has its own generated
entry point, chosen by export condition (`bun`, `deno`, `node`, otherwise
browser) or imported directly as `to-cloneable/node` and so on. Nothing is
decided by calling `structuredClone` at run time.

The browser entry point serves every engine, so it keeps a class only if all
of them clone it.

## How the tables are generated

`generate/` observes each runtime: it finds every built-in class, obtains a
live instance, and records what `structuredClone` does with it. For classes it
cannot instantiate, it keeps one only if the engine's own source lists it and
the Web IDL marks it `[Serializable]`. A weekly workflow regenerates all four
and opens a pull request describing what changed and where the sources
disagree.

```sh
npm run generate           # this runtime (also: deno run -A / bun generate/index.mjs)
npm run generate:browser   # after `npx playwright install`
```

## Limits

- A native class that was neither observed nor confirmed by source and spec is
  removed, which can drop something cloneable.
- Classes that are not globals (Node's `KeyObject`) are treated as plain objects.
- The TypeScript return type is an approximation.

## License

MIT
