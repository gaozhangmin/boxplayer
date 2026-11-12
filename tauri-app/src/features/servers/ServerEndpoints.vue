<script setup lang="ts">
import {ref,onMounted} from 'vue'
import {Check,Pencil,Plus,CircleMinus,X} from 'lucide-vue-next'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import type {Account} from '../sources/contracts'
import {nativeCall} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
const props=defineProps<{account:Account}>(),emit=defineEmits<{close:[]}>(),sources=useFileSourcesStore()
const endpoints=ref<{primary:string;backupAddresses:Record<string,string>;selectedLineName:string}>({primary:props.account.baseUrl,backupAddresses:{},selectedLineName:''})
const editorVisible=ref(false),editingName=ref<string|null>(null),name=ref(''),url=ref(''),error=ref(''),busy=ref(false)
async function update(action:string,extra:Record<string,unknown>={}){if(busy.value)return false;busy.value=true;error.value='';try{const result=await nativeCall<{account:Account;endpoints:typeof endpoints.value}>('server_endpoints',{accountId:props.account.id,action,...extra});endpoints.value=result.endpoints;const index=sources.accounts.findIndex(a=>a.id===props.account.id);if(index>=0)sources.accounts[index]=result.account;return true}catch(cause){error.value=(cause as Error).message;return false}finally{busy.value=false}}
onMounted(()=>update('get'))
function edit(key:string|null=null){editingName.value=key;name.value=key||'';url.value=key?endpoints.value.backupAddresses[key]||'':'';error.value='';editorVisible.value=true}
async function save(){if(await update('save',{oldName:editingName.value,name:name.value,url:url.value}))editorVisible.value=false}
function select(key=''){void update('select',{name:key})}
function remove(key:string){void update('remove',{name:key})}
</script>
<template>
  <ElectronModal label="端点管理" :width="620" :closable="false" class="media-server-endpoints-modal" @close="emit('close')">
    <header class="endpoint-header"><button class="endpoint-close" aria-label="关闭端点管理" @click="emit('close')"><X :size="20" /></button><strong>{{ account.name }}</strong></header>
    <p v-if="error && !editorVisible" role="alert">{{error}}</p><div class="endpoint-body">
      <h4>主地址</h4>
      <button class="endpoint-address" :aria-pressed="!endpoints.selectedLineName" @click="select()"><span>{{ endpoints.primary }}</span><Check v-if="!endpoints.selectedLineName" :size="20" /></button>
      <h4>备用地址</h4>
      <div v-for="(address, key) in endpoints.backupAddresses" :key="key" class="endpoint-address endpoint-backup">
        <button class="endpoint-remove" :aria-label="`删除端点 ${key}`" @click="remove(key)"><CircleMinus :size="18" /></button>
        <button class="endpoint-choice" :aria-pressed="endpoints.selectedLineName === key" @click="select(key)"><span><strong>{{ key }}</strong><small>{{ address }}</small></span><Check v-if="endpoints.selectedLineName === key" :size="20" /></button>
        <button :aria-label="`编辑端点 ${key}`" @click="edit(key)"><Pencil :size="18" /></button>
      </div>
      <button class="endpoint-add" @click="edit()"><Plus :size="18" />新增端点</button>
    </div>
  </ElectronModal>
  <ElectronModal label="编辑端点" v-if="editorVisible" :width="320" :closable="false" class="media-server-endpoint-editor" @close="editorVisible = false">
    <form class="endpoint-editor-form" @submit.prevent="save">
      <strong>{{ editingName === null ? '新增端点' : '编辑端点' }}</strong>
      <div class="endpoint-fields"><input v-model="name" autofocus placeholder="名称（选填）" aria-label="端点名称" maxlength="120" /><input v-model="url" placeholder="端点 URL" aria-label="端点 URL" required /></div>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy||!url.trim()">保存</button><button type="button" @click="editorVisible = false">取消</button>
    </form>
  </ElectronModal>
</template>

<style scoped>
button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }
.endpoint-header { height: 40px; display: flex; align-items: center; justify-content: center; position: relative }
.endpoint-close { position: absolute; left: 0; width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 999px; display: grid; place-items: center }
.endpoint-body { min-height: 560px; padding: 16px 0 }
h4 { margin: 20px 18px 6px; color: var(--muted-text); font-size: 12px }
.endpoint-address { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 8px 12px; border-radius: 12px; background: var(--secondary); text-align: left; margin-bottom: 8px }
.endpoint-address > span, .endpoint-choice > span { flex: 1; min-width: 0; overflow-wrap: anywhere }
.endpoint-address svg { flex-shrink: 0; color: var(--muted-text) }
.endpoint-backup { padding: 4px 12px }
.endpoint-choice { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; text-align: left; padding: 4px 0 }
.endpoint-choice strong { font-size: 13px; font-weight: 500 }
.endpoint-choice small { display: block; color: var(--muted-text); font-size: 11px }
.endpoint-remove svg { color: #ff5252 }
.endpoint-add { display: flex; gap: 8px; align-items: center; justify-content: center; width: 100%; border-radius: 12px; background: var(--secondary); height: 42px; margin-top: 42px }
.endpoint-editor-form { display: flex; flex-direction: column; padding: 0 16px 16px; gap: 8px; text-align: center }
.endpoint-editor-form > strong { padding: 0 0 18px; font-size: 14px }
.endpoint-fields { background: var(--secondary); border-radius: 24px; padding: 0 16px; margin-bottom: 12px }
.endpoint-fields input { display: block; width: 100%; height: 46px; padding: 0; border: 0; background: transparent; color: var(--foreground); font: inherit; outline: none }
.endpoint-fields input:first-child { border-bottom: 1px solid var(--border) }
.endpoint-editor-form > button { height: 48px; border-radius: 999px; background: var(--secondary); font-weight: 600 }
.endpoint-editor-form > button:disabled { opacity: .5; cursor: default }
p[role=alert] { color: rgb(var(--danger-6)); font-size: 12px; margin: 0 }
</style>

<style>.media-server-endpoints-modal .electron-modal{border-radius:28px}.media-server-endpoint-editor .electron-modal{border-radius:8px}.media-server-endpoints-modal .electron-modal-body{padding:8px 16px 16px}</style>
