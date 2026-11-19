import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import SourceManager from '@/features/sources/SourceManager.vue'
import SavedSourceEditor from '@/features/sources/SavedSourceEditor.vue'
import SourceFormPresentation, { sourceProviderOptions } from '@/features/sources/SourceFormPresentation.vue'
import type { Account } from '@/features/sources/contracts'
import { nativeCall } from '@/platform/native'
import { setLocale } from '@/features/files/electron/i18n'
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn(), isNative: () => false, asAppError: (cause: unknown) => ({ message: String(cause) }) }))
const google: Account = { id: 'fixture-google', providerId: 'google', name: 'Fixture Drive', baseUrl: 'https://www.googleapis.com', authOrigins: ['https://www.googleapis.com'] }
const wrappers: ReturnType<typeof mount>[] = []
function editor(account = google) {
  const wrapper = mount(SavedSourceEditor, { props: { account }, attachTo: document.body, global: { plugins: [createPinia()] } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  setLocale('zh-CN')
  vi.mocked(nativeCall).mockImplementation(async command => command.endsWith('_connection_info') ? { username: 'fixture-user', password: 'must-not-render', rootPath: '/media' } : true as never)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = '' })
it('renders Google add and edit through the same form, name/protocol rows and compact footer', async () => {
  const add = mount(SourceManager, { attachTo: document.body, global: { plugins: [createPinia()] } }); wrappers.push(add)
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.findAll('button').find(button => button.text() === 'Google Drive')!.trigger('click')
  const addForm = add.getComponent(SourceFormPresentation)
  expect(addForm.get('.protocol-name').text()).toBe('Google Drive')
  expect(addForm.findAll('label').map(label => label.text())).toEqual(['名称', '通讯协议Google Drive'])
  expect(addForm.get('footer.source-buttons button[type=submit]').text()).toBe('连接')
  const edit = editor(); await flushPromises()
  const editForm = edit.getComponent(SourceFormPresentation)
  expect(editForm.findAll('label').map(label => label.text())).toEqual(addForm.findAll('label').map(label => label.text()))
  expect(editForm.findAll('input')).toHaveLength(1)
  expect(editForm.text()).not.toMatch(/googleapis|must-not-render/)
  expect(editForm.get('footer.source-buttons button[type=submit]').text()).toBe('保存')
  expect(nativeCall).not.toHaveBeenCalled()
  await editForm.get('input').setValue('Renamed fixture')
  await editForm.get('form').trigger('submit'); await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith('account_update_metadata', { accountId: google.id, name: 'Renamed fixture', baseUrl: google.baseUrl })
  expect(edit.emitted('saved')).toEqual([[]])
})
it.each(sourceProviderOptions.filter(([id]) => !['smb', 'nfs', 'ftp', 'webdav', 'jellyfin', 'emby', 'plex'].includes(id)))('displays %s consistently with the add catalog', async (providerId, label) => {
  const view = editor({ ...google, providerId }); await flushPromises()
  expect(view.get('.protocol-name').text()).toBe(label)
  expect(view.findAll('input')).toHaveLength(1)
  expect(nativeCall).not.toHaveBeenCalled()
})
it('shows the Aliyun web account with the same display name as Aliyun add', async () => {
  const view = editor({ ...google, providerId: 'aliyun' }); await flushPromises()
  expect(view.get('.protocol-name').text()).toBe('阿里云盘')
})
it.each(['webdav', 'smb', 'nfs', 'ftp', 'emby', 'jellyfin', 'plex'] as const)('preserves %s save identity and keeps stored credentials out of the form', async providerId => {
  const view = editor({ ...google, providerId }); await flushPromises()
  expect(view.get<HTMLInputElement>('input[type=password]').element.value).toBe('')
  expect(view.html()).not.toContain('must-not-render')
  const input = view.get<HTMLInputElement>('input[autocomplete=username]')
  expect(input.element.disabled).toBe(providerId === 'nfs')
  expect(view.findAll('.source-buttons button')).toHaveLength(['emby', 'jellyfin', 'plex'].includes(providerId) ? 3 : 1)
  await view.get('form').trigger('submit'); await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith(['emby', 'jellyfin', 'plex'].includes(providerId) ? 'server_update_connection' : providerId === 'webdav' ? 'webdav_update_connection' : 'network_share_update_connection', expect.objectContaining({ accountId: google.id, password: null, username: 'fixture-user' }))
  expect(view.emitted('saved')).toEqual([[]])
})
it('keeps a failed save visible and preserves remove confirmation and cancellation', async () => {
  const view = editor(); await flushPromises()
  vi.mocked(nativeCall).mockRejectedValueOnce(new Error('fixture save failed'))
  await view.get('form').trigger('submit'); await flushPromises()
  expect(view.get('[role=alert]').text()).toContain('fixture save failed')
  expect(view.emitted('saved')).toBeUndefined()
  await view.get('.remove-share').trigger('click'); await flushPromises()
  const body = new DOMWrapper(document.body)
  expect(nativeCall).not.toHaveBeenCalledWith('account_remove', expect.anything())
  await body.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises()
  expect(nativeCall).not.toHaveBeenCalledWith('account_remove', expect.anything())
  await view.get('.remove-share').trigger('click'); await flushPromises()
  await body.findAll('button').find(button => button.text() === '确认')!.trigger('click'); await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith('account_remove', { accountId: google.id })
  expect(view.emitted('removed')).toEqual([[]])
})
