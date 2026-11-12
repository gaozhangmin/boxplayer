<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {recoverLocalOperations} from '@/features/files/localRecovery'
import {recoverRemoteOperationsWithPrompt as recoverRemoteOperations} from '@/features/files/remoteRecoveryPrompt'
import {createScanScheduler,scanTargets} from '@/features/library/scanScheduler'
import { listen } from '@tauri-apps/api/event'
import FilesHeader from '@/features/files/electron/FilesHeader.vue'
import { Film, Folder, Heart, Home, Library, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Play, Search, Settings, ChevronLeft, ChevronRight, ArrowUpRight, Music2, Clock3, Tv, CircleUserRound } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import AccountManager from '@/features/sources/AccountManager.vue'
import BoxPlayerAccount from '@/features/sources/BoxPlayerAccount.vue'
import { useMembershipStore } from '@/stores/membership'
import { createAutoSigner } from '@/features/sources/autoSign'
import {useVideoCatalog} from '@/features/library/catalog'
import ServerWorkspace from '@/features/servers/ServerWorkspace.vue'
import type {BrowseRoute} from '@/features/servers/workspace'
import LibraryWorkspace from '@/features/library/LibraryWorkspace.vue'
import {libraryTitle} from '@/features/library/navigation'
import { createServerReporter } from '@/features/sources/reporting'
import { driver } from '@/features/sources/drivers'
import AppFrame from '@/components/AppFrame.vue'
import WindowBar from '@/components/WindowBar.vue'
import LibraryHeader from '@/features/library/electron/LibraryHeader.vue'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settings'
import { useFileSourcesStore } from '@/stores/fileSources'
import MainSidebarNav from '@/features/files/MainSidebarNav.vue'
import FileBrowser from '@/features/files/FileBrowser.vue'
import { buildFileSidebarEntries, type FileSidebarEntry } from '@/features/files/sidebar'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { asAppError, isNative, openFile, openWebsite, openWindow, runtimeInfo, showContextMenu, playFile, nativeCall } from '@/platform/native'
const settings = useSettingsStore()
const { t } = useI18n()
type Selection = { key: MessageKey; source?: FileSidebarEntry; route?:string;serverRoute?:BrowseRoute }
const libraryPageTitle=ref(''),serverPageTitle=ref(''),filePageTitle=ref('')
const fileWorkspace=ref<InstanceType<typeof FileBrowser>>(),fileCanBack=ref(false)
const serverWorkspace=ref<InstanceType<typeof ServerWorkspace>>(),serverCanBack=ref(false)
const showAccounts=ref(false)
const showBoxPlayerAccount=ref(false)
const membership=useMembershipStore()
let membershipRefreshing=false
async function refreshMembership(){if(!isNative()||membershipRefreshing)return;membershipRefreshing=true;try{await fileSources.refresh();await membership.refresh()}finally{membershipRefreshing=false}}
function onMembershipFocus(){void refreshMembership().catch(()=>{});if(recoveryReady)void scanScheduler.tick()}
watch(()=>membership.selectedId,()=>{if(isNative())void membership.refresh()})
const searchText=ref(''), serverSearch=ref(''), searchRevision=ref(0)
const selected = ref<Selection>({ key: 'home' })
const history = ref<Selection[]>([])
const fileSources = useFileSourcesStore()
const videoCatalog=useVideoCatalog()
const autoSigner=createAutoSigner(message=>toast.info(message))
watch(()=>[settings.ready,settings.value.autoSign,fileSources.accounts.map(a=>a.id).join(',')],()=>{if(isNative()&&settings.ready)void autoSigner(fileSources.accounts,!!settings.value.autoSign)})
const fileEntries = computed(() => buildFileSidebarEntries(fileSources.snapshot, t('directURL')))
watch(fileEntries, entries => {
  const current = selected.value.source
  if (!current) return
  const replacement = entries.find(entry => entry.id === current.id)
  if (replacement) selected.value = { ...selected.value, source: replacement }
  else {
    selected.value = { key: 'files' }
    history.value = history.value.filter(item => !item.source || entries.some(entry => entry.id === item.source?.id))
  }
})
const selectedServer = computed(()=>fileSources.accounts.find(account=>account.id===selected.value.source?.sourceId&&['jellyfin','emby','plex'].includes(account.providerId)))
watch(()=>selected.value.source?.sourceId,()=>{if(searchTimer)clearTimeout(searchTimer);searchText.value='';serverSearch.value=''})
let searchTimer:ReturnType<typeof setTimeout>|undefined
function scheduleSearch(){if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(),250)}
function search(){if(searchTimer)clearTimeout(searchTimer);if(selectedServer.value){serverSearch.value=searchText.value.trim();searchRevision.value++}else selectCatalog('search')}
const selectionTitle = computed(() => (selectedServer.value&&serverPageTitle.value?serverPageTitle.value:selected.value.key==='files'&&filePageTitle.value?filePageTitle.value:selected.value.source?.title) ?? (selected.value.key!=='files'?(libraryPageTitle.value||libraryTitle(selected.value.route||selected.value.key)):t(selected.value.key)))
const collapsed = computed(() => settings.value.sidebarCollapsed)
function navigate(next: Selection) {
  if (selected.value.key === next.key && selected.value.source?.id === next.source?.id&&selected.value.route===next.route&&JSON.stringify(selected.value.serverRoute)===JSON.stringify(next.serverRoute)) return
  history.value.push(selected.value)
  selected.value = next
}
function select(key: MessageKey) { libraryPageTitle.value='';navigate({ key }) }
function selectCatalog(route:string,origin?:'home'|'library'){libraryPageTitle.value='';navigate({key:origin||(route==='home'?'home':route==='favorites'?'favorites':'library'),route})}
function selectSource(source: FileSidebarEntry) {serverPageTitle.value='';serverCanBack.value=false;filePageTitle.value='';fileCanBack.value=false; navigate({ key: 'files', source,serverRoute:source.serverRoute }) }
function back() {if(selectedServer.value&&serverCanBack.value){serverWorkspace.value?.goBack();return}if(selected.value.key==='files'&&!selectedServer.value&&fileCanBack.value){fileWorkspace.value?.goBack();return}const previous = history.value.pop(); if (previous) selected.value = previous }
async function run(action: () => Promise<unknown>) { try { await action() } catch (e) { toast.error(asAppError(e).message) } }
async function toggleSidebar() { await settings.save({ sidebarCollapsed: !collapsed.value }) }
function openMenu(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  void run(() => showContextMenu(rect.left, rect.bottom))
}
async function choose() { const file = await openFile(); if (file) await playFile(file) }
function selectSourceId(id: string) { if(selected.value.source?.kind==='favorite'&&selected.value.source.sourceId===id)return;const entry = fileEntries.value.find(entry => entry.sourceId === id && ['localFolder', 'drive', 'mediaServer'].includes(entry.kind)); if (entry) selectSource(entry) }
function openServer(id:string,route:BrowseRoute){const source=fileEntries.value.find(entry=>entry.kind==='mediaServer'&&entry.sourceId===id);if(source){serverPageTitle.value='';navigate({key:'files',source,serverRoute:route})}}
function selectFolder(folder:{sourceId:string;path:string;local:boolean;favoriteId:string}){
 const entry=fileEntries.value.find(entry=>entry.kind==='favorite'&&entry.sourceId===folder.sourceId&&entry.favoriteId===folder.favoriteId)
 const bookmark=fileSources.findBookmark(folder.favoriteId)
 if(entry)selectSource(entry);else if(bookmark)selectSource({id:JSON.stringify(['favorite',folder.sourceId,folder.favoriteId]),kind:'favorite',sourceId:folder.sourceId,favoriteId:folder.favoriteId,title:bookmark.name})
}
let scanTimer:ReturnType<typeof setInterval>|undefined
const scanScheduler=createScanScheduler({
 targets:()=>scanTargets(videoCatalog.items,fileSources.preferences.favorites,new Set([...fileSources.snapshot.localFolders.map(s=>s.id),...fileSources.accounts.filter(a=>!['boxplayer','plex','emby','jellyfin'].includes(a.providerId)).map(a=>a.id)])),
 interval:()=>settings.value.libraryScanMinutes||0,busy:()=>videoCatalog.scanning,
 scan:async target=>{const completed=await videoCatalog.scan(target.sourceId,target.root);if(!completed)throw new Error('扫描已取消');if(videoCatalog.error)throw new Error(videoCatalog.error)},now:()=>Date.now(),
 read:key=>Number(localStorage.getItem('tauri.scan.last:'+key)||0),write:(key,time)=>localStorage.setItem('tauri.scan.last:'+key,String(time)),error:()=>{}
})
watch(()=>settings.value.libraryScanMinutes,()=>{scanScheduler.invalidate();if(isNative()&&recoveryReady)void scanScheduler.tick()})
let recoveryReady=false
let recoveryNotice:string|number|undefined
async function recoverFileState(){
 try{
  await recoverRemoteOperations(fileSources);await recoverLocalOperations(fileSources)
  recoveryReady=true
  if(recoveryNotice!==undefined)toast.dismiss(recoveryNotice)
  if(!scanTimer)scanTimer=setInterval(()=>{if(recoveryReady)void scanScheduler.tick()},30000)
  return true
 }catch(cause){
  recoveryReady=false
  if(recoveryNotice!==undefined)toast.dismiss(recoveryNotice)
  recoveryNotice=toast.error(asAppError(cause).message,{duration:Infinity,action:{label:'重试恢复',onClick:()=>{void run(async()=>{if(await recoverFileState()){await fileSources.refresh();await videoCatalog.load();void scanScheduler.tick()}})}}})
  return false
 }
}
let unlisten: (() => void) | undefined
let catalogUnlisten:(()=>void)|undefined
let libraryUnlisten: (() => void) | undefined
let refreshUnlisten: (() => void) | undefined
const reportServer = createServerReporter(() => fileSources.accounts, e => {const error=asAppError(e);if(error.code!=='ACCOUNT_MISSING')toast.error(error.message)})
let reportUnlisten: (() => void) | undefined
onMounted(async () => {
  if (!isNative()) return
  window.addEventListener('focus',onMembershipFocus)
  try {
    unlisten = await listen<import('@/platform/contracts').OpenRequest[]>('shell:open', event => {
      for (const request of event.payload) { if (request.kind === 'file') void run(() => playFile(request.value)); else toast.info(t('requests')) }
    })
    reportUnlisten = await listen<import('@/platform/contracts').PlayerSnapshot>('player:state', event => {void reportServer(event.payload);void videoCatalog.recordProgress(event.payload).catch(()=>{})})
    catalogUnlisten=await listen('catalog:changed',()=>void videoCatalog.load())
    libraryUnlisten = await listen('library:changed', () => void run(() => fileSources.refresh()))
    refreshUnlisten = await listen<import('@/platform/contracts').RefreshRequest>('media:refresh-request', event => {
      void run(async () => {
        let media = null
        try {
          const account = fileSources.accounts.find(a => a.id === event.payload.accountId && a.id === event.payload.sourceId)
          if (account) media = await driver(account).resolve(account, { id: event.payload.fileId, name: '', isDirectory: false, size: 0, playable: true })
        } finally { await nativeCall('media_refresh_complete', { requestId: event.payload.requestId, media }) }
      })
    })
    await recoverFileState()
    await fileSources.refresh()
    await videoCatalog.load()
    if(recoveryReady)void scanScheduler.tick()
    await membership.refresh()
    const info = await runtimeInfo()
    for (const request of info.pendingOpen) { if (request.kind === 'file') await playFile(request.value); else toast.info(t('requests')) }
  } catch (e) { toast.error(asAppError(e).message) }
})
onUnmounted(() => {scanScheduler.stop();if(scanTimer)clearInterval(scanTimer);if(searchTimer)clearTimeout(searchTimer); window.removeEventListener('focus',onMembershipFocus);catalogUnlisten?.();reportUnlisten?.(); unlisten?.(); libraryUnlisten?.(); refreshUnlisten?.() })
</script>
<template>
  <AppFrame>
    <div class="main-layout" :class="{ collapsed }">
      <aside class="sidebar">
        <form class="search-box" role="search" @submit.prevent="search">
          <Search :size="16" /><input v-if="!collapsed" v-model="searchText" @input="scheduleSearch" :placeholder="selectedServer ? '搜索 '+selectedServer.name : t('searchShort')" :aria-label="t('search')" /><button v-else type="submit" :aria-label="t('search')"><Search :size="17" /></button>
        </form>
        <MainSidebarNav :entries="fileEntries" :collapsed="collapsed" :selected-key="selected.key" :selected-route="selected.route" :selected-source-id="selected.source?.id" @select="select" @catalog="selectCatalog" @server="openServer" @select-source="selectSource" />
        <footer class="sidebar-footer">
          <div class="sidebar-actions">
            <Button variant="ghost" size="icon" :disabled="settings.preview || !settings.ready || settings.saving" :aria-label="collapsed ? t('expand') : t('collapse')" @click="run(toggleSidebar)"><component :is="collapsed ? PanelLeftOpen : PanelLeftClose" :size="18" /></Button>
            <Button variant="ghost" size="icon" :aria-label="t('settings')" :title="t('settings')" @click="run(() => openWindow('settings'))"><Settings :size="18" /></Button>
            <Button v-if="!collapsed" variant="ghost" size="icon" :aria-label="t('account')" @click="showAccounts=true"><CircleUserRound :size="18" /></Button>
          </div>
          <button v-if="!collapsed" class="pro-card" @click="showBoxPlayerAccount=true"><span><small>{{ membership.membership?.isPro ? t('account') : t('upgradeTo') }}</small><strong>{{ membership.label }}</strong></span><ChevronRight :size="18" /></button>
        </footer>
      </aside>
      <main class="main-content">
        <WindowBar :class="{'electron-files-window-bar':!selectedServer}">
          <FilesHeader v-if="selected.key==='files'&&!selectedServer" :title="selectionTitle" @back="history.length||fileCanBack?back():select('home')"><div id="file-toolbar-actions"/></FilesHeader><LibraryHeader v-else-if="selected.key!=='files'" v-show="!(selected.key==='library'&&!selected.route)" :title="selectionTitle" :home="(selected.route||selected.key)==='home'" @back="back"><div id="library-toolbar-actions"/></LibraryHeader><div v-else class="toolbar"><Button v-if="(selected.route||selected.key)!=='home'&&(history.length||(selected.key==='files'&&(selectedServer?serverCanBack:fileCanBack)))" class="toolbar-back" variant="outline" size="icon" :aria-label="t('back')" @click="back"><ChevronLeft :size="20" /></Button><span class="toolbar-title">{{ selectionTitle }}</span><div class="toolbar-spacer" /><div v-if="selected.key === 'files'" id="file-toolbar-actions" /><div v-else id="library-toolbar-actions"/></div>
        </WindowBar>
        <div class="content-body">
          <ServerWorkspace v-if="selected.key==='files'&&selectedServer" ref="serverWorkspace" :key="selectedServer.id" :account="selectedServer" :initial-route="selected.serverRoute" :search-query="serverSearch" :search-revision="searchRevision" toolbar-target="#file-toolbar-actions" @title="serverPageTitle=$event" @can-go-back="serverCanBack=$event" @go-back="back" @account-updated="run(()=>fileSources.refresh())" @switch-account="id=>openServer(id,{kind:'home',title:'主屏幕'})"/>
          <FileBrowser ref="fileWorkspace" @title="filePageTitle=$event" @can-go-back="fileCanBack=$event" @go-back="back" v-else-if="selected.key === 'files'" :key="selected.source?.id ?? 'files'" :source="selected.source" :search-query="serverSearch" :search-revision="searchRevision" toolbar-target="#file-toolbar-actions" @menu="openMenu" @select-source="selectSourceId" @open-folder="selectFolder" @server-route="openServer" />
          <LibraryWorkspace v-else :origin="selected.key==='home'?'home':'library'" :route="selected.route||selected.key" :query="searchText" toolbar-target="#library-toolbar-actions" @navigate="selectCatalog" @source="selectSourceId" @server="openServer" @folder="selectFolder" @title="libraryPageTitle=$event"/>

        </div>
      </main>
    </div>
    <AccountManager v-if="showAccounts" @close="showAccounts=false" @select="selectSourceId"/>
    <BoxPlayerAccount v-if="showBoxPlayerAccount" @close="showBoxPlayerAccount=false"/>
  </AppFrame>
</template>
