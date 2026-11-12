<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { mediaShareText, type MediaShareTarget } from '../utils/mediaShare'
import { supportsCreateShare } from '../drive/providerFeatures'
import DriveShare from '../drive/share'
import { copyToClipboard } from '../utils/electronhelper'
const target = ref<MediaShareTarget | null>(null)
const selected = ref(0)
const result = ref('')
const error = ref('')
const busy = ref(false)
const candidates = computed(() => (target.value?.files || []).filter(file => file.userId && file.driveId !== 'local' && file.driveServerId !== 'local' && supportsCreateShare(file.userId, file.driveId)))
function open(event: Event) { if (busy.value) return; const item = (event as CustomEvent<MediaShareTarget>).detail; if (!item?.id || !item.title) return; target.value = item; selected.value = 0; result.value = ''; error.value = '' }
function copy(text: string) { try { copyToClipboard(text); result.value = text; error.value = '' } catch { error.value = t('mediaShare.copyError') } }
async function create() {
 const file = candidates.value[selected.value], item = target.value
 if (!file?.userId || !item || busy.value) return
 busy.value = true; error.value = ''
 try {
  const share = await DriveShare.ApiCreatShare(file.userId, file.driveId, '', '', item.title, [file.id])
  if (typeof share === 'string') throw new Error(share)
  if (!share.share_url) throw new Error(t('mediaShare.createError'))
  result.value = [mediaShareText(item), share.share_url, share.share_pwd ? t('mediaShare.password', { password: share.share_pwd }) : ''].filter(Boolean).join('\n')
 } catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure) } finally { busy.value = false }
}
onMounted(() => window.addEventListener('boxplayer:media-share', open))
onUnmounted(() => window.removeEventListener('boxplayer:media-share', open))
</script>
<template><a-modal :visible="!!target" :title="t('fileContext.share')" :footer="false" :width="480" :mask-closable="!busy" :esc-to-close="!busy" :closable="!busy" @cancel="!busy && (target = null)"><div class="media-share"><strong>{{ target?.title }}</strong><p>{{ t('mediaShare.infoNote') }}</p><a-button :disabled="busy" @click="target && copy(mediaShareText(target))">{{ t('mediaShare.copyInfo') }}</a-button><template v-if="candidates.length"><p>{{ t('mediaShare.linkNote') }}</p><a-select v-model="selected" :disabled="busy" :aria-label="t('mediaShare.file')"><a-option v-for="(file, index) in candidates" :key="file.id + ':' + file.driveId" :value="index">{{ file.name }}</a-option></a-select><a-button type="primary" :loading="busy" @click="create">{{ t('mediaShare.createLink') }}</a-button></template><p v-else>{{ t('mediaShare.noFileLink') }}</p><template v-if="result"><a-textarea :model-value="result" readonly :auto-size="{ minRows: 3, maxRows: 8 }" /><a-button :disabled="busy" @click="copy(result)">{{ t('mediaShare.copyResult') }}</a-button></template><p v-if="error" role="alert">{{ error }}</p></div></a-modal></template>
<style scoped>.media-share{display:flex;flex-direction:column;gap:12px}.media-share p{margin:0;color:var(--color-text-3)}.media-share p[role=alert]{color:rgb(var(--danger-6))}</style>
