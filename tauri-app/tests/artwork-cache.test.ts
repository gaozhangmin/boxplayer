import {expect,it,vi} from 'vitest'
vi.mock('@/platform/native',()=>({isNative:()=>true}))
import {cachedArtwork} from '@/features/library/artworkCache'
it('rewrites public TMDB artwork but keeps account-bearing URLs out of the public cache',()=>{const url='https://api.xbyvideohub.com/api/tmdb/image/w500/a.jpg';expect(cachedArtwork(url)).toBe('mscache://localhost/image?url='+encodeURIComponent(url));for(const source of ['blob:abc','data:image/png;base64,abc','https://server.invalid/Items/1/Images/Primary?api_key=secret',url+'?token=secret'])expect(cachedArtwork(source)).toBe(source)})
it('keeps portable metadata URLs when saving native cached artwork',async()=>{const {originalArtwork}=await import('@/features/library/artworkCache');const url='https://api.xbyvideohub.com/api/tmdb/image/w500/a.jpg';expect(originalArtwork(cachedArtwork(url))).toBe(url)})
