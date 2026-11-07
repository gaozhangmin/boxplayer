import { toSimplified, toTraditional } from 'chinese-simple2traditional'
import type { Danmu } from 'artplayer-plugin-danmuku'

export interface DanmakuTextPreferences {
  danmakuChinese: 'none' | 'simplified' | 'traditional'
  danmakuFixedToScroll: boolean
  danmakuFontFamily: string
}
export function formatDanmakuText(text: string, preference: DanmakuTextPreferences) {
  return preference.danmakuChinese === 'simplified' ? toSimplified(text)
    : preference.danmakuChinese === 'traditional' ? toTraditional(text) : text
}
export function prepareDanmakuComments(comments: Danmu[], preference: DanmakuTextPreferences): Danmu[] {
  return comments.map(comment => ({ ...comment, text: formatDanmakuText(comment.text, preference),
    mode: preference.danmakuFixedToScroll ? 0 : comment.mode,
    style: { ...comment.style, fontFamily: preference.danmakuFontFamily } }))
}
export function danmakuMatchTitle(title: string, includeYear: boolean) {
  return includeYear ? title : title.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
}
