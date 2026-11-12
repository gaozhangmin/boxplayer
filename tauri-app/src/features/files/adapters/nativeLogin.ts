import {computed,ref,reactive,onUnmounted} from 'vue'
import QRCode from 'qrcode'
import {nativeCall} from '@/platform/native'
import {accountSave} from '@/features/sources/transport'
import {useFileSourcesStore} from '@/stores/fileSources'
import type {Account} from '@/features/sources/contracts'
import {nativeProvider,getDriveProviderMeta,message} from './sourceServices'
export function useNativeLogin(props:{provider?:string;sourceName?:string},emit:{(event:'connected'):void;(event:'cancel'):void}){
 const requestId=crypto.randomUUID(),loginVisible=ref(true),loginProvider=ref(props.provider||'aliyun'),loginProviders=['aliyun','cloud123','115','139','189','guangya','baidu','pikpak','quark','dropbox','onedrive','box','google','smb','nfs','ftp','webdav','alist']
 const loginCur=ref(props.provider==='aliyun'?1:2),loginStatus=ref<'process'|'error'|'finish'|'wait'>('process'),loginLoading=ref(false),qrCodeUrl=ref(''),qrCodeStatusType=ref<'info'|'error'|'success'>('info'),qrCodeStatusTips=ref('请扫码登录'),busy=ref(false),sms=ref(''),secret=ref(''),phone=ref(''),code=ref(''),username=ref(''),password=ref('')
 const remoteDriveForm=reactive({name:props.sourceName||'',url:'',username:'',password:'',rootPath:'/',mountPort:''})
 let session='',kind='',timer:ReturnType<typeof setTimeout>|undefined,generation=0,alive=true
 const commands:Record<string,string>={'115':'drive115',quark:'quark',aliyun:'alipan','189':'cloud189'}
 async function clear(preserveSession=false){generation++;if(timer)clearTimeout(timer);timer=undefined;const previous=session;session='';if(previous&&kind&&!preserveSession)await nativeCall(kind+'_cancel',{sessionId:previous}).catch(()=>{})}
 async function connected(_account:Account){if(!alive)return;await useFileSourcesStore().refresh();if(!alive)return;loginVisible.value=false;emit('connected')}
 async function execute(action:()=>Promise<void>){if(busy.value)return;busy.value=true;try{await action()}catch(error){if(alive){loginStatus.value='error';qrCodeStatusType.value='error';qrCodeStatusTips.value=(error as {message?:string}).message||String(error);message.error(qrCodeStatusTips.value)}}finally{busy.value=false;loginLoading.value=false}}
 async function poll(current:number){
  const previous=session;if(!alive||generation!==current||!previous)return
  try{
   const result=await nativeCall<{account?:Account;status:string}>(kind+'_poll',{sessionId:previous})
   if(!alive||generation!==current)return
   if(result.account){session='';loginStatus.value='finish';await connected(result.account);return}
   qrCodeStatusTips.value=result.status==='scanned'?'已扫码，请在手机确认':loginProvider.value==='aliyun'?'请再次扫码完成开放平台授权':'请扫码登录'
   if(['expired','cancelled','error'].includes(result.status)){
    if(loginProvider.value==='aliyun'&&result.status==='expired'){qrCodeStatusTips.value='第二次授权二维码已过期，点击二维码刷新';qrCodeStatusType.value='error';return}
    await clear();qrCodeStatusTips.value='二维码已失效，请刷新';return
   }
   timer=setTimeout(()=>void poll(current),2000)
  }catch(error){if(alive&&generation===current){qrCodeStatusTips.value=(error as {message?:string}).message||String(error);qrCodeStatusType.value='error'}}
 }
 async function qr(){await execute(async()=>{
  const previous=session,second=loginProvider.value==='aliyun'&&loginCur.value===2&&!!previous
  await clear(second);kind=commands[loginProvider.value];if(!kind)return
  loginLoading.value=true;loginStatus.value='process';qrCodeUrl.value=''
  if(loginProvider.value==='aliyun'&&!second){loginCur.value=1;qrCodeStatusTips.value='请在登录窗口完成第一次扫码或账号登录'}
  const current=generation
  const result=await nativeCall<{sessionId:string;content?:string;imageDataUrl?:string}>(loginProvider.value==='aliyun'?(second?'alipan_renew':'aliyun_begin'):kind+'_begin',loginProvider.value==='aliyun'?(second?{sessionId:previous}:{requestId,name:props.sourceName||''}):loginProvider.value==='189'?{requestId,name:props.sourceName||''}:loginProvider.value==='115'?{clientId:'',clientSecret:null,name:props.sourceName||'115'}:{name:props.sourceName||''})
  if(!alive||current!==generation){await nativeCall(kind+'_cancel',{sessionId:result.sessionId}).catch(()=>{});return}
  session=result.sessionId;qrCodeUrl.value=result.imageDataUrl||await QRCode.toDataURL(result.content||'',{width:250,margin:2});if(loginProvider.value==='aliyun')loginCur.value=2
  qrCodeStatusType.value='info';qrCodeStatusTips.value=loginProvider.value==='aliyun'?'第一次登录已完成，请再次扫码完成开放平台授权':'请扫码登录';timer=setTimeout(()=>void poll(current),2000)
 })}
 async function oauth(){await execute(async()=>{const providerId=nativeProvider(loginProvider.value),current=generation;const account=await nativeCall<Account>('oauth_login',{requestId,providerId,clientId:'',clientSecret:null,name:props.sourceName||'',callbackPort:['dropbox','box','baidu','123'].includes(providerId)?53684:0});if(alive&&current===generation)await connected(account)})}
 async function submitRemoteDrive(){await execute(async()=>{if(['smb','nfs','ftp'].includes(loginProvider.value)){if(loginProvider.value==='nfs'&&remoteDriveForm.mountPort&&(!/^\d+$/.test(remoteDriveForm.mountPort)||Number(remoteDriveForm.mountPort)<1||Number(remoteDriveForm.mountPort)>65535))throw Error('请输入有效的 Mount 端口');const saved=await nativeCall<Account>('network_share_connect',{requestId,provider:loginProvider.value,name:remoteDriveForm.name||props.sourceName||loginProvider.value.toUpperCase(),address:remoteDriveForm.url,username:remoteDriveForm.username,password:remoteDriveForm.password,rootPath:remoteDriveForm.rootPath,mountPort:loginProvider.value==='nfs'&&remoteDriveForm.mountPort?Number(remoteDriveForm.mountPort):null});remoteDriveForm.password='';await connected(saved);return}const base=new URL(remoteDriveForm.url);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('请输入有效的 HTTP(S) 地址');let saved:Account;if(loginProvider.value==='alist')saved=await nativeCall('server_login',{requestId,providerId:'alist',baseUrl:base.href,name:remoteDriveForm.name,username:remoteDriveForm.username,password:remoteDriveForm.password,otpCode:null});else saved=await accountSave({id:'',providerId:'webdav',name:remoteDriveForm.name||'WebDAV',baseUrl:base.href,authOrigins:[base.origin]},{headers:{Authorization:'Basic '+btoa(Array.from(new TextEncoder().encode(remoteDriveForm.username+':'+remoteDriveForm.password),b=>String.fromCharCode(b)).join(''))}});if(loginProvider.value==='webdav'&&remoteDriveForm.rootPath.trim()&&remoteDriveForm.rootPath.trim()!=='/')saved=await nativeCall('webdav_update_connection',{accountId:saved.id,name:saved.name,url:remoteDriveForm.url,username:remoteDriveForm.username,password:null,rootPath:remoteDriveForm.rootPath});remoteDriveForm.password='';await connected(saved)})}
 async function sendGuangyaSmsCode(){await execute(async()=>{if(sms.value)await nativeCall('guangya_cancel',{sessionId:sms.value}).catch(()=>{});const result=await nativeCall<{sessionId:string}>('guangya_sms',{requestId,phoneNumber:phone.value.trim(),name:props.sourceName||''});if(!alive){await nativeCall('guangya_cancel',{sessionId:result.sessionId}).catch(()=>{});return}sms.value=result.sessionId})}
 async function submitGuangyaLogin(){await execute(async()=>{if(!sms.value)throw Error('请先获取短信验证码');const sessionId=sms.value;sms.value='';const account=await nativeCall<Account>('guangya_login',{requestId,sessionId,code:code.value});code.value='';await connected(account)})}
 async function submitPikPakLogin(){await execute(async()=>{const account=await nativeCall<Account>('pikpak_login',{requestId,name:props.sourceName||'',username:username.value,password:password.value});password.value='';await connected(account)})}
 async function submitCloud139Login(){await execute(async()=>{const account=await nativeCall<Account>('cloud139_login',{requestId,name:props.sourceName||'',authorization:secret.value});secret.value='';await connected(account)})}
 function handleModalOpen(){if(commands[loginProvider.value])void qr();else if(['cloud123','baidu','dropbox','onedrive','box','google'].includes(loginProvider.value))void oauth()}
 function handleClose(){void clear();void nativeCall('auth_cancel',{requestId}).catch(()=>{})}
 onUnmounted(()=>{alive=false;void clear();void nativeCall('auth_cancel',{requestId}).catch(()=>{});if(sms.value)void nativeCall('guangya_cancel',{sessionId:sms.value}).catch(()=>{});remoteDriveForm.password='';password.value='';secret.value=''})
 return {loginVisible,loginProvider,loginProviders,getLoginProviderMeta:getDriveProviderMeta,activeLoginProviderMeta:computed(()=>getDriveProviderMeta(loginProvider.value)),loginCur,loginStatus,loginLoading,qrCodeUrl,qrCodeStatusType,qrCodeStatusTips,drive115Tips:qrCodeStatusTips,drive115Loading:busy,cloud139Authorization:secret,cloud139Loading:busy,cloud189QrStatusType:qrCodeStatusType,cloud189Tips:qrCodeStatusTips,cloud189Loading:busy,guangyaPhone:phone,guangyaCode:code,guangyaLoading:busy,guangyaSmsState:sms,pikpakUsername:username,pikpakPassword:password,pikpakLoading:busy,quarkQrImageUrl:qrCodeUrl,quarkQrStatusType:qrCodeStatusType,quarkTips:qrCodeStatusTips,quarkLoading:busy,dropboxLoading:busy,onedriveLoading:busy,boxLoading:busy,googleLoading:busy,remoteDriveForm,remoteDriveLoading:busy,handleModalOpen,handleClose,handleRefreshQrCodeUrl:qr,handleRefresh115Qr:qr,submitCloud139Login,handleOpen189:qr,sendGuangyaSmsCode,submitGuangyaLogin,handleReopenCloud123:oauth,handleReopenBaidu:oauth,submitPikPakLogin,handleOpenQuark:qr,handleReopenDropbox:oauth,handleReopenOneDrive:oauth,handleReopenBox:oauth,handleReopenGoogle:oauth,submitRemoteDrive}
}
