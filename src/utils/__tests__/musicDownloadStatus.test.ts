import { describe, it, expect } from 'vitest'
import { downloadTrackKey, musicDownloadStatus } from '../musicDownloadStatus'

describe('music download state', () => {
  it('isolates the same file ID across accounts and drives', () => {
    const a = { user_id: 'a', drive_id: 'drive', file_id: 'song' }
    expect(downloadTrackKey(a)).not.toBe(downloadTrackKey({ ...a, user_id: 'b' }))
    expect(downloadTrackKey(a)).not.toBe(downloadTrackKey({ ...a, drive_id: 'other' }))
  })
  it('does not infer completion from transferred bytes before commit', () => {
    expect(musicDownloadStatus('downloading', 100, 100)).toEqual({ phase: 'downloading', progress: 1 })
  })
  it('keeps unknown lengths indeterminate', () => {
    expect(musicDownloadStatus('downloading', 100, 0).progress).toBeUndefined()
    expect(musicDownloadStatus('downloading', NaN, 100).progress).toBeUndefined()
  })
  it('bounds the rendered percentage and preserves failure', () => {
    expect(musicDownloadStatus('failed', 200, 100)).toEqual({ phase: 'failed', progress: 1 })
    expect(musicDownloadStatus('paused', -10, 100).progress).toBe(0)
  })
  it('shows completion when the task reports completion even without a size', () => {
    expect(musicDownloadStatus('completed', 0, 0)).toEqual({ phase: 'completed', progress: 1 })
  })
})
