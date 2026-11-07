<script setup lang="ts">
import PlaybackSubtitleNumberRow from './PlaybackSubtitleNumberRow.vue'
import useSettingStore from '../setting/settingstore'
const store = useSettingStore()
const emit = defineEmits<{ change: [] }>()
const rows = [
  { key: 'danmakuDelay', label: '延迟显示', min: -100, max: 100, step: 0.1, unit: ' s' },
  { key: 'danmakuFontSize', label: '字体大小', min: 12, max: 80, step: 1, unit: '' },
  { key: 'danmakuBorderSize', label: '描边大小', min: 0, max: 10, step: 0.1, unit: '' },
  { key: 'speed', label: '弹幕速度', min: 50, max: 300, step: 10, unit: '%' },
  { key: 'opacity', label: '不透明度', min: 0, max: 100, step: 5, unit: '%' },
  { key: 'area', label: '显示区域', min: 10, max: 100, step: 5, unit: '%' }
] as const
const value = (key: string) => key === 'speed' ? Math.round(500 / store.danmakuSpeed) : key === 'opacity' ? Math.round(store.danmakuOpacity * 100) : key === 'area' ? 100 - parseFloat(store.danmakuMarginBottom || '0') : Number(store.$state[key as keyof typeof store.$state])
const set = (key: string, next: number) => {
  if (key === 'speed') store.updateStore({ danmakuSpeed: 500 / next })
  else if (key === 'opacity') store.updateStore({ danmakuOpacity: next / 100 })
  else if (key === 'area') store.updateStore({ danmakuMarginBottom: `${100 - next}%` })
  else store.updateStore({ [key]: next })
  emit('change')
}
</script>
<template>
  <div class="playback-danmaku-settings">
    <PlaybackSubtitleNumberRow v-for="row in rows" :key="row.key"
      :label="row.label" :value="value(row.key)" :min="row.min" :max="row.max"
      :step="row.step" :unit="row.unit" :digits="row.step < 1 ? 1 : 0"
      :editable="row.key === 'danmakuDelay'" @change="set(row.key, $event)" />
  </div>
</template>
<style scoped>
.playback-danmaku-settings { display:grid; color:inherit; }
.playback-danmaku-settings :deep(.subtitle-number-row) { min-height:54px; }
.playback-danmaku-settings :deep(.subtitle-number-row:last-child) { border-bottom:0; }
</style>
