<script lang="ts">
export const sourceProviderOptions = [['smb','SMB'], ['nfs','NFS'], ['ftp','FTP'], ['webdav', 'WebDAV'], ['alist', 'AList'], ['jellyfin', 'Jellyfin'], ['emby', 'Emby'], ['plex', 'Plex'], ['alipan-open','阿里云盘'], ['baidu','百度网盘'], ['123','123网盘'], ['115', '115网盘'], ['quark', '夸克网盘'], ['guangya', '光鸭云盘'], ['pikpak', 'PikPak'], ['139', '139云盘'], ['189', '天翼云盘'], ['onedrive', 'OneDrive'], ['google', 'Google Drive'], ['dropbox', 'Dropbox'], ['box', 'Box']] as const
</script>
<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { t } from '@/features/files/electron/i18n'
const props = defineProps<{
  provider: string
  protocolName?: string
  disabled?: boolean
  nameRequired?: boolean
  namePlaceholder?: string
  submitLabel: string
  submitDisabled?: boolean
}>()
const name = defineModel<string>('name', { required: true })
const emit = defineEmits<{ submit: [] }>()
const server = computed(() => ['jellyfin', 'emby', 'plex'].includes(props.provider))
const protocol = computed(() => props.protocolName || sourceProviderOptions.find(([id]) => id === (props.provider === 'aliyun' ? 'alipan-open' : props.provider))?.[1] || (props.provider === 'boxplayer' ? 'BoxPlayer' : props.provider))
</script>
<template>
  <form class="source-form" :class="{ 'server-connection': server }" @submit.prevent="emit('submit')">
    <label>{{ t('mediaServer.name') }}<input v-model="name" :disabled="disabled" :required="nameRequired" :placeholder="namePlaceholder" autocomplete="off" /></label>
    <label>{{ t('mediaServer.protocol') }}<span class="protocol-name">{{ protocol }}</span></label>
    <slot />
    <footer class="source-buttons">
      <Button type="submit" :disabled="disabled || submitDisabled">{{ submitLabel }}</Button>
      <slot name="actions" />
    </footer>
  </form>
</template>
<style scoped>
.source-form { display: grid; gap: 8px; align-content: start; max-width: 520px; width: 100%; align-self: center; margin-inline: auto; padding: 56px 28px 32px; }
.source-form :deep(label) { display: grid; grid-template-columns: 100px minmax(0,1fr); min-height: 40px; align-items: center; gap: 16px; font-size: 14px; text-align: right; }
.source-form :deep(input) { min-width: 0; width: 100%; border: 0; border-radius: 4px; padding: 8px 4px; background: transparent; color: inherit; outline-offset: 3px; font: inherit; }
.source-form :deep(select) { padding: 6px; border: 0; border-radius: 7px; background: var(--secondary); color: inherit; }
.protocol-name { text-align: left; color: var(--muted-text); }
.source-form :deep(> img) { justify-self: center; }
.source-form :deep(.advanced-toggle) { justify-self: center; border: 0; border-radius: 20px; padding: 5px 12px; background: var(--secondary); color: var(--muted-text); font-size: 12px; cursor: pointer; }
.source-buttons { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 8px; margin: 24px 0 0 116px; }
.source-buttons :deep(> button) { flex: none; width: auto; min-width: 128px; min-height: 36px; border-radius: 7px; font-size: 14px; }
.source-form :deep([role=alert]) { color: var(--destructive, #c33); }
.source-form.server-connection { width: calc(100% - 56px); max-width: none; margin: 0 28px; padding: 20px 0 0; gap: 0; }
.server-connection :deep(.advanced-toggle) { justify-self: start; display: flex; align-items: center; gap: 12px; padding: 12px 0; margin: 22px 0 4px 116px; background: transparent; border-radius: 0; font-size: 14px; line-height: 22px; }
.server-connection .source-buttons { margin-top: 26px; }
.server-connection .source-buttons :deep(> button) { width: 145px; min-height: 42px; border-radius: 9px; font-size: 16px; }
.server-connection :deep(input:not([type=checkbox])), .server-connection .protocol-name { line-height: 22px; }
.server-connection .protocol-name { padding: 8px 4px; }
.server-connection > label:first-child input::placeholder { color: var(--foreground); }
.source-form :deep(.library-mode input) { width: 16px; height: 16px; margin: 0; justify-self: start; accent-color: var(--primary); }
@media (max-width: 650px) {
  .source-form { padding: 20px 16px; }
  .source-form :deep(label) { grid-template-columns: 1fr; gap: 5px; text-align: left; }
  .source-buttons, .server-connection .source-buttons { margin-left: 0; justify-content: center; }
  .server-connection :deep(.advanced-toggle) { margin-left: 0; }
}
</style>
