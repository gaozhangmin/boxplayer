import type { AgentWorkflowView } from '@shared/types/agentControl'

export interface AiSearchV1AuditTarget {
  userId: string
  driveId: string
  rootId: string
  platform: string
}

export interface AiSearchV1WriteInput {
  confirmationId: string
  kind: 'move' | 'trash'
  target: AiSearchV1AuditTarget
  fileIds: string[]
  targetParentFileId?: string
}

export interface DocumentAgentV1Source {
  sourceId: string
  fileName: string
  userId: string
  driveId: string
  fileId: string
  parentFileId?: string
  platform: string
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const ipc = window.Electron?.ipcRenderer
  if (!ipc) return Promise.resolve(null as T)
  return ipc.invoke(channel, ...args) as Promise<T>
}

export function beginAiSearchV1Audit(input: { sessionId: string; runId: string; goal: string; target?: AiSearchV1AuditTarget }): Promise<string | null> {
  return invoke('agentV1:aiSearch:beginAudit', input)
}

export function recordAiSearchV1Evidence(input: { sessionId: string; runId: string; toolCallId: string; toolName: string; isError: boolean; result: unknown }): Promise<void> {
  return invoke('agentV1:aiSearch:recordEvidence', input)
}

export function finishAiSearchV1Audit(sessionId: string, runId: string, status: 'completed' | 'failed' | 'cancelled' = 'completed', message?: string): Promise<void> {
  return invoke('agentV1:aiSearch:finishAudit', sessionId, runId, status, message)
}

export interface AiSearchStorageStats {
  provider: string
  driveId: string
  maxDepth: number
  totalFiles: number
  totalDirs: number
  totalSize: number
  byCategory: Record<string, { count: number; size: number }>
  topExtensions: Record<string, number>
}

export function collectAiSearchStorageStats(workflowId: string): Promise<AiSearchStorageStats | null> {
  return invoke('agentV1:aiSearch:collectStorageStats', workflowId)
}

export function confirmAiSearchV1Write(input: AiSearchV1WriteInput): Promise<{ workflowId: string } | null> {
  return invoke('agentV1:aiSearch:confirmWrite', input)
}

export function getAgentV1Workflow(workflowId: string): Promise<AgentWorkflowView | null> {
  return invoke('agentV1:getWorkflow', workflowId)
}

export function beginDocumentV1Audit(input: { sessionId: string; runId: string; goal: string; sources: DocumentAgentV1Source[] }): Promise<string | null> {
  return invoke('agentV1:document:beginAudit', input)
}

export function recordDocumentV1Citation(workflowId: string, input: { sourceId: string; location: string }): Promise<void> {
  return invoke('agentV1:document:recordCitation', workflowId, input)
}

export function finishDocumentV1Audit(workflowId: string, status: 'completed' | 'failed' | 'cancelled', message: string): Promise<void> {
  return invoke('agentV1:document:finishAudit', workflowId, status, message)
}
