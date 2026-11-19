/** Memoises a zero-argument factory: runs it on first call, then caches. */
export function lazy<T>(fn: () => T): () => T {
  let cache: { value: T } | undefined;
  return () => (cache ??= { value: fn() }).value;
}
