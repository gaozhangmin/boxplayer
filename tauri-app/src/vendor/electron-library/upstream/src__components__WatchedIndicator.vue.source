<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { t } from '../i18n'
defineProps<{ watched: boolean; corner?: boolean; disabled?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>
<template>
  <span v-if="corner && !watched" class="watched-corner" aria-hidden="true" />
  <button v-else-if="!corner" type="button" class="watched-toggle" :class="{ 'is-watched': watched }" :disabled="disabled" :aria-pressed="watched" :aria-label="t(watched ? 'mediaServer.markUnwatched' : 'mediaServer.markWatched')" @click.stop="$emit('toggle')" @keydown.stop><Check :size="14" />{{ t(watched ? 'unified.watched' : 'mediaServer.markWatched') }}</button>
</template>
<style scoped>
.watched-corner{position:absolute;right:0;top:0;width:26px;height:26px;background:#ff8800;clip-path:polygon(0 0,100% 0,100% 100%);pointer-events:none;z-index:2}.watched-toggle{display:inline-flex;align-items:center;align-self:flex-start;gap:6px;width:auto;border:0;border-radius:5px;padding:4px 8px;background:transparent;color:var(--color-text-2);font-size:12px;cursor:pointer}.watched-toggle:hover{background:var(--color-fill-3)}.watched-toggle.is-watched{background:#ff8800;color:#fff}.watched-toggle.is-watched:hover{background:#e87900}.watched-toggle:disabled{opacity:.5;cursor:wait}
</style>
