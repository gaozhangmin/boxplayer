import { ref, nextTick } from 'vue'
import { z } from 'zod'
import Config from '../../config'
import { getAIConfig } from '../../utils/bookAI'
import { isBoxPlayerCloudProvider, mapBoxPlayerCloudAIError } from '../../utils/boxplayerCloudAI'
import { isLeakedAgentContext, runBoxPlayerAgent } from '../../services/agent'
import { beginAiSearchV1Audit, collectAiSearchStorageStats, confirmAiSearchV1Write, finishAiSearchV1Audit, getAgentV1Workflow, recordAiSearchV1Evidence } from '../../services/agent/agentV1AuditClient'
import { buildBoxPlayerCapabilityKnowledge, BOXPLAYER_CAPABILITIES, getBoxPlayerCapability } from '../../services/agent/boxplayerCapabilities'
import { buildWorkspaceMemoryContext, forgetWorkspaceMemory, listWorkspaceMemories, rememberWorkspaceFact, type WorkspaceMemory } from '../../services/agent/workspaceMemory'
import useAppStore from '../../store/appstore'
import { searchAllDrives } from '../../utils/globalSearch'
import type { GlobalSearchResult } from '../../utils/globalSearch'
import type { ChatMessage, MessagePart, FileResult, LinkResult } from './types'
import AliShare from '../../aliapi/share'
import AliFileCmd from '../../aliapi/filecmd'
import UserDAL from '../../user/userdal'
import { parseQuarkShareLink } from '../../quark/share'
import { TMDB_BASE_URL, TMDB_BASE_URL_PROXY, tmdbImageUrl } from '../../utils/tmdb'
import { normalizeMiaochuanPayload } from '../../utils/drive-tools/miaochuan'
import { apiGuangyaImportMiaochuan } from '../../guangya/miaochuan'
import { driveToolDriveIdForPlatform, driveToolPlatformMatches, driveToolRootIdFor, exportDirectLinks, normalizeDriveToolDriveId, normalizeDriveToolPlatform, type DirectLinkFormat } from '../../utils/drive-tools/directLinks'
import { extractMagnetLinks, importGuangyaMagnets } from '../../utils/drive-tools/magnet'
import { deleteDriveEmptyDirs, scanDriveEmptyDirs } from '../../utils/drive-tools/emptyDirs'
import { scanDriveDuplicates, type DuplicateDriveTarget, type DuplicateScanMode } from '../../utils/drive-tools/duplicates'
import { scanDriveLargeFiles, type LargeFileScanMode } from '../../utils/drive-tools/largeFiles'
import { flattenDriveToolFolders, moveDriveToolFiles, type OrganizeFileItem } from '../../utils/drive-tools/organize'
import { buildMediaOrganizePlan, executeMediaOrganizePlan } from '../../utils/drive-tools/mediaOrganize'
import { getWebDavConnections } from '../../utils/webdavClient'
import { searchPanHubStream, type PanHubMergedLinks } from '../../utils/panHubSearch'
import AliFile from '../../aliapi/file'
import DriveFile from '../../drive/file'
import { createBookAISettings } from '../../utils/bookAI'
import { getAIProvider } from '../../services/ai/providers'
import { canUseSemanticEmbeddings } from '../../services/ai/embeddingPolicy'
import { askIndexedDocument, indexDocumentLocally } from '../../services/documents'
import { formatProviderCapabilities, getProviderCapabilities, normalizeProviderPlatform, type ProviderCapabilityManifest } from '../../services/agent/providerCapabilities'
import { getMediaAcquisitionCapability, formatMediaAcquisitionCapability } from '../../services/mediaAcquisition/capabilities'
import { unsupportedAgentToolMessage } from '../../services/agent/agentToolCapabilities'
import { listMediaAcquisitionNotifications, listMediaAcquisitionRuns, listMediaAcquisitionTracking, runMediaAcquisitionTrackingPatrol } from '../../services/mediaAcquisition/client'

function getBoxPlayerAPIBaseURL(): string {
  return Config.BOXPLAYER_API_URL.replace(/\/+$/, '')
}

const CHAT_KEY = 'ai_search_chat_history_v2'
const CHAT_SESSION_KEY = 'ai_search_agent_session_v1'
const CHAT_THREADS_KEY = 'ai_search_chat_threads_v1'
const ACTIVE_THREAD_KEY = 'ai_search_active_thread_v1'

const INTERNAL_AGENT_TEXT_MARKERS = [
  'please always be enthusiastic and maintain a smooth conversation',
  'remember that the number of tool calls has a maximum limit',
  'always output all function calls required to complete the user',
  'you must follow the tool call guidelines',
  '你的记忆没有开启，这意味着你必须将需要记忆的信息存储到对话中',
  '## boxplayer 功能知识库',
  '## 当前已登录网盘的运行时能力'
]

function isInternalAgentText(text: string): boolean {
  const value = text.toLocaleLowerCase()
  return isLeakedAgentContext(text) || INTERNAL_AGENT_TEXT_MARKERS.some(marker => value.includes(marker))
}

function inferExplicitPlatforms(text: string): string[] {
  const value = text.toLocaleLowerCase()
  const matches: Array<[string, RegExp]> = [
    ['aliyun', /阿里云盘|aliyun|alipan/], ['baidu', /百度网盘|baidu/], ['115', /115网盘|115 云盘/], ['cloud123', /123网盘|123 云盘/],
    ['google', /google drive|google 云盘|谷歌云盘/], ['onedrive', /onedrive/], ['dropbox', /dropbox/], ['box', /box 网盘/], ['pikpak', /pikpak/], ['quark', /夸克网盘|quark/]
  ]
  return matches.filter(([, pattern]) => pattern.test(value)).map(([platform]) => platform)
}

function isStorageAnalysisRequest(text: string): boolean {
  return /存储空间|占用空间|空间分析|清理空间/.test(text)
}

function isLargeFileRequest(text: string): boolean {
  return /大文件/.test(text)
}

function isDuplicateFileRequest(text: string): boolean {
  return /重复文件|查找重复|查重|去重/.test(text) && !/(?:删除|移入回收站).*(?:重复|副本)/.test(text)
}

function isCategorizeFilesRequest(text: string): boolean {
  return /^(?:帮我|请)?(?:整理|分类)(?:一下)?文件[。！!]?$/u.test(text.trim())
}

function isEmptyDirectoryRequest(text: string): boolean {
  return /扫描空目录|查找空目录|清理空目录/.test(text)
}

function isDuplicateCardDeleteRequest(text: string): boolean {
  return /^删除以下\d+个重复文件\s*:/u.test(text.trim())
}

type SelectedDriveTarget = { userId: string; driveId: string; platform: string }

function parseSelectedDriveTargets(text: string): SelectedDriveTarget[] {
  const labelIndex = text.search(/selectedDriveTargets\s*:/i)
  if (labelIndex < 0) return []
  const arrayStart = text.indexOf('[', labelIndex)
  if (arrayStart < 0) return []
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = arrayStart; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth !== 0) continue
      try {
        const parsed = JSON.parse(text.slice(arrayStart, index + 1))
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.userId === 'string' && typeof item.driveId === 'string' && typeof item.platform === 'string') : []
      } catch {
        return []
      }
    }
  }
  return []
}

export interface WorkspaceDocumentContext {
  file: any
  userId: string
}

export interface WorkspaceChatThread {
  id: string
  title: string
  messages: ChatMessage[]
  documentContext?: WorkspaceDocumentContext
  updatedAt: number
}

function getSessionId(): string {
  try {
    const saved = localStorage.getItem(CHAT_SESSION_KEY)
    if (saved) return saved
    const id = crypto.randomUUID()
    localStorage.setItem(CHAT_SESSION_KEY, id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sanitizePersistedMessages(parsed.filter((m: any) => m?.id && Array.isArray(m.parts)))
  } catch {
    return []
  }
}

function redactPersistedChatValue(value: any, parentKey = ''): any {
  if (Array.isArray(value)) return value.map(item => redactPersistedChatValue(item, parentKey))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /(?:[?&](?:token|signature|expires|x-oss-signature|authorization)=|^https?:\/\/[^\s]+(?:aliyuncs|googleusercontent|dropboxusercontent))/i.test(value)) return '[已脱敏的临时直链]'
    if (typeof value === 'string') return value.replace(/((?:提取码|密码|password|pwd)\s*[:：]?\s*)\S+/gi, '$1[已脱敏]')
    return value
  }
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|secret|authorization|cookie|proxy_headers/i.test(key)) output[key] = '[已脱敏]'
    else if (key === 'text' && parentKey === 'output' && (value as any).total !== undefined && /https?:\/\//i.test(String(item || ''))) output[key] = '[直链仅在本次会话中显示]'
    else output[key] = redactPersistedChatValue(item, key)
  }
  return output
}

function sanitizePersistedMessages(messages: ChatMessage[]): ChatMessage[] {
  const redacted = redactPersistedChatValue(messages) as ChatMessage[]
  return redacted.map(message => ({
    ...message,
    parts: message.parts.filter(part => message.role !== 'assistant' || part.type !== 'text' || !isInternalAgentText(part.text))
  })).filter(message => message.parts.length > 0)
}

function createThread(documentContext?: WorkspaceDocumentContext): WorkspaceChatThread {
  const name = documentContext?.file?.name || documentContext?.file?.file_name
  return { id: crypto.randomUUID(), title: name ? `分析 · ${name}` : '新对话', messages: [], documentContext, updatedAt: Date.now() }
}

function loadThreads(): WorkspaceChatThread[] {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const threads = parsed.filter((thread: any) => thread?.id && Array.isArray(thread.messages)).map((thread: any) => ({ ...thread, messages: sanitizePersistedMessages(thread.messages) }))
        if (threads.length) return threads
      }
    }
    const legacy = loadHistory()
    return legacy.length ? [{ ...createThread(), title: '历史对话', messages: legacy }] : [createThread()]
  } catch {
    return [createThread()]
  }
}

export function useAISearchChat() {
  const appStore = useAppStore()
  const threads = ref<WorkspaceChatThread[]>(loadThreads())
  const activeThreadId = ref(localStorage.getItem(ACTIVE_THREAD_KEY) || threads.value[0].id)
  if (!threads.value.some(thread => thread.id === activeThreadId.value)) activeThreadId.value = threads.value[0].id
  const activeThread = () => threads.value.find(thread => thread.id === activeThreadId.value) || threads.value[0]
  const messages = ref<ChatMessage[]>(activeThread().messages)
  const loading = ref(false)
  const memories = ref<WorkspaceMemory[]>([])
  const activeDocument = ref<WorkspaceDocumentContext | null>(activeThread().documentContext || null)
  let sessionId = activeThread().id || getSessionId()
  let abortController: AbortController | null = null
  let activeRun = 0

  async function refreshMemories() {
    memories.value = await listWorkspaceMemories().catch(() => [])
  }

  async function removeMemory(id: string) {
    if (await forgetWorkspaceMemory(id).catch(() => false)) await refreshMemories()
  }

  function setDocumentContext(context: WorkspaceDocumentContext | null) {
    if (!context) return
    const current = activeDocument.value
    if (current?.userId === context.userId && current.file?.file_id === context.file?.file_id && current.file?.content_hash === context.file?.content_hash && current.file?.etag === context.file?.etag) return
    const thread = createThread(context)
    threads.value = [thread, ...threads.value]
    activeThreadId.value = thread.id
    messages.value = thread.messages
    activeDocument.value = context
    sessionId = thread.id
    persistThreads()
  }

  function persistThreads() {
    const thread = activeThread()
    thread.messages = messages.value.slice(-50)
    thread.documentContext = activeDocument.value || undefined
    thread.updatedAt = Date.now()
    if (thread.title === '新对话' && messages.value[0]?.role === 'user') thread.title = String((messages.value[0].parts[0] as any)?.text || '新对话').slice(0, 30)
    threads.value = [...threads.value].sort((a, b) => b.updatedAt - a.updatedAt)
    try {
      localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(threads.value.map(thread => ({ ...thread, messages: sanitizePersistedMessages(thread.messages) }))))
      localStorage.setItem(ACTIVE_THREAD_KEY, activeThreadId.value)
    } catch {}
  }

  function saveCurrentHistory(_nextMessages: ChatMessage[]) { persistThreads() }

  function openConversation(id: string) {
    if (loading.value || id === activeThreadId.value) return
    const thread = threads.value.find(item => item.id === id)
    if (!thread) return
    activeThreadId.value = thread.id
    messages.value = thread.messages
    activeDocument.value = thread.documentContext || null
    sessionId = thread.id
    persistThreads()
  }

  function newConversation() {
    if (loading.value) return
    const thread = createThread()
    threads.value = [thread, ...threads.value]
    activeThreadId.value = thread.id
    messages.value = []
    activeDocument.value = null
    sessionId = thread.id
    persistThreads()
  }

  function deleteConversation(id: string) {
    if (loading.value) return
    const remaining = threads.value.filter(thread => thread.id !== id)
    threads.value = remaining.length ? remaining : [createThread()]
    if (activeThreadId.value === id) {
      const next = threads.value[0]
      activeThreadId.value = next.id
      messages.value = next.messages
      activeDocument.value = next.documentContext || null
      sessionId = next.id
    }
    persistThreads()
  }

  function getActiveDocumentDetails() {
    const context = activeDocument.value
    if (!context?.file?.file_id) return null
    const file = context.file
    const fileName = file.name || file.file_name || '文档'
    const driveId = file.drive_id || ''
    const version = file.content_hash || file.etag || `${file.size || 0}:${file.updated_at || file.time || ''}`
    return {
      ...context,
      fileName,
      driveId,
      sourceId: `document:${context.userId}:${driveId}:${file.file_id}:${version}`
    }
  }

  void refreshMemories()

  function appendPart(msgId: string, part: MessagePart) {
    const msg = messages.value.find(m => m.id === msgId)
    if (msg) msg.parts = [...msg.parts, part]
  }

  function removePart(msgId: string, part: MessagePart) {
    const msg = messages.value.find(m => m.id === msgId)
    if (msg) msg.parts = msg.parts.filter(item => item !== part)
  }

  function getMatchKey(input: any): string | null {
    if (input?.keyword) return `k:${input.keyword}`
    if (input?.url) return `u:${input.url}`
    return null
  }

  function updateToolPart(msgId: string, toolType: string, input: any, fn: (part: any) => void) {
    const msg = messages.value.find(m => m.id === msgId)
    if (!msg) return
    const parts = [...msg.parts]
    const inputKey = getMatchKey(input)
    let idx = -1
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (p.type !== toolType) continue
      if (inputKey) {
        if (getMatchKey((p as any).input) === inputKey) { idx = i; break }
      } else {
        idx = i; break
      }
    }
    if (idx >= 0) {
      const updated = { ...parts[idx] }
      fn(updated)
      parts[idx] = updated
      msg.parts = parts
    }
  }

  function scrollBottom() {
    nextTick(() => {
      const el = document.querySelector('.ai-messages')
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  // scan drives by searching common patterns, never touches media servers
  async function scanAllDrives(platforms?: string[], selectedTargets: SelectedDriveTarget[] = []): Promise<GlobalSearchResult[]> {
    const targets = await resolveScanTargets(platforms, selectedTargets)
    const data = await scanDriveLargeFiles(targets, 'size', { customSizeMB: 0, maxDirs: 2000, maxFiles: 20_000 })
    if (data.failedDirs) throw new Error(data.errors.slice(0, 2).join('；') || '无法完整读取目标网盘')
    if (data.truncated) throw new Error('全盘扫描超过 2000 个目录或 20000 个文件，已拒绝将不完整结果作为存储分析。请缩小网盘或目录范围后重试。')
    return data.files.map(file => {
      const token = UserDAL.GetUserToken(file.userId)
      return {
        id: `${file.driveId}:${file.userId}:${file.fileId}`,
        name: file.name,
        ext: file.ext,
        size: file.size,
        isDir: false,
        file_id: file.fileId,
        parent_file_id: file.parentFileId,
        drive_id: file.driveId,
        user_id: file.userId,
        source: 'cloud' as const,
        provider: token?.tokenfrom || file.driveId,
        providerName: token?.nick_name || token?.user_name || token?.name || file.driveId,
        userName: token?.nick_name || token?.user_name || token?.name || file.userId,
        icon: file.icon,
        path: file.path
      }
    })
  }

  async function getUserIdForPlatform(platform: 'aliyun' | 'quark' | 'guangya', selectedTargets: SelectedDriveTarget[] = []): Promise<{ userId: string; driveId: string } | null> {
    const users = await UserDAL.GetUserListFromDB()
    const matches = users.filter(u => u?.user_id && u?.access_token && u.tokenfrom === platform)
    const selected = selectedTargets.filter(target => driveToolPlatformMatches(platform, target.platform))
    if (selected.length === 1) {
      const user = matches.find(item => item.user_id === selected[0].userId)
      if (!user) return null
      const expectedDriveId = platform === 'aliyun' ? selected[0].driveId : driveToolDriveIdForPlatform(platform, user.default_drive_id)
      if (selected[0].driveId !== expectedDriveId) return null
      return { userId: user.user_id, driveId: expectedDriveId }
    }
    if (matches.length !== 1) return null
    const u = matches[0]
    if (platform === 'quark') return { userId: u.user_id, driveId: 'quark' }
    if (platform === 'guangya') return { userId: u.user_id, driveId: 'guangya' }
    if (platform === 'aliyun') return { userId: u.user_id, driveId: u.default_drive_id || '' }
    return null
  }

  function defaultRootForDrive(driveId: string): string {
    return driveToolRootIdFor(driveId)
  }

  async function resolveDriveForTool(args: any, selectedTargets: SelectedDriveTarget[] = []): Promise<{ userId: string; driveId: string; rootId: string } | null> {
    if (args.userId && args.driveId) {
      const driveId = normalizeDriveToolDriveId(args.driveId)
      if (!selectedTargets.some(target => target.userId === args.userId && normalizeDriveToolDriveId(target.driveId) === driveId)) return null
      const users = await UserDAL.GetUserListFromDB()
      const user = users.find(item => item?.user_id === args.userId && item?.access_token)
      if (!user) return null
      const validDriveIds = user.tokenfrom === 'aliyun'
        ? [user.default_drive_id, user.resource_drive_id, user.backup_drive_id]
        : [driveToolDriveIdForPlatform(user.tokenfrom || '', user.default_drive_id)]
      if (!validDriveIds.includes(driveId)) return null
      const rootId = args.rootId || defaultRootForDrive(driveId)
      if (args.rootId && args.rootId !== defaultRootForDrive(driveId)) return null
      return { userId: user.user_id, driveId, rootId }
    }
    const users = await UserDAL.GetUserListFromDB()
    const matches = users.filter((u: any) => u?.user_id && u?.access_token && driveToolPlatformMatches(u.tokenfrom || 'aliyun', args.platform))
    if (matches.length !== 1) return null
    const user = matches[0]
    const driveId = user.tokenfrom === 'aliyun'
      ? (user.resource_drive_id || user.backup_drive_id || user.default_drive_id)
      : driveToolDriveIdForPlatform(user.tokenfrom || '', user.default_drive_id)
    if (!driveId) return null
    return { userId: user.user_id, driveId, rootId: args.rootId || defaultRootForDrive(driveId) }
  }

  async function buildDriveTargetsForTool(platforms?: string[]): Promise<DuplicateDriveTarget[]> {
    const users = await UserDAL.GetUserListFromDB()
    const targets: DuplicateDriveTarget[] = []
    const shouldUsePlatform = (platform: string) => !platforms?.length || platforms.some((requested: string) => driveToolPlatformMatches(platform, requested))
    for (const user of users) {
      const platform = user?.tokenfrom || 'aliyun'
      if (!user?.user_id || !user?.access_token || !shouldUsePlatform(platform)) continue
      const name = user.nick_name || user.user_name || user.name || user.user_id
      const add = (driveId: string, rootId: string, suffix: string) => {
        if (driveId && !targets.some(target => target.userId === user.user_id && target.driveId === driveId)) {
          targets.push({ userId: user.user_id, driveId, rootId, name: `${name}${suffix}` })
        }
      }
      if (platform === 'aliyun') {
        add(user.resource_drive_id, 'resource_root', ' / 资源盘')
        add(user.backup_drive_id, 'backup_root', ' / 备份盘')
        add(user.default_drive_id, 'root', ' / 默认盘')
      } else {
        const driveId = driveToolDriveIdForPlatform(platform, user.default_drive_id)
        add(driveId, driveToolRootIdFor(driveId), ` / ${platform}`)
      }
    }
    if (!platforms?.length || platforms.some((platform: string) => driveToolPlatformMatches('webdav', platform))) {
      for (const connection of getWebDavConnections()) {
        targets.push({ userId: connection.id, driveId: `webdav:${connection.id}`, rootId: '/', name: `${connection.name} / WebDAV` })
      }
    }
    return targets
  }

  async function buildSelectedDriveTargetsForTool(selectedTargets: SelectedDriveTarget[]): Promise<DuplicateDriveTarget[]> {
    const users = await UserDAL.GetUserListFromDB()
    const targets: DuplicateDriveTarget[] = []
    for (const selected of selectedTargets) {
      const user = users.find(item => item?.user_id === selected.userId && item?.access_token)
      if (!user || !driveToolPlatformMatches(user.tokenfrom || 'aliyun', selected.platform)) throw new Error('所选网盘账号已失效，请重新选择')
      const driveId = normalizeDriveToolDriveId(selected.driveId)
      const validDriveIds = user.tokenfrom === 'aliyun'
        ? [user.default_drive_id, user.resource_drive_id, user.backup_drive_id]
        : [driveToolDriveIdForPlatform(user.tokenfrom || '', user.default_drive_id)]
      if (!validDriveIds.includes(driveId)) throw new Error('所选网盘目标无效，请重新选择')
      const name = user.nick_name || user.user_name || user.name || user.user_id
      if (!targets.some(target => target.userId === user.user_id && target.driveId === driveId)) {
        targets.push({ userId: user.user_id, driveId, rootId: defaultRootForDrive(driveId), name })
      }
    }
    if (!targets.length) throw new Error('请先选择要操作的网盘账号')
    return targets
  }

  async function resolveScanTargets(platforms: string[] | undefined, selectedTargets: SelectedDriveTarget[]): Promise<DuplicateDriveTarget[]> {
    if (selectedTargets.length) {
      const targets = await buildSelectedDriveTargetsForTool(selectedTargets)
      if (platforms?.length && targets.some(target => !platforms.some(platform => driveToolPlatformMatches(UserDAL.GetUserToken(target.userId)?.tokenfrom || '', platform)))) {
        throw new Error('工具请求的平台与已选择网盘不一致，请重新选择网盘')
      }
      return targets
    }
    const targets = await buildDriveTargetsForTool(platforms)
    const accountKeys = new Set(targets.filter(target => !target.driveId.startsWith('webdav:')).map(target => target.userId))
    if (accountKeys.size > 1) throw new Error('存在多个已登录网盘账号，请先选择要操作的账号')
    return targets
  }

  function driveSupportsRecycleBin(userId: string, driveId: string): boolean {
    if (!userId || !driveId || driveId.startsWith('webdav:')) return false
    const token = UserDAL.GetUserToken(userId)
    const platform = token?.tokenfrom || normalizeDriveToolPlatform(token?.tokenfrom || '') || normalizeDriveToolDriveId(driveId)
    return getProviderCapabilities(platform).capabilities.recycleBin
  }

  function unsupportedFileToolMessage(files: Array<{ userId?: string }>, toolName: string): string | null {
    for (const file of files) {
      const token = UserDAL.GetUserToken(file.userId || '')
      if (!token) return '无法确认目标文件所属网盘，已拒绝执行该操作。请先通过搜索或列表工具获取文件。'
      const platform = token.tokenfrom || ''
      const message = unsupportedAgentToolMessage(getProviderCapabilities(platform), toolName)
      if (message) return message
    }
    return null
  }

  function unsupportedPlatformToolMessage(platforms: string[] | undefined, toolName: string): string | null {
    for (const platform of platforms || []) {
      const message = unsupportedAgentToolMessage(getProviderCapabilities(platform), toolName)
      if (message) return message
    }
    return null
  }

  function unsupportedDriveTargetToolMessage(targets: DuplicateDriveTarget[], toolName: string): string | null {
    for (const target of targets) {
      const platform = target.driveId.startsWith('webdav:') ? 'webdav' : UserDAL.GetUserToken(target.userId)?.tokenfrom || ''
      const message = unsupportedAgentToolMessage(getProviderCapabilities(platform), toolName)
      if (message) return message
    }
    return null
  }

  async function unsupportedConnectedPlatformToolMessage(platforms: string[] | undefined, toolName: string): Promise<string | null> {
    const users = await UserDAL.GetUserListFromDB()
    for (const user of users) {
      const platform = user?.tokenfrom || 'aliyun'
      const selected = !platforms?.length || platforms.some(requested => driveToolPlatformMatches(platform, requested))
      if (!user?.user_id || !user?.access_token || !selected) continue
      const message = unsupportedAgentToolMessage(getProviderCapabilities(platform), toolName)
      if (message) return message
    }
    return null
  }

  async function getConnectedProviderCapabilities(): Promise<ProviderCapabilityManifest[]> {
    const users = await UserDAL.GetUserListFromDB()
    const platforms = Array.from(new Set(users.filter(user => user?.user_id && user?.access_token).map(user => normalizeProviderPlatform(user.tokenfrom || 'aliyun'))))
    return platforms.map(platform => getProviderCapabilities(platform))
  }

  async function sendMessage(text: string) {
    const kw = text.trim()
    if (!kw || loading.value) return

    const config = getAIConfig()
    if (!config) {
      const { default: msg } = await import('../../utils/message')
      msg.warning('请先在设置中配置 AI 模型')
      return
    }
    const { default: msg } = await import('../../utils/message')

    const { checkAndIncrement } = await import('../../utils/usageLimit')
    const isBYOK = !isBoxPlayerCloudProvider(config.providerName)
    const uc = checkAndIncrement('aiAgentChat', 1, { metered: false, isBYOK })
    if (!uc.allowed) { msg.warning(uc.message!); return }

    if (abortController) { abortController.abort() }
    abortController = new AbortController()
    const runId = ++activeRun

    const userMsgId = `${Date.now()}-u`
    const aiMsgId = `${Date.now()}-a`

    messages.value = sanitizePersistedMessages(messages.value)
    messages.value = [...messages.value, { id: userMsgId, role: 'user', parts: [{ type: 'text', text: kw }] }]
    messages.value = [...messages.value, { id: aiMsgId, role: 'assistant', parts: [] }]
    loading.value = true
    saveCurrentHistory(messages.value)
    scrollBottom()

    const selectedDriveTargets = parseSelectedDriveTargets(kw)
    const agentV1RunId = crypto.randomUUID()
    const agentV1Target = selectedDriveTargets.length === 1 ? { ...selectedDriveTargets[0], rootId: defaultRootForDrive(selectedDriveTargets[0].driveId) } : undefined
    const agentV1WorkflowId = await beginAiSearchV1Audit({ sessionId, runId: agentV1RunId, goal: kw, target: agentV1Target }).catch(() => null)
    let agentV1Error = ''
    let agentV1Cancelled = false
    abortController?.signal.addEventListener('abort', () => { agentV1Cancelled = true }, { once: true })
    const explicitPlatforms = inferExplicitPlatforms(kw)
    const previousUserRequest = messages.value.slice(0, -2).reverse().find(message => message.role === 'user' && !parseSelectedDriveTargets((message.parts[0] as any)?.text || '').length)
    const workflowIntentText = [String((previousUserRequest?.parts[0] as any)?.text || ''), kw].join('\n')
    const storageAnalysisWorkflow = isStorageAnalysisRequest(workflowIntentText)
    const largeFileWorkflow = !storageAnalysisWorkflow && isLargeFileRequest(workflowIntentText)
    const duplicateFileWorkflow = !storageAnalysisWorkflow && !largeFileWorkflow && isDuplicateFileRequest(workflowIntentText)
    const categorizeFilesWorkflow = !storageAnalysisWorkflow && !largeFileWorkflow && !duplicateFileWorkflow && isCategorizeFilesRequest(workflowIntentText)
    const emptyDirectoryWorkflow = !storageAnalysisWorkflow && !largeFileWorkflow && !duplicateFileWorkflow && !categorizeFilesWorkflow && isEmptyDirectoryRequest(workflowIntentText)
    const selectedReadOnlyWorkflow = selectedDriveTargets.length > 0 && (storageAnalysisWorkflow || largeFileWorkflow || duplicateFileWorkflow || categorizeFilesWorkflow || emptyDirectoryWorkflow)
    const duplicateCardDeleteWorkflow = isDuplicateCardDeleteRequest(kw)
    const trustedFileTargets = new Set<string>()
    const fileTargetKey = (file: { userId?: string; driveId?: string; fileId?: string }) => `${file.userId || ''}\n${file.driveId || ''}\n${file.fileId || ''}`
    const rememberTrustedFiles = (files: Array<{ userId?: string; driveId?: string; fileId?: string }>) => {
      for (const file of files) if (file.userId && file.driveId && file.fileId) trustedFileTargets.add(fileTargetKey(file))
    }
    const isTrustedFileFromConversation = (file: { userId?: string; driveId?: string; fileId?: string }): boolean => {
      const targetKey = fileTargetKey(file)
      const containsTarget = (value: any): boolean => {
        if (Array.isArray(value)) return value.some(containsTarget)
        if (!value || typeof value !== 'object') return false
        if (fileTargetKey(value) === targetKey) return true
        return Object.values(value).some(containsTarget)
      }
      return messages.value.some(message => message.role === 'assistant' && message.parts.some(part => part.type !== 'text' && containsTarget(part)))
    }
    const validateFileTool = (files: Array<{ userId?: string; driveId?: string; fileId?: string }>, toolName: string): string | null => {
      if (files.some(file => !trustedFileTargets.has(fileTargetKey(file)) && !isTrustedFileFromConversation(file))) return '目标文件不是搜索或扫描工具展示过的结果，已拒绝执行。请先搜索或扫描后再操作。'
      return unsupportedFileToolMessage(files, toolName)
    }

    try {
      const connectedProviderCapabilities = await getConnectedProviderCapabilities()
      const apiMessages = messages.value.slice(0, -2)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.parts.filter(p => p.type === 'text' && (m.role !== 'assistant' || !isInternalAgentText((p as any).text || ''))).map(p => (p as any).text).join('\n'),
        }))

      let textPart: any = null
      const deferredApprovalTools = new Set(['moveFiles', 'organizeFiles', 'mediaOrganizeFiles', 'importMiaochuanToGuangya', 'importGuangyaMagnets', 'deleteDriveEmptyDirs', 'deleteFiles'])
      await runBoxPlayerAgent({
        surface: 'ai_search',
        session: { id: sessionId, messages: apiMessages },
        model: config,
        systemPrompt: `你是 BoxPlayer 智能搜索助手。重要：你无法直接访问用户文件，唯一获取文件信息的方式是调用工具。任何涉及文件、网盘、存储的操作都必须调用对应工具。禁止用文字模拟工具结果、禁止编造文件名和大小。查不到就如实说查不到。

## BoxPlayer 功能知识库
${buildBoxPlayerCapabilityKnowledge()}

## 用户长期记忆
${buildWorkspaceMemoryContext(memories.value)}
长期记忆只是辅助偏好，不能代替用户本次明确指令、不能绕过确认。只有用户明确说“记住/以后/默认使用”时，才能调用 rememberPreference 保存偏好。

## 当前文档
${getActiveDocumentDetails() ? `当前已选择《${getActiveDocumentDetails()!.fileName}》。用户询问该文档内容、摘要、要点、翻译或风险时，必须调用 analyzeActiveDocument；回答只可依据工具返回的内容和引用。` : '当前没有选中的文档。'}

## 当前已登录网盘的运行时能力
${formatProviderCapabilities(connectedProviderCapabilities)}
只能对上面明确标记为支持的能力提出操作；网盘列表变化后，以 listDrives 或 getConnectedDriveCapabilities 的实时结果为准。

## 你的工具
- listDrives: 列出用户所有已登录的网盘
- searchMyFiles: 搜索用户所有云盘中的文件
- searchPanHub: 搜索全网公开网盘分享链接
- findDuplicates: 扫描云盘查找重复文件（可传 platforms 限定网盘，mode 可选 helperName 或 contentHash）
- analyzeStorage: 分析存储空间（需传 platforms 参数限定网盘）
- categorizeFiles: 按类型分类文件（需传 platforms 参数限定网盘）
- importShare: 导入阿里云盘/夸克分享链接，转存到用户网盘
- parseMiaochuanJson: 解析网盘互通/秒传 JSON 清单
- importMiaochuanToGuangya: 将秒传 JSON 清单导入光鸭云盘（需用户确认）
- exportDirectLinks: 批量导出文件/文件夹直链，支持 URL 和 aria2 格式
- importGuangyaMagnets: 批量提交 magnet 链接到光鸭云添加（需用户确认）
   - scanDriveEmptyDirs: 扫描任意已接入网盘的空目录
   - deleteDriveEmptyDirs: 删除任意已接入网盘的空目录（需用户确认）
   - scanDriveLargeFiles: 扫描任意已接入网盘的大文件
   - findDuplicates: 扫描任意已接入网盘的重复文件
   - organizeFiles: 移动整理、拆开文件夹、移动到指定目录（需用户确认）
   - mediaOrganizeFiles: 按影视命名规则进行媒体整理（需用户确认）
   - downloadFiles: 添加文件下载任务
   - moveFiles: 移动文件到指定目录（需用户确认）
- getTMDBMovies: 获取 TMDB 最新电影（热映/流行/高分）
- searchTMDB: 在 TMDB 中搜索电影和电视剧，查询影视详细信息
- getDoubanMovies: 获取豆瓣电影排行榜（Top250/新片/口碑/北美票房）
- deleteFiles: 将文件移入回收站（需用户确认；仅支持明确有回收站能力的网盘，不支持的网盘必须拒绝）
- getBoxPlayerCapabilities: 查询已注册的 BoxPlayer 功能、工具和限制
- openBoxPlayerModule: 打开已注册的 BoxPlayer 功能页面；只导航，不改变设置或数据
- rememberPreference: 仅在用户明确要求记住时保存偏好到本机长期记忆
- analyzeActiveDocument: 本机解析并索引当前从网盘打开的文档；回答时最多将 5 个检索片段发送给已配置的 AI 模型，返回可引用的内容
- getConnectedDriveCapabilities: 查询当前已登录网盘及各自支持的操作
- listMediaAcquisitionTasks: 查询媒体获取 Agent 的任务队列、进度、候选资源和最近事件
- listMediaAcquisitionTracking: 查询追更剧集、已播缺集、已获取集数和下次巡检时间
- listMediaAcquisitionNotifications: 查询媒体获取完成、部分完成、失败、取消或暂无资源的通知
- runMediaAcquisitionPatrol: 触发追更巡检，发现已播缺集时创建补全任务

## 核心规则（必须遵守）
1. 用户提到文件相关操作，必须调用对应工具，不能只回复文字
2. 禁止在未调用工具的情况下编造文件名、大小等信息
3. 网盘范围选择：
   - 用户未指定网盘，或明确要求多个网盘时，先调用 listDrives
   - 用户明确指定单个平台时，调用 listDrives({ platforms: [平台名] })；仅有一个账号时直接使用返回的账号继续操作，多个账号时等待用户在选择器中选择
   - 用户选择账号后，消息中的 selectedDriveTargets 是唯一允许使用的账号和 driveId；后续扫描必须使用这些目标，不能扩大到同平台其他账号
   - 用户要求清理重复文件时，提取消息中的 JSON 数组，直接调用 deleteFiles({ files: [...] })，先展示确认信息
   - listDrives 会在界面弹出网盘选择器，让用户勾选并点确定
   - 用户选择后你会收到类似"用户选择了: 阿里云盘(zxm)、百度网盘。platforms: aliyun,baidu"的消息，提取 platforms 列表传给工具
   - 然后你再执行对应操作
   - 用户想看热门电影/新片/排行榜 → 调用 getTMDBMovies（国外）或 getDoubanMovies（国内），无需 listDrives
   - 用户查询特定电影/电视剧信息 → 调用 searchTMDB
   - 用户询问“获取到哪了/追更哪些剧/缺哪几集/最近完成了什么” → 调用媒体获取相关工具
   - 用户要求“触发巡检/跑一遍追更” → 调用 runMediaAcquisitionPatrol
   - 用户要求新建媒体获取任务时，说明需要在搜索页或媒体详情页点击“获取/一键补全”并选择目标网盘和目录；不要跳过弹窗替用户决定目标网盘
   - 导入分享：必须问用户保存到阿里云盘还是夸克
   - 用户提到秒传、网盘互通、导入光鸭、helper JSON：先调用 parseMiaochuanJson；如果用户明确要导入光鸭，再调用 importMiaochuanToGuangya
4. 工具返回结果后，简要总结即可
5. moveFiles、deleteFiles、organizeFiles、mediaOrganizeFiles、importMiaochuanToGuangya、importGuangyaMagnets 和 deleteDriveEmptyDirs 必须先展示确认信息
6. 完全无关的问题可以正常简短回复
7. 不调用与当前问题无关的工具；大文件/存储任务不得调用 TMDB 或豆瓣电影工具

## 回复格式
不要展示模型内部思考过程。需要调用工具时，先用一句简短的执行说明告知用户接下来要做什么；工具返回后用清晰结论、结果和可选后续操作回复。`,
        prompt: kw,
        tools: {
          listDrives: {
            description: '列出已登录网盘；传 platforms 时只返回这些平台。多个账号时让用户在界面中选择。',
            inputSchema: z.object({ platforms: z.array(z.string()).optional().describe('可选的平台筛选，如 ["aliyun"]') }),
            permission: 'read',
            execute: async (args: any) => {
              const users = await UserDAL.GetUserListFromDB()
	              const platforms = args.platforms?.length ? args.platforms : explicitPlatforms
	              const drives: { userId: string; name: string; platform: string; driveId: string; capabilities: ProviderCapabilityManifest }[] = []
	              for (const u of users) {
	                if (!u?.user_id || !u?.access_token) continue
	                const name = u.nick_name || u.user_name || u.name || u.user_id
	                const platform = u.tokenfrom || 'aliyun'
	                if (platforms.length && !platforms.some((requested: string) => driveToolPlatformMatches(platform, requested))) continue
	                if (platform === 'aliyun') {
                  drives.push({ userId: u.user_id, name, platform, driveId: u.resource_drive_id || u.backup_drive_id || u.default_drive_id || '', capabilities: getProviderCapabilities(platform) })
                } else {
                  drives.push({ userId: u.user_id, name, platform, driveId: driveToolDriveIdForPlatform(platform, u.default_drive_id), capabilities: getProviderCapabilities(platform) })
                }
              }
              if (!drives.length) return { error: '没有找到符合条件的已登录网盘账号' }
              if (drives.length > 1) {
                appendPart(aiMsgId, { type: 'tool-listDrives', state: 'select', drives } as MessagePart)
                scrollBottom()
                return { awaitingSelection: true, count: drives.length, platforms }
              }
              const [drive] = drives
              return { count: 1, selectedDrive: { userId: drive.userId, driveId: drive.driveId, platform: drive.platform, name: drive.name } }
            },
          },

          getConnectedDriveCapabilities: {
            description: '读取当前已登录网盘及其运行时能力清单，用于判断某个平台是否支持搜索、下载、移动、分享、回收站等操作',
            inputSchema: z.object({}),
            permission: 'read',
            execute: async () => {
              const users = await UserDAL.GetUserListFromDB()
              return users.filter(user => user?.user_id && user?.access_token).map(user => {
                const platform = normalizeProviderPlatform(user.tokenfrom || 'aliyun')
                const capabilities = getProviderCapabilities(platform)
                return { userId: user.user_id, accountName: user.nick_name || user.user_name || user.name || user.user_id, ...capabilities, mediaAcquisition: getMediaAcquisitionCapability(platform) ? formatMediaAcquisitionCapability(getMediaAcquisitionCapability(platform)!) : '' }
              })
            },
          },

          getBoxPlayerCapabilities: {
            description: '查询 BoxPlayer 已注册功能、可执行工具和安全限制；用于回答“你能做什么”或确认模块能力边界',
            inputSchema: z.object({ capabilityId: z.string().optional().describe('功能 ID，如 cloud-files、upload、playback、media-server、settings；不传返回全部') }),
            permission: 'read',
            execute: async (args: any) => {
              const capability = args.capabilityId ? getBoxPlayerCapability(args.capabilityId) : undefined
              if (args.capabilityId && !capability) return { error: `未知功能：${args.capabilityId}` }
              return capability || BOXPLAYER_CAPABILITIES
            },
          },

          listMediaAcquisitionTasks: {
            description: '查看媒体获取 Agent 的实时任务队列、进度和最近事件。只读，不会创建或修改任务。',
            inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().describe('最多返回多少条任务，默认 20') }),
            permission: 'read',
            execute: async (args: any) => {
              const runs = await listMediaAcquisitionRuns(args.limit || 20)
              return {
                total: runs.length,
                tasks: runs.map(run => ({
                  id: run.id,
                  title: run.target.title,
                  mediaType: run.target.mediaType,
                  kind: run.kind,
                  status: run.status,
                  phase: run.phase,
                  progress: run.progress,
                  activity: run.activity,
                  targetPlatform: run.target.targetPlatform,
                  targetDriveId: run.target.targetDriveId,
                  seasonNumber: run.target.seasonNumber,
                  missingEpisodes: run.target.missingEpisodes || [],
                  candidates: run.candidates.map(candidate => ({ id: candidate.id, kind: candidate.kind, sourcePlatform: candidate.sourcePlatform, title: candidate.title, status: candidate.status, lastError: candidate.lastError })),
                  latestEvents: run.events.slice(-5).map(event => ({ level: event.level, phase: event.phase, message: event.message, createdAt: event.createdAt }))
                }))
              }
            },
          },

          listMediaAcquisitionTracking: {
            description: '查看正在追更的剧集、已播缺集、已获取集数和下次巡检时间。只读。',
            inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().describe('最多返回多少条追更记录，默认 50') }),
            permission: 'read',
            execute: async (args: any) => {
              const items = await listMediaAcquisitionTracking(args.limit || 50)
              return {
                total: items.length,
                tracking: items.map(item => ({
                  id: item.id,
                  title: item.title,
                  mediaType: item.mediaType,
                  seasonNumber: item.seasonNumber,
                  status: item.status,
                  totalEpisodes: item.totalEpisodes,
                  latestAiredEpisode: item.latestAiredEpisode,
                  obtainedEpisodeNumbers: item.obtainedEpisodeNumbers,
                  missingEpisodes: item.missingEpisodes,
                  providerAheadEpisodes: item.providerAheadEpisodes,
                  nextCheckAt: item.nextCheckAt
                }))
              }
            },
          },

          listMediaAcquisitionNotifications: {
            description: '查看媒体获取完成、部分完成、失败、取消或暂无资源的通知。只读。',
            inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().describe('最多返回多少条通知，默认 50') }),
            permission: 'read',
            execute: async (args: any) => {
              const notifications = await listMediaAcquisitionNotifications(args.limit || 50)
              return {
                total: notifications.length,
                notifications: notifications.map(item => ({ id: item.id, title: item.title, status: item.status, message: item.message, read: item.read, createdAt: item.createdAt }))
              }
            },
          },

          runMediaAcquisitionPatrol: {
            description: '触发媒体获取 Agent 追更巡检：检查全部追更中的剧集，发现已播缺集时自动补全。用户明确要求巡检时使用。',
            inputSchema: z.object({}),
            permission: 'write',
            executionMode: 'sequential',
            execute: async () => {
              await runMediaAcquisitionTrackingPatrol()
              return { ok: true, message: '全部追更巡检已完成' }
            },
          },

          openBoxPlayerModule: {
            description: '打开一个已注册的 BoxPlayer 模块页面；仅进行界面导航，不会修改任何数据或设置',
            inputSchema: z.object({ capabilityId: z.string().describe('功能 ID，如 upload、playback、media-server、books、settings') }),
            permission: 'navigate',
            execute: async (args: any) => {
              const capability = getBoxPlayerCapability(args.capabilityId)
              if (!capability?.tab) return { error: `该功能当前不能打开：${args.capabilityId}` }
              if (capability.menu) appStore.toggleTabMenu(capability.tab, capability.menu)
              else appStore.toggleTab(capability.tab)
              return { opened: capability.title, module: capability.module, tab: capability.tab }
            },
          },

          rememberPreference: {
            description: '保存用户明确要求长期记住的偏好，例如默认网盘、常用整理方式或内容偏好；仅本机保存，不能记录密钥、密码、令牌或敏感内容',
            inputSchema: z.object({ key: z.string().describe('简短、稳定的偏好键名'), summary: z.string().describe('用户明确要求记住的偏好描述') }),
            // 只写入用户明确要求保存的本机偏好记忆，不修改网盘数据；用户可在记忆列表中删除。
            permission: 'read',
            execute: async (args: any) => {
              if (/密码|token|密钥|secret|access[_-]?token/i.test(`${args.key} ${args.summary}`)) return { error: '不能保存密码、令牌或密钥到长期记忆' }
              const memory = await rememberWorkspaceFact(args.key, args.summary, userMsgId)
              if (!memory) return { error: '本机长期记忆暂不可用' }
              await refreshMemories()
              return { saved: true, key: memory.key, summary: memory.summary }
            },
          },

          analyzeActiveDocument: {
            description: '本机解析并索引当前工作台上下文中的 PDF、DOCX、EPUB、TXT 或 Markdown 文档；回答时最多将 5 个检索片段发送给已配置的 AI 模型，只能基于检索到的文档内容回答',
            inputSchema: z.object({ query: z.string().describe('对当前文档的分析问题，例如“概括核心内容和风险”') }),
            permission: 'read',
            execute: async (args: any) => {
              const document = getActiveDocumentDetails()
              if (!document) return { error: '当前没有可分析的文档。请从网盘文件右键选择“用 AI 分析”。' }
              try {
                const download = await DriveFile.ApiFileDownloadUrl(document.userId, document.driveId, document.file.file_id, 14_400)
                if (typeof download === 'string') return { error: download }
                const response = await fetch(download.url, { headers: download.headers || {} })
                if (!response.ok) return { error: `下载文档失败: HTTP ${response.status}` }
                const data = await response.arrayBuffer()
                const settings = createBookAISettings()
                const provider = getAIProvider(settings)
                const embeddingModel = canUseSemanticEmbeddings(settings.provider) ? provider.getEmbeddingModel() : undefined
                await indexDocumentLocally({ sourceId: document.sourceId, fileName: document.fileName, data, embeddingModel })
                let answer = ''
                const citations: Array<{ location: string; section: string; text: string }> = []
                await askIndexedDocument({
                  sourceId: document.sourceId,
                  fileName: document.fileName,
                  question: args.query,
                  model: config,
                  embeddingModel,
                  signal: abortController?.signal,
                  onToken: token => { answer += token },
                  onCitation: citation => citations.push({ location: citation.location || (citation.page ? `页 ${citation.page}` : '正文'), section: citation.section || '正文', text: citation.text })
                })
                return { fileName: document.fileName, answer, citations: citations.slice(0, 5) }
              } catch (e: any) {
                return { error: e?.message || '文档分析失败' }
              }
            },
          },

          searchMyFiles: {
            description: '搜索用户所有已登录云盘中的文件',
            inputSchema: z.object({
              keyword: z.string().describe('搜索关键词'),
              platforms: z.array(z.string()).optional().describe('限定搜索的网盘平台名列表，如 ["aliyun","baidu"]'),
            }),
            permission: 'read',
            execute: async (args: any) => {
              const keyword = args.keyword
              const requestedPlatforms = args.platforms?.length ? args.platforms : explicitPlatforms
              const unsupported = unsupportedPlatformToolMessage(requestedPlatforms, 'searchMyFiles')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, {
                type: 'tool-searchMyFiles',
                state: 'running',
                input: { keyword },
              } as MessagePart)
              scrollBottom()

              try {
                const targets = selectedDriveTargets.length ? await buildSelectedDriveTargetsForTool(selectedDriveTargets) : []
                const r = await searchAllDrives(keyword, { platforms: requestedPlatforms, targets, includeMediaServers: false })
                const files: FileResult[] = r.slice(0, 30).map((f: GlobalSearchResult) => ({
                  name: f.name, ext: f.ext, size: f.size, isDir: f.isDir,
                  provider: f.provider, providerName: f.providerName,
                  driveId: f.drive_id, fileId: f.file_id,
                  parentFileId: f.parent_file_id, userId: f.user_id, source: f.source,
                }))
                rememberTrustedFiles(files)
                updateToolPart(aiMsgId, 'tool-searchMyFiles', { keyword }, (part: any) => {
                  part.state = 'done'
                  part.output = { total: r.length, files }
                })
                scrollBottom()
                return { total: r.length, files }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-searchMyFiles', { keyword }, (part: any) => {
                  part.state = 'error'
                  part.error = e?.message || '搜索失败'
                })
                scrollBottom()
                return { total: 0, files: [], error: e?.message }
              }
            },
          },
          searchPanHub: {
            description: '搜索全网公开网盘分享链接',
            inputSchema: z.object({ keyword: z.string().describe('搜索关键词') }),
            permission: 'read',
            execute: async (args: any) => {
              const keyword = args.keyword
              const panHubUsage = checkAndIncrement('panHubSearch')
              if (!panHubUsage.allowed) {
                appendPart(aiMsgId, {
                  type: 'tool-searchPanHub',
                  state: 'error',
                  input: { keyword },
                  error: panHubUsage.message || '今日全网资源搜索次数已用完',
                } as MessagePart)
                scrollBottom()
                return { total: 0, links: [], error: panHubUsage.message || '今日全网资源搜索次数已用完' }
              }
              appendPart(aiMsgId, {
                type: 'tool-searchPanHub',
                state: 'running',
                input: { keyword },
              } as MessagePart)
              scrollBottom()

              try {
                const flattenLinks = (merged: PanHubMergedLinks): LinkResult[] => {
                  const all: LinkResult[] = []
                  for (const [type, items] of Object.entries(merged)) {
                    all.push(...items.map((i: any) => ({
                      type, url: i.url || '', note: i.note || '', password: i.password || '',
                    })))
                  }
                  return all
                }
                const result = await searchPanHubStream({
                  apiBase: `${getBoxPlayerAPIBaseURL()}/api`,
                  keyword,
                  plugins: [],
                  channels: [],
                  concurrency: 4,
                  pluginTimeoutMs: 5000,
                  signal: abortController?.signal,
                  ipcRenderer: window.Electron?.ipcRenderer,
                  onProgress: (merged, total) => {
                    updateToolPart(aiMsgId, 'tool-searchPanHub', { keyword }, (part: any) => {
                      part.output = { total, links: flattenLinks(merged).slice(0, 30) }
                    })
                    scrollBottom()
                  },
                })
                if (result.total > 0) {
                  const all = flattenLinks(result.merged)
                  updateToolPart(aiMsgId, 'tool-searchPanHub', { keyword }, (part: any) => {
                    part.state = 'done'
                    part.output = { total: all.length, links: all }
                  })
                  scrollBottom()
                  return { total: all.length, links: all.slice(0, 30) }
                }
                const errMsg = '未找到匹配资源'
                updateToolPart(aiMsgId, 'tool-searchPanHub', { keyword }, (part: any) => {
                  part.state = 'error'
                  part.error = errMsg
                })
                scrollBottom()
                return { total: 0, links: [], error: errMsg }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-searchPanHub', { keyword }, (part: any) => {
                  part.state = 'error'
                  part.error = e?.message || '搜索失败'
                })
                scrollBottom()
                return { total: 0, links: [], error: e?.message }
              }
            },
          },
          parseMiaochuanJson: {
            description: '解析网盘互通/秒传 JSON 清单，支持 MD5、base64 MD5、GCID、path/name/size 等字段',
            inputSchema: z.object({
              jsonText: z.string().describe('秒传 JSON 文本'),
            }),
            permission: 'read',
            execute: async (args: any) => {
              appendPart(aiMsgId, { type: 'tool-miaochuan', state: 'parsing' } as MessagePart)
              scrollBottom()
              try {
                const parsed = normalizeMiaochuanPayload(args.jsonText || '')
                updateToolPart(aiMsgId, 'tool-miaochuan', {}, (part: any) => {
                  part.state = parsed.files.length ? 'done' : 'error'
                  if (parsed.files.length) part.output = { total: parsed.files.length, report: parsed.report }
                  else part.error = parsed.errors[0] || '没有识别到可秒传文件'
                })
                scrollBottom()
                return {
                  total: parsed.files.length,
                  errors: parsed.errors.slice(0, 10),
                  files: parsed.files.slice(0, 30).map(file => ({ path: file.path, name: file.name, size: file.size, sourceProvider: file.sourceProvider }))
                }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-miaochuan', {}, (part: any) => {
                  part.state = 'error'
                  part.error = e?.message || '解析秒传 JSON 失败'
                })
                scrollBottom()
                return { total: 0, error: e?.message }
              }
            },
          },
          importMiaochuanToGuangya: {
            description: '将秒传 JSON 清单导入光鸭云盘，需要用户确认后才会执行写入操作',
            inputSchema: z.object({
              jsonText: z.string().describe('秒传 JSON 文本'),
              parentId: z.string().optional().describe('光鸭目标目录 ID，默认根目录 guangya_root'),
            }),
            permission: 'write',
            execute: async (args: any) => {
              const parsed = normalizeMiaochuanPayload(args.jsonText || '')
              if (!parsed.files.length) {
                appendPart(aiMsgId, { type: 'tool-miaochuan', state: 'error', error: parsed.errors[0] || '没有识别到可秒传文件' } as MessagePart)
                scrollBottom()
                return { pending: false, error: 'no valid files' }
              }
              const account = await getUserIdForPlatform('guangya', selectedDriveTargets)
              if (!account) {
                appendPart(aiMsgId, { type: 'tool-miaochuan', state: 'error', error: '请先登录光鸭云盘' } as MessagePart)
                scrollBottom()
                return { pending: false, error: 'no guangya account' }
              }
              appendPart(aiMsgId, {
                type: 'tool-miaochuan',
                state: 'confirm',
                input: {
                  parentId: args.parentId || 'guangya_root', userId: account.userId,
                  files: parsed.files.map(file => ({ path: file.path, name: file.name, size: file.size, md5: file.md5, gcid: file.gcid }))
                },
                output: { total: parsed.files.length, report: parsed.report }
              } as MessagePart)
              scrollBottom()
              return { pending: true, total: parsed.files.length, target: args.parentId || 'guangya_root' }
            },
          },
          exportDirectLinks: {
            description: '批量导出文件或文件夹的直链，支持 url 或 aria2 格式；可用于光鸭、夸克、阿里云盘等已接入下载 URL 的网盘',
            inputSchema: z.object({
              files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string(), isDir: z.boolean().optional(), size: z.number().optional() })),
              format: z.enum(['url', 'aria2']).optional().describe('导出格式，默认 aria2'),
            }),
            permission: 'read',
            execute: async (args: any) => {
              const files = args.files || []
              const format: DirectLinkFormat = args.format || 'aria2'
              if (!files.length) return { total: 0, success: 0, failed: 0, error: 'no files' }
              const unsupported = validateFileTool(files, 'exportDirectLinks')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, { type: 'tool-directLinks', state: 'running', input: { files, format } } as MessagePart)
              scrollBottom()
              try {
                const userId = files[0].userId
                const models = files.map((file: any) => ({
                  __v_skip: true,
                  user_id: file.userId,
                  drive_id: file.driveId,
                  file_id: file.fileId,
                  parent_file_id: '',
                  name: file.name,
                  namesearch: file.name,
                  ext: '',
                  mime_type: '',
                  mime_extension: '',
                  category: '',
                  starred: false,
                  time: 0,
                  file_count: 0,
                  size: file.size || 0,
                  sizeStr: '',
                  timeStr: '',
                  icon: '',
                  isDir: !!file.isDir,
                  thumbnail: '',
                  description: ''
                }))
                const result = await exportDirectLinks(models as any, userId, format, 100)
                updateToolPart(aiMsgId, 'tool-directLinks', {}, (part: any) => {
                  part.state = 'done'
                  part.output = { total: result.total, success: result.success, failed: result.failed, text: result.text }
                })
                scrollBottom()
                return { total: result.total, success: result.success, failed: result.failed, message: '直链已生成并仅显示在本地界面，不会发送给模型。' }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-directLinks', {}, (part: any) => {
                  part.state = 'error'
                  part.error = e?.message || '直链导出失败'
                })
                scrollBottom()
                return { total: 0, success: 0, failed: files.length, error: e?.message }
              }
            },
          },
          importGuangyaMagnets: {
            description: '批量提交 magnet 链接到光鸭云添加，需要用户确认后才会创建离线任务',
            inputSchema: z.object({
              text: z.string().describe('包含 magnet 链接的文本或 JSON'),
              parentId: z.string().optional().describe('光鸭目标目录 ID，默认根目录 guangya_root'),
            }),
            permission: 'write',
            execute: async (args: any) => {
              const magnets = extractMagnetLinks(args.text || '')
              if (!magnets.length) {
                appendPart(aiMsgId, { type: 'tool-guangyaMagnets', state: 'error', error: '没有识别到 magnet 链接' } as MessagePart)
                scrollBottom()
                return { pending: false, error: 'no magnets' }
              }
              const account = await getUserIdForPlatform('guangya', selectedDriveTargets)
              if (!account) {
                appendPart(aiMsgId, { type: 'tool-guangyaMagnets', state: 'error', error: '请先登录光鸭云盘' } as MessagePart)
                scrollBottom()
                return { pending: false, error: 'no guangya account' }
              }
              appendPart(aiMsgId, {
                type: 'tool-guangyaMagnets',
                state: 'confirm',
                input: { text: args.text || '', parentId: args.parentId || 'guangya_root', userId: account.userId, magnets }
              } as MessagePart)
              scrollBottom()
              return { pending: true, total: magnets.length }
            },
          },
          scanDriveEmptyDirs: {
            description: '扫描任意已接入网盘指定目录下的最里层空目录',
            inputSchema: z.object({
              userId: z.string().optional().describe('网盘账号 userId；可从 listDrives 获取'),
              driveId: z.string().optional().describe('网盘 driveId；可从 listDrives 获取'),
              platform: z.string().optional().describe('网盘平台名，如 aliyun、quark、guangya、baidu'),
              rootId: z.string().optional().describe('扫描根目录 ID；不传则使用该网盘根目录'),
            }),
            permission: 'read',
            execute: async (args: any) => {
              const targets = selectedDriveTargets.length
                ? await buildSelectedDriveTargetsForTool(selectedDriveTargets)
                : [await resolveDriveForTool(args, selectedDriveTargets)].filter((target): target is { userId: string; driveId: string; rootId: string } => !!target)
              if (!targets.length) {
                appendPart(aiMsgId, { type: 'tool-guangyaEmptyDirs', state: 'error', error: '请先选择或登录要扫描的网盘' } as MessagePart)
                scrollBottom()
                return { error: 'no drive account' }
              }
              appendPart(aiMsgId, { type: 'tool-guangyaEmptyDirs', state: 'scanning' } as MessagePart)
              scrollBottom()
              try {
                const emptyDirs: any[] = []
                let scannedDirs = 0
                const reports: string[] = []
                for (const target of targets) {
                  const token = UserDAL.GetUserToken(target.userId)
                  const unsupported = unsupportedAgentToolMessage(getProviderCapabilities(token?.tokenfrom || (target.driveId.startsWith('webdav:') ? 'webdav' : '')), 'scanDriveEmptyDirs')
                  if (unsupported) throw new Error(unsupported)
                  const result = await scanDriveEmptyDirs(target.userId, target.driveId, target.rootId)
                  if (result.failedDirs || result.truncated) throw new Error(result.errors.slice(0, 2).join('；') || '空目录扫描未完成，已拒绝将不完整结果用于删除')
                  emptyDirs.push(...result.emptyDirs)
                  scannedDirs += result.scannedDirs
                  if (result.report) reports.push(result.report)
                }
                rememberTrustedFiles(emptyDirs)
                updateToolPart(aiMsgId, 'tool-guangyaEmptyDirs', {}, (part: any) => {
                  part.state = 'done'
                  part.input = { dirs: emptyDirs }
                  part.output = { scannedDirs, total: emptyDirs.length, report: reports.join('\n') }
                })
                scrollBottom()
                return { scannedDirs, total: emptyDirs.length, dirs: emptyDirs.slice(0, 50) }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-guangyaEmptyDirs', {}, (part: any) => {
                  part.state = 'error'
                  part.error = e?.message || '扫描空目录失败'
                })
                scrollBottom()
                return { error: e?.message }
              }
            },
          },
          deleteDriveEmptyDirs: {
            description: '删除任意已接入网盘的空目录，需要用户确认；dirs 应来自 scanDriveEmptyDirs 的结果',
            inputSchema: z.object({
              dirs: z.array(z.object({ name: z.string(), fileId: z.string(), parentFileId: z.string(), driveId: z.string(), userId: z.string(), path: z.string() })),
            }),
            permission: 'write',
            execute: async (args: any) => {
              const dirs = args.dirs || []
              if (!dirs.length) return { pending: false, total: 0 }
              const unsupported = validateFileTool(dirs, 'deleteDriveEmptyDirs')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, { type: 'tool-guangyaEmptyDirs', state: 'confirm', input: { dirs } } as MessagePart)
              scrollBottom()
              return { pending: true, total: dirs.length }
            },
          },
          importShare: {
            description: '导入分享链接，将阿里云盘或夸克网盘分享的文件转存到用户网盘',
            inputSchema: z.object({
              url: z.string().describe('分享链接 URL'),
              password: z.string().optional().describe('提取码'),
            }),
            permission: 'write',
            execute: async (args: any) => {
              const { url, password } = args
              const isQuark = /pan\.quark\.cn\/s\//.test(url)
              const isAliyun = /(aliyundrive|alipan)\.com\/s\//.test(url)
              if (!isQuark && !isAliyun) {
                appendPart(aiMsgId, { type: 'tool-importShare', state: 'error', input: { url, password: password || '' }, error: '仅支持阿里云盘和夸克网盘的分享链接' } as MessagePart)
                scrollBottom()
                return { error: 'unsupported platform' }
              }
              appendPart(aiMsgId, { type: 'tool-importShare', state: 'parsing', input: { url, password: password || '' } } as MessagePart)
              scrollBottom()
              const platform = isQuark ? 'quark' : 'aliyun'
              const account = await getUserIdForPlatform(platform, selectedDriveTargets)
              if (!account) {
                updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => { p.state = 'error'; p.error = `请先在网盘选择器中选择一个${platform === 'quark' ? '夸克' : '阿里云'}盘账号` })
                scrollBottom()
                return { error: 'no account' }
              }
              try {
                let shareToken: string; let shareId: string
                if (isQuark) {
                  const parsed = parseQuarkShareLink(url + (password ? ` 提取码:${password}` : ''))
                  if (!parsed.id) throw new Error('解析夸克分享链接失败')
                  shareId = parsed.id.replace('quark:', '')
                  const { apiQuarkShareToken } = await import('../../quark/share')
                  shareToken = await apiQuarkShareToken(shareId, password || '', account.userId)
                } else {
                  shareId = url.split(/\.com\/s\/([\w]+)/)[1]
                  shareToken = await AliShare.ApiGetShareToken(shareId, password || '')
                  if (!shareToken || shareToken.startsWith('，')) throw new Error('获取分享token失败')
                }
                updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => { p.state = 'listing' })
                scrollBottom()
                const fileResp = isQuark
                  ? await (await import('../../quark/share')).apiQuarkShareFileList(shareId, shareToken, 'root', account.userId)
                  : await AliShare.ApiShareFileList(shareId, shareToken, 'root')
                if (fileResp?.next_marker) throw new Error('分享文件超过当前一次可安全导入的数量，请在网盘页面分批转存')
                const files = fileResp?.items || []
                if (!files.length) {
                  updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => { p.state = 'done'; p.output = { shareName: '', fileCount: 0, savedCount: 0, platform: platform === 'quark' ? '夸克网盘' : '阿里云盘' } })
                  return { savedCount: 0, fileCount: 0 }
                }
                const fileIds = files.map((f: any) => f.file_id)
                updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => { p.state = 'saving' })
                scrollBottom()
                // refresh Quark cookies from Electron session before saving
        if (isQuark) {
          const { readQuarkCookieStringFromElectron, buildQuarkCookieString } = await import('../../quark/auth')
          const freshCookie = await readQuarkCookieStringFromElectron().catch(() => '')
          if (freshCookie) {
            const { default: UserDAL_ } = await import('../../user/userdal')
            const token = UserDAL_.GetUserToken(account.userId) || await UserDAL_.GetUserTokenFromDB(account.userId)
            if (token) {
              token.access_token = freshCookie
              UserDAL_.SaveUserToken(token)
            }
          }
        }

        const result = isQuark
          ? await (await import('../../quark/share')).apiQuarkSaveShareFilesBatch(shareId, shareToken, account.userId, 'quark_root', fileIds)
          : await AliShare.ApiSaveShareFilesBatch(shareId, shareToken, account.userId, account.driveId, 'root', fileIds)
                updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => {
                  if (result === 'success') {
                    p.state = 'done'
                    p.output = { shareName: (fileResp as any)?.share_name || files[0]?.name || '', fileCount: files.length, savedCount: files.length, platform: platform === 'quark' ? '夸克网盘' : '阿里云盘' }
                  } else if (result === 'async') {
                    p.state = 'done'
                    p.output = { shareName: (fileResp as any)?.share_name || files[0]?.name || '', fileCount: files.length, savedCount: files.length, platform: platform === 'quark' ? '夸克网盘' : '阿里云盘', asyncStatus: true }
                  } else {
                    p.state = 'error'
                    p.error = result || '转存失败'
                  }
                })
                scrollBottom()
                return { savedCount: result === 'success' ? files.length : 0, fileCount: files.length, shareName: (fileResp as any)?.share_name || '' }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-importShare', { url }, (p: any) => { p.state = 'error'; p.error = e?.message || '导入失败' })
                scrollBottom()
                return { error: e?.message }
              }
            },
          },

          downloadFiles: {
            description: '添加文件下载任务',
            inputSchema: z.object({ files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string() })) }),
            permission: 'write',
            execute: async (args: any) => {
              const files = args.files || []
              if (!files.length) return { total: 0, success: 0 }
              const unsupported = validateFileTool(files, 'downloadFiles')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, { type: 'tool-downloadFiles', state: 'running', input: { files } } as MessagePart)
              scrollBottom()
              try {
                const { default: DownDAL } = await import('../../down/DownDAL')
                const models = files.map((f: any) => ({ user_id: f.userId, drive_id: f.driveId, file_id: f.fileId, file_name: f.name, parent_file_id: 'root', size: 0, ext: '', category: 'other', icon: '', thumbnail: '', description: '', encType: '', password: '' }))
                DownDAL.aAddDownload(models as any, '', false)
                updateToolPart(aiMsgId, 'tool-downloadFiles', {}, (p: any) => { p.state = 'done'; p.output = { total: files.length, success: files.length } })
                scrollBottom()
                return { total: files.length, success: files.length }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-downloadFiles', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '添加下载失败' })
                scrollBottom()
                return { error: e?.message }
              }
            },
          },

	          findDuplicates: {
	            description: '扫描云盘查找重复文件；mode=helperName 匹配光鸭助手的 (1)/(2)/(3) 命名规则，mode=contentHash 按文件内容哈希判重',
	            inputSchema: z.object({ platforms: z.array(z.string()).optional().describe('网盘平台名列表，如 ["aliyun","baidu"]'), mode: z.enum(['helperName', 'contentHash']).optional().describe('判重模式，默认 helperName') }),
	            permission: 'read',
	            execute: async (args: any) => {
	              const unsupported = unsupportedPlatformToolMessage(args.platforms, 'findDuplicates')
	              if (unsupported) return { error: unsupported }
	              appendPart(aiMsgId, { type: 'tool-findDuplicates', state: 'scanning' } as MessagePart)
	              scrollBottom()
	              try {
	                const requestedPlatforms = args.platforms?.length ? args.platforms : explicitPlatforms
	                const targets = await resolveScanTargets(requestedPlatforms, selectedDriveTargets)
	                const targetUnsupported = unsupportedDriveTargetToolMessage(targets, 'findDuplicates')
	                if (targetUnsupported) throw new Error(targetUnsupported)
	                const data = await scanDriveDuplicates(targets, (args.mode || 'helperName') as DuplicateScanMode)
	                if (data.failedDirs || data.truncated) throw new Error(data.errors.slice(0, 2).join('；') || '重复文件扫描未完成，已拒绝使用不完整结果')
                const groups = data.groups.slice(0, 20).map(group => ({
                  name: group.label,
                  size: group.files[0]?.size || 0,
                  files: group.files.map(file => ({ name: file.name, ext: file.name.includes('.') ? file.name.split('.').pop() || '' : '', size: file.size, isDir: false, provider: file.driveId, providerName: file.path.split('/')[0] || file.driveId, driveId: file.driveId, fileId: file.fileId, parentFileId: file.parentFileId, userId: file.userId, source: file.path }))
                }))
                rememberTrustedFiles(groups.flatMap(group => group.files))
                updateToolPart(aiMsgId, 'tool-findDuplicates', {}, (p: any) => { p.state = 'done'; p.output = { totalFiles: data.scannedFiles, groups } })
                scrollBottom()
                return { totalFiles: data.scannedFiles, groupCount: groups.length, report: data.report }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-findDuplicates', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '扫描失败' })
                scrollBottom()
                return { error: e?.message }
              }
	            },
	          },

	          scanDriveLargeFiles: {
	            description: '扫描任意已接入网盘的大文件；支持 size/video/doc/zip/others/size5000/size1000/size100 模式',
	            inputSchema: z.object({
	              platforms: z.array(z.string()).optional().describe('网盘平台名列表，如 ["aliyun","115","guangya"]'),
	              mode: z.enum(['size', 'video', 'doc', 'zip', 'others', 'size5000', 'size1000', 'size100']).optional().describe('扫描模式，默认 size1000'),
	              customSizeMB: z.number().optional().describe('mode=size 时使用的阈值，单位 MB')
	            }),
	            permission: 'read',
	            execute: async (args: any) => {
	              const unsupported = unsupportedPlatformToolMessage(args.platforms, 'scanDriveLargeFiles')
	              if (unsupported) return { error: unsupported }
	              appendPart(aiMsgId, { type: 'tool-analyzeStorage', state: 'scanning' } as MessagePart)
	              scrollBottom()
	              try {
	                const requestedPlatforms = args.platforms?.length ? args.platforms : explicitPlatforms
	                const targets = await resolveScanTargets(requestedPlatforms, selectedDriveTargets)
	                const targetUnsupported = unsupportedDriveTargetToolMessage(targets, 'scanDriveLargeFiles')
	                if (targetUnsupported) throw new Error(targetUnsupported)
	                const data = await scanDriveLargeFiles(targets, (args.mode || 'size1000') as LargeFileScanMode, { customSizeMB: args.customSizeMB ?? 100 })
	                if (data.failedDirs || data.truncated) throw new Error(data.errors.slice(0, 2).join('；') || '扫描未完成，已拒绝使用不完整结果')
                const topLarge: FileResult[] = data.files.slice(0, 30).map(file => ({
	                  name: file.name,
	                  ext: file.ext,
	                  size: file.size,
	                  isDir: false,
	                  provider: file.driveId,
	                  providerName: file.path.split('/')[0] || file.driveId,
	                  driveId: file.driveId,
	                  fileId: file.fileId,
	                  parentFileId: file.parentFileId,
	                  userId: file.userId,
                  source: file.path
                }))
                rememberTrustedFiles(topLarge)
	                updateToolPart(aiMsgId, 'tool-analyzeStorage', {}, (p: any) => {
	                  p.state = 'done'
	                  p.title = '大文件扫描'
	                  p.report = data.report
	                  p.output = { drives: [{ name: '大文件扫描', totalSize: data.files.reduce((sum, file) => sum + file.size, 0), fileCount: data.files.length, topLarge }], oldestFiles: [], unusedFiles: [] }
	                })
	                scrollBottom()
	                return { total: data.files.length, scannedDirs: data.scannedDirs, scannedFiles: data.scannedFiles, report: data.report, files: topLarge }
	              } catch (e: any) {
	                updateToolPart(aiMsgId, 'tool-analyzeStorage', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '扫描大文件失败' })
	                scrollBottom()
	                return { error: e?.message }
	              }
	            },
	          },

          analyzeStorage: {
            description: '分析存储空间使用情况，platforms 参数指定要分析的网盘',
            inputSchema: z.object({ platforms: z.array(z.string()).optional().describe('网盘平台名列表') }),
            permission: 'read',
            execute: async (args: any) => {
	              const requestedPlatforms = args.platforms?.length ? args.platforms : explicitPlatforms
	              const unsupported = unsupportedPlatformToolMessage(requestedPlatforms, 'analyzeStorage')
              if (unsupported) return { error: unsupported }
	              const connectedUnsupported = selectedDriveTargets.length ? null : await unsupportedConnectedPlatformToolMessage(requestedPlatforms, 'analyzeStorage')
              if (connectedUnsupported) return { error: connectedUnsupported }
              appendPart(aiMsgId, { type: 'tool-analyzeStorage', state: 'scanning' } as MessagePart)
              scrollBottom()
              try {
	                if (agentV1WorkflowId && selectedDriveTargets.length === 1) {
	                  const stats = await collectAiSearchStorageStats(agentV1WorkflowId)
	                  if (!stats) throw new Error('无法读取受限网盘统计结果')
	                  const name = selectedDriveTargets[0].platform
	                  const categories = Object.entries(stats.byCategory).map(([category, value]) => ({ category, ...value }))
	                  const drives = [{ name, totalSize: stats.totalSize, fileCount: stats.totalFiles, topLarge: [] as FileResult[] }]
	                  updateToolPart(aiMsgId, 'tool-analyzeStorage', {}, (p: any) => { p.state = 'done'; p.output = { drives, oldestFiles: [], unusedFiles: [] }; p.report = `已在授权根目录的前 ${stats.maxDepth} 层完成只读统计：${stats.totalFiles} 个文件、${stats.totalDirs} 个目录` })
	                  scrollBottom()
	                  return { drives: 1, totalFiles: stats.totalFiles, totalDirs: stats.totalDirs, totalSize: stats.totalSize, maxDepth: stats.maxDepth, categories, topExtensions: stats.topExtensions }
	                }
	                const allFiles = await scanAllDrives(requestedPlatforms, selectedDriveTargets)
                const driveMap = new Map<string, { totalSize: number; count: number; files: FileResult[] }>()
                for (const f of allFiles) {
                  const key = f.providerName
                  if (!driveMap.has(key)) driveMap.set(key, { totalSize: 0, count: 0, files: [] })
                  const d = driveMap.get(key)!
                  d.totalSize += f.size; d.count++
                  d.files.push({ name: f.name, ext: f.ext, size: f.size, isDir: f.isDir, provider: f.provider, providerName: f.providerName, driveId: f.drive_id, fileId: f.file_id, parentFileId: f.parent_file_id, userId: f.user_id, source: f.source })
                }
                const drives = Array.from(driveMap.entries()).map(([name, d]) => ({ name, totalSize: d.totalSize, fileCount: d.count, topLarge: [...d.files].sort((a, b) => b.size - a.size).slice(0, 10) }))
                rememberTrustedFiles(drives.flatMap(drive => drive.topLarge))
                const oldestFiles: FileResult[] = []
                updateToolPart(aiMsgId, 'tool-analyzeStorage', {}, (p: any) => { p.state = 'done'; p.output = { drives, oldestFiles, unusedFiles: [] } })
                scrollBottom()
                return { drives: drives.length, totalFiles: allFiles.length }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-analyzeStorage', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '分析失败' })
                scrollBottom()
                return { error: e?.message }
              }
            },
          },

          categorizeFiles: {
            description: '分析文件类型分布，platforms 参数指定要分类的网盘',
            inputSchema: z.object({ platforms: z.array(z.string()).optional().describe('网盘平台名列表') }),
            permission: 'read',
            execute: async (args: any) => {
	              const requestedPlatforms = args.platforms?.length ? args.platforms : explicitPlatforms
	              const unsupported = unsupportedPlatformToolMessage(requestedPlatforms, 'categorizeFiles')
              if (unsupported) return { error: unsupported }
	              const connectedUnsupported = selectedDriveTargets.length ? null : await unsupportedConnectedPlatformToolMessage(requestedPlatforms, 'categorizeFiles')
              if (connectedUnsupported) return { error: connectedUnsupported }
              appendPart(aiMsgId, { type: 'tool-categorizeFiles', state: 'planning' } as MessagePart)
              scrollBottom()
              try {
	                const allFiles = await scanAllDrives(requestedPlatforms, selectedDriveTargets)
                const catMap: Record<string, { exts: string[]; count: number; size: number }> = {
                  '视频': { exts: ['mp4','mkv','avi','mov','wmv','flv','webm'], count: 0, size: 0 },
                  '文档': { exts: ['pdf','doc','docx','txt','md','xls','xlsx','ppt','pptx'], count: 0, size: 0 },
                  '音频': { exts: ['mp3','flac','wav','aac','ogg','m4a'], count: 0, size: 0 },
                  '图片': { exts: ['jpg','jpeg','png','gif','bmp','webp','svg'], count: 0, size: 0 },
                  '压缩包': { exts: ['zip','rar','7z','tar','gz'], count: 0, size: 0 },
                  '其他': { exts: [], count: 0, size: 0 },
                }
                for (const f of allFiles) {
                  if (f.isDir) continue
                  const ext = (f.ext || '').toLowerCase()
                  let found = false
                  for (const [name, cat] of Object.entries(catMap)) {
                    if (name === '其他') continue
                    if (cat.exts.includes(ext)) { cat.count++; cat.size += f.size; found = true; break }
                  }
                  if (!found) { catMap['其他'].count++; catMap['其他'].size += f.size }
                }
                const categories = Object.entries(catMap).filter(([, c]) => c.count > 0).map(([name, c]) => ({ name, pattern: c.exts.slice(0, 5).join(', ') + (c.exts.length > 5 ? '…' : ''), fileCount: c.count, totalSize: c.size }))
                updateToolPart(aiMsgId, 'tool-categorizeFiles', {}, (p: any) => { p.state = 'done'; p.output = { categories } })
                scrollBottom()
                return { categoryCount: categories.length }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-categorizeFiles', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '分析失败' })
                scrollBottom()
                return { error: e?.message }
              }
            },
          },

	          moveFiles: {
	            description: '移动文件到指定目录（需要用户确认）',
	            inputSchema: z.object({ files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string() })), targetDir: z.string() }),
	            permission: 'write',
	            execute: async (args: any) => {
              const { files, targetDir } = args
              if (!files?.length) return { total: 0, success: 0 }
              const unsupported = validateFileTool(files, 'moveFiles')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, { type: 'tool-moveFiles', state: 'confirm', input: { files, targetDir } } as MessagePart)
              scrollBottom()
	              return { pending: true }
	            },
	          },

	          organizeFiles: {
	            description: '移动整理文件；mode=moveToParent 整体上移一层，mode=flatten 拆开文件夹到目标目录，mode=moveToDir 移动到指定目录；需要用户确认',
	            inputSchema: z.object({
	              mode: z.enum(['moveToParent', 'flatten', 'moveToDir']).describe('整理方式'),
	              files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string(), parentFileId: z.string().optional() })),
	              targetDir: z.string().optional().describe('目标目录 ID；moveToParent 可不传，默认使用第一个文件的 parentFileId')
	            }),
	            permission: 'write',
	            execute: async (args: any) => {
	              const files = args.files || []
	              if (!files.length) return { total: 0, success: 0 }
                const unsupported = validateFileTool(files, 'organizeFiles')
                if (unsupported) return { error: unsupported }
	              const targetDir = args.targetDir || files[0]?.parentFileId || ''
	              if (!targetDir) return { pending: false, error: 'missing targetDir' }
	              appendPart(aiMsgId, { type: 'tool-organizeFiles', state: 'confirm', input: { mode: args.mode || 'moveToDir', files, targetDir } } as MessagePart)
	              scrollBottom()
	              return { pending: true, total: files.length, mode: args.mode || 'moveToDir' }
	            },
	          },

	          mediaOrganizeFiles: {
	            description: '按影视命名规则进行媒体整理，自动创建 电影/电视剧/动漫/综艺 等目录并移动媒体文件或文件夹；需要用户确认',
	            inputSchema: z.object({
	              files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string(), isDir: z.boolean().optional() })),
	              rootParentId: z.string().describe('整理根目录 ID，通常是当前目录 ID')
	            }),
	            permission: 'write',
	            execute: async (args: any) => {
	              const files = args.files || []
	              if (!files.length || !args.rootParentId) return { total: 0, success: 0, error: 'missing files or rootParentId' }
                const unsupported = validateFileTool(files, 'mediaOrganizeFiles')
                if (unsupported) return { error: unsupported }
	              const plans = buildMediaOrganizePlan(files.map((file: any) => ({ userId: file.userId, driveId: file.driveId, fileId: file.fileId, name: file.name, isDir: !!file.isDir })), args.rootParentId)
	              if (!plans.length) return { pending: false, total: 0, error: '没有识别到可整理的媒体文件或文件夹' }
	              appendPart(aiMsgId, { type: 'tool-organizeFiles', state: 'confirm', input: { mode: 'media', files, targetDir: args.rootParentId, plans } } as MessagePart)
	              scrollBottom()
	              return { pending: true, total: plans.length, preview: plans.slice(0, 8).map(plan => ({ name: plan.name, targetPath: plan.targetPath })) }
	            },
	          },

	          getTMDBMovies: {
            description: '从 TMDB 获取电影数据（热映、流行、高分），获取最新电影和电视剧信息',
            inputSchema: z.object({
              category: z.enum(['trending','popular','top_rated']).optional().describe('类别：trending=热映, popular=流行, top_rated=高分'),
              page: z.number().optional().describe('页码，默认1'),
            }),
            permission: 'read',
            execute: async (args: any) => {
              const category: string = args.category || 'trending'
              const page = args.page || 1
              const labelMap: Record<string, string> = { trending: 'TMDB 热映', popular: 'TMDB 流行', top_rated: 'TMDB 高分' }
              const label = labelMap[category] || 'TMDB 电影'
              appendPart(aiMsgId, { type: 'tool-getMovies', state: 'loading', category: label } as MessagePart)
              scrollBottom()
              let items: { title: string; desc: string }[] = []
              try {
                let movieResults: any[] = []
                let tvResults: any[] = []

                if (category === 'top_rated') {
                  const resp = await fetch(`${TMDB_BASE_URL}/movie/top_rated?language=zh-CN`)
                  const data = await resp.json()
                  if (data?.code === 0) {
                    movieResults = data.movies || []
                    tvResults = data.tv || []
                  }
                } else {
                  const typeMap: Record<string, string[]> = {
                    trending: ['/trending/movie/week', '/trending/tv/week'],
                    popular: ['/movie/popular', '/tv/popular'],
                  }
                  const endpoints = typeMap[category] || ['/trending/movie/week', '/trending/tv/week']
                  const [movieResp, tvResp] = await Promise.all([
                    fetch(`${TMDB_BASE_URL_PROXY}${endpoints[0]}?language=zh-CN&page=${page}`),
                    fetch(`${TMDB_BASE_URL_PROXY}${endpoints[1]}?language=zh-CN&page=${page}`),
                  ])
                  const movieData = await movieResp.json()
                  const tvData = await tvResp.json()
                  if (movieData?.results) movieResults = movieData.results
                  if (tvData?.results) tvResults = tvData.results
                }

                const movieItems = movieResults.slice(0, 25).map((m: any) => ({
                  id: String(m.id || ''),
                  title: m.title || m.name || '',
                  cover: tmdbImageUrl(m.poster_path),
                  desc: `评分: ${m.vote_average?.toFixed(1) || '?'} · ${(m.release_date || m.first_air_date || '').slice(0, 4)}`,
                  url: `https://www.themoviedb.org/movie/${m.id}`,
                }))
                const tvItems = tvResults.slice(0, 10).map((t: any) => ({
                  id: String(t.id || ''),
                  title: `📺 ${t.name || t.title || ''}`,
                  cover: tmdbImageUrl(t.poster_path),
                  desc: `评分: ${t.vote_average?.toFixed(1) || '?'} · ${(t.first_air_date || '').slice(0, 4)}`,
                  url: `https://www.themoviedb.org/tv/${t.id}`,
                }))
                const allItems = [...movieItems, ...tvItems]
                items = allItems.map(i => ({ title: i.title, desc: i.desc }))

                if (movieItems.length || tvItems.length) {
                  updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'done'; p.category = `${label} · ${movieItems.length + tvItems.length}部`; p.movies = movieItems; p.tv = tvItems })
                } else {
                  updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'error'; p.error = '获取失败' })
                }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '请求失败' })
              }
              scrollBottom()
              return { category: label, total: items.length, items }
            },
          },

          getDoubanMovies: {
            description: '获取豆瓣电影排行榜（Top250、新片榜、口碑榜、北美票房），用户想看热门电影或了解最近什么电影好看时调用',
            inputSchema: z.object({ category: z.enum(['douban-top250','douban-movie','douban-weekly','douban-us-box']).optional().describe('排行榜类别，默认douban-top250') }),
            permission: 'read',
            execute: async (args: any) => {
              const category = args.category || 'douban-top250'
              appendPart(aiMsgId, { type: 'tool-getMovies', state: 'loading', category } as MessagePart)
              scrollBottom()
              let items: { title: string; desc: string }[] = []
              try {
                const resp = await fetch(`${getBoxPlayerAPIBaseURL()}/api/douban-hot?category=${category}&page=1&limit=25`)
                const data = await resp.json()
                if (data?.code === 0 && data?.data?.items) {
                  const movies = data.data.items.map((item: any) => ({ id: String(item.id || ''), title: item.title || '', cover: item.cover || '', desc: item.desc || '', url: item.url || '' }))
                  items = movies.map((m: any) => ({ title: m.title, desc: m.desc }))
                  updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'done'; p.category = category; p.movies = movies })
                } else {
                  updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'error'; p.error = data?.message || '获取电影数据失败' })
                }
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '请求失败' })
              }
              scrollBottom()
              return { category, total: items.length, items }
            },
          },

          searchTMDB: {
            description: '在 TMDB 中搜索电影和电视剧，查询详细的影视信息',
            inputSchema: z.object({ query: z.string().describe('搜索关键词') }),
            permission: 'read',
            execute: async (args: any) => {
              const query = args.query
              appendPart(aiMsgId, { type: 'tool-getMovies', state: 'loading', category: `搜索: ${query}` } as MessagePart)
              scrollBottom()
              let items: { title: string; desc: string }[] = []
              try {
                const [movieResp, tvResp] = await Promise.all([
                  fetch(`${TMDB_BASE_URL_PROXY}/search/movie?query=${encodeURIComponent(query)}&language=zh-CN`),
                  fetch(`${TMDB_BASE_URL_PROXY}/search/tv?query=${encodeURIComponent(query)}&language=zh-CN`),
                ])
                const movieData = await movieResp.json()
                const tvData = await tvResp.json()
                const movieResults: any[] = movieData?.results || []
                const tvResults: any[] = tvData?.results || []

                const movies = movieResults.slice(0, 10).map((m: any) => ({
                  id: String(m.id || ''),
                  title: m.title || '',
                  cover: tmdbImageUrl(m.poster_path),
                  desc: `评分: ${m.vote_average?.toFixed(1) || '?'} · ${(m.release_date || '').slice(0, 4)}`,
                  url: `https://www.themoviedb.org/movie/${m.id}`,
                }))
                const tvItems = tvResults.slice(0, 10).map((t: any) => ({
                  id: String(t.id || ''),
                  title: `📺 ${t.name || ''}`,
                  cover: tmdbImageUrl(t.poster_path),
                  desc: `评分: ${t.vote_average?.toFixed(1) || '?'} · ${(t.first_air_date || '').slice(0, 4)}`,
                  url: `https://www.themoviedb.org/tv/${t.id}`,
                }))
                const allResults = [...movies, ...tvItems]
                items = allResults.map((m: any) => ({ title: m.title, desc: m.desc }))
                updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'done'; p.category = `搜索: ${query} · ${allResults.length}个结果`; p.movies = movies; p.tv = tvItems })
              } catch (e: any) {
                updateToolPart(aiMsgId, 'tool-getMovies', {}, (p: any) => { p.state = 'error'; p.error = e?.message || '请求失败' })
              }
              scrollBottom()
              return { query, total: items.length, items }
            },
          },

	          deleteFiles: {
	            description: '将文件移入回收站（需要用户确认）；仅支持明确有回收站能力的网盘，不支持的网盘会拒绝执行',
            inputSchema: z.object({ files: z.array(z.object({ name: z.string(), fileId: z.string(), driveId: z.string(), userId: z.string() })) }),
            permission: 'destructive',
            execute: async (args: any) => {
              const { files } = args
              if (!files?.length) return { total: 0, success: 0 }
              const unsupported = validateFileTool(files, 'deleteFiles')
              if (unsupported) return { error: unsupported }
              appendPart(aiMsgId, { type: 'tool-deleteFiles', state: 'confirm', input: { files } } as MessagePart)
              scrollBottom()
              return { pending: true }
            },
          },
        },
        toolAllowlist: storageAnalysisWorkflow
          ? (selectedReadOnlyWorkflow ? ['analyzeStorage'] : ['listDrives', 'analyzeStorage'])
          : largeFileWorkflow
            ? (selectedReadOnlyWorkflow ? ['scanDriveLargeFiles'] : ['listDrives', 'scanDriveLargeFiles'])
            : duplicateFileWorkflow
              ? (selectedReadOnlyWorkflow ? ['findDuplicates'] : ['listDrives', 'findDuplicates'])
              : categorizeFilesWorkflow
                ? (selectedReadOnlyWorkflow ? ['categorizeFiles'] : ['listDrives', 'categorizeFiles'])
                : emptyDirectoryWorkflow
                  ? (selectedReadOnlyWorkflow ? ['scanDriveEmptyDirs'] : ['listDrives', 'scanDriveEmptyDirs'])
                  : duplicateCardDeleteWorkflow
                    ? ['deleteFiles']
                    : undefined,
        requireToolCall: storageAnalysisWorkflow || largeFileWorkflow || duplicateFileWorkflow || categorizeFilesWorkflow || emptyDirectoryWorkflow || duplicateCardDeleteWorkflow,
        maxTurns: selectedReadOnlyWorkflow || duplicateCardDeleteWorkflow ? 2 : 8,
        maxToolCalls: selectedReadOnlyWorkflow || duplicateCardDeleteWorkflow ? 1 : 8,
        shouldStopAfterToolResult: ({ toolName, result }) => {
          const details = (result as any)?.details || result
          if (toolName === 'listDrives' && details?.awaitingSelection) return '等待用户选择网盘账号'
          if (['analyzeStorage', 'scanDriveLargeFiles', 'categorizeFiles', 'findDuplicates', 'scanDriveEmptyDirs'].includes(toolName)) return '扫描已结束'
          if (toolName === 'deleteFiles' && details?.pending) return '等待用户确认删除'
          return undefined
        },
        signal: abortController?.signal,
        requestApproval: async request => {
          // These tools only create an existing Vue confirmation card; the actual mutation happens after the user confirms that card.
          if (deferredApprovalTools.has(request.toolName)) return true
          return window.confirm(`允许 AI 执行“${request.toolName}”操作吗？\n\n参数：${JSON.stringify(request.args).slice(0, 500)}`)
        },
        onEvent: async event => {
          if (event.type === 'tool_complete' && agentV1WorkflowId) {
            await recordAiSearchV1Evidence({ sessionId, runId: agentV1RunId, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, result: event.result })
          }
          if (event.type === 'text_delta') {
            if (textPart?.blocked) return
            if (!textPart) {
              textPart = { type: 'text', text: '' }
              appendPart(aiMsgId, textPart)
            }
            textPart.text += event.text
            if (isInternalAgentText(textPart.text)) {
              textPart.blocked = true
              removePart(aiMsgId, textPart)
              abortController?.abort()
            }
            scrollBottom()
          }
          if (event.type === 'error') {
            agentV1Error = event.message || 'AI 搜索对话失败'
            if (textPart?.blocked) return
            if (!textPart) {
              textPart = { type: 'text', text: '' }
              appendPart(aiMsgId, textPart)
            }
            const errorMessage = event.message === 'Maximum agent turns reached.'
              ? '任务步骤超出限制，已停止继续执行。'
              : event.message === 'Repeated tool call limit reached.'
                ? '检测到重复工具调用，已停止继续执行。'
                : isBoxPlayerCloudProvider(config.providerName) ? mapBoxPlayerCloudAIError(event.message) : event.message
            textPart.text += `${textPart.text ? '\n\n' : ''}❌ ${errorMessage || 'AI 请求失败'}`
            scrollBottom()
          }
        }
      })
      if (agentV1WorkflowId) await finishAiSearchV1Audit(sessionId, agentV1RunId, agentV1Cancelled ? 'cancelled' : agentV1Error ? 'failed' : 'completed', agentV1Cancelled ? 'AI 搜索对话已取消' : agentV1Error || 'AI 搜索对话已结束')
    } catch (e: any) {
      if (agentV1WorkflowId) await finishAiSearchV1Audit(sessionId, agentV1RunId, e?.name === 'AbortError' ? 'cancelled' : 'failed', e?.name === 'AbortError' ? 'AI 搜索对话已取消' : e?.message || 'AI 搜索对话失败')
      if (e?.name === 'AbortError') return
      appendPart(aiMsgId, {
        type: 'text',
        text: `\n\n❌ ${isBoxPlayerCloudProvider(config.providerName) ? mapBoxPlayerCloudAIError(e?.message) : e?.message || 'AI 请求失败'}`,
      })
    } finally {
      if (runId === activeRun) {
        loading.value = false
        abortController = null
      }
      saveCurrentHistory(messages.value)
    }
  }

  function stop() {
    activeRun++
    abortController?.abort()
    abortController = null
    loading.value = false
  }

  function clear() {
    stop()
    messages.value = []
    persistThreads()
  }

  async function confirmAction(msgId: string, partIndex: number) {
    const msg = messages.value.find(m => m.id === msgId)
    if (!msg) return
    const part = msg.parts[partIndex] as any
	    if (!part || (part.type !== 'tool-moveFiles' && part.type !== 'tool-organizeFiles' && part.type !== 'tool-deleteFiles' && part.type !== 'tool-miaochuan' && part.type !== 'tool-guangyaMagnets' && part.type !== 'tool-guangyaEmptyDirs')) return
    if (part.state !== 'confirm') return
    part.state = 'running'
    scrollBottom()
    try {
      if (part.type === 'tool-moveFiles' || part.type === 'tool-deleteFiles' || (part.type === 'tool-organizeFiles' && (part.input?.mode || 'moveToDir') === 'moveToDir')) {
        const submitted = await submitAiSearchV1Write(msgId, partIndex, part)
        if (submitted) return
      }
      if (part.type === 'tool-miaochuan') {
        const account = part.input?.userId ? { userId: part.input.userId, driveId: 'guangya' } : null
        if (!account || UserDAL.GetUserToken(account.userId)?.tokenfrom !== 'guangya') throw new Error('所选光鸭云盘账号已失效，请重新选择')
        const files = part.input?.files || []
        const result = await apiGuangyaImportMiaochuan(account.userId, part.input?.parentId || 'guangya_root', files)
        part.state = 'done'
        part.output = {
          total: result.total,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
          report: `导入完成：成功 ${result.success}/${result.total}，失败 ${result.failed}，跳过 ${result.skipped}${result.failures.length ? `\n失败示例：${result.failures.slice(0, 5).map(item => `${item.path}(${item.reason})`).join('；')}` : ''}`
        }
        scrollBottom()
        saveCurrentHistory(messages.value)
        return
      }
      if (part.type === 'tool-guangyaMagnets') {
        const account = part.input?.userId ? { userId: part.input.userId, driveId: 'guangya' } : null
        if (!account || UserDAL.GetUserToken(account.userId)?.tokenfrom !== 'guangya') throw new Error('所选光鸭云盘账号已失效，请重新选择')
        const result = await importGuangyaMagnets(account.userId, part.input?.parentId || 'guangya_root', part.input?.text || '')
        part.state = 'done'
        part.output = { total: result.total, success: result.success, failed: result.failed, report: result.report }
        scrollBottom()
        saveCurrentHistory(messages.value)
        return
      }
      if (part.type === 'tool-guangyaEmptyDirs') {
        const result = await deleteDriveEmptyDirs(part.input?.dirs || [])
        part.state = 'done'
        part.output = { total: result.total, success: result.success, failed: result.failed, report: result.report }
        scrollBottom()
        saveCurrentHistory(messages.value)
        return
      }
	      const { files, targetDir } = part.input || {}
	      const userId = files[0]?.userId
	      const driveId = files[0]?.driveId
	      const fileIds = files.map((f: any) => f.fileId)
	      if (part.type === 'tool-moveFiles') {
	        if (files.some((file: any) => file.driveId !== driveId || file.userId !== userId)) throw new Error('移动文件必须来自同一个网盘账号')
	        const result = await moveDriveToolFiles(files.map((file: any) => ({ userId: file.userId, driveId: file.driveId, fileId: file.fileId, name: file.name } as OrganizeFileItem)), targetDir || 'root', driveId)
	        part.state = 'done'
	        part.output = { total: result.total, success: result.success, failed: result.failed, report: result.report }
	      } else if (part.type === 'tool-organizeFiles') {
	        if (files.some((file: any) => file.driveId !== driveId || file.userId !== userId)) throw new Error('整理文件必须来自同一个网盘账号')
	        const items = files.map((file: any) => ({ userId: file.userId, driveId: file.driveId, fileId: file.fileId, name: file.name } as OrganizeFileItem))
	        const mode = part.input?.mode || 'moveToDir'
	        const result = mode === 'flatten'
	          ? await flattenDriveToolFolders(items, targetDir || 'root', driveId)
	          : mode === 'media'
	            ? await executeMediaOrganizePlan(part.input?.plans || buildMediaOrganizePlan(files.map((file: any) => ({ userId: file.userId, driveId: file.driveId, fileId: file.fileId, name: file.name, isDir: !!file.isDir })), targetDir || 'root'), targetDir || 'root')
	            : await moveDriveToolFiles(items, targetDir || 'root', driveId)
	        part.state = 'done'
	        part.output = { total: result.total, success: result.success, failed: result.failed, report: result.report }
	      } else {
	        const groups = new Map<string, any[]>()
	        for (const file of files) {
	          const key = `${file.userId}\n${file.driveId}`
	          groups.set(key, [...(groups.get(key) || []), file])
	        }
	        let success = 0
	        const unsupported: string[] = []
	        for (const [key, group] of groups) {
	          const [groupUserId, groupDriveId] = key.split('\n')
	          if (!driveSupportsRecycleBin(groupUserId, groupDriveId)) {
	            unsupported.push(...group.map((file: any) => `${file.name}(${groupDriveId})`))
	            continue
	          }
	          const successIds = await AliFileCmd.ApiTrashBatch(groupUserId, groupDriveId, group.map((file: any) => file.fileId))
	          success += successIds.length
	        }
	        const failed = files.length - success
	        part.state = 'done'
	        part.output = {
	          total: files.length,
	          success,
	          failed,
	          report: unsupported.length
	            ? `已跳过 ${unsupported.length} 个不支持安全移入回收站的文件：${unsupported.slice(0, 8).join('；')}${unsupported.length > 8 ? '…' : ''}`
	            : `已移入回收站：成功 ${success}/${files.length}${failed ? `，失败 ${failed}` : ''}`
	        }
	      }
    } catch (e: any) {
      part.state = 'error'
      part.error = e?.message || '操作失败'
    }
    scrollBottom()
    saveCurrentHistory(messages.value)
  }

  async function submitAiSearchV1Write(msgId: string, partIndex: number, part: any): Promise<boolean> {
    const files = Array.isArray(part.input?.files) ? part.input.files : []
    const userId = files[0]?.userId
    const driveId = files[0]?.driveId
    if (!userId || !driveId || files.some((file: any) => file.userId !== userId || file.driveId !== driveId)) return false
    const account = UserDAL.GetUserToken(userId)
    if (!account) throw new Error('所选网盘账号已失效，请重新选择')
    const result = await confirmAiSearchV1Write({
      confirmationId: `${activeThreadId.value}:${msgId}:${partIndex}`,
      kind: part.type === 'tool-deleteFiles' ? 'trash' : 'move',
      target: { userId, driveId, platform: normalizeDriveToolPlatform(account.tokenfrom || 'aliyun'), rootId: driveToolRootIdFor(driveId) },
      fileIds: files.map((file: any) => String(file.fileId)),
      targetParentFileId: part.type === 'tool-deleteFiles' ? undefined : String(part.input?.targetDir || '')
    })
    if (!result) return false
    part.output = { total: files.length, success: 0, failed: 0, report: '已生成 Agent V1 执行计划，正在进行执行前校验…' }
    scrollBottom()
    saveCurrentHistory(messages.value)
    void watchAiSearchV1Write(msgId, partIndex, result.workflowId)
    return true
  }

  async function watchAiSearchV1Write(msgId: string, partIndex: number, workflowId: string): Promise<void> {
    // Match the default execution-grant lifetime. Large confirmed batches may
    // need several minutes because every item is re-read before the write.
    let reconcilingPolls = 0
    for (let attempt = 0; attempt < 600; attempt++) {
      await new Promise(resolve => window.setTimeout(resolve, 1_000))
      const workflow = await getAgentV1Workflow(workflowId)
      const message = messages.value.find(item => item.id === msgId)
      const part = message?.parts[partIndex] as any
      if (!workflow || !part || part.state !== 'running') return
      // The executor reads the drive back right after an unknown outcome, so only a lasting pause is reported.
      reconcilingPolls = workflow.executionGrant?.status === 'reconciling' ? reconcilingPolls + 1 : 0
      if (reconcilingPolls >= 10) {
        const unsettled = workflow.receipts.filter(item => item.status === 'pending' || item.status === 'unknown').length
        part.state = 'error'
        part.error = `Agent V1 无法确认 ${unsettled} 项操作是否已生效，已暂停执行。请在网盘中核对这些文件的位置。`
        scrollBottom()
        saveCurrentHistory(messages.value)
        return
      }
      if (workflow.status !== 'completed' && workflow.status !== 'failed' && workflow.status !== 'cancelled' && workflow.status !== 'expired') continue
      const success = workflow.receipts.filter(item => item.status === 'succeeded').length
      const failed = workflow.receipts.filter(item => item.status === 'failed').length
      if (workflow.status === 'completed') {
        part.state = 'done'
        part.output = { total: workflow.plan?.actions.length || success + failed, success, failed, report: `Agent V1 已完成：成功 ${success}${failed ? `，失败 ${failed}` : ''}` }
      } else {
        part.state = 'error'
        part.error = workflow.events.at(-1)?.message || `Agent V1 执行${workflow.status === 'expired' ? '已过期' : '失败'}`
      }
      scrollBottom()
      saveCurrentHistory(messages.value)
      return
    }
  }

  function cancelAction(msgId: string, partIndex: number) {
    const msg = messages.value.find(m => m.id === msgId)
    if (!msg) return
    const part = msg.parts[partIndex] as any
	    if (part && (part.type === 'tool-moveFiles' || part.type === 'tool-organizeFiles' || part.type === 'tool-deleteFiles' || part.type === 'tool-miaochuan' || part.type === 'tool-guangyaMagnets' || part.type === 'tool-guangyaEmptyDirs') && part.state === 'confirm') {
      part.state = 'done'
      part.output = { total: part.input?.files?.length || part.input?.magnets?.length || part.input?.dirs?.length || 0, success: 0, failed: 0, report: '已取消' }
    }
    saveCurrentHistory(messages.value)
  }

  return { messages, loading, memories, activeDocument, threads, activeThreadId, setDocumentContext, openConversation, newConversation, deleteConversation, sendMessage, stop, clear, refreshMemories, removeMemory, confirmAction, cancelAction }
}
