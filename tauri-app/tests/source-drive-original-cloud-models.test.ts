import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import {Dropdown} from '@arco-design/web-vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {onedrive,dropbox,box,google} from '@/features/sources/cloud'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const drivers={onedrive,dropbox,box,google},providers=Object.keys(drivers) as Array<keyof typeof drivers>,older='2024-01-01T00:00:00Z',newer='2025-01-01T00:00:00Z'
function fixture(provider:keyof typeof drivers){
 const rows=[['Folder',true,0,older],['b.mkv',false,20,older],['a.mkv',false,10,newer]].map(([name,folder,size,date])=>{
  const id=folder?'folder':String(name)[0]
  if(provider==='onedrive')return {id,name,size,lastModifiedDateTime:date,...(folder?{folder:{childCount:2}}:{file:{mimeType:'video/x-matroska',hashes:{sha1Hash:'sha1-'+id}},thumbnails:[{large:{url:'https://fixture.test/'+id}}]})}
  if(provider==='dropbox')return {id,name,size,'.tag':folder?'folder':'file',server_modified:date,path_display:'/Movies/'+name,content_hash:folder?undefined:'hash-'+id}
  if(provider==='box')return {id,name,size,type:folder?'folder':'file',modified_at:date,sha1:folder?undefined:'sha1-'+id,representations:{entries:[{content:{url_template:'https://fixture.test/'+id}}]}}
  return {id,name,size:String(size),mimeType:folder?'application/vnd.google-apps.folder':'video/x-matroska',modifiedTime:date,thumbnailLink:folder?'':'https://fixture.test/'+id,md5Checksum:folder?undefined:'md5-'+id}
 })
 return provider==='onedrive'?{value:rows}:provider==='google'?{files:rows}:provider==='box'?{entries:rows,total_count:3,limit:200}:{entries:rows,has_more:false,cursor:''}
}
beforeEach(()=>{vi.resetAllMocks();const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})})
it.each(providers)('feeds original %s metadata into all six original dropdown sorts and three layouts',async provider=>{
 const pinia=createPinia(),account={id:'original-model-'+provider,providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[]};useFileSourcesStore(pinia).accounts=[account];vi.mocked(driver).mockReturnValue(drivers[provider]);vi.mocked(json).mockResolvedValue(fixture(provider))
 const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body})
 try{
  await flushPromises();const pane=getDrivePane(),a=pane.store.ListDataRaw.find(row=>row.file_id==='a')!
  expect(a).toMatchObject({name:'a.mkv',time:Date.parse(newer),timeStr:expect.any(String),sizeStr:'10.00B',icon:'iconfile_video',category:'video',drive_id:account.id})
  expect(a.timeStr).not.toBe('');if(provider!=='dropbox')expect(a.thumbnail).toBe('https://fixture.test/a')
  const sort=wrapper.findAllComponents(Dropdown).find(node=>node.text().includes('名称'))!
  expect(sort).toBeTruthy();expect(sort.props('trigger')).toBe('hover')
  const orders=[['name asc',['Folder','a.mkv','b.mkv']],['name desc',['Folder','b.mkv','a.mkv']],['updated_at asc',['Folder','b.mkv','a.mkv']],['updated_at desc',['Folder','a.mkv','b.mkv']],['size asc',['Folder','a.mkv','b.mkv']],['size desc',['Folder','b.mkv','a.mkv']]] as const
  for(const [order,expected] of orders){sort.vm.$emit('select',order);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual(expected);expect(wrapper.findAll('.fileitem').map(row=>row.text()).map(text=>expected.find(name=>text.includes(name)))).toEqual([...expected])}
  expect(json).toHaveBeenCalledTimes(1)
  const request=vi.mocked(json).mock.calls[0]!,url=new URL(request[2])
  if(provider==='onedrive')expect(url.searchParams.get('$expand')).toBe('thumbnails')
  if(provider==='box'){expect(url.searchParams.get('fields')).toContain('modified_at');expect(request[5]).toEqual({'x-rep-hints':'[jpg?dimensions=320x320]'})}
  if(provider==='google')expect(url.searchParams.get('fields')).toContain('modifiedTime')
  await pane.load(account.id,'refresh',false);await flushPromises();expect(pane.store.ListDataShow.map(row=>row.name)).toEqual(['Folder','b.mkv','a.mkv'])
  for(const layout of ['image','bigimage','list']){pane.settings.updateStore({uiFileListMode:layout});await flushPromises();expect(wrapper.text()).toContain('a.mkv');expect(pane.store.ListDataRaw.find(row=>row.file_id==='a')!.time).toBe(Date.parse(newer))}
 }finally{wrapper.unmount()}
})
