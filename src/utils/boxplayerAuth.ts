import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { BOXPLAYER_SITE_URL as GENERATED_BOXPLAYER_SITE_URL, BOXPLAYER_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../secrets.generated'

export const BOXPLAYER_SITE_URL = GENERATED_BOXPLAYER_SITE_URL
export const BOXPLAYER_AUTH_CALLBACK = 'boxplayer-auth://callback'
const BOXPLAYER_APP_ACCESS_TOKEN_KEY = 'boxplayer_app_access_token'

type BoxPlayerAuthCallback = {
  code?: string
  access_token?: string
  refresh_token?: string
}

function getStoredAppAccessToken(): string {
  try {
    return localStorage.getItem(BOXPLAYER_APP_ACCESS_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function clearBoxPlayerAppSession() {
  try {
    localStorage.removeItem(BOXPLAYER_APP_ACCESS_TOKEN_KEY)
  } catch {}
}

export async function exchangeBoxPlayerLoginCode(code: string): Promise<{ email: string; accessToken: string }> {
  const response = await fetch(`${BOXPLAYER_SITE_URL}/api/app/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.accessToken) throw new Error(data.error || 'app_login_exchange_failed')
  try {
    localStorage.setItem(BOXPLAYER_APP_ACCESS_TOKEN_KEY, data.accessToken)
  } catch {}
  return { email: data.email || '', accessToken: data.accessToken }
}

export async function restoreBoxPlayerAuth(params: BoxPlayerAuthCallback): Promise<{ email: string }> {
  if (params.code) {
    const result = await exchangeBoxPlayerLoginCode(params.code)
    return { email: result.email }
  }
  const supabase = getBoxPlayerSupabase()
  if (!params.access_token || !supabase) throw new Error('登录回调无效')
  clearBoxPlayerAppSession()
  const { data, error } = await supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token || '' })
  if (error || !data.user) throw error || new Error('登录回调无效')
  return { email: data.user.email || '' }
}

export function buildProPurchaseUrl(tokens: { accessToken?: string; refreshToken?: string } = {}): string {
  const url = new URL('/login', BOXPLAYER_SITE_URL)
  url.searchParams.set('next', '/pricing/')
  url.searchParams.set('redirect_uri', BOXPLAYER_AUTH_CALLBACK)
  url.searchParams.set('source', 'boxplayer-desktop')
  if (tokens.accessToken) {
    const hash = new URLSearchParams({ access_token: tokens.accessToken })
    if (tokens.refreshToken) hash.set('refresh_token', tokens.refreshToken)
    url.hash = hash.toString()
  }
  return url.toString()
}

export async function buildProPurchaseUrlForCurrentSession(): Promise<string> {
  const supabase = getBoxPlayerSupabase()
  if (!supabase) return buildProPurchaseUrl()
  const { data } = await supabase.auth.getSession()
  return buildProPurchaseUrl({
    accessToken: data.session?.access_token,
    refreshToken: data.session?.refresh_token
  })
}

let supabaseClient: SupabaseClient | null | undefined

export function getBoxPlayerSupabase(): SupabaseClient | null {
  if (supabaseClient !== undefined) return supabaseClient
  supabaseClient = BOXPLAYER_SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? createClient(BOXPLAYER_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null
  return supabaseClient
}

export async function getBoxPlayerAccessToken(forceRefresh = false): Promise<string> {
  const supabase = getBoxPlayerSupabase()
  if (supabase) {
    if (forceRefresh) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      const refreshedToken = refreshed.session?.access_token
      if (refreshedToken) return refreshedToken
    }
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) return token
  }
  const appToken = getStoredAppAccessToken()
  if (appToken) return appToken
  if (!supabase) throw new Error('登录服务未配置')
  throw new Error('请先登录 BoxPlayer 账号')
}

export async function fetchBoxPlayerSubscription(): Promise<any> {
  const appToken = getStoredAppAccessToken()
  let token = await getBoxPlayerAccessToken()
  let usingAppToken = Boolean(appToken && token === appToken)
  let response = await fetch(`${BOXPLAYER_SITE_URL}/api/me/subscription`, { headers: { Authorization: `Bearer ${token}` } })
  let data = await response.json().catch(() => ({}))
  if (!response.ok && data.error === 'invalid_auth_token') {
    if (usingAppToken) clearBoxPlayerAppSession()
    token = await getBoxPlayerAccessToken(true)
    usingAppToken = false
    response = await fetch(`${BOXPLAYER_SITE_URL}/api/me/subscription`, { headers: { Authorization: `Bearer ${token}` } })
    data = await response.json().catch(() => ({}))
  }
  if (!response.ok) {
    if (data.error === 'invalid_auth_token') throw new Error('登录状态已失效，请重新登录 BoxPlayer 账号')
    throw new Error(data.error || 'subscription_lookup_failed')
  }
  return data
}
