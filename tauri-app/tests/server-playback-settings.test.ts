import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Settings from '@/features/sources/ServerPlaybackSettings.vue'
import { nativeCall } from '@/platform/native'
const state = vi.hoisted(() => ({ value: { serverPlayback: { quality: 'max', compatibility: 'auto', customProfile: { Action: 'add', DirectPlayProfiles: [], TranscodingProfiles: [] } } }, ready: true, saving: false, preview: false, initialize: vi.fn(async () => {}), save: vi.fn(async () => {}) }))
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => state }))
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn() }))
const account = { id: 'server-a', providerId: 'jellyfin' as const, name: 'Server', baseUrl: 'https://server.test', authOrigins: ['https://server.test'] }
beforeEach(() => {vi.clearAllMocks();state.value.serverPlayback={quality:'max',compatibility:'auto',customProfile:{Action:'add',DirectPlayProfiles:[],TranscodingProfiles:[]}}})
it('validates JSON before saving and persists a global custom profile without credentials', async () => {
  const wrapper = mount(Settings, { props: { account } });await flushPromises()
  await wrapper.findAll('select')[0]!.setValue('20000000');await wrapper.findAll('select')[1]!.setValue('custom')
  await wrapper.get('textarea').setValue('not json');await wrapper.get('form').trigger('submit');await flushPromises();expect(state.save).not.toHaveBeenCalled();expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  await wrapper.get('textarea').setValue(JSON.stringify({ Action: 'replace', DirectPlayProfiles: [{ Type: 'Video', Container: 'mp4', VideoCodec: 'h264' }], TranscodingProfiles: [] }));await wrapper.get('form').trigger('submit');await flushPromises()
  expect(state.save).toHaveBeenCalledWith({ serverPlayback: { quality: '20000000', compatibility: 'custom', customProfile: expect.objectContaining({ Action: 'replace', DirectPlayProfiles: [expect.objectContaining({ VideoCodec: 'h264' })] }) } })
  expect(wrapper.text()).toContain('下次播放生效');wrapper.unmount()
})
it('tests only the selected server and cancels the exact native request on unmount', async () => {
  vi.mocked(nativeCall).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(true)
  const wrapper = mount(Settings, { props: { account } });await flushPromises();await wrapper.findAll('button').find(button => button.text() === '码率测试（5 MB）')!.trigger('click');await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith('server_bitrate_test', expect.objectContaining({ accountId: account.id, requestId: expect.any(String) }))
  const id = vi.mocked(nativeCall).mock.calls[0]![1] as { requestId: string }
  wrapper.unmount();await flushPromises();expect(nativeCall).toHaveBeenCalledWith('auth_cancel', { requestId: id.requestId })
})

it('does not overwrite a profile changed in another window while the draft was open',async()=>{
 const wrapper=mount(Settings,{props:{account}});await flushPromises();state.value.serverPlayback.quality='80000000';await wrapper.get('form').trigger('submit');await flushPromises();expect(state.save).not.toHaveBeenCalled();expect(wrapper.get('[role="alert"]').text()).toContain('其他窗口');wrapper.unmount();
})
