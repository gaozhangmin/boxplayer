import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyCliApplyResult, reconcileUnknownCliAction } from '../../agent/AgentCliExecutor.ts'

const { settleAgentActionReceipt } = vi.hoisted(() => ({ settleAgentActionReceipt: vi.fn() }))
vi.mock('../../agent/AgentControlService.ts', () => ({ settleAgentActionReceipt, claimAgentExecutionGrant: vi.fn(), getAgentWorkflow: vi.fn(), recordAgentActionReceipt: vi.fn() }))

const workflow: any = { id: 'workflow-1', scope: { accountId: 'user-1', driveId: 'drive-1', rootId: 'root', platform: 'aliyun', operations: ['files.list', 'files.move'] } }
const action = { id: 'move-1', kind: 'move' as const, label: '移动：报告.pdf', idempotencyKey: 'move:user-1:file-1', resourceHandleIds: ['handle-1'] }
const movePreflight = { command: 'files move-apply' as const, rationale: 'approved', plan: { items: [{ file_id: 'file-1', from_parent_file_id: 'folder-1', to_parent_file_id: 'folder-2' }] } }

function inspectorWithParent(parentResourceId?: string) {
  return {
    inspectResource: vi.fn().mockResolvedValue({ kind: 'file', snapshot: { accountId: 'user-1', driveId: 'drive-1', resourceId: 'file-1', parentResourceId, name: '报告.pdf' } }),
    isWithinScopeRoot: vi.fn().mockResolvedValue(true)
  }
}

beforeEach(() => settleAgentActionReceipt.mockReset())

describe('AgentCliExecutor outcomes', () => {
  it('trusts the CLI per-item report once it has finished the batch', () => {
    expect(classifyCliApplyResult({ exitCode: 0, stdout: JSON.stringify({ ok: true, operationId: 'op-1', results: [{ fileId: 'file-1', status: 'success' }] }), stderr: '' }, 'file-1')).toMatchObject({ status: 'succeeded', result: { operationId: 'op-1' } })
    expect(classifyCliApplyResult({ exitCode: 3, stdout: JSON.stringify({ ok: false, results: [{ fileId: 'file-1', status: 'failed', message: '目标目录不存在' }] }), stderr: '' }, 'file-1')).toMatchObject({ status: 'failed', result: { message: '目标目录不存在' } })
  })

  it('treats a missing per-item report as unknown unless the CLI rejected the plan before writing', () => {
    expect(classifyCliApplyResult({ exitCode: 1, stdout: '', stderr: 'confirm required\n' }, 'file-1')).toMatchObject({ status: 'failed', result: { message: 'confirm required' } })
    expect(classifyCliApplyResult({ exitCode: 3, stdout: '', stderr: 'socket hang up\n' }, 'file-1')).toMatchObject({ status: 'unknown', result: { message: 'socket hang up' } })
    expect(classifyCliApplyResult({ exitCode: 0, stdout: 'not json', stderr: '' }, 'file-1').status).toBe('unknown')
  })

  it('settles an unknown move from the file parent it reads back', async () => {
    await expect(reconcileUnknownCliAction('grant-1', workflow, action, movePreflight, inspectorWithParent('folder-2'))).resolves.toBe('succeeded')
    expect(settleAgentActionReceipt).toHaveBeenCalledWith('grant-1', expect.objectContaining({ actionId: 'move-1', status: 'succeeded', verification: expect.objectContaining({ source: 'clouddrive-cli files info' }) }))

    await expect(reconcileUnknownCliAction('grant-1', workflow, action, movePreflight, inspectorWithParent('folder-1'))).resolves.toBe('failed')
    expect(settleAgentActionReceipt).toHaveBeenLastCalledWith('grant-1', expect.objectContaining({ status: 'failed' }))
  })

  it('leaves the outcome unknown when the readback cannot decide it', async () => {
    await expect(reconcileUnknownCliAction('grant-1', workflow, action, movePreflight, inspectorWithParent('folder-9'))).resolves.toBe('unknown')
    const trashPreflight = { command: 'files trash-apply' as const, rationale: 'approved', plan: { items: [{ file_id: 'file-1' }] } }
    await expect(reconcileUnknownCliAction('grant-1', workflow, { ...action, kind: 'trash' as const }, trashPreflight, inspectorWithParent('folder-1'))).resolves.toBe('unknown')
    expect(settleAgentActionReceipt).not.toHaveBeenCalled()
  })
})
