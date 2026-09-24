import { AppWindow, createElectronWindow, createReaderWindow, Referer, ua } from './window'
import path from 'path'
import is from 'electron-is'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, net, powerSaveBlocker, session, shell } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { exec, execFile, spawn, SpawnOptions } from 'child_process'
import os from 'os'
import { ShowError } from './dialog'
import { getAsarPath, getStaticPath, getUserDataPath } from '../utils/mainfile'
import { registerMediaImageCacheIpc } from '../mediaImageCache'
import { createHash } from 'crypto'
import { getMotrixApplicationRpcPort } from '../aria/runtime'
import { request as httpsRequest } from 'https'
import { requestPanHub, requestPanHubStream } from './panHubRequest'
import { embeddedMpvBridge } from '../mpv/embeddedMpvBridge'
import {
  getBookMeta,
  isBookIndexed,
  clearBookData,
  storeChunks,
  storeEmbeddings,
  storeMeta,
  hybridSearch,
  getBookChunks,
  writeMemory,
  searchMemories,
  listMemories,
  deleteMemory,
  listSkills,
  getSkill,
  setSkillEnabled,
  recordMetric,
  getMetrics,
  wipeAllData,
  destroyDb
} from '../reedy/ReedyService'
import { addMediaAcquisitionCandidate, addMediaAcquisitionEvent, beginMediaAcquisitionCandidateVerification, beginMediaAcquisitionOrganizing, beginMediaAcquisitionSearch, cancelMediaAcquisitionRun, claimRunnableMediaAcquisitionRun, clearCompletedMediaAcquisitionRuns, clearMediaAcquisitionNotifications, completeMediaAcquisitionCandidate, completeMediaAcquisitionRun, continueMediaAcquisitionAfterPartial, createMediaAcquisitionRun, createMediaAcquisitionTracking, endMediaAcquisitionTracking, failMediaAcquisitionCandidate, failMediaAcquisitionRun, finishMediaAcquisitionSearchWithoutCandidates, forceCancelMediaAcquisitionRun, getMediaAcquisitionAgentSandbox, getMediaAcquisitionAgentSession, getMediaAcquisitionCandidateBaseline, getMediaAcquisitionTarget, listMediaAcquisitionNotifications, listMediaAcquisitionRuns, listMediaAcquisitionStates, listMediaAcquisitionTracking, listRunnableMediaAcquisitionRuns, markMediaAcquisitionCandidateTransferring, markMediaAcquisitionNoCoverage, markMediaAcquisitionNotificationsRead, partialMediaAcquisitionCandidate, recordMediaAcquisitionCandidateBaseline, recordMediaAcquisitionExternalTask, recordMediaAcquisitionTransferIntent, releaseMediaAcquisitionRunClaim, renewMediaAcquisitionRunClaim, retryMediaAcquisitionCandidate, retryMediaAcquisitionSearch, saveMediaAcquisitionAgentSandbox, saveMediaAcquisitionAgentSession, selectMediaAcquisitionCandidate, updateMediaAcquisitionExternalTaskProgress, upsertMediaAcquisitionTracking } from '../mediaAcquisition/MediaAcquisitionService'
import { getMediaAcquisitionProviderTransferStatus, submitMediaAcquisitionExternalUrl, submitMediaAcquisitionProviderShareImport, submitMediaAcquisitionProviderTransfer } from '../mediaAcquisition/MediaProviderAdapter'
import type { CreateMediaAcquisitionCandidateInput, CreateMediaAcquisitionRunInput, CreateMediaAcquisitionTrackingInput, MediaAcquisitionEvent, MediaAcquisitionFileSnapshot, MediaAcquisitionPhase } from '@shared/types/mediaAcquisition'
import { getAssrtSubtitleFiles, searchAssrtSubtitles } from '../mediaAcquisition/assrt'
import { addWorkspaceEvidence, addWorkspaceEvent, approveWorkspacePlan, archiveWorkspaceTask, cancelWorkspaceTask, completeWorkspaceTask, createWorkspaceTask, getWorkspaceTask, getWorkspaceTaskV1Audit, listWorkspaceTasks, rejectWorkspacePlan, restoreWorkspaceTask, resumeWorkspaceTask, saveWorkspacePlan, updateWorkspacePlanSelection } from '../workspaceAgent/WorkspaceAgentService'
import type { CreateWorkspacePlanInput, CreateWorkspaceTaskInput, UpdateWorkspacePlanSelectionInput, WorkspaceExecutionEvent } from '@shared/types/workspaceAgent'
import { agentV1Status, getAgentWorkflow } from '../agent/AgentControlService'
import { beginAiSearchV1Audit, collectAiSearchStorageStats, confirmAiSearchV1Write, finishAiSearchV1Audit, recordAiSearchV1Evidence, type BeginAiSearchV1AuditInput, type RecordAiSearchV1EvidenceInput } from '../aiSearch/AiSearchV1Bridge'
import { beginMediaAcquisitionV1Transfer, completeMediaAcquisitionV1Transfer, type MediaAcquisitionTransferTicket } from '../mediaAcquisition/MediaAcquisitionV1Bridge'
import { beginDocumentV1Audit, finishDocumentV1Audit, recordDocumentV1Citation, type DocumentAgentV1Source } from '../documentInsight/DocumentAgentV1Bridge'
import { runBundledCloudDriveCli } from '../agent/CloudDriveCliGateway'
import { completeDocumentReadingUnit, createDocumentReadingJob, failDocumentReadingUnit, getDocumentReadingJob, listDocumentReadingJobs, setDocumentReadingJobStatus } from '../documentInsight/DocumentReadingService'
import type { CreateDocumentReadingJobInput, DocumentReadingJobStatus } from '@shared/types/documentReading'
import { downloadAndExtractPdf } from '../documentInsight/PdfExtractionService'
import { sendPdfProgress } from '../documentInsight/pdfProgress'
import { buildQuarkCookieHeader, mergeQuarkCookieHeaders } from '@shared/quarkCookies'
import { resolveCloudDriveCliConfigDir } from './cliConfigPath'

let psbId: any
const panHubStreamControllers = new Map<string, AbortController>()

const QUARK_DOWNLOAD_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch'

const getQuarkSessionCookieHeader = async (targetUrl: string) => {
  const cookies = await session.defaultSession.cookies.get({ url: targetUrl })
  return buildQuarkCookieHeader(cookies, targetUrl)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function pathToFileUrl(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, '/')
  return 'file://' + (normalized.startsWith('/') ? normalized : '/' + normalized)
}

function findSoffice(): string {
  const candidates = [
    process.env.LIBREOFFICE_PATH || '',
    process.env.SOFFICE_PATH || '',
    is.macOS() ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : '',
    is.windows() ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : '',
    is.windows() ? 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe' : '',
    '/usr/bin/libreoffice',
    '/usr/local/bin/libreoffice',
    '/opt/homebrew/bin/libreoffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice'
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const names = is.windows() ? ['soffice.exe', 'libreoffice.exe'] : ['soffice', 'libreoffice']
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

function convertOfficeFileToPdf(soffice: string, inputPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const userInstall = path.join(outDir, 'lo-profile').replace(/\\/g, '/')
    const args = [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      `-env:UserInstallation=file://${userInstall}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      inputPath
    ]
    execFile(soffice, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message || '').trim() || 'LibreOffice 转换失败'))
      } else {
        resolve()
      }
    })
  })
}

function pushCliOption(argv: string[], flag: string, value: unknown) {
  if (value === undefined || value === null || value === '' || value === false) return
  if (value === true) {
    argv.push(flag)
    return
  }
  argv.push(flag, String(value))
}

function buildOpenDataLoaderPdfArgv(data: any): string[] {
  const inputPath = String(data?.inputPath || '')
  const outputDir = String(data?.outputDir || '')
  if (!inputPath) throw new Error('请选择要转换的 PDF 文件或文件夹')
  // if (!outputDir) throw new Error('请选择输出文件夹')
  const argv = ['docs', 'convert', inputPath, '--output', outputDir, '--json']
  if (!data?.format) argv.push('--pdf-format', 'json,html,markdown,text')
  const optionMap: Array<[string, string]> = [
    ['format', '--pdf-format'],
    ['password', '--pdf-password'],
    ['contentSafetyOff', '--pdf-content-safety-off'],
    ['replaceInvalidChars', '--pdf-replace-invalid-chars'],
    ['tableMethod', '--pdf-table-method'],
    ['readingOrder', '--pdf-reading-order'],
    ['markdownPageSeparator', '--pdf-markdown-page-separator'],
    ['textPageSeparator', '--pdf-text-page-separator'],
    ['htmlPageSeparator', '--pdf-html-page-separator'],
    ['imageOutput', '--pdf-image-output'],
    ['imageFormat', '--pdf-image-format'],
    ['imageDir', '--pdf-image-dir'],
    ['pages', '--pdf-pages'],
    ['hybrid', '--pdf-hybrid'],
    ['hybridMode', '--pdf-hybrid-mode'],
    ['hybridUrl', '--pdf-hybrid-url'],
    ['hybridTimeout', '--pdf-hybrid-timeout'],
    ['hybridHancomAiRegionlistStrategy', '--pdf-hybrid-hancom-ai-regionlist-strategy'],
    ['hybridHancomAiOcrStrategy', '--pdf-hybrid-hancom-ai-ocr-strategy'],
    ['hybridHancomAiImageCache', '--pdf-hybrid-hancom-ai-image-cache'],
    ['threads', '--pdf-threads'],
  ]
  for (const [key, flag] of optionMap) pushCliOption(argv, flag, data?.[key])
  const booleanMap: Array<[string, string]> = [
    ['sanitize', '--pdf-sanitize'],
    ['keepLineBreaks', '--pdf-keep-line-breaks'],
    ['useStructTree', '--pdf-use-struct-tree'],
    ['markdownWithHtml', '--pdf-markdown-with-html'],
    ['includeHeaderFooter', '--pdf-include-header-footer'],
    ['detectStrikethrough', '--pdf-detect-strikethrough'],
    ['hybridFallback', '--pdf-hybrid-fallback'],
    ['toStdout', '--pdf-to-stdout'],
    ['verbose', '--pdf-verbose'],
  ]
  for (const [key, flag] of booleanMap) pushCliOption(argv, flag, data?.[key] === true)
  return argv
}

export default class ipcEvent {
  private constructor() {
  }

  static handleEvents() {
    this.handleWebToElectron()
    this.handleWebToElectronCB()
    this.handleShowContextMenu()
    this.handleWebShowOpenDialogSync()
    this.handleWebShowOpenDialog()
    this.handleWebShowSaveDialogSync()
    this.handleWebShowItemInFolder()
    this.handleWebPlatformSync()
    this.handleWebSpawnSync()
    this.handleWebExecSync()
    this.handleWebSaveTheme()
    this.handleWebClearCookies()
    this.handleWebGetCookies()
    this.handleWebQuarkAccountInfo()
    this.handleWebQuarkFileList()
    this.handleWebQuarkDownloadUrl()
    this.handleWebSetCookies()
    this.handleWebClearCache()
    this.handleWebReload()
    this.handleWebRelaunch()
    this.handleWebRelaunchAria()
    this.handleWebSetProgressBar()
    this.handleWebShutDown()
    this.handleWebSetProxy()
    this.handlePanHubRequest()
    this.handleOfficePreviewConvertToPdf()
    this.handleOpenDataLoaderConvertPdf()
    this.handleWebOpenWindow()
    this.handleWebOpenLyric()
    this.handleWebSendLyric()
    this.handleWebCloseLyric()
    this.handleWebConfigureGlobalHotkeys()
    this.handleWebOpenUrl()
    this.handleExportCliTokens()
    this.handleInstallCli()
    this.handlePowerSaveBlocker()
    this.handleMpvEmbedded()
    if (app.isPackaged) {
      this.installCli(true).catch((err: any) => {
        console.warn('Auto install BoxPlayer CLI failed', err?.message || err)
      })
    }
    registerMediaImageCacheIpc()
    this.handleReedy()
    this.handleMediaAcquisition()
    this.handleDocumentReading()
  }

  private static handleMpvEmbedded() {
    ipcMain.handle('MpvEmbedded:getCapability', async () => embeddedMpvBridge.getCapability())
    ipcMain.handle('MpvEmbedded:load', async (event, data) => embeddedMpvBridge.load(data || {}, event.sender))
    ipcMain.handle('MpvEmbedded:control', async (_event, data) => embeddedMpvBridge.control(data || {}))
    ipcMain.handle('MpvEmbedded:getStatus', async () => embeddedMpvBridge.getStatus())
    ipcMain.on('MpvEmbedded:softwareFrameConsumed', (event) => embeddedMpvBridge.acknowledgeSoftwareFrame?.(event.sender))
  }

  private static handleMediaAcquisition() {
    ipcMain.handle('mediaAcquisition:create', (_event, input: CreateMediaAcquisitionRunInput) => createMediaAcquisitionRun(input))
    ipcMain.handle('mediaAcquisition:list', (_event, limit?: number) => listMediaAcquisitionRuns(limit))
    ipcMain.handle('mediaAcquisition:listStates', () => listMediaAcquisitionStates())
    ipcMain.handle('mediaAcquisition:listRunnable', (_event, limit?: number) => listRunnableMediaAcquisitionRuns(limit))
    ipcMain.handle('mediaAcquisition:claimRunnable', (_event, workerId: string, runId?: string) => claimRunnableMediaAcquisitionRun(workerId, runId))
    ipcMain.handle('mediaAcquisition:releaseClaim', (_event, runId: string, workerId: string) => releaseMediaAcquisitionRunClaim(runId, workerId))
    ipcMain.handle('mediaAcquisition:renewClaim', (_event, runId: string, workerId: string) => renewMediaAcquisitionRunClaim(runId, workerId))
    ipcMain.handle('mediaAcquisition:listTracking', (_event, limit?: number) => listMediaAcquisitionTracking(limit))
    ipcMain.handle('mediaAcquisition:createTracking', (_event, input: CreateMediaAcquisitionTrackingInput) => createMediaAcquisitionTracking(input))
    ipcMain.handle('mediaAcquisition:getTarget', (_event, targetId: string) => getMediaAcquisitionTarget(targetId))
    ipcMain.handle('mediaAcquisition:endTracking', (_event, trackingId: string) => endMediaAcquisitionTracking(trackingId))
    ipcMain.handle('mediaAcquisition:upsertTracking', (_event, data: { targetId: string; seasonNumber: number; totalEpisodes: number; latestAiredEpisode: number; obtainedEpisodeNumbers: number[]; missingEpisodes: number[]; status: 'tracking' | 'complete' | 'ended'; nextCheckAt?: number }) => upsertMediaAcquisitionTracking(data.targetId, data.seasonNumber, data.totalEpisodes, data.latestAiredEpisode, data.obtainedEpisodeNumbers, data.missingEpisodes, data.status, data.nextCheckAt))
    ipcMain.handle('mediaAcquisition:listNotifications', (_event, limit?: number) => listMediaAcquisitionNotifications(limit))
    ipcMain.handle('mediaAcquisition:markNotificationsRead', (_event, ids?: string[]) => markMediaAcquisitionNotificationsRead(ids))
    ipcMain.handle('mediaAcquisition:clearNotifications', () => clearMediaAcquisitionNotifications())
    ipcMain.handle('mediaAcquisition:clearCompletedRuns', () => clearCompletedMediaAcquisitionRuns())
    ipcMain.handle('mediaAcquisition:getAgentSession', (_event, runId: string) => getMediaAcquisitionAgentSession(runId))
    ipcMain.handle('mediaAcquisition:saveAgentSession', (_event, runId: string, messages: unknown[]) => saveMediaAcquisitionAgentSession(runId, messages))
    ipcMain.handle('mediaAcquisition:getAgentSandbox', (_event, runId: string) => getMediaAcquisitionAgentSandbox(runId))
    ipcMain.handle('mediaAcquisition:saveAgentSandbox', (_event, runId: string, state: Record<string, unknown>) => saveMediaAcquisitionAgentSandbox(runId, state))
    ipcMain.handle('mediaAcquisition:cancel', (_event, runId: string) => cancelMediaAcquisitionRun(runId))
    ipcMain.handle('mediaAcquisition:forceCancel', (_event, runId: string) => forceCancelMediaAcquisitionRun(runId))
    ipcMain.handle('mediaAcquisition:beginSearch', (_event, runId: string) => beginMediaAcquisitionSearch(runId))
    ipcMain.handle('mediaAcquisition:finishSearchWithoutCandidates', (_event, runId: string) => finishMediaAcquisitionSearchWithoutCandidates(runId))
    ipcMain.handle('mediaAcquisition:retrySearch', (_event, runId: string, message: string, delayMs: number, maxRetries?: number) => retryMediaAcquisitionSearch(runId, message, delayMs, maxRetries))
    ipcMain.handle('mediaAcquisition:addCandidate', (_event, runId: string, input: CreateMediaAcquisitionCandidateInput) => addMediaAcquisitionCandidate(runId, input))
    ipcMain.handle('mediaAcquisition:submitProviderTransfer', (_event, data: { runId: string; candidateId: string; parentId: string; ticket?: MediaAcquisitionTransferTicket | null }) => submitMediaAcquisitionProviderTransfer(data.runId, data.candidateId, data.parentId, data.ticket))
    ipcMain.handle('mediaAcquisition:submitProviderShareImport', (_event, data: { runId: string; candidateId: string; parentId: string; ticket?: MediaAcquisitionTransferTicket | null }) => submitMediaAcquisitionProviderShareImport(data.runId, data.candidateId, data.parentId, data.ticket))
    ipcMain.handle('mediaAcquisition:submitExternalUrl', (_event, data: { runId: string; parentId: string; url: string; fileName: string }) => submitMediaAcquisitionExternalUrl(data.runId, data.parentId, data.url, data.fileName))
    ipcMain.handle('mediaAcquisition:getProviderTransferStatus', (_event, data: { runId: string; taskId?: string; fileId?: string }) => getMediaAcquisitionProviderTransferStatus(data.runId, data.taskId, data.fileId))
    ipcMain.handle('mediaAcquisition:recordCandidateBaseline', (_event, runId: string, candidateId: string, files: MediaAcquisitionFileSnapshot[]) => recordMediaAcquisitionCandidateBaseline(runId, candidateId, files))
    ipcMain.handle('mediaAcquisition:getCandidateBaseline', (_event, runId: string, candidateId: string) => getMediaAcquisitionCandidateBaseline(runId, candidateId))
    ipcMain.handle('mediaAcquisition:markCandidateTransferring', (_event, runId: string, candidateId: string) => markMediaAcquisitionCandidateTransferring(runId, candidateId))
    ipcMain.handle('mediaAcquisition:recordTransferIntent', (_event, runId: string, candidateId: string, activity: string) => recordMediaAcquisitionTransferIntent(runId, candidateId, activity))
    ipcMain.handle('mediaAcquisition:selectCandidate', (_event, runId: string, candidateId: string, reason: string) => selectMediaAcquisitionCandidate(runId, candidateId, reason))
    ipcMain.handle('mediaAcquisition:recordExternalTask', (_event, runId: string, candidateId: string, taskId?: string, fileId?: string, activity?: string) => recordMediaAcquisitionExternalTask(runId, candidateId, taskId, fileId, activity || '已提交网盘任务，等待完成'))
    ipcMain.handle('mediaAcquisition:updateExternalTask', (_event, runId: string, candidateId: string, progress: number, activity: string) => updateMediaAcquisitionExternalTaskProgress(runId, candidateId, progress, activity))
    ipcMain.handle('mediaAcquisition:retryCandidate', (_event, runId: string, candidateId: string, message: string, delayMs?: number) => retryMediaAcquisitionCandidate(runId, candidateId, message, delayMs))
    ipcMain.handle('mediaAcquisition:noCoverage', (_event, runId: string, reason: string) => markMediaAcquisitionNoCoverage(runId, reason))
    ipcMain.handle('mediaAcquisition:failRun', (_event, runId: string, message: string) => failMediaAcquisitionRun(runId, message))
    ipcMain.handle('mediaAcquisition:beginCandidateVerification', (_event, runId: string, candidateId: string, activity: string) => beginMediaAcquisitionCandidateVerification(runId, candidateId, activity))
    ipcMain.handle('mediaAcquisition:beginOrganizing', (_event, runId: string, activity?: string) => beginMediaAcquisitionOrganizing(runId, activity))
    ipcMain.handle('mediaAcquisition:completeCandidate', (_event, runId: string, candidateId: string, message: string) => completeMediaAcquisitionCandidate(runId, candidateId, message))
    ipcMain.handle('mediaAcquisition:completeRun', (_event, runId: string, message: string, data?: Record<string, unknown>) => completeMediaAcquisitionRun(runId, message, data))
    ipcMain.handle('mediaAcquisition:partialCandidate', (_event, runId: string, candidateId: string, message: string) => partialMediaAcquisitionCandidate(runId, candidateId, message))
    ipcMain.handle('mediaAcquisition:continueAfterPartial', (_event, runId: string, candidateId: string, seasonTargets: Array<{ seasonNumber: number; missingEpisodes: number[] }>, message: string) => continueMediaAcquisitionAfterPartial(runId, candidateId, seasonTargets, message))
    ipcMain.handle('mediaAcquisition:failCandidate', (_event, runId: string, candidateId: string, message: string, continueWithAlternatives?: boolean) => failMediaAcquisitionCandidate(runId, candidateId, message, continueWithAlternatives))
    ipcMain.handle('mediaAcquisition:addEvent', (_event, runId: string, level: MediaAcquisitionEvent['level'], phase: MediaAcquisitionPhase, message: string, data?: Record<string, unknown>) => addMediaAcquisitionEvent(runId, level, phase, message, data))
    ipcMain.handle('mediaAcquisition:assrtSearch', (_event, data: { token?: string; query?: string }) => searchAssrtSubtitles(data?.token, data?.query))
    ipcMain.handle('mediaAcquisition:assrtDetail', (_event, data: { token?: string; subtitleId?: number }) => getAssrtSubtitleFiles(data?.token, data?.subtitleId))
    ipcMain.handle('workspaceAgent:create', (_event, input: CreateWorkspaceTaskInput) => createWorkspaceTask(input))
    ipcMain.handle('workspaceAgent:list', (_event, limit?: number, includeArchived?: boolean) => listWorkspaceTasks(limit, includeArchived))
    ipcMain.handle('workspaceAgent:get', (_event, taskId: string) => getWorkspaceTask(taskId))
    ipcMain.handle('workspaceAgent:getV1Audit', (_event, taskId: string) => getWorkspaceTaskV1Audit(taskId))
    ipcMain.handle('workspaceAgent:addEvidence', (_event, taskId: string, source: string, summary: string, data: Record<string, unknown>) => addWorkspaceEvidence(taskId, source, summary, data))
    ipcMain.handle('workspaceAgent:savePlan', (_event, input: CreateWorkspacePlanInput) => saveWorkspacePlan(input))
    ipcMain.handle('workspaceAgent:approve', (_event, taskId: string, hash: string) => approveWorkspacePlan(taskId, hash))
    ipcMain.handle('workspaceAgent:updateSelection', (_event, input: UpdateWorkspacePlanSelectionInput) => updateWorkspacePlanSelection(input))
    ipcMain.handle('workspaceAgent:reject', (_event, taskId: string, hash: string) => rejectWorkspacePlan(taskId, hash))
    ipcMain.handle('workspaceAgent:complete', (_event, taskId: string, status: 'completed' | 'partial' | 'failed' | 'stale', message: string) => completeWorkspaceTask(taskId, status, message))
    ipcMain.handle('workspaceAgent:cancel', (_event, taskId: string) => cancelWorkspaceTask(taskId))
    ipcMain.handle('workspaceAgent:resume', (_event, taskId: string) => resumeWorkspaceTask(taskId))
    ipcMain.handle('workspaceAgent:archive', (_event, taskId: string) => archiveWorkspaceTask(taskId))
    ipcMain.handle('workspaceAgent:restore', (_event, taskId: string) => restoreWorkspaceTask(taskId))
    ipcMain.handle('workspaceAgent:addEvent', (_event, taskId: string, level: WorkspaceExecutionEvent['level'], message: string, data?: Record<string, unknown>) => addWorkspaceEvent(taskId, level, message, data))
    ipcMain.handle('agentV1:status', () => agentV1Status())
    ipcMain.handle('agentV1:getWorkflow', (_event, workflowId: string) => getAgentWorkflow(workflowId))
    ipcMain.handle('agentV1:aiSearch:beginAudit', (_event, input: BeginAiSearchV1AuditInput) => beginAiSearchV1Audit(input))
    ipcMain.handle('agentV1:aiSearch:recordEvidence', (_event, input: RecordAiSearchV1EvidenceInput) => recordAiSearchV1Evidence(input))
    ipcMain.handle('agentV1:aiSearch:finishAudit', (_event, sessionId: string, runId: string, status?: 'completed' | 'failed' | 'cancelled', message?: string) => finishAiSearchV1Audit(sessionId, runId, status, message))
    ipcMain.handle('agentV1:aiSearch:collectStorageStats', (_event, workflowId: string) => collectAiSearchStorageStats(workflowId))
    ipcMain.handle('agentV1:aiSearch:confirmWrite', (_event, input: import('../aiSearch/AiSearchV1Bridge').ConfirmAiSearchV1WriteInput) => confirmAiSearchV1Write(input))
    ipcMain.handle('agentV1:media:beginTransfer', (_event, runId: string, candidateId: string, reason: string) => beginMediaAcquisitionV1Transfer(runId, candidateId, reason))
    ipcMain.handle('agentV1:media:completeTransfer', (_event, ticket: MediaAcquisitionTransferTicket, success: boolean, message: string) => completeMediaAcquisitionV1Transfer(ticket, success, message))
    ipcMain.handle('agentV1:document:beginAudit', (_event, input: { sessionId: string; runId: string; goal: string; sources: DocumentAgentV1Source[] }) => beginDocumentV1Audit(input))
    ipcMain.handle('agentV1:document:recordCitation', (_event, workflowId: string, input: { sourceId: string; location: string }) => recordDocumentV1Citation(workflowId, input))
    ipcMain.handle('agentV1:document:finishAudit', (_event, workflowId: string, status: 'completed' | 'failed' | 'cancelled', message: string) => finishDocumentV1Audit(workflowId, status, message))
  }

  private static handleDocumentReading() {
    ipcMain.handle('documentReading:create', (_event, input: CreateDocumentReadingJobInput) => createDocumentReadingJob(input))
    ipcMain.handle('documentReading:get', (_event, id: string) => getDocumentReadingJob(id))
    ipcMain.handle('documentReading:listForSource', (_event, sourceId: string) => listDocumentReadingJobs(sourceId))
    ipcMain.handle('documentReading:setStatus', (_event, id: string, status: DocumentReadingJobStatus, errorMessage?: string) => setDocumentReadingJobStatus(id, status, errorMessage))
    ipcMain.handle('documentReading:completeUnit', (_event, input: { jobId: string; index: number; summary: string; keyPoints: string[]; citationLocations: string[] }) => completeDocumentReadingUnit(input))
    ipcMain.handle('documentReading:failUnit', (_event, jobId: string, index: number, message: string) => failDocumentReadingUnit(jobId, index, message))
    ipcMain.handle('documentReading:extractPdf', (event, input: { requestId?: string; url: string; headers?: Record<string, string> }) => downloadAndExtractPdf({ ...input, onProgress: progress => sendPdfProgress(event.sender, input?.requestId || '', progress) }))
  }

  private static handleWebToElectron() {
    ipcMain.on('WebToElectron', async (event, data) => {
      let mainWindow = AppWindow.mainWindow
      if (data.cmd && data.cmd === 'close') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
      } else if (data.cmd && data.cmd === 'relaunch') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy()
          mainWindow = undefined
        }
        try {
          app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
          app.exit(0)
        } catch {
        }
      } else if (data.cmd && data.cmd === 'exit') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy()
          mainWindow = undefined
        }
        try {
          app.exit(0)
        } catch {
        }
      } else if (data.cmd && data.cmd === 'minsize') {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
      } else if (data.cmd && data.cmd === 'open-reader-window') {
        createReaderWindow(data.bookData)
      } else if (data.cmd && data.cmd === 'maxsize') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMaximized()) {
            mainWindow.unmaximize()
          } else {
            mainWindow.maximize()
          }
        }
      } else if (data.cmd && (Object.hasOwn(data.cmd, 'launchStart')
        || Object.hasOwn(data.cmd, 'launchStartShow'))) {
        const launchStart = data.cmd.launchStart
        const launchStartShow = data.cmd.launchStartShow
        const appName = path.basename(process.execPath)
        // 设置开机自启
        const settings: Electron.Settings = {
          openAtLogin: launchStart,
          path: process.execPath
        }
        // 显示主窗口
        if (is.macOS()) {
          settings.openAsHidden = !launchStartShow
        } else {
          settings.args = [
            '--processStart', `${appName}`,
            '--process-start-args', `"--hidden"`
          ]
          !launchStartShow && settings.args.push('--openAsHidden')
        }
        app.setLoginItemSettings(settings)
      } else if (data.cmd && data.cmd === 'preventSleep') {
        if (data.flag) {
          if (psbId && powerSaveBlocker.isStarted(psbId)) {
            return
          }
          psbId = powerSaveBlocker.start('prevent-app-suspension')
        } else {
          if (typeof psbId === 'undefined' || !powerSaveBlocker.isStarted(psbId)) {
            return
          }
          powerSaveBlocker.stop(psbId)
          psbId = undefined
        }
      } else if (data.cmd && data.cmd === 'downloadProgress') {
        const win = AppWindow.mainWindow
        if (win && !win.isDestroyed()) {
          const progress = typeof data.progress === 'number' ? data.progress : -1
          win.setProgressBar(progress)
        }
      } else if (data.cmd && data.cmd === 'downloadCompleted' && data.showNotification !== false) {
        const { Notification } = require('electron') as typeof import('electron')
        if (Notification.isSupported()) {
          const n = new Notification({
            title: '下载完成',
            body: data.fileName ? `${data.fileName} 已下载完成` : '文件下载完成'
          })
          n.on('click', () => { AppWindow.mainWindow?.show(); AppWindow.mainWindow?.focus() })
          n.show()
        }
      } else {
        event.sender.send('ElectronToWeb', 'mainsenddata')
      }
    })
  }

  private static handleWebToElectronCB() {
    ipcMain.on('WebToElectronCB', (event, data) => {
      const mainWindow = AppWindow.mainWindow
      if (data.cmd && data.cmd === 'maxsize') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMaximized()) {
            mainWindow.unmaximize()
            event.returnValue = 'unmaximize'
          } else {
            mainWindow.maximize()
            event.returnValue = 'maximize'
          }
        }
      } else {
        event.returnValue = 'backdata'
      }
    })
  }

  private static handleShowContextMenu() {
    ipcMain.on('show-context-menu', (event, params) => {
      const { showCut, showCopy, showPaste } = params
      const window = BrowserWindow.fromWebContents(event.sender)
      // 制作右键菜单
      let template: Array<Electron.MenuItemConstructorOptions> = [
        // 设置选项是否可见
        { role: 'selectAll', label: '全选' },
        { role: 'copy', label: '复制', visible: showCopy },
        { role: 'cut', label: '剪切', visible: showCut },
        { role: 'paste', label: '粘贴', visible: showPaste },
        { role: 'undo', label: '撤销' }
      ]
      // 显示菜单
      const contextMenu = Menu.buildFromTemplate(template)
      contextMenu.popup({ window })
    })
  }

  private static handleWebShowOpenDialogSync() {
    ipcMain.on('WebShowOpenDialogSync', (event, config) => {
      const window = BrowserWindow.fromWebContents(event.sender) || AppWindow.mainWindow
      event.returnValue = dialog.showOpenDialogSync(window!, config) || []
    })
  }

  private static handleWebShowOpenDialog() {
    ipcMain.handle('WebShowOpenDialog', async (event, config) => {
      const window = BrowserWindow.fromWebContents(event.sender) || AppWindow.mainWindow
      const result = await dialog.showOpenDialog(window!, config)
      return result.canceled ? [] : result.filePaths
    })
  }

  private static handleWebShowSaveDialogSync() {
    ipcMain.on('WebShowSaveDialogSync', (event, config) => {
      dialog.showSaveDialog(AppWindow.mainWindow!, config).then((result) => {
        event.returnValue = result.filePath || ''
      })
    })
  }

  private static handleWebShowItemInFolder() {
    ipcMain.on('WebShowItemInFolder', (event, fullPath) => {
      for (let i = 0; i < 5; i++) {
        if (existsSync(fullPath)) break
        if (fullPath.lastIndexOf(path.sep) > 0) {
          fullPath = fullPath.substring(0, fullPath.lastIndexOf(path.sep))
        } else return
      }
      if (fullPath.length > 2) shell.showItemInFolder(fullPath)
    })
  }

  private static handleWebPlatformSync() {
    ipcMain.on('WebPlatformSync', (event) => {
      const asarPath = app.getAppPath()
      const appPath = app.getPath('userData')
      event.returnValue = {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        appVersion: app.getVersion(),
        execPath: process.execPath,
        appPath: appPath,
        asarPath: asarPath,
        argv0: process.argv0
      }
    })
  }

  private static handleWebSpawnSync() {
    ipcMain.on('WebSpawnSync', (event, data) => {
      try {
        const options: SpawnOptions = {
          shell: true,
          stdio: 'ignore',
          windowsVerbatimArguments: true,
          ...data.options
        }
        const argsToStr = (args: string) => is.windows() ? `"${args}"` : `'${args}'`
        if ((is.windows() || is.macOS()) && !existsSync(data.command)) {
          event.returnValue = { error: '找不到文件' + data.command }
          ShowError('找不到文件', data.command)
        } else {
          let command
          if (is.macOS()) {
            command = `open -a ${argsToStr(data.command)} ${data.command.includes('mpv.app') ? '--args ' : ''}`
          } else {
            command = `${argsToStr(data.command)}`
          }
          const subProcess = spawn(command, data.args, options)
          subProcess.unref()
          event.returnValue = {
            pid: subProcess.pid,
            subProcess: subProcess,
            execCmd: data,
            options: options,
            exitCode: subProcess.exitCode
          }
        }
      } catch (err: any) {
        event.returnValue = { error: err }
      }
    })
  }

  private static handleWebExecSync() {
    ipcMain.on('WebExecSync', (event, data) => {
      try {
        const cmdArguments = []
        cmdArguments.push(data.command)
        if (data.args) cmdArguments.push(...data.args)
        const finalCmd = cmdArguments.join(' ')
        exec(finalCmd, (err: any) => {
          event.returnValue = err
        })
        event.returnValue = ''
      } catch (err: any) {
        event.returnValue = { error: err }
      }
    })
  }

  private static handleWebSaveTheme() {
    ipcMain.on('WebSaveTheme', (event, data) => {
      try {
        const themeJson = getUserDataPath('theme.json')
        writeFileSync(themeJson, `{"theme":"${data.theme || ''}"}`, 'utf-8')
        const message = { theme: data.theme || 'system', dark: nativeTheme.shouldUseDarkColors }
        for (const win of AppWindow.previewWindows) {
          if (!win.isDestroyed()) win.webContents.send('setTheme', message)
        }
      } catch {
      }
    })
  }

  private static handleWebClearCookies() {
    ipcMain.on('WebClearCookies', (event, data) => {
      session.defaultSession.clearStorageData(data)
    })
  }

  private static handleWebGetCookies() {
    ipcMain.handle('WebGetCookies', async (event, data) => {
      return await session.defaultSession.cookies.get(data)
    })
  }

  private static handleWebQuarkAccountInfo() {
    ipcMain.handle('WebQuarkAccountInfo', async (_event, data: { serviceTicket?: string }) => {
      const serviceTicket = String(data?.serviceTicket || '')
      if (!serviceTicket) return { ok: false, status: 0, body: '', cookies: [], error: '夸克登录凭证为空' }
      const params = new URLSearchParams({ st: serviceTicket, fr: 'pc', platform: 'pc' })
      const initialUrl = `https://pan.quark.cn/account/info?${params.toString()}`
      const existingCookies = await session.defaultSession.cookies.get({ domain: 'quark.cn' })
      const cookieJar = new Map(existingCookies.filter((cookie) => cookie.name && cookie.value).map((cookie) => [cookie.name, cookie.value]))
      const headers = {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://pan.quark.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Safari/537.36 Core/1.94.225.400 QQBrowser/12.2.5544.400'
      }
      const requestHop = async (url: string, redirectsLeft: number): Promise<{ ok: boolean; status: number; body: string; error?: string }> => {
        return await new Promise((resolve) => {
          const request = httpsRequest(url, {
            method: 'GET',
            headers: {
              ...headers,
              ...(cookieJar.size ? { Cookie: Array.from(cookieJar, ([name, value]) => `${name}=${value}`).join('; ') } : {})
            }
          }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
            response.on('end', async () => {
              for (const rawCookie of response.headers['set-cookie'] || []) {
                const pair = rawCookie.split(';', 1)[0] || ''
                const separator = pair.indexOf('=')
                if (separator > 0) cookieJar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
                const cookie = ipcEvent.parseSetCookie(rawCookie, url)
                if (cookie) await session.defaultSession.cookies.set(cookie).catch(() => undefined)
              }
              const location = response.headers.location
              if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location && redirectsLeft > 0) {
                resolve(await requestHop(new URL(location, url).toString(), redirectsLeft - 1))
                return
              }
              resolve({ ok: !!response.statusCode && response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
            })
          })
          request.on('error', (error) => resolve({ ok: false, status: 0, body: '', error: error.message }))
          request.end()
        })
      }
      const result = await requestHop(initialUrl, 5)
      const cookies = Array.from(cookieJar, ([name, value]) => ({ name, value, domain: '.quark.cn' }))
      return { ...result, cookies }
    })
  }

  private static handleWebQuarkDownloadUrl() {
    ipcMain.handle('WebQuarkDownloadUrl', async (_event, data: { fileId?: string; cookie?: string }) => {
      const fileId = String(data?.fileId || '')
      if (!fileId) return { ok: false, status: 0, body: '', cookies: [], error: '夸克文件 ID 为空' }
      const params = new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc'
      })
      const url = `https://drive.quark.cn/1/clouddrive/file/download?${params.toString()}`
      const sessionCookieHeader = await getQuarkSessionCookieHeader('https://drive.quark.cn')
      const accountCookieHeader = String(data?.cookie || '')
      const cookieHeader = mergeQuarkCookieHeaders(sessionCookieHeader, accountCookieHeader)

      return await new Promise((resolve) => {
        const request = net.request({
          method: 'POST',
          url,
          useSessionCookies: true
        } as any)
        request.setHeader('Accept', 'application/json, text/plain, */*')
        request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9')
        request.setHeader('Content-Type', 'application/json')
        request.setHeader('Origin', 'https://pan.quark.cn')
        request.setHeader('Referer', 'https://pan.quark.cn')
        request.setHeader('User-Agent', QUARK_DOWNLOAD_AGENT)
        if (cookieHeader) request.setHeader('Cookie', cookieHeader)
        request.on('response', (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', async () => {
            const body = Buffer.concat(chunks).toString('utf8')
            const setCookie = response.headers['set-cookie']
            const setCookieList = Array.isArray(setCookie) ? setCookie : (setCookie ? [String(setCookie)] : [])
            for (const rawCookie of setCookieList) {
              const cookie = ipcEvent.parseSetCookie(rawCookie, 'https://pan.quark.cn')
              if (cookie) {
                try {
                  await session.defaultSession.cookies.set(cookie)
                } catch (err) {
                  console.error(err)
                }
              }
            }
            const latestSessionCookie = await getQuarkSessionCookieHeader('https://drive.quark.cn')
            resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body, cookie: mergeQuarkCookieHeaders(latestSessionCookie, accountCookieHeader) })
          })
        })
        request.on('error', (error) => resolve({ ok: false, status: 0, body: '', cookies: [], error: error.message }))
        request.write(JSON.stringify({ fids: [fileId] }))
        request.end()
      })
    })
  }

  private static handleWebQuarkFileList() {
    ipcMain.handle('WebQuarkFileList', async (_event, data: { cookie?: string; parentId?: string; page?: number; size?: number }) => {
      const params = new URLSearchParams({
        pr: 'ucpro', fr: 'pc', uc_param_str: '', __t: String(Date.now()), __dt: '1000',
        pdir_fid: String(data?.parentId || '0'), _page: String(data?.page || 1), _size: String(data?.size || 100),
        _fetch_total: '1', fetch_all_file: '1', fetch_risk_file_name: '1', _sort: 'file_name:asc'
      })
      const url = `https://drive-pc.quark.cn/1/clouddrive/file/sort?${params.toString()}`
      const accountCookieHeader = String(data?.cookie || '')
      const cookieHeader = mergeQuarkCookieHeaders(await getQuarkSessionCookieHeader('https://drive-pc.quark.cn'), accountCookieHeader)
      return await new Promise((resolve) => {
        const request = net.request({ method: 'GET', url, useSessionCookies: true } as any)
        request.setHeader('Accept', 'application/json, text/plain, */*')
        request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9')
        request.setHeader('Content-Type', 'application/json')
        request.setHeader('Origin', 'https://pan.quark.cn')
        request.setHeader('Referer', 'https://pan.quark.cn/')
        request.setHeader('User-Agent', QUARK_DOWNLOAD_AGENT)
        if (cookieHeader) request.setHeader('Cookie', cookieHeader)
        request.on('response', (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', async () => {
            const setCookie = response.headers['set-cookie']
            const setCookieList = Array.isArray(setCookie) ? setCookie : (setCookie ? [String(setCookie)] : [])
            for (const rawCookie of setCookieList) {
              const cookie = ipcEvent.parseSetCookie(rawCookie, 'https://drive-pc.quark.cn')
              if (cookie) await session.defaultSession.cookies.set(cookie).catch(() => undefined)
            }
            const latestSessionCookie = await getQuarkSessionCookieHeader('https://drive-pc.quark.cn')
            resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'), cookie: mergeQuarkCookieHeaders(latestSessionCookie, accountCookieHeader) })
          })
        })
        request.on('error', (error) => resolve({ ok: false, status: 0, body: '', error: error.message }))
        request.end()
      })
    })
  }

  private static parseSetCookie(rawCookie: string, defaultUrl: string) {
    const parts = rawCookie.split(';').map((part) => part.trim()).filter(Boolean)
    const [nameValue, ...attrs] = parts
    if (!nameValue || !nameValue.includes('=')) return undefined
    const [name, ...valueParts] = nameValue.split('=')
    const cookie: any = {
      url: defaultUrl,
      name,
      value: valueParts.join('='),
      path: '/',
      secure: true
    }
    for (const attr of attrs) {
      const [key, ...attrValueParts] = attr.split('=')
      const lowerKey = key.toLowerCase()
      const attrValue = attrValueParts.join('=')
      if (lowerKey === 'domain' && attrValue) cookie.domain = attrValue
      else if (lowerKey === 'path' && attrValue) cookie.path = attrValue
      else if (lowerKey === 'expires' && attrValue) {
        const expires = Date.parse(attrValue)
        if (Number.isFinite(expires)) cookie.expirationDate = Math.floor(expires / 1000)
      } else if (lowerKey === 'max-age' && attrValue) {
        const maxAge = Number(attrValue)
        if (Number.isFinite(maxAge)) cookie.expirationDate = Math.floor(Date.now() / 1000) + maxAge
      } else if (lowerKey === 'secure') cookie.secure = true
      else if (lowerKey === 'httponly') cookie.httpOnly = true
    }
    return cookie
  }

  private static handleWebSetCookies() {
    ipcMain.handle('WebSetCookies', async (_event, data) => {
      const cookies = Array.isArray(data) ? data : []
      await Promise.all(cookies.map(async (item) => {
        const cookie = {
          url: item.url,
          name: item.name,
          value: item.value,
          domain: item.domain || '.' + item.url.substring(item.url.lastIndexOf('/') + 1),
          secure: item.url.indexOf('https://') == 0,
          expirationDate: item.expirationDate
        }
        await session.defaultSession.cookies.set(cookie).catch((err: any) => console.error(err))
      }))
      return true
    })
  }

  private static handleWebClearCache() {
    ipcMain.on('WebClearCache', (event, data) => {
      if (data.cache) {
        session.defaultSession.clearCache()
        session.defaultSession.clearAuthCache()
      } else {
        session.defaultSession.clearStorageData(data)
      }
    })
  }

  private static handleWebReload() {
    ipcMain.on('WebReload', (event, data) => {
      if (AppWindow.mainWindow && !AppWindow.mainWindow.isDestroyed()) AppWindow.mainWindow.reload()
    })
  }

  private static handleWebRelaunch() {
    ipcMain.on('WebRelaunch', (event, data) => {
      app.relaunch()
      try {
        app.exit()
      } catch {
      }
    })
  }

  private static handleWebRelaunchAria() {
    ipcMain.handle('WebRelaunchAria', async (event, data) => {
      return getMotrixApplicationRpcPort()
    })
  }

  private static handleWebSetProgressBar() {
    ipcMain.on('WebSetProgressBar', (event, data) => {
      if (AppWindow.mainWindow && !AppWindow.mainWindow.isDestroyed()) {
        if (data.pro) {

          AppWindow.mainWindow.setProgressBar(data.pro, { mode: data.mode || 'normal' })
        } else AppWindow.mainWindow.setProgressBar(-1)
      }
    })
  }

  private static handleWebShutDown() {
    ipcMain.on('WebShutDown', (event, data) => {
      if (is.macOS()) {
        const shutdownCmd = 'osascript -e \'tell application "System Events" to shut down\''
        exec(shutdownCmd, (err: any) => {
          if (data.quitApp) {
            try {
              app.exit()
            } catch {
            }
          }
          if (err) {
            // donothing
          }
        })
      } else {
        const cmdArguments = ['shutdown']
        if (is.linux()) {
          if (data.sudo) {
            cmdArguments.unshift('sudo')
          }
          cmdArguments.push('-h')
          cmdArguments.push('now')
        }
        if (is.windows()) {
          cmdArguments.push('-s')
          cmdArguments.push('-f')
          cmdArguments.push('-t 0')
        }

        const finalcmd = cmdArguments.join(' ')

        exec(finalcmd, (err: any) => {
          if (data.quitApp) {
            try {
              app.exit()
            } catch {
            }
          }
          if (err) {
            // donothing
          }
        })
      }
    })
  }

  private static handleWebSetProxy() {
    ipcMain.on('WebSetProxy', (event, data) => {
      // if (data.proxyUrl) app.commandLine.appendSwitch('proxy-server', data.proxyUrl)
      // else app.commandLine.removeSwitch('proxy-server')
      console.log(JSON.stringify(data))
      if (data.proxyUrl) {
        session.defaultSession.setProxy({ proxyRules: data.proxyUrl })
      } else {
        session.defaultSession.setProxy({})
      }
    })
  }

  private static handlePanHubRequest() {
    ipcMain.handle('PanHub:request', async (_event, data) => requestPanHub(data))
    ipcMain.on('PanHub:stream-start', (event, data: { requestId?: string; request?: any }) => {
      const requestId = data?.requestId || ''
      if (!requestId || !data?.request) return
      panHubStreamControllers.get(requestId)?.abort()
      const controller = new AbortController()
      panHubStreamControllers.set(requestId, controller)
      const send = (channel: string, payload?: unknown) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, { requestId, payload })
      }
      requestPanHubStream(data.request, (payload) => send('PanHub:stream-event', payload), controller.signal)
        .then(() => send('PanHub:stream-end'))
        .catch((error) => {
          if (!controller.signal.aborted) send('PanHub:stream-error', error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (panHubStreamControllers.get(requestId) === controller) panHubStreamControllers.delete(requestId)
        })
    })
    ipcMain.on('PanHub:stream-cancel', (_event, requestId: string) => {
      panHubStreamControllers.get(requestId)?.abort()
      panHubStreamControllers.delete(requestId)
    })
  }

  private static handleOfficePreviewConvertToPdf() {
    ipcMain.handle('OfficePreview:convertToPdf', async (_event, data: { sourceUrl?: string; fileName?: string }) => {
      try {
        const sourceUrl = data?.sourceUrl || ''
        const fileName = path.basename(data?.fileName || 'document')
        if (!sourceUrl) return { ok: false, error: '文档预览地址为空' }
        const soffice = findSoffice()
        if (!soffice) {
          return {
            ok: false,
            error: '未找到 LibreOffice。请安装 LibreOffice 后重试，或继续使用网盘自带预览。'
          }
        }

        const hash = createHash('sha1').update(sourceUrl + fileName).digest('hex')
        const previewRoot = path.join(app.getPath('userData'), 'office-preview')
        const workDir = path.join(previewRoot, hash)
        mkdirSync(workDir, { recursive: true })
        const ext = path.extname(fileName) || '.office'
        const inputPath = path.join(workDir, `source${ext}`)
        const outputPath = path.join(workDir, 'source.pdf')
        if (!existsSync(outputPath)) {
          const response = await fetch(sourceUrl)
          if (!response.ok) return { ok: false, error: `文档下载失败：${response.status}` }
          const arrayBuffer = await response.arrayBuffer()
          writeFileSync(inputPath, Buffer.from(arrayBuffer))
          await convertOfficeFileToPdf(soffice, inputPath, workDir)
        }
        if (!existsSync(outputPath)) return { ok: false, error: 'LibreOffice 未生成 PDF 文件' }
        return { ok: true, pdfUrl: pathToFileUrl(outputPath) }
      } catch (err: any) {
        return { ok: false, error: err?.message || '文档转换 PDF 失败' }
      }
    })
  }

  private static handleOpenDataLoaderConvertPdf() {
    const handler = async (_event: any, data: any) => {
      try {
        const inputPath = String(data?.inputPath || '')
        if (!inputPath) return { ok: false, error: '请选择要转换的 PDF 文件' }
        const baseName = path.basename(inputPath, path.extname(inputPath))
        const hash = createHash('sha1').update(inputPath).digest('hex').slice(0, 12)
        const outputDir = path.join(app.getPath('userData'), 'pdf-tools-output', `${baseName}-${hash}`)
        try { rmSync(outputDir, { recursive: true, force: true }) } catch {}
        mkdirSync(outputDir, { recursive: true })
        const argv = buildOpenDataLoaderPdfArgv({ ...data, outputDir })
        const result = await runBundledCloudDriveCli(argv)
        const stdout = result.stdout || ''
        const stderr = result.stderr || ''
        let body: any = stdout.trim()
        try {
          body = stdout ? JSON.parse(stdout) : {}
        } catch {
        }
        if (result.exitCode !== 0) {
          const errMsg = typeof body === 'object' ? body?.error?.message || body?.error || stdout || stderr : (stdout || stderr)
          console.error('[opendataloader:convertPdf] CLI failed', { exitCode: result.exitCode, stdout, stderr })
          return { ok: false, error: errMsg, exitCode: result.exitCode, stderr }
        }

        const fmtMap: { [k: string]: 'json' | 'html' | 'md' | 'text' } = {
          '.json': 'json',
          '.html': 'html',
          '.htm': 'html',
          '.md': 'md',
          '.markdown': 'md',
          '.txt': 'text'
        }
        const contents: { json: any; html: string; md: string; text: string; files: any[] } = {
          json: null, html: '', md: '', text: '', files: []
        }
        const walk = (dir: string): string[] => {
          const out: string[] = []
          try {
            for (const name of readdirSync(dir)) {
              const fp = path.join(dir, name)
              try {
                const st = statSync(fp)
                if (st.isDirectory()) out.push(...walk(fp))
                else if (st.isFile()) out.push(fp)
              } catch {}
            }
          } catch {}
          return out
        }
        const allFiles = walk(outputDir)
        for (const filePath of allFiles) {
          const ext = path.extname(filePath).toLowerCase()
          const kind = fmtMap[ext]
          const entry: any = { path: filePath, name: path.basename(filePath), format: kind || ext.slice(1) || 'unknown' }
          contents.files.push(entry)
          if (!kind) continue
          try {
            const text = readFileSync(filePath, 'utf8')
            entry.size = text.length
            if (kind === 'json' && !contents.json) {
              try { contents.json = JSON.parse(text) } catch { contents.json = text }
            } else if (kind === 'html' && !contents.html) contents.html = text
            else if (kind === 'md' && !contents.md) contents.md = text
            else if (kind === 'text' && !contents.text) contents.text = text
          } catch (e: any) {
            console.warn('[opendataloader:convertPdf] read file failed', filePath, e?.message)
          }
        }

        const merged = (body && typeof body === 'object') ? { ...body, ...contents } : contents
        if (!contents.json && !contents.html && !contents.md && !contents.text) {
          console.warn('[opendataloader:convertPdf] empty output, files=', allFiles, 'stdout=', stdout.slice(0, 500))
        }
        return { ok: true, result: merged }
      } catch (err: any) {
        console.error('[opendataloader:convertPdf] error', err)
        return { ok: false, error: err?.message || 'OpenDataLoader PDF 转换失败' }
      }
    }
    ipcMain.handle('opendataloader:convertPdf', handler)
    ipcMain.handle('OpenDataLoader:convertPdf', handler)
  }

  private static handleWebOpenWindow() {
    let winWidth = AppWindow.winWidth
    if (winWidth < 1080) winWidth = 1080
    ipcMain.on('WebOpenWindow', (event, data) => {
      const win = createElectronWindow(winWidth, AppWindow.winHeight, true, 'main2', data.theme)
      AppWindow.previewWindows.add(win)
      win.once('closed', () => AppWindow.previewWindows.delete(win))
      win.on('ready-to-show', function() {
        win.webContents.send('setPage', data)
        win.webContents.send('setTheme', { dark: nativeTheme.shouldUseDarkColors })
        win.setTitle('预览窗口')
        win.show()
        if (data.page === 'PageBookReader') {
          setTimeout(() => win.setFullScreen(true), 200)
        }
      })
    })
  }

  private static lyricWin: BrowserWindow | null = null
  private static globalHotkeyAccelerators: string[] = []

  private static handleWebOpenLyric() {
    ipcMain.on('WebOpenLyric', () => {
      if (ipcEvent.lyricWin && !ipcEvent.lyricWin.isDestroyed()) {
        ipcEvent.lyricWin.show()
        return
      }
      const win = new BrowserWindow({
        show: false,
        width: 960,
        height: 180,
        center: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          webSecurity: false,
          sandbox: false,
          preload: getAsarPath('dist/electron/preload/index.js')
        }
      })
      win.removeMenu()
      win.setAlwaysOnTop(true, 'screen-saver')
      if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL + '/desktop-lyrics.html')
      else win.loadFile(getStaticPath('desktop-lyrics.html'))
      win.on('ready-to-show', () => win.show())
      win.on('closed', () => {
        ipcEvent.lyricWin = null
      })
      ipcEvent.lyricWin = win
    })
  }

  private static handleWebSendLyric() {
    ipcMain.on('WebSendLyric', (_event, data) => {
      if (!ipcEvent.lyricWin || ipcEvent.lyricWin.isDestroyed()) return
      if (data?.clickThrough !== undefined) ipcEvent.lyricWin.setIgnoreMouseEvents(!!data.clickThrough, { forward: true })
      ipcEvent.lyricWin.webContents.send('lyricData', data)
    })
  }

  private static handleWebCloseLyric() {
    ipcMain.on('WebCloseLyric', () => {
      if (ipcEvent.lyricWin && !ipcEvent.lyricWin.isDestroyed()) {
        ipcEvent.lyricWin.close()
        ipcEvent.lyricWin = null
      }
    })
  }

  private static handleWebConfigureGlobalHotkeys() {
    ipcMain.handle('WebConfigureGlobalHotkeys', (event, bindings: Array<{ action: string; accelerator: string; enabled?: boolean }>) => {
      for (const accelerator of ipcEvent.globalHotkeyAccelerators) {
        try { globalShortcut.unregister(accelerator) } catch {}
      }
      ipcEvent.globalHotkeyAccelerators = []
      if (!Array.isArray(bindings) || !bindings.length) return { ok: true, registered: [], failed: [] }
      const sender = BrowserWindow.fromWebContents(event.sender)
      const registered: string[] = []
      const failed: string[] = []
      for (const binding of bindings) {
        const accelerator = String(binding?.accelerator || '').trim()
        const action = String(binding?.action || '').trim()
        if (!accelerator || !action || binding.enabled === false) continue
        try {
          const ok = globalShortcut.register(accelerator, () => {
            const win = sender && !sender.isDestroyed() ? sender : AppWindow.mainWindow
            win?.webContents.send('WebGlobalHotkey', { action, accelerator })
          })
          if (ok) {
            registered.push(accelerator)
            ipcEvent.globalHotkeyAccelerators.push(accelerator)
          } else {
            failed.push(accelerator)
          }
        } catch {
          failed.push(accelerator)
        }
      }
      return { ok: failed.length === 0, registered, failed }
    })
  }

  private static handleWebOpenUrl() {
    ipcMain.on('WebOpenUrl', (event, data) => {
      const win = new BrowserWindow({
        show: false,
        width: AppWindow.winWidth,
        height: AppWindow.winHeight,
        center: true,
        minWidth: 680,
        minHeight: 500,
        icon: getStaticPath('icon_256x256.ico'),
        useContentSize: true,
        frame: true,
        hasShadow: true,
        autoHideMenuBar: true,
        backgroundColor: data.theme && data.theme == 'dark' ? '#23232e' : '#ffffff',
        webPreferences: {
          spellcheck: false,
          devTools: is.dev(),
          sandbox: false,
          webSecurity: false,
          allowRunningInsecureContent: true,
          backgroundThrottling: false,
          enableWebSQL: false,
          disableBlinkFeatures: 'OutOfBlinkCors,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'
        }
      })

      win.on('ready-to-show', function() {
        win.setTitle('预览窗口')
        win.show()
      })

      win.loadURL(data.PageUrl, {
        userAgent: ua,
        httpReferrer: Referer
      })
    })
  }

  private static handleExportCliTokens() {
    ipcMain.handle('ExportCliTokens', async (_event, data: { accounts: any[] }) => {
      try {
        const cliDir = resolveCloudDriveCliConfigDir(process.env.CLOUDDRIVE_CLI_CONFIG_DIR, os.homedir())
        const tokensPath = path.join(cliDir, 'tokens.json')
        const configPath = path.join(cliDir, 'config.json')
        mkdirSync(cliDir, { recursive: true })

        let existing: { accounts: any[] } = { accounts: [] }
        try {
          const raw = require('fs').readFileSync(tokensPath, 'utf8')
          existing = JSON.parse(raw)
          if (!Array.isArray(existing.accounts)) existing.accounts = []
        } catch {
          existing = { accounts: [] }
        }

        existing.accounts = Array.isArray(data.accounts) ? data.accounts : []

        let config: { defaults: Record<string, string> } = { defaults: {} }
        try {
          const raw = readFileSync(configPath, 'utf8')
          config = JSON.parse(raw)
          if (!config.defaults || typeof config.defaults !== 'object') config.defaults = {}
        } catch {
          config = { defaults: {} }
        }

        const accountKeys = new Set(existing.accounts.map((account) => `${account.provider}/${account.accountId}`))
        for (const [provider, accountId] of Object.entries(config.defaults)) {
          if (!accountKeys.has(`${provider}/${accountId}`)) delete config.defaults[provider]
        }
        for (const account of existing.accounts) {
          if (account.provider && account.accountId && !config.defaults[account.provider]) {
            config.defaults[account.provider] = account.accountId
          }
        }

        writeFileSync(tokensPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 })
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
        return { ok: true, exported: (data.accounts || []).length, path: tokensPath }
      } catch (e: any) {
        return { ok: false, error: e?.message || 'Export failed' }
      }
    })
  }

  private static handleInstallCli() {
    ipcMain.handle('InstallCli', async () => {
      return this.installCli(false)
    })
  }

  private static async installCli(silent: boolean) {
      try {
        const cliSrcDir = is.dev()
          ? path.join(app.getAppPath(), 'scripts')
          : path.join(process.resourcesPath, 'cli')
        const nodeExe = (() => {
          const p = process.execPath.toLowerCase()
          if (p.endsWith('electron') || p.endsWith('electron.exe') || p.includes('electron.app')) return null
          return process.execPath
        })()

        if (is.macOS() || is.linux()) {
          const homeDir = os.homedir()
          const installDir = path.join(homeDir, '.local', 'bin')
          mkdirSync(installDir, { recursive: true })

          for (const name of ['clouddrive-cli', 'clouddrive-mcp']) {
            const scriptFile = path.join(cliSrcDir, `${name}.mjs`)
            if (!existsSync(scriptFile)) {
              return { ok: false, error: `CLI script not found: ${scriptFile}` }
            }
            const linkPath = path.join(installDir, name)
            const nodeCommand = nodeExe
              ? `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(nodeExe)} ${shellQuote(scriptFile)} "$@"`
              : `exec node ${shellQuote(scriptFile)} "$@"`
            const wrapper = `#!/bin/sh\n${nodeCommand}\n`
            writeFileSync(linkPath, wrapper, { mode: 0o755 })
            try { chmodSync(linkPath, 0o755) } catch { /* ignore */ }
          }

          // 将 ~/.local/bin 写入 shell 配置（如尚未添加）
          const pathLine = `\n# BoxPlayer CLI\nexport PATH="$HOME/.local/bin:$PATH"\n`
          const profiles = ['.zshrc', '.bashrc', '.bash_profile'].map((f) => path.join(homeDir, f))
          let updatedProfile = ''
          for (const p of profiles) {
            try {
              if (existsSync(p)) {
                const content = readFileSync(p, 'utf8')
                if (!content.includes('.local/bin')) {
                  writeFileSync(p, content + pathLine)
                  updatedProfile = path.basename(p)
                  break
                } else {
                  updatedProfile = path.basename(p)
                  break
                }
              }
            } catch { /* ignore */ }
          }

          const hint = updatedProfile
            ? `重启终端（或运行 source ~/.${updatedProfile}）后执行：`
            : `请确保 ~/.local/bin 已加入 PATH，然后执行：`

          return {
            ok: true,
            auto: silent,
            message: `已安装到 ${installDir}\n${hint} clouddrive-cli auth list`,
            paths: [
              path.join(installDir, 'clouddrive-cli'),
              path.join(installDir, 'clouddrive-mcp'),
            ],
          }
        }

        if (is.windows()) {
          const installDir = path.join(os.homedir(), 'AppData', 'Local', 'BoxPlayer', 'bin')
          mkdirSync(installDir, { recursive: true })

          for (const name of ['clouddrive-cli', 'clouddrive-mcp']) {
            const scriptFile = path.join(cliSrcDir, `${name}.mjs`)
            if (!existsSync(scriptFile)) {
              return { ok: false, error: `CLI script not found: ${scriptFile}` }
            }
            const nodeCmd = nodeExe ? nodeExe : 'node'
            const envLine = nodeExe ? 'set ELECTRON_RUN_AS_NODE=1\n' : ''
            const batContent = `@echo off\nsetlocal\n${envLine}"${nodeCmd}" "${scriptFile}" %*\n`
            writeFileSync(path.join(installDir, `${name}.cmd`), batContent)
          }

          const pathKey = 'HKCU\\Environment'
          const currentPath = process.env.PATH || ''
          if (!currentPath.includes(installDir)) {
            const { execSync } = await import('child_process')
            try {
              execSync(`setx PATH "${currentPath};${installDir}"`)
            } catch {
            }
          }

          return {
            ok: true,
            auto: silent,
            message: `已安装到 ${installDir}\n重启终端后运行: clouddrive-cli auth list`,
            paths: [
              path.join(installDir, 'clouddrive-cli.cmd'),
              path.join(installDir, 'clouddrive-mcp.cmd'),
            ],
            note: '如命令不可用，请手动将该目录加入系统 PATH',
          }
        }

        return { ok: false, error: 'Unsupported platform' }
      } catch (e: any) {
        if (e?.code === 'EACCES' || e?.code === 'EPERM') {
          return {
            ok: false,
            error: '权限不足，无法写入命令行安装目录。\n请在设置页手动安装，或确认 ~/.local/bin / %LOCALAPPDATA% 可写。',
            needsElevation: true,
          }
        }
        return { ok: false, error: e?.message || 'Install failed' }
      }
  }

  private static powerSaveBlockerId: number | null = null

  private static handlePowerSaveBlocker() {
    ipcMain.on('setPowerSaveBlocker', (_event, enabled: boolean) => {
      if (enabled) {
        if (ipcEvent.powerSaveBlockerId === null) {
          ipcEvent.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
        }
      } else {
        if (ipcEvent.powerSaveBlockerId !== null) {
          powerSaveBlocker.stop(ipcEvent.powerSaveBlockerId)
          ipcEvent.powerSaveBlockerId = null
        }
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Reedy IPC handlers
  // ---------------------------------------------------------------------------

  private static handleReedy() {
    // Request-response via ipcMain.handle
    ipcMain.handle('reedy:get-meta', (_event, bookHash: string) => {
      return getBookMeta(bookHash)
    })

    ipcMain.handle('reedy:is-indexed', (_event, bookHash: string) => {
      return isBookIndexed(bookHash)
    })

    ipcMain.handle('reedy:clear-book', (_event, bookHash: string) => {
      clearBookData(bookHash)
      return { ok: true }
    })

    ipcMain.handle('reedy:list-skills', () => {
      return listSkills()
    })

    ipcMain.handle('reedy:toggle-skill', (_event, skillId: string, enabled: boolean) => {
      setSkillEnabled(skillId, enabled)
      return { ok: true }
    })

    ipcMain.handle('reedy:write-memory', (_event, args: {
      scope: string; scope_key: string; key: string; summary: string
      source_message_id?: string; embedding?: number[]
    }) => {
      return writeMemory(args as any)
    })

    ipcMain.handle('reedy:search-memories', (_event, scope: string, scopeKey: string, queryEmbedding: number[] | null, topK: number, recencyWeight?: number) => {
      return searchMemories(scope as any, scopeKey, queryEmbedding, topK, recencyWeight)
    })

    ipcMain.handle('reedy:list-memories', (_event, scope: string, scopeKey: string, limit: number) => {
      return listMemories(scope as any, scopeKey, limit)
    })

    ipcMain.handle('reedy:delete-memory', (_event, id: string) => {
      return deleteMemory(id)
    })

    ipcMain.handle('reedy:export-metrics', (_event, since?: number) => {
      return getMetrics(since)
    })

    ipcMain.handle('reedy:wipe-all', () => {
      wipeAllData()
      return { ok: true }
    })

    ipcMain.handle('reedy:record-metric', (_event, evt: any) => {
      recordMetric(evt)
      return { ok: true }
    })

    // Indexing: store chunks + embeddings + meta
    ipcMain.handle('reedy:store-chunks', (_event, chunks: any[]) => {
      storeChunks(chunks)
      return { ok: true }
    })

    ipcMain.handle('reedy:store-embeddings', (_event, rows: any[]) => {
      storeEmbeddings(rows)
      return { ok: true }
    })

    ipcMain.handle('reedy:store-meta', (_event, meta: any) => {
      storeMeta(meta)
      return { ok: true }
    })

    // Search: hybrid search
    ipcMain.handle('reedy:search', (_event, bookHash: string, queryEmbedding: number[], queryText: string, topK: number, spoilerBound?: number) => {
      return hybridSearch(bookHash, queryEmbedding, queryText, topK, spoilerBound)
    })
    ipcMain.handle('reedy:get-chunks', (_event, bookHash: string) => getBookChunks(bookHash))

    // Cleanup on app quit
    ipcMain.handle('reedy:destroy', () => {
      destroyDb()
      return { ok: true }
    })

    ipcMain.handle('payment:start-server', async () => {
      const { startPaymentServer } = await import('./oauthServer')
      const win = BrowserWindow.getAllWindows()[0]
      return startPaymentServer(win)
    })
    ipcMain.handle('payment:stop-server', async () => {
      const { stopPaymentServer } = await import('./oauthServer')
      stopPaymentServer()
    })

  }
}
