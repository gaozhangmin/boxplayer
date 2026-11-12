<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  KeyboardState,
  MouseState,
  useAppStore,
  useDownedStore,
  useKeyboardStore,
  useMouseStore,
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
import { Tooltip as AntdTooltip } from 'ant-design-vue'
import { IStateDownFile } from './DownDAL'
import { TestButton } from '../utils/mosehelper'
import { xorWith } from 'lodash'
import { isLocalVideoPath } from './integration/localVideoPlayback'
import { resolveDownloadOpenPath } from './integration/btDownloadTarget'
import UserDAL from '../user/userdal'
import { getCloudDownloadSourceLabel } from './cloudDownloadSource'
import { t } from '../i18n'

const viewlist = ref()
const inputsearch = ref()
const appStore = useAppStore()
const winStore = useWinStore()
const downedStore = useDownedStore()
const selectedItems = computed(() => downedStore.ListDataShow.filter(item => downedStore.ListSelected.has(item.DownID)))
const canOpenSelectedLocal = computed(() => selectedItems.value.some(item => !item.Info.offlineProvider && !item.Info.ariaRemote))
const isCloudDownload = (file: IStateDownFile) => !!file.Info.offlineProvider
const accountNames = ref<Record<string, string>>({})
const cloudSourceLabel = (item: IStateDownFile) => getCloudDownloadSourceLabel(item.Info, accountNames.value[item.Info.user_id])

onMounted(async () => {
  const users = await UserDAL.GetUserListFromDB().catch(() => [])
  accountNames.value = Object.fromEntries(users.filter((user) => user?.user_id).map((user) => [user.user_id, user.nick_name || user.user_name || user.name || user.user_id]))
})

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (appStore.appTab != 'down' || appStore.GetAppTabMenu != 'DownedRight') return

  if (TestCtrl('a', state.KeyDownEvent, () => downedStore.mSelectAll())) return
  if (TestCtrl('f', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey('f3', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey(' ', state.KeyDownEvent, () => inputsearch.value.focus())) return

  if (TestKeyboardScroll(state.KeyDownEvent, viewlist.value, downedStore)) return
  if (TestKeyboardSelect(state.KeyDownEvent, viewlist.value, downedStore, null)) return
})

const rangIsSelecting = ref(false)
const rangSelectID = ref('')
const rangSelectStart = ref('')
const rangSelectEnd = ref('')
const rangSelectFiles = ref<{ [k: string]: any }>({})
const onSelectRangStart = () => {
  onHideRightMenuScroll()
  rangIsSelecting.value = !rangIsSelecting.value
  rangSelectID.value = ''
  rangSelectStart.value = ''
  rangSelectEnd.value = ''
  rangSelectFiles.value = {}
  downedStore.mRefreshListDataShow(false)
}
const onSelectReverse = () => {
  onHideRightMenuScroll()
  const listData = downedStore.ListDataShow
  const listSelected = downedStore.GetSelected()
  const reverseSelect = xorWith(listData, listSelected, (a, b) => a.DownID === b.DownID)
  downedStore.ListSelected.clear()
  downedStore.ListFocusKey = ''
  if (reverseSelect.length > 0) {
    downedStore.mRangSelect(reverseSelect[0].DownID, reverseSelect.map(r => r.DownID))
  }
  downedStore.mRefreshListDataShow(false)
}
const onSelectCancel = () => {
  onHideRightMenuScroll()
  downedStore.ListSelected.clear()
  downedStore.ListFocusKey = ''
  downedStore.mRefreshListDataShow(false)
}

const onSelectRang = (file_id: string) => {
  if (rangIsSelecting.value && rangSelectID.value != '') {

    let startid = rangSelectID.value
    let endid = ''
    const s: { [k: string]: any } = {}
    const children = downedStore.ListDataShow
    let a = -1
    let b = -1
    for (let i = 0, maxi = children.length; i < maxi; i++) {
      if (children[i].DownID == file_id) a = i
      if (children[i].DownID == startid) b = i
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
        s[children[n].DownID] = true
      }
    }

    rangSelectStart.value = startid
    rangSelectEnd.value = endid
    rangSelectFiles.value = s
    downedStore.mRefreshListDataShow(false)
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

const handleSelectAll = () => downedStore.mSelectAll()

const handleSelect = (file_id: string, event: any, isCtrl: boolean = false) => {
  onHideRightMenuScroll()
  if (rangIsSelecting.value) {
    if (!rangSelectID.value) {
      if (!downedStore.ListSelected.has(file_id)) downedStore.mMouseSelect(file_id, true, false)
      rangSelectID.value = file_id
      rangSelectStart.value = file_id
      rangSelectFiles.value = { [file_id]: true }
    } else {
      const start = rangSelectID.value
      const children = downedStore.ListDataShow
      let a = -1
      let b = -1
      for (let i = 0, maxi = children.length; i < maxi; i++) {
        if (children[i].DownID == file_id) a = i
        if (children[i].DownID == start) b = i
        if (a > 0 && b > 0) break
      }
      const fileList: string[] = []
      if (a >= 0 && b >= 0) {
        if (a > b) [a, b] = [b, a]
        for (let n = a; n <= b; n++) {
          fileList.push(children[n].DownID)
        }
      }
      downedStore.mRangSelect(file_id, fileList)
      rangIsSelecting.value = false
      rangSelectID.value = ''
      rangSelectStart.value = ''
      rangSelectEnd.value = ''
      rangSelectFiles.value = {}
    }
    downedStore.mRefreshListDataShow(false)
  } else {
    downedStore.mMouseSelect(file_id, event.ctrlKey || isCtrl, event.shiftKey)
    if (!downedStore.ListSelected.has(file_id)) downedStore.ListFocusKey = ''
  }
}

const handleDelete = async () => await downedStore.mDeleteDowned([...downedStore.ListSelected])

const handleOpenFile = (file: IStateDownFile | null) => {
  if (file && isCloudDownload(file)) return
  downedStore.mOpenUploadedFile(file, [...downedStore.ListSelected], false)
}

const handleOpenDir = (file: IStateDownFile | null) => {
  if (file && isCloudDownload(file)) return
  downedStore.mOpenUploadedFile(file, [...downedStore.ListSelected], true)
}

const isDownloadedVideo = (file: IStateDownFile) => !file.Info.isDir && isLocalVideoPath(resolveDownloadOpenPath(file.Info))

const handleDeleteAll = async () => await downedStore.mDeleteAllDowned()

const handleSearchInput = (value: string) => {
  downedStore.mSearchListData(value)
  RefreshScrollTo(viewlist.value.$el, 0)
}
const handleSearchEnter = (event: any) => {
  event.target.blur()
  RefreshScroll(viewlist.value.$el)
}
const handleRightClick = (e: { event: MouseEvent; node: any }) => {
  let key = e.node.key
  if (!downedStore.ListSelected.has(key)) downedStore.mMouseSelect(key, false, false)
  onShowRightMenu('downedrightmenu', e.event.clientX, e.event.clientY)
}
</script>

<template>
  <div style="height: 7px"></div>
  <div class='toppanbtns' style='height: 26px'>
    <div style="min-height: 26px; max-width: 100%; flex-shrink: 0; flex-grow: 0">
      <div class="toppannav">
        <div class="toppannavitem" :title="t('transfer.downloaded')">
          <span> {{ t('transfer.downloaded') }} </span>
        </div>
      </div>
    </div>
    <div class='flex flexauto'></div>
    <div class="flex flexnoauto cellcount" :title="t('down.totalDownloadedRecords')">
      <a-badge color="#637dff" :text="`${t('down.totalRecords')} ${downedStore.ListStats.count}`" />
    </div>
  </div>
  <div style="height: 14px"></div>
  <div class="toppanbtns" style="height: 26px">
    <div class="toppanbtn" v-show="downedStore.IsListSelected">
      <a-button v-if="canOpenSelectedLocal" type="text" size="small" tabindex="-1" :title="t('down.openFile')" @click="handleOpenFile(null)"><IconFont name="iconwenjian" />{{ t('down.openFile') }}</a-button>
      <a-button v-if="canOpenSelectedLocal" type="text" size="small" tabindex="-1" :title="t('down.openFolder')" @click="handleOpenDir(null)"><IconFont name="iconfolder" />{{ t('down.openFolder') }}</a-button>
      <a-button type="text" size="small" tabindex="-1" :title="t('file.delete')" @click="handleDelete"><IconFont name="icondelete" />{{ t('file.delete') }}</a-button>
      <a-button type="text" size="small" tabindex="-1"><IconFont name="icondian" /></a-button>

      <a-button type="text" size="small" tabindex="-1" :title="t('down.clearAllDownloaded')" @click="handleDeleteAll"><IconFont name="icondelete" />{{ t('down.clearAllDownloaded') }}</a-button>
    </div>
    <div class="toppanbtn" v-show="!downedStore.IsListSelected">
      <a-button type="text" size="small" tabindex="-1" :title="t('down.clearAllDownloaded')" @click="handleDeleteAll"><IconFont name="icondelete" />{{ t('down.clearAllDownloaded') }}</a-button>
    </div>
    <div style="flex-grow: 1"></div>
    <div class="toppanbtn">
      <a-input-search
        tabindex="-1"
        ref="inputsearch"
        size="small"
        title="Ctrl+F / F3 / Space"
        :placeholder="t('share.quickFilter')"
        allow-clear
        v-model="downedStore.ListSearchKey"
        @clear='(e:any)=>handleSearchInput("")'
        @input="(val:any)=>handleSearchInput(val as string)"
        @press-enter="handleSearchEnter"
        @keydown.esc="($event.target as any).blur()"
      />
    </div>
    <div></div>
  </div>
  <div style="height: 9px"></div>
  <div class="toppanarea">
    <div style="margin: 0 3px">
      <AntdTooltip :title="t('share.selectAll')" placement="left">
        <a-button shape="circle" type="text" tabindex="-1" class="select all" @click="handleSelectAll" title="Ctrl+A">
          <IconFont :name="downedStore.IsListSelectedAll ? 'iconrsuccess' : 'iconpic2'" />
        </a-button>
      </AntdTooltip>
    </div>
    <div class="selectInfo">{{ downedStore.ListDataSelectCountInfo }}</div>
    <div style='margin: 0 2px'>
      <AntdTooltip placement='rightTop' v-if="downedStore.ListDataShow.length > 0">
        <a-button shape='square' type='text' tabindex='-1' class='qujian'
                  :status="rangIsSelecting ? 'danger' : 'normal'" title='Ctrl+Q' @click='onSelectRangStart'>
          {{ rangIsSelecting ? t('share.cancelSelect') : t('share.rangeSelect') }}
        </a-button>
        <template #title>
          <div>
            {{ t('share.rangeStep1') }}
            <br />
            {{ t('share.rangeStep2') }}
            <br />
            {{ t('share.rangeStep3') }}
          </div>
        </template>
      </AntdTooltip>
      <a-button shape='square'
                v-if='!rangIsSelecting && downedStore.ListSelected.size > 0 && downedStore.ListSelected.size < downedStore.ListDataShow.length'
                type='text'
                tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectReverse'>
        {{ t('share.reverseSelect') }}
      </a-button>
      <a-button shape='square' v-if='!rangIsSelecting && downedStore.ListSelected.size > 0' type='text' tabindex='-1' class='qujian'
                status='normal' @click='onSelectCancel'>
        {{ t('share.cancelSelectedItems') }}
      </a-button>
    </div>
  </div>
  <div class="toppanlist" @keydown.space.prevent="() => true">
    <a-list
      ref="viewlist"
      :bordered="false"
      :split="false"
      :max-height="winStore.GetListHeightNumber"
      :virtualListProps="{
        height: winStore.GetListHeightNumber,
        isStaticItemHeight: true,
        estimatedSize: 50,
        threshold: 1,
        itemKey: 'DownID'
      }"
      style="width: 100%"
      :data="downedStore.ListDataShow"
      :loading="downedStore.ListLoading"
      tabindex="-1"
      @scroll="onHideRightMenuScroll"
    >
      <template #item="{ item, index }">
        <div :key="item.DownID" class="listitemdiv" :data-id="item.DownID">
          <div
            :class="'fileitem' + (downedStore.ListSelected.has(item.DownID) ? ' selected' : '') + (downedStore.ListFocusKey == item.DownID ? ' focus' : '')"
            @click="handleSelect(item.DownID, $event)"
            @mouseover='onSelectRang(item.DownID)'
            @contextmenu="(event:MouseEvent)=>handleRightClick({event,node:{key:item.DownID}} )"
          >
            <div
              :class="'rangselect ' + (rangSelectFiles[item.DownID] ? (rangSelectStart == item.DownID ? 'rangstart' : rangSelectEnd == item.DownID ? 'rangend' : 'rang') : '')">
              <a-button shape='circle' type='text' tabindex='-1' class='select' :title='index'
                        @click.prevent.stop='handleSelect(item.DownID, $event, true)'>
                <IconFont :name="downedStore.ListSelected.has(item.DownID) ? 'iconrsuccess' : 'iconpic2'" />
              </a-button>
            </div>
            <div class="fileicon">
              <IconFont :name="item.Info.icon" aria-hidden="true" />
            </div>
            <div class="filename" @dblclick.stop="!isCloudDownload(item) && handleOpenFile(item)">
              <div :title="isCloudDownload(item) ? t('down.savedInCloud') : item.Info.localFilePath || t('down.doubleClickOpen')">
                {{ item.Info.name }}
                <span v-if='item.Info.offlineProvider' class='cloud-origin' :title='cloudSourceLabel(item)'>
                  <IconFont name='iconcloud-download' aria-hidden='true' />
                </span>
                <span v-if='item.Info.offlineProvider' class='cloud-source'>{{ cloudSourceLabel(item) }}</span>
              </div>
            </div>
            <div class="cell filesize">{{ item.Info.sizestr }}</div>
            <div class='toppanbtn'>
              <a :title="isDownloadedVideo(item) ? t('down.playVideo') : t('down.openFile')" v-if='!item.Info.ariaRemote && !isCloudDownload(item)' @click="handleOpenFile(item)"><IconFont name="iconwenjian" /></a>&nbsp;&nbsp;
              <a :title="t('down.openFolder')" v-if='!item.Info.ariaRemote && !isCloudDownload(item)' @click="handleOpenDir(item)"><IconFont name="iconfolder" /></a>&nbsp;&nbsp;
              <a :title="t('file.delete')" @click="handleDelete"><IconFont name="icondelete" /></a>&nbsp;&nbsp;
            </div>
          </div>
        </div>
      </template>
    </a-list>
    <a-dropdown id="downedrightmenu" class="rightmenu" :popup-visible="true" tabindex="-1" :draggable="false" style="z-index: -1; left: -200px; opacity: 0">
      <template #content>
        <a-doption v-if="canOpenSelectedLocal" @click="handleOpenFile(null)">
          <template #icon> <IconFont name="iconwenjian" /> </template>
          <template #default>{{ t('down.openFile') }}</template>
        </a-doption>
        <a-doption v-if="canOpenSelectedLocal" @click="handleOpenDir(null)">
          <template #icon> <IconFont name="iconfolder" /> </template>
          <template #default>{{ t('down.openFolder') }}</template>
        </a-doption>
        <a-doption @click="handleDelete" class="danger">
          <template #icon> <IconFont name="icondelete" /> </template>
          <template #default>{{ t('file.delete') }}</template>
        </a-doption>
      </template>
    </a-dropdown>
  </div>
</template>

<style scoped>
.cloud-origin {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: #637dff;
  vertical-align: middle;
}

.cloud-source {
  margin-left: 6px;
  color: var(--color-text-4);
  font-size: 11px;
}

</style>
