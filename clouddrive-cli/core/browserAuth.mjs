import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

import { createAuthStore } from './authStore.mjs'

const OAUTH_PROVIDERS = {
  onedrive: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: process.env.CLOUDDRIVE_ONEDRIVE_CLIENT_ID || '',
    scope: 'offline_access Files.ReadWrite User.Read',
    defaultDriveId: 'onedrive',
    includeSecret: false,
  },
  dropbox: {
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    clientId: process.env.CLOUDDRIVE_DROPBOX_CLIENT_ID || '',
    clientSecret: process.env.CLOUDDRIVE_DROPBOX_CLIENT_SECRET || '',
    scope: 'account_info.read files.metadata.read files.content.read files.content.write sharing.read sharing.write',
    defaultDriveId: 'dropbox',
    tokenAccessType: 'offline',
    includeSecret: true,
  },
  box: {
    authUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    clientId: process.env.CLOUDDRIVE_BOX_CLIENT_ID || '',
    clientSecret: process.env.CLOUDDRIVE_BOX_CLIENT_SECRET || '',
    scope: 'root_readwrite',
    defaultDriveId: 'box',
    includeSecret: true,
  },
  '123': {
    authUrl: 'https://www.123pan.com/auth',
    tokenUrl: 'https://open-api.123pan.com/api/v1/oauth2/access_token',
    userInfoUrl: 'https://open-api.123pan.com/api/v1/user/info',
    clientId: process.env.CLOUDDRIVE_CLOUD123_CLIENT_ID || process.env.CLOUDDRIVE_123_CLIENT_ID || '',
    clientSecret: process.env.CLOUDDRIVE_CLOUD123_CLIENT_SECRET || process.env.CLOUDDRIVE_123_CLIENT_SECRET || '',
    scope: 'user:base,file:all:read,file:all:write',
    defaultDriveId: 'cloud123',
    includeSecret: true,
    tokenfrom: 'cloud123',
    skipPkce: true,
  },
}

const ALIYUN_OPENAPI = {
  qrCodeUrl: 'https://openapi.alipan.com/oauth/authorize/qrcode',
  tokenUrl: 'https://openapi.alipan.com/oauth/access_token',
  clientId: process.env.CLOUDDRIVE_ALIYUN_CLIENT_ID || process.env.CLOUDDRIVE_ALIPAN_CLIENT_ID || '',
  clientSecret: process.env.CLOUDDRIVE_ALIYUN_CLIENT_SECRET || process.env.CLOUDDRIVE_ALIPAN_CLIENT_SECRET || '',
  scopes: ['user:base', 'file:all:read', 'file:all:write'],
}

const DRIVE115 = {
  authDeviceUrl: 'https://passportapi.115.com/open/authDeviceCode',
  statusUrl: 'https://qrcodeapi.115.com/get/status/',
  tokenUrl: 'https://passportapi.115.com/open/deviceCodeToToken',
  clientId: process.env.CLOUDDRIVE_115_CLIENT_ID || '',
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase()
  if (value === '123' || value === '123pan' || value === 'cloud123') return '123'
  if (value === 'alipan' || value === 'aliyundrive') return 'aliyun'
  if (value === 'drive115' || value === '115pan') return '115'
  return value
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function hashString(value) {
  let hash = 0
  for (let i = 0; i < String(value).length; i++) {
    hash = (hash << 5) - hash + String(value).charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function providerConfig(provider) {
  const normalized = normalizeProvider(provider)
  const config = OAUTH_PROVIDERS[normalized]
  if (!config) {
    const err = new Error(`Provider "${provider}" does not support standalone browser login yet`)
    err.code = 'ERR_PROVIDER_OPERATION_UNIMPLEMENTED'
    throw err
  }
  return config
}

export function createPkceVerifier() {
  return base64Url(randomBytes(48))
}

export function createPkceChallenge(verifier) {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function normalize115Token(data) {
  if (!data?.access_token) return null
  const accountId = `115_${hashString(data.refresh_token || data.access_token)}`
  return {
    provider: '115',
    accountId,
    displayName: '115网盘',
    token: {
      tokenfrom: '115',
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_in: data.expires_in || 0,
      token_type: data.token_type || 'Bearer',
      user_id: accountId,
      user_name: '115网盘',
      nick_name: '115网盘',
      name: '115网盘',
      default_drive_id: '',
      expire_time: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : undefined,
    },
  }
}

export async function buildOAuthAuthorization({
  provider,
  redirectUri,
  state = `boxplayer_${Date.now()}`,
  verifier = createPkceVerifier(),
} = {}) {
  if (!redirectUri) throw new Error('redirectUri is required')
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === 'aliyun') throw new Error('Aliyun login uses QR code auth instead of OAuth redirect')
  const config = providerConfig(normalizedProvider)
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scope,
    state,
  })
  if (!config.skipPkce) {
    params.set('code_challenge', createPkceChallenge(verifier))
    params.set('code_challenge_method', 'S256')
  }
  if (normalizedProvider === 'onedrive') params.set('response_mode', 'query')
  if (config.tokenAccessType) params.set('token_access_type', config.tokenAccessType)
  return {
    provider: normalizedProvider,
    url: `${config.authUrl}?${params.toString()}`,
    redirectUri,
    state,
    verifier,
    clientId: config.clientId,
  }
}

export function createLoopbackCallbackListener({ host = '127.0.0.1', port = 0, timeoutMs = 120000 } = {}) {
  let server
  let settled = false
  let resolveCallback
  let rejectCallback
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    rejectCallback(new Error('OAuth callback timed out'))
    server?.close()
  }, timeoutMs)

  server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}`)
      if (url.pathname !== '/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      const code = url.searchParams.get('code') || ''
      const state = url.searchParams.get('state') || ''
      const error = url.searchParams.get('error') || ''
      if (error) throw new Error(url.searchParams.get('error_description') || error)
      if (!code) throw new Error('OAuth callback did not include code')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<!doctype html><meta charset="utf-8"><title>BoxPlayer CLI</title><body>Login complete. You can return to the terminal.</body>')
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolveCallback({ code, state })
        server.close()
      }
    } catch (error) {
      res.statusCode = 400
      res.end('OAuth failed. Return to the terminal.')
      if (!settled) {
        settled = true
        clearTimeout(timer)
        rejectCallback(error)
        server.close()
      }
    }
  })

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      resolve({
        redirectUri: `http://${host}:${address.port}/callback`,
        waitForCallback: () => callbackPromise,
        close: () => server.close(),
      })
    })
  })

  return ready
}

function isLoopbackRedirectUri(redirectUri) {
  try {
    const url = new URL(redirectUri)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

function portFromRedirectUri(redirectUri) {
  if (!redirectUri) return 0
  const url = new URL(redirectUri)
  return Number.parseInt(url.port || '80', 10)
}

export async function openBrowser(url, browser = '') {
  const configured = browser || process.env.CLOUDDRIVE_CLI_BROWSER || ''
  const platform = process.platform
  const command = platform === 'darwin'
    ? (configured.toLowerCase() === 'chrome' ? 'open' : 'open')
    : platform === 'win32'
      ? 'cmd'
      : (configured || 'xdg-open')
  const args = platform === 'darwin'
    ? (configured.toLowerCase() === 'chrome' ? ['-a', 'Google Chrome', url] : [url])
    : platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

async function fetchJson(url, init, errorPrefix) {
  const resp = await fetch(url, init)
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) {
    const message = data?.error_description || data?.error_summary || data?.error?.message || data?.message || `HTTP ${resp.status}`
    const err = new Error(`${errorPrefix}: ${message}`)
    err.code = 'ERR_OAUTH_HTTP'
    err.status = resp.status
    throw err
  }
  return data
}

function parseJwtPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length < 2) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

async function enrichAccount(provider, token) {
  if (provider === 'onedrive') {
    const account = await fetchJson('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }, 'Fetch OneDrive account failed').catch(() => null)
    const accountId = account?.id || hashString(token.refresh_token || token.access_token)
    return { accountId: `onedrive_${accountId}`, displayName: account?.displayName || account?.userPrincipalName || 'OneDrive' }
  }
  if (provider === 'dropbox') {
    const account = await fetchJson('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: 'null',
    }, 'Fetch Dropbox account failed').catch(() => null)
    const accountId = account?.account_id || hashString(token.refresh_token || token.access_token)
    return { accountId: `dropbox_${accountId}`, displayName: account?.name?.display_name || account?.email || 'Dropbox' }
  }
  if (provider === 'box') {
    const account = await fetchJson('https://api.box.com/2.0/users/me?fields=id,name,login', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }, 'Fetch Box account failed').catch(() => null)
    const accountId = account?.id || hashString(token.refresh_token || token.access_token)
    return { accountId: `box_${accountId}`, displayName: account?.name || account?.login || 'Box' }
  }
  if (provider === '123') {
    const account = await fetchJson('https://open-api.123pan.com/api/v1/user/info', {
      headers: { Authorization: `Bearer ${token.access_token}`, Platform: 'open_platform' },
    }, 'Fetch 123 account failed').catch(() => null)
    const payload = parseJwtPayload(token.access_token) || {}
    const rawId = account?.uid || account?.userId || payload.user_id || payload.id || payload.uid || hashString(token.refresh_token || token.access_token)
    return { accountId: `cloud123_${rawId}`, displayName: account?.nickname || '123网盘' }
  }
  return { accountId: `${provider}_${hashString(token.refresh_token || token.access_token)}`, displayName: provider }
}

export async function exchangeOAuthCodeForToken({ provider, code, redirectUri, verifier }) {
  const normalizedProvider = normalizeProvider(provider)
  const config = providerConfig(normalizedProvider)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
  })
  if (!config.skipPkce) body.set('code_verifier', verifier)
  if (normalizedProvider === 'onedrive') body.set('scope', config.scope)
  if (config.includeSecret && config.clientSecret) body.set('client_secret', config.clientSecret)

  const tokenResponse = await fetchJson(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, `Exchange ${normalizedProvider} code failed`)
  const token = tokenResponse?.data?.access_token ? tokenResponse.data : tokenResponse

  const account = await enrichAccount(normalizedProvider, token)
  return {
    provider: normalizedProvider,
    accountId: account.accountId,
    displayName: account.displayName,
    token: {
      ...token,
      tokenfrom: config.tokenfrom || normalizedProvider,
      user_id: account.accountId,
      user_name: account.displayName,
      nick_name: account.displayName,
      name: account.displayName,
      device_id: config.clientId,
      default_drive_id: config.defaultDriveId,
      expire_time: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : undefined,
    },
  }
}

async function createAliyunQrCode({ clientId = ALIYUN_OPENAPI.clientId, clientSecret = ALIYUN_OPENAPI.clientSecret } = {}) {
  const data = await fetchJson(ALIYUN_OPENAPI.qrCodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      scopes: ALIYUN_OPENAPI.scopes,
      width: 348,
      height: 348,
    }),
  }, 'Create Aliyun QR code failed')
  const qrCodeUrl = data?.qrCodeUrl || data?.body?.qrCodeUrl || data?.data?.qrCodeUrl
  if (!qrCodeUrl) throw new Error('Create Aliyun QR code failed: missing qrCodeUrl')
  return qrCodeUrl
}

async function pollAliyunQrCode({ qrCodeUrl, timeoutMs = 120000, intervalMs = 2000 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const data = await fetchJson(`${qrCodeUrl}/status`, {}, 'Poll Aliyun QR code failed')
    const body = data?.body || data?.data || data
    const status = body?.status
    if (status === 'LoginSuccess') {
      const authCode = body?.authCode
      if (!authCode) throw new Error('Aliyun QR login succeeded without authCode')
      return { authCode }
    }
    if (status === 'QRCodeExpired') throw new Error('Aliyun QR code expired')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Aliyun QR login timed out')
}

async function exchangeAliyunAuthCodeForToken({ authCode, clientId = ALIYUN_OPENAPI.clientId, clientSecret = ALIYUN_OPENAPI.clientSecret }) {
  const data = await fetchJson(ALIYUN_OPENAPI.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: authCode,
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  }, 'Exchange Aliyun auth code failed')
  const token = data?.body || data?.data || data

  // 获取真实用户信息，保持与 App 登录的 accountId 一致（原始 user_id）
  let userInfo = {}
  try {
    userInfo = await fetchJson('https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }, 'Get Aliyun user info failed')
    userInfo = userInfo?.body || userInfo?.data || userInfo
  } catch { /* ignore - fall back to placeholder */ }

  const userId = userInfo?.user_id || userInfo?.userId || ''
  const nickName = userInfo?.nick_name || userInfo?.name || userInfo?.user_name || 'Aliyun Drive'
  const defaultDriveId = userInfo?.default_drive_id || userInfo?.defaultDriveId || ''

  if (!userId) throw new Error('Aliyun login: could not retrieve user_id from API. Login failed.')

  const expiresAt = token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : 0
  return {
    provider: 'aliyun',
    accountId: `aliyun_${userId}`,
    displayName: nickName,
    token: {
      tokenfrom: 'aliyun',
      access_token: token.access_token || '',
      refresh_token: token.refresh_token || '',
      open_api_token_type: token.token_type || 'Bearer',
      open_api_access_token: token.access_token || '',
      open_api_refresh_token: token.refresh_token || '',
      open_api_expires_in: expiresAt,
      expires_in: token.expires_in || 0,
      token_type: token.token_type || 'Bearer',
      user_id: userId,
      user_name: nickName,
      nick_name: nickName,
      name: nickName,
      device_id: clientId,
      default_drive_id: defaultDriveId,
      expire_time: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    },
  }
}

async function renderTerminalQrCode(content, { small = true } = {}) {
  const module = await import('qrcode-terminal')
  const qrcode = module.default || module
  await new Promise((resolve) => {
    qrcode.generate(content, { small }, (output) => {
      process.stderr.write(`${output}\n`)
      resolve()
    })
  })
}

async function createDrive115DeviceCode({ clientId = DRIVE115.clientId, verifier = createPkceVerifier() } = {}) {
  const body = new URLSearchParams({
    client_id: clientId,
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: 'sha256',
  })
  const data = await fetchJson(DRIVE115.authDeviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 'Create 115 QR code failed')
  const payload = data?.data || data
  if (!payload?.uid || !payload?.qrcode) throw new Error('Create 115 QR code failed: missing device code')
  return {
    uid: payload.uid,
    time: payload.time,
    sign: payload.sign,
    qrcode: payload.qrcode,
  }
}

async function pollDrive115DeviceStatus({ uid, time, sign, timeoutMs = 120000, intervalMs = 1500 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const params = new URLSearchParams({ uid, time, sign })
    const data = await fetchJson(`${DRIVE115.statusUrl}?${params.toString()}`, {}, 'Poll 115 QR code failed')
    const state = data?.state ?? 0
    const status = data?.data?.status ?? 0
    if (state === 0) throw new Error('115 QR code expired')
    if (status === 2) return { state, status, msg: data?.data?.msg || 'authorized' }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('115 QR login timed out')
}

async function exchangeDrive115DeviceCodeForToken({ uid, verifier }) {
  const data = await fetchJson(DRIVE115.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ uid, code_verifier: verifier }).toString(),
  }, 'Exchange 115 device code failed')
  const account = normalize115Token(data?.data || data)
  if (!account) throw new Error('Exchange 115 device code failed: missing access_token')
  return account
}

export async function loginWithDrive115QrCode({
  configDir,
  verifier = createPkceVerifier(),
  createDeviceCode = createDrive115DeviceCode,
  renderQrCode = renderTerminalQrCode,
  pollDeviceStatus = pollDrive115DeviceStatus,
  exchangeDeviceCode = exchangeDrive115DeviceCodeForToken,
  timeoutMs = 120000,
  intervalMs = 1500,
  clientId = DRIVE115.clientId,
} = {}) {
  const device = await createDeviceCode({ clientId, verifier })
  await renderQrCode(device.qrcode)
  const status = await pollDeviceStatus({ uid: device.uid, time: device.time, sign: device.sign, timeoutMs, intervalMs })
  if ((status.state ?? 1) === 0) throw new Error('115 QR code expired')
  if ((status.status ?? 0) !== 2) throw new Error(status.msg || '115 QR login was not authorized')
  const account = await exchangeDeviceCode({ uid: device.uid, verifier })
  const store = createAuthStore({ configDir })
  await store.saveAccount(account)
  await store.setDefaultAccount(account.provider, account.accountId)
  return {
    provider: account.provider,
    accountId: account.accountId,
    displayName: account.displayName,
    isDefault: true,
  }
}

export async function loginWithAliyunQrCode({
  configDir,
  createQrCode = createAliyunQrCode,
  renderQrCode = renderTerminalQrCode,
  pollQrCode = pollAliyunQrCode,
  exchangeAuthCode = exchangeAliyunAuthCodeForToken,
  timeoutMs = 120000,
  intervalMs = 2000,
  clientId = ALIYUN_OPENAPI.clientId,
  clientSecret = ALIYUN_OPENAPI.clientSecret,
} = {}) {
  const qrCodeUrl = await createQrCode({ clientId, clientSecret })
  process.stderr.write('请使用阿里云盘 App 扫描以下二维码授权：\n\n')
  await renderQrCode(qrCodeUrl)
  process.stderr.write('\n等待扫码授权...\n')
  const { authCode } = await pollQrCode({ qrCodeUrl, timeoutMs, intervalMs })
  const account = await exchangeAuthCode({ authCode, clientId, clientSecret })
  const store = createAuthStore({ configDir })
  await store.saveAccount(account)
  await store.setDefaultAccount(account.provider, account.accountId)
  return {
    provider: account.provider,
    accountId: account.accountId,
    displayName: account.displayName,
    isDefault: true,
  }
}

export async function loginWithBrowserOAuth({
  provider,
  configDir,
  browser,
  state = `boxplayer_${Date.now()}`,
  verifier = createPkceVerifier(),
  redirectUri,
  openBrowser: openBrowserFn = openBrowser,
  waitForCallback,
  exchangeCode = exchangeOAuthCodeForToken,
  timeoutMs = 120000,
  port = 0,
} = {}) {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === 'aliyun') {
    return loginWithAliyunQrCode({ configDir, timeoutMs })
  }
  if (normalizedProvider === '115') {
    return loginWithDrive115QrCode({ configDir, timeoutMs })
  }
  let listener
  if (!redirectUri || !waitForCallback) {
    if (redirectUri && !isLoopbackRedirectUri(redirectUri)) {
      throw new Error(`Redirect URI "${redirectUri}" cannot be handled by a standalone terminal CLI. Use an http://127.0.0.1:<port>/callback redirect URI, or import the Electron App token.`)
    }
    const listenPort = redirectUri ? portFromRedirectUri(redirectUri) : port
    listener = await createLoopbackCallbackListener({ port: listenPort, timeoutMs })
    redirectUri = listener.redirectUri
    waitForCallback = listener.waitForCallback
  }

  const auth = await buildOAuthAuthorization({ provider: normalizedProvider, redirectUri, state, verifier })
  await openBrowserFn(auth.url, browser)
  const callback = await waitForCallback()
  if (callback.state && callback.state !== state) throw new Error('OAuth callback state mismatch')

  const account = await exchangeCode({ provider: normalizedProvider, code: callback.code, redirectUri, verifier })
  const store = createAuthStore({ configDir })
  await store.saveAccount(account)
  await store.setDefaultAccount(account.provider, account.accountId)
  listener?.close?.()
  return {
    provider: account.provider,
    accountId: account.accountId,
    displayName: account.displayName,
    isDefault: true,
  }
}

export function supportedBrowserLoginProviders() {
  return ['aliyun', 'dropbox', 'box', '123', '115', 'onedrive']
}
