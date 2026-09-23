import { describe, expect, it } from 'vitest'
import { normalizeLinuxMpvStatus } from '../../mpv/embeddedMpvLinuxHost'

describe('normalizeLinuxMpvStatus', () => {
  it('derives paused from the native playing flag', () => {
    expect(normalizeLinuxMpvStatus({ playing: false, position: 2 })).toMatchObject({ playing: false, paused: true, position: 2, speed: 1 })
    expect(normalizeLinuxMpvStatus({ playing: true, position: 3 })).toMatchObject({ playing: true, paused: false, position: 3, speed: 1 })
  })

  it('preserves explicit pause and speed values from future native hosts', () => {
    expect(normalizeLinuxMpvStatus({ playing: true, paused: true, speed: 1.5 })).toMatchObject({ playing: true, paused: true, speed: 1.5 })
  })
})
