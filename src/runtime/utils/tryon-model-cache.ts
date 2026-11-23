export interface LruCache<K, V> {
  get(key: K): V | undefined
  has(key: K): boolean
  set(key: K, value: V): void
  delete(key: K): boolean
  resize(capacity: number): void
  keys(): K[]
  clear(): void
  readonly size: number
}

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

export function modelCacheCapacity(lowTier: boolean, preload: number): number {
  if (lowTier) return 2
  return Math.min(Math.max(2 + 2 * preload, 4), 6)
}
