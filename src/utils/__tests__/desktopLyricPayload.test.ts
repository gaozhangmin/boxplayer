import { describe, expect, it } from 'vitest'
import { flowingAppearance, normalizeLyricPayload } from '../desktopLyricPayload'

describe('desktop lyric widget payload', () => {
  it('adapts current/next line and playback state sent by the player', () => {
    const data = normalizeLyricPayload({ text: 'current', next: 'next', playing: true, locked: false })
    expect(data.lines.map((line: { text: string }) => line.text)).toEqual(['current', 'next'])
    expect(data.activeIndex).toBe(0)
    expect(data.isPlaying).toBe(true)
    expect(data.isLocked).toBe(false)
  })
  it('retains flowing mode and all three custom colors', () => {
    expect(flowingAppearance({ presentation: 'flowing', flowingColors: { text: '#123456', light: '#ABCDEF', background: '#010203' } }))
      .toEqual({ presentation: 'flowing', colors: { text: '#123456', light: '#ABCDEF', background: '#010203' } })
  })
  it('defaults legacy or malformed appearance fields safely', () => {
    expect(flowingAppearance({ presentation: 'unknown', flowingColors: { text: 'red', light: '#abc', background: null } }))
      .toEqual({ presentation: 'standard', colors: { text: '#D6ADFF', light: '#9850FF', background: '#090310' } })
  })
})
