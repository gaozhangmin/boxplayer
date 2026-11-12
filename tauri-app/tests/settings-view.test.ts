import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from '@/entries/settings/App.vue'
import { defaultSettings } from '@/platform/contracts'
import * as native from '@/platform/native'
vi.mock('@/platform/native', async importOriginal => {
  const actual = await importOriginal<typeof import('@/platform/native')>()
  return { ...actual, isNative: vi.fn(() => true), runtimeInfo: vi.fn(), nativeCall:vi.fn(), inspectMigration:vi.fn(), importMigration:vi.fn(), exportMigration:vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn(), onSettingsChanged: vi.fn(async () => () => {}) }
})
vi.mock('vue-sonner', () => ({ Toaster: { template: '<div />' }, toast: { success: vi.fn(), error: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(native.isNative).mockReturnValue(true)
  vi.mocked(native.getSettings).mockResolvedValue(defaultSettings())
  vi.mocked(native.runtimeInfo).mockResolvedValue({ schemaVersion: 1, platform: 'macos', dataDirectory: '/dev-only', version: '0.1.0', pendingOpen: [] })
})
async function render() {
  const pinia = createPinia()
  const wrapper = mount(App, { global: { plugins: [pinia] } })
  const { useSettingsStore } = await import('@/stores/settings')
  await useSettingsStore(pinia).initialize()
  await flushPromises()
  return wrapper
}
describe('settings view', () => {
  it('persists the selected theme through the Rust boundary', async () => {
    vi.mocked(native.updateSettings).mockResolvedValue({ ...defaultSettings(), revision: 1, theme: 'dark' })
    const wrapper = await render()
    await wrapper.get('[data-testid="theme-dark"]').trigger('click')
    await flushPromises()
    expect(native.updateSettings).toHaveBeenCalledWith(0, { theme: 'dark' })
    expect(wrapper.get('[data-testid="theme-dark"]').attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })
  it('disables editable settings in browser preview and states the limit', async () => {
    vi.mocked(native.isNative).mockReturnValue(false)
    const wrapper = await render()
    expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
    expect(wrapper.text()).toContain('浏览器预览')
    expect(native.getSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('inspects a migration manifest without importing, and shows import counts separately',async()=>{
 vi.mocked(native.inspectMigration).mockResolvedValue({schemaVersion:2,sourceVersion:'5.0.40',tables:{media:3,positions:2},sha256:'synthetic'})
 vi.mocked(native.importMigration).mockResolvedValue({applied:true,sourceCount:1,positionCount:2,mediaCount:3,preferences:{}})
 const wrapper=await render();await wrapper.findAll('button').find(row=>row.text()==='数据迁移')!.trigger('click');await wrapper.findAll('button').find(row=>row.text()==='检查迁移文件')!.trigger('click');await flushPromises();expect(wrapper.text()).toContain('media: 3');expect(native.importMigration).not.toHaveBeenCalled();await wrapper.findAll('button').find(row=>row.text()==='导入迁移数据')!.trigger('click');await flushPromises();expect(wrapper.text()).toContain('3 个视频');wrapper.unmount()
})

it('saves custom proxy settings and tests the draft without changing saved settings',async()=>{
 const wrapper=await render();await wrapper.findAll('button').find(row=>row.text()==='网络与代理')!.trigger('click')
 expect((wrapper.get('[data-testid="proxy-mode"]').element as HTMLSelectElement).value).toBe('system')
 await wrapper.get('[data-testid="proxy-mode"]').setValue('custom');await wrapper.get('[data-testid="proxy-url"]').setValue('socks5h://127.0.0.1:7890')
 vi.mocked(native.nativeCall).mockResolvedValue({milliseconds:85});await wrapper.get('[data-testid="proxy-test"]').trigger('click');await flushPromises()
 expect(native.nativeCall).toHaveBeenCalledWith('network_proxy_test',{proxy:{mode:'custom',url:'socks5h://127.0.0.1:7890'}});expect(native.updateSettings).not.toHaveBeenCalled();expect(wrapper.text()).toContain('Dropbox 连接正常')
 vi.mocked(native.updateSettings).mockResolvedValue({...defaultSettings(),revision:1,proxy:{mode:'custom',url:'socks5h://127.0.0.1:7890'}})
 await wrapper.get('form').trigger('submit');await flushPromises();expect(native.updateSettings).toHaveBeenCalledWith(0,{proxy:{mode:'custom',url:'socks5h://127.0.0.1:7890'}});wrapper.unmount()
})
it('rejects a proxy URL containing credentials before saving or testing',async()=>{
 const wrapper=await render();await wrapper.findAll('button').find(row=>row.text()==='网络与代理')!.trigger('click');await wrapper.get('[data-testid="proxy-mode"]').setValue('custom');await wrapper.get('[data-testid="proxy-url"]').setValue('http://user:secret@localhost:7890');await wrapper.get('form').trigger('submit');await wrapper.get('[data-testid="proxy-test"]').trigger('click');await flushPromises();expect(native.updateSettings).not.toHaveBeenCalled();expect(native.nativeCall).not.toHaveBeenCalled();wrapper.unmount()
})
