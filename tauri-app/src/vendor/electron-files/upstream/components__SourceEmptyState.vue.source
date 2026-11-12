<script setup lang="ts">
import { t } from '../i18n'
defineProps<{ home?: boolean }>()
defineEmits<{ add: [] }>()
</script>

<template>
  <div class="source-empty-state">
    <div class="source-empty-mark" aria-hidden="true" />
    <h2>{{ t(home ? 'source.emptyHomeTitle' : 'source.emptyFilesTitle') }}</h2>
    <p>{{ t(home ? 'source.emptyHomeDescription' : 'source.emptyFilesDescription') }}</p>
    <button type="button" @click="$emit('add')">{{ t('source.emptyAdd') }}</button>
  </div>
</template>

<style scoped>
.source-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;width:100%;min-height:100%;padding:24px;text-align:center;grid-column:1/-1}
.source-empty-mark{width:144px;height:144px;flex-shrink:0;margin-bottom:24px;background:linear-gradient(135deg,#ff5c00,#ff9800);mask:url('../assets/media/source-empty-mark.png') center/contain no-repeat}
.source-empty-state h2{margin:0 0 12px;font-size:22px;font-weight:600;color:var(--color-text-1)}
.source-empty-state p{margin:0 0 28px;font-size:16px;font-weight:500;line-height:1.5;color:var(--color-text-3);max-width:560px}
.source-empty-state button{border:0;border-radius:9px;background:#ff8700;color:#fff;font:inherit;font-size:16px;font-weight:600;min-height:40px;padding:8px 20px;cursor:pointer}
.source-empty-state button:focus-visible{outline:3px solid var(--color-text-1);outline-offset:4px}
</style>
