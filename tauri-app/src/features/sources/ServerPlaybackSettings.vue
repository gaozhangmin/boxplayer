<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { nativeCall } from '@/platform/native'
import { defaultServerPlayback } from '@/platform/contracts'
import type { Account } from './contracts'
import { MEDIA_SERVER_PLAYBACK_QUALITY_OPTIONS, MEDIA_SERVER_COMPATIBILITY_OPTIONS, normalizeMediaServerCustomDeviceProfile, type MediaServerPlaybackQuality, type MediaServerPlaybackCompatibility } from './playbackQuality'
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ back: [] }>()
const settings = useSettingsStore()
const quality = ref<MediaServerPlaybackQuality>('max'), compatibility = ref<MediaServerPlaybackCompatibility>('auto')
const profile = ref(''), error = ref(''), status = ref(''), measuring = ref(false)
let requestId = '', alive = true, stopped = false, originalProfile = ''
onMounted(async () => { try { await settings.initialize();if(!settings.ready)throw new Error(settings.error||'无法读取播放设置');const current = settings.value.serverPlayback || defaultServerPlayback();quality.value = current.quality;compatibility.value = current.compatibility;profile.value = JSON.stringify(current.customProfile, null, 2);originalProfile=JSON.stringify(current) } catch (cause) { error.value = (cause as Error).message } })
onUnmounted(() => { alive = false;if (requestId) void nativeCall('auth_cancel', { requestId }).catch(() => {}) })
async function save() {
 if(settings.preview||!settings.ready||settings.saving)return
 error.value = '';status.value = ''
 try {
  if(originalProfile!==JSON.stringify(settings.value.serverPlayback||defaultServerPlayback()))throw new Error('播放设置已在其他窗口更新，请返回后重新编辑')
  if (profile.value.length > 65536) throw new Error('设备配置不能超过 64 KiB')
  const parsed: unknown = JSON.parse(profile.value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('设备配置必须是 JSON 对象')
  if (!Array.isArray((parsed as Record<string, unknown>).DirectPlayProfiles) || !Array.isArray((parsed as Record<string, unknown>).TranscodingProfiles)) throw new Error('设备配置需要 DirectPlayProfiles 和 TranscodingProfiles 数组')
  await settings.save({ serverPlayback: { quality: quality.value, compatibility: compatibility.value, customProfile: normalizeMediaServerCustomDeviceProfile(parsed) } })
  if (alive) {originalProfile=JSON.stringify(settings.value.serverPlayback||defaultServerPlayback());status.value = '已保存，下次播放生效'}
 } catch (cause) { if (alive) error.value = (cause as {message?:string})?.message || '保存播放设置失败' }
}
async function measure() {
 if (measuring.value) return
 measuring.value = true;stopped=false;error.value = '';status.value = '';requestId = crypto.randomUUID()
 try { const result = await nativeCall<{bytes:number;durationMs:number;bitrate:number}>('server_bitrate_test', { accountId: props.account.id, requestId });if (alive) status.value = `HTTP 吞吐量 ${(result.bitrate / 1000000).toFixed(2)} Mbps（${(result.bytes / 1000000).toFixed(1)} MB）` }
 catch (cause) { if (alive) {if(stopped)status.value='测试已停止';else error.value = (cause as {message?:string})?.message || '码率测试失败'} }
 finally { measuring.value = false;requestId = '' }
}
async function stop() { stopped=true;const id = requestId;if (id) await nativeCall('auth_cancel', { requestId: id }).catch(() => {}) }
</script>
<template>
 <form class="playback-settings" @submit.prevent="save">
  <p>这些偏好适用于所有 Jellyfin / Emby 来源。</p>
  <label>播放码率<select v-model="quality" :disabled="settings.saving"><option v-for="option in MEDIA_SERVER_PLAYBACK_QUALITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
  <label>设备兼容性<select v-model="compatibility" :disabled="settings.saving"><option v-for="option in MEDIA_SERVER_COMPATIBILITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
  <label v-if="compatibility==='custom'">自定义设备 JSON<textarea v-model="profile" :disabled="settings.saving" rows="12" maxlength="65536" spellcheck="false" /></label>
  <div class="playback-actions"><Button type="button" variant="outline" :disabled="settings.saving" @click="emit('back')">返回</Button><Button :disabled="settings.preview||!settings.ready||settings.saving">保存播放设置</Button><Button type="button" variant="outline" :disabled="settings.preview||measuring" @click="measure">码率测试（5 MB）</Button><Button v-if="measuring" type="button" variant="ghost" @click="stop">停止测试</Button></div>
  <p v-if="status" role="status">{{ status }}</p><p v-if="error" role="alert">{{ error }}</p>
 </form>
</template>
<style scoped>
.playback-settings{display:grid;gap:16px;font-size:14px}.playback-settings p{margin:0;color:var(--muted-text)}.playback-settings label{display:grid;gap:8px}.playback-settings select,.playback-settings textarea{width:100%;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--control-surface);color:inherit}.playback-settings textarea{resize:vertical;font-family:ui-monospace,monospace;font-size:12px}.playback-actions{display:flex;gap:8px;flex-wrap:wrap}.playback-settings p[role=alert]{color:#c33}
</style>
