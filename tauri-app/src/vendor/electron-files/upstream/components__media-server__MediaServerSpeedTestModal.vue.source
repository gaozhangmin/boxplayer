<template>
  <a-modal :visible="visible" :footer="false" :closable="false" :mask-closable="!running" :width="820" modal-class="server-speed-modal" @cancel="close">
    <div class="speed-header">
      <button type="button" :aria-label="t('unified.back')" @click="target ? backToBrowser() : stack.length ? up() : close()"><ChevronLeft :size="20" /></button>
      <h2>{{ target ? t('mediaServer.speedTest') : stack[stack.length - 1]?.title || server.name }}</h2>
      <button v-if="target" type="button" class="start-button" @click="running ? stop() : start()">{{ t(running ? 'mediaServer.stopTest' : 'mediaServer.startTest') }}</button>
      <button v-else type="button" class="view-button" :aria-label="t(viewMode === 'list' ? 'mediaServer.gridView' : 'mediaServer.listView')" @click="viewMode = viewMode === 'list' ? 'grid' : 'list'"><LayoutGrid v-if="viewMode === 'list'" :size="18" /><List v-else :size="18" /></button>
    </div>
    <div v-if="!target" class="speed-browser">
      <div v-if="loading && !items.length" class="browser-loading"><MediaLoadingIndicator :size="72" /></div>
      <div v-else-if="error && !items.length" role="alert" class="browser-message error">{{ error }} <button type="button" @click="retry">{{ t('mediaServer.retry') }}</button></div>
      <p v-else-if="!items.length" class="browser-message">{{ t('mediaServer.speedEmpty') }}</p>
      <div v-else class="file-browser" :class="{ 'file-browser-grid': viewMode === 'grid' }">
        <FileBrowserCard v-for="item in items" :key="item.id" :name="item.title" :directory="isFolder(item)" :thumbnail="itemImage(item)" :mode="viewMode" @open="select(item)" />
        <button v-if="hasNextPage" type="button" class="load-more" :disabled="loading" @click="loadMore"><MediaLoadingIndicator v-if="loading" :size="28" />{{ loading ? '' : t('mediaServer.speedMore') }}</button>
      </div>
      <div v-if="error && items.length" role="alert" class="browser-message error">{{ error }} <button type="button" @click="retry">{{ t('mediaServer.retry') }}</button></div>
    </div>
    <div v-else class="speed-results">
      <h3>{{ target.fileName }}</h3>
      <p>{{ (bytes / 1048576).toFixed(1) }} MiB<span v-if="target.fileSize"> / {{ (target.fileSize / 1048576).toFixed(1) }} MiB</span></p>
      <progress v-if="target.fileSize" :value="bytes" :max="target.fileSize" />
      <div class="speed-metrics"><div>{{ t('mediaServer.speedCurrent') }}<strong>{{ current.toFixed(2) }} Mbps</strong></div><div>{{ t('mediaServer.speedAverage') }}<strong>{{ average.toFixed(2) }} Mbps</strong></div><div>{{ t('mediaServer.speedMinimum') }}<strong>{{ minimum.toFixed(2) }} Mbps</strong></div></div>
      <svg class="speed-chart" viewBox="0 0 640 240" preserveAspectRatio="none" role="img" :aria-label="t('mediaServer.speedCurve')"><path v-for="y in [0, 60, 120, 180, 240]" :key="y" :d="`M 0 ${y} H 640`" class="grid" /><polyline v-if="samples.length" :points="chartPoints" /></svg>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeft, LayoutGrid, List } from 'lucide-vue-next'
import FileBrowserCard from '../FileBrowserCard.vue'
import MediaLoadingIndicator from '../MediaLoadingIndicator.vue'
import { toMsCacheUrl } from '../../media-server/imageCache'
import { t } from '../../i18n'
import type { MediaServerConfig } from '../../types/mediaServer'
import type { MediaServerLibraryNode, MediaServerDownloadInfo } from '../../types/mediaServerContent'
import { getMediaServerDownloadInfo, getMediaServerLibraries, getMediaServerLibraryPagedItems } from '../../media-server/contentGateway'

const props = defineProps<{ visible: boolean; server: MediaServerConfig }>()
const emit = defineEmits<{ (event: 'update:visible', value: boolean): void }>()
const items = ref<MediaServerLibraryNode[]>([])
const stack = ref<MediaServerLibraryNode[]>([])
const page = ref(0)
const hasNextPage = ref(false)
const loading = ref(false)
const error = ref('')
const target = ref<MediaServerDownloadInfo | null>(null)
const running = ref(false)
const bytes = ref(0)
const current = ref(0)
const average = ref(0)
const minimum = ref(0)
const samples = ref<number[]>([])
const viewMode = ref<'list' | 'grid'>('list')
const chartPoints = computed(() => {
  const max = Math.max(1, ...samples.value)
  return samples.value.map((value, index) => `${(index * 640 / Math.max(1, samples.value.length - 1)).toFixed(1)},${(240 - value / max * 228).toFixed(1)}`).join(' ')
})
let controller: AbortController | null = null
let requestNumber = 0

const isFolder = (item: MediaServerLibraryNode) => item.kind === 'folder' || item.kind === 'series' || item.kind === 'season'
const itemImage = (item: MediaServerLibraryNode) => isFolder(item) ? '' : toMsCacheUrl(props.server.id, item.images?.primary || item.images?.thumb || item.poster || '')

async function loadRoot() {
  const current = ++requestNumber
  loading.value = true
  error.value = ''
  try {
    const result = await getMediaServerLibraries(props.server)
    if (current === requestNumber) { items.value = result; hasNextPage.value = false }
  } catch (cause) { if (current === requestNumber) error.value = String(cause) }
  finally { if (current === requestNumber) loading.value = false }
}

async function loadDirectory(parent: MediaServerLibraryNode, nextPage = 0) {
  const current = ++requestNumber
  loading.value = true
  error.value = ''
  try {
    const result = await getMediaServerLibraryPagedItems(props.server, parent.id, nextPage, { collectionType: parent.collectionType })
    if (current === requestNumber) {
      items.value = nextPage ? [...items.value, ...result.items] : result.items
      hasNextPage.value = result.hasNextPage
      page.value = nextPage
    }
  } catch (cause) { if (current === requestNumber) error.value = String(cause) }
  finally { if (current === requestNumber) loading.value = false }
}

async function select(item: MediaServerLibraryNode) {
  if (isFolder(item)) { stack.value.push(item); await loadDirectory(item); return }
  loading.value = true
  error.value = ''
  try { target.value = await getMediaServerDownloadInfo(props.server, item.id) }
  catch (cause) { error.value = String(cause) }
  finally { loading.value = false }
}

async function up() {
  stack.value.pop()
  const parent = stack.value[stack.value.length - 1]
  if (parent) await loadDirectory(parent)
  else await loadRoot()
}
function loadMore() { const parent = stack.value[stack.value.length - 1]; if (parent && !loading.value) void loadDirectory(parent, page.value + 1) }
function retry() { const parent = stack.value[stack.value.length - 1]; if (parent) void loadDirectory(parent, page.value); else void loadRoot() }
function stop() { controller?.abort(); controller = null; running.value = false }
function backToBrowser() { stop(); target.value = null; error.value = '' }
function close() { stop(); emit('update:visible', false) }

async function start() {
  if (!target.value || running.value) return
  const info = target.value
  const abort = new AbortController()
  controller = abort
  running.value = true
  error.value = ''; bytes.value = 0; current.value = 0; average.value = 0; minimum.value = 0; samples.value = []
  let lastBytes = 0
  let lastTime = performance.now()
  const started = lastTime
  try {
    const response = await fetch(info.url, { headers: info.headers, signal: abort.signal, cache: 'no-store' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done || abort.signal.aborted) break
      bytes.value += chunk.value.byteLength
      const now = performance.now()
      if (now - lastTime >= 250) {
        const speed = (bytes.value - lastBytes) * 8 / (now - lastTime) / 1000
        current.value = speed
        average.value = bytes.value * 8 / Math.max(1, now - started) / 1000
        minimum.value = samples.value.length ? Math.min(minimum.value, speed) : speed
        samples.value.push(speed)
        lastBytes = bytes.value; lastTime = now
      }
      if (now - started >= 20000) { abort.abort(); break }
    }
  } catch (cause) { if (!abort.signal.aborted) error.value = String(cause) }
  finally { if (controller === abort) { controller = null; running.value = false } }
}

watch(() => props.visible, (visible) => {
  if (visible) { stack.value = []; target.value = null; void loadRoot() }
  else { requestNumber++; stop() }
}, { immediate: true })
onBeforeUnmount(stop)
</script>

<style>
.server-speed-modal.arco-modal,body[arco-theme='dark'] .arco-modal.server-speed-modal{width:min(820px,calc(100vw - 32px))!important;min-width:min(820px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:hidden;background: var(--app-overlay-bg) !important;color:#dedede}
.server-speed-modal .arco-modal-body{box-sizing:border-box;width:100%;min-width:0;padding:0!important}
</style>
<style scoped>
.speed-header{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:12px;padding:10px 16px;min-height:58px;border-bottom:1px solid var(--color-border-2)}.speed-header h2{margin:0;text-align:left;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.speed-header button{display:grid;place-items:center;min-width:38px;min-height:38px;border:1px solid #494949;border-radius:50%;background:#171717;color:#fff;cursor:pointer}.speed-header .start-button{padding:0 16px;border-radius:20px;white-space:nowrap}.speed-browser{min-height:300px;max-height:min(72vh,720px);overflow:auto;background:#1e1e1e}.browser-loading{min-height:300px;display:grid;place-items:center}.file-browser{display:flex;flex-direction:column;padding:0 16px}.file-browser-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(174px,1fr));gap:24px 20px;padding:20px}.file-browser-grid :deep(.folder-browser-card){width:174px}.browser-message{padding:32px 24px;color:var(--color-text-2)}.browser-message button,.load-more{border:0;background:transparent;color:#ff8b25;cursor:pointer}.load-more{min-height:60px;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center}.speed-results{padding:24px;min-height:300px;max-height:65vh;overflow:auto}.speed-results h3{font-size:18px}.speed-results progress{width:100%;accent-color:#ff8700}.speed-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.speed-metrics div{padding:16px;border:1px solid #444;border-radius:10px}.speed-metrics strong{display:block;margin-top:8px;color:#ff8700;font-size:18px}.speed-chart{width:100%;height:240px;background:#242424}.speed-chart .grid{stroke:#464646;stroke-width:1}.speed-chart polyline{fill:none;stroke:#ff8700;stroke-width:3}.error{color:#ff5555}
</style>
