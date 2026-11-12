import { ref, onBeforeUnmount } from 'vue'
export const browseModeKey = 'MediaLibrary_BrowseMode'
export const browseModeEvent = 'boxplayer:browse-mode-changed'
export function useServerBrowseMode() {
 const layout = ref<'grid'|'list'>('grid')
 function sync() { try { layout.value = localStorage.getItem(browseModeKey) === 'list' ? 'list' : 'grid' } catch { /* Preserve current mode when storage is unavailable. */ } }
 function storage(event: StorageEvent) { if (event.key === browseModeKey || event.key === null) sync() }
 function setLayout(value: 'grid'|'list') { localStorage.setItem(browseModeKey,value); layout.value = value; window.dispatchEvent(new Event(browseModeEvent)); window.dispatchEvent(new CustomEvent('boxplayer:library-browse-mode-changed',{detail:value})) }
 sync(); window.addEventListener(browseModeEvent,sync); window.addEventListener('boxplayer:library-browse-mode-changed',sync); window.addEventListener('storage',storage)
 onBeforeUnmount(() => { window.removeEventListener(browseModeEvent,sync); window.removeEventListener('boxplayer:library-browse-mode-changed',sync); window.removeEventListener('storage',storage) })
 return { layout, setLayout }
}
