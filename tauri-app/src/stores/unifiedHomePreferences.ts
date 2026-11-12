import { defineStore } from 'pinia'
import { defaultHomeSettings } from '../features/library/unifiedHomeManagement'

export const UNIFIED_HOME_PREFERENCES_KEY = 'unified-media-home-preferences'

// Compatibility projection for existing renderers. Mutation authority belongs
// to categoryPlacement; loading here is only for the legacy migration.
export default defineStore('unified-media-home-preferences', {
  state: defaultHomeSettings,
  actions: {
    ensureLoaded() {
      try {
        const data = JSON.parse(localStorage.getItem(UNIFIED_HOME_PREFERENCES_KEY) || '{}')
        this.$patch({
          order: Array.isArray(data.order) ? data.order.filter((id: unknown) => typeof id === 'string') : [],
          hidden: Array.isArray(data.hidden) ? data.hidden.filter((id: unknown) => typeof id === 'string') : [],
          titles: Object.fromEntries(Object.entries(data.titles || {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        })
      } catch { this.$patch(defaultHomeSettings()) }
    }
  }
})
