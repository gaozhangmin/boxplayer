// Return only bounded classifications; never expose raw logs or account credentials to CI.
export function summarizeStartupFailures(logs: Array<{ logtype: string; logmessage: string }>) {
  return logs.filter(log => log.logtype === 'danger' || log.logtype === 'warning').slice(0, 20).map(log => {
    const message = log.logmessage.toLowerCase()
    const provider = ['aliyun', 'cloud123', 'baidu', 'pikpak', 'guangya', 'quark', '139', 'dropbox', 'onedrive', 'google'].find(name => message.includes(name)) || 'unknown'
    const reason = ['invalid_grant', 'invalid_token', 'invalid_client', 'invalid_refresh_token', 'invalid refresh token', 'invalid refresh_token', 'unauthorized', 'accessprohibited', '4126', 'captcha', 'timed out', 'timeout', 'failed to fetch', 'network', 'expired'].find(value => message.includes(value)) || 'provider error'
    const httpStatus = message.match(/http(?: status)?[ :]+([45]\d{2})/i)?.[1]
    return { provider, reason, ...(httpStatus ? { httpStatus: Number(httpStatus) } : {}) }
  })
}
