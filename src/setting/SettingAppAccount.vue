<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Github, Chrome, Mail, Loader2, LogOut, X, Gift } from 'lucide-vue-next'
import message from '../utils/message'
import { openExternal } from '../utils/electronhelper'
import { BOXPLAYER_SITE_URL, buildProPurchaseUrlForCurrentSession, clearBoxPlayerAppSession, fetchBoxPlayerSubscription, getBoxPlayerSupabase } from '../utils/boxplayerAuth'

const loading = ref(false)
const emailInput = ref('')
const showEmail = ref(false)
const codeSent = ref(false)
const emailCode = ref('')
const userEmail = ref('')
const isLoggedIn = ref(false)
const isPro = ref(false)
try {
  userEmail.value = localStorage.getItem('app_user_email') || ''
  isLoggedIn.value = localStorage.getItem('app_user_authed') === '1'
  isPro.value = localStorage.getItem('app_user_pro') === '1'
} catch {}
const upgrading = ref(false)
const redeeming = ref(false)
const redeemCode = ref('')
const showUpgradeModal = ref(false)

const CALLBACK_URL = 'boxplayer-auth://callback'

const supabase = getBoxPlayerSupabase()

function saveLogin(email: string) {
  localStorage.setItem('app_user_email', email)
  localStorage.setItem('app_user_authed', '1')
  userEmail.value = email
  isLoggedIn.value = true
}

function handleLogout() {
  localStorage.removeItem('app_user_email')
  localStorage.removeItem('app_user_authed')
  localStorage.removeItem('app_user_pro')
  clearBoxPlayerAppSession()
  supabase?.auth.signOut().catch(() => {})
  userEmail.value = ''
  isLoggedIn.value = false
  isPro.value = false
  message.success('已退出登录')
}

async function handleOAuth(provider: 'github' | 'google') {
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true },
    })
    if (error) message.error(error.message)
    else if (data.url) {
      openExternal(data.url)
    }
  } finally { loading.value = false }
}

async function handleEmailSend() {
  const email = emailInput.value.trim()
  if (!email?.includes('@')) { message.warning('请输入有效邮箱'); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    if (error) message.error(error.message)
    else { codeSent.value = true; message.success('验证码已发送') }
  } finally { loading.value = false }
}

async function handleEmailVerify() {
  const email = emailInput.value.trim()
  const token = emailCode.value.trim()
  if (!token) { message.warning('请输入验证码'); return }
  if (!supabase) return
  loading.value = true
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) message.error(error.message)
    else if (data.user) { clearBoxPlayerAppSession(); saveLogin(data.user.email || email); message.success('登录成功') }
  } finally { loading.value = false }
}

async function handleUpgrade() {
  upgrading.value = true
  try {
    openExternal(await buildProPurchaseUrlForCurrentSession())
  } catch (e: any) { message.error(e?.message || '打开官网购买页面失败') }
  finally { upgrading.value = false }
}

function getRedeemErrorMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_redeem_code: '请输入有效的兑换码',
    redeem_code_not_found: '兑换码无效',
    redeem_code_inactive: '兑换码已取消',
    redeem_code_not_started: '兑换码尚未开始',
    redeem_code_expired: '兑换码已过期',
    redeem_code_used: '兑换码已被使用',
    redeem_code_already_used_by_user: '当前账号已兑换过这个兑换码',
  }
  return map[code] || code || '兑换失败'
}

async function handleRedeemCode() {
  const code = redeemCode.value.trim()
  if (!code) { message.warning('请输入兑换码'); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  redeeming.value = true
  try {
    const { data: sessionData, error } = await supabase.auth.getSession()
    if (error) throw error
    const token = sessionData.session?.access_token
    if (!token) {
      message.info('请先登录后再兑换')
      return
    }
    const resp = await fetch(`${BOXPLAYER_SITE_URL}/api/redeem/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.ok === false) throw new Error(data.error || 'redeem_failed')
    redeemCode.value = ''
    await refreshSubscription()
    isPro.value = true
    localStorage.setItem('app_user_pro', '1')
    const planLabel = data.plan === 'monthly' ? '包月专业版' : data.plan === 'yearly' ? '包年专业版' : '终身专业版'
    message.success(`兑换成功：${planLabel}`)
  } catch (e: any) {
    message.error(getRedeemErrorMessage(e?.message || 'redeem_failed'))
  } finally {
    redeeming.value = false
  }
}

async function refreshSubscription() {
  if (!supabase || !isLoggedIn.value) return
  try {
    const sub = await fetchBoxPlayerSubscription()
    isPro.value = Boolean(sub.isPro)
    if (isPro.value) localStorage.setItem('app_user_pro', '1')
    else localStorage.removeItem('app_user_pro')
  } catch (e: any) {
    message.error(e?.message || '同步专业版状态失败')
  }
}

function setupPaymentCallback() {
  if (!window.Electron?.ipcRenderer) return
  const handler = async () => {
    await refreshSubscription()
    if (isPro.value) message.success('Pro 已激活！')
    else message.info('支付已完成，正在等待服务器同步订阅状态')
  }
  window.Electron.ipcRenderer.on('payment-callback', handler)
  onUnmounted(() => window.Electron.ipcRenderer?.removeListener('payment-callback', handler))
}

function setupCallbackListener() {
  const handler = async (event: Event) => {
    const result = (event as CustomEvent<{ email?: string }>).detail
    saveLogin(result?.email || '')
    message.success('登录成功')
    await refreshSubscription()
  }
  window.addEventListener('boxplayer-auth-restored', handler)
  onUnmounted(() => window.removeEventListener('boxplayer-auth-restored', handler))
}

onMounted(() => {
  setupCallbackListener()
  setupPaymentCallback()
  refreshSubscription()
  if (localStorage.getItem('boxplayer_show_pricing') === '1') {
    localStorage.removeItem('boxplayer_show_pricing')
    if (!isPro.value) showUpgradeModal.value = true
  }
})
</script>

<template>
  <div id="SettingAppAccount" class='settingcard'>
    <div class='settinghead'>应用账户</div>

    <div class='settingrow acc-row'>
      <div class='acc-copy'>
        <div class='acc-label'>BoxPlayer 账号</div>
        <div class='acc-desc'>{{ isLoggedIn ? '已登录 · 同步专业版状态' : 'GitHub / Google / 邮箱登录后同步专业版状态' }}</div>
      </div>

      <div class='acc-panel'>
        <template v-if="isLoggedIn">
          <div class='acc-logged'>
            <span class='acc-email'>{{ userEmail }}</span>
            <span v-if="isPro" class='acc-pro-badge'>PRO</span>
            <button class='acc-logout' @click="handleLogout"><LogOut :size="13" /> 退出</button>
          </div>
        </template>

        <template v-else>
          <div class='acc-oauth'>
            <button class='acc-provider acc-gh' :disabled="loading" @click="handleOAuth('github')" title="GitHub"><Github :size="18" /></button>
            <button class='acc-provider acc-go' :disabled="loading" @click="handleOAuth('google')" title="Google"><Chrome :size="18" /></button>
            <button class='acc-provider acc-em' :class="{ active: showEmail }" :disabled="loading" @click="showEmail = !showEmail" title="邮箱"><Mail :size="18" /></button>
          </div>

          <div v-if="showEmail" class='acc-email-form'>
            <template v-if="!codeSent">
              <input v-model="emailInput" type="email" placeholder="邮箱地址" class='acc-input' />
              <button :disabled="loading || !emailInput.trim()" @click="handleEmailSend" class='acc-send-btn'><Loader2 v-if="loading" :size="13" class="spin" /><span v-else>发送验证码</span></button>
            </template>
            <template v-else>
              <input v-model="emailCode" type="text" placeholder="输入验证码" maxlength="6" class='acc-input' @keydown.enter="handleEmailVerify" />
              <button :disabled="loading || emailCode.length < 4" @click="handleEmailVerify" class='acc-send-btn'><Loader2 v-if="loading" :size="13" class="spin" /><span v-else>验证并登录</span></button>
            </template>
          </div>
        </template>

        <div class='acc-version'>
          <span class='acc-version-badge' :class="{ pro: isPro }">{{ isPro ? '专业版 PRO' : '开源版' }}</span>
          <button v-if="!isPro" class='acc-upgrade-btn' @click="showUpgradeModal = true">升级到专业版</button>
        </div>

        <div v-if="isLoggedIn" class='acc-redeem'>
          <div class='acc-redeem-head'>
            <Gift :size="14" />
            <span>兑换码</span>
          </div>
          <div class='acc-redeem-form'>
            <input v-model="redeemCode" type="text" placeholder="输入包月 / 包年 / 终身兑换码" class='acc-input acc-redeem-input' @keydown.enter="handleRedeemCode" />
            <button :disabled="redeeming || !redeemCode.trim()" @click="handleRedeemCode" class='acc-send-btn acc-redeem-btn'>
              <Loader2 v-if="redeeming" :size="13" class="spin" />
              <span v-else>兑换</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Upgrade modal -->
    <div v-if="showUpgradeModal" class="upg-mask" @click.self="showUpgradeModal = false">
      <div class="upg-modal">
        <button class="upg-close" @click="showUpgradeModal = false"><X :size="18" /></button>
        <h2 class="upg-title">版本对比</h2>

        <table class="upg-table">
          <thead>
            <tr><th>功能</th><th>开源版</th><th class="upg-th-pro">专业版</th></tr>
          </thead>
          <tbody>
            <tr><td>网盘文件管理</td><td class="upg-yes">✓</td><td class="upg-yes">✓</td></tr>
            <tr><td>视频 / 音乐播放</td><td class="upg-yes">✓</td><td class="upg-yes">✓</td></tr>
            <tr><td>本地书籍阅读</td><td class="upg-yes">✓</td><td class="upg-yes">✓</td></tr>
            <tr><td>多网盘同时连接</td><td class="upg-yes">✓</td><td class="upg-yes">✓</td></tr>
            <tr><td>BYOK · 自带 API Key 使用 AI</td><td class="upg-yes">登录后可用</td><td class="upg-yes">✓</td></tr>
            <tr><td>内置 BoxPlayer AI 模型</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td>AI 智能搜索与语义索引</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td>AI Agent 网盘搜索</td><td class="upg-yes">BYOK 可用</td><td class="upg-yes">✓</td></tr>
            <tr><td>AI 阅读助手</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td>阅读器语音朗读（本地）</td><td class="upg-yes">✓</td><td class="upg-yes">✓</td></tr>
            <tr><td>阅读器即时翻译</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td>全网资源搜索</td><td class="upg-yes">5 次/天</td><td class="upg-yes">✓ 无限</td></tr>
            <tr><td>TMDB + 豆瓣电影发现</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td>优先技术支持</td><td class="upg-no">✗</td><td class="upg-yes">✓</td></tr>
            <tr><td colspan="3" class="upg-coming">阅读器云端高品质朗读 — 即将推出</td></tr>
          </tbody>
        </table>

        <div class="upg-price">
          <div class="upg-price-main"><span class="upg-old-price">$199</span> $139</div>
          <div class="upg-price-sub">一次买断 · 终身使用 · 7 天免费试用 · 7 折首发优惠</div>
        </div>

        <button v-if="isLoggedIn" class="upg-btn" :disabled="upgrading" @click="handleUpgrade">
          <Loader2 v-if="upgrading" :size="14" class="spin" /> <span v-else>官网登录并购买</span>
        </button>
        <button v-else class="upg-btn upg-btn-login" @click="handleUpgrade">
          官网登录并购买
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── account layout ── */
.acc-row { justify-content: space-between; align-items: flex-start; }
.acc-copy { min-width: 180px; padding-top: 2px; }
.acc-label { color: var(--color-text-1); font-size: 14px; font-weight: 600; line-height: 20px; }
.acc-desc { max-width: 400px; margin-top: 4px; color: var(--color-text-3); font-size: 12px; line-height: 18px; }
.acc-panel { width: min(100%, 440px); padding: 14px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-fill-1); }

/* ── logged-in state ── */
.acc-logged { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.acc-email { font-size: 14px; font-weight: 600; color: var(--color-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc-pro-badge { padding: 2px 8px; font-size: 10px; font-weight: 800; letter-spacing: .08em; color: #fff; background: linear-gradient(135deg, #f59e0b, #eab308); border-radius: 4px; flex-shrink: 0; }
.acc-logout { display: flex; align-items: center; gap: 4px; margin-left: auto; padding: 5px 10px; font-size: 11px; color: var(--color-text-4); background: transparent; border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.acc-logout:hover { color: rgb(var(--danger-6)); border-color: rgba(var(--danger-6), .4); }

/* ── oauth ── */
.acc-oauth { display: flex; gap: 10px; margin-bottom: 12px; }
.acc-provider { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 1px solid var(--color-border); border-radius: 50%; cursor: pointer; font-family: inherit; transition: transform .15s; }
.acc-provider:hover:not(:disabled) { transform: translateY(-1px); }
.acc-provider:disabled { opacity: .4; cursor: default; }
.acc-gh { background: #24292e; color: #fff; border-color: #24292e; }
.acc-gh:hover:not(:disabled) { box-shadow: 0 2px 8px rgba(36,41,46,.3); }
.acc-go { background: var(--color-bg-1); color: var(--color-text-3); }
.acc-go:hover:not(:disabled) { color: var(--color-text-1); border-color: var(--color-border-2); }
.acc-em { background: var(--color-bg-1); color: var(--color-text-3); }
.acc-em:hover:not(:disabled), .acc-em.active { color: rgb(var(--primary-6)); border-color: rgb(var(--primary-6)); }

/* ── email form ── */
.acc-email-form { display: flex; gap: 8px; margin-bottom: 12px; }
.acc-input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; font-size: 12px; color: var(--color-text-1); background: var(--color-bg-1); border: 1px solid var(--color-border); border-radius: 8px; outline: none; font-family: inherit; }
.acc-input:focus { border-color: rgb(var(--primary-6)); }
.acc-send-btn { display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 14px; font-size: 12px; font-weight: 600; color: #fff; background: rgb(var(--primary-6)); border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; white-space: nowrap; flex-shrink: 0; }
.acc-send-btn:hover:not(:disabled) { opacity: .9; }
.acc-send-btn:disabled { opacity: .4; cursor: default; }

/* ── version ── */
.acc-version { display: flex; align-items: center; gap: 10px; padding-top: 10px; border-top: 1px solid var(--color-border); }
.acc-version-badge { padding: 3px 10px; font-size: 11px; font-weight: 700; color: var(--color-text-3); background: var(--color-fill-2); border: 1px solid var(--color-border); border-radius: 6px; }
.acc-version-badge.pro { color: #b45309; background: rgba(245,158,11,.15); border-color: rgba(245,158,11,.3); }
.acc-upgrade-btn { margin-left: auto; padding: 6px 14px; font-size: 12px; font-weight: 700; color: #fff; background: linear-gradient(135deg,#f59e0b,#eab308); border:0; border-radius:7px; cursor:pointer; font-family:inherit; }
.acc-upgrade-btn:hover { opacity:.9; }

/* ── redeem ── */
.acc-redeem { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); }
.acc-redeem-head { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; color: var(--color-text-2); font-size: 12px; font-weight: 700; }
.acc-redeem-form { display: flex; gap: 8px; }
.acc-redeem-input { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
.acc-redeem-input::placeholder { text-transform: none; letter-spacing: 0; font-weight: 400; }
.acc-redeem-btn { min-width: 72px; justify-content: center; }

/* ── upgrade modal ── */
.upg-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:2000}
.upg-modal{position:relative;width:640px;max-width:95vw;max-height:90vh;overflow-y:auto;background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:20px;padding:28px 28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.24)}
.upg-close{position:absolute;top:14px;right:14px;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;color:var(--color-text-4);background:transparent;border:0;border-radius:8px;cursor:pointer}
.upg-close:hover{background:var(--color-fill-2);color:var(--color-text-1)}
.upg-title{font-size:20px;font-weight:800;color:var(--color-text-1);text-align:center;margin:0 0 18px}
.upg-table{width:100%;border-collapse:collapse;margin-bottom:18px}
.upg-table th,.upg-table td{padding:9px 14px;font-size:13px;text-align:center;border-bottom:1px solid var(--color-border)}
.upg-table th{color:var(--color-text-3);font-weight:700;font-size:12px}
.upg-table th:first-child,.upg-table td:first-child{text-align:left;color:var(--color-text-2)}
.upg-th-pro{color:#b45309 !important}
.upg-yes{color:rgb(var(--success-6));font-weight:700}
.upg-no{color:var(--color-text-4)}
.upg-coming{color:var(--color-text-4);font-size:12px;font-style:italic}
.upg-coming td{padding-top:12px}
.upg-price{text-align:center;margin-bottom:14px}
.upg-price-main{font-size:28px;font-weight:800;color:var(--color-text-1)}
.upg-old-price{font-size:16px;color:var(--color-text-4);text-decoration:line-through;margin-right:10px;font-weight:500}
.upg-price-sub{font-size:12px;color:var(--color-text-4);margin-top:4px}
.upg-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:12px 0;font-size:14px;font-weight:700;color:#fff;background:linear-gradient(135deg,#f59e0b,#eab308);border:0;border-radius:10px;cursor:pointer;font-family:inherit}
.upg-btn:hover:not(:disabled){opacity:.92}
.upg-btn:disabled{opacity:.5;cursor:default}
.upg-btn-login{background:var(--color-fill-3);color:var(--color-text-2)}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
