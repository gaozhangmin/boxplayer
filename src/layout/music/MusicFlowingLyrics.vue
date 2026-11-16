<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FlowingLyricsRenderer, type FlowingColors } from '../../utils/radio/FlowingLyrics'
import { t } from '../../i18n'
const props = defineProps<{ text: string; playing: boolean; colors: FlowingColors; transparent?: boolean }>()
const emit = defineEmits<{ (e: 'exit'): void; (e: 'standard'): void; (e: 'settings'): void }>()
const root = ref<HTMLElement>(), canvas = ref<HTMLCanvasElement>(), menu = ref(false)
let renderer: FlowingLyricsRenderer | undefined, observer: ResizeObserver | undefined
let frame = 0, elapsed = 0, previous = 0
const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
function paint() { renderer?.draw(elapsed, motion.matches, props.transparent) }
function stop() { cancelAnimationFrame(frame); frame = 0; previous = 0 }
function animate(now: number) {
  if (previous) elapsed += Math.max(0, Math.min(.1, (now - previous) / 1000))
  previous = now; paint(); frame = requestAnimationFrame(animate)
}
function update() {
  stop(); renderer?.update(props.text, props.colors); paint()
  if (props.playing && !motion.matches && !document.hidden) frame = requestAnimationFrame(animate)
}
onMounted(() => {
  renderer = new FlowingLyricsRenderer(canvas.value!)
  observer = new ResizeObserver(() => {
    const rect = root.value!.getBoundingClientRect(); renderer?.resize(rect.width, rect.height); paint()
  })
  observer.observe(root.value!); update(); root.value?.focus()
  motion.addEventListener('change', update); document.addEventListener('visibilitychange', update)
})
watch(() => [props.text, props.playing, props.colors.text, props.colors.light, props.colors.background, props.transparent], update)
watch(() => props.transparent, value => { if (value) menu.value = false })
onBeforeUnmount(() => { stop(); observer?.disconnect(); motion.removeEventListener('change', update); document.removeEventListener('visibilitychange', update) })
</script>
<template>
  <div ref="root" class="flowing-lyrics" :class="{ transparent }" tabindex="0" :aria-label="text" @dblclick.stop="emit('exit')" @contextmenu.prevent="menu = !menu" @keydown.esc.stop.prevent="emit('exit')">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <div v-if="menu" class="flowing-menu" @dblclick.stop>
      <button @click="emit('standard')">{{ t('music.standardLyrics') }}</button>
      <button @click="emit('settings'); menu = false">{{ t('music.lyricAppearance') }}</button>
      <button @click="emit('exit')">{{ t('music.done') }}</button>
    </div>
    <span class="flowing-hint">{{ t('music.flowingLyricsHint') }}</span>
  </div>
</template>
<style scoped>
.flowing-lyrics { position: absolute; inset: 0; z-index: 12; outline: none; overflow: hidden; background: #090310; }
canvas { display: block; width: 100%; height: 100%; }
.flowing-menu { position: absolute; top: 24px; right: 24px; display: flex; gap: 8px; padding: 12px; border-radius: 16px; background: #20202eea; }
button { color: white; background: #ffffff18; border: 1px solid #ffffff30; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
button:focus-visible { outline: 2px solid #d6adff; }
.flowing-hint { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.flowing-lyrics.transparent{background:transparent}
</style>
