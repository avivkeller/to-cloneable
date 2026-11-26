
const { getPrototypeOf, getOwnPropertyDescriptor, defineProperty, keys } = Object;
const ObjectPrototype = Object.prototype;
const { apply, construct } = Reflect;
const call = Function.prototype.call.bind(Function.prototype.call);
const { isArray } = Array;
const { isView } = ArrayBuffer;
const hasOwn = (object, key) => apply(ObjectPrototype.hasOwnProperty, object, [key]);
const functionToString = Function.prototype.toString;
const objectToString = ObjectPrototype.toString;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const detached = getOwnPropertyDescriptor(ArrayBuffer.prototype, 'detached')?.get;

// undefined, not false: a Symbol.toStringTag can hide a real error.
const isError =
  Error.isError ??
  ((value) => {
    if (apply(objectToString, value, []) === '[object Error]') return true;
    return value[Symbol.toStringTag] === undefined ? false : undefined;
  });

const REMOVED = Symbol('removed');

const ORDINARY = 0;
const KEEP = 1;
const REMOVE = 2;
const MAP = 3;
const SET = 4;
const ARRAY = 5;
const ERROR = 6;

const ordinary = { action: ORDINARY };
const removed = { action: REMOVE };

function resolve(path) {
  let value = globalThis;
  const parts = path.split('.');
  for (let i = 0; i < parts.length; i++) value = value?.[parts[i]];
  return typeof value === 'function' ? value : undefined;
}

// "x" is a getter, "x()" a method.
function findCheck(prototype, brand) {
  const method = brand.endsWith('()');
  const name = method ? brand.slice(0, -2) : brand;
  for (let p = prototype; p !== null && p !== ObjectPrototype; p = getPrototypeOf(p)) {
    const descriptor = getOwnPropertyDescriptor(p, name);
    const fn = method ? descriptor?.value : descriptor?.get;
    if (typeof fn === 'function') return fn;
  }
  return undefined;
}

function nativeConstructor(prototype) {
  try {
    if (!hasOwn(prototype, 'constructor')) return undefined;
    const { constructor } = prototype;
    return typeof constructor === 'function' &&
      constructor.prototype === prototype &&
      /\{\s*\[native code\]\s*\}\s*$/.test(apply(functionToString, constructor, []))
      ? constructor
      : undefined;
  } catch {
    return undefined;
  }
}

function passes(check, value) {
  try {
    call(check, value);
    return true;
  } catch {
    return false;
  }
}

function isDetached(value, entry) {
  if (detached === undefined) return false;
  const view = isView(value);
  if (!view && !entry.buffer) return false;
  try {
    return call(detached, view ? value.buffer : value) === true;
  } catch {
    return false; // a SharedArrayBuffer cannot be detached
  }
}

/**
 * @param {{
 *   keep: Record<string, string>,
 *   remove: string[],
 *   plain: string[],
 *   walks: Record<string, string[]>,
 * }} table
 */
export function create(table) {
  /** @type {Map<object, { action: number, buffer?: boolean, error?: boolean, check?: Function, walks?: string[] }>} */
  let byPrototype;
  let byName;
  let errorConstructors;
  const classified = new WeakMap();

  // Lazy, so polyfills installed after import are seen.
  const build = () => {
    byPrototype = new Map();
    byName = new Map();
    errorConstructors = new Map();
    const add = (path, entry) => {
      const constructor = resolve(path);
      const prototype = constructor?.prototype;
      if (prototype === null || typeof prototype !== 'object' || byPrototype.has(prototype)) return undefined;
      byPrototype.set(prototype, entry);
      byName.set(path.slice(path.lastIndexOf('.') + 1), entry);
      return constructor;
    };
    // For Object.create(Array.prototype); real arrays never get here.
    add('Array', ordinary);
    add('Map', { action: MAP });
    add('Set', { action: SET });
    for (const path in table.keep) {
      const entry = { action: KEEP };
      const constructor = add(path, entry);
      if (constructor === undefined) continue;
      const { prototype } = constructor;
      if (prototype === ArrayBuffer.prototype) entry.buffer = true;
      if (prototype === Error.prototype || apply(ObjectPrototype.isPrototypeOf, Error.prototype, [prototype])) {
        entry.error = true;
      }
      if (table.keep[path]) entry.check = findCheck(prototype, table.keep[path]);
      if (table.walks[path]) {
        entry.walks = table.walks[path];
        const name = getOwnPropertyDescriptor(prototype, 'name')?.value;
        if (typeof name === 'string') errorConstructors.set(name, constructor);
      }
    }
    for (let i = 0; i < table.remove.length; i++) add(table.remove[i], removed);
    for (let i = 0; i < table.plain.length; i++) add(table.plain[i], ordinary);
  };

  // An unlisted native class was never found to clone. Nor is an unlisted
  // native subclass of a listed one: being cloneable is not inherited.
  const classify = (prototype) => {
    let entry = classified.get(prototype);
    if (entry !== undefined) return entry;
    entry = ordinary;
    let native = false;
    for (let p = prototype; p !== null; p = getPrototypeOf(p)) {
      // Object.prototype, of any realm.
      if (getPrototypeOf(p) === null) break;
      let listed = byPrototype.get(p);
      if (listed === undefined) {
        const constructor = nativeConstructor(p);
        if (constructor !== undefined) {
          // Another realm's Date has its own prototype but the same name.
          listed = byName.get(constructor.name);
          native = true;
        }
      } else if (native) {
        listed = removed;
      }
      if (listed !== undefined) {
        entry = listed;
        native = false;
        break;
      }
    }
    if (native) entry = removed;
    classified.set(prototype, entry);
    return entry;
  };

  return function toCloneable(value, options) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return typeof value === 'symbol' ? undefined : value;
    }
    if (byPrototype === undefined) build();

    const seen = new Map();
    const stack = [];
    let clean;

    const transfer = options?.transfer;
    if (transfer != null) {
      for (const item of transfer) seen.set(item, item);
    }

    const defer = (kind, source, contents, target) => {
      seen.set(source, target);
      stack.push(kind, contents, target);
      return target;
    };

    const convert = (v) => {
      switch (typeof v) {
        case 'object':
          if (v === null) return v;
          break;
        case 'function':
        case 'symbol':
          return REMOVED;
        case 'undefined':
          // typeof document.all is 'undefined', and it does not clone.
          return v === undefined ? v : REMOVED;
        default:
          return v;
      }
      const known = seen.get(v);
      if (known !== undefined) return known;
      if (isArray(v)) return defer(ARRAY, v, v, new Array(v.length));
      const prototype = getPrototypeOf(v);
      if (prototype === ObjectPrototype || prototype === null) return defer(ORDINARY, v, v, {});
      const entry = classify(prototype);
      switch (entry.action) {
        case KEEP:
          return convertBuiltin(v, entry);
        case REMOVE:
          seen.set(v, REMOVED);
          return REMOVED;
        case MAP:
        case SET: {
          const contents = [];
          try {
            if (entry.action === MAP) apply(mapForEach, v, [(value, key) => contents.push(key, value)]);
            else apply(setForEach, v, [(value) => contents.push(value)]);
          } catch {
            break; // inherits from Map or Set without being one
          }
          return defer(entry.action, v, contents, entry.action === MAP ? new Map() : new Set());
        }
      }
      return defer(ORDINARY, v, v, {});
    };

    const convertBuiltin = (v, entry) => {
      // Without a brand, only an object with no own properties is safe to pass
      // through: those are what a clone would walk.
      const real =
        entry.check !== undefined
          ? passes(entry.check, v)
          : entry.error === true
            ? isError(v) === true
            : keys(v).length === 0;
      if (!real) return defer(ORDINARY, v, v, {});
      let result = v;
      if (isDetached(v, entry)) result = REMOVED;
      else if (entry.walks !== undefined && !isClean(v, entry)) {
        if (isError(v) === true) return defer(ERROR, v, v, replacementError(v));
        result = REMOVED;
      }
      seen.set(v, result);
      return result;
    };

    const isClean = (v, entry) => {
      clean ??= new Map();
      let result = clean.get(v);
      if (result !== undefined) return result;
      // A cycle of causes counts as dirty.
      clean.set(v, false);
      result = true;
      for (let i = 0; i < entry.walks.length; i++) {
        const name = entry.walks[i];
        if (hasOwn(v, name) && !passesThrough(v[name])) {
          result = false;
          break;
        }
      }
      clean.set(v, result);
      return result;
    };

    const passesThrough = (v) => {
      if (v === null) return true;
      if (typeof v !== 'object') return typeof v !== 'function' && typeof v !== 'symbol';
      if (seen.has(v)) return seen.get(v) === v;
      if (isArray(v)) return false;
      const prototype = getPrototypeOf(v);
      if (prototype === null) return false;
      const entry = classify(prototype);
      return entry.action === KEEP && entry.walks !== undefined && isError(v) === true && isClean(v, entry);
    };

    const replacementError = (v) => {
      const message = getOwnPropertyDescriptor(v, 'message');
      const { name, stack: trace } = v;
      const out = construct(
        Error,
        message !== undefined && 'value' in message ? [String(message.value)] : [],
        (typeof name === 'string' && errorConstructors.get(name)) || Error,
      );
      if (typeof trace === 'string') {
        defineProperty(out, 'stack', { value: trace, writable: true, enumerable: false, configurable: true });
      }
      return out;
    };

    const set = (target, key, value) => {
      if (key === '__proto__') {
        defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
      } else {
        target[key] = value;
      }
    };

    const result = convert(value);
    while (stack.length > 0) {
      const target = stack.pop();
      const source = stack.pop();
      switch (stack.pop()) {
        // No for-of: a page can replace Array.prototype[Symbol.iterator].
        case ORDINARY: {
          const names = keys(source);
          for (let i = 0; i < names.length; i++) {
            const key = names[i];
            const item = convert(source[key]);
            if (item !== REMOVED) set(target, key, item);
          }
          break;
        }
        case ARRAY: {
          const names = keys(source);
          const { length } = names;
          // Keys list indices first, in order, so this means dense with no named
          // properties.
          if (length === source.length && (length === 0 || names[length - 1] === String(length - 1))) {
            for (let i = 0; i < length; i++) {
              const item = convert(source[i]);
              // Keep the slot, or later indices shift.
              target[i] = item === REMOVED ? undefined : item;
            }
            break;
          }
          for (let i = 0; i < length; i++) {
            const key = names[i];
            const item = convert(source[key]);
            if (item !== REMOVED) set(target, key, item);
            else if (String(key >>> 0) === key && key >>> 0 !== 0xffffffff) target[key] = undefined;
          }
          break;
        }
        case MAP:
          for (let i = 0; i < source.length; i += 2) {
            const key = convert(source[i]);
            const item = convert(source[i + 1]);
            if (key !== REMOVED && item !== REMOVED) target.set(key, item);
          }
          break;
        case SET:
          for (let i = 0; i < source.length; i++) {
            const item = convert(source[i]);
            if (item !== REMOVED) target.add(item);
          }
          break;
        case ERROR: {
          const { walks } = classify(getPrototypeOf(source));
          for (let i = 0; i < walks.length; i++) {
            const key = walks[i];
            if (key === 'stack' || !hasOwn(source, key)) continue;
            const item = convert(source[key]);
            if (item !== REMOVED) {
              defineProperty(target, key, { value: item, writable: true, enumerable: false, configurable: true });
            }
          }
          break;
        }
      }
    }
    return result === REMOVED ? undefined : result;
  };
}
