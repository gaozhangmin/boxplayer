<script lang="ts">
import {modalCloseAll} from '../../../creationPorts'
import {chooseDownloadDirectory,submitDownload,transferEntryScope} from '../../../transferEntry'
import { defineComponent, ref, onUnmounted } from 'vue'
import {useSettingStore} from '../../../ports'

import { isEmpty } from 'lodash'
import {message} from '../../../ports'


export default defineComponent({
  props: {
    visible: {
      type: Boolean,
      required: true
    },
    istree: {
      type: Boolean,
      required: true
    },
  },
  setup(props) {
    const okLoading = ref(false)
    const settingStore = useSettingStore()
    const scope=transferEntryScope()
    let alive=true
    onUnmounted(()=>{alive=false})
    const check=()=>{if(!alive)throw Error('下载窗口已关闭');scope.check()}

    const handleOpen = () => {}

    const handleClose = async () => {
      modalCloseAll()
    }

    const handleHide = () => {
      modalCloseAll()
    }

    const handleOK = async () => {
      if(okLoading.value)return
      const savePath = settingStore.downSavePath
      if (isEmpty(savePath)) {
        message.error('未设置保存路径')
        return
      }
      okLoading.value=true
      try { check();if(!await submitDownload())return;check();modalCloseAll() } catch(error) { if(alive)message.error(error instanceof Error?error.message:'下载请求失败') } finally { okLoading.value=false }
      return
    }

    const handleSelectDownSavePath = async () => {
      try { const path=await chooseDownloadDirectory(check);check();if(path)settingStore.updateStore({downSavePath:path}) }
      catch(error) { if(alive)message.error(error instanceof Error?error.message:'无法选择下载目录') }
    }
    return { okLoading, settingStore, handleOpen, handleClose, handleOK, handleHide, handleSelectDownSavePath }
  }
})
</script>

<template>
  <a-modal
      :visible="visible"
      modal-class="source-drive-dialog modalclass"
      :footer="false"
      :unmount-on-close="true"
      :mask-closable="false"
      @cancel="handleHide"
      @before-open="handleOpen"
      @close="handleClose">
    <template #title>
      <span class="modaltitle">从网盘下载 文件/文件夹 到本地</span>
    </template>
    <div class="modalbody" style="width: 440px;padding-bottom: 24px;">
      <a-input-search tabindex="-1"
                      :readonly="true"
                      button-text="更改"
                      search-button
                      :model-value="settingStore.downSavePath"
                      @search="handleSelectDownSavePath" />
    </div>
    <div class="modalfoot">
      <div style="flex-grow: 1"></div>
      <a-button v-if="!okLoading" type="outline" size="small" @click="handleHide">取消</a-button>
      <a-button type="primary" size="small" :loading="okLoading" @click="handleOK">开始下载</a-button>
    </div>
  </a-modal>
</template>

<style></style>
