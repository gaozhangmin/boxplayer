<script setup lang="ts">
const labels:Record<string,string>={'source.emptyHomeTitle':'主屏幕为空','source.emptyFilesTitle':'文件屏幕为空','source.emptyHomeDescription':'现在让我们找一些视频添加到您的主屏幕','source.emptyFilesDescription':'现在让我们找一些视频添加到您的文件','source.emptyAdd':'新增文件来源'}
const t=(key:string)=>labels[key]||key
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
.source-empty-mark{width:144px;height:144px;flex-shrink:0;margin-bottom:24px;background:linear-gradient(135deg,var(--primary),#50c75c);mask:url('./source-empty-mark.png') center/contain no-repeat}
.source-empty-state h2{margin:0 0 12px;font-size:22px;font-weight:600;color:var(--foreground)}
.source-empty-state p{margin:0 0 28px;font-size:16px;font-weight:500;line-height:1.5;color:var(--muted-text);max-width:560px}
.source-empty-state button{border:0;border-radius:9px;background:var(--primary);color:#fff;font:inherit;font-size:16px;font-weight:600;min-height:40px;padding:8px 20px;cursor:pointer}
.source-empty-state button:focus-visible{outline:3px solid var(--foreground);outline-offset:4px}
</style>
