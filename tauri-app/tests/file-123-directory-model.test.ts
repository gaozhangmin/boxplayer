import {beforeEach,expect,it,vi} from 'vitest'
import {cloud123DirectoryEntry} from '@/features/files/drive/cloud123DirectoryModel'
import {cloud123} from '@/features/sources/cloud'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'123-original',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
const file={fileId:7,parentFileId:0,filename:'Movie.mkv',type:0,size:2048,updateAt:'2025-01-01T00:00:00Z',thumbnailUrl:'https://fixture.test/thumb',private_token:'fixture-hidden'}
beforeEach(()=>vi.resetAllMocks())
it('retains original time, icon, size and thumbnail with native account/root identity',()=>{
 const row=cloud123DirectoryEntry(account,'',file)
 expect(row).toMatchObject({id:'7',name:'Movie.mkv',playable:true,electronModel:{drive_id:account.id,file_id:'7',parent_file_id:'',time:Date.parse(file.updateAt),icon:'iconfile_video',sizeStr:'2.00KB',thumbnail:file.thumbnailUrl}})
 expect(JSON.stringify(row)).not.toContain('fixture-hidden')
})
it('retains nested parent, document icon and original thumbnail precedence',()=>{
 expect(cloud123DirectoryEntry(account,'12',{...file,parentFileId:12,filename:'Report.pdf',thumbnail:'https://fixture.test/first'}).electronModel).toMatchObject({parent_file_id:'12',icon:'iconfile-pdf',thumbnail:'https://fixture.test/first'})
})
it('does not invent a date when optional metadata is absent',()=>{
 expect(cloud123DirectoryEntry(account,'0',{fileId:8,filename:'Folder',type:1}).electronModel).toMatchObject({time:0,timeStr:'',size:0,icon:'iconfile-folder'})
})
it.each([{fileId:0},{fileId:-1},{fileId:Number.MAX_SAFE_INTEGER+1},{parentFileId:99},{type:2},{trashed:1},{size:-1},{updateAt:'bad-date'},{createAt:42},{filename:''}])('rejects invalid source metadata %j',patch=>{
 expect(()=>cloud123DirectoryEntry(account,'',{...file,...patch})).toThrow()
})
it('uses original platform headers, excludes recycled rows and preserves next-file pagination',async()=>{
 vi.mocked(json).mockResolvedValue({code:0,data:{fileList:[file,{...file,fileId:8,trashed:1}],lastFileId:8}})
 const page=await cloud123.list(account,'','6');expect(page.entries).toHaveLength(1);expect(page.nextCursor).toBe('8')
 const call=vi.mocked(json).mock.calls[0]!,url=new URL(call[2]);expect(url.searchParams.get('lastFileId')).toBe('6');expect(url.searchParams.get('trashed')).toBe('0');expect(call[5]).toEqual({Platform:'open_platform'})
})
it('treats omitted final cursor as complete using the original default',async()=>{
 vi.mocked(json).mockResolvedValue({code:0,data:{fileList:[file]}});expect((await cloud123.list(account,'')).nextCursor).toBeUndefined()
})
it.each([{fileList:[file,file],lastFileId:-1},{fileList:[file],lastFileId:6},{fileList:[file],lastFileId:1.5},{fileList:[],lastFileId:7},{fileList:undefined,lastFileId:-1}])('rejects malformed pages or duplicate cursor %j',async data=>{
 vi.mocked(json).mockResolvedValue({code:0,data});await expect(cloud123.list(account,'','6')).rejects.toThrow()
})
