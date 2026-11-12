import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileArtwork from '@/features/files/FileArtwork.vue'
import { nativeCall } from '@/platform/native'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
beforeEach(()=>vi.resetAllMocks())
it('prefers scraped posters and falls back to an account-bound thumbnail then icon',async()=>{
 vi.mocked(nativeCall).mockResolvedValue('data:image/png;base64,dGh1bWI=')
 const wrapper=mount(FileArtwork,{props:{poster:'https://images.example/poster.jpg',sourceId:'source',fileId:'video',local:true,playable:true,preview:true}})
 expect(wrapper.get('img').attributes('src')).toBe('https://images.example/poster.jpg');expect(nativeCall).not.toHaveBeenCalled()
 await wrapper.get('img').trigger('error');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('local_thumbnail',{sourceId:'source',relativePath:'video'});expect(wrapper.get('img').attributes('src')).toContain('data:image')
 await wrapper.get('img').trigger('error');expect(wrapper.find('img').exists()).toBe(false);expect(wrapper.find('svg').exists()).toBe(true)
})
it('ignores stale thumbnail results after the file identity changes',async()=>{
 let resolve!:(value:string)=>void
 vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise<string>(done=>{resolve=done}) as never).mockResolvedValueOnce('data:image/png;base64,bmV3')
 const wrapper=mount(FileArtwork,{props:{sourceId:'source',fileId:'old',playable:true,preview:true}})
 await wrapper.setProps({fileId:'new'});await flushPromises();resolve('data:image/png;base64,b2xk');await flushPromises();expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,bmV3')
})
it('does not request previews for folders or when remote previews are disabled',async()=>{
 const wrapper=mount(FileArtwork,{props:{sourceId:'source',fileId:'folder',directory:true}});await flushPromises();expect(nativeCall).not.toHaveBeenCalled();expect(wrapper.find('svg').exists()).toBe(true)
})
