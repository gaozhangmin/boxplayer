import { describe, expect, it } from 'vitest'
import { detailResumeState, detailSeriesId, videoDurationSeconds } from '../detailResume'

describe('detail resume button', () => {
  it('keeps the entire series ID instead of sharing progress between all tv_* items', () => {
    expect(detailSeriesId('tv_123')).toBe('tv_123')
    expect(detailSeriesId('tv_123_2_1')).toBe('tv_123')
    expect(detailSeriesId('custom_series_name_1_2')).toBe('custom_series_name')
  })
  it('shows the last position, not duration or percent', () => {
    expect(detailResumeState(932.9, 2400)).toEqual({ label: '继续播放：15:32', percent: 932.9 / 2400 * 100 })
    expect(detailResumeState(3731, 7200)?.label).toBe('继续播放：1:02:11')
  })
  it('keeps server progress when duration is unavailable and clamps the fill', () => {
    expect(detailResumeState(100, undefined, 24)?.percent).toBe(24)
    expect(detailResumeState(300, 100)?.percent).toBe(100)
    expect(detailResumeState(300, undefined)?.percent).toBe(0)
  })
  it('preserves percentage-only history when file duration and position are unavailable', () => {
    expect(detailResumeState(0, 0, 40)).toEqual({ label: '继续播放', percent: 40 })
    expect(detailResumeState(undefined, undefined, 40)?.percent).toBe(40)
    for (const percent of [0, -1, 100, NaN, Infinity]) {
      expect(detailResumeState(0, 0, percent)).toBeNull()
    }
  })
  it('does not show resume for empty or invalid history', () => {
    for (const position of [undefined, 0, -1, NaN, Infinity]) expect(detailResumeState(position, 100)).toBeNull()
  })
  it('reads numeric and clock-formatted file durations', () => {
    expect(videoDurationSeconds('2400')).toBe(2400)
    expect(videoDurationSeconds('01:02:11')).toBe(3731)
    expect(videoDurationSeconds('invalid')).toBe(0)
  })
})
