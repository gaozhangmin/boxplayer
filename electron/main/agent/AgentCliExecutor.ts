import { app } from 'electron'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentPlanAction, AgentReceiptStatus, AgentWorkflowView } from '@shared/types/agentControl'
import { claimAgentExecutionGrant, getAgentWorkflow, recordAgentActionReceipt, settleAgentActionReceipt } from './AgentControlService'
import { preflightAgentCliAction } from './AgentCliPreflight'
import type { AgentCliActionPreflight } from './AgentCliPreflight'
import { CloudDriveCliAdapter } from './CloudDriveCliAdapter'
import { runBundledCloudDriveCli, type CloudDriveCliResult } from './CloudDriveCliGateway'
import { agentV1FeatureFlags } from './AgentV1FeatureFlags'

export interface AgentCliExecutionResult {
  grantId?: string
  workflowId?: string
  executedActions: number
  /** `reconciling`: an outcome could not be confirmed, so the grant waits for a readback instead of a retry. */
  status: 'idle' | 'completed' | 'failed' | 'reconciling'
}

/** CLI exits that reject a plan before any provider call is made. */
const PRE_WRITE_EXIT_CODES = new Set([1, 2, 5])

type ResourceInspector = Pick<CloudDriveCliAdapter, 'inspectResource' | 'isWithinScopeRoot'>

export interface AgentCliApplyOutcome {
  status: Exclude<AgentReceiptStatus, 'pending'>
  result: Record<string, unknown>
}

/**
 * Main-process-only executor. It intentionally has no IPC handler: a renderer
 * may create/approve a plan but cannot claim or consume an execution grant.
 */
export async function executeNextAgentCliGrant(workerId = `main:${process.pid}`): Promise<AgentCliExecutionResult> {
  if (!agentV1FeatureFlags().cliExecutor) throw new Error('Agent V1 CLI 执行器尚未启用')
  const grant = claimAgentExecutionGrant(workerId, undefined, ['workspace', 'ai_search'])
  if (!grant) return { executedActions: 0, status: 'idle' }
  const workflow = getAgentWorkflow(grant.workflowId)
  if (!workflow?.plan || workflow.plan.id !== grant.planId || workflow.plan.hash !== grant.planHash) throw new Error('执行授权与当前计划不匹配')

  const inspector = new CloudDriveCliAdapter()
  // A grant resumed after a readback already ran these actions; running them again could repeat a write.
  const recorded = new Set(workflow.receipts.map(receipt => receipt.idempotencyKey))
  let executedActions = recorded.size
  for (const action of workflow.plan.actions) {
    if (recorded.has(action.idempotencyKey)) continue
    let preflight: AgentCliActionPreflight
    try {
      preflight = await preflightAgentCliAction(workflow, action, inspector)
    } catch (error: any) {
      // Preflight only reads the drive, so a failure here leaves it unchanged.
      recordAgentActionReceipt(grant.id, workerId, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'failed', result: { message: error?.message || 'Agent CLI 预检失败' } })
      return { grantId: grant.id, workflowId: workflow.id, executedActions, status: 'failed' }
    }
    const outcome = await applyCliPreflight(preflight)
    recordAgentActionReceipt(grant.id, workerId, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: outcome.status, result: outcome.result })
    if (outcome.status === 'failed') return { grantId: grant.id, workflowId: workflow.id, executedActions, status: 'failed' }
    if (outcome.status === 'unknown') {
      const settled = await reconcileUnknownCliAction(grant.id, workflow, action, preflight, inspector)
      if (settled !== 'succeeded') return { grantId: grant.id, workflowId: workflow.id, executedActions, status: settled === 'failed' ? 'failed' : 'reconciling' }
      // The readback re-queued the grant; the next scheduler tick continues with the remaining actions.
      if (!isLastAction(workflow, action)) return { grantId: grant.id, workflowId: workflow.id, executedActions: executedActions + 1, status: 'idle' }
    }
    executedActions++
  }
  return { grantId: grant.id, workflowId: workflow.id, executedActions, status: 'completed' }
}

/**
 * Trust the CLI's per-item report when it finished the batch. Without one, the provider may
 * already have applied the change, so the outcome is unknown unless the CLI rejected the plan up front.
 */
export function classifyCliApplyResult(result: CloudDriveCliResult, fileId: string): AgentCliApplyOutcome {
  let body: any
  try {
    body = result.stdout ? JSON.parse(result.stdout) : undefined
  } catch {
    body = undefined
  }
  const item = Array.isArray(body?.results) ? body.results.find((entry: any) => entry?.fileId === fileId) || (body.results.length === 1 ? body.results[0] : undefined) : undefined
  if (item) {
    if (item.status === 'success') return { status: 'succeeded', result: body }
    return { status: 'failed', result: { ...body, message: item.message || '网盘拒绝了该操作' } }
  }
  const message = body?.error?.message || body?.error || result.stderr?.trim() || result.stdout?.trim() || '网盘 CLI 没有返回逐项结果'
  if (PRE_WRITE_EXIT_CODES.has(result.exitCode)) return { status: 'failed', result: { exitCode: result.exitCode, message } }
  return { status: 'unknown', result: { exitCode: result.exitCode, message } }
}

/** Settle an unknown move by reading back the file's parent. Other actions keep their unknown receipt for manual checking. */
export async function reconcileUnknownCliAction(grantId: string, workflow: AgentWorkflowView, action: AgentPlanAction, preflight: AgentCliActionPreflight, inspector: ResourceInspector): Promise<'succeeded' | 'failed' | 'unknown'> {
  if (preflight.command !== 'files move-apply') return 'unknown'
  const item = (preflight.plan.items as Array<{ file_id: string; from_parent_file_id: string; to_parent_file_id: string }>)[0]
  let parentId: string | undefined
  try {
    parentId = (await inspector.inspectResource(workflow.scope, item.file_id)).snapshot.parentResourceId
  } catch {
    return 'unknown'
  }
  const status = parentId === item.to_parent_file_id ? 'succeeded' : parentId === item.from_parent_file_id ? 'failed' : undefined
  if (!status) return 'unknown'
  settleAgentActionReceipt(grantId, {
    actionId: action.id,
    idempotencyKey: action.idempotencyKey,
    status,
    verification: { source: 'clouddrive-cli files info', summary: status === 'succeeded' ? '回读确认文件已在目标目录' : '回读确认文件仍在原目录' }
  })
  return status
}

function isLastAction(workflow: AgentWorkflowView, action: AgentPlanAction): boolean {
  const actions = workflow.plan?.actions || []
  return actions[actions.length - 1]?.id === action.id
}

async function applyCliPreflight(preflight: AgentCliActionPreflight): Promise<AgentCliApplyOutcome> {
  const fileId = String((preflight.plan.items as Array<{ file_id?: string }>)[0]?.file_id || '')
  const directory = await mkdtemp(join(app.getPath('temp'), 'boxplayer-agent-v1-'))
  const planPath = join(directory, 'approved-plan.json')
  try {
    await writeFile(planPath, JSON.stringify(preflight.plan), 'utf8')
    const args = preflight.command === 'files trash-apply'
      ? ['files', 'trash-apply', planPath, '--apply', '--rationale', preflight.rationale, '--json']
      : ['files', 'move-apply', planPath, '--rationale', preflight.rationale, '--json']
    return classifyCliApplyResult(await runBundledCloudDriveCli(args), fileId)
  } catch (error: any) {
    // The bundled CLI did not report back; the drive may or may not have changed.
    return { status: 'unknown', result: { message: error?.message || 'Agent CLI 操作失败' } }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
