import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
import { nativeCall } from '@/platform/native'
beforeEach(()=>{vi.resetModules();vi.resetAllMocks()})
it('serializes native calls, caches results and skips obsolete queued generations',async()=>{
 const {localThumbnail}=await import('@/features/files/thumbnails')
 let resolve!:(value:string)=>void;let active=true
 vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise<string>(done=>{resolve=done}) as never).mockResolvedValue('data:image/png;base64,c2Vjb25k')
 const first=localThumbnail('source','first',()=>true),obsolete=localThumbnail('source','old',()=>active),second=localThumbnail('source','second',()=>true)
 await Promise.resolve();expect(nativeCall).toHaveBeenCalledTimes(1);active=false;resolve('data:image/png;base64,Zmlyc3Q=')
 expect(await first).toContain('Zmlyc3Q=');expect(await obsolete).toBeNull();expect(await second).toContain('c2Vjb25k');expect(nativeCall).toHaveBeenCalledTimes(2)
 expect(await localThumbnail('source','first',()=>true)).toContain('Zmlyc3Q=');expect(nativeCall).toHaveBeenCalledTimes(2)
 expect(nativeCall).toHaveBeenLastCalledWith('local_thumbnail',{sourceId:'source',relativePath:'second'})
})
it('keeps one native slot occupied until completion even when the current row disappears',async()=>{
 const {localThumbnail}=await import('@/features/files/thumbnails');let finish!:()=>void,active=true
 vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise<null>(done=>{finish=()=>done(null)}) as never).mockResolvedValue(null)
 const old=localThumbnail('source','old',()=>active);await Promise.resolve();active=false;const next=localThumbnail('source','next',()=>true);await Promise.resolve();expect(nativeCall).toHaveBeenCalledTimes(1);finish();await old;await next;expect(nativeCall).toHaveBeenCalledTimes(2)
})
it('releases the queue after errors and accepts only bounded native image data',async()=>{
 const {localThumbnail}=await import('@/features/files/thumbnails');vi.mocked(nativeCall).mockRejectedValueOnce(new Error('THUMBNAIL_BUSY')).mockResolvedValueOnce('https://provider.example/image?token=private').mockResolvedValueOnce('data:image/png;base64,b2s=')
 expect(await localThumbnail('source','busy',()=>true)).toBeNull();expect(await localThumbnail('source','unexpected-url',()=>true)).toBeNull();expect(await localThumbnail('source','valid',()=>true)).toBe('data:image/png;base64,b2s=')
})
it('uses the same native slot for local and remote extraction',async()=>{
 const {localThumbnail,remoteThumbnail}=await import('@/features/files/thumbnails');let release!:(value:string)=>void
 vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise<string>(done=>{release=done}) as never).mockResolvedValue('data:image/png;base64,cmVtb3Rl')
 const local=localThumbnail('local','movie',()=>true),remote=remoteThumbnail('account','file',()=>true);await Promise.resolve();expect(nativeCall).toHaveBeenCalledTimes(1);release('data:image/png;base64,bG9jYWw=');await local;await remote;expect(nativeCall).toHaveBeenLastCalledWith('source_thumbnail',{sourceId:'account',fileId:'file',local:false})
})
