import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FileBrowserCard from '@/features/files/electron/FileBrowserCard.vue'
import FileTypeIcon from '@/features/files/electron/FileTypeIcon.vue'

describe('file browser type icons', () => {
  it.each([
    ['一路向北.WMA', 'iconfile-audio'],
    ['movie.mkv', 'iconfile_video'],
    ['poster.jpg', 'iconfile-img'],
    ['guide.pdf', 'iconfile-pdf'],
    ['archive.7z', 'iconfile-7z'],
    ['unknown', 'iconwenjian'],
  ])('uses the file type for %s', (filename, icon) => {
    const component = mount(FileTypeIcon, { props: { filename, icon: 'iconwenjian', size: 28 } })
    expect(component.classes()).toContain(icon)
  })

  it('uses the original filename when a card has a scraped title', () => {
    const component = mount(FileBrowserCard, {
      props: { name: '一路向北', filename: '一路向北.wma', category: 'video', icon: 'iconfile_video', directory: false, mode: 'list' },
    })
    expect(component.find('.iconfile-audio').exists()).toBe(true)
  })
})
