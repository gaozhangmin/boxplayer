import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../components/MediaDetail.vue', import.meta.url), 'utf8')

describe('media detail episode heading layout', () => {
  it('aligns the episode heading to the start of its column-flex copy container', () => {
    const styles = source.slice(source.indexOf('<style'))
    const headingRules = styles.match(/#xbybody \.media-detail \.hero-logo,\s*#xbybody \.media-detail \.hero-episode-title\s*\{([^}]+)\}/)?.[1]
    expect(headingRules).toContain('align-self: flex-start')
    expect(headingRules).not.toMatch(/align-self:\s*end\s*;/)
    expect(styles).toMatch(/\.hero-copy \.hero-episode-title\s*\{[^}]*max-width: 100%;[^}]*text-align: left;[^}]*overflow-wrap: anywhere;/)
  })
})
