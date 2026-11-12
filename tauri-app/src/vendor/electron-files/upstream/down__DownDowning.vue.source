<script setup lang='ts'>
import { computed, onMounted, ref, watch } from 'vue'
import {
  KeyboardState,
  MouseState,
  useAppStore,
  useDowningStore,
  useKeyboardStore,
  useMouseStore,
  useUserStore,
  useUploadingStore,
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
import { TestButton } from '../utils/mosehelper'
import { xorWith } from 'lodash'
import UrlDownloadModal from './UrlDownloadModal.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import TorrentFileSelector from './TorrentFileSelector.vue'
import DragDropZone from '../components/DragDropZone.vue'
import UserDAL from '../user/userdal'
import { getCloudDownloadSourceLabel } from './cloudDownloadSource'
import { IStateDownFile } from './DownDAL'
import { t } from '../i18n'

const viewlist = ref()
const inputsearch = ref()
const urlDownloadVisible = ref(false)
const taskDetailVisible = ref(false)
const taskDetailGid = ref('')
const torrentSelectorVisible = ref(false)
const torrentSelectorGid = ref('')

const appStore = useAppStore()
const winStore = useWinStore()
const downingStore = useDowningStore()
const userStore = useUserStore()
const selectedHasLocalTask = computed(() => downingStore.ListDataShow.some(item => downingStore.ListSelected.has(item.DownID) && !item.Info.offlineProvider))
const focusedIsCloudTask = computed(() => {
  const key = downingStore.ListFocusKey || [...downingStore.ListSelected][0]
  return !!downingStore.ListDataShow.find(item => item.DownID === key)?.Info.offlineProvider
})
const accountNames = ref<Record<string, string>>({})
const cloudSourceLabel = (item: IStateDownFile) => getCloudDownloadSourceLabel(item.Info, accountNames.value[item.Info.user_id])

onMounted(async () => {
  const users = await UserDAL.GetUserListFromDB().catch(() => [])
  accountNames.value = Object.fromEntries(users.filter((user) => user?.user_id).map((user) => [user.user_id, user.nick_name || user.user_name || user.name || user.user_id]))
})
const isDowning = computed(() => downingStore.ListDataDowningCount > 0)
watch(isDowning, (value, oldValue) => {
  if (value !== oldValue && window.WebToElectron) {
    if (value) {
      window.WebToElectron({ cmd: 'preventSleep', flag: 1 })
    } else if (useUploadingStore().ListDataUploadingCount == 0) {
      window.WebToElectron({ cmd: 'preventSleep', flag: 0 })
    }
  }
})

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (appStore.appTab != 'down' || appStore.GetAppTabMenu != 'DowningRight') return

  if (TestCtrl('a', state.KeyDownEvent, () => downingStore.mSelectAll())) return
  if (TestCtrl('f', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey('f3', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey(' ', state.KeyDownEvent, () => inputsearch.value.focus())) return

  if (TestKeyboardScroll(state.KeyDownEvent, viewlist.value, downingStore)) return
  if (TestKeyboardSelect(state.KeyDownEvent, viewlist.value, downingStore, null)) return
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
  downingStore.mRefreshListDataShow(false)
}
const onSelectReverse = () => {
  onHideRightMenuScroll()
  const listData = downingStore.ListDataShow
  const listSelected = downingStore.GetSelected()
  const reverseSelect = xorWith(listData, listSelected, (a, b) => a.DownID === b.DownID)
  downingStore.ListSelected.clear()
  downingStore.ListFocusKey = ''
  if (reverseSelect.length > 0) {
    downingStore.mRangSelect(reverseSelect[0].DownID, reverseSelect.map(r => r.DownID))
  }
  downingStore.mRefreshListDataShow(false)
}
const onSelectCancel = () => {
  onHideRightMenuScroll()
  downingStore.ListSelected.clear()
  downingStore.ListFocusKey = ''
  downingStore.mRefreshListDataShow(false)
}

const onSelectRang = (file_id: string) => {
  if (rangIsSelecting.value && rangSelectID.value != '') {

    let startid = rangSelectID.value
    let endid = ''
    const s: { [k: string]: any } = {}
    const children = downingStore.ListDataShow
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
    downingStore.mRefreshListDataShow(false)
  }
}

const handleSelectAll = () => downingStore.mSelectAll()
const handleSelect = (file_id: string, event: any, isCtrl: boolean = false) => {
  onHideRightMenuScroll()
  if (rangIsSelecting.value) {
    if (!rangSelectID.value) {
      if (!downingStore.ListSelected.has(file_id)) downingStore.mMouseSelect(file_id, true, false)
      rangSelectID.value = file_id
      rangSelectStart.value = file_id
      rangSelectFiles.value = { [file_id]: true }
    } else {
      const start = rangSelectID.value
      const children = downingStore.ListDataShow
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
      downingStore.mRangSelect(file_id, fileList)
      rangIsSelecting.value = false
      rangSelectID.value = ''
      rangSelectStart.value = ''
      rangSelectEnd.value = ''
      rangSelectFiles.value = {}
    }
    downingStore.mRefreshListDataShow(false)
  } else {
    downingStore.mMouseSelect(file_id, event.ctrlKey || isCtrl, event.shiftKey)
    if (!downingStore.ListSelected.has(file_id)) downingStore.ListFocusKey = ''
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

const handleStart = () => downingStore.mStartDowning()

const handleStartAll = () => downingStore.mStartAllDowning()

const handleStop = () => downingStore.mStopDowning()

const handleStopAll = async () => await downingStore.mStopAllDowning()

const handleDelete = async () => await downingStore.mDeleteDowning([...downingStore.ListSelected])

const handleDeleteAll = async () => await downingStore.mDeleteAllDowning()

const handleTop = () => downingStore.mOrderDowning([...downingStore.ListSelected])

const handleSearchInput = (value: string) => {
  downingStore.mSearchListData(value)
  RefreshScrollTo(viewlist.value.$el, 0)
}
const handleSearchEnter = (event: any) => {
  event.target.blur()
  RefreshScroll(viewlist.value.$el)
}
const handleRightClick = (e: { event: MouseEvent; node: any }) => {
  let key = e.node.key
  if (!downingStore.ListSelected.has(key)) downingStore.mMouseSelect(key, false, false)
  onShowRightMenu('downingrightmenu', e.event.clientX, e.event.clientY)
}

const focusedIsBT = computed(() => {
  const key = downingStore.ListFocusKey || [...downingStore.ListSelected][0]
  if (!key) return false
  const item = downingStore.ListDataShow.find((i: any) => i.DownID === key)
  const st = item?.Info?.sourceType
  return st === 'magnet' || st === 'torrent' || st === 'torrent-url'
})

const handleUrlDownload = () => {
  dropPrefilledUrl.value = ''
  urlDownloadVisible.value = true
}

const dropPrefilledUrl = ref('')
const handleDropUrl = (url: string) => {
  dropPrefilledUrl.value = url
  urlDownloadVisible.value = true
}

const handleTaskDetail = () => {
  const selected = [...downingStore.ListSelected]
  const key = selected[0] || downingStore.ListFocusKey
  if (!key) return
  const item = downingStore.ListDataShow.find((i: any) => i.DownID === key)
  if (!item) return
  taskDetailGid.value = item.Info?.GID || ''
  taskDetailVisible.value = true
}

const handleTorrentFiles = () => {
  const selected = [...downingStore.ListSelected]
  const key = selected[0] || downingStore.ListFocusKey
  if (!key) return
  const item = downingStore.ListDataShow.find((i: any) => i.DownID === key)
  if (!item) return
  torrentSelectorGid.value = item.Info?.GID || ''
  torrentSelectorVisible.value = true
}
</script>

<template>
  <DragDropZone style='display: contents' @drop-url='handleDropUrl'>
  <div style="height: 7px"></div>
  <div class='toppanbtns' style='height: 26px'>
    <div style="min-height: 26px; max-width: 100%; flex-shrink: 0; flex-grow: 0">
      <div class="toppannav">
        <div class="toppannavitem" :title="t('transfer.downloading')">
          <span> {{ t('transfer.downloading') }} </span>
        </div>
      </div>
    </div>
    <div class='flex flexauto'></div>
    <div class='flex flexnoauto cellcount' :title="t('transfer.totalFileCount')">
      <a-badge color='#637dff' :text="t('transfer.total') + ' ' + downingStore.ListStats.count" />
    </div>
    <div class='flex flexnoauto cellcount' :title="t('transfer.runningDownloadCount')">
      <a-badge color='#637dff' :text="t('transfer.download') + ' ' + downingStore.ListStats.runningCount" />
    </div>
    <div class='flex flexnoauto cellcount' :title="t('transfer.totalFileSize')">
      <a-badge color='#637dff' :text="t('transfer.size') + ' ' + downingStore.ListStats.totalSizeStr" />
    </div>
  </div>
  <div style='height: 14px'></div>
  <div class='toppanbtns' style='height: 26px'>
    <div class='toppanbtn' v-show='downingStore.IsListSelected'>
      <a-button v-if='selectedHasLocalTask' type='text' size='small' tabindex='-1' @click='handleStart'><IconFont name="iconstart" />{{ t('transfer.start') }}
      </a-button>
      <a-button v-if='selectedHasLocalTask' type='text' size='small' tabindex='-1' @click='handleStop'><IconFont name="iconpause" />{{ t('transfer.pause') }}
      </a-button>
      <a-button v-if='selectedHasLocalTask' type='text' size='small' tabindex='-1' @click='handleTop'><IconFont name="iconyouxian" />{{ t('transfer.prioritize') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleDelete'><IconFont name="icondelete" />{{ t('common.delete') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1'><IconFont name="icondian" /></a-button>

      <a-button type='text' size='small' tabindex='-1' @click='handleStartAll'><IconFont name="iconstart" />{{ t('transfer.startAll') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleStopAll'><IconFont name="iconpause" />{{ t('transfer.pauseAll') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleDeleteAll'><IconFont name="icondelete" />{{ t('transfer.deleteAll') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleUrlDownload'>
        <IconFont name="iconcloud-download" />{{ t('transfer.newDownload') }}
      </a-button>
    </div>
    <div class='toppanbtn' v-show='!downingStore.IsListSelected'>
      <a-button type='text' size='small' tabindex='-1' @click='handleUrlDownload'>
        <IconFont name="iconcloud-download" />{{ t('transfer.newDownload') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleStartAll'><IconFont name="iconstart" />{{ t('transfer.startAll') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleStopAll'><IconFont name="iconpause" />{{ t('transfer.pauseAll') }}
      </a-button>
      <a-button type='text' size='small' tabindex='-1' @click='handleDeleteAll'><IconFont name="icondelete" />{{ t('transfer.deleteAll') }}
      </a-button>
    </div>
    <div style='flex-grow: 1'></div>
    <div class='toppanbtn'>
      <a-input-search
        tabindex='-1'
        ref='inputsearch'
        size='small'
        title='Ctrl+F / F3 / Space'
        :placeholder="t('transfer.quickFilter')"
        allow-clear
        v-model='downingStore.ListSearchKey'
        @clear='(e:any)=>handleSearchInput("")'
        @input='(val:any)=>handleSearchInput(val as string)'
        @press-enter='handleSearchEnter'
        @keydown.esc='($event.target as any).blur()'
      />
    </div>
    <div></div>
  </div>
  <div style='height: 9px'></div>
  <div class='toppanarea'>
    <div style='margin: 0 3px'>
      <AntdTooltip :title="t('transfer.selectAllTooltip')" placement='left'>
        <a-button shape='circle' type='text' tabindex='-1' class='select all' @click='handleSelectAll' title='Ctrl+A'>
          <IconFont :name="downingStore.IsListSelectedAll ? 'iconrsuccess' : 'iconpic2'" />
        </a-button>
      </AntdTooltip>
    </div>
    <div class='selectInfo'>{{ downingStore.ListDataSelectCountInfo }}</div>
    <div style='margin: 0 2px'>
      <AntdTooltip placement='rightTop' v-if="downingStore.ListDataShow.length > 0">
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
                v-if='!rangIsSelecting && downingStore.ListSelected.size > 0 && downingStore.ListSelected.size < downingStore.ListDataShow.length'
                type='text'
                tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectReverse'>
        {{ t('transfer.invertSelection') }}
      </a-button>
      <a-button shape='square' v-if='!rangIsSelecting && downingStore.ListSelected.size > 0' type='text' tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectCancel'>
        {{ t('transfer.cancelSelected') }}
      </a-button>
    </div>
  </div>
  <div class='toppanlist' @keydown.space.prevent='() => true'>
    <a-list
      ref='viewlist'
      :bordered='false'
      :split='false'
      :max-height='winStore.GetListHeightNumber'
      :virtualListProps="{
        height: winStore.GetListHeightNumber,
        isStaticItemHeight: true,
        estimatedSize: 50,
        threshold: 1,
        itemKey: 'DownID'
      }"
      style='width: 100%'
      :data='downingStore.ListDataShow'
      :loading='downingStore.ListLoading'
      tabindex='-1'
      @scroll='onHideRightMenuScroll'
    >
      <template #item='{ item, index }'>
        <div :key='item.DownID' class='listitemdiv' :data-id='item.DownID'>
          <div
            :class="'fileitem' + (downingStore.ListSelected.has(item.DownID) ? ' selected' : '') + (downingStore.ListFocusKey == item.DownID ? ' focus' : '')"
            @click='handleSelect(item.DownID, $event)'
            @mouseover='onSelectRang(item.DownID)'
            @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:item.DownID}} )'
          >
            <div
              :class="'rangselect ' + (rangSelectFiles[item.DownID] ? (rangSelectStart == item.DownID ? 'rangstart' : rangSelectEnd == item.DownID ? 'rangend' : 'rang') : '')">
              <a-button shape='circle' type='text' tabindex='-1' class='select' :title='index'
                        @click.prevent.stop='handleSelect(item.DownID, $event, true)'>
                <IconFont :name="downingStore.ListSelected.has(item.DownID) ? 'iconrsuccess' : 'iconpic2'" />
              </a-button>
            </div>
            <div class='fileicon'>
              <IconFont :name="item.Info.icon" aria-hidden='true' />
            </div>
            <div class='filename'>
              <div :title='item.Info.localFilePath'>
                {{ item.Info.name }}
                <span v-if='item.Info.offlineProvider' class='cloud-origin' :title='cloudSourceLabel(item)'>
                  <IconFont name='iconcloud-download' aria-hidden='true' />
                </span>
                <span v-if='item.Info.offlineProvider' class='cloud-source'>{{ cloudSourceLabel(item) }}</span>
              </div>
            </div>
            <div class='cell filesize'>{{ item.Info.sizestr }}</div>
            <div class='downprogress'>
              <div class='transfering-state'>
                <p class='text-state'>{{ item.Down.DownState }}</p>
                <div class='progress-total'>
                  <div
                    :class="item.Down.IsDowning ? 'progress-current active' : item.Down.IsCompleted ? 'progress-current succeed' : item.Down.IsFailed ? 'progress-current error' : 'progress-current'"
                    :style="'width: ' + item.Down.DownProcess.toString() + '%'"
                  ></div>
                </div>
                <p v-if='item.Down.IsFailed' class='text-error'>{{ item.Down.FailedMessage }}</p>
              </div>
            </div>
            <div class='downspeed'>{{ item.Down.DownSpeedStr }}</div>
          </div>
        </div>
      </template>
    </a-list>
    <a-dropdown id='downingrightmenu' class='rightmenu' :popup-visible='true' tabindex='-1' :draggable='false'
                style='z-index: -1; left: -200px; opacity: 0'>
      <template #content>
        <a-doption v-if='!focusedIsCloudTask' @click='handleStart'>
          <template #icon><IconFont name="iconstart" /></template>
          <template #default>{{ t('transfer.start') }}</template>
        </a-doption>
        <a-doption v-if='!focusedIsCloudTask' @click='handleStop'>
          <template #icon><IconFont name="iconpause" /></template>
          <template #default>{{ t('transfer.pause') }}</template>
        </a-doption>
        <a-doption v-if='!focusedIsCloudTask' @click='handleTop'>
          <template #icon><IconFont name="iconyouxian" /></template>
          <template #default>{{ t('transfer.prioritize') }}</template>
        </a-doption>
        <a-doption @click='handleDelete' class='danger'>
          <template #icon><IconFont name="icondelete" /></template>
          <template #default>{{ t('common.delete') }}</template>
        </a-doption>
        <a-doption v-if='!focusedIsCloudTask' @click='handleTaskDetail'>
          <template #icon><IconFont name="iconinfo" /></template>
          <template #default>{{ t('transfer.taskDetail') }}</template>
        </a-doption>
        <a-doption v-if='focusedIsBT' @click='handleTorrentFiles'>
          <template #icon><IconFont name="iconfile" /></template>
          <template #default>{{ t('common.select') }}{{ t('transfer.file') }}</template>
        </a-doption>
      </template>
    </a-dropdown>
  </div>
  <UrlDownloadModal v-model:visible="urlDownloadVisible" :initial-url="dropPrefilledUrl" />
  <TaskDetailDrawer v-model:visible="taskDetailVisible" :gid="taskDetailGid" />
  <TorrentFileSelector v-model:visible="torrentSelectorVisible" :gid="torrentSelectorGid" />
  </DragDropZone>
</template>

<style scoped>
.cloud-origin {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: #637dff;
  vertical-align: middle;
}

.cloud-origin :deep(svg) {
  width: 14px;
  height: 14px;
}

.cloud-source {
  margin-left: 6px;
  color: var(--color-text-4);
  font-size: 11px;
}
.downprogress {
  flex-grow: 0;
  flex-shrink: 0;
  width: 110px;
  margin-right: 8px;
}

.downspeed {
  flex-grow: 0;
  flex-shrink: 0;
  width: 130px;
  overflow: hidden;
  color: var(--color-text-4);
  font-size: 25px;
  text-align: right;
  text-overflow: clip;
  white-space: nowrap;
  word-break: keep-all;
}

@media only screen and (min-width: 900px) {
  .downprogress {
    width: 150px;
  }
}

@media only screen and (min-width: 960px) {
  .downprogress {
    width: 170px;
  }
}

@media only screen and (min-width: 1000px) {
  .downprogress {
    width: 180px;
  }

  .downspeed {
    width: 150px;
  }
}

.transfering-state {
  display: block;
  width: 100%;
  overflow: visible;
}

.text-state {
  max-width: 100%;
  height: 16px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  -o-text-overflow: ellipsis;
  text-overflow: ellipsis;
}

.text-error {
  width: 100%;
  min-height: 16px;
  max-height: 48px;
  margin: 0;
  overflow: auto;
  color: #f35b51;
  font-size: 12px;
  line-height: 16px;
  white-space: normal;
  word-break: break-word;
}

.progress-total {
  position: relative;
  width: 100%;
  height: 3px;
  margin-top: 2px;
  background: #84858d14;
  border-radius: 1.5px;
}

body[arco-theme='dark'] .progress-total {
  background: #84858d;
}

.progress-total .progress-current {
  position: absolute;
  top: 0;
  left: 0;
  min-width: 6px;
  max-width: 100%;
  height: 100%;
  background: #00000033;
  border-radius: 1.5px;
  background: var(--color-primary-light-4);
  -webkit-transition: width 0.3s ease, opacity 0.3s ease;
  -o-transition: width 0.3s ease, opacity 0.3s ease;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.progress-total .progress-current.succeed {
  background: #099970;
}

.progress-total .progress-current.error {
  background: #f35b51;
}

.progress-total .progress-current.active {
  background: linear-gradient(270deg, #ffba7a 0%, #ff74c7 8.56%, #637dff 26.04%, rgba(99, 125, 255, 0.2) 100%);
}
</style>
