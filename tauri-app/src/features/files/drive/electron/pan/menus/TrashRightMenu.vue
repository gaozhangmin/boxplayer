<script setup lang="ts">
import IconFont from '@/features/files/electron/IconFont.vue'
import { menuTrashSelectFile, topRecoverSelectedFile, topRestoreSelectedFile } from '@/features/files/drive/ports'
import { computed } from 'vue'
import { usePanTreeStore } from '@/features/files/drive/ports'
import { supportsTrashPermanentDelete } from '@/features/files/drive/ports'

const props = defineProps({
  dirtype: {
    type: String,
    required: true
  }
})

const panTreeStore = usePanTreeStore()
const showTrashPermanentDelete = computed(() => props.dirtype === 'trash' && supportsTrashPermanentDelete(panTreeStore.user_id, panTreeStore.drive_id))

</script>

<template>
  <a-dropdown id="rightpantrashmenu" class="rightmenu" :popup-visible="true"
              style="z-index: -1; left: -200px; opacity: 0">
    <template #content>
      <a-doption v-show="dirtype == 'recover'" @click="topRecoverSelectedFile">
        <template #icon><IconFont name="iconrecover" /></template>
        <template #default>恢复选中</template>
      </a-doption>
      <a-doption v-show="dirtype == 'trash'" @click="topRestoreSelectedFile">
        <template #icon><IconFont name="iconrecover" /></template>
        <template #default>还原选中</template>
      </a-doption>

      <a-doption v-if="showTrashPermanentDelete" @click="() => menuTrashSelectFile(false, true)">
        <template #icon><IconFont name="iconrest" /></template>
        <template #default>彻底删除</template>
      </a-doption>
    </template>
  </a-dropdown>
</template>
<style></style>
