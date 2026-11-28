<script setup lang="ts">
import { computed } from 'vue'
import getFileIcon from '../drive/electron/aliapi/fileicon'
import IconFont from './IconFont.vue'

const props = defineProps<{ filename: string; icon?: string; category?: string; fileSize?: number; size: number }>()
const iconName = computed(() => {
  const extension = /\.([^.\/\\]+)$/.exec(props.filename)?.[1]
  const detected = getFileIcon(undefined, extension, extension, undefined, props.fileSize ?? 0)[1]
  if (detected !== 'iconwenjian') return detected
  if (props.icon && props.icon !== 'iconwenjian' && props.icon !== 'iconfile-folder') return props.icon
  return getFileIcon(props.category, extension, extension, undefined, props.fileSize ?? 0)[1]
})
</script>

<template>
  <IconFont :name="iconName" :size="size" aria-hidden="true" />
</template>
