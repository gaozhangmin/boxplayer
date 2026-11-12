<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MediaServerConfig } from '../../types/mediaServer'
import embyIcon from '../../assets/media-server/emby.svg'
import jellyfinIcon from '../../assets/media-server/jellyfin.svg'
import plexIcon from '../../assets/media-server/plex.svg'

const props = withDefaults(defineProps<{ server: Pick<MediaServerConfig, 'type' | 'customIconUrl'>; size?: number }>(), { size: 18 })
const failedCustomIcon = ref(false)
const providerIcon = computed(() => ({ emby: embyIcon, jellyfin: jellyfinIcon, plex: plexIcon })[props.server.type])
const icon = computed(() => !failedCustomIcon.value && props.server.customIconUrl || providerIcon.value)
watch(() => props.server.customIconUrl, () => { failedCustomIcon.value = false })
</script>

<template>
  <img class="media-server-provider-icon" :src="icon" :alt="server.type" :style="{ width: size + 'px', height: size + 'px' }" draggable="false" @error="failedCustomIcon = true" />
</template>

<style scoped>
.media-server-provider-icon { display: inline-block; flex-shrink: 0; object-fit: contain }
</style>
