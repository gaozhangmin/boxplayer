import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import {nativeCall} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
import {baidu} from '@/features/sources/cloud'
import {baiduFileMetadata} from '@/features/files/drive/baiduMetadata'
import {createRemoteFolder} from '@/features/files/drive/folderMutations'
import {copyBaiduFile,trashBaiduFile,acknowledgeBaiduTrash} from '@/features/files/drive/baiduBatchMutations'
import {baiduFileId} from '@/features/files/drive/baiduListTransport'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const source='9007199254740997',target='9007199254740999',copiedId='18446744073709551613',folderId='18446744073709551614',taskId='18446744073709551615'
const name='电影 9007199254740997.mkv',path='/'+name
const rawItem=(id:string,location:string,filename:string,folder=false)=>`{"fs_id":${id},"path":${JSON.stringify(location)},"filename":${JSON.stringify(filename)},"server_filename":${JSON.stringify(filename)},"isdir":${folder?1:0},"size":${folder?0:42},"server_mtime":1700000000,"server_ctime":1690000000,"md5":"fixture-digest"}`
const bytes=(raw:string)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(raw)),finalUrl:''})
let account:any,count=0,created:boolean,copied:boolean,removed:boolean,requests:any[],sourceLiteral:string
beforeEach(()=>{
 vi.resetAllMocks();setActivePinia(createPinia());account={id:'integer-baidu-'+(++count),providerId:'baidu',name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore().accounts=[account]
 created=false;copied=false;removed=false;requests=[];sourceLiteral=source
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{
  if(command!=='http_request')throw Error('unexpected native command '+command)
  const request=args.request,url=new URL(request.url),q=url.searchParams;requests.push(request)
  if(request.method==='POST'){
   if(q.get('method')==='create'){created=true;return bytes(`{"errno":0,"fs_id":${folderId},"isdir":1,"path":"/Folder"}`) as any}
   if(q.get('opera')==='delete'){removed=true;return bytes(`{"errno":0,"taskid":${taskId}}`) as any}
   if(q.get('opera')==='copy'){copied=true;return bytes(`{"errno":0,"taskid":${taskId},"info":[{"errno":0,"path":${JSON.stringify(path)}}]}`) as any}
   throw Error('unexpected mutation')
  }
  if(q.get('method')==='filemetas'){
   const id=q.get('fsids')!.slice(1,-1)
   const item=id===target?rawItem(target,'/Dest','Dest',true):id===copiedId?rawItem(copiedId,'/Dest/'+name,name):id===folderId?rawItem(folderId,'/Folder','Folder',true):rawItem(sourceLiteral,path,name)
   return bytes(`{"errno":0,"list":[${item}],"ignored":"literal \\\"9007199254740997\\\""}`) as any
  }
  const rows=q.get('method')==='search'?[rawItem(sourceLiteral,path,name)]:q.get('dir')==='/Dest'?copied?[rawItem(copiedId,'/Dest/'+name,name)]:[]:[rawItem(target,'/Dest','Dest',true),...(!removed?[rawItem(sourceLiteral,path,name)]:[]),...(created?[rawItem(folderId,'/Folder','Folder',true)]:[])]
  return bytes(`{"errno":0,"has_more":0,"list":[${rows.join(',')}]}`) as any
 })
})
it('preserves unquoted native byte IDs through original listing, metadata and numeric fsids query',async()=>{
 const page=await baidu.list(account,'');expect(page.entries.find(row=>row.id===source)).toMatchObject({id:source,name,size:42,electronModel:{file_id:source,path,description:`baidu_fsid:${source};baidu_path:${path}`}})
 const detail=await baiduFileMetadata(account,source);expect(detail.fs_id).toBe(source);expect(detail.filename).toBe(name);expect(detail.size).toBe(42)
 const request=requests.find(row=>new URL(row.url).searchParams.get('method')==='filemetas');expect(new URL(request.url).searchParams.get('fsids')).toBe('['+source+']');expect(request.accountId).toBe(account.id);expect(request.providerId).toBe('baidu')
})
it('keeps unquoted original search identifiers and digits inside file names intact',async()=>{
 const result=await baidu.search!(account,'电影');expect(result.entries[0]).toMatchObject({id:source,name,electronModel:{file_id:source,path}})
})
it('returns the stable creation ID instead of a physical path and reads it back losslessly',async()=>{
 expect(await createRemoteFolder(account,'','Folder')).toEqual({file_id:folderId,error:''})
 const listing=await baidu.list(account,'');expect(listing.entries.find(row=>row.id===folderId)).toMatchObject({id:folderId,isDirectory:true,name:'Folder'})
 const request=requests.find(row=>row.method==='POST'),form=new URLSearchParams(new TextDecoder().decode(new Uint8Array(request.body)))
 expect(form.get('path')).toBe('/Folder');expect(form.get('isdir')).toBe('1');expect(new URL(request.url).searchParams.has('access_token')).toBe(false)
})
it('carries unquoted uint64 task/file IDs through original copy and delete receipts without Number conversion',async()=>{
 const file={file_id:source,parent_file_id:'',name,isDir:false,path}
 expect(await copyBaiduFile(account,file,target,()=>true,['',target])).toEqual([source])
 expect(requests.some(row=>new URL(row.url).searchParams.get('fsids')==='['+copiedId+']')).toBe(true)
 expect(await trashBaiduFile(account,file,()=>true)).toBe(true);acknowledgeBaiduTrash(account.id,source)
 const posts=requests.filter(row=>row.method==='POST');expect(posts).toHaveLength(2)
 expect(posts.map(row=>new URL(row.url).searchParams.get('opera'))).toEqual(['copy','delete'])
 const deletion=new URLSearchParams(new TextDecoder().decode(new Uint8Array(posts[1].body)));expect(deletion.get('async')).toBe('2');expect(JSON.parse(deletion.get('filelist')!)).toEqual([path])
})
it.each(['9007199254740997.5','-9007199254740997','9.007199254740997e20'])('rejects a noncanonical or unsafe numeric ID token %s',async value=>{
 sourceLiteral=value;await expect(baidu.list(account,'')).rejects.toThrow()
})
it('does not guess digits from an already decoded unsafe Number',()=>{expect(()=>baiduFileId(Number(source))).toThrow('精度')})
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
it('returns the actual long-ID through the original create callback and refreshed list',async()=>{
 const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account]
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  const callback=vi.fn();await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(2));await getDrivePane().action('createFolder',['folder','',undefined,callback]);await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK()
  await vi.waitFor(()=>{expect(wrapper.findComponent(NewFolder).exists()).toBe(false);expect(callback).toHaveBeenCalledWith(folderId);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===folderId)).toBe(true)})
  expect(getDrivePane().store.ListDataRaw.find(row=>row.file_id===folderId)).toMatchObject({name:'Folder',isDir:true,path:'/Folder'})
 }finally{wrapper.unmount()}
})
