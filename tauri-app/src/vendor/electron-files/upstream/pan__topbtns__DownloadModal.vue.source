<script lang="ts">
import { modalCloseAll, modalDownload } from '../../utils/modal'
import { defineComponent, ref } from 'vue'
import useSettingStore from "../../setting/settingstore";
import { menuDownload } from './topbtn'
import { isEmpty } from 'lodash'
import message from '../../utils/message'


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

    const handleOpen = () => {}

    const handleClose = async () => {
      modalCloseAll()
    }

    const handleHide = () => {
      modalCloseAll()
    }

    const handleOK = () => {
      const savePath = settingStore.AriaIsLocal ? settingStore.downSavePath : settingStore.ariaSavePath
      if (isEmpty(savePath)) {
        message.error('未设置保存路径')
        return
      }
      menuDownload(props.istree, false)
      modalCloseAll()
    }

    const handleSelectDownSavePath = () => {
      if (window.WebShowOpenDialogSync) {
        window.WebShowOpenDialogSync(
            {
              title: '选择一个文件夹，把所有文件下载到此文件夹内',
              buttonLabel: '选择',
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: settingStore.downSavePath
            },
            (result: string[] | undefined) => {
              if (result && result[0]) {
                settingStore.updateStore({ downSavePath: result[0] })
              }
            }
        )
      }
    }
    return { okLoading, settingStore, handleOpen, handleClose, handleOK, handleHide, handleSelectDownSavePath }
  }
})
</script>

<template>
  <a-modal
      :visible="visible"
      modal-class="modalclass"
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
