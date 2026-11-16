import { describe, expect, it } from 'vitest'
import { DEFAULT_MUSIC_FX, MUSIC_FX_PRESETS, normalizeMusicFxConfig, parseMusicFxConfigJson } from '../radio/FxConfig'

describe('unified visual interface choices', () => {
  it('keeps old particle preferences when the interface field is absent', () => {
    expect(normalizeMusicFxConfig({ intensity: 1.2, shelfMode: 'stage' })).toMatchObject({ playerInterface: 'particleStage', intensity: 1.2, shelfMode: 'stage' })
  })
  it('preserves clean playback and visual parameters in saved settings', () => {
    const clean = normalizeMusicFxConfig({ ...DEFAULT_MUSIC_FX, playerInterface: 'fresh', intensity: 1.2, skullPresetEnabled: true })
    expect(parseMusicFxConfigJson(JSON.stringify(clean))).toEqual(clean)
    expect(clean).toMatchObject({ playerInterface: 'fresh', intensity: 1.2, skullPresetEnabled: true })
  })
  it('returns to particle playback from each existing visual preset', () => {
    for (const preset of MUSIC_FX_PRESETS) expect(preset.config.playerInterface).toBe('particleStage')
  })
})
