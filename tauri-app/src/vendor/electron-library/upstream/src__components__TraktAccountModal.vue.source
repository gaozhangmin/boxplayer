<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue'
import { t } from '../i18n'
import MediaLoadingIndicator from './MediaLoadingIndicator.vue'
import { traktStatus, traktAccount, loadTraktStatus, loadTraktAccount, traktSyncEnabled, setTraktSyncEnabled, traktSyncRange, setTraktSyncRange, syncTraktPlaybackProgress, startTraktLogin, openTraktVip, cancelTraktLogin, logoutTrakt, traktError } from '../services/trakt/client'
import TraktAvatar from './TraktAvatar.vue'
import { IconExport, IconClose } from '@arco-design/web-vue/es/icon'
const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()
const login = ref(false)
const busy = ref(false)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
function stop() { generation++; clearTimeout(timer); login.value = false; busy.value = false }
async function close() { stop(); await cancelTraktLogin().catch(() => undefined); emit('close') }
async function begin() {
  stop(); error.value = ''; busy.value = true
  const attempt = generation
  try {
    login.value = true
    const status = await startTraktLogin()
    if (attempt !== generation) return
    traktStatus.value = status
    stop()
    await refreshAccount()
    setTraktSyncEnabled(true)
  } catch (e) { if (attempt === generation) { stop(); error.value = traktError(e) } }
}
async function disconnect() { busy.value = true; error.value = ''; try { await logoutTrakt() } catch (e) { error.value = traktError(e) } finally { busy.value = false } }
async function refreshAccount() { busy.value = true; try { await loadTraktAccount() } catch (e) { error.value = traktError(e) } finally { busy.value = false } }
watch(() => props.visible, async visible => {
  if (!visible) { stop(); void cancelTraktLogin().catch(() => undefined); return }
  error.value = ''; busy.value = true
  try { await loadTraktStatus(); if (props.visible && traktStatus.value.connected) { await refreshAccount(); if (traktSyncEnabled.value) void syncTraktPlaybackProgress().catch(e => error.value = traktError(e)) } } catch (e) { error.value = traktError(e) } finally { busy.value = false }
})
onUnmounted(() => { stop(); void cancelTraktLogin().catch(() => undefined) })
</script>
<template>
  <a-modal :visible="visible" :title="traktStatus.connected ? undefined : 'Trakt'" :width="384" :footer="false" :modal-class="traktStatus.connected ? 'trakt-profile-modal' : ''" @cancel="close">
    <div class="trakt-account">
      <template v-if="traktStatus.connected">
        <button class="profile-close" :aria-label="t('common.cancel')" @click="close"><IconClose /></button>
        <div class="profile-avatar"><TraktAvatar :src="traktAccount?.avatar" :size="118" /><span v-if="traktAccount?.vip" class="vip-badge">Trakt VIP</span><button v-else-if="traktAccount" class="vip-badge" @click="openTraktVip().catch(e => error = traktError(e))">{{ t('trakt.vipUpgrade') }}</button></div>
        <h2>{{ traktAccount?.name || traktStatus.username || 'Trakt' }}</h2>
        <div class="profile-stats" :aria-busy="busy">
          <div><strong>{{ traktAccount?.episodes ?? '—' }}</strong><span>{{ t('trakt.episodes') }}</span></div>
          <div><strong>{{ traktAccount?.shows ?? '—' }}</strong><span>{{ t('trakt.shows') }}</span></div>
          <div><strong>{{ traktAccount?.movies ?? '—' }}</strong><span>{{ t('trakt.movies') }}</span></div>
        </div>
        <MediaLoadingIndicator v-if="busy" class="profile-loading" :size="24" />
        <label class="profile-sync" :title="t('trakt.syncNote')"><span>{{ t('trakt.syncRecords') }}</span><input type="checkbox" :checked="traktSyncEnabled" @change="setTraktSyncEnabled(($event.target as HTMLInputElement).checked)" /></label>
        <label class="profile-sync"><span>{{ t('trakt.syncRange') }}</span><select :value="traktSyncRange" @change="setTraktSyncRange(Number(($event.target as HTMLSelectElement).value))"><option :value="-1">{{ t('trakt.rangeAll') }}</option><option :value="7">{{ t('trakt.rangeWeek') }}</option><option :value="30">{{ t('trakt.rangeMonth') }}</option><option :value="180">{{ t('trakt.rangeHalfYear') }}</option><option :value="365">{{ t('trakt.rangeYear') }}</option></select></label>
        <div class="profile-footer"><a-button size="small" :loading="busy" @click="disconnect"><IconExport />{{ t('trakt.disconnect') }}</a-button></div>
      </template>
      <template v-else-if="login">
        <div class="trakt-wait"><MediaLoadingIndicator :size="24" /><span>{{ t('trakt.waiting') }}</span></div>
        <a-button @click="close">{{ t('common.cancel') }}</a-button>
      </template>
      <template v-else>
        <p>{{ t('trakt.description') }}</p>
        <p v-if="!traktStatus.configured">{{ t('trakt.configRequired') }}</p>
        <a-button type="primary" :loading="busy" :disabled="!traktStatus.configured" @click="begin">{{ t('trakt.connect') }}</a-button>
      </template>
      <p v-if="error" role="alert" class="trakt-error">{{ error }}<button v-if="traktStatus.connected" @click="error = ''; refreshAccount()">{{ t('trakt.retry') }}</button></p>
    </div>
  </a-modal>
</template>
<style scoped>
.trakt-account{display:flex;flex-direction:column;gap:16px}.trakt-account p{margin:0;color:var(--color-text-2);line-height:1.6}.trakt-account .device-code{text-align:center;font-size:30px;letter-spacing:4px;padding:15px;border-radius:12px;background:var(--color-fill-2)}.trakt-wait{display:flex;align-items:center;justify-content:center;gap:12px}.trakt-account .trakt-error{color:var(--color-danger-light-4)}
.profile-avatar{position:relative;align-self:center;margin-top:-76px;margin-bottom:12px}.vip-badge{position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);border-radius:16px;background:#eee;color:#333;padding:5px 9px;white-space:nowrap;font-size:12px;font-weight:600}.trakt-account h2{margin:0;text-align:center;font-size:36px;line-height:1.2;font-weight:700;overflow-wrap:anywhere}.profile-stats{display:grid;grid-template-columns:repeat(3,1fr);margin-top:5px;text-align:center}.profile-stats div{display:flex;flex-direction:column;gap:6px}.profile-stats strong{font-size:21px}.profile-stats span{font-size:15px}.profile-sync{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff12;padding-bottom:8px;font-size:18px;cursor:pointer}.profile-sync input{width:17px;height:17px;accent-color:#1684ff}.profile-footer{margin-top:-8px}.profile-footer .arco-btn{background:#ffffff12;color:#eee;border-radius:6px}.profile-loading{position:absolute;right:18px;top:18px}.trakt-error button{margin-left:8px;cursor:pointer}
</style>
<style>
.profile-close{position:absolute;right:10px;top:10px;border:0;background:transparent;color:#aaa;cursor:pointer;padding:6px;display:grid;place-items:center}.profile-close:focus-visible{outline:2px solid #1684ff;border-radius:50%}
.trakt-profile-modal.arco-modal{background: var(--app-overlay-bg);color:#eee;border-radius:12px;overflow:visible}.trakt-profile-modal .arco-modal-body{padding:16px 17px 28px;overflow:visible}.trakt-profile-modal .arco-modal-close-btn{top:10px;right:10px;color:#aaa}.trakt-profile-modal .arco-modal-header{display:none}
</style>
