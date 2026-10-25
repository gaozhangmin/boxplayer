import { t } from '../i18n'

export const SETTINGS_FOLLOW_URL = 'https://xhslink.cn/m/1hvKIte6Cly'
export const SETTINGS_HELP_URL = 'https://www.xbyvideohub.com/guides/'
export const SETTINGS_SUPPORT_EMAIL = 'gaozhangmin@gmail.com'

/** Build a draft only. The user reviews and sends it from their own mail app. */
export function buildSettingsSupportMailto(version: string, system: string): string {
  const body = `${t('supportLinks.supportFeedbackPlaceholder')}\r\n\r\n${t('supportLinks.supportTechnicalDetails')}\r\nBoxPlayer ${version}\r\n${system}`
  return `mailto:${SETTINGS_SUPPORT_EMAIL}?subject=${encodeURIComponent('BoxPlayer')}&body=${encodeURIComponent(body)}`
}
