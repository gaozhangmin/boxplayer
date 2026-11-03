import { app } from 'electron'
import { join } from 'path'
import type { AgentActionReceipt, AgentExecutionGrant, AgentResourceHandle, AgentSurface, AgentWorkflowView, CreateAgentEvidenceInput, CreateAgentPlanInput, CreateAgentResourceHandleInput, CreateAgentWorkflowInput, RecordAgentActionReceiptInput, SettleAgentActionReceiptInput } from '@shared/types/agentControl'
import { AgentLedgerDb } from './AgentLedgerDb'
import { agentV1FeatureFlags } from './AgentV1FeatureFlags'

let db: AgentLedgerDb | null = null

function getDb(): AgentLedgerDb {
  if (!db) db = new AgentLedgerDb(join(app.getPath('userData'), 'agent-v1.db'))
  return db
}

function requireEnabled(): void {
  if (!agentV1FeatureFlags().controlPlane) throw new Error('Agent V1 控制面尚未启用')
}

export function agentV1Status() {
  return agentV1FeatureFlags()
}

export function createAgentWorkflow(input: CreateAgentWorkflowInput): AgentWorkflowView {
  requireEnabled()
  return getDb().createWorkflow(input)
}

export function getAgentWorkflow(workflowId: string): AgentWorkflowView | null {
  requireEnabled()
  return getDb().getWorkflow(workflowId)
}

/** Main-process-only lookup used by feature-gated migration bridges. */
export function findAgentWorkflowByExternalRef(externalRef: string): AgentWorkflowView | null {
  requireEnabled()
  return getDb().findWorkflowByExternalRef(externalRef)
}

export function addAgentEvidence(workflowId: string, input: CreateAgentEvidenceInput): AgentWorkflowView | null {
  requireEnabled()
  getDb().addEvidence(workflowId, input)
  return getDb().getWorkflow(workflowId)
}

export function completeAgentObservation(workflowId: string, status: 'completed' | 'failed' | 'cancelled', message: string): AgentWorkflowView {
  requireEnabled()
  return getDb().completeObservation(workflowId, status, message)
}

/** Main-process-only terminal mirror for legacy runners during a staged migration. */
export function completeExternalAgentWorkflow(workflowId: string, status: 'completed' | 'failed' | 'cancelled' | 'expired', message: string): AgentWorkflowView {
  requireEnabled()
  return getDb().completeExternalWorkflow(workflowId, status, message)
}

export function createAgentPlan(workflowId: string, input: CreateAgentPlanInput): AgentWorkflowView | null {
  requireEnabled()
  getDb().createPlan(workflowId, input)
  return getDb().getWorkflow(workflowId)
}

/** Main-process-only resource binding. Renderer code never receives executor privileges. */
export function createAgentResourceHandle(workflowId: string, input: CreateAgentResourceHandleInput): AgentResourceHandle {
  requireEnabled()
  return getDb().createResourceHandle(workflowId, input)
}

export function replaceAgentDraftPlan(workflowId: string, input: CreateAgentPlanInput): AgentWorkflowView | null {
  requireEnabled()
  getDb().replaceDraftPlan(workflowId, input)
  return getDb().getWorkflow(workflowId)
}

export function approveAgentPlan(workflowId: string, planHash: string, ttlMs?: number): AgentWorkflowView {
  requireEnabled()
  return getDb().approvePlan(workflowId, planHash, Date.now(), ttlMs)
}

export function claimAgentExecutionGrant(workerId: string, leaseMs?: number, surfaces?: AgentSurface[]): AgentExecutionGrant | null {
  requireEnabled()
  return getDb().claimExecutionGrant(workerId, leaseMs, Date.now(), surfaces)
}

export function recordAgentActionReceipt(grantId: string, workerId: string, input: RecordAgentActionReceiptInput): AgentActionReceipt {
  requireEnabled()
  return getDb().recordActionReceipt(grantId, workerId, input)
}

/** Main-process-only: settles a pending or unknown receipt from a readback of the drive. */
export function settleAgentActionReceipt(grantId: string, input: SettleAgentActionReceiptInput): AgentActionReceipt {
  requireEnabled()
  return getDb().settleActionReceipt(grantId, input)
}

export function destroyAgentControlDb(): void {
  db?.close()
  db = null
}
