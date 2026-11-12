import type { DriveFileItem } from '../types/media'
export interface MediaShareTarget { id: string; title: string; year?: string | number; overview?: string; files?: DriveFileItem[] }
export function mediaShareText(item: MediaShareTarget): string { return [item.title, item.year ? String(item.year) : '', item.overview || ''].filter(Boolean).join('\n') }
export function openMediaShare(item: MediaShareTarget): void { window.dispatchEvent(new CustomEvent('boxplayer:media-share', { detail: item })) }
