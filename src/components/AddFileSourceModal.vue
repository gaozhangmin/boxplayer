<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, Network, ChevronRight, ChevronLeft, Plus, Monitor, X } from 'lucide-vue-next'
import FileSourceBrowser from './FileSourceBrowser.vue'
import UserLogin from '../user/UserLogin.vue'
import ServerRegistry from './media-server/MediaServerRegistryPanel.vue'
import type { MediaServerConfig, MediaServerType } from '../types/mediaServer'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import MediaServerIcon from './media-server/MediaServerIcon.vue'
import { getDriveProviderMeta } from '../utils/driveProvider'
import { MediaScanner } from '../utils/mediaScanner'
import { useMediaLibraryStore } from '../store/medialibrary'
import message from '../utils/message'
import { t } from '../i18n'

const props = defineProps<{ visible: boolean; deviceName: string; sources: Array<{ id: string; name: string; icon?: string; favorite?: boolean; driveServerId?: string; server?: MediaServerConfig; folder: IAliGetFileModel; drives?: Array<{ label: string; folder: IAliGetFileModel }> }> }>()
const emit = defineEmits<{ 'toggle-root': [id: string]; close: []; connected: [] }>()
const selected = ref('add')
type Detail = { kind: 'cloud'; provider: string } | { kind: 'server'; type: MediaServerType } | { kind: 'local' }
const detail = ref<Detail>()
const authorizing = ref(false)
const sourceName = ref('')
const localPath = ref('')
const savingLocal = ref(false)
const selectedSource = computed(() => props.sources.find(s => s.id === selected.value))
const clouds = ['google', 'dropbox', 'onedrive', 'box', 'aliyun', 'cloud123', '115', 'baidu', 'pikpak', 'quark', '139', '189', 'guangya'].map(getDriveProviderMeta)
const detailLabel = computed(() => detail.value?.kind === 'cloud' ? getDriveProviderMeta(detail.value.provider).label : detail.value?.kind === 'local' ? t('source.folder') : '')
const remote = computed(() => detail.value?.kind === 'cloud' && ['webdav', 'alist'].includes(detail.value.provider))
function resetDetail() { detail.value = undefined; authorizing.value = false; sourceName.value = ''; localPath.value = '' }
function selectSource(id: string) { if (savingLocal.value) return; resetDetail(); selected.value = id }
function openCloud(provider: string) {
  resetDetail()
  detail.value = { kind: 'cloud', provider }
  sourceName.value = t('source.defaultName', { type: getDriveProviderMeta(provider).label })
}
function connected() { resetDetail(); emit('connected') }
function chooseLocalFolder() {
  if (!window.WebShowOpenDialogSync) { message.error(t('media.localFolderUnsupported')); return }
  window.WebShowOpenDialogSync({ title: t('media.selectLocalFolder'), properties: ['openDirectory', 'createDirectory'] }, (paths: string[] | undefined) => {
    if (!paths?.[0]) return
    localPath.value = paths[0]
    if (!sourceName.value.trim()) sourceName.value = paths[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop() || paths[0]
  })
}
async function saveLocalFolder() {
  if (!localPath.value || savingLocal.value || useMediaLibraryStore().isScanning) return
  savingLocal.value = true
  try { await MediaScanner.getInstance().scanLocalFolder(localPath.value, sourceName.value.trim() || undefined); connected() }
  catch (error) { message.error(String(error)) }
  finally { savingLocal.value = false }
}
watch(() => props.visible, () => { if (!savingLocal.value) { selected.value = 'add'; resetDetail() } })
</script>

<template>
  <a-modal modal-class="add-file-source-modal" :visible="visible" :closable="false" :width="840" :footer="false" :mask-closable="!savingLocal" unmount-on-close @cancel="emit('close')">
    <div class="file-source-layout">
      <aside class="file-source-sidebar">
        <button class="file-source-close" :disabled="savingLocal" :aria-label="t('common.close')" @click="emit('close')"><X :size="20" /></button>
        <div class="file-source-navigation">
          <p>{{ t('source.saved') }}</p>
          <button :disabled="savingLocal" :class="{ selected: selected === 'add' }" @click="selectSource('add')"><Plus :size="20" /><span>{{ t('source.addShare') }}</span></button>
          <button :disabled="savingLocal" :class="{ selected: selected === 'device' }" @click="selectSource('device')"><Monitor :size="20" /><span>{{ deviceName }}</span></button>
          <button v-for="source in sources" :key="source.id" :disabled="savingLocal" :class="{ selected: selected === source.id }" @click="selectSource(source.id)"><img v-if="source.icon" :src="source.icon" alt="" /><Folder v-else :size="20" /><span>{{ source.name }}</span></button>
        </div>
      </aside>
      <main class="file-source-main">
        <ServerRegistry v-if="selected === 'add' && detail?.kind === 'server'" :key="detail.type" form-only embedded :default-type="detail.type" @close="resetDetail" @saved="connected" />
        <template v-else>
          <header class="file-source-heading">
            <button v-if="detail" class="file-source-back" :disabled="savingLocal" :aria-label="t('unified.back')" @click="resetDetail"><ChevronLeft :size="20" /></button>
            <h2>{{ detail?.kind === 'local' ? t('unified.addLocalFolder') : detail ? t('source.add', { type: detailLabel }) : selected === 'add' ? t('source.addTitle') : selected === 'device' ? deviceName : selectedSource?.name }}</h2>
          </header>
          <FileSourceBrowser v-if="selected !== 'add'" :device="selected === 'device'" :source="selectedSource" @toggle-root="emit('toggle-root', selected)" />
          <UserLogin v-else-if="detail?.kind === 'cloud' && (authorizing || remote)" :key="detail.provider" embedded :provider="detail.provider" :source-name="sourceName.trim() || t('source.defaultName', { type: detailLabel })" @connected="connected" @cancel="resetDetail" />
          <form v-else-if="detail" class="source-connection-form" @submit.prevent="detail.kind === 'local' ? saveLocalFolder() : authorizing = true">
            <div class="source-field"><label for="source-name">{{ t('mediaServer.name') }}</label><input id="source-name" v-model="sourceName" :disabled="savingLocal" :placeholder="t('source.defaultName', { type: detailLabel })" autocomplete="off" /></div>
            <div class="source-field"><label>{{ t('mediaServer.protocol') }}</label><span>{{ detail.kind === 'local' ? deviceName : detailLabel }}</span></div>
            <div v-if="detail.kind === 'local'" class="source-field source-local-path"><label>{{ t('source.folder') }}</label><div><span>{{ localPath }}</span><button type="button" :disabled="savingLocal" @click="chooseLocalFolder">{{ t('source.chooseFolder') }}</button></div></div>
            <div class="source-actions"><button type="submit" :disabled="savingLocal || (detail.kind === 'local' && (!localPath || useMediaLibraryStore().isScanning))">{{ detail.kind === 'local' ? t('common.save') : t('mediaServer.connect') }}</button></div>
          </form>
          <div v-else class="source-picker">
            <h3>{{ t('source.local') }}</h3>
            <div class="source-group"><button @click="detail = { kind: 'local' }"><Folder class="local-source-icon" :size="28" /><span>{{ t('unified.addLocalFolder') }}</span><ChevronRight :size="16" /></button></div>
            <h3>{{ t('source.network') }}</h3>
            <div class="source-group"><button v-for="provider in ['webdav', 'alist']" :key="provider" @click="openCloud(provider)"><Network :size="28" /><span>{{ getDriveProviderMeta(provider).label }}</span><ChevronRight :size="16" /></button></div>
            <h3>{{ t('source.cloud') }}</h3>
            <div class="source-group"><button v-for="provider in clouds" :key="provider.key" @click="openCloud(provider.key)"><img :src="provider.icon" alt="" /><span>{{ provider.label }}</span><ChevronRight :size="16" /></button></div>
            <h3>{{ t('source.servers') }}</h3>
            <div class="source-group"><button v-for="type in (['plex', 'emby', 'jellyfin'] as const)" :key="type" @click="detail = { kind: 'server', type }"><MediaServerIcon :server="{ type }" :size="28" /><span>{{ type === 'plex' ? 'Plex' : type === 'emby' ? 'Emby' : 'Jellyfin' }}</span><ChevronRight :size="16" /></button></div>
          </div>
        </template>
      </main>
    </div>
  </a-modal>
</template>

<style scoped>
.source-picker{flex:1;overflow:auto;padding:0 30px 24px}
.source-picker h3{font-size:12px;color:var(--color-text-3);font-weight:500;margin:20px 0 10px}
.source-group button{display:flex;align-items:center;gap:14px;width:100%;min-height:44px;padding:8px 0;background:transparent;color:var(--color-text-1);font:inherit;font-size:14px;font-weight:550;border:0;text-align:left;cursor:pointer}
.source-group button:hover{background:var(--color-fill-2)}
.source-group button:focus-visible{outline:2px solid rgb(var(--primary-6));outline-offset:-2px}
.source-group button>span{flex:1}.source-group button>img{width:28px;height:28px;object-fit:contain}.source-group button>svg:last-child{color:var(--color-text-3)}.local-source-icon{color:#50c75c}
.file-source-heading{position:relative;display:flex;align-items:center;justify-content:center;min-height:64px;flex-shrink:0;padding:0 55px}
.file-source-heading h2{font-size:17px;font-weight:650;text-align:center;margin:0;color:var(--color-text-1)}
.file-source-back{position:absolute;left:20px;top:16px;width:32px;height:32px;border:1px solid var(--color-border-2);border-radius:50%;display:grid;place-items:center;background:var(--color-fill-2);color:var(--color-text-1);cursor:pointer}
.source-connection-form{max-width:520px;width:100%;box-sizing:border-box;align-self:center;padding:56px 28px 32px;overflow:auto}
.source-field{display:grid;grid-template-columns:100px minmax(0,1fr);gap:16px;align-items:center;min-height:40px;font-size:14px}.source-field label{color:var(--color-text-2);text-align:right}.source-field input{width:100%;min-width:0;box-sizing:border-box;border:0;border-radius:4px;background:transparent;color:var(--color-text-1);font:inherit;padding:8px 4px}.source-field input:focus-visible{outline:1px solid rgb(var(--primary-6))}.source-field>span{color:var(--color-text-3);padding:8px 4px}
.source-actions{display:flex;gap:12px;margin:24px 0 0 116px}.source-actions button,.source-local-path button{min-height:36px;border-radius:7px;padding:6px 16px;border:1px solid var(--color-border-2);font:inherit;background:var(--color-fill-2);color:var(--color-text-1);cursor:pointer}.source-actions button[type=submit]{background:rgb(var(--primary-6));color:#fff;border-color:transparent;min-width:130px}.source-actions button:disabled{opacity:.5;cursor:default}.source-local-path>div{display:flex;align-items:flex-start;flex-direction:column;gap:10px;overflow-wrap:anywhere;min-width:0}.file-source-main :deep(.media-server-registry-panel){flex:1;min-height:0;display:flex;flex-direction:column}
@media(max-width:600px){.source-picker{padding-inline:14px}.source-field{grid-template-columns:72px minmax(0,1fr);gap:12px}.source-actions{margin-left:84px}}
</style>
<style>
.arco-modal.add-file-source-modal{width:840px!important;max-width:calc(100vw - 40px)!important;overflow:hidden;border-radius:16px;box-sizing:border-box}
.arco-modal.add-file-source-modal>.arco-modal-header{display:none}.arco-modal.add-file-source-modal>.arco-modal-body{padding:0!important}
.add-file-source-modal .file-source-layout{display:grid;grid-template-columns:30% minmax(0,1fr);height:min(78vh,680px);min-height:360px}
.add-file-source-modal .file-source-sidebar{position:relative;background:var(--color-fill-1);border-right:1px solid var(--color-border-1);padding:76px 16px 20px;overflow:auto}
.add-file-source-modal .file-source-close{position:absolute;left:22px;top:16px;width:32px;height:32px;border:1px solid var(--color-border-2);border-radius:50%;display:grid;place-items:center;background:var(--color-fill-2);color:var(--color-text-1);cursor:pointer}
.add-file-source-modal .file-source-navigation p{font-size:11px;color:var(--color-text-3);margin:16px 8px 8px}.add-file-source-modal .file-source-navigation button{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:7px 8px;border:0;border-radius:7px;background:transparent;color:var(--color-text-1);font:inherit;font-size:13px;text-align:left;cursor:pointer}.add-file-source-modal .file-source-navigation button.selected,.add-file-source-modal .file-source-navigation button:hover{background:var(--color-fill-3)}.add-file-source-modal .file-source-navigation button svg{color:#4ac75a;flex-shrink:0}.add-file-source-modal .file-source-navigation button img{width:20px;height:20px;object-fit:contain}.add-file-source-modal .file-source-navigation button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.add-file-source-modal .file-source-main{min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--app-overlay-bg)}
@media(max-width:600px){.add-file-source-modal .file-source-layout{grid-template-columns:130px minmax(0,1fr)}.add-file-source-modal .file-source-sidebar{padding-inline:8px}}
</style>
