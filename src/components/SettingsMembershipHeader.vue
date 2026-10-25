<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { QrCode } from 'lucide-vue-next'
import { QRCode as AntQRCode } from 'ant-design-vue'
import { t } from '../i18n'
import BoxPlayerProBadge, { type BoxPlayerProTier } from './BoxPlayerProBadge.vue'
import TraktAvatar from './TraktAvatar.vue'
import TraktAccountModal from './TraktAccountModal.vue'
import traktLogo from '../assets/media/trakt-logo.svg'
import { traktStatus, traktAccount, loadTraktStatus, loadTraktAccount } from '../services/trakt/client'
import { startBoxPlayerDeviceLogin, exchangeBoxPlayerDeviceLogin, type BoxPlayerDeviceLogin } from '../utils/boxplayerAuth'

const props = defineProps<{ signedIn: boolean; email: string; tier: BoxPlayerProTier }>()
const emit = defineEmits<{ membership: [] }>()
const pro = computed(() => props.tier !== 'standard')
const showTrakt = ref(false)
const showQr = ref(false)
const qr = ref<BoxPlayerDeviceLogin>()
const qrError = ref('')
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let expiresAt = 0
function stopQr() { controller?.abort(); controller = undefined; clearTimeout(timer); timer = undefined }
function closeQr() { showQr.value = false; stopQr() }
async function openQr() {
  stopQr(); showQr.value = true; qr.value = undefined; qrError.value = ''
  const current = new AbortController(); controller = current
  try {
    const result = await startBoxPlayerDeviceLogin(current.signal)
    if (current.signal.aborted) return
    qr.value = result; expiresAt = Date.now() + result.expiresIn * 1000
    schedulePoll(current, result)
  } catch (error) { if (!current.signal.aborted) qrError.value = error instanceof Error ? error.message : String(error) }
}
function schedulePoll(current: AbortController, login: BoxPlayerDeviceLogin) {
  timer = setTimeout(async () => {
    if (current.signal.aborted) return
    if (Date.now() >= expiresAt) { qrError.value = t('membership.qrExpired'); return }
    try {
      const result = await exchangeBoxPlayerDeviceLogin(login.deviceCode, current.signal)
      if (current.signal.aborted) return
      if (result.pending) schedulePoll(current, login)
      else closeQr()
    } catch (error) { if (!current.signal.aborted) qrError.value = error instanceof Error ? error.message : String(error) }
  }, Math.max(2, login.interval || 3) * 1000)
}
onMounted(async () => {
  try { await loadTraktStatus(); if (traktStatus.value.connected) await loadTraktAccount() } catch { /* The Trakt modal displays connection errors. */ }
})
onUnmounted(stopQr)
</script>

<template>
  <header class="bp-settings-header">
    <h1>{{ t('settings.center') }}</h1>
    <div class="bp-settings-actions">
      <button :aria-label="t('membership.scanLogin')" :title="t('membership.scanLogin')" @click="openQr"><QrCode :size="24" /></button>
      <button :aria-label="t('trakt.account')" title="Trakt" @click="showTrakt = true">
        <TraktAvatar v-if="traktStatus.connected" :src="traktAccount?.avatar" :size="40" />
        <img v-else :src="traktLogo" alt="" width="28" height="28" />
      </button>
    </div>
  </header>
  <button v-if="!pro" class="bp-upgrade-banner" @click="emit('membership')"><span>{{ t('membership.upgradeTo') }}<strong>BoxPlayer PRO</strong></span><span aria-hidden="true">›</span></button>
  <section v-else class="bp-membership-banner">
    <template v-if="signedIn"><div class="bp-banner-email">{{ email }}</div><div v-if="!pro" class="bp-banner-standard">{{ t('membership.badge.standard') }}</div></template>
    <template v-if="pro"><BoxPlayerProBadge :tier="tier" /></template>
    <h2 v-else>{{ t('membership.upgradeHeadline') }}</h2>
    <button class="bp-banner-action" @click="emit('membership')">{{ t(pro ? 'membership.manage' : 'membership.learnMore') }}</button>
  </section>
  <TraktAccountModal :visible="showTrakt" @close="showTrakt = false" />
  <a-modal :visible="showQr" :title="t('membership.scanLogin')" :footer="false" :width="360" @cancel="closeQr">
    <div class="bp-qr-login">
      <template v-if="qr && !qrError"><AntQRCode :value="qr.verificationURIComplete" :size="232" color="#000" bg-color="#fff" /><p>{{ qr.userCode }}</p></template>
      <p v-else-if="qrError" role="alert">{{ qrError }}</p>
      <a-spin v-else />
      <a-button v-if="qrError" @click="openQr">{{ t('trakt.retry') }}</a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.bp-settings-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 22px;background:var(--color-bg-1)}.bp-settings-header h1{font-size:30px;margin:0;font-weight:750}.bp-settings-actions{display:flex;gap:12px}.bp-settings-actions button{width:46px;height:46px;display:grid;place-items:center;padding:3px;border:1px solid #5b806348;border-radius:50%;color:#afc9ba;background:#6c937417;cursor:pointer}.bp-settings-actions button:focus-visible,.bp-banner-action:focus-visible{outline:2px solid #20c66d;outline-offset:3px}
.bp-membership-banner{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;flex-direction:column;gap:20px;padding:30px 24px;color:white;text-align:center;background:linear-gradient(90deg,#008f52 0%,#12b55c 50%,#80d63d 100%)}.bp-membership-banner:before,.bp-membership-banner:after{content:'';position:absolute;inset:0;z-index:-1}.bp-membership-banner:before{background:#00cfad;clip-path:polygon(0 0,17% 0,0 65%)}.bp-membership-banner:after{background:#b3eb5866;clip-path:polygon(95% 0,100% 0,100% 100%,80% 100%)}.bp-banner-email{max-width:100%;font-size:14px;font-weight:600;overflow-wrap:anywhere}.bp-banner-standard{font-size:12px;margin-top:-12px}.bp-membership-banner h2{font-size:26px;line-height:1.5;white-space:pre-line;margin:12px 0 18px;font-weight:750}.bp-membership-banner :deep(.bp-pro-badge){margin-top:8px;min-height:32px}.bp-banner-action{border:0;border-radius:28px;background:white;color:#0ba653;line-height:1.2;font-family:inherit;font-size:18px;font-weight:700;padding:14px 28px;cursor:pointer}.bp-qr-login{min-height:260px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}.bp-qr-login p{overflow-wrap:anywhere}
</style>

<style scoped>
.bp-upgrade-banner{position:relative;overflow:hidden;isolation:isolate;display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:24px;border:0;border-radius:20px;background:linear-gradient(90deg,#008f52 0%,#12b55c 50%,#80d63d 100%);color:white;text-align:left;cursor:pointer;font:inherit}
.bp-upgrade-banner:before{content:'';position:absolute;inset:0;background:#ffffff19;clip-path:polygon(20% 0,63% 0,40% 100%,0 100%);z-index:-1}.bp-upgrade-banner>span:first-child{font-size:14px;font-weight:600}.bp-upgrade-banner strong{display:block;font-size:26px;line-height:1.3}.bp-upgrade-banner>span:last-child{font-size:28px}
</style>
