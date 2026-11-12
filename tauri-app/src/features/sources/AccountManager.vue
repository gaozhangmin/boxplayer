<script setup lang="ts">
import { computed, ref } from 'vue'
import { X, CircleUserRound, ChevronRight } from 'lucide-vue-next'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { useFileSourcesStore } from '@/stores/fileSources'
import { nativeCall, asAppError, addLocalSource } from '@/platform/native'
import { providers } from './contracts'
import SourceManager from './SourceManager.vue'
import BoxPlayerAccount from './BoxPlayerAccount.vue'
const emit=defineEmits<{close:[];select:[id:string]}>()
const sources=useFileSourcesStore()
const adding=ref(false),busy=ref(false),error=ref(''),confirmId=ref('')
const profile=ref(false)
const accounts=computed(()=>sources.accounts.filter(account=>account.providerId!=='boxplayer'))
function providerName(id:string){return providers.find(p=>p[0]===id)?.[1]||id}
async function remove(id:string){
 busy.value=true;error.value=''
 try{await nativeCall('account_remove',{accountId:id});confirmId.value=''}catch(e){error.value=asAppError(e).message}
 finally{await sources.refresh().catch(e=>{error.value=asAppError(e).message});busy.value=false}
}
async function local(){busy.value=true;try{const source=await addLocalSource();await sources.refresh();adding.value=false;if(source){emit('select',source.id);emit('close')}}catch(e){error.value=asAppError(e).message;adding.value=false}finally{busy.value=false}}
async function saved(){await sources.refresh();adding.value=false}
</script>
<template>
 <SourceManager v-if="adding" @close="adding=false" @select="id=>{emit('select',id);emit('close')}" @saved="saved" @local="local"/>
 <BoxPlayerAccount v-else-if="profile" @close="profile=false"/>
 <DialogRoot v-else :open="true" @update:open="value=>{if(!value&&!busy)emit('close')}">
  <DialogPortal><DialogOverlay class="account-overlay"/><DialogContent class="account-dialog" @escape-key-down="event=>{if(busy)event.preventDefault()}" @pointer-down-outside="event=>{if(busy)event.preventDefault()}">
   <header class="account-header"><button class="account-close" aria-label="关闭账号管理" @click="emit('close')"><X :size="21" /></button><DialogTitle class="account-title">账号管理</DialogTitle></header>
   <DialogDescription class="account-description">选择账号浏览文件，或添加新的来源。</DialogDescription>
   <Button variant="outline" @click="profile=true">BoxPlayer 账号与会员</Button>
   <p v-if="error" role="alert" class="account-error">{{error}}</p>
   <div v-for="account in accounts" :key="account.id" class="account-row">
    <button :disabled="busy" class="account-select" @click="emit('select',account.id);emit('close')"><span class="account-avatar"><CircleUserRound :size="27" /></span><span class="account-identity"><strong>{{account.name}}</strong><small>{{providerName(account.providerId)}}</small></span><ChevronRight :size="17" /></button>
    <template v-if="confirmId===account.id"><Button variant="ghost" :disabled="busy" @click="confirmId=''">取消</Button><Button :disabled="busy" @click="remove(account.id)">确认退出本机账号</Button></template>
    <Button v-else variant="ghost" :disabled="busy" @click="confirmId=account.id">退出</Button>
   </div>
   <p v-if="!accounts.length" class="account-description">还没有登录的账号。</p>
   <div class="account-buttons"><Button variant="ghost" :disabled="busy" @click="emit('close')">关闭</Button><Button :disabled="busy" @click="adding=true">添加账号</Button></div>
  </DialogContent></DialogPortal>
 </DialogRoot>
</template>
<style scoped>
.account-header { position: relative; min-height: 40px; display: grid; place-items: center; }
.account-close { position: absolute; left: 0; top: 0; width: 36px; height: 36px; border: 1px solid var(--control-border); border-radius: 50%; display: grid; place-items: center; background: var(--control-surface); box-shadow: inset 0 1px 1px #fff5; }
.account-avatar { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--secondary); color: var(--primary); flex: none; }
.account-identity { display: grid; flex: 1; gap: 4px; min-width: 0; }

.account-overlay{position:fixed;inset:0;z-index:100;background:#0002;backdrop-filter:blur(1px)}.account-dialog{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:101;width:min(560px,92vw);max-height:85vh;overflow:auto;border:1px solid var(--control-border);border-radius:18px;padding:16px 24px 24px;background:var(--background);color:var(--foreground);box-shadow:0 20px 70px #0004;display:grid;gap:16px;outline:none}.account-title{font-size:15px;font-weight:600}.account-description{font-size:13px;color:var(--muted-text);margin:0}.account-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:10px}.account-select{flex:1;min-width:0;text-align:left;display:flex;align-items:center;gap:12px;padding:10px 0}.account-select strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-select small{color:var(--muted-text)}.account-buttons{display:flex;justify-content:flex-end;gap:8px}.account-error{color:#c33}
</style>
