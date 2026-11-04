<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Sparkles, User, Send, Square, RotateCcw, WandSparkles, Command, Plus, Search, Film, HardDrive, FolderCog, Activity, ShieldCheck, ArrowUpRight, Brain, Trash2 } from 'lucide-vue-next'
import { useAppStore } from '../store'
import message from '../utils/message'
import { resolveQuarkSearchDirectory } from '../utils/quarkSearchNavigation'
import { useAISearchChat } from './aisearch/useAISearchChat'
import ReasonChain from './aisearch/ReasonChain.vue'
import BorderBeam from './aisearch/BorderBeam.vue'
import ThinkingOrb from './aisearch/ThinkingOrb.vue'
import ClarifyCard from './aisearch/ClarifyCard.vue'
import SearchFilesCard from './aisearch/SearchFilesCard.vue'
import SearchLinksCard from './aisearch/SearchLinksCard.vue'
import SummaryCard from './aisearch/SummaryCard.vue'
import LoadingIndicator from './aisearch/LoadingIndicator.vue'
import DriveSelectorCard from './aisearch/DriveSelectorCard.vue'
import ImportShareCard from './aisearch/ImportShareCard.vue'
import DownloadCard from './aisearch/DownloadCard.vue'
import DuplicateCard from './aisearch/DuplicateCard.vue'
import StorageCard from './aisearch/StorageCard.vue'
import OrganizeCard from './aisearch/OrganizeCard.vue'
import BatchActionCard from './aisearch/BatchActionCard.vue'
import MovieListCard from './aisearch/MovieListCard.vue'
import MiaochuanCard from './aisearch/MiaochuanCard.vue'
import DirectLinksCard from './aisearch/DirectLinksCard.vue'
import GuangyaMagnetsCard from './aisearch/GuangyaMagnetsCard.vue'
import GuangyaEmptyDirsCard from './aisearch/GuangyaEmptyDirsCard.vue'
import { renderMarkdown } from './aisearch/markdown'
import type { FileResult } from './aisearch/types'
import type { WorkspaceDocumentContext } from './aisearch/useAISearchChat'
import type { MediaAcquisitionRequest } from '@shared/types/mediaAcquisition'
import MediaAcquisitionTargetModal from '../components/MediaAcquisitionTargetModal.vue'
import { t } from '../i18n'

const props = withDefaults(defineProps<{ aiEnabled: boolean; documentContext?: WorkspaceDocumentContext | null; sidebarVisible?: boolean }>(), { sidebarVisible: true })
const emit = defineEmits<{ 'search-resource': [title: string] }>()

const appStore = useAppStore()
const { messages, loading, memories, activeDocument, threads, activeThreadId, setDocumentContext, openConversation, newConversation, deleteConversation, sendMessage, stop, clear, removeMemory, confirmAction, cancelAction } = useAISearchChat()
const chatContainer = ref<HTMLElement>()
const inputText = ref('')
const composerFocused = ref(false)
const acquisitionRequest = ref<MediaAcquisitionRequest | null>(null)
const acquisitionVisible = ref(false)
const visibleMessages = computed(() => messages.value.filter(message => message.role === 'user' || message.parts.some((part: any) => part.type !== 'text' || Boolean(part.text?.trim()))))
const requestCount = computed(() => messages.value.filter(message => message.role === 'user').length)
const toolActivityCount = computed(() => messages.value
  .filter(message => message.role === 'assistant')
  .flatMap(message => message.parts)
  .filter(part => part.type.startsWith('tool-')).length)
const pendingApprovalCount = computed(() => messages.value
  .flatMap(message => message.parts)
  .filter((part: any) => part.state === 'confirm').length)
const recentToolActivities = computed(() => messages.value
  .flatMap(message => message.parts)
  .filter(part => part.type.startsWith('tool-'))
  .slice(-4)
  .reverse()
  .map((part: any) => ({
    title: TOOL_ACTIVITY_LABELS[part.type] || t('ai.toolCalled'),
    state: part.state === 'error' ? 'error' : part.state === 'confirm' ? 'approval' : part.state === 'running' ? 'running' : 'complete',
  })))

function handleSend(q?: string) {
  const kw = (q || '').trim()
  if (!kw) return false
  if (!props.aiEnabled) {
    message.warning(t('ai.agentRequiresConfig'))
    return false
  }
  sendMessage(kw)
  return true
}

function handleInputSend() {
  if (handleSend(inputText.value)) inputText.value = ''
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleInputSend()
  }
}

function handleSearchResource(title: string) {
  emit('search-resource', title)
}

function handleAcquire(request: MediaAcquisitionRequest) {
  acquisitionRequest.value = request
  acquisitionVisible.value = true
}

function handleAcquisitionVisible(visible: boolean) {
  acquisitionVisible.value = visible
  if (!visible) acquisitionRequest.value = null
}

function handleClarifySelect(option: string) {
  handleSend(option)
}

function handleFollowUp(query: string) {
  handleSend(query)
}

function handleFileNavigate(file: FileResult) {
  appStore.toggleTabMenu('pan', 'wangpan')
  nextTick(async () => {
    const { default: usePanTreeStore } = await import('../pan/pantreestore')
    const { default: PanDAL } = await import('../pan/pandal')
    const { default: UserDAL } = await import('../user/userdal')
    const panTreeStore = usePanTreeStore()
    if (panTreeStore.user_id !== file.userId) await UserDAL.UserChange(file.userId)
    await nextTick()
    let fileId = file.parentFileId || file.fileId
    if (file.provider === 'quark') {
      try {
        fileId = await resolveQuarkSearchDirectory({
          fileId: file.fileId, parentFileId: file.parentFileId, isDir: file.isDir
        }, async () => {
          const { apiQuarkFileDetail } = await import('../quark/dirfilelist')
          const detail = await apiQuarkFileDetail(file.userId, file.fileId)
          return detail?.pdir_fid == null ? undefined : String(detail.pdir_fid)
        })
      } catch {
        message.error(t('pan.unrecognizedCurrentDir'))
        return
      }
    }
    if (fileId === '/' || !fileId) {
      const map: Record<string, string> = {
        baidu: 'baidu_root', cloud123: 'cloud_root', '115': 'drive115_root',
        quark: 'quark_root', pikpak: 'pikpak_root', dropbox: 'dropbox_root',
        onedrive: 'onedrive_root', box: 'box_root',
      }
      fileId = map[file.provider] || fileId
    }
    PanDAL.aReLoadOneDirToShow(file.driveId || fileId, fileId, true)
  })
}

function handleRetryTool(_messageId: string, _toolType: string, input: any) {
  if (input?.keyword) handleSend(input.keyword)
}

function handleDriveConfirm(selected: { userId: string; name: string; platform: string; driveId: string }[]) {
  const PLATFORM_LABELS: Record<string, string> = {
    aliyun: t('drive.aliyun'), quark: t('drive.quarkFull'), baidu: t('drive.baiduFull'), '115': t('drive.drive115'),
    '123': t('drive.cloud123'), tianyi: t('drive.cloud189'), xunlei: 'Xunlei Drive', pikpak: 'PikPak',
    dropbox: 'Dropbox', onedrive: 'OneDrive', box: 'Box',
  }
  const desc = selected.map(d => `${PLATFORM_LABELS[d.platform] || d.platform}(${d.name})`).join('、')
  const platforms = selected.map(d => d.platform)
  const targets = selected.map(d => ({ userId: d.userId, driveId: d.driveId, platform: d.platform }))
  handleSend(`用户选择了: ${desc}。platforms: ${platforms.join(',')}。selectedDriveTargets: ${JSON.stringify(targets)}`)
}

function handleConfirmAction(msgId: string, partIndex: number) { confirmAction(msgId, partIndex) }
function handleCancelAction(msgId: string, partIndex: number) { cancelAction(msgId, partIndex) }
function handleDeleteConversation(event: MouseEvent, id: string) { event.stopPropagation(); deleteConversation(id) }

watch(() => props.documentContext, context => {
  setDocumentContext(context || null)
  if (context?.file && props.aiEnabled) {
    const name = context.file.name || context.file.file_name || t('ai.currentDocument')
    void nextTick(() => handleSend(`请分析当前文档《${name}》，先概括核心内容、关键要点与需要注意的风险。`))
  }
}, { immediate: true })

const DEFAULT_FOLLOWUPS = [
  '豆瓣电影排行榜',
  'TMDB 最近热映',
  '帮我找科幻电影',
  '最近有什么好电影',
  '整理文件',
  '清理空间',
  '查找重复文件',
  '分析存储空间',
]

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  'tool-listDrives': t('ai.toolListDrives'),
  'tool-searchMyFiles': t('ai.toolSearchMyFiles'),
  'tool-searchPanHub': t('ai.toolSearchPanHub'),
  'tool-getMovies': t('ai.toolGetMovies'),
  'tool-findDuplicates': t('ai.toolFindDuplicates'),
  'tool-analyzeStorage': t('ai.toolAnalyzeStorage'),
  'tool-categorizeFiles': t('ai.toolCategorizeFiles'),
  'tool-moveFiles': t('ai.toolMoveFiles'),
  'tool-organizeFiles': t('ai.toolOrganizeFiles'),
  'tool-deleteFiles': t('ai.toolDeleteFiles'),
  'tool-importShare': t('ai.toolImportShare'),
  'tool-downloadFiles': t('ai.toolDownloadFiles'),
}
</script>

<template>
  <div class="ai-chat">
    <div :class="['ai-workspace-grid', { 'without-task-rail': !props.sidebarVisible }]">
      <aside v-show="props.sidebarVisible" class="ai-task-rail">
        <div class="ai-rail-brand">
          <span class="ai-rail-brand-mark"><Sparkles :size="17" /></span>
          <span>BOXPLAYER<br><b>INTELLIGENCE</b></span>
        </div>
        <button class="ai-new-task" type="button" :disabled="loading" @click="newConversation"><Plus :size="16" /> {{ t('ai.newConversation') }}</button>
        <div class="ai-rail-section">
          <span class="ai-rail-label">{{ t('ai.commonCapabilities') }}</span>
          <button type="button" class="ai-rail-action" :disabled="!aiEnabled || loading" @click="handleSend('帮我搜索网盘里的文件')"><Search :size="15" /><span>{{ t('ai.findFiles') }}</span></button>
          <button type="button" class="ai-rail-action" :disabled="!aiEnabled || loading" @click="handleSend('推荐最近值得看的电影')"><Film :size="15" /><span>{{ t('ai.movieDiscovery') }}</span></button>
          <button type="button" class="ai-rail-action" :disabled="!aiEnabled || loading" @click="handleSend('分析我的存储空间')"><HardDrive :size="15" /><span>{{ t('ai.storageInsights') }}</span></button>
          <button type="button" class="ai-rail-action" :disabled="!aiEnabled || loading" @click="handleSend('帮我整理文件')"><FolderCog :size="15" /><span>{{ t('ai.organizePlan') }}</span></button>
        </div>
        <div v-if="threads.length" class="ai-rail-section ai-rail-history">
          <span class="ai-rail-label">{{ t('ai.conversationHistory') }}</span>
          <button v-for="thread in threads" :key="thread.id" type="button" class="ai-history-item" :class="{ active: thread.id === activeThreadId }" :disabled="loading" :title="thread.title" @click="openConversation(thread.id)">
            <span>{{ thread.title }}</span>
            <i :title="t('ai.deleteHistory')" @click="handleDeleteConversation($event, thread.id)"><Trash2 :size="12" /></i>
          </button>
        </div>
        <div v-if="memories.length" class="ai-rail-section ai-rail-memories">
          <span class="ai-rail-label"><Brain :size="13" /> {{ t('ai.longTermMemory') }}</span>
          <div v-for="memory in memories" :key="memory.id" class="ai-memory-item" :title="memory.summary">
            <span><b>{{ memory.key }}</b>{{ memory.summary }}</span>
            <button type="button" :title="t('ai.deleteMemory')" @click="removeMemory(memory.id)"><Trash2 :size="12" /></button>
          </div>
        </div>
        <div class="ai-rail-foot">
          <span class="ai-rail-foot-dot" :class="{ active: aiEnabled }" />
          {{ aiEnabled ? t('ai.serviceAvailable') : t('ai.needsConfig') }}
        </div>
      </aside>

      <BorderBeam class="ai-workspace-beam" :active="loading">
      <main class="ai-workspace-main">
    <header class="ai-workspace-header">
      <div class="ai-workspace-title">
        <span class="ai-workspace-mark"><WandSparkles :size="16" /></span>
        <div>
          <strong>{{ t('ai.workspaceTitle') }}</strong>
          <span>{{ t('ai.workspaceSubtitle') }}</span>
        </div>
      </div>
      <div class="ai-workspace-status" :class="{ active: loading }">
        <ThinkingOrb v-if="loading" class="ai-status-orb" />
        <span v-else class="ai-status-pulse" />
        {{ loading ? t('ai.processing') : aiEnabled ? t('ai.ready') : t('ai.previewOnly') }}
      </div>
    </header>
    <div v-if="activeDocument" class="ai-document-context">
      <span>{{ t('ai.currentDocument') }}</span>
      <strong>{{ activeDocument.file?.name || activeDocument.file?.file_name }}</strong>
      <small>{{ t('ai.documentContextHint') }}</small>
    </div>

    <!-- messages -->
    <div ref="chatContainer" class="ai-messages">
      <!-- empty -->
      <div v-if="visibleMessages.length === 0 && !loading" class="ai-empty">
        <span class="ai-empty-icon"><Sparkles :size="26" :stroke-width="1.6" /></span>
        <div class="ai-empty-kicker">BOXPLAYER AGENT</div>
        <div class="ai-empty-title">{{ t('ai.startWithGoal') }}</div>
        <div class="ai-empty-desc">{{ aiEnabled ? t('ai.emptyEnabledDesc') : t('ai.emptyDisabledDesc') }}</div>
        <div class="ai-starter-grid">
          <button type="button" class="ai-starter-card ai-starter-card--search" :disabled="!aiEnabled" @click="handleSend('帮我搜索网盘里的文件')">
            <span><Search :size="17" /></span><strong>{{ t('ai.findFiles') }}</strong><small>{{ t('ai.findFilesDesc') }}</small>
          </button>
          <button type="button" class="ai-starter-card ai-starter-card--film" :disabled="!aiEnabled" @click="handleSend('推荐最近值得看的电影')">
            <span><Film :size="17" /></span><strong>{{ t('ai.movieDiscovery') }}</strong><small>{{ t('ai.movieDiscoveryDesc') }}</small>
          </button>
          <button type="button" class="ai-starter-card ai-starter-card--storage" :disabled="!aiEnabled" @click="handleSend('分析我的存储空间')">
            <span><HardDrive :size="17" /></span><strong>{{ t('ai.storageInsights') }}</strong><small>{{ t('ai.storageInsightsDesc') }}</small>
          </button>
          <button type="button" class="ai-starter-card ai-starter-card--organize" :disabled="!aiEnabled" @click="handleSend('帮我整理文件')">
            <span><FolderCog :size="17" /></span><strong>{{ t('ai.organizePlan') }}</strong><small>{{ t('ai.organizePlanDesc') }}</small>
          </button>
        </div>
      </div>

      <!-- message list -->
      <div v-else class="ai-message-list">
      <div
        v-for="msg in visibleMessages"
        :key="msg.id"
        class="ai-msg"
        :class="'ai-msg--' + msg.role"
      >
        <!-- Keep the user marker compact. Agent answers follow the Codex-style plain reading flow. -->
        <div v-if="msg.role === 'user'" class="ai-msg-avatar" :title="t('ai.you')">
          <User v-if="msg.role === 'user'" :size="16" :stroke-width="2" />
        </div>

        <!-- parts -->
        <div class="ai-msg-body">
          <div v-if="msg.role === 'user'" class="ai-msg-label">{{ t('ai.you') }}</div>
          <template v-for="(part, pi) in msg.parts" :key="pi">
            <!-- tool: listDrives -->
            <DriveSelectorCard
              v-if="part.type === 'tool-listDrives'"
              :drives="(part as any).drives"
              @confirm="handleDriveConfirm"
            />

            <!-- text (user) -->
            <div v-else-if="part.type === 'text' && msg.role === 'user'" class="ai-msg-text">{{ (part as any).text }}</div>

            <!-- text (assistant, markdown) -->
            <div v-else-if="part.type === 'text'" class="ai-msg-text" v-html="renderMarkdown((part as any).text)" />

            <!-- legacy reasoning history is presented as a compact execution note -->
            <ReasonChain v-else-if="part.type === 'reasoning'" :text="(part as any).text" />

            <!-- clarification -->
            <ClarifyCard
              v-else-if="part.type === 'clarification'"
              :question="(part as any).question"
              :options="(part as any).options"
              @select="handleClarifySelect"
            />

            <!-- tool: searchMyFiles -->
            <SearchFilesCard
              v-else-if="part.type === 'tool-searchMyFiles'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @navigate="handleFileNavigate"
              @retry="handleRetryTool(msg.id, 'tool-searchMyFiles', (part as any).input)"
            />

            <!-- tool: searchPanHub -->
            <SearchLinksCard
              v-else-if="part.type === 'tool-searchPanHub'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @retry="handleRetryTool(msg.id, 'tool-searchPanHub', (part as any).input)"
            />

            <!-- summary -->
            <SummaryCard
              v-else-if="part.type === 'summary'"
              :text="(part as any).text"
              :followups="(part as any).followups"
              @followup="handleFollowUp"
            />

            <!-- tool: importShare -->
            <ImportShareCard
              v-else-if="part.type === 'tool-importShare'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @retry="handleRetryTool(msg.id, 'tool-importShare', (part as any).input)"
            />

            <!-- tool: downloadFiles -->
            <DownloadCard
              v-else-if="part.type === 'tool-downloadFiles'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @retry="handleRetryTool(msg.id, 'tool-downloadFiles', (part as any).input)"
            />

            <!-- tool: getMovies -->
            <MovieListCard
              v-else-if="part.type === 'tool-getMovies'"
              :state="(part as any).state"
              :category="(part as any).category"
              :movies="(part as any).movies"
              :tv="(part as any).tv"
              :error="(part as any).error"
              @search="(title: string) => handleSend(title)"
              @search-resource="(title: string) => handleSearchResource(title)"
              @acquire="handleAcquire"
              @retry="handleRetryTool(msg.id, 'tool-getMovies', {})"
            />

            <!-- tool: findDuplicates -->
            <DuplicateCard
              v-else-if="part.type === 'tool-findDuplicates'"
              :state="(part as any).state"
              :output="(part as any).output"
              :error="(part as any).error"
              @navigate="handleFileNavigate"
              @select="(files: FileResult[]) => handleSend('删除以下' + files.length + '个重复文件: ' + JSON.stringify(files.map(f => ({name:f.name,fileId:f.fileId,driveId:f.driveId,userId:f.userId}))))"
              @retry="handleRetryTool(msg.id, 'tool-findDuplicates', {})"
            />

            <!-- tool: analyzeStorage -->
            <StorageCard
              v-else-if="part.type === 'tool-analyzeStorage'"
              :state="(part as any).state"
              :title="(part as any).title"
              :report="(part as any).report"
              :output="(part as any).output"
              :error="(part as any).error"
              @navigate="handleFileNavigate"
              @retry="handleRetryTool(msg.id, 'tool-analyzeStorage', {})"
            />

            <!-- tool: categorizeFiles -->
            <OrganizeCard
              v-else-if="part.type === 'tool-categorizeFiles'"
              :state="(part as any).state"
              :output="(part as any).output"
              :error="(part as any).error"
              @organize="(cats: any[]) => handleSend('帮我把文件按以下分类整理: ' + cats.map((c: any) => c.name + '→' + c.name + '文件夹').join(', '))"
              @retry="handleRetryTool(msg.id, 'tool-categorizeFiles', {})"
            />

            <!-- tool: moveFiles -->
            <BatchActionCard
              v-else-if="part.type === 'tool-moveFiles'"
              action="move"
              :state="(part as any).state"
              :files="(part as any).input?.files || []"
              :target-dir="(part as any).input?.targetDir"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

            <!-- tool: organizeFiles -->
            <BatchActionCard
              v-else-if="part.type === 'tool-organizeFiles'"
              action="move"
              :state="(part as any).state"
              :files="(part as any).input?.files || []"
              :target-dir="(part as any).input?.targetDir"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

            <!-- tool: deleteFiles -->
            <BatchActionCard
              v-else-if="part.type === 'tool-deleteFiles'"
              action="delete"
              :state="(part as any).state"
              :files="(part as any).input?.files || []"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

            <!-- tool: miaochuan -->
            <MiaochuanCard
              v-else-if="part.type === 'tool-miaochuan'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

            <!-- tool: directLinks -->
            <DirectLinksCard
              v-else-if="part.type === 'tool-directLinks'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
            />

            <!-- tool: guangyaMagnets -->
            <GuangyaMagnetsCard
              v-else-if="part.type === 'tool-guangyaMagnets'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

            <!-- tool: guangyaEmptyDirs -->
            <GuangyaEmptyDirsCard
              v-else-if="part.type === 'tool-guangyaEmptyDirs'"
              :state="(part as any).state"
              :input="(part as any).input"
              :output="(part as any).output"
              :error="(part as any).error"
              @confirm="handleConfirmAction(msg.id, pi)"
              @cancel="handleCancelAction(msg.id, pi)"
            />

          </template>
        </div>
      </div>

      </div>

      <!-- streaming indicator -->
      <div v-if="loading" class="ai-running-card">
        <LoadingIndicator />
        <span>{{ t('ai.agentThinking') }}</span>
      </div>
    </div>

    <!-- bottom bar -->
    <div class="ai-bottom">
      <div class="ai-suggestions">
        <Command :size="13" :stroke-width="1.8" />
        <span class="ai-suggestions-label">{{ t('ai.quickStart') }}</span>
        <button
          v-for="hint in DEFAULT_FOLLOWUPS"
          :key="hint"
          class="ai-hint"
          :disabled="!aiEnabled || loading"
          type="button"
          @click="handleSend(hint)"
        >
          {{ hint }}
        </button>
      </div>
      <BorderBeam class="ai-input-beam" :active="loading || composerFocused">
      <div class="ai-input-bar" :class="{ disabled: !aiEnabled }">
        <textarea
          v-model="inputText"
          class="ai-input"
          :placeholder="aiEnabled ? t('ai.inputPlaceholder') : t('ai.inputDisabledPlaceholder')"
          rows="1"
          :disabled="!aiEnabled || loading"
          @blur="composerFocused = false"
          @focus="composerFocused = true"
          @keydown="handleComposerKeydown"
        />
        <button
          v-if="loading"
          class="ai-stop-btn"
          type="button"
          :title="t('ai.stopGenerating')"
          @click="stop"
        ><Square :size="15" :fill="'currentColor'" /></button>
        <button
          v-else
          class="ai-send-btn"
          :disabled="!aiEnabled || !inputText.trim() || loading"
          type="button"
          @click="handleInputSend"
        ><Send :size="16" :stroke-width="2" /><span>{{ t('ai.send') }}</span></button>
      </div>
      </BorderBeam>
    </div>

    <!-- footer -->
    <div v-if="messages.length > 0" class="ai-footer">
      <button class="ai-clear-btn" type="button" :disabled="loading || !messages.length" @click="clear"><RotateCcw :size="13" /> {{ t('ai.clearCurrentConversation') }}</button>
      <span class="ai-msg-count">{{ requestCount }} {{ t('ai.requests') }} · {{ toolActivityCount }} {{ t('ai.toolActivities') }}</span>
    </div>
      </main>
      </BorderBeam>

      <aside class="ai-activity-panel">
        <div class="ai-activity-heading">
          <span>{{ t('ai.executionContext') }}</span>
          <Activity :size="16" />
        </div>
        <section class="ai-activity-status" :class="{ running: loading }">
          <span class="ai-activity-status-icon"><Activity v-if="loading" :size="16" /><ShieldCheck v-else :size="16" /></span>
          <div>
            <strong>{{ loading ? t('ai.agentRunning') : aiEnabled ? t('ai.workspaceReady') : t('ai.waitingConfig') }}</strong>
            <p>{{ loading ? t('ai.combiningResults') : aiEnabled ? t('ai.progressShownHere') : t('ai.configureToStart') }}</p>
          </div>
        </section>
        <section class="ai-activity-section">
          <span class="ai-rail-label">{{ t('ai.currentSession') }}</span>
          <div class="ai-session-metric"><span>{{ t('ai.userRequests') }}</span><b>{{ requestCount }}</b></div>
          <div class="ai-session-metric"><span>{{ t('ai.toolActivitiesLabel') }}</span><b>{{ toolActivityCount }}</b></div>
          <div class="ai-session-metric"><span>{{ t('ai.pendingActions') }}</span><b :class="{ warning: pendingApprovalCount }">{{ pendingApprovalCount }}</b></div>
        </section>
        <section v-if="recentToolActivities.length" class="ai-activity-section ai-activity-trail">
          <span class="ai-rail-label">{{ t('ai.recentActivity') }}</span>
          <div v-for="(activity, index) in recentToolActivities" :key="index" class="ai-activity-item">
            <span class="ai-activity-dot" :class="activity.state" />
            <span>{{ activity.title }}</span>
            <small>{{ activity.state === 'running' ? t('ai.running') : activity.state === 'approval' ? t('ai.pendingApproval') : activity.state === 'error' ? t('ai.incomplete') : t('ai.complete') }}</small>
          </div>
        </section>
        <section class="ai-activity-section ai-safety-note">
          <span class="ai-rail-label">{{ t('ai.safetyBoundary') }}</span>
          <p>{{ t('ai.safetyBoundaryDesc') }}</p>
          <span><ShieldCheck :size="13" /> {{ t('ai.noAutoModify') }}</span>
        </section>
        <button class="ai-activity-link" type="button" @click="handleSend('列出我已登录的所有网盘')">{{ t('ai.viewAvailableDrives') }} <ArrowUpRight :size="14" /></button>
      </aside>
    </div>
    <MediaAcquisitionTargetModal v-if="acquisitionRequest" :visible="acquisitionVisible" :request="acquisitionRequest" @update:visible="handleAcquisitionVisible" />
  </div>
</template>

<style scoped>
.ai-chat { --agent-accent: rgb(var(--primary-6)); --agent-ui-text: #fff; --agent-ui-muted: rgba(255,255,255,.78); display: flex; flex-direction: column; height: 100%; min-height: 0; background: radial-gradient(circle at 50% -180px, rgba(var(--primary-6), .10), transparent 420px); color: var(--color-text-1); }
.ai-workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 64px; padding: 0 48px; border-bottom: 1px solid var(--color-border-2); background: color-mix(in srgb, var(--color-bg-1) 92%, transparent); }
.ai-workspace-title { display: flex; gap: 10px; align-items: center; }
.ai-workspace-mark { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: #fff; background: var(--agent-accent); border-radius: 10px; box-shadow: 0 5px 18px rgba(var(--primary-6), .23); }
.ai-workspace-title strong, .ai-workspace-title span { display: block; }
.ai-workspace-title strong { font-size: 14px; letter-spacing: -.01em; }
.ai-workspace-title span { margin-top: 2px; font-size: 11px; color: var(--color-text-4); }
.ai-workspace-status { display: inline-flex; gap: 7px; align-items: center; font-size: 12px; color: var(--color-text-3); }
.ai-document-context { display: flex; align-items: center; gap: 8px; margin: 12px 34px 0; padding: 9px 12px; color: var(--color-text-3); font-size: 12px; background: var(--color-fill-1); border: 1px solid var(--color-border-2); border-radius: 8px; }
.ai-document-context > span { color: var(--color-text-4); }
.ai-document-context strong { overflow: hidden; color: var(--color-text-2); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ai-document-context small { margin-left: auto; color: var(--color-text-4); white-space: nowrap; }
.ai-status-pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--color-text-4); }
.ai-workspace-status.active .ai-status-pulse { background: var(--agent-accent); box-shadow: 0 0 0 4px rgba(var(--primary-6), .13); }

.ai-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; max-width: 620px; margin: auto; padding: 40px 24px; text-align: center; }
.ai-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 54px; height: 54px; margin-bottom: 18px; color: var(--agent-accent); background: rgba(var(--primary-6), .10); border: 1px solid rgba(var(--primary-6), .16); border-radius: 17px; }
.ai-empty-kicker { margin-bottom: 8px; color: var(--agent-accent); font-size: 10px; font-weight: 700; letter-spacing: .14em; }
.ai-empty-title { font-size: 25px; font-weight: 650; letter-spacing: -.04em; color: var(--color-text-1); margin-bottom: 8px; }
.ai-pro-badge, .ai-send-pro { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: linear-gradient(135deg, #f59e0b, #f97316); color: #fff; font-weight: 700; line-height: 1; letter-spacing: 0; }
.ai-pro-badge { height: 16px; padding: 0 6px; font-size: 10px; vertical-align: middle; margin-left: 4px; }
.ai-send-pro { height: 14px; padding: 0 5px; font-size: 9px; margin-left: 2px; }
.ai-empty-desc { max-width: 440px; font-size: 13px; line-height: 1.75; color: var(--color-text-3); margin-bottom: 22px; }
.ai-empty-prompts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.ai-empty-prompts button { padding: 8px 12px; color: var(--color-text-2); font: inherit; font-size: 12px; background: var(--color-fill-1); border: 1px solid var(--color-border-2); border-radius: 9px; cursor: pointer; transition: border-color .18s, color .18s, transform .18s; }
.ai-empty-prompts button:hover:not(:disabled) { color: var(--agent-accent); border-color: rgba(var(--primary-6), .4); transform: translateY(-1px); }
.ai-starter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; width: min(100%, 540px); text-align: left; }
.ai-starter-card { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 9px; min-height: 76px; padding: 12px; overflow: hidden; color: var(--color-text-2); font: inherit; text-align: left; background: color-mix(in srgb, var(--color-fill-1) 76%, transparent); border: 1px solid var(--color-border-2); border-radius: 13px; cursor: pointer; transition: transform .18s, border-color .18s, background .18s; }
.ai-starter-card:hover:not(:disabled) { border-color: rgba(var(--primary-6), .46); background: rgba(var(--primary-6), .08); transform: translateY(-2px); }
.ai-starter-card:disabled { opacity: .48; cursor: default; }
.ai-starter-card > span { display: inline-flex; grid-row: span 2; align-items: center; justify-content: center; width: 30px; height: 30px; color: rgb(var(--primary-5)); background: rgba(var(--primary-6), .12); border-radius: 9px; }
.ai-starter-card strong { align-self: end; overflow: hidden; font-size: 12px; font-weight: 650; white-space: nowrap; text-overflow: ellipsis; }
.ai-starter-card small { align-self: start; overflow: hidden; color: var(--color-text-4); font-size: 10px; white-space: nowrap; text-overflow: ellipsis; }
.ai-starter-card--film > span { color: #f4b84f; background: rgba(244, 184, 79, .12); }
.ai-starter-card--storage > span { color: #45c5a3; background: rgba(69, 197, 163, .12); }
.ai-starter-card--organize > span { color: #a78bfa; background: rgba(167, 139, 250, .12); }
.ai-empty-hints { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.ai-hint { padding: 6px 14px; font-size: 13px; color: var(--color-text-3); background: transparent; border: 1px solid rgba(var(--primary-6), 0.16); border-radius: 16px; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.ai-hint:hover { color: rgb(var(--primary-6)); background: rgba(var(--primary-6), 0.08); border-color: rgba(var(--primary-6), 0.42); }
.ai-hint:disabled { opacity: 0.45; cursor: default; }
.ai-hint:disabled:hover { color: var(--color-text-3); background: transparent; border-color: rgba(var(--primary-6), 0.16); }

.ai-messages { flex: 1; overflow-y: auto; padding: 28px max(48px, calc((100% - 920px) / 2)); display: flex; flex-direction: column; }
.ai-msg { display: flex; gap: 10px; width: min(100%, 790px); margin-bottom: 28px; }
.ai-msg:last-child { margin-bottom: 0; }
.ai-msg--user { align-self: flex-end; flex-direction: row-reverse; width: auto; max-width: min(78%, 620px); }
.ai-msg--assistant { align-self: flex-start; }
.ai-msg-avatar { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; margin-top: 2px; border-radius: 10px; flex-shrink: 0; }
.ai-msg--user .ai-msg-avatar { background: rgb(var(--primary-6)); color: #fff; }
.ai-msg--assistant .ai-msg-avatar { background: var(--color-fill-2); color: var(--color-text-3); }
.ai-msg-body { min-width: 0; flex: 1; }
.ai-msg--user .ai-msg-body { text-align: right; }
.ai-msg-label { margin: 0 0 7px; color: var(--color-text-4); font-size: 10px; font-weight: 700; letter-spacing: .1em; }
.ai-msg--user .ai-msg-label { display: none; }
.ai-msg-text { font-size: 14px; line-height: 1.7; color: var(--color-text-1); word-break: break-word; white-space: pre-wrap; }
.ai-msg--user .ai-msg-text { padding: 10px 14px; text-align: left; color: #fff; background: var(--agent-accent); border-radius: 15px 15px 4px 15px; box-shadow: 0 5px 18px rgba(var(--primary-6), .16); }
.ai-msg--assistant .ai-msg-text { padding: 2px 0; }
.ai-msg-text :deep(strong) { font-weight: 600; }
.ai-msg-text :deep(em) { font-style: italic; }
.ai-msg-text :deep(del) { text-decoration: line-through; opacity: 0.7; }
.ai-msg-text :deep(code) { padding: 1px 5px; font-size: 12px; background: var(--color-fill-2); border-radius: 3px; font-family: 'SF Mono', 'Menlo', 'Monaco', monospace; }
.ai-msg-text :deep(a) { color: rgb(var(--primary-6)); text-decoration: underline; }
.ai-msg-text :deep(a:hover) { opacity: 0.8; }
.ai-msg-text :deep(h1), .ai-msg-text :deep(h2), .ai-msg-text :deep(h3), .ai-msg-text :deep(h4) { margin: 8px 0 4px; font-weight: 600; line-height: 1.3; }
.ai-msg-text :deep(h1) { font-size: 18px; }
.ai-msg-text :deep(h2) { font-size: 16px; }
.ai-msg-text :deep(h3) { font-size: 15px; }
.ai-msg-text :deep(h4) { font-size: 14px; }
.ai-msg-text :deep(ul), .ai-msg-text :deep(ol) { padding-left: 20px; margin: 4px 0; }
.ai-msg-text :deep(li) { margin: 2px 0; }
.ai-msg-text :deep(blockquote) { margin: 6px 0; padding: 4px 12px; border-left: 3px solid rgb(var(--primary-6)); color: var(--color-text-2); background: var(--color-fill-1); border-radius: 0 4px 4px 0; }
.ai-msg-text :deep(hr) { border: 0; border-top: 1px solid var(--color-border-2); margin: 10px 0; }
.ai-msg-text :deep(table) { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.ai-msg-text :deep(th), .ai-msg-text :deep(td) { padding: 6px 10px; border: 1px solid var(--color-border-2); text-align: left; }
.ai-msg-text :deep(th) { background: var(--color-fill-1); font-weight: 600; }
.ai-msg-text :deep(pre) { margin: 6px 0; padding: 10px 12px; background: var(--color-fill-1); border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.5; }
.ai-msg-text :deep(pre code) { padding: 0; background: transparent; font-size: inherit; }

.ai-running-card { display: inline-flex; align-items: center; align-self: flex-start; gap: 8px; margin: 0 0 10px 40px; padding: 8px 11px; color: var(--color-text-3); font-size: 12px; background: var(--color-fill-1); border: 1px solid var(--color-border-2); border-radius: 10px; }
.ai-bottom { flex-shrink: 0; padding: 0 max(48px, calc((100% - 920px) / 2)) 14px; background: linear-gradient(to bottom, transparent, var(--color-bg-1) 24%); }
.ai-suggestions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 0; }
.ai-suggestions-label { font-size: 12px; color: var(--color-text-4); flex-shrink: 0; margin-right: 2px; }
.ai-input-beam { border-radius: 15px; }
.ai-input-bar { display: flex; align-items: flex-end; gap: 8px; padding: 7px 8px 7px 14px; background: var(--color-bg-1); border: 1px solid var(--color-border-2); border-radius: 15px; box-shadow: 0 10px 28px rgba(0, 0, 0, .06); transition: border-color .18s, box-shadow .18s; }
.ai-input-bar:focus-within { border-color: rgba(var(--primary-6), .65); box-shadow: 0 0 0 3px rgba(var(--primary-6), .11), 0 10px 28px rgba(0, 0, 0, .06); }
.ai-input { flex: 1; min-height: 26px; max-height: 120px; padding: 6px 0; resize: none; font-size: 14px; line-height: 1.55; color: var(--color-text-1); background: transparent; border: 0; outline: none; font-family: inherit; }
.ai-input::placeholder { color: var(--color-text-4); }
.ai-send-btn, .ai-stop-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 40px; height: 34px; padding: 0 12px; font-size: 12px; font-weight: 650; color: #fff; background: var(--agent-accent); border: 0; border-radius: 10px; cursor: pointer; font-family: inherit; transition: opacity .15s, transform .15s; }
.ai-stop-btn { background: var(--color-text-2); }
.ai-send-btn:hover { opacity: 0.9; }
.ai-send-btn:disabled { opacity: 0.4; cursor: default; }

.ai-footer { display: flex; align-items: center; justify-content: space-between; padding: 7px max(48px, calc((100% - 920px) / 2)) 10px; background: var(--color-bg-1); }
.ai-clear-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 12px; color: var(--color-text-4); background: transparent; border: 0; border-radius: 4px; cursor: pointer; font-family: inherit; }
.ai-clear-btn:hover { color: rgb(var(--danger-6)); background: var(--color-fill-2); }
.ai-msg-count { font-size: 12px; color: var(--color-text-4); }

@media (max-width: 720px) { .ai-workspace-header { min-height: 56px; padding: 0 16px; } .ai-workspace-title span { display: none; } .ai-document-context { margin: 10px 16px 0; } .ai-document-context small { display: none; } .ai-messages { padding: 20px 16px; } .ai-bottom, .ai-footer { padding-left: 16px; padding-right: 16px; } .ai-msg { width: 100%; } .ai-msg--user { max-width: 88%; } .ai-suggestions { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 9px; } .ai-hint { flex: 0 0 auto; } }

/* Agent workspace: navigation, conversation canvas, and live execution context. */
.ai-chat { background: linear-gradient(115deg, #070b17 0%, var(--color-bg-1) 42%, #071a1c 100%); }
.ai-workspace-grid { display: grid; grid-template-columns: 224px minmax(0, 1fr) 272px; height: 100%; min-height: 0; gap: 14px; overflow: hidden; }
.ai-task-rail, .ai-activity-panel { min-height: 0; padding: 20px 14px; background: color-mix(in srgb, var(--color-bg-1) 88%, #0a1020 12%); }
.ai-task-rail, .ai-workspace-main, .ai-activity-panel { border: 1px solid var(--app-glass-line); border-radius: 24px; background: var(--app-glass-panel); box-shadow: 0 20px 60px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.075); backdrop-filter: blur(24px) saturate(1.14); }
.ai-task-rail { display: flex; flex-direction: column; gap: 20px; overflow-y: auto; }
.ai-activity-panel { display: flex; flex-direction: column; gap: 18px; overflow-y: auto; }
.ai-rail-brand { display: flex; align-items: center; gap: 9px; padding: 3px 8px; color: var(--color-text-3); font-size: 9px; font-weight: 700; line-height: 1.25; letter-spacing: .12em; }
.ai-rail-brand b { color: var(--agent-accent); font-weight: 750; }
.ai-rail-brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; color: #fff; border-radius: 10px; background: linear-gradient(145deg, rgb(var(--primary-5)), #8b5cf6); box-shadow: 0 8px 20px rgba(var(--primary-6), .28); }
.ai-new-task { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 36px; color: #fff; font: inherit; font-size: 12px; font-weight: 650; background: linear-gradient(110deg, rgb(var(--primary-6)), #735cff); border: 0; border-radius: 10px; cursor: pointer; box-shadow: 0 10px 20px rgba(var(--primary-6), .17); transition: transform .18s, filter .18s; }
.ai-new-task:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
.ai-new-task:disabled { cursor: default; opacity: .5; }
.ai-rail-section { display: flex; flex-direction: column; gap: 3px; }
.ai-rail-label { display: flex; align-items: center; gap: 5px; margin: 0 8px 7px; color: var(--color-text-4); font-size: 10px; font-weight: 700; letter-spacing: .11em; }
.ai-rail-action, .ai-history-item { display: flex; align-items: center; gap: 9px; width: 100%; min-width: 0; padding: 8px 9px; color: var(--color-text-3); font: inherit; font-size: 12px; text-align: left; background: transparent; border: 0; border-radius: 8px; cursor: pointer; transition: color .16s, background .16s; }
.ai-rail-action:hover:not(:disabled), .ai-history-item:hover:not(:disabled) { color: var(--color-text-1); background: rgba(var(--primary-6), .09); }
.ai-rail-action:disabled, .ai-history-item:disabled { opacity: .45; cursor: default; }
.ai-rail-history { min-height: 0; margin-top: 4px; }
.ai-history-item { justify-content: space-between; overflow: hidden; color: var(--color-text-4); }
.ai-history-item > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ai-history-item.active { color: var(--color-text-1); background: rgba(var(--primary-6), .12); }
.ai-history-item i { display: inline-flex; flex: 0 0 auto; align-items: center; padding: 3px; color: var(--color-text-4); font-style: normal; border-radius: 5px; opacity: 0; }
.ai-history-item:hover i, .ai-history-item.active i { opacity: .9; }
.ai-history-item i:hover { color: #f87171; background: rgba(248, 113, 113, .12); }
.ai-rail-memories { min-height: 0; margin-top: 8px; }
.ai-memory-item { display: flex; align-items: flex-start; gap: 5px; padding: 5px 8px; color: var(--color-text-4); font-size: 10px; line-height: 1.45; }
.ai-memory-item > span { display: -webkit-box; flex: 1; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ai-memory-item b { display: block; color: var(--color-text-3); font-size: 10px; font-weight: 600; }
.ai-memory-item button { display: inline-flex; flex: 0 0 auto; padding: 2px; color: var(--color-text-4); background: transparent; border: 0; border-radius: 4px; cursor: pointer; opacity: .7; }
.ai-memory-item button:hover { color: #f87171; background: rgba(248, 113, 113, .12); opacity: 1; }
.ai-rail-foot { display: flex; align-items: center; gap: 7px; margin-top: auto; padding: 9px 8px 1px; color: var(--color-text-4); font-size: 11px; }
.ai-rail-foot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-text-4); }
.ai-rail-foot-dot.active { background: #34d399; box-shadow: 0 0 0 4px rgba(52, 211, 153, .10); }

.ai-workspace-beam { min-width: 0; min-height: 0; border-radius: 24px; }
.ai-workspace-beam > .ai-workspace-main { height: 100%; }
.ai-workspace-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--app-glass-panel); }
.ai-workspace-header { min-height: 70px; padding: 0 34px; border-bottom-color: color-mix(in srgb, var(--color-border-2) 80%, transparent); background: color-mix(in srgb, var(--color-bg-1) 68%, transparent); backdrop-filter: blur(18px); }
.ai-workspace-mark { width: 34px; height: 34px; border-radius: 11px; background: linear-gradient(145deg, rgb(var(--primary-5)), #8b5cf6); }
.ai-workspace-title strong { font-size: 15px; }
.ai-workspace-title span { font-size: 11px; }
.ai-workspace-status { padding: 6px 9px; background: var(--color-fill-1); border: 1px solid var(--color-border-2); border-radius: 999px; }
.ai-status-orb { width: 16px; height: 16px; flex-basis: 16px; transform: scale(.53); margin: -7px; }
.ai-messages { padding: 30px clamp(28px, 5vw, 76px); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.ai-message-list { display: flex; flex-direction: column; width: 100%; }
:global(#xbybody .ai-workspace-main .ai-msg-body) { color: inherit !important; background: transparent !important; border-color: transparent !important; box-shadow: none !important; backdrop-filter: none !important; }
.ai-msg { width: min(100%, 820px); gap: 8px; margin-bottom: 24px; }
.ai-msg-avatar { width: 28px; height: 28px; border-radius: 9px; }
.ai-msg--assistant { padding: 2px 0; }
.ai-msg--assistant .ai-msg-body { max-width: 100%; }
.ai-msg--user { align-self: flex-end; max-width: min(72%, 600px); }
.ai-msg--user .ai-msg-body { flex: 0 1 auto; max-width: 100%; }
.ai-msg--user .ai-msg-avatar { color: var(--color-text-2); background: var(--color-fill-2); box-shadow: none; }
.ai-msg--user .ai-msg-text { display: inline-block; max-width: 100%; padding: 10px 13px; color: var(--color-text-1); background: var(--color-fill-2); border: 1px solid color-mix(in srgb, var(--color-border-2) 80%, transparent); border-radius: 12px 12px 4px 12px; box-shadow: none; }
.ai-msg-text { font-size: 15px; line-height: 1.72; letter-spacing: .002em; }
.ai-msg--assistant .ai-msg-text { padding: 0; color: var(--color-text-1); }
.ai-msg-text :deep(h1), .ai-msg-text :deep(h2), .ai-msg-text :deep(h3), .ai-msg-text :deep(h4) { margin-top: 18px; margin-bottom: 8px; letter-spacing: -.012em; }
.ai-msg-text :deep(h1) { font-size: 20px; }
.ai-msg-text :deep(h2) { font-size: 17px; }
.ai-msg-text :deep(h3) { font-size: 15px; }
.ai-msg-text :deep(p) { margin: 0 0 10px; }
.ai-msg-text :deep(ul), .ai-msg-text :deep(ol) { margin: 8px 0 12px; padding-left: 21px; }
.ai-msg-text :deep(li) { margin: 4px 0; }
.ai-msg-text :deep(code) { padding: 2px 5px; color: var(--color-text-2); background: color-mix(in srgb, var(--color-fill-2) 85%, transparent); border-radius: 5px; font-size: .88em; }
.ai-msg-text :deep(blockquote) { margin: 12px 0; padding: 8px 12px; border-left: 2px solid rgb(var(--primary-5)); color: var(--color-text-2); background: color-mix(in srgb, var(--color-fill-1) 72%, transparent); border-radius: 0 7px 7px 0; }
.ai-msg-text :deep(table) { margin: 12px 0; overflow: hidden; border: 1px solid var(--color-border-2); border-radius: 8px; font-size: 13px; }
.ai-msg-text :deep(th), .ai-msg-text :deep(td) { padding: 8px 10px; border-width: 0 0 1px; border-color: var(--color-border-2); }
.ai-msg-text :deep(tr:last-child td) { border-bottom: 0; }
.ai-msg-text :deep(th) { color: var(--color-text-2); background: color-mix(in srgb, var(--color-fill-2) 72%, transparent); }
.ai-msg-text :deep(pre) { margin: 12px 0; padding: 12px 14px; border: 1px solid var(--color-border-2); border-radius: 8px; background: color-mix(in srgb, var(--color-fill-2) 72%, transparent); }
.ai-running-card { margin: 0 0 14px 39px; padding: 9px 12px; border-color: var(--color-border-2); border-radius: 9px; background: color-mix(in srgb, var(--color-fill-1) 84%, transparent); }
.ai-bottom { padding: 0 clamp(28px, 5vw, 76px) 16px; background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-bg-1) 96%, #090d17 4%) 32%); }
.ai-suggestions { padding: 8px 0 10px; }
.ai-hint { padding: 5px 10px; color: var(--color-text-4); font-size: 11px; border-color: color-mix(in srgb, var(--color-border-2) 88%, transparent); border-radius: 7px; }
.ai-hint:hover:not(:disabled) { color: rgb(var(--primary-5)); background: color-mix(in srgb, rgb(var(--primary-6)) 7%, transparent); border-color: color-mix(in srgb, rgb(var(--primary-6)) 40%, var(--color-border-2)); }
.ai-input-bar { min-height: 56px; padding: 9px 10px 9px 16px; border-color: color-mix(in srgb, var(--color-border-2) 92%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--color-fill-1) 92%, var(--color-bg-1) 8%); box-shadow: none; }
.ai-input-bar:focus-within { border-color: color-mix(in srgb, rgb(var(--primary-6)) 65%, var(--color-border-2)); box-shadow: 0 0 0 3px color-mix(in srgb, rgb(var(--primary-6)) 12%, transparent); }
.ai-input { padding: 7px 0; font-size: 15px; line-height: 1.5; }
.ai-send-btn, .ai-stop-btn { height: 37px; border-radius: 8px; }
.ai-send-btn { background: rgb(var(--primary-6)); }
.ai-send-btn:hover:not(:disabled) { background: rgb(var(--primary-5)); opacity: 1; transform: translateY(-1px); }
.ai-footer { padding: 7px clamp(28px, 4vw, 64px) 11px; background: transparent; }

.ai-activity-heading { display: flex; align-items: center; justify-content: space-between; padding: 3px 6px 0; color: var(--color-text-2); font-size: 12px; font-weight: 650; }
.ai-activity-heading svg { color: var(--agent-accent); }
.ai-activity-status { display: flex; gap: 10px; padding: 13px; border: 1px solid var(--color-border-2); border-radius: 12px; background: var(--color-fill-1); }
.ai-activity-status.running { border-color: rgba(var(--primary-6), .34); background: rgba(var(--primary-6), .07); }
.ai-activity-status-icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 29px; height: 29px; color: #34d399; background: rgba(52, 211, 153, .10); border-radius: 9px; }
.ai-activity-status.running .ai-activity-status-icon { color: rgb(var(--primary-5)); background: rgba(var(--primary-6), .12); animation: ai-status-spin 1.5s linear infinite; }
.ai-activity-status strong { display: block; margin: 1px 0 4px; color: var(--color-text-1); font-size: 12px; }
.ai-activity-status p, .ai-safety-note p { margin: 0; color: var(--color-text-4); font-size: 11px; line-height: 1.55; }
.ai-activity-section { padding: 15px 0; border-top: 1px solid var(--color-border-2); }
.ai-session-metric { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; color: var(--color-text-3); font-size: 12px; }
.ai-session-metric b { color: var(--color-text-1); font-size: 13px; }
.ai-session-metric b.warning { color: #f59e0b; }
.ai-activity-trail { min-height: 0; padding-bottom: 3px; }
.ai-activity-item { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 7px; align-items: center; padding: 6px 8px; color: var(--color-text-3); font-size: 11px; }
.ai-activity-item > span:nth-child(2) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ai-activity-item small { color: var(--color-text-4); font-size: 10px; }
.ai-activity-dot { width: 6px; height: 6px; border-radius: 50%; background: #34d399; }
.ai-activity-dot.running { background: rgb(var(--primary-5)); box-shadow: 0 0 0 4px rgba(var(--primary-6), .12); animation: ai-activity-pulse 1.25s ease-in-out infinite; }
.ai-activity-dot.approval { background: #f59e0b; }
.ai-activity-dot.error { background: #fb7185; }
.ai-safety-note { margin-top: auto; padding: 14px; border: 1px solid color-mix(in srgb, var(--color-border-2) 84%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--color-fill-1) 72%, transparent); }
.ai-safety-note .ai-rail-label { margin-left: 0; }
.ai-safety-note > span { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; color: #34d399; font-size: 11px; }
.ai-activity-link { display: inline-flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px; color: rgb(var(--primary-5)); font: inherit; font-size: 12px; background: transparent; border: 0; cursor: pointer; }
.ai-activity-link:hover { text-decoration: underline; }

/* Keep navigation labels and controls readable on both workspace themes. */
.ai-rail-label { font-size: 13px; color: var(--agent-ui-text); }
.ai-rail-action, .ai-history-item { font-size: 13px; color: var(--agent-ui-text); }
.ai-rail-action:disabled { color: var(--agent-ui-text); opacity: 1; }
.ai-rail-brand, .ai-rail-foot, .ai-activity-heading, .ai-session-metric, .ai-activity-link, .ai-suggestions-label, .ai-clear-btn { color: var(--agent-ui-text); }
.ai-rail-brand, .ai-rail-foot, .ai-activity-heading, .ai-session-metric, .ai-activity-link, .ai-empty-prompts button, .ai-hint, .ai-new-task, .ai-send-btn, .ai-stop-btn { font-size: 13px; }
.ai-memory-item, .ai-memory-item b, .ai-activity-item, .ai-activity-item small, .ai-activity-status p, .ai-safety-note p { color: var(--agent-ui-muted); font-size: 12px; }
.ai-workspace-title span, .ai-workspace-status, .ai-empty-desc, .ai-starter-card small { color: var(--agent-ui-muted); font-size: 13px; }
@keyframes ai-status-spin { to { transform: rotate(360deg); } }
@keyframes ai-activity-pulse { 50% { opacity: .45; transform: scale(.8); } }

@media (max-width: 1180px) { .ai-workspace-grid { grid-template-columns: 190px minmax(0, 1fr); } .ai-activity-panel { display: none; } }
@media (min-width: 1181px) { .ai-workspace-grid.without-task-rail { grid-template-columns: minmax(0, 1fr) 272px; } }
@media (max-width: 1180px) { .ai-workspace-grid.without-task-rail { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 820px) { .ai-workspace-grid { grid-template-columns: 1fr; } .ai-task-rail { display: none; } .ai-workspace-header { padding: 0 20px; } .ai-messages { padding: 22px 20px; } .ai-bottom, .ai-footer { padding-left: 20px; padding-right: 20px; } }
@media (max-width: 520px) { .ai-starter-grid { grid-template-columns: 1fr; } }
</style>

<style>
body:not([arco-theme='dark']) #xbybody .ai-chat {
  --agent-ui-text: #111827;
  --agent-ui-muted: #374151;
}

body:not([arco-theme='dark']) #xbybody .ai-task-rail {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .ai-workspace-main {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .ai-activity-panel {
  border-color: var(--color-border-2);
  background: var(--color-bg-1);
  box-shadow: none;
  backdrop-filter: none;
}

body:not([arco-theme='dark']) #xbybody .ai-bottom {
  background: linear-gradient(to bottom, transparent, var(--color-bg-1) 32%) !important;
}
</style>
