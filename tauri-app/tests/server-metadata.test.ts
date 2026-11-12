import {expect,it,vi} from 'vitest'
import {serverMetadata} from '@/features/sources/serverMetadata'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),endpoint:(account:{baseUrl:string},path:string)=>account.baseUrl+'/'+path}))
it('uses Plex metadata, preserves series identity and does not infer miniseries',async()=>{
 vi.mocked(json).mockResolvedValueOnce({MediaContainer:{Metadata:[{title:'Episode 2',type:'episode',grandparentRatingKey:'series',grandparentTitle:'Show',parentIndex:1,index:2,viewCount:1,Genre:[{tag:'Drama'}]}]}})
 const account={id:'plex-a',providerId:'plex' as const,name:'Plex',baseUrl:'https://plex.test',authOrigins:[]}
 const metadata=await serverMetadata(account,'42')
 expect(json).toHaveBeenCalledWith(account,'GET','https://plex.test/library/metadata/42')
 expect(metadata).toMatchObject({type:'tv',seriesId:'series',seriesName:'Show',seasonNumber:1,episodeNumber:2,watched:true,genres:['Drama']})
 expect(metadata).not.toHaveProperty('isMiniseries')
})
