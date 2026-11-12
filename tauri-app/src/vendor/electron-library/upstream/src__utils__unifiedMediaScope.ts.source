import type { MediaLibraryItem } from '../types/media'

export function hasLocalMedia(item: MediaLibraryItem): boolean {
  const local = (file: MediaLibraryItem['driveFiles'][number]) => file.driveServerId === 'local' || file.driveId === 'local'
  return (item.driveFiles || []).some(local) || (item.seasons || []).some(season => (season.episodes || []).some(episode => (episode.driveFiles || []).some(local)))
}
