<template>
  <SourceFormSurface :embedded="embedded" :visible="visible" :mask-closable="!loading" modal-class="server-add-sheet" @update:visible="emit('update:visible', $event)">
    <template #title><div class="sheet-heading"><button class="sheet-back" :disabled="loading" :aria-label="t('unified.back')" @click="emit('update:visible', false)"><ChevronLeft :size="24" /></button><h2>{{ editingServer ? form.name : t('mediaServer.addServer', { type: serverTypeTitle }) }}</h2><button v-if="editingServer" type="button" class="sheet-remove" :disabled="loading" @click="emit('remove', editingServer.id)">{{ t('mediaServer.removeShare') }}</button></div></template>
    <form v-if="form.type !== 'plex' || editingServer" class="server-add-form" @submit.prevent="handleSubmit">
      <div class="sheet-field"><label for="server-add-name">{{ t('mediaServer.name') }}</label><input id="server-add-name" v-model="form.name" :placeholder="defaultName" :disabled="loading" autocomplete="off" /></div>
      <div class="sheet-field"><label>{{ t('mediaServer.protocol') }}</label><span class="protocol-value">{{ serverTypeTitle }}</span></div>
      <div class="sheet-field"><label for="server-add-host">{{ t('mediaServer.address') }}</label><input id="server-add-host" v-model="form.host" placeholder="iMac.local" :disabled="loading" :readonly="!!editingServer" autocapitalize="off" spellcheck="false" /></div>
      <div class="sheet-field"><label for="server-add-user">{{ t('mediaServer.username') }}</label><input id="server-add-user" v-model="form.username" placeholder="johnappleseed" :disabled="loading" autocomplete="username" /></div>
      <div class="sheet-field"><label for="server-add-password">{{ t('mediaServer.password') }}</label><input id="server-add-password" v-model="form.password" type="password" :placeholder="t('mediaServer.password')" :disabled="loading" autocomplete="current-password" /></div>
      <button type="button" class="sheet-advanced" :aria-expanded="advanced" :disabled="loading" @click="advanced = !advanced">{{ t('mediaServer.advanced') }}<ChevronUp v-if="advanced" :size="16" /><ChevronDown v-else :size="16" /></button>
      <div v-if="advanced" class="sheet-advanced-fields">
        <div class="sheet-field"><label for="server-add-port">{{ t('mediaServer.port') }}</label><input id="server-add-port" v-model="form.port" inputmode="numeric" :placeholder="defaultPortMap[form.type]" :disabled="loading" /></div>
        <div class="sheet-field"><label for="server-add-https">HTTPS</label><select id="server-add-https" v-model="form.httpsMode" :disabled="loading"><option value="auto">{{ t('mediaServer.httpsAuto') }}</option><option value="on">{{ t('mediaServer.httpsOn') }}</option><option value="off">{{ t('mediaServer.httpsOff') }}</option></select></div>
        <div v-if="editingServer && form.path" class="sheet-field"><label for="server-add-path">{{ t('mediaServer.path') }}</label><input id="server-add-path" v-model="form.path" :disabled="loading" :readonly="!!editingServer" /></div>
        <div class="sheet-field sheet-checkbox"><label for="server-add-library">{{ t('mediaServer.libraryMode') }}</label><input id="server-add-library" v-model="form.libraryMode" type="checkbox" :disabled="loading" /></div>
      </div>
      <div class="sheet-actions">
        <button type="submit" :disabled="loading || !form.host.trim()">{{ loading ? t('mediaServer.connect') + '…' : editingServer ? t('common.save') : t('mediaServer.create') }}</button>
        <template v-if="editingServer">
          <button type="button" :disabled="loading" @click="showSpeedTest = true">{{ t('mediaServer.speedTest') }}</button>
        </template>
      </div>
    </form>
    <form v-else class="server-add-form" @submit.prevent="handleSubmit">
      <div class="sheet-field"><label for="plex-source-name">{{ t('mediaServer.name') }}</label><input id="plex-source-name" v-model="form.name" :placeholder="defaultName" :disabled="loading" /></div>
      <div class="sheet-field"><label>{{ t('mediaServer.protocol') }}</label><span class="protocol-value">Plex</span></div>
      <div class="sheet-actions"><button type="submit" :disabled="loading">{{ t('mediaServer.connect') }}</button></div>
    </form>
  </SourceFormSurface>
  <MediaServerSpeedTestModal v-if="editingServer" v-model:visible="showSpeedTest" :server="editingServer" />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import SourceFormSurface from '../SourceFormSurface.vue'
import MediaServerSpeedTestModal from './MediaServerSpeedTestModal.vue'
import { ChevronLeft, ChevronUp, ChevronDown } from 'lucide-vue-next'
import { buildMediaServerAddress, type ServerHttpsMode } from '../../utils/mediaServerAddress'
import message from '../../utils/message'
import type { MediaServerConfig, MediaServerType } from '../../types/mediaServer'
import { t } from '../../i18n'

const props = defineProps<{
  visible: boolean
  embedded?: boolean
  loading?: boolean
  editingServer?: MediaServerConfig | null
  defaultType?: MediaServerType
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'remove', id: string): void
  (event: 'submit', payload: {
    type: MediaServerType
    name: string
    baseUrl: string
    notes?: string
    host?: string
    port?: string
    path?: string
    username?: string
    password?: string
    useHttps?: boolean
    libraryMode?: boolean
    syncFlag?: boolean
    backupAddresses?: Record<string, string>
    nameCustomized?: boolean
  }): void
}>()

interface BackupAddressInput {
  name: string
  url: string
}

const form = reactive({
  type: 'jellyfin' as MediaServerType,
  name: '',
  notes: '',
  host: '',
  port: '',
  path: '',
  username: '',
  password: '',
  useHttps: false,
  httpsMode: 'auto' as ServerHttpsMode,
  libraryMode: false,
  syncFlag: true,
  backupAddresses: [] as BackupAddressInput[]
})

const advanced = ref(true)
const showSpeedTest = ref(false)
const defaultName = computed(() => t('mediaServer.defaultName', { type: serverTypeTitle.value }))

const defaultPortMap: Record<MediaServerType, string> = {
  jellyfin: '8096',
  emby: '8096',
  plex: '32400'
}

const serverTypeTitle = computed(() => {
  if (form.type === 'jellyfin') return 'Jellyfin'
  if (form.type === 'emby') return 'Emby'
  return 'Plex'
})

const parseBaseUrl = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl)
    return {
      useHttps: url.protocol === 'https:',
      host: url.hostname,
      port: url.port || '',
      path: url.pathname === '/' ? '' : url.pathname
    }
  } catch {
    return {
      useHttps: false,
      host: '',
      port: '',
      path: ''
    }
  }
}

const fillForm = () => {
  if (props.editingServer) {
    advanced.value = false
    const parsed = parseBaseUrl(props.editingServer.baseUrl)
    form.type = props.editingServer.type
    form.name = props.editingServer.name
    form.notes = props.editingServer.notes || ''
    form.host = props.editingServer.host || parsed.host
    form.port = props.editingServer.port || parsed.port
    form.path = props.editingServer.path || parsed.path
    form.username = props.editingServer.username || ''
    form.password = props.editingServer.password || ''
    form.useHttps = props.editingServer.useHttps ?? parsed.useHttps
    form.httpsMode = form.useHttps ? 'on' : 'off'
    form.libraryMode = props.editingServer.libraryMode ?? true
    form.syncFlag = props.editingServer.syncFlag ?? true
    form.backupAddresses = Object.entries(props.editingServer.backupAddresses || {}).map(([name, url]) => ({ name, url }))
    return
  }
  form.type = props.defaultType || 'jellyfin'
  form.name = ''
  form.notes = ''
  form.host = ''
  form.port = ''
  form.path = ''
  form.username = ''
  form.password = ''
  form.useHttps = false
  form.httpsMode = 'auto'
  form.libraryMode = false
  advanced.value = !props.embedded
  form.syncFlag = true
  form.backupAddresses = []
}

watch(() => props.visible, (visible) => {
  if (visible) fillForm()
  else showSpeedTest.value = false
}, { immediate: true })

watch(() => props.defaultType, () => {
  if (!props.editingServer && props.visible) fillForm()
})

const handleSubmit = () => {
  if (props.loading) return
  if (form.type === 'plex' && !props.editingServer) {
    emit('submit', { type: 'plex', name: form.name.trim() || defaultName.value, nameCustomized: !!form.name.trim(), baseUrl: '' })
    return
  }
  if (!form.host.trim()) {
    message.error(t('mediaServer.fillServerHost'))
    return
  }
  let address: ReturnType<typeof buildMediaServerAddress>
  try { address = buildMediaServerAddress(form.host, form.port || defaultPortMap[form.type], form.path, form.httpsMode) }
  catch { message.error(t('mediaServer.invalidAddress')); return }
  const baseUrl = address.baseUrl
  const backupAddresses = form.backupAddresses.reduce<Record<string, string>>((acc, item) => {
    const name = item.name.trim()
    const url = item.url.trim()
    if (name && url) acc[name] = url
    return acc
  }, {})
  emit('submit', {
    type: form.type,
    name: form.name.trim() || defaultName.value,
    nameCustomized: !!form.name.trim(),
    baseUrl,
    notes: form.notes.trim(),
    host: address.host,
    port: address.port,
    path: address.path,
    username: form.username.trim(),
    password: form.password,
    useHttps: address.useHttps,
    libraryMode: form.libraryMode,
    syncFlag: form.syncFlag,
    backupAddresses
  })
}

</script>
<style>
.server-add-sheet.arco-modal,body[arco-theme='dark'] .arco-modal.server-add-sheet{background: var(--app-overlay-bg) !important;color:#dedede;border:1px solid #484848!important;border-radius:18px!important;width:min(660px,calc(100vw - 32px))!important;max-height:calc(100vh - 32px);overflow:auto}
.server-add-sheet .arco-modal-header,body[arco-theme='dark'] .server-add-sheet .arco-modal-header{height:64px;border:0!important;padding:0 20px;position:relative}
.server-add-sheet .arco-modal-title{width:100%}.server-add-sheet .arco-modal-body{padding:0 32px 36px!important;max-height:none!important}
</style>
<style scoped>
.sheet-heading{display:flex;align-items:center;justify-content:center;width:100%;height:64px}.sheet-heading h2{margin:0;color:#fff;font-size:20px;font-weight:700}
.sheet-back{position:absolute;left:20px;top:10px;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid #383838;border-radius:50%;color:#eee;background:#191919;cursor:pointer}
.sheet-remove{position:absolute;right:20px;top:12px;min-height:38px;padding:0 14px;border:1px solid #444;border-radius:20px;background:#242424;color:#eee;font:inherit;font-size:13px;cursor:pointer}.sheet-remove:hover{border-color:#ff5555;color:#ff7777}
.server-add-form{padding-top:20px}.sheet-field{display:grid;grid-template-columns:126px minmax(0,1fr);gap:12px;align-items:center;min-height:48px;margin-bottom:0;border-bottom:1px solid #383838}
.sheet-field label{text-align:left;font-size:16px;font-weight:500;color:#dedede}.sheet-field input:not([type=checkbox]){min-width:0;width:100%;box-sizing:border-box;background:transparent;border:0;border-radius:4px;color:#ddd;padding:8px 4px;font:inherit;font-size:16px;outline:none}.sheet-field input::placeholder{color:#626262;opacity:1}#server-add-name::placeholder{color:#dedede}.sheet-field input:focus-visible{box-shadow:0 0 0 1px #ff8700}
.protocol-value{color:#949494;font-size:16px;padding-left:4px}.sheet-advanced{display:flex;align-items:center;gap:12px;margin:22px 0 4px;padding:12px 0;border:0;background:transparent;color:#ddd;font:inherit;font-size:16px;cursor:pointer}
.sheet-field select{background:#303030;color:#ddd;border:0;border-radius:7px;font:inherit;font-size:16px;padding:8px 12px;min-width:0;width:100%;height:38px;max-width:260px;cursor:pointer}.sheet-checkbox input{width:16px;height:16px;margin:0;accent-color:#ff8700;cursor:pointer}.sheet-actions{display:flex;justify-content:center;gap:12px;margin-top:30px;flex-wrap:wrap}.sheet-actions button{min-height:42px;min-width:145px;padding:0 20px;border:1px solid #555;border-radius:9px;background:#303030;color:#eee;font:inherit;font-size:16px;cursor:pointer}.sheet-actions button[type=submit]{background:#ff8700;color:#111;border-color:#ff8700}.sheet-actions button:disabled{opacity:.5;cursor:default}.sheet-back:disabled{opacity:.5;cursor:default}
@media(max-width:560px){:global(.server-add-sheet .arco-modal-body){padding:0 24px 40px!important}.sheet-field{grid-template-columns:92px minmax(0,1fr);gap:12px}.sheet-advanced{margin-left:104px}}
</style>

<style scoped>
.source-form-surface .sheet-heading h2{color:var(--color-text-1);font-size:17px}
.source-form-surface .sheet-field{grid-template-columns:100px minmax(0,1fr);gap:16px;border:0;min-height:40px}
.source-form-surface .sheet-field label{text-align:right;color:var(--color-text-2);font-size:14px}
.source-form-surface .sheet-field input:not([type=checkbox]){color:var(--color-text-1);font-size:14px}
.source-form-surface .sheet-back{left:0;color:var(--color-text-1);background:var(--color-fill-2);border-color:var(--color-border-2)}
.source-form-surface .sheet-advanced,.source-form-surface .sheet-actions{margin-left:116px;justify-content:flex-start}
.source-form-surface .sheet-advanced{color:var(--color-text-2);font-size:14px}
.source-form-surface .sheet-field select{background:var(--color-fill-2);color:var(--color-text-1);font-size:14px}
</style>
