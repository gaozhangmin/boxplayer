<script setup lang="ts">
import IconFont from '@/features/files/electron/IconFont.vue'
import { useAppStore } from '../../taskWorkspacePort'
import DownDowning from '../../DownloadingTaskPane.vue'
import DownDowned from '../../DownedTaskPane.vue'
import DownUploading from '../../UploadingTaskPane.vue'
import DownUploaded from '../../UploadedTaskPane.vue'
import { t } from '@/features/files/electron/i18n'

const appStore = useAppStore()
withDefaults(defineProps<{ sidebarVisible?: boolean }>(), { sidebarVisible: true })
</script>

<template>
  <a-layout style="height: 100%">
    <a-layout-sider v-show="sidebarVisible" hide-trigger :width="218" class="xbyleft single-boundary-sidebar">
      <div class="headdesc">{{ t('transfer.title') }}</div>
      <a-menu :style="{ width: '100%' }" class="xbyleftmenu single-boundary-sidebar-menu" :selected-keys="[appStore.GetAppTabMenu]" @update:selected-keys="appStore.toggleTabMenu('down', $event[0])">
        <a-menu-item key="DowningRight">
          <template #icon><IconFont name="icondownload" /></template>
          {{ t('transfer.downloading') }}
        </a-menu-item>
        <a-menu-item key="DownedRight">
          <template #icon><IconFont name="icondesktop" /></template>
          {{ t('transfer.downloaded') }}
        </a-menu-item>
        <a-menu-item key="UploadingRight">
          <template #icon><IconFont name="iconcloud-upload" /></template>
          {{ t('transfer.uploading') }}
        </a-menu-item>
        <a-menu-item key="UploadedRight">
          <template #icon><IconFont name="iconcloud_success" /></template>
          {{ t('transfer.uploaded') }}
        </a-menu-item>
<!--        <a-menu-item key="SyncRight">-->
<!--          <template #icon><IconFont name="iconcloud-sync" /></template>-->
<!--          文件夹同步 x-->
<!--        </a-menu-item>-->
<!--        <a-menu-item key="M3U8Right">-->
<!--          <template #icon><IconFont name="iconluxiang" /></template>-->
<!--          M3U8视频 x-->
<!--        </a-menu-item>-->
      </a-menu>
    </a-layout-sider>
    <a-layout-content class="xbyright">
      <a-tabs type="text" :direction="'horizontal'" class="hidetabs" :justify="true" :active-key="appStore.GetAppTabMenu">
        <a-tab-pane key="DowningRight" title="1"><DownDowning /></a-tab-pane>
        <a-tab-pane key="DownedRight" title="2"><DownDowned /></a-tab-pane>
        <a-tab-pane key="UploadingRight" title="3"><DownUploading /></a-tab-pane>
        <a-tab-pane key="UploadedRight" title="4"><DownUploaded /></a-tab-pane>


      </a-tabs>
    </a-layout-content>
  </a-layout>
</template>

<style></style>
