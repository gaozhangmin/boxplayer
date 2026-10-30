import { describe, expect, it } from 'vitest'
import { buildMpvLoadOptions } from '../../mpv/embeddedMpvLoadOptions'

describe('embedded MPV load options', () => {
  it('disables video and cover art for music while retaining authentication', () => {
    expect(buildMpvLoadOptions({ audioOnly: true, headers: { Authorization: 'Bearer music' } }))
      .toBe('vid=no,sid=no,http-header-fields=%27%Authorization: Bearer music')
    expect(buildMpvLoadOptions({ audioOnly: false })).toBe('')
  })
  it('passes authenticated media headers to loadfile', () => {
    expect(buildMpvLoadOptions({
      headers: {
        Authorization: 'Bearer token-115',
        'User-Agent': 'aDrive/4.12.0'
      },
      startPosition: 108
    })).toBe('start=108,user-agent=aDrive/4.12.0,http-header-fields=%31%Authorization: Bearer token-115')
  })

  it('escapes commas inside an Emby authorization header', () => {
    expect(buildMpvLoadOptions({
      headers: {
        'X-Emby-Authorization': 'MediaBrowser Token="token", UserId="user", Client="BoxPlayer"',
        'X-Emby-Token': 'token'
      }
    })).toBe('http-header-fields=%105%X-Emby-Authorization: MediaBrowser Token="token"\\, UserId="user"\\, Client="BoxPlayer",X-Emby-Token: token')
  })

  it('preserves every header required by cloud drive playback', () => {
    expect(buildMpvLoadOptions({
      headers: {
        Authorization: 'Bearer cloud-token',
        Cookie: 'sid=quark',
        'User-Agent': 'BoxPlayer-Cloud',
        Referer: 'https://pan.example/',
        Origin: 'https://pan.example',
        'x-urlp': 'signed-value'
      }
    })).toBe('user-agent=BoxPlayer-Cloud,referrer=https://pan.example/,http-header-fields=%100%Authorization: Bearer cloud-token,Cookie: sid=quark,Origin: https://pan.example,x-urlp: signed-value')
  })

  it('keeps Aliyun user-agent and referer compatible with the 5.0.37 load path', () => {
    expect(buildMpvLoadOptions({ headers: {
      'User-Agent': 'aDrive/4.12.0', Referer: 'https://www.aliyundrive.com/'
    } })).toBe('user-agent=aDrive/4.12.0,referrer=https://www.aliyundrive.com/')
  })

  it('quotes delimiter-bearing and non-ASCII values using UTF-8 byte lengths', () => {
    expect(buildMpvLoadOptions({ headers: { 'User-Agent': '播放器,1' } }))
      .toBe('user-agent=%11%播放器,1')
  })

  it('does not emit empty options', () => {
    expect(buildMpvLoadOptions({})).toBe('')
  })
})
