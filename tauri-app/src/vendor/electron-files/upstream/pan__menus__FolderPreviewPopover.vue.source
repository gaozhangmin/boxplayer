<script setup lang='ts'>
import { ref } from 'vue'
import { IAliGetFileModel } from '../../aliapi/alimodels'
import { fetchFolderPreview, FOLDER_PREVIEW_MAX } from '../../utils/folderPreview'
import useSettingStore from '../../setting/settingstore'

const HOVER_DELAY = 450
const HIDE_DELAY = 180
const PANEL_W = 360
const PANEL_H = 320

interface FolderPreviewParams {
  user_id: string
  drive_id: string
  file_id: string
  name?: string
  path?: string
}

const settingStore = useSettingStore()

const visible = ref(false)
const loading = ref(false)
const items = ref<IAliGetFileModel[]>([])
const folderName = ref('')
const folderId = ref('')
const pos = ref({ x: 0, y: 0 })

let hoverTimer: number | null = null
let hideTimer: number | null = null
let autoHideTimer: number | null = null
let token = 0

const computePos = (target: HTMLElement) => {
  const rect = target.getBoundingClientRect()
  const winW = window.innerWidth
  const winH = window.innerHeight
  let x = rect.right + 12
  if (x + PANEL_W > winW - 8) x = Math.max(8, rect.left - PANEL_W - 12)
  let y = rect.top
  if (y + PANEL_H > winH - 8) y = Math.max(8, winH - PANEL_H - 8)
  return { x, y }
}

const clearAutoHide = () => {
  if (autoHideTimer !== null) {
    window.clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
}

const scheduleAutoHide = () => {
  clearAutoHide()
  const sec = settingStore.uiFolderPreviewAutoHide
  if (!sec || sec <= 0) return
  autoHideTimer = window.setTimeout(() => {
    autoHideTimer = null
    cancel()
  }, sec * 1000)
}

const clearTimers = () => {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer)
    hoverTimer = null
  }
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  clearAutoHide()
}

const cancel = () => {
  clearTimers()
  token++
  visible.value = false
  loading.value = false
  items.value = []
  folderId.value = ''
  folderName.value = ''
}

const scheduleHide = () => {
  if (hideTimer !== null) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    hideTimer = null
    cancel()
  }, HIDE_DELAY)
}

const open = (target: HTMLElement, params: FolderPreviewParams) => {
  if (!target || !params || !params.user_id || !params.drive_id || !params.file_id) return
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer)
    hoverTimer = null
  }
  if (visible.value && folderId.value === params.file_id) {
    scheduleAutoHide()
    return
  }
  const myToken = ++token
  hoverTimer = window.setTimeout(async () => {
    hoverTimer = null
    if (myToken !== token) return
    folderId.value = params.file_id
    folderName.value = params.name || ''
    pos.value = computePos(target)
    loading.value = true
    items.value = []
    visible.value = true
    scheduleAutoHide()
    try {
      const list = await fetchFolderPreview(params)
      if (myToken !== token) return
      items.value = list.slice(0, FOLDER_PREVIEW_MAX)
    } finally {
      if (myToken === token) loading.value = false
    }
  }, HOVER_DELAY)
}

const leave = () => {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer)
    hoverTimer = null
  }
  if (visible.value) scheduleHide()
  else token++
}

const onPanelEnter = () => {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  clearAutoHide()
}

const onPanelLeave = () => {
  scheduleHide()
  scheduleAutoHide()
}

defineExpose({ open, leave, cancel })
</script>

<template>
  <div
    v-show='visible'
    class='folderPreviewPanel'
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @mouseenter='onPanelEnter'
    @mouseleave='onPanelLeave'
    @mousedown.stop>
    <div class='folderPreviewHeader' :title='folderName'>
      <IconFont name="iconfile-folder" />
      <span class='folderPreviewName'>{{ folderName }}</span>
    </div>
    <div class='folderPreviewBody'>
      <div v-if='loading' class='folderPreviewState'>加载中…</div>
      <div v-else-if='!items.length' class='folderPreviewState'>空文件夹</div>
      <div v-else class='folderPreviewGrid'>
        <div v-for='f in items' :key='f.file_id' class='folderPreviewCell' :title='f.name'>
          <div class='folderPreviewThumb'>
            <img v-if='f.thumbnail' :src='f.thumbnail' onerror="this.style.display='none'" />
            <IconFont :name="(f.icon || (f.isDir ? 'iconfile-folder' : 'iconwenjian'))" v-else aria-hidden='true' />
            <span v-if="f.category && f.category.toString().startsWith('video')" class='folderPreviewPlay'>
              <svg viewBox='0 0 1024 1024'>
                <path d='M689.066667 480l-196.266667-177.066667c-27.733333-25.6-70.4-6.4-70.4 32v356.266667c0 36.266667 44.8 55.466667 70.4 32l196.266667-177.066667c17.066667-19.2 17.066667-49.066667 0-66.133333z'></path>
              </svg>
            </span>
          </div>
          <div class='folderPreviewLabel'>{{ f.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.folderPreviewPanel {
  position: fixed;
  z-index: 3000;
  width: 360px;
  max-height: 360px;
  padding: 8px 10px 10px;
  background: var(--color-bg-popup, #ffffff);
  border: 1px solid var(--color-neutral-3, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.folderPreviewHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 8px;
  border-bottom: 1px solid var(--color-neutral-3, rgba(0, 0, 0, 0.06));
  font-size: 13px;
  color: var(--color-text-1, #1d2129);
}

.folderPreviewHeader .iconfont {
  font-size: 18px;
  color: rgb(var(--primary-6));
  flex-shrink: 0;
}

.folderPreviewName {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folderPreviewBody {
  flex: 1;
  overflow-y: auto;
  margin-top: 8px;
}

.folderPreviewState {
  padding: 24px 0;
  text-align: center;
  color: var(--color-text-3, #86909c);
  font-size: 13px;
}

.folderPreviewGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.folderPreviewCell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.folderPreviewThumb {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: var(--color-fill-2, #f2f3f5);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.folderPreviewThumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.folderPreviewThumb .iconfont {
  font-size: 36px;
  color: rgb(var(--primary-6));
  opacity: 0.85;
}

.folderPreviewPlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.folderPreviewPlay svg {
  width: 28px;
  height: 28px;
  fill: rgba(255, 255, 255, 0.9);
  filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.5));
}

.folderPreviewLabel {
  font-size: 12px;
  color: var(--color-text-2, #4e5969);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
