import {beforeEach,expect,it,vi} from 'vitest'
import {alipan} from '@/features/sources/alipan'
import {aliDirectoryEntry} from '@/features/files/drive/aliDirectoryModel'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
const account={id:'ali-model',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(fileId:string)=>JSON.stringify({driveId:'drive',fileId})
const file={file_id:'movie',name:'Movie.mkv',type:'file',drive_id:'drive',parent_file_id:'root',size:2048,updated_at:'2025-01-01T00:00:00Z',file_extension:'mkv',mime_type:'video/x-matroska',category:'video',content_hash:'fixture-hash',content_hash_name:'sha1',starred:true,description:'color:#df5659',private_token:'fixture-hidden'}
beforeEach(()=>vi.resetAllMocks())
it.each(['aliyun','alipan-open'] as const)('retains original %s directory fields and native identities',provider=>{
 const row=aliDirectoryEntry({...account,providerId:provider},'drive','root',file),model=row.electronModel
 expect(model).toMatchObject({drive_id:account.id,file_id:id('movie'),parent_file_id:id('root'),time:Date.parse(file.updated_at),sizeStr:'2.00KB',content_hash:'fixture-hash',starred:true,description:file.description,icon:'iconfile_video',category:'video'})
 expect(row.favorite).toBe(true);expect(row.playable).toBe(true);expect(JSON.stringify(row)).not.toContain('fixture-hidden')
 if(provider==='aliyun'){const url=new URL(model.thumbnail);expect(url.protocol).toBe('mscache:');expect(url.searchParams.get('account')).toBe(account.id);const upstream=new URL(url.searchParams.get('url')!);expect(upstream.searchParams.get('drive_id')).toBe('drive');expect(upstream.searchParams.get('file_id')).toBe('movie')}
 else expect(model.thumbnail).toBe('')
})
it.each([{drive_id:'other'},{parent_file_id:'other'},{file_id:'root'},{file_id:''},{type:'symlink'},{size:-1},{size:Number.MAX_SAFE_INTEGER+1},{updated_at:'not-a-date'},{updated_at:42},{user_meta:'invalid JSON'}])('rejects conflicting or malformed directory input %j',patch=>{
 expect(()=>aliDirectoryEntry(account,'drive','root',{...file,...patch})).toThrow()
})
it('adapts absent optional dates/extensions without inventing timestamps',()=>{
 const row=aliDirectoryEntry({...account,providerId:'alipan-open'},'drive','root',{file_id:'movie',name:'Movie.mkv',type:'file'})
 expect(row.electronModel).toMatchObject({time:0,timeStr:'',ext:'mkv',icon:'iconfile_video',parent_file_id:id('root')})
})
it('preserves the original restricted-file icon and folder counts',()=>{
 expect(aliDirectoryEntry(account,'drive','root',{...file,punish_flag:103}).electronModel.icon).toBe('iconpartweifa')
 expect(aliDirectoryEntry(account,'drive','root',{...file,file_id:'folder',type:'folder',file_count:7}).electronModel).toMatchObject({icon:'iconfile-folder',file_count:7,isDir:true})
})
it('keeps original media metadata and play cursor formatting',()=>{
 const row=aliDirectoryEntry(account,'drive','root',{...file,video_media_metadata:{width:3840,height:2160,duration:120},play_cursor:30})
 expect(row.electronModel).toMatchObject({media_width:3840,media_height:2160,media_duration:'00:02:00',media_play_cursor:'00:00:30'})
})
it.each([{items:[file,file]},{items:[file],next_marker:'again'},{items:[file],next_marker:42},{items:undefined}])('rejects duplicate entries and incomplete pagination %j',async data=>{
 vi.mocked(json).mockResolvedValue(data);await expect(alipan.list(account,id('root'),'again')).rejects.toThrow()
})
