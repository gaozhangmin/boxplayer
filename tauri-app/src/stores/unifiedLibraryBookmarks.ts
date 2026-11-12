import { defineStore } from 'pinia'

export const CATEGORY_BOOKMARKS_KEY = 'unified-library-category-bookmarks-v1'
const defaults = () => ({ favorites: ['library', 'movies', 'tv', 'other', 'music', 'books'], home: [] as string[], titles: {} as Record<string, string> })
// Compatibility projection for existing renderers. Only categoryPlacement may
// persist mutations; this store can decode legacy data during migration.
export default defineStore('unified-library-category-bookmarks', {
  state: defaults,
  actions: {
    ensureLoaded() {
      try {
        const saved = JSON.parse(localStorage.getItem(CATEGORY_BOOKMARKS_KEY) || 'null')
        if (!saved) return
        if (saved.titles && typeof saved.titles === 'object') {
          this.titles = Object.fromEntries(Object.entries(saved.titles).filter(([, value]) => typeof value === 'string')) as Record<string, string>
        }
        for (const field of ['favorites', 'home'] as const) if (Array.isArray(saved[field])) this[field] = [...new Set<string>(saved[field].filter((id: unknown) => typeof id === 'string'))]
      } catch { /* Preserve defaults when older settings are malformed. */ }
    }
  }
})
