import { describe, expect, it } from 'vitest'
import { buildAriaAddOptions, resolveProviderDownloadSplit, shouldCheckExistingDownloadTarget, shouldReuseAriaDownloadUrl } from './aria2AddOptions'

describe('shouldReuseAriaDownloadUrl', () => {
  it('resolves a fresh link for a recreated Baidu account task', () => {
    expect(shouldReuseAriaDownloadUrl(true, false)).toBe(false)
  })

  it('preserves explicit links and the existing cache policy for other providers', () => {
    expect(shouldReuseAriaDownloadUrl(true, true)).toBe(true)
    expect(shouldReuseAriaDownloadUrl(false, false)).toBe(true)
    expect(shouldReuseAriaDownloadUrl(false, true)).toBe(true)
  })
})

describe('buildAriaAddOptions', () => {
  it('keeps HTTP-only options on URI downloads', () => {
    expect(buildAriaAddOptions({
      gid: 'g1',
      dir: '/tmp',
      split: 4,
      referer: 'https://www.aliyundrive.com/drive',
      userAgent: 'Chrome',
      headers: ['Authorization: Bearer token'],
      outFileName: 'movie.mkv',
      sourceType: 'url'
    })).toEqual({
      gid: 'g1',
      dir: '/tmp',
      split: 4,
      out: 'movie.mkv',
      referer: 'https://www.aliyundrive.com/drive',
      'user-agent': 'Chrome',
      header: ['Authorization: Bearer token']
    })
  })

  it('does not pass HTTP-only options to local torrent tasks', () => {
    expect(buildAriaAddOptions({
      gid: 'g1',
      dir: '/tmp',
      split: 4,
      referer: 'https://www.aliyundrive.com/drive',
      userAgent: 'Chrome',
      headers: ['User-Agent: Chrome', 'Authorization: Bearer token'],
      outFileName: 'movie.mkv',
      sourceType: 'torrent'
    })).toEqual({
      gid: 'g1',
      dir: '/tmp',
      split: 4
    })
  })

  it('passes selected torrent file indexes to BT tasks', () => {
    expect(buildAriaAddOptions({
      gid: 'g1',
      dir: '/tmp',
      split: 4,
      referer: '',
      userAgent: '',
      headers: [],
      outFileName: '',
      sourceType: 'torrent',
      selectFile: '1,3'
    })).toEqual({
      gid: 'g1',
      dir: '/tmp',
      split: 4,
      'select-file': '1,3'
    })
  })

  it('allows BT tasks to resume when their target directory already exists', () => {
    expect(shouldCheckExistingDownloadTarget('magnet')).toBe(false)
    expect(shouldCheckExistingDownloadTarget('torrent')).toBe(false)
    expect(shouldCheckExistingDownloadTarget('url')).toBe(true)
  })

  it('uses one connection for Quark signed downloads while preserving the configured split elsewhere', () => {
    expect(resolveProviderDownloadSplit('quark', 8)).toBe(1)
    expect(resolveProviderDownloadSplit('drive115', 8)).toBe(1)
    expect(resolveProviderDownloadSplit('aliyun', 8)).toBe(8)
  })
})
