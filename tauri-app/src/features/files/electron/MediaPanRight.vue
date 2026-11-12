<script setup lang="ts">
import {computed,ref,onMounted,onUnmounted,watch} from 'vue'
import {Play,RefreshCw,Shuffle,Star,SquareCheck,Share2,Download,Pencil,Eye,Bookmark,ListPlus,Library,Trash2} from 'lucide-vue-next'
import LocalMediaFileCard from './LocalMediaFileCard.vue'
import FileBrowserCard from './FileBrowserCard.vue'
import {t} from './i18n'
import {useFileSelection} from '../adapters/fileSelection'
import type {VideoItem} from '@/features/library/catalog'
export interface BrowserFile{file_id:string;drive_id:string;name:string;isDir:boolean;category:string;thumbnail?:string;media_duration?:number;media_height?:number;size:number;sizeStr?:string;timeStr?:string;path?:string}
const props=withDefaults(defineProps<{files:BrowserFile[];media:Map<string,VideoItem>;posters:Map<string,string>;selected:string[];favoriteIds:string[];unifiedFiles?:boolean;favoriteBrowse?:boolean;browseMode?:'grid'|'list';browseSelection?:boolean;descending?:boolean}>(),{unifiedFiles:true})
const emit=defineEmits<{enterFolder:[file:BrowserFile];fileAction:[action:string,file:BrowserFile];openMedia:[item:VideoItem];openFile:[file:BrowserFile];select:[ids:string[]]}>()
const browseMode=computed(()=>props.browseMode)
const browserItems=computed(()=>[...props.files].filter(file=>!props.favoriteBrowse||file.isDir||file.category==='video'))
const browserMedia=computed(()=>props.media),browserPosters=computed(()=>props.posters),browserSeasonLabels=computed(()=>new Map<string,string>())
const browserMetadata=computed(()=>new Map([...props.media].map(([id,item])=>[id,{title:item.name,rating:item.rating,year:item.year,certification:item.certification,overview:item.overview}])))
const selectedFiles=computed({get:()=>props.selected,set:ids=>emit('select',ids)})
const fileSelection=useFileSelection(browserItems,selectedFiles)
const mediaPanFileStore={get ListSelected(){return new Set(props.selected)},get ListFocusKey(){return fileSelection.focus.value},set ListFocusKey(value:string){fileSelection.focus.value=value},mMouseSelect:fileSelection.mouse,GetSelectedFirst(){return props.files.find(file=>props.selected.includes(file.file_id))}}
const browserTree={user_id:''},library={get folders(){return props.files.filter(file=>props.favoriteIds.includes(file.file_id)).map(file=>({userId:'',driveId:file.drive_id,fileId:file.file_id,isFavorite:true,isDriveRootFavorite:true}))}}
const localFileWatched=(file:BrowserFile)=>!!props.media.get(file.file_id)?.watched
const toggleLocalFileWatched=(file:BrowserFile)=>emit('fileAction','watched',file)
const isFileSourceRoot=(file:BrowserFile)=>['','/','0','root','quark_root','baidu_root'].includes(file.file_id)
const fileInContinueWatching=computed(()=>{const item=menuFile.value&&props.media.get(menuFile.value.file_id);return !!item&&!item.continueHidden&&((item.progress||0)>0||item.continueAdded)})
const browserSubtitle=(file:BrowserFile)=>props.media.get(file.file_id)?.overview||[file.timeStr,file.sizeStr].filter(Boolean).join(' - ')
const menuOpenFile=(file:BrowserFile)=>emit('openFile',file)
const menuFile = ref<BrowserFile>()
const closeFileMenu = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as HTMLElement)?.closest('.file-browser-context-menu')) menuFile.value = undefined }
onMounted(() => { document.addEventListener('keydown', closeFileMenu); document.addEventListener('click', closeFileMenu) })
onUnmounted(() => { document.removeEventListener('keydown', closeFileMenu); document.removeEventListener('click', closeFileMenu) })
const menuPosition = ref({ x: 0, y: 0 })
const openFileMenu = (event: MouseEvent, file: BrowserFile) => { menuFile.value = file; menuPosition.value = { x: event.clientX, y: event.clientY } }
const fileMenuActions = computed<Array<{ id: string; icon: typeof Play; label: Parameters<typeof t>[0]; disabled?: boolean }>>(() => !menuFile.value ? [] : menuFile.value.isDir ? [
  { id: 'play', icon: Play, label: 'unified.play' }, { id: 'loop', icon: RefreshCw, label: 'unified.loopPlay' }, { id: 'shuffle', icon: Shuffle, label: 'unified.shufflePlay' }, { id: 'favorite', icon: Star, label: library.folders.some(folder => folder.userId === browserTree.user_id && folder.driveId === menuFile.value?.drive_id && folder.fileId === menuFile.value?.file_id && folder.isFavorite !== false && (!isFileSourceRoot(menuFile.value!) || folder.isDriveRootFavorite)) ? 'unified.removeFavoriteFolder' : 'unified.addToFavorites' }
] : [
  { id: 'play', icon: Play, label: 'unified.play' }, { id: 'loop', icon: RefreshCw, label: 'unified.loopPlay' }, { id: 'select', icon: SquareCheck, label: 'unified.selectItems' }, { id: 'rating', icon: Star, label: 'media.rating' },
  { id: 'share', icon: Share2, label: 'fileContext.share' }, { id: 'download', icon: Download, label: 'fileContext.download', disabled: menuFile.value.drive_id === 'local' },
  { id: 'metadata', icon: Pencil, label: 'fileContext.editMetadata' }, { id: 'watched', icon: Eye, label: localFileWatched(menuFile.value!) ? 'mediaServer.markUnwatched' : 'mediaServer.markWatched' },
  { id: 'continue', icon: Bookmark, label: fileInContinueWatching.value ? 'fileContext.removeContinue' : 'fileContext.continue' }, { id: 'playlist', icon: ListPlus, label: 'media.playlist' }, { id: 'series', icon: Library, label: 'fileContext.series' }, { id: 'delete', icon: Trash2, label: 'common.delete', disabled: true }
])
const runFileAction = (action: string) => { const file = menuFile.value; menuFile.value = undefined; if (!file) return; if (action === 'select') handleSelect(file.file_id, {} as MouseEvent, true); else if (action === 'watched') toggleLocalFileWatched(file); else emit('fileAction', action, file) }
let capturedPointer: MouseEvent | undefined
const capturePointer = (event: MouseEvent) => { capturedPointer = event; queueMicrotask(()=>{capturedPointer=undefined}) }
const handleSelect = (file_id: string, event: MouseEvent, isCtrl: boolean = false) => {
  const pointer = capturedPointer || event
  mediaPanFileStore.mMouseSelect(file_id, pointer.ctrlKey || pointer.metaKey || isCtrl, pointer.shiftKey)
  if (!mediaPanFileStore.ListSelected.has(file_id)) mediaPanFileStore.ListFocusKey = ''
}

const handleOpenFile = (event: Event, file: BrowserFile | undefined) => {
  if (!file) file = mediaPanFileStore.GetSelectedFirst()
  if (!file) return

  const media = browserMedia.value.get(file.file_id)
  if (props.unifiedFiles && !props.browseSelection && media && (props.favoriteBrowse || file.drive_id === 'local')) {
    emit('openMedia', media)
    return
  }

  // 如果是文件夹，应该进入子目录而不是打开文件
  if (file.isDir) {
    // 发出事件让 MediaLibrary.vue 处理文件夹导航
    emit('enterFolder', file)
    return
  }

  // 只有文件才执行打开操作
  if (!mediaPanFileStore.ListSelected.has(file.file_id)) {
    mediaPanFileStore.mMouseSelect(file.file_id, false, false)
  }

  // 简化的文件打开逻辑
  menuOpenFile(file)
}


</script>
<template><div class="media-pan-right" @click.capture="capturePointer">    <div v-if="props.unifiedFiles" class="folder-browser" :class="{ 'folder-browser-list': browseMode === 'list' }">
      <template v-for="item in browserItems" :key="item.file_id">
        <LocalMediaFileCard portrait-list v-if="item.drive_id === 'local'" :season-label="browserSeasonLabels.get(item.file_id)" :name="browserMedia.get(item.file_id)?.name || item.name" :metadata="browserMetadata.get(item.file_id)" :path="item.file_id" :thumbnail="browserPosters.get(item.file_id) || item.thumbnail" :duration="item.media_duration" :height="item.media_height" :directory="item.isDir && !browserMedia.has(item.file_id)" :mode="browseMode" :selection="props.browseSelection" :selected="mediaPanFileStore.ListSelected.has(item.file_id)" :watched="localFileWatched(item)" @open="props.browseSelection ? handleSelect(item.file_id, {} as MouseEvent, true) : handleOpenFile({} as Event, item)" @watched="toggleLocalFileWatched(item)" @context="openFileMenu($event, item)" />
      <FileBrowserCard v-else :downloadable="!item.isDir && item.category === 'video'" :download-label="t('fileContext.download')" @download="emit('fileAction', 'download', item)" :key="item.file_id" :season-label="browserSeasonLabels.get(item.file_id)" :name="browserMedia.get(item.file_id)?.name || item.name" :directory="item.isDir && !browserMedia.has(item.file_id)" :thumbnail="browserPosters.get(item.file_id) || item.thumbnail" :size-text="item.isDir ? '' : browserSubtitle(item)" :mode="browseMode" :selection="props.browseSelection" :selected="mediaPanFileStore.ListSelected.has(item.file_id)" @context="openFileMenu($event, item)" @open="props.browseSelection ? handleSelect(item.file_id, $event, true) : handleOpenFile($event, item)" />
      </template>
    </div>
    <div v-if="menuFile" class="file-browser-context-menu" :style="{ left: menuPosition.x + 'px', top: menuPosition.y + 'px' }" role="menu"><button v-for="action in fileMenuActions" :key="action.id" type="button" role="menuitem" :disabled="action.disabled" @click="runFileAction(action.id)"><component :is="action.icon" :size="16" /><span>{{ t(action.label) }}</span></button></div></div></template>
<style scoped>
.folder-browser{display:grid;grid-template-columns:repeat(auto-fill,174px);gap:24px 20px;padding:20px;align-content:start}
.folder-browser-list{display:flex;flex-direction:column;gap:0;padding:0 16px}
.file-browser-context-menu{position:fixed;z-index:2100;padding:5px;min-width:174px;background: var(--app-overlay-bg);border:1px solid var(--color-border-2);border-radius:12px;box-shadow:0 8px 24px #0004}.file-browser-context-menu button{display:flex;align-items:center;gap:7px;width:100%;border:0;border-radius:5px;background:transparent;padding:5px 9px;text-align:left;color:var(--color-text-1);font-size:13px;cursor:pointer}.file-browser-context-menu button svg{color:#ff8b25}.file-browser-context-menu button:hover:not(:disabled){background:var(--color-fill-2)}.file-browser-context-menu button:disabled{opacity:.4;cursor:not-allowed}body[arco-theme=dark] .file-browser-context-menu{background: var(--app-overlay-bg)}
</style>
