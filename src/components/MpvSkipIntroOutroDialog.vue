<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { Clock, Minus, Plus, Settings, X } from 'lucide-vue-next'

const props = defineProps<{ position: number; duration: number }>()
const emit = defineEmits<{ close: [] }>()
const introEnabled = defineModel<boolean>('introEnabled', { required: true })
const outroEnabled = defineModel<boolean>('outroEnabled', { required: true })
const introSeconds = defineModel<number>('introSeconds', { required: true })
const outroSeconds = defineModel<number>('outroSeconds', { required: true })
const dialog = shallowRef<HTMLDialogElement | null>(null)
const autoSkip = computed({
  get: () => introEnabled.value || outroEnabled.value,
  set: (enabled: boolean) => { introEnabled.value = enabled; outroEnabled.value = enabled }
})
const rows = computed(() => [
  { key: 'intro', title: '自定义跳过片头', detail: '从当前位置设置，或以 1 秒为步长调整', enabled: introEnabled.value, seconds: introSeconds.value },
  { key: 'outro', title: '自定义跳过片尾', detail: '设置在结束前多久开始跳过', enabled: outroEnabled.value, seconds: outroSeconds.value }
])
const toggle = (key: string) => {
  if (key === 'intro') introEnabled.value = !introEnabled.value
  else outroEnabled.value = !outroEnabled.value
}
const setDuration = (key: string, seconds: number) => {
  const value = Math.max(0, Math.round(seconds))
  if (key === 'intro') introSeconds.value = value
  else outroSeconds.value = value
}
const mark = (key: string) => {
  setDuration(key, key === 'intro' ? props.position : props.duration - props.position)
  if (key === 'intro') introEnabled.value = true
  else outroEnabled.value = true
}
const formatDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="skip-dialog" aria-labelledby="mpv-skip-title" @cancel.prevent="emit('close')" @click.self="emit('close')">
    <div class="skip-panel" @click.stop>
      <header><h2 id="mpv-skip-title"><Settings :size="20" />播放</h2><button class="skip-close" aria-label="关闭" type="button" autofocus @click="emit('close')"><X :size="20" /></button></header>
      <div class="skip-content">
        <section class="skip-row skip-master">
          <div><h3>自动跳过片头片尾</h3><p>自动跳过片头和片尾字幕。</p></div>
          <button class="skip-switch" :class="{ enabled: autoSkip }" role="switch" :aria-checked="autoSkip" aria-label="自动跳过片头片尾" type="button" @click="autoSkip = !autoSkip"><span /></button>
        </section>
        <section v-for="row in rows" :key="row.key" class="skip-marker">
          <div class="skip-row">
            <div><h3>{{ row.title }}</h3><p>{{ row.detail }}</p></div>
            <button class="skip-switch" :class="{ enabled: row.enabled }" role="switch" :aria-checked="row.enabled" :aria-label="row.title" type="button" @click="toggle(row.key)"><span /></button>
          </div>
          <div class="skip-actions">
            <button class="skip-mark" type="button" :disabled="duration <= 0" @click="mark(row.key)"><Clock :size="19" />使用当前位置</button>
            <div class="skip-duration" role="group" :aria-label="row.title + '时长'">
              <button :aria-label="row.title + '减少一秒'" :disabled="row.seconds <= 0" type="button" @click="setDuration(row.key, row.seconds - 1)"><Minus :size="18" /></button>
              <output :aria-label="row.title + '时长'">{{ formatDuration(row.seconds) }}</output>
              <button :aria-label="row.title + '增加一秒'" type="button" @click="setDuration(row.key, row.seconds + 1)"><Plus :size="18" /></button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.skip-dialog { position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 24px; box-sizing: border-box; border: 0; background: transparent; color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.skip-dialog[open] { display: grid; place-items: center; }
.skip-dialog::backdrop { background: transparent; }
.skip-panel { width: min(680px, 100%); max-height: 100%; overflow-y: auto; border: 1px solid rgba(255,255,255,.35); border-radius: 26px; background: linear-gradient(135deg, rgba(17,20,27,.94), rgba(36,49,70,.88), rgba(17,20,27,.94)); backdrop-filter: blur(30px); box-shadow: 0 16px 32px rgba(0,0,0,.5); }
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,.32); }
h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 17px; }
button { display: inline-flex; align-items: center; justify-content: center; border: 0; color: white; cursor: pointer; font: inherit; }
button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
button:disabled { opacity: .35; cursor: default; }
.skip-close { width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,.1); }
.skip-content { padding: 0 24px; }
.skip-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
h3 { margin: 0; font-size: 20px; font-weight: 700; }
p { margin: 4px 0 0; color: rgba(255,255,255,.72); font-size: 14px; }
.skip-master, .skip-marker { padding: 18px 0; }
.skip-marker { border-top: 1px solid rgba(255,255,255,.32); }
.skip-switch { flex: 0 0 58px; width: 58px; height: 34px; padding: 3px; border-radius: 17px; background: rgba(255,255,255,.22); justify-content: flex-start; }
.skip-switch.enabled { background: #34c759; }
.skip-switch span { width: 28px; height: 28px; border-radius: 50%; background: white; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
.skip-switch.enabled span { transform: translateX(24px); }
.skip-actions { display: flex; gap: 12px; margin-top: 14px; }
.skip-mark { flex: 1; min-height: 48px; justify-content: flex-start; gap: 8px; padding: 0 18px; border: 1px solid rgba(255,255,255,.52); border-radius: 13px; background: rgba(255,255,255,.1); font-weight: 700; }
.skip-duration { display: flex; align-items: center; border: 1px solid rgba(255,255,255,.25); border-radius: 13px; background: rgba(255,255,255,.15); }
.skip-duration button { width: 44px; height: 48px; background: transparent; }
.skip-duration output { width: 82px; text-align: center; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
@media (max-width: 520px) { .skip-dialog { padding: 12px; } .skip-content { padding: 0 18px; } header { padding: 14px 18px; } h3 { font-size: 17px; } .skip-actions { flex-wrap: wrap; } .skip-mark { flex-basis: 100%; } }
</style>
