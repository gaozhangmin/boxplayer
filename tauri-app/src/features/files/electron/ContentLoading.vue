<script setup lang="ts">
import MediaLoadingIndicator from './MediaLoadingIndicator.vue'

withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 36 })
</script>

<template>
  <div class="content-loading">
    <MediaLoadingIndicator :size="size" :label="label" />
  </div>
</template>

<style scoped>
.content-loading {
  display: grid;
  place-items: center;
  min-height: 96px;
}
</style>
