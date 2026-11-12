<script setup lang="ts">
import { computed,ref } from 'vue'
import { BookOpen, Music, Play, Library, Heart, Music2, Clock3, Film, Tv, ChevronDown,CalendarDays,EyeOff,History,Star,Drama,GalleryVerticalEnd,Folder,List,TvMinimal } from 'lucide-vue-next'
import type {BrowseRoute} from '@/features/servers/workspace'
import FilesSidebar from './FilesSidebar.vue'
import type { FileSidebarEntry } from './sidebar'
import { useI18n, type MessageKey } from '@/lib/i18n'
import {useLibraryNavigation} from '@/stores/libraryNavigation'
import useHome from '@/stores/unifiedHomePreferences'
import {visibleHomeItems,withFixedHomeMenus} from '@/features/library/unifiedHomeManagement'
import {libraryHomeId,categoryRouteForHomeId} from '@/features/library/categoryPlacement'
import {libraryTitle} from '@/features/library/navigation'
import {librarySidebarCategoryIcon,libraryCategoryIcon} from '@/features/library/electron/libraryCategoryIcon'
import {videoLibraryRoutes} from '@/features/library/navigation'
const props=defineProps<{ entries: FileSidebarEntry[]; collapsed: boolean; selectedKey: MessageKey; selectedSourceId?: string; selectedRoute?:string }>()
const emit = defineEmits<{ select: [key: MessageKey]; selectSource: [entry: FileSidebarEntry]; catalog:[route:string,origin?:'home'|'library'];server:[id:string,route:BrowseRoute] }>()
const { t } = useI18n()
const home=useHome()
const navigation=useLibraryNavigation()
const homeMenus=computed(()=>visibleHomeItems(withFixedHomeMenus([{id:'sources',title:t('favorites'),sourceId:'local',available:true},...navigation.items]),home.$state).map(item=>({route:item.id==='sources'?'favorites':categoryRouteForHomeId(item.id),id:item.id,title:home.titles[item.id]||item.title})))
function homeIcon(id:string){if(id==='recent'||id.includes(':recent')||id.includes(':next'))return History;if(id==='local:daily')return CalendarDays;if(id==='local:unwatched')return EyeOff;if(['local:top-rated','sources','local:favorites'].includes(id))return Star;if(id==='local:genres')return Drama;if(['local:movies','local:animation','local:documentary'].includes(id))return Film;if(id==='local:tv')return TvMinimal;if(id==='local:unmatched')return Play;if(id==='local:playlist')return List;if(id.startsWith('custom-series'))return GalleryVerticalEnd;return Folder}
const serverMenus=computed(()=>navigation.serverMenus.filter(item=>props.entries.some(entry=>entry.sourceId===item.accountId)))
const expanded = ref<Record<string, boolean>>({ home: true, library: true })
const groups = [
  { key: 'home', icon: Play, children: [] },
  { key: 'library', icon: Library, children: [] }
] as const

function homeNavigationIcon(id: string) {
  if (id === 'recent' || id.includes(':recent') || id.includes(':next')) return History
  if (id === 'local:daily') return CalendarDays
  if (id === 'local:unwatched') return EyeOff
  if (id === 'local:top-rated' || id === 'sources' || id === 'local:favorites') return Star
  if (id === 'local:genres') return Drama
  if (id === 'local:movies' || id === 'local:animation' || id === 'local:documentary') return Film
  if (id === 'local:tv') return TvMinimal
  if (id === 'local:unmatched') return Play
  if (id === 'local:playlist') return List
  if (id.startsWith('custom-series')) return GalleryVerticalEnd
  if (id === 'music') return Music
  if (id === 'books') return BookOpen
  return Folder
}

const section=computed<string>(()=>props.selectedKey==='home'&&(!props.selectedRoute||props.selectedRoute==='home')?'home':props.selectedKey==='files'?'files':'collection')
const selectedHomeRowKey=computed(()=>'catalog:'+props.selectedRoute)
const isCatalogPage=computed(()=>props.selectedKey==='library')
const isLibrarySettingsPage=computed(()=>props.selectedKey==='library'&&(!props.selectedRoute||props.selectedRoute==='library'))
const visibleHomeMenu=computed(()=>[...homeMenus.value.map(item=>({...item,action:()=>emit('catalog',item.route,'home')})),...serverMenus.value.map(item=>({...item,action:()=>emit('server',item.accountId,item.route)}))])
const librarySidebarCards=computed(()=>videoLibraryRoutes.map(([key,title])=>({key:key as string,title:home.titles[libraryHomeId(key)]||title,icon:librarySidebarCategoryIcon(key),action:()=>emit('catalog',key,'library')})))
function showHome(){emit('select','home')}
function showHomeRow(_id:string){emit('select','library')}
function openHomeMenu(id:string){visibleHomeMenu.value.find(item=>item.id===id)?.action()}
function isHomeMenuSelected(id:string){return props.selectedKey==='home'&&props.selectedRoute===(id==='sources'?'favorites':categoryRouteForHomeId(id))}

import {t as electronT} from '@/features/files/electron/i18n'
</script>
<template><nav class="electron-library-sidebar" :class="{collapsed}" :aria-label="t('library')"><section data-sidebar-root="home">      <div class="group-header"><button class="group-heading" :class="{ selected: section === 'home' }" @click="showHome"><Play :size="20" /><span>{{ electronT('unified.home') }}</span></button><button class="group-toggle" :aria-expanded="expanded.home" :aria-label="electronT('unified.expandGroup', { name: electronT('unified.home') })" @click="expanded.home = !expanded.home"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.home" class="nav-children">
        <button v-for="item in visibleHomeMenu" :key="item.id" :class="{ selected: isHomeMenuSelected(item.id) }" @click="openHomeMenu(item.id)"><component :is="homeNavigationIcon(item.id)" :size="18" /><span :title="item.title">{{ item.title }}</span></button>
      </div>
</section><section data-sidebar-root="library">      <div class="group-header"><button class="group-heading" :class="{ selected: isLibrarySettingsPage }" @click="showHomeRow('library-index')"><Library :size="20" /><span>{{ electronT('media.library') }}</span></button><button class="group-toggle" :aria-expanded="expanded.library" :aria-label="electronT('unified.expandGroup', { name: electronT('media.library') })" @click="expanded.library = !expanded.library"><ChevronDown :size="14" /></button></div>
      <div v-show="expanded.library" class="nav-children">
        <button v-for="item in librarySidebarCards" :key="item.key" :class="{ selected: selectedHomeRowKey === 'catalog:' + item.key && isCatalogPage || item.key === 'music' && section === 'music' || item.key === 'books' && section === 'book' }" :data-testid="item.key === 'music' ? 'unified-nav-music' : item.key === 'books' ? 'unified-nav-book' : undefined" @click="item.action()"><component :is="item.icon" :size="18" /><span>{{ item.title }}</span></button>

      </div>
</section><FilesSidebar :entries="entries" :collapsed="collapsed" :selected-id="selectedSourceId ?? (selectedKey === 'files' ? 'files' : null)" @select-files="emit('select', 'files')" @select-source="emit('selectSource', $event)" /></nav></template>
<style scoped>
.source-reorder-hint{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--color-text-3);font-size:13px}
.source-reorder-hint button{background:transparent;border:0;color:#ff8700;font:inherit;cursor:pointer;padding:8px 12px}
.file-source-handle{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:grab;touch-action:none}
.file-source-handle:active,.is-reordering .file-source-card:active{cursor:grabbing}
.is-reordering:not(.file-source-list) .file-source-card{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%}
.is-reordering:not(.file-source-list) .file-source-card:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%;-webkit-user-drag:element;user-select:none}
.favorite-page-wrap.is-reordering .favorite-shortcut:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut:active{cursor:grabbing}
.file-source-card.source-dragging{position:relative;z-index:10;opacity:1;animation:none!important;transition:none!important;pointer-events:none;cursor:grabbing;background:var(--color-bg-1);box-shadow:0 12px 32px #0006;border-radius:10px}
.file-source-list .file-source-card{transition:transform .16s ease;user-select:none}
.file-source-card.source-drop-target .file-source-art{outline:2px solid #ff8700;outline-offset:3px}
@keyframes source-card-wiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
@media(prefers-reduced-motion:reduce){.is-reordering:not(.file-source-list) .file-source-card,.favorite-page-wrap.is-reordering .favorite-shortcut{animation:none;outline:1px dashed #ff8700;outline-offset:4px}}
.favorite-page-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,220px));gap:30px 24px}
.favorite-page-grid .favorite-shortcut{width:100%}
.source-shortcuts .row-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.source-shortcuts .row-heading h2{margin:0}
.source-shortcuts .row-heading button{border:0;background:transparent;color:#ff8000;cursor:pointer}
.unified-loading-state{display:flex;align-items:center;justify-content:center;min-height:56vh}
.unified-toolbar .round-button{padding:0;box-sizing:border-box;overflow:hidden;place-items:center}
.unified-library{display:flex;height:100%;min-height:0;background:var(--color-bg-1);color:var(--color-text-1)}
:global(#xbybody .unified-library .music-pane), :global(#xbybody .unified-library .music-pane .unified-toolbar){background:#000!important}
.unified-sidebar{display:flex;flex-direction:column;min-height:0;overflow:hidden!important}
.sidebar-navigation{flex:1;min-height:0;overflow-y:auto}
.sidebar-footer{flex-shrink:0;padding-top:12px}
.sidebar-footer-toggle{margin-bottom:24px;transform:rotate(90deg);color:var(--color-text-3)!important}
.unified-sidebar.collapsed{width:76px!important;padding:16px 10px}
.collapsed .nav-children,.collapsed .group-toggle,.collapsed .group-heading span,.collapsed .sidebar-search input{display:none!important}
.collapsed .group-header{justify-content:center;margin-top:20px}
.collapsed .group-heading{justify-content:center!important;padding:10px!important}
.collapsed .sidebar-search{justify-content:center;padding:10px;cursor:text}
.unified-sidebar{width:258px;flex-shrink:0;padding:18px 12px;overflow-y:auto;border-right:1px solid var(--color-border-2);background:var(--color-bg-2)}
.sidebar-search{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--color-border-2);border-radius:20px;margin-bottom:18px;color:var(--color-text-3)}
.sidebar-search input{width:100%;min-width:0;border:0;outline:none;background:transparent;color:var(--color-text-1)}
button{font:inherit;color:inherit;cursor:pointer}
.group-heading,.nav-children button{display:flex;align-items:center;gap:12px;border:0;background:transparent;width:100%;border-radius:9px;text-align:left;min-height:39px;padding:8px 12px}
.group-heading{font-weight:600;margin:12px 0 4px}.group-heading span{flex:1}.group-header{display:flex;align-items:center}.group-header .group-heading{flex:1}.group-toggle{background:transparent;border:0;border-radius:50%;padding:8px}.unified-sidebar svg{color:#ff8b25;flex-shrink:0}.nav-children{padding-left:14px}.nav-children span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unified-sidebar button:hover,.unified-sidebar .selected{background:var(--color-fill-3)}
.library-scan-status{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:10px 20px;border-bottom:1px solid var(--color-border-2);background:var(--color-bg-2);color:var(--color-text-1);font-size:13px}.library-scan-status>svg{color:#ff8800}.library-scan-count{color:var(--color-text-3)}
.unified-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}.unified-toolbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--color-border-2)}
.unified-toolbar h1{font-size:15px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unified-toolbar{gap:12px}.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}.round-button:disabled{cursor:wait;opacity:.6}.add-source{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:10px 16px;background:#ff8b25;color:#fff}button:focus-visible{outline:2px solid #ff8b25;outline-offset:2px}
.unified-home{flex:1;overflow-y:auto;padding:24px 28px}.home-row{margin-bottom:26px}h2{font-size:19px;font-weight:600;margin:0 0 14px}
:global(body #xbybody .unified-library .music-pane > .unified-toolbar) { background:#fafbfc!important; color:#20242c; border-bottom-color:#e9ecf0; }
:global(body[arco-theme='dark'] #xbybody .unified-library .music-pane > .unified-toolbar) { background:#181c1f!important; color:#edf0f2; border-bottom-color:#292e33; }
:global(body[arco-theme='dark'] #xbybody .unified-library .unified-home:not(.category-collection)){background:#1e1e1e!important}
:global(body[arco-theme='dark'] .search-pane){background:#1e1e1e}.search-pane .unified-toolbar{border-bottom:0}.search-pane .sidebar-search-results{padding-top:0}
.sidebar-search-results{height:100%;min-height:0}.search-result-group{margin:0 12px 32px}.search-result-group>h2{font-size:22px;margin:0 0 14px}.search-scopes{max-width:60%;overflow-x:auto;white-space:nowrap}.search-clear{padding:0!important;min-width:20px}.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(8,minmax(0,1fr));gap:22px 20px}@media(max-width:1400px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(6,minmax(0,1fr))}}@media(max-width:1050px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(4,minmax(0,1fr))}}
.collection-empty-folder{border:1px solid var(--color-border-1);border-radius:24px;background:#000;min-height:100%}
.sort-option{display:block;width:100%;text-align:left;padding:10px;border:0;background:transparent;color:var(--color-text-1)}.sort-option:hover{background:var(--color-fill-3)}
.unified-toolbar{position:relative}.source-scope{position:absolute;left:50%;transform:translateX(-50%);display:flex;padding:3px;border:1px solid var(--color-border-2);border-radius:22px;background:var(--color-fill-1)}.source-scope button{border:0;background:transparent;border-radius:18px;padding:5px 18px;font-size:13px;color:var(--color-text-3)}.source-scope button.active{background:var(--color-fill-4);color:var(--color-text-1)}.category-collection{padding:16px}.ranking-empty{padding:80px 24px;text-align:center;color:var(--color-text-3)}.more-button{display:flex;align-items:center;justify-content:center;gap:2px;width:48px;border-radius:22px}
.horizontal-row{display:flex;align-items:flex-start;gap:24px;overflow-x:auto;padding:3px 0 10px;scrollbar-width:none}
.horizontal-row::-webkit-scrollbar{display:none}
.favorite-shortcut{padding:0;border:0;background:transparent;color:var(--color-text-1);width:172px;flex-shrink:0;text-align:left;cursor:pointer}
.favorite-shortcut-art{aspect-ratio:1.8;height:auto;border-radius:10% / 18%;display:flex;align-items:center;justify-content:center;color:#ffffffb8;background:linear-gradient(90deg,#ff5b00,#ff9600)}
.favorite-shortcut-art :deep(svg),.favorite-shortcut-art :deep(.media-server-provider-icon){width:48px!important;height:48px!important}
.favorite-shortcut-art{position:relative;overflow:hidden}.favorite-shortcut-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.favorite-movies .favorite-shortcut-art{background:linear-gradient(90deg,#0075ff,#17c9e8)}
.favorite-tv .favorite-shortcut-art{background:linear-gradient(90deg,#ff1c61,#e434f1)}
.favorite-other .favorite-shortcut-art{background:linear-gradient(90deg,#20c866,#08dfc2)}
.favorite-music .favorite-shortcut-art{background:linear-gradient(90deg,#3288c8,#25c1df)}
.favorite-book .favorite-shortcut-art{background:linear-gradient(110deg,#777036,#b6a644)}
.favorite-server .favorite-shortcut-art{background:linear-gradient(90deg,#7229a7,#a32bf1)}
.favorite-folder .favorite-shortcut-art{background:linear-gradient(90deg,#ff8500,#ffc326)}
.favorite-shortcut strong{display:block;margin-top:8px;font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source-shortcuts .horizontal-row{gap:24px}
:global(#xbybody .unified-home.library-settings-page){background:#1e1e1e!important;}
.library-settings-page{background:#1e1e1e;min-height:calc(100% - 60px)}.library-settings-page .library-settings-option,.library-settings-page .library-statistics>div{background:#2c2c2c;color:#ddd}.library-settings{width:min(660px,calc(100% - 48px));margin:18px auto 60px;padding:0;color:var(--color-text-1)}.library-statistics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:26px}.library-statistics>div{display:flex;flex-direction:column;gap:5px;border-radius:10px;background:var(--color-fill-2);padding:13px}.library-statistics strong{color:#ff8b25;font-size:18px}.library-statistics span,.library-source-group h2{color:var(--color-text-3);font-size:13px}.library-source-group{margin-bottom:26px}.library-source-group h2{font-weight:500;margin:0 0 9px}.library-settings-option{display:flex;align-items:center;gap:16px;background:var(--color-fill-2);padding:17px 18px;border-radius:10px;font-size:14px;margin-top:8px;cursor:pointer}.library-settings-option input{accent-color:#0099ff;width:13px;height:13px}.library-visibility{margin-top:46px}.library-refresh-actions{display:flex;gap:28px;margin-top:18px}.library-refresh-actions button{display:flex;align-items:center;gap:8px;color:var(--color-text-2);border:0;background:transparent;font-size:13px;cursor:pointer}.library-refresh-actions button:disabled{opacity:.4}:global(body[arco-theme="dark"]) .library-settings{color:#ddd}:global(body[arco-theme="dark"]) .library-settings-option,:global(body[arco-theme="dark"]) .library-statistics>div{background:#2c2c2c}
.library-index{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:24px 22px;padding:8px 16px}
.library-index-card{min-width:0;padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}
.library-index-art{aspect-ratio:2/3;border-radius:14px;background:var(--color-fill-2);display:flex;align-items:center;justify-content:center;color:#ff8b25}
:global(body[arco-theme="dark"]) .library-index-art{background:#202424}
.library-index-card strong{display:block;margin-top:10px;font-size:13px;font-weight:600}
.library-index-list{grid-template-columns:1fr}
.library-index-list .library-index-card{display:flex;align-items:center;gap:22px;padding:12px 0;border-bottom:1px solid var(--color-border-2)}
.library-index-list .library-index-art{width:98px;height:147px;flex-shrink:0}
@media(max-width:1100px){.library-index{grid-template-columns:repeat(5,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}}
@media(max-width:800px){.library-index{grid-template-columns:repeat(3,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}.favorite-page-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
.source-card{width:180px;height:112px;flex-shrink:0;background:#a85332;border:0;border-radius:16px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.source-card span{max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.music-source{background:#345d8b}.book-source{background:#777036}.server-source{background:#704c89}.folder-source{background:#927123}
.source-list{overflow:auto;flex:1;padding:0 18px}.source-list>button{display:flex;align-items:center;gap:18px;padding:16px;width:100%;border:0;border-bottom:1px solid var(--color-border-2);background:transparent;text-align:left}.source-list strong{flex:1}.source-list span{color:var(--color-text-3)}.source-art{width:86px;height:125px;display:grid;place-items:center;border-radius:9px;background:var(--color-fill-2);color:#ff8b25}.source-chevron{transform:rotate(180deg)}
.source-item{display:flex;align-items:center;border-bottom:1px solid var(--color-border-2);padding-right:16px}.source-open{display:flex;align-items:center;gap:18px;padding:16px;flex:1;min-width:0;border:0;background:transparent;text-align:left}.source-open strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-art{flex-shrink:0}
.embedded-workspace{flex:1;min-height:0;overflow:hidden}.home-empty{display:flex;align-items:center;flex-direction:column;padding:40px;color:var(--color-text-3);gap:12px}.load-error{padding:12px;background:var(--color-fill-2);border-radius:8px;margin-bottom:14px}.load-error button{background:transparent;border:0;color:#ff8b25}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:1050px){.unified-sidebar{width:220px}.unified-home{padding:20px}}
.server-category-subtitle{margin-left:14px}.unified-toolbar .server-sort-button{display:flex;width:auto;min-width:72px;max-width:240px;gap:7px;padding:0 12px;border-radius:20px;background:var(--color-fill-3);color:#ff8700;white-space:nowrap}.server-sort-button span{overflow:hidden;text-overflow:ellipsis}.sort-menu-spacer{width:13px;flex-shrink:0}.server-sort-menu{min-width:132px;padding:4px;color:var(--color-text-1);max-height:calc(100vh - 90px);overflow-y:auto}.server-sort-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 7px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:13px;text-align:left;white-space:nowrap;cursor:pointer}.server-sort-menu button:hover,.server-sort-menu button:focus-visible{background:var(--color-fill-3)}.server-sort-menu .invisible{visibility:hidden}.server-sort-divider{height:1px;margin:5px 3px;background:var(--color-border-2)}
:global(.arco-dropdown-option.unified-action-option){box-sizing:border-box;min-width:190px;width:max-content!important;max-width:calc(100vw - 48px);padding:0 12px!important;line-height:28px!important;margin:2px 4px!important;font-size:13px}:global(.unified-action-option .arco-dropdown-option-icon){display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;margin-right:9px}:global(.unified-action-option .arco-dropdown-option-content){white-space:nowrap;line-height:28px}:global(.unified-action-option svg){display:block;flex-shrink:0}
:global(.arco-dropdown-option.server-root-option){min-width:132px;padding:0 8px!important;margin:1px 3px!important;line-height:25px!important}:global(.server-root-option .arco-dropdown-option-icon){color:#ff8b25!important}
:global(.arco-dropdown-option.browse-sort-option){color:#fff!important}:global(.browse-sort-option .arco-dropdown-option-icon){color:#ff8800!important}
.source-screen-empty{display:flex;flex-direction:column}.source-screen-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser.file-sources-empty{display:flex;align-items:stretch}.file-sources-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,174px);align-content:start;gap:22px;padding:22px 36px}.file-source-card{padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}.file-source-art{position:relative;aspect-ratio:2/3;border-radius:16px;background:var(--color-fill-2);display:grid;place-items:center;color:#ff8b25}.file-source-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.file-source-art input{position:absolute;top:8px;right:8px}.file-source-card strong{display:block;font-size:13px;margin-top:10px}.file-source-list{display:flex;flex-direction:column;padding:0 16px;gap:0}.file-source-list .file-source-card{display:flex;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}.file-source-list .file-source-art{width:86px;height:129px;flex-shrink:0;border-radius:8px}.file-source-list strong{margin:0;font-size:14px}.file-source-subtitle{display:block;margin-top:4px;font-size:12px;font-weight:400;color:var(--color-text-3)}.file-source-handle{margin-left:auto;color:var(--color-text-3)}.file-source-add{background:#ff8700!important;color:white!important;border-radius:22px}
.file-source-art :deep(img.media-server-provider-icon) { position: static; inset: auto; object-fit: contain; border-radius: 0 }
.file-source-art img.file-source-provider-icon{position:static;width:56px;height:56px;object-fit:contain;border-radius:0}
.file-source-list .file-source-art img.file-source-provider-icon{width:28px;height:28px}
.file-sidebar-provider-icon{width:18px;height:18px;flex-shrink:0;object-fit:contain}
:global(.arco-dropdown:has([data-folder-option])){border-radius:12px!important;border:1px solid var(--color-border-3)!important;padding:4px!important;box-shadow:0 12px 24px rgba(0,0,0,.2)}
</style>

<style>
.file-source-selection-bar{position:fixed;right:20px;bottom:36px;z-index:100;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 300px);padding:10px 14px;border:1px solid var(--color-border-2);border-radius:24px;background:var(--color-bg-popup);color:var(--color-text-1);box-shadow:0 6px 20px #0003;overflow-x:auto;white-space:nowrap;font-size:12px}
.file-source-selection-bar button{display:flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;white-space:nowrap}.file-source-selection-bar button svg{color:#ff8800}.file-source-selection-bar button:disabled{opacity:.4;cursor:not-allowed}.file-source-selection-bar .danger svg{color:#ff375f}.file-source-card.source-selected .file-source-art{background:#684220!important;outline:1px solid #ff8800}.file-source-card.source-selected input{accent-color:#ff8800}.file-source-browser:has(+ .file-source-selection-bar){padding-bottom:90px}
.source-context-dismiss{position:fixed;inset:0;z-index:2000}
.source-context-menu{position:absolute;min-width:145px;padding:5px;border:1px solid var(--color-border-3);border-radius:12px;background: var(--app-overlay-bg);box-shadow:0 10px 26px #0004;color:var(--color-text-1)}
.source-context-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:13px;cursor:pointer;text-align:left}
.source-context-menu button svg{color:#ff8700;flex-shrink:0}.source-context-menu button:hover,.source-context-menu button:focus-visible{background:var(--color-fill-3)}
body[arco-theme='dark'] .source-context-menu{background: var(--app-overlay-bg);color:#e5e5e5;border-color:#484848}
.source-reorder>div{display:flex;gap:8px;align-items:center;padding:8px}.source-reorder span{flex:1}.source-reorder button{border:0;background:var(--color-fill-2);color:var(--color-text-1);padding:6px;border-radius:5px}
</style>

<style scoped>
.favorite-playlist .favorite-shortcut-art { background:linear-gradient(90deg,#ff452c,#ff9f57); }
</style>

<style scoped>.electron-library-sidebar.collapsed .nav-children,.electron-library-sidebar.collapsed .group-heading span,.electron-library-sidebar.collapsed .group-toggle{display:none}.electron-library-sidebar{flex:1;min-height:0;overflow:auto}.group-header{flex-shrink:0}</style>
