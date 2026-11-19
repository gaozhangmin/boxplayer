import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import FilesFolderToolbar from '@/features/files/electron/FilesFolderToolbar.vue'

it('offers favorite management only on the bookmarked directory', async () => {
 const wrapper = mount(FilesFolderToolbar, {
  attachTo: document.body,
  props: { mode: 'list', descending: false, selection: false }
 })
 try {
  await wrapper.get('.more-button').trigger('click')
  await flushPromises()
  expect(document.body.textContent).toContain('循环播放')
  expect(document.body.textContent).not.toContain('从收藏夹中移除')
  expect(document.body.textContent).not.toContain('重命名收藏夹')
  await wrapper.setProps({ manageFavorite: true })
  expect(document.body.textContent).toContain('从收藏夹中移除')
  expect(document.body.textContent).toContain('重命名收藏夹')
 } finally { wrapper.unmount() }
})
