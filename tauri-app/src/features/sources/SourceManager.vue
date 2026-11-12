<script setup lang="ts">
import {toast} from 'vue-sonner'
import { computed, onUnmounted, ref, watch } from 'vue'
import {readPreferences,writePreferences} from '@/features/servers/preferences'
import SavedSourceBrowser from '@/features/files/SavedSourceBrowser.vue'
import {useVideoCatalog} from '@/features/library/catalog'
import type { FolderCatalog } from '@/features/files/folderFavorites'
import { providerIcon } from '@/features/files/sourcePresentation'
import QRCode from 'qrcode'
import { X, ChevronLeft, ChevronRight, ChevronDown, Plus, Folder, Cloud, Server, HardDrive, Monitor, Network } from 'lucide-vue-next'
import { useFileSourcesStore } from '@/stores/fileSources'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { nativeCall } from '@/platform/native'
import { accountSave } from './transport'
import type { Account } from './contracts'

const props=defineProps<{folderCatalog?:FolderCatalog}>()
interface PlexDiscovery {sessionId:string;resources:{id:string;name:string;connections:number}[]}
const plexDiscovery=ref<PlexDiscovery>(),plexSelected=ref<string[]>([])
let plexGeneration=0
async function clearPlex(){plexGeneration++;const pending=plexDiscovery.value;plexDiscovery.value=undefined;plexSelected.value=[];if(pending)await nativeCall('plex_cancel_resources',{sessionId:pending.sessionId}).catch(()=>{})}
async function savePlex(){if(busy.value||!plexDiscovery.value||!plexSelected.value.length)return;busy.value=true;error.value='';try{const result=await nativeCall<{accounts:Account[];failed:number}>('plex_save_resources',{sessionId:plexDiscovery.value.sessionId,selected:plexSelected.value,name:name.value.trim()});plexDiscovery.value=undefined;toast.success(result.failed?'已添加 '+result.accounts.length+' 个 Plex 服务器，'+result.failed+' 个无法连接':'已添加 '+result.accounts.length+' 个 Plex 服务器');for(const account of result.accounts)emit('saved',account)}catch(cause){error.value=(cause as Error).message}finally{busy.value=false}}
const browsing=ref('')
async function selectSaved(id:string){await back();browsing.value=id}
const emit = defineEmits<{ saved: [account: Account]; close: []; local: []; select: [id: string] }>()
const options = [['smb','SMB'], ['nfs','NFS'], ['ftp','FTP'], ['webdav', 'WebDAV'], ['alist', 'AList'], ['jellyfin', 'Jellyfin'], ['emby', 'Emby'], ['plex', 'Plex'], ['alipan-open','阿里云盘'], ['baidu','百度网盘'], ['123','123网盘'], ['115', '115网盘'], ['quark', '夸克网盘'], ['guangya', '光鸭云盘'], ['pikpak', 'PikPak'], ['139', '139云盘'], ['189', '天翼云盘'], ['onedrive', 'OneDrive'], ['google', 'Google Drive'], ['dropbox', 'Dropbox'], ['box', 'Box']] as const
const provider = ref<string>('')
const authorizing=ref(false),localChoice=ref<{id:string;path:string;name:string}>(),savedLocal=ref<{id:string;name:string}>()
const deviceName=/Mac/i.test(navigator.platform)?'Mac':/Win/i.test(navigator.platform)?'PC':'Linux'
const authenticationForm=computed(()=>authorizing.value||['smb','nfs','ftp','webdav','alist','jellyfin','emby','plex'].includes(provider.value))
async function chooseLocal(){if(busy.value)return;busy.value=true;error.value='';try{const choice=await nativeCall<{id:string;path:string;name:string}|null>('local_choose_folder');if(choice){savedLocal.value=undefined;localChoice.value=choice;if(!name.value.trim())name.value=choice.name}}catch(cause){error.value=(cause as {message?:string}).message||'无法选择文件夹'}finally{busy.value=false}}
async function clearLocal(){const choice=localChoice.value;localChoice.value=undefined;savedLocal.value=undefined;if(choice)await nativeCall('local_cancel_folder',{selectionId:choice.id}).catch(()=>{})}
const sources = useFileSourcesStore(),catalog=useVideoCatalog()
const title = computed(() => options.find(option => option[0] === provider.value)?.[1] ?? '')
const icons: Record<string,string> = { '139':'cloud139', '189':'cloud189', 'alipan-open':'aliyun', baidu:'baidu', '123':'cloud123', '115':'drive115', quark:'quark', pikpak:'pikpak', onedrive:'onedrive', google:'google-drive', dropbox:'dropbox', box:'box', jellyfin:'jellyfin', emby:'emby', plex:'plex' }
const groups = [
 { title: '网络共享', ids: ['smb','ftp','nfs','webdav','alist'] },
 { title: '云服务', ids: ['google','dropbox','onedrive','box','alipan-open','123','115','baidu','pikpak','quark','139','189','guangya'] },
 { title: '媒体服务器', ids: ['plex','emby','jellyfin'] }
]
function chooseProvider(id: string) { browsing.value='';authorizing.value=false;void clearLocal();void clearPlex(); provider.value = id; name.value = ''; url.value = ''; username.value = ''; serverPort.value = ''; httpsMode.value = 'auto'; advanced.value = false;libraryMode.value=false }
async function back() {
 await clearQr()
 await clearLocal()
 await clearPlex()
 if (busy.value) await nativeCall('auth_cancel', { requestId }).catch(() => {})
 provider.value = '';browsing.value='';authorizing.value=false
}

const oauthProviders = ['onedrive', 'google', 'dropbox', 'box','baidu','123']
const alistToken = ref(false), otpCode = ref('')
const name = ref(''), url = ref(''), username = ref(''), secret = ref('')
const libraryMode=ref(false)
const advanced = ref(false), serverPort = ref(''), httpsMode = ref('auto')
const smsPhone = ref(''), smsCode = ref(''), smsSession = ref('')
const busy = ref(false), error = ref('')
const requestId = crypto.randomUUID()
type QrProvider = '115'|'quark'|'alipan-open'|'189'
const qrCommands = { '189':'cloud189', '115':'drive115', quark:'quark', 'alipan-open':'alipan' } as const
const qrNames = { '189':'天翼云盘', '115':'115', quark:'夸克', 'alipan-open':'阿里云盘' } as const
const qrProviders = Object.keys(qrCommands)
const qrKind=ref<QrProvider>('115')
const qrSession = ref(''), qrImage = ref(''), qrMessage = ref('')
let qrTimer: ReturnType<typeof setTimeout> | undefined
let alive = true
let qrGeneration = 0
async function clearSms() {
 const sessionId=smsSession.value;smsSession.value='';smsCode.value='';
 if(sessionId)await nativeCall('guangya_cancel',{sessionId}).catch(()=>{})
}
async function clearQr(preserveSession=false) {
  void clearSms()
  qrGeneration++
  if (qrTimer) clearTimeout(qrTimer)
  const sessionId = qrSession.value
  qrSession.value = ''; qrImage.value = ''
  if (sessionId && !preserveSession) await nativeCall(qrCommands[qrKind.value]+'_cancel', { sessionId }).catch(() => {})
}
async function cancel() {
  await clearPlex()
  await clearLocal()
  await clearQr()
  if (busy.value) await nativeCall('auth_cancel', { requestId }).catch(() => {})
  emit('close')
}
onUnmounted(() => { alive = false; void clearQr();void clearLocal();void clearPlex(); if (busy.value) void nativeCall('auth_cancel', { requestId }).catch(() => {}) })
watch(provider, () => { void clearQr(); qrMessage.value = ''; error.value = ''; secret.value = '' })
async function pollQr() {
  const sessionId = qrSession.value
  if (!alive || !sessionId) return
  try {
    const result = await nativeCall<{ status: string; account?: Account }>(qrCommands[qrKind.value]+'_poll', { sessionId })
    if (!alive || qrSession.value !== sessionId) return
    if (result.account) { qrSession.value = ''; secret.value = ''; emit('saved', result.account); return }
    if (result.status === 'expired') { qrMessage.value = '二维码已失效，请重新生成'; if(qrKind.value!=='alipan-open')await clearQr(); return }
    qrMessage.value = result.status === 'scanned' ? `已扫码，请在 ${qrNames[qrKind.value]} App 确认` : `请用 ${qrNames[qrKind.value]} App 扫码确认`
    qrTimer = setTimeout(() => void pollQr(), 2000)
  } catch (e) { if (!alive || qrSession.value !== sessionId) return; qrMessage.value = (e as { message?: string })?.message || '扫码状态请求失败，请重新生成'; await clearQr() }
}
async function webLogin() {
  if (busy.value) return
  busy.value=true;error.value=''
  await clearQr()
  try { const account=await nativeCall<Account>('aliyun_login',{requestId,name:name.value.trim()});if(alive)emit('saved',account) }
  catch(e){if(alive)error.value=(e as {message?:string})?.message||'网页登录失败，请重试'}
  finally{busy.value=false}
}
async function save() {
  if (busy.value) return
  if(provider.value!=='local'&&!authenticationForm.value){authorizing.value=true;return}
  busy.value = true; error.value = ''
  try {
    if(provider.value==='local'){if(!localChoice.value)return;const source=savedLocal.value||await nativeCall<{id:string;name:string}>('local_save_chosen_source',{selectionId:localChoice.value.id,name:name.value.trim()});savedLocal.value=source;await sources.refresh();if(props.folderCatalog)await props.folderCatalog.scanFolder(source.id,'');else await catalog.scan(source.id);localChoice.value=undefined;savedLocal.value=undefined;emit('close');return}
    if (provider.value === '139') {
      const generation=qrGeneration
      const account=await nativeCall<Account>('cloud139_login',{requestId,name:name.value.trim(),authorization:secret.value.trim()})
      secret.value='';if(alive && generation===qrGeneration)emit('saved',account)
      return
    }
    if (provider.value === 'pikpak') {
      const generation=qrGeneration
      const account=await nativeCall<Account>('pikpak_login',{requestId,name:name.value.trim(),username:username.value,password:secret.value})
      secret.value='';if(alive && generation===qrGeneration)emit('saved',account)
      return
    }
    if (provider.value === 'guangya') {
      const generation=qrGeneration
      if (!smsSession.value) {
        const result=await nativeCall<{sessionId:string}>('guangya_sms',{requestId,phoneNumber:smsPhone.value.trim(),name:name.value.trim()})
        if(!alive || generation!==qrGeneration || provider.value!=='guangya'){await nativeCall('guangya_cancel',{sessionId:result.sessionId}).catch(()=>{});return}
        smsSession.value=result.sessionId
      } else {
        const sessionId=smsSession.value;smsSession.value=''
        const account=await nativeCall<Account>('guangya_login',{requestId,sessionId,code:smsCode.value.trim()})
        smsCode.value='';if(alive && generation===qrGeneration)emit('saved',account)
      }
      return
    }
    if (qrProviders.includes(provider.value)) {
      const previous=qrSession.value, paired=provider.value==='alipan-open'
      await clearQr(paired && !!previous)
      const generation = qrGeneration
      const kind = provider.value as QrProvider
      qrKind.value=kind
      const result = await nativeCall<{ sessionId: string; content?: string; imageDataUrl?: string }>(paired?(previous?'alipan_renew':'aliyun_begin'):qrCommands[qrKind.value]+'_begin', paired?(previous?{sessionId:previous}:{requestId,name:name.value.trim()}):provider.value==='189'?{requestId,name:name.value.trim()}:provider.value==='115'?{ clientId: '', clientSecret: null, name: name.value.trim() || '115' }:{name:name.value.trim()})
      if (!alive || generation !== qrGeneration || provider.value !== kind) { await nativeCall(qrCommands[kind]+'_cancel', {sessionId:result.sessionId}).catch(()=>{}); return }
      qrSession.value = result.sessionId
      qrImage.value = result.imageDataUrl || await QRCode.toDataURL(result.content || '', { width: 240, margin: 2 })
      qrMessage.value = `请用 ${qrNames[qrKind.value]} App 扫码`
      qrTimer = setTimeout(() => void pollQr(), 2000)
      return
    }
    if (oauthProviders.includes(provider.value)) {
      const saved = await nativeCall<Account>('oauth_login', { requestId, providerId: provider.value, clientId: '', clientSecret: null, name: name.value.trim(), callbackPort: ['dropbox', 'box','baidu','123'].includes(provider.value) ? 53684 : 0 })
      secret.value = ''; emit('saved', saved); return
    }
    if(provider.value==='plex'){
      const generation=plexGeneration;const result=await nativeCall<PlexDiscovery>('plex_login',{requestId});
      if(!alive||generation!==plexGeneration||provider.value!=='plex'){await nativeCall('plex_cancel_resources',{sessionId:result.sessionId}).catch(()=>{});return}
      plexDiscovery.value=result;plexSelected.value=result.resources.map(resource=>resource.id);return
    }
    if(['smb','nfs','ftp'].includes(provider.value)){const saved=await nativeCall<Account>('network_share_connect',{requestId,provider:provider.value,name:name.value.trim()||'我的 '+title.value,address:url.value,username:username.value,password:secret.value,rootPath:'/'});secret.value='';emit('saved',saved);return}
    const address = url.value.trim()
    if (address.includes('://') && !/^https?:\/\//i.test(address)) throw new Error('请输入 HTTP(S) 来源地址')
    const base = new URL(/^https?:\/\//i.test(address) ? address : `${httpsMode.value === 'https' ? 'https' : 'http'}://${address}`)
    if (httpsMode.value !== 'auto') base.protocol = httpsMode.value + ':'
    if (serverPort.value) {
      if (!/^\d+$/.test(serverPort.value) || Number(serverPort.value) < 1 || Number(serverPort.value) > 65535) throw new Error('请输入有效端口')
      base.port = serverPort.value
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('请输入不含凭据和查询参数的 HTTP(S) 来源地址')
    if (provider.value === 'jellyfin' || provider.value === 'emby' || (provider.value === 'alist' && !alistToken.value)) {
      const saved = await nativeCall<Account>('server_login', { requestId, providerId: provider.value, baseUrl: base.href.replace(/\/$/, ''), name: name.value.trim() || '我的 '+title.value, username: username.value, password: secret.value, ...(provider.value === 'alist' ? {otpCode: otpCode.value.trim() || null} : {}) })
      secret.value = '';if(['jellyfin','emby'].includes(provider.value))writePreferences(saved.id,{...readPreferences(saved.id),libraryMode:libraryMode.value}); emit('saved', saved); return
    }
    let headers: Record<string, string>
    if (provider.value === 'webdav') {
      const bytes = new TextEncoder().encode(`${username.value}:${secret.value}`)
      headers = { Authorization: `Basic ${btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))}` }
    } else headers = secret.value ? { Authorization: secret.value } : {}
    const saved = await accountSave({ id: '', providerId: provider.value as 'webdav' | 'alist', name: name.value.trim() || '我的 '+title.value, baseUrl: base.href, authOrigins: [base.origin] }, { headers })
    secret.value = ''; emit('saved', saved)
  } catch (e) { if (qrProviders.includes(provider.value)) await clearQr(); error.value = e instanceof Error ? e.message : (e as { message?: string })?.message || '无法保存来源' }
  finally { busy.value = false }
}
</script>
<template>
  <DialogRoot :open="true" @update:open="value => { if (!value) void cancel() }">
    <DialogPortal>
      <DialogOverlay class="source-overlay" />
      <DialogContent class="source-dialog" @pointer-down-outside="event => { if (busy) event.preventDefault() }">
        <aside class="source-sidebar">
          <button class="source-close" type="button" aria-label="关闭添加来源" @click="cancel"><X :size="22" /></button>
          <div class="saved-heading">已存储的共享</div>
          <button class="saved-source" :class="{ active: !browsing }" type="button" @click="back"><Plus :size="18" />添加…</button>
          <button class="saved-source" :class="{active:browsing==='device'}" type="button" @click="selectSaved('device')"><Monitor :size="20"/><span>{{deviceName}}</span></button>

          <button v-for="account in sources.accounts.filter(a => a.providerId !== 'boxplayer')" :key="account.id" class="saved-source" type="button" @click="selectSaved(account.id)"><img v-if="providerIcon(account.providerId)" class="provider-icon" :src="providerIcon(account.providerId)" alt=""/><Cloud v-else :size="18" /><span>{{ sources.preferences.names[account.id]||account.name }}</span></button>
        </aside>
        <div class="source-main">
          <header class="source-header" :class="{ catalog: !provider&&!browsing }">
            <button v-if="provider||browsing" class="source-back" type="button" aria-label="返回来源列表" @click="back"><ChevronLeft :size="22" /></button>
            <DialogTitle class="source-title">{{plexDiscovery?'选择 Plex 服务器':browsing==='device'?deviceName:browsing?(sources.accounts.find(a=>a.id===browsing)?.name||sources.snapshot.localFolders.find(f=>f.id===browsing)?.name):provider==='local'?'添加本地文件夹':provider?'添加 '+title:'添加共享'}}</DialogTitle>
            <DialogDescription class="sr-only">选择文件来源，连接网盘或服务器，或添加本地文件夹。</DialogDescription>
          </header>
          <SavedSourceBrowser v-if="browsing" :key="browsing" :device="browsing==='device'" :source-id="browsing==='device'?undefined:browsing" :folder-catalog="folderCatalog"/>
          <div v-else-if="!provider" class="source-catalog">
            <section><h3>本地共享</h3><div class="provider-group"><button class="provider-row" type="button" @click="chooseProvider('local')"><Folder :size="25" /><span>添加本地文件夹</span><ChevronRight :size="17" /></button></div></section>
            <section v-for="group in groups" :key="group.title"><h3>{{ group.title }}</h3><div class="provider-group">
              <button v-for="option in group.ids.flatMap(id=>options.filter(item=>item[0]===id))" :key="option[0]" class="provider-row" type="button" @click="chooseProvider(option[0])"><img v-if="providerIcon(option[0])" class="provider-icon" :src="providerIcon(option[0])" alt="" /><component v-else :is="group.title === '媒体服务器' ? Server : group.title === '网络共享' ? Network : Cloud" :size="25" /><span>{{ option[1] }}</span><ChevronRight :size="17" /></button>
            </div></section>
          </div>
          <form v-else-if="plexDiscovery" class="plex-modal" @submit.prevent="savePlex"><p v-if="!plexDiscovery.resources.length" class="plex-empty">没有可用的 Plex 资源</p><div class="plex-resource-list"><button v-for="resource in plexDiscovery.resources" :key="resource.id" type="button" class="plex-resource-row" :class="{selected:plexSelected.includes(resource.id)}" :aria-pressed="plexSelected.includes(resource.id)" @click="plexSelected=plexSelected.includes(resource.id)?plexSelected.filter(id=>id!==resource.id):[...plexSelected,resource.id]"><Server :size="20"/><span><strong>{{resource.name}}</strong><small>{{resource.connections}} 个可用连接</small></span><input type="checkbox" :checked="plexSelected.includes(resource.id)" tabindex="-1" aria-hidden="true"/></button></div><p v-if="error" role="alert">{{error}}</p><footer class="plex-actions"><button type="button" :disabled="busy" @click="back">取消</button><Button type="submit" :disabled="busy||!plexSelected.length">保存</Button></footer></form>
          <form v-else class="source-form" :class="{'server-connection':['jellyfin','emby','plex'].includes(provider)}" @submit.prevent="save">
          <label>名称<input v-model="name" :disabled="busy" :placeholder="provider==='local'?'文件夹名称':'我的 '+title" autocomplete="off" /></label>
          <label>通讯协议<span class="protocol-name">{{ provider==='local'?deviceName:title }}</span></label>
          <label v-if="provider==='local'">文件夹<span class="local-path"><span>{{localChoice?.path}}</span><button type="button" :disabled="busy" @click="chooseLocal">选择文件夹</button></span></label>
          <template v-if="authenticationForm">
          <label v-if="!['guangya','pikpak','139','plex'].includes(provider) && !oauthProviders.includes(provider) && !qrProviders.includes(provider)">地址<input v-model="url" :disabled="busy" :placeholder="['jellyfin','emby','plex'].includes(provider) ? 'iMac.local' : 'https://server.example/dav/'" required autocomplete="off" /></label>
          <label v-if="!['guangya','139','nfs'].includes(provider) && !oauthProviders.includes(provider) && provider !== 'plex' && !qrProviders.includes(provider) && (provider !== 'alist' || !alistToken)">用户名<input v-model="username" :disabled="busy" placeholder="johnappleseed" autocomplete="off" /></label>
          <label v-if="!['guangya','nfs'].includes(provider) && !oauthProviders.includes(provider) && provider !== 'plex' && !qrProviders.includes(provider)">{{ provider === '139' ? 'Authorization' : provider === 'alist' && alistToken ? '访问令牌' : '密码' }}<input v-model="secret" :disabled="busy" :placeholder="provider==='139'?'Authorization':'密码'" type="password" autocomplete="off" /></label>
          <template v-if="provider === 'alist'"><label v-if="!alistToken">二步验证码<input v-model="otpCode" :disabled="busy" placeholder="可选" inputmode="numeric" autocomplete="one-time-code" /></label><button type="button" class="advanced-toggle" :disabled="busy" @click="alistToken=!alistToken;secret=''">{{ alistToken ? '使用用户名和密码' : '使用访问令牌' }}</button></template>
          <template v-if="['webdav','alist','jellyfin','emby'].includes(provider)">
            <button class="advanced-toggle" type="button" :aria-expanded="advanced" @click="advanced=!advanced">高级<ChevronDown :size="16" :style="{transform:advanced?'rotate(180deg)':undefined}"/></button>
            <template v-if="advanced && !oauthProviders.includes(provider) && provider !== '115'"><label>端口<input v-model="serverPort" :disabled="busy" inputmode="numeric" :placeholder="provider === 'emby' || provider === 'jellyfin' ? '8096' : '默认'" /></label><label>HTTPS<select v-model="httpsMode" :disabled="busy"><option value="auto">自动</option><option value="https">启用</option><option value="http">停用</option></select></label><label v-if="['jellyfin','emby'].includes(provider)" class="library-mode">媒体库模式<input v-model="libraryMode" type="checkbox" :disabled="busy"/></label></template>
          </template>
          <template v-if="provider==='guangya'"><label>手机号<input v-model="smsPhone" :disabled="busy || !!smsSession" inputmode="tel" autocomplete="tel" required /></label><label v-if="smsSession">短信验证码<input v-model="smsCode" :disabled="busy" inputmode="numeric" autocomplete="one-time-code" required /></label><button v-if="smsSession" type="button" class="advanced-toggle" :disabled="busy" @click="clearSms">重新获取验证码</button></template>
          <img v-if="qrImage" :src="qrImage" :alt="qrNames[qrKind]+' 登录二维码'" width="240" height="240" />
          <p v-if="qrMessage" role="status">{{ qrMessage }}</p>
          <p v-if="error" class="source-error" role="alert">{{ error }}</p>
          <button v-if="provider==='alipan-open'" class="advanced-toggle" type="button" :disabled="busy" @click="webLogin">使用网页登录</button>
          </template>
          <div class="source-buttons"><Button type="submit" :disabled="busy||(provider==='local'&&!localChoice)||(['jellyfin','emby','webdav','alist'].includes(provider)&&!url.trim())">{{provider==='local'?'保存':!authenticationForm?'连接': busy ? '正在连接…' : provider === 'guangya' ? (smsSession ? '登录' : '获取短信验证码') : qrProviders.includes(provider) ? '生成二维码' : provider==='plex'?'连接':oauthProviders.includes(provider) ? '在浏览器登录' : '新增' }}</Button></div>
          </form>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
<style scoped>
.source-overlay { position: fixed; inset: 0; z-index: 100; background: #0002; backdrop-filter: blur(1px); }
.source-dialog { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 101; outline: none; width: min(840px, 92vw); height: min(680px, 78vh); display: grid; grid-template-columns: 30% minmax(0,1fr); overflow: hidden; background: var(--background); color: var(--foreground); border: 1px solid var(--control-border); border-radius: 16px; box-shadow: 0 24px 65px #0004; }
.source-sidebar { background: var(--sidebar-surface); backdrop-filter: blur(24px); padding: 76px 16px 20px; overflow: auto; }
.source-close, .source-back { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 50%; background: var(--control-surface); color: inherit; box-shadow: inset 0 1px 1px #fff8, 0 2px 6px #00000005; cursor: pointer; }
.source-close { position: absolute; top: 16px; left: 22px; }
.saved-heading { color: var(--muted-text); font-size: 12px; margin: 16px 0 10px; }
.saved-source { width: 100%; display: flex; align-items: center; gap: 10px; min-height:34px;padding:7px 8px; border: 0; border-radius: 7px; text-align: left; color: inherit; background: transparent; font-size: 13px; cursor: pointer; }
.saved-source span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.saved-source svg { color: var(--primary); flex: none; }
.saved-source.active, .saved-source:hover { background: var(--muted); }
.source-main { min-width: 0; display: flex; flex-direction: column; overflow: auto; }
.source-header { position: sticky; top: 0; min-height: 62px; display: grid; place-items: center; background: var(--background); z-index: 1; flex-shrink: 0; }
.source-back { position: absolute; left: 12px; top: 12px; }
.source-title { font-size: 15px; font-weight: 600; }
.source-header.catalog { background: var(--background); }
.source-catalog { padding: 0 22px 24px; background: var(--secondary); flex: 1; }
.source-catalog h3 { margin: 20px 20px 8px; color: var(--muted-text); font-size: 13px; font-weight: 500; }
.provider-group { border-radius: 13px; background: var(--background); padding: 0 20px; }
.provider-row { border: 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; background: transparent; color: inherit; width: 100%; min-height: 48px; text-align: left; font-size: 14px; cursor: pointer; }
.provider-icon { width: 28px; height: 28px; object-fit: contain; flex: none; }
.provider-row:last-child { border-bottom: 0; }
.provider-row:hover { color: var(--primary); }
.provider-row > svg:first-child { color: var(--primary); flex: none; }
.provider-row > svg:last-child { margin-left: auto; color: var(--muted-text); }
.source-form { padding: 34px 38px; display: grid; gap: 8px; align-content: start; }
.source-form label { display: grid; grid-template-columns: 100px minmax(0,1fr); min-height: 30px; align-items: center; gap: 16px; font-size: 14px; text-align: right; }
.source-form input { min-width: 0; width: 100%; border: 0; border-bottom: 1px solid transparent; padding: 4px 0; background: transparent; color: inherit; outline-offset: 3px; }
.advanced-toggle { justify-self: center; border: 0; border-radius: 20px; padding: 5px 12px; background: var(--secondary); color: var(--muted-text); font-size: 12px; cursor: pointer; }
.source-form select { padding: 6px; border: 0; border-radius: 7px; background: var(--secondary); color: inherit; }
.protocol-name { text-align: left; color: var(--muted-text); }
.source-description { color: var(--muted-text); font-size: 12px; margin: 0; }
.source-form input:focus { border-bottom-color: var(--primary); }
.source-form > img { justify-self: center; }
.source-buttons { display: flex; justify-content: center; gap: 8px; margin-top: 10px; }
.source-buttons > button { min-width: 128px; height: 30px; border-radius: 5px; font-size: 14px; }
.source-error { color: #c33; }
@media (max-width: 650px) { .source-dialog { grid-template-columns: 32% minmax(0,1fr); } .source-sidebar { padding-inline: 8px; } .source-form { padding: 20px 16px; } .source-form label { grid-template-columns: 1fr; gap: 5px; text-align: left; } }
.source-header{min-height:64px;padding:0 55px}.source-back{left:20px;top:16px}.source-title{font-size:17px;font-weight:650}.source-catalog{padding:0 30px 24px}.source-catalog h3{font-size:12px;font-weight:500;margin:20px 0 10px}.provider-group{background:transparent;border-radius:0}.provider-row{min-height:44px;padding:8px 0;border:0;gap:14px;font-size:14px;font-weight:550}.source-form{max-width:520px;width:100%;align-self:center;padding:56px 28px 32px}.source-form label{min-height:40px}.source-form input{padding:8px 4px;border:0;border-radius:4px;background:transparent}.source-buttons{justify-content:flex-start;margin:24px 0 0 116px}.source-buttons>button{min-height:36px;border-radius:7px}.local-path{display:flex;flex-direction:column;align-items:flex-start;gap:10px;text-align:left;overflow-wrap:anywhere}.local-path button{border:1px solid var(--control-border);border-radius:7px;padding:6px 16px;background:var(--secondary)}
.source-form.server-connection{width:calc(100% - 56px);max-width:none;margin:0 28px;padding:20px 0 0;gap:0}.server-connection .advanced-toggle{justify-self:start;display:flex;align-items:center;gap:12px;padding:12px 0;margin:22px 0 4px 116px;background:transparent;border-radius:0;font-size:14px}.server-connection .source-buttons{margin:24px 0 0 116px}.server-connection .source-buttons>button{width:145px;height:42px;border-radius:9px}.source-main:has(.server-connection) .source-header{margin:0 28px;padding:0;width:calc(100% - 56px)}.source-main:has(.server-connection) .source-back{left:0;top:20px;width:40px;height:40px}
.saved-heading{margin:16px 8px 8px}.source-main:has(.server-connection){padding-top:10px}.source-main:has(.server-connection) .source-title{font-weight:700;line-height:26.714px;margin:0}.server-connection input:not([type=checkbox]){line-height:22px}.server-connection .protocol-name{padding:8px 4px;line-height:22px}.server-connection .advanced-toggle{line-height:22px}.server-connection .source-buttons{margin-top:26px}.server-connection .source-buttons>button{font-size:16px}.server-connection>label:first-child input::placeholder{color:var(--foreground)}.library-mode input{width:16px;height:16px;margin:0;justify-self:start;accent-color:var(--primary)}
</style>

<style scoped>
.plex-modal{padding:4px 28px 6px}.plex-empty{min-height:180px;display:grid;place-items:center;color:var(--muted-text);font-size:16px}.plex-resource-list{display:flex;flex-direction:column;gap:12px;max-height:420px;overflow:auto;padding-right:4px}.plex-resource-row{width:100%;border:1px solid var(--border);background:var(--control-surface);border-radius:18px;padding:16px 18px;display:flex;align-items:center;gap:14px;text-align:left}.plex-resource-row.selected{border-color:var(--primary)}.plex-resource-row>span{flex:1;min-width:0}.plex-resource-row strong{display:block;font-size:17px;font-weight:700}.plex-resource-row small{display:block;margin-top:2px;font-size:13px;color:var(--muted-text)}.plex-resource-row input{accent-color:var(--primary)}.plex-actions{display:flex;justify-content:flex-end;gap:10px;padding-top:18px}
</style>

<style scoped>.plex-actions>button{height:32px;padding:4px 15px;border-radius:4px}</style>
