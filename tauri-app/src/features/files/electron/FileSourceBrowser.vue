<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import SourceDriveManager from '../drive/SourceDriveManager.vue'
import IconFont from './IconFont.vue'
import {encodeLocal,decodeLocal} from '../adapters/sourceServices'
import type {IAliGetFileModel as DriveFile} from '../drive/electron/aliapi/alimodels'
import { Folder, File, ArrowLeft, Star, Download } from 'lucide-vue-next'
import type {IAliGetFileModel} from '../adapters/sourceServices'
import {listProviderFolderItems,useMediaLibraryStore,MediaScanner,isFileSourceRoot,message,listLocal,downloadFolder} from '../adapters/sourceServices'
import {t,useLocale} from './i18n'
import type {MediaServerConfig} from '../adapters/types'
import type {MediaServerCardItem} from '../adapters/serverBrowse'
import {getMediaServerLibraries,getMediaServerLibraryPagedItems,updateMediaServerFavoriteState,serverFolderFavorites,rememberServerFolderFavorite} from '../adapters/serverBrowse'
const locale = useLocale()
const props = defineProps<{ source?: { name: string; favorite?: boolean; driveServerId?: string; server?: MediaServerConfig; folder: IAliGetFileModel; drives?: Array<{ label: string; folder: IAliGetFileModel }> }; device?: boolean }>()
const emit = defineEmits<{ 'toggle-root': [] }>()
type Entry = { name: string; directory: boolean; path?: string; folder?: IAliGetFileModel; serverItem?: MediaServerCardItem }
const entries = ref<Entry[]>([]), loading = ref(false), error = ref('')
const history = ref<Array<{ name: string; folder?: IAliGetFileModel; serverItem?: MediaServerCardItem; path?: string }>>([])
const managerTarget=computed(()=>{
 const current=history.value.at(-1)
 if(props.source&&!props.source.server){if(props.source.drives?.length&&!current?.folder)return undefined;const folder=current?.folder||props.source.folder;return {sourceId:folder.user_id,path:folder.file_id||'',local:false,name:current?.name||props.source.name}}
 if(current?.path){const [sourceId,path]=decodeLocal(current.path);return {sourceId,path,local:true,name:current.name}}
 return undefined
})
function favoriteManagedFolder(file:DriveFile){const target=managerTarget.value;if(!target)return;toggleFavorite(target.local?{name:file.name,directory:true,path:encodeLocal(target.sourceId,file.file_id)}:{name:file.name,directory:true,folder:{...file,path:file.file_id,user_id:target.sourceId}})}
const media = useMediaLibraryStore()

const pendingRemoval = ref<Entry>()
const renameEntry = ref<Entry>(), favoriteName = ref(''), saving = ref(false)
function folderMatch(entry: Entry) {
  return media.folders.find(f => entry.path ? f.path === entry.path && (f.driveId === 'local' || f.driveServerId === 'local') : entry.folder && f.userId === (entry.folder as any).user_id && f.driveId === entry.folder.drive_id && f.fileId === entry.folder.file_id)
}
function isFavorite(entry: Entry) {
  if (entry.serverItem) return serverFolderFavorites.value.some(f => f.item.serverId === entry.serverItem!.serverId && f.item.id === entry.serverItem!.id) || entry.serverItem.isFavorite === true
  const saved = folderMatch(entry)
  return !!saved && saved.isFavorite !== false && (!entry.folder || !isFileSourceRoot(entry.folder) || !!saved.isDriveRootFavorite)
}
// Same defaults as macOS: a drive root is the "All Files" card, other folders keep their name.
function defaultFavoriteName(entry: Entry) {
  return entry === allFolders.value || (!!entry.folder && isFileSourceRoot(entry.folder)) ? t('unified.allFiles') : entry.name
}
function toggleFavorite(entry: Entry) {
  if (props.source?.server && entry.serverItem) {
    const server = props.source.server, item = entry.serverItem, favorite = isFavorite(entry)
    if (item.kind === 'folder' && !favorite) { renameEntry.value = entry; favoriteName.value = defaultFavoriteName(entry); return }
    const apply = async () => {
      if (item.kind === 'folder') rememberServerFolderFavorite(server, item, !favorite)
      else await updateMediaServerFavoriteState(server, item.id, favorite, item)
      item.isFavorite = !favorite
    }
    void apply().catch(e => message.error(String(e)))
    return
  }
  const existing = folderMatch(entry)
  if (existing && isFavorite(entry)) {
    pendingRemoval.value = entry
    return
  }
  renameEntry.value = entry; favoriteName.value = defaultFavoriteName(entry)
}
function removeFavorite() {
  const entry = pendingRemoval.value
  if (!entry) return
  const existing = folderMatch(entry)
  if (existing) {
    if (entry.path) media.addFolder({ ...existing, isFavorite: false })
    else media.removeFolder(existing.id)
  }
  pendingRemoval.value = undefined
}
async function saveFavorite() {
  const entry = renameEntry.value
  if (!entry || saving.value) return
  // An emptied name falls back to the default instead of blocking the save, as on macOS.
  const name = favoriteName.value.trim() || defaultFavoriteName(entry)
  saving.value = true
  try {
    if (entry.serverItem && props.source?.server) {
      rememberServerFolderFavorite(props.source.server, { ...entry.serverItem, title: name }, true)
      entry.serverItem.isFavorite = true; renameEntry.value = undefined; return
    }
    const folder = entry.folder
    // Browsing down from a favorited folder means this one was scraped with it.
    const coveredByAncestor = history.value.some(step => !!step.folder && step.folder.file_id !== folder?.file_id
      && isFavorite({ name: step.name, directory: true, folder: step.folder }))
    const isRoot = (!!folder && isFileSourceRoot(folder)) || entry === allFolders.value || !!props.source?.drives?.some(d => d.folder.drive_id === folder?.drive_id && d.folder.file_id === folder?.file_id)
    renameEntry.value = undefined
    if (entry.path) void MediaScanner.getInstance().scanLocalFolder(entry.path, name).catch(e => message.error(String(e)))
    else if (folder) void MediaScanner.getInstance().favoriteFolder(folder, props.source?.driveServerId || folder.drive_id, name, isRoot, coveredByAncestor).catch(e => message.error(String(e)))
  } catch (e) { message.error(String(e)) } finally { saving.value = false }
}
const allFolders = computed<Entry | undefined>(() => {
  if (props.device) return undefined
  if (props.source?.server) return { name: t('source.allFolders'), directory: true, serverItem: history.value.at(-1)?.serverItem || { id: '__all__', serverId: props.source.server.id, provider: props.source.server.type, kind: 'folder', title: props.source.name } }
  const current = history.value.at(-1)
  if (!current && props.source?.drives?.length) return undefined
  const folder = current?.folder || props.source?.folder
  if (history.value.length && !props.source?.drives?.some(d => d.folder.drive_id === folder?.drive_id && d.folder.file_id === folder?.file_id)) return undefined
  return folder ? { name: t('source.allFolders'), directory: true, folder } : undefined
})
function isVideo(entry: Entry) { return !entry.directory && (/\.(mp4|mkv|avi|mov|m4v|webm|ts|m2ts|wmv|flv)$/i.test(entry.name) || entry.folder?.category === 'video' || !!entry.serverItem) }
async function download(entry:Entry){try{if(entry.path)throw Error('本地文件无需下载');if(entry.serverItem&&props.source?.server)await downloadFolder({user_id:props.source.server.id,file_id:entry.serverItem.id} as IAliGetFileModel,entry.name);else if(entry.folder)await downloadFolder(entry.folder,entry.name)}catch(error){message.error(String(error))}}
let revision = 0
onUnmounted(() => revision++)
async function load(target?: { name: string; folder?: IAliGetFileModel; serverItem?: MediaServerCardItem; path?: string }, push = true) {
  const current = ++revision
  if (push && target) history.value.push(target)
  entries.value = []; error.value = ''; loading.value = true
  if(managerTarget.value){loading.value=false;return}
  try {
    let result: Entry[]
    if (props.source?.server) {
      const server = props.source.server
      let items: MediaServerCardItem[] = []
      if (!target?.serverItem || target.serverItem.id === '__all__') items = await getMediaServerLibraries(server)
      else {
        for (let page = 0; ; page++) {
          const result = await getMediaServerLibraryPagedItems(server, target.serverItem.id, page, { recursiveMedia: false })
          items.push(...result.items)
          if (!result.hasNextPage || current !== revision) break
        }
      }
      result = items.map(item => ({ name: item.title, directory: ['folder', 'series', 'season'].includes(item.kind) || ['boxset', 'playlist', 'collectionfolder'].includes((item.rawType || '').toLowerCase()), serverItem: item }))
    } else if (target?.path) {
      result = await listLocal(target.path)
    } else if (target?.folder) {
      const folder=target.folder,userId=folder.user_id
      const files=await listProviderFolderItems({folder,userId,driveId:folder.drive_id})
      result=files.map(file=>({name:file.name,directory:file.isDir,folder:{...file,user_id:userId}}))
    } else if (props.device) {
      result = useMediaLibraryStore().folders.filter(f => f.driveId === 'local' || f.driveServerId === 'local' || f.userId === 'local').map(f => ({ name: f.name, directory: true, path: f.path }))
    } else {
      result = (props.source?.drives || []).map(d => ({ name: d.label, directory: true, folder: d.folder }))
    }
    if (current === revision) entries.value = result.sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  } catch (e) { if (current === revision) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (current === revision) loading.value = false }
}
function back() {
  history.value.pop()
  const root = props.source && !props.source.drives?.length ? { name: props.source.name, folder: props.source.folder } : undefined
  void load(history.value.at(-1) || root, false)
}
watch(() => [props.source?.server?.id, (props.source?.folder as any)?.user_id, props.source?.folder.drive_id, props.source?.folder.file_id, props.device], () => {
  history.value = []
  const source = props.source
  void load(source && !source.drives?.length ? { name: source.name, folder: source.folder } : undefined, false)
}, { immediate: true })
</script>
<template>
  <div class="share-browser">
    <div v-if="!managerTarget || history.length" class="share-browser-toolbar"><button v-if="history.length" :aria-label="locale === 'en-US' ? 'Back' : '返回'" @click="back"><ArrowLeft :size="18" /></button><strong v-if="!managerTarget">{{ history.at(-1)?.name || source?.name || '本地文件夹' }}</strong></div>
    <div v-if="allFolders && !managerTarget" class="source-file-row"><Folder :size="22" /><span>{{ t('source.allFolders') }}</span><button class="source-star" :aria-label="isFavorite(allFolders) ? t('unified.removeFavoriteFolder') : t('unified.addToFavorites')" @click="toggleFavorite(allFolders)"><Star :size="20" :fill="isFavorite(allFolders) ? 'currentColor' : 'none'" /></button></div>
    <SourceDriveManager v-if="managerTarget" :key="managerTarget.sourceId" :source-id="managerTarget.sourceId" :initial-path="managerTarget.path" :local="managerTarget.local" :name="managerTarget.name" @favorite="favoriteManagedFolder"><template v-if="allFolders" #list-header><div class="source-file-row source-all-files"><span class="fileicon"><IconFont name="iconfile-folder" aria-hidden="true" /></span><span>{{ t('unified.allFiles') }}</span><button class="source-star" :aria-label="isFavorite(allFolders) ? t('unified.removeFavoriteFolder') : t('unified.addToFavorites')" @click="toggleFavorite(allFolders)"><Star :size="20" :fill="isFavorite(allFolders) ? 'currentColor' : 'none'" /></button></div></template></SourceDriveManager><div v-else-if="loading" class="share-browser-status"><a-spin /></div>
    <div v-else-if="error" class="share-browser-status" role="alert">{{ error }}<a-button @click="load(history.at(-1), false)">重试</a-button></div>
    <div v-else-if="!entries.length" class="share-browser-status">暂无文件</div>
    <div v-else class="share-browser-files"><div v-for="(entry, index) in entries" :key="index" class="source-file-row"><button class="source-file-name" :disabled="!entry.directory" @click="load(entry)"><Folder v-if="entry.directory" :size="22" /><File v-else :size="22" /><span>{{ entry.name }}</span></button><button v-if="entry.directory" class="source-star" :aria-label="isFavorite(entry) ? t('unified.removeFavoriteFolder') : t('unified.addToFavorites')" @click="toggleFavorite(entry)"><Star :size="20" :fill="isFavorite(entry) ? 'currentColor' : 'none'" /></button><button v-else-if="isVideo(entry)" class="source-download" aria-label="下载" @click="download(entry)"><Download :size="20" /></button></div></div>
    <a-modal modal-class="file-source-confirm-modal" :visible="!!pendingRemoval" :title="t('unified.removeFavoriteFolder')" :ok-text="t('unified.removeFavoriteFolder')" :ok-button-props="{ status: 'danger' }" :width="400" @ok="removeFavorite" @cancel="pendingRemoval = undefined">{{ pendingRemoval?.path ? t('source.removeLocalFavoriteConfirmation') : t('unified.removeFavoriteConfirmation') }}</a-modal>
    <a-modal modal-class="file-source-confirm-modal" :visible="!!renameEntry" :title="t('unified.addToFavorites')" :ok-text="t('common.save')" :width="400" :confirm-loading="saving" @ok="saveFavorite" @cancel="renameEntry = undefined"><a-input v-model="favoriteName" :placeholder="t('mediaServer.name')" @press-enter="saveFavorite" /></a-modal>
  </div>
</template>
<style scoped>
.share-browser{padding:0 24px 24px;overflow:auto;flex:1;min-height:0}.share-browser-toolbar{display:flex;align-items:center;gap:12px;padding:8px 0 18px}.share-browser button{display:flex;align-items:center;gap:12px;border:0;background:transparent;color:var(--color-text-1);font:inherit;text-align:left;cursor:pointer}.share-browser-files button{width:100%;min-height:44px;border-bottom:1px solid var(--color-border-1);padding:8px 0}.share-browser-files button:disabled{opacity:1;cursor:default}.share-browser-files button span{overflow-wrap:anywhere}.share-browser-files svg{flex-shrink:0;color:#ff8a00}.source-all-files{display:flex;align-items:center;gap:12px;min-height:50px;border-bottom:1px solid var(--color-border-1);padding:8px 12px;box-sizing:border-box}.source-all-files>span:not(.fileicon){flex:1}.source-all-files>.fileicon{flex:none}.source-all-files>.source-star{margin-left:auto}
.share-browser-status{padding:32px 0;display:flex;flex-direction:column;align-items:center;gap:16px;color:var(--color-text-3)}
</style>

<style>
.arco-modal.file-source-confirm-modal {
  width: 400px !important;
  max-width: calc(100vw - 32px);
}
</style>

<style scoped>
.source-file-row{display:flex;align-items:center;gap:12px;min-height:44px;border-bottom:1px solid var(--color-border-1)}.source-file-row>span{flex:1}.share-browser-files .source-file-row button{width:auto;border:0;min-height:40px}.share-browser-files .source-file-row .source-file-name{flex:1;min-width:0}.source-file-row .source-star,.source-file-row .source-download{margin-left:auto;padding:8px;color:#ff8a00;flex-shrink:0}
</style>

<style scoped>
.share-browser{display:flex;flex-direction:column;overflow:hidden}.share-browser-files{overflow:auto;min-height:0}.share-browser-toolbar,.source-file-row{flex-shrink:0}.share-browser :deep(.source-drive-manager){padding-inline:0}
</style>
