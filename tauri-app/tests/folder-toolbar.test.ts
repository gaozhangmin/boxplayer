import { mount, flushPromises,DOMWrapper } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
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

it('moves sorting into More and preserves field selection and repeated-field direction', async () => {
 const wrapper = mount(FilesFolderToolbar, {
  attachTo: document.body,
  props: { mode: 'grid', descending: false, selection: false }
 })
 try {
  expect(wrapper.find('.files-name-sort').exists()).toBe(false)
  expect(wrapper.findAll('.electron-files-toolbar > button')).toHaveLength(2)
  const menu = new DOMWrapper(document.body)
  async function openSort() {
   await wrapper.get('.more-button').trigger('click'); await flushPromises()
   const sorting = menu.findAll('.arco-dropdown-option').find(option => option.text().includes('排序'))!
   expect(sorting.text()).toContain('名称')
   await sorting.trigger('mouseenter'); await flushPromises()
   await vi.waitFor(() => expect(menu.find('[data-file-sort="name"]').exists()).toBe(true))
  }
  await openSort()
  expect(['name','modified','added','watched','size'].every(value=>menu.find(`[data-file-sort="${value}"]`).exists())).toBe(true)
  await menu.get('[data-file-sort="name"]').trigger('click')
  expect(wrapper.emitted('direction')).toHaveLength(1)
  await wrapper.setProps({ descending: true })
  await openSort()
  await menu.get('[data-file-sort="modified"]').trigger('click')
  expect(wrapper.emitted('sort')).toEqual([['modified']])
 } finally { wrapper.unmount() }
})
