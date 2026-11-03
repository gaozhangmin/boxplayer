import { z } from 'zod'
import type { CreateWorkspacePlanInput, WorkspaceDriveScope, WorkspaceFileSnapshot, WorkspacePlanAction, WorkspacePlanKind, WorkspaceTaskView } from '@shared/types/workspaceAgent'
import { runBoxPlayerAgent } from '../agent'
import { getAIConfig } from '../../utils/bookAI'
import { searchAllDrives } from '../../utils/globalSearch'
import { scanDriveDuplicates } from '../../utils/drive-tools/duplicates'
import { scanDriveLargeFiles } from '../../utils/drive-tools/largeFiles'
import { scanDriveEmptyDirs } from '../../utils/drive-tools/emptyDirs'
import { addWorkspaceEvidence, addWorkspaceEvent, completeWorkspaceTask, getWorkspaceTask, saveWorkspacePlan } from './client'

type DiscoverOptions = { keyword?: string; targetParentFileId?: string; shareUrl?: string; sharePassword?: string; largeFileMode?: 'size100' | 'size1000' | 'size5000' }
const snapshot = (file: any): WorkspaceFileSnapshot => ({ userId: file.userId || file.user_id, driveId: file.driveId || file.drive_id, fileId: file.fileId || file.file_id, parentFileId: file.parentFileId || file.parent_file_id, name: file.name, size: file.size, time: file.time, path: file.path })
const actionId = () => crypto.randomUUID()
const sharePasswords = new Map<string, string>()
/**
 * The planner may use Pi to explain a plan, but the operation set is built from
 * inspected file identifiers only. This keeps model output from becoming a
 * remote write capability.
 */
export async function discoverAndPlan(task: WorkspaceTaskView, options: DiscoverOptions): Promise<WorkspaceTaskView> {
  try {
    const built = await buildPlan(task, options)
    const cancelled = await cancelledTask(task.id)
    if (cancelled) return cancelled
    if (task.kind === 'import_share') sharePasswords.set(task.id, options.sharePassword || '')
    const evidenceView = await addWorkspaceEvidence(task.id, built.source, built.evidenceSummary, built.evidence)
    const cancelledAfterEvidence = await cancelledTask(task.id)
    if (cancelledAfterEvidence) return cancelledAfterEvidence
    const evidenceId = evidenceView?.evidence.at(-1)?.id
    if (!evidenceId) throw new Error('无法保存取证结果')
    if (built.actions.length === 0) {
      await addWorkspaceEvent(task.id, 'info', '取证完成，未发现需要执行的操作。')
      return completeWorkspaceTask(task.id, 'completed', '取证完成，未发现需要处理的项目。')
    }
    const explanation = await askPiForPlanSummary(task, built, options).catch(() => ({ summary: built.summary, risk: built.risk }))
    const cancelledAfterSummary = await cancelledTask(task.id)
    if (cancelledAfterSummary) return cancelledAfterSummary
    const input: CreateWorkspacePlanInput = { taskId: task.id, title: built.title, summary: explanation.summary || built.summary, risk: explanation.risk || built.risk, evidenceIds: [evidenceId], actions: built.actions }
    const saved = await saveWorkspacePlan(input)
    if (!saved) throw new Error('无法保存审批计划')
    return saved
  } catch (error: any) {
    sharePasswords.delete(task.id)
    const cancelled = await cancelledTask(task.id)
    if (cancelled) return cancelled
    await addWorkspaceEvent(task.id, 'error', error?.message || '取证或规划失败')
    return await completeWorkspaceTask(task.id, 'failed', error?.message || '取证或规划失败')
  }
}

async function cancelledTask(taskId: string): Promise<WorkspaceTaskView | null> {
  const current = await getWorkspaceTask(taskId)
  return current?.status === 'cancelled' ? current : null
}

async function buildPlan(task: WorkspaceTaskView, options: DiscoverOptions): Promise<{ source: string; evidenceSummary: string; evidence: Record<string, unknown>; title: string; summary: string; risk: string; actions: WorkspacePlanAction[] }> {
  const scope = task.scope
  if (task.kind === 'cleanup_duplicates') {
    const result = await scanDriveDuplicates([scope], 'contentHash')
    if (result.truncated || result.failedDirs) throw new Error(result.errors[0] || '重复文件扫描不完整，拒绝生成清理计划')
    const actions = result.groups.flatMap(group => [...group.files].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(1).map(file => ({ id: actionId(), kind: 'trash' as const, label: `移入回收站：${file.name}`, snapshot: snapshot(file) })))
    return { source: 'scanDriveDuplicates', evidenceSummary: result.report, evidence: { report: result.report, groups: result.groups.map(group => ({ label: group.label, files: group.files.map(snapshot) })) }, title: '重复文件清理计划', summary: `按“保留每组最新文件”规则，准备将 ${actions.length} 个重复文件移入回收站。`, risk: '文件将移入网盘回收站，不会永久删除。', actions }
  }
  if (task.kind === 'cleanup_large_files') {
    const result = await scanDriveLargeFiles([scope], options.largeFileMode || 'size1000')
    if (result.truncated || result.failedDirs) throw new Error(result.errors[0] || '大文件扫描不完整，拒绝生成清理计划')
    const actions = result.files.map(file => ({ id: actionId(), kind: 'trash' as const, label: `移入回收站：${file.name}`, snapshot: snapshot(file) }))
    return { source: 'scanDriveLargeFiles', evidenceSummary: result.report, evidence: { report: result.report, files: result.files.map(snapshot) }, title: '大文件清理计划', summary: `准备将 ${actions.length} 个符合阈值的大文件移入回收站。`, risk: '请确认这些文件无需保留；操作只移入回收站。', actions }
  }
  if (task.kind === 'cleanup_empty_directories') {
    const result = await scanDriveEmptyDirs(scope.userId, scope.driveId, scope.rootId)
    if (result.truncated || result.failedDirs) throw new Error(result.errors[0] || '空目录扫描不完整，拒绝生成清理计划')
    const actions = result.emptyDirs.map(dir => ({ id: actionId(), kind: 'trash' as const, label: `移入回收站：空目录 ${dir.name}`, snapshot: snapshot(dir) }))
    return { source: 'scanDriveEmptyDirs', evidenceSummary: result.report, evidence: { report: result.report, dirs: result.emptyDirs.map(snapshot) }, title: '空目录清理计划', summary: `准备将 ${actions.length} 个已确认空目录移入回收站。`, risk: '目录在执行前会再次读取；非空或变化的目录不会被处理。', actions }
  }
  if (task.kind === 'organize_files' || task.kind === 'download_files') {
    if (!options.keyword?.trim()) throw new Error('请输入要搜索的文件关键词')
    const files = (await searchAllDrives(options.keyword, { targets: [{ userId: scope.userId, driveId: scope.driveId }], includeMediaServers: false })).filter(file => file.source === 'cloud' && !file.isDir).slice(0, 100)
    if (!files.length) throw new Error('在选定网盘范围中没有找到文件')
    if (task.kind === 'organize_files' && !options.targetParentFileId?.trim()) throw new Error('整理计划需要目标目录 ID')
    const actions = files.map(file => ({ id: actionId(), kind: task.kind === 'organize_files' ? 'move' as const : 'download' as const, label: `${task.kind === 'organize_files' ? '移动' : '加入下载'}：${file.name}`, snapshot: snapshot(file), targetParentFileId: options.targetParentFileId }))
    return { source: 'searchMyFiles', evidenceSummary: `搜索“${options.keyword}”得到 ${files.length} 个可操作文件。`, evidence: { keyword: options.keyword, files: files.map(snapshot) }, title: task.kind === 'organize_files' ? '文件整理计划' : '下载计划', summary: task.kind === 'organize_files' ? `准备将 ${files.length} 个搜索结果移动到指定目录。` : `准备将 ${files.length} 个搜索结果加入下载队列。`, risk: task.kind === 'organize_files' ? '执行前会确认文件仍在原目录且目标目录已指定。' : '执行成功仅表示已加入下载队列，不代表文件已下载完成。', actions }
  }
  if (!options.shareUrl?.trim()) throw new Error('请输入阿里云盘或夸克分享链接')
  const share = await inspectShare(scope, options.shareUrl, options.sharePassword || '')
  const action: WorkspacePlanAction = { id: actionId(), kind: 'import_share', label: `导入分享：${share.files.length} 个根目录项目`, share: { url: options.shareUrl, shareId: share.shareId, fileIds: share.fileIds } }
  return { source: 'inspectShare', evidenceSummary: `已读取分享根目录：${share.files.length} 个项目。`, evidence: { platform: share.platform, target: scope.name, files: share.files }, title: '分享导入计划', summary: `准备将分享中的 ${share.files.length} 个根目录项目导入 ${scope.name}。`, risk: '审批内容已包含分享文件清单；执行前仍会校验目标网盘和分享令牌。', actions: [action] }
}

async function inspectShare(scope: WorkspaceDriveScope, url: string, password: string): Promise<{ platform: string; shareId: string; fileIds: string[]; files: Array<{ id: string; name: string; isDir: boolean; size?: number }> }> {
  const isQuark = /pan\.quark\.cn\/s\//.test(url)
  const isAliyun = /(aliyundrive|alipan)\.com\/s\//.test(url)
  if (!isQuark && !isAliyun) throw new Error('仅支持阿里云盘和夸克网盘分享链接')
  if ((isQuark && scope.platform !== 'quark') || (isAliyun && scope.platform !== 'aliyun')) throw new Error('请选择与分享链接相同平台的目标网盘')
  if (isQuark) {
    const quark = await import('../../quark/share')
    const parsed = quark.parseQuarkShareLink(url + (password ? ` 提取码:${password}` : ''))
    if (!parsed.id) throw new Error('解析夸克分享链接失败')
    const shareId = parsed.id.replace('quark:', '')
    const shareToken = await quark.apiQuarkShareToken(shareId, password, scope.userId)
    const response = await quark.apiQuarkShareFileList(shareId, shareToken, 'root', scope.userId)
    if (!response?.items?.length || response.next_marker) throw new Error('分享内容为空或超过安全导入上限')
    const files = response.items.map((item: any) => ({ id: item.file_id, name: item.name, isDir: item.type === 'folder' || !!item.isDir, size: item.size }))
    return { platform: 'quark', shareId, fileIds: files.map(file => file.id), files }
  }
  const { default: AliShare } = await import('../../aliapi/share')
  const shareId = url.match(/\.com\/s\/([\w]+)/)?.[1] || ''
  if (!shareId) throw new Error('解析阿里云盘分享链接失败')
  const shareToken = await AliShare.ApiGetShareToken(shareId, password)
  if (!shareToken || shareToken.startsWith('，')) throw new Error('获取分享令牌失败')
  const response = await AliShare.ApiShareFileList(shareId, shareToken, 'root')
  if (!response?.items?.length || response.next_marker) throw new Error('分享内容为空或超过安全导入上限')
  const files = response.items.map((item: any) => ({ id: item.file_id, name: item.name, isDir: item.type === 'folder' || !!item.isDir, size: item.size }))
  return { platform: 'aliyun', shareId, fileIds: files.map(file => file.id), files }
}

async function askPiForPlanSummary(task: WorkspaceTaskView, built: Awaited<ReturnType<typeof buildPlan>>, options: DiscoverOptions): Promise<{ summary: string; risk: string }> {
  const config = getAIConfig()
  if (!config) return { summary: built.summary, risk: built.risk }
  let answer = { summary: built.summary, risk: built.risk }
  await runBoxPlayerAgent({
    surface: 'workspace', model: config, prompt: `为此已取证的网盘计划生成一条简短审批摘要。不要请求或执行任何写操作。目标：${task.goal}`,
    systemPrompt: '你是 BoxPlayer 网盘计划解释助手。只能基于 inspectEvidence 返回的事实总结计划。必须调用 proposePlanSummary；不要编造文件或操作。',
    tools: {
      inspectEvidence: { description: '读取已验证的计划证据。', inputSchema: z.object({}), permission: 'read', execute: () => built.evidence },
      proposePlanSummary: { description: '提交审批页使用的摘要与风险说明，不会执行任何网盘操作。', inputSchema: z.object({ summary: z.string().min(1).max(300), risk: z.string().min(1).max(240) }), permission: 'read', execute: args => { answer = args; return { accepted: true } } }
    },
    toolAllowlist: ['inspectEvidence', 'proposePlanSummary'], toolExecution: 'sequential', maxTurns: 3, maxToolCalls: 3, maxToolCallsPerTurn: 1,
    terminalToolsAfterObservation: { observationTools: ['inspectEvidence'], terminalTools: ['proposePlanSummary'] }
  })
  return answer
}

export async function executeApprovedPlan(task: WorkspaceTaskView): Promise<WorkspaceTaskView> {
  if (task.status !== 'executing' || !task.plan || task.plan.status !== 'approved') throw new Error('计划尚未获得有效批准')
  let success = 0
  try {
    for (const action of task.plan.actions) {
      await verifyAction(action, task.scope)
      await executeAction(action, task.scope, task.id)
      success++
      await addWorkspaceEvent(task.id, 'info', `已完成：${action.label}`)
    }
    return await completeWorkspaceTask(task.id, 'completed', `计划执行完成：${success}/${task.plan.actions.length} 项操作成功。`)
  } catch (error: any) {
    const message = error?.message || '执行失败'
    await addWorkspaceEvent(task.id, 'error', `已停止执行：${message}`)
    return await completeWorkspaceTask(task.id, success ? 'partial' : /已变化|不存在/.test(message) ? 'stale' : 'failed', `已完成 ${success}/${task.plan.actions.length} 项；${message}`)
  } finally {
    sharePasswords.delete(task.id)
  }
}

async function verifyAction(action: WorkspacePlanAction, scope: WorkspaceDriveScope): Promise<void> {
  if (action.kind === 'import_share') return
  const file = action.snapshot
  if (!file || file.userId !== scope.userId || file.driveId !== scope.driveId) throw new Error('计划范围校验失败')
  const { default: AliFile } = await import('../../aliapi/file')
  const current = await AliFile.ApiFileInfo(file.userId, file.driveId, file.fileId)
  if (!current || current.name !== file.name || (file.parentFileId && current.parent_file_id !== file.parentFileId)) throw new Error(`文件已变化或不存在：${file.name}`)
}

async function executeAction(action: WorkspacePlanAction, scope: WorkspaceDriveScope, taskId: string): Promise<void> {
  if (action.kind === 'move') {
    const { moveDriveToolFiles } = await import('../../utils/drive-tools/organize')
    const result = await moveDriveToolFiles([{ userId: action.snapshot!.userId, driveId: action.snapshot!.driveId, fileId: action.snapshot!.fileId, name: action.snapshot!.name }], action.targetParentFileId || '')
    if (result.success !== 1) throw new Error(result.report)
    return
  }
  if (action.kind === 'trash') {
    const { default: AliFileCmd } = await import('../../aliapi/filecmd')
    const ids = await AliFileCmd.ApiTrashBatch(action.snapshot!.userId, action.snapshot!.driveId, [action.snapshot!.fileId])
    if (ids.length !== 1) throw new Error(`网盘不支持或未能移入回收站：${action.snapshot!.name}`)
    return
  }
  if (action.kind === 'download') {
    const { default: DownDAL } = await import('../../down/DownDAL')
    await DownDAL.aAddDownload([{ user_id: action.snapshot!.userId, drive_id: action.snapshot!.driveId, file_id: action.snapshot!.fileId, file_name: action.snapshot!.name, name: action.snapshot!.name, parent_file_id: action.snapshot!.parentFileId || '', size: action.snapshot!.size || 0, isDir: false, ext: '', category: 'other', icon: '', thumbnail: '', description: '', encType: '', password: '' }] as any, '', false)
    return
  }
  await executeShareImport(action, scope, sharePasswords.get(taskId) || '')
}

async function executeShareImport(action: WorkspacePlanAction, scope: WorkspaceDriveScope, password: string): Promise<void> {
  const url = action.share?.url || ''
  const isQuark = /pan\.quark\.cn\/s\//.test(url)
  const isAliyun = /(aliyundrive|alipan)\.com\/s\//.test(url)
  if (!isQuark && !isAliyun) throw new Error('仅支持阿里云盘和夸克网盘分享链接')
  if ((isQuark && scope.platform !== 'quark') || (isAliyun && scope.platform !== 'aliyun')) throw new Error('分享链接与目标网盘不匹配')
  if (isQuark) {
    const { parseQuarkShareLink } = await import('../../quark/share')
    const parsed = parseQuarkShareLink(url + (password ? ` 提取码:${password}` : ''))
    if (!parsed.id) throw new Error('解析夸克分享链接失败')
    const shareId = parsed.id.replace('quark:', '')
    const quark = await import('../../quark/share')
    const token = await quark.apiQuarkShareToken(shareId, password, scope.userId)
    const reviewed = action.share?.fileIds || []
    const current = await quark.apiQuarkShareFileList(shareId, token, 'root', scope.userId)
    const fileIds = current?.items?.map((item: any) => item.file_id) || []
    if (current?.next_marker || fileIds.length !== reviewed.length || fileIds.some(id => !reviewed.includes(id))) throw new Error('分享内容已变化，请重新取证后再导入')
    if (!fileIds.length) throw new Error('分享计划缺少已审查的文件清单')
    const result = await quark.apiQuarkSaveShareFilesBatch(shareId, token, scope.userId, scope.rootId, fileIds)
    if (result !== 'success' && result !== 'async') throw new Error(result || '夸克分享导入失败')
    return
  }
  const { default: AliShare } = await import('../../aliapi/share')
  const shareId = url.match(/\.com\/s\/([\w]+)/)?.[1] || ''
  if (!shareId) throw new Error('解析阿里云盘分享链接失败')
  const token = await AliShare.ApiGetShareToken(shareId, password)
  if (!token || token.startsWith('，')) throw new Error('获取分享令牌失败')
  const reviewed = action.share?.fileIds || []
  const current = await AliShare.ApiShareFileList(shareId, token, 'root')
  const fileIds = current?.items?.map(item => item.file_id) || []
  if (current?.next_marker || fileIds.length !== reviewed.length || fileIds.some(id => !reviewed.includes(id))) throw new Error('分享内容已变化，请重新取证后再导入')
  if (!fileIds.length) throw new Error('分享计划缺少已审查的文件清单')
  const result = await AliShare.ApiSaveShareFilesBatch(shareId, token, scope.userId, scope.driveId, scope.rootId, fileIds)
  if (result !== 'success' && result !== 'async') throw new Error(result || '阿里云盘分享导入失败')
}
