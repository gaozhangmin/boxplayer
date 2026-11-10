<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Search, X, File, Folder, ArrowUpRight, Film, Tv, Monitor, Clock, ChevronRight, Sparkles } from 'lucide-vue-next'
import { useAppStore, useSettingStore } from '../store'
import { humanSize } from '../utils/format'
import { searchAllDrives, searchResultGroupTitle, type GlobalSearchResult } from '../utils/globalSearch'
import { createPanHubFetch, searchPanHubStream, type PanHubMergedLinks } from '../utils/panHubSearch'
import PanHubResultGroup from './PanHubResultGroup.vue'
import PanHubHotSearches from './PanHubHotSearches.vue'
import PanHubTrending from './PanHubTrending.vue'
import PanHubMediaResults, { type TmdbMediaResult } from './PanHubMediaResults.vue'
import PanHubSearchBox from './PanHubSearchBox.vue'
import { checkAndIncrement } from '../utils/usageLimit'
import message from '../utils/message'
import { resolveQuarkSearchDirectory } from '../utils/quarkSearchNavigation'
import Config from '../config'
import DownDAL from '../down/DownDAL'
import TorrentFileSelector from '../down/TorrentFileSelector.vue'
import { discardMagnetPreview, prepareMagnetFiles, type MagnetPreview } from '../down/integration/aria2TaskApi'
import type { DownloadTaskFile } from '../down/integration/taskTypes'
import MediaAcquisitionTargetModal from '../components/MediaAcquisitionTargetModal.vue'
import type { MediaAcquisitionRequest, MediaAcquisitionState } from '@shared/types/mediaAcquisition'
import { listMediaAcquisitionStates } from '../services/mediaAcquisition/client'
import { t } from '../i18n'
import { isDocumentInsightFile, openDocumentInsight, toDocumentInsightSource } from '../services/documents/insight'

const appStore = useAppStore()
const HISTORY_KEY = 'global_search_history'
const MAX_HISTORY = 20
const PANHUB_API_BASE = `${Config.BOXPLAYER_API_URL.replace(/\/+$/, '')}/api`
const panHubFetch = createPanHubFetch(window.Electron?.ipcRenderer?.invoke?.bind(window.Electron.ipcRenderer))

const searchMode = ref<'local' | 'panhub'>('local')
const keyword = ref('')
const inputRef = ref<HTMLInputElement>()
const cloudResults = ref<GlobalSearchResult[]>([])
const msResults = ref<GlobalSearchResult[]>([])
const searching = ref(false)
const selectedSection = ref<'cloud' | 'ms' | null>(null)
const selectedIndex = ref(0)
const searchTimer = ref<ReturnType<typeof setTimeout>>()
const searchId = ref(0)
const history = ref<string[]>([])
const collapsedGroups = ref<Set<string>>(new Set())
const historyCollapsed = ref(false)

function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    history.value = raw ? JSON.parse(raw) : []
  } catch {
    history.value = []
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
}

function addToHistory(query: string) {
  const q = query.trim()
  if (q.length < 2) return
  history.value = [q, ...history.value.filter((h) => h !== q)].slice(0, MAX_HISTORY)
  saveHistory()
}

function removeHistoryItem(index: number) {
  history.value.splice(index, 1)
  saveHistory()
}

function clearHistory() {
  history.value = []
  saveHistory()
}

function useHistoryItem(query: string) {
  keyword.value = query
  nextTick(() => {
    if (inputRef.value) inputRef.value.focus()
  })
}

const cloudGroups = computed(() => {
  const groups: { key: string; title: string; items: GlobalSearchResult[] }[] = []
  const map = new Map<string, GlobalSearchResult[]>()
  for (const r of cloudResults.value) {
    const key = searchResultGroupTitle(r)
    if (!map.has(key)) {
      map.set(key, [])
      groups.push({ key, title: key, items: map.get(key)! })
    }
    map.get(key)!.push(r)
  }
  return groups
})

const msGroups = computed(() => {
  const groups: { key: string; title: string; items: GlobalSearchResult[] }[] = []
  const map = new Map<string, GlobalSearchResult[]>()
  for (const r of msResults.value) {
    const key = searchResultGroupTitle(r)
    if (!map.has(key)) {
      map.set(key, [])
      groups.push({ key, title: key, items: map.get(key)! })
    }
    map.get(key)!.push(r)
  }
  return groups
})

const allItems = computed(() => {
  const items: { section: 'cloud' | 'ms'; groupIndex: number; itemIndex: number; result: GlobalSearchResult }[] = []
  cloudGroups.value.forEach((group, gi) => {
    group.items.forEach((result, ii) => {
      items.push({ section: 'cloud', groupIndex: gi, itemIndex: ii, result })
    })
  })
  msGroups.value.forEach((group, gi) => {
    group.items.forEach((result, ii) => {
      items.push({ section: 'ms', groupIndex: gi, itemIndex: ii, result })
    })
  })
  return items
})

const hasInput = computed(() => keyword.value.trim().length >= 2)
const totalCloud = computed(() => cloudResults.value.length)
const totalMs = computed(() => msResults.value.length)
const showHistoryDrop = computed(() => !hasInput.value && history.value.length > 0)
const hasBoth = computed(() => totalCloud.value > 0 && totalMs.value > 0)

const isLocalMode = () => searchMode.value === 'local'
const isPanHubMode = () => searchMode.value === 'panhub'

const phLoading = ref(false); const phSearched = ref(false)
const phTotal = ref(0); const phMerged = ref<PanHubMergedLinks>({})
const phError = ref(''); const phFilterPlatform = ref('all')
const phSortType = ref<'default'|'date-desc'|'date-asc'|'name-asc'|'name-desc'>('default')
const phElapsedMs = ref(0); let phController: AbortController|null = null
const phTmdbItems = ref<TmdbMediaResult[]>([])
const phTmdbLoading = ref(false)
const phTmdbError = ref('')
const acquisitionStates = ref<MediaAcquisitionState[]>([])
const acquisitionRequest = ref<MediaAcquisitionRequest | null>(null)
const acquisitionVisible = ref(false)
const magnetSelectorVisible = ref(false)
const magnetSelectorLoading = ref(false)
const magnetSelectorFiles = ref<DownloadTaskFile[]>([])
const magnetPreview = ref<MagnetPreview | null>(null)
const pendingMagnet = ref<{ url: string; title: string; savePath: string } | null>(null)
let magnetPreviewController: AbortController | null = null
let acquisitionStateTimer: ReturnType<typeof setInterval> | undefined

const PH_PLATFORM_INFO: Record<string,{name:string;color:string}> = {
  aliyun:{name:'阿里云盘',color:'#7c3aed'},quark:{name:'夸克网盘',color:'#6366f1'},
  baidu:{name:'百度网盘',color:'#2563eb'},'115':{name:'115网盘',color:'#f59e0b'},
  xunlei:{name:'迅雷云盘',color:'#fbbf24'},uc:{name:'UC网盘',color:'#ef4444'},
  tianyi:{name:'天翼云盘',color:'#ec4899'},'123':{name:'123网盘',color:'#10b981'},
  mobile:{name:'移动云盘',color:'#0ea5e9'},pikpak:{name:'PikPak',color:'#f97316'},
  lanzou:{name:'蓝奏云',color:'#06b6d4'},magnet:{name:'磁力链接',color:'#64748b'},
  ed2k:{name:'电驴链接',color:'#475569'},others:{name:'其他网盘',color:'#6b7280'},
}
const phHasResults = computed(() => Object.keys(phMerged.value).length > 0)
const phPlatforms=computed(()=>{const p:{key:string;name:string;count:number}[]=[];for(const[k,v]of Object.entries(phMerged.value))p.push({key:k,name:PH_PLATFORM_INFO[k]?.name||k,count:v.length});return p})

async function phSearchTmdb(keyword: string, signal: AbortSignal) {
  phTmdbLoading.value = true
  phTmdbError.value = ''
  try {
    const query = new URLSearchParams({ query: keyword, language: 'zh-CN', include_adult: 'false', page: '1' })
    const response = await fetch(`${PANHUB_API_BASE}/tmdb/proxy/search/multi?${query}`, { signal })
    const payload = await response.json()
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) throw new Error(payload?.message || t('search.tmdbFailed'))
    phTmdbItems.value = Array.isArray(payload?.results)
      ? payload.results.filter((item: TmdbMediaResult) => item?.media_type === 'movie' || item?.media_type === 'tv').slice(0, 10)
      : []
  } catch (error: any) {
    if (error?.name !== 'AbortError') phTmdbError.value = error?.message || t('search.tmdbFailed')
  } finally {
    if (!signal.aborted) phTmdbLoading.value = false
  }
}

function phAcquire(request: MediaAcquisitionRequest) {
  acquisitionRequest.value = request
  acquisitionVisible.value = true
}

async function refreshAcquisitionStates() {
  try {
    acquisitionStates.value = await listMediaAcquisitionStates()
  } catch {
    // The search page remains usable when the desktop IPC service is unavailable.
  }
}

function onAcquisitionVisibleChange(visible: boolean) {
  acquisitionVisible.value = visible
  if (!visible) acquisitionRequest.value = null
}

function onAcquisitionCreated() {
  void refreshAcquisitionStates()
}

async function phDoSearch(){
  const kw=keyword.value.trim()
  if(kw.length<2){phMerged.value={};phSearched.value=false;return}
  const usage = checkAndIncrement('panHubSearch')
  if(!usage.allowed){message.warning(usage.message || t('search.limitUsed'));return}
  addToHistory(kw)
  if(phController)phController.abort()
  const controller=new AbortController()
  phController=controller
  phLoading.value=true;phSearched.value=true
  phError.value='';phTotal.value=0;phMerged.value={};phTmdbItems.value=[];phTmdbError.value='';phFilterPlatform.value='all';phSortType.value='default'
  const start=Date.now()
  try{
    panHubFetch(`${PANHUB_API_BASE}/hot-searches`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({term:kw})}).catch(()=>{})
    void phSearchTmdb(kw, controller.signal)
    const result=await searchPanHubStream({
      apiBase:PANHUB_API_BASE,
      keyword:kw,
      signal:controller.signal,
      fetchImpl:panHubFetch,
      ipcRenderer:window.Electron?.ipcRenderer,
      onProgress:(merged,total)=>{
        if(phController!==controller)return
        phMerged.value=merged;phTotal.value=total
      }
    })
    if(phController!==controller)return
    phMerged.value=result.merged;phTotal.value=result.total
    if(result.successfulSources===0&&result.failedSources>0)phError.value=t('search.sourcesUnavailable')
  }catch(e:any){if(e?.name==='AbortError')return;phError.value=e?.message||t('search.networkFailed')}
  finally{if(phController===controller){phLoading.value=false;phElapsedMs.value=Date.now()-start;phController=null}}
}
function phReset(){if(phController)phController.abort();phController=null;phLoading.value=false;phSearched.value=false;phError.value='';phTotal.value=0;phMerged.value={};phTmdbItems.value=[];phTmdbError.value='';phTmdbLoading.value=false;keyword.value=''}
function phHotSelect(term:string){keyword.value=term;nextTick(()=>{if(searchTimer.value)clearTimeout(searchTimer.value);phDoSearch()})}
function phCopy(url:string){navigator.clipboard.writeText(url).catch(()=>{})}
async function phConfirmMagnetDownload(url:string,title:string){
  const magnet=url.trim()
  if(!/^magnet:\?/i.test(magnet))return
  const settingStore=useSettingStore()
  const savePath=settingStore.ariaState==='remote'?settingStore.ariaSavePath:settingStore.downSavePath
  if(!savePath){message.error(t('search.selectSavePathFirst'));return}

  magnetPreviewController?.abort()
  await discardMagnetPreview(magnetPreview.value)
  magnetPreview.value=null
  magnetSelectorFiles.value=[]
  pendingMagnet.value={url:magnet,title:(title||'').trim(),savePath}
  magnetSelectorVisible.value=true
  magnetSelectorLoading.value=true
  const controller=new AbortController()
  magnetPreviewController=controller
  try{
    const preview=await prepareMagnetFiles(magnet,savePath,{signal:controller.signal})
    if(controller.signal.aborted||magnetPreviewController!==controller){await discardMagnetPreview(preview);return}
    magnetPreview.value=preview
    magnetSelectorFiles.value=preview.files
    if(pendingMagnet.value&&!pendingMagnet.value.title)pendingMagnet.value.title=preview.name
  }catch(e:any){
    if(e?.name!=='AbortError'){
      message.error(e?.message||t('search.fetchMagnetFilesFailed'))
      magnetSelectorVisible.value=false
      pendingMagnet.value=null
    }
  }finally{
    if(magnetPreviewController===controller){magnetPreviewController=null;magnetSelectorLoading.value=false}
  }
}

async function phCancelMagnetSelection(){
  magnetSelectorVisible.value=false
  magnetSelectorLoading.value=false
  magnetPreviewController?.abort()
  magnetPreviewController=null
  const preview=magnetPreview.value
  magnetPreview.value=null
  magnetSelectorFiles.value=[]
  pendingMagnet.value=null
  await discardMagnetPreview(preview)
}

async function phCreateSelectedMagnet(indexes:number[]){
  const pending=pendingMagnet.value
  const preview=magnetPreview.value
  if(!pending||!preview||!indexes.length)return
  magnetPreview.value=null
  pendingMagnet.value=null
  magnetSelectorFiles.value=[]
  await discardMagnetPreview(preview)
  const settingStore=useSettingStore()
  const selectFile=indexes.length===preview.files.length?undefined:indexes.join(',')
  const result=DownDAL.aAddExternalDownload({source:pending.url,sourceType:'magnet',savePath:pending.savePath,fileName:(pending.title||preview.name).slice(0,200),selectFile,split:settingStore.downThreadMax})
  if(!result.success){message.error(result.message||t('search.addMagnetFailed'));return}
  message.success(t('search.downloadTasksAdded', { count: indexes.length }))
}

function phCreateMagnetDirect(){
  const pending=pendingMagnet.value
  if(!pending)return
  const preview=magnetPreview.value
  magnetPreviewController?.abort()
  magnetPreviewController=null
  magnetPreview.value=null
  pendingMagnet.value=null
  magnetSelectorFiles.value=[]
  magnetSelectorLoading.value=false
  magnetSelectorVisible.value=false
  discardMagnetPreview(preview).catch(()=>undefined)
  const settingStore=useSettingStore()
  const result=DownDAL.aAddExternalDownload({source:pending.url,sourceType:'magnet',savePath:pending.savePath,fileName:pending.title.slice(0,200),split:settingStore.downThreadMax})
  if(!result.success){message.error(result.message||t('search.addMagnetFailed'));return}
  message.success(t('search.magnetTaskAdded'))
}
function phFmt(ms:number):string{return ms<1000?`${ms}ms`:`${(ms/1000).toFixed(1)}s`}

function handleSearchSubmit(){if(searchTimer.value){clearTimeout(searchTimer.value)};doSearch()}

function onSearchBoxSubmit() {
  if (searchTimer.value) clearTimeout(searchTimer.value)
  doSearch()
}

let searchController: AbortController | undefined

function doSearch() {
  if (searchMode.value === 'panhub') { phDoSearch(); return }
  const q = keyword.value.trim()
  if (q.length < 2) {
    cloudResults.value = []
    msResults.value = []
    selectedSection.value = null
    selectedIndex.value = 0
    return
  }
  addToHistory(q)
  const id = ++searchId.value
  searching.value = true
  searchController?.abort()
  searchController = new AbortController()
  cloudResults.value = []
  msResults.value = []
  const publish = (items: GlobalSearchResult[]) => {
    if (id !== searchId.value) return
    const selected = allItems.value[selectedIndex.value]?.result
    cloudResults.value = items.filter((r) => r.source === 'cloud')
    msResults.value = items.filter((r) => r.source === 'media_server')
    const retained = selected ? allItems.value.findIndex(({ result: item }) => item.id === selected.id && item.user_id === selected.user_id && item.mediaServerId === selected.mediaServerId) : -1
    if (retained >= 0) selectedIndex.value = retained
    else if (items.length) {
      selectedSection.value = items[0].source === 'cloud' ? 'cloud' : 'ms'
      selectedIndex.value = 0
    } else {
      selectedSection.value = null
      selectedIndex.value = -1
    }
  }
  searchAllDrives(q, { signal: searchController.signal, onUpdate: publish }).then(publish).catch(() => {}).finally(() => {
    if (id === searchId.value) searching.value = false
  })
}

watch(keyword, () => {
  searchId.value++
  searchController?.abort()
  cloudResults.value = []; msResults.value = []
  if (searchTimer.value) clearTimeout(searchTimer.value)
  selectedSection.value = null; selectedIndex.value = 0
  if (keyword.value.trim().length < 2) { cloudResults.value = []; msResults.value = []; phMerged.value = {}; phTmdbItems.value = []; phTmdbError.value = ''; phTmdbLoading.value = false; searching.value = false; return }
  if (searchMode.value === 'panhub') { searchTimer.value = setTimeout(doSearch, 300); return }
  searching.value = true; searchTimer.value = setTimeout(doSearch, 300)
})

watch(searchMode, () => {
  searchController?.abort()
  if (searchTimer.value) clearTimeout(searchTimer.value)
  if (searchMode.value === 'local') {
    phController?.abort(); phController = null; phLoading.value = false
  } else {
    searchId.value++; searching.value = false
  }
  if (keyword.value.trim().length >= 2) searchTimer.value = setTimeout(doSearch, 0)
})

async function handleClick(result: GlobalSearchResult) {
  if (result.source === 'media_server') {
    nextTick(async () => {
      const { default: useMediaServerRegistryStore } = await import('../store/mediaServerRegistry')
      const { default: useMediaServerNavigationStore } = await import('../store/mediaServerNavigation')
      const registry = useMediaServerRegistryStore()
      const navigation = useMediaServerNavigationStore()

      if (result.mediaServerId) {
        registry.setCurrentServer(result.mediaServerId)
      }
      navigation.push({ kind: 'item-detail', itemId: result.file_id, title: result.name })
      appStore.toggleTab('media-server')
    })
    return
  }

  nextTick(async () => {
    appStore.toggleTabMenu('pan', 'wangpan')
    await nextTick()

    const { default: usePanTreeStore } = await import('../pan/pantreestore')
    const { default: PanDAL } = await import('../pan/pandal')
    const { default: UserDAL } = await import('../user/userdal')
    const panTreeStore = usePanTreeStore()

    if (panTreeStore.user_id !== result.user_id) {
      if (!await UserDAL.UserChange(result.user_id)) return
    }

    await nextTick()

    appStore.toggleTabMenu('pan', 'wangpan')
    let fileId = result.parent_file_id || result.file_id
    if (result.provider === 'quark') {
      try {
        fileId = await resolveQuarkSearchDirectory({
          fileId: result.file_id, parentFileId: result.parent_file_id, isDir: result.isDir
        }, async () => {
          const { apiQuarkFileDetail } = await import('../quark/dirfilelist')
          const detail = await apiQuarkFileDetail(result.user_id, result.file_id)
          return detail?.pdir_fid == null ? undefined : String(detail.pdir_fid)
        })
      } catch {
        message.error(t('pan.unrecognizedCurrentDir'))
        return
      }
    }
    if (fileId === '/' || !fileId) {
      if (result.provider === 'baidu') fileId = 'baidu_root'
      else if (result.provider === 'cloud123') fileId = 'cloud_root'
      else if (result.provider === '115') fileId = 'drive115_root'
      else if (result.provider === 'quark') fileId = 'quark_root'
      else if (result.provider === 'pikpak') fileId = 'pikpak_root'
      else if (result.provider === 'dropbox') fileId = 'dropbox_root'
      else if (result.provider === 'onedrive') fileId = 'onedrive_root'
      else if (result.provider === 'box') fileId = 'box_root'
    }

    if (!await PanDAL.aReLoadOneDirToShow(result.drive_id, fileId, true)) {
      message.error(t('pan.unrecognizedCurrentDir'))
    }
  })
}

function canAskDocument(result: GlobalSearchResult): boolean {
  return result.source === 'cloud' && isDocumentInsightFile(result)
}

function openDocumentAI(result: GlobalSearchResult, initialPrompt = '') {
  const source = toDocumentInsightSource(result, result.user_id)
  if (!source) return
  openDocumentInsight({ sources: [source], initialPrompt, scopeName: result.providerName })
  appStore.toggleTab('ai-workspace')
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    inputRef.value?.blur()
    return
  }
  const total = allItems.value.length
  if (!total) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % total
    updateSelectedSection()
    scrollToSelected()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + total) % total
    updateSelectedSection()
    scrollToSelected()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (document.activeElement === inputRef.value) {
      if (searchTimer.value) clearTimeout(searchTimer.value)
      doSearch()
      return
    }
    const item = allItems.value[selectedIndex.value]
    if (item) handleClick(item.result)
  }
}

function updateSelectedSection() {
  const item = allItems.value[selectedIndex.value]
  if (item) selectedSection.value = item.section
}

function scrollToSelected() {
  nextTick(() => {
    const el = document.querySelector('.gs-page-result-item.selected')
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

function selectItem(section: 'cloud' | 'ms', gi: number, ii: number) {
  const idx = allItems.value.findIndex(
    (item) => item.section === section && item.groupIndex === gi && item.itemIndex === ii
  )
  if (idx >= 0) {
    selectedIndex.value = idx
    selectedSection.value = section
  }
}

function getExtBadge(ext: string) {
  return ext.split('/')[0].toLowerCase()
}

function mediaKindIcon(kind: string | undefined) {
  if (kind === 'movie' || kind === 'Movie') return Film
  if (kind === 'series' || kind === 'Series') return Tv
  return Monitor
}

function mediaKindLabel(kind: string | undefined) {
  if (kind === 'movie' || kind === 'Movie') return t('search.kindMovie')
  if (kind === 'series' || kind === 'Series') return t('search.kindSeries')
  if (kind === 'season' || kind === 'Season') return t('search.kindSeason')
  if (kind === 'episode' || kind === 'Episode') return t('search.kindEpisode')
  if (kind === 'person' || kind === 'Person') return t('search.kindPerson')
  if (kind === 'folder' || kind === 'Folder') return t('search.kindFolder')
  return kind
}

function handleOpenPanHubSearch(event: Event) {
  const requestedKeyword = (event as CustomEvent<{ keyword?: string }>).detail?.keyword?.trim() || ''
  if (requestedKeyword) sessionStorage.removeItem('boxplayer:pending-panhub-search')
  searchMode.value = 'panhub'
  keyword.value = requestedKeyword
  nextTick(() => phDoSearch())
}

function consumePendingPanHubSearch() {
  const requestedKeyword = sessionStorage.getItem('boxplayer:pending-panhub-search')?.trim() || ''
  if (requestedKeyword) handleOpenPanHubSearch(new CustomEvent('boxplayer:open-panhub-search', { detail: { keyword: requestedKeyword } }))
}

onMounted(() => {
  loadHistory()
  void refreshAcquisitionStates()
  acquisitionStateTimer = setInterval(() => void refreshAcquisitionStates(), 2000)
  window.addEventListener('boxplayer:open-panhub-search', handleOpenPanHubSearch)
  consumePendingPanHubSearch()
  nextTick(() => {
    if (inputRef.value) inputRef.value.focus()
  })
})

onUnmounted(() => {
  searchId.value++
  searchController?.abort()
  if (acquisitionStateTimer) clearInterval(acquisitionStateTimer)
  if (searchTimer.value) clearTimeout(searchTimer.value)
  phController?.abort()
  magnetPreviewController?.abort()
  discardMagnetPreview(magnetPreview.value).catch(() => undefined)
  window.removeEventListener('boxplayer:open-panhub-search', handleOpenPanHubSearch)
})
</script>

<template>
  <div class="gs-page" @keydown="handleKeyDown">
    <div class="gs-page-header">
      <div class="gs-page-tabs">
        <button :class="['gs-page-tab', searchMode === 'local' ? 'active' : '']" @click="searchMode = 'local'">{{ t('search.mine') }}</button>
        <button :class="['gs-page-tab', searchMode === 'panhub' ? 'active' : '']" @click="searchMode = 'panhub'">{{ t('search.aiSearch') }} <span class="gs-pro-badge">Pro</span></button>
      </div>

      <PanHubSearchBox
        v-model="keyword"
        :loading="searchMode === 'local' ? searching : phLoading"
        :searched="searchMode === 'local' ? (searching === false && hasInput) : phSearched"
        :placeholder="searchMode === 'panhub' ? t('search.placeholderPanHub') : t('search.placeholderLocal')"
        @search="onSearchBoxSubmit()"
        @pause="phController?.abort(); phLoading = false"
        @reset="searchMode === 'local' ? (keyword = '') : phReset()"
      />

      <div v-if="showHistoryDrop && searchMode === 'local'" class="gs-history-drop">
        <div class="gs-history-drop-header" @click="historyCollapsed = !historyCollapsed">
          <ChevronRight :size="12" :stroke-width="2.5" class="gs-chevron" :class="{ open: !historyCollapsed }" />
          <Clock :size="14" :stroke-width="1.5" />
          <span>{{ t('search.history') }}</span>
          <button class="gs-history-clear" type="button" @click.stop="clearHistory">{{ t('common.clear') }}</button>
        </div>
        <div v-show="!historyCollapsed" class="gs-history-list">
          <button
            v-for="(item, idx) in history"
            :key="idx"
            class="gs-history-item"
            type="button"
            @click="useHistoryItem(item)"
          >
            <Clock :size="13" :stroke-width="1.5" class="gs-history-item-icon" />
            <span class="gs-history-item-text">{{ item }}</span>
            <button
              class="gs-history-item-del"
              type="button"
              :title="t('common.delete')"
              @click.stop="removeHistoryItem(idx)"
            >
              <X :size="12" :stroke-width="1.5" />
            </button>
          </button>
        </div>
      </div>
    </div>

    <div class="gs-page-body">
      <template v-if="isLocalMode()">
      <div v-if="searching && hasInput" class="gs-page-status">
        <span class="gs-spinner" /> {{ t('search.searching') }}
      </div>
      <div v-else-if="!hasInput && !showHistoryDrop" class="gs-page-empty">
        <Search :size="64" :stroke-width="1" class="gs-page-empty-icon" />
        <div class="gs-page-empty-text">{{ t('search.startHint') }}</div>
        <div class="gs-page-empty-sub">{{ t('search.startSub') }}</div>
      </div>
      <div
        v-else-if="!searching && totalCloud === 0 && totalMs === 0"
        class="gs-page-status"
      >
        {{ t('search.noResults', { keyword }) }}
      </div>

      <div v-if="totalCloud > 0 || totalMs > 0" class="gs-page-results" :class="{ 'gs-split-mode': hasBoth }">

        <!-- Split layout: both cloud + media server -->
        <div v-if="hasBoth" class="gs-split">
          <div class="gs-split-left">
            <div class="gs-section">
              <div class="gs-section-header">
                <Folder :size="16" :stroke-width="1.5" />
                <span>{{ t('search.cloudFiles') }}</span>
                <span class="gs-section-count">{{ totalCloud }}</span>
              </div>
              <div v-for="(group, gi) in cloudGroups" :key="group.key" class="gs-page-group">
                <div class="gs-page-group-title" @click="toggleGroup(group.key)">
                  <ChevronRight :size="12" :stroke-width="2.5" class="gs-chevron" :class="{ open: !collapsedGroups.has(group.key) }" />
                  {{ group.title }} ({{ group.items.length }})
                </div>
                <div v-show="!collapsedGroups.has(group.key)">
                  <div v-for="(item, ii) in group.items" :key="item.id" class="gs-page-result-item gs-cloud-item" :class="{ selected: allItems[selectedIndex]?.section === 'cloud' && allItems[selectedIndex]?.groupIndex === gi && allItems[selectedIndex]?.itemIndex === ii }" @click="handleClick(item)" @mouseenter="selectItem('cloud', gi, ii)">
                    <div class="gs-page-result-icon">
                      <Folder v-if="item.isDir" :size="18" :stroke-width="1.5" />
                      <File v-else :size="18" :stroke-width="1.5" />
                    </div>
                    <div class="gs-page-result-body">
                      <div class="gs-page-result-name">{{ item.name }}</div>
                      <div v-if="item.path" class="gs-page-result-path">{{ item.path }}</div>
                      <div class="gs-page-result-meta">
                        <span v-if="item.ext" class="gs-page-ext">{{ getExtBadge(item.ext) }}</span>
                        <span v-if="item.size > 0">{{ humanSize(item.size) }}</span>
                        <span class="gs-page-source">{{ item.providerName }}</span>
                      </div>
                    </div>
                    <button v-if="canAskDocument(item)" type="button" class="gs-document-ai" title="使用 BoxPlayer AI 问答" @click.stop="openDocumentAI(item)"><Sparkles :size="14" />AI 问答</button>
                    <ArrowUpRight :size="14" :stroke-width="1.5" class="gs-page-result-go" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="gs-split-right">
            <div class="gs-section">
              <div class="gs-section-header">
                <Tv :size="16" :stroke-width="1.5" />
                <span>{{ t('search.mediaServers') }}</span>
                <span class="gs-section-count">{{ totalMs }}</span>
              </div>
              <div v-for="(group, gi) in msGroups" :key="group.key" class="gs-ms-group">
                <div class="gs-page-group-title" @click="toggleGroup(group.key)">
                  <ChevronRight :size="12" :stroke-width="2.5" class="gs-chevron" :class="{ open: !collapsedGroups.has(group.key) }" />
                  {{ group.title }} ({{ group.items.length }})
                </div>
                <div v-show="!collapsedGroups.has(group.key)" class="gs-ms-grid">
                  <div v-for="(item, ii) in group.items" :key="item.id" class="gs-ms-card" :class="{ selected: allItems[selectedIndex]?.section === 'ms' && allItems[selectedIndex]?.groupIndex === gi && allItems[selectedIndex]?.itemIndex === ii }" @click="handleClick(item)" @mouseenter="selectItem('ms', gi, ii)">
                    <div class="gs-ms-poster-wrap">
                      <img v-if="item.poster" :src="item.poster" class="gs-ms-poster" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'" />
                      <div v-else class="gs-ms-poster-fallback">
                        <component :is="mediaKindIcon(item.itemType)" :size="24" :stroke-width="1.3" />
                      </div>
                      <div class="gs-ms-type-badge">{{ mediaKindLabel(item.itemType) }}</div>
                    </div>
                    <div class="gs-ms-title">{{ item.name }}</div>
                    <div class="gs-ms-source">{{ item.providerName }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Single layout: only one type -->
      <template v-else>
          <div v-if="totalCloud > 0" class="gs-section">
            <div class="gs-section-header">
              <Folder :size="18" :stroke-width="1.5" />
              <span>{{ t('search.cloudFiles') }}</span>
              <span class="gs-section-count">{{ totalCloud }}</span>
            </div>
            <div v-for="(group, gi) in cloudGroups" :key="group.key" class="gs-page-group">
              <div class="gs-page-group-title" @click="toggleGroup(group.key)">
                <ChevronRight :size="12" :stroke-width="2.5" class="gs-chevron" :class="{ open: !collapsedGroups.has(group.key) }" />
                {{ group.title }} ({{ group.items.length }})
              </div>
              <div v-show="!collapsedGroups.has(group.key)">
                <div v-for="(item, ii) in group.items" :key="item.id" class="gs-page-result-item gs-cloud-item" :class="{ selected: allItems[selectedIndex]?.section === 'cloud' && allItems[selectedIndex]?.groupIndex === gi && allItems[selectedIndex]?.itemIndex === ii }" @click="handleClick(item)" @mouseenter="selectItem('cloud', gi, ii)">
                  <div class="gs-page-result-icon">
                    <Folder v-if="item.isDir" :size="20" :stroke-width="1.5" />
                    <File v-else :size="20" :stroke-width="1.5" />
                  </div>
                  <div class="gs-page-result-body">
                    <div class="gs-page-result-name">{{ item.name }}</div>
                    <div v-if="item.path" class="gs-page-result-path">{{ item.path }}</div>
                    <div class="gs-page-result-meta">
                      <span v-if="item.ext" class="gs-page-ext">{{ getExtBadge(item.ext) }}</span>
                      <span v-if="item.size > 0">{{ humanSize(item.size) }}</span>
                      <span class="gs-page-source">{{ item.providerName }}</span>
                    </div>
                  </div>
                  <button v-if="canAskDocument(item)" type="button" class="gs-document-ai" title="使用 BoxPlayer AI 问答" @click.stop="openDocumentAI(item)"><Sparkles :size="14" />AI 问答</button>
                  <ArrowUpRight :size="16" :stroke-width="1.5" class="gs-page-result-go" />
                </div>
              </div>
            </div>
          </div>

          <div v-if="totalMs > 0" class="gs-section">
            <div class="gs-section-header">
              <Tv :size="18" :stroke-width="1.5" />
              <span>{{ t('search.mediaServers') }}</span>
              <span class="gs-section-count">{{ totalMs }}</span>
            </div>
            <div v-for="(group, gi) in msGroups" :key="group.key" class="gs-ms-group">
              <div class="gs-page-group-title" @click="toggleGroup(group.key)">
                <ChevronRight :size="12" :stroke-width="2.5" class="gs-chevron" :class="{ open: !collapsedGroups.has(group.key) }" />
                {{ group.title }} ({{ group.items.length }})
              </div>
              <div v-show="!collapsedGroups.has(group.key)" class="gs-ms-grid">
                <div v-for="(item, ii) in group.items" :key="item.id" class="gs-ms-card" :class="{ selected: allItems[selectedIndex]?.section === 'ms' && allItems[selectedIndex]?.groupIndex === gi && allItems[selectedIndex]?.itemIndex === ii }" @click="handleClick(item)" @mouseenter="selectItem('ms', gi, ii)">
                  <div class="gs-ms-poster-wrap">
                    <img v-if="item.poster" :src="item.poster" class="gs-ms-poster" loading="lazy" @error="($event.target as HTMLImageElement).style.display='none'" />
                    <div v-else class="gs-ms-poster-fallback">
                      <component :is="mediaKindIcon(item.itemType)" :size="28" :stroke-width="1.3" />
                    </div>
                    <div class="gs-ms-type-badge">{{ mediaKindLabel(item.itemType) }}</div>
                  </div>
                  <div class="gs-ms-title">{{ item.name }}</div>
                  <div class="gs-ms-source">{{ item.providerName }}</div>
                </div>
              </div>
            </div>
          </div>
          </template>
      </div>
      </template>
      <template v-else-if="isPanHubMode()">
    <div v-if="!phSearched" class="ph-hero-row">
          <header class="ph-hero"><div class="ph-hero-badge">{{ t('search.panHubBadge') }}</div><h1 class="ph-hero-title"><span class="ph-hero-title-line">{{ t('search.panHubTitle1') }}</span><span class="ph-hero-title-line ph-hero-title-accent">{{ t('search.panHubTitle2') }}</span></h1><p class="ph-hero-desc">{{ t('search.panHubDesc') }}</p><ul class="ph-hero-features"><li class="ph-hero-feature">{{ t('search.featureAggregate') }}</li><li class="ph-hero-feature">{{ t('search.featureAgent') }}</li><li class="ph-hero-feature">{{ t('search.featureFollow') }}</li><li class="ph-hero-feature">{{ t('search.featureMissing') }}</li></ul></header>
<aside class="ph-hero-aside"><PanHubHotSearches :api-base="PANHUB_API_BASE" @select="phHotSelect" /></aside>
        </div>
        <div v-if="phError" class="ph-error"><span class="ph-error-icon">⚠️</span>{{ phError }}</div>
        <div v-if="phSearched && !phLoading" class="ph-stats-bar">
          <div class="ph-stats-main"><span class="ph-stat-item"><span class="ph-stat-label">{{ t('search.results') }}</span><span class="ph-stat-value">{{ phTotal }}</span></span><span class="ph-stat-item"><span class="ph-stat-label">{{ t('search.elapsed') }}</span><span class="ph-stat-value">{{ phFmt(phElapsedMs) }}</span></span></div>
          <div v-if="phTotal>0" class="ph-stats-filters"><button :class="['ph-filter-pill',{active:phFilterPlatform==='all'}]" type="button" @click="phFilterPlatform='all'">{{ t('search.all') }} ({{phTotal}})</button><button v-for="p in phPlatforms" :key="p.key" :class="['ph-filter-pill',{active:phFilterPlatform===p.key}]" type="button" @click="phFilterPlatform=phFilterPlatform===p.key?'all':p.key">{{p.name}}({{p.count}})</button></div>
          <div v-if="phTotal>0" class="ph-stats-sort"><select v-model="phSortType" class="ph-sort-select"><option value="default">{{ t('search.defaultSort') }}</option><option value="date-desc">{{ t('search.latest') }}</option><option value="date-asc">{{ t('search.oldest') }}</option><option value="name-asc">{{ t('search.nameAsc') }}</option><option value="name-desc">{{ t('search.nameDesc') }}</option></select></div>

        </div>
        <div v-if="phLoading" class="ph-status-msg"><span class="gs-spinner" /> {{ t('search.searchingPanHub') }}</div>
        <PanHubMediaResults v-if="phSearched" :keyword="keyword" :items="phTmdbItems" :loading="phTmdbLoading" :error="phTmdbError" :states="acquisitionStates" @acquire="phAcquire" />
        <section v-if="phHasResults" class="ph-results-section"><div class="ph-results-grid"><PanHubResultGroup :merged="phMerged" :platform-info="PH_PLATFORM_INFO" :filter-platform="phFilterPlatform" :sort-type="phSortType" @copy="phCopy" @magnet="phConfirmMagnetDownload" /></div></section>
        <section v-else-if="phSearched&&!phLoading&&!phHasResults" class="ph-empty-section"><div class="ph-empty-card"><div class="ph-empty-icon">🔍</div><h3>{{ t('search.noPanHubTitle') }}</h3><p>{{ t('search.noPanHubDesc') }}</p></div></section>
      <section v-if="!phSearched" class="ph-douban-section">
        <PanHubTrending :api-base="PANHUB_API_BASE" :states="acquisitionStates" @select="phHotSelect" @acquire="phAcquire" />
      </section>
      </template>
      <TorrentFileSelector
        :visible="magnetSelectorVisible"
        :initial-files="magnetSelectorFiles"
        :external-loading="magnetSelectorLoading"
        :apply-to-task="false"
        @update:visible="(visible) => { if (!visible) phCancelMagnetSelection() }"
        @confirm-selection="phCreateSelectedMagnet"
        @direct-confirm="phCreateMagnetDirect"
      />
      <MediaAcquisitionTargetModal v-if="acquisitionRequest" :visible="acquisitionVisible" :request="acquisitionRequest" :states="acquisitionStates" @created="onAcquisitionCreated" @update:visible="onAcquisitionVisibleChange" />
    </div>
  </div>
</template>

<style scoped>
.gs-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-2);
  background: var(--color-bg-1);
  overflow: hidden;
}

.gs-page-header {
  padding: 24px 48px 12px;
  flex-shrink: 0;
}
.gs-page-tabs {
  display: flex;
  gap: 0;
  max-width: 320px;
  margin: 0 auto 16px;
  padding: 3px;
  background: var(--color-fill-2);
  border-radius: 10px;
}
.gs-page-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  padding: 7px 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  line-height: 22px;
}

.gs-pro-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 15px;
  padding: 0 5px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f59e0b, #f97316);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.28);
}
.gs-page-tab:hover:not(.active) {
  color: var(--color-text-2);
}
.gs-page-tab.active {
  background: var(--color-bg-2);
  color: var(--color-text-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.gs-page-tab:hover {
  border-color: var(--color-text-4);
}
.gs-page-tab.active {
  background: var(--color-bg-2);
  color: var(--color-text-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.gs-page-search {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 20px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: 10px;
  transition: border-color 0.2s;
}

.gs-page-search:focus-within {
  border-color: rgb(var(--primary-6));
  box-shadow: 0 0 0 2px rgba(var(--primary-6), 0.12);
}

.gs-page-search-icon {
  flex-shrink: 0;
  color: var(--color-text-3);
}

.gs-page-input {
  flex: 1;
  padding: 0;
  color: var(--color-text-1);
  font-size: 20px;
  font-weight: 400;
  line-height: 28px;
  background: transparent;
  border: 0;
  outline: none;
}

.gs-page-input::placeholder {
  color: var(--color-text-4);
}

.gs-page-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--color-text-3);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.gs-page-clear:hover {
  background: var(--color-fill-2);
  color: var(--color-text-2);
}

.gs-page-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-4);
  text-align: center;
}

.gs-page-body {
  flex: 1;
  overflow-y: auto;
}

.gs-page-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.gs-page-empty-icon {
  color: var(--color-text-4);
  opacity: 0.3;
  margin-bottom: 16px;
}

.gs-page-empty-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text-3);
  margin-bottom: 6px;
}

.gs-page-empty-sub {
  font-size: 13px;
  color: var(--color-text-4);
}

.gs-page-status {
  padding: 40px 20px;
  font-size: 14px;
  text-align: center;
  color: var(--color-text-3);
}

.gs-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-2);
  border-top-color: rgb(var(--primary-6));
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 6px;
  animation: gs-spin 0.6s linear infinite;
}

@keyframes gs-spin {
  to { transform: rotate(360deg); }
}

.gs-page-results {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px 48px 32px;
}

.gs-page-results.gs-split-mode {
  max-width: none;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

/* Split layout */
.gs-split {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.gs-split-left,
.gs-split-right {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px 32px;
}

.gs-split-left {
  border-right: 1px solid var(--color-border-2);
}

.gs-split-right .gs-ms-grid {
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.gs-split-right .gs-ms-card {
  border-radius: 6px;
}

.gs-split-right .gs-ms-poster-wrap {
  border-radius: 4px;
}

.gs-split-right .gs-ms-title {
  font-size: 12px;
}

.gs-split-right .gs-ms-source {
  font-size: 10px;
}

.gs-section {
  margin-bottom: 32px;
}

.gs-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-1);
  border-bottom: 2px solid var(--color-border-2);
  margin-bottom: 12px;
}

.gs-section-count {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-4);
}

/* Cloud drive items */
.gs-page-group {
  margin-bottom: 20px;
}

.gs-page-group-title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-3);
  border-bottom: 1px solid var(--color-border-2);
  margin-bottom: 4px;
  cursor: pointer;
  user-select: none;
}

.gs-page-group-title:hover {
  color: var(--color-text-2);
}

.gs-chevron {
  flex-shrink: 0;
  color: var(--color-text-4);
  transition: transform 0.15s;
}

.gs-chevron.open {
  transform: rotate(90deg);
}

.gs-page-result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.1s;
}

.gs-page-result-item:hover,
.gs-page-result-item.selected {
  background: var(--color-fill-2);
}

.gs-page-result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  color: var(--color-text-3);
}

.gs-page-result-body {
  flex: 1;
  min-width: 0;
}

.gs-page-result-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 22px;
}

.gs-page-result-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-text-3);
}

.gs-page-result-path {
  font-size: 12px;
  color: var(--color-text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
  margin-top: 1px;
}

.gs-page-ext {
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  color: var(--color-text-2);
  background: var(--color-fill-2);
  border-radius: 3px;
  text-transform: uppercase;
}

.gs-page-source {
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.08);
  border-radius: 3px;
}

.gs-page-result-go {
  flex-shrink: 0;
  color: var(--color-text-4);
  opacity: 0;
  transition: opacity 0.15s;
}

.gs-document-ai { display:inline-flex; flex:0 0 auto; align-items:center; gap:4px; margin-left:auto; padding:5px 8px; border:1px solid rgba(120,98,232,.35); border-radius:7px; color:#705ce2; background:transparent; cursor:pointer; font:inherit; font-size:11px; font-weight:650; }.gs-document-ai:hover { border-color:#8067ed; background:rgba(120,98,232,.1); }

.gs-page-result-item:hover .gs-page-result-go {
  opacity: 1;
}

/* Media server cards */
.gs-ms-group {
  margin-bottom: 20px;
}

.gs-ms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
  margin-top: 4px;
}

.gs-ms-card {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  transition: background 0.15s, transform 0.15s;
}

.gs-ms-card:hover,
.gs-ms-card.selected {
  background: var(--color-fill-2);
}

.gs-ms-card:hover {
  transform: translateY(-2px);
}

.gs-ms-poster-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-fill-2);
}

.gs-ms-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gs-ms-poster-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--color-text-4);
  background: var(--color-fill-2);
}

.gs-ms-type-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 3px;
  backdrop-filter: blur(4px);
}

.gs-ms-title {
  padding: 6px 2px 1px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
}

.gs-ms-source {
  padding: 0 2px 4px;
  font-size: 11px;
  color: var(--color-text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Search history drop */
.gs-history-drop {
  max-width: 720px;
  margin: 8px auto 0;
  padding: 4px 0;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
}

.gs-history-drop-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  padding: 8px 12px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-3);
  cursor: pointer;
}

.gs-history-clear {
  margin-left: auto;
  padding: 1px 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-4);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.gs-history-clear:hover {
  color: rgb(var(--danger-6));
  background: var(--color-fill-2);
}

.gs-history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px 8px;
}

.gs-history-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  text-align: left;
  color: var(--color-text-2);
  font-size: 13px;
  background: var(--color-fill-2);
  border: 0;
  border-radius: 16px;
  cursor: pointer;
  transition: background 0.1s;
}

.gs-history-item:hover {
  background: var(--color-fill-3);
}

.gs-history-item-icon {
  flex-shrink: 0;
  color: var(--color-text-4);
}

.gs-history-item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.gs-history-item-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  flex-shrink: 0;
  color: var(--color-text-4);
  background: transparent;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, color 0.1s;
}

.gs-history-item:hover .gs-history-item-del {
  opacity: 1;
}

.gs-history-item-del:hover {
  color: rgb(var(--danger-6));
  background: var(--color-fill-2);
}

/* PanHub */
.ph-hero-row{display:flex;align-items:stretch;gap:0;position:relative;background:linear-gradient(145deg,rgba(var(--primary-6),.12) 0%,rgba(var(--primary-6),.04) 35%,rgba(var(--warning-6),.06) 70%,rgba(var(--primary-6),.08) 100%);border-radius:20px;box-shadow:0 4px 20px -4px rgba(var(--primary-6),.15);overflow:hidden;margin:0 48px}
.ph-hero{flex:1;min-width:0;padding:24px 28px;text-align:left;position:relative;z-index:1}
.ph-hero-badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgb(var(--primary-6));margin-bottom:10px;padding:6px 12px;background:rgba(var(--primary-6),.12);border:1px solid rgba(var(--primary-6),.25);border-radius:8px}
.ph-hero-title{font-size:36px;font-weight:800;margin:0 0 10px;color:var(--color-text-1);letter-spacing:-.04em;line-height:1.1;max-width:560px}
.ph-hero-title-line{display:block}
.ph-hero-title-accent{color:rgb(var(--primary-6))}
.ph-hero-desc{font-size:14px;color:var(--color-text-3);margin:0 0 16px;line-height:1.65;max-width:520px}
.ph-hero-features{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:12px 20px}
.ph-hero-feature{font-size:12px;font-weight:700;color:rgb(var(--primary-6));padding:6px 12px;background:var(--color-fill-1);border:1px solid rgba(var(--primary-6),.2);border-radius:10px;transition:transform .2s,box-shadow .2s}
.ph-hero-feature:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(var(--primary-6),.15)}

.ph-hero-aside{flex-shrink:0;width:340px}
.ph-hero-aside :deep(.ph-hot){background:transparent;border:none;box-shadow:none}
.ph-stats-bar{margin:0 48px;background:var(--color-bg-2);border:1px solid var(--color-border-2);border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
.ph-stats-main{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ph-stat-item{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--color-fill-1);border-radius:8px;border:1px solid var(--color-border-2)}
.ph-stat-label{font-size:13px;color:var(--color-text-4);font-weight:500}
.ph-stat-value{font-size:18px;font-weight:700;color:rgb(var(--primary-6))}
.ph-stats-filters{display:flex;gap:8px;flex-wrap:wrap}
.ph-stats-sort{display:flex;align-items:center}
.ph-filter-pill{padding:6px 14px;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:999px;font-size:13px;font-weight:500;color:var(--color-text-3);cursor:pointer;transition:all .15s;white-space:nowrap}
.ph-filter-pill:hover{background:var(--color-bg-2);border-color:var(--color-border-2)}
.ph-filter-pill.active{background:rgb(var(--primary-6));color:#fff;border-color:transparent}
.ph-sort-select{padding:8px 14px;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:8px;font-size:13px;font-weight:500;color:var(--color-text-2);cursor:pointer;outline:none;min-width:140px}
.ph-sort-select:focus{border-color:rgb(var(--primary-6));box-shadow:0 0 0 3px rgba(var(--primary-6),.12)}
.ph-status-msg{display:flex;align-items:center;justify-content:center;gap:10px;padding:60px 48px;font-size:14px;color:var(--color-text-3)}
.ph-error{display:flex;align-items:center;gap:8px;margin:12px 48px 0;padding:12px 16px;background:rgba(var(--danger-6),.1);border:1px solid rgba(var(--danger-6),.3);border-radius:8px;color:rgb(var(--danger-6));font-weight:500;font-size:13px}
.ph-error-icon{font-size:16px}
.ph-results-section{padding:0 48px 32px}
.ph-results-grid{display:grid;grid-template-columns:1fr;gap:16px}
.ph-empty-section{display:flex;justify-content:center;padding:48px 24px}
.ph-empty-card{background:var(--color-bg-2);border:1px solid var(--color-border-2);border-radius:16px;padding:32px;text-align:center;max-width:400px}
.ph-empty-icon{font-size:48px;margin-bottom:16px;opacity:.6}
.ph-empty-card h3{margin:0 0 8px;font-size:20px;color:var(--color-text-1)}
.ph-empty-card p{margin:0;font-size:14px;color:var(--color-text-3);line-height:1.6}
.ph-douban-section{padding:0 48px 32px}

@media (max-width: 720px) {
  .gs-page-header {
    padding: 20px 16px 12px;
  }

  .gs-page-results {
    padding: 12px 16px 24px;
  }

  .gs-ms-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
  }
  .ph-hero-row { flex-direction: column; margin: 0 16px; }
  .ph-hero-aside { width: 100%; }
  .ph-stats-bar { margin: 0 16px; padding: 12px 14px; }
  .ph-results-section { padding: 0 16px 24px; }
  .ph-douban-section { padding: 0 16px 24px; }
  .ph-status-msg { padding: 40px 16px; }
  .ph-error { margin: 12px 16px 0; }
}
</style>

<style>
/* ===== Mineradio dark-theme alignment for Global Search ===== */
body[arco-theme='dark'] .gs-page {
  color: var(--app-mineradio-ink);
  background: transparent;
}

body[arco-theme='dark'] .gs-page-tabs {
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 14px;
  backdrop-filter: blur(18px) saturate(1.2);
}

body[arco-theme='dark'] .gs-page-tab {
  color: rgba(255,255,255,.60);
  border-radius: 10px;
  background: transparent;
}

body[arco-theme='dark'] .gs-page-tab:hover:not(.active) {
  color: rgba(255,255,255,.82);
}

body[arco-theme='dark'] .gs-page-tab.active {
  color: #fff;
  background: rgba(255,255,255,.085);
  box-shadow: inset 0 0 0 1px rgba(0,245,212,.22), 0 10px 28px rgba(0,245,212,.055);
}

body[arco-theme='dark'] .gs-page-search {
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 16px;
  backdrop-filter: blur(18px) saturate(1.2);
}

body[arco-theme='dark'] .gs-page-search:focus-within {
  border-color: rgba(0,245,212,.22);
  box-shadow: 0 0 0 3px rgba(0,245,212,.08);
}

body[arco-theme='dark'] .gs-page-input {
  color: #fff;
}

body[arco-theme='dark'] .gs-page-input::placeholder {
  color: rgba(255,255,255,.36);
}

body[arco-theme='dark'] .gs-page-search-icon,
body[arco-theme='dark'] .gs-page-clear {
  color: rgba(255,255,255,.42);
}

body[arco-theme='dark'] .gs-page-clear:hover {
  background: rgba(255,255,255,.08);
  color: #fff;
}

body[arco-theme='dark'] .gs-page-empty-icon {
  color: rgba(255,255,255,.25);
}

body[arco-theme='dark'] .gs-page-empty-text {
  color: rgba(255,255,255,.72);
}

body[arco-theme='dark'] .gs-page-empty-sub {
  color: rgba(255,255,255,.40);
}

body[arco-theme='dark'] .gs-page-status {
  color: rgba(255,255,255,.55);
}

body[arco-theme='dark'] .gs-spinner {
  border-color: rgba(255,255,255,.15);
  border-top-color: var(--app-mineradio-accent);
}

body[arco-theme='dark'] .gs-section-header {
  color: rgba(255,255,255,.92);
  border-bottom-color: rgba(255,255,255,.07);
}

body[arco-theme='dark'] .gs-section-count {
  color: var(--app-mineradio-accent);
}

body[arco-theme='dark'] .gs-page-group-title {
  color: rgba(255,255,255,.60);
  border-bottom-color: rgba(255,255,255,.06);
}

body[arco-theme='dark'] .gs-page-group-title:hover {
  color: rgba(255,255,255,.85);
}

body[arco-theme='dark'] .gs-page-result-item {
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  transition: background .15s, border-color .15s;
}

body[arco-theme='dark'] .gs-page-result-item:hover,
body[arco-theme='dark'] .gs-page-result-item.selected {
  background: rgba(255,255,255,.075);
  border-color: rgba(244,210,138,.18);
  box-shadow: 0 10px 28px rgba(0,0,0,.18);
}

body[arco-theme='dark'] .gs-page-result-name {
  color: rgba(255,255,255,.92);
}

body[arco-theme='dark'] .gs-page-result-meta,
body[arco-theme='dark'] .gs-page-result-path {
  color: rgba(255,255,255,.42);
}

body[arco-theme='dark'] .gs-page-ext {
  color: rgba(255,255,255,.72);
  background: rgba(255,255,255,.06);
}

body[arco-theme='dark'] .gs-page-source {
  color: var(--app-mineradio-accent);
  background: rgba(0,245,212,.10);
}

body[arco-theme='dark'] .gs-page-result-go {
  color: rgba(255,255,255,.42);
}

body[arco-theme='dark'] .gs-ms-card {
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 14px;
  background: rgba(255,255,255,.042);
  transition: background .15s, transform .15s, border-color .15s, box-shadow .15s;
}

body[arco-theme='dark'] .gs-ms-card:hover {
  transform: translateY(-2px);
  background: rgba(255,255,255,.068);
  border-color: rgba(0,245,212,.20);
  box-shadow: 0 14px 38px rgba(0,0,0,.26);
}

body[arco-theme='dark'] .gs-ms-poster-wrap {
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.06);
}

body[arco-theme='dark'] .gs-ms-poster-fallback {
  color: rgba(255,255,255,.30);
  background: rgba(255,255,255,.04);
}

body[arco-theme='dark'] .gs-ms-type-badge {
  background: rgba(0,0,0,.65);
  backdrop-filter: blur(4px);
}

body[arco-theme='dark'] .gs-ms-title {
  color: rgba(255,255,255,.90);
}

body[arco-theme='dark'] .gs-ms-source {
  color: rgba(255,255,255,.40);
}

body[arco-theme='dark'] .gs-split-left {
  border-right-color: rgba(255,255,255,.07);
}

body[arco-theme='dark'] .gs-history-drop {
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.075);
  border-radius: 14px;
  backdrop-filter: blur(18px) saturate(1.2);
}

body[arco-theme='dark'] .gs-history-drop-header {
  color: rgba(255,255,255,.60);
}

body[arco-theme='dark'] .gs-history-item {
  color: rgba(255,255,255,.72);
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.06);
}

body[arco-theme='dark'] .gs-history-item:hover {
  background: rgba(255,255,255,.085);
}

body[arco-theme='dark'] .gs-history-item-icon {
  color: rgba(255,255,255,.40);
}

body[arco-theme='dark'] .gs-history-item-del:hover {
  color: #ff8f9d;
  background: rgba(255,143,157,.12);
}

body[arco-theme='dark'] .gs-chevron {
  color: rgba(255,255,255,.40);
}

body[arco-theme='dark'] .gs-pro-badge {
  box-shadow: 0 2px 8px rgba(245,158,11,.32);
}

body[arco-theme='dark'] .ph-results-section {
  padding-top: 18px;
}

body[arco-theme='dark'] .ph-stats-bar {
  background: rgba(255,255,255,.045);
  border-color: rgba(255,255,255,.085);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
}

body[arco-theme='dark'] .ph-stat-item,
body[arco-theme='dark'] .ph-filter-pill,
body[arco-theme='dark'] .ph-sort-select {
  background: rgba(255,255,255,.055);
  border-color: rgba(255,255,255,.075);
}

body[arco-theme='dark'] .ph-filter-pill.active {
  background: rgba(105,121,255,.92);
  border-color: rgba(158,169,255,.45);
}
</style>
