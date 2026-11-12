<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import QRCode from 'qrcode'
import { X, CircleUserRound } from 'lucide-vue-next'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { nativeCall, asAppError } from '@/platform/native'
import { useFileSourcesStore } from '@/stores/fileSources'
import type { Account } from './contracts'
import { useMembershipStore } from '@/stores/membership'
import { storeToRefs } from 'pinia'
const emit=defineEmits<{close:[]}>(),sources=useFileSourcesStore()
const accounts=computed(()=>sources.accounts.filter(a=>a.providerId==='boxplayer'))
const memberStore=useMembershipStore()
const {selectedId:selected,membership}=storeToRefs(memberStore)
const busy=ref(false),error=ref(''),qr=ref(''),code=ref(''),confirm=ref(false)
const tier=computed(()=>membership.value?.isPro?memberStore.label:'标准账户')
let alive=true,sequence=0,requestId='',sessionId='',timer:ReturnType<typeof setTimeout>|undefined
function cancel(){clearTimeout(timer);if(requestId)void nativeCall('auth_cancel',{requestId}).catch(()=>{});if(sessionId)void nativeCall('boxplayer_cancel',{sessionId}).catch(()=>{});requestId='';sessionId='';qr.value='';code.value=''}
async function refresh(){const generation=++sequence;error.value='';if(!selected.value)return;busy.value=true;await memberStore.refresh();if(alive&&sequence===generation){error.value=memberStore.error;busy.value=false}}
async function login(){cancel();const generation=++sequence;busy.value=true;memberStore.invalidate();error.value='';requestId=crypto.randomUUID();try{const result=await nativeCall<{sessionId:string;content:string;userCode:string;interval:number;expiresIn:number}>('boxplayer_begin',{requestId});if(!alive||generation!==sequence){void nativeCall('boxplayer_cancel',{sessionId:result.sessionId}).catch(()=>{});return}requestId='';sessionId=result.sessionId;const image=await QRCode.toDataURL(result.content,{width:240,margin:2});if(!alive||generation!==sequence)return;qr.value=image;code.value=result.userCode;busy.value=false;poll(generation,result.sessionId,Math.max(2,result.interval)*1000,Date.now()+result.expiresIn*1000)}catch(cause){if(alive&&generation===sequence){cancel();error.value=asAppError(cause).message;busy.value=false}}}
function poll(generation:number,id:string,interval:number,expires:number){timer=setTimeout(async()=>{if(!alive||generation!==sequence)return;if(Date.now()>=expires){cancel();error.value='二维码已过期，请重新登录';return}try{const result=await nativeCall<{pending:boolean;account?:Account}>('boxplayer_poll',{sessionId:id});if(!alive||generation!==sequence)return;if(result.pending){poll(generation,id,interval,expires);return}if(result.account?.providerId!=='boxplayer')throw new Error('账号确认响应无效');cancel();await sources.refresh();if(!alive||generation!==sequence)return;selected.value=result.account.id;await refresh()}catch(cause){if(alive&&generation===sequence){cancel();error.value=asAppError(cause).message}}},interval)}
async function logout(){if(!confirm.value){confirm.value=true;return}const id=selected.value;cancel();++sequence;busy.value=true;memberStore.invalidate();try{await nativeCall('account_remove',{accountId:id});await sources.refresh();selected.value=accounts.value[0]?.id||'';confirm.value=false}catch(cause){if(alive)error.value=asAppError(cause).message}finally{if(alive)busy.value=false}}
async function purchase(){try{await nativeCall('open_website',{target:'pro'})}catch(cause){if(alive)error.value=asAppError(cause).message}}
async function browserLogin(){if(!sessionId)return;try{await nativeCall('boxplayer_browser',{sessionId})}catch(cause){if(alive)error.value=asAppError(cause).message}}
onMounted(async()=>{try{await sources.refresh();if(!alive)return;if(!accounts.value.some(a=>a.id===selected.value))memberStore.select(accounts.value[0]?.id||'');await refresh()}catch(cause){if(alive)error.value=asAppError(cause).message}})
onUnmounted(()=>{alive=false;++sequence;cancel()})
function onFocus(){if(!busy.value&&!qr.value)void refresh()}
onMounted(()=>window.addEventListener('focus',onFocus))
onUnmounted(()=>window.removeEventListener('focus',onFocus))
</script>
<template>
 <DialogRoot :open="true" @update:open="open=>{if(!open)emit('close')}"><DialogPortal><DialogOverlay class="bp-account-overlay"/><DialogContent class="bp-account-dialog">
  <header><button aria-label="关闭 BoxPlayer 账号" @click="emit('close')"><X :size="21"/></button><DialogTitle>BoxPlayer 账号</DialogTitle></header>
  <DialogDescription class="description">登录以查看会员权益，网盘和媒体服务器账号独立管理。</DialogDescription>
  <CircleUserRound class="avatar" :size="48"/>
  <select v-if="accounts.length" v-model="selected" aria-label="BoxPlayer 账号" :disabled="busy||!!qr" @change="confirm=false;refresh()"><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }}</option></select>
  <strong v-if="membership">{{ tier }}</strong><p v-if="membership?.currentPeriodEnd" class="description">有效期至 {{ new Date(membership.currentPeriodEnd).toLocaleDateString() }}</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <div v-if="qr" class="qr"><img :src="qr" alt="BoxPlayer 账号登录二维码"/><strong>{{ code }}</strong><p>扫码或在浏览器中登录后确认</p><Button variant="outline" @click="browserLogin">在浏览器登录</Button><Button variant="ghost" @click="++sequence;cancel()">取消登录</Button></div>
  <Button v-else :disabled="busy" @click="login">{{ busy?'正在读取…':accounts.length?'登录其他 BoxPlayer 账号':'扫码登录 BoxPlayer' }}</Button>
  <div v-if="selected&&!qr" class="actions"><Button variant="ghost" :disabled="busy" @click="refresh">刷新会员状态</Button><Button variant="ghost" :disabled="busy" @click="logout">{{ confirm?'确认退出本机账号':'退出登录' }}</Button><Button v-if="confirm" variant="ghost" @click="confirm=false">取消</Button></div>
  <Button variant="outline" @click="purchase">在官网查看会员方案</Button>
 </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.bp-account-overlay{position:fixed;inset:0;z-index:110;background:#0002;backdrop-filter:blur(1px)}.bp-account-dialog{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:111;width:min(440px,92vw);max-height:90vh;overflow:auto;background:var(--background);color:var(--foreground);border:1px solid var(--control-border);border-radius:18px;padding:18px 28px 28px;box-shadow:0 20px 70px #0004;display:flex;flex-direction:column;align-items:center;gap:16px;outline:none}.bp-account-dialog header{position:relative;width:100%;min-height:38px;display:grid;place-items:center;font-size:15px;font-weight:600}.bp-account-dialog header button{position:absolute;left:0;top:0;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--control-border);background:var(--control-surface)}.avatar{color:var(--primary);margin-top:8px}.description{font-size:13px;color:var(--muted-text);text-align:center;margin:0}.qr{display:flex;flex-direction:column;align-items:center;gap:10px}.qr img{width:240px;height:240px;max-width:100%;border-radius:10px}[role=alert]{color:#b93838;font-size:13px}.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}select{max-width:100%;padding:8px 12px;background:var(--control-surface);border:1px solid var(--control-border);border-radius:8px}
</style>
