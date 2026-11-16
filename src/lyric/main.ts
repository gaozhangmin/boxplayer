import { createApp } from 'vue'
import PageLyric from './PageLyric.vue'

// A dedicated renderer avoids initializing the library, playback engine and
// account startup again inside the floating desktop widget.
document.documentElement.style.cssText = 'margin:0;width:100%;height:100%;background:transparent;overflow:hidden'
document.body.style.cssText = 'margin:0;width:100%;height:100%;background:transparent;overflow:hidden'
createApp(PageLyric).mount('#app')
