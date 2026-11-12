import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { isCoverDataUri, isPublicCover } from '@/features/files/coverImages'
import ServerArtwork from '@/features/servers/ServerArtwork.vue'
import { serverArtwork } from '@/features/sources/serverMetadata'
vi.mock('@/features/sources/serverMetadata',()=>({serverArtwork:vi.fn()}))
it('accepts bounded native raster data and CSP-allowed URLs while rejecting active or blocked formats',()=>{
 for(const mime of ['png','jpeg','webp'])expect(isCoverDataUri(`data:image/${mime};base64,dGVzdA==`)).toBe(true)
 for(const value of ['data:image/svg+xml;base64,dGVzdA==','data:text/html;base64,dGVzdA==','data:image/png;base64,invalid!','https://images.example/cover.jpg','http://api.xbyvideohub.com/a'])expect(isPublicCover(value)).toBe(false)
 expect(isPublicCover('https://api.xbyvideohub.com/a')).toBe(true);expect(isCoverDataUri('data:image/png;base64,'+'A'.repeat(12*1024*1024))).toBe(false)
})
it('renders server data URI artwork directly without requesting the server',async()=>{
 const image='data:image/png;base64,dGVzdA==';const wrapper=mount(ServerArtwork,{props:{account:{id:'server',providerId:'jellyfin',name:'Server',baseUrl:'https://server.example',authOrigins:[]},path:image}});await flushPromises();expect(wrapper.get('img').attributes('src')).toBe(image);expect(serverArtwork).not.toHaveBeenCalled()
})
