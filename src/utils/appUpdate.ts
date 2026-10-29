import { ref } from 'vue'
export const appUpdate = ref<any>({ status: 'idle' })
let initialized = false
export function initializeAppUpdate() {
  if (initialized) return
  initialized = true
  window.AutoUpdateOnStateChanged?.(state => { appUpdate.value = state })
  window.AutoUpdateGetState?.().then(state => { if (state) appUpdate.value = state })
}
export async function checkAppUpdate() {
  const state = await window.AutoUpdateCheck?.(true)
  if (state) appUpdate.value = state
}
export async function downloadAppUpdate() {
  try { await window.AutoUpdateDownload?.() }
  catch (error) { appUpdate.value = { ...appUpdate.value, status: 'error', message: String(error) } }
}
