<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert, Clock3, LoaderCircle, RefreshCw, RotateCcw, Trash2, X } from 'lucide-vue-next'
import message from '../../utils/message'
import { t } from '../../i18n'
import { cancelMediaAcquisitionRun, clearCompletedMediaAcquisitionRuns, listMediaAcquisitionRuns, retryMediaAcquisitionRun } from '../../services/mediaAcquisition/client'
import { MEDIARY_CHANGED_EVENT } from '../../services/mediaAcquisition/mediaryBridge'
import type { MediaAcquisitionRunView } from '@shared/types/mediaAcquisition'

const runs = ref<MediaAcquisitionRunView[]>([])
const loading = ref(false)
const retryingRunId = ref('')
const clearingCompleted = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const processingRuns = computed(() => runs.value.filter(run => ['searching', 'selecting', 'transferring', 'verifying', 'organizing'].includes(run.status)))
const queuedRuns = computed(() => runs.value.filter(run => ['reserved', 'queued', 'retry_wait'].includes(run.status)))
const completedRuns = computed(() => runs.value.filter(run => ['completed', 'partial', 'no_coverage', 'failed', 'cancelled'].includes(run.status)))
// The mediary agent cannot be interrupted mid-run, so only waiting tasks can be cancelled.
const endableStatuses = new Set<MediaAcquisitionRunView['status']>(['queued', 'retry_wait'])

async function refresh() {
  loading.value = true
  try {
    runs.value = await listMediaAcquisitionRuns(60)
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tasks.readFailed'))
  } finally {
    loading.value = false
  }
}

async function cancel(run: MediaAcquisitionRunView) {
  try {
    await cancelMediaAcquisitionRun(run.id)
    message.success(t('ai.media.tasks.forceEnded'))
  } catch (error: any) {
    message.warning(error?.message || t('ai.media.tasks.stillProcessing'))
  } finally {
    await refresh()
  }
}

async function retry(run: MediaAcquisitionRunView) {
  retryingRunId.value = run.id
  try {
    await retryMediaAcquisitionRun(run.id)
    await refresh()
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tasks.readFailed'))
  } finally {
    retryingRunId.value = ''
  }
}

async function clearCompleted() {
  if (!completedRuns.value.length) return
  clearingCompleted.value = true
  try {
    const count = await clearCompletedMediaAcquisitionRuns()
    message.success(t('ai.media.tasks.clearCompletedSuccess', { count }))
    await refresh()
  } catch (error: any) {
    message.error(error?.message || t('ai.media.tasks.clearCompletedFailed'))
  } finally {
    clearingCompleted.value = false
  }
}

function statusLabel(status: MediaAcquisitionRunView['status']) {
  return ({ reserved: t('ai.media.tasks.status.reserved'), queued: t('ai.media.tasks.status.queued'), searching: t('ai.media.tasks.status.searching'), selecting: t('ai.media.tasks.status.selecting'), transferring: t('ai.media.tasks.status.transferring'), verifying: t('ai.media.tasks.status.verifying'), organizing: t('ai.media.tasks.status.organizing'), retry_wait: t('ai.media.tasks.status.retryWait'), completed: t('ai.media.tasks.status.completed'), partial: t('ai.media.tasks.status.partial'), no_coverage: t('ai.media.tasks.status.noCoverage'), failed: t('ai.media.tasks.status.failed'), cancelled: t('ai.media.tasks.status.cancelled') } as Record<string, string>)[status] || status
}

function phaseLabel(phase: string) {
  return ({ queued: t('ai.media.tasks.phase.queued'), search: t('ai.media.tasks.phase.search'), select: t('ai.media.tasks.phase.select'), transfer: t('ai.media.tasks.phase.transfer'), verify: t('ai.media.tasks.phase.verify'), organize: t('ai.media.tasks.phase.organize'), finalize: t('ai.media.tasks.phase.finalize') } as Record<string, string>)[phase] || phase
}

function formatTime(time: number) {
  return new Date(time).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) return t('ai.media.tasks.seconds', { count: seconds })
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return t('ai.media.tasks.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? t('ai.media.tasks.hoursMinutes', { hours, minutes: restMinutes }) : t('ai.media.tasks.hours', { count: hours })
}

function retryHint(run: MediaAcquisitionRunView) {
  if (!['reserved', 'retry_wait', 'queued'].includes(run.status) || !run.nextAttemptAt) return ''
  if (run.status === 'reserved') return t('ai.media.tasks.reservedHint', { time: formatTime(run.nextAttemptAt) })
  const remaining = run.nextAttemptAt - Date.now()
  if (run.status === 'queued' && run.searchAttemptCount) return remaining > 0 ? t('ai.media.tasks.searchRetryLater', { count: run.searchAttemptCount, duration: formatDuration(remaining) }) : t('ai.media.tasks.searchRetryDue')
  return remaining > 0 ? t('ai.media.tasks.retryLater', { count: run.attemptCount, duration: formatDuration(remaining) }) : t('ai.media.tasks.retryDue')
}

function candidateStatusLabel(candidate: MediaAcquisitionRunView['candidates'][number]) {
  return ({ selected: t('ai.media.tasks.candidate.selected'), imported: t('ai.media.tasks.candidate.imported'), transferring: t('ai.media.tasks.candidate.transferring'), failed: t('ai.media.tasks.candidate.failed'), rejected: t('ai.media.tasks.candidate.rejected'), pending: t('ai.media.tasks.candidate.pending') } as Record<string, string>)[candidate.status] || candidate.status
}

function candidateHint(run: MediaAcquisitionRunView, candidate: MediaAcquisitionRunView['candidates'][number]) {
  if (candidate.lastError) return candidate.lastError
  const decision = [...(run.decisions || [])].reverse().find(item => item.candidateId === candidate.id && (item.decision === 'select' || item.decision === 'reject'))
  if (decision?.reason) {
    const normalize = (value: string) => value.replace(/[\s\u3000]+/g, '').toLowerCase()
    const targetTitle = normalize(run.target.title)
    // Older runs may contain an Agent-generated reason copied from another title.
    // Do not expose it as if it were evidence for this task.
    if (targetTitle.length >= 2 && !normalize(decision.reason).includes(targetTitle)) return t('ai.media.tasks.candidateMatched', { candidate: candidate.title, target: run.target.title })
    return decision.reason
  }
  if (candidate.status === 'rejected') return t('ai.media.tasks.rejectedHint')
  return ''
}

function eventMessage(run: MediaAcquisitionRunView, event: MediaAcquisitionRunView['events'][number]) {
  const candidateId = typeof event.data?.candidateId === 'string' ? event.data.candidateId : undefined
  if (event.phase === 'select' && event.data?.tool === 'transferCandidate' && candidateId && event.message.startsWith('Agent 决策：')) {
    const candidate = run.candidates.find(item => item.id === candidateId)
    if (candidate) return t('ai.media.tasks.agentDecision', { reason: t('ai.media.tasks.candidateMatched', { candidate: candidate.title, target: run.target.title }) })
  }
  return event.message
}

const onChanged = () => void refresh()

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 2500)
  window.addEventListener(MEDIARY_CHANGED_EVENT, onChanged)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener(MEDIARY_CHANGED_EVENT, onChanged)
})
</script>

<template>
  <section class="media-task-page">
    <header class="media-task-head">
      <div>
        <span class="media-task-kicker">MEDIA ACQUISITION</span>
        <h2>{{ t('ai.media.tasks.title') }}</h2>
        <p>{{ t('ai.media.tasks.subtitle') }}</p>
      </div>
      <div class="media-task-head-actions">
        <button type="button" class="media-task-clear" :disabled="clearingCompleted || !completedRuns.length" :title="t('ai.media.tasks.clearCompletedTitle')" @click="clearCompleted"><Trash2 :size="15" />{{ t('common.clear') }}</button>
        <button type="button" class="media-task-refresh" :disabled="loading" :title="t('ai.media.tasks.refreshTitle')" @click="refresh">
          <LoaderCircle v-if="loading" :size="16" class="spin" />
          <RefreshCw v-else :size="16" />
        </button>
      </div>
    </header>

    <div v-if="!runs.length && !loading" class="media-task-empty">
      <Clock3 :size="28" />
      <strong>{{ t('ai.media.tasks.emptyTitle') }}</strong>
      <span>{{ t('ai.media.tasks.emptyDesc') }}</span>
    </div>

    <div v-else class="media-task-list">
      <section v-if="processingRuns.length" class="media-task-section">
        <h3>{{ t('ai.media.tasks.processing') }} <span>{{ processingRuns.length }}</span></h3>
        <article v-for="run in processingRuns" :key="run.id" class="media-task-card is-active">
          <div class="media-task-card-head">
            <strong>{{ run.target.title }}</strong>
            <span class="media-task-status">{{ statusLabel(run.status) }}</span>
          </div>
          <div class="media-task-meta">{{ run.target.targetPlatform }} · {{ run.target.targetDriveId }} · {{ run.kind === 'season' ? t('ai.media.tasks.singleSeason') : t('ai.media.tasks.mediaAcquire') }}</div>
          <div class="media-task-progress"><i :style="{ width: `${Math.max(4, run.progress)}%` }" /></div>
          <div class="media-task-activity">{{ run.activity }}</div>
          <div v-if="run.events.length" class="media-task-ticker">
            <div v-for="event in run.events.slice(-8).reverse()" :key="event.id" class="media-task-ticker-row" :class="event.level">
              <span class="media-task-ticker-phase">{{ phaseLabel(event.phase) }}</span>
              <span class="media-task-ticker-message">{{ eventMessage(run, event) }}</span>
              <time>{{ formatTime(event.createdAt) }}</time>
            </div>
          </div>
          <div v-if="run.candidates.length" class="media-task-candidates">
            <div v-for="candidate in run.candidates" :key="candidate.id" :class="['media-task-candidate', candidate.status]">
              <div class="media-task-candidate-main">
                <span>{{ candidate.sourcePlatform }} · {{ candidate.title }}</span>
                <small v-if="candidateHint(run, candidate)">{{ candidateHint(run, candidate) }}</small>
              </div>
              <em>{{ candidateStatusLabel(candidate) }}</em>
            </div>
          </div>
          <div class="media-task-actions">
            <span>{{ formatTime(run.startedAt) }}</span>
            <button v-if="endableStatuses.has(run.status)" type="button" @click="cancel(run)"><X :size="13" />{{ t('common.cancel') }}</button>
          </div>
        </article>
      </section>

      <section v-if="queuedRuns.length" class="media-task-section">
        <h3>{{ t('ai.media.tasks.queued') }} <span>{{ queuedRuns.length }}</span></h3>
        <article v-for="run in queuedRuns" :key="run.id" class="media-task-card">
          <div class="media-task-card-head"><strong>{{ run.target.title }}</strong><span class="media-task-status">{{ statusLabel(run.status) }}</span></div>
          <div class="media-task-meta">{{ run.target.targetPlatform }} · {{ run.target.targetDriveId }} · {{ run.kind === 'season' ? t('ai.media.tasks.singleSeason') : t('ai.media.tasks.mediaAcquire') }}</div>
          <div class="media-task-activity">{{ run.activity }}</div>
          <div v-if="retryHint(run)" class="media-task-retry">
            <Clock3 :size="13" />
            <span>{{ retryHint(run) }}</span>
            <time v-if="run.nextAttemptAt">{{ t('ai.media.tasks.next') }}{{ formatTime(run.nextAttemptAt) }}</time>
          </div>
          <div class="media-task-actions">
            <span>{{ formatTime(run.startedAt) }}</span>
            <button v-if="endableStatuses.has(run.status)" type="button" @click="cancel(run)"><X :size="13" />{{ t('common.cancel') }}</button>
          </div>
        </article>
      </section>

      <section v-if="completedRuns.length" class="media-task-section">
        <h3>{{ t('ai.media.tasks.completed') }} <span>{{ completedRuns.length }}</span></h3>
        <article v-for="run in completedRuns" :key="run.id" class="media-task-card">
          <div class="media-task-card-head">
            <strong>{{ run.target.title }}</strong>
            <span class="media-task-status" :class="{ error: run.status === 'failed', warning: run.status === 'partial' || run.status === 'no_coverage' }">{{ statusLabel(run.status) }}</span>
          </div>
          <div class="media-task-meta">{{ run.target.targetPlatform }} · {{ formatTime(run.startedAt) }}</div>
          <div v-if="run.errorMessage" class="media-task-error"><CircleAlert :size="14" />{{ run.errorMessage }}</div>
          <div class="media-task-activity">{{ run.status === 'completed' ? t('ai.media.status.completedLibrary') : (run.events.at(-1)?.message || run.activity) }}</div>
          <div v-if="run.events.length" class="media-task-ticker compact">
            <div v-for="event in run.events.slice(-4).reverse()" :key="event.id" class="media-task-ticker-row" :class="event.level">
              <span class="media-task-ticker-phase">{{ phaseLabel(event.phase) }}</span>
              <span class="media-task-ticker-message">{{ event.message }}</span>
              <time>{{ formatTime(event.createdAt) }}</time>
            </div>
          </div>
          <div v-if="run.status === 'failed'" class="media-task-actions">
            <span />
            <button type="button" :disabled="retryingRunId === run.id" @click="retry(run)"><RotateCcw :size="13" />{{ t('common.retry') }}</button>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.media-task-page { height: 100%; overflow: auto; padding: 32px; color: var(--color-text-1); background: var(--color-bg-1); }
.media-task-head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border-2); }
.media-task-kicker { display: block; color: rgb(var(--primary-6)); font-size: 11px; font-weight: 700; letter-spacing: 1.2px; }
.media-task-head h2 { margin: 5px 0; font-size: 25px; }
.media-task-head p { margin: 0; color: var(--color-text-3); }
.media-task-head-actions { display: flex; align-items: center; gap: 8px; }.media-task-refresh, .media-task-clear { height: 34px; border: 1px solid var(--color-border-2); border-radius: 6px; color: var(--color-text-2); background: transparent; cursor: pointer; }.media-task-refresh { width: 34px; }.media-task-clear { display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; }.media-task-refresh:disabled, .media-task-clear:disabled { cursor: not-allowed; opacity: .45; }
.media-task-empty { min-height: 310px; display: flex; flex-direction: column; gap: 10px; align-items: center; justify-content: center; color: var(--color-text-3); }
.media-task-empty strong { color: var(--color-text-1); }
.media-task-list { display: grid; gap: 28px; padding-top: 24px; max-width: 900px; }
.media-task-section { display: grid; gap: 10px; }
.media-task-section h3 { margin: 0; font-size: 14px; color: var(--color-text-2); }
.media-task-section h3 span { color: rgb(var(--primary-6)); }
.media-task-card { padding: 14px 16px; border: 1px solid var(--color-border-2); border-radius: 7px; background: var(--color-bg-2); }
.media-task-card.is-active { border-color: rgb(var(--primary-6)); }
.media-task-card-head, .media-task-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.media-task-status { color: rgb(var(--primary-6)); font-size: 12px; }.media-task-status.error, .media-task-error { color: rgb(var(--danger-6)); }.media-task-status.warning { color: rgb(var(--warning-6)); }
.media-task-meta, .media-task-activity, .media-task-actions { margin-top: 7px; font-size: 12px; color: var(--color-text-3); }
.media-task-progress { height: 4px; overflow: hidden; margin-top: 12px; border-radius: 99px; background: var(--color-fill-2); }.media-task-progress i { display: block; height: 100%; border-radius: inherit; background: rgb(var(--primary-6)); }
.media-task-actions button { display: inline-flex; gap: 3px; align-items: center; padding: 3px 7px; border: 0; color: var(--color-text-2); background: transparent; cursor: pointer; }.media-task-error { display: flex; gap: 5px; align-items: center; margin-top: 8px; }
.media-task-add-source { display: flex; gap: 7px; margin-top: 12px; }.media-task-password { width: 88px; flex: 0 0 88px; }.media-task-add-source :deep(.arco-input-wrapper) { min-width: 0; }.media-task-add-source :deep(.arco-btn) { flex: 0 0 auto; }
.media-task-retry { display: flex; align-items: center; gap: 6px; margin-top: 9px; padding: 7px 9px; border: 1px solid color-mix(in srgb, rgb(var(--warning-6)) 28%, transparent); border-radius: 6px; color: rgb(var(--warning-6)); background: color-mix(in srgb, rgb(var(--warning-6)) 8%, transparent); font-size: 12px; }.media-task-retry span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.media-task-retry time { margin-left: auto; color: var(--color-text-3); white-space: nowrap; }
.media-task-duplicate-audit { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; padding: 8px 9px; border: 1px solid color-mix(in srgb, rgb(var(--warning-6)) 24%, transparent); border-radius: 6px; color: rgb(var(--warning-6)); background: color-mix(in srgb, rgb(var(--warning-6)) 7%, transparent); font-size: 12px; }.media-task-duplicate-audit span { min-width: 0; }.media-task-duplicate-audit :deep(.arco-btn) { display: inline-flex; flex: 0 0 auto; gap: 4px; align-items: center; }
.media-task-ticker { display: grid; gap: 4px; margin-top: 10px; padding-left: 9px; border-left: 2px solid var(--color-fill-3); color: var(--color-text-3); font-size: 11px; line-height: 17px; }.media-task-ticker.compact { max-height: 96px; overflow: hidden; }.media-task-ticker-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 7px; align-items: center; }.media-task-ticker-row.warning .media-task-ticker-phase { color: rgb(var(--warning-6)); }.media-task-ticker-row.error .media-task-ticker-phase { color: rgb(var(--danger-6)); }.media-task-ticker-phase { color: rgb(var(--primary-6)); font-weight: 650; }.media-task-ticker-message { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.media-task-ticker time { color: var(--color-text-4); font-size: 10px; }.media-task-candidates { display: grid; gap: 6px; margin-top: 11px; }.media-task-candidate { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 8px; border-radius: 4px; color: var(--color-text-2); background: var(--color-fill-2); font-size: 12px; }.media-task-candidate.selected { background: color-mix(in srgb, rgb(var(--primary-6)) 12%, var(--color-fill-2)); }.media-task-candidate.failed { background: color-mix(in srgb, rgb(var(--danger-6)) 10%, var(--color-fill-2)); }.media-task-candidate.rejected { opacity: .72; }.media-task-candidate-main { display: grid; min-width: 0; gap: 2px; }.media-task-candidate span, .media-task-candidate small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.media-task-candidate small { color: var(--color-text-3); font-size: 11px; }.media-task-candidate em { flex: 0 0 auto; color: var(--color-text-3); font-style: normal; }.media-task-candidate.failed em { color: rgb(var(--danger-6)); }.media-task-candidate.selected em { color: rgb(var(--primary-6)); }.media-task-candidate :deep(.arco-btn) { display: inline-flex; flex: 0 0 auto; gap: 3px; align-items: center; }
</style>
