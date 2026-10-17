/**
 * Instant frame switching (issue #94): an LRU of parsed GLBs and the order in
 * which to prefetch a model's neighbours. Pure (no three.js, no Vue), so the
 * eviction and the neighbour order are unit-tested.
 */

export interface LruCache<K, V> {
  /** The value, marked most recently used; undefined when absent. */
  get(key: K): V | undefined
  has(key: K): boolean
  /** Insert (or replace) as most recently used, then evict over capacity. */
  set(key: K, value: V): void
  delete(key: K): boolean
  /** Change the capacity, evicting at once if it shrank. */
  resize(capacity: number): void
  /** Keys, least recently used first. */
  keys(): K[]
  /** Dispose and remove everything. */
  clear(): void
  readonly size: number
}

/**
 * Least-recently-used cache with a capacity in entries. `dispose` runs on
 * every value that leaves (evicted, replaced, deleted, cleared). `pinned`
 * keys are never evicted (the frame on screen): the cache may then run over
 * capacity until they are unpinned.
 */
export function createLruCache<K, V>(
  capacity: number,
  dispose: (value: V, key: K) => void = () => {},
  pinned: (key: K) => boolean = () => false
): LruCache<K, V> {
  const entries = new Map<K, V>()
  let limit = Math.max(capacity, 1)

  function evict() {
    if (entries.size <= limit) return
    for (const [key, value] of entries) {
      if (entries.size <= limit) break
      if (pinned(key)) continue
      entries.delete(key)
      dispose(value, key)
    }
  }

  return {
    get(key) {
      const value = entries.get(key)
      if (value === undefined) return undefined
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    has: (key) => entries.has(key),
    set(key, value) {
      const previous = entries.get(key)
      entries.delete(key)
      entries.set(key, value)
      if (previous !== undefined && previous !== value) dispose(previous, key)
      evict()
    },
    delete(key) {
      const value = entries.get(key)
      if (value === undefined) return false
      entries.delete(key)
      dispose(value, key)
      return true
    },
    resize(next) {
      limit = Math.max(next, 1)
      evict()
    },
    keys: () => [...entries.keys()],
    clear() {
      const all = [...entries]
      entries.clear()
      for (const [key, value] of all) dispose(value, key)
    },
    get size() {
      return entries.size
    }
  }
}

/**
 * Files to prefetch around `active` in catalog order: the next and previous
 * models first (usually the neighbouring colourways), then one further out
 * each side, up to `perSide` each way. No wrap-around.
 */
export function neighbourFiles(
  files: readonly string[],
  active: string | undefined,
  perSide: number
): string[] {
  const index = active === undefined ? -1 : files.indexOf(active)
  if (index < 0 || perSide <= 0) return []
  const out: string[] = []
  for (let step = 1; step <= perSide; step++) {
    const next = files[index + step]
    const previous = files[index - step]
    if (next !== undefined && next !== active) out.push(next)
    if (previous !== undefined && previous !== active) out.push(previous)
  }
  return [...new Set(out)]
}

/** Cache capacity per tier: low-tier devices keep the current frame and one more. */
export function modelCacheCapacity(lowTier: boolean, preload: number): number {
  if (lowTier) return 2
  // The frame on screen, its neighbours, and room for the one just left.
  return Math.min(Math.max(2 + 2 * preload, 4), 6)
}
