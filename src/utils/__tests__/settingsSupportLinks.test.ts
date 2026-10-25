import { describe, expect, it } from 'vitest'
import { buildSettingsSupportMailto, SETTINGS_FOLLOW_URL, SETTINGS_HELP_URL } from '../settingsSupportLinks'
describe('settings support destinations', () => {
  it('uses the requested social profile and existing website guide route', () => {
    expect(SETTINGS_FOLLOW_URL).toBe('https://xhslink.cn/m/1hvKIte6Cly')
    expect(SETTINGS_HELP_URL).toBe('https://www.xbyvideohub.com/guides/')
  })
  it('creates a prefilled draft with the specified recipient and real technical details', () => {
    const draft = new URL(buildSettingsSupportMailto('2.0 (123)', 'Windows 11 x64'))
    expect(draft.protocol).toBe('mailto:')
    expect(draft.pathname).toBe('gaozhangmin@gmail.com')
    expect(draft.searchParams.get('subject')).toBe('BoxPlayer')
    expect(draft.searchParams.get('body')).toContain('BoxPlayer 2.0 (123)\r\nWindows 11 x64')
    expect(draft.searchParams.has('attachment')).toBe(false)
  })
  it('keeps Unicode, ampersands, plus signs and newlines inside the message body', () => {
    const draft = new URL(buildSettingsSupportMailto('测试 + 1&2', 'OS\nName?x=y#z'))
    expect(draft.searchParams.get('body')).toContain('测试 + 1&2')
    expect(draft.searchParams.get('body')).toContain('OS\nName?x=y#z')
    expect([...draft.searchParams.keys()]).toEqual(['subject', 'body'])
  })
})
