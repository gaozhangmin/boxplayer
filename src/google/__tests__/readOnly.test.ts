import { afterEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_DRIVE_READ_ONLY_MESSAGE, GOOGLE_DRIVE_RECONNECT_MESSAGE, GOOGLE_DRIVE_SCOPE } from '../accessPolicy'
import { googleDriveRequest } from '../dirfilelist'
import googleCapabilities from '../capabilities'
import GoogleUploadDisk, { apiGoogleUploadBuffer } from '../upload'
import { apiGoogleMkdir, apiGoogleTrashBatch } from '../filecmd'
import { apiGoogleShareCreate } from '../share'
import type { IUploadingUI } from '../../utils/dbupload'

const { ensureReady, messageError } = vi.hoisted(() => ({ ensureReady: vi.fn(), messageError: vi.fn() }))
vi.mock('../../user/userdal', () => ({ default: { EnsureUserTokenReady: ensureReady } }))
vi.mock('../../utils/message', () => ({ default: { error: messageError } }))

afterEach(() => {
  vi.unstubAllGlobals()
  ensureReady.mockReset()
  messageError.mockReset()
})

describe('Google Drive read-only operations', () => {
  const verifiedToken = { tokenfrom: 'google', user_id: 'google_test', access_token: 'read-token', google_drive_scope: GOOGLE_DRIVE_SCOPE }

  it('does not advertise write actions', () => {
    const operations = googleCapabilities.operations
    for (const operation of ['files.list', 'files.search', 'files.download', 'trash.list'] as const) expect(operations[operation]).toBe(true)
    for (const operation of ['files.createFolder', 'files.rename', 'files.copy', 'files.move', 'upload.local', 'upload.memory', 'share.create', 'share.cancel', 'trash.move', 'trash.restore', 'trash.delete', 'trash.empty'] as const) expect(operations[operation]).toBe(false)
  })

  it.each([['/files', 'POST'], ['/files/item', 'PATCH'], ['/files/item', 'DELETE'], ['/files/item/permissions', 'POST'], ['https://example.test/files', 'GET'], ['/../../outside', 'GET']])(
    'blocks %s (%s) before reading credentials', async (path, method) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(googleDriveRequest('google_test', path, { method }, 'failed', false, true)).rejects.toThrow(GOOGLE_DRIVE_READ_ONLY_MESSAGE)
      expect(ensureReady).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('does not allow legacy, unknown, or cross-account credentials for reads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const legacy = { ...verifiedToken, google_drive_scope: undefined }
    ensureReady.mockResolvedValue(legacy)
    await expect(googleDriveRequest('google_test', '/files', { method: 'GET' }, 'failed', false, true)).rejects.toThrow(GOOGLE_DRIVE_RECONNECT_MESSAGE)
    ensureReady.mockResolvedValue({ ...verifiedToken, user_id: 'google_other' })
    await expect(googleDriveRequest('google_test', '/files', { method: 'GET' }, 'failed', false, true)).rejects.toThrow(GOOGLE_DRIVE_RECONNECT_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends ordinary list reads and read-only download initiation with the verified token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    ensureReady.mockResolvedValue(verifiedToken)
    await expect(googleDriveRequest('google_test', '/files?q=folder', { method: 'GET' }, 'failed')).resolves.toEqual({})
    await expect(googleDriveRequest('google_test', '/files/test/download?mimeType=video/mp4', { method: 'POST' }, 'failed')).resolves.toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer read-token')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
  })

  it('rejects direct mutation callers and old upload queue entries without network calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiGoogleMkdir('google_test', 'root', 'new')).resolves.toEqual({ file_id: '', error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })
    await expect(apiGoogleTrashBatch('google_test', ['item'])).resolves.toEqual(['item'])
    await expect(apiGoogleShareCreate('google_test', 'google', ['item'], '', '', '')).resolves.toEqual({ error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })
    await expect(apiGoogleUploadBuffer('google_test', 'root', 'name', Buffer.alloc(0))).resolves.toMatchObject({ error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })
    await expect(GoogleUploadDisk.UploadOneFile({} as IUploadingUI)).resolves.toBe(GOOGLE_DRIVE_READ_ONLY_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ensureReady).not.toHaveBeenCalled()
  })
})
