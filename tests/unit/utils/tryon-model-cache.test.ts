import { describe, expect, it } from 'vitest'
import {
  createLruCache,
  modelCacheCapacity,
  neighbourFiles
} from '../../../src/runtime/utils/tryon-model-cache'

describe('createLruCache', () => {
  function tracked(capacity: number, pinned: (key: string) => boolean = () => false) {
    const disposed: string[] = []
    const cache = createLruCache<string, string>(capacity, (value) => disposed.push(value), pinned)
    return { cache, disposed }
  }

  it('evicts the least recently used entry and disposes it', () => {
    const { cache, disposed } = tracked(2)
    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.get('a') // a is now the most recent
    cache.set('c', 'C')
    expect(cache.keys()).toEqual(['a', 'c'])
    expect(disposed).toEqual(['B'])
  })

  it('never evicts a pinned entry', () => {
    const { cache, disposed } = tracked(2, (key) => key === 'a')
    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.set('c', 'C')
    expect(cache.keys()).toEqual(['a', 'c'])
    expect(disposed).toEqual(['B'])
  })

  it('runs over capacity while only pinned entries are left to evict', () => {
    const { cache, disposed } = tracked(1, () => true)
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.size).toBe(2)
    expect(disposed).toEqual([])
  })

  it('disposes a replaced value, but not the same one set again', () => {
    const { cache, disposed } = tracked(3)
    cache.set('a', 'A')
    cache.set('a', 'A')
    expect(disposed).toEqual([])
    cache.set('a', 'A2')
    expect(disposed).toEqual(['A'])
    expect(cache.get('a')).toBe('A2')
  })

  it('evicts at once when shrunk, and disposes everything on clear', () => {
    const { cache, disposed } = tracked(4)
    for (const key of ['a', 'b', 'c', 'd']) cache.set(key, key.toUpperCase())
    cache.resize(2)
    expect(cache.keys()).toEqual(['c', 'd'])
    expect(disposed).toEqual(['A', 'B'])
    cache.clear()
    expect(cache.size).toBe(0)
    expect(disposed).toEqual(['A', 'B', 'C', 'D'])
  })

  it('disposes a deleted entry', () => {
    const { cache, disposed } = tracked(2)
    cache.set('a', 'A')
    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(disposed).toEqual(['A'])
  })

  it('stays bounded over 50 switches', () => {
    const { cache, disposed } = tracked(4)
    for (let i = 0; i < 50; i++) cache.set(`m${i % 7}`, `M${i}`)
    expect(cache.size).toBe(4)
    // Every value that left was disposed exactly once.
    expect(disposed.length + cache.size).toBe(50)
    expect(new Set(disposed).size).toBe(disposed.length)
  })
})

describe('neighbourFiles', () => {
  const files = ['a', 'b', 'c', 'd', 'e']

  it('takes the next and previous first, then further out', () => {
    expect(neighbourFiles(files, 'c', 1)).toEqual(['d', 'b'])
    expect(neighbourFiles(files, 'c', 2)).toEqual(['d', 'b', 'e', 'a'])
  })

  it('does not wrap around the catalog', () => {
    expect(neighbourFiles(files, 'a', 2)).toEqual(['b', 'c'])
    expect(neighbourFiles(files, 'e', 1)).toEqual(['d'])
  })

  it('is empty when off or for an unknown file', () => {
    expect(neighbourFiles(files, 'c', 0)).toEqual([])
    expect(neighbourFiles(files, 'x', 1)).toEqual([])
    expect(neighbourFiles(files, undefined, 1)).toEqual([])
  })
})

describe('modelCacheCapacity', () => {
  it('keeps two GLBs on the low tier', () => {
    expect(modelCacheCapacity(true, 3)).toBe(2)
  })

  it('fits the frame on screen, its neighbours and the last one, capped at 6', () => {
    expect(modelCacheCapacity(false, 0)).toBe(4)
    expect(modelCacheCapacity(false, 1)).toBe(4)
    expect(modelCacheCapacity(false, 2)).toBe(6)
    expect(modelCacheCapacity(false, 5)).toBe(6)
  })
})
