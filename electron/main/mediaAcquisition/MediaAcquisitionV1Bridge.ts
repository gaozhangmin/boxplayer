import type { AgentPlanAction, AgentReceiptStatus, AgentScopeGrant, AgentSettledReceiptStatus, CreateAgentEvidenceInput } from '@shared/types/agentControl'
import type { MediaAcquisitionCandidate, MediaAcquisitionRunView } from '@shared/types/mediaAcquisition'
import { addAgentEvidence, approveAgentPlan, claimAgentExecutionGrant, completeAgentObservation, createAgentPlan, createAgentResourceHandle, createAgentWorkflow, findAgentWorkflowByExternalRef, getAgentWorkflow, recordAgentActionReceipt, settleAgentActionReceipt } from '../agent/AgentControlService'
import { getMediaAcquisitionRun } from './MediaAcquisitionService'
import { agentV1FeatureFlags } from '../agent/AgentV1FeatureFlags'

const workflowRef = (runId: string) => `media:${runId}`
const targetEvidenceRef = (targetId: string) => `media-target:${targetId}`
const transferRef = (runId: string, candidateId: string) => `media-transfer:${runId}:${candidateId}`

export interface MediaAcquisitionTransferTicket {
  workflowId: string
  grantId: string
}

export function mediaAcquisitionScope(run: Pick<MediaAcquisitionRunView, 'target'>): AgentScopeGrant {
  return {
    accountId: run.target.targetUserId,
    driveId: run.target.targetDriveId,
    rootId: run.target.targetParentFileId,
    platform: run.target.targetPlatform,
    // The legacy acquisition runner writes automatically. V1 observes only until
    // the media UI collects a real, exact-plan approval from the user.
    operations: ['files.list']
  }
}

export function mediaAcquisitionCandidateEvidence(run: Pick<MediaAcquisitionRunView, 'id' | 'target'>, candidate: MediaAcquisitionCandidate): CreateAgentEvidenceInput {
  return {
    source: 'media_candidate',
    summary: `候选资源：${candidate.title}`,
    // Do not copy locator/password or free-form detail: either can contain a share URL.
    data: { candidateId: candidate.id, kind: candidate.kind, sourcePlatform: candidate.sourcePlatform, title: candidate.title, status: candidate.status },
    externalRef: `media-candidate:${candidate.id}:${candidate.status}:${candidate.updatedAt || candidate.createdAt}`
  }
}

export function mediaAcquisitionTransferScope(run: Pick<MediaAcquisitionRunView, 'target'>, candidate: Pick<MediaAcquisitionCandidate, 'kind'>): AgentScopeGrant {
  return {
    ...mediaAcquisitionScope(run),
    operations: ['files.list', candidate.kind === 'share' ? 'share.import' : 'offline.create']
  }
}

export function mediaAcquisitionTransferAction(candidate: Pick<MediaAcquisitionCandidate, 'id' | 'kind' | 'title'>, handleId: string): AgentPlanAction {
  const kind = candidate.kind === 'share' ? 'import_share' : 'offline_download'
  return {
    id: `media-transfer:${candidate.id}`,
    kind,
    label: kind === 'import_share' ? `导入分享候选：${candidate.title}` : `创建离线下载：${candidate.title}`,
    idempotencyKey: `media-transfer:${candidate.id}`,
    resourceHandleIds: [handleId],
    parameters: { candidateId: candidate.id, candidateKind: candidate.kind }
  }
}

/** Creates and claims one exact user-approved candidate transfer without storing its locator or password. */
export function beginMediaAcquisitionV1Transfer(runId: string, candidateId: string, reason: string): MediaAcquisitionTransferTicket | null {
  if (!agentV1FeatureFlags().mediaAcquisitionBridge) return null
  const run = getMediaAcquisitionRun(runId)
  const candidate = run?.candidates.find(item => item.id === candidateId)
  if (!run || !candidate || !['pending', 'selected'].includes(candidate.status)) throw new Error('候选已变化，请重新查看后再确认')
  const ref = transferRef(runId, candidateId)
  const existing = findAgentWorkflowByExternalRef(ref)
  if (existing?.executionGrant?.status === 'claimed') return { workflowId: existing.id, grantId: existing.executionGrant.id }
  if (existing) throw new Error('该候选已有已结束或待执行的转存授权，请重新选择候选')

  const workflow = createAgentWorkflow({ surface: 'media_acquisition', goal: `获取媒体候选：${candidate.title}`, scope: mediaAcquisitionTransferScope(run, candidate), externalRef: ref })
  const evidenceView = addAgentEvidence(workflow.id, {
    ...mediaAcquisitionCandidateEvidence(run, candidate),
    summary: `用户确认候选：${candidate.title}`,
    data: { ...mediaAcquisitionCandidateEvidence(run, candidate).data, selectionReason: redactMediaTransferMessage(reason) },
    externalRef: `${ref}:candidate`
  })
  const evidence = evidenceView?.evidence.find(item => item.externalRef === `${ref}:candidate`)
  if (!evidence) throw new Error('无法记录媒体候选取证')
  const actionKind = candidate.kind === 'share' ? 'import_share' : 'offline_download'
  const handle = createAgentResourceHandle(workflow.id, {
    evidenceId: evidence.id,
    kind: candidate.kind === 'share' ? 'share' : 'external_source',
    snapshot: { accountId: run.target.targetUserId, driveId: run.target.targetDriveId, resourceId: candidate.id, name: candidate.title },
    externalRef: `${ref}:candidate`
  })
  const action = mediaAcquisitionTransferAction(candidate, handle.id)
  const planned = createAgentPlan(workflow.id, {
    summary: actionKind === 'import_share' ? `导入已确认分享候选：${candidate.title}` : `为已确认候选创建离线下载：${candidate.title}`,
    risk: actionKind === 'import_share' ? '会将分享内容导入指定网盘目录；实际内容以网盘回读核验为准。' : '会向指定网盘提交外部离线下载；可能产生网盘离线任务。',
    evidenceIds: [evidence.id],
    actions: [action]
  })
  if (!planned?.plan) throw new Error('无法生成媒体候选转存计划')
  approveAgentPlan(workflow.id, planned.plan.hash)
  const grant = claimAgentExecutionGrant(mediaTransferWorkerId(workflow.id), 600_000, ['media_acquisition'])
  if (!grant || grant.workflowId !== workflow.id) throw new Error('无法领取媒体候选转存授权')
  return { workflowId: workflow.id, grantId: grant.id }
}

const RECEIPT_STATUSES = new Set<AgentReceiptStatus>(['succeeded', 'failed', 'pending', 'unknown'])

/**
 * `pending`: the provider accepted the transfer and the files have not landed yet.
 * `unknown`: the provider may have accepted it, but BoxPlayer could not confirm that.
 */
export function completeMediaAcquisitionV1Transfer(ticket: MediaAcquisitionTransferTicket, status: AgentReceiptStatus, message: string): void {
  if (!RECEIPT_STATUSES.has(status)) throw new Error('媒体候选转存回执状态无效')
  const workflow = getApprovedMediaAcquisitionTransfer(ticket)
  const action = workflow.plan!.actions[0]
  recordAgentActionReceipt(ticket.grantId, mediaTransferWorkerId(ticket.workflowId), {
    actionId: action.id,
    idempotencyKey: action.idempotencyKey,
    status,
    result: { submitted: status === 'succeeded' || status === 'pending', message: redactMediaTransferMessage(message) }
  })
}

/** Settles a pending or unknown transfer after the media workflow has read back what landed in the target drive. */
export function settleMediaAcquisitionV1Transfer(runId: string, candidateId: string, status: AgentSettledReceiptStatus, message: string): void {
  if (!agentV1FeatureFlags().mediaAcquisitionBridge) return
  const workflow = findAgentWorkflowByExternalRef(transferRef(runId, candidateId))
  const action = workflow?.plan?.actions[0]
  const receipt = action ? workflow?.receipts.find(item => item.idempotencyKey === action.idempotencyKey) : undefined
  if (!workflow?.executionGrant || !action || !receipt || (receipt.status !== 'pending' && receipt.status !== 'unknown')) return
  settleAgentActionReceipt(workflow.executionGrant.id, {
    actionId: action.id,
    idempotencyKey: action.idempotencyKey,
    status,
    verification: { source: 'media_acquisition.landing', summary: redactMediaTransferMessage(message) }
  })
}

/** Verifies that a main-process provider call is bound to one exact approved candidate. */
export function assertMediaAcquisitionV1TransferTicket(ticket: MediaAcquisitionTransferTicket, runId: string, candidateId: string): void {
  const workflow = getApprovedMediaAcquisitionTransfer(ticket)
  const action = workflow.plan!.actions[0]
  if (workflow.externalRef !== transferRef(runId, candidateId) || action.parameters?.candidateId !== candidateId) throw new Error('媒体候选转存授权与当前候选不匹配')
}

function getApprovedMediaAcquisitionTransfer(ticket: MediaAcquisitionTransferTicket) {
  const workflow = getAgentWorkflow(ticket.workflowId)
  if (!workflow || workflow.surface !== 'media_acquisition' || workflow.executionGrant?.id !== ticket.grantId || workflow.executionGrant.status !== 'claimed' || !workflow.plan?.actions.length) throw new Error('媒体候选转存授权无效')
  return workflow
}

export function mirrorMediaAcquisitionRun(run: MediaAcquisitionRunView): void {
  if (!agentV1FeatureFlags().mediaAcquisitionBridge) return
  let workflow = findAgentWorkflowByExternalRef(workflowRef(run.id))
  if (!workflow) workflow = createAgentWorkflow({ surface: 'media_acquisition', goal: `获取媒体：${run.target.title}`, scope: mediaAcquisitionScope(run), externalRef: workflowRef(run.id) })
  if (workflow.status !== 'gathering_evidence') return
  addAgentEvidence(workflow.id, {
    source: 'media_target',
    summary: `目标目录：${run.target.title}`,
    data: {
      mediaType: run.target.mediaType,
      title: run.target.title,
      tmdbId: run.target.tmdbId,
      quality: run.target.preferredQuality,
      language: run.target.preferredLanguage,
      fetchSubtitles: run.target.fetchSubtitles
    },
    externalRef: targetEvidenceRef(run.target.id)
  })
  for (const candidate of run.candidates) addAgentEvidence(workflow.id, mediaAcquisitionCandidateEvidence(run, candidate))
  const terminalStatus = run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled' : ['completed', 'partial', 'no_coverage'].includes(run.status) ? 'completed' : undefined
  if (terminalStatus) completeAgentObservation(workflow.id, terminalStatus, `媒体获取任务已${terminalStatus === 'completed' ? '结束' : terminalStatus === 'failed' ? '失败' : '取消'}：${run.activity || run.target.title}`)
}

function mediaTransferWorkerId(workflowId: string): string {
  return `media-main:${process.pid}:${workflowId}`
}

function redactMediaTransferMessage(value: string): string {
  return String(value || '媒体转存结束').replace(/https?:\/\/\S+/gi, '[链接已脱敏]').replace(/(?:password|pwd|密码|token|secret)\s*[:：=]\s*\S+/gi, '[敏感信息已脱敏]').slice(0, 300)
}
