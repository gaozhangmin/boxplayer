<script setup lang="ts">
import { ref, watch } from 'vue'
import placeholder from '../assets/media/trakt-avatar-placeholder.png'
const props = withDefaults(defineProps<{ src?: string; size?: number }>(), { size: 32 })
const failed = ref(false)
const loaded = ref(false)
watch(() => props.src, () => { failed.value = false; loaded.value = false })
</script>
<template>
  <span class="trakt-avatar" :style="{ width: size + 'px', height: size + 'px', backgroundImage: `url(${placeholder})` }">
    <img v-if="src && !failed" :key="src" :src="src" :class="{ loaded }" alt="" referrerpolicy="no-referrer" @load="loaded = true" @error="failed = true" />
  </span>
</template>
<style scoped>
.trakt-avatar{display:block;position:relative;border-radius:50%;overflow:hidden;flex-shrink:0;background-color:#eee;background-size:cover;background-position:center}
.trakt-avatar img{display:block;width:100%;height:100%;object-fit:cover;opacity:0}
.trakt-avatar img.loaded{opacity:1}
</style>
