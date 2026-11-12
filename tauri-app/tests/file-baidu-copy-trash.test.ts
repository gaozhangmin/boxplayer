import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import {rawRequest} from '@/features/sources/transport'
import {copyBaiduFile,trashBaiduFile,pendingBaiduTrash,acknowledgeBaiduTrash} from '@/features/files/drive/baiduBatchMutations'
import {supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {supportsRemoteTrashMove,supportsRemoteTrash} from '@/features/files/drive/trashMutations'
import {BaiduRenameRejected,baiduRenameFetch} from '@/features/files/drive/baiduRenameTransport'
import {baiduMoveFetch} from '@/features/files/drive/baiduMoveTransport'
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn()}))
const response=(value:unknown,status=200)=>({status,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
let account:any,count=0,actual:any,target:any,copies:any[],removed:boolean,apply:boolean,current:boolean,status:number,ack:any
const posts=()=>vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'baidu-batch-'+(++count),providerId:'baidu',name:'Fixture',userId:'owner',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 actual={fs_id:'101',path:'/Old/Movie.mkv',filename:'Movie.mkv',isdir:0,size:42,md5:'digest'};target={fs_id:'12',path:'/Dest',filename:'Dest',isdir:1};copies=[];removed=false;apply=true;current=true;status=200;ack=undefined
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw,body)=>{
  const url=new URL(raw),q=url.searchParams
  if(method==='POST'){
   const operation=q.get('opera'),data=ack??(operation==='delete'?{errno:0,taskid:7}:{errno:0,info:[{errno:0,path:actual.path}]})
   if(apply&&status===200&&data.errno===0&&!data.info?.some((row:any)=>row.errno!==0)){
    if(operation==='delete')removed=true
    else copies=[{...actual,fs_id:'103',path:target.path+'/'+actual.filename}]
   }
   return response(data,status)
  }
  if(q.get('method')==='filemetas'){
   const id=q.get('fsids')!.slice(1,-1),row=id==='12'?target:id==='101'?actual:copies.find(row=>row.fs_id===id)
   return response({errno:0,list:row?[row]:[]})
  }
  const rows=q.get('dir')==='/Old'?!removed?[actual]:[]:q.get('dir')===target.path?copies:[]
  return response({errno:0,has_more:0,list:rows.map(row=>({...row,server_filename:row.filename,server_ctime:0,server_mtime:0,size:row.size??0}))})
 })
})
const file=()=>({drive_id:account.id,file_id:'101',parent_file_id:'/Old',name:actual.filename,isDir:actual.isdir===1,path:actual.path})
const copy=()=>copyBaiduFile(account,file(),'12',()=>current,['','12'])
const trash=()=>trashBaiduFile(account,file(),()=>current)
it.each([false,true])('retains copy async=1 form and confirms a new stable ID for directory=%s',async folder=>{
 actual.isdir=folder?1:0;expect(supportsRemoteCopy(account)).toBe(true);expect(await copy()).toEqual(['101'])
 const form=new URLSearchParams(posts()[0]![3]);expect(form.get('async')).toBe('1');expect(form.get('ondup')).toBe('fail');expect(JSON.parse(form.get('filelist')!)).toEqual([{path:actual.path,dest:target.path}]);expect(removed).toBe(false)
 expect(vi.mocked(rawRequest).mock.calls.some(call=>new URL(call[2]).searchParams.get('fsids')==='[103]')).toBe(true)
})
it.each([false,true])('retains delete async=2 and string-path array for directory=%s',async folder=>{
 actual.isdir=folder?1:0;expect(supportsRemoteTrashMove(account)).toBe(true);expect(supportsRemoteTrash(account)).toBe(false);expect(await trash()).toBe(true)
 const form=new URLSearchParams(posts()[0]![3]);expect(form.get('async')).toBe('2');expect(form.has('ondup')).toBe(false);expect(JSON.parse(form.get('filelist')!)).toEqual([actual.path])
 expect(pendingBaiduTrash(account)).toHaveLength(1);acknowledgeBaiduTrash(account.id,'101');expect(pendingBaiduTrash(account)).toEqual([])
})
it.each(['copy','trash'] as const)('confirms delayed %s visibility without another submission',async kind=>{
 apply=false;const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('尚未确认')
 if(kind==='copy')copies=[{...actual,fs_id:'103',path:'/Dest/Movie.mkv'}];else removed=true
 await run();expect(posts()).toHaveLength(1)
})
it.each(['copy','trash'] as const)('does not infer %s completion from external changes after losing the receipt',async kind=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>args[1]==='POST'?Promise.reject(Error('lost response')):original(...args))
 const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('lost response')
 if(kind==='copy')copies=[{...actual,fs_id:'103',path:'/Dest/Movie.mkv'}];else removed=true
 await expect(run()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(1)
})
it.each([403,409,429])('permits intentional retry only after definite HTTP %s refusal',async denied=>{
 status=denied;await expect(trash()).rejects.toThrow('拒绝');status=200;expect(await trash()).toBe(true);expect(posts()).toHaveLength(2)
})
it.each([408,500])('does not resubmit HTTP %s uncertain results',async uncertain=>{
 status=uncertain;await expect(trash()).rejects.toThrow('不确定');await expect(trash()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(1)
})
it('does not accept a per-item refusal or wrong receipt path',async()=>{
 ack={errno:0,info:[{errno:-8,path:actual.path}]};await expect(copy()).rejects.toThrow('拒绝单项')
 ack={errno:0,info:[{errno:0,path:'/Unexpected/Movie.mkv'}]};apply=false;await expect(copy()).rejects.toThrow('路径不匹配')
 await expect(copy()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(2)
})
it('rejects preexisting target conflict before posting',async()=>{
 copies=[{...actual,fs_id:'103',path:'/Dest/Movie.mkv'}];await expect(copy()).rejects.toThrow('同名');expect(posts()).toHaveLength(0)
})
it('rejects a mismatched copied metadata path or digest',async()=>{
 apply=false;await expect(copy()).rejects.toThrow('尚未确认');copies=[{...actual,fs_id:'103',path:'/Dest/Movie.mkv',md5:'other'}]
 await expect(copy()).rejects.toThrow('尚未确认');expect(posts()).toHaveLength(1)
})
it('rejects self/descendant targets and changed source identity without writing',async()=>{
 target={...target,path:'/Old',filename:'Old'};await expect(copy()).rejects.toThrow('原位置')
 actual={...actual,path:'/Old',filename:'Old',isdir:1};target={...target,path:'/Old/Sub',filename:'Sub'}
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const url=new URL(args[2]);if(url.searchParams.get('method')==='list'&&url.searchParams.get('dir')==='/')return response({errno:0,has_more:0,list:[{...actual,server_filename:actual.filename,server_ctime:0,server_mtime:0}]});return original(...args)})
 await expect(copyBaiduFile(account,file(),'12',()=>current)).rejects.toThrow('子目录');expect(posts()).toHaveLength(0)
})
it.each(['copy','trash'] as const)('retains the %s receipt if its source closes during response delivery',async kind=>{
 const original=vi.mocked(rawRequest).getMockImplementation()!;vi.mocked(rawRequest).mockImplementation(async(...args)=>{const result=await original(...args);if(args[1]==='POST')current=false;return result})
 const run=kind==='copy'?copy:trash;await expect(run()).rejects.toThrow('切换');current=true;await run();expect(posts()).toHaveLength(1)
})
it('coalesces duplicate requests and blocks competing file mutations until local sync',async()=>{
 expect(await Promise.all([trash(),trash()])).toEqual([true,true]);expect(posts()).toHaveLength(1)
 await expect(copy()).rejects.toThrow('此前')
 const {renameRemoteFile}=await import('@/features/files/drive/renameMutations');await expect(renameRemoteFile(account,file(),'New.mkv')).rejects.toThrow('此前')
})
it.each(['rename','move'] as const)('treats existing %s HTTP408 as unknown rather than a definite refusal',async kind=>{
 status=408;const fields=kind==='rename'?{path:actual.path,newname:'New.mkv'}:{path:actual.path,dest:'/Dest'}
 const form=new URLSearchParams({async:'1',ondup:kind==='rename'?'overwrite':'fail',filelist:JSON.stringify([fields])})
 await expect((kind==='rename'?baiduRenameFetch:baiduMoveFetch)(account.id,'https://pan.baidu.com/rest/2.0/xpan/file?method=filemanager&opera='+kind,{method:'POST',headers:{'User-Agent':'pan.baidu.com','Content-Type':'application/x-www-form-urlencoded'},body:form})).rejects.not.toBeInstanceOf(BaiduRenameRejected)
})
