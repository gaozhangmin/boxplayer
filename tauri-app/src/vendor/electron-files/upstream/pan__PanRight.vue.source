<!-- eslint-disable no-irregular-whitespace -->
<script setup lang='ts'>
import { IAliGetFileModel } from '../aliapi/alimodels'
import {
  KeyboardState,
  MouseState,
  useAppStore,
  useFootStore,
  useKeyboardStore,
  useMouseStore,
  usePanFileStore,
  useSettingStore
} from '../store'
import useWinStore from '../store/winstore'
import {
  onHideRightMenuScroll,
  onShowRightMenu,
  TestCtrl,
  TestCtrlShift,
  TestKey,
  TestKeyboardScroll,
  TestKeyboardSelect
} from '../utils/keyboardhelper'
import { computed, onMounted, ref, watchEffect } from 'vue'
import { t } from '../i18n'
import PanDAL from './pandal'

import { Tooltip as AntdTooltip } from 'ant-design-vue'

import {
  dropMoveSelectedFile,
  handleUpload,
  menuCopySelectedFile,
  menuCreatShare,
  menuFavSelectFile,
  menuTrashSelectFile,
  topSearchAll
} from './topbtns/topbtn'
import {
  modalCreatNewDir,
  modalCreatNewFile,
  modalDaoRuShareLink,
  modalPassword,
  modalRename,
  modalSelectPanDir,
  modalUpload,
  modalCloud123OfflineDownload
} from '../utils/modal'
import { PanFileState } from './panfilestore'
import PanTopbtn from './menus/PanTopbtn.vue'
import FileTopbtn from './menus/FileTopbtn.vue'
import FileRightMenu from './menus/FileRightMenu.vue'
import TrashRightMenu from './menus/TrashRightMenu.vue'
import TrashTopbtn from './menus/TrashTopbtn.vue'
import DirTopPath from './menus/DirTopPath.vue'
import message from '../utils/message'
import { menuOpenFile } from '../utils/openfile'
import { throttle } from '../utils/debounce'
import { TestButton } from '../utils/mosehelper'
import { isValidDropUploadTarget } from '../utils/uploadTarget'
import usePanTreeStore from './pantreestore'
import { getDriveId as GetDriveID, getDriveType as GetDriveType } from '../drive/context'
import { isAliyunUser, isCloud123User, isDrive115User, isGuangyaUser, isPikPakUser } from '../utils/driveIdentity'
import { xorWith } from 'lodash'
import { flattenDriveToolFolders, moveDriveToolFiles, type OrganizeFileItem } from '../utils/drive-tools/organize'
import { buildMediaOrganizePlan, executeMediaOrganizePlan, mapMediaOrganizeFiles } from '../utils/drive-tools/mediaOrganize'
import {
  supportsCopy,
  supportsCreateFolder,
  supportsCreateShare,
  supportsCreateTextFile,
  isWritableProviderDirectory,
  supportsDirectPermanentDelete,
  supportsLocalUpload,
  supportsMove,
  supportsRename,
  supportsSearch,
  supportsShareImport,
  supportsTrashMove,
  supportsTrashPermanentDelete
} from '../drive/providerFeatures'


const viewlist = ref()
const inputsearch = ref()
const isresourcedrive = ref(false)
const inputpicType = ref('pic_root')
const inputselectType = ref('backup')
const inputsearchType = ref<string[]>([])

const handleListScroll = () => {
  onHideRightMenuScroll()
  cancelFolderPreview()
}

const handleListReachBottom = () => {
  void PanDAL.LoadMoreCurrentProviderItems().catch((error: any) => {
    message.warning(`加载下一页失败，滚动到底部可重试：${error?.message || '网络请求失败'}`)
  })
}

const appStore = useAppStore()
const settingStore = useSettingStore()
const winStore = useWinStore()
const panfileStore = usePanFileStore()
const panTreeStore = usePanTreeStore()
const currentDriveId = computed(() => panTreeStore.drive_id || panfileStore.DriveID || '')
const currentUserId = computed(() => panTreeStore.user_id || '')
const canWriteCurrentDirectory = computed(() => isWritableProviderDirectory(panTreeStore.selectDir.file_id || ''))
const canCopy = computed(() => supportsCopy(currentUserId.value, currentDriveId.value))
const canCreateFolder = computed(() => canWriteCurrentDirectory.value && supportsCreateFolder(currentUserId.value, currentDriveId.value))
const canCreateTextFile = computed(() => canWriteCurrentDirectory.value && supportsCreateTextFile(currentUserId.value, currentDriveId.value))
const canCreateShare = computed(() => supportsCreateShare(currentUserId.value, currentDriveId.value))
const canImportShare = computed(() => supportsShareImport(currentUserId.value, currentDriveId.value))
const canMove = computed(() => supportsMove(currentUserId.value, currentDriveId.value))
const canRename = computed(() => supportsRename(currentUserId.value, currentDriveId.value))
const canSearchCurrentDrive = computed(() => supportsSearch(currentUserId.value, currentDriveId.value))
const canTrash = computed(() => supportsTrashMove(currentUserId.value, currentDriveId.value))
const canDeletePermanently = computed(() => panfileStore.SelectDirType === 'trash'
  ? supportsTrashPermanentDelete(currentUserId.value, currentDriveId.value)
  : supportsDirectPermanentDelete(currentUserId.value, currentDriveId.value))
const canUpload = computed(() => canWriteCurrentDirectory.value && supportsLocalUpload(currentUserId.value, currentDriveId.value))

const isOfflineDownloadSupported = computed(() => {
  if (panfileStore.SelectDirType !== 'pan') return false
  const user = panTreeStore.user_id || ''
  const drive = panTreeStore.drive_id || panfileStore.DriveID
  return isCloud123User(user) || isPikPakUser(user) || isGuangyaUser(user) || isDrive115User(user)
    || ['cloud123', 'pikpak', 'guangya', 'drive115'].includes(drive)
})

const handleOfflineDownload = () => {
  if (!isOfflineDownloadSupported.value) return
  const isRoot = !panfileStore.DirID || panfileStore.DirID.includes('root')
  const isDrive115 = isDrive115User(panTreeStore.user_id || '') || (panTreeStore.drive_id || panfileStore.DriveID) === 'drive115'
  modalCloud123OfflineDownload({
    dirId: isRoot ? (isDrive115 ? '0' : '') : panfileStore.DirID,
    dirName: isRoot ? (isDrive115 ? t('pan.rootFolder') : t('pan.defaultOfflineFolder')) : panfileStore.DirName
  })
}

const getSelectedOrganizeFiles = (): OrganizeFileItem[] => {
  const userId = panTreeStore.user_id || ''
  return panfileStore.GetSelected().map((file: any) => ({ userId, driveId: file.drive_id || panfileStore.DriveID, fileId: file.file_id, name: file.name || file.file_name }))
}

const allSelectedInCurrentDrive = (files: OrganizeFileItem[]) => files.every(file => file.driveId === panfileStore.DriveID)

const handleMoveOrganizeToParent = async () => {
  const files = getSelectedOrganizeFiles()
  const parentId = panTreeStore.selectDir?.parent_file_id || ''
  if (!files.length) {
    message.warning(t('pan.selectFileOrFolderFirst'))
    return
  }
  if (!parentId) {
    message.warning(t('pan.noParentFolder'))
    return
  }
  if (!allSelectedInCurrentDrive(files)) {
    message.warning(t('pan.currentDriveOnly'))
    return
  }
  if (!window.confirm(t('pan.confirmMoveUp', { count: files.length }))) return
  const result = await moveDriveToolFiles(files, parentId, panfileStore.DriveID)
  if (result.failed) message.warning(result.report)
  else message.success(result.report)
  await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
}

const handleMoveOrganizeFlatten = async () => {
  const files = getSelectedOrganizeFiles()
  const currentDirId = panfileStore.DirID || ''
  if (!files.length) {
    message.warning(t('pan.selectFolderFirst'))
    return
  }
  if (!currentDirId) {
    message.warning(t('pan.unrecognizedCurrentDir'))
    return
  }
  if (!allSelectedInCurrentDrive(files)) {
    message.warning(t('pan.currentDriveOnly'))
    return
  }
  if (!window.confirm(t('pan.confirmFlatten'))) return
  const result = await flattenDriveToolFolders(files, currentDirId, panfileStore.DriveID)
  if (result.failed) message.warning(result.report)
  else message.success(result.report)
  await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
}

const handleMoveOrganizeToSelectedDir = () => {
  const files = getSelectedOrganizeFiles()
  if (!files.length) {
    message.warning(t('pan.selectFileOrFolderFirst'))
    return
  }
  modalSelectPanDir('cut', panfileStore.DirID || '', async (_userId: string, driveId: string, selectFile: any) => {
    if (files.some(file => file.driveId !== driveId)) {
      message.warning(t('pan.sameDriveMoveOnly'))
      return
    }
    if (!window.confirm(t('pan.confirmMoveTo', { count: files.length, name: selectFile.name }))) return
    const result = await moveDriveToolFiles(files, selectFile.file_id, driveId)
    if (result.failed) message.warning(result.report)
    else message.success(result.report)
    await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
  })
}

const handleMediaOrganize = async () => {
  const userId = panTreeStore.user_id || ''
  const rootId = panfileStore.DirID || ''
  const files = panfileStore.GetSelected()
  if (!files.length) {
    message.warning(t('pan.selectMediaFirst'))
    return
  }
  if (!rootId || !userId) {
    message.warning(t('pan.unrecognizedOrganizeDir'))
    return
  }
  const plans = buildMediaOrganizePlan(mapMediaOrganizeFiles(files, userId), rootId)
  if (!plans.every(plan => plan.driveId === panfileStore.DriveID)) {
    message.warning(t('pan.currentDriveMediaOnly'))
    return
  }
  if (!plans.length) {
    message.warning(t('pan.noOrganizableMedia'))
    return
  }
  const preview = plans.slice(0, 8).map(item => `${item.name} → ${item.targetPath}`).join('\n')
  if (!window.confirm(t('pan.confirmMediaOrganize', { count: plans.length, preview, suffix: plans.length > 8 ? '\n...' : '' }))) return
  const result = await executeMediaOrganizePlan(plans, rootId)
  if (result.failed) message.warning(result.report)
  else message.success(result.report)
  await PanDAL.aReLoadOneDirToShow('', 'refresh', false)
}

let dirID = ''
let DriveID = panfileStore.DriveID
panfileStore.$subscribe((_m: any, state: PanFileState) => {
  if (state.DirID != dirID) {
    dirID = state.DirID
    if (viewlist.value) viewlist.value.scrollIntoView(0)
    cancelFolderPreview()
  }
  if (state.DriveID != DriveID) {
    DriveID = state.DriveID
    inputselectType.value = GetDriveType(panTreeStore.user_id, DriveID).name
    isresourcedrive.value = inputselectType.value.includes('resource')
  }
  const isTrash = panfileStore.SelectDirType == 'trash' || panfileStore.SelectDirType == 'recover'
  const selectItem = panfileStore.GetSelectedFirst()
  const isShowVideo = !isTrash && panfileStore.ListSelected.size == 1 && selectItem?.category == 'video'
  if (menuShowVideo.value != isShowVideo) menuShowVideo.value = isShowVideo
  const isShowZip = !isTrash && panfileStore.ListSelected.size == 1 && (selectItem?.ext == 'zip' || selectItem?.ext == 'rar')
  if (menuShowZip.value != isShowZip) menuShowZip.value = isShowZip
})

watchEffect(() => {
  const scrollToFile = panfileStore.scrollToFile
  if (scrollToFile) {
    if (viewlist.value) {
      viewlist.value.scrollIntoView({ key: scrollToFile, offset: 50 })
    }
    panfileStore.mSaveFileScrollTo('')
  }
})

const keyboardStore = useKeyboardStore()
keyboardStore.$subscribe((_m: any, state: KeyboardState) => {
  if (appStore.appTab != 'pan') return

  if (TestCtrl('a', state.KeyDownEvent, () => panfileStore.mSelectAll())) return
  if (TestCtrl('c', state.KeyDownEvent, () => canCopy.value && menuCopySelectedFile(false, 'copy'))) return
  if (TestCtrl('x', state.KeyDownEvent, () => canMove.value && menuCopySelectedFile(false, 'cut'))) return
  if (TestCtrlShift('Delete', state.KeyDownEvent, () => canDeletePermanently.value && menuTrashSelectFile(false, true))) return
  if (TestCtrl('Delete', state.KeyDownEvent, () => canTrash.value && menuTrashSelectFile(false, false))) return
  if (
    TestCtrlShift('f', state.KeyDownEvent, () => {
      PanDAL.aReLoadOneDirToShow('', 'search', false)
      setTimeout(() => {
        document.getElementById('searchpanInput')?.focus()
      }, 300)
    })
  ) return
  if (TestCtrl('f', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey('f3', state.KeyDownEvent, () => inputsearch.value.focus())) return
  if (TestKey(' ', state.KeyDownEvent, () => inputsearch.value.focus())) return
  // 新建文件
  if (TestCtrl('n', state.KeyDownEvent, () => canCreateTextFile.value && modalCreatNewFile())) return
  if (TestCtrlShift('n', state.KeyDownEvent, () => canCreateFolder.value && modalCreatNewDir('folder'))) return
  // 上传文件
  if (TestCtrlShift('u', state.KeyDownEvent, () => canUpload.value && handleUpload('folder'))) return
  if (TestCtrl('u', state.KeyDownEvent, () => canUpload.value && handleUpload('file'))) return
  if (TestCtrlShift('j', state.KeyDownEvent, () => canUpload.value && handleUpload('folder', 'enc'))) return
  if (TestCtrl('j', state.KeyDownEvent, () => canUpload.value && handleUpload('file', 'enc'))) return
  if (TestCtrlShift('m', state.KeyDownEvent, () => canUpload.value && handleUpload('folder', 'myenc'))) return
  if (TestCtrl('m', state.KeyDownEvent, () => canUpload.value && handleUpload('file', 'myenc'))) return

  if (TestCtrl('l', state.KeyDownEvent, () => canImportShare.value && modalDaoRuShareLink())) return
  if (TestCtrl('h', state.KeyDownEvent, handleHome)) return
  if (TestKey('f5', state.KeyDownEvent, handleRefresh)) return
  if (TestKey('f6', state.KeyDownEvent, handleDingWei)) return
  if (TestKey('Backspace', state.KeyDownEvent, handleBack)) return
  if (TestKey('f2', state.KeyDownEvent, () => canRename.value && modalRename(false, panfileStore.IsListSelectedMulti, false))) return
  if (TestCtrl('e', state.KeyDownEvent, () => canRename.value && modalRename(false, panfileStore.IsListSelectedMulti, false))) return
  if (TestCtrl('s', state.KeyDownEvent, () => {
    isresourcedrive && canCreateShare.value && menuCreatShare(false, 'pan', 'resource_root')
  })) return
  if (TestCtrl('t', state.KeyDownEvent, () => canCreateShare.value && menuCreatShare(false, 'pan', 'backup_root'))) return
  if (TestCtrl('g', state.KeyDownEvent, () => isAliyunUser(currentUserId.value) && menuFavSelectFile(false, !panfileStore.IsListSelectedFavAll))) return
  if (TestCtrl('q', state.KeyDownEvent, onSelectRangStart)) return
  if (TestKeyboardSelect(state.KeyDownEvent, viewlist.value, panfileStore, handleOpenFile)) return
  if (TestKeyboardScroll(state.KeyDownEvent, viewlist.value, panfileStore)) return
})

const mouseStore = useMouseStore()
mouseStore.$subscribe((_m: any, state: MouseState) => {
  if (appStore.appTab != 'pan') return
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
  if (TestButton(3, mouseEvent, () => handleBack())) return
})
const handleRefresh = () => {
  let album_id = ''
  if (panfileStore.SelectDirType.includes('pic')) {
    album_id = panTreeStore.selectDir.file_id
  }
  PanDAL.aReLoadOneDirToShow(DriveID, 'refresh', false, album_id)
}
const handleDingWei = () => {
  PanDAL.aTreeScrollToDir('refresh')
}

const handleChangePic = (value: any) => {
  panTreeStore.selectDir.album_type = value
  if (value == 'pic_root') {
    panTreeStore.selectDir.album_id = ''
  }
  PanDAL.aReLoadOneDirToShow(DriveID, value, false)
}

const handleChangeDrive = (value: any) => {
  DriveID = GetDriveID(panTreeStore.user_id, value)
  handleRefresh()
}
const handleSearchCheck = () => {
  if (useSettingStore().securityHideBackupDrive) {
    inputsearchType.value = inputsearchType.value.filter((t) => t != 'backup')
  }
  if (useSettingStore().securityHideResourceDrive) {
    inputsearchType.value = inputsearchType.value.filter((t) => t != 'resource')
  }
  if (useSettingStore().securityHidePicDrive) {
    inputsearchType.value = inputsearchType.value.filter((t) => t != 'pic')
  }
}
const handleBack = () => {
  if (!panTreeStore.PanHistoryCount) return
  PanDAL.aReLoadOneDirToShow(DriveID, 'back', false)
  inputpicType.value = panTreeStore.selectDir.album_type || 'pic_root'
}
const handleHome = () => {
  PanDAL.aReLoadOneDirToShow('', 'backup_root', false)
}
const handleSelectAll = () => {
  panfileStore.mSelectAll()
}


const handleSelect = (file_id: string, event: any, isCtrl: boolean = false) => {
  onHideRightMenuScroll()
  if (rangIsSelecting.value) {
    if (!rangSelectID.value) {
      if (!panfileStore.ListSelected.has(file_id)) panfileStore.mMouseSelect(file_id, true, false)
      rangSelectID.value = file_id
      rangSelectStart.value = file_id
      rangSelectFiles.value = { [file_id]: true }
    } else {
      const start = rangSelectID.value
      const children = panfileStore.ListDataShow
      let a = -1
      let b = -1
      for (let i = 0, maxi = children.length; i < maxi; i++) {
        if (children[i].file_id == file_id) a = i
        if (children[i].file_id == start) b = i
        if (a > 0 && b > 0) break
      }
      const fileList: string[] = []
      if (a >= 0 && b >= 0) {
        if (a > b) [a, b] = [b, a]
        for (let n = a; n <= b; n++) {
          fileList.push(children[n].file_id)
        }
      }
      panfileStore.mRangSelect(file_id, fileList)
      rangIsSelecting.value = false
      rangSelectID.value = ''
      rangSelectStart.value = ''
      rangSelectEnd.value = ''
      rangSelectFiles.value = {}
    }
    panfileStore.mRefreshListDataShow(false)
  } else {
    panfileStore.mMouseSelect(file_id, event.ctrlKey || isCtrl, event.shiftKey)
    if (!panfileStore.ListSelected.has(file_id)) panfileStore.ListFocusKey = ''
  }
}

const handleOpenFile = (event: Event, file: IAliGetFileModel | undefined) => {
  if (rangIsSelecting.value) return
  if (panfileStore.DirID == 'trash' || panfileStore.DirID == 'recover') {
    return
  }
  if (!file) file = panfileStore.GetSelectedFirst()
  if (!file) return
  if (file.isDir) {
    PanDAL.aReLoadOneDirToShow(file.drive_id, file.file_id, true, file.album_id)
    return
  }
  if (!panfileStore.ListSelected.has(file.file_id)) {
    panfileStore.mMouseSelect(file.file_id, false, false)
  }
  let isShare = file.from_share_id != undefined
  let isEncrypt = file.description && file.description.includes('xbyEncrypt')
  if (isEncrypt) {
    if (isShare) {
      modalPassword('input', (success, inputpassword) => {
        success && file && menuOpenFile(file, inputpassword)
      })
    } else if (useSettingStore().securityPassword && useSettingStore().securityPasswordConfirm) {
      modalPassword('confirm', (success) => {
        success && file && menuOpenFile(file)
      })
    } else if (!useSettingStore().securityPassword) {
      modalPassword('new', (success) => {
        success && file && menuOpenFile(file)
      })
    } else {// 自动解密
      menuOpenFile(file)
    }
  } else {
    menuOpenFile(file)
  }
}

const handleSearchInput = (value: string) => {
  panfileStore.mSearchListData(value)
  viewlist.value.scrollIntoView(0)
}
const handleSearchEnter = (event: any) => {
  event.target.blur()
  viewlist.value.scrollIntoView(0)
}
const globalSearchKeyword = ref('')
const handleGlobalSearch = (value: string) => {
  const keyword = value.trim()
  if (!keyword) return
  void topSearchAll(keyword, inputsearchType.value)
}
const handleGlobalSearchEnter = (event: any) => {
  event.target.blur()
  handleGlobalSearch(event.target.value || globalSearchKeyword.value)
}

const menuShowVideo = ref(false)
const menuShowZip = ref(false)
const handleRightClick = (e: { event: MouseEvent; node: any }) => {
  const key = e.node.key
  if (!panfileStore.ListSelected.has(key)) panfileStore.mMouseSelect(key, false, false)
  const dirType = panfileStore.SelectDirType
  onShowRightMenu(dirType == 'trash' || dirType == 'recover' ? 'rightpantrashmenu' : 'rightpanmenu', e.event.clientX, e.event.clientY)
}


const handleFileListOrder = (order: string) => {
  panfileStore.mOrderListData(order)
}
let listGridWidth = 0
const resizeObserver = new ResizeObserver((entries) => {
  let newWidth = 0
  entries.map((t) => {
    newWidth = t.contentRect?.width || 0
    return true
  })

  if (listGridWidth != newWidth && newWidth > 400) {
    listGridWidth = newWidth
    onGridResize()
  }
})
const onGridResize = throttle(() => {
  handleListGridMode(settingStore.uiFileListMode)
  useFootStore().rightWidth = listGridWidth
}, 100)

onMounted(() => {
  const panFileList = document.getElementById('panfilelist')
  if (panFileList instanceof Element) {
    resizeObserver.observe(panFileList)
  }
  let searchDrive = ['backup', 'resource', 'pic']
  if (useSettingStore().securityHideBackupDrive) {
    searchDrive = searchDrive.filter((t) => t != 'backup')
  }
  if (useSettingStore().securityHideResourceDrive) {
    searchDrive = searchDrive.filter((t) => t != 'resource')
  }
  if (useSettingStore().securityHidePicDrive) {
    searchDrive = searchDrive.filter((t) => t != 'pic')
  }
  inputsearchType.value = searchDrive
})

const listGridColumn = ref(1)
const listGridItemHeight = ref(50)
const handleListGridMode = (mode: string) => {
  if (mode == 'list') {
    if (listGridItemHeight.value != 50) {
      listGridItemHeight.value = 50
      listGridColumn.value = 1
    }
  } else if (mode == 'image') {
    const count = Math.max(3, Math.floor(listGridWidth / 150))
    if (listGridItemHeight.value != 180) listGridItemHeight.value = 180
    if (listGridColumn.value != count) listGridColumn.value = count
  } else {
    const count = Math.max(2, Math.floor(listGridWidth / 200))
    if (listGridItemHeight.value != 180) listGridItemHeight.value = 240
    if (listGridColumn.value != count) listGridColumn.value = count
  }
  settingStore.updateStore({ uiFileListMode: mode })
  panfileStore.mGridListData(mode, listGridColumn.value)
}


const rangIsSelecting = ref(false)
const rangSelectID = ref('')
const rangSelectStart = ref('')
const rangSelectEnd = ref('')
const rangSelectFiles = ref<{ [k: string]: any }>({})

const onSelectCancel = () => {
  onHideRightMenuScroll()
  panfileStore.ListSelected.clear()
  panfileStore.ListFocusKey = ''
  panfileStore.mRefreshListDataShow(false)
}
const onSelectReverse = () => {
  onHideRightMenuScroll()
  const listData = panfileStore.ListDataShow
  const listSelected = panfileStore.GetSelected()
  const reverseSelect = xorWith(listData, listSelected, (a, b) => a.file_id === b.file_id)
  panfileStore.ListSelected.clear()
  panfileStore.ListFocusKey = ''
  if (reverseSelect.length > 0) {
    panfileStore.mRangSelect(reverseSelect[0].file_id, reverseSelect.map(r => r.file_id))
  }
  panfileStore.mRefreshListDataShow(false)
}
const onSelectRangStart = () => {
  onHideRightMenuScroll()
  rangIsSelecting.value = !rangIsSelecting.value
  rangSelectID.value = ''
  rangSelectStart.value = ''
  rangSelectEnd.value = ''
  rangSelectFiles.value = {}
  panfileStore.mRefreshListDataShow(false)
}

const onSelectRang = (file_id: string) => {
  if (rangIsSelecting.value && rangSelectID.value != '') {

    let startid = rangSelectID.value
    let endid = ''
    const s: { [k: string]: any } = {}
    const children = panfileStore.ListDataShow
    let a = -1
    let b = -1
    for (let i = 0, maxi = children.length; i < maxi; i++) {
      if (children[i].file_id == file_id) a = i
      if (children[i].file_id == startid) b = i
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
        s[children[n].file_id] = true
      }
    }

    rangSelectStart.value = startid
    rangSelectEnd.value = endid
    rangSelectFiles.value = s
    panfileStore.mRefreshListDataShow(false)
  }
}

const dragingRowItem = ref(false)

const cancelFolderPreview = () => {}

const onRowItemDragStart = (ev: any, file_id: string) => {
  cancelFolderPreview()
  if (rangIsSelecting.value) {
    ev.stopPropagation()
    ev.preventDefault()
    return
  }

  onHideRightMenuScroll()
  dragingRowItem.value = true

  if (!panfileStore.ListSelected.has(file_id)) {
    panfileStore.mMouseSelect(file_id, false, false)
  }
  const files = panfileStore.GetSelected()
  if (files.length == 0) return

  const dragImage = document.createElement('div')
  dragImage.className = 'dragrowitem'
  if (files.length == 1) {
    dragImage.innerHTML = `<a>${t('pan.drag')}</a>${files[0].name}`
  } else {
    dragImage.innerHTML = `<a>${t('pan.drag')}</a>${t('pan.dragMultiple', { name: files[0].name, count: files.length })}`
  }

  if (ev.dataTransfer) {
    document.body.appendChild(dragImage)
    ev.dataTransfer.setDragImage(dragImage, -16, 10)
    ev.dataTransfer.effectAllowed = 'copyMove'
    ev.dataTransfer.dropEffect = 'move'
    setTimeout(() => document.body.removeChild(dragImage), 0)
  }
}
const onRowItemDragEnter = (ev: any) => {
  if (dragingRowItem.value) {
    ev.stopPropagation()
    ev.preventDefault()
    ev.target.style.outline = '2px dotted #637dff'
    ev.target.style.background = 'rgba(var(--primary-6),0.3)'
    ev.dataTransfer.dropEffect = 'move'
  }
}
const onRowItemDragLeave = (ev: any) => {
  if (dragingRowItem.value) {
    ev.stopPropagation()
    ev.preventDefault()
    ev.target.style.outline = 'none'
    ev.target.style.background = ''
  }
}
const onRowItemDragOver = (ev: any) => {
  if (dragingRowItem.value) {
    ev.stopPropagation()
    ev.preventDefault()
  }
}
const onRowItemDrop = (ev: any, data: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  ev.target.style.outline = 'none'
  ev.target.style.background = ''
  if (!canMove.value) return
  dropMoveSelectedFile(data.drive_id, data.file_id, false)
}
const onRowItemDragEnd = (ev: any) => {
  if (dragingRowItem.value) {
    ev.stopPropagation()
    ev.preventDefault()
    dragingRowItem.value = false
  }
}


const showDragUpload = ref(false)
const onPanDrop = (e: any) => {
  if (!e.dataTransfer.files || e.dataTransfer.files.length == 0) return
  e.stopPropagation()
  e.preventDefault()
  showDragUpload.value = false
  if (!canUpload.value) {
    message.warning(t('pan.readOnlyNoUpload'))
    return
  }

  if (panfileStore.DirID.startsWith('color')) {
    message.error(t('pan.noUploadToColor'))
    return
  }
  if (panfileStore.DirID.startsWith('search')) {
    message.error(t('pan.noUploadToSearch'))
    return
  }
  if (panfileStore.DirID == 'favorite') {
    message.error(t('pan.noUploadToFavorite'))
    return
  }
  if (panfileStore.DirID == 'recover') {
    message.error(t('pan.noUploadToRecover'))
    return
  }
  if (panfileStore.DirID == 'trash') {
    message.error(t('pan.noUploadToTrash'))
    return
  }
  const targetDirId = panfileStore.DirID || panTreeStore.selectDir.file_id
  if (!isValidDropUploadTarget(panTreeStore.user_id, panTreeStore.drive_id || panfileStore.DriveID, targetDirId)) {
    message.error(t('pan.invalidUploadTarget'))
    return
  }


  const filesList = e.dataTransfer.files
  if (filesList && filesList.length > 0) {
    const files: string[] = []

    for (let i = 0, maxi = filesList.length; i < maxi; i++) {
      const file = filesList[i]
      const filePath = window.WebGetPathForFile?.(file) || (file as any).path || ''
      if (filePath) files.push(filePath)
    }
    if (!files.length) {
      message.error('无法读取拖拽文件的本地路径，请重新拖拽或使用上传按钮')
      return
    }
    modalUpload(targetDirId, files)
  }
}
const onPanDragEnter = (ev: any) => {
  if (dragingRowItem.value) return
  if (!canUpload.value) return
  ev.stopPropagation()
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'copy'
  showDragUpload.value = true
}
const onPanDragLeave = (ev: any) => {
  ev.stopPropagation()
  ev.preventDefault()
  showDragUpload.value = false
}
const onPanDragOver = (ev: any) => {
  if (!canUpload.value) return
  ev.stopPropagation()
  ev.preventDefault()
}
const onPanDragEnd = (ev: any) => {
  if (showDragUpload.value) {
    ev.stopPropagation()
    ev.preventDefault()
    showDragUpload.value = false
  }
}
</script>

<template>
  <div style='height: 7px'></div>
  <div class='toppanbtns' style='height: 26px'>
    <DirTopPath />
    <div style='flex-grow: 1'></div>
    <div v-if="panfileStore.SelectDirType == 'trash'" class='toppantip'>
      <span v-if="isCloud123User(panTreeStore.user_id || '')" style='color: crimson'>{{ t('pan.trashTipCloud123') }}</span>
      <span v-else style='color: crimson'>{{ t('pan.trashTipAliyun') }}</span>
    </div>
    <div v-if="panfileStore.SelectDirType == 'recover'" class='toppantip'>
      <span style='color: crimson'>{{ t('pan.recoverTip') }}</span>
    </div>
    <div v-if="panfileStore.SelectDirType == 'favorite'" class='toppantip'>
      <span style='color: crimson'>{{ t('pan.favoriteTip') }}</span>
    </div>
    <div v-if="panfileStore.SelectDirType == 'color'" class='toppantip'>
      <span style='color: crimson'>{{ t('pan.colorTip') }}</span>
    </div>
    <div v-if="panfileStore.SelectDirType == 'video'" class='toppantip'>
      <span style='color: crimson'>{{ t('pan.videoTip') }}</span>
    </div>
  </div>
  <div style='height: 14px'></div>
  <div class='toppanbtns' style='height: 26px' tabindex='-1'>
    <div class='toppanbtn'>
      <a-button type='text' size='small' tabindex='-1' :disabled='panfileStore.ListLoading' :title="t('pan.back')"
                @click='handleBack'>
        <template #icon>
          <IconFont name="iconarrow-left-2-icon" />
        </template>
      </a-button>
      <a-button type='text' size='small' tabindex='-1' :loading='panfileStore.ListLoading' :title="t('pan.refresh')"
                @click='handleRefresh'>
        <template #icon>
          <IconFont name="iconreload-1-icon" />
        </template>
      </a-button>
      <a-button type='text' size='small' tabindex='-1' :disabled='panfileStore.ListLoading' :title="t('pan.locate')"
                @click='handleDingWei'>
        <template #icon>
          <IconFont name="icondingwei" />
        </template>
      </a-button>
      <a-button v-if='isOfflineDownloadSupported' type='text' size='small' tabindex='-1' :title="t('pan.cloudDownload')"
                @click='handleOfflineDownload'>
        <template #icon>
          <IconFont name="iconcloud-download" />
        </template>
        {{ t('pan.cloudDownload') }}
      </a-button>
      <a-dropdown v-if="panfileStore.SelectDirType === 'pan' && panfileStore.IsListSelected && canMove" trigger="click">
        <a-button type='text' size='small' tabindex='-1' :title="t('pan.organizeSelected')">
          <template #icon>
            <IconFont name="iconmoveto" />
          </template>
          {{ t('pan.organize') }}
        </a-button>
        <template #content>
          <a-doption @click="handleMoveOrganizeToParent">
            <span class="arco-dropdown-option-icon"><IconFont name="iconmoveto" /></span>{{ t('pan.moveUpOneLevel') }}
          </a-doption>
          <a-doption @click="handleMoveOrganizeFlatten">
            <span class="arco-dropdown-option-icon"><IconFont name="iconfile-folder" /></span>{{ t('pan.flattenToCurrent') }}
          </a-doption>
          <a-doption @click="handleMoveOrganizeToSelectedDir">
            <span class="arco-dropdown-option-icon"><IconFont name="iconmoveto" /></span>{{ t('pan.chooseDirAndMove') }}
          </a-doption>
          <a-doption @click="handleMediaOrganize">
            <span class="arco-dropdown-option-icon"><IconFont name="iconscan" /></span>{{ t('pan.mediaOrganize') }}
          </a-doption>
        </template>
      </a-dropdown>
    </div>
    <div v-show="!panfileStore.IsListSelected && panfileStore.SelectDirType.includes('pic')" class='toppanbtn'>
      <a-select v-model:model-value='inputpicType' size='small' tabindex='-1'
                @update:model-value='handleChangePic'
                style='width: 120px; flex-shrink: 0; margin: 0 -8px' :disabled='panfileStore.ListLoading'>
        <a-option value='pic_root'>{{ t('pan.allAlbums') }}</a-option>
        <a-option value='mypic'>{{ t('pan.myAlbums') }}</a-option>
      </a-select>
    </div>
    <div v-show="!panfileStore.IsListSelected && ['trash', 'recover', 'favorite'].includes(panfileStore.SelectDirType) && isAliyunUser(panTreeStore.user_id || '')"
         class='toppanbtn'>
      <a-select v-model:model-value='inputselectType'
                size='small' tabindex='-1'
                @update:model-value='handleChangeDrive'
                style='width: 100px; flex-shrink: 0; margin: 0 -8px'
                :disabled='panfileStore.ListLoading'>
        <a-option value='backup' :disabled="useSettingStore().securityHideBackupDrive">{{ t('drive.backup') }}</a-option>
        <a-option value='resource' :disabled="useSettingStore().securityHideResourceDrive">{{ t('drive.resource') }}</a-option>
        <a-option value='pic' :disabled="useSettingStore().securityHidePicDrive">{{ t('pan.album') }}</a-option>
      </a-select>
    </div>
    <div v-show="panfileStore.SelectDirType == 'search' && !panfileStore.IsListSelected && isAliyunUser(panTreeStore.user_id || '')" class='toppanbtn'>
      <a-dropdown style='width: 100px;' @popup-visible-change="handleSearchCheck">
        <a-button :disabled='panfileStore.ListLoading'>{{ t('pan.scope') }}</a-button>
        <template #content>
          <a-checkbox-group v-model="inputsearchType" direction="vertical">
            <a-checkbox value='backup' :disabled="useSettingStore().securityHideBackupDrive">{{ t('drive.backup') }}</a-checkbox>
            <a-checkbox value='resource' :disabled="useSettingStore().securityHideResourceDrive">{{ t('drive.resource') }}</a-checkbox>
            <a-checkbox value='pic' :disabled="useSettingStore().securityHidePicDrive">{{ t('pan.album') }}</a-checkbox>
          </a-checkbox-group>
        </template>
      </a-dropdown>
    </div>
    <div v-show="panfileStore.SelectDirType == 'search' && !panfileStore.IsListSelected" class='toppanbtn'>
      <a-input-search
        class='searchpan'
        style='width: 240px'
        :loading='panfileStore.ListLoading'
        :placeholder="t('pan.searchPlaceholder')"
        :button-text="t('pan.search')"
        search-button
        allow-clear
        :input-attrs="{ id: 'searchpanInput' }"
        @search='(val:string)=>topSearchAll(val, inputsearchType)'
        @press-enter='($event:any)=>topSearchAll($event.srcElement.value as string, inputsearchType)'
        @keydown.esc=';($event.target as any).blur()' />
      <a-button v-show=" isAliyunUser(panTreeStore.user_id || '')" type='text' size='small' tabindex='-1' style='border: none'
                @click="() => topSearchAll('topSearchAll高级搜索', inputsearchType)">{{ t('pan.advanced') }}
      </a-button>
    </div>

    <PanTopbtn :dirtype='panfileStore.SelectDirType'
               :inputpicType='inputpicType'
               :inputselectType='inputselectType'
               :isselected='panfileStore.IsListSelected' />
    <FileTopbtn :dirtype='panfileStore.SelectDirType'
                :isselected='panfileStore.IsListSelected'
                :isvideo='menuShowVideo'
                :inputselectType='inputselectType'
                :inputpicType='inputpicType'
                :isselectedmulti='panfileStore.IsListSelectedMulti'
                :isallfavored='panfileStore.IsListSelectedFavAll'
                :isallcolored='panfileStore.IsListSelectedColorAll' />
    <TrashTopbtn :dirtype='panfileStore.SelectDirType' :isselected='panfileStore.IsListSelected' />

    <div style='flex-grow: 1'></div>
    <div class='toppanbtn'>
      <a-input-search
        v-if='canSearchCurrentDrive'
        ref='inputsearch'
        v-model='globalSearchKeyword'
        :input-attrs="{ tabindex: '-1' }"
        size='small'
        title='Ctrl+F / F3 / Space'
        :placeholder="t('pan.globalSearch')"
        :loading='panfileStore.ListLoading'
        draggable='false'
        allow-clear
        @dragenter.stop='() => false'
        @search='(value:string)=>handleGlobalSearch(value)'
        @press-enter='handleGlobalSearchEnter'
        @keydown.esc=';($event.target as any).blur()' />
      <a-input-search
        v-else
        ref='inputsearch'
        v-model='panfileStore.ListSearchKey'
        :input-attrs="{ tabindex: '-1' }"
        size='small'
        title='Ctrl+F / F3 / Space'
        :placeholder="t('pan.quickFilter')"
        draggable='false'
        allow-clear
        @dragenter.stop='() => false'
        @clear='(e:any)=>handleSearchInput("")'
        @input='(val:any)=>handleSearchInput(val as string)'
        @press-enter='handleSearchEnter'
        @keydown.esc=';($event.target as any).blur()' />
    </div>
    <div></div>
  </div>
  <div style='height: 9px'></div>
  <div class='toppanarea' tabindex='-1'>
    <div style='margin: 0 3px'>
      <AntdTooltip :title="t('pan.selectAllTooltip')" placement='left'>
        <a-button shape='circle' type='text' tabindex='-1' class='select all' title='Ctrl+A' @click='handleSelectAll'>
          <IconFont :name="panfileStore.IsListSelectedAll ? 'iconrsuccess' : 'iconpic2'" />
        </a-button>
      </AntdTooltip>
    </div>
    <div class='selectInfo'>{{ panfileStore.ListDataSelectCountInfo }}</div>
    <div style='margin: 0 2px'>
      <AntdTooltip placement='rightTop'
                   v-if="panfileStore.SelectDirType !== 'video' && panfileStore.ListDataShow.length > 0">
        <a-button shape='square' type='text' tabindex='-1' class='qujian'
                  :status="rangIsSelecting ? 'danger' : 'normal'" title='Ctrl+Q' @click='onSelectRangStart'>
          {{ rangIsSelecting ? t('pan.rangeCancel') : t('pan.rangeSelect') }}
        </a-button>
        <template #title>
          <div>
            {{ t('pan.rangeStep1') }}
            <br />
            {{ t('pan.rangeStep2') }}
            <br />
            {{ t('pan.rangeStep3') }}
          </div>
        </template>
      </AntdTooltip>
      <a-button shape='square'
                v-if='!rangIsSelecting && panfileStore.ListSelected.size > 0 && panfileStore.ListSelected.size < panfileStore.ListDataShow.length'
                type='text'
                tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectReverse'>
        {{ t('pan.invertSelection') }}
      </a-button>
      <a-button shape='square' v-if='!rangIsSelecting && panfileStore.ListSelected.size > 0' type='text' tabindex='-1'
                class='qujian'
                status='normal' @click='onSelectCancel'>
        {{ t('pan.cancelSelected') }}
      </a-button>
    </div>
    <div style='flex-grow: 1'></div>
    <div class='fileorder' v-if='!["pic", "video"].includes(panfileStore.SelectDirType)'>
      <a-dropdown trigger='hover' position='bl' @select='(val:any)=>handleFileListOrder(val as string)'>
        <a-button type='text' size='small' tabindex='-1' :disabled='panfileStore.ListLoading'>
          <IconFont name="iconpaixu1" />
          {{ panfileStore.FileOrderDesc }}
          <IconFont name="icondown" />
        </a-button>
        <template #content>
          <a-doption value='name asc'>
            <template #default>　{{ t('pan.sortNameAsc') }}　</template>
          </a-doption>
          <a-doption value='name desc'>
            <template #default>　{{ t('pan.sortNameDesc') }}　</template>
          </a-doption>
          <a-doption value='updated_at asc'>
            <template #default>　{{ t('pan.sortTimeAsc') }}　</template>
          </a-doption>
          <a-doption value='updated_at desc'>
            <template #default>　{{ t('pan.sortTimeDesc') }}　</template>
          </a-doption>
          <a-doption value='size asc'>
            <template #default>　{{ t('pan.sortSizeAsc') }}　</template>
          </a-doption>
          <a-doption value='size desc'>
            <template #default>　{{ t('pan.sortSizeDesc') }}　</template>
          </a-doption>
        </template>
      </a-dropdown>
    </div>
    <div>
      <AntdTooltip :title="t('pan.listMode')" placement='bottom'>
        <a-button shape='square' type='text' tabindex='-1'
                  :class="settingStore.uiFileListMode === 'list' ? 'select active' : 'select'"
                  @click="() => handleListGridMode('list')">
          <IconFont name="iconliebiaomoshi" />
        </a-button>
      </AntdTooltip>
      <AntdTooltip :title="t('pan.thumbnailMode')" placement='bottom'>
        <a-button shape='square' type='text' tabindex='-1'
                  :class="settingStore.uiFileListMode === 'image' ? 'select active' : 'select'"
                  @click="() => handleListGridMode('image')">
          <IconFont name="iconxiaotumoshi" />
        </a-button>
      </AntdTooltip>
      <AntdTooltip :title="t('pan.largeImageMode')" placement='bottom'>
        <a-button shape='square' type='text' tabindex='-1'
                  :class="settingStore.uiFileListMode === 'bigimage' ? 'select active' : 'select'"
                  @click="() => handleListGridMode('bigimage')">
          <IconFont name="iconsuoluetumoshi" />
        </a-button>
      </AntdTooltip>
    </div>
    <div class='cell pr'></div>
  </div>
  <div
    id='panfilelist'
    :class="'toppanlist' + (showDragUpload ? ' pandraging' : '') + (dragingRowItem ? ' draging' : '') + (rangIsSelecting ? ' ranging' : '')"
    tabindex='-1'
    :style='{ height: winStore.GetListHeight }'
    @keydown.space.prevent='() => true'
    @drop='onPanDrop'
    @dragenter='onPanDragEnter'>
    <a-skeleton v-if='panfileStore.ListLoading && panfileStore.ListDataCount == 0' :loading='true' :animation='true'>
      <a-skeleton-line :rows='10' :line-height='50' :line-spacing='50' />
    </a-skeleton>
    <a-list
      v-else-if="settingStore.uiFileListMode === 'list'"
      ref='viewlist'
      :bordered='false'
      :split='false'
      :max-height='winStore.GetListHeightNumber'
      :virtual-list-props="{
        height: winStore.GetListHeightNumber,
        fixedSize: true,
        estimatedSize: 50,
        threshold: 1,
        itemKey: 'file_id'
      }"
      style='width: 100%'
      :data='panfileStore.ListDataShow'
      tabindex='-1'
      @scroll='handleListScroll'
      @reach-bottom='handleListReachBottom'>
      <template #empty>
        <a-empty :description="t('pan.emptyFolder')" />
      </template>
      <template #item='{ item, index }'>
        <div :key="'l-' + item.file_id" class='listitemdiv'>
          <div
            v-if='item.isDir'
            :class="'fileitem' + (panfileStore.ListSelected.has(item.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == item.file_id ? ' focus' : '')"
            draggable='true'
            @click='handleSelect(item.file_id, $event)'
            @mouseover='onSelectRang(item.file_id)'
            @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:item.file_id}} )'
            @dragstart='(ev) => onRowItemDragStart(ev, item.file_id)'
            @dragend='onRowItemDragEnd'
            @drop='onRowItemDrop($event, item)'
            @dragover='onRowItemDragOver'
            @dragenter='onRowItemDragEnter'
            @dragleave='onRowItemDragLeave'>
            <div
              :class="'rangselect ' + (rangSelectFiles[item.file_id] ? (rangSelectStart == item.file_id ? 'rangstart' : rangSelectEnd == item.file_id ? 'rangend' : 'rang') : '')">
              <a-button shape='circle' type='text' tabindex='-1' class='select' :title='index'
                        @click.prevent.stop='handleSelect(item.file_id, $event, true)'>
                <IconFont :name="panfileStore.ListSelected.has(item.file_id) ? (item.starred ? 'iconcrown3' : 'iconrsuccess') : item.starred ? 'iconcrown' : 'iconpic2'" />
              </a-button>
            </div>
            <div class='fileicon'>
              <IconFont :name="item.icon" aria-hidden='true' />
            </div>
            <div class='filename' droppable='false'>
              <div @click='handleOpenFile($event, item)'>
                {{ item.name }}
              </div>
            </div>
            <div class='filebtn'>
              <template v-if='!item.album_id && item.description'>
                <a-button v-if='!item.description.includes(",") && !item.description.includes("xbyEncrypt")'
                          type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                  <IconFont name="iconwbiaoqian" :class='item.description' />
                </a-button>
                <a-button v-else-if='item.description.includes(",")' type='text' tabindex='-1' class='label'
                          :title="t('pan.mark')">
                  <IconFont name="iconwbiaoqian"
                     :class='item.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                </a-button>
              </template>
              <a-popover v-if='item.thumbnail && !item.description.includes("xbyEncrypt")'
                         content-class='popimg' position='lt'>
                <a-button type='text' tabindex='-1' class='gengduo' :title="t('pan.thumbnail')">
                  <IconFont name="icongengduo" />
                </a-button>
                <template #content>
                  <div class='preimg'>
                    <img :src='item.thumbnail' onerror="javascript:this.src='imgerror.png';" />
                  </div>
                </template>
              </a-popover>
              <a-button v-if='item.description.includes("xbyEncrypt1")'
                        type='text' tabindex='-1' class='label'
                        :title="t('pan.encryptedFile')">
                <IconFont name="iconsafebox" style="color: grey" />
              </a-button>
              <a-button v-else-if='item.description.includes("xbyEncrypt2")'
                        type='text' tabindex='-1' class='label'
                        :title="t('pan.privateFile')">
                <IconFont name="iconsafebox" style="color: pink" />
              </a-button>
              <a-button v-else type='text' tabindex='-1' class='gengduo' disabled></a-button>
            </div>

            <div v-show='!item.album_id' class='filesize'>{{ item.sizeStr }}</div>
            <div v-show='item.file_count' class='filesize'>{{ t('pan.fileCount', { count: item.file_count }) }}</div>
            <div class='filetime'>{{ item.timeStr }}</div>
          </div>
          <div
            v-else
            :class="'fileitem' + (panfileStore.ListSelected.has(item.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == item.file_id ? ' focus' : '')"
            draggable='true'
            @click='handleSelect(item.file_id, $event)'
            @mouseover='onSelectRang(item.file_id)'
            @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:item.file_id}} )'
            @dragstart='(ev) => onRowItemDragStart(ev, item.file_id)'
            @dragend='onRowItemDragEnd'>
            <div
              :class="'rangselect ' + (rangSelectFiles[item.file_id] ? (rangSelectStart == item.file_id ? 'rangstart' : rangSelectEnd == item.file_id ? 'rangend' : 'rang') : '')">
              <a-button shape='circle' type='text' tabindex='-1' class='select' :title='index'
                        @click.prevent.stop='handleSelect(item.file_id, $event, true)'>
                <IconFont :name="panfileStore.ListSelected.has(item.file_id) ? (item.starred ? 'iconcrown3' : 'iconrsuccess') : item.starred ? 'iconcrown' : 'iconpic2'" />
              </a-button>
            </div>
            <div class='fileicon'
                 :title="item.icon == 'iconweifa' ? t('pan.violation') : item.icon == 'iconweixiang' ? t('pan.shareForbidden') : ''">
              <IconFont :name="item.icon" aria-hidden='true' />
            </div>
            <div class='filename' droppable='false'>
              <div @click='handleOpenFile($event, item)'>
                {{ item.name }}
              </div>
            </div>
            <div class='filebtn'>
              <template v-if='!item.album_id && item.description'>
                <a-button v-if='!item.description.includes(",") && !item.description.includes("xbyEncrypt")'
                          type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                  <IconFont name="iconwbiaoqian" :class='item.description' />
                </a-button>
                <a-button v-else-if='item.description.includes(",")' type='text' tabindex='-1' class='label'
                          :title="t('pan.mark')">
                  <IconFont name="iconwbiaoqian"
                     :class='item.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                </a-button>
              </template>
              <a-popover v-if='item.thumbnail && !item.description.includes("xbyEncrypt")' content-class='popimg'
                         position='lt'>
                <a-button type='text' tabindex='-1' class='gengduo'>
                  <IconFont name="icontupianyulan" />
                </a-button>
                <template #content>
                  <div class='preimg'>
                    <img :src='item.thumbnail' onerror="javascript:this.src='imgerror.png';" />
                  </div>
                </template>
              </a-popover>
              <a-button v-if='item.description.includes("xbyEncrypt1")'
                        type='text' tabindex='-1' class='label'
                        :title="t('pan.encryptedFile')">
                <IconFont name="iconsafebox" style="color: grey" />
              </a-button>
              <a-button v-else-if='item.description.includes("xbyEncrypt2")'
                        type='text' tabindex='-1' class='label'
                        :title="t('pan.privateFile')">
                <IconFont name="iconsafebox" style="color: pink" />
              </a-button>
              <a-button v-if="false" type='text' tabindex='-1' class='gengduo' disabled></a-button>
            </div>
            <div class='filesize'>
              {{ item.sizeStr }}
            </div>
            <div class='filetime'>{{ item.timeStr }}</div>
            <div class='filesize' v-show="item.media_duration || item.media_play_cursor">
              <span>{{ t('pan.totalTime') + (item.media_duration || t('pan.unknownDuration')) }}</span>
              <span>{{ t('pan.watchProgress') + (item.media_play_cursor || t('pan.unknownStatus')) }}</span>
              <span>{{ item.media_width > 0 ? item.media_width + 'x' + item.media_height : '' }}</span>
            </div>
          </div>
        </div>
      </template>
    </a-list>

    <a-list
      v-else-if="settingStore.uiFileListMode === 'image'"
      ref='viewlist'
      :bordered='false'
      :split='false'
      :max-height='winStore.GetListHeightNumber'
      :virtual-list-props="{
        height: winStore.GetListHeightNumber,
        fixedSize: true,
        estimatedSize: 200,
        threshold: 1,
        itemKey: 'file_id',
        buffer: 5
      }"
      style='width: 100%'
      :data='panfileStore.ListDataGrid'
      tabindex='-1'
      @scroll='handleListScroll'
      @reach-bottom='handleListReachBottom'>
      <template #empty>
        <a-empty :description="t('pan.emptyFolder')" />
      </template>
      <template #item='{ item, index }'>
        <div :key="'g-' + item.file_id" class='listitemdiv'>
          <div class='gridrow' :style="{ gridTemplateColumns: 'repeat(' + listGridColumn + ', 150px)' }">
            <template v-for='(grid, gindex) in item.files' :key='grid.file_id'>
              <div
                v-if='grid.isDir'
                :class="'griditem ' + settingStore.uiFileListMode + ' ' + (panfileStore.ListSelected.has(grid.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == grid.file_id ? ' focus' : '')"
                draggable='true'
                @click='handleSelect(grid.file_id, $event)'
                @mouseover='() => onSelectRang(grid.file_id)'
                @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:grid.file_id}} )'
                @dragstart='(ev) => onRowItemDragStart(ev, grid.file_id)'
                @dragend='onRowItemDragEnd'
                @drop='onRowItemDrop($event, grid.file_id)'
                @dragover='onRowItemDragOver'
                @dragenter='onRowItemDragEnter'
                @dragleave='onRowItemDragLeave'>
                <div class='gridicon'>
                  <IconFont :name="grid.icon" aria-hidden='true' role='img' />
                </div>
                <div class='gridicon'>
                  <img v-if='grid.thumbnail' :src='grid.thumbnail'
                       @error="(e) => {(e.currentTarget! as any).style.display = 'none'}" />
                </div>
                <div class='gridicon'>
                  <span v-if="grid.category.startsWith('video')" class='playicon' @click='handleOpenFile($event, grid)'>
                    <svg viewBox='0 0 1024 1024'>
                      <path
                        d='M689.066667 480l-196.266667-177.066667c-27.733333-25.6-70.4-6.4-70.4 32v356.266667c0 36.266667 44.8 55.466667 70.4 32l196.266667-177.066667c17.066667-19.2 17.066667-49.066667 0-66.133333z'></path>
                    </svg>
                  </span>
                  <span v-else></span>
                </div>
                <div class='gridname'>
                  <div :title="grid.sizeStr + ' ' + grid.name" @click='handleOpenFile($event, grid)'>
                    {{ grid.name }}
                  </div>
                </div>
                <div class='gridinfo'>{{ grid.timeStr }}</div>
                <div
                  :class="'rangselect ' + (rangSelectFiles[grid.file_id] ? (rangSelectStart == grid.file_id ? 'rangstart' : rangSelectEnd == grid.file_id ? 'rangend' : 'rang') : '')">
                  <a-button shape='circle' type='text' tabindex='-1' class='select'
                            :title='(index * listGridColumn + gindex).toString()'
                            @click.prevent.stop='handleSelect(grid.file_id, $event, true)'>
                    <IconFont :name="panfileStore.ListSelected.has(grid.file_id) ? (grid.starred ? 'iconcrown3' : 'iconrsuccess') : grid.starred ? 'iconcrown' : 'iconpic2'" />
                  </a-button>
                  <template v-if='!grid.album_id && grid.description'>
                    <a-button v-if='!grid.description.includes(",") && !grid.description.includes("xbyEncrypt")'
                              type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian" :class='grid.description' />
                    </a-button>
                    <a-button v-else-if='grid.description.includes(",")' type='text' tabindex='-1' class='label'
                              :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian"
                         :class='grid.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                    </a-button>
                  </template>
                  <a-button v-if='grid.description.includes("xbyEncrypt1")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.encryptedFile')">
                    <IconFont name="iconsafebox" style="color: grey" />
                  </a-button>
                  <a-button v-else-if='grid.description.includes("xbyEncrypt2")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.privateFile')">
                    <IconFont name="iconsafebox" style="color: pink" />
                  </a-button>
                </div>
              </div>
              <div
                v-else
                :class="'griditem ' + settingStore.uiFileListMode + ' ' + (panfileStore.ListSelected.has(grid.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == grid.file_id ? ' focus' : '')"
                draggable='true'
                @click='handleSelect(grid.file_id, $event)'
                @mouseover='() => onSelectRang(grid.file_id)'
                @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:grid.file_id}} )'
                @dragstart='(ev) => onRowItemDragStart(ev, grid.file_id)'
                @dragend='onRowItemDragEnd'>
                <div class='gridicon'>
                  <IconFont :name="grid.icon" aria-hidden='true' role='img' />
                </div>
                <div class='gridicon'>
                  <img v-if='grid.thumbnail' :src='grid.thumbnail'
                       @error="(e) => {(e.currentTarget! as any).style.display = 'none'}" />
                </div>
                <div class='gridicon'>
                  <span v-if="grid.category.startsWith('video')" class='playicon' @click='handleOpenFile($event, grid)'>
                    <svg viewBox='0 0 1024 1024'>
                      <path
                        d='M689.066667 480l-196.266667-177.066667c-27.733333-25.6-70.4-6.4-70.4 32v356.266667c0 36.266667 44.8 55.466667 70.4 32l196.266667-177.066667c17.066667-19.2 17.066667-49.066667 0-66.133333z'></path>
                    </svg>
                  </span>
                  <span v-else></span>
                </div>
                <div class='gridname'>
                  <div :title="grid.sizeStr + ' ' + grid.name" @click='handleOpenFile($event, grid)'>
                    {{ grid.name }}
                  </div>
                </div>
                <div class='gridinfo'>{{ grid.timeStr }}</div>
                <div
                  :class="'rangselect ' + (rangSelectFiles[grid.file_id] ? (rangSelectStart == grid.file_id ? 'rangstart' : rangSelectEnd == grid.file_id ? 'rangend' : 'rang') : '')">
                  <a-button shape='circle' type='text' tabindex='-1' class='select'
                            :title='(index * listGridColumn + gindex).toString()'
                            @click.prevent.stop='handleSelect(grid.file_id, $event, true)'>
                    <IconFont :name="panfileStore.ListSelected.has(grid.file_id) ? (grid.starred ? 'iconcrown3' : 'iconrsuccess') : grid.starred ? 'iconcrown' : 'iconpic2'" />
                  </a-button>
                  <template v-if='!grid.album_id && grid.description'>
                    <a-button v-if='!grid.description.includes(",") && !grid.description.includes("xbyEncrypt")'
                              type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian" :class='grid.description' />
                    </a-button>
                    <a-button v-else-if='grid.description.includes(",")' type='text' tabindex='-1' class='label'
                              :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian"
                         :class='grid.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                    </a-button>
                  </template>
                  <a-button v-if='grid.description.includes("xbyEncrypt1")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.encryptedFile')">
                    <IconFont name="iconsafebox" style="color: grey" />
                  </a-button>
                  <a-button v-else-if='grid.description.includes("xbyEncrypt2")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.privateFile')">
                    <IconFont name="iconsafebox" style="color: pink" />
                  </a-button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </a-list>

    <a-list
      v-else
      ref='viewlist'
      :bordered='false'
      :split='false'
      :max-height='winStore.GetListHeightNumber'
      :virtual-list-props="{
        height: winStore.GetListHeightNumber,
        fixedSize: true,
        estimatedSize: 260,
        threshold: 1,
        itemKey: 'file_id',
        buffer: 5
      }"
      style='width: 100%'
      :data='panfileStore.ListDataGrid'
      tabindex='-1'
      @scroll='handleListScroll'
      @reach-bottom='handleListReachBottom'>
      <template #empty>
        <a-empty :description="t('pan.emptyFolder')" />
      </template>
      <template #item='{ item, index }'>
        <div :key="'g-' + item.file_id" class='listitemdiv'>
          <div class='gridrow' :style="{ gridTemplateColumns: 'repeat(' + listGridColumn + ', 200px)' }">
            <template v-for='(grid, gindex) in item.files' :key='grid.file_id'>
              <div
                v-if='grid.isDir'
                :class="'griditem ' + settingStore.uiFileListMode + ' ' + (panfileStore.ListSelected.has(grid.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == grid.file_id ? ' focus' : '')"
                draggable='true'
                @click='handleSelect(grid.file_id, $event)'
                @mouseover='onSelectRang(grid.file_id)'
                @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:grid.file_id}} )'
                @dragstart='(ev) => onRowItemDragStart(ev, grid.file_id)'
                @dragend='onRowItemDragEnd'
                @drop='onRowItemDrop($event, grid.file_id)'
                @dragover='onRowItemDragOver'
                @dragenter='onRowItemDragEnter'
                @dragleave='onRowItemDragLeave'>
                <div class='gridicon'>
                  <IconFont :name="grid.icon" aria-hidden='true' role='img' />
                </div>
                <div class='gridicon'>
                  <img v-if='grid.thumbnail' :src='grid.thumbnail'
                       @error="(e) => {(e.currentTarget! as any).style.display = 'none'}" />
                </div>
                <div class='gridicon'>
                  <span v-if="grid.category.startsWith('video')" class='playicon' @click='handleOpenFile($event, grid)'>
                    <svg viewBox='0 0 1024 1024'>
                      <path
                        d='M689.066667 480l-196.266667-177.066667c-27.733333-25.6-70.4-6.4-70.4 32v356.266667c0 36.266667 44.8 55.466667 70.4 32l196.266667-177.066667c17.066667-19.2 17.066667-49.066667 0-66.133333z'></path>
                    </svg>
                  </span>
                  <span v-else></span>
                </div>
                <div class='gridname'>
                  <div :title="grid.sizeStr + ' ' + grid.name" @click='handleOpenFile($event, grid)'>
                    {{ grid.name }}
                  </div>
                </div>
                <div class='gridinfo'>{{ grid.timeStr }}</div>
                <div
                  :class="'rangselect ' + (rangSelectFiles[grid.file_id] ? (rangSelectStart == grid.file_id ? 'rangstart' : rangSelectEnd == grid.file_id ? 'rangend' : 'rang') : '')">
                  <a-button shape='circle' type='text' tabindex='-1' class='select'
                            :title='(index * listGridColumn + gindex).toString()'
                            @click.prevent.stop='handleSelect(grid.file_id, $event, true)'>
                    <IconFont :name="panfileStore.ListSelected.has(grid.file_id) ? (grid.starred ? 'iconcrown3' : 'iconrsuccess') : grid.starred ? 'iconcrown' : 'iconpic2'" />
                  </a-button>
                  <template v-if='!grid.album_id && grid.description'>
                    <a-button v-if='!grid.description.includes(",") && !grid.description.includes("xbyEncrypt")'
                              type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian" :class='grid.description' />
                    </a-button>
                    <a-button v-else-if='grid.description.includes(",")' type='text' tabindex='-1' class='label'
                              :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian"
                         :class='grid.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                    </a-button>
                  </template>
                  <a-button v-if='grid.description.includes("xbyEncrypt1")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.encryptedFile')">
                    <IconFont name="iconsafebox" style="color: grey" />
                  </a-button>
                  <a-button v-else-if='grid.description.includes("xbyEncrypt2")'
                            type='text' tabindex='-1' class='label'
                            :title="t('pan.privateFile')">
                    <IconFont name="iconsafebox" style="color: pink" />
                  </a-button>
                </div>
              </div>
              <div
                v-else
                :class="'griditem ' + settingStore.uiFileListMode + ' ' + (panfileStore.ListSelected.has(grid.file_id) ? ' selected' : '') + (panfileStore.ListFocusKey == grid.file_id ? ' focus' : '')"
                draggable='true'
                @click='handleSelect(grid.file_id, $event)'
                @mouseover='() => onSelectRang(grid.file_id)'
                @contextmenu='(event:MouseEvent)=>handleRightClick({event,node:{key:grid.file_id}} )'
                @dragstart='(ev) => onRowItemDragStart(ev, grid.file_id)'
                @dragend='onRowItemDragEnd'>
                <div class='gridicon'>
                  <IconFont :name="grid.icon" aria-hidden='true' role='img' />
                </div>
                <div class='gridicon'>
                  <img v-if='grid.thumbnail' :src='grid.thumbnail'
                       @error="(e) => {(e.currentTarget! as any).style.display = 'none'}" />
                </div>
                <div class='gridicon'>
                  <span v-if="grid.category.startsWith('video')" class='playicon' @click='handleOpenFile($event, grid)'>
                    <svg viewBox='0 0 1024 1024'>
                      <path
                        d='M689.066667 480l-196.266667-177.066667c-27.733333-25.6-70.4-6.4-70.4 32v356.266667c0 36.266667 44.8 55.466667 70.4 32l196.266667-177.066667c17.066667-19.2 17.066667-49.066667 0-66.133333z'></path>
                    </svg>
                  </span>
                  <span v-else></span>
                </div>

                <div class='gridname'>
                  <div :title="grid.sizeStr + ' ' + grid.name" @click='handleOpenFile($event, grid)'>
                    {{ grid.name }}
                  </div>
                </div>

                <div class='gridinfo'>{{ grid.timeStr }}</div>

                <div
                  :class="'rangselect ' + (rangSelectFiles[grid.file_id] ? (rangSelectStart == grid.file_id ? 'rangstart' : rangSelectEnd == grid.file_id ? 'rangend' : 'rang') : '')">
                  <a-button shape='circle' type='text' tabindex='-1' class='select'
                            :title='(index * listGridColumn + gindex).toString()'
                            @click.prevent.stop='handleSelect(grid.file_id, $event, true)'>
                    <IconFont :name="panfileStore.ListSelected.has(grid.file_id) ? (grid.starred ? 'iconcrown3' : 'iconrsuccess') : grid.starred ? 'iconcrown' : 'iconpic2'" />
                  </a-button>
                  <template v-if='!grid.album_id && grid.description'>
                    <a-button v-if='!grid.description.includes(",") && !grid.description.includes("xbyEncrypt")'
                              type='text' tabindex='-1' class='label' :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian" :class='grid.description' />
                    </a-button>
                    <a-button v-else-if='grid.description.includes(",")' type='text' tabindex='-1' class='label'
                              :title="t('pan.mark')">
                      <IconFont name="iconwbiaoqian"
                         :class='grid.description.split(",").filter((v: string)=> !v.includes("xbyEncrypt")).join("")' />
                    </a-button>
                  </template>
                  <a-button v-if='grid.description.includes("xbyEncrypt")' type='text' tabindex='-1' class='label'
                            :title="t('pan.encryptedFile')">
                    <IconFont name="iconsafebox" style="color: grey" />
                  </a-button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </a-list>

    <FileRightMenu :dirtype='panfileStore.SelectDirType'
                   :isvideo='menuShowVideo'
                   :isselected='panfileStore.IsListSelected'
                   :isselectedmulti='panfileStore.IsListSelectedMulti'
                   :inputselectType='inputselectType'
                   :inputpicType='inputpicType'
                   :isallfavored='panfileStore.IsListSelectedFavAll' />
    <TrashRightMenu :dirtype='panfileStore.SelectDirType' />
  </div>

  <div id='PanRightShowUpload' :style="{ display: showDragUpload ? '' : 'none' }" @drop='onPanDrop'
       @dragover='onPanDragOver' @dragleave='onPanDragLeave' @dragend='onPanDragEnd'>
    <div class='ShowUpload'>
      <IconFont name="iconyouxian" style='font-size: 64px' />
      <div class='ShowUploadTitle'>
        <span class='link'>{{ t('pan.uploadTo', { name: panfileStore.DirName }) }}</span>
      </div>
    </div>
  </div>


</template>

<style>
.arco-dropdown-option-icon {
  margin-right: 2px !important;
  width: 20px;
  flex-grow: 0;
  flex-shrink: 0;
  align-items: center;
}

.arco-dropdown-option-icon .iconfont {
  font-size: 18px;
}

.arco-dropdown-option-content > div {
  line-height: 26px;
  height: 26px;
  display: flex;
}

.arco-dropdown-option {
  padding: 0 4px !important;
}

.gengduo {
  width: 24px;
  height: 24px;
  min-height: 24px;
  display: inline-block;
}

.arco-btn-text.arco-btn-disabled.gengduo {
  cursor: default !important;
}

.gengduo:hover {
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.1);
}

.arco-btn.gengduo {
  width: 24px;
  height: 24px;
  min-height: 24px;
  margin: 0;
  padding: 0;
  background: transparent;
  border-color: transparent;
  border-radius: 4px;
}

.arco-btn.gengduo .iconfont {
  font-size: 20px;
  line-height: 20px;
}

.arco-btn.label {
  width: 24px;
  height: 24px;
  min-height: 24px;
  margin: 0;
  padding: 0;
  background: transparent;
  border-color: transparent;
  border-radius: 4px;
  cursor: default;
}

.arco-btn.label .iconfont {
  font-size: 20px;
  line-height: 20px;
}

.popimg {
  padding: 0 !important;
}

.popimg .arco-popover-content {
  margin-top: 0 !important;
}

.rightmenu .arco-dropdown-option {
  line-height: 26px !important;
}

.rightmenu.arco-dropdown-list-wrapper,
.rightmenu .arco-dropdown-list-wrapper {
  max-height: 300px !important;
  overflow-y: auto;
}

.draging .fileitem.selected,
.draging .griditem.selected {
  opacity: 0.6;
}

.draging .fileitem *,
.draging .griditem *,
.ranging .fileitem *,
.ranging .griditem * {
  pointer-events: none;
}

.pandraging {
  pointer-events: none;
}

#PanRightShowUpload {
  position: fixed;
  z-index: 2000;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  background-image: linear-gradient(to top, rgba(120, 115, 245, 0.3) 0%, rgba(120, 115, 245, 0.06) 22%, rgba(236, 119, 171, 0.01) 80%);
}

#PanRightShowUpload .ShowUpload {
  max-width: 80%;
  margin: 16px auto 48px auto;
  overflow: hidden;
  text-align: center;
  pointer-events: none;
}

#PanRightShowUpload .ShowUpload .ShowUploadTitle {
  margin: 0 auto;
  padding: 4px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
}

#PanRightShowUpload .ShowUpload .link {
  overflow: hidden;
  color: #1976d2;
  font-size: 14px;
  white-space: nowrap !important;
  text-overflow: ellipsis;
  word-break: keep-all !important;
}

#PanRightShowUpload .ShowUpload .iconfont {
  color: rgb(120, 115, 245);
}

.fileorder .arco-btn-size-small {
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  min-width: 102px;
}

.fileorder .iconfont {
  font-size: 18px;
  line-height: 24px;
}

#panfilelist .fileitem,
#panfilelist .griditem {
  -webkit-user-drag: element;
}

.toppantip {
  color: var(--color-text-3);
  font-size: 13px;
  flex-grow: 0;
  flex-shrink: 0;
  height: 26px;
  padding: 4px 8px 0 0;
  line-height: 19px;
}

.arco-skeleton-animation .arco-skeleton-line-row {
  opacity: 0.35;
}
</style>
