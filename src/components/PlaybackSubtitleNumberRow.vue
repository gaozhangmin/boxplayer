<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'
const props = withDefaults(defineProps<{ label: string; value: number; min: number; max: number; step: number; unit?: string; digits?: number; editable?: boolean; disabled?: boolean }>(), { unit: '', digits: 0, editable: false, disabled: false })
const emit = defineEmits<{ change: [value: number] }>()
const change = (value: number) => { if (Number.isFinite(value)) emit('change', Math.max(props.min, Math.min(props.max, Number(value.toFixed(3))))) }
</script>
<template>
  <div class="subtitle-number-row" :class="{ 'is-disabled': disabled }">
    <span>{{ label }}</span>
    <input v-if="editable" :disabled="disabled" :value="value.toFixed(digits)" :min="min" :max="max" :step="step" type="number" :aria-label="label" @change="change(Number(($event.target as HTMLInputElement).value))" />
    <span v-else class="subtitle-number-value">{{ value.toFixed(digits) }}{{ unit }}</span>
    <span v-if="editable">{{ unit }}</span>
    <div class="subtitle-stepper">
      <button type="button" :disabled="disabled || value <= min" :aria-label="`减少${label}`" @click="change(value - step)"><Minus :size="16" /></button>
      <button type="button" :disabled="disabled || value >= max" :aria-label="`增加${label}`" @click="change(value + step)"><Plus :size="16" /></button>
    </div>
  </div>
</template>
<style scoped>
.subtitle-number-row { display:flex; align-items:center; gap:8px; min-height:48px; border-bottom:1px solid #80808022; }
.subtitle-number-row > span:first-child { flex:1; }
.subtitle-number-row.is-disabled { opacity:.4; }
.subtitle-number-value { font-variant-numeric:tabular-nums; }
input { width:60px; border:0; border-radius:8px; padding:6px; background:#80808022; color:inherit; text-align:right; }
.subtitle-stepper { display:flex; background:#80808022; border-radius:20px; }
button { display:grid; place-items:center; width:34px; height:30px; background:transparent; border:0; color:inherit; cursor:pointer; }
button + button { border-left:1px solid #80808030; }
button:disabled { opacity:.3; cursor:default; }
</style>
