<script setup lang="ts">
import { Ban } from 'lucide-vue-next'
import { t } from '../i18n'
</script>

<template>
  <div class="media-empty-folder" role="status">
    <Ban class="empty-folder-icon" :size="96" :stroke-width="1.5" aria-hidden="true" />
    <h2>{{ t('pan.emptyFolder') }}</h2>
    <p>{{ t('unified.emptyFolderDescription') }}</p>
  </div>
</template>

<style scoped>
.media-empty-folder { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 260px; box-sizing: border-box; padding: 24px; text-align: center; background: transparent; }
.empty-folder-icon { flex-shrink: 0; color: #888; margin-bottom: 30px; }
.media-empty-folder h2 { margin: 0 0 10px; font-size: 32px; font-weight: 600; line-height: 1.3; color: var(--color-text-1); }
.media-empty-folder p { margin: 0; font-size: 18px; line-height: 1.5; color: var(--color-text-3); }
</style>
