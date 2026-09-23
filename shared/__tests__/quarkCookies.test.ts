import { describe, expect, it } from 'vitest'
import { buildQuarkCookieHeader, mergeQuarkCookieHeaders } from '../quarkCookies'

describe('Quark download cookie contract', () => {
  it('does not send a pan-only stale cookie to the drive download host', () => {
    const header = buildQuarkCookieHeader([
      { name: '__uid', value: 'account', domain: '.quark.cn' },
      { name: '__pus', value: 'stale-pan', domain: '.pan.quark.cn' },
      { name: '__pus', value: 'current-drive', domain: '.drive.quark.cn' }
    ], 'https://drive.quark.cn/1/clouddrive/file/download')

    expect(header).toBe('__uid=account; __pus=current-drive')
  })

  it('keeps the current session value over a persisted fallback value', () => {
    expect(mergeQuarkCookieHeaders('__uid=account; __pus=current', '__uid=account; __pus=stale; __kps=fallback')).toBe('__uid=account; __pus=current; __kps=fallback')
  })
})
