<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Loader2, Sparkles } from 'lucide-vue-next'
import { openExternal } from '../utils/electronhelper'
import message from '../utils/message'
import { buildProPurchaseUrlForCurrentSession } from '../utils/boxplayerAuth'
import { t } from '../i18n'


const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean] }>()

const upgrading = ref(false)
const isLoggedIn = ref(false)
watch(() => props.visible, (v) => {
  if (v) try { isLoggedIn.value = localStorage.getItem('app_user_authed') === '1' } catch {}
})

async function handleUpgrade() {
  upgrading.value = true
  try {
    openExternal(await buildProPurchaseUrlForCurrentSession())
  } catch (error: any) {
    message.error(error?.message || t('settings.upgradeOpening'))
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <div v-if="visible" class="lim-mask" @click.self="emit('update:visible', false)">
    <div class="lim-modal">
      <button class="lim-close" @click="emit('update:visible', false)"><X :size="18" /></button>
      <div class="lim-icon"><Sparkles :size="32" /></div>
      <h2 class="lim-title">{{ t('upgrade.title') }}</h2>
      <p class="lim-desc">{{ t('upgrade.desc') }}</p>

      <table class="lim-table">
        <thead>
          <tr><th>{{ t('upgrade.feature') }}</th><th>{{ t('upgrade.openSource') }}</th><th class="pro-th">{{ t('upgrade.pro') }}</th></tr>
        </thead>
        <tbody>
          <tr><td>{{ t('upgrade.cloudFileManagement') }}</td><td class="yes">✓</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.videoMusicPlayback') }}</td><td class="yes">✓</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.localBookReading') }}</td><td class="yes">✓</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.multiDrive') }}</td><td class="yes">✓</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.builtInAi') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.aiSemanticSearch') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.aiAgentDriveSearch') }}</td><td class="limit">BYOK</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.aiReaderAssistant') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.localTts') }}</td><td class="yes">✓</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.cloudTts') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.instantTranslate') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.webResourceSearch') }}</td><td class="limit">{{ t('upgrade.fivePerDay') }}</td><td class="yes">✓</td></tr>
          <tr><td>{{ t('upgrade.prioritySupport') }}</td><td class="no">—</td><td class="yes">✓</td></tr>
        </tbody>
      </table>

      <div class="lim-price-row">
        <span class="lim-price-free">{{ t('upgrade.freePrice') }}</span>
        <span class="lim-price-pro"><span class="lim-old-price">$199</span> {{ t('upgrade.proPrice') }}</span>
      </div>

      <button v-if="isLoggedIn" class="lim-btn" :disabled="upgrading" @click="handleUpgrade">
        <Loader2 v-if="upgrading" :size="16" class="lim-spin" />
        <span v-else>官网登录并购买</span>
      </button>
      <button v-else class="lim-btn" @click="handleUpgrade">
        {{ t('upgrade.buyOnWebsite') }}
      </button>
      <button class="lim-skip" @click="emit('update:visible', false)">{{ t('upgrade.skip') }}</button>
    </div>
  </div>
</template>

<style scoped>
.lim-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:2000}
.lim-modal{position:relative;width:560px;max-width:94vw;max-height:90vh;overflow-y:auto;background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:16px;padding:28px 24px 20px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.2)}
.lim-close{position:absolute;top:12px;right:12px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;color:var(--color-text-4);background:transparent;border:0;border-radius:6px;cursor:pointer}
.lim-close:hover{background:var(--color-fill-2);color:var(--color-text-1)}
.lim-icon{color:rgb(var(--primary-6));margin-bottom:8px}
.lim-title{font-size:22px;font-weight:700;color:var(--color-text-1);margin:0 0 8px}
.lim-desc{font-size:14px;color:var(--color-text-3);margin:0 0 16px;line-height:1.5}

.lim-table{width:100%;border-collapse:collapse;margin-bottom:14px;text-align:left}
.lim-table th,.lim-table td{padding:9px 12px;font-size:13px;border-bottom:1px solid var(--color-border)}
.lim-table th{color:var(--color-text-3);font-weight:600;text-align:center}
.lim-table th:first-child,.lim-table td:first-child{text-align:left;color:var(--color-text-2)}
.pro-th{color:#b45309!important}
.yes{text-align:center;color:rgb(var(--success-6));font-weight:700;font-size:15px}
.no{text-align:center;color:var(--color-text-4);font-size:13px}
.limit{text-align:center;color:var(--color-text-3);font-size:12px}

.lim-price-row{display:flex;justify-content:center;gap:20px;margin-bottom:14px}
.lim-price-free{font-size:13px;color:var(--color-text-3)}
.lim-price-pro{font-size:13px;font-weight:700;color:#b45309}
.lim-old-price{color:var(--color-text-4);text-decoration:line-through;margin-right:6px}
.lim-btn{width:100%;padding:12px 0;font-size:15px;font-weight:600;color:#fff;background:linear-gradient(135deg,#f59e0b,#eab308);border:0;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px}
.lim-btn:hover:not(:disabled){opacity:.9}
.lim-btn:disabled{opacity:.5;cursor:default}
.lim-skip{display:block;width:100%;padding:8px 0;font-size:13px;color:var(--color-text-4);background:transparent;border:0;cursor:pointer;font-family:inherit;margin-top:4px}
.lim-skip:hover{color:var(--color-text-3)}
.lim-spin{animation:lim-spin 1s linear infinite}
@keyframes lim-spin{to{transform:rotate(360deg)}}
</style>
