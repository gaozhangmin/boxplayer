import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {bindDrivePane,type DrivePanePort} from '@/features/files/drive/ports'
import {createDriveShare} from '@/features/files/drive/sharePorts'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
import {json,request} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(r:{body:number[]})=>new TextDecoder().decode(new Uint8Array(r.body)),playable:()=>true}))
let unbind:()=>void
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});setActivePinia(createPinia())})
afterEach(()=>{unbind?.();vi.useRealTimers()})
function setup(provider:Account['providerId'],userId?:string,ids:string[]=['1','2']){
 const account={id:'native-uuid',providerId:provider,name:'Fixture',baseUrl:'',authOrigins:[],userId}
 useFileSourcesStore().accounts=[account]
 const pane={sourceId:account.id,local:false,account,context:1} as unknown as DrivePanePort;unbind=bindDrivePane(pane)
 const files=ids.map(id=>({drive_id:account.id,file_id:id,name:id+'.mkv',isDir:false})) as any
 return {share:createDriveShare(files),pane,account}
}
const response=(value:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
describe('original share provider ports',()=>{
 it('reuses Google anyone permission from a later page without creating a duplicate permission',async()=>{
  const {share}=setup('google');vi.mocked(json).mockResolvedValueOnce({permissions:[],nextPageToken:'next'}).mockResolvedValueOnce({permissions:[{id:'public',type:'anyone',role:'reader'}]}).mockResolvedValueOnce({id:'1',webViewLink:'https://drive.google.com/file/d/1/view'})
  await expect(share.create(['1'],'Title','','')).resolves.toMatchObject({url:'https://drive.google.com/file/d/1/view'})
  expect(vi.mocked(json).mock.calls.map(call=>call[1])).toEqual(['GET','GET','GET']);expect(vi.mocked(json).mock.calls[1]![2]).toContain('pageToken=next');share.dispose()
 })
 it('rejects a Google permission response lacking identity before reading a link',async()=>{
  const {share}=setup('google');vi.mocked(json).mockResolvedValueOnce({permissions:[]}).mockResolvedValueOnce({})
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('失败');expect(json).toHaveBeenCalledTimes(2);share.dispose()
 })
 it('preserves original OneDrive body and rejects unsupported settings before a write',async()=>{
  const {share}=setup('onedrive');await expect(share.create(['1'],'Title','','pass')).rejects.toThrow('请清空');expect(json).not.toHaveBeenCalled()
  vi.mocked(json).mockResolvedValue({id:'permission',link:{webUrl:'https://1drv.ms/v/example',scope:'anonymous'}})
  expect(await share.create(['1'],'Title','','')).toMatchObject({url:'https://1drv.ms/v/example'})
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:'native-uuid',providerId:'onedrive'}),'POST','https://graph.microsoft.com/v1.0/me/drive/items/1/createLink',{type:'view',scope:'anonymous'});share.dispose()
 })
 it('preserves 123 combined ids/password/expiry and builds URL from provider UID rather than account UUID',async()=>{
  const {share}=setup('123','cloud123_42');vi.mocked(request).mockResolvedValue(response({code:0,data:{shareID:8,shareKey:'key'}}))
  const result=await share.create(['1','2'],'Title',new Date(Date.now()+3*86400000).toISOString(),'pass')
  expect(result).toEqual({url:'https://42.share.123pan.cn/123pan/key',password:'pass'})
  const call=vi.mocked(request).mock.calls[0]!;expect(JSON.parse(call[3]!)).toEqual({shareName:'Title',shareExpire:7,fileIDList:'1,2',sharePwd:'pass'});expect(call[4]).toEqual({'Content-Type':'application/json',Platform:'open_platform'});share.dispose()
 })
 it('refuses a missing 123 UID and incomplete provider success',async()=>{
  const {share}=setup('123');await expect(share.create(['1'],'Title','','')).rejects.toThrow('有效');expect(request).not.toHaveBeenCalled()
  share.dispose();unbind();const next=setup('123','42');vi.mocked(request).mockResolvedValue(response({code:0,data:{shareKey:'key'}}));await expect(next.share.create(['1'],'Title','','')).rejects.toThrow('完整');next.share.dispose()
 })
 it('stops Google creation after the source context changes during permission lookup',async()=>{
  const {share,pane}=setup('google');let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=share.create(['1'],'Title','','');pane.context=2;finish({permissions:[]})
  await expect(pending).rejects.toThrow('切换');expect(json).toHaveBeenCalledTimes(1);share.dispose()
 })
 it('retains Guangya combined selections, password and original day conversion',async()=>{
  const {share}=setup('guangya');vi.mocked(json).mockResolvedValue({code:0,data:{shareId:'share',shareUrl:'https://www.guangyapan.com/s/share'}})
  expect(await share.create(['1','2'],'Title',new Date(Date.now()+3*86400000).toISOString(),'pass')).toEqual({url:'https://www.guangyapan.com/s/share',password:'pass'})
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:'native-uuid',providerId:'guangya'}),'POST','https://api.guangyapan.com/nd.bizuserres.s/v1/share_file',{fileIds:['1','2'],title:'Title',validateDuration:3,shareType:1,code:'pass',autoFillCode:false,trafficLimit:'0',maxRestoreCount:0,downloadType:1});share.dispose()
 })
 it('rejects Guangya business errors or a missing share identifier',async()=>{
  const {share}=setup('guangya');vi.mocked(json).mockResolvedValue({code:401,data:{shareId:'bad'}});await expect(share.create(['1'],'Title','','')).rejects.toThrow('失败')
  vi.mocked(json).mockResolvedValue({code:0,data:{shareUrl:'https://www.guangyapan.com/s/unconfirmed'}});await expect(share.create(['1'],'Title','','')).rejects.toThrow('标识');share.dispose()
 })

 it('reuses an unmodified Dropbox link without a creation write',async()=>{
  const {share}=setup('dropbox');vi.mocked(json).mockResolvedValue({links:[{id:'1',url:'https://www.dropbox.com/s/link'}],has_more:false})
  expect(await share.create(['1'],'Title','','')).toEqual({url:'https://www.dropbox.com/s/link',password:''});expect(json).toHaveBeenCalledTimes(1);share.dispose()
 })
 it('updates and confirms password/expiry on an existing Dropbox link without recreating it',async()=>{
  const {share}=setup('dropbox'),expires='2030-01-01T00:00:00Z',link={id:'1',url:'https://www.dropbox.com/s/link'}
  vi.mocked(json).mockResolvedValueOnce({links:[link],has_more:false}).mockResolvedValueOnce({...link,expires,link_permissions:{require_password:true}})
  expect(await share.create(['1'],'Title',expires,'pass')).toMatchObject({password:'pass'})
  expect(json).toHaveBeenLastCalledWith(expect.objectContaining({id:'native-uuid',providerId:'dropbox'}),'POST','https://api.dropboxapi.com/2/sharing/modify_shared_link_settings',{url:link.url,settings:{require_password:true,link_password:'pass',expires}});expect(json).toHaveBeenCalledTimes(2);share.dispose()
 })
 it('preserves original Dropbox create options and validates confirmed protection',async()=>{
  const {share}=setup('dropbox'),expires='2030-01-01T00:00:00Z'
  vi.mocked(json).mockResolvedValueOnce({links:[],has_more:false}).mockResolvedValueOnce({id:'1',url:'https://www.dropbox.com/s/link',expires,link_permissions:{resolved_visibility:{'.tag':'password'}}})
  await share.create(['1'],'Title',expires,'pass')
  expect(json).toHaveBeenLastCalledWith(expect.objectContaining({providerId:'dropbox'}),'POST','https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',{path:'1',settings:{requested_visibility:'password',link_password:'pass',expires}});share.dispose()
 })
 it('rereads a lost Dropbox create acknowledgement without repeating the write',async()=>{
  const {share}=setup('dropbox');vi.mocked(json).mockResolvedValueOnce({links:[],has_more:false}).mockRejectedValueOnce(Error('lost acknowledgement')).mockResolvedValueOnce({links:[{id:'1',url:'https://www.dropbox.com/s/link'}],has_more:false})
  expect(await share.create(['1'],'Title','','')).toMatchObject({url:'https://www.dropbox.com/s/link'});expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/create_shared_link_with_settings'))).toHaveLength(1);share.dispose()
 })
 it('does not send a Dropbox create after a malformed or cyclic existing-link lookup',async()=>{
  const {share}=setup('dropbox');vi.mocked(json).mockResolvedValue({links:[],has_more:true,cursor:'again'})
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('分页');expect(vi.mocked(json).mock.calls.every(call=>call[2].endsWith('/list_shared_links'))).toBe(true)
  vi.mocked(json).mockResolvedValue({});await expect(share.create(['1'],'Title','','')).rejects.toThrow('响应无效');share.dispose()
 })
 it('does not present an unprotected Dropbox link as password protected',async()=>{
  const {share}=setup('dropbox'),link={id:'1',url:'https://www.dropbox.com/s/link'}
  vi.mocked(json).mockResolvedValueOnce({links:[link],has_more:false}).mockResolvedValueOnce(link)
  await expect(share.create(['1'],'Title','','pass')).rejects.toThrow('未确认密码');share.dispose()
 })
 it('rejects a Dropbox create response for another file',async()=>{
  const {share}=setup('dropbox');vi.mocked(json).mockResolvedValueOnce({links:[],has_more:false}).mockResolvedValueOnce({id:'other',url:'https://www.dropbox.com/s/other'})
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('标识不匹配');share.dispose()
 })
 it('does not modify Dropbox link settings after closing during lookup',async()=>{
  const {share}=setup('dropbox');let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=share.create(['1'],'Title','','pass');share.dispose();finish({links:[{id:'1',url:'https://www.dropbox.com/s/link'}],has_more:false})
  await expect(pending).rejects.toThrow('关闭');expect(json).toHaveBeenCalledTimes(1)
 })

 it('retains Quark combined selection/password/expiry and resolves the public pwd_id',async()=>{
  const {share}=setup('quark');vi.mocked(request).mockResolvedValueOnce(response({code:0,data:{share_id:'internal'}})).mockResolvedValueOnce(response({code:0,data:{share_id:'internal',pwd_id:'Public123',share_pwd:'pass'}}))
  const before=Date.now(),result=await share.create(['1','2'],'Title',new Date(before+3*86400000).toISOString(),'pass')
  expect(result).toEqual({url:'https://pan.quark.cn/s/Public123',password:'pass'})
  const call=vi.mocked(request).mock.calls[0]!,body=JSON.parse(call[3]!);expect(body).toMatchObject({fid_list:['1','2'],title:'Title',url_type:2,expired_type:2,passcode:'pass'});expect(body.expired_at).toBeGreaterThanOrEqual(before+3*86400000)
  expect(call[0]).toMatchObject({id:'native-uuid',providerId:'quark'});expect(new URL(call[2]).searchParams.get('pr')).toBe('ucpro');share.dispose()
 })
 it('does not treat an allocated Quark share id in a pending task as completion',async()=>{
  vi.useFakeTimers();const {share}=setup('quark');let polls=0
  vi.mocked(request).mockImplementation(async(_account,_method,url)=>{const path=new URL(url).pathname;if(path.endsWith('/share'))return response({code:0,data:{task_id:'task',share_id:'internal'}});if(path.endsWith('/task'))return response({code:0,data:{status:++polls===1?1:2,share_id:'internal'}});return response({code:0,data:{share_id:'internal',pwd_id:'Public123'}})})
  const pending=share.create(['1'],'Title','',''),assertion=expect(pending).resolves.toMatchObject({url:'https://pan.quark.cn/s/Public123'});await vi.runAllTimersAsync();await assertion
  expect(polls).toBe(2);expect(vi.mocked(request).mock.calls.filter(call=>new URL(call[2]).pathname.endsWith('/share'))).toHaveLength(1);share.dispose()
 })
 it('reports Quark task failure before trying to fetch a public link',async()=>{
  const {share}=setup('quark');vi.mocked(request).mockResolvedValueOnce(response({data:{task_id:'task'}})).mockResolvedValueOnce(response({data:{status:3,message:'fixture failed'}}))
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('fixture failed');expect(request).toHaveBeenCalledTimes(2);share.dispose()
 })
 it('reports a timed-out Quark task without repeating share creation',async()=>{
  vi.useFakeTimers();const {share}=setup('quark');vi.mocked(request).mockResolvedValueOnce(response({data:{task_id:'task'}})).mockResolvedValue(response({data:{status:1,share_id:'allocated'}}))
  const pending=share.create(['1'],'Title','',''),assertion=expect(pending).rejects.toThrow('超时');await vi.runAllTimersAsync();await assertion
  expect(vi.mocked(request).mock.calls.filter(call=>new URL(call[2]).pathname.endsWith('/share'))).toHaveLength(1);expect(request).toHaveBeenCalledTimes(41);share.dispose()
 })
 it('stops Quark polling after closing during creation',async()=>{
  const {share}=setup('quark');let finish!:(value:any)=>void;vi.mocked(request).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const pending=share.create(['1'],'Title','','');share.dispose();finish(response({data:{task_id:'task'}}))
  await expect(pending).rejects.toThrow('关闭');expect(request).toHaveBeenCalledTimes(1)
 })
 it('does not fabricate a Quark public URL from an internal share id',async()=>{
  const {share}=setup('quark');vi.mocked(request).mockResolvedValueOnce(response({data:{share_id:'internal'}})).mockResolvedValueOnce(response({data:{share_id:'internal'}}))
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('公开');share.dispose()
 })
 it('does not claim a Quark password when the returned passcode differs',async()=>{
  const {share}=setup('quark');vi.mocked(request).mockResolvedValueOnce(response({data:{share_id:'internal'}})).mockResolvedValueOnce(response({data:{share_id:'internal',pwd_id:'Public123',share_pwd:'other'}}))
  await expect(share.create(['1'],'Title','','pass')).rejects.toThrow('未确认提取码');share.dispose()
 })
 it('rejects a Quark business error before looking up task/link metadata',async()=>{
  const {share}=setup('quark');vi.mocked(request).mockResolvedValue(response({code:500,message:'fixture business error'}))
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('fixture business error');expect(request).toHaveBeenCalledTimes(1);share.dispose()
 })

 it('passes PikPak combined ids, generated-password mode and original expiry through the native signer',async()=>{
  const {share}=setup('pikpak');vi.mocked(nativeCall).mockResolvedValue({share_id:'share',share_url:'https://mypikpak.com/s/public',pass_code:'Generated'})
  expect(await share.create(['1','2'],'Title',new Date(Date.now()+7*86400000).toISOString(),'pass')).toEqual({url:'https://mypikpak.com/s/public',password:'Generated'})
  expect(nativeCall).toHaveBeenCalledExactlyOnceWith('pikpak_create_share',{accountId:'native-uuid',fileIds:['1','2'],needPassword:true,expirationDays:7});expect(json).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();share.dispose()
 })
 it('preserves PikPak unlimited public share defaults',async()=>{
  const {share}=setup('pikpak');vi.mocked(nativeCall).mockResolvedValue({id:'share',share_link:'https://mypikpak.com/s/public'})
  expect(await share.create(['1'],'Title','','')).toEqual({url:'https://mypikpak.com/s/public',password:''})
  expect(nativeCall).toHaveBeenCalledExactlyOnceWith('pikpak_create_share',{accountId:'native-uuid',fileIds:['1'],needPassword:false,expirationDays:-1});share.dispose()
 })
 it('does not substitute the typed PikPak password when the server omits its generated passcode',async()=>{
  const {share}=setup('pikpak');vi.mocked(nativeCall).mockResolvedValue({share_id:'share',share_url:'https://mypikpak.com/s/public'})
  await expect(share.create(['1'],'Title','','typed')).rejects.toThrow('生成的提取码');share.dispose()
 })
 it('rejects incomplete or unsafe PikPak share responses',async()=>{
  const {share}=setup('pikpak');vi.mocked(nativeCall).mockResolvedValue({share_url:'https://mypikpak.com/s/public'});await expect(share.create(['1'],'Title','','')).rejects.toThrow('失败')
  vi.mocked(nativeCall).mockResolvedValue({share_id:'share',share_url:'javascript:alert(1)'});await expect(share.create(['1'],'Title','','')).rejects.toThrow('链接无效');share.dispose()
 })
 it('does not publish an in-flight PikPak result after closing the share dialog',async()=>{
  const {share}=setup('pikpak');let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const pending=share.create(['1'],'Title','','');share.dispose();finish({share_id:'share',share_url:'https://mypikpak.com/s/public'})
  await expect(pending).rejects.toThrow('关闭');expect(nativeCall).toHaveBeenCalledTimes(1)
 })

 it('decodes Ali native locations and preserves ordinary multi-file parameters',async()=>{
  const ids=['a','b'].map(fileId=>JSON.stringify({driveId:'resource-drive',fileId})),{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValue(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_pwd:'pass',share_name:'Title',drive_id:'resource-drive',file_id_list:['a','b']}))
  expect(await share.create(ids,'Title','2030-01-01T00:00:00Z','pass')).toEqual({url:'https://www.alipan.com/s/public',password:'pass'})
  const [command,args]=vi.mocked(nativeCall).mock.calls[0]!,request=(args as any).request;expect(command).toBe('http_request');expect(request).toMatchObject({providerId:'aliyun',accountId:'native-uuid',method:'POST',url:'https://api.aliyundrive.com/adrive/v2/share_link/create'})
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(request.body)))).toEqual({drive_id:'resource-drive',expiration:'2030-01-01T00:00:00Z',share_pwd:'pass',share_name:'Title',file_id_list:['a','b']});expect(request.headers).toEqual({'Content-Type':'application/json'});share.dispose()
 })
 it('uses the original Ali quick-transfer endpoint and drive_file_list body',async()=>{
  const ids=['a','b'].map(fileId=>JSON.stringify({driveId:'backup-drive',fileId})),{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValue(response({share_id:'transfer',share_url:'https://www.alipan.com/t/public'}))
  await share.create(ids,'Title','','',true)
  const request=(vi.mocked(nativeCall).mock.calls[0]![1] as any).request;expect(request.url).toBe('https://api.aliyundrive.com/adrive/v1/share/create');expect(JSON.parse(new TextDecoder().decode(new Uint8Array(request.body)))).toEqual({drive_file_list:[{drive_id:'backup-drive',file_id:'a'},{drive_id:'backup-drive',file_id:'b'}]});share.dispose()
 })
 it('rejects mixed Ali drives and virtual roots before any write',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'}),JSON.stringify({driveId:'two',fileId:'b'}),JSON.stringify({driveId:'one',fileId:'root'})],{share}=setup('aliyun',undefined,ids)
  await expect(share.create(ids.slice(0,2),'Title','','')).rejects.toThrow('同一个盘');await expect(share.create([ids[2]!],'Title','','')).rejects.toThrow('实际文件');expect(nativeCall).not.toHaveBeenCalled();share.dispose()
 })
 it('retains the original Ali business-error message on HTTP 400',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValue({...response({code:'SharelinkCreateExceedDailyLimit'}),status:400})
  await expect(share.create(ids,'Title','','')).rejects.toThrow('今日分享次数过多');share.dispose()
 })
 it('does not route Ali open-channel credentials into web sharing',async()=>{
  const {share}=setup('alipan-open');await expect(share.create(['1'],'Title','','')).rejects.toThrow('开放通道');expect(nativeCall).not.toHaveBeenCalled();share.dispose()
 })
 it('rejects a mismatched Ali drive or unconfirmed password',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValue(response({share_id:'share',share_url:'https://www.alipan.com/s/public',drive_id:'other'}));await expect(share.create(ids,'Title','','')).rejects.toThrow('不匹配')
  vi.mocked(nativeCall).mockResolvedValue(response({share_id:'share',share_url:'https://www.alipan.com/s/public'}));await expect(share.create(ids,'Title','','pass')).rejects.toThrow('未确认提取码');share.dispose()
 })
 it('does not return a pending Ali result after changing source context',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share,pane}=setup('aliyun',undefined,ids);let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=share.create(ids,'Title','','');pane.context=2;finish(response({share_id:'share',share_url:'https://www.alipan.com/s/public'}));await expect(pending).rejects.toThrow('切换');share.dispose()
 })

 it('preserves 123 paid-share amount, resource description, reward and combined ids',async()=>{
  const {share}=setup('123','42');vi.mocked(request).mockResolvedValue(response({code:0,data:{shareID:8,shareKey:'paid'}}))
  expect(await share.create(['1','2'],'Title','2030-01-01T00:00:00Z','pass',false,{amount:9,description:'Description',reward:true})).toEqual({url:'https://42.share.123pan.cn/123pan/paid',password:''})
  const call=vi.mocked(request).mock.calls[0]!;expect(call[2]).toBe('https://open-api.123pan.com/api/v1/share/content-payment/create');expect(JSON.parse(call[3]!)).toEqual({shareName:'Title',fileIDList:'1,2',payAmount:9,isReward:1,resourceDesc:'Description'});share.dispose()
 })
 it('rejects invalid 123 payment metadata before creating a share',async()=>{
  const {share}=setup('123','42')
  for(const amount of [0,1001,1.5])await expect(share.create(['1'],'Title','','',false,{amount,description:'',reward:false})).rejects.toThrow('整数')
  await expect(share.create(['1'],'Title','','',false,{amount:1,description:'x'.repeat(201),reward:false})).rejects.toThrow('说明');expect(request).not.toHaveBeenCalled();share.dispose()
 })
 it('never routes 123 paid options to another provider',async()=>{
  const {share}=setup('google');await expect(share.create(['1'],'Title','','',false,{amount:1,description:'',reward:false})).rejects.toThrow('不支持');expect(json).not.toHaveBeenCalled();expect(nativeCall).not.toHaveBeenCalled();share.dispose()
 })
 it('updates a mismatched Ali title using the original share-only batch body',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValueOnce(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_name:'Server title'})).mockResolvedValueOnce(response({responses:[{id:'share',status:200,body:{share_id:'share',share_name:'Title'}}]}))
  await share.create(ids,'Title','','');expect(nativeCall).toHaveBeenCalledTimes(2)
  const request=(vi.mocked(nativeCall).mock.calls[1]![1] as any).request;expect(request.url).toBe('https://api.aliyundrive.com/adrive/v4/batch');expect(JSON.parse(new TextDecoder().decode(new Uint8Array(request.body)))).toEqual({resource:'file',requests:[{id:'share',method:'POST',url:'/share_link/update',headers:{'Content-Type':'application/json'},body:{share_id:'share',share_pwd:'',expiration:'',share_name:'Title'}}]});share.dispose()
 })
 it('retries failed Ali title confirmation without creating another share',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValueOnce(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_name:'Server title'})).mockResolvedValueOnce(response({responses:[{id:'share',status:202,body:{share_id:'share',share_name:'Title'}}]})).mockResolvedValueOnce(response({responses:[{id:'share',status:200,body:{share_id:'share',share_name:'Title'}}]}))
  await expect(share.create(ids,'Title','','')).rejects.toThrow('仍在执行');expect(await share.create(ids,'Title','','')).toMatchObject({url:'https://www.alipan.com/s/public'})
  expect(vi.mocked(nativeCall).mock.calls.filter(call=>(call[1] as any).request.url.endsWith('/share_link/create'))).toHaveLength(1);expect(nativeCall).toHaveBeenCalledTimes(3);share.dispose()
 })
 it('does not update Ali title after the source changes during creation',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share,pane}=setup('aliyun',undefined,ids);let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const pending=share.create(ids,'Title','','');pane.context=2;finish(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_name:'Server title'}));await expect(pending).rejects.toThrow('切换');expect(nativeCall).toHaveBeenCalledTimes(1);share.dispose()
 })

 it.each(['box','google','onedrive','dropbox','guangya','123','pikpak','quark','aliyun'] as const)('rejects same-ID account substitution before creating a %s share',async provider=>{
  const {share,account}=setup(provider,'cloud123_42');useFileSourcesStore().accounts=[{...account,name:'Replacement'}]
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('账号已变化');expect(json).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(nativeCall).not.toHaveBeenCalled();share.dispose()
 })
 it('does not add Google public permission under a replaced account after permission lookup',async()=>{
  const {share,account}=setup('google');let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>finish=resolve))
  const pending=share.create(['1'],'Title','','');useFileSourcesStore().accounts=[{...account,userId:'another-user'}];finish({permissions:[]})
  await expect(pending).rejects.toThrow('账号已变化');expect(json).toHaveBeenCalledTimes(1);expect(vi.mocked(json).mock.calls[0]![1]).toBe('GET');share.dispose()
 })
 it('does not update a stale Dropbox link after a same-ID account replacement',async()=>{
  const {share,account}=setup('dropbox');let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(()=>new Promise(resolve=>finish=resolve))
  const pending=share.create(['1'],'Title','','pass');useFileSourcesStore().accounts=[{...account,name:'Replacement'}];finish({links:[{id:'1',url:'https://www.dropbox.com/s/link'}],has_more:false})
  await expect(pending).rejects.toThrow('账号已变化');expect(json).toHaveBeenCalledTimes(1);share.dispose()
 })
 it('does not update Ali title under a replaced account after original create returns',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share,account}=setup('aliyun',undefined,ids);let finish!:(value:any)=>void;vi.mocked(nativeCall).mockImplementation(()=>new Promise(resolve=>finish=resolve))
  const pending=share.create(ids,'Title','','');useFileSourcesStore().accounts=[{...account,userId:'Replacement'}];finish(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_name:'Server title'}))
  await expect(pending).rejects.toThrow('账号已变化');expect(nativeCall).toHaveBeenCalledTimes(1);share.dispose()
 })
 it('does not reuse an Ali cached share receipt after account replacement',async()=>{
  const ids=[JSON.stringify({driveId:'one',fileId:'a'})],{share,account}=setup('aliyun',undefined,ids)
  vi.mocked(nativeCall).mockResolvedValueOnce(response({share_id:'share',share_url:'https://www.alipan.com/s/public',share_name:'Server title'})).mockResolvedValueOnce(response({responses:[{id:'share',status:202,body:{share_id:'share',share_name:'Title'}}]}))
  await expect(share.create(ids,'Title','','')).rejects.toThrow('仍在执行');useFileSourcesStore().accounts=[{...account,name:'Replacement'}]
  await expect(share.create(ids,'Title','','')).rejects.toThrow('账号已变化');expect(nativeCall).toHaveBeenCalledTimes(2);share.dispose()
 })
 it('rejects a changed pane account even if the stored account is unchanged',async()=>{
  const {share,pane,account}=setup('box');pane.account={...account,name:'Different pane owner'}
  await expect(share.create(['1'],'Title','','')).rejects.toThrow('账号已变化');expect(json).not.toHaveBeenCalled();share.dispose()
 })

})
