<script setup lang="ts">
import { menuCopySelectedFile, menuCreatShare, menuDownload, menuTrashSelectFile } from '../topbtns/topbtn'
import { modalRename, modalShuXing } from '../../utils/modal'
import PanDAL from '../pandal'
import { usePanTreeStore, useAppStore } from '../../store'
import TreeStore from '../../store/treestore'
import { MediaScanner } from '../../utils/mediaScanner'
import MusicScanner from '../../utils/musicScanner'
import BookScanner from '../../utils/bookScanner'
import message from '../../utils/message'
import { computed, ref } from 'vue'
import { isAliyunUser as isAliyunAccountUser } from '../../aliapi/utils'
import { supportsCopy, supportsCreateShare, supportsMove, supportsRename, supportsTrashMove, supportsZipDownload } from '../../drive/providerFeatures'
import { t } from '../../i18n'

const istree = true
const pantreeStore = usePanTreeStore()
const appStore = useAppStore()
const mediaScanner = MediaScanner.getInstance()
const musicScanner = MusicScanner.getInstance()
const bookScanner = BookScanner.getInstance()
const isAliyunAccount = computed(() => isAliyunAccountUser(pantreeStore.user_id || ''))
const isZipDownloadSupported = computed(() => supportsZipDownload(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const isShareSupported = computed(() => supportsCreateShare(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const isCopySupported = computed(() => supportsCopy(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const isMoveSupported = computed(() => supportsMove(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const isRenameSupported = computed(() => supportsRename(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const isTrashSupported = computed(() => supportsTrashMove(pantreeStore.user_id || '', pantreeStore.drive_id || ''))
const hasFolderOperations = computed(() => isMoveSupported.value || isCopySupported.value || isTrashSupported.value)

const props = defineProps({
  inputselectType: {
    type: String,
    required: true
  }
})

const handleRefresh = () => PanDAL.aReLoadOneDirToShow('', 'refresh', false)
const handleExpandAll = (isExpand: boolean) => {
  const drive_id = pantreeStore.drive_id
  const file_id = pantreeStore.selectDir.file_id
  const diridList = (() => {
    const result: string[] = []
    const visited = new Set<string>()
    const stack = [file_id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      const children = TreeStore.GetDirChildDirID(drive_id, current)
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (visited.has(child)) continue
        visited.add(child)
        result.push(child)
        stack.push(child)
      }
    }
    return result
  })()
  pantreeStore.mTreeExpandAll(diridList, isExpand)
}

const buildSelectedFolder = () => {
  const selectDir = pantreeStore.selectDir
  if (!selectDir || !selectDir.file_id) {
    message.warning('请先选择要扫描的文件夹')
    return null
  }
  const folder = {
    __v_skip: true,
    drive_id: pantreeStore.drive_id,
    file_id: selectDir.file_id,
    parent_file_id: selectDir.parent_file_id || '',
    name: selectDir.name,
    namesearch: (selectDir.name || '').toLowerCase(),
    ext: '',
    mime_type: '',
    mime_extension: '',
    category: 'folder',
    icon: 'iconfolder',
    file_count: 0,
    size: 0,
    sizeStr: '',
    time: Date.now(),
    timeStr: new Date().toLocaleString(),
    starred: false,
    isDir: true,
    thumbnail: '',
    path: (selectDir as any).path || ''
  } as any
  return folder
}

// 扫描类型勾选
const scanVideo = ref(true)
const scanAudio = ref(false)
const scanBook = ref(false)
const isScanning = computed(() => mediaScanner.isCurrentlyScanning || musicScanner.isScanning || bookScanner.isScanning)

const handleStartScan = async () => {
  const folder = buildSelectedFolder()
  if (!folder) return
  if (isScanning.value) { message.warning('正在扫描中，请稍后...'); return }
  if (!scanVideo.value && !scanAudio.value && !scanBook.value) { message.warning('请至少勾选一种扫描类型'); return }

  const userId = pantreeStore.user_id || ''
  const tasks: Promise<any>[] = []

  if (scanVideo.value && !mediaScanner.isCurrentlyScanning) {
    message.info(`开始扫描 "${folder.name}" 视频`)
    appStore.toggleTab('media')
    tasks.push(mediaScanner.scanFolder(folder, pantreeStore.drive_id).catch(e => console.error('视频扫描失败:', e)))
  }
  if (scanAudio.value && !musicScanner.isScanning) {
    if (!userId) { message.error('未识别到当前账号，无法扫描'); return }
    appStore.toggleTab('music')
    tasks.push(musicScanner.scanFolder(folder, userId).then(r => message.success(`音频扫描完成：收录 ${r.found} 首`)).catch(e => console.error('音频扫描失败:', e)))
  }
  if (scanBook.value && !bookScanner.isScanning) {
    if (!userId) { message.error('未识别到当前账号，无法扫描'); return }
    appStore.toggleTab('book')
    tasks.push(bookScanner.scanFolder(folder, userId).then(r => message.success(`书籍扫描完成：收录 ${r.found} 本`)).catch(e => console.error('书籍扫描失败:', e)))
  }

  await Promise.allSettled(tasks)
}

// 检查是否选中了有效的文件夹
const isSelectedFolder = computed(() => {
  return pantreeStore.selectDir && pantreeStore.selectDir.file_id && pantreeStore.selectDir.file_id !== ''
})

</script>

<template>
  <a-dropdown id="leftpanmenu" class="rightmenu" :popup-visible="true" style="z-index: -1; left: -200px; opacity: 0">
    <template #content>
      <a-dsubmenu id="leftpansubzhankai" class="rightmenu" trigger="hover">
        <template #default>
          <div @click.stop="() => {}">
            <span class="arco-dropdown-option-icon"><IconFont name="iconfenzhi1" /></span>{{ t('file.directory') }}
          </div>
        </template>
        <template #content>
          <a-doption @click="handleRefresh">
            <template #icon> <IconFont name="iconreload-1-icon" /> </template>
            <template #default>{{ t('file.refresh') }}</template>
          </a-doption>
          <a-doption @click="() => handleExpandAll(true)">
            <template #icon> <IconFont name="iconArrow-Down2" /> </template>
            <template #default>{{ t('file.expandAll') }}</template>
          </a-doption>
          <a-doption @click="() => handleExpandAll(false)">
            <template #icon> <IconFont name="iconArrow-Right2" /> </template>
            <template #default>{{ t('file.collapseAll') }}</template>
          </a-doption>
        </template>
      </a-dsubmenu>
      <a-doption @click="() => menuDownload(istree)">
        <template #icon> <IconFont :name="isZipDownloadSupported ? 'iconfile-zip' : 'icondownload'" /> </template>
        <template #default>{{ isZipDownloadSupported ? `ZIP ${t('file.download')}` : t('file.download') }}</template>
      </a-doption>
      <a-doption v-show="isShareSupported"
                 @click="() => menuCreatShare(istree, 'pan', 'resource_root')">
        <template #icon><IconFont name="iconfenxiang" /></template>
        <template #default>分享</template>
      </a-doption>
      <a-doption v-if="isAliyunAccount" @click="() => menuCreatShare(istree, 'pan', 'backup_root')">
        <template #icon><IconFont name="iconrss" /></template>
        <template #default>{{ t('file.quickTransfer') }}</template>
      </a-doption>

      <!-- 扫描数据 -->
      <a-dsubmenu v-if="isSelectedFolder" class="rightmenu" trigger="hover">
        <template #default>
          <div @click.stop="() => {}">
            <span class="arco-dropdown-option-icon">
              <IconFont name="iconscan" style="opacity: 0.8" />
            </span>
            {{ t('file.scan') }}
          </div>
        </template>
        <template #content>
          <a-doption @click.stop="scanVideo = !scanVideo">
            <template #icon>
              <IconFont :name="scanVideo ? 'iconcheckbox-full' : 'iconfangkuang'" :style="scanVideo ? 'color: rgb(var(--primary-6))' : ''" />
            </template>
            <template #default>{{ t('file.video') }}</template>
          </a-doption>
          <a-doption @click.stop="scanAudio = !scanAudio">
            <template #icon>
              <IconFont :name="scanAudio ? 'iconcheckbox-full' : 'iconfangkuang'" :style="scanAudio ? 'color: rgb(var(--primary-6))' : ''" />
            </template>
            <template #default>{{ t('file.audio') }}</template>
          </a-doption>
          <a-doption @click.stop="scanBook = !scanBook">
            <template #icon>
              <IconFont :name="scanBook ? 'iconcheckbox-full' : 'iconfangkuang'" :style="scanBook ? 'color: rgb(var(--primary-6))' : ''" />
            </template>
            <template #default>{{ t('file.book') }}</template>
          </a-doption>
          <a-doption @click="handleStartScan">
            <template #icon><IconFont name="iconstart" /></template>
            <template #default>{{ t('file.startScan') }}</template>
          </a-doption>
        </template>
      </a-dsubmenu>

      <a-dsubmenu v-if="hasFolderOperations" id="leftpansubmove" class="rightmenu" trigger="hover">
        <template #default>
          <div @click.stop="() => {}">
            <span class="arco-dropdown-option-icon"><IconFont name="iconmoveto" style="opacity: 0.8" /></span>{{ t('file.operations') }}
          </div>
        </template>
        <template #content>
          <a-doption v-if="isMoveSupported" @click="() => menuCopySelectedFile(istree, 'cut')">
            <template #icon> <IconFont name="iconscissor" /> </template>
            <template #default>{{ t('file.moveTo') }}</template>
          </a-doption>
          <a-doption v-if="isCopySupported" @click="() => menuCopySelectedFile(istree, 'copy')">
            <template #icon> <IconFont name="iconcopy" /> </template>
            <template #default>{{ t('file.copyTo') }}</template>
          </a-doption>
          <a-doption v-if="isTrashSupported" class="danger" @click="() => menuTrashSelectFile(istree, false)">
            <template #icon> <IconFont name="icondelete" /> </template>
            <template #default>{{ t('file.trash') }}</template>
          </a-doption>
        </template>
      </a-dsubmenu>

      <a-doption v-if="isRenameSupported" @click='() => modalRename(istree, false, false)'>
        <template #icon><IconFont name="iconedit-square" /></template>
        <template #default>{{ t('file.rename') }}</template>
      </a-doption>

      <a-doption @click='() => modalShuXing(istree)'>
        <template #icon><IconFont name="iconshuxing" /></template>
        <template #default>{{ t('file.properties') }}</template>
      </a-doption>
    </template>
  </a-dropdown>
</template>
<style>
.ai-pro-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: linear-gradient(135deg, #f59e0b, #f97316); color: #fff; font-weight: 700; line-height: 1; height: 14px; padding: 0 5px; font-size: 9px; vertical-align: middle; margin-left: 4px; }
</style>
