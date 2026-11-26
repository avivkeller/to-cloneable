export async function observe(onSample) {
  const g = globalThis;
  const getProto = Object.getPrototypeOf;
  const root = Object.prototype;
  const attempt = (fn) => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const isObject = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');

  const found = [];
  const scan = (owner, prefix, deep) => {
    for (const key of attempt(() => Object.getOwnPropertyNames(owner)) ?? []) {
      if (!/^[A-Z]/.test(key)) continue;
      const value = attempt(() => owner[key]);
      if (typeof value === 'function') found.push([prefix + key, value]);
      else if (deep && isObject(value)) scan(value, `${key}.`, false);
    }
  };
  scan(g, '', true);
  found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const classes = new Map();
  const pathOf = new Map();
  for (const [path, constructor] of found) {
    const prototype = attempt(() => constructor.prototype);
    if (!isObject(prototype) || typeof prototype === 'function' || prototype === root || pathOf.has(prototype)) continue;
    classes.set(path, constructor);
    pathOf.set(prototype, path);
  }

  const samples = new Map();
  // Often only an instance of an unexposed subclass exists (a generator for
  // Iterator, Node's InternalCryptoKey for CryptoKey); a direct one replaces it.
  const indirect = new Set();
  let grew = false;
  const adopt = (value) => {
    if (!isObject(value)) return;
    let path;
    let direct = true;
    for (let p = attempt(() => getProto(value)); p && p !== root; p = getProto(p), direct = false) {
      path = pathOf.get(p);
      if (path !== undefined) break;
    }
    if (path === undefined || (samples.has(path) && !(direct && indirect.has(path)))) return;
    if (direct) indirect.delete(path);
    else indirect.add(path);
    samples.set(path, value);
    grew = true;
  };
  const adoptAll = (value) => {
    adopt(value);
    if (Array.isArray(value)) value.forEach(adopt);
  };

  // The bytes are an empty WebAssembly module: a generic BufferSource that
  // WebAssembly.Module also accepts.
  const generic = () => [0, 1, 'about:blank', 0n, function () {}, {}, [], new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])];
  const tuples = (pool, length) =>
    length === 0 ? [[]] : tuples(pool, length - 1).flatMap((head) => pool.map((value) => [...head, value]));
  const construct = (C, pool) => {
    const usable = (instance) => isObject(instance) && attempt(() => C.prototype.isPrototypeOf(instance));
    const arities = [...new Set([Math.min(attempt(() => C.length) ?? 0, 3), 0, 1, 2])];
    for (const arity of arities) {
      // Found instances only fill single-argument calls; pairing them would be
      // quadratic in the number of classes.
      for (const args of tuples(arity === 1 ? pool : generic(), arity)) {
        const instance = attempt(() => new C(...args));
        if (usable(instance)) return instance;
      }
    }
    // Symbol and BigInt are not constructors: sample the wrapper object.
    for (const args of [[], [0]]) {
      const primitive = attempt(() => C(...args));
      if (primitive !== undefined && primitive !== null && !isObject(primitive)) {
        const wrapper = Object(primitive);
        if (usable(wrapper)) return wrapper;
      }
    }
    return undefined;
  };

  const explore = (objects) => {
    for (let depth = 0, level = objects; depth < 2; depth++) {
      const next = [];
      for (const object of level) {
        for (let p = object; isObject(p) && p !== root; p = attempt(() => getProto(p))) {
          for (const name of attempt(() => Object.getOwnPropertyNames(p)) ?? []) {
            const value = attempt(() => object[name]);
            const before = samples.size;
            adoptAll(value);
            if (samples.size > before) next.push(value);
          }
        }
      }
      level = next;
    }
  };

  // CryptoKey clones but cannot be constructed, and Node and Deno have no
  // engine source to infer it from. The race covers promises that never settle.
  adoptAll(
    await attempt(() =>
      Promise.race([
        crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt']).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]),
    ),
  );

  const globals = [];
  for (const key of attempt(() => Object.getOwnPropertyNames(g)) ?? []) {
    const value = /^[a-z]/.test(key) ? attempt(() => g[key]) : undefined;
    if (isObject(value) && typeof value !== 'function') globals.push(value);
  }
  globals.forEach(adopt);
  explore(globals);

  do {
    grew = false;
    const pool = [...generic(), ...samples.values()];
    for (const [path, C] of classes) {
      if (samples.has(path) && !indirect.has(path)) continue;
      const instance = construct(C, pool);
      if (instance === undefined) continue;
      indirect.delete(path);
      samples.set(path, instance);
      grew = true;
    }
    explore([...samples.values()]);
  } while (grew);

  const cloneOf = (instance) => {
    const copy = attempt(() => [structuredClone(instance)]);
    if (copy === undefined) return 'throw';
    return isObject(copy[0]) && getProto(copy[0]) !== root ? 'clone' : 'plain';
  };
  const throwsOn = (fn, self) => {
    try {
      // Promise-returning getters (a stream writer's `ready`) reject instead
      // of throwing; that rejection must not go unhandled.
      const value = fn.call(self);
      if (typeof value?.then === 'function') attempt(() => value.then(undefined, () => {}));
      return false;
    } catch {
      return true;
    }
  };

  const brandsOf = (C, instance) => {
    const chain = [];
    for (let p = C.prototype; p !== null && p !== root; p = getProto(p)) chain.unshift(p);
    const impostor = attempt(() => Object.create(C.prototype));
    if (impostor === undefined) return [];
    const brands = [];
    const consider = (label, fn) => {
      if (typeof fn !== 'function' || brands.includes(label)) return;
      if (instance !== undefined && throwsOn(fn, instance)) return;
      if (throwsOn(fn, impostor)) brands.push(label);
    };
    for (const p of chain) {
      for (const key of Object.getOwnPropertyNames(p).sort()) {
        consider(key, attempt(() => Object.getOwnPropertyDescriptor(p, key))?.get);
      }
    }
    for (const p of chain) consider('valueOf()', Object.getOwnPropertyDescriptor(p, 'valueOf')?.value);
    return brands;
  };

  // V8 serializes an error's `cause`, SpiderMonkey also `errors`, Node a
  // DOMException's `stack`: a function there makes the clone throw.
  const walksOf = (instance) => {
    const walks = [];
    for (const name of ['cause', 'errors', 'stack']) {
      const before = attempt(() => Object.getOwnPropertyDescriptor(instance, name));
      const defined = attempt(() =>
        Object.defineProperty(instance, name, { value() {}, writable: true, configurable: true, enumerable: false }),
      );
      if (defined === undefined) continue;
      if (cloneOf(instance) === 'throw') walks.push(name);
      attempt(() => (before ? Object.defineProperty(instance, name, before) : delete instance[name]));
    }
    return walks;
  };

  const records = {};
  for (const [path, C] of classes) {
    let parent = null;
    for (let p = getProto(C.prototype); p !== null && p !== root; p = getProto(p)) {
      if (pathOf.has(p)) {
        parent = pathOf.get(p);
        break;
      }
    }
    const native = attempt(() => /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(C))) ?? false;
    const instance = samples.get(path);
    if (instance !== undefined && onSample) onSample(path, instance);
    const result = instance === undefined ? 'unsampled' : cloneOf(instance);
    records[path] = {
      result,
      native,
      parent,
      brands: result === 'clone' || result === 'unsampled' ? brandsOf(C, instance) : [],
      walks: result === 'clone' ? walksOf(instance) : [],
    };
  }
  return records;
}
