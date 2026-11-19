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

it('uses one toolbar button for name and direction and omits sorting from More', async () => {
 const wrapper = mount(FilesFolderToolbar, {
  attachTo: document.body,
  props: { mode: 'grid', descending: false, selection: false }
 })
 try {
  const sort = wrapper.get('.files-name-sort')
  expect(sort.attributes('aria-label')).toMatch(/名称.*升序/)
  await sort.trigger('click')
  expect(wrapper.emitted('direction')).toHaveLength(1)
  await wrapper.setProps({ descending: true })
  expect(sort.attributes('aria-label')).toMatch(/名称.*降序/)
  await wrapper.get('.more-button').trigger('click')
  await flushPromises()
  expect(document.body.querySelector('.arco-dropdown')?.textContent).not.toContain('排序')
 } finally { wrapper.unmount() }
})
