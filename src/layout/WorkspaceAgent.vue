<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, Database, Download, FileOutput, FileSearch, FileText, FolderInput, HardDrive, Link, ListFilter, Play, Plus, Search, ShieldAlert, ShieldCheck, Sparkles, Trash2, X } from 'lucide-vue-next'
import type { WorkspaceDriveScope, WorkspacePlanAction, WorkspacePlanKind, WorkspaceTaskView } from '@shared/types/workspaceAgent'
import { approveWorkspacePlan, archiveWorkspaceTask, cancelWorkspaceTask, getWorkspaceTask, getWorkspaceTaskV1Audit, listWorkspaceTasks, rejectWorkspacePlan, restoreWorkspaceTask, resumeWorkspaceTask, updateWorkspacePlanSelection, type WorkspaceAgentV1Audit } from '../services/workspaceAgent/client'
import { discoverAndPlan, executeApprovedPlan } from '../services/workspaceAgent/runner'
import UserDAL from '../user/userdal'
import { driveToolDriveIdForPlatform, driveToolRootIdFor } from '../utils/drive-tools/directLinks'
import { getAIConfig } from '../utils/bookAI'
import { humanSize } from '../utils/format'
import message from '../utils/message'
import { createWorkspaceTask } from '../services/workspaceAgent/client'

const props = defineProps<{ aiEnabled: boolean; sidebarVisible?: boolean }>()
const emit = defineEmits<{ (event: 'back-to-documents'): void }>()
const tasks = ref<WorkspaceTaskView[]>([])
const activeTaskId = ref('')
const showArchived = ref(false)
const drives = ref<WorkspaceDriveScope[]>([])
const selectedDriveKey = ref('')
const plannerVisible = ref(false)
const kind = ref<WorkspacePlanKind>('cleanup_duplicates')
const goal = ref('清理重复文件')
const keyword = ref('')
const targetParentFileId = ref('')
const shareUrl = ref('')
const sharePassword = ref('')
const largeFileMode = ref<'size100' | 'size1000' | 'size5000'>('size1000')
const creating = ref(false)
const recoveryEvidenceOpen = ref(false)
const candidateActionsOpen = ref(false)
const selectedActionIds = ref<string[]>([])
const v1Audit = ref<WorkspaceAgentV1Audit | null>(null)
let cutoverRefreshTimer: ReturnType<typeof setInterval> | undefined

const activeTask = computed(() => tasks.value.find(task => task.id === activeTaskId.value) || tasks.value[0])
const selectedScope = computed(() => drives.value.find(drive => driveKey(drive) === selectedDriveKey.value))
const pendingPlans = computed(() => tasks.value.filter(task => task.status === 'awaiting_approval'))
const inboxTask = computed(() => pendingPlans.value[0])
const isRecoveryTask = computed(() => activeTask.value?.status === 'paused' && !activeTask.value.plan)
const latestEvidence = computed(() => activeTask.value?.evidence.at(-1))
const recoveryConclusion = computed(() => ({ cleanup_duplicates: '未发现重复文件', cleanup_large_files: '未发现符合阈值的大文件', cleanup_empty_directories: '未发现空目录', organize_files: '尚未形成整理计划', import_share: '尚未形成导入计划', download_files: '尚未形成下载计划' })[activeTask.value?.kind || 'cleanup_duplicates'])
const activeActions = computed(() => activeTask.value?.plan?.actions || [])
const candidateActions = computed(() => activeActions.value.filter(action => action.snapshot))
const selectedCandidateCount = computed(() => candidateActions.value.filter(action => selectedActionIds.value.includes(action.id)).length)
const selectedActionCount = computed(() => activeActions.value.filter(action => selectedActionIds.value.includes(action.id)).length)
const allCandidatesSelected = computed(() => candidateActions.value.length > 0 && selectedCandidateCount.value === candidateActions.value.length)
const reclaimedBytes = computed(() => activeActions.value.filter(action => action.kind === 'trash').reduce((sum, action) => sum + (action.snapshot?.size || 0), 0))
const operationGroups = computed(() => {
  const groups = new Map<WorkspacePlanAction['kind'], WorkspacePlanAction[]>()
  for (const action of activeActions.value) groups.set(action.kind, [...(groups.get(action.kind) || []), action])
  return [...groups.entries()].map(([actionKind, actions]) => ({ actionKind, actions, size: actions.reduce((sum, action) => sum + (action.snapshot?.size || 0), 0) }))
})
const evidenceSteps = computed(() => {
  const task = activeTask.value
  if (!task) return []
  const steps = [{ title: '范围已锁定', detail: `${task.scope.name} · ${task.scope.rootId}`, tone: 'violet', time: formatTime(task.createdAt) }]
  for (const evidence of task.evidence) steps.push({ title: evidenceTitle(evidence.source), detail: evidence.summary, tone: 'green', time: formatTime(evidence.createdAt) })
  if (task.plan) steps.push({ title: '已生成可审查计划', detail: `${task.plan.actions.length} 项操作，必须整份审批后执行`, tone: 'green', time: formatTime(task.plan.createdAt) })
  return steps
})
const approvalStatus = computed(() => {
  const task = activeTask.value
  if (!task) return { text: '等待任务', className: 'muted' }
  if (task.plan?.status === 'awaiting_approval') return { text: '待确认', className: 'waiting' }
  if (task.status === 'executing') return { text: '执行中', className: 'progress' }
  if (task.status === 'completed') return { text: '已完成', className: 'success' }
  if (task.status === 'paused') return { text: '已暂停', className: 'warning' }
  if (task.status === 'failed' || task.status === 'stale') return { text: '需处理', className: 'danger' }
  return { text: statusLabel(task.status), className: 'muted' }
})

function driveKey(drive: WorkspaceDriveScope) { return `${drive.userId}:${drive.driveId}` }
function kindLabel(value: WorkspacePlanKind) {
  return ({ organize_files: '整理文件', cleanup_duplicates: '清理重复文件', cleanup_large_files: '清理大文件', cleanup_empty_directories: '清理空目录', import_share: '导入分享', download_files: '下载文件' })[value]
}
function actionLabel(value: WorkspacePlanAction['kind']) { return ({ move: '移动整理', trash: '移入回收站', import_share: '导入分享', download: '创建下载' })[value] }
function actionIcon(value: WorkspacePlanAction['kind']) { return value === 'trash' ? Trash2 : value === 'move' ? FolderInput : value === 'download' ? Download : Link }
function needsKeyword() { return kind.value === 'organize_files' || kind.value === 'download_files' }
function statusLabel(value: WorkspaceTaskView['status']) { return ({ discovering: '正在取证', planning: '正在规划', awaiting_approval: '等待审批', executing: '正在执行', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', paused: '已暂停', stale: '已失效' })[value] }
function evidenceTitle(source: string) { return ({ scanDriveDuplicates: '工具：扫描重复文件', scanDriveLargeFiles: '工具：扫描大文件', scanDriveEmptyDirs: '工具：扫描空目录', searchMyFiles: '工具：搜索网盘文件', inspectShare: '工具：读取分享内容' })[source] || `工具：${source}` }
function formatTime(value: number) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
function formatTaskTime(value: number) { return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + formatTime(value) }

async function refresh(activeId?: string) {
  tasks.value = await listWorkspaceTasks(80, showArchived.value)
  if (activeId) activeTaskId.value = activeId
  else if (!activeTaskId.value && tasks.value[0]) activeTaskId.value = tasks.value[0].id
  syncSelectedActions(activeTask.value)
  void refreshV1Audit(activeTask.value)
}

async function loadDrives() {
  const users = await UserDAL.GetUserListFromDB()
  drives.value = users.filter(user => user?.user_id && user.access_token).map(user => {
    const platform = user.tokenfrom || 'aliyun'
    const driveId = platform === 'aliyun' ? user.resource_drive_id || user.backup_drive_id || user.default_drive_id || '' : driveToolDriveIdForPlatform(platform, user.default_drive_id)
    return { userId: user.user_id, driveId, platform, rootId: driveToolRootIdFor(driveId), name: `${user.nick_name || user.user_name || user.name || user.user_id} · ${platform}` }
  }).filter(drive => drive.driveId && drive.rootId)
  if (!selectedDriveKey.value && drives.value[0]) selectedDriveKey.value = driveKey(drives.value[0])
}

function openPlanner() { plannerVisible.value = true }
function restartPlanning(task: WorkspaceTaskView) {
  kind.value = task.kind
  goal.value = task.goal
  selectedDriveKey.value = driveKey(task.scope)
  plannerVisible.value = true
}
function closePlanner() { plannerVisible.value = false }
async function cancelEvidence(task: WorkspaceTaskView) {
  try {
    replaceTask(await cancelWorkspaceTask(task.id))
    message.success('已取消取证，扫描结果不会生成计划')
  } catch (error: any) {
    message.error(error?.message || '取消取证失败')
  }
}

async function createPlan() {
  const scope = selectedScope.value
  if (!scope) return message.warning('请先选择网盘范围')
  if (!props.aiEnabled && !getAIConfig()) return message.warning('请先配置 AI 服务')
  creating.value = true
  plannerVisible.value = false
  try {
    const task = await createWorkspaceTask({ goal: goal.value.trim() || kindLabel(kind.value), kind: kind.value, scope })
    replaceTask(task)
    message.success('已在后台开始取证')
    void discoverAndPlan(task, { keyword: keyword.value, targetParentFileId: targetParentFileId.value, shareUrl: shareUrl.value, sharePassword: sharePassword.value, largeFileMode: largeFileMode.value }).then(planned => {
      replaceBackgroundTask(planned)
      if (planned.status === 'failed') message.error(planned.summary || '取证或规划失败')
    }).catch(error => {
      message.error(error?.message || '取证或规划失败')
      void refresh(task.id)
    })
  } catch (error: any) {
    message.error(error?.message || '生成计划失败')
  } finally {
    creating.value = false
  }
}

async function approve(task: WorkspaceTaskView) {
  if (!task.plan) return
  try {
    const actionIds = selectedActionIds.value.length ? selectedActionIds.value : task.plan.actions.map(action => action.id)
    const selected = await updateWorkspacePlanSelection({ taskId: task.id, planHash: task.plan.hash, actionIds })
    const approved = await approveWorkspacePlan(selected.id, selected.plan!.hash)
    replaceTask(approved)
    const audit = await getWorkspaceTaskV1Audit(approved.id).catch(() => null)
    if (audit?.cutover && audit.grant) {
      v1Audit.value = audit
      message.success('已提交 Agent V1 主进程执行器')
      return
    }
    replaceTask(await executeApprovedPlan(approved))
  } catch (error: any) {
    message.error(error?.message || '计划执行失败')
    const current = await getWorkspaceTask(task.id)
    if (current) replaceTask(current)
  }
}
async function reject(task: WorkspaceTaskView) {
  if (!task.plan) return
  try { replaceTask(await rejectWorkspacePlan(task.id, task.plan.hash)) } catch (error: any) { message.error(error?.message || '拒绝计划失败') }
}
async function resume(task: WorkspaceTaskView) {
  try { replaceTask(await resumeWorkspaceTask(task.id)) } catch (error: any) { message.error(error?.message || '恢复任务失败') }
}
async function archive(task: WorkspaceTaskView) {
  try {
    await archiveWorkspaceTask(task.id)
    if (activeTaskId.value === task.id) activeTaskId.value = ''
    await refresh()
  } catch (error: any) { message.error(error?.message || '隐藏任务失败') }
}
async function restore(task: WorkspaceTaskView) {
  try { await restoreWorkspaceTask(task.id); showArchived.value = false; await refresh(task.id) } catch (error: any) { message.error(error?.message || '恢复任务失败') }
}
function replaceTask(task: WorkspaceTaskView) {
  const index = tasks.value.findIndex(item => item.id === task.id)
  if (index >= 0) tasks.value.splice(index, 1, task)
  else tasks.value.unshift(task)
  activeTaskId.value = task.id
  syncSelectedActions(task)
  void refreshV1Audit(task)
}
function replaceBackgroundTask(task: WorkspaceTaskView) {
  const index = tasks.value.findIndex(item => item.id === task.id)
  if (index >= 0) tasks.value.splice(index, 1, task)
  else tasks.value.unshift(task)
  if (activeTaskId.value === task.id) syncSelectedActions(task)
}
function syncSelectedActions(task?: WorkspaceTaskView) { selectedActionIds.value = (task?.plan?.actions || []).map(action => action.id) }
function toggleAllCandidates() { selectedActionIds.value = allCandidatesSelected.value ? [] : candidateActions.value.map(action => action.id) }
function selectTask(task: WorkspaceTaskView) { activeTaskId.value = task.id; syncSelectedActions(task); void refreshV1Audit(task) }
async function refreshV1Audit(task?: WorkspaceTaskView) {
  const taskId = task?.id
  v1Audit.value = null
  if (!taskId) return
  const audit = await getWorkspaceTaskV1Audit(taskId).catch(() => null)
  if (activeTask.value?.id === taskId) v1Audit.value = audit
}
function toggleCandidateList() { if (!candidateActionsOpen.value && !selectedActionIds.value.length) syncSelectedActions(activeTask.value); candidateActionsOpen.value = !candidateActionsOpen.value }

onMounted(async () => {
  await Promise.all([loadDrives(), refresh()])
  cutoverRefreshTimer = setInterval(() => {
    const task = activeTask.value
    if (task?.status === 'executing' && v1Audit.value?.cutover) void refresh(task.id)
  }, 1500)
})
onUnmounted(() => {
  if (cutoverRefreshTimer) clearInterval(cutoverRefreshTimer)
})
</script>

<template>
  <div class="workspace-agent">
    <aside v-show="props.sidebarVisible !== false" class="workspace-agent__rail">
      <button type="button" class="workspace-agent__back" @click="emit('back-to-documents')"><ArrowLeft :size="16" />返回文档洞察</button>
      <section class="workspace-agent__rail-section workspace-agent__drives">
        <div class="workspace-agent__section-title"><span>云端账号</span><button type="button" title="新建任务" @click="openPlanner"><Plus :size="15" /></button></div>
        <label class="workspace-agent__scope">当前范围<select v-model="selectedDriveKey"><option v-for="drive in drives" :key="driveKey(drive)" :value="driveKey(drive)">{{ drive.name }}</option></select></label>
        <div v-for="drive in drives.slice(0, 3)" :key="driveKey(drive)" class="workspace-agent__drive" :class="{ selected: driveKey(drive) === selectedDriveKey }"><HardDrive :size="17" /><span>{{ drive.name }}</span><CheckCircle2 :size="15" /></div>
      </section>

      <section class="workspace-agent__history">
        <div class="workspace-agent__section-title"><span>任务历史</span><button type="button" @click="showArchived = !showArchived; refresh()">{{ showArchived ? '返回列表' : '查看全部' }}</button></div>
        <div v-for="task in tasks" :key="task.id" class="workspace-agent__history-row">
          <button type="button" class="workspace-agent__task" :class="{ active: activeTask?.id === task.id }" @click="selectTask(task)">
            <span class="workspace-agent__task-icon"><component :is="task.kind === 'cleanup_duplicates' ? ClipboardCheck : FileSearch" :size="15" /></span>
            <span class="workspace-agent__task-copy"><strong>{{ task.goal }}</strong><small>{{ formatTaskTime(task.createdAt) }}</small></span>
            <em :class="approvalStatus.className">{{ task.id === activeTask?.id ? approvalStatus.text : statusLabel(task.status) }}</em>
          </button>
          <button v-if="showArchived && task.archivedAt" type="button" class="workspace-agent__history-action" title="恢复到默认列表" @click="restore(task)"><Check :size="14" /></button>
          <button v-else-if="!['discovering', 'planning', 'awaiting_approval', 'executing'].includes(task.status)" type="button" class="workspace-agent__history-action" title="从历史隐藏（保留审计记录）" @click="archive(task)"><X :size="14" /></button>
        </div>
        <div v-if="!tasks.length" class="workspace-agent__history-empty">尚无任务记录</div>
      </section>
      <button type="button" class="workspace-agent__new-task" @click="openPlanner"><Plus :size="18" />新建任务</button>
    </aside>

    <main class="workspace-agent__main">
      <template v-if="activeTask">
        <header class="workspace-agent__task-header">
          <span class="workspace-agent__hero-icon"><Sparkles :size="24" /></span>
          <div class="workspace-agent__header-copy"><small>当前任务</small><h1>{{ activeTask.goal }}</h1><p>任务来源：手动创建　·　{{ formatTaskTime(activeTask.createdAt) }}</p></div>
          <span class="workspace-agent__status-pill" :class="approvalStatus.className"><i />{{ approvalStatus.text }}</span>
        </header>

        <section v-if="isRecoveryTask" class="workspace-agent__recovery">
          <div class="workspace-agent__recovery-conclusion"><span><CheckCircle2 :size="21" /></span><div><small>扫描结论</small><h2>{{ recoveryConclusion }}</h2><p>{{ latestEvidence?.summary || '当前任务未形成新的取证结论。' }}</p></div></div>
          <div class="workspace-agent__recovery-meta"><span><HardDrive :size="16" />范围：{{ activeTask.scope.name }} / 根目录</span><span><Database :size="16" />已扫描：{{ activeTask.evidence.length ? '已保存 1 份证据' : '尚未保存证据' }}</span></div>
          <div class="workspace-agent__recovery-reason"><AlertCircle :size="18" /><div><strong>为什么需要重新取证</strong><p>{{ activeTask.summary || '应用会话已中断，当前证据可能已过期，不能直接生成或执行计划。' }}</p></div></div>
          <div class="workspace-agent__recovery-actions"><button type="button" class="workspace-agent__approve" @click="restartPlanning(activeTask)"><FileSearch :size="18" />重新取证并生成计划</button><button type="button" class="workspace-agent__plain-action" @click="openPlanner"><Plus :size="17" />新建任务</button><button type="button" class="workspace-agent__plain-action" @click="recoveryEvidenceOpen = !recoveryEvidenceOpen"><FileOutput :size="17" />{{ recoveryEvidenceOpen ? '收起完整证据' : '查看完整证据' }}</button><button type="button" class="workspace-agent__plain-action" @click="archive(activeTask)"><X :size="17" />从历史隐藏</button></div>
          <article v-if="recoveryEvidenceOpen && latestEvidence" class="workspace-agent__recovery-evidence"><strong>{{ evidenceTitle(latestEvidence.source) }}</strong><p>{{ latestEvidence.summary }}</p><em>evidence/{{ latestEvidence.id.slice(0, 8) }}.json</em></article>
          <small class="workspace-agent__recovery-note">重新取证会创建一份新的可审查计划；旧证据和旧计划不会被用于执行。</small>
        </section>

        <template v-else>
        <section class="workspace-agent__evidence-panel">
          <div class="workspace-agent__panel-heading"><h2>证据链</h2><span>所有操作均可追溯</span></div>
          <div v-if="evidenceSteps.length" class="workspace-agent__timeline">
            <article v-for="step in evidenceSteps" :key="`${step.title}-${step.time}`" class="workspace-agent__timeline-row">
              <span class="workspace-agent__timeline-dot" :class="step.tone" /><span class="workspace-agent__timeline-icon" :class="step.tone"><Database v-if="step.title.includes('范围')" :size="17" /><Search v-else-if="step.title.includes('扫描') || step.title.includes('搜索')" :size="17" /><ShieldCheck v-else :size="17" /></span>
              <div><strong>{{ step.title }}</strong><p>{{ step.detail }}</p></div><time>{{ step.time }}</time><CheckCircle2 :size="16" class="workspace-agent__timeline-check" />
            </article>
          </div>
          <div v-else class="workspace-agent__timeline-empty"><Clock3 :size="17" />等待 Agent 开始取证</div>
        </section>

        <section class="workspace-agent__plan-panel">
          <div class="workspace-agent__plan-heading"><div><h2>{{ activeTask.plan ? '待确认计划' : '计划状态' }}</h2><span>{{ activeTask.plan ? '基于已验证的证据生成' : activeTask.summary || '尚未生成可执行计划' }}</span><code v-if="activeTask.plan?.status === 'awaiting_approval'" class="workspace-agent__plan-fingerprint">计划指纹 {{ activeTask.plan.hash.slice(0, 12) }}</code><code v-if="v1Audit?.plan" class="workspace-agent__plan-fingerprint">V1 {{ v1Audit.plan.status }} · {{ v1Audit.plan.hash.slice(0, 12) }}</code></div><strong v-if="reclaimedBytes">预计释放空间：{{ humanSize(reclaimedBytes) }}</strong></div>
          <div v-if="operationGroups.length" class="workspace-agent__action-table">
            <div class="workspace-agent__table-head"><span>优先级</span><span>操作策略</span><span>文件数</span><span>预计影响</span><span>示例文件</span><span>操作</span></div>
            <div v-for="(group, index) in operationGroups" :key="group.actionKind" class="workspace-agent__table-row"><span><b :class="index === 0 ? 'high' : 'medium'">{{ index === 0 ? '高' : '中' }}</b></span><span>{{ actionLabel(group.actionKind) }}</span><span>{{ group.actions.length }}</span><span>{{ group.size ? humanSize(group.size) : '—' }}</span><span :title="group.actions[0]?.label">{{ group.actions[0]?.snapshot?.name || group.actions[0]?.label }}</span><button type="button" :aria-expanded="candidateActionsOpen" @click="toggleCandidateList">{{ candidateActionsOpen ? '收起列表' : `查看全部 ${group.actions.length} 项` }}</button></div>
            <div class="workspace-agent__table-total"><span>合计</span><span /><span>{{ activeActions.length }}</span><span>{{ reclaimedBytes ? humanSize(reclaimedBytes) : '—' }}</span><span /></div>
          </div>
          <section v-if="candidateActionsOpen && candidateActions.length" class="workspace-agent__candidates"><header><label><input type="checkbox" :checked="allCandidatesSelected" @change="toggleAllCandidates" />全选</label><strong>待执行文件</strong><span>已选 {{ selectedCandidateCount }}/{{ candidateActions.length }} 项；仅选中项会移入回收站。</span></header><div class="workspace-agent__candidate-list"><label v-for="(action, index) in candidateActions" :key="action.id"><input v-model="selectedActionIds" type="checkbox" :value="action.id" /><b>{{ index + 1 }}</b><span :title="action.snapshot?.name">{{ action.snapshot?.name }}</span><em>{{ action.snapshot?.size ? humanSize(action.snapshot.size) : '—' }}</em></label></div></section>
          <div v-else class="workspace-agent__no-plan"><component :is="activeTask.status === 'failed' ? AlertCircle : FileOutput" :size="19" /><div><strong>{{ activeTask.status === 'discovering' || activeTask.status === 'planning' ? '正在后台取证' : activeTask.status === 'completed' ? '未发现需要处理的项目' : '尚未形成可执行计划' }}</strong><p>{{ activeTask.status === 'discovering' || activeTask.status === 'planning' ? '扫描仍在后台进行；你可以继续使用应用，或取消本次取证。' : activeTask.summary || '完成取证后，Agent 会在这里给出可审查的完整计划。' }}</p></div></div>
        </section>

        <section class="workspace-agent__sources-panel"><div class="workspace-agent__panel-heading"><h2>来源证据 <span>（可追溯）</span></h2><button type="button"><FileOutput :size="15" />导出证据包</button></div><div class="workspace-agent__source-cards"><article v-for="evidence in activeTask.evidence.slice(0, 3)" :key="evidence.id"><span><Database :size="19" /></span><div><strong>{{ evidence.source }}</strong><p>{{ evidence.summary }}</p><em>evidence/{{ evidence.id.slice(0, 8) }}.json</em></div></article><p v-if="!activeTask.evidence.length">计划完成后将在此处保存可导出的证据快照。</p></div></section>

        <footer v-if="activeTask.plan?.status === 'awaiting_approval' || activeTask.status === 'discovering' || activeTask.status === 'planning' || activeTask.status === 'paused'" class="workspace-agent__approval-bar"><button v-if="activeTask.plan?.status === 'awaiting_approval'" type="button" class="workspace-agent__reject" @click="reject(activeTask)"><X :size="17" />拒绝计划</button><button v-else-if="activeTask.status === 'discovering' || activeTask.status === 'planning'" type="button" class="workspace-agent__reject" @click="cancelEvidence(activeTask)"><X :size="17" />取消取证</button><button v-if="activeTask.plan?.status === 'awaiting_approval'" type="button" class="workspace-agent__approve" :disabled="!selectedActionCount" @click="approve(activeTask)"><ShieldCheck :size="19" />确认执行 {{ selectedActionCount }} 项</button><button v-else-if="activeTask.status === 'paused'" type="button" class="workspace-agent__approve" @click="resume(activeTask)"><Play :size="18" />手动恢复</button><button v-else type="button" class="workspace-agent__approve" disabled><Clock3 :size="18" />后台取证中</button><small>{{ activeTask.status === 'discovering' || activeTask.status === 'planning' ? '取证完成后会自动生成可审查计划' : activeTask.plan?.status === 'awaiting_approval' ? `将仅执行当前选中的 ${selectedActionCount} 项；未选项目不会移入回收站。` : '任务暂停后可手动恢复并重新校验。' }}</small></footer>
        </template>
      </template>
      <section v-else class="workspace-agent__blank"><Sparkles :size="31" /><strong>从一个网盘目标开始</strong><p>创建任务后，Agent 会先收集证据，再提交完整计划。</p><button type="button" @click="openPlanner"><Plus :size="17" />新建任务</button></section>
    </main>

    <aside class="workspace-agent__inbox">
      <section>
        <div class="workspace-agent__inbox-title"><h2>审批收件箱</h2><button type="button">全部标为已读</button></div>
        <article v-if="inboxTask" class="workspace-agent__approval-card waiting">
          <span class="workspace-agent__approval-icon"><ShieldCheck :size="17" /></span>
          <div class="workspace-agent__approval-copy"><strong>待确认计划</strong><p>{{ inboxTask.plan?.summary || inboxTask.summary || '任务正在等待下一步操作。' }}</p><small>来源：智能工作台 · {{ formatTime(inboxTask.updatedAt) }}</small></div>
          <div class="workspace-agent__approval-actions"><button type="button" @click="selectTask(inboxTask)">查看详情</button><button type="button" @click="approve(inboxTask)">待确认</button></div>
        </article>
        <p v-else class="workspace-agent__inbox-empty">暂无待审批计划</p>
      </section>
      <section class="workspace-agent__policy"><div class="workspace-agent__inbox-title"><h2>策略与合规检查</h2><button type="button">策略详情</button></div><small>当前策略：安全优先默认策略</small><ul><li><CheckCircle2 :size="16" />仅建议可回收的操作，需审批后执行</li><li><CheckCircle2 :size="16" />执行前重新校验文件、账号与范围</li><li><CheckCircle2 :size="16" />计划中断后需人工恢复并重新取证</li><li><CheckCircle2 :size="16" />媒体入库与追更任务完全隔离</li></ul><div class="workspace-agent__policy-result"><ShieldCheck :size="17" />策略模拟结果：通过</div></section>
    </aside>

    <div v-if="plannerVisible" class="workspace-agent__modal" @click.self="closePlanner"><form class="workspace-agent__planner" @submit.prevent="createPlan"><header><div><small>新建任务</small><h2>生成可审查计划</h2></div><button type="button" :disabled="creating" @click="closePlanner"><X :size="18" /></button></header><label>网盘范围<select v-model="selectedDriveKey" :disabled="creating"><option v-for="drive in drives" :key="driveKey(drive)" :value="driveKey(drive)">{{ drive.name }}</option></select></label><label>计划类型<select v-model="kind" :disabled="creating"><option value="cleanup_duplicates">重复文件清理</option><option value="cleanup_large_files">大文件清理</option><option value="cleanup_empty_directories">空目录清理</option><option value="organize_files">文件整理</option><option value="download_files">下载计划</option><option value="import_share">分享导入</option></select></label><label>任务目标<input v-model="goal" :disabled="creating" placeholder="例如：清理下载目录中的重复文件" /></label><label v-if="needsKeyword()">搜索关键词<input v-model="keyword" :disabled="creating" placeholder="输入文件关键词" /></label><label v-if="kind === 'organize_files'">目标目录 ID<input v-model="targetParentFileId" :disabled="creating" placeholder="输入目标目录 ID" /></label><label v-if="kind === 'cleanup_large_files'">文件阈值<select v-model="largeFileMode" :disabled="creating"><option value="size100">大于 100 MB</option><option value="size1000">大于 1 GB</option><option value="size5000">大于 5 GB</option></select></label><template v-if="kind === 'import_share'"><label>分享链接<input v-model="shareUrl" :disabled="creating" placeholder="阿里云盘或夸克分享链接" /></label><label>提取码（可选）<input v-model="sharePassword" :disabled="creating" /></label></template><footer><button type="button" @click="closePlanner">取消</button><button type="submit" class="primary" :disabled="creating"><FileSearch :size="16" />{{ creating ? '正在创建…' : '开始取证' }}</button></footer></form></div>
  </div>
</template>

<style scoped>
.workspace-agent { --wa-line: rgba(145,157,185,.17); --wa-panel: rgba(16,20,28,.76); --wa-soft: rgba(255,255,255,.035); --wa-text: #f1f3f9; --wa-muted: #8d94a6; --wa-accent: #7667ff; --wa-green: #48c98d; display:grid; grid-template-columns:250px minmax(480px,1fr) 312px; height:100%; min-height:0; overflow:hidden; color:var(--wa-text); border:1px solid rgba(150,166,198,.15); border-radius:15px; background:radial-gradient(circle at 66% 0%,rgba(9,79,68,.28),transparent 37%),linear-gradient(145deg,rgba(20,22,28,.98),rgba(8,10,14,.99)); box-shadow:inset 0 1px 0 rgba(255,255,255,.035); }
.workspace-agent button { border:0; color:inherit; background:transparent; cursor:pointer; font:inherit; }.workspace-agent__rail { display:flex; min-height:0; flex-direction:column; border-right:1px solid var(--wa-line); background:rgba(15,17,23,.76); }.workspace-agent__rail-section { padding:16px; border-bottom:1px solid var(--wa-line); }.workspace-agent__section-title,.workspace-agent__inbox-title { display:flex; align-items:center; justify-content:space-between; }.workspace-agent__section-title span,.workspace-agent__inbox-title h2 { margin:0; font-size:14px; font-weight:750; }.workspace-agent__section-title button,.workspace-agent__inbox-title button { color:#8d80ff; font-size:12px; }.workspace-agent__section-title button:first-of-type { display:grid; width:25px; height:25px; place-items:center; border:1px solid var(--wa-line); border-radius:7px; color:#b9c0d0; }.workspace-agent__scope { display:flex; flex-direction:column; gap:6px; margin:12px 0 8px; color:var(--wa-muted); font-size:11px; }.workspace-agent select,.workspace-agent input { width:100%; min-height:35px; box-sizing:border-box; border:1px solid rgba(150,160,181,.18); border-radius:6px; padding:0 10px; outline:0; color:var(--wa-text); background:rgba(0,0,0,.25); font:inherit; font-size:12px; }.workspace-agent select:focus,.workspace-agent input:focus { border-color:rgba(126,108,255,.8); }.workspace-agent__drive { display:flex; align-items:center; gap:9px; padding:7px 0; color:#b9becc; font-size:12px; }.workspace-agent__drive span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__drive svg:last-child { color:var(--wa-green); }.workspace-agent__history { display:flex; min-height:0; flex:1; flex-direction:column; gap:5px; padding:15px 8px; overflow:auto; }.workspace-agent__history .workspace-agent__section-title { padding:0 8px 7px; }.workspace-agent__history .workspace-agent__section-title button:first-of-type { display:block; width:auto; height:auto; border:0; }.workspace-agent__task { display:flex; min-height:64px; align-items:flex-start; gap:8px; padding:10px 9px; border:1px solid transparent!important; border-radius:7px; text-align:left; }.workspace-agent__task:hover { background:var(--wa-soft); }.workspace-agent__task.active { border-color:rgba(118,103,255,.84)!important; background:linear-gradient(120deg,rgba(88,74,190,.3),rgba(33,31,50,.44)); box-shadow:inset 0 0 20px rgba(91,74,241,.08); }.workspace-agent__task-icon { display:grid; width:24px; height:24px; flex:0 0 auto; place-items:center; border-radius:7px; color:#b4a9ff; background:rgba(113,94,255,.18); }.workspace-agent__task-copy { display:flex; min-width:0; flex:1; flex-direction:column; gap:5px; }.workspace-agent__task-copy strong { overflow:hidden; font-size:12px; font-weight:650; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__task-copy small { color:var(--wa-muted); font-size:11px; }.workspace-agent__task em { padding-top:3px; font-size:10px; font-style:normal; white-space:nowrap; }.waiting { color:#bcaeff!important; }.progress { color:#8ea1ff!important; }.success { color:var(--wa-green)!important; }.warning { color:#e9b95d!important; }.danger { color:#ef8e91!important; }.muted { color:#8d94a6!important; }.workspace-agent__history-empty { padding:15px 8px; color:var(--wa-muted); font-size:12px; }.workspace-agent__new-task { display:flex; align-items:center; gap:8px; margin:12px; padding:14px; border-top:1px solid var(--wa-line)!important; color:#d7d3ff!important; font-size:14px; text-align:left; }
.workspace-agent__main { display:flex; min-width:0; min-height:0; flex-direction:column; justify-content:space-between; overflow:auto; }.workspace-agent__main>* { flex:0 0 auto; }.workspace-agent__task-header { display:flex; min-height:96px; align-items:center; gap:14px; padding:16px 20px; border-bottom:1px solid var(--wa-line); }.workspace-agent__hero-icon { display:grid; width:48px; height:48px; place-items:center; border-radius:12px; color:#d0c9ff; background:linear-gradient(145deg,#4e448b,#27284e); box-shadow:0 8px 18px rgba(77,65,169,.25); }.workspace-agent__header-copy { min-width:0; flex:1; }.workspace-agent__header-copy small { color:var(--wa-muted); font-size:12px; }.workspace-agent__header-copy h1 { max-width:620px; margin:3px 0; overflow:hidden; font-size:18px; font-weight:750; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__header-copy p { margin:0; color:var(--wa-muted); font-size:12px; }.workspace-agent__status-pill { display:flex; align-items:center; gap:7px; padding:8px 13px; border:1px solid var(--wa-line); border-radius:999px; background:rgba(0,0,0,.16); font-size:12px; }.workspace-agent__status-pill i { width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 10px currentColor; }
.workspace-agent__evidence-panel,.workspace-agent__plan-panel,.workspace-agent__sources-panel { padding:14px 20px 0; }.workspace-agent__panel-heading,.workspace-agent__plan-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }.workspace-agent__panel-heading h2,.workspace-agent__plan-heading h2 { margin:0; font-size:15px; }.workspace-agent__panel-heading h2 span { color:var(--wa-muted); font-size:12px; font-weight:400; }.workspace-agent__panel-heading>span,.workspace-agent__plan-heading span { color:var(--wa-muted); font-size:12px; }.workspace-agent__panel-heading button { display:flex; align-items:center; gap:5px; padding:6px 9px; border:1px solid var(--wa-line); border-radius:7px; color:#c4c9d7; font-size:12px; }.workspace-agent__timeline { margin-top:10px; border-left:1px solid rgba(147,158,183,.34); }.workspace-agent__timeline-row { position:relative; display:grid; grid-template-columns:34px minmax(0,1fr) 55px 17px; align-items:center; gap:7px; min-height:54px; margin-left:11px; padding:0 11px; border:1px solid var(--wa-line); border-radius:7px; background:rgba(255,255,255,.018); }.workspace-agent__timeline-row + .workspace-agent__timeline-row { margin-top:5px; }.workspace-agent__timeline-dot { position:absolute; left:-16px; width:8px; height:8px; border-radius:50%; background:#778093; }.workspace-agent__timeline-dot.green { background:var(--wa-green); }.workspace-agent__timeline-dot.violet { background:#988aff; }.workspace-agent__timeline-icon { display:grid; width:28px; height:28px; place-items:center; border-radius:7px; color:#a79dff; background:rgba(122,107,255,.15); }.workspace-agent__timeline-icon.green { color:#62d9a1; background:rgba(50,190,126,.12); }.workspace-agent__timeline-row strong { display:block; margin-bottom:3px; font-size:12px; }.workspace-agent__timeline-row p { margin:0; overflow:hidden; color:var(--wa-muted); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__timeline-row time { color:#8d94a6; font-size:10px; }.workspace-agent__timeline-check { color:var(--wa-green); }.workspace-agent__timeline-empty { display:flex; align-items:center; gap:7px; margin-top:12px; padding:13px; border:1px dashed var(--wa-line); border-radius:8px; color:var(--wa-muted); font-size:12px; }
.workspace-agent__plan-heading { padding-top:5px; }.workspace-agent__plan-heading>div { display:flex; align-items:baseline; gap:10px; min-width:0; }.workspace-agent__plan-heading>strong { color:#c9d0df; font-size:12px; font-weight:500; }.workspace-agent__plan-fingerprint { padding:2px 6px; overflow:hidden; border:1px solid rgba(132,119,255,.38); border-radius:4px; color:#bdb5ff; background:rgba(103,86,221,.13); font:10px ui-monospace,SFMono-Regular,Menlo,monospace; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__action-table { margin-top:10px; overflow:hidden; border:1px solid var(--wa-line); border-radius:8px; }.workspace-agent__table-head,.workspace-agent__table-row,.workspace-agent__table-total { display:grid; grid-template-columns:72px minmax(110px,1.2fr) 62px 110px minmax(110px,1.2fr) 70px; align-items:center; min-height:34px; border-bottom:1px solid var(--wa-line); font-size:11px; }.workspace-agent__table-head { min-height:33px; color:#abb1c0; background:rgba(255,255,255,.045); }.workspace-agent__table-row { color:#d7dbe4; }.workspace-agent__table-total { border:0; color:#c9cfda; font-weight:700; }.workspace-agent__table-head span,.workspace-agent__table-row span,.workspace-agent__table-total span { min-width:0; padding:0 9px; overflow:hidden; border-right:1px solid var(--wa-line); text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__table-row b { display:inline-flex; min-width:25px; justify-content:center; padding:3px 7px; border-radius:5px; font-size:10px; }.workspace-agent__table-row b.high { color:#ffb5b5; background:rgba(197,69,65,.32); }.workspace-agent__table-row b.medium { color:#f4cd7f; background:rgba(180,126,26,.28); }.workspace-agent__table-row button { color:#a99dff; font-size:11px; }.workspace-agent__no-plan { display:flex; align-items:flex-start; gap:10px; margin-top:11px; padding:17px; border:1px dashed var(--wa-line); border-radius:8px; color:#7e89a0; }.workspace-agent__no-plan strong { color:#d6dae3; font-size:13px; }.workspace-agent__no-plan p { margin:5px 0 0; color:var(--wa-muted); font-size:12px; }.workspace-agent__source-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; margin-top:10px; }.workspace-agent__source-cards article { display:flex; min-height:63px; gap:9px; padding:10px; border:1px solid var(--wa-line); border-radius:8px; background:rgba(255,255,255,.018); }.workspace-agent__source-cards article>span { display:grid; width:28px; height:28px; flex:0 0 auto; place-items:center; border-radius:50%; color:#a79dff; background:rgba(119,101,255,.17); }.workspace-agent__source-cards strong { display:block; overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__source-cards p { display:-webkit-box; margin:4px 0; overflow:hidden; color:var(--wa-muted); font-size:10px; -webkit-box-orient:vertical; -webkit-line-clamp:1; }.workspace-agent__source-cards em { color:#9a8eff; font-size:10px; font-style:normal; }.workspace-agent__source-cards>p { grid-column:1/-1; color:var(--wa-muted); font-size:12px; }
.workspace-agent__approval-bar { display:grid; grid-template-columns:154px 1fr; align-items:center; gap:15px; margin:17px 20px 16px; }.workspace-agent__approval-bar button { min-height:44px; border-radius:8px; font-weight:700; }.workspace-agent__reject { display:flex; align-items:center; justify-content:center; gap:7px; border:1px solid rgba(242,102,101,.65)!important; color:#ef8f8f!important; }.workspace-agent__approve { display:flex; align-items:center; justify-content:center; gap:9px; color:white!important; background:linear-gradient(100deg,#5d5cff,#806eff)!important; box-shadow:0 8px 22px rgba(102,88,255,.27); }.workspace-agent__approval-bar small { grid-column:2; margin-top:-10px; color:#7f8798; font-size:11px; text-align:center; }.workspace-agent__blank { display:flex; height:100%; align-items:center; justify-content:center; flex-direction:column; gap:10px; color:#8c94a6; }.workspace-agent__blank strong { color:#e0e4eb; font-size:16px; }.workspace-agent__blank p { margin:0; font-size:12px; }.workspace-agent__blank button { display:flex; align-items:center; gap:6px; margin-top:5px; padding:10px 14px; border-radius:7px; color:#fff; background:#5f63ff; }
.workspace-agent__inbox { display:flex; min-height:0; flex-direction:column; gap:12px; padding:14px; border-left:1px solid var(--wa-line); overflow:auto; background:rgba(10,12,17,.57); }.workspace-agent__inbox section { padding:13px; border:1px solid var(--wa-line); border-radius:9px; background:rgba(255,255,255,.018); }.workspace-agent__approval-card { position:relative; display:flex; gap:9px; margin-top:12px; padding:12px; border:1px solid rgba(122,104,255,.75); border-radius:8px; background:linear-gradient(140deg,rgba(66,55,133,.32),rgba(30,28,44,.4)); }.workspace-agent__approval-card.success { border-color:rgba(66,201,141,.45); }.workspace-agent__approval-card.warning { border-color:rgba(233,185,93,.45); }.workspace-agent__approval-icon { display:grid; width:25px; height:25px; flex:0 0 auto; place-items:center; border-radius:7px; color:#baafff; background:rgba(121,103,255,.18); }.workspace-agent__approval-card strong { font-size:13px; }.workspace-agent__approval-card p { display:-webkit-box; margin:6px 0; overflow:hidden; color:#a9b0bf; font-size:11px; line-height:1.4; -webkit-box-orient:vertical; -webkit-line-clamp:2; }.workspace-agent__approval-card b { display:block; color:#f0c36e; font-size:11px; }.workspace-agent__approval-card small { display:block; margin-top:7px; color:#8d94a6; font-size:10px; }.workspace-agent__approval-actions { display:grid; grid-template-columns:1fr 1fr; position:absolute; right:10px; bottom:10px; left:10px; gap:7px; }.workspace-agent__approval-actions button,.workspace-agent__inbox-resume { min-height:31px; border:1px solid var(--wa-line)!important; border-radius:6px; color:#d7dbe5; background:rgba(255,255,255,.04)!important; font-size:11px; }.workspace-agent__approval-actions button:last-child { color:#fff; border:0!important; background:#6c61ee!important; }.workspace-agent__approval-card:has(.workspace-agent__approval-actions) { padding-bottom:50px; }.workspace-agent__inbox-resume { display:flex; align-items:center; justify-content:center; gap:5px; position:absolute; right:10px; bottom:10px; left:10px; }.workspace-agent__inbox-empty { margin:15px 0 0; color:var(--wa-muted); font-size:12px; }.workspace-agent__policy { margin-top:auto; }.workspace-agent__policy>small { display:block; margin:9px 0; color:var(--wa-muted); font-size:11px; }.workspace-agent__policy ul { display:flex; flex-direction:column; gap:9px; margin:13px 0; padding:0; list-style:none; }.workspace-agent__policy li { display:flex; align-items:flex-start; gap:7px; color:#c8ceda; font-size:11px; line-height:1.35; }.workspace-agent__policy li svg { flex:0 0 auto; color:var(--wa-green); }.workspace-agent__policy-result { display:flex; align-items:center; gap:7px; padding:10px; border:1px solid rgba(73,200,141,.3); border-radius:7px; color:#78d8a5; background:rgba(44,174,112,.08); font-size:12px; }
.workspace-agent__modal { display:grid; position:absolute; z-index:9; inset:0; place-items:center; padding:20px; background:rgba(1,3,7,.65); backdrop-filter:blur(5px); }.workspace-agent__planner { width:min(430px,100%); padding:20px; border:1px solid rgba(140,128,255,.43); border-radius:13px; background: var(--app-overlay-bg); box-shadow:0 30px 90px rgba(0,0,0,.6); }.workspace-agent__planner header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:18px; }.workspace-agent__planner header small { color:#9e95ff; font-size:11px; }.workspace-agent__planner h2 { margin:4px 0 0; font-size:19px; }.workspace-agent__planner header button { display:grid; width:30px; height:30px; place-items:center; border:1px solid var(--wa-line); border-radius:7px; }.workspace-agent__planner label { display:flex; flex-direction:column; gap:6px; margin:10px 0; color:#b4bac8; font-size:12px; }.workspace-agent__planner footer { display:flex; justify-content:flex-end; gap:9px; margin-top:18px; }.workspace-agent__planner footer button { min-height:36px; padding:0 13px; border:1px solid var(--wa-line); border-radius:7px; }.workspace-agent__planner footer .primary { display:flex; align-items:center; gap:6px; border:0; color:#fff; background:#625eff; }
.workspace-agent__planner-tip { margin:14px 0 -3px; color:var(--wa-muted); font-size:11px; line-height:1.45; }.workspace-agent__planner footer .danger { display:flex; align-items:center; gap:6px; color:#f0a09d; border-color:rgba(242,102,101,.55); background:rgba(242,102,101,.06); }
.workspace-agent__back { display:flex; min-height:42px; align-items:center; gap:7px; padding:0 16px; border-bottom:1px solid var(--wa-line)!important; color:var(--wa-muted)!important; font-size:12px!important; text-align:left; }.workspace-agent__back:hover { color:var(--wa-text)!important; background:rgba(127,111,255,.08)!important; }
.workspace-agent__approval-card { display:grid; grid-template-columns:25px minmax(0,1fr); align-items:start; }.workspace-agent__approval-copy { min-width:0; }.workspace-agent__approval-actions,.workspace-agent__inbox-resume { position:static; grid-column:1 / -1; width:100%; margin-top:3px; }.workspace-agent__approval-card:has(.workspace-agent__approval-actions) { padding-bottom:12px; }
.workspace-agent__history-row { display:flex; align-items:center; gap:2px; }.workspace-agent__history-row .workspace-agent__task { min-width:0; flex:1; }.workspace-agent__history-action { display:grid; width:25px; height:25px; flex:0 0 auto; place-items:center; border-radius:6px!important; color:var(--wa-muted)!important; }.workspace-agent__history-action:hover { color:var(--wa-text)!important; background:rgba(127,111,255,.14)!important; }
.workspace-agent__recovery { display:flex; width:min(680px,calc(100% - 40px)); flex-direction:column; gap:15px; margin:auto; padding:24px; border:1px solid var(--wa-line); border-radius:13px; background:linear-gradient(140deg,rgba(34,42,50,.58),rgba(11,14,20,.5)); }.workspace-agent__recovery-conclusion { display:flex; align-items:flex-start; gap:12px; }.workspace-agent__recovery-conclusion>span { display:grid; width:38px; height:38px; flex:0 0 auto; place-items:center; border-radius:11px; color:var(--wa-green); background:rgba(56,195,132,.12); }.workspace-agent__recovery small { color:var(--wa-muted); font-size:11px; }.workspace-agent__recovery h2 { margin:3px 0 5px; font-size:19px; }.workspace-agent__recovery p { margin:0; color:var(--wa-muted); font-size:12px; line-height:1.55; }.workspace-agent__recovery-meta { display:flex; flex-wrap:wrap; gap:9px; }.workspace-agent__recovery-meta span { display:flex; min-width:0; align-items:center; gap:6px; padding:8px 10px; border-radius:7px; color:#bdc5d4; background:rgba(255,255,255,.035); font-size:11px; }.workspace-agent__recovery-meta svg { color:#a497ff; }.workspace-agent__recovery-reason { display:flex; gap:9px; padding:12px; border:1px solid rgba(233,185,93,.26); border-radius:8px; color:#e9b95d; background:rgba(233,185,93,.07); }.workspace-agent__recovery-reason strong { display:block; margin-bottom:4px; font-size:12px; }.workspace-agent__recovery-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }.workspace-agent__recovery-actions .workspace-agent__approve { min-height:40px; grid-column:1 / -1; border-radius:8px; font-weight:700; }.workspace-agent__plain-action { display:flex; min-height:35px; align-items:center; justify-content:center; gap:6px; border:1px solid var(--wa-line)!important; border-radius:7px; color:#cbd1dd!important; background:rgba(255,255,255,.025)!important; font-size:12px; }.workspace-agent__plain-action:hover { background:rgba(127,111,255,.1)!important; }.workspace-agent__recovery-note { text-align:center; }.workspace-agent__recovery-evidence { padding:12px; border:1px solid var(--wa-line); border-radius:8px; background:rgba(0,0,0,.12); }.workspace-agent__recovery-evidence strong { display:block; font-size:12px; }.workspace-agent__recovery-evidence p { margin:5px 0; }.workspace-agent__recovery-evidence em { color:#9b8eff; font-size:10px; font-style:normal; }
@media (max-width:1180px) { .workspace-agent { grid-template-columns:220px minmax(0,1fr); }.workspace-agent__inbox { display:none; } } @media (max-width:800px) { .workspace-agent { grid-template-columns:1fr; }.workspace-agent__rail { display:none; }.workspace-agent__source-cards { grid-template-columns:1fr; }.workspace-agent__action-table { overflow:auto; }.workspace-agent__table-head,.workspace-agent__table-row,.workspace-agent__table-total { min-width:620px; }.workspace-agent__task-header { padding:14px; }.workspace-agent__evidence-panel,.workspace-agent__plan-panel,.workspace-agent__sources-panel { padding-right:14px; padding-left:14px; }.workspace-agent__approval-bar { margin-right:14px; margin-left:14px; } }

:global(body:not([arco-theme='dark'])) .workspace-agent { --wa-line:var(--color-border-2); --wa-panel:var(--color-bg-2); --wa-soft:var(--color-fill-2); --wa-text:var(--color-text-1); --wa-muted:var(--color-text-3); --wa-green:#138a59; color:var(--wa-text); border-color:var(--wa-line); background:var(--color-bg-1); box-shadow:none; }
:global(body:not([arco-theme='dark'])) .workspace-agent__rail,:global(body:not([arco-theme='dark'])) .workspace-agent__inbox,:global(body:not([arco-theme='dark'])) .workspace-agent__header,:global(body:not([arco-theme='dark'])) .workspace-agent__composer { background:var(--color-bg-2); }
:global(body:not([arco-theme='dark'])) .workspace-agent select,:global(body:not([arco-theme='dark'])) .workspace-agent input { border-color:var(--wa-line); color:var(--wa-text); background:var(--color-bg-1); }
:global(body:not([arco-theme='dark'])) .workspace-agent__timeline-row,:global(body:not([arco-theme='dark'])) .workspace-agent__source-cards article,:global(body:not([arco-theme='dark'])) .workspace-agent__inbox section { background:var(--color-bg-1); }
:global(body:not([arco-theme='dark'])) .workspace-agent__table-head { background:var(--color-fill-1); }.workspace-agent__table-row { color:var(--wa-text); }
:global(body:not([arco-theme='dark'])) .workspace-agent__task.active { background:linear-gradient(120deg,rgba(109,89,230,.13),rgba(109,89,230,.04)); }.workspace-agent__planner { color:var(--color-text-1); background: var(--app-overlay-bg); }.workspace-agent__policy li,:global(body:not([arco-theme='dark'])) .workspace-agent__approval-card p { color:var(--color-text-2); }
.workspace-agent__candidates { margin-top:10px; overflow:hidden; border:1px solid var(--wa-line); border-radius:8px; }.workspace-agent__candidates header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid var(--wa-line); background:rgba(255,255,255,.025); }.workspace-agent__candidates strong { font-size:12px; }.workspace-agent__candidates header span { color:var(--wa-muted); font-size:11px; }.workspace-agent__candidate-list { max-height:300px; overflow:auto; }.workspace-agent__candidate-list article { display:grid; grid-template-columns:40px minmax(0,1fr) 100px; align-items:center; min-height:34px; border-bottom:1px solid var(--wa-line); font-size:11px; }.workspace-agent__candidate-list article:last-child { border-bottom:0; }.workspace-agent__candidate-list b { color:var(--wa-muted); font-weight:500; text-align:center; }.workspace-agent__candidate-list span { min-width:0; overflow:hidden; color:#d7dbe4; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__candidate-list em { padding-right:12px; color:var(--wa-muted); font-style:normal; text-align:right; }
.workspace-agent__candidates { margin-top:10px; overflow:hidden; border:1px solid var(--wa-line); border-radius:8px; }.workspace-agent__candidates header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:10px 12px; border-bottom:1px solid var(--wa-line); background:rgba(255,255,255,.025); }.workspace-agent__candidates header label { display:flex; align-items:center; gap:6px; color:#d7dbe4; font-size:11px; }.workspace-agent__candidates strong { font-size:12px; }.workspace-agent__candidates header span { color:var(--wa-muted); font-size:11px; }.workspace-agent__candidate-list { max-height:300px; overflow:auto; }.workspace-agent__candidate-list label { display:grid; grid-template-columns:24px 40px minmax(0,1fr) 100px; align-items:center; min-height:34px; border-bottom:1px solid var(--wa-line); font-size:11px; }.workspace-agent__candidate-list label:last-child { border-bottom:0; }.workspace-agent__candidate-list input { justify-self:center; }.workspace-agent__candidate-list b { color:var(--wa-muted); font-weight:500; text-align:center; }.workspace-agent__candidate-list span { min-width:0; overflow:hidden; color:#d7dbe4; text-overflow:ellipsis; white-space:nowrap; }.workspace-agent__candidate-list em { padding-right:12px; color:var(--wa-muted); font-style:normal; text-align:right; }
</style>
