<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import { useSettingsStore } from '@/stores/settings'
import { useI18n } from '@/lib/i18n'
const settings = useSettingsStore()
const { t } = useI18n()
</script>
<template>
  <div class="app-frame">
    <div v-if="settings.preview" class="preview-banner" role="status">{{ t('preview') }}</div>
    <div v-if="settings.error" class="error-banner" role="alert">{{ settings.error }}</div>
    <slot />
  </div>
  <Toaster rich-colors position="bottom-right" :theme="settings.value.theme" />
</template>
