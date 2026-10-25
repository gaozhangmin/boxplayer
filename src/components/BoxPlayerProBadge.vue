<script setup lang="ts">
import { computed } from 'vue'
import brandMark from '../assets/membership/boxplayer-mark.svg'

export type BoxPlayerProTier = 'standard' | 'all' | 'android' | 'apple'
withDefaults(defineProps<{ tier: BoxPlayerProTier; compact?: boolean }>(), { tier: 'standard', compact: false })
const label = computed(() => 'BoxPlayer PRO')
</script>

<template>
  <span v-if="tier !== 'standard'" class="bp-pro-badge" :class="{ compact }" role="status" :aria-label="label" :title="label">
    <span class="bp-brand-mark" :style="{ maskImage: `url(${brandMark})`, WebkitMaskImage: `url(${brandMark})` }" aria-hidden="true" />
    <strong aria-hidden="true">PRO</strong>
  </span>
</template>

<style scoped>
.bp-pro-badge{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0;color:inherit;white-space:nowrap;flex-shrink:0;vertical-align:middle;box-sizing:border-box}
.bp-brand-mark{width:16px;height:19px;display:block;background:currentColor;mask-size:contain;mask-repeat:no-repeat;mask-position:center;-webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center}
.bp-pro-badge strong{font:italic 900 19px/1 Arial,Helvetica,sans-serif;letter-spacing:-.6px}
.bp-pro-badge.compact{height:26px;gap:4px}.compact .bp-brand-mark{width:14px;height:17px}.compact strong{font-size:16px}
</style>
