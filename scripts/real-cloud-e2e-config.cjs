const REAL_CLOUD_PROVIDERS = ['aliyun', 'cloud123', '115', 'baidu', 'pikpak', 'quark', '139', '189', 'guangya', 'dropbox', 'onedrive', 'box', 'google']

const emptyToken = () => ({
  tokenfrom: 'unknown', access_token: '', refresh_token: '', session_expires_in: 0,
  open_api_token_type: '', open_api_access_token: '', open_api_refresh_token: '', open_api_expires_in: 0,
  signature: '', device_id: '', expires_in: 0, token_type: '', user_id: '', user_name: '',
  avatar: '', nick_name: '', default_drive_id: '', default_sbox_drive_id: '', resource_drive_id: '',
  backup_drive_id: '', sbox_drive_id: '', role: '', status: '', expire_time: '', state: '', pin_setup: false,
  is_first_login: false, need_rp_verify: false, name: '', spu_id: '', is_expires: false, used_size: 0,
  total_size: 0, free_size: 0, space_expire: false, spaceinfo: '', vipname: '', vipIcon: '', vipexpire: '',
  pic_drive_id: '', signInfo: { signMon: -1, signDay: -1 }
})

const parseJson = (value, name) => {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${name} 不是有效 JSON`)
  }
}

const normalizeProvider = (value) => String(value || '').trim()

const normalizeCliAccount = (account) => {
  const provider = normalizeProvider(account?.provider || account?.tokenfrom)
  const source = account?.token && typeof account.token === 'object' ? account.token : account
  const fallbackAccountId = String(account?.accountId || '').replace(provider === 'aliyun' ? /^aliyun_/ : /$^/, '')
  const userId = String(source?.user_id || fallbackAccountId || '').trim()
  const displayName = String(account?.displayName || source?.nick_name || source?.user_name || source?.name || provider).trim()
  return {
    ...emptyToken(),
    ...source,
    tokenfrom: provider,
    user_id: userId,
    user_name: source?.user_name || displayName,
    nick_name: source?.nick_name || displayName,
    name: source?.name || displayName,
    signInfo: source?.signInfo || { signMon: -1, signDay: -1 }
  }
}

function parseRealCloudAccounts(value) {
  if (!String(value || '').trim()) throw new Error('缺少 BOXPLAYER_E2E_ACCOUNTS_JSON')
  const parsed = parseJson(value, 'BOXPLAYER_E2E_ACCOUNTS_JSON')
  const source = Array.isArray(parsed) ? parsed : parsed?.accounts
  if (!Array.isArray(source) || !source.length) throw new Error('BOXPLAYER_E2E_ACCOUNTS_JSON 必须包含非空 accounts 数组')
  const accounts = source.map(normalizeCliAccount)
  const seenProviders = new Set()
  for (const account of accounts) {
    if (!REAL_CLOUD_PROVIDERS.includes(account.tokenfrom)) throw new Error(`不支持的真实网盘 provider: ${account.tokenfrom || '(empty)'}`)
    if (!account.user_id) throw new Error(`${account.tokenfrom} 测试账号缺少 user_id`)
    if (!account.access_token && !account.refresh_token) throw new Error(`${account.tokenfrom} 测试账号缺少 access_token/refresh_token`)
    if (seenProviders.has(account.tokenfrom)) throw new Error(`每个 provider 只能配置一个 CI 测试账号: ${account.tokenfrom}`)
    seenProviders.add(account.tokenfrom)
  }
  return accounts
}

const normalizePath = (value, fallbackFolder) => {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split('/').map(item => item.trim()).filter(Boolean)
  return fallbackFolder ? [fallbackFolder] : []
}

function parseRequiredProviders(value) {
  const providers = String(value || REAL_CLOUD_PROVIDERS.join(','))
    .split(',')
    .map(normalizeProvider)
    .filter(Boolean)
  for (const provider of providers) {
    if (!REAL_CLOUD_PROVIDERS.includes(provider)) throw new Error(`BOXPLAYER_E2E_REQUIRED_PROVIDERS 包含未知 provider: ${provider}`)
  }
  return Array.from(new Set(providers))
}

function parseRealCloudTargets(value, accounts, options = {}) {
  const folder = String(options.folder || 'BoxPlayer-E2E').trim()
  const fileName = String(options.fileName || 'boxplayer-e2e.mp4').trim()
  let source
  if (String(value || '').trim()) {
    const parsed = parseJson(value, 'BOXPLAYER_E2E_TARGETS_JSON')
    source = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed || {}).map(([provider, target]) => ({ provider, ...(target || {}) }))
  } else {
    source = accounts.map(account => ({ provider: account.tokenfrom, path: folder ? [folder] : [], fileName }))
  }
  if (!Array.isArray(source) || !source.length) throw new Error('真实网盘播放目标不能为空')
  const targets = source.map(target => ({
    provider: normalizeProvider(target?.provider),
    path: normalizePath(target?.path, folder),
    fileName: String(target?.fileName || target?.file || fileName).trim()
  }))
  const seen = new Set()
  for (const target of targets) {
    if (!REAL_CLOUD_PROVIDERS.includes(target.provider)) throw new Error(`播放目标包含未知 provider: ${target.provider || '(empty)'}`)
    if (!target.fileName) throw new Error(`${target.provider} 播放目标缺少 fileName`)
    if (seen.has(target.provider)) throw new Error(`每个 provider 只能配置一个播放目标: ${target.provider}`)
    seen.add(target.provider)
  }
  return targets
}

function loadRealCloudE2EConfig(env = process.env) {
  const accounts = parseRealCloudAccounts(env.BOXPLAYER_E2E_ACCOUNTS_JSON)
  const requiredProviders = parseRequiredProviders(env.BOXPLAYER_E2E_REQUIRED_PROVIDERS)
  const targets = parseRealCloudTargets(env.BOXPLAYER_E2E_TARGETS_JSON, accounts, {
    folder: env.BOXPLAYER_E2E_MEDIA_FOLDER,
    fileName: env.BOXPLAYER_E2E_MEDIA_FILE
  })
  const accountProviders = new Set(accounts.map(account => account.tokenfrom))
  const targetProviders = new Set(targets.map(target => target.provider))
  const missingAccounts = requiredProviders.filter(provider => !accountProviders.has(provider))
  const missingTargets = requiredProviders.filter(provider => !targetProviders.has(provider))
  if (missingAccounts.length) throw new Error(`缺少 CI 测试账号: ${missingAccounts.join(', ')}`)
  if (missingTargets.length) throw new Error(`缺少 CI 播放目标: ${missingTargets.join(', ')}`)
  return {
    accounts,
    requiredProviders,
    targets: targets.filter(target => requiredProviders.includes(target.provider))
  }
}

module.exports = { REAL_CLOUD_PROVIDERS, parseRealCloudAccounts, parseRequiredProviders, parseRealCloudTargets, loadRealCloudE2EConfig }

if (require.main === module) {
  try {
    const config = loadRealCloudE2EConfig()
    console.log(`Real-cloud E2E configuration is valid for ${config.requiredProviders.length} providers: ${config.requiredProviders.join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
