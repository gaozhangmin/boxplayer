<script setup lang="ts">
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {Star} from 'lucide-vue-next'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { loadTraktStatus, personalTraktRatings, publicTraktRating, syncTrakt, traktError, type Identity } from '../trakt/client'
import { readServerRatings, saveServerRating, serverRatingKey } from './personalRatings'
import type { ServerItem } from './workspace'
const props = defineProps<{ accountId: string; item: ServerItem }>(), emit = defineEmits<{ close: []; rated: [rating?: number] }>()
const value = ref<string | number>(''), busy = ref(false), loading = ref(true), error = ref(''), publicRating = ref<{ rating: number; votes: number }>()
const identity = computed<Identity>(() => ({ type: props.item.kind === 'movie' ? 'movie' : props.item.kind === 'episode' ? 'episode' : 'tv', tmdbId: props.item.tmdbId, imdbId: props.item.imdbId }))
let alive = true
onBeforeUnmount(() => { alive = false })
onMounted(async () => {
 let local: number | undefined
 try { local = readServerRatings()[serverRatingKey(props.accountId,props.item.id)]; value.value = local == null ? '' : String(local) } catch(e) { error.value = (e as Error).message }
 try {
  const status = await loadTraktStatus()
  if (identity.value.tmdbId || identity.value.imdbId) {
   try { const result = await publicTraktRating(identity.value); if (alive) publicRating.value = result } catch { /* Public aggregate is optional; personal ratings remain usable. */ }
  }
  if (status.connected && status.settings.enabled && local === undefined) {
   const kind = identity.value.type === 'movie' ? 'movies' : identity.value.type === 'episode' ? 'episodes' : 'shows'
   for (let page = 1; page <= 100 && alive; page++) {
    const rows = await personalTraktRatings(kind, page)
    const record = rows.find(row => { const ids = (row.movie || row.show || row.episode)?.ids; return !!ids && (identity.value.tmdbId != null && ids.tmdb === identity.value.tmdbId || identity.value.imdbId != null && ids.imdb === identity.value.imdbId) })
    if (record) { if (alive) value.value = String(record.rating); break }
    if (rows.length < 100) break
   }
  }
 } catch (e) { if (alive) error.value = traktError(e) } finally { if (alive) loading.value = false }
})
async function save() {
 if (busy.value || loading.value) return
 const rating = String(value.value).trim() ? Number(value.value) : undefined
 if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 10)) { error.value = '个人评分必须为 1–10 的整数。'; return }
 const accountId = props.accountId, itemId = props.item.id, target = { ...identity.value }
 busy.value = true; error.value = ''
 try { const status = await loadTraktStatus(); if (status.connected && status.settings.enabled) await syncTrakt(target, rating === undefined ? 'rating-remove' : 'rating', rating); saveServerRating(accountId, itemId, rating); if (alive) { emit('rated', rating); emit('close') } } catch (e) { if (alive) error.value = traktError(e) } finally { if (alive) busy.value = false }
}
</script>
<template><ElectronModal label="个人评分" :width="372" :busy="busy" class="personal-rating-modal" @close="emit('close')"><form class="personal-rating" aria-label="个人评分" @submit.prevent="save"><div aria-hidden="true" class="personal-rating__icon">🍿</div><div class="personal-rating__heading"><strong>您觉得影片如何?</strong><span>《{{item.name}}》</span></div><div class="personal-rating-stars" role="radiogroup" aria-label="个人评分"><button v-for="score in 10" :key="score" type="button" role="radio" :aria-label="score+' 分'" :aria-checked="Number(value)===score" :disabled="busy||loading" @click="value=Number(value)===score?'':score"><Star :size="25" :fill="Number(value)>=score?'currentColor':'none'"/></button></div><p v-if="loading" role="status">正在读取评分…</p><p v-if="error" role="alert">{{error}}</p><div class="personal-rating__actions"><button type="button" :disabled="busy" @click="emit('close')">取消</button><button class="primary" :disabled="busy||loading">个人评分</button></div></form></ElectronModal></template><style scoped>.personal-rating{display:flex;flex-direction:column;align-items:center;padding:10px 8px 8px}.personal-rating__icon{display:grid;width:102px;height:102px;place-items:center;border-radius:50%;background:#fff4ec;font-size:44px}.personal-rating__heading{display:flex;max-width:100%;flex-direction:column;align-items:center;gap:3px;margin-top:16px;text-align:center}.personal-rating__heading strong{font-size:18px}.personal-rating__heading span{font-size:16px;font-weight:600}.personal-rating-stars{display:flex;justify-content:center;gap:2px;margin-top:14px;color:var(--primary)}.personal-rating-stars button{padding:0;border:0;background:transparent;cursor:pointer}.personal-rating__actions{display:grid;width:100%;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}.personal-rating__actions button{height:52px;border:2px solid var(--primary);border-radius:9px;background:transparent;color:var(--primary);font-size:16px;font-weight:700}.personal-rating__actions .primary{background:var(--primary);color:white}.personal-rating__actions button:disabled{opacity:.45}p[role=alert]{color:#ef6868}</style><style>.personal-rating-modal .electron-modal{border-radius:24px}</style>