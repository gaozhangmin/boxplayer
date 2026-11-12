<script setup lang='ts'>
import { computed } from 'vue'
import { useAppStore, usePanFileStore, usePanTreeStore } from '../../store'
import { isAliyunUser as isAliyunAccountUser, isBoxUser, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser } from '../../aliapi/utils'
import { isWebDavDrive } from '../../utils/webdavClient'
import { supportsCopy, supportsCreateShare, supportsDirectPermanentDelete, supportsMove, supportsRename, supportsTrashMove, supportsZipDownload } from '../../drive/providerFeatures'

import {
  menuAddAlbumSelectFile,
  menuCopyFileName,
  menuCopyFileTree,
  menuCopySelectedFile,
  menuCreatShare,
  menuDLNA,
  menuDownload,
  menuFavSelectFile,
  menuFileClearHistory,
  menuFileColorChange,
  menuFileEncTypeChange,
  menuJumpToDir,
  menuM3U8Download,
  menuTrashSelectFile,
  menuVideoXBT
} from '../topbtns/topbtn'
import { modalRename, modalShuXing } from '../../utils/modal'
import { t } from '../../i18n'
import message from '../../utils/message'
import { isDocumentInsightFile, MAX_DOCUMENT_INSIGHT_SOURCES, openDocumentInsight, toDocumentInsightSource } from '../../services/documents/insight'

const props = defineProps({
  dirtype: {
    type: String,
    required: true
  },
  isvideo: {
    type: Boolean,
    required: true
  },
  isselected: {
    type: Boolean,
    required: true
  },
  isselectedmulti: {
    type: Boolean,
    required: true
  },
  isallfavored: {
    type: Boolean,
    required: true
  },
  isallcolored: {
    type: Boolean,
    required: true
  },
  inputselectType: {
    type: String,
    required: true
  },
  inputpicType: {
    type: String,
    required: true
  }
})

const istree = false
const panTreeStore = usePanTreeStore()
const panFileStore = usePanFileStore()
const appStore = useAppStore()
const isAliyunAccount = computed(() => isAliyunAccountUser(panTreeStore.user_id || ''))
const isDropbox = computed(() => isDropboxUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'dropbox')
const isOneDrive = computed(() => isOneDriveUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'onedrive')
const isBox = computed(() => isBoxUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'box')
const isGoogle = computed(() => isGoogleUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'google')
const isGuangya = computed(() => isGuangyaUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'guangya')
const isPikPak = computed(() => isPikPakUser(panTreeStore.user_id || '') || panTreeStore.drive_id === 'pikpak')
const isThirdPartyDrive = computed(() => isDropbox.value || isOneDrive.value || isBox.value || isGoogle.value || isGuangya.value || isPikPak.value)
const isShareSupported = computed(() => supportsCreateShare(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isCopySupported = computed(() => supportsCopy(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isMoveSupported = computed(() => supportsMove(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isRenameSupported = computed(() => supportsRename(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isTrashSupported = computed(() => supportsTrashMove(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isPermanentDeleteSupported = computed(() => supportsDirectPermanentDelete(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const isWebDav = computed(() => isWebDavDrive(panTreeStore.drive_id || panTreeStore.selectDir.drive_id))
const isBoxZipDownload = computed(() => {
  if (!supportsZipDownload(panTreeStore.user_id || '', panTreeStore.drive_id || '')) return false
  const files = panFileStore.GetSelected()
  if (isDropbox.value) return files.length === 1 && files[0].isDir
  return props.isselectedmulti || files.some(file => file.isDir)
})
const isShowBtn = computed(() => {
  return (props.dirtype === 'pic' && props.inputpicType != 'mypic')
    || props.dirtype === 'mypic' || ['search', 'color', 'pan'].includes(props.dirtype)
})
const isPic = computed(() => {
  return (props.dirtype === 'pic' && props.inputpicType == 'mypic')
})
const isDocumentAIAvailable = computed(() => {
  const selected = panFileStore.GetSelected()
  return selected.length > 0 && selected.length <= MAX_DOCUMENT_INSIGHT_SOURCES && selected.every(isDocumentInsightFile)
})

function openDocumentAI(initialPrompt = '') {
  const selected = panFileStore.GetSelected()
  if (!isDocumentAIAvailable.value) {
    message.warning(t('file.documentAiUnsupported'))
    return
  }
  const sources = selected.map(file => toDocumentInsightSource(file, panTreeStore.user_id || '')).filter(Boolean) as any[]
  const availableSources = panFileStore.ListDataShow.map(file => toDocumentInsightSource(file, panTreeStore.user_id || '')).filter(Boolean) as any[]
  openDocumentInsight({ sources, availableSources, scopeName: String(panTreeStore.selectDir?.name || ''), initialPrompt })
  appStore.toggleTab('ai-workspace')
}
</script>

<template>
  <div v-show="isselected && dirtype !== 'trash' && dirtype !== 'recover'" class='toppanbtn'>
    <a-button v-if='!isPic && dirtype != "video" && !isBoxZipDownload' type='text' size='small' tabindex='-1' title='Ctrl+D'
              @click='() => menuDownload(istree)'>
      <IconFont name="icondownload" />{{ t('file.download') }}
    </a-button>
    <a-dropdown v-if='isDocumentAIAvailable' trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1' title='BoxPlayer AI'><IconFont name="iconscan" />{{ t('file.analyzeWithAi') }} <span class='ai-pro-badge'>Pro</span><IconFont name='icondown' /></a-button>
      <template #content>
        <a-doption @click="openDocumentAI()">AI 问答</a-doption>
        <a-doption @click="openDocumentAI('总结这些来源')">AI 摘要</a-doption>
      </template>
    </a-dropdown>
    <a-button v-if='!isPic && dirtype != "video" && isBoxZipDownload' type='text' size='small' tabindex='-1' title='Ctrl+D'
              @click='() => menuDownload(istree)'>
      <IconFont name="iconfile-zip" />ZIP {{ t('file.download') }}
    </a-button>
    <a-button v-if="!isPic && dirtype != 'video' && dirtype !== 'search' && isShareSupported" type='text' size='small' tabindex='-1'
              title='Ctrl+S'
              @click="() => menuCreatShare(istree, 'pan', 'resource_root')">
      <IconFont name="iconfenxiang" />{{ t('file.share') }}
    </a-button>
    <a-button v-if='!isPic && dirtype != "video" && dirtype !== "search" && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+T'
              @click="() => menuCreatShare(istree, 'pan', 'backup_root')">
      <IconFont name="iconrss" />{{ t('file.quickTransfer') }}
    </a-button>
    <a-button v-if='!isPic && !isallfavored && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+G'
              @click='() => menuFavSelectFile(istree, true)'>
      <IconFont name="iconcrown" />{{ t('file.favorite') }}
    </a-button>
    <a-button v-if='!isPic && isallfavored && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+G'
              @click='() => menuFavSelectFile(istree, false)'>
      <IconFont name="iconcrown2" />{{ t('file.unfavorite') }}
    </a-button>
    <a-button v-if='isShowBtn && isRenameSupported' title='F2 / Ctrl+E' type='text' size='small' tabindex='-1'
              @click='() => modalRename(istree, isselectedmulti, isPic)'>
      <IconFont name="iconedit-square" />{{ t('file.rename') }}
    </a-button>
    <a-button v-if="isselected && !isselectedmulti && (dirtype == 'favorite' || dirtype == 'search' || dirtype == 'color' || dirtype == 'trash' || dirtype == 'video')"
              type='text' size='small' tabindex='-1' title='Ctrl+R'
              @click='() => menuJumpToDir()'>
      <IconFont name="icondakaiwenjianjia1" />{{ t('file.openLocation') }}
    </a-button>
    <a-dropdown v-if="dirtype !== 'video' && dirtype !== 'mypic' && (isTrashSupported || isPermanentDeleteSupported)" trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1' class='danger'>
        <IconFont name="icondelete" />{{ t('file.delete') }}<IconFont name="icondown" />
      </a-button>
      <template #content>
        <a-doption v-show='(isShowBtn || dirtype === "search") && isTrashSupported' title='Ctrl+Delete' class='danger'
                   @click='() => menuTrashSelectFile(istree, false, isPic)'>
          <template #icon><IconFont name="icondelete" /></template>
          <template #default>{{ t('file.trash') }}</template>
        </a-doption>
        <a-dsubmenu v-if='isPermanentDeleteSupported' class='rightmenu' trigger='hover'>
          <template #default>
            <span class='arco-dropdown-option-icon'><IconFont name="iconrest" /></span>{{ t('file.deletePermanently') }}
          </template>
          <template #content>
            <a-doption title='Ctrl+Shift+Delete' class='danger' @click='() => menuTrashSelectFile(istree, true, isPic)'>
              <template #default>{{ t('file.cannotRestore') }}</template>
            </a-doption>
          </template>
        </a-dsubmenu>
      </template>
    </a-dropdown>

    <a-dropdown trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1'>{{ t('file.more') }}<IconFont name="icondown" /></a-button>
      <template #content>
        <a-doption v-show='inputpicType !== "mypic" && dirtype === "pic"'
                   title='Ctrl+X' @click="() => menuAddAlbumSelectFile()">
          <template #icon><IconFont name="iconscissor" /></template>
          <template #default>{{ t('file.moveToAlbum') }}</template>
        </a-doption>
        <a-doption v-show='dirtype === "mypic"' title='Ctrl+X'
                   @click="() => menuTrashSelectFile(istree, false, true)">
          <template #icon><IconFont name="iconscissor" /></template>
          <template #default>{{ t('file.removeFromAlbum') }}</template>
        </a-doption>
        <a-doption v-show='isShowBtn && isMoveSupported' title='Ctrl+X' @click="() => menuCopySelectedFile(istree, 'cut')">
          <template #icon><IconFont name="iconscissor" /></template>
          <template #default>{{ t('file.moveTo') }}</template>
        </a-doption>
        <a-doption v-show='isShowBtn && isCopySupported' title='Ctrl+C' @click="() => menuCopySelectedFile(istree, 'copy')">
          <template #icon><IconFont name="iconcopy" /></template>
          <template #default>{{ t('file.copyTo') }}</template>
        </a-doption>
        <a-doption v-show='!isPic' title='Ctrl+P' @click='() => modalShuXing(istree, dirtype.includes("pic"))'>
          <template #icon><IconFont name="iconshuxing" /></template>
          <template #default>{{ t('file.properties') }}</template>
        </a-doption>
        <a-doption v-show='isvideo' @click='() => menuVideoXBT()'>
          <template #icon><IconFont name="iconjietu" /></template>
          <template #default>{{ t('file.sprite') }}</template>
        </a-doption>
        <a-doption v-show='isShowBtn && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+M'
                   @click="() => menuFileEncTypeChange(istree)">
          <template #icon><IconFont name="iconsafebox" /></template>
          <template #default>{{ t('file.markEncrypted') }}</template>
        </a-doption>
        <a-doption v-show='isShowBtn && isallcolored && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+M'
                   @click="() => menuFileClearHistory(istree)">
          <template #icon><IconFont name="iconshipin" /></template>
          <template #default>{{ t('file.clearHistory') }}</template>
        </a-doption>
        <a-doption v-show='isShowBtn && isallcolored && !isWebDav && isAliyunAccount' type='text' size='small' tabindex='-1' title='Ctrl+M'
                   @click="() => menuFileColorChange(istree, '')">
          <template #icon><IconFont name="iconfangkuang" /></template>
          <template #default>{{ t('file.clearMark') }}</template>
        </a-doption>
        <a-doption v-show="isvideo" @click="() => menuDLNA()">
          <template #icon><IconFont name="icontouping2" /></template>
          <template #default>{{ t('file.dlna') }}</template>
        </a-doption>
        <a-doption v-show='isvideo' @click='() => menuM3U8Download()'>
          <template #icon><IconFont name="iconluxiang" /></template>
          <template #default>{{ t('file.m3u8Download') }}</template>
        </a-doption>
        <a-doption v-show='isselected' @click='() => menuCopyFileName()'>
          <template #icon><IconFont name="iconlist" /></template>
          <template #default>{{ t('file.copyName') }}</template>
        </a-doption>
        <a-doption v-show='!dirtype.includes("pic") && isselected && !isselectedmulti && isAliyunAccount'
                   @click='() => menuCopyFileTree()'>
          <template #icon><IconFont name="iconnode-tree1" /></template>
          <template #default>{{ t('file.copyTree') }}</template>
        </a-doption>
      </template>
    </a-dropdown>
  </div>
</template>
<style></style>
