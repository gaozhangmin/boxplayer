<script setup lang="ts">
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
    <label><input :checked="store.danmakuVisible" type="checkbox" @change="store.updateStore({ danmakuVisible: ($event.target as HTMLInputElement).checked }); emit('change')" /> 显示弹幕</label>
    <div v-for="row in rows" :key="row.key" class="playback-danmaku-row">
      <span>{{ row.label }}</span>
      <input :value="value(row.key)" :min="row.min" :max="row.max" :step="row.step" type="number" :aria-label="row.label" @change="set(row.key, Math.max(row.min, Math.min(row.max, Number(($event.target as HTMLInputElement).value))))" />
      <span>{{ row.unit }}</span>
      <button type="button" :disabled="value(row.key) <= row.min" :aria-label="`减少${row.label}`" @click="set(row.key, Math.max(row.min, Number((value(row.key) - row.step).toFixed(2))))">−</button>
      <button type="button" :disabled="value(row.key) >= row.max" :aria-label="`增加${row.label}`" @click="set(row.key, Math.min(row.max, Number((value(row.key) + row.step).toFixed(2))))">+</button>
    </div>
  </div>
</template>
<style scoped>
.playback-danmaku-settings { display: grid; gap: 12px; color: inherit; }
.playback-danmaku-row { display: grid; grid-template-columns: minmax(72px,1fr) 65px 24px 32px 32px; gap: 6px; align-items: center; min-height: 44px; }
input[type=number] { min-width: 0; width: 100%; box-sizing: border-box; color: inherit; background: #80808025; border: 0; border-radius: 8px; padding: 6px; }
button { color: inherit; background: #80808025; border: 0; border-radius: 12px; min-height: 32px; cursor: pointer; }
button:disabled { opacity: .35; cursor: default; }
</style>
