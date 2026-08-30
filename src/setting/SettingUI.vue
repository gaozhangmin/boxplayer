<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import useSettingStore from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import LimitReachedModal from './LimitReachedModal.vue'
import { getAppNewPath, openExternal } from '../utils/electronhelper'
import { CheckCircle2, Chrome, Code2, Crown, Github, Gift, Loader2, LogOut, Mail, RefreshCw } from 'lucide-vue-next'
import { getPkgVersion } from '../utils/utils'
import { modalUpdateLog } from '../utils/modal'
import fs from 'node:fs'
import message from '../utils/message'
import { Sleep } from '../utils/format'
import { BOXPLAYER_SITE_URL, fetchBoxPlayerSubscription, getBoxPlayerSupabase } from '../utils/boxplayerAuth'
import { t } from '../i18n'

const platform = window.platform
const settingStore = useSettingStore()
const topTabOptions = [
  { key: 'pan', labelKey: 'nav.pan' }, { key: 'media-server', labelKey: 'nav.mediaServer' }, { key: 'search', labelKey: 'nav.search' }, { key: 'ai-workspace', labelKey: 'nav.aiWorkspace' },
  { key: 'media', labelKey: 'nav.video' }, { key: 'music', labelKey: 'nav.music' }, { key: 'book', labelKey: 'nav.books' },
  { key: 'share', labelKey: 'nav.share' }, { key: 'rss', labelKey: 'nav.plugins' }
]

function toggleTopTab(key: string, hidden: boolean) {
  const tabs = new Set(settingStore.uiHiddenTopTabs || [])
  if (hidden) tabs.add(key)
  else tabs.delete(key)
  cb({ uiHiddenTopTabs: Array.from(tabs) })
}

const isPro = ref(false)
const isLoggedIn = ref(false)
const accountEmail = ref('')
const accountInitial = computed(() => (accountEmail.value.trim().charAt(0) || 'B').toUpperCase())
try {
  isPro.value = localStorage.getItem('app_user_pro') === '1'
  isLoggedIn.value = localStorage.getItem('app_user_authed') === '1'
  accountEmail.value = localStorage.getItem('app_user_email') || ''
} catch {}
const showUpgradeModal = ref(false)

onMounted(() => {
  window.WebPlatformSync?.((data: { appVersion?: string }) => {
    if (typeof data?.appVersion === 'string' && data.appVersion) installedAppVersion.value = data.appVersion
  })
  setupAuthCallback()
  setupPaymentCallback()
  if (isLoggedIn.value) syncProStatus()
  if (localStorage.getItem('boxplayer_show_pricing') === '1') {
    localStorage.removeItem('boxplayer_show_pricing')
    if (!isPro.value) showUpgradeModal.value = true
  }
})

onUnmounted(() => {
  if (!window.Electron?.ipcRenderer) return
  if (authCallbackHandler) window.Electron.ipcRenderer.removeListener('auth-callback', authCallbackHandler)
  if (paymentCallbackHandler) window.Electron.ipcRenderer.removeListener('payment-callback', paymentCallbackHandler)
})

function handleLogout() {
  localStorage.removeItem('app_user_email')
  localStorage.removeItem('app_user_authed')
  localStorage.removeItem('app_user_pro')
  isLoggedIn.value = false
  isPro.value = false
  accountEmail.value = ''
  supabase?.auth.signOut().catch(() => {})
  message.success(t('user.logout'))
}

const loading = ref(false)
const showEmail = ref(false)
const codeSent = ref(false)
const emailCode = ref('')
const authEmail = ref('')
const upgrading = ref(false)
const redeeming = ref(false)
const redeemCode = ref('')

const CALLBACK_URL = 'boxplayer-auth://callback'
const PRICING_URL = `${BOXPLAYER_SITE_URL}/pricing/`
const PAYMENT_POLL_DELAYS = [0, 2000, 5000, 10000, 20000]

const supabase = getBoxPlayerSupabase()

function saveLogin(email: string) {
  localStorage.setItem('app_user_email', email)
  localStorage.setItem('app_user_authed', '1')
  accountEmail.value = email
  isLoggedIn.value = true
  syncProStatus()
}

async function syncProStatus() {
  if (!isLoggedIn.value || !supabase) return false
  try {
    const subscription = await fetchBoxPlayerSubscription()
    isPro.value = subscription.isPro === true
    if (isPro.value) {
      localStorage.setItem('app_user_pro', '1')
    } else {
      localStorage.removeItem('app_user_pro')
    }
    return isPro.value
  } catch (e: any) {
    message.error(e?.message || t('settings.syncStatus'))
  }
  return false
}

async function pollProStatusAfterPayment() {
  if (!isLoggedIn.value) {
    message.warning(t('settings.signInBeforePurchase'))
    return
  }

  for (let i = 0; i < PAYMENT_POLL_DELAYS.length; i += 1) {
    const delay = PAYMENT_POLL_DELAYS[i]
    if (delay > 0) await Sleep(delay)
    const active = await syncProStatus()
    if (active) {
      message.success(t('settings.proActive'))
      return
    }
  }

  message.warning(t('settings.syncStatus'))
}

async function handleOAuth(provider: 'github' | 'google') {
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider, options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true },
    })
    if (error) message.error(error.message)
    else if (data.url) openExternal(data.url)
  } finally { loading.value = false }
}

async function handleEmailSend() {
  const email = authEmail.value.trim()
  if (!email?.includes('@')) { message.warning(t('settings.emailPlaceholder')); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    if (error) message.error(error.message)
    else { codeSent.value = true; message.success(t('settings.sendCode')) }
  } finally { loading.value = false }
}

async function handleEmailVerify() {
  const email = authEmail.value.trim()
  const token = emailCode.value.trim()
  if (!token) { message.warning(t('settings.verifyCode')); return }
  if (!supabase) return
  loading.value = true
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) message.error(error.message)
    else if (data.user) { saveLogin(data.user.email || email); message.success(t('user.login')) }
  } finally { loading.value = false }
}

async function handleUpgrade() {
  upgrading.value = true
  try {
    openExternal(PRICING_URL)
  } catch (e: any) { message.error(e?.message || t('settings.upgradeOpening')) }
  finally { upgrading.value = false }
}

function getRedeemErrorMessage(code: string): string {
  const map: Record<string, string> = {
    invalid_redeem_code: t('settings.redeemPlaceholder'),
    redeem_code_not_found: t('settings.redeemPlaceholder'),
    redeem_code_inactive: t('settings.redeemPlaceholder'),
    redeem_code_not_started: t('settings.redeemPlaceholder'),
    redeem_code_expired: t('settings.redeemPlaceholder'),
    redeem_code_used: t('settings.redeemPlaceholder'),
    redeem_code_already_used_by_user: t('settings.redeemPlaceholder'),
  }
  return map[code] || code || t('settings.redeem')
}

async function handleRedeemCode() {
  const code = redeemCode.value.trim()
  if (!code) { message.warning(t('settings.redeemPlaceholder')); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  redeeming.value = true
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) { message.warning(t('settings.signInBeforePurchase')); return }
    const response = await fetch(`${BOXPLAYER_SITE_URL}/api/redeem/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok === false) throw new Error(result.error || 'redeem_failed')
    redeemCode.value = ''
    await syncProStatus()
    isPro.value = true
    localStorage.setItem('app_user_pro', '1')
    const planLabel = result.plan === 'monthly' ? t('settings.redeemCode') : result.plan === 'yearly' ? t('settings.redeemCode') : t('settings.buyLifetimePro')
    message.success(`${t('settings.redeem')}：${planLabel}`)
  } catch (e: any) {
    message.error(getRedeemErrorMessage(e?.message || 'redeem_failed'))
  } finally {
    redeeming.value = false
  }
}

let authCallbackHandler: ((_e: any, params: { access_token?: string; refresh_token?: string }) => void) | null = null
let paymentCallbackHandler: ((_e: any, params?: { status?: string; checkout_id?: string; reason?: string }) => void) | null = null

function setupAuthCallback() {
  if (!window.Electron?.ipcRenderer) return
  authCallbackHandler = async (_e: any, params: { access_token?: string; refresh_token?: string }) => {
    if (!params.access_token || !supabase) return
    const { data, error } = await supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token || '' })
    if (!error && data.user) { saveLogin(data.user.email || ''); message.success(t('user.login')) }
  }
  window.Electron.ipcRenderer.on('auth-callback', authCallbackHandler)
}

function setupPaymentCallback() {
  if (!window.Electron?.ipcRenderer) return
  paymentCallbackHandler = async (_e: any, params?: { status?: string; checkout_id?: string; reason?: string }) => {
    const status = params?.status || 'success'
    if (status === 'cancelled' || status === 'canceled') {
      message.info(t('settings.openSource'))
      return
    }
    if (status === 'failed' || status === 'failure') {
      message.error(t('settings.syncStatus'))
      return
    }

    message.info(t('settings.syncStatus'))
    await pollProStatusAfterPayment()
  }
  window.Electron.ipcRenderer.on('payment-callback', paymentCallbackHandler)
}

const cb = (val: any) => {
  settingStore.updateStore(val)
}

const installedAppVersion = ref(getPkgVersion())
const getAppVersion = computed(() => installedAppVersion.value)

const verLoading = ref(false)
const handleCheckVer = async () => {
  verLoading.value = true
  try {
    const state = await window.AutoUpdateCheck?.(true)
    if (!state || state.status === 'unsupported') {
      message.info('后台更新仅支持已打包的桌面版本')
    } else if (state.status === 'downloading') {
      message.info(state.version ? `新版本 ${state.version} 正在后台下载` : '新版本正在后台下载')
    } else if (state.status === 'downloaded') {
      message.success(state.version ? `新版本 ${state.version} 已下载，退出 App 后即可更新` : '新版本已下载，退出 App 后即可更新')
    } else if (state.status === 'up-to-date') {
      message.info(`已经是最新版 ${getAppVersion.value}`, 6)
    } else if (state.status === 'error') {
      message.error('检查更新失败，请检查网络是否正常')
    } else {
      message.info('正在检查更新')
    }
  } finally {
    verLoading.value = false
  }
}
const handleUpdateLog = () => {
  modalUpdateLog()
}

function openSupport() {
  openExternal('https://xbyvideohub.com/support/')
}

const handleImportAsar = () => {
  window.WebShowOpenDialogSync({
    title: t('settings.selectAsar'),
    buttonLabel: t('settings.importUpdateFile'),
    filters: [{ name: 'app.asar', extensions: ['asar'] }],
    properties: ['openFile', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
  }, async (files: string[] | undefined) => {
    if (files && files.length > 0) {
      // 导入到app.new
      await fs.promises.cp(files[0], getAppNewPath())
      message.info(t('settings.importUpdateSuccess'), 0)
      await Sleep(1000)
      window.WebToElectron({ cmd: 'relaunch' })
    }
  })
}
</script>

<template>
  <div class='settingcard'>
    <div class='settings-app-hero'>
      <div class='settings-app-badge'>{{ t('settings.application') }}</div>
      <div class='appver'>
        BoxPlayer {{ getAppVersion }}
        <span class="appver-badge" :class="{ pro: isPro }">
          <Crown v-if="isPro" :size="15" :stroke-width="2.2" />
          <Code2 v-else :size="15" :stroke-width="2.2" />
          {{ isPro ? 'PRO' : t('settings.openSource') }}
        </span>
      </div>
    </div>
    <div class='settings-app-actions'>
      <a-button type='outline' status='success' size='small' @click='handleUpdateLog'>
        {{ t('settings.changelog') }}
      </a-button>
      <a-button type='outline' status='warning' size='small' @click='openSupport'>
        {{ t('settings.submitFeedback') }}
      </a-button>
      <a-button type='outline' size='small' :loading='verLoading' @click='handleCheckVer'>
        {{ t('settings.checkUpdates') }}
      </a-button>
      <a-button v-if='platform !== "linux"' status='warning' type='outline' size='small' @click='handleImportAsar'>
        {{ t('settings.import') }}
      </a-button>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.accountPro') }}</div>
    <div class='settingrow setting-account-row'>
      <div class='setting-account-copy'>
        <div class='setting-account-title'>{{ t('settings.boxAccount') }}</div>
        <div class='setting-account-desc'>{{ t('settings.accountDesc') }}</div>
      </div>

      <div class='setting-account-panel'>
        <template v-if="isLoggedIn">
          <div class='setting-account-main'>
            <div class='setting-account-avatar' aria-hidden='true'>{{ accountInitial }}</div>
            <div class='setting-account-identity'>
              <div class='setting-account-email'>{{ accountEmail }}</div>
              <div class='setting-account-meta'>
                <span class='setting-pro-badge' :class="{ active: isPro }">
                  <CheckCircle2 v-if="isPro" :size='13' />
                  <Crown v-else :size='13' />
                  {{ isPro ? t('settings.proActive') : t('settings.openSource') }}
                </span>
              </div>
            </div>
            <button class='setting-icon-btn' :title="t('settings.syncStatus')" :disabled='loading' @click='syncProStatus'>
              <RefreshCw :size='15' />
            </button>
            <button class='setting-icon-btn danger' :title="t('user.logout')" @click='handleLogout'>
              <LogOut :size='15' />
            </button>
          </div>

          <button v-if="!isPro" class='setting-upgrade-btn' :disabled='upgrading' @click='handleUpgrade'>
            <Loader2 v-if="upgrading" :size='15' class='spin' />
            <Crown v-else :size='15' />
            <span>{{ upgrading ? t('settings.upgradeOpening') : t('settings.buyLifetimePro') }}</span>
          </button>

          <div class='setting-redeem-box'>
            <div class='setting-redeem-title'>
              <Gift :size='14' />
              <span>{{ t('settings.redeemCode') }}</span>
            </div>
            <div class='setting-redeem-form'>
              <input v-model='redeemCode' type='text' :placeholder="t('settings.redeemPlaceholder')" class='sa-input setting-redeem-input' @keydown.enter='handleRedeemCode' />
              <button class='sa-send-btn setting-redeem-btn' :disabled='redeeming || !redeemCode.trim()' @click='handleRedeemCode'>
                <Loader2 v-if='redeeming' :size='13' class='spin' />
                <span v-else>{{ t('settings.redeem') }}</span>
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class='setting-account-main'>
            <div class='setting-account-avatar muted' aria-hidden='true'>B</div>
            <div class='setting-account-identity'>
              <div class='setting-account-email'>{{ t('settings.notSignedIn') }}</div>
              <div class='setting-account-meta'>{{ t('settings.signInBeforePurchase') }}</div>
            </div>
          </div>

          <div class='setting-provider-grid'>
            <button class="sa-provider sa-gh" :disabled="loading" title="GitHub" @click="handleOAuth('github')">
              <Github :size="18" />
              <span>GitHub</span>
            </button>
            <button class="sa-provider sa-go" :disabled="loading" title="Google" @click="handleOAuth('google')">
              <Chrome :size="18" />
              <span>Google</span>
            </button>
            <button class="sa-provider sa-em" :class="{ active: showEmail }" :disabled="loading" :title="t('settings.email')" @click="showEmail = !showEmail">
              <Mail :size="18" />
              <span>{{ t('settings.email') }}</span>
            </button>
          </div>

          <div v-if="showEmail" class='setting-email-form'>
            <template v-if="!codeSent">
              <input v-model="authEmail" type="email" :placeholder="t('settings.emailPlaceholder')" class="sa-input" @keydown.enter="handleEmailSend" />
              <button class="sa-send-btn" :disabled="loading || !authEmail.trim()" @click="handleEmailSend">
                <Loader2 v-if="loading" :size="13" class="spin" />
                <span v-else>{{ t('settings.sendCode') }}</span>
              </button>
            </template>
            <template v-else>
              <input v-model="emailCode" type="text" :placeholder="t('settings.verifyCode')" maxlength="6" class="sa-input" @keydown.enter="handleEmailVerify" />
              <button class="sa-send-btn" :disabled="loading || emailCode.length < 4" @click="handleEmailVerify">
                <Loader2 v-if="loading" :size="13" class="spin" />
                <span v-else>{{ t('settings.verifyAndLogin') }}</span>
              </button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.language') }}</div>
    <div class='settingrow'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiLanguage' @update:model-value='cb({ uiLanguage: $event })'>
        <a-radio tabindex='-1' value='zh-CN'>{{ t('settings.chinese') }}</a-radio>
        <a-radio tabindex='-1' value='en-US'>{{ t('settings.english') }}</a-radio>
      </a-radio-group>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.appearance') }}</div>
    <div class='settingrow'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiTheme'
                     @update:model-value='cb({ uiTheme: $event })'>
        <a-radio tabindex='-1' value='system'>{{ t('common.system') }}</a-radio>
        <a-radio tabindex='-1' value='light'>{{ t('common.light') }}</a-radio>
        <a-radio tabindex='-1' value='dark'>{{ t('common.dark') }}</a-radio>
      </a-radio-group>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.hideTabs') }}</div>
    <div class='settingrow'>
      <a-checkbox v-for='tab in topTabOptions' :key='tab.key' :checked='settingStore.uiHiddenTopTabs.includes(tab.key)' @update:model-value='(hidden: boolean) => toggleTopTab(tab.key, hidden)'>{{ t(tab.labelKey as Parameters<typeof t>[0]) }}</a-checkbox>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.defaultTab') }}</div>
    <div class='settingrow'>
      <a-radio-group
        type='button'
        tabindex='-1'
        :model-value='settingStore.uiDefaultTab'
        @update:model-value='cb({ uiDefaultTab: $event })'
      >
        <a-radio tabindex='-1' value='pan'>{{ t('nav.pan') }}</a-radio>
        <a-radio tabindex='-1' value='media-server'>{{ t('nav.mediaServer') }}</a-radio>
        <a-radio tabindex='-1' value='media'>{{ t('nav.video') }}</a-radio>
      </a-radio-group>
    </div>
    <template v-if="['win32', 'darwin'].includes(platform)">
      <div class='settingspace'></div>
      <div class='settinghead'>{{ t('settings.startup') }}</div>
      <div class='settingrow'>
        <MySwitch :value='settingStore.uiLaunchStart' @update:value='cb({ uiLaunchStart: $event })'>
          {{ t('settings.startAtLogin') }}
        </MySwitch>
      </div>
      <div class='settingrow' v-if="settingStore.uiLaunchStart">
        <MySwitch :value='settingStore.uiLaunchStartShow'
                  @update:value='cb({ uiLaunchStartShow: $event })'>
          {{ t('settings.showOnStart') }}
        </MySwitch>
      </div>
      <div class='settingrow' data-testid='launch-maximized-setting'>
        <MySwitch :value='settingStore.uiLaunchMaximized' @update:value='cb({ uiLaunchMaximized: $event })'>
          {{ t('book.autoMaximizeMainWindow') }}
        </MySwitch>
      </div>
    </template>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.update') }}</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoCheckUpdate'
                @update:value='cb({ uiLaunchAutoCheckUpdate: $event })'>
        {{ t('settings.checkOnStart') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.autoSign') }}</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoSign' @update:value='cb({ uiLaunchAutoSign: $event })'>
        {{ t('settings.signOnStart') }}
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.exit') }}</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiExitOnClose' @update:value='cb({ uiExitOnClose: $event })'>
        {{ t('settings.exitOnClose') }}
      </MySwitch>
      <a-popover position='right'>
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.defaultOff') }}
            <hr />
            {{ t('settings.exitHelp') }}
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>{{ t('settings.updateProxy') }}</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiUpdateProxyEnable' @update:value='cb({ uiUpdateProxyEnable: $event })'>
        {{ t('settings.enableUpdateProxy') }}
      </MySwitch>
      <div class='settingrow' v-if="settingStore.uiUpdateProxyEnable">
        <a-input v-model.trim='settingStore.uiUpdateProxyUrl'
                 allow-clear
                 :style="{ width: '280px' }"
                 :placeholder="t('settings.updateProxy')"
                 @update:model-value='cb({ uiUpdateProxyUrl: $event })' />
      </div>
    </div>
  </div>
  <LimitReachedModal :visible="showUpgradeModal" @update:visible="showUpgradeModal = $event" />
</template>

<style scoped>
.settings-app-hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.settings-app-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(88, 130, 255, 0.12);
  color: var(--color-primary-6);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.appver {
  font-weight: 600;
  font-size: 28px;
  line-height: 1.4;
}

.settings-app-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.settings-app-actions :deep(.arco-btn) {
  margin-left: 0 !important;
}

:global(html.dark) .settings-app-badge {
  background: rgba(120, 160, 255, 0.2);
  color: #dbe6ff;
}

@media (max-width: 900px) {
  .appver {
    font-size: 24px;
  }
}

.appver-badge{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:5px 11px;font-size:12px;font-weight:800;line-height:1;letter-spacing:.05em;color:var(--color-text-1);background:var(--color-fill-3);border:1px solid var(--color-border-2);border-radius:6px;vertical-align:middle;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.appver-badge.pro{color:#92400e;background:#fef3c7;border-color:#f59e0b;box-shadow:0 2px 8px rgba(245,158,11,.22)}
:global(html.dark) .appver-badge{color:#e5e7eb;background:rgba(148,163,184,.16);border-color:rgba(148,163,184,.38)}
:global(html.dark) .appver-badge.pro{color:#fde68a;background:rgba(180,83,9,.3);border-color:#f59e0b;box-shadow:0 2px 10px rgba(245,158,11,.18)}

.setting-account-row {
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.setting-account-copy {
  min-width: 180px;
  padding-top: 5px;
}

.setting-account-title {
  color: var(--color-text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.setting-account-desc {
  max-width: 360px;
  margin-top: 4px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 18px;
}

.setting-account-panel {
  width: min(100%, 460px);
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-1);
}

.setting-account-main {
  display: flex;
  align-items: center;
  min-height: 40px;
  gap: 10px;
}

.setting-account-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 8px;
  background: rgba(var(--primary-6), 0.12);
  color: rgb(var(--primary-6));
  font-size: 15px;
  font-weight: 700;
}

.setting-account-avatar.muted {
  background: var(--color-fill-2);
  color: var(--color-text-3);
}

.setting-account-identity {
  min-width: 0;
  flex: 1;
}

.setting-account-email {
  overflow: hidden;
  color: var(--color-text-1);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-account-meta {
  display: flex;
  align-items: center;
  min-height: 18px;
  margin-top: 2px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 18px;
}

.setting-pro-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-fill-1);
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
}

.setting-pro-badge.active {
  border-color: rgba(var(--success-6), 0.35);
  background: rgba(var(--success-6), 0.1);
  color: rgb(var(--success-6));
}

.setting-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-1);
  color: var(--color-text-3);
  font-family: inherit;
}

.setting-icon-btn:hover:not(:disabled) {
  border-color: var(--color-border-2);
  color: var(--color-text-1);
}

.setting-icon-btn.danger:hover:not(:disabled) {
  border-color: rgba(var(--danger-6), 0.4);
  color: rgb(var(--danger-6));
}

.setting-icon-btn:disabled {
  opacity: 0.45;
}

.setting-upgrade-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 38px;
  margin-top: 12px;
  gap: 7px;
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 6px;
  background: #d97706;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.setting-upgrade-btn:hover:not(:disabled) {
  background: #b45309;
}

.setting-upgrade-btn:disabled {
  opacity: 0.65;
}

.setting-redeem-box {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.setting-redeem-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 700;
}

.setting-redeem-form {
  display: flex;
  gap: 8px;
}

.setting-redeem-input {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.setting-redeem-input::placeholder {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}

.setting-redeem-btn {
  min-width: 72px;
}

.setting-provider-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.sa-provider {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 36px;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
}

.sa-provider:disabled {
  opacity: 0.45;
}

.sa-gh {
  background: #24292e;
  color: #fff;
  border-color: #24292e;
}

.sa-go,
.sa-em {
  background: var(--color-bg-1);
  color: var(--color-text-2);
}

.sa-go:hover:not(:disabled),
.sa-em:hover:not(:disabled),
.sa-em.active {
  border-color: rgb(var(--primary-6));
  color: rgb(var(--primary-6));
}

.setting-email-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.sa-input {
  min-width: 0;
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  outline: none;
  background: var(--color-fill-1);
  color: var(--color-text-1);
  font-family: inherit;
  font-size: 13px;
}

.sa-input:focus {
  border-color: rgb(var(--primary-6));
  background: var(--color-bg-1);
}

.sa-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 94px;
  height: 34px;
  flex: 0 0 auto;
  gap: 5px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: rgb(var(--primary-6));
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.sa-send-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.sa-send-btn:disabled {
  opacity: 0.45;
}

@media (max-width: 720px) {
  .setting-account-row {
    flex-direction: column;
    gap: 10px;
  }

  .setting-account-copy,
  .setting-account-panel {
    width: 100%;
  }

  .setting-provider-grid {
    grid-template-columns: 1fr;
  }

  .setting-email-form {
    flex-direction: column;
  }

  .setting-redeem-form {
    flex-direction: column;
  }

  .sa-send-btn {
    width: 100%;
  }
}

.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
