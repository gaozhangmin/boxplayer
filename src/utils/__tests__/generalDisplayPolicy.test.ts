import { describe, expect, it } from 'vitest'
import { displayScopeAllows } from '../seriesVersionPreferences'
describe('general display media scopes', () => {
  it.each([
    ['all', true, true], ['all', false, true],
    ['tv', true, false], ['tv', false, true],
    ['movie', true, true], ['movie', false, false],
    ['off', true, false], ['off', false, false],
    ['invalid', true, false], ['invalid', false, false]
  ])('%s for movie=%s returns %s', (scope, movie, expected) => {
    expect(displayScopeAllows(String(scope), Boolean(movie))).toBe(expected)
  })
})
