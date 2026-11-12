import { beforeEach,expect,it,vi } from 'vitest'
import { alipan } from '@/features/sources/alipan'
import { json } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account:Account={id:'account-a',providerId:'alipan-open',name:'Alipan',baseUrl:'https://openapi.alipan.com',authOrigins:['https://openapi.alipan.com']}
beforeEach(()=>vi.clearAllMocks())
it('deduplicates default/backup roots and keeps drive identity on pages and playback',async()=>{
 vi.mocked(json).mockResolvedValueOnce({resource_drive_id:'resource',backup_drive_id:'backup',default_drive_id:'backup'}).mockResolvedValueOnce({items:[{file_id:'video',name:'film.mkv',type:'file',size:42}],next_marker:'next'}).mockResolvedValueOnce({url:'https://cdn.test/video?signature=synthetic'})
 const root=await alipan.list(account,'');expect(root.entries.map(i=>i.name)).toEqual(['资源盘','备份盘'])
 const page=await alipan.list(account,root.entries[1]!.id,'marker');expect(page.nextCursor).toBe('next')
 expect(json).toHaveBeenNthCalledWith(2,account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/list',expect.objectContaining({drive_id:'backup',parent_file_id:'root',marker:'marker',limit:100}))
 const media=await alipan.resolve(account,page.entries[0]!);expect(media).toMatchObject({sourceId:'account-a',accountId:'account-a',fileId:page.entries[0]!.id,headers:{Referer:'https://www.aliyundrive.com/'}})
 expect(json).toHaveBeenNthCalledWith(3,account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/getDownloadUrl',expect.objectContaining({drive_id:'backup',file_id:'video'}))
})
it('rejects missing drive identity before making an API request',async()=>{
 await expect(alipan.list(account,'{"fileId":"video"}')).rejects.toThrow();expect(json).not.toHaveBeenCalled()
})

it('web accounts retain their own endpoints, page size, and CDN URL mapping',async()=>{
 const web:Account={...account,id:'web-a',providerId:'aliyun',baseUrl:'https://api.aliyundrive.com',authOrigins:['https://api.aliyundrive.com','https://user.aliyundrive.com']}
 vi.mocked(json).mockResolvedValueOnce({resource_drive_id:'resource',backup_drive_id:'backup'}).mockResolvedValueOnce({items:[{file_id:'video',name:'clip.mp4',type:'file'}],next_marker:'next-web'}).mockResolvedValueOnce({cdn_url:'https://cdn.test/web-video'})
 const roots=await alipan.list(web,'');expect(vi.mocked(json).mock.calls[0]![2]).toBe('https://user.aliyundrive.com/v2/user/get')
 const page=await alipan.list(web,roots.entries[0]!.id,'web-marker');expect(page.nextCursor).toBe('next-web')
 expect(json).toHaveBeenNthCalledWith(2,web,'POST','https://api.aliyundrive.com/adrive/v3/file/list',expect.objectContaining({drive_id:'resource',parent_file_id:'root',marker:'web-marker',limit:100,fields:'*'}))
 expect((await alipan.resolve(web,page.entries[0]!)).url).toBe('https://cdn.test/web-video')
 expect(json).toHaveBeenNthCalledWith(3,web,'POST','https://api.aliyundrive.com/v2/file/get_download_url',{drive_id:'resource',file_id:'video'})
 expect(vi.mocked(json).mock.calls.every(call=>!call[2].startsWith('https://openapi.alipan.com'))).toBe(true)
})

it('uses the documented 100-item Open list limit on every cursor page',async()=>{
 const parent=JSON.stringify({driveId:'backup',fileId:'root'})
 vi.mocked(json).mockResolvedValueOnce({items:[{file_id:'one',name:'one.mkv',type:'file',size:1}],next_marker:'next'}).mockResolvedValueOnce({items:[{file_id:'two',name:'two.mkv',type:'file',size:2}],next_marker:''})
 const first=await alipan.list(account,parent),second=await alipan.list(account,parent,first.nextCursor)
 expect(first.nextCursor).toBe('next');expect(second.nextCursor).toBeUndefined();expect(second.entries[0]!.id).toBe(JSON.stringify({driveId:'backup',fileId:'two'}))
 expect(vi.mocked(json).mock.calls.map(call=>call[3])).toEqual([expect.objectContaining({limit:100,marker:''}),expect.objectContaining({limit:100,marker:'next'})])
})
