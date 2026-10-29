<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { readPersonalRatings, savePersonalRating } from '../utils/mediaPersonalRating'
import { loadTraktStatus, syncTrakt, traktError } from '../services/trakt/client'
import type { TraktIdentity } from '@shared/trakt'
const target = ref<({ id: string; name: string } & Partial<TraktIdentity>) | null>(null)
const busy = ref(false)
const rating = ref(0)
const error = ref('')
function open(event: Event) {
  if (busy.value) return
  const item = (event as CustomEvent).detail
  if (!item?.id || !item?.name) return
  target.value = item; error.value = ''
  if (window.Electron?.ipcRenderer) void loadTraktStatus().catch(e => { error.value = traktError(e) })
  try { rating.value = readPersonalRatings()[item.id] || 0 } catch { rating.value = 0; error.value = t('posterMenu.ratingSaveError') }
}
function close() { if (!busy.value) target.value = null }
async function save() {
  if (!target.value || !rating.value || busy.value) return
  busy.value = true; error.value = ''
  const item = target.value
  try {
    if (window.Electron?.ipcRenderer && (await loadTraktStatus()).connected) await syncTrakt(item as TraktIdentity, 'rating', rating.value)
    savePersonalRating(item.id, rating.value); target.value = null
  } catch (e) { error.value = String(e).includes('TRAKT_') ? traktError(e) : t('posterMenu.ratingSaveError') }
  finally { busy.value = false }
}
onMounted(() => window.addEventListener('boxplayer:personal-rating', open))
onUnmounted(() => window.removeEventListener('boxplayer:personal-rating', open))
</script>
<template>
  <a-modal class="personal-rating-modal" :visible="!!target" :footer="false" :width="372" :mask-closable="!busy" :esc-to-close="!busy" @cancel="close">
    <div class="personal-rating">
      <div aria-hidden="true" class="personal-rating__icon">🍿</div>
      <div class="personal-rating__heading">
        <strong>{{ t('posterMenu.ratingPrompt') }}</strong>
        <span>《{{ target?.name }}》</span>
      </div>
      <a-rate v-model="rating" :count="10" :allow-half="false" :disabled="busy" />
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="personal-rating__actions">
        <a-button :disabled="busy" @click="close">{{ t('common.cancel') }}</a-button>
        <a-button type="primary" :loading="busy" :disabled="rating < 1" @click="save">{{ t('posterMenu.rating') }}</a-button>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.personal-rating{display:flex;flex-direction:column;align-items:center;color:#fff;padding:10px 8px 8px}.personal-rating__icon{display:grid;width:102px;height:102px;place-items:center;border-radius:50%;background:#fff4ec;font-size:44px}.personal-rating__heading{display:flex;max-width:100%;flex-direction:column;align-items:center;gap:3px;margin-top:16px;text-align:center}.personal-rating__heading strong{font-size:18px}.personal-rating__heading span{overflow:hidden;max-width:100%;font-size:16px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.personal-rating :deep(.arco-rate){display:flex;width:100%;justify-content:center;gap:2px;margin-top:14px;color:#ff8800}.personal-rating :deep(.arco-rate-character){margin:0;font-size:27px}.personal-rating__actions{display:grid;width:100%;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}.personal-rating__actions :deep(.arco-btn){height:52px;border:2px solid #ff8800;border-radius:9px;background:transparent;color:#ff8800;font-size:16px;font-weight:700}.personal-rating__actions :deep(.arco-btn-primary){background:#ff8800;color:#fff}.personal-rating__actions :deep(.arco-btn-disabled){opacity:.45}.personal-rating p{width:100%;margin:12px 0 0;color:var(--color-danger-light-4);text-align:center}
:global(.personal-rating-modal .arco-modal){max-width:calc(100vw - 32px);border:1px solid rgb(255 255 255 / 20%);border-radius:24px;background: var(--app-overlay-bg);box-shadow:0 24px 60px rgb(0 0 0 / 48%)}:global(.personal-rating-modal .arco-modal-header){display:none}:global(.personal-rating-modal .arco-modal-body){padding:22px 24px 24px}@media (max-width:420px){.personal-rating__icon{width:88px;height:88px}.personal-rating :deep(.arco-rate-character){font-size:23px}.personal-rating__actions{gap:10px}:global(.personal-rating-modal .arco-modal-body){padding:18px 16px 20px}}
</style>
