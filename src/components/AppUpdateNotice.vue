<script setup lang="ts">
import { computed } from 'vue'
import { appUpdate, initializeAppUpdate } from '../utils/appUpdate'
import { openExternal } from '../utils/electronhelper'
initializeAppUpdate()
const notes = computed(() => String(appUpdate.value.releaseNotes || '').replace(/<[^>]*>/g, ''))
async function close() { await window.AutoUpdateAcknowledge?.(); appUpdate.value = { status: 'idle' } }
</script>
<template>
  <a-modal :visible="appUpdate.status === 'installed'" :width="680" :footer="false" @cancel="close">
    <template #title>✨ 已更新到 v{{ appUpdate.version }}</template>
    <p>自 v{{ appUpdate.previousVersion }} 以来的更新</p>
    <div class="update-notes">{{ notes || '本次更新包含功能改进与问题修复，详细内容请查看完整更新日志。' }}</div>
    <div class="update-notice-actions"><a-button @click="openExternal('https://github.com/gaozhangmin/boxplayer/releases')">查看完整更新内容</a-button><a-button type="primary" @click="close">知道了</a-button></div>
  </a-modal>
</template>
<style scoped>
.update-notes{white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;line-height:1.8;padding:24px 0}.update-notice-actions{display:flex;justify-content:flex-end;gap:12px}.update-notice-actions :deep(.arco-btn-primary){background:#ff8a00}
</style>
