<script setup lang="ts">
import MediaLoadingIndicator from './MediaLoadingIndicator.vue'
import { watchingUpdatePending, cancelWatchingUpdate } from '../utils/continueWatchingAction'
import { t } from '../i18n'
</script>

<template>
  <a-modal :visible="watchingUpdatePending" :width="280" :z-index="3100" :footer="false" :closable="false" :mask-closable="false" mask-animation-name="" modal-animation-name="" :mask-style="{ backgroundColor: 'rgba(0, 0, 0, 0.32)', backdropFilter: 'none' }" modal-class="watching-update-modal" @cancel="cancelWatchingUpdate">
    <div class="watching-update-content" role="status" aria-live="polite" aria-busy="true">
      <strong>{{ t('fileContext.updatingWatching') }}</strong>
      <MediaLoadingIndicator :size="28" />
      <button type="button" @click="cancelWatchingUpdate">{{ t('common.cancel') }}</button>
    </div>
  </a-modal>
</template>

<style scoped>
.watching-update-content { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px; font-size: 13px }
button { border: 0; border-radius: 6px; background: var(--color-fill-3); color: var(--color-text-1); padding: 4px 12px; cursor: pointer }
</style>
<style>
.watching-update-modal.arco-modal { width: min(280px, calc(100vw - 32px)) !important; border-radius: 6px !important }
body[arco-theme='dark'] .arco-modal.watching-update-modal { background: var(--app-overlay-bg) !important; backdrop-filter: none !important}
</style>
