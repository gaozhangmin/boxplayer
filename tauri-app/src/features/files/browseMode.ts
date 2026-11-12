import { computed, onUnmounted, ref } from 'vue'
export const browseModeEvent='boxplayer:browse-mode-changed'
const legacyEvent='boxplayer:browse-mode'
export function useFileBrowseMode(){
 const read=()=>{try{return localStorage.getItem('MediaLibrary_BrowseMode')!=='list'}catch{return true}}
 const grid=ref(read())
 function sync(event:Event){if(event instanceof StorageEvent&&event.key!=='MediaLibrary_BrowseMode')return;grid.value=read()}
 window.addEventListener(browseModeEvent,sync);window.addEventListener(legacyEvent,sync);window.addEventListener('storage',sync)
 onUnmounted(()=>{window.removeEventListener(browseModeEvent,sync);window.removeEventListener(legacyEvent,sync);window.removeEventListener('storage',sync)})
 return computed({get:()=>grid.value,set:(value:boolean)=>{grid.value=value;try{localStorage.setItem('MediaLibrary_BrowseMode',value?'grid':'list')}catch{}window.dispatchEvent(new CustomEvent(browseModeEvent,{detail:value?'grid':'list'}));window.dispatchEvent(new CustomEvent(legacyEvent,{detail:value?'grid':'list'}))}})
}
