export interface ToCloneableOptions {
  /**
   * The same list you pass to `postMessage` or `structuredClone`. Objects in
   * it are kept as they are: a `MessagePort` only clones when transferred.
   */
  transfer?: Iterable<object>;
}

type Removed = symbol | ((...args: any[]) => unknown) | (abstract new (...args: any[]) => unknown);
type Primitive = string | number | bigint | boolean | null | undefined;
type Leaf = Date | RegExp | Error | ArrayBuffer | ArrayBufferView | Boolean | Number | String;

/** An approximation: which built-in classes clone is decided per runtime. */
export type Cloneable<T> = T extends Removed
  ? undefined
  : T extends Primitive | Leaf
    ? T
    : T extends Map<infer K, infer V>
      ? Map<Cloneable<K>, Cloneable<V>>
      : T extends Set<infer U>
        ? Set<Cloneable<U>>
        : T extends readonly unknown[]
          ? { -readonly [I in keyof T]: Cloneable<T[I]> }
          : T extends object
            ? { [K in keyof T as K extends symbol ? never : T[K] extends Removed ? never : K]: Cloneable<T[K]> }
            : T;

/**
 * Returns a version of `value` that `structuredClone`, `postMessage` and
 * worker threads accept, without modifying `value`.
 *
 * Whatever would throw a `DataCloneError` is removed. A removed object
 * property, `Map` entry or `Set` member disappears; a removed array element
 * becomes `undefined`; a removed top-level value yields `undefined`.
 */
export function toCloneable<T>(value: T, options?: ToCloneableOptions): Cloneable<T>;
