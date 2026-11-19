<script setup lang="ts">
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import { t } from './i18n'

defineProps<{ descending: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="files-name-sort"
    :aria-label="`${t('unified.sortLabel')} · ${t('unified.sort.name')} · ${t(descending ? 'unified.serverSort.descending' : 'unified.serverSort.ascending')}`"
    @click="$emit('toggle')"
  >
    <span>{{ t('unified.sort.name') }}</span>
    <ArrowDown v-if="descending" :size="16" aria-hidden="true" />
    <ArrowUp v-else :size="16" aria-hidden="true" />
  </button>
</template>

<style scoped>
.files-name-sort {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  flex-shrink: 0;
  white-space: nowrap;
  border: 1px solid var(--color-border-2);
  border-radius: 20px;
  background: var(--color-fill-3);
  color: var(--primary);
}
</style>
