import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import { validateAgentPlanPolicy } from '@shared/agentControlPolicy'
import type { AgentActionReceipt, AgentApproval, AgentReceiptStatus, AgentEvidence, AgentExecutionGrant, AgentLedgerEvent, AgentPlan, AgentPlanAction, AgentResourceHandle, AgentSurface, AgentWorkflow, AgentWorkflowStatus, AgentWorkflowView, CreateAgentEvidenceInput, CreateAgentPlanInput, CreateAgentResourceHandleInput, CreateAgentWorkflowInput, RecordAgentActionReceiptInput, SettleAgentActionReceiptInput } from '@shared/types/agentControl'

type Row = Record<string, any>
const TERMINAL_WORKFLOW_STATUSES = new Set<AgentWorkflowStatus>(['completed', 'failed', 'cancelled', 'expired'])
const UNSETTLED_RECEIPT_STATUSES = new Set<AgentReceiptStatus>(['pending', 'unknown'])
const RECEIPT_EVENTS: Record<AgentReceiptStatus, [AgentLedgerEvent['level'], string]> = {
  succeeded: ['info', '已记录执行回执。'],
  failed: ['error', '已记录失败回执。'],
  pending: ['info', '操作已提交，等待网盘完成后回读核对。'],
  unknown: ['warning', '无法确认操作结果，已暂停执行，需要回读网盘核对。']
}

export class AgentLedgerDb {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close(): void { this.db.close() }

  createWorkflow(input: CreateAgentWorkflowInput, now = Date.now()): AgentWorkflowView {
    const goal = input.goal?.trim()
    if (!goal) throw new Error('请输入 Agent 任务目标')
    if (!input.scope?.accountId || !input.scope.driveId || !input.scope.rootId || !input.scope.platform || !input.scope.operations?.length) throw new Error('请先授予一个有效的网盘操作范围')
    const id = randomUUID()
    if (input.externalRef && this.findWorkflowByExternalRef(input.externalRef)) throw new Error('外部工作流引用已存在')
    this.db.prepare('INSERT INTO agent_workflows (id, surface, goal, scope_json, status, external_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.surface, goal, stableJson(input.scope), 'gathering_evidence', input.externalRef || null, now, now)
    this.addEvent(id, 'info', '已创建 Agent 工作流，等待取证。', undefined, now)
    return this.getWorkflow(id)!
  }

  getWorkflow(id: string, now = Date.now()): AgentWorkflowView | null {
    // Keep the visible state aligned with the executable state even when no
    // background worker happens to poll an expired approval.
    this.expireGrants(now)
    const row = this.db.prepare('SELECT * FROM agent_workflows WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    const evidence = (this.db.prepare('SELECT * FROM agent_evidence WHERE workflow_id = ? ORDER BY created_at').all(id) as Row[]).map(toEvidence)
    const resourceHandles = (this.db.prepare('SELECT * FROM agent_resource_handles WHERE workflow_id = ? ORDER BY created_at').all(id) as Row[]).map(toResourceHandle)
    const planRow = this.db.prepare('SELECT * FROM agent_plans WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as Row | undefined
    const approvalRow = planRow ? this.db.prepare('SELECT * FROM agent_approvals WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1').get(planRow.id) as Row | undefined : undefined
    const grantRow = planRow ? this.db.prepare('SELECT * FROM agent_execution_grants WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1').get(planRow.id) as Row | undefined : undefined
    const receipts = grantRow ? (this.db.prepare('SELECT * FROM agent_action_receipts WHERE execution_grant_id = ? ORDER BY created_at').all(grantRow.id) as Row[]).map(toReceipt) : []
    const events = (this.db.prepare('SELECT * FROM agent_events WHERE workflow_id = ? ORDER BY created_at').all(id) as Row[]).map(toEvent)
    return { ...toWorkflow(row), evidence, resourceHandles, plan: planRow ? toPlan(planRow) : undefined, approval: approvalRow ? toApproval(approvalRow) : undefined, executionGrant: grantRow ? toGrant(grantRow) : undefined, receipts, events }
  }

  findWorkflowByExternalRef(externalRef: string): AgentWorkflowView | null {
    const row = this.db.prepare('SELECT id FROM agent_workflows WHERE external_ref = ?').get(externalRef) as Row | undefined
    return row ? this.getWorkflow(String(row.id)) : null
  }

  addEvidence(workflowId: string, input: CreateAgentEvidenceInput, now = Date.now()): AgentEvidence {
    const workflow = this.requireWorkflow(workflowId)
    if (workflow.status !== 'gathering_evidence') throw new Error('当前工作流不能继续取证')
    if (!input.source?.trim() || !input.summary?.trim()) throw new Error('证据来源和摘要不能为空')
    const id = randomUUID()
    const data = input.data || {}
    const hash = digest({ source: input.source.trim(), summary: input.summary.trim(), data })
    if (input.externalRef) {
      const existing = this.db.prepare('SELECT * FROM agent_evidence WHERE workflow_id = ? AND external_ref = ?').get(workflowId, input.externalRef) as Row | undefined
      if (existing) return toEvidence(existing)
    }
    this.db.prepare('INSERT INTO agent_evidence (id, workflow_id, source, summary, data_json, hash, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, workflowId, input.source.trim(), input.summary.trim(), stableJson(data), hash, input.externalRef || null, now)
    this.touch(workflowId, now)
    this.addEvent(workflowId, 'info', '已记录取证结果。', { evidenceId: id, source: input.source.trim() }, now)
    return { id, workflowId, source: input.source.trim(), summary: input.summary.trim(), data, hash, externalRef: input.externalRef, createdAt: now }
  }

  /** Finish a read-only audit. Write workflows must still finish through receipts. */
  completeObservation(workflowId: string, status: Extract<AgentWorkflowStatus, 'completed' | 'failed' | 'cancelled'>, message: string, now = Date.now()): AgentWorkflowView {
    const workflow = this.requireWorkflow(workflowId)
    if (workflow.status !== 'gathering_evidence' || this.db.prepare('SELECT 1 FROM agent_plans WHERE workflow_id = ? LIMIT 1').get(workflowId)) throw new Error('只有未创建计划的取证工作流可以直接结束')
    if (!message.trim()) throw new Error('取证工作流结束说明不能为空')
    this.db.transaction(() => {
      this.transition(workflowId, status, now)
      this.addEvent(workflowId, status === 'completed' ? 'info' : status === 'failed' ? 'error' : 'warning', message.trim(), undefined, now)
    })()
    return this.getWorkflow(workflowId, now)!
  }

  /** Records a terminal result produced by a legacy runner while the control plane is shadowing it. */
  completeExternalWorkflow(workflowId: string, status: Extract<AgentWorkflowStatus, 'completed' | 'failed' | 'cancelled' | 'expired'>, message: string, now = Date.now()): AgentWorkflowView {
    const workflow = this.requireWorkflow(workflowId)
    if (!message.trim()) throw new Error('外部工作流结束说明不能为空')
    const plan = this.db.prepare('SELECT * FROM agent_plans WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1').get(workflowId) as Row | undefined
    this.db.transaction(() => {
      if (plan) {
        const planStatus = status === 'completed' ? 'completed' : status === 'expired' ? 'stale' : status === 'cancelled' ? 'cancelled' : 'failed'
        this.db.prepare('UPDATE agent_plans SET status = ?, completed_at = ? WHERE id = ? AND status NOT IN (\'completed\', \'failed\', \'cancelled\', \'stale\')').run(planStatus, now, plan.id)
        const grantStatus = status === 'completed' ? 'completed' : status === 'expired' ? 'expired' : 'failed'
        this.db.prepare('UPDATE agent_execution_grants SET status = ?, completed_at = ? WHERE plan_id = ? AND status IN (\'pending\', \'claimed\')').run(grantStatus, now, plan.id)
      }
      this.transition(workflowId, status, now)
      this.addEvent(workflowId, status === 'completed' ? 'info' : status === 'cancelled' ? 'warning' : 'error', message.trim(), { source: 'legacy_runner' }, now)
    })()
    return this.getWorkflow(workflowId, now)!
  }

  createResourceHandle(workflowId: string, input: CreateAgentResourceHandleInput, now = Date.now()): AgentResourceHandle {
    const workflow = this.requireWorkflow(workflowId)
    if (workflow.status !== 'gathering_evidence') throw new Error('当前工作流不能继续创建资源句柄')
    const evidence = this.db.prepare('SELECT id FROM agent_evidence WHERE id = ? AND workflow_id = ?').get(input.evidenceId, workflowId) as Row | undefined
    if (!evidence) throw new Error('资源句柄必须引用本工作流的证据')
    const snapshot = input.snapshot
    if (!snapshot?.accountId || !snapshot.driveId || !snapshot.resourceId || !snapshot.name) throw new Error('资源句柄缺少必要快照信息')
    if (snapshot.accountId !== workflow.scope.accountId || snapshot.driveId !== workflow.scope.driveId) throw new Error('资源句柄超出已授予的网盘范围')
    const id = randomUUID()
    const hash = digest({ evidenceId: input.evidenceId, kind: input.kind, snapshot })
    if (input.externalRef) {
      const existing = this.db.prepare('SELECT * FROM agent_resource_handles WHERE workflow_id = ? AND external_ref = ?').get(workflowId, input.externalRef) as Row | undefined
      if (existing) return toResourceHandle(existing)
    }
    this.db.prepare('INSERT INTO agent_resource_handles (id, workflow_id, evidence_id, kind, snapshot_json, hash, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, workflowId, input.evidenceId, input.kind, stableJson(snapshot), hash, input.externalRef || null, now)
    this.touch(workflowId, now)
    this.addEvent(workflowId, 'info', '已从取证结果创建资源句柄。', { resourceHandleId: id, evidenceId: input.evidenceId }, now)
    return { id, workflowId, evidenceId: input.evidenceId, kind: input.kind, snapshot, hash, externalRef: input.externalRef, createdAt: now }
  }

  createPlan(workflowId: string, input: CreateAgentPlanInput, now = Date.now()): AgentPlan {
    const workflow = this.requireWorkflow(workflowId)
    if (workflow.status !== 'gathering_evidence') throw new Error('当前工作流不能创建新计划')
    const { evidenceIds } = this.validatePlanInput(workflow, input)
    const id = randomUUID()
    const hash = digest({ workflowId, scope: workflow.scope, summary: input.summary.trim(), risk: input.risk.trim(), evidenceIds, actions: input.actions })
    this.db.transaction(() => {
      this.db.prepare("UPDATE agent_plans SET status = 'stale' WHERE workflow_id = ? AND status = 'awaiting_approval'").run(workflowId)
      this.db.prepare('INSERT INTO agent_plans (id, workflow_id, status, summary, risk, evidence_ids_json, actions_json, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, workflowId, 'awaiting_approval', input.summary.trim(), input.risk.trim(), stableJson(evidenceIds), stableJson(input.actions), hash, now)
      this.transition(workflowId, 'awaiting_approval', now)
      this.addEvent(workflowId, 'warning', `计划已生成：${input.actions.length} 项操作等待审批。`, { planId: id, hash }, now)
    })()
    return this.getWorkflow(workflowId)!.plan!
  }

  replaceDraftPlan(workflowId: string, input: CreateAgentPlanInput, now = Date.now()): AgentPlan {
    const workflow = this.requireWorkflow(workflowId)
    const view = this.getWorkflow(workflowId)
    if (!view?.plan || view.plan.status !== 'awaiting_approval' || workflow.status !== 'awaiting_approval') throw new Error('当前工作流没有可更新的待审批计划')
    const normalized = this.validatePlanInput(workflow, input)
    const hash = digest({ workflowId, scope: workflow.scope, summary: input.summary.trim(), risk: input.risk.trim(), evidenceIds: normalized.evidenceIds, actions: input.actions })
    this.db.transaction(() => {
      this.db.prepare('UPDATE agent_plans SET summary = ?, risk = ?, evidence_ids_json = ?, actions_json = ?, hash = ? WHERE id = ?').run(input.summary.trim(), input.risk.trim(), stableJson(normalized.evidenceIds), stableJson(input.actions), hash, view.plan!.id)
      this.touch(workflowId, now)
      this.addEvent(workflowId, 'info', '待审批计划已根据用户选择更新。', { planId: view.plan!.id, hash }, now)
    })()
    return this.getWorkflow(workflowId)!.plan!
  }

  approvePlan(workflowId: string, planHash: string, now = Date.now(), ttlMs = 15 * 60_000): AgentWorkflowView {
    const view = this.getWorkflow(workflowId)
    if (!view?.plan || view.status !== 'awaiting_approval') throw new Error('当前工作流没有待审批计划')
    if (view.plan.hash !== planHash) throw new Error('计划内容已变化，请重新查看后审批')
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('执行授权有效期无效')
    const approvalId = randomUUID()
    const grantId = randomUUID()
    this.db.transaction(() => {
      this.db.prepare("UPDATE agent_plans SET status = 'approved', approved_at = ? WHERE id = ?").run(now, view.plan!.id)
      this.db.prepare('INSERT INTO agent_approvals (id, plan_id, plan_hash, status, created_at) VALUES (?, ?, ?, ?, ?)').run(approvalId, view.plan!.id, planHash, 'approved', now)
      this.db.prepare('INSERT INTO agent_execution_grants (id, workflow_id, plan_id, plan_hash, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(grantId, workflowId, view.plan!.id, planHash, 'pending', now + ttlMs, now)
      this.transition(workflowId, 'approved', now)
      this.addEvent(workflowId, 'info', '用户已批准冻结计划，已创建限时执行授权。', { planId: view.plan!.id, grantId, expiresAt: now + ttlMs }, now)
    })()
    return this.getWorkflow(workflowId, now)!
  }

  claimExecutionGrant(workerId: string, leaseMs = 120_000, now = Date.now(), surfaces?: AgentSurface[]): AgentExecutionGrant | null {
    if (!workerId?.trim() || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('执行器租约无效')
    const allowedSurfaces = [...new Set(surfaces || [])]
    const grantId = this.db.transaction(() => {
      this.expireGrants(now)
      const surfaceFilter = allowedSurfaces.length ? ` AND workflow_id IN (SELECT id FROM agent_workflows WHERE surface IN (${allowedSurfaces.map(() => '?').join(',')}))` : ''
      const row = this.db.prepare(`SELECT id FROM agent_execution_grants WHERE status IN ('pending', 'claimed') AND expires_at > ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)${surfaceFilter} ORDER BY created_at LIMIT 1`).get(now, now, ...allowedSurfaces) as Row | undefined
      if (!row) return ''
      const result = this.db.prepare("UPDATE agent_execution_grants SET status = 'claimed', worker_id = ?, lease_expires_at = ? WHERE id = ? AND status IN ('pending', 'claimed') AND expires_at > ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)").run(workerId.trim(), Math.min(now + leaseMs, Number.MAX_SAFE_INTEGER), row.id, now, now)
      if (!result.changes) return ''
      const grant = this.db.prepare('SELECT workflow_id FROM agent_execution_grants WHERE id = ?').get(row.id) as Row
      this.transition(String(grant.workflow_id), 'executing', now)
      this.addEvent(String(grant.workflow_id), 'info', '执行器已领取限时授权。', { workerId: workerId.trim(), grantId: String(row.id) }, now)
      return String(row.id)
    })()
    return grantId ? toGrant(this.db.prepare('SELECT * FROM agent_execution_grants WHERE id = ?').get(grantId) as Row) : null
  }

  recordActionReceipt(grantId: string, workerId: string, input: RecordAgentActionReceiptInput, now = Date.now()): AgentActionReceipt {
    const grant = this.db.prepare('SELECT * FROM agent_execution_grants WHERE id = ?').get(grantId) as Row | undefined
    if (!grant) throw new Error('执行授权不存在')
    const plan = toPlan(this.db.prepare('SELECT * FROM agent_plans WHERE id = ?').get(grant.plan_id) as Row)
    const action = plan.actions.find(item => item.id === input.actionId && item.idempotencyKey === input.idempotencyKey)
    if (!action) throw new Error('执行回执与已批准计划不匹配')
    const existing = this.db.prepare('SELECT * FROM agent_action_receipts WHERE execution_grant_id = ? AND idempotency_key = ?').get(grantId, input.idempotencyKey) as Row | undefined
    if (existing) return toReceipt(existing)
    if (grant.status !== 'claimed' || grant.worker_id !== workerId || Number(grant.lease_expires_at) <= now || Number(grant.expires_at) <= now) throw new Error('执行授权不可用或已过期')
    const id = randomUUID()
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO agent_action_receipts (id, execution_grant_id, action_id, idempotency_key, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, grantId, input.actionId, input.idempotencyKey, input.status, input.result ? stableJson(input.result) : null, now)
      const [level, message] = RECEIPT_EVENTS[input.status]
      this.addEvent(String(grant.workflow_id), level, message, { actionId: input.actionId, receiptId: id }, now)
      // The drive may already have changed: stop handing out this grant until a readback settles the outcome.
      if (input.status === 'unknown') this.db.prepare("UPDATE agent_execution_grants SET status = 'reconciling', lease_expires_at = NULL WHERE id = ?").run(grantId)
      this.finalizeIfComplete(grantId, plan, now)
    })()
    return toReceipt(this.db.prepare('SELECT * FROM agent_action_receipts WHERE id = ?').get(id) as Row)
  }

  /**
   * Turn a pending or unknown receipt into a final one from a readback of the drive.
   * It needs no executor lease: an offline download can finish long after the lease ends.
   */
  settleActionReceipt(grantId: string, input: SettleAgentActionReceiptInput, now = Date.now()): AgentActionReceipt {
    const grant = this.db.prepare('SELECT * FROM agent_execution_grants WHERE id = ?').get(grantId) as Row | undefined
    if (!grant) throw new Error('执行授权不存在')
    const plan = toPlan(this.db.prepare('SELECT * FROM agent_plans WHERE id = ?').get(grant.plan_id) as Row)
    if (!plan.actions.some(item => item.id === input.actionId && item.idempotencyKey === input.idempotencyKey)) throw new Error('执行回执与已批准计划不匹配')
    const row = this.db.prepare('SELECT * FROM agent_action_receipts WHERE execution_grant_id = ? AND idempotency_key = ?').get(grantId, input.idempotencyKey) as Row | undefined
    if (!row) throw new Error('没有可核对的执行回执')
    const receipt = toReceipt(row)
    if (receipt.settledAt && receipt.status === input.status) return receipt
    if (!UNSETTLED_RECEIPT_STATUSES.has(receipt.status)) throw new Error('只有已提交或结果未知的回执可以核对')
    if (input.status !== 'succeeded' && input.status !== 'failed') throw new Error('回执核对只能确认成功或失败')
    const verification = { source: input.verification?.source?.trim() || '', summary: input.verification?.summary?.trim() || '' }
    if (!verification.source || !verification.summary) throw new Error('回执核对必须附带网盘回读结果')
    this.db.transaction(() => {
      this.db.prepare('UPDATE agent_action_receipts SET status = ?, result_json = COALESCE(?, result_json), verification_json = ?, settled_at = ? WHERE id = ?').run(input.status, input.result ? stableJson(input.result) : null, stableJson(verification), now, receipt.id)
      this.addEvent(String(grant.workflow_id), input.status === 'succeeded' ? 'info' : 'error', input.status === 'succeeded' ? '回读核对确认操作已生效。' : '回读核对确认操作未生效。', { actionId: input.actionId, receiptId: receipt.id, source: verification.source }, now)
      if (['claimed', 'reconciling'].includes(String(grant.status))) this.finalizeIfComplete(grantId, plan, now)
    })()
    return toReceipt(this.db.prepare('SELECT * FROM agent_action_receipts WHERE id = ?').get(receipt.id) as Row)
  }

  private finalizeIfComplete(grantId: string, plan: AgentPlan, now: number): void {
    const grant = this.db.prepare('SELECT * FROM agent_execution_grants WHERE id = ?').get(grantId) as Row
    const receipts = (this.db.prepare('SELECT * FROM agent_action_receipts WHERE execution_grant_id = ?').all(grantId) as Row[]).map(toReceipt)
    if (receipts.some(receipt => receipt.status === 'failed')) {
      this.db.prepare("UPDATE agent_execution_grants SET status = 'failed', completed_at = ? WHERE id = ?").run(now, grantId)
      this.db.prepare("UPDATE agent_plans SET status = 'failed', completed_at = ? WHERE id = ?").run(now, plan.id)
      this.transition(String(grant.workflow_id), 'failed', now)
      return
    }
    const unsettled = receipts.some(receipt => UNSETTLED_RECEIPT_STATUSES.has(receipt.status))
    if (receipts.length !== plan.actions.length) {
      // An unknown outcome paused the run. Once it settles as succeeded, the rest of the plan can be
      // claimed again; the executor skips every action that already has a receipt.
      if (grant.status === 'reconciling' && !unsettled) {
        this.db.prepare("UPDATE agent_execution_grants SET status = 'pending', worker_id = NULL, lease_expires_at = NULL WHERE id = ?").run(grantId)
        this.addEvent(String(grant.workflow_id), 'info', '回读核对已完成，剩余操作可以继续执行。', { grantId }, now)
      }
      return
    }
    if (unsettled) {
      if (grant.status !== 'reconciling') {
        this.db.prepare("UPDATE agent_execution_grants SET status = 'reconciling', lease_expires_at = NULL WHERE id = ?").run(grantId)
        this.addEvent(String(grant.workflow_id), 'warning', '所有操作已执行，部分结果需要回读网盘核对后才能结束。', { grantId }, now)
      }
      return
    }
    this.db.prepare("UPDATE agent_execution_grants SET status = 'completed', completed_at = ? WHERE id = ?").run(now, grantId)
    this.db.prepare("UPDATE agent_plans SET status = 'completed', completed_at = ? WHERE id = ?").run(now, plan.id)
    this.transition(String(grant.workflow_id), 'completed', now)
    this.addEvent(String(grant.workflow_id), 'info', '已完成所有已批准操作。', { grantId }, now)
  }

  private expireGrants(now: number): void {
    const rows = this.db.prepare("SELECT id, workflow_id, plan_id FROM agent_execution_grants WHERE status IN ('pending', 'claimed') AND expires_at <= ?").all(now) as Row[]
    for (const row of rows) {
      this.db.prepare("UPDATE agent_execution_grants SET status = 'expired', completed_at = ? WHERE id = ?").run(now, row.id)
      this.db.prepare("UPDATE agent_plans SET status = 'stale' WHERE id = ? AND status = 'approved'").run(row.plan_id)
      this.transition(String(row.workflow_id), 'expired', now)
      this.addEvent(String(row.workflow_id), 'warning', '执行授权已过期，计划需要重新审批。', { grantId: String(row.id) }, now)
    }
  }

  private requireWorkflow(id: string): AgentWorkflow {
    const view = this.getWorkflow(id)
    if (!view) throw new Error('Agent 工作流不存在')
    if (TERMINAL_WORKFLOW_STATUSES.has(view.status)) throw new Error('Agent 工作流已经结束')
    return view
  }

  private validatePlanInput(workflow: AgentWorkflow, input: CreateAgentPlanInput): { evidenceIds: string[] } {
    if (!input.summary?.trim() || !input.risk?.trim() || !input.actions?.length) throw new Error('计划摘要、风险和操作不能为空')
    const evidenceIds = [...new Set(input.evidenceIds)]
    if (!evidenceIds.length) throw new Error('计划必须引用至少一条证据')
    const matchingEvidence = this.db.prepare(`SELECT id FROM agent_evidence WHERE workflow_id = ? AND id IN (${evidenceIds.map(() => '?').join(',')})`).all(workflow.id, ...evidenceIds) as Row[]
    if (matchingEvidence.length !== evidenceIds.length) throw new Error('计划引用了不属于该工作流的证据')
    validateActions(input.actions)
    const resourceHandleIds = [...new Set(input.actions.flatMap(action => action.resourceHandleIds))]
    const resourceRows = this.db.prepare(`SELECT * FROM agent_resource_handles WHERE workflow_id = ? AND id IN (${resourceHandleIds.map(() => '?').join(',')})`).all(workflow.id, ...resourceHandleIds) as Row[]
    const policyViolation = validateAgentPlanPolicy(workflow.scope, input.actions, resourceRows.map(toResourceHandle))
    if (policyViolation) throw new Error(policyViolation)
    return { evidenceIds }
  }

  private transition(workflowId: string, status: AgentWorkflowStatus, now: number): void {
    this.db.prepare('UPDATE agent_workflows SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?').run(status, now, TERMINAL_WORKFLOW_STATUSES.has(status) ? now : null, workflowId)
  }

  private touch(workflowId: string, now: number): void { this.db.prepare('UPDATE agent_workflows SET updated_at = ? WHERE id = ?').run(now, workflowId) }

  private addEvent(workflowId: string, level: AgentLedgerEvent['level'], message: string, data?: Record<string, unknown>, now = Date.now()): void {
    this.db.prepare('INSERT INTO agent_events (id, workflow_id, level, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), workflowId, level, message, data ? stableJson(data) : null, now)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workflows (id TEXT PRIMARY KEY, surface TEXT NOT NULL, goal TEXT NOT NULL, scope_json TEXT NOT NULL, status TEXT NOT NULL, external_ref TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER);
      CREATE TABLE IF NOT EXISTS agent_evidence (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL, data_json TEXT NOT NULL, hash TEXT NOT NULL, external_ref TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_resource_handles (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, evidence_id TEXT NOT NULL, kind TEXT NOT NULL, snapshot_json TEXT NOT NULL, hash TEXT NOT NULL, external_ref TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_plans (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, risk TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, actions_json TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, approved_at INTEGER, completed_at INTEGER);
      CREATE TABLE IF NOT EXISTS agent_approvals (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, plan_hash TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_execution_grants (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan_hash TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, worker_id TEXT, lease_expires_at INTEGER, created_at INTEGER NOT NULL, completed_at INTEGER);
      CREATE TABLE IF NOT EXISTS agent_action_receipts (id TEXT PRIMARY KEY, execution_grant_id TEXT NOT NULL, action_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL, UNIQUE(execution_grant_id, idempotency_key));
      CREATE TABLE IF NOT EXISTS agent_events (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, data_json TEXT, created_at INTEGER NOT NULL);
    `)
    this.ensureColumn('agent_workflows', 'external_ref', 'TEXT')
    this.ensureColumn('agent_evidence', 'external_ref', 'TEXT')
    this.ensureColumn('agent_resource_handles', 'external_ref', 'TEXT')
    this.ensureColumn('agent_action_receipts', 'verification_json', 'TEXT')
    this.ensureColumn('agent_action_receipts', 'settled_at', 'INTEGER')
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS agent_workflows_updated ON agent_workflows(updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_workflows_external_ref ON agent_workflows(external_ref) WHERE external_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS agent_evidence_workflow ON agent_evidence(workflow_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_evidence_external_ref ON agent_evidence(workflow_id, external_ref) WHERE external_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS agent_resource_handles_workflow ON agent_resource_handles(workflow_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_resource_handles_external_ref ON agent_resource_handles(workflow_id, external_ref) WHERE external_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS agent_grants_claim ON agent_execution_grants(status, expires_at, lease_expires_at, created_at);
      CREATE INDEX IF NOT EXISTS agent_receipts_grant ON agent_action_receipts(execution_grant_id, created_at);
    `)
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]
    if (!columns.some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function validateActions(actions: AgentPlanAction[]): void {
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const action of actions) {
    if (!action.id?.trim() || !action.label?.trim() || !action.idempotencyKey?.trim() || !action.resourceHandleIds?.length) throw new Error('计划操作缺少必要字段')
    if (ids.has(action.id) || keys.has(action.idempotencyKey)) throw new Error('计划操作标识或幂等键重复')
    ids.add(action.id)
    keys.add(action.idempotencyKey)
  }
}

function digest(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex') }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function parse<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function toWorkflow(row: Row): AgentWorkflow { return { id: row.id, surface: row.surface, goal: row.goal, scope: parse(row.scope_json, {}), status: row.status, externalRef: row.external_ref || undefined, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at || undefined } as AgentWorkflow }
function toEvidence(row: Row): AgentEvidence { return { id: row.id, workflowId: row.workflow_id, source: row.source, summary: row.summary, data: parse(row.data_json, {}), hash: row.hash, externalRef: row.external_ref || undefined, createdAt: row.created_at } }
function toResourceHandle(row: Row): AgentResourceHandle { return { id: row.id, workflowId: row.workflow_id, evidenceId: row.evidence_id, kind: row.kind, snapshot: parse(row.snapshot_json, {}), hash: row.hash, externalRef: row.external_ref || undefined, createdAt: row.created_at } as AgentResourceHandle }
function toPlan(row: Row): AgentPlan { return { id: row.id, workflowId: row.workflow_id, status: row.status, summary: row.summary, risk: row.risk, evidenceIds: parse(row.evidence_ids_json, []), actions: parse(row.actions_json, []), hash: row.hash, createdAt: row.created_at, approvedAt: row.approved_at || undefined, completedAt: row.completed_at || undefined } }
function toApproval(row: Row): AgentApproval { return { id: row.id, planId: row.plan_id, planHash: row.plan_hash, status: 'approved', createdAt: row.created_at } }
function toGrant(row: Row): AgentExecutionGrant { return { id: row.id, workflowId: row.workflow_id, planId: row.plan_id, planHash: row.plan_hash, status: row.status, expiresAt: row.expires_at, workerId: row.worker_id || undefined, leaseExpiresAt: row.lease_expires_at || undefined, createdAt: row.created_at, completedAt: row.completed_at || undefined } as AgentExecutionGrant }
function toReceipt(row: Row): AgentActionReceipt { return { id: row.id, executionGrantId: row.execution_grant_id, actionId: row.action_id, idempotencyKey: row.idempotency_key, status: row.status, result: parse(row.result_json, undefined), verification: parse(row.verification_json, undefined), createdAt: row.created_at, settledAt: row.settled_at || undefined } }
function toEvent(row: Row): AgentLedgerEvent { return { id: row.id, workflowId: row.workflow_id, level: row.level, message: row.message, data: parse(row.data_json, undefined), createdAt: row.created_at } }
