import { getAgentWorkflow } from '../agent/AgentControlService'
import { agentV1FeatureFlags } from '../agent/AgentV1FeatureFlags'
import type { AgentCliExecutionResult } from '../agent/AgentCliExecutor'
import { addWorkspaceEvent, completeWorkspaceTask } from './WorkspaceAgentService'

/** Mirrors a completed V1 cutover run back into the existing workbench history. */
export function reconcileWorkspaceAgentV1Execution(result: AgentCliExecutionResult): void {
  if (!agentV1FeatureFlags().workspaceCutover || !result.workflowId || result.status === 'idle') return
  const workflow = getAgentWorkflow(result.workflowId)
  const match = workflow?.externalRef?.match(/^workspace:(.+)$/)
  if (!match) return
  const taskId = match[1]
  if (result.status === 'completed') completeWorkspaceTask(taskId, 'completed', `Agent V1 已完成 ${result.executedActions} 项已批准操作。`)
  // The task stays open: its outcome is neither a success nor a failure until the drive is checked.
  else if (result.status === 'reconciling') addWorkspaceEvent(taskId, 'warning', `Agent V1 完成 ${result.executedActions} 项操作后，无法确认下一项是否已生效，已暂停执行。请在网盘中核对该文件的位置。`)
  else completeWorkspaceTask(taskId, 'failed', `Agent V1 在完成 ${result.executedActions} 项操作后失败，请查看执行回执。`)
}
