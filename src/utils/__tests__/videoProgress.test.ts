import { afterEach, describe, expect, it } from 'vitest'
import { directVideoPosition, readDirectVideoHistory, saveDirectVideoProgress, getLocalVideoProgress, saveLocalVideoProgress, videoProgressStorageKey } from '../videoProgress'

const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) || null,
  setItem: (key: string, value: string) => values.set(key, value)
}

describe('local video progress', () => {
  afterEach(() => {
    values.clear()
    delete (globalThis as any).window
  })

  it('saves and reads progress by account, drive, and file', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
    saveLocalVideoProgress('user-1', 'drive115', 'file-1', 123.9)
    expect(getLocalVideoProgress('user-1', 'drive115', 'file-1')).toBe(123)
    expect(values.has(videoProgressStorageKey('user-1', 'drive115', 'file-1'))).toBe(true)
  })

  it('ignores invalid progress values', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
    saveLocalVideoProgress('user-1', 'drive115', 'file-1', 0)
    expect(getLocalVideoProgress('user-1', 'drive115', 'file-1')).toBe(0)
  })

  it('normalizes the 115 drive alias to the canonical drive id', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
    saveLocalVideoProgress('user-1', '115', 'file-1', 456)
    expect(getLocalVideoProgress('user-1', 'drive115', 'file-1')).toBe(456)
    expect(values.has(videoProgressStorageKey('user-1', 'drive115', 'file-1'))).toBe(true)
  })
  it('keeps direct viewing and scraped playback independent, including across accounts', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
    const file = { user_id: 'user-1', drive_id: '115', file_id: 'file-1', parent_file_id: 'folder', file_name: 'video.mkv' }
    saveLocalVideoProgress('user-1', 'drive115', 'file-1', 120)
    saveDirectVideoProgress(file, 42, 300)
    expect(directVideoPosition({ ...file, drive_id: 'drive115' })).toBe(42)
    expect(directVideoPosition({ ...file, user_id: 'user-2' })).toBe(0)
    expect(getLocalVideoProgress('user-1', 'drive115', 'file-1')).toBe(120)
    expect(readDirectVideoHistory()[0]).toMatchObject({ file_name: 'video.mkv', position: 42, duration: 300 })

    saveDirectVideoProgress(file, 14, 300)
    expect(directVideoPosition(file)).toBe(14)
    saveDirectVideoProgress(file, 0, 0, true)
    expect(readDirectVideoHistory()).toEqual([])
    expect(getLocalVideoProgress('user-1', 'drive115', 'file-1')).toBe(120)
  })
})
