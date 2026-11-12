import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

// App registration only. Never read account databases, cookies or the credential vault.
export const registrationKeys = [
  'ALIYUN_APP_ID', 'ALIYUN_APP_SECRET', 'BAIDU_APP_ID', 'BAIDU_APP_SECRET',
  'CLOUD123_APP_ID', 'CLOUD123_APP_SECRET', 'DRIVE115_APP_ID', 'DRIVE115_APP_SECRET',
  'ONEDRIVE_CLIENT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET',
  'GUANGYA_CLIENT_ID', 'CLOUD189_APP_ID', 'PIKPAK_CLIENT_ID', 'PIKPAK_CLIENT_SECRET',
  'BOXPLAYER_SITE_URL', 'TRAKT_CLIENT_ID'
]
export function parseRegistration(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^export const ([A-Z0-9_]+)\s*=\s*(.+)$/)
    if (!match || !registrationKeys.includes(match[1])) continue
    try {
      const value = JSON.parse(match[2].trim().replace(/;$/, ''))
      if (typeof value === 'string' && value.trim()) values[match[1]] = value
    } catch { /* Generated values must be JSON string literals, never executable JS. */ }
  }
  return values
}
function sharedWorktree(root) {
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return dirname(common)
  } catch { return null }
}
export function loadProviderRegistration({ root, env = process.env, sharedRoot = undefined, strict = true }) {
  const worktree = resolve(root, '..')
  const shared = sharedRoot === undefined ? sharedWorktree(worktree) : sharedRoot
  const paths = [env.BOXPLAYER_REGISTRATION_FILE, join(worktree, 'src/secrets.generated.ts'), shared && join(shared, 'src/secrets.generated.ts')].filter(Boolean)
  const files = [...new Set(paths)].filter(path => existsSync(path))
  const values = {}
  for (const path of files) {
    const parsed = parseRegistration(readFileSync(path, 'utf8'))
    for (const key of registrationKeys) if (!(key in values) && parsed[key]) values[key] = parsed[key]
  }
  const output = {}
  for (const key of registrationKeys) output[`BOXPLAYER_${key}`] = env[`BOXPLAYER_${key}`] ?? values[key] ?? ''
  const missing = registrationKeys.filter(key => !output[`BOXPLAYER_${key}`].trim())
  if (strict && missing.length) throw new Error(`Missing application registration: ${missing.join(', ')}. Generate application registration in this worktree or set BOXPLAYER_REGISTRATION_FILE before building.`)
  return { env: output, configured: registrationKeys.filter(key => !missing.includes(key)), missing }
}
