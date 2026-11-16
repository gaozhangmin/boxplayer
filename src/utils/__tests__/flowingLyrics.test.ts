import { describe, expect, it } from 'vitest'
import { wrapFlowingText } from '../radio/FlowingLyrics'

const measure = (text: string) => Array.from(text).length

describe('flowing lyric wrapping', () => {
  it('wraps Chinese lyrics without dropping or duplicating characters', () => {
    const text = '为爱飞行脱离地心引力的热情'
    const lines = wrapFlowingText(text, 5, measure)
    expect(lines.join('')).toBe(text)
    expect(lines.every(line => measure(line) <= 5)).toBe(true)
  })
  it('keeps ordinary English words together', () => {
    expect(wrapFlowingText('light falling softly', 7, measure)).toEqual(['light', 'falling', 'softly'])
  })
  it('preserves explicit verse breaks including blank lines', () => {
    expect(wrapFlowingText('first\n\nlast', 20, measure)).toEqual(['first', '', 'last'])
  })
  it('splits overlong words without splitting surrogate pairs', () => {
    const text = 'A🌟B🌟C🌟D'
    const lines = wrapFlowingText(text, 2, measure)
    expect(lines.join('')).toBe(text)
    expect(lines.every(line => measure(line) <= 2)).toBe(true)
  })
})
