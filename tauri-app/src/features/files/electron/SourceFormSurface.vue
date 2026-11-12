<script setup lang="ts">
import { watch, nextTick } from 'vue'

const props = defineProps<{
  embedded?: boolean
  closable?: boolean
  visible: boolean
  title?: string
  modalClass?: string
  width?: number | string
  maskClosable?: boolean
}>()
const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'before-open': []
  close: []
}>()
watch(() => props.visible, async visible => {
  if (!props.embedded) return
  if (visible) { await nextTick(); if (props.visible) emit('before-open') }
  else emit('close')
}, { immediate: true })
function close() { emit('update:visible', false) }
</script>

<template>
  <section v-if="embedded && visible" class="source-form-surface">
    <header v-if="$slots.title || title" class="source-form-heading"><slot name="title"><h2>{{ title }}</h2></slot></header>
    <slot />
  </section>
  <a-modal v-else-if="!embedded" :visible="visible" :title="title" :width="width" :modal-class="modalClass" :footer="false" :closable="!!closable" :mask-closable="maskClosable ?? false" unmount-on-close @update:visible="emit('update:visible', $event)" @cancel="close" @before-open="emit('before-open')" @close="emit('close')">
    <template v-if="$slots.title" #title><slot name="title" /></template>
    <slot />
  </a-modal>
</template>

<style scoped>
.source-form-surface{min-width:0;flex:1;overflow:auto;color:var(--color-text-1);padding:0 28px 32px;box-sizing:border-box}
.source-form-heading{position:relative;min-height:64px;display:flex;align-items:center;justify-content:center}
.source-form-heading h2{font-size:17px;margin:0}
</style>
