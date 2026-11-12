import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSourceShare, supportsSourceShare } from '@/features/sources/share'
import { nativeCall } from '@/platform/native'
import { json, request } from '@/features/sources/transport'
import { providers, type Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn(), request: vi.fn() }))
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn() }))
const account = (providerId: Account['providerId']): Account => ({ id: `native-${providerId}-second-account`, providerId, userId: '123456', name: 'fixture', baseUrl: 'https://ignored.invalid', authOrigins: [] })
const url = 'https://share.example.test/s/fixture'
const mock = vi.mocked(json)
beforeEach(() => vi.resetAllMocks())
function bound(a: Account) {
  for (const args of [...mock.mock.calls, ...vi.mocked(request).mock.calls]) expect(args[0]).toBe(a)
}
describe('account-bound source sharing protocols', () => {
  it('supports exactly the nine Electron share providers without network or writes', async () => {
    const supported = ['aliyun', '123', 'pikpak', 'guangya', 'dropbox', 'onedrive', 'box', 'google', 'quark']
    for (const [provider] of providers) {
      const a = account(provider)
      expect(supportsSourceShare(a)).toBe(supported.includes(provider))
      if (!supported.includes(provider)) await expect(createSourceShare(a, 'file', 'title')).rejects.toThrow('不支持')
    }
    expect(json).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(nativeCall).not.toHaveBeenCalled()
  })
  it('Aliyun decodes the Tauri drive/file location and sends Electron defaults', async () => {
    const a = account('aliyun')
    mock.mockResolvedValue({ share_url: url, share_pwd: 'abcd' })
    expect(await createSourceShare(a, JSON.stringify({ driveId: 'drive2', fileId: 'file1' }), '电影')).toEqual({ url, password: 'abcd' })
    expect(json).toHaveBeenCalledWith(a, 'POST', 'https://api.aliyundrive.com/adrive/v2/share_link/create', { drive_id: 'drive2', file_id_list: ['file1'], expiration: '', share_pwd: '', share_name: '电影' })
    bound(a)
  })
  it.each(['raw-file', 'null', '{}', '{"driveId":"d","fileId":"root"}'])('rejects malformed Aliyun location %s before writes', async id => {
    await expect(createSourceShare(account('aliyun'), id, '')).rejects.toThrow()
    expect(json).not.toHaveBeenCalled()
  })
  it('123 uses the exact open-platform body/header and provider UID, not native account UUID', async () => {
    const a = account('123'); a.userId = 'cloud123_9876'
    vi.mocked(request).mockResolvedValue({ status: 200, headers: {}, finalUrl: '', body: Array.from(new TextEncoder().encode(JSON.stringify({ code: 0, data: { shareID: 4, shareKey: 'key' } }))) })
    expect(await createSourceShare(a, '9999999999999999', '')).toEqual({ url: 'https://9876.share.123pan.cn/123pan/key' })
    expect(request).toHaveBeenCalledWith(a, 'POST', 'https://open-api.123pan.com/api/v1/share/create', JSON.stringify({ shareName: '分享链接', shareExpire: 0, fileIDList: '9999999999999999' }), { 'Content-Type': 'application/json', Platform: 'open_platform' })
    bound(a)
  })
  it('123 refuses missing provider UID before creating a share', async () => {
    const a = account('123'); delete a.userId
    await expect(createSourceShare(a, '42', '')).rejects.toThrow('用户')
    expect(request).not.toHaveBeenCalled()
  })
  it('PikPak delegates captcha and share creation to native with only the selected account/file', async () => {
    const a = account('pikpak')
    vi.mocked(nativeCall).mockResolvedValue({ share_id: 's', share_link: url, passcode: 'abcd' })
    expect(await createSourceShare(a, 'opaque', '')).toEqual({ url, password: 'abcd' })
    expect(nativeCall).toHaveBeenCalledExactlyOnceWith('pikpak_create_share', { accountId: a.id, fileId: 'opaque' })
    expect(json).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
    expect(Object.keys(vi.mocked(nativeCall).mock.calls[0]![1]!)).toEqual(['accountId', 'fileId'])
  })
  it('Guangya uses share_file with auto-fill code and returns its actual password', async () => {
    const a = account('guangya')
    mock.mockResolvedValue({ code: 0, data: { shareId: 's', code: 'abcd' } })
    expect(await createSourceShare(a, 'opaque', '')).toEqual({ url: 'https://www.guangyapan.com/s/s', password: 'abcd' })
    expect(json).toHaveBeenCalledWith(a, 'POST', 'https://api.guangyapan.com/nd.bizuserres.s/v1/share_file', { fileIds: ['opaque'], title: '分享链接', validateDuration: 0, shareType: 1, code: '', autoFillCode: true, trafficLimit: '0', maxRestoreCount: 0, downloadType: 1 })
    bound(a)
  })
  it('Dropbox reuses existing links without a creation write', async () => {
    const a = account('dropbox'); mock.mockResolvedValue({ links: [{ url }] })
    expect(await createSourceShare(a, 'id:opaque', '')).toEqual({ url })
    expect(json).toHaveBeenCalledExactlyOnceWith(a, 'POST', 'https://api.dropboxapi.com/2/sharing/list_shared_links', { path: 'id:opaque', direct_only: true })
    bound(a)
  })
  it('Dropbox pages existing shares then creates only the requested item', async () => {
    const a = account('dropbox')
    mock.mockResolvedValueOnce({ links: [], has_more: true, cursor: 'opaque' }).mockResolvedValueOnce({ links: [], has_more: false }).mockResolvedValueOnce({ url })
    expect(await createSourceShare(a, 'id:one', '')).toEqual({ url })
    expect(mock.mock.calls[1]).toEqual([a, 'POST', 'https://api.dropboxapi.com/2/sharing/list_shared_links', { cursor: 'opaque' }])
    expect(mock.mock.calls[2]).toEqual([a, 'POST', 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', { path: 'id:one' }])
    bound(a)
  })
  it('Dropbox recovers an already-created race by reading again, without retrying the write', async () => {
    const a = account('dropbox')
    mock.mockResolvedValueOnce({ links: [] }).mockRejectedValueOnce(new Error('409')).mockResolvedValueOnce({ links: [{ url }] })
    expect(await createSourceShare(a, 'id:one', '')).toEqual({ url })
    expect(mock.mock.calls.filter(c => c[2].includes('create_shared'))).toHaveLength(1); bound(a)
  })
  it('OneDrive creates an anonymous view link and encodes opaque item ids', async () => {
    const a = account('onedrive'); mock.mockResolvedValue({ link: { webUrl: url } })
    expect(await createSourceShare(a, 'file/1', '')).toEqual({ url })
    expect(json).toHaveBeenCalledWith(a, 'POST', 'https://graph.microsoft.com/v1.0/me/drive/items/file%2F1/createLink', { type: 'view', scope: 'anonymous' }); bound(a)
  })
  it.each(['file', 'folder'])('Box determines the %s type before choosing the mutation endpoint', async type => {
    const a = account('box')
    if (type === 'folder') mock.mockRejectedValueOnce(new Error('404'))
    mock.mockResolvedValueOnce({ id: '42', type }).mockResolvedValueOnce({ shared_link: { url } })
    expect(await createSourceShare(a, '42', '')).toEqual({ url })
    expect(json).toHaveBeenLastCalledWith(a, 'PUT', `https://api.box.com/2.0/${type === 'folder' ? 'folders' : 'files'}/42?fields=shared_link,id,name,type`, { shared_link: { access: 'open', permissions: { can_download: true } } }); bound(a)
  })
  it.each([true, false])('Google reuses anyone permission if present (%s) then gets real webViewLink', async existing => {
    const a = account('google')
    mock.mockResolvedValueOnce({ permissions: existing ? [{ id: 'p', type: 'anyone' }] : [] })
    if (!existing) mock.mockResolvedValueOnce({ id: 'p' })
    mock.mockResolvedValueOnce({ webViewLink: url })
    expect(await createSourceShare(a, 'f/1', '')).toEqual({ url })
    expect(mock.mock.calls[0]?.[2]).toBe('https://www.googleapis.com/drive/v3/files/f%2F1/permissions?supportsAllDrives=true&fields=permissions(id,type,role,allowFileDiscovery)')
    if (!existing) expect(mock.mock.calls[1]).toEqual([a, 'POST', 'https://www.googleapis.com/drive/v3/files/f%2F1/permissions?supportsAllDrives=true', { type: 'anyone', role: 'reader' }])
    expect(mock.mock.calls.at(-1)?.[2]).toBe('https://www.googleapis.com/drive/v3/files/f%2F1?fields=id,name,webViewLink&supportsAllDrives=true'); bound(a)
  })
  it('Quark polls its task then requests password info instead of inventing a link', async () => {
    const a = account('quark')
    mock.mockResolvedValueOnce({ code: 0, data: { task_id: 'task1' } }).mockResolvedValueOnce({ code: 0, data: { status: 2, share_id: 'share1' } }).mockResolvedValueOnce({ code: 0, data: { pwd_id: 'public1', passcode: 'abcd' } })
    expect(await createSourceShare(a, 'fid1', '电影')).toEqual({ url: 'https://pan.quark.cn/s/public1', password: 'abcd' })
    const first = mock.mock.calls[0]!; const target = new URL(first[2])
    expect(target.origin + target.pathname).toBe('https://drive-pc.quark.cn/1/clouddrive/share')
    expect(Object.fromEntries(target.searchParams)).toEqual({ pr: 'ucpro', fr: 'pc', uc_param_str: '', __t: expect.any(String), __dt: '1000' })
    expect(first[3]).toEqual({ fid_list: ['fid1'], title: '电影', url_type: 1, expired_type: 1 })
    expect(new URL(mock.mock.calls[1]![2]).searchParams.get('task_id')).toBe('task1')
    expect(mock.mock.calls[2]?.[3]).toEqual({ share_id: 'share1' }); bound(a)
  })
  it('Quark stops on failed task without fetching password or resubmitting creation', async () => {
    mock.mockResolvedValueOnce({ data: { task_id: 'task' } }).mockResolvedValueOnce({ data: { status: 3 } })
    await expect(createSourceShare(account('quark'), 'f', '')).rejects.toThrow('任务失败')
    expect(json).toHaveBeenCalledTimes(2)
  })
  it.each(['aliyun', 'pikpak', 'guangya', 'onedrive', 'box', 'google', 'quark'] as const)('fails closed on %s business errors', async provider => {
    mock.mockResolvedValue({ code: 401, error: 'private server details' })
    vi.mocked(nativeCall).mockResolvedValue({ error: 'private server details' })
    await expect(createSourceShare(account(provider), provider === 'aliyun' ? '{"driveId":"d","fileId":"f"}' : 'f', '')).rejects.toThrow('创建分享链接失败')
  })
  it('rejects an unsafe returned link and does not leak provider error details', async () => {
    mock.mockResolvedValue({ link: { webUrl: 'javascript:alert(1)' } })
    await expect(createSourceShare(account('onedrive'), 'f', '')).rejects.toThrow('无效')
  })
  it('PikPak captcha-required fails without returning a fake share or retrying the write', async () => {
    const a = account('pikpak')
    vi.mocked(nativeCall).mockResolvedValue({ error: 'captcha_required', error_description: 'fixture challenge' })
    await expect(createSourceShare(a, 'f', '')).rejects.toThrow('创建分享链接失败')
    expect(nativeCall).toHaveBeenCalledExactlyOnceWith('pikpak_create_share', { accountId: a.id, fileId: 'f' })
    expect(json).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it('Quark consumes synchronous task responses without polling', async () => {
    const a = account('quark')
    mock.mockResolvedValueOnce({ data: { task_resp: { data: { share_id: 'sync' } } } })
      .mockResolvedValueOnce({ data: { share_url: url } })
    expect(await createSourceShare(a, 'f', '')).toEqual({ url })
    expect(json).toHaveBeenCalledTimes(2); bound(a)
  })
  it('Box refuses a mismatched read result before any sharing write', async () => {
    mock.mockResolvedValue({ id: 'other-file', type: 'file' })
    await expect(createSourceShare(account('box'), 'f', '')).rejects.toThrow('目标无效')
    expect(mock.mock.calls.every(c => c[1] === 'GET')).toBe(true)
  })
  it('123 business failure cannot generate a URL from a response shareKey', async () => {
    const a = account('123')
    vi.mocked(request).mockResolvedValue({ status: 200, headers: {}, finalUrl: '', body: Array.from(new TextEncoder().encode(JSON.stringify({ code: 401, data: { shareID: 1, shareKey: 'fake' } }))) })
    await expect(createSourceShare(a, '42', '')).rejects.toThrow('创建分享链接失败'); bound(a)
  })

  it.each(['javascript:alert(1)', 'https://user:password@example.test/s'])('PikPak validates native share URLs (%s)', async unsafe => {
    vi.mocked(nativeCall).mockResolvedValue({ share_id: 's', share_url: unsafe })
    await expect(createSourceShare(account('pikpak'), 'f', '')).rejects.toThrow('无效')
    expect(json).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it('PikPak preserves native rejection without attempting a renderer HTTP fallback', async () => {
    const failure = { code: 'PIKPAK_SHARE', message: 'fixture native failure', retryable: false }
    vi.mocked(nativeCall).mockRejectedValue(failure)
    await expect(createSourceShare(account('pikpak'), 'f', '')).rejects.toBe(failure)
    expect(nativeCall).toHaveBeenCalledTimes(1)
    expect(json).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })

})
