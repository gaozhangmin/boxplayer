<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import type { NetShareKind } from '@shared/netShare'
import { NET_SHARE_DEFAULT_PORTS } from '@shared/netShare'
import { createNetShareConnection, listNetShareShares, protectNetShareSecret, saveWebDavConnection, testWebDavConnection, type WebDavConnectionConfig } from '../utils/webdavClient'
import { createRemoteDriveAccount } from '../utils/remoteDriveAccount'
import { useMediaLibraryStore } from '../store/medialibrary'
import UserDAL from '../user/userdal'
import message from '../utils/message'
import { t } from '../i18n'

const props = defineProps<{ kind: NetShareKind; existing?: WebDavConnectionConfig; sourceName?: string; embedded?: boolean; removable?: boolean }>()
const emit = defineEmits<{ saved: [connection: WebDavConnectionConfig]; cancel: []; remove: [] }>()

const existing = props.existing
const form = ref({
  // Defaults are placeholders only; an empty name falls back to the default when saving.
  name: existing?.name || '',
  host: existing?.host || '',
  port: existing?.port ? String(existing.port) : '',
  share: existing?.share || '',
  domain: existing?.domain || '',
  anonymous: !!existing?.anonymous,
  username: existing?.username || '',
  // Never echo the stored (possibly encrypted) secret; empty means "keep the saved password".
  password: '',
  exportPath: existing?.exportPath || '',
  rootPath: existing?.rootPath && existing.rootPath !== '/' ? existing.rootPath : '',
  secure: !!existing?.secure,
  allowUntrustedCert: !!existing?.allowUntrustedCert,
  encoding: existing?.encoding || 'utf8'
})
const advanced = ref(false)
const busy = ref<'' | 'test' | 'save' | 'shares'>('')
const shares = ref<string[]>([])
const label = computed(() => props.kind.toUpperCase())
const keepsSavedPassword = computed(() => !!existing?.password && !form.value.password && !form.value.anonymous)

const validate = () => {
  if (!form.value.host.trim()) { message.error(t('netShare.hostRequired')); return false }
  if (props.kind === 'nfs' && !form.value.exportPath.trim()) { message.error(t('netShare.exportRequired')); return false }
  if (props.kind !== 'nfs' && !form.value.anonymous && !form.value.username.trim()) { message.error(t('netShare.usernameRequired')); return false }
  return true
}

const buildConnection = async () => {
  const password = keepsSavedPassword.value ? existing!.password : await protectNetShareSecret(form.value.password)
  const name = form.value.name.trim() || props.sourceName || t('source.defaultName', { type: label.value })
  const connection = createNetShareConnection({ kind: props.kind, ...form.value, name, password }, existing)
  if (keepsSavedPassword.value) connection.password = existing!.password
  return connection
}

const errorText = (error: any) => String(error?.message || error || t('media.unknownError'))

async function testConnection() {
  if (!validate() || busy.value) return
  busy.value = 'test'
  try {
    await testWebDavConnection(await buildConnection())
    message.success(t('netShare.testOk'))
  } catch (error) {
    message.error(t('netShare.testFailed', { error: errorText(error) }))
  } finally { busy.value = '' }
}

async function loadShares() {
  if (!validate() || busy.value) return
  busy.value = 'shares'
  try {
    shares.value = await listNetShareShares(await buildConnection())
    if (!shares.value.length) message.info(t('netShare.noShares'))
  } catch (error) {
    message.error(t('netShare.testFailed', { error: errorText(error) }))
  } finally { busy.value = '' }
}

async function save() {
  if (!validate() || busy.value) return
  busy.value = 'save'
  try {
    const connection = await buildConnection()
    await testWebDavConnection(connection)
    saveWebDavConnection(connection)
    if (!existing) {
      const account = createRemoteDriveAccount(connection)
      const mediaStore = useMediaLibraryStore()
      if (!mediaStore.folders.some(folder => folder.id === account.folder.id)) mediaStore.addFolder(account.folder)
      await UserDAL.UserLogin(account.token, false, connection.name)
      message.success(t('netShare.connected', { type: label.value }))
    }
    emit('saved', connection)
  } catch (error) {
    message.error(t('netShare.testFailed', { error: errorText(error) }))
  } finally { busy.value = '' }
}
</script>

<template>
  <form class="net-share-form" :class="{ embedded }" @submit.prevent="save">
    <div class="ns-field"><label for="ns-name">{{ t('mediaServer.name') }}</label><input id="ns-name" v-model="form.name" :placeholder="t('source.defaultName', { type: label })" :disabled="!!busy" autocomplete="off" /></div>
    <div class="ns-field"><label>{{ t('mediaServer.protocol') }}</label><span class="ns-value">{{ label }}</span></div>
    <div class="ns-field"><label for="ns-host">{{ t('mediaServer.address') }}</label><input id="ns-host" v-model="form.host" :placeholder="kind === 'smb' ? '192.168.1.10 / nas.local' : kind === 'nfs' ? '192.168.1.10' : 'ftp.example.com'" :disabled="!!busy" autocapitalize="off" spellcheck="false" /></div>
    <div v-if="kind === 'smb'" class="ns-field"><label for="ns-share">{{ t('netShare.share') }}</label>
      <div class="ns-inline">
        <a-select v-if="shares.length" v-model="form.share" allow-create allow-clear :options="shares" :placeholder="t('netShare.sharePlaceholder')" :disabled="!!busy" />
        <input v-else id="ns-share" v-model="form.share" :placeholder="t('netShare.sharePlaceholder')" :disabled="!!busy" />
        <button type="button" class="ns-link" :disabled="!!busy" @click="loadShares">{{ busy === 'shares' ? t('netShare.listShares') + '…' : t('netShare.listShares') }}</button>
      </div>
    </div>
    <div v-if="kind === 'nfs'" class="ns-field"><label for="ns-export">{{ t('netShare.exportPath') }}</label><input id="ns-export" v-model="form.exportPath" placeholder="/volume1/video" :disabled="!!busy" /></div>
    <p v-if="kind === 'nfs'" class="ns-hint ns-field-hint">{{ t('netShare.exportPathHint') }}</p>
    <template v-if="kind !== 'nfs' && !form.anonymous">
      <div class="ns-field"><label for="ns-user">{{ t('mediaServer.username') }}</label><input id="ns-user" v-model="form.username" placeholder="johnappleseed" :disabled="!!busy" autocomplete="username" /></div>
      <div class="ns-field"><label for="ns-password">{{ t('mediaServer.password') }}</label><input id="ns-password" v-model="form.password" type="password" :placeholder="existing?.password ? t('netShare.keepPassword') : t('mediaServer.password')" :disabled="!!busy" autocomplete="current-password" /></div>
    </template>
    <div v-if="kind !== 'nfs'" class="ns-field ns-checkbox"><label for="ns-anonymous">{{ kind === 'smb' ? t('netShare.guest') : t('netShare.anonymous') }}</label><input id="ns-anonymous" v-model="form.anonymous" type="checkbox" :disabled="!!busy" /></div>
    <button type="button" class="ns-advanced" :aria-expanded="advanced" :disabled="!!busy" @click="advanced = !advanced">{{ t('mediaServer.advanced') }}<ChevronUp v-if="advanced" :size="16" /><ChevronDown v-else :size="16" /></button>
    <div v-if="advanced" class="ns-advanced-fields">
      <div class="ns-field"><label for="ns-port">{{ t('netShare.port') }}</label><input id="ns-port" v-model="form.port" inputmode="numeric" :placeholder="String(NET_SHARE_DEFAULT_PORTS[kind])" :disabled="!!busy" /></div>
      <div v-if="kind === 'smb'" class="ns-field"><label for="ns-domain">{{ t('netShare.domain') }}</label><input id="ns-domain" v-model="form.domain" :placeholder="t('netShare.optional')" :disabled="!!busy" /></div>
      <div class="ns-field"><label for="ns-path">{{ t('netShare.startDir') }}</label><input id="ns-path" v-model="form.rootPath" :placeholder="t('netShare.startDirPlaceholder')" :disabled="!!busy" /></div>
      <template v-if="kind === 'ftp'">
        <div class="ns-field ns-checkbox"><label for="ns-ftps">FTPS</label><input id="ns-ftps" v-model="form.secure" type="checkbox" :disabled="!!busy" /></div>
        <div v-if="form.secure" class="ns-field ns-checkbox"><label for="ns-untrusted">{{ t('netShare.allowUntrusted') }}</label><input id="ns-untrusted" v-model="form.allowUntrustedCert" type="checkbox" :disabled="!!busy" /></div>
        <div class="ns-field"><label>{{ t('netShare.encoding') }}</label><a-select v-model="form.encoding" allow-create :options="['utf8', 'gbk', 'gb18030', 'big5', 'shift_jis', 'euc-kr', 'latin1']" :disabled="!!busy" /></div>
      </template>
      <p v-if="kind === 'nfs'" class="ns-hint">{{ t('netShare.nfsHint') }}</p>
      <p v-else-if="kind === 'ftp'" class="ns-hint">{{ t('netShare.ftpHint') }}</p>
    </div>
    <div class="ns-actions">
      <button type="submit" :disabled="!!busy || !form.host.trim()">{{ busy === 'save' ? t('mediaServer.connect') + '…' : existing ? t('unified.saveSource') : t('mediaServer.connect') }}</button>
      <button type="button" :disabled="!!busy || !form.host.trim()" @click="testConnection">{{ busy === 'test' ? t('netShare.test') + '…' : t('netShare.test') }}</button>
      <button v-if="removable" type="button" class="ns-remove" :disabled="!!busy" @click="emit('remove')">{{ t('common.delete') }}</button>
    </div>
  </form>
</template>

<style scoped>
.net-share-form{display:flex;flex-direction:column;width:100%;max-width:520px;box-sizing:border-box;margin:0 auto;padding:8px 0;color:var(--color-text-1)}
.net-share-form.embedded{padding:20px 0 24px;overflow:auto}
.ns-field{display:grid;grid-template-columns:100px minmax(0,1fr);gap:16px;align-items:center;min-height:40px}
.ns-field>label{text-align:right;color:var(--color-text-2);font-size:14px}
.ns-field input:not([type=checkbox]){min-width:0;width:100%;box-sizing:border-box;background:transparent;border:0;border-radius:4px;color:var(--color-text-1);padding:8px 4px;font:inherit;font-size:14px;outline:none}
.ns-field input::placeholder{color:var(--color-text-4);opacity:1}
.ns-field input:focus-visible{box-shadow:0 0 0 1px #ff8700}
.ns-checkbox input{width:16px;height:16px;margin:0 0 0 4px;accent-color:#ff8700;cursor:pointer}
.ns-value{color:var(--color-text-3);font-size:14px;padding-left:4px}
.ns-inline{display:flex;gap:8px;align-items:center;min-width:0}
.ns-inline>:first-child{flex:1;min-width:0}
.ns-link{flex:none;border:0;background:transparent;color:#ff8700;font:inherit;font-size:13px;cursor:pointer}
.ns-link:disabled{opacity:.5;cursor:default}
.ns-advanced{display:flex;align-items:center;gap:12px;margin:16px 0 4px 116px;padding:8px 0;border:0;background:transparent;color:var(--color-text-2);font:inherit;font-size:14px;cursor:pointer}
.ns-hint{margin:4px 0 0 116px;font-size:12px;color:var(--color-text-3);line-height:1.5}.ns-field-hint{margin-top:-6px}
.ns-actions{display:flex;gap:12px;margin:26px 0 0 116px;flex-wrap:wrap}
.ns-actions button{min-height:38px;min-width:130px;padding:0 20px;border:1px solid var(--color-border-2);border-radius:9px;background:var(--color-fill-2);color:var(--color-text-1);font:inherit;font-size:14px;cursor:pointer}
.ns-actions button[type=submit]{background:#ff8700;color:#111;border-color:#ff8700}
.ns-actions button:disabled{opacity:.5;cursor:default}
.ns-actions .ns-remove{color:rgb(var(--danger-6))}.ns-actions .ns-remove:hover:not(:disabled){border-color:rgb(var(--danger-6))}
.ns-field :deep(.arco-select-view){background:var(--color-fill-2)}
@media(max-width:560px){.ns-field{grid-template-columns:84px minmax(0,1fr);gap:12px}.ns-advanced,.ns-hint,.ns-actions{margin-left:96px}}
</style>
