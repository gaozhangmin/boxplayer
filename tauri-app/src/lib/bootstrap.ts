import { createApp, watch } from 'vue'
import type { Component, App } from 'vue'
import { createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

export function mountApp(component: Component, configure?: (app:App)=>void) {
  const app = createApp(component)
  app.use(createPinia())
  configure?.(app)
  const settings = useSettingsStore()
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  function apply() {
    const dark = settings.value.theme === 'dark' || (settings.value.theme === 'system' && media.matches)
    document.documentElement.classList.toggle('dark', dark)
    if(dark)document.body.setAttribute('arco-theme','dark');else document.body.removeAttribute('arco-theme')
    document.documentElement.lang = settings.value.language
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  media.addEventListener('change', apply)
  watch(() => [settings.value.theme, settings.value.language], apply, { immediate: true })
  void settings.initialize()
  app.mount('#app')
}
