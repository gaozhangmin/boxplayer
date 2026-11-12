<script setup lang="ts">
import {computed} from 'vue'
import {Grid2X2,List,ArrowDown,ArrowUp,Ellipsis,ChevronDown,SquareCheck,ListFilter,Play,RefreshCw,Shuffle,Star,Pencil} from 'lucide-vue-next'
import {t} from './i18n'
const props=defineProps<{mode:'grid'|'list';descending:boolean;selection:boolean}>()
const emit=defineEmits<{mode:[value:'grid'|'list'];direction:[];selection:[];play:[kind:'play'|'loop'|'shuffle'];remove:[];rename:[]}>()
const collectionMode=computed({get:()=>props.mode,set:value=>emit('mode',value)})
const folderDescending=computed({get:()=>props.descending,set:()=>emit('direction')})
const folderSelection=computed({get:()=>props.selection,set:()=>emit('selection')})
const isFolderPage=true,videoView={playBrowse:(kind:'play'|'loop'|'shuffle')=>emit('play',kind)}
const removeFolderFavorite=()=>emit('remove'),renameFolder=()=>emit('rename')
</script>
<template><div class="electron-files-toolbar"><button class="round-button" :aria-label="collectionMode === 'grid' ? t('mediaServer.listView') : t('mediaServer.gridView')" @click="collectionMode = collectionMode === 'grid' ? 'list' : 'grid'"><Grid2X2 v-if="collectionMode === 'grid'" :size="18"/><List v-else :size="18"/></button><button class="round-button" :aria-label="t('unified.sortLabel')" @click="folderDescending = !folderDescending"><ArrowDown v-if="folderDescending" :size="16"/><ArrowUp v-else :size="16"/></button><a-dropdown trigger="click" position="br"><button class="round-button more-button" :aria-label="t('media.manager')"><Ellipsis :size="18"/><ChevronDown :size="10"/></button><template #content>            <template v-if="isFolderPage">
              <a-doption data-folder-option class="unified-action-option server-root-option" @click="folderSelection = !folderSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="folderDescending = !folderDescending"><template #icon><ListFilter :size="14" /></template>{{ t('unified.folderSort') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('play')"><template #icon><Play :size="14" /></template>{{ t('unified.play') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('loop')"><template #icon><RefreshCw :size="14" /></template>{{ t('unified.loopPlay') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="videoView?.playBrowse('shuffle')"><template #icon><Shuffle :size="14" /></template>{{ t('unified.shufflePlay') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="removeFolderFavorite"><template #icon><Star :size="14" /></template>{{ t('unified.removeFavoriteFolder') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="renameFolder"><template #icon><Pencil :size="14" /></template>{{ t('unified.renameCollection') }}</a-doption>
            </template>
</template></a-dropdown></div></template>
<style scoped>.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}
.more-button{display:flex;align-items:center;justify-content:center;gap:2px;width:48px;border-radius:22px}.electron-files-toolbar{display:flex;align-items:center;gap:12px}</style>