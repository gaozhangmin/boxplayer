<script setup lang="ts">
import { BellRing, CheckCircle2, CircleDotDashed, RefreshCw, SearchCheck, X } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import message from '../../utils/message'
import { t } from '../../i18n'
import { endMediaAcquisitionTracking, listMediaAcquisitionTracking, runMediaAcquisitionTrackingPatrol } from '../../services/mediaAcquisition/client'
import type { MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'

const items = ref<MediaAcquisitionTrackingItem[]>([])
const loading = ref(false)
const patrolling = ref(false)
const endingId = ref('')
let timer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  loading.value = true
  try {
    items.value = (await listMediaAcquisitionTracking()).filter(item => item.status !== 'ended')
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tracking.readFailed'))
  } finally {
    loading.value = false
  }
}

// mediary patrols every tracked season in one sweep.
async function patrol() {
  patrolling.value = true
  try {
    await runMediaAcquisitionTrackingPatrol()
    await refresh()
    message.success(t('ai.media.tracking.allDone'))
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tracking.patrolFailed'))
  } finally {
    patrolling.value = false
  }
}

async function endTracking(id: string) {
  endingId.value = id
  try {
    await endMediaAcquisitionTracking(id)
    await refresh()
    message.success(t('ai.media.tracking.cancelSuccess'))
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tracking.cancelFailed'))
  } finally {
    endingId.value = ''
  }
}

function checkTime(value?: number) {
  return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('ai.media.tracking.waitFirstCheck')
}

function trackingStatusLabel(item: MediaAcquisitionTrackingItem) {
  return item.status === 'complete' ? t('ai.media.tracking.complete') : item.missingEpisodes.length ? t('ai.media.tracking.waiting') : t('ai.media.tracking.tracking')
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 10_000)
})
onBeforeUnmount(() => timer && clearInterval(timer))
</script>

<template>
  <section class="tracking-page">
    <header class="tracking-head">
      <div><span>MEDIA ACQUISITION</span><h2>{{ t('ai.media.tracking.title') }}</h2><p>{{ t('ai.media.tracking.subtitle') }}</p></div>
      <div class="tracking-tools"><button type="button" :disabled="patrolling" :title="t('ai.media.tracking.patrolAllTitle')" @click="patrol()"><SearchCheck :size="16" :class="{ spin: patrolling }" /></button><button type="button" :disabled="loading" :title="t('ai.media.tracking.refreshTitle')" @click="refresh"><RefreshCw :size="16" :class="{ spin: loading }" /></button></div>
    </header>
    <div v-if="!items.length && !loading" class="tracking-empty"><BellRing :size="26" /><strong>{{ t('ai.media.tracking.emptyTitle') }}</strong><span>{{ t('ai.media.tracking.emptyDesc') }}</span></div>
    <div v-else class="tracking-list">
      <article v-for="item in items" :key="item.id" class="tracking-card">
        <CheckCircle2 v-if="item.status === 'complete'" :size="22" class="complete" />
        <CircleDotDashed v-else :size="22" class="active" />
        <div class="tracking-main"><strong>{{ item.title }} · {{ t('ai.media.tracking.season', { number: item.seasonNumber }) }}</strong><p>{{ t('ai.media.tracking.stats', { obtained: item.obtainedEpisodes, aired: item.latestAiredEpisode || '?', total: item.totalEpisodes || '?' }) }} <template v-if="item.missingEpisodes.length">· {{ t('ai.media.tracking.missing', { episodes: item.missingEpisodes.join('、E') }) }}</template><template v-else-if="item.status === 'tracking'">· {{ t('ai.media.tracking.upToDate') }}</template></p><small>{{ t('ai.media.tracking.nextCheck') }}{{ checkTime(item.nextCheckAt) }}</small></div>
        <div class="tracking-actions"><span :class="['tracking-status', item.status]">{{ trackingStatusLabel(item) }}</span><a-popconfirm :content="t('ai.media.tracking.cancelConfirm')" @ok="endTracking(item.id)"><button type="button" :title="t('ai.media.tracking.cancelTitle')" :disabled="endingId === item.id"><X :size="14" /></button></a-popconfirm></div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.tracking-page { height: 100%; overflow: auto; padding: 32px; color: var(--color-text-1); background: var(--color-bg-1); }.tracking-head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border-2); }.tracking-head span { color: rgb(var(--primary-6)); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }.tracking-head h2 { margin: 5px 0; font-size: 25px; }.tracking-head p { margin: 0; color: var(--color-text-3); }.tracking-head button, .tracking-actions button { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--color-border-2); border-radius: 6px; color: var(--color-text-2); background: transparent; cursor: pointer; }.tracking-tools, .tracking-actions { display: flex; align-items: center; gap: 7px; }.tracking-actions button { width: 28px; height: 28px; }.tracking-empty { min-height: 280px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--color-text-3); }.tracking-empty strong { color: var(--color-text-1); }.tracking-list { display: grid; gap: 9px; max-width: 980px; padding-top: 22px; }.tracking-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 15px 16px; border: 1px solid var(--color-border-2); border-radius: 7px; background: var(--color-bg-2); }.tracking-main strong { display: block; }.tracking-main p, .tracking-main small { display: block; margin: 5px 0 0; color: var(--color-text-3); font-size: 12px; }.tracking-main small { font-size: 11px; }.tracking-status { padding: 4px 8px; border-radius: 99px; color: rgb(var(--primary-6)); background: rgb(var(--primary-1)); font-size: 12px; white-space: nowrap; }.tracking-status.complete { color: rgb(var(--success-6)); background: rgb(var(--success-1)); }.active { color: rgb(var(--primary-6)); }.complete { color: rgb(var(--success-6)); }.spin { animation: tracking-spin .8s linear infinite; }@keyframes tracking-spin { to { transform: rotate(360deg); } }
</style>
