import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import ServerManager from '@/features/sources/ServerManager.vue'
import { deleteServerMedia, deleteServerPlaylist, listServerPlaylists } from '@/features/sources/playlists'
vi.mock('@/features/sources/playlists', () => ({ listServerPlaylists: vi.fn(), serverPlaylistMembership: vi.fn(async () => false), setServerPlaylistMembership: vi.fn(async () => {}), createServerPlaylist: vi.fn(async () => {}), deleteServerMedia: vi.fn(async () => {}), deleteServerPlaylist: vi.fn(async () => {}) }))
const account = { id: 'server-a', providerId: 'jellyfin' as const, userId: 'user', name: '客厅 Jellyfin', baseUrl: 'https://server.test', authOrigins: ['https://server.test'] }
const entry = { id: 'film-a', name: 'Film A', isDirectory: false, playable: true, size: 0 }
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => { vi.clearAllMocks();vi.mocked(listServerPlaylists).mockResolvedValue([{ id: 'list-a', title: 'Films', count: 2 }]) })
afterEach(() => { wrapper?.unmount();document.body.innerHTML = '' })
it('opening management and cancelling deletion never submits a delete', async () => {
  wrapper = mount(ServerManager, { props: { account, entry }, attachTo: document.body });await flushPromises();const view = new DOMWrapper(document.body)
  expect(deleteServerMedia).not.toHaveBeenCalled();expect(deleteServerPlaylist).not.toHaveBeenCalled()
  await view.findAll('button').find(button => button.text() === '删除服务器媒体…')!.trigger('click')
  expect(view.text()).toContain('客厅 Jellyfin');expect(view.text()).toContain('Film A');expect(deleteServerMedia).not.toHaveBeenCalled()
  await view.findAll('button').find(button => button.text() === '取消删除')!.trigger('click');expect(deleteServerMedia).not.toHaveBeenCalled()
})
it('confirmed deletion preserves target identity and reports server errors without closing', async () => {
  vi.mocked(deleteServerMedia).mockRejectedValueOnce(new Error('来源请求失败（403）'))
  wrapper = mount(ServerManager, { props: { account, entry }, attachTo: document.body });await flushPromises();const view = new DOMWrapper(document.body)
  await view.findAll('button').find(button => button.text() === '删除服务器媒体…')!.trigger('click');await view.findAll('button').find(button => button.text() === '确认删除')!.trigger('click');await flushPromises()
  expect(deleteServerMedia).toHaveBeenCalledWith(account, entry);expect(view.get('[role="alert"]').text()).toContain('403');expect(wrapper.emitted('close')).toBeUndefined()
})

it('keeps file testing and closing available while readonly playlist discovery is pending',async()=>{
 vi.mocked(listServerPlaylists).mockReturnValueOnce(new Promise(()=>{}));wrapper=mount(ServerManager,{props:{account:{...account,providerId:'plex'},entry},attachTo:document.body});await flushPromises();const view=new DOMWrapper(document.body);const button=view.findAll('button').find(button=>button.text()==='文件码率测试')!;expect(button.attributes('disabled')).toBeUndefined();await button.trigger('click');expect(view.text()).toContain('开始测试');await view.get('button[aria-label="关闭服务器管理"]').trigger('click');expect(wrapper.emitted('close')).toHaveLength(1);
})
