<script setup lang='ts'>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowLeft, ArrowUp, ChevronDown, Copy, Expand, FilePlus2, FileText, Folder, Minus, Plus, Search, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-vue-next'
import DriveFile from '../drive/file'
import AliDirFileList from '../aliapi/dirfilelist'
import { getDriveType } from '../drive/context'
import { listProviderItems } from '../drive/providerList'
import { createBookAISettings, getAIConfig, migrateSoleSavedBYOKAsDefault } from '../utils/bookAI'
import { getAIProvider } from '../services/ai/providers'
import { askIndexedDocuments, buildPdfReadingUnits, indexDocumentLocally, indexParsedDocument, MAX_DOCUMENT_BYTES, readIndexedPdfUnit } from '../services/documents'
import { canUseSemanticEmbeddings } from '../services/ai/embeddingPolicy'
import { reedyClient } from '../services/reedy/ReedyClient'
import { copyToClipboard } from '../utils/electronhelper'
import { documentInsightSourceId, isDocumentInsightFile, MAX_DOCUMENT_INSIGHT_SOURCES, type DocumentInsightSourceInput } from '../services/documents/insight'
import { searchAllDrives } from '../utils/globalSearch'
import { resolveDriveProvider } from '../utils/driveProvider'
import UserDAL from '../user/userdal'
import { completeDocumentReadingUnit, createDocumentReadingJob, extractPdfForDocumentReading, listDocumentReadingJobs, setDocumentReadingJobStatus } from '../services/documents/reading'
import { beginDocumentV1Audit, finishDocumentV1Audit, recordDocumentV1Citation, type DocumentAgentV1Source } from '../services/agent/agentV1AuditClient'
import { renderMarkdown as renderDocumentMarkdown } from '../layout/aisearch/markdown'
import type { DocumentReadingJobView } from '@shared/types/documentReading'
import message from '../utils/message'
import { isPro } from '../utils/usageLimit'
import LimitReachedModal from '../setting/LimitReachedModal.vue'

type DocumentCitation = { sourceId: string; sourceFile: string; location: string; section: string; text: string }
type ConversationMessage = { id: string; role: 'user' | 'assistant'; text: string; citations: DocumentCitation[] }
type SourceState = DocumentInsightSourceInput & { id: string; fileName: string; status: 'reading' | 'ready' | 'failed'; detail: string }

const props = withDefaults(defineProps<{
  visible: boolean
  /** Compatibility with the initial single-file preview entry. */
  file?: any | null
  userId?: string
  sources?: DocumentInsightSourceInput[]
  availableSources?: DocumentInsightSourceInput[]
  scopeName?: string
  mode?: 'sidebar' | 'workspace'
  initialPrompt?: string
}>(), { file: null, userId: '', sources: () => [], availableSources: () => [], scopeName: '', mode: 'sidebar', initialPrompt: '' })
const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'jump-to-location', location: string): void
}>()

const indexing = ref(false)
const asking = ref(false)
const status = ref('')
const question = ref('')
const messages = ref<ConversationMessage[]>([])
const sourceStates = ref<SourceState[]>([])
const extraSources = ref<DocumentInsightSourceInput[]>([])
const removedSourceIds = ref(new Set<string>())
const abortController = ref<AbortController | null>(null)
const expanded = ref(false)
const sidebarWidth = ref(420)
const resizing = ref(false)
const feedback = ref('')
const sourcesOpen = ref(false)
const pickerOpen = ref(false)
const hoveredCitation = ref<DocumentCitation | null>(null)
const cloudSearchQuery = ref('')
const cloudSearchResults = ref<DocumentInsightSourceInput[]>([])
const cloudSearching = ref(false)
const pickerSelection = ref<DocumentInsightSourceInput[]>([])
type SourceBrowserLocation = { id: string; name: string }
const browserEntries = ref<any[]>([])
const browserPath = ref<SourceBrowserLocation[]>([])
const browserLoading = ref(false)
const browserError = ref('')
const readingJob = ref<DocumentReadingJobView | null>(null)
const deepReading = ref(false)
const readingAbort = ref<AbortController | null>(null)
const readingMapOpen = ref(false)
const readingNotesOpen = ref(false)
const answerTimedOut = ref(false)
const showUpgradeModal = ref(false)
let pendingPrompt = ''
const ANSWER_TIMEOUT_MS = 90_000

const allSourceInputs = computed(() => {
  const initial = props.sources.length ? props.sources : (props.file ? [{ file: props.file, userId: props.userId }] : [])
  const unique = new Map<string, DocumentInsightSourceInput>()
  for (const source of [...initial, ...extraSources.value]) {
    if (!isDocumentInsightFile(source.file) || !source.userId) continue
    const id = documentInsightSourceId(source)
    if (!removedSourceIds.value.has(id) && unique.size < MAX_DOCUMENT_INSIGHT_SOURCES) unique.set(id, source)
  }
  return [...unique.values()]
})
const readySources = computed(() => sourceStates.value.filter(source => source.status === 'ready'))
const failedSources = computed(() => sourceStates.value.filter(source => source.status === 'failed'))
const indexed = computed(() => readySources.value.length > 0 && !indexing.value)
const isMultiSource = computed(() => allSourceInputs.value.length > 1)
// Full-screen document AI must use the same centered conversation column as
// the workspace. Keeping the sidebar layout here leaves the composer pinned
// to the old 340px column after the overlay expands.
const layout = computed(() => props.mode === 'workspace' || isMultiSource.value || expanded.value ? 'workspace' : 'sidebar')
const documentAiStyle = computed(() => layout.value === 'sidebar' ? { width: `${sidebarWidth.value}px` } : undefined)
const sourceHeading = computed(() => {
  const count = allSourceInputs.value.length
  if (count === 1) return `Ask questions about “${allSourceInputs.value[0]?.file?.name || allSourceInputs.value[0]?.file?.file_name || '文档'}”`
  return `Ask questions about ${count} files${props.scopeName ? ` in ‘${props.scopeName}’` : ''}`
})
const privacyText = computed(() => canUseSemanticEmbeddings(createBookAISettings().provider)
  ? '已选网盘文件在本机按页解析；仅相关片段会用于检索和回答。'
  : '已选网盘文件在本机解析并建立关键词索引；回答只使用相关片段。')
const quickPrompts = ['总结这些来源', '有哪些关键要点？', '这份文档可如何改进？', '这些文档定义了哪些下一步？']
const candidates = computed(() => {
  const selected = new Set(allSourceInputs.value.map(documentInsightSourceId))
  return props.availableSources.filter(source => isDocumentInsightFile(source.file) && !selected.has(documentInsightSourceId(source))).slice(0, 30)
})
const browserSource = computed(() => allSourceInputs.value[0] || props.availableSources[0] || null)
const browserUserId = computed(() => browserSource.value?.userId || '')
const browserDriveId = computed(() => String(browserSource.value?.file?.drive_id || ''))
const browserFolders = computed(() => browserEntries.value.filter(file => file.isDir))
const browserFiles = computed(() => browserEntries.value.filter(file => !file.isDir && isDocumentInsightFile(file)))
const browserTitle = computed(() => browserPath.value.at(-1)?.name || '当前网盘')
const mentionQuery = computed(() => {
  const match = question.value.match(/(?:^|\s)@([^@]*)$/)
  return match ? match[1].trim().toLowerCase() : null
})
const mentionCandidates = computed(() => {
  if (mentionQuery.value === null) return []
  const seen = new Set<string>()
  return [...allSourceInputs.value, ...candidates.value]
    .filter(source => {
      const id = documentInsightSourceId(source)
      const name = String(source.file.name || source.file.file_name || '').toLowerCase()
      if (seen.has(id) || !name.includes(mentionQuery.value || '')) return false
      seen.add(id)
      return true
    })
    .slice(0, 6)
})
const singlePdfSource = computed(() => readySources.value.length === 1 && /\.pdf$/i.test(readySources.value[0]?.fileName || '') ? readySources.value[0] : null)
const readingCompleted = computed(() => readingJob.value?.units.filter(unit => unit.status === 'completed' || unit.status === 'skipped').length || 0)
const completedReadingUnits = computed(() => readingJob.value?.units.filter(unit => unit.status === 'completed' && unit.summary) || [])
const hasReadingNotes = computed(() => completedReadingUnits.value.length > 0)

try {
  const savedWidth = Number(localStorage.getItem('boxplayer.documentAi.sidebarWidth'))
  if (Number.isFinite(savedWidth) && savedWidth >= 300 && savedWidth <= 760) sidebarWidth.value = savedWidth
} catch {}

let resizeStartX = 0
let resizeStartWidth = 0
function stopSidebarResize() {
  if (!resizing.value) return
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', resizeSidebar)
  window.removeEventListener('pointerup', stopSidebarResize)
  window.removeEventListener('pointercancel', stopSidebarResize)
  try { localStorage.setItem('boxplayer.documentAi.sidebarWidth', String(sidebarWidth.value)) } catch {}
}
function resizeSidebar(event: PointerEvent) {
  if (!resizing.value) return
  const maxWidth = Math.max(300, Math.min(760, window.innerWidth - 320))
  sidebarWidth.value = Math.min(maxWidth, Math.max(300, resizeStartWidth + resizeStartX - event.clientX))
}
function startSidebarResize(event: PointerEvent) {
  if (layout.value !== 'sidebar' || expanded.value || event.button !== 0) return
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = sidebarWidth.value
  resizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', resizeSidebar)
  window.addEventListener('pointerup', stopSidebarResize)
  window.addEventListener('pointercancel', stopSidebarResize)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('document_has_no_text')) return '此 PDF 不包含可检索文字，暂不支持图片型 PDF'
  if (typeof error === 'string' && error.includes('document_has_no_text')) return '此 PDF 不包含可检索文字，暂不支持图片型 PDF'
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  try { return JSON.stringify(error) || '文档索引失败' } catch { return '文档索引失败' }
}

function getDocumentAIConfig() {
  // Preview windows have their own renderer state. Reuse one saved BYOK
  // configuration so a configured main workspace also works in PDF preview.
  migrateSoleSavedBYOKAsDefault()
  return getAIConfig()
}

function getDocumentAuditSources(): DocumentAgentV1Source[] {
  return readySources.value.flatMap(source => {
    const file = source.file || {}
    const userId = String(source.userId || '')
    const driveId = String(file.drive_id || '')
    const fileId = String(file.file_id || '')
    const token = UserDAL.GetUserToken(userId)
    const route = resolveDriveProvider(userId, driveId, token?.tokenfrom)
    if (!userId || !driveId || !fileId || !route.isValid) return []
    return [{ sourceId: source.id, fileName: source.fileName, userId, driveId, fileId, parentFileId: String(file.parent_file_id || '') || undefined, platform: route.provider }]
  })
}

function requireDocumentAIPro(): boolean {
  if (isPro()) return true
  status.value = 'AI 文档问答需购买 Pro 后使用'
  showUpgradeModal.value = true
  return false
}

function isPdfSource(source: { fileName: string }): boolean { return /\.pdf$/i.test(source.fileName) }

async function indexCloudSource(source: SourceState, settings: ReturnType<typeof createBookAISettings>, provider: ReturnType<typeof getAIProvider>) {
  const download = await DriveFile.ApiFileDownloadUrl(source.userId, source.file.drive_id || '', source.file.file_id, 14_400)
  if (typeof download === 'string') throw new Error(download)
  const embeddingModel = canUseSemanticEmbeddings(settings.provider) ? provider.getEmbeddingModel() : undefined
  if (isPdfSource(source)) {
    const parsed = await extractPdfForDocumentReading({ url: download.url, headers: download.headers || {}, onProgress: progress => {
      source.detail = progress.phase === 'download'
        ? `正在受限缓存 PDF${progress.total ? ` ${Math.round(progress.current / progress.total * 100)}%` : ''}`
        : `正在本机逐页解析 ${progress.current}/${progress.total || '?'}`
    } })
    await indexParsedDocument({ sourceId: source.id, fileName: source.fileName, embeddingModel, onProgress: progress => { source.detail = progress.detail || (progress.phase === 'chunking' ? '正在按页分块' : progress.phase === 'embedding' ? '正在建立索引' : '正在保存索引') } }, { fileName: source.fileName, sections: parsed.sections, totalChars: parsed.totalChars })
    return
  }
  const response = await fetch(download.url, { headers: download.headers || {} })
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)
  await indexDocumentLocally({ sourceId: source.id, fileName: source.fileName, data: await response.arrayBuffer(), embeddingModel, onProgress: progress => { const labels = { parsing: '正在本机解析', chunking: '正在按页分块', embedding: '正在建立索引', saving: '正在保存索引' }; source.detail = progress.detail || `${labels[progress.phase]}${progress.total > 1 ? ` ${progress.current}/${progress.total}` : ''}` } })
}

function clearTemporaryIndexes() {
  const ids = sourceStates.value.map(source => source.id)
  sourceStates.value = []
  for (const id of ids) void reedyClient.clearBook(id).catch(() => undefined)
}

async function loadReadingJob() {
  if (!singlePdfSource.value) { readingJob.value = null; return }
  readingJob.value = (await listDocumentReadingJobs(singlePdfSource.value.id))[0] || null
}

function close() {
  abortController.value?.abort()
  readingAbort.value?.abort()
  expanded.value = false
  emit('update:visible', false)
}

function normalizeSources(): SourceState[] {
  return allSourceInputs.value.map(source => ({
    ...source,
    id: documentInsightSourceId(source),
    fileName: String(source.file.name || source.file.file_name || '文档'),
    status: 'reading' as const,
    detail: '等待读取'
  }))
}

async function buildIndexes() {
  if (indexing.value || !allSourceInputs.value.length) return
  if (!requireDocumentAIPro()) return
  const config = getDocumentAIConfig()
  if (!config) {
    status.value = '请先在 设置 > AI 设置 中配置并设为默认模型'
    return
  }
  clearTemporaryIndexes()
  sourceStates.value = normalizeSources()
  messages.value = []
  indexing.value = true
  try {
    const settings = createBookAISettings()
    const provider = getAIProvider(settings)
    for (const source of sourceStates.value) {
      if (Number(source.file.size || 0) > MAX_DOCUMENT_BYTES) {
        source.status = 'failed'
        source.detail = '超过 200 MB 限制'
        continue
      }
      try {
        source.detail = 'Reading…'
        await indexCloudSource(source, settings, provider)
        source.status = 'ready'
        source.detail = 'Ready'
      } catch (error) {
        source.status = 'failed'
        source.detail = errorMessage(error)
      }
    }
    const completed = readySources.value.length
    status.value = completed ? `${completed} 份文档已可提问，试试下面的问题或直接输入。` : failedSources.value.length ? `无法准备文档：${failedSources.value[0].detail}` : '没有可用于问答的来源'
    await loadReadingJob()
    if (completed && pendingPrompt) {
      const prompt = pendingPrompt
      pendingPrompt = ''
      indexing.value = false
      void ask(prompt)
    }
  } catch (error) {
    const detail = errorMessage(error)
    for (const source of sourceStates.value) {
      source.status = 'failed'
      source.detail = detail
    }
    status.value = `无法准备文档：${detail}`
  } finally {
    indexing.value = false
  }
}

async function indexAddedSource(input: DocumentInsightSourceInput) {
  if (!requireDocumentAIPro()) return
  const config = getDocumentAIConfig()
  if (!config) {
    status.value = '请先在 设置 > AI 设置 中配置并设为默认模型'
    return
  }
  const source: SourceState = { ...input, id: documentInsightSourceId(input), fileName: String(input.file.name || input.file.file_name || '文档'), status: 'reading', detail: 'Reading…' }
  sourceStates.value = [...sourceStates.value, source]
  try {
    const settings = createBookAISettings()
    const provider = getAIProvider(settings)
    if (Number(source.file.size || 0) > MAX_DOCUMENT_BYTES) throw new Error('超过 200 MB 限制')
    await indexCloudSource(source, settings, provider)
    source.status = 'ready'
    source.detail = 'Ready'
    status.value = `${readySources.value.length} 份文档已可提问，试试下面的问题或直接输入。`
  } catch (error) {
    source.status = 'failed'
    source.detail = errorMessage(error)
  }
}

async function startDeepReading() {
  const source = singlePdfSource.value
  if (!source || deepReading.value) return
  if (!requireDocumentAIPro()) return
  const config = getAIConfig()
  if (!config) { message.warning('请先在设置中配置 AI 模型'); return }
  try {
    let job = readingJob.value
    if (!job || job.status === 'stale' || job.status === 'cancelled') {
      const plan = buildPdfReadingUnits(await reedyClient.getChunks(source.id))
      if (!plan.totalPages) throw new Error('该 PDF 没有可阅读文本')
      const calls = plan.units.filter(unit => !unit.skipReason).length
      if (plan.totalPages > 100 && !window.confirm(`该 PDF 共 ${plan.totalPages} 页，将分为 ${plan.units.length} 个阅读单元并进行最多 ${calls} 次模型调用。是否开始？`)) return
      job = await createDocumentReadingJob({ sourceId: source.id, sourceFile: source.fileName, totalPages: plan.totalPages, units: plan.units })
    }
    readingJob.value = await setDocumentReadingJobStatus(job.id, 'running')
    readingMapOpen.value = true
    readingAbort.value = new AbortController()
    deepReading.value = true
    for (const unit of readingJob.value.units) {
      if (unit.status === 'completed' || unit.status === 'skipped') continue
      if (readingAbort.value.signal.aborted) break
      try {
        status.value = `正在深读第 ${unit.startPage}–${unit.endPage} 页…`
        const result = await readIndexedPdfUnit({ sourceId: source.id, fileName: source.fileName, startPage: unit.startPage, endPage: unit.endPage, model: config, signal: readingAbort.value.signal })
        readingJob.value = await completeDocumentReadingUnit({ jobId: job.id, index: unit.index, ...result })
      } catch (error: any) {
        if (readingAbort.value?.signal.aborted) break
        readingJob.value = await setDocumentReadingJobStatus(job.id, 'paused', errorMessage(error))
        status.value = `深度阅读已暂停：${errorMessage(error)}`
        return
      }
    }
    readingJob.value = await setDocumentReadingJobStatus(job.id, readingAbort.value.signal.aborted ? 'paused' : 'completed')
    if (readingJob.value.status === 'completed') readingNotesOpen.value = true
    status.value = readingJob.value.status === 'completed' ? '深度阅读完成' : '深度阅读已暂停'
  } catch (error) {
    status.value = `无法启动深度阅读：${errorMessage(error)}`
  } finally {
    deepReading.value = false
    readingAbort.value = null
  }
}

async function pauseDeepReading() {
  readingAbort.value?.abort()
  if (readingJob.value) readingJob.value = await setDocumentReadingJobStatus(readingJob.value.id, 'paused')
}

async function ask(promptOverride?: string) {
  const prompt = (promptOverride || question.value).trim()
  if (!prompt || asking.value) return
  if (!requireDocumentAIPro()) return
  if (!indexed.value) {
    if (indexing.value) {
      pendingPrompt = prompt
      question.value = ''
      status.value = '文档准备完成后会自动发送此问题'
      return
    }
    if (!getDocumentAIConfig()) {
      status.value = '请先在 设置 > AI 设置 中配置并设为默认模型'
      message.warning(status.value)
      return
    }
    pendingPrompt = prompt
    question.value = ''
    status.value = '正在重新准备文档，完成后会自动发送此问题'
    void buildIndexes()
    return
  }
  const config = getDocumentAIConfig()
  if (!config) {
    status.value = '请先在 设置 > AI 设置 中配置并设为默认模型'
    message.warning(status.value)
    return
  }
  const settings = createBookAISettings()
  const provider = getAIProvider(settings)
  const controller = new AbortController()
  const auditRunId = crypto.randomUUID()
  const auditWorkflowId = await beginDocumentV1Audit({ sessionId: `document:${readySources.value.map(source => source.id).join(',')}`, runId: auditRunId, goal: prompt, sources: getDocumentAuditSources() }).catch(() => null)
  abortController.value = controller
  answerTimedOut.value = false
  asking.value = true
  feedback.value = ''
  question.value = ''
  status.value = '正在检索来源并准备回答…'
  const userMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'user', text: prompt, citations: [] }
  const assistantMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'assistant', text: '', citations: [] }
  messages.value.push(userMessage, assistantMessage)
  const timeout = window.setTimeout(() => {
    answerTimedOut.value = true
    status.value = '回答超时，已停止本次请求。'
    controller.abort()
  }, ANSWER_TIMEOUT_MS)
  try {
    await askIndexedDocuments({
      sources: readySources.value.map(source => ({ sourceId: source.id, fileName: source.fileName })),
      question: prompt,
      model: config,
      embeddingModel: canUseSemanticEmbeddings(settings.provider) ? provider.getEmbeddingModel() : undefined,
      signal: controller.signal,
      history: messages.value.slice(0, -2).map(item => ({ role: item.role, content: item.text })),
      onToken: token => { status.value = ''; assistantMessage.text += token },
      onCitation: citation => {
        status.value = '已检索到证据，正在生成回答…'
        const item: DocumentCitation = { sourceId: citation.sourceId, sourceFile: citation.sourceFile, location: citation.location || '正文', section: citation.section || '正文', text: citation.text }
        if (!assistantMessage.citations.some(existing => existing.sourceId === item.sourceId && existing.location === item.location && existing.text === item.text)) assistantMessage.citations.push(item)
        if (auditWorkflowId) void recordDocumentV1Citation(auditWorkflowId, { sourceId: item.sourceId, location: item.location })
      }
    })
    if (!assistantMessage.text.trim()) throw new Error('模型未返回回答，请重试')
    if (auditWorkflowId) void finishDocumentV1Audit(auditWorkflowId, 'completed', '文档问答已完成。')
  } catch (error: any) {
    if (auditWorkflowId) void finishDocumentV1Audit(auditWorkflowId, controller.signal.aborted ? 'cancelled' : 'failed', errorMessage(error))
    if (controller.signal.aborted) {
      status.value = answerTimedOut.value ? '回答超时，已停止本次请求。' : '已停止本次回答。'
      if (!assistantMessage.text) assistantMessage.text = answerTimedOut.value ? '回答超过 90 秒仍未完成，已停止本次请求。' : '已停止本次回答。'
    } else {
      console.error('文档问答失败:', error)
      const message = errorMessage(error)
      status.value = `文档问答失败：${message}`
      if (!assistantMessage.text) assistantMessage.text = `暂时无法生成回答：${message}`
    }
  } finally {
    window.clearTimeout(timeout)
    asking.value = false
    if (abortController.value === controller) abortController.value = null
  }
}

function stopAnswer() {
  abortController.value?.abort()
}

function askQuickPrompt(prompt: string) {
  void ask(prompt)
}

function clearConversation() {
  abortController.value?.abort()
  messages.value = []
  feedback.value = ''
  status.value = indexed.value ? '已清除本次对话。' : status.value
}

function copyAnswer(text: string) {
  copyToClipboard(text)
  feedback.value = '回答已复制'
}

function jumpToCitation(citation: DocumentCitation) {
  emit('jump-to-location', citation.location)
}

function citationLabel(citation: DocumentCitation) {
  return `${citation.sourceFile} · ${citation.section} · ${citation.location}`
}

function togglePickerSource(source: DocumentInsightSourceInput) {
  const id = documentInsightSourceId(source)
  pickerSelection.value = pickerSelection.value.some(item => documentInsightSourceId(item) === id)
    ? pickerSelection.value.filter(item => documentInsightSourceId(item) !== id)
    : [...pickerSelection.value, source]
}

function toBrowserSource(file: any): DocumentInsightSourceInput {
  return { file: { ...file, drive_id: file.drive_id || browserDriveId.value }, userId: browserUserId.value }
}

async function loadBrowserDirectory() {
  const userId = browserUserId.value
  const driveId = browserDriveId.value
  const directory = browserPath.value.at(-1)
  if (!userId || !driveId || !directory) {
    browserError.value = '无法确定当前文档所在的网盘'
    return
  }
  browserLoading.value = true
  browserError.value = ''
  try {
    const token = UserDAL.GetUserToken(userId)
    const route = resolveDriveProvider(userId, driveId, token?.tokenfrom)
    if (!route.isValid) throw new Error(route.error)
    if (route.provider === 'aliyun') {
      const response = await AliDirFileList.ApiDirFileList(userId, driveId, directory.id, directory.name, 'name ASC', '', undefined, false)
      browserEntries.value = response.items
    } else {
      const response = await listProviderItems(route.provider, userId, driveId, directory.id, true)
      if (!response) throw new Error('该网盘暂不支持浏览')
      if (response.error) throw new Error(response.error)
      browserEntries.value = response.items
    }
  } catch (error) {
    browserEntries.value = []
    browserError.value = errorMessage(error)
  } finally {
    browserLoading.value = false
  }
}

async function openSourcePicker() {
  pickerOpen.value = !pickerOpen.value
  if (!pickerOpen.value || browserPath.value.length) return
  const userId = browserUserId.value
  const driveId = browserDriveId.value
  if (!userId || !driveId) {
    browserError.value = '请先从网盘中打开一份支持的文档'
    return
  }
  const root = getDriveType(userId, driveId)
  browserPath.value = [{ id: root.key, name: root.title }]
  await loadBrowserDirectory()
}

async function enterBrowserFolder(folder: any) {
  browserPath.value = [...browserPath.value, { id: folder.file_id, name: folder.name }]
  await loadBrowserDirectory()
}

async function goBrowserBack() {
  if (browserPath.value.length < 2) return
  browserPath.value = browserPath.value.slice(0, -1)
  await loadBrowserDirectory()
}

async function addSources(sources: DocumentInsightSourceInput[]) {
  if (!requireDocumentAIPro()) return
  const selected = new Set(allSourceInputs.value.map(documentInsightSourceId))
  const additions = sources.filter(source => !selected.has(documentInsightSourceId(source))).slice(0, MAX_DOCUMENT_INSIGHT_SOURCES - allSourceInputs.value.length)
  if (!additions.length) return
  if (additions.length < sources.length) message.warning(`最多添加 ${MAX_DOCUMENT_INSIGHT_SOURCES} 个来源`)
  extraSources.value = [...extraSources.value, ...additions]
  pickerSelection.value = []
  pickerOpen.value = false
  sourcesOpen.value = true
  for (const source of additions) await indexAddedSource(source)
}

function addSource(source: DocumentInsightSourceInput) {
  void addSources([source])
}

async function selectMention(source: DocumentInsightSourceInput) {
  const sourceId = documentInsightSourceId(source)
  const name = String(source.file.name || source.file.file_name || '文档')
  question.value = question.value.replace(/@[^@]*$/, `@${name} `)
  if (!allSourceInputs.value.some(item => documentInsightSourceId(item) === sourceId)) void addSources([source])
}

async function searchCloudSources() {
  const query = cloudSearchQuery.value.trim()
  if (query.length < 2) {
    message.warning('请输入至少两个字搜索已授权网盘')
    return
  }
  cloudSearching.value = true
  try {
    const selected = new Set(allSourceInputs.value.map(documentInsightSourceId))
    cloudSearchResults.value = (await searchAllDrives(query, { includeMediaServers: false }))
      .filter(result => result.source === 'cloud' && !result.isDir && isDocumentInsightFile(result))
      .map(result => ({ file: { ...result, name: result.name }, userId: result.user_id }))
      .filter(source => !selected.has(documentInsightSourceId(source)))
      .slice(0, 30)
  } catch (error) {
    cloudSearchResults.value = []
    message.warning(errorMessage(error))
  } finally {
    cloudSearching.value = false
  }
}

function removeSource(source: SourceState) {
  removedSourceIds.value = new Set([...removedSourceIds.value, source.id])
  void reedyClient.clearBook(source.id).catch(() => undefined)
  const next = sourceStates.value.filter(item => item.id !== source.id)
  sourceStates.value = next
  if (!next.length) clearConversation()
}

function startSession() {
  if (!props.visible || !allSourceInputs.value.length) return
  if (props.initialPrompt) pendingPrompt = props.initialPrompt
  void buildIndexes()
}

watch(() => props.visible, visible => {
  if (visible) startSession()
  else {
    abortController.value?.abort()
    clearTemporaryIndexes()
  }
})
watch(() => `${props.initialPrompt}:${props.sources.map(documentInsightSourceId).join('|')}`, () => {
  if (props.visible) startSession()
})
watch(() => `${browserUserId.value}:${browserDriveId.value}`, () => {
  browserPath.value = []
  browserEntries.value = []
  browserError.value = ''
})
if (props.visible) startSession()
onBeforeUnmount(() => {
  stopSidebarResize()
  abortController.value?.abort()
  clearTemporaryIndexes()
})
</script>

<template>
  <aside v-show='visible' :class="['document-ai', `document-ai--${layout}`, { 'document-ai--expanded': expanded, 'document-ai--resizing': resizing }]" :style='documentAiStyle'>
    <div v-if="layout === 'sidebar' && !expanded" class='document-ai__resize-handle' data-testid='document-ai-resize-handle' role='separator' aria-orientation='vertical' aria-label='调整 AI 对话框宽度' @pointerdown='startSidebarResize'></div>
    <header class='document-ai__header'>
      <div class='document-ai__brand'><span class='document-ai__brand-icon'><Sparkles :size='18' /></span><span v-if="layout === 'workspace'" class='document-ai__agent'>AGENT</span><span>BoxPlayer AI</span><ChevronDown :size='14' /></div>
      <div class='document-ai__header-actions'>
        <button type='button' :title="expanded ? '收起对话' : '切换到宽视图'" @click='expanded = !expanded'><Expand :size='17' /></button>
        <button type='button' title='清空对话' @click='clearConversation'><Trash2 :size='17' /></button>
        <button type='button' title='关闭文档 AI' @click='close'><X :size='18' /></button>
      </div>
    </header>

    <section class='document-ai__body'>
      <div class='document-ai__context' data-testid='document-ai-context'>
        <FileText :size='18' />
        <div>
          <strong>{{ sourceHeading }}</strong>
          <span>{{ indexing ? '正在检查并提取 PDF 可检索文字' : privacyText }}</span>
          <div class='document-ai__context-actions'>
            <button v-if="allSourceInputs.length > 1" type='button' class='document-ai__sources-link' @click='sourcesOpen = !sourcesOpen'>{{ allSourceInputs.length }} 个来源</button>
            <button v-if='readingJob' type='button' class='document-ai__sources-link' @click='readingMapOpen = !readingMapOpen'>深读 {{ readingCompleted }}/{{ readingJob.units.length }}</button>
            <button v-if='hasReadingNotes' type='button' class='document-ai__sources-link' @click='readingNotesOpen = !readingNotesOpen'>{{ readingNotesOpen ? '收起笔记' : '查看笔记' }}</button>
          </div>
        </div>
        <div v-if='sourcesOpen' class='document-ai__sources-popover'>
          <div v-for='source in sourceStates' :key='source.id' class='document-ai__source-row'><FileText :size='15' /><span :title='source.fileName'>{{ source.fileName }}</span><small :class='source.status'>{{ source.detail }}</small><button type='button' title='移除来源' @click='removeSource(source)'><Minus :size='14' /></button></div>
        </div>
      </div>

      <section v-if='readingJob && readingMapOpen' class='document-ai__reading-map'>
        <div><strong>Reading map</strong><span>已完成 {{ readingCompleted }} / {{ readingJob.units.length }} 个单元 · {{ readingJob.totalPages }} 页</span></div>
        <button v-if='deepReading' type='button' @click='pauseDeepReading'>暂停</button><button v-else-if="readingJob.status === 'paused'" type='button' @click='startDeepReading'>恢复</button>
        <ol><li v-for='unit in readingJob.units' :key='unit.id' :class='`document-ai__reading-unit--${unit.status}`'><span>第 {{ unit.startPage }}–{{ unit.endPage }} 页</span><small>{{ unit.skipReason || unit.errorMessage || (unit.status === 'completed' ? '已完成' : unit.status === 'running' ? '正在阅读' : '等待阅读') }}</small></li></ol>
      </section>

      <section v-if='hasReadingNotes && readingNotesOpen' class='document-ai__reading-notes'>
        <div class='document-ai__reading-notes-heading'><div><strong>深度阅读笔记</strong><span>按 PDF 页码分段生成；后续问答仍会基于原文检索。</span></div></div>
        <article v-for='unit in completedReadingUnits' :key='unit.id' class='document-ai__reading-note'>
          <small>第 {{ unit.startPage }}–{{ unit.endPage }} 页</small>
          <div class='document-ai__message-markdown' v-html='renderDocumentMarkdown(unit.summary || "")' />
        </article>
      </section>

      <div v-if='!messages.length' class='document-ai__empty'>
        <span class='document-ai__hero-icon'><Sparkles :size='26' /></span>
        <h2>{{ layout === 'workspace' ? 'Ask BoxPlayer AI' : 'What can I help you with?' }}</h2>
        <p>{{ status || (indexing ? '正在准备来源…' : '从下方建议开始，或提出一个具体问题。') }}</p>
        <div class='document-ai__suggestions'>
          <button v-for='prompt in quickPrompts' :key='prompt' type='button' :disabled='asking' @click='askQuickPrompt(prompt)'>{{ prompt }}</button>
        </div>
        <div v-if='failedSources.length' class='document-ai__preparation-error'><strong>文档未能完成准备</strong><span>{{ failedSources[0].detail }}</span><button type='button' :disabled='indexing' @click='buildIndexes'>重新准备文档</button></div>
        <div v-if='singlePdfSource && !readingJob' class='document-ai__deep-reading'>
          <strong>PDF 深度阅读</strong>
          <span>按真实页码每 20 页生成一个可恢复的阅读单元。</span>
          <button v-if='deepReading' type='button' @click='pauseDeepReading'>暂停深读</button>
          <button v-else type='button' @click='startDeepReading'>Deep read</button>
        </div>
      </div>

      <div v-else class='document-ai__conversation'>
        <article v-for='item in messages' :key='item.id' :class="['document-ai__message', `document-ai__message--${item.role}`]">
          <div v-if="item.role === 'assistant'" class='document-ai__message-meta'><Sparkles :size='13' /><span>BoxPlayer AI</span><span class='document-ai__message-rule'>基于文档</span></div>
          <div v-if="item.role === 'assistant' && item.text" class='document-ai__message-text document-ai__message-markdown' v-html='renderDocumentMarkdown(item.text)' />
          <div v-else class='document-ai__message-text'>{{ item.text || (asking && item.role === 'assistant' ? '正在生成回答…' : '') }}</div>
          <div v-if="item.role === 'assistant' && item.citations.length" class='document-ai__citations'>
            <span>Based on:</span>
            <span v-for='(citation, index) in item.citations' :key='`${citation.sourceId}:${citation.location}:${citation.text}`' class='document-ai__citation-wrap'>
              <button type='button' :aria-label='citationLabel(citation)' @click='jumpToCitation(citation)' @mouseenter='hoveredCitation = citation' @mouseleave='hoveredCitation = null' @focus='hoveredCitation = citation' @blur='hoveredCitation = null'>{{ index + 1 }}</button>
              <span v-if='hoveredCitation === citation' class='document-ai__citation-popover'><strong>{{ citationLabel(citation) }}</strong><span>{{ citation.text }}</span></span>
            </span>
          </div>
          <div v-if="item.role === 'assistant' && item.text" class='document-ai__response-actions'>
            <button type='button' title='有帮助' @click="feedback = '感谢反馈'"><ThumbsUp :size='15' /></button>
            <button type='button' title='没有帮助' @click="feedback = '已记录反馈'"><ThumbsDown :size='15' /></button>
            <button type='button' title='复制回答' @click='copyAnswer(item.text)'><Copy :size='15' /></button>
          </div>
        </article>
      </div>
    </section>

    <footer class='document-ai__composer'>
      <div v-if='feedback' class='document-ai__feedback'>{{ feedback }}</div>
      <div v-else-if='status && messages.length' class='document-ai__feedback'>{{ status }}</div>
      <button v-if="layout === 'workspace'" type='button' class='document-ai__add-source' title='添加文档来源' @click='openSourcePicker'><Plus :size='18' /></button>
      <div v-if='pickerOpen' class='document-ai__source-picker'>
        <div class='document-ai__picker-heading'><div><strong>添加来源</strong><small>浏览文件夹并勾选需要一起提问的文档。</small></div><button type='button' title='关闭' @click='pickerOpen = false'><X :size='15' /></button></div>
        <div class='document-ai__browser-toolbar'><button type='button' :disabled='browserPath.length < 2 || browserLoading' title='返回上级目录' @click='goBrowserBack'><ArrowLeft :size='14' /></button><span :title='browserPath.map(item => item.name).join(" / ")'>{{ browserTitle }}</span></div>
        <p v-if='browserLoading' class='document-ai__picker-empty'>正在读取文件夹…</p>
        <p v-else-if='browserError' class='document-ai__picker-empty'>{{ browserError }}</p>
        <template v-else>
          <button v-for='folder in browserFolders' :key='folder.file_id' type='button' class='document-ai__browser-folder' @click='enterBrowserFolder(folder)'><Folder :size='16' /><span>{{ folder.name }}</span><ChevronDown :size='14' /></button>
          <button v-for='file in browserFiles' :key='file.file_id' :class="['document-ai__browser-file', { selected: pickerSelection.some(item => documentInsightSourceId(item) === documentInsightSourceId(toBrowserSource(file))) }]" type='button' @click='togglePickerSource(toBrowserSource(file))'><FilePlus2 :size='15' /><span>{{ file.name }}</span><small>{{ file.ext?.toUpperCase() || 'DOC' }}</small></button>
          <p v-if='!browserFolders.length && !browserFiles.length' class='document-ai__picker-empty'>此文件夹没有可用于文档问答的文件</p>
        </template>
        <details class='document-ai__picker-search'><summary>按文件名搜索全部网盘</summary><div class='document-ai__cloud-search'><input v-model='cloudSearchQuery' placeholder='输入至少两个字' @keydown.enter.prevent='searchCloudSources'><button type='button' title='搜索网盘' :disabled='cloudSearching' @click='searchCloudSources'><Search :size='14' /></button></div><button v-for='source in cloudSearchResults' :key='documentInsightSourceId(source)' :class="{ selected: pickerSelection.some(item => documentInsightSourceId(item) === documentInsightSourceId(source)) }" type='button' @click='togglePickerSource(source)'><FilePlus2 :size='15' /><span>{{ source.file.name || source.file.file_name }}</span></button></details>
        <button v-if='pickerSelection.length' type='button' class='document-ai__add-selected' @click='addSources(pickerSelection)'>添加 {{ pickerSelection.length }} 份文档</button>
      </div>
      <div v-if='mentionCandidates.length' class='document-ai__mention-picker'><span>输入 @ 选择或添加文档</span><button v-for='source in mentionCandidates' :key='documentInsightSourceId(source)' type='button' @click='selectMention(source)'><FileText :size='14' />@{{ source.file.name || source.file.file_name }}</button></div>
      <textarea v-model='question' :disabled='asking' placeholder='Ask BoxPlayer AI · 输入 @ 提及文件' rows='1' @keydown.meta.enter.prevent='ask()' @keydown.ctrl.enter.prevent='ask()' @keydown.enter.exact.prevent='ask()'></textarea>
      <button v-if='asking' type='button' class='document-ai__stop-answer' title='停止回答' @click='stopAnswer'><X :size='18' /></button>
      <button v-else type='button' :disabled='!question.trim()' title='发送' @click='ask()'><ArrowUp :size='18' /></button>
      <div class='document-ai__composer-hint'><span>仅基于已选文档回答</span><kbd>↵</kbd><span>发送</span><kbd>⇧↵</kbd><span>换行</span></div>
    </footer>
  </aside>
  <LimitReachedModal :visible="showUpgradeModal" @update:visible="showUpgradeModal = $event" />
</template>

<style scoped>
.document-ai { position:relative; display:flex; width:340px; min-width:300px; height:100%; flex-direction:column; overflow:hidden; border-left:1px solid #e7e8ee; color:#17181d; background:#fff; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }.document-ai--workspace { width:100%; min-width:0; border:0; border-radius:0; }.document-ai--expanded { position:fixed; z-index:2200; inset:0; width:100vw; min-width:0; height:100vh; border:0; border-radius:0; }.document-ai__header { display:flex; height:68px; min-height:68px; align-items:center; justify-content:space-between; padding:0 32px; border-bottom:1px solid #ececf1; }.document-ai__brand,.document-ai__header-actions,.document-ai__brand-icon { display:inline-flex; align-items:center; }.document-ai__brand { gap:8px; font-size:14px; font-weight:700; }.document-ai__brand-icon,.document-ai__hero-icon { justify-content:center; color:#fff; background:linear-gradient(135deg,#ff3fd8 0%,#7a5cff 48%,#39a7ff 100%); }.document-ai__brand-icon { width:28px; height:28px; border-radius:9px; }.document-ai__agent { padding:2px 7px; border:1px solid #cf8cff; border-radius:999px; color:#9b4ee4; font-size:10px; letter-spacing:.5px; }.document-ai__header-actions { gap:5px; }.document-ai__header-actions button,.document-ai__response-actions button { display:inline-grid; width:30px; height:30px; place-items:center; border:0; border-radius:7px; color:#6d7180; background:transparent; cursor:pointer; }.document-ai__header-actions button:hover,.document-ai__response-actions button:hover { color:#343844; background:#f3f2f8; }.document-ai__body { min-height:0; flex:1; overflow-y:auto; }.document-ai__context { display:flex; position:relative; gap:10px; align-items:flex-start; padding:16px 24px; border-bottom:1px solid #f0f0f3; color:#676b78; }.document-ai__context>svg { margin-top:1px; color:#6659eb; }.document-ai__context div { display:grid; gap:3px; min-width:0; }.document-ai__context strong { overflow:hidden; color:#242631; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }.document-ai__context span { color:#828593; font-size:11px; line-height:1.4; }.document-ai__sources-link { justify-self:start; padding:0; border:0; color:#705ce6; background:transparent; cursor:pointer; font-size:12px; font-weight:600; }.document-ai__sources-popover { display:grid; position:absolute; z-index:4; top:66px; left:24px; width:min(520px,calc(100vw - 48px)); gap:1px; padding:8px; border:1px solid #e3e1ee; border-radius:12px; background:#fff; box-shadow:0 16px 35px rgba(32,27,61,.16); }.document-ai__source-row { display:grid; grid-template-columns:18px minmax(0,1fr) auto 26px; gap:7px; align-items:center; padding:8px; color:#656979; font-size:12px; }.document-ai__source-row span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.document-ai__source-row small.ready { color:#2a9f65; }.document-ai__source-row small.failed { color:#c65353; }.document-ai__source-row button { display:grid; place-items:center; border:0; color:#868a96; background:transparent; cursor:pointer; }.document-ai__reading-map { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; max-width:900px; margin:0 auto; padding:0 60px 10px; color:#656979; font-size:11px; }.document-ai__reading-map>div { display:grid; gap:2px; }.document-ai__reading-map strong { color:#3b3e49; font-size:12px; }.document-ai__reading-map>button { align-self:start; padding:5px 8px; border:1px solid #b9adfb; border-radius:6px; color:#6753d9; background:#fff; cursor:pointer; font:inherit; font-size:11px; }.document-ai__reading-map ol { display:grid; grid-column:1/-1; grid-template-columns:repeat(auto-fit,minmax(132px,1fr)); gap:5px; margin:0; padding:0; list-style:none; }.document-ai__reading-map li { display:grid; gap:2px; padding:6px 8px; border:1px solid #e8e8ed; border-radius:7px; }.document-ai__reading-map li small { color:#878a96; font-size:10px; }.document-ai__reading-unit--completed { border-color:#b9ead1 !important; background:#f3fcf7; }.document-ai__reading-unit--failed { border-color:#f1c6c6 !important; background:#fff8f8; }.document-ai__empty { display:flex; min-height:330px; flex-direction:column; align-items:center; justify-content:center; padding:36px 25px; text-align:center; }.document-ai__hero-icon { display:grid; width:52px; height:52px; place-items:center; margin-bottom:18px; border-radius:17px; box-shadow:0 8px 18px rgba(106,86,235,.22); }.document-ai__empty h2 { margin:0; color:#22242d; font-size:17px; letter-spacing:-.2px; }.document-ai__empty p { margin:9px 0 18px; color:#858895; font-size:12px; line-height:1.65; }.document-ai__suggestions { display:grid; width:100%; max-width:340px; gap:8px; }.document-ai__suggestions button { min-height:42px; padding:0 13px; border:1px solid #e5e5ec; border-radius:9px; color:#343641; background:#fff; cursor:pointer; font-size:12px; text-align:left; }.document-ai__suggestions button:hover:not(:disabled) { border-color:#ab9dff; background:#faf9ff; }.document-ai__suggestions button:disabled { color:#a3a5ae; cursor:not-allowed; }.document-ai__deep-reading { display:grid; width:100%; max-width:340px; gap:7px; margin-top:20px; padding:14px; border:1px solid #e6e2fa; border-radius:10px; color:#595d6d; background:#fbfaff; font-size:11px; text-align:left; }.document-ai__deep-reading strong { color:#383b47; font-size:12px; }.document-ai__deep-reading button { justify-self:start; padding:7px 10px; border:1px solid #ac9cff; border-radius:7px; color:#6855da; background:#fff; cursor:pointer; font:inherit; font-size:11px; font-weight:600; }.document-ai__conversation { display:grid; gap:20px; max-width:900px; margin:0 auto; padding:34px 60px 48px; }.document-ai__message { display:grid; gap:9px; max-width:100%; }.document-ai__message--user { justify-items:end; }.document-ai__message-text { color:#292b35; font-size:14px; line-height:1.75; white-space:pre-wrap; }.document-ai__message--user .document-ai__message-text { max-width:min(80%,420px); padding:12px 16px; border-radius:19px 19px 4px 19px; background:#f0ecff; }.document-ai__citations { display:flex; flex-wrap:wrap; align-items:center; gap:5px; color:#858895; font-size:11px; }.document-ai__citation-wrap { position:relative; }.document-ai__citations button { min-width:20px; height:20px; padding:0 6px; border:1px solid #e0dcf7; border-radius:999px; color:#725dea; background:#faf9ff; cursor:pointer; font-size:10px; }.document-ai__citation-popover { display:grid; position:absolute; z-index:7; bottom:27px; left:0; width:min(330px,calc(100vw - 48px)); gap:4px; padding:10px; border:1px solid #e3e1ee; border-radius:10px; color:#555967; background:#fff; box-shadow:0 12px 28px rgba(32,27,61,.18); font-size:11px; line-height:1.45; }.document-ai__citation-popover strong { color:#373a46; font-size:11px; }.document-ai__response-actions { display:flex; gap:1px; margin-top:-4px; }.document-ai__composer { display:flex; position:relative; align-items:flex-end; gap:8px; padding:12px 20px 16px; border-top:1px solid #eeeeF3; background:#fff; }.document-ai__composer textarea { width:100%; min-height:48px; max-height:120px; resize:vertical; padding:13px 42px 10px 15px; border:1.5px solid #c3b5ff; border-radius:24px; outline:none; color:#292b35; background:#fff; box-shadow:inset 0 0 0 1px rgba(114,93,234,.06); font:inherit; font-size:13px; line-height:1.35; }.document-ai__composer textarea:focus { border-color:#8067ff; box-shadow:0 0 0 3px rgba(128,103,255,.12); }.document-ai__composer textarea:disabled { color:#9d9fa9; background:#f7f7f8; }.document-ai__composer>button:not(.document-ai__add-source) { display:grid; width:34px; height:34px; flex:0 0 34px; place-items:center; margin-left:-48px; margin-bottom:7px; border:0; border-radius:50%; color:#fff; background:linear-gradient(135deg,#e58fff,#8c69ff 52%,#48a1ff); cursor:pointer; }.document-ai__composer>button:disabled { opacity:.38; cursor:not-allowed; }.document-ai__add-source { display:grid; width:32px; height:32px; flex:0 0 auto; place-items:center; margin-bottom:8px; border:0; border-radius:50%; color:#695be8; background:#f1eeff; cursor:pointer; }.document-ai__source-picker,.document-ai__mention-picker { display:grid; position:absolute; z-index:5; bottom:76px; left:24px; width:min(360px,calc(100vw - 48px)); gap:4px; padding:10px; border:1px solid #e3e1ee; border-radius:12px; background:#fff; box-shadow:0 16px 35px rgba(32,27,61,.16); }.document-ai__source-picker strong { font-size:12px; }.document-ai__source-picker small { margin-bottom:5px; color:#858895; font-size:10px; }.document-ai__picker-label { padding:4px 8px; color:#696d7b; font-size:11px; font-weight:600; }.document-ai__cloud-search { display:flex; gap:4px; padding:0 4px 4px; }.document-ai__cloud-search input { min-width:0; flex:1; padding:7px 8px; border:1px solid #e5e5ec; border-radius:7px; outline:0; color:#3e414c; font:inherit; font-size:11px; }.document-ai__cloud-search input:focus { border-color:#ae9dff; }.document-ai__cloud-search button { display:grid; width:30px; padding:0; place-items:center; }.document-ai__source-picker button,.document-ai__mention-picker button { display:flex; gap:8px; align-items:center; min-width:0; padding:8px; border:0; border-radius:7px; color:#4b4e58; background:transparent; cursor:pointer; text-align:left; }.document-ai__source-picker button:hover,.document-ai__mention-picker button:hover { background:#f6f4ff; }.document-ai__source-picker button span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.document-ai__source-picker p { margin:5px 0; color:#858895; font-size:11px; }.document-ai__mention-picker { bottom:74px; }.document-ai__feedback { position:absolute; right:20px; bottom:76px; max-width:calc(100% - 40px); color:#777a87; font-size:11px; }.document-ai--workspace .document-ai__body { width:100%; }.document-ai--workspace .document-ai__context { max-width:960px; margin:0 auto; padding-top:25px; border-bottom:0; }.document-ai--workspace .document-ai__empty { min-height:420px; }.document-ai--workspace .document-ai__composer { max-width:960px; width:100%; align-self:center; box-sizing:border-box; border-top:0; }.document-ai--workspace .document-ai__header { padding-right:32px; padding-left:32px; }@media (max-width:760px) { .document-ai { width:320px; min-width:280px; }.document-ai--workspace .document-ai__conversation { padding:22px; }.document-ai--workspace .document-ai__context { padding:20px; }.document-ai--workspace .document-ai__header { padding:0 16px; } }
.document-ai { --document-ai-bg:var(--color-bg-1); --document-ai-surface:var(--color-bg-2); --document-ai-line:var(--color-border-2); --document-ai-text:var(--color-text-1); --document-ai-muted:var(--color-text-3); --document-ai-hover:var(--color-fill-2); --document-ai-input:var(--color-bg-2); --document-ai-popover:var(--color-bg-3); -webkit-app-region:no-drag; color:var(--document-ai-text); background:var(--document-ai-bg); border-left-color:var(--document-ai-line); }
:global(body[arco-theme='dark']) .document-ai { --document-ai-bg:#10151e; --document-ai-surface:#151c28; --document-ai-line:rgba(143,157,189,.2); --document-ai-text:#edf1fb; --document-ai-muted:#9ba7bb; --document-ai-hover:rgba(255,255,255,.075); --document-ai-input:#121924; --document-ai-popover:#161c28; background:radial-gradient(circle at 92% 0%,rgba(35,113,94,.2),transparent 31%),linear-gradient(145deg,#121720,#090c12); }
.document-ai--workspace { border:1px solid var(--document-ai-line); border-radius:15px; background:var(--document-ai-bg); }.document-ai--expanded { border:0; border-radius:0; }
:global(body[arco-theme='dark']) .document-ai--workspace { background:radial-gradient(circle at 74% 0%,rgba(13,102,84,.25),transparent 38%),linear-gradient(145deg,#151a24,#090c12); box-shadow:inset 0 1px 0 rgba(255,255,255,.035); }
.document-ai__header,.document-ai__composer { border-color:var(--document-ai-line); background:var(--document-ai-bg); }.document-ai__brand,.document-ai__context strong,.document-ai__empty h2,.document-ai__reading-map strong,.document-ai__deep-reading strong,.document-ai__citation-popover strong { color:var(--document-ai-text); }.document-ai__header-actions button,.document-ai__response-actions button,.document-ai__context,.document-ai__context span,.document-ai__reading-map,.document-ai__deep-reading,.document-ai__citations,.document-ai__feedback,.document-ai__picker-label { color:var(--document-ai-muted); }.document-ai__header-actions button:hover,.document-ai__response-actions button:hover,.document-ai__source-picker button:hover,.document-ai__mention-picker button:hover { color:var(--document-ai-text); background:var(--document-ai-hover); }
.document-ai__context { border-bottom-color:var(--document-ai-line); }.document-ai__sources-popover,.document-ai__source-picker,.document-ai__mention-picker,.document-ai__citation-popover { border-color:var(--document-ai-line); color:var(--document-ai-text); background:var(--document-ai-popover); }.document-ai__source-row,.document-ai__source-row button,.document-ai__source-picker button,.document-ai__mention-picker button,.document-ai__message-text { color:var(--document-ai-text); }.document-ai__reading-map li,.document-ai__suggestions button { border-color:var(--document-ai-line); color:var(--document-ai-text); background:var(--document-ai-surface); }.document-ai__suggestions button:hover:not(:disabled) { background:var(--document-ai-hover); }.document-ai__deep-reading { border-color:rgba(150,132,245,.32); background:color-mix(in srgb, #765ae6 10%, var(--document-ai-bg)); }.document-ai__message--user .document-ai__message-text { color:var(--document-ai-text); background:color-mix(in srgb, #765ae6 22%, var(--document-ai-bg)); }.document-ai__composer textarea,.document-ai__cloud-search input { border-color:color-mix(in srgb, #977fff 55%, var(--document-ai-line)); color:var(--document-ai-text); background:var(--document-ai-input); }.document-ai__composer textarea:disabled { color:var(--document-ai-muted); background:var(--document-ai-surface); }
.document-ai__preparation-error { display:grid; width:100%; max-width:340px; gap:6px; margin-top:14px; padding:12px; border:1px solid rgba(222,119,99,.42); border-radius:10px; color:var(--document-ai-muted); background:rgba(222,119,99,.07); font-size:11px; text-align:left; }.document-ai__preparation-error strong { color:var(--document-ai-text); font-size:12px; }.document-ai__preparation-error button { justify-self:start; padding:6px 9px; border:1px solid rgba(156,130,246,.6); border-radius:6px; color:#725dea; background:transparent; cursor:pointer; font:inherit; font-size:11px; }
.document-ai__composer>.document-ai__stop-answer { color:var(--document-ai-text); background:var(--document-ai-hover); box-shadow:inset 0 0 0 1px var(--document-ai-line); }
.document-ai__source-picker button.selected { color:#745ce5; background:color-mix(in srgb,#8067ff 13%,var(--document-ai-popover)); }.document-ai__source-picker .document-ai__add-selected { justify-content:center; margin-top:4px; color:#fff; background:linear-gradient(100deg,#655cff,#8d6dff); font-weight:700; }.document-ai__source-picker .document-ai__add-selected:hover { color:#fff; background:linear-gradient(100deg,#5d54e8,#8161ec); }.document-ai__mention-picker>span { padding:4px 8px; color:var(--document-ai-muted); font-size:10px; }
.document-ai__source-picker { max-height:min(500px,calc(100vh - 138px)); overflow-y:auto; }.document-ai__picker-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:2px 3px 5px; }.document-ai__picker-heading>div { display:grid; gap:3px; }.document-ai__picker-heading small { margin:0; }.document-ai__picker-heading>button { display:grid; width:25px; height:25px; flex:0 0 25px; place-items:center; padding:0; }.document-ai__browser-toolbar { display:grid; grid-template-columns:30px minmax(0,1fr); align-items:center; gap:5px; padding:5px 4px; border:1px solid var(--document-ai-line); border-radius:8px; color:var(--document-ai-muted); background:var(--document-ai-surface); font-size:11px; }.document-ai__browser-toolbar button { display:grid; width:28px; height:25px; place-items:center; padding:0; }.document-ai__browser-toolbar span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.document-ai__browser-folder,.document-ai__browser-file { display:grid !important; grid-template-columns:18px minmax(0,1fr) auto; align-items:center; }.document-ai__browser-folder svg:last-child { transform:rotate(-90deg); color:var(--document-ai-muted); }.document-ai__browser-file small { color:var(--document-ai-muted); font-size:9px; }.document-ai__picker-empty { padding:9px 8px !important; color:var(--document-ai-muted) !important; font-size:11px; }.document-ai__picker-search { display:grid; gap:5px; margin-top:3px; padding:7px 4px 2px; border-top:1px solid var(--document-ai-line); }.document-ai__picker-search summary { padding:3px 4px; color:var(--document-ai-muted); cursor:pointer; font-size:11px; }.document-ai__picker-search[open] summary { color:var(--document-ai-text); }.document-ai__picker-search .document-ai__cloud-search { padding-bottom:1px; }
.document-ai__message-markdown { max-width:760px; color:var(--document-ai-text); line-height:1.72; white-space:normal; user-select:text; }
.document-ai__reading-notes { display:grid; max-width:900px; gap:12px; margin:0 auto; padding:12px 60px 28px; }.document-ai__reading-notes-heading { display:flex; align-items:end; justify-content:space-between; padding-top:4px; }.document-ai__reading-notes-heading>div { display:grid; gap:3px; }.document-ai__reading-notes-heading strong { color:var(--document-ai-text); font-size:14px; }.document-ai__reading-notes-heading span { color:var(--document-ai-muted); font-size:11px; }.document-ai__reading-note { display:grid; gap:9px; padding:16px 18px; border:1px solid var(--document-ai-line); border-radius:10px; background:var(--document-ai-surface); }.document-ai__reading-note>small { color:#9a85ff; font-size:11px; font-weight:700; }
:deep(.document-ai__message-markdown > :first-child) { margin-top:0; }
:deep(.document-ai__message-markdown > :last-child) { margin-bottom:0; }
:deep(.document-ai__message-markdown p) { margin:0 0 13px; }
:deep(.document-ai__message-markdown h1),:deep(.document-ai__message-markdown h2),:deep(.document-ai__message-markdown h3),:deep(.document-ai__message-markdown h4) { margin:25px 0 10px; color:var(--document-ai-text); font-weight:700; letter-spacing:-.015em; line-height:1.35; }
:deep(.document-ai__message-markdown h1) { font-size:20px; }
:deep(.document-ai__message-markdown h2) { padding-bottom:7px; border-bottom:1px solid var(--document-ai-line); font-size:16px; }
:deep(.document-ai__message-markdown h3) { font-size:14px; }
:deep(.document-ai__message-markdown h4) { font-size:13px; }
:deep(.document-ai__message-markdown ul),:deep(.document-ai__message-markdown ol) { margin:8px 0 15px; padding-left:22px; }
:deep(.document-ai__message-markdown li) { margin:5px 0; padding-left:3px; }
:deep(.document-ai__message-markdown li::marker) { color:#8f7aff; font-weight:700; }
:deep(.document-ai__message-markdown blockquote) { margin:14px 0; padding:9px 13px; border-left:3px solid #8d79ff; border-radius:0 8px 8px 0; color:var(--document-ai-muted); background:color-mix(in srgb, #7d66f0 10%, var(--document-ai-surface)); }
:deep(.document-ai__message-markdown blockquote p) { margin:0; }
:deep(.document-ai__message-markdown hr) { height:1px; margin:22px 0; border:0; background:var(--document-ai-line); }
:deep(.document-ai__message-markdown strong) { color:var(--document-ai-text); font-weight:700; }
:deep(.document-ai__message-markdown em) { color:var(--document-ai-muted); }
:deep(.document-ai__message-markdown code) { padding:2px 5px; border-radius:4px; color:var(--document-ai-text); background:var(--document-ai-hover); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.88em; }
:deep(.document-ai__message-markdown pre) { overflow:auto; margin:14px 0; padding:12px; border:1px solid var(--document-ai-line); border-radius:9px; background:var(--document-ai-surface); }
:deep(.document-ai__message-markdown pre code) { padding:0; background:transparent; }
:deep(.document-ai__message-markdown a) { color:#927dff; text-decoration:underline; text-underline-offset:2px; }

/* Conversation-first desktop treatment: source and deep-reading metadata stay
   available without competing with the answer thread. */
.document-ai { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI Variable','Segoe UI',ui-sans-serif,system-ui,sans-serif; letter-spacing:0; }
.document-ai__header { height:54px; min-height:54px; padding:0 24px; }.document-ai__brand { gap:7px; font-size:13px; font-weight:650; }.document-ai__brand-icon { width:26px; height:26px; border-radius:8px; }.document-ai__agent { padding:1px 6px; font-size:9px; font-weight:700; letter-spacing:.04em; }.document-ai__header-actions button { width:28px; height:28px; }
.document-ai__context { gap:9px; max-width:820px !important; padding:14px 24px !important; }.document-ai__context strong { font-size:13px; font-weight:650; }.document-ai__context span { max-width:680px; font-size:12px; line-height:1.45; }.document-ai__context-actions { display:flex !important; grid-template-columns:none !important; gap:10px; align-items:center; margin-top:3px; }.document-ai__sources-link { font-size:11px; font-weight:600; }
.document-ai__empty { min-height:0 !important; align-items:flex-start; justify-content:flex-start; max-width:760px; margin:0 auto; padding:68px 48px 42px; text-align:left; }.document-ai__hero-icon { width:38px; height:38px; margin-bottom:15px; border-radius:12px; box-shadow:none; }.document-ai__empty h2 { font-size:22px; font-weight:680; letter-spacing:-.025em; }.document-ai__empty p { max-width:560px; margin:7px 0 20px; font-size:14px; line-height:1.6; }.document-ai__suggestions { grid-template-columns:repeat(2,minmax(0,1fr)); max-width:600px; gap:7px; }.document-ai__suggestions button { min-height:38px; padding:0 12px; border-radius:8px; font-size:13px; line-height:1.35; }.document-ai__deep-reading { max-width:570px; margin-top:18px; padding:12px 14px; border-radius:9px; font-size:12px; line-height:1.45; }.document-ai__deep-reading strong { font-size:13px; }.document-ai__deep-reading button { padding:6px 9px; font-size:12px; }
.document-ai__conversation { gap:28px; max-width:820px; padding:34px 48px 56px; }.document-ai__message { gap:8px; }.document-ai__message-text,.document-ai__message-markdown { max-width:720px; font-size:15px; line-height:1.78; }.document-ai__message--user .document-ai__message-text { max-width:min(78%,540px); padding:10px 14px; border-radius:14px 14px 4px 14px; font-size:14px; line-height:1.55; }.document-ai__citations { gap:6px; font-size:12px; }.document-ai__citations button { min-width:22px; height:22px; font-size:11px; }.document-ai__response-actions { margin-top:-1px; }.document-ai__response-actions button { width:28px; height:28px; }
.document-ai__composer { width:min(820px,100%); padding:12px 24px 18px; box-sizing:border-box; }.document-ai--workspace .document-ai__composer { max-width:820px; }.document-ai__composer textarea { min-height:46px; padding:12px 43px 10px 15px; border-radius:12px; font-size:14px; line-height:1.45; }.document-ai__composer>button:not(.document-ai__add-source) { width:30px; height:30px; flex-basis:30px; margin-left:-42px; margin-bottom:8px; }.document-ai__add-source { width:30px; height:30px; margin-bottom:8px; }.document-ai__feedback { right:26px; bottom:78px; font-size:12px; }
.document-ai--expanded .document-ai__composer { width:min(820px,calc(100% - 48px)); align-self:center; }.document-ai--expanded .document-ai__context { width:min(820px,calc(100% - 48px)); box-sizing:border-box; }.document-ai--expanded .document-ai__empty { width:min(760px,calc(100% - 48px)); box-sizing:border-box; }.document-ai--expanded .document-ai__conversation { width:min(820px,calc(100% - 48px)); box-sizing:border-box; }
.document-ai__reading-map { max-width:820px; padding:4px 48px 12px; font-size:12px; }.document-ai__reading-map strong { font-size:13px; }.document-ai__reading-map ol { grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }.document-ai__reading-map li { padding:7px 9px; }.document-ai__reading-notes { max-width:820px; padding:8px 48px 26px; }.document-ai__reading-notes-heading strong { font-size:14px; }.document-ai__reading-notes-heading span,.document-ai__reading-note>small { font-size:12px; }.document-ai__reading-note { padding:15px 16px; border-radius:9px; }
:deep(.document-ai__message-markdown h1) { font-size:22px; }.document-ai__message-markdown h2 { font-size:18px; }.document-ai__message-markdown h3 { font-size:16px; }.document-ai__message-markdown h4 { font-size:15px; }:deep(.document-ai__message-markdown h1),:deep(.document-ai__message-markdown h2),:deep(.document-ai__message-markdown h3),:deep(.document-ai__message-markdown h4) { margin:28px 0 11px; font-weight:700; }.document-ai__message-markdown p { margin-bottom:15px; }
@media (max-width:760px) { .document-ai__header { padding:0 16px; }.document-ai__context,.document-ai__empty,.document-ai__conversation,.document-ai__reading-map,.document-ai__reading-notes { padding-right:20px !important; padding-left:20px !important; }.document-ai__empty { padding-top:42px; }.document-ai__suggestions { grid-template-columns:1fr; }.document-ai__conversation { padding-top:24px; }.document-ai__composer { padding-right:16px; padding-left:16px; }.document-ai__message-text,.document-ai__message-markdown { font-size:14px; } }

/* Keep PDF question-answering visually aligned with the book reader while
   preserving its page-level citations and source controls. */
.document-ai__context {
  margin:12px auto 0;
  border:1px solid var(--document-ai-line);
  border-radius:9px;
  background:var(--document-ai-surface);
}
.document-ai__resize-handle {
  position:absolute;
  z-index:20;
  top:0;
  bottom:0;
  left:-5px;
  width:10px;
  cursor:col-resize;
  touch-action:none;
}
.document-ai__resize-handle::after {
  position:absolute;
  top:50%;
  left:3px;
  width:3px;
  height:42px;
  border-radius:999px;
  background:transparent;
  content:'';
  transform:translateY(-50%);
  transition:background .16s ease, height .16s ease;
}
.document-ai__resize-handle:hover::after,
.document-ai--resizing .document-ai__resize-handle::after {
  height:58px;
  background:rgb(var(--primary-6));
}
.document-ai--resizing {
  transition:none !important;
}
.document-ai--sidebar .document-ai__context {
  margin:10px 12px 0;
  padding:11px 12px !important;
}
.document-ai__message-meta {
  display:inline-flex;
  align-items:center;
  gap:5px;
  color:var(--document-ai-muted);
  font-size:11px;
  font-weight:650;
}
.document-ai__message-rule {
  padding:2px 6px;
  border-radius:999px;
  color:rgb(var(--primary-6));
  background:rgba(var(--primary-6),.09);
  font-size:10px;
  font-weight:600;
}
.document-ai__message--assistant .document-ai__message-text {
  box-sizing:border-box;
  padding:13px 15px;
  border:1px solid var(--document-ai-line);
  border-radius:4px 12px 12px 12px;
  background:var(--document-ai-surface);
  box-shadow:0 1px 2px rgba(0,0,0,.04);
}
.document-ai__message--assistant .document-ai__citations {
  margin-top:-2px;
}
.document-ai__composer {
  padding-bottom:33px;
}
.document-ai__composer-hint {
  display:flex;
  position:absolute;
  right:24px;
  bottom:8px;
  left:24px;
  align-items:center;
  gap:5px;
  color:var(--document-ai-muted);
  font-size:10px;
  line-height:1.35;
  pointer-events:none;
}
.document-ai__composer-hint > span:first-child {
  margin-right:auto;
}
.document-ai__composer-hint kbd {
  min-width:15px;
  padding:0 3px;
  border:1px solid var(--document-ai-line);
  border-bottom-width:2px;
  border-radius:3px;
  color:var(--document-ai-muted);
  font:inherit;
  text-align:center;
}
@media (max-width:760px) {
  .document-ai__composer-hint { right:16px; left:16px; }
  .document-ai__composer-hint > span:first-child { display:none; }
}
</style>
