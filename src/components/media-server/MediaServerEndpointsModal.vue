<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Pencil, Plus, CircleMinus, X } from 'lucide-vue-next'
import useMediaServerRegistryStore from '../../store/mediaServerRegistry'
import { saveMediaServerEndpoint, removeMediaServerEndpoint } from '../../utils/mediaServerEndpoints'

const props = defineProps<{ serverId: string }>()
const emit = defineEmits<{ close: [] }>()
const registry = useMediaServerRegistryStore()
const server = computed(() => registry.servers.find(server => server.id === props.serverId))
const editorVisible = ref(false)
const editingName = ref<string | null>(null)
const name = ref('')
const url = ref('')
const error = ref('')
watch(() => props.serverId, () => { editorVisible.value = false; error.value = '' })
function edit(key: string | null = null) { editingName.value = key; name.value = key || ''; url.value = key ? server.value?.backupAddresses?.[key] || '' : ''; error.value = ''; editorVisible.value = true }
function save() {
  if (!server.value) return
  try { registry.updateServer(server.value.id, saveMediaServerEndpoint(server.value, editingName.value, name.value, url.value)); editorVisible.value = false } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
}
function select(key = '') { if (server.value) registry.updateServer(server.value.id, { selectedLineName: key }) }
function remove(key: string) { if (server.value) registry.updateServer(server.value.id, removeMediaServerEndpoint(server.value, key)) }
</script>

<template>
  <a-modal :visible="!!server" :width="620" :footer="false" :closable="false" :z-index="3000" modal-class="media-server-endpoints-modal" @cancel="emit('close')">
    <header class="endpoint-header"><button class="endpoint-close" aria-label="关闭端点管理" @click="emit('close')"><X :size="20" /></button><strong>{{ server?.name }}</strong></header>
    <div class="endpoint-body">
      <h4>主地址</h4>
      <button class="endpoint-address" :aria-pressed="!server?.selectedLineName" @click="select()"><span>{{ server?.baseUrl }}</span><Check v-if="!server?.selectedLineName" :size="20" /></button>
      <h4>备用地址</h4>
      <div v-for="(address, key) in server?.backupAddresses" :key="key" class="endpoint-address endpoint-backup">
        <button class="endpoint-remove" :aria-label="`删除端点 ${key}`" @click="remove(key)"><CircleMinus :size="18" /></button>
        <button class="endpoint-choice" :aria-pressed="server?.selectedLineName === key" @click="select(key)"><span><strong>{{ key }}</strong><small>{{ address }}</small></span><Check v-if="server?.selectedLineName === key" :size="20" /></button>
        <button :aria-label="`编辑端点 ${key}`" @click="edit(key)"><Pencil :size="18" /></button>
      </div>
      <button class="endpoint-add" @click="edit()"><Plus :size="18" />新增端点</button>
    </div>
  </a-modal>
  <a-modal :visible="!!server && editorVisible" :width="320" :footer="false" :closable="false" :z-index="3100" modal-class="media-server-endpoint-editor" @cancel="editorVisible = false">
    <form class="endpoint-editor-form" @submit.prevent="save">
      <strong>{{ editingName === null ? '新增端点' : '编辑端点' }}</strong>
      <div class="endpoint-fields"><input v-model="name" autofocus placeholder="名称（选填）" aria-label="端点名称" maxlength="120" /><input v-model="url" placeholder="端点 URL" aria-label="端点 URL" required /></div>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="!url.trim()">保存</button><button type="button" @click="editorVisible = false">取消</button>
    </form>
  </a-modal>
</template>

<style scoped>
button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit }
button:focus-visible { outline: 2px solid #ff8800; outline-offset: 2px }
.endpoint-header { height: 40px; display: flex; align-items: center; justify-content: center; position: relative }
.endpoint-close { position: absolute; left: 0; width: 36px; height: 36px; border: 1px solid var(--color-border-3); border-radius: 999px; display: grid; place-items: center }
.endpoint-body { min-height: 560px; padding: 16px 0 }
h4 { margin: 20px 18px 6px; color: var(--color-text-3); font-size: 12px }
.endpoint-address { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 8px 12px; border-radius: 12px; background: var(--color-fill-3); text-align: left; margin-bottom: 8px }
.endpoint-address > span, .endpoint-choice > span { flex: 1; min-width: 0; overflow-wrap: anywhere }
.endpoint-address svg { flex-shrink: 0; color: var(--color-text-3) }
.endpoint-backup { padding: 4px 12px }
.endpoint-choice { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; text-align: left; padding: 4px 0 }
.endpoint-choice strong { font-size: 13px; font-weight: 500 }
.endpoint-choice small { display: block; color: var(--color-text-3); font-size: 11px }
.endpoint-remove svg { color: #ff5252 }
.endpoint-add { display: flex; gap: 8px; align-items: center; justify-content: center; width: 100%; border-radius: 12px; background: var(--color-fill-3); height: 42px; margin-top: 42px }
.endpoint-editor-form { display: flex; flex-direction: column; padding: 0 16px 16px; gap: 8px; text-align: center }
.endpoint-editor-form > strong { padding: 0 0 18px; font-size: 14px }
.endpoint-fields { background: var(--color-fill-3); border-radius: 24px; padding: 0 16px; margin-bottom: 12px }
.endpoint-fields input { display: block; width: 100%; height: 46px; padding: 0; border: 0; background: transparent; color: var(--color-text-1); font: inherit; outline: none }
.endpoint-fields input:first-child { border-bottom: 1px solid var(--color-border-3) }
.endpoint-editor-form > button { height: 48px; border-radius: 999px; background: var(--color-fill-3); font-weight: 600 }
.endpoint-editor-form > button:disabled { opacity: .5; cursor: default }
p[role=alert] { color: rgb(var(--danger-6)); font-size: 12px; margin: 0 }
</style>
<style>
.media-server-endpoints-modal.arco-modal { width: min(620px, calc(100vw - 32px)) !important; border-radius: 28px !important; border: 1px solid var(--color-border-3); background: var(--app-overlay-bg); max-height: calc(100vh - 32px); overflow: auto }
.media-server-endpoint-editor.arco-modal { width: min(320px, calc(100vw - 32px)) !important; border: 1px solid var(--color-border-3); border-radius: 8px !important; background: var(--app-overlay-bg)}
.media-server-endpoints-modal .arco-modal-body { padding: 8px 16px 16px }
body[arco-theme='dark'] .arco-modal.media-server-endpoints-modal { background: var(--app-overlay-bg) !important; backdrop-filter: none !important}
body[arco-theme='dark'] .arco-modal.media-server-endpoint-editor { background: var(--app-overlay-bg) !important; backdrop-filter: none !important}
body[arco-theme='dark'] .media-server-endpoints-modal .endpoint-address,
body[arco-theme='dark'] .media-server-endpoints-modal .endpoint-add,
body[arco-theme='dark'] .media-server-endpoint-editor .endpoint-fields,
body[arco-theme='dark'] .media-server-endpoint-editor .endpoint-editor-form > button { background: #3f4141 }
</style>
