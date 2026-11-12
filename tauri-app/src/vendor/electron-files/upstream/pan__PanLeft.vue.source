<script setup lang='ts'>
import { computed, ref, watchEffect } from 'vue'

import { Tree as AntdTree } from 'ant-design-vue'
import usePanTreeStore, { PanTreeState } from './pantreestore'
import MySwitchTab from '../layout/MySwitchTab.vue'
import { KeyboardState, useAppStore, useKeyboardStore, usePanFileStore, useSettingStore, useWinStore } from '../store'
import PanDAL from './pandal'
import UserDAL from '../user/userdal'
import { onHideRightMenuScroll, onShowRightMenu, TestCtrl } from '../utils/keyboardhelper'
import DirLeftMenu from './menus/DirLeftMenu.vue'
import FolderPreviewPopover from './menus/FolderPreviewPopover.vue'
import TreeStore, { TreeNodeData } from '../store/treestore'
import { dropMoveSelectedFile } from './topbtns/topbtn'
import message from '../utils/message'
import { modalUpload } from '../utils/modal'
import { getDriveType as GetDriveType } from '../drive/context'
import { isAliyunUser, isBaiduUser, isBoxUser, isCloud123User, isCloud139User, isCloud189User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser, isQuarkUser, isRemoteDriveUser } from '../utils/driveIdentity'
import { t } from '../i18n'
import { supportsLocalUpload, supportsMove, supportsSearch } from '../drive/providerFeatures'
import { quickFileId, type QuickFileEntry } from './quickFiles'

const treeref = ref()
const inputselectType = ref('backup')
const winStore = useWinStore()
const treeHeight = computed(() => winStore.height - 42 - 56 - 24 - 4)
const quickHeight = computed(() => winStore.height - 42 - 56 - 24 - 4 - 280 - 28)
const appStore = useAppStore()
const pantreeStore = usePanTreeStore()
const settingStore = useSettingStore()
const isCloudUser = computed(() => isCloud123User(pantreeStore.user_id || ''))
const isAliyunAccount = computed(() => isAliyunUser(pantreeStore.user_id || UserDAL.GetUserToken(pantreeStore.user_id || '')))

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (appStore.appTab != 'pan') return
  if (TestCtrl('1', state.KeyDownEvent, () => handleQuickSelect(1))) return
  if (TestCtrl('2', state.KeyDownEvent, () => handleQuickSelect(2))) return
  if (TestCtrl('3', state.KeyDownEvent, () => handleQuickSelect(3))) return
  if (TestCtrl('4', state.KeyDownEvent, () => handleQuickSelect(4))) return
  if (TestCtrl('5', state.KeyDownEvent, () => handleQuickSelect(5))) return
  if (TestCtrl('6', state.KeyDownEvent, () => handleQuickSelect(6))) return
  if (TestCtrl('7', state.KeyDownEvent, () => handleQuickSelect(7))) return
  if (TestCtrl('8', state.KeyDownEvent, () => handleQuickSelect(8))) return
  if (TestCtrl('9', state.KeyDownEvent, () => handleQuickSelect(9))) return
})

const switchValues = computed(() => [
  { key: 'wangpan', title: t('pan.files'), alt: '' },
  { key: 'kuaijie', title: t('pan.shortcuts'), alt: '' }
])

let DriveID = pantreeStore.drive_id
pantreeStore.$subscribe((_m: any, state: PanTreeState) => {
  if (state.drive_id != DriveID) {
    DriveID = state.drive_id
    inputselectType.value = GetDriveType(state.user_id, state.drive_id).name
    folderPreviewRef.value?.cancel()
  }
})

const colorTreeData = ref<TreeNodeData[]>([])
watchEffect(() => {
  const list = settingStore.uiFileColorArray
  const nodeList: TreeNodeData[] = []
  for (let i = 0; i < list.length; i++) {
    nodeList.push({
      __v_skip: true,
      key: 'color' + list[i].key.replace('#', 'c') + ' ' + (list[i].title || list[i].key),
      parent_file_id: '',
      title: list[i].title || list[i].key,
      namesearch: list[i].key.replace('#', 'c'),
      children: [],
      isLeaf: true
    } as TreeNodeData)
  }
  Object.freeze(nodeList)
  colorTreeData.value = nodeList
})
watchEffect(() => {
  const scrollToDir = pantreeStore.scrollToDir
  if (scrollToDir) treeref.value.scrollTo({ key: scrollToDir, align: 'top', offset: 220 })
  pantreeStore.mSaveTreeScrollTo('')
})

const handleTreeRightClick = (e: { event: MouseEvent; node: any }) => {
  const { parent = undefined, key } = e.node
  if (key.startsWith('search')) return
  const isSingleRootDrive = isCloud123User(pantreeStore.user_id || '') || isDrive115User(pantreeStore.user_id || '') || isBaiduUser(pantreeStore.user_id || '') || isPikPakUser(pantreeStore.user_id || '') || isDropboxUser(pantreeStore.user_id || '') || isOneDriveUser(pantreeStore.user_id || '') || isBoxUser(pantreeStore.user_id || '') || isGoogleUser(pantreeStore.user_id || '') || isRemoteDriveUser(pantreeStore.user_id || '')
  if (!isSingleRootDrive && key.length < 40) return
  pantreeStore.mTreeSelected(e)
  onShowRightMenu('leftpanmenu', e.event.clientX, e.event.clientY)
}

const onRowItemDragEnter = (ev: any) => {
  if (!supportsMove(pantreeStore.user_id || '', pantreeStore.drive_id || '') && !supportsLocalUpload(pantreeStore.user_id || '', pantreeStore.drive_id || '')) return
  ev.stopPropagation()
  ev.preventDefault()
  ev.target.style.outline = '2px dotted #637dff'
  ev.target.style.background = 'rgba(var(--primary-6),0.3)'
  ev.dataTransfer.dropEffect = 'move'
}
const onRowItemDragLeave = (ev: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  ev.target.style.outline = 'none'
  ev.target.style.background = ''
}
const onRowItemDragOver = (ev: any) => {
  if (!supportsMove(pantreeStore.user_id || '', pantreeStore.drive_id || '') && !supportsLocalUpload(pantreeStore.user_id || '', pantreeStore.drive_id || '')) return
  ev.stopPropagation()
  ev.preventDefault()
}

const onQuickDragEnter = (ev: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  ev.target.style.outline = '2px dotted #637dff'
  ev.target.style.background = 'rgba(var(--primary-6),0.3)'
  ev.dataTransfer.dropEffect = 'copy'
}

const onQuickDragOver = (ev: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'copy'
}

const onRowItemDrop = (ev: any, data: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  ev.target.style.outline = 'none'
  ev.target.style.background = ''
  const filesList = ev.dataTransfer.files
  if (filesList && filesList.length > 0) {
    if (!supportsLocalUpload(pantreeStore.user_id || '', data.drive_id || pantreeStore.drive_id || '')) {
      message.warning(t('pan.readOnlyNoUpload'))
      return
    }
    const files: string[] = []
    for (let i = 0, maxi = filesList.length; i < maxi; i++) {
      const path = filesList[i].path
      files.push(path)
    }
    modalUpload(data.key, files)
  } else {
    if (!supportsMove(pantreeStore.user_id || '', pantreeStore.drive_id || '')) {
      message.warning(t('pan.readOnlyNoMove'))
      return
    }
    dropMoveSelectedFile(data.drive_id, data.key, true)
  }
}

const onQuickDrop = (ev: any) => {
  ev.preventDefault()
  ev.target.style.outline = 'none'
  ev.target.style.background = ''

  const list: QuickFileEntry[] = []
  const selectedFile = usePanFileStore().GetSelected()
  for (let i = 0, maxi = selectedFile.length; i < maxi; i++) {
    if (selectedFile[i].isDir) {
      const item = selectedFile[i]
      const driveType = GetDriveType(pantreeStore.user_id, item.drive_id)
      const userToken = UserDAL.GetUserToken(pantreeStore.user_id)
      const dirPath = TreeStore.GetDirPath(item.drive_id, item.file_id).map(node => ({
        drive_id: node.drive_id,
        file_id: node.file_id,
        parent_file_id: node.parent_file_id,
        name: node.name,
        path: node.path,
        description: node.description
      }))
      list.push({
        id: quickFileId(pantreeStore.user_id, item.drive_id, item.file_id),
        user_id: pantreeStore.user_id,
        user_name: userToken.nick_name || userToken.user_name || userToken.name || pantreeStore.user_id,
        provider: driveType.name || '',
        drive_id: item.drive_id,
        drive_name: driveType.title,
        file_id: item.file_id,
        parent_file_id: item.parent_file_id,
        path: item.path || '',
        title: item.name,
        description: item.description || '',
        dir_path: dirPath
      })
    }
  }
  if (list.length == 0) {
    message.error(t('pan.noFolderSelected'))
    return
  }
  PanDAL.updateQuickFile(list)
}
const handleQuickDelete = (id: string) => {
  PanDAL.deleteQuickFile(id)
}
const openQuickFile = async (item: QuickFileEntry) => {
  if (item.user_id !== pantreeStore.user_id) {
    const changed = await UserDAL.UserChange(item.user_id)
    if (!changed) return
  }
  await PanDAL.aOpenQuickFile(item)
}
const handleQuickSelect = async (index: number) => {
  const array = PanDAL.getQuickFileList()
  if (array.length >= index) {
    await openQuickFile(array[index - 1])
  }
}
const handleQuickTreeSelect = async (_keys: any[], e: any) => {
  const item = PanDAL.getQuickFileList().find(shortcut => shortcut.id === e.node.key)
  if (item) await openQuickFile(item)
}
const handleColorTreeSelect = (_keys: any[], e: any) => {
  const drive_id = pantreeStore.backup_drive_id || pantreeStore.resource_drive_id
  pantreeStore.mTreeSelected({ ...e, node: { ...e.node, drive_id } }, true)
}
const quickSelectedKeys = computed(() => {
  const item = PanDAL.getQuickFileList().find(shortcut => shortcut.user_id === pantreeStore.user_id && shortcut.drive_id === pantreeStore.drive_id && shortcut.file_id === pantreeStore.selectDir.file_id)
  return item ? [item.id] : []
})
const filterTreeData = computed(() => {
  const userId = pantreeStore.user_id || ''
  const isRemoteDrive = isRemoteDriveUser(userId)
  const isCloudUser = isCloud123User(userId) || isPikPakUser(userId) || isDropboxUser(userId) || isOneDriveUser(userId) || isBoxUser(userId) || isRemoteDrive
  const providerTreeData = pantreeStore.treeData.filter((item) => item.key !== 'recent' || isBoxUser(userId))
  const baseList = isCloudUser
    ? providerTreeData.filter((item) => {
      if (item.key === 'search' && !supportsSearch(userId, pantreeStore.drive_id)) return false
      if (item.key === 'backup_root') return false
      if (item.key === 'resource_root') return false
      if (item.key === 'pic_root') return false
      if ((isPikPakUser(pantreeStore.user_id || '') || isDropboxUser(pantreeStore.user_id || '') || isOneDriveUser(pantreeStore.user_id || '') || isRemoteDrive) && (item.key === 'video' || item.key === 'recover' || item.key === 'favorite')) return false
      if (isRemoteDrive && (item.key === 'trash' || item.key === 'search')) return false
      return true
    })
    : providerTreeData.filter((item) => {
      if (item.key === 'search' && !supportsSearch(userId, pantreeStore.drive_id)) return false
      if (!isAliyunAccount.value && (item.key === 'backup_root' || item.key === 'resource_root')) {
        return false
      }
      if (isBaiduUser(pantreeStore.user_id || '') && item.key === 'trash') {
        return false
      }
      if (!isAliyunAccount.value && (item.key === 'pic_root' || item.key === 'video' || item.key === 'favorite' || item.key === 'recover')) {
        return false
      }
      if (useSettingStore().securityHideBackupDrive && item.key === 'backup_root') {
        return false
      }
      if (useSettingStore().securityHideResourceDrive && item.key === 'resource_root') {
        return false
      }
      if (useSettingStore().securityHidePicDrive && item.key === 'pic_root') {
        return false
      }
      if (!usePanTreeStore().resource_drive_id && item.key === 'resource_root') {
        return false
      }
      return true
    })

  return baseList
})

const folderPreviewRef = ref<{ open: (target: HTMLElement, params: any) => void; leave: () => void; cancel: () => void } | null>(null)

const SPECIAL_KEYS = new Set([
  'trash', 'recover', 'favorite', 'video', 'pic_root',
  'backup_root', 'resource_root'
])

const isPreviewableNode = (data: TreeNodeData | undefined): boolean => {
  if (!settingStore.uiFolderPreviewEnabled) return false
  if (!data) return false
  const key = String(data.key || '')
  if (!key) return false
  if (SPECIAL_KEYS.has(key)) return false
  if (key.startsWith('search') || key.startsWith('color')) return false
  if (data.isLeaf === true) {
    // leaf placeholder, but still might be a real folder; only block if no drive_id
  }
  const userId = (data as any).user_id || pantreeStore.user_id || ''
  const isSingleRootDrive = isCloud123User(userId) || isDrive115User(userId) || isBaiduUser(userId) || isPikPakUser(userId) || isDropboxUser(userId) || isOneDriveUser(userId) || isBoxUser(userId) || isGoogleUser(userId) || isQuarkUser(userId) || isCloud139User(userId) || isCloud189User(userId) || isGuangyaUser(userId) || isRemoteDriveUser(userId)
  if (!isSingleRootDrive && key.length < 40) return false
  return true
}

const onTreeNodeEnter = (ev: MouseEvent, data: TreeNodeData) => {
  if (!isPreviewableNode(data)) return
  const target = ev.currentTarget as HTMLElement
  if (!target) return
  const driveId = data.drive_id || pantreeStore.drive_id
  const userId = (data as any).user_id || pantreeStore.user_id || ''
  if (!userId || !driveId) return
  folderPreviewRef.value?.open(target, {
    user_id: userId,
    drive_id: driveId,
    file_id: (data as any).file_id || data.key,
    name: data.title,
    path: (data as any).path || ''
  })
}

const onTreeNodeLeave = () => {
  folderPreviewRef.value?.leave()
}

const onTreeScroll = () => {
  onHideRightMenuScroll()
  folderPreviewRef.value?.cancel()
}
</script>

<template>
  <div style='width: 100%; height: 100%; overflow: hidden; min-width: 300px' tabindex='-1'
       @keydown.tab.prevent='() => true'>
    <div class='headswitch'>
      <div class='bghr'></div>
      <div class='sw'>
        <MySwitchTab :name="'panleft'" :tabs='switchValues' :value='appStore.GetAppTabMenu'
                     @update:value="(val:string)=>appStore.toggleTabMenu('pan', val)" />
      </div>
    </div>
    <div class='treeleft'>
      <a-tabs type='text' :direction="'horizontal'" class='hidetabs' :justify='true'
              :active-key='appStore.GetAppTabMenu'>
        <a-tab-pane key='wangpan' title='1'>
          <AntdTree
            ref='treeref'
            :tabindex='-1'
            :focusable='false'
            class='dirtree'
            block-node
            selectable
            :auto-expand-parent='false'
            show-icon
            :height='treeHeight'
            :style="{ height: treeHeight + 'px' }"
            :item-height='30'
            :show-line='false'
            :open-animation='{}'
            :expanded-keys='pantreeStore.treeExpandedKeys'
            :selected-keys='pantreeStore.treeSelectedKeys'
            :tree-data='filterTreeData'
            @select='(_:any[],e:any)=>pantreeStore.mTreeSelected(e, false)'
            @expand='(_:any[],e:any)=>pantreeStore.mTreeExpand(e.node.key)'
            @right-click='handleTreeRightClick'
            @scroll='onTreeScroll'>
            <template #switcherIcon>
              <IconFont class="ant-tree-switcher-lucide" name="iconArrow-Right2" :size="15" />
            </template>
            <template #icon>
              <IconFont name="iconfile-folder" />
            </template>
            <template #title='{ dataRef }'>
              <span v-if="String(dataRef.key).length == 40 || String(dataRef.key).includes('root')"
                    class='dirtitle treedragnode'
                    @drop='onRowItemDrop($event, dataRef)'
                    @dragover='onRowItemDragOver'
                    @dragenter='onRowItemDragEnter'
                    @dragleave='onRowItemDragLeave'
                    @mouseenter='(ev:MouseEvent)=>onTreeNodeEnter(ev, dataRef)'
                    @mouseleave='onTreeNodeLeave'>
                {{ dataRef.title }}
              </span>
              <span v-else
                    class='dirtitle'
                    @mouseenter='(ev:MouseEvent)=>onTreeNodeEnter(ev, dataRef)'
                    @mouseleave='onTreeNodeLeave'>
                {{ dataRef.title }}
              </span>
            </template>
          </AntdTree>
        </a-tab-pane>
        <a-tab-pane key='kuaijie' title='2'>
          <AntdTree
            :tabindex='-1'
            :focusable='false'
            class='colortree'
            block-node
            selectable
            :auto-expand-parent='false'
            show-icon
            :style="{ marginLeft: '-18px' }"
            :item-height='30'
            :show-line='false'
            :open-animation='{}'
            :selected-keys='pantreeStore.treeSelectedKeys'
            :tree-data='colorTreeData'
            @select='handleColorTreeSelect'>
            <template #icon='{ dataRef }'>
              <IconFont name="iconwbiaoqian" :class='dataRef.namesearch' />
            </template>
            <template #title='{ dataRef }'>
              <span :class="'dirtitle ' + dataRef.namesearch">{{ t('pan.mark') }} · {{ dataRef.title }}</span>
            </template>
          </AntdTree>
          <div class='quickdrop'
               @drop='onQuickDrop($event)'
               @dragover='onQuickDragOver'
               @dragenter='onQuickDragEnter'
               @dragleave='onRowItemDragLeave'>
            {{ t('pan.quickDropHint1') }}<br />
            {{ t('pan.quickDropHint2') }}
          </div>
          <AntdTree
            :tabindex='-1'
            :focusable='false'
            class='quicktree'
            block-node
            selectable
            :auto-expand-parent='false'
            show-icon
            :height='quickHeight'
            :style="{ height: quickHeight + 'px', marginLeft: '-18px' }"
            :item-height='30'
            :show-line='false'
            :open-animation='{}'
            :selected-keys='quickSelectedKeys'
            :tree-data='pantreeStore.quickData'
            @select='handleQuickTreeSelect'>
            <template #icon>
              <IconFont name="iconfile-folder" />
            </template>
            <template #title='{ dataRef }'>
              <div class="quickitem"
                   @mouseenter='(ev:MouseEvent)=>onTreeNodeEnter(ev, dataRef)'
                   @mouseleave='onTreeNodeLeave'>
                 <span class='quicktitle' :title='dataRef.title + " · " + (dataRef.user_name || dataRef.user_id) + " · " + dataRef.drive_name'>
                {{ dataRef.title }}
                <small class="quicksource">{{ dataRef.user_name || dataRef.user_id }} · {{ dataRef.drive_name }}</small>
              </span>
                <span class='quickbtn'>
                <a-button type='text' size='mini' @click.stop='handleQuickDelete(dataRef.key)'>
                  {{ t('common.delete') }}
                </a-button>
              </span>
              </div>
            </template>
          </AntdTree>
        </a-tab-pane>
      </a-tabs>
    </div>
    <DirLeftMenu :inputselectType='inputselectType' />
    <FolderPreviewPopover ref='folderPreviewRef' />
  </div>
</template>

<style lang="less">
.treeleft {
  margin-left: -6px;
}

.dirtree {
  height: 100%;
}

.dirtree .iconfont,
.sharetree .iconfont,
.quicktree .iconfont,
.videotree .iconfont {
  font-size: 20px;
}

.dirtree .iconfont.iconfile-folder,
.sharetree .iconfont.iconfile-folder,
.quicktree .iconfont.iconfile-folder,
.videotree .iconfont.iconfile-folder {
  color: #ffb74d;
  font-size: 20px;
}

.colortree .iconfont {
  font-size: 20px;
}

.dirtree .iconfont.iconrecover {
  color: #13c2c2;
}

.dirtree .iconfont.icondelete {
  color: #ff4d4fd9;
}

.dirtree .iconfont.iconsearch {
  color: #1890ff;
}

.dirtree .iconfont.iconcrown {
  color: #ffb74d;
}

.dirtree .iconfont.iconrss_video {
  color: #a760ef;
}

.dirtree .iconfont.iconjietu {
  color: #a77566;
}

.colortree .iconfont.iconrss_video {
  color: #a760ef;
}

.ant-tree .iconfile-folder {
  color: #ffb74d;
  font-size: 20px;
}

.dirtitle {
  white-space: nowrap;
  word-break: keep-all;
}

.dirtitle.treedragnode {
  width: 100%;
  display: inline-block;
}

.dirtree .ant-tree-list-holder-inner .ant-tree-node-content-wrapper {
  flex-wrap: nowrap !important;
  flex-shrink: 0 !important;
  display: flex;
}

.dirtree .ant-tree-list-holder {
  overflow-x: hidden;
}

.dirtree .ant-tree-title {
  flex-grow: 1;
}

.ant-tree-node-selected .ant-tree-title,
.ant-tree-node-selected .ant-tree-title > span {
  color: rgb(var(--primary-6)) !important;
  font-weight: 500;
}

body[arco-theme='dark'] .ant-tree-node-selected .ant-tree-title,
body[arco-theme='dark'] .ant-tree-node-selected .ant-tree-title > span {
  color: rgb(255, 255, 255) !important;
}

.headswitch {
  width: 100%;
  height: 56px;
  overflow: hidden;
  text-align: center;
  justify-content: center;
  position: relative;
  padding-top: 16px;
  padding-bottom: 6px;
  margin-left: -18px;
  flex-shrink: 0;
  flex-grow: 0;
}

.headswitch .bghr {
  position: absolute;
  left: 0;
  right: 0;
  top: 32px;
  border-bottom: 1px solid var(--color-neutral-3);
  z-index: -1;
}

.headswitch .sw {
  margin: 0 auto;
  background: var(--color-bg-1);
  width: fit-content;
}

.rootsearch {
  width: calc(100% - 151px) !important;
  float: right;
}

.rootsearch.arco-input-wrapper {
  background-color: transparent;
  border: 1px solid rgb(var(--primary-6)) !important;
}

.colortree {
  height: 180px;
  flex-shrink: 0;
  flex-grow: 0;
}

.quickdrop {
  height: 50px;
  flex-shrink: 0;
  flex-grow: 0;
  border: 3px dotted var(--color-border-2);
  display: flex;
  margin-left: -18px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  text-align: center;
  line-height: 1.3;
}

.quicktree .ant-tree-icon__customize .iconfont {
  font-size: 18px;
  margin-right: 2px;
}

.quicktree .ant-tree-node-content-wrapper {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.quicktree .ant-tree-title {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.quickitem {
  display: flex;
}

.quickitem .quicktitle {
  flex-shrink: 1;
  flex-grow: 1;
  display: -webkit-box;
  max-height: 24px;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 1;
}

.quicksource {
  margin-left: 6px;
  color: var(--color-text-3);
  font-size: 11px;
}

.quickitem .quickbtn {
  flex-shrink: 0;
  flex-grow: 0;
  padding-left: 2px;
  padding-right: 2px;
  font-size: 12px;
  color: var(--color-text-3);
}

.quicktree .quickbtn .arco-btn-size-mini {
  padding: 0 4px;
}

.quicktree .quickbtn .arco-btn-size-mini:hover,
.quicktree .quickbtn .arco-btn-size-mini:active {
  color: #fff !important;
  background: rgba(255, 77, 79, 0.85) !important;
}
</style>
