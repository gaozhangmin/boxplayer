import { describe, expect, it } from 'vitest'
import type { ResourceCandidate } from '@mediary/domain'
import { BoxPlayerStorageExecutor, type BoxPlayerDriveClient, type DriveItem } from '../../mediary/BoxPlayerStorageExecutor'

type Tree = Record<string, DriveItem[]>
const GB = 1024 * 1024 * 1024

function fakeClient(tree: Tree, overrides: Partial<BoxPlayerDriveClient> = {}) {
  const calls: string[] = []
  let nextId = 1
  const client: BoxPlayerDriveClient = {
    label: '测试盘',
    rootId: '0',
    listFiles: async id => tree[id] || [],
    createDirectory: async (parentId, name) => {
      const id = `dir-${nextId++}`
      tree[parentId] = [...(tree[parentId] || []), { id, name, isDirectory: true, size: 0 }]
      tree[id] = []
      calls.push(`mkdir:${parentId}:${name}`)
      return id
    },
    renameFile: async (fileId, newName) => { calls.push(`rename:${fileId}:${newName}`) },
    moveFiles: async (fileIds, target) => { calls.push(`move:${fileIds.join(',')}->${target}`) },
    trashFiles: async fileIds => { calls.push(`trash:${fileIds.join(',')}`) },
    ...overrides
  }
  return { client, calls }
}

function candidate(type: string, url: string): ResourceCandidate {
  return { id: 'cand-1', snapshotId: 'snap-1', index: 0, title: '沙丘2 4K', type: type as ResourceCandidate['type'], source: 'tg', providerPayload: { url, password: '' } }
}

const noWait = async () => {}

describe('BoxPlayerStorageExecutor', () => {
  it('only writes inside the chosen folder and folders created under it', async () => {
    const { client } = fakeClient({ folder: [], other: [] })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['folder'], wait: noWait })
    const showDir = await executor.createDirectory({ parentId: 'folder', name: '沙丘2 (2024)' })
    await expect(executor.createDirectory({ parentId: showDir, name: 'staging-run' })).resolves.toMatch(/^dir-/)
    await expect(executor.moveFiles({ fileIds: ['f1'], targetDirectoryId: 'other' })).rejects.toThrow('WRITE_SCOPE_VIOLATION')
    await expect(executor.removeDirectory('folder')).rejects.toThrow('SAFETY_VIOLATION')
    await expect(executor.listTree({ directoryId: '0' })).rejects.toThrow('SAFETY_VIOLATION')
  })

  it('reuses an existing folder with the same name instead of creating a duplicate', async () => {
    const { client, calls } = fakeClient({ folder: [{ id: 'show', name: '沙丘2 (2024)', isDirectory: true, size: 0 }] })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['folder'], wait: noWait })
    await expect(executor.createDirectory({ parentId: 'folder', name: '沙丘2 (2024)' })).resolves.toBe('show')
    expect(calls).toEqual([])
  })

  it('judges a share save by the videos that appear in staging', async () => {
    const tree: Tree = { staging: [] }
    const { client } = fakeClient(tree, {
      shareTypes: ['aliyun'],
      importShare: async ({ directoryId }) => { tree[directoryId] = [{ id: 'v1', name: 'Dune.Part.Two.2024.2160p.mkv', isDirectory: false, size: 20 * GB }] }
    })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['staging'], wait: noWait })
    const attempt = await executor.transfer({ workflowRunId: 'run-1', directoryId: 'staging', candidate: candidate('aliyun', 'https://www.alipan.com/s/abc') })
    expect(attempt).toMatchObject({ status: 'succeeded', materializedFileIds: ['v1'], candidateId: 'cand-1' })
  })

  it('reports a dead share as a failed attempt the agent can recover from', async () => {
    const { client } = fakeClient({ staging: [] }, { shareTypes: ['aliyun'], importShare: async () => { throw new Error('分享不存在或已失效') } })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['staging'], wait: noWait })
    await expect(executor.transfer({ workflowRunId: 'run-1', directoryId: 'staging', candidate: candidate('aliyun', 'https://www.alipan.com/s/dead') })).resolves.toMatchObject({ status: 'failed', providerMessage: '分享不存在或已失效' })
  })

  it('polls an offline task and reports no_target_change when nothing lands in time', async () => {
    let polls = 0
    const { client } = fakeClient({ staging: [] }, {
      createOfflineTask: async () => ({ taskId: 'task-1' }),
      getOfflineTaskStatus: async () => { polls++; return { completed: false, failed: false } }
    })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['staging'], taskPollMaxPolls: 3, shareSettlePolls: 2, wait: noWait })
    const attempt = await executor.transfer({ workflowRunId: 'run-1', directoryId: 'staging', candidate: candidate('magnet', 'magnet:?xt=urn:btih:abc') })
    expect(polls).toBe(3)
    expect(attempt.status).toBe('no_target_change')
  })

  it('refuses a link type the drive cannot transfer', async () => {
    const { client } = fakeClient({ staging: [] })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['staging'], wait: noWait })
    await expect(executor.transfer({ workflowRunId: 'run-1', directoryId: 'staging', candidate: candidate('magnet', 'magnet:?xt=urn:btih:abc') })).resolves.toMatchObject({ status: 'failed', providerMessage: expect.stringContaining('BOXPLAYER_NO_OFFLINE') })
  })

  it('surfaces a drive login failure instead of recording a failed attempt', async () => {
    const { client } = fakeClient({ staging: [] }, { shareTypes: ['aliyun'], importShare: async () => { throw new Error('BOXPLAYER_DRIVE_AUTH: 登录已失效') } })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['staging'], wait: noWait })
    await expect(executor.transfer({ workflowRunId: 'run-1', directoryId: 'staging', candidate: candidate('aliyun', 'https://www.alipan.com/s/abc') })).rejects.toThrow('BOXPLAYER_DRIVE_AUTH')
  })

  it('only trashes files it can see in the target directory', async () => {
    const { client, calls } = fakeClient({ season: [{ id: 'e1', name: 'S01E01.mkv', isDirectory: false, size: GB }] })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['season'], wait: noWait })
    await expect(executor.deleteFiles({ directoryId: 'season', fileIds: ['elsewhere'] })).rejects.toThrow('SAFETY_VIOLATION')
    await expect(executor.deleteFiles({ directoryId: 'season', fileIds: ['e1'] })).resolves.toEqual({ deleted: ['e1'] })
    expect(calls).toEqual(['trash:e1'])
  })

  it('flattens wrapper folders and removes the ones left without a real video', async () => {
    const { client, calls } = fakeClient({
      movie: [{ id: 'wrap', name: 'Dune.Part.Two', isDirectory: true, size: 0 }],
      wrap: [{ id: 'v1', name: 'Dune.Part.Two.mkv', isDirectory: false, size: 20 * GB }, { id: 'nfo', name: 'movie.nfo', isDirectory: false, size: 10 }]
    })
    const executor = new BoxPlayerStorageExecutor({ client, writeScopeDirectoryIds: ['movie'], wait: noWait })
    const result = await executor.flattenDirectory('movie')
    expect(result.moved).toEqual(['v1'])
    expect(calls[0]).toBe('move:v1->movie')
  })
})
