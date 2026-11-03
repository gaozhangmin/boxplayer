import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { AgentLedgerDb } from '../../agent/AgentLedgerDb.ts'
import { agentV1FeatureFlags } from '../../agent/AgentV1FeatureFlags.ts'

const dirs: string[] = []

function createDb() {
  const dir = mkdtempSync(join(tmpdir(), 'boxplayer-agent-v1-'))
  dirs.push(dir)
  return new AgentLedgerDb(join(dir, 'agent-v1.db'))
}

const workflowInput = {
  surface: 'workspace' as const,
  goal: '把重复文件移到回收站',
  scope: { accountId: 'user-1', driveId: 'drive-1', rootId: 'root', platform: 'aliyun', operations: ['files.read', 'trash.move'] }
}

function actionFor(db: AgentLedgerDb, workflowId: string, evidenceId: string, kind: 'move' | 'trash' | 'import_share' | 'download' = 'trash') {
  const handle = db.createResourceHandle(workflowId, { evidenceId, kind: kind === 'import_share' ? 'share' : 'file', snapshot: { accountId: 'user-1', driveId: 'drive-1', resourceId: kind === 'import_share' ? 'share-1' : 'file-1', name: kind === 'import_share' ? '分享资源' : 'file-1' } }, 1150)
  return { id: `${kind}-file-1`, kind, label: kind === 'trash' ? '移入回收站：file-1' : '操作：file-1', idempotencyKey: `${kind}:user-1:drive-1:file-1`, resourceHandleIds: [handle.id] }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('AgentLedgerDb', () => {
  it('keeps every migration bridge off until the control plane is explicitly enabled', () => {
    expect(agentV1FeatureFlags({ BOXPLAYER_AGENT_V1_WORKSPACE: '1' })).toEqual({ controlPlane: false, workspaceBridge: false, workspaceCutover: false, mediaAcquisitionBridge: false, aiSearchBridge: false, aiSearchCutover: false, documentBridge: false, cliExecutor: false })
    expect(agentV1FeatureFlags({ BOXPLAYER_AGENT_V1: '1', BOXPLAYER_AGENT_V1_WORKSPACE: '1' })).toMatchObject({ controlPlane: true, workspaceBridge: true, workspaceCutover: false, mediaAcquisitionBridge: false, aiSearchBridge: false, cliExecutor: false })
    expect(agentV1FeatureFlags({ BOXPLAYER_AGENT_V1: '1', BOXPLAYER_AGENT_V1_WORKSPACE: '1', BOXPLAYER_AGENT_V1_EXECUTOR: '1' }).cliExecutor).toBe(false)
    expect(agentV1FeatureFlags({ BOXPLAYER_AGENT_V1: '1', BOXPLAYER_AGENT_V1_WORKSPACE: '1', BOXPLAYER_AGENT_V1_EXECUTOR: '1', BOXPLAYER_AGENT_V1_WORKSPACE_CUTOVER: '1' })).toMatchObject({ workspaceCutover: true, cliExecutor: true })
    expect(agentV1FeatureFlags({ BOXPLAYER_AGENT_V1: '1', BOXPLAYER_AGENT_V1_WORKSPACE: '1', BOXPLAYER_AGENT_V1_AI_SEARCH: '1', BOXPLAYER_AGENT_V1_EXECUTOR: '1', BOXPLAYER_AGENT_V1_AI_SEARCH_CUTOVER: '1' })).toMatchObject({ aiSearchBridge: true, aiSearchCutover: true, cliExecutor: true })
  })

  it('only creates an execution grant for the exact approved plan hash', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan_duplicates', summary: '找到重复文件', data: { fileId: 'file-1' } }, 1100)
    const action = actionFor(db, workflow.id, evidence.id)
    const plan = db.createPlan(workflow.id, { summary: '把重复文件移到回收站', risk: '文件会进入回收站，可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)

    expect(() => db.approvePlan(workflow.id, 'another-hash', 1300)).toThrow('计划内容已变化')
    const approved = db.approvePlan(workflow.id, plan.hash, 1300, 60_000)

    expect(approved).toMatchObject({
      status: 'approved',
      approval: { planHash: plan.hash, status: 'approved' },
      executionGrant: { planHash: plan.hash, status: 'pending', expiresAt: 61_300 }
    })
    db.close()
  })

  it('gives an execution grant to only one worker until its lease expires', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [actionFor(db, workflow.id, evidence.id)] }, 1200)
    const grant = db.approvePlan(workflow.id, plan.hash, 1300, 60_000).executionGrant!

    expect(db.claimExecutionGrant('worker-a', 10_000, 1400)?.id).toBe(grant.id)
    expect(db.claimExecutionGrant('worker-b', 10_000, 1500)).toBeNull()
    expect(db.claimExecutionGrant('worker-b', 10_000, 11_401)?.id).toBe(grant.id)
    db.close()
  })

  it('keeps media transfer grants out of the cloud-drive CLI worker queue', () => {
    const db = createDb()
    const now = Date.now()
    const workspace = db.createWorkflow(workflowInput, now)
    const workspaceEvidence = db.addEvidence(workspace.id, { source: 'scan', summary: '完成', data: {} }, now + 100)
    const workspaceAction = actionFor(db, workspace.id, workspaceEvidence.id)
    const workspacePlan = db.createPlan(workspace.id, { summary: '清理', risk: '可恢复', evidenceIds: [workspaceEvidence.id], actions: [workspaceAction] }, now + 200)

    const media = db.createWorkflow({ ...workflowInput, surface: 'media_acquisition' }, now + 1)
    const mediaEvidence = db.addEvidence(media.id, { source: 'candidate', summary: '候选', data: {} }, now + 101)
    const mediaAction = actionFor(db, media.id, mediaEvidence.id)
    const mediaPlan = db.createPlan(media.id, { summary: '提交候选', risk: '会创建网盘任务', evidenceIds: [mediaEvidence.id], actions: [mediaAction] }, now + 201)
    db.approvePlan(workspace.id, workspacePlan.hash, now + 300, 60_000)
    db.approvePlan(media.id, mediaPlan.hash, now + 301, 60_000)

    expect(db.claimExecutionGrant('cli-worker', 10_000, now + 400, ['workspace'])?.workflowId).toBe(workspace.id)
    expect(db.claimExecutionGrant('media-worker', 10_000, now + 400, ['media_acquisition'])?.workflowId).toBe(media.id)
    db.close()
  })

  it('marks an unclaimed approval expired when the workflow is read after its deadline', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [actionFor(db, workflow.id, evidence.id)] }, 1200)
    db.approvePlan(workflow.id, plan.hash, 1300, 100)

    expect(db.getWorkflow(workflow.id, 1401)).toMatchObject({ status: 'expired', plan: { status: 'stale' }, executionGrant: { status: 'expired' } })
    db.close()
  })

  it('closes a read-only observation workflow without creating an execution grant', () => {
    const db = createDb()
    const workflow = db.createWorkflow({ ...workflowInput, surface: 'ai_search', scope: { ...workflowInput.scope, operations: ['files.list'] } }, 1000)
    db.addEvidence(workflow.id, { source: 'search', summary: '搜索完成', data: { total: 3 } }, 1100)

    expect(db.completeObservation(workflow.id, 'completed', '只读取证已结束', 1200)).toMatchObject({ status: 'completed', plan: undefined, executionGrant: undefined, finishedAt: 1200 })
    expect(() => db.addEvidence(workflow.id, { source: 'search', summary: '不应再添加', data: {} }, 1300)).toThrow('Agent 工作流已经结束')
    db.close()
  })

  it('keeps an action receipt idempotent for retry-safe execution', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const action = actionFor(db, workflow.id, evidence.id)
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)
    const grant = db.approvePlan(workflow.id, plan.hash, 1300, 60_000).executionGrant!
    expect(db.claimExecutionGrant('worker-a', 10_000, 1400)).toMatchObject({ id: grant.id, status: 'claimed', workerId: 'worker-a' })

    const first = db.recordActionReceipt(grant.id, 'worker-a', { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'succeeded', result: { trashed: true } }, 1500)
    const retry = db.recordActionReceipt(grant.id, 'worker-a', { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'succeeded', result: { trashed: true } }, 1600)

    expect(retry.id).toBe(first.id)
    expect(db.getWorkflow(workflow.id)).toMatchObject({ status: 'completed', receipts: [{ id: first.id, status: 'succeeded' }] })
    db.close()
  })

  it('rejects a write plan when its resource or operation is outside the granted scope', () => {
    const db = createDb()
    const workflow = db.createWorkflow({ ...workflowInput, scope: { ...workflowInput.scope, operations: ['files.read'] } }, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const action = actionFor(db, workflow.id, evidence.id)

    expect(() => db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)).toThrow('当前范围未授予 trash.move 操作权限')
    db.close()
  })

  it('keeps external workspace references idempotent while a draft plan changes', () => {
    const db = createDb()
    const workflow = db.createWorkflow({ ...workflowInput, externalRef: 'workspace:task-1' }, 1000)
    expect(db.findWorkflowByExternalRef('workspace:task-1')?.id).toBe(workflow.id)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {}, externalRef: 'workspace-evidence:e-1' }, 1100)
    expect(db.addEvidence(workflow.id, { source: 'scan', summary: '新摘要不会覆盖已验证证据', data: {}, externalRef: 'workspace-evidence:e-1' }, 1150).id).toBe(evidence.id)
    const action = actionFor(db, workflow.id, evidence.id)
    const plan = db.createPlan(workflow.id, { summary: '清理一项', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)
    const updated = db.replaceDraftPlan(workflow.id, { summary: '用户仅保留已选择项目', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1300)

    expect(updated.id).toBe(plan.id)
    expect(updated.hash).not.toBe(plan.hash)
    expect(db.getWorkflow(workflow.id)).toMatchObject({ status: 'awaiting_approval', plan: { summary: '用户仅保留已选择项目' } })
    db.close()
  })

  it('adds external references before creating their legacy-table indexes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boxplayer-agent-v1-legacy-'))
    dirs.push(dir)
    const path = join(dir, 'agent-v1.db')
    const legacy = new Database(path)
    legacy.exec('CREATE TABLE agent_workflows (id TEXT PRIMARY KEY, surface TEXT NOT NULL, goal TEXT NOT NULL, scope_json TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER); CREATE TABLE agent_evidence (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL, data_json TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE agent_resource_handles (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, evidence_id TEXT NOT NULL, kind TEXT NOT NULL, snapshot_json TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);')
    legacy.close()

    const db = new AgentLedgerDb(path)
    expect(db.createWorkflow({ ...workflowInput, externalRef: 'workspace:legacy-task' }, 1000)).toMatchObject({ externalRef: 'workspace:legacy-task' })
    db.close()
  })

  it('holds a pending outcome until a readback settles it, without retrying or expiring it', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const action = actionFor(db, workflow.id, evidence.id)
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)
    const grant = db.approvePlan(workflow.id, plan.hash, 1300, 60_000).executionGrant!
    db.claimExecutionGrant('worker-a', 10_000, 1400)

    const pending = db.recordActionReceipt(grant.id, 'worker-a', { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'pending', result: { taskId: 'task-1' } }, 1500)
    expect(db.recordActionReceipt(grant.id, 'worker-a', { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'succeeded' }, 1600).id).toBe(pending.id)
    expect(db.getWorkflow(workflow.id, 1700)).toMatchObject({ status: 'executing', executionGrant: { status: 'reconciling' }, receipts: [{ status: 'pending' }] })
    expect(db.claimExecutionGrant('worker-b', 10_000, 20_000)).toBeNull()
    expect(db.getWorkflow(workflow.id, 120_000)).toMatchObject({ status: 'executing', executionGrant: { status: 'reconciling' } })

    expect(() => db.settleActionReceipt(grant.id, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'succeeded', verification: { source: ' ', summary: '' } }, 121_000)).toThrow('必须附带网盘回读结果')
    const settled = db.settleActionReceipt(grant.id, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'succeeded', verification: { source: 'files info', summary: '文件已在回收站' } }, 122_000)
    expect(settled).toMatchObject({ id: pending.id, status: 'succeeded', result: { taskId: 'task-1' }, verification: { source: 'files info', summary: '文件已在回收站' }, settledAt: 122_000 })
    expect(db.getWorkflow(workflow.id, 123_000)).toMatchObject({ status: 'completed', executionGrant: { status: 'completed' }, plan: { status: 'completed' } })
    expect(() => db.settleActionReceipt(grant.id, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'failed', verification: { source: 'files info', summary: '不应改写' } }, 124_000)).toThrow('只有已提交或结果未知的回执可以核对')
    db.close()
  })

  it('pauses a plan at an unknown outcome and resumes only the remaining actions after a successful readback', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const first = actionFor(db, workflow.id, evidence.id)
    const secondHandle = db.createResourceHandle(workflow.id, { evidenceId: evidence.id, kind: 'file', snapshot: { accountId: 'user-1', driveId: 'drive-1', resourceId: 'file-2', name: 'file-2' } }, 1150)
    const second = { ...first, id: 'trash-file-2', label: '移入回收站：file-2', idempotencyKey: 'trash:user-1:drive-1:file-2', resourceHandleIds: [secondHandle.id] }
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [first, second] }, 1200)
    const grant = db.approvePlan(workflow.id, plan.hash, 1300, 60_000).executionGrant!
    db.claimExecutionGrant('worker-a', 10_000, 1400)

    db.recordActionReceipt(grant.id, 'worker-a', { actionId: first.id, idempotencyKey: first.idempotencyKey, status: 'unknown', result: { message: 'timeout' } }, 1500)
    expect(db.getWorkflow(workflow.id, 1600)).toMatchObject({ status: 'executing', executionGrant: { status: 'reconciling' } })
    expect(() => db.recordActionReceipt(grant.id, 'worker-a', { actionId: second.id, idempotencyKey: second.idempotencyKey, status: 'succeeded' }, 1700)).toThrow('执行授权不可用或已过期')

    db.settleActionReceipt(grant.id, { actionId: first.id, idempotencyKey: first.idempotencyKey, status: 'succeeded', verification: { source: 'files info', summary: '文件已移走' } }, 1800)
    expect(db.getWorkflow(workflow.id, 1900)).toMatchObject({ status: 'executing', executionGrant: { status: 'pending' }, receipts: [{ status: 'succeeded' }] })
    expect(db.claimExecutionGrant('worker-b', 10_000, 2000)?.id).toBe(grant.id)
    db.recordActionReceipt(grant.id, 'worker-b', { actionId: second.id, idempotencyKey: second.idempotencyKey, status: 'succeeded' }, 2100)
    expect(db.getWorkflow(workflow.id, 2200)).toMatchObject({ status: 'completed', executionGrant: { status: 'completed' } })
    db.close()
  })

  it('fails the workflow when a readback shows that an unknown action did not take effect', () => {
    const db = createDb()
    const workflow = db.createWorkflow(workflowInput, 1000)
    const evidence = db.addEvidence(workflow.id, { source: 'scan', summary: '完成', data: {} }, 1100)
    const action = actionFor(db, workflow.id, evidence.id)
    const plan = db.createPlan(workflow.id, { summary: '清理', risk: '可恢复', evidenceIds: [evidence.id], actions: [action] }, 1200)
    const grant = db.approvePlan(workflow.id, plan.hash, 1300, 60_000).executionGrant!
    db.claimExecutionGrant('worker-a', 10_000, 1400)
    db.recordActionReceipt(grant.id, 'worker-a', { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'unknown' }, 1500)

    db.settleActionReceipt(grant.id, { actionId: action.id, idempotencyKey: action.idempotencyKey, status: 'failed', verification: { source: 'files info', summary: '文件仍在原目录' } }, 1600)
    expect(db.getWorkflow(workflow.id, 1700)).toMatchObject({ status: 'failed', executionGrant: { status: 'failed' }, receipts: [{ status: 'failed', verification: { summary: '文件仍在原目录' } }] })
    db.close()
  })
})
