import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { defaultSettings, type Settings, type SettingsPatch } from '@/platform/contracts'
import { asAppError, getSettings, isNative, onSettingsChanged, updateSettings } from '@/platform/native'

export const useSettingsStore = defineStore('settings', () => {
  const value = ref<Settings>(defaultSettings())
  const ready = ref(false)
  const saving = ref(false)
  const error = ref('')
  const preview = computed(() => !isNative())
  let stop: (() => void) | undefined
  let starting: Promise<void> | undefined
  function accept(next: Settings) {
    if (next.schemaVersion === 1 && next.revision >= value.value.revision) value.value = next
  }
  function initialize(): Promise<void> {
    if (starting) return starting
    starting = (async () => {
      if (!isNative()) { ready.value = true; return }
      try {
        // Listen before reading: an update between these calls must not be missed.
        stop = await onSettingsChanged(accept)
        accept(await getSettings())
        ready.value = true
      } catch (e) { error.value = asAppError(e).message; stop?.(); stop = undefined; starting = undefined }
    })()
    return starting
  }
  async function save(patch: SettingsPatch) {
    if (saving.value) return
    saving.value = true
    error.value = ''
    try { accept(await updateSettings(value.value.revision, patch)) }
    catch (e) {
      const failure = asAppError(e)
      error.value = failure.message
      if (failure.code === 'REVISION_CONFLICT') {
        try { accept(await getSettings()) } catch (refreshError) { error.value = asAppError(refreshError).message }
      }
      throw failure
    } finally { saving.value = false }
  }
  function dispose() { stop?.(); stop = undefined; starting = undefined; ready.value = false }
  return { value, ready, saving, error, preview, initialize, save, dispose, accept }
})
