import '@/features/player/soia/window.css'
import 'vue-sonner/style.css'
import App from './App.vue'
import { mountApp } from '@/lib/bootstrap'
document.documentElement.classList.add('player-window')
// soia's theme is selected through data attributes, separate from BoxPlayer's .dark class.
document.documentElement.dataset.theme = 'dark'
document.documentElement.dataset.platform = /mac|darwin/i.test(navigator.userAgent) ? 'macos' : /windows/i.test(navigator.userAgent) ? 'windows' : 'linux'
mountApp(App)
