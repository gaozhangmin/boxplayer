<script setup lang="ts">
import {computed,ref,onMounted,onUnmounted,watch,nextTick} from 'vue'
import {Folder,Network,Play,RefreshCw,Shuffle,Star,Pencil,Eye,EyeOff,Move,Image,Trash2,List,SquareCheck,ListPlus,GalleryVerticalEnd,Grid2X2,ArrowDown,ArrowUp,ChevronDown,Ellipsis,Plus,ListFilter,LockKeyhole} from 'lucide-vue-next'
import {Dropdown as ADropdown,Doption as ADoption} from '@arco-design/web-vue'
import LibraryObjectActions from './LibraryObjectActions.vue'
import MediaServerIcon from './MediaServerIcon.vue'
import NativeFilesDialogs from '../adapters/NativeFilesDialogs.vue'
import AddFileSourceModal from './AddFileSourceModal.vue'
import SourceEmptyState from './SourceEmptyState.vue'
import {message} from '../adapters/sourceServices'
import {t} from './i18n'
import {reorderFileSourceIds,applyFileSourceOrder} from './fileSourceOrder'
import {useFilesPorts} from '../adapters/filesPorts'
const props=defineProps<{toolbarTarget?:string;menusOnly?:boolean}>()
const toolbarReady=ref(!props.toolbarTarget)
onMounted(()=>{toolbarReady.value=true})
const emit=defineEmits<{reorderFavorites:[];selectSource:[id:string];openFolder:[folder:{sourceId:string;path:string;local:boolean;favoriteId:string}];serverRoute:[accountId:string,route:import('@/features/servers/workspace').BrowseRoute]}>()
const ports=useFilesPorts(emit,{loadCatalog:!props.menusOnly})
const {sourceOverrides,collectionMode,connectedFileRoots,rootIsFavorite,favoriteCover,section,app}=ports
const {folderFavoriteCards,libraryBookmarks,media,registry,rootFolderMatchesAny,isConnectedRootFolder,rootFavoriteDriveName,openConnectedFileRoot,showFolder,showServer,categoryBookmarkTitle,showCatalog,getDriveProviderById,getDriveProviderIcon}=ports.originalModel
const fileSourceDescending=ports.descending
const fileSourceCards = computed(() => [
 ...folderFavoriteCards.value.map(card => ({ ...card, server: null, providerIcon: '', icon: Folder })),
 ...libraryBookmarks.favorites.filter(route => route.startsWith('home-entry/')).map(route => ({ key: 'server-category:' + route, title: libraryBookmarks.titles[route] || categoryBookmarkTitle(route), server: null, providerIcon: '', icon: Folder, action: () => showCatalog(route) })),...connectedFileRoots.value.filter(root => !media.folders.some(folder => folder.isFavorite !== false && rootFolderMatchesAny(root, folder))).map(root => ({ key: `root:${root.value}`, title: sourceOverrides.value[`root:${root.value}`]?.name || root.label, server: null, providerIcon: root.providerIcon || '', icon: root.driveServerId === 'webdav' ? Network : Folder, action: () => { void openConnectedFileRoot(root) } })), ...registry.servers.map(server => ({ key: 'server:' + server.id, title: server.name, server, providerIcon: '', icon: Star, action: () => showServer(server.id) })), ...media.folders.filter(folder => (!isConnectedRootFolder(folder) || folder.isDriveRootFavorite) && folder.isFavorite !== false).map(folder => ({ key: 'folder:' + folder.id, title: folder.name, subtitle: folder.isDriveRootFavorite ? rootFavoriteDriveName(folder) : '', server: null, providerIcon: folder.isDriveRootFavorite || ['/', '0', 'root', 'quark_root', 'baidu_root'].includes(folder.fileId) ? getDriveProviderIcon(getDriveProviderById(folder.driveId || folder.driveServerId)) : '', icon: Star, action: () => { void showFolder(folder) } }))].sort((a,b) => ((sourceOverrides.value[a.key]?.order ?? 9999) - (sourceOverrides.value[b.key]?.order ?? 9999)) || a.title.localeCompare(b.title) * (fileSourceDescending.value ? -1 : 1)))
function sourceServer(key: string) { return registry.servers.find(server => key === 'source:server:' + server.id) }

const showAddFileSource=ref(false),sourceDialog=ref(''),sourceMenu=ref<{key:string;x:number;y:number}|null>(null),favoriteSourceMenu=ref(false)
async function sourceAction(id:string){const key=sourceMenu.value?.key;sourceMenu.value=null;if(!key)return;if(id==='reorder'){if(props.menusOnly)emit('reorderFavorites');else startSourceReordering();return}await ports.action(key,id)}
async function deleteSelectedFileSource(){if(await ports.removeSelected(selectedFileSources.value)){selectedFileSources.value=[];fileSourceSelection.value=false}}

const categoryMenu = ref<{ route: string; x: number; y: number; favoriteCard?: boolean }>()
function openCategoryMenu(event: MouseEvent, route: string, favoriteCard = false) { if (route.startsWith('source:')) { openSourceMenu(event, route.slice(7)); return }; event.preventDefault(); categoryMenu.value = { route, favoriteCard, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)) } }
const serverFolderMenu=ref<{item:{id:string;serverId:string;isFavorite?:boolean};x:number;y:number}>()
function openFolderFavoriteMenu(event: MouseEvent, key: string) {
 const card = folderFavoriteCards.value.find(card => card.key === key)
 if (!card) return
 serverFolderMenu.value = { item: card.item, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 450)) }
}
function openFileCardMenu(event: MouseEvent, key: string) {
 if (key.startsWith('server-folder:')) openFolderFavoriteMenu(event, key)
 else if (key.startsWith('server-category:')) openCategoryMenu(event, key.slice('server-category:'.length), true)
 else void openSourceMenu(event, key)
}

function serverFolderFavoriteKey(item:{id:string;serverId:string}){return ports.originalModel.folderFavoriteCards.value.find(card=>card.item.id===item.id&&card.item.serverId===item.serverId)?.key||''}
function openFavoriteCoverDialog(key:string){void ports.action(key,'cover')}
function serverPosterAction(item:{id:string;serverId:string},action:string){const key=serverFolderFavoriteKey(item);void ports.action(key,action==='loop'?'loopPlay':action==='shuffle'?'shufflePlay':action==='favorite'?'toggleServerFavorite':action)}
function categoryAction(event:Event){const detail=(event as CustomEvent).detail;if(!detail?.route?.startsWith('home-entry/'))return;const actions:Record<string,string>={loop:'loopPlay',shuffle:'shufflePlay',removeFavorite:'removeFavoriteFolder',renameFavorite:'renameCollection',hideFavorite:'hideFavoriteOnHome',showFavorite:'showFavoriteOnHome',favoriteCover:'cover'};void ports.action('server-category:'+detail.route,actions[detail.action]||detail.action)}
onMounted(()=>window.addEventListener('boxplayer:library-object-action',categoryAction));onUnmounted(()=>window.removeEventListener('boxplayer:library-object-action',categoryAction))
const startFavoriteReordering=()=>startSourceReordering()
const fileSourceSelection = ref(false)
const fileSourceReordering = ref(false)
const sourceDragKey = ref('')
const sourceDropKey = ref('')
const sourceDragOffset = ref({ x: 0, y: 0 })
let sourceRowBounds: { key: string; top: number; height: number }[] = []
let sourceDragSuppressClick = false
let sourceDragClickTimer: ReturnType<typeof setTimeout> | undefined
let sourcePointer: { key: string; x: number; y: number; id: number } | undefined
function startSourcePointer(event: PointerEvent, key: string) {
  if (event.button !== 0) return
  event.preventDefault()
  sourcePointer = { key, x: event.clientX, y: event.clientY, id: event.pointerId }
  sourceRowBounds = Array.from((event.target as HTMLElement).closest('.file-source-browser')?.querySelectorAll<HTMLElement>('.file-source-card') || []).map(row => {
    const bounds = row.getBoundingClientRect()
    return { key: row.dataset.sourceKey || '', top: bounds.top, height: bounds.height }
  })
  sourceDragOffset.value = { x: 0, y: 0 }
  document.addEventListener('pointermove', moveSourcePointer)
  document.addEventListener('pointerup', finishSourcePointer)
  document.addEventListener('pointercancel', cancelSourcePointer)
}
function moveSourcePointer(event: PointerEvent) {
  if (!sourcePointer || event.pointerId !== sourcePointer.id) return
  if (!sourceDragKey.value && Math.hypot(event.clientX - sourcePointer.x, event.clientY - sourcePointer.y) < 5) return
  clearTimeout(sourceDragClickTimer)
  sourceDragSuppressClick = true
  sourceDragKey.value = sourcePointer.key
  sourceDragOffset.value = { x: collectionMode.value === 'list' ? 0 : event.clientX - sourcePointer.x, y: event.clientY - sourcePointer.y }
  if (collectionMode.value === 'list') {
    const dragged = sourceRowBounds.find(row => row.key === sourcePointer?.key)
    const center = (dragged?.top || 0) + (dragged?.height || 0) / 2 + sourceDragOffset.value.y
    sourceDropKey.value = sourceRowBounds.reduce((nearest, row) => Math.abs(row.top + row.height / 2 - center) < Math.abs(nearest.top + nearest.height / 2 - center) ? row : nearest, sourceRowBounds[0])?.key || ''
  } else sourceDropKey.value = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.file-source-card')?.dataset.sourceKey || ''
  event.preventDefault()
}
function finishSourcePointer(event: PointerEvent) {
  if (!sourcePointer || event.pointerId !== sourcePointer.id) return
  if (sourceDragKey.value && sourceDropKey.value) commitSourceOrder(reorderFileSourceIds(fileSourceCards.value.map(card => card.key), sourceDragKey.value, sourceDropKey.value))
  cancelSourcePointer()
}
function cancelSourcePointer() {
  sourcePointer = undefined
  document.removeEventListener('pointermove', moveSourcePointer)
  document.removeEventListener('pointerup', finishSourcePointer)
  document.removeEventListener('pointercancel', cancelSourcePointer)
  if (sourceDragKey.value) endSourceDrag()
  sourceRowBounds = []
}
function sourceDragStyle(key: string) {
  if (!sourceDragKey.value) return undefined
  if (key === sourceDragKey.value) return { transform: `translate3d(${sourceDragOffset.value.x}px, ${sourceDragOffset.value.y}px, 0)` }
  if (collectionMode.value !== 'list') return undefined
  const from = sourceRowBounds.findIndex(row => row.key === sourceDragKey.value)
  const to = sourceRowBounds.findIndex(row => row.key === sourceDropKey.value)
  const index = sourceRowBounds.findIndex(row => row.key === key)
  if (from < 0 || to < 0) return undefined
  const distance = sourceRowBounds[from].height
  const offset = from < to && index > from && index <= to ? -distance : from > to && index >= to && index < from ? distance : 0
  return { transform: `translateY(${offset}px)` }
}
function startSourceReordering() { fileSourceReordering.value = true; fileSourceSelection.value = false; selectedFileSources.value = []; sourceDialog.value = '' }
function finishSourceReordering() { cancelSourcePointer(); fileSourceReordering.value = false; sourceDragKey.value = ''; sourceDropKey.value = '' }
function commitSourceOrder(ids: string[]) {
  const next = applyFileSourceOrder(sourceOverrides.value, ids)
  try { ports.commitOrder(ids); sourceOverrides.value = next }
  catch (error) { message.error(String(error)) }
}
function endSourceDrag() {
  sourceDragKey.value = ''; sourceDropKey.value = ''
  clearTimeout(sourceDragClickTimer)
  sourceDragClickTimer = setTimeout(() => { sourceDragSuppressClick = false }, 150)
}
function sourceReorderKeydown(event: KeyboardEvent, key: string) {
  const previous = ['ArrowUp', 'ArrowLeft'].includes(event.key)
  const next = ['ArrowDown', 'ArrowRight'].includes(event.key)
  if (!previous && !next) return
  event.preventDefault(); event.stopPropagation(); moveSource(key, previous ? -1 : 1)
}
function sourceReorderEscape(event: KeyboardEvent) { if (event.key === 'Escape') finishSourceReordering() }
onMounted(() => document.addEventListener('keydown', sourceReorderEscape))
onUnmounted(() => { cancelSourcePointer(); clearTimeout(sourceDragClickTimer); document.removeEventListener('keydown', sourceReorderEscape) })
watch([() => app.mediaLibrarySection, collectionMode], finishSourceReordering)
const selectedFileSources = ref<string[]>([])
const allFileSourcesSelected = computed(() => fileSourceCards.value.length > 0 && fileSourceCards.value.every(card => selectedFileSources.value.includes(card.key)))
function toggleFileSourceSelection() { fileSourceSelection.value = !fileSourceSelection.value; selectedFileSources.value = [] }
function toggleAllFileSources() { selectedFileSources.value = allFileSourcesSelected.value ? [] : fileSourceCards.value.map(card => card.key) }
const contextOptions = computed(() => sourceMenu.value?.key.startsWith('root:')
  ? [{ id: connectedFileRoots.value.some(root => `root:${root.value}` === sourceMenu.value?.key && rootIsFavorite(root)) ? 'removeRootFavorite' : 'addToFavorites', icon: Star }, { id: 'reorder', icon: Move }, { id: 'editShare', icon: Pencil }, { id: 'delete', icon: Trash2 }]
  : sourceMenu.value?.key.startsWith('server:')
  ? [{ id: 'reorder', icon: Move }, { id: 'editShare', icon: Pencil }, { id: 'cover', icon: Image }, { id: 'endpoint', icon: RefreshCw }, { id: 'delete', icon: Trash2 }]
  : [{ id: 'play', icon: Play }, { id: 'loopPlay', icon: RefreshCw }, { id: 'shufflePlay', icon: Shuffle }, { id: 'removeFavoriteFolder', icon: Star }, { id: 'renameCollection', icon: Pencil }, { id: sourceOverrides.value[sourceMenu.value?.key || '']?.hiddenOnHome ? 'showFavoriteOnHome' : 'hideFavoriteOnHome', icon: Eye }, { id: 'reorder', icon: Move }, { id: 'cover', icon: Image }])
async function openSourceMenu(event: MouseEvent, key: string, fromFavorite = false) {
  event.preventDefault()
  favoriteSourceMenu.value = fromFavorite
  sourceMenu.value = { key, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 170)), y: event.clientY }
  await nextTick()
  const menu = document.querySelector<HTMLElement>('.source-context-menu')
  if (sourceMenu.value && menu) sourceMenu.value.y = Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))
  document.querySelector<HTMLButtonElement>('.source-context-menu button')?.focus()
}
function moveSource(key: string, offset: number) {
  const cards = [...fileSourceCards.value]
  const index = cards.findIndex(card => card.key === key), target = index + offset
  if (index < 0 || target < 0 || target >= cards.length) return
  ;[cards[index], cards[target]] = [cards[target], cards[index]]
  commitSourceOrder(cards.map(card => card.key))
}
const failedProviderIcons = ref(new Set<string>())
function markProviderIconFailed(key: string) { failedProviderIcons.value = new Set([...failedProviderIcons.value, key]) }
function openFileSource(card: typeof fileSourceCards.value[number]) { if (fileSourceReordering.value || sourceDragKey.value || sourceDragSuppressClick) return; if (!fileSourceSelection.value) { card.action(); return }; selectedFileSources.value = selectedFileSources.value.includes(card.key) ? selectedFileSources.value.filter(key => key !== card.key) : [...selectedFileSources.value, card.key] }

defineExpose({coverForKey:favoriteCover,openMenu:openFileCardMenu,openAdd:()=>{showAddFileSource.value=true}})
</script>
<template><Teleport v-if="toolbarReady&&!menusOnly" :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><div class="electron-files-toolbar"><button class="round-button" :aria-label="collectionMode === 'grid' ? t('mediaServer.listView') : t('mediaServer.gridView')" @click="collectionMode = collectionMode === 'grid' ? 'list' : 'grid'"><Grid2X2 v-if="collectionMode === 'grid'" :size="18"/><List v-else :size="18"/></button><button class="round-button" :aria-label="t('unified.sortLabel')" @click="ports.toggleDirection"><ArrowDown v-if="ports.descending.value" :size="16"/><ArrowUp v-else :size="16"/></button><a-dropdown trigger="click" position="br"><button class="round-button more-button" :aria-label="t('media.manager')"><Ellipsis :size="18"/><ChevronDown :size="10"/></button><template #content>            <template v-if="section === 'files'">
              <a-doption class="unified-action-option server-root-option" @click="startSourceReordering"><template #icon><Move :size="14" /></template>{{ t('unified.sourceReorder') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="toggleFileSourceSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="ports.toggleDirection()"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" disabled><template #icon><Star :size="14" /></template>{{ t('unified.addToFavorites') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" disabled><template #icon><LockKeyhole :size="14" /></template>{{ t('unified.enablePasswordLock') }}</a-doption>
            </template>
</template></a-dropdown><button class="add-source file-source-add" @click="showAddFileSource=true"><Plus :size="16"/>{{t('unified.addSource')}}</button></div></Teleport>      <div v-if="!menusOnly&&section === 'files'" class="file-source-browser" :class="{ 'file-source-list': collectionMode === 'list', 'is-reordering': fileSourceReordering, 'file-sources-empty': !fileSourceCards.length }">
        <div v-if="fileSourceReordering" class="source-reorder-hint" role="status"><span>{{ t('unified.dragSourceHint') }}</span><button @click="finishSourceReordering">{{ t('unified.reorderDone') }}</button></div>
        <SourceEmptyState v-if="!fileSourceCards.length" @add="showAddFileSource = true" />
        <button v-for="card in fileSourceCards" :key="card.key" :data-source-key="card.key" class="file-source-card" :style="sourceDragStyle(card.key)" :class="{ 'source-selected': fileSourceSelection && selectedFileSources.includes(card.key), 'source-dragging': sourceDragKey === card.key, 'source-drop-target': sourceDropKey === card.key && sourceDragKey !== card.key }" :aria-pressed="fileSourceSelection ? selectedFileSources.includes(card.key) : undefined" @pointerdown="collectionMode === 'grid' && fileSourceReordering && startSourcePointer($event, card.key)" @keydown="fileSourceReordering && sourceReorderKeydown($event, card.key)" @click="openFileSource(card)" @contextmenu.prevent="openFileCardMenu($event, card.key)">
<div class="file-source-art"><img v-if="card.providerIcon && !failedProviderIcons.has(card.key)" class="file-source-provider-icon" :src="card.providerIcon" :alt="card.title" draggable="false" @error="markProviderIconFailed(card.key)" /><img v-else-if="!card.server && favoriteCover(card.key)" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="card.server" :server="card.server" :size="collectionMode === 'grid' ? 56 : 28" /><component v-else :is="card.icon" :size="collectionMode === 'grid' ? 56 : 28" /><input v-if="fileSourceSelection" type="checkbox" :checked="selectedFileSources.includes(card.key)" tabindex="-1" :aria-label="card.title" /></div><strong>{{ card.title }}<small v-if="collectionMode === 'list' && 'subtitle' in card && card.subtitle" class="file-source-subtitle">{{ card.subtitle }}</small></strong><span v-if="collectionMode === 'list'" class="file-source-handle" role="button" tabindex="0" :aria-label="t('unified.reorder', { name: card.title })" @click.stop @pointerdown.stop="startSourcePointer($event, card.key)" @keydown="sourceReorderKeydown($event, card.key)"><List :size="22" /></span>
        </button>
      </div>
      <div v-if="section === 'files' && fileSourceSelection" class="file-source-selection-bar">
        <span>{{ t('posterMenu.selectedCount', { count: selectedFileSources.length }) }}</span>
        <button @click="toggleAllFileSources"><SquareCheck :size="17" />{{ t(allFileSourcesSelected ? 'book.unselectAll' : 'scan.selectAll') }}</button>
        <button :disabled="!selectedFileSources.length" @click="startSourceReordering"><Move :size="17" />{{ t('unified.sourceReorder') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><Eye :size="17" />{{ t('mediaServer.markWatched') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><EyeOff :size="17" />{{ t('mediaServer.markUnwatched') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><ListPlus :size="17" />{{ t('media.playlist') }}</button>
        <button disabled :title="t('pan.unsupportedFeature')"><GalleryVerticalEnd :size="17" />{{ t('unified.series') }}</button>
        <button :disabled="!selectedFileSources.length || selectedFileSources.some(key => key.startsWith('root:'))" class="danger" @click="deleteSelectedFileSource"><Trash2 :size="17" />{{ t('common.delete') }}</button>
        <button @click="toggleFileSourceSelection">{{ t('music.done') }}</button>
      </div>
<Teleport to="body">      <div v-if="serverFolderMenu" class="source-context-dismiss" @pointerdown="serverFolderMenu = undefined" @contextmenu.prevent="serverFolderMenu = undefined" @keydown.esc="serverFolderMenu = undefined">
        <div class="source-context-menu" :style="{ left: serverFolderMenu.x + 'px', top: serverFolderMenu.y + 'px' }" @pointerdown.stop>
          <!-- A series card in Favorites: play like a folder, toggle the account's favorite, choose a cover. -->
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'play'); serverFolderMenu = undefined"><Play :size="17" />{{ t('unified.play') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'loop'); serverFolderMenu = undefined"><RefreshCw :size="17" />{{ t('unified.loopPlay') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'shuffle'); serverFolderMenu = undefined"><Shuffle :size="17" />{{ t('unified.shufflePlay') }}</button>
          <button role="menuitem" @click="serverPosterAction(serverFolderMenu.item, 'favorite'); serverFolderMenu = undefined"><Star :size="17" />{{ t(serverFolderMenu.item.isFavorite === false ? 'mediaServer.addFavorite' : 'mediaServer.removeFavorite') }}</button>
          <button role="menuitem" @click="openFavoriteCoverDialog(serverFolderFavoriteKey(serverFolderMenu.item)); serverFolderMenu = undefined"><Image :size="17" />{{ t('unified.cover') }}</button>
        </div>
      </div>
      <div v-if="categoryMenu" class="source-context-dismiss" @pointerdown="categoryMenu = undefined" @contextmenu.prevent="categoryMenu = undefined" @keydown.esc="categoryMenu = undefined"><div class="source-context-menu" role="menu" :style="{ left: categoryMenu.x + 'px', top: categoryMenu.y + 'px' }" @pointerdown.stop>
        <template v-if="categoryMenu.favoriteCard && categoryMenu.route === 'library'">
          <button role="menuitem" @click="startFavoriteReordering"><Move :size="17" />{{ t('unified.sourceReorder') }}</button>
        </template>
        <LibraryObjectActions :route="categoryMenu.route" :hidden-on-home="!!sourceOverrides[categoryMenu.route]?.hiddenOnHome" @action="categoryMenu = undefined" />
      </div></div>
      <div v-if="sourceMenu" class="source-context-dismiss" @pointerdown="sourceMenu = null" @contextmenu.prevent="sourceMenu = null" @keydown.esc="sourceMenu = null">
        <div class="source-context-menu" role="menu" :style="{ left: sourceMenu.x + 'px', top: sourceMenu.y + 'px' }" @pointerdown.stop>
          <button v-for="option in contextOptions" :key="option.id" role="menuitem" @click="sourceAction(option.id)"><component :is="option.icon" :size="17" />{{ t(('unified.' + (option.id === 'reorder' ? 'sourceReorder' : option.id === 'removeRootFavorite' ? 'removeFavoriteFolder' : option.id)) as Parameters<typeof t>[0]) }}</button>
        </div>
      </div>
</Teleport><NativeFilesDialogs :ports="ports"/><AddFileSourceModal v-if="showAddFileSource" :visible="true" :device-name="ports.deviceName" :sources="ports.savedSources.value" @close="showAddFileSource=false" @connected="ports.refresh"/></template>
<style scoped>
.source-reorder-hint{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--color-text-3);font-size:13px}
.source-reorder-hint button{background:transparent;border:0;color:#ff8700;font:inherit;cursor:pointer;padding:8px 12px}
.file-source-handle{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:grab;touch-action:none}
.file-source-handle:active,.is-reordering .file-source-card:active{cursor:grabbing}
.is-reordering:not(.file-source-list) .file-source-card{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%}
.is-reordering:not(.file-source-list) .file-source-card:nth-child(even){animation-delay:-.12s}
.file-source-card.source-dragging{position:relative;z-index:10;opacity:1;animation:none!important;transition:none!important;pointer-events:none;cursor:grabbing;background:var(--color-bg-1);box-shadow:0 12px 32px #0006;border-radius:10px}
.file-source-list .file-source-card{transition:transform .16s ease;user-select:none}
.file-source-card.source-drop-target .file-source-art{outline:2px solid #ff8700;outline-offset:3px}
@keyframes source-card-wiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
.file-source-browser.file-sources-empty{display:flex;align-items:stretch}.file-sources-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,174px);align-content:start;gap:22px;padding:22px 36px}.file-source-card{padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}.file-source-art{position:relative;aspect-ratio:2/3;border-radius:16px;background:var(--color-fill-2);display:grid;place-items:center;color:#ff8b25}.file-source-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.file-source-art input{position:absolute;top:8px;right:8px}.file-source-card strong{display:block;font-size:13px;margin-top:10px}.file-source-list{display:flex;flex-direction:column;padding:0 16px;gap:0}.file-source-list .file-source-card{display:flex;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}.file-source-list .file-source-art{width:86px;height:129px;flex-shrink:0;border-radius:8px}.file-source-list strong{margin:0;font-size:14px}.file-source-subtitle{display:block;margin-top:4px;font-size:12px;font-weight:400;color:var(--color-text-3)}.file-source-handle{margin-left:auto;color:var(--color-text-3)}.file-source-add{background:#ff8700!important;color:white!important;border-radius:22px}
.file-source-art :deep(img.media-server-provider-icon) { position: static; inset: auto; object-fit: contain; border-radius: 0 }
.file-source-art img.file-source-provider-icon{position:static;width:56px;height:56px;object-fit:contain;border-radius:0}
.file-source-list .file-source-art img.file-source-provider-icon{width:28px;height:28px}
.file-source-selection-bar{position:fixed;right:20px;bottom:36px;z-index:100;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 300px);padding:10px 14px;border:1px solid var(--color-border-2);border-radius:24px;background:var(--color-bg-popup);color:var(--color-text-1);box-shadow:0 6px 20px #0003;overflow-x:auto;white-space:nowrap;font-size:12px}
.file-source-selection-bar button{display:flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;white-space:nowrap}.file-source-selection-bar button svg{color:#ff8800}.file-source-selection-bar button:disabled{opacity:.4;cursor:not-allowed}.file-source-selection-bar .danger svg{color:#ff375f}.file-source-card.source-selected .file-source-art{background:#684220!important;outline:1px solid #ff8800}.file-source-card.source-selected input{accent-color:#ff8800}.file-source-browser:has(+ .file-source-selection-bar){padding-bottom:90px}
.source-context-dismiss{position:fixed;inset:0;z-index:2000}
.source-context-menu{position:absolute;min-width:145px;padding:5px;border:1px solid var(--color-border-3);border-radius:12px;background: var(--app-overlay-bg);box-shadow:0 10px 26px #0004;color:var(--color-text-1)}
.source-context-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:13px;cursor:pointer;text-align:left}
.source-context-menu button svg{color:#ff8700;flex-shrink:0}.source-context-menu button:hover,.source-context-menu button:focus-visible{background:var(--color-fill-3)}
.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}
.add-source{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:10px 16px;background:#ff8b25;color:#fff}
.more-button{display:flex;align-items:center;justify-content:center;gap:2px;width:48px;border-radius:22px}
.electron-files-toolbar{display:flex;align-items:center;gap:12px}
</style>
