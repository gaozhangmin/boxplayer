<script setup lang='ts'>
import { computed, ref } from 'vue'
import { handleUpload, topFavorDeleteAll } from '../topbtns/topbtn'
import {
  modalCreatNewAlbum,
  modalCreatNewDir,
  modalCreatNewFile,
  modalDaoRuShareLink,
  modalShowShareLink
} from '../../utils/modal'
import AliShare from '../../aliapi/share'
import { usePanTreeStore, usePanFileStore } from '../../store'
import message from '../../utils/message'
import PanDAL from '../pandal'
import { isAliyunUser } from '../../aliapi/utils'
import { isWritableProviderDirectory, supportsCreateFolder, supportsCreateTextFile, supportsEncryptedFileOperations, supportsLocalUpload, supportsShareImport } from '../../drive/providerFeatures'
import { t } from '../../i18n'

const props = defineProps({
  dirtype: {
    type: String,
    required: true
  },
  inputselectType: {
    type: String,
    required: true
  },
  inputpicType: {
    type: String,
    required: true
  },
  isselected: {
    type: Boolean,
    required: true
  }
})

const videoSelectType = ref('recent')
const panTreeStore = usePanTreeStore()
const panFileStore = usePanFileStore()

const isShareImportSupported = computed(() => supportsShareImport(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const canWriteCurrentDirectory = computed(() => isWritableProviderDirectory(panTreeStore.selectDir.file_id || ''))
const canCreateTextFile = computed(() => canWriteCurrentDirectory.value && supportsCreateTextFile(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const canCreateFolder = computed(() => canWriteCurrentDirectory.value && supportsCreateFolder(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const canUploadLocal = computed(() => canWriteCurrentDirectory.value && supportsLocalUpload(panTreeStore.user_id || '', panTreeStore.drive_id || ''))
const canUseEncryption = computed(() => canWriteCurrentDirectory.value && supportsEncryptedFileOperations(panTreeStore.user_id || ''))
const canCreateAnything = computed(() => canCreateTextFile.value || canCreateFolder.value || canUseEncryption.value)

const isShowBtn = computed(() => {
  return (props.dirtype === 'pic' && props.inputpicType != 'mypic')
    || props.dirtype === 'mypic' || props.dirtype === 'pan'
})

const handleSelectAllCompilation = () => {
  videoSelectType.value = 'allComp'
  PanDAL.aReLoadOneDirToShow('', 'video.compilation', false)
}
const handleSelectRecentPlay = () => {
  videoSelectType.value = 'recent'
  PanDAL.aReLoadOneDirToShow('', 'video.recentplay', false)
}

const handleClickBottleFish = async () => {
  let resp = await AliShare.ApiShareBottleFish(panTreeStore.user_id)
  if (typeof resp !== 'string') {
    // 打开分享
    let share_id = resp.shareId
    AliShare.ApiGetShareToken(share_id, '')
      .then((share_token) => {
        if (!share_token || share_token.startsWith('，')) {
          message.error('解析链接出错' + share_token)
        } else {
          modalShowShareLink(share_id, '', share_token, true, [], false)
        }
      })
      .catch((err: any) => {
        message.error('解析链接出错', err)
      })
  } else {
    message.info(resp)
  }
}
</script>

<template>
  <div v-show="!isselected && dirtype === 'favorite'" class='toppanbtn'>
    <a-button type='text' size='small' tabindex='-1' class='danger' @click='topFavorDeleteAll'>
      <IconFont name="iconcrown2" />{{ t('file.emptyFavorites') }}
    </a-button>
  </div>
  <div v-if="dirtype == 'video'" class='toppanbtn' tabindex='-1'>
    <a-space direction='horizontal'>
      <a-button size='small' tabindex='-1'
                :type="videoSelectType === 'recent' ? 'secondary' : 'dashed'"
                @click='handleSelectRecentPlay'>
        <IconFont name="iconfile_video" />{{ t('file.nowWatching') }}
      </a-button>
      <a-button size='small' tabindex='-1'
                :type="videoSelectType === 'allComp' ? 'secondary' : 'dashed'"
                @click='handleSelectAllCompilation'>
        <IconFont name="iconrss_video" />{{ t('file.allAlbums') }}
      </a-button>
    </a-space>
  </div>
  <div v-show="!isselected && ['pan', 'pic', 'mypic'].includes(dirtype)" class='toppanbtn'>
    <a-button v-if="inputselectType.includes('resource') && isAliyunUser(panTreeStore.user_id || '')" type='text' size='small' tabindex='-1'
              @click="handleClickBottleFish">
      <IconFont name="iconnotification" />{{ t('file.luckyBottle') }}
    </a-button>
    <a-dropdown v-if='dirtype !== "pic" && canCreateAnything' trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1'>
        <IconFont name="iconplus" />{{ t('file.new') }}<IconFont name="icondown" />
      </a-button>
      <template #content>
        <a-dgroup :title="t('file.normalNew')">
          <a-doption v-if='canCreateTextFile' value='newfile' title='Ctrl+N' @click='() => modalCreatNewFile()'>
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.newFile') }}</template>
          </a-doption>
          <a-doption v-if='canCreateFolder' value='newfolder' title='Ctrl+Shift+N' @click="() => modalCreatNewDir('folder')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.newFolder') }}</template>
          </a-doption>
          <a-doption v-if='canCreateFolder' value='newdatefolder' @click="() => modalCreatNewDir('datefolder')">
            <template #icon><IconFont name="iconfolderadd" /></template>
            <template #default>{{ t('file.dateFolder') }}</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup v-if='canUseEncryption' :title="t('file.encryptedNew')">
          <a-doption value='newfile' @click='() => modalCreatNewFile("xbyEncrypt1")'>
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.newFile') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
          <a-doption value='newfolder' @click="() => modalCreatNewDir('folder', 'xbyEncrypt1')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.newFolder') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
          <a-doption value='newdatefolder' @click="() => modalCreatNewDir('datefolder', 'xbyEncrypt1')">
            <template #icon><IconFont name="iconfolderadd" /></template>
            <template #default>{{ t('file.dateFolder') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup v-if='canUseEncryption' :title="t('file.privateNew')">
          <a-doption value='newfile' @click='() => modalCreatNewFile("xbyEncrypt2")'>
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.newFile') }}（{{ t('file.private') }}）</template>
          </a-doption>
          <a-doption value='newfolder' @click="() => modalCreatNewDir('folder', 'xbyEncrypt2')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.newFolder') }}（{{ t('file.private') }}）</template>
          </a-doption>
          <a-doption value='newdatefolder' @click="() => modalCreatNewDir('datefolder', 'xbyEncrypt2')">
            <template #icon><IconFont name="iconfolderadd" /></template>
            <template #default>{{ t('file.dateFolder') }}（{{ t('file.private') }}）</template>
          </a-doption>
        </a-dgroup>
      </template>
    </a-dropdown>
    <a-button v-else-if="dirtype === 'pic' && inputpicType != 'pic_root'"
              type='text' size='small' tabindex='-1'
              @click='modalCreatNewAlbum'>
      <IconFont name="iconplus" />{{ t('file.createAlbum') }}
    </a-button>
    <a-dropdown v-if='!dirtype.includes("pic") && canUploadLocal' trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1'>
        <IconFont name="iconupload" />{{ t('file.upload') }}<IconFont name="icondown" />
      </a-button>
      <template #content>
        <a-dgroup :title="t('file.normalUpload')">
          <a-doption value='uploadfile' title='Ctrl+U'
                     @click="() => handleUpload('file')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadFile') }}</template>
          </a-doption>
          <a-doption value='uploaddir' title='Ctrl+Shift+U' @click="() => handleUpload('folder')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.uploadFolder') }}</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup v-if='canUseEncryption' :title="t('file.encryptedUpload')">
          <a-doption value='uploadfile' title='Ctrl+J'
                     @click="() => handleUpload('file', 'xbyEncrypt1')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadFile') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
          <a-doption value='uploaddir' title='Ctrl+Shift+J' @click="() => handleUpload('folder', 'xbyEncrypt1')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.uploadFolder') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup v-if='canUseEncryption' :title="t('file.privateUpload')">
          <a-doption value='uploadfile' title='Ctrl+M'
                     @click="() => handleUpload('file', 'xbyEncrypt2')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadFile') }}（{{ t('file.private') }}）</template>
          </a-doption>
          <a-doption value='uploaddir' title='Ctrl+Shift+M' @click="() => handleUpload('folder','xbyEncrypt2')">
            <template #icon><IconFont name="iconfile-folder" /></template>
            <template #default>{{ t('file.uploadFolder') }}（{{ t('file.private') }}）</template>
          </a-doption>
        </a-dgroup>
      </template>
    </a-dropdown>
    <a-dropdown v-if="isShowBtn && dirtype.includes('pic') &&  isAliyunUser(panTreeStore.user_id || '')"
                trigger='hover' class='rightmenu' position='bl'>
      <a-button type='text' size='small' tabindex='-1'>
        <IconFont name="iconupload" />{{ t('file.uploadPhotosVideos') }}<IconFont name="icondown" />
      </a-button>
      <template #content>
        <a-dgroup :title="t('file.normalUpload')">
          <a-doption value='uploadfile'
                     @click="() => handleUpload('pic_file')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadPhotosVideos') }}</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup :title="t('file.encryptedUpload')">
          <a-doption value='uploadfile'
                     @click="() => handleUpload('pic_file', 'xbyEncrypt1')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadPhotosVideos') }}（{{ t('file.encrypted') }}）</template>
          </a-doption>
        </a-dgroup>
        <a-dgroup :title="t('file.privateUpload')">
          <a-doption value='uploadfile' title='Ctrl+U'
                     @click="() => handleUpload('pic_file', 'xbyEncrypt2')">
            <template #icon><IconFont name="iconwenjian" /></template>
            <template #default>{{ t('file.uploadPhotosVideos') }}（{{ t('file.private') }}）</template>
          </a-doption>
        </a-dgroup>
      </template>
    </a-dropdown>
    <a-button v-if="!dirtype.includes('pic') && isShareImportSupported" type='text' size='small' tabindex='-1' title='Ctrl+L'
              @click='modalDaoRuShareLink()'>
      <IconFont name="iconlink2" />{{ t('file.importShare') }}
    </a-button>
    <!-- AI 整理暂时隐藏 -->
    <!-- <a-button v-if="!isselected && ['pan', 'pic', 'mypic'].includes(dirtype)" type='text' size='small' tabindex='-1'
              @click='handleAiOrganizeCurrentDir'>
      <IconFont name="iconscan" />AI 整理
    </a-button> -->
  </div>
</template>
<style></style>
