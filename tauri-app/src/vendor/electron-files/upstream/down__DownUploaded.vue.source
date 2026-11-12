<script setup lang="ts">
import {
  KeyboardState,
  MouseState,
  useAppStore,
  useKeyboardStore,
  useMouseStore,
  usePanFileStore,
  useWinStore
} from '../store'
import {
  onHideRightMenuScroll,
  onShowRightMenu,
  RefreshScroll,
  RefreshScrollTo,
  TestCtrl,
  TestKey,
  TestKeyboardScroll,
  TestKeyboardSelect
} from '../utils/keyboardhelper'
import { ref } from 'vue'
import UploadDAL from '../transfer/uploaddal'

import { Tooltip as AntdTooltip } from 'ant-design-vue'
import useUploadedStore from './UploadedStore'
import { IStateUploadTask } from '../utils/dbupload'
import message from '../utils/message'
import AliFile from '../aliapi/file'
import PanDAL from '../pan/pandal'
import { humanSize } from '../utils/format'
import { TestButton } from '../utils/mosehelper'
import fs from 'node:fs'
import { xorWith } from 'lodash'
import { t } from '../i18n'

const viewlist = ref()
const inputsearch = ref()
const appStore = useAppStore()
const winStore = useWinStore()
const uploadedStore = useUploadedStore()

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (appStore.appTab != 'down' || appStore.GetAppTabMenu != 'UploadedRight') return

  if (TestCtrl('a', state.KeyDownEvent, () => uploadedStore.mSelectAll())) return
  if (TestCtrl('f', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey('f3', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey(' ', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey('f5', state.KeyDownEvent, handleRefresh)) return

  if (TestKeyboardSelect(state.KeyDownEvent, viewlist.value, uploadedStore, handleDbClick)) return
  if (TestKeyboardScroll(state.KeyDownEvent, viewlist.value, uploadedStore)) return
})

const rangIsSelecting = ref(false)
const rangSelectID = ref(-1)
const rangSelectStart = ref(-1)
const rangSelectEnd = ref(-1)
const rangSelectFiles = ref<{ [k: number]: any }>({})
const onSelectRangStart = () => {
  onHideRightMenuScroll()
  rangIsSelecting.value = !rangIsSelecting.value
  rangSelectID.value = -1
  rangSelectStart.value = -1
  rangSelectEnd.value = -1
  rangSelectFiles.value = {}
  uploadedStore.mRefreshListDataShow(false)
}
const onSelectReverse = () => {
  onHideRightMenuScroll()
  const listData = uploadedStore.ListDataShow
  const listSelected = uploadedStore.GetSelected()
  const reverseSelect = xorWith(listData, listSelected, (a, b) => a.TaskID === b.TaskID)
  uploadedStore.ListSelected.clear()
  uploadedStore.ListFocusKey = -1
  if (reverseSelect.length > 0) {
    uploadedStore.mRangSelect(reverseSelect[0].TaskID, reverseSelect.map(r => r.TaskID))
  }
  uploadedStore.mRefreshListDataShow(false)
}
const onSelectCancel = () => {
  onHideRightMenuScroll()
  uploadedStore.ListSelected.clear()
  uploadedStore.ListFocusKey = 0
  uploadedStore.mRefreshListDataShow(false)
}

const onSelectRang = (file_id: number) => {
  if (rangIsSelecting.value && rangSelectID.value != -1) {

    let startid = rangSelectID.value
    let endid = -1
    const s: { [k: string]: any } = {}
    const children = uploadedStore.ListDataShow
    let a = -1
    let b = -1
    for (let i = 0, maxi = children.length; i < maxi; i++) {
      if (children[i].TaskID == file_id) a = i
      if (children[i].TaskID == startid) b = i
      if (a > 0 && b > 0) break
    }
    if (a >= 0 && b >= 0) {
      if (a > b) {
        ;[a, b] = [b, a]
        endid = file_id
      } else {
        endid = startid
        startid = file_id
      }
      for (let n = a; n <= b; n++) {
        s[children[n].TaskID] = true
      }
    }

    rangSelectStart.value = startid
    rangSelectEnd.value = endid
    rangSelectFiles.value = s
    uploadedStore.mRefreshListDataShow(false)
  }
}

const mouseStore = useMouseStore()
mouseStore.$subscribe((_m: any, state: MouseState) => {
  if (appStore.appTab != 'down') return
  const mouseEvent = state.MouseEvent
  // console.log('MouseEvent', state.MouseEvent)
  if (TestButton(0, mouseEvent, () => {
    if (mouseEvent.srcElement) {
      // @ts-ignore
      const className = mouseEvent.srcElement.className
      if (className && className.toString().startsWith('arco-virtual-list')) {
        onSelectCancel()
      }
    }
  })) return
})


const handleRefresh = () => UploadDAL.aReloadUploaded()
const handleSelectAll = () => uploadedStore.mSelectAll()

const handleSelect = (TaskID: number, event: any, isCtrl: boolean = false) => {
  onHideRightMenuScroll()
  if (rangIsSelecting.value) {
    if (!rangSelectID.value) {
      if (!uploadedStore.ListSelected.has(TaskID)) uploadedStore.mMouseSelect(TaskID, true, false)
      rangSelectID.value = TaskID
      rangSelectStart.value = TaskID
      rangSelectFiles.value = { [TaskID]: true }
    } else {
      const start = rangSelectID.value
      const children = uploadedStore.ListDataShow
      let a = -1
      let b = -1
      for (let i = 0, maxi = children.length; i < maxi; i++) {
        if (children[i].TaskID == TaskID) a = i
        if (children[i].TaskID == start) b = i
        if (a > 0 && b > 0) break
      }
      const fileList: number[] = []
      if (a >= 0 && b >= 0) {
        if (a > b) [a, b] = [b, a]
        for (let n = a; n <= b; n++) {
          fileList.push(children[n].TaskID)
        }
      }
      uploadedStore.mRangSelect(TaskID, fileList)
      rangIsSelecting.value = false
      rangSelectID.value = -1
      rangSelectStart.value = -1
      rangSelectEnd.value = -1
      rangSelectFiles.value = {}
    }
    uploadedStore.mRefreshListDataShow(false)
  } else {
    uploadedStore.mMouseSelect(TaskID, event.ctrlKey || isCtrl, event.shiftKey)
    if (!uploadedStore.ListSelected.has(TaskID)) uploadedStore.ListFocusKey = -1
  }
}
const handleDbClick = (TaskID: number) => {
  onSelectFile(undefined, 'pan')
}

const handleRightClick = (e: { event: MouseEvent; node: any }) => {
  const key = e.node.key

  uploadedStore.mKeyboardSelect(key, false, false)
  onShowRightMenu('rightuploadedmenu', e.event.clientX, e.event.clientY)
}

const handleSearchInput = (value: string) => {
  uploadedStore.mSearchListData(value)
  RefreshScrollTo(viewlist.value.$el, 0)
}

const handleSearchEnter = (event: any) => {
  event.target.blur()
  RefreshScroll(viewlist.value.$el)
}

const onSelectFile = (item: IStateUploadTask | undefined, cmd: string) => {
  if (!item) {
    item = uploadedStore.GetSelectedFirst()
  }
  if (!item) return
  if (cmd == 'file') {
    const full = item.localFilePath
    try {
      if (fs.existsSync(full)) {
        message.loading('Loading...', 2)
        window.Electron.shell.openPath(full)
      } else {
        message.error(t('transfer.fileMayDeleted'))
      }
    } catch {
    }
  }
  if (cmd == 'dir') {
    const full = item.localFilePath
    try {
      if (fs.existsSync(full)) {
        message.loading('Loading...', 2)
        window.Electron.shell.showItemInFolder(full)
      } else {
        message.error(t('transfer.folderMayDeleted'))
      }
    } catch {
    }
  }
  if (cmd == 'delete') {
    UploadDAL.UploadedDelete(false)
  }
  if (cmd == 'pan') {

    if (item.TaskFileID) {
      AliFile.ApiGetFile(item.user_id, item.drive_id, item.TaskFileID).then(async (file) => {
        if (file) {
          await PanDAL.aReLoadOneDirToShow('', file.parent_file_id, true)
          usePanFileStore().mMouseSelect(file.file_id, false, false)
          useAppStore().toggleTab('pan')
        } else {
          message.error(t('transfer.fileNotFoundMayDeleted'))
        }
      })
    } else {
      message.error(t('transfer.fileNotFound'))
    }
  }
}
</script>

<template>
  <div style="height: 7px"></div>
  <div class='toppanbtns' style='height: 26px'>
    <div style="min-height: 26px; max-width: 100%; flex-shrink: 0; flex-grow: 0">
      <div class="toppannav">
        <div class="toppannavitem" :title="t('transfer.uploaded')">
          <span> {{ t('transfer.uploaded') }} </span>
        </div>
      </div>
    </div>
    <div class='flex flexauto'></div>
    <div style="flex-grow: 1"></div>
  </div>
  <div style="height: 14px"></div>
  <div class="toppanbtns" style="height: 26px">
    <div class="toppanbtn">
      <a-button type="text" size="small" tabindex="-1" :loading="uploadedStore.ListLoading" title="F5"
                @click="handleRefresh">
        <template #icon>
          <IconFont name="iconreload-1-icon" />
        </template>
      </a-button>
    </div>

    <div v-if="uploadedStore.IsListSelected" class="toppanbtn">
      <a-button type="text" size="small" tabindex="-1" @click="() => UploadDAL.UploadedDelete(false)"><IconFont name="icondelete" />{{ t('transfer.clearSelected') }}
      </a-button>
    </div>

    <div class="toppanbtn">
      <a-button type="text" size="small" tabindex="-1" @click="() => UploadDAL.UploadedDelete(true)"><IconFont name="iconrest" />{{ t('transfer.clearAllUploaded') }}
      </a-button>
    </div>

    <div style="flex-grow: 1"></div>
    <div class="toppanbtn">
      <a-input-search
        tabindex="-1"
        ref="inputsearch"
        size="small"
        title="Ctrl+F / F3 / Space"
        :placeholder="t('transfer.quickFilter')"
        allow-clear
        v-model="uploadedStore.ListSearchKey"
        @clear='(e:any)=>handleSearchInput("")'
        @input="(val:any)=>handleSearchInput(val as string)"
        @press-enter="handleSearchEnter"
        @keydown.esc="($event.target as any).blur()"
      />
    </div>
  </div>
  <div style="height: 9px"></div>
  <div class="toppanarea">
    <div style="margin: 0 3px">
      <AntdTooltip :title="t('transfer.selectAllTooltip')" placement="left">
        <a-button shape="circle" type="text" tabindex="-1" class="select all" title="Ctrl+A" @click="handleSelectAll">
          <IconFont :name="uploadedStore.IsListSelectedAll ? 'iconrsuccess' : 'iconpic2'" />
        </a-button>
      </AntdTooltip>
    </div>
    <div class="selectInfo">{{ uploadedStore.ListDataSelectCountInfo }}</div>
    <div style='margin: 0 2px'>
      <AntdTooltip placement='rightTop' v-if="uploadedStore.ListDataShow.length > 0">
        <a-button shape='square' type='text' tabindex='-1' class='qujian'
                  :status="rangIsSelecting ? 'danger' : 'normal'" title='Ctrl+Q' @click='onSelectRangStart'>
          {{ rangIsSelecting ? t('transfer.cancelSelection') : t('transfer.rangeSelect') }}
        </a-button>
        <template #title>
          <div>
            {{ t('transfer.rangeStep1') }}
            <br />
            {{ t('transfer.rangeStep2') }}
            <br />
            {{ t('transfer.rangeStep3') }}
          </div>
        </template>
      </AntdTooltip>
      <a-button shape='square'
                v-if='!rangIsSelecting && uploadedStore.ListSelected.size > 0 && uploadedStore.ListSelected.size < uploadedStore.ListDataShow.length'
                type='text'
                tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectReverse'>
        {{ t('transfer.invertSelection') }}
      </a-button>
      <a-button shape='square' v-if='!rangIsSelecting && uploadedStore.ListSelected.size > 0' type='text' tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectCancel'>
        {{ t('transfer.cancelSelected') }}
      </a-button>
    </div>
    <div style="flex-grow: 1"></div>
    <div class="cell pr"></div>
  </div>
  <div class="toppanlist" :style="{ height: winStore.GetListHeight }" @keydown.space.prevent="() => true">
    <a-list
      ref="viewlist"
      :bordered="false"
      :split="false"
      :max-height="winStore.GetListHeightNumber"
      :virtual-list-props="{
        height: winStore.GetListHeightNumber,
        fixedSize: true,
        estimatedSize: 50,
        threshold: 1,
        itemKey: 'TaskID'
      }"
      style="width: 100%"
      :data="uploadedStore.ListDataShow"
      :loading="uploadedStore.ListLoading"
      tabindex="-1"
      @scroll="onHideRightMenuScroll">
      <template #empty>
        <a-empty :description="t('transfer.noUploadedTasks')" />
      </template>
      <template #item="{ item, index }">
        <div :key="item.TaskID" class="listitemdiv">
          <div
            :class="'fileitem ' + (uploadedStore.ListSelected.has(item.TaskID) ? ' selected' : '') + (uploadedStore.ListFocusKey == item.TaskID ? ' focus' : '')"
            @click="handleSelect(item.TaskID, $event)"
            @mouseover='onSelectRang(item.TaskID)'
            @dblclick="() => handleDbClick(item.TaskID)"
            @contextmenu="(event:MouseEvent)=>handleRightClick({event,node:{key:item.TaskID}} )">
            <div
              :class="'rangselect ' + (rangSelectFiles[item.TaskID] ? (rangSelectStart == item.TaskID ? 'rangstart' : rangSelectEnd == item.TaskID ? 'rangend' : 'rang') : '')">
              <a-button shape='circle' type='text' tabindex='-1' class='select' :title='index'
                        @click.prevent.stop='handleSelect(item.TaskID, $event, true)'>
                <IconFont :name="uploadedStore.ListSelected.has(item.TaskID) ? 'iconrsuccess' : 'iconpic2'" />
              </a-button>
            </div>
            <div class="fileicon">
              <IconFont :name="(item.isDir ? 'iconfile-folder' : 'iconwenjian')" aria-hidden="true" />
            </div>
            <div class="filename">
              <div class="nopoint" :title="item.localFilePath">
                {{ item.TaskName }}
              </div>
            </div>
            <div class="downsize">{{ humanSize(item.ChildTotalSize) }}</div>
            <div className="downedbtn">
              <a-button type="text" tabindex="-1" :title="t('transfer.locateInCloud')" @click.prevent.stop="onSelectFile(item, 'pan')">
                <IconFont name="iconcloud" />
              </a-button>
              <a-button type="text" tabindex="-1" :title="t('down.openFile')" @click.prevent.stop="onSelectFile(item, 'file')">
                <IconFont name="iconwenjian" />
              </a-button>
              <a-button type="text" tabindex="-1" :title="t('down.openFolder')" @click.prevent.stop="onSelectFile(item, 'dir')">
                <IconFont name="iconfile-folder" />
              </a-button>
              <a-button type="text" tabindex="-1" :title="t('transfer.deleteUploadRecord')"
                        @click.prevent.stop="onSelectFile(item, 'delete')">
                <IconFont name="icondelete" />
              </a-button>
            </div>
          </div>
        </div>
      </template>
    </a-list>
    <a-dropdown id="rightuploadedmenu" class="rightmenu" :popup-visible="true" tabindex="-1" :draggable="false"
                style="z-index: -1; left: -200px; opacity: 0">
      <template #content>
        <a-doption @click="() => onSelectFile(undefined, 'pan')">
          <template #icon><IconFont name="iconcloud" /></template>
          <template #default>{{ t('transfer.locateInCloud') }}</template>
        </a-doption>
        <a-doption @click="() => onSelectFile(undefined, 'file')">
          <template #icon><IconFont name="iconwenjian" /></template>
          <template #default>{{ t('down.openFile') }}</template>
        </a-doption>
        <a-doption @click="() => onSelectFile(undefined, 'dir')">
          <template #icon><IconFont name="iconfile-folder" /></template>
          <template #default>{{ t('down.openFolder') }}</template>
        </a-doption>
        <a-doption @click="() => onSelectFile(undefined, 'delete')">
          <template #icon><IconFont name="icondelete" /></template>
          <template #default>{{ t('transfer.deleteUploadRecord') }}</template>
        </a-doption>
      </template>
    </a-dropdown>
  </div>
</template>

<style>
.downedbtn {
  margin: 0 8px 0 0;
  flex-shrink: 0;
  flex-grow: 0;
  text-align: right;
}

.downedbtn > button {
  min-width: 32px !important;
  height: 30px !important;
  min-height: 30px !important;
  padding: 0px !important;
  color: var(--color-text-4) !important;
  font-size: 14px;
  line-height: 30px !important;
  border: none !important;
  margin: 0 1px;
}

.downedbtn > button .iconfont {
  font-size: 24px;
  line-height: 30px;
}

.fileitem.selected .downedbtn > button {
  color: rgb(var(--primary-6)) !important;
}

.downedbtn > button:hover,
.downedbtn > button:active {
  background: rgba(99, 125, 255, 0.2) !important;
  color: rgb(var(--primary-6)) !important;
}

body[arco-theme='dark'] .downedbtn > button:hover,
body[arco-theme='dark'] .downedbtn > button:active {
  background: rgba(99, 125, 255, 0.3) !important;
  color: rgb(var(--primary-6)) !important;
}

.downedbtn > button:hover .iconfont,
.downedbtn > button:active .iconfont {
  color: rgb(var(--primary-6)) !important;
}
</style>
