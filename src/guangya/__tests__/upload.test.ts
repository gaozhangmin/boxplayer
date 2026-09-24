import { afterEach, describe, expect, it, vi } from 'vitest'

const { guangyaRequest } = vi.hoisted(() => ({ guangyaRequest: vi.fn() }))

vi.mock('../dirfilelist', () => ({
  guangyaApiParentId: (value: string) => value,
  guangyaRequest
}))

import { apiGuangyaUploadBuffer, apiGuangyaUploadInfo } from '../upload'

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('Guangya OSS upload', () => {
  it('keeps polling when the upload task is still processing', async () => {
    guangyaRequest.mockResolvedValueOnce({ data: { status: 'processing' } })

    await expect(apiGuangyaUploadInfo('user', 'task-1')).resolves.toMatchObject({ fileId: '', uploading: true, error: '' })
  })

  it('uploads with the temporary OSS credentials returned for capacity 2', async () => {
    guangyaRequest
      .mockResolvedValueOnce({ data: { taskId: 'task-1', fullEndPoint: 'https://bucket.oss.example.com', bucketName: 'bucket', objectPath: 'folder/file.txt', creds: { accessKeyID: 'key', secretAccessKey: 'secret', sessionToken: 'session-token' } } })
      .mockResolvedValueOnce({ data: { message: '文件上传中' } })
      .mockResolvedValueOnce({ data: { fileId: 'file-1' } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGuangyaUploadBuffer('user', 'root', 'file.txt', Buffer.from('hello'))).resolves.toEqual({ file_id: 'file-1', error: '' })

    expect(guangyaRequest).toHaveBeenNthCalledWith(1, 'user', '/nd.bizuserres.s/v1/get_res_center_token', {
      capacity: 2,
      name: 'file.txt',
      parentId: 'root',
      res: { fileSize: 5, md5: 'XUFAKrxLKna5cZ2REBfFkg==' }
    })

    expect(fetchMock).toHaveBeenCalledWith('https://bucket.oss.example.com/folder/file.txt', expect.objectContaining({ method: 'PUT', body: Buffer.from('hello') }))
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['x-oss-date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(headers.Authorization).toMatch(/^OSS key:/)
    expect(headers['Content-MD5']).toBe('XUFAKrxLKna5cZ2REBfFkg==')
    expect(headers['x-oss-security-token']).toBe('session-token')
  })
})
