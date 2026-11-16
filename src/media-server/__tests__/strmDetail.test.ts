import { afterEach, expect, it, vi } from 'vitest'
import { getMediaServerItemDetail } from '../contentGateway'
import { embyAdapter } from '../adapters/emby'
import { jellyfinAdapter } from '../adapters/jellyfin'
import { MediaServerAuthenticationError, isMediaServerAuthenticationRejected } from '../adapters/base'
const config = { id:'strm', type:'emby' as const, name:'Server', baseUrl:'https://server.test', userId:'user', accessToken:'test', createdAt:0, updatedAt:0 }
afterEach(()=>vi.unstubAllGlobals())
it('only marks explicit sign-in authentication rejections as failed',()=>{
 expect(isMediaServerAuthenticationRejected(new MediaServerAuthenticationError(401,'rejected'))).toBe(true)
 expect(isMediaServerAuthenticationRejected(new MediaServerAuthenticationError(403,'rejected'))).toBe(true)
 expect(isMediaServerAuthenticationRejected(new MediaServerAuthenticationError(503,'unavailable'))).toBe(false)
 expect(isMediaServerAuthenticationRejected(new TypeError('offline'))).toBe(false)
 expect(isMediaServerAuthenticationRejected(new DOMException('cancelled','AbortError'))).toBe(false)
})
it('falls back to item Path for a STRM without source Path',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({Id:'1',Type:'Movie',Name:'Film',Path:'/library/Film.strm',MediaSources:[{Id:'source'}]}))))
 const detail=await getMediaServerItemDetail(config,'1')
 expect(detail.filePath).toBe('/library/Film.strm')
 expect(detail.sourceOptions[0].filePath).toBe('/library/Film.strm')
})
it('does not attach item path to a different version or series directory',async()=>{
 for(const row of [{Type:'Movie',MediaSources:[{Id:'a',Path:'/a.mkv'},{Id:'b'}]},{Type:'Series',MediaSources:[]}]){
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({Id:'1',Name:'Film',Path:'/library/Film.strm',...row}))))
 const detail=await getMediaServerItemDetail(config,'1')
 if(row.Type==='Series')expect(detail.filePath).toBeUndefined()
 else {expect(detail.sourceOptions[0].filePath).toBe('/a.mkv');expect(detail.sourceOptions[1].filePath).toBeUndefined()}
 }
})
it('keeps transport failures distinct from authentication rejection',async()=>{
 for(const adapter of [embyAdapter,jellyfinAdapter]){
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:401})))
 await expect(adapter.signIn({name:'Server',type:adapter.type,baseUrl:config.baseUrl,username:'user',password:'pass'})).rejects.toBeInstanceOf(MediaServerAuthenticationError)
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')))
 await expect(adapter.signIn({name:'Server',type:adapter.type,baseUrl:config.baseUrl})).rejects.toBeInstanceOf(TypeError)
 }
})
