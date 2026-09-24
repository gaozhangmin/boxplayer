import { describe, expect, it } from 'vitest'
import { buildPikPakCaptchaMeta, parsePikPakError } from '../auth'

describe('buildPikPakCaptchaMeta', () => {
  it('keeps a phone login in the username field used by sign-in', () => {
    expect(buildPikPakCaptchaMeta('15558182007')).toEqual({ username: '15558182007' })
  })

  it('keeps email and username logins unchanged', () => {
    expect(buildPikPakCaptchaMeta('user@example.com')).toEqual({ username: 'user@example.com' })
    expect(buildPikPakCaptchaMeta('pikpak-user')).toEqual({ username: 'pikpak-user' })
  })
})

describe('parsePikPakError', () => {
  it('shows the localized region restriction returned by sign-in', () => {
    expect(parsePikPakError({
      error: 'invalid_grant',
      error_code: 4126,
      error_description: 'AccessProhibited',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'PROHIBITED:CN:112.10.230.184:test' },
        { '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'zh', message: '对不起，PikPak 在当前地区 (中国大陆) 不可用。' }
      ]
    }, 'PikPak 登录失败')).toBe('对不起，PikPak 在当前地区 (中国大陆) 不可用。')
  })

  it('uses the Chinese region restriction when the response has no localized message', () => {
    expect(parsePikPakError({ error_code: 4126, error_description: 'AccessProhibited' }, 'PikPak 登录失败'))
      .toBe('对不起，PikPak 在当前地区 (中国大陆) 不可用。')
  })

  it('keeps existing messages for unrelated login failures', () => {
    expect(parsePikPakError({ error: 'invalid_account_or_password' }, 'PikPak 登录失败')).toBe('PikPak 账号或密码错误')
    expect(parsePikPakError({ error_description: 'captcha_required' }, 'PikPak 登录失败')).toBe('captcha_required')
  })
})
