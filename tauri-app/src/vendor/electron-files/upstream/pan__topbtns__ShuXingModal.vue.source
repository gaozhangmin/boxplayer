<script setup lang='ts'>
import { IAliFileItem, IAliGetForderSizeModel } from '../../aliapi/alimodels'
import AliFile from '../../aliapi/file'
import { useFootStore, usePanFileStore, usePanTreeStore } from '../../store'
import { copyToClipboard } from '../../utils/electronhelper'
import message from '../../utils/message'
import { modalCloseAll } from '../../utils/modal'
import { humanDateTimeDateStr, humanSize, humanTime } from '../../utils/format'
import { ref } from 'vue'
import { Modal } from '@arco-design/web-vue'
import DebugLog from '../../utils/debuglog'
import { GetDriveID, isBaiduUser, isBoxUser, isCloud123User, isDrive115User, isDropboxUser, isGoogleUser, isGuangyaUser, isOneDriveUser, isPikPakUser, isQuarkUser } from '../../aliapi/utils'
import { getEncType, getRawUrl } from '../../utils/proxyhelper'
import { apiCloud123FileDetail } from '../../cloud123/filecmd'
import { apiDrive115FileDetail } from '../../cloud115/filecmd'
import { mapDrive115DetailToAliModel } from '../../cloud115/dirfilelist'
import { mapCloud123InfoToAliModel } from '../../cloud123/dirfilelist'
import TreeStore from '../../store/treestore'
import { apiBaiduFileMetas, mapBaiduMetaToAliFileItem } from '../../cloudbaidu/filecmd'
import { apiPikPakFileDetail, mapPikPakFileToAliModel } from '../../pikpak/dirfilelist'
import { apiDropboxFileDetail, mapDropboxFileToAliModel } from '../../dropbox/dirfilelist'
import type { DropboxMetadata } from '../../dropbox/dirfilelist'
import { apiDropboxListRevisions, apiDropboxRestoreRevision } from '../../dropbox/revisions'
import { apiOneDriveFileDetail, mapOneDriveItemToAliModel } from '../../onedrive/dirfilelist'
import { apiOneDriveListVersions, apiOneDriveRestoreVersion, OneDriveVersion } from '../../onedrive/revisions'
import { apiGuangyaFileDetail, getGuangyaFileId, mapGuangyaFileToAliModel } from '../../guangya/dirfilelist'
import { apiQuarkFileDetail, mapQuarkFileToAliModel } from '../../quark/dirfilelist'
import { apiBoxFileDetail, mapBoxItemToAliModel } from '../../box/dirfilelist'
import { apiBoxDeleteVersion, apiBoxListVersions, apiBoxPromoteVersion, BoxFileVersion } from '../../box/revisions'
import { apiGoogleDeleteRevision, apiGoogleListRevisions, apiGoogleUpdateRevision, GoogleRevision } from '../../google/revisions'
import { apiGoogleDeletePermission, apiGoogleListPermissions } from '../../google/share'
import { resolveDriveFileToken } from '../../drive/account'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  istree: {
    type: Boolean,
    required: true
  },
  ispic: {
    type: Boolean,
    required: true
  }
})

const okLoading = ref(false)
const fileInfo = ref<IAliFileItem>()
const dirInfo = ref<IAliGetForderSizeModel>()
const dirPath = ref('')
const isDropboxFile = ref(false)
const dropboxRevisions = ref<DropboxMetadata[]>([])
const dropboxRevisionLoading = ref(false)
const isOneDriveFile = ref(false)
const oneDriveVersions = ref<OneDriveVersion[]>([])
const oneDriveVersionLoading = ref(false)
const isBoxFile = ref(false)
const boxVersions = ref<BoxFileVersion[]>([])
const boxVersionLoading = ref(false)
const isGoogleFile = ref(false)
const googleRevisions = ref<GoogleRevision[]>([])
const googleRevisionLoading = ref(false)
const googlePermissions = ref<Array<{ id?: string; type?: string; role?: string }>>([])
const googlePermissionLoading = ref(false)
const activeUserId = ref('')
const activeDriveId = ref('')
const handleOpen = async () => {
  const pantreeStore = usePanTreeStore()
  let file_id = ''
  let drive_id = ''
  let file_desc = ''
  let file_user_id = ''
  let selectedFile: any
  let selectedIsDir = props.istree
  if (props.istree) {
    selectedFile = pantreeStore.selectDir
    file_id = pantreeStore.selectDir.file_id
    drive_id = pantreeStore.selectDir.drive_id
    file_desc = pantreeStore.selectDir.description || ''
    file_user_id = (pantreeStore.selectDir as any).user_id || ''
  } else {
    const panfileStore = usePanFileStore()
    let fileList = panfileStore.GetSelected()
    if (fileList.length == 0) {
      const focus = panfileStore.mGetFocus()
      panfileStore.mKeyboardSelect(focus, false, false)
      fileList = panfileStore.GetSelected()
    }
    selectedFile = fileList[0]
    file_id = fileList[0].file_id
    drive_id = fileList[0].drive_id
    file_desc = fileList[0].description || ''
    file_user_id = (fileList[0] as any).user_id || ''
    selectedIsDir = !!fileList[0].isDir
  }
  if (props.ispic) {
    drive_id = GetDriveID(pantreeStore.user_id, 'pic')
    file_user_id = pantreeStore.user_id
  }
  if (!file_id) {
    message.error('没有选中任何文件')
  } else {
    const token = await resolveDriveFileToken({ drive_id, user_id: file_user_id }, pantreeStore.user_id)
    if (!token?.user_id) {
      message.error(`未找到 ${drive_id} 对应的已登录账号`)
      return
    }
    const user_id = token.user_id
    activeUserId.value = user_id
    activeDriveId.value = drive_id
    const isCloudUser = isCloud123User(user_id)
      || drive_id === 'cloud123'
      || pantreeStore.selectDir.drive_id === 'cloud123'
    const is115User = isDrive115User(user_id) || drive_id === 'drive115'
    const isBaidu = isBaiduUser(user_id) || drive_id === 'baidu'
    const isPikPak = isPikPakUser(user_id) || drive_id === 'pikpak'
    const isQuark = isQuarkUser(user_id) || drive_id === 'quark'
    const isDropbox = isDropboxUser(user_id) || drive_id === 'dropbox'
    const isOneDrive = isOneDriveUser(user_id) || drive_id === 'onedrive'
    const isGuangya = isGuangyaUser(user_id) || drive_id === 'guangya'
    const isBox = isBoxUser(user_id) || drive_id === 'box'
    const isGoogle = isGoogleUser(user_id) || drive_id === 'google'
    isDropboxFile.value = isDropbox
    isOneDriveFile.value = isOneDrive
    isBoxFile.value = isBox
    isGoogleFile.value = isGoogle
    if (isCloudUser) {
      const pathList = TreeStore.GetDirPath(drive_id, file_id)
      const pathNames = pathList.map((item) => item.name).filter((name) => name)
      dirPath.value = '/' + pathNames.join('/')
      const detail = await apiCloud123FileDetail(user_id, file_id)
      if (detail) {
        const mapped: any = mapCloud123InfoToAliModel(detail)
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.createAt || detail.create_at || ''
        mapped.updated_at = detail.updateAt || detail.update_at || ''
        fileInfo.value = mapped
      }
    } else if (is115User) {
      const detail = await apiDrive115FileDetail(user_id, file_id)
      if (detail) {
        const mapped: any = mapDrive115DetailToAliModel(detail, drive_id)
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.created_at || ''
        mapped.updated_at = detail.updated_at || ''
        mapped.content_hash = detail.sha1 || ''
        fileInfo.value = mapped
        if (mapped.type === 'folder') {
          dirInfo.value = {
            size: detail.size || 0,
            folder_count: detail.folder_count || 0,
            file_count: detail.file_count || 0,
            reach_limit: undefined
          }
        }
        if (detail.path && detail.path.length > 0) {
          const pathNames = detail.path.map((item) => item.file_name).filter((name) => name)
          dirPath.value = '/' + pathNames.join('/')
        }
      }
    } else if (isBaidu) {
      const descInfo = parseBaiduDesc(file_desc || '')
      const fsid = descInfo.fsid
      console.log('=== 百度网盘属性调试 ===')
      console.log('file_desc:', file_desc)
      console.log('descInfo:', descInfo)
      console.log('fsid:', fsid)
      if (fsid) {
        const metas = await apiBaiduFileMetas(user_id, [fsid], 0, 1, 1, 1, 1)
        console.log('API metas 响应:', metas)
        const meta = metas && metas[0]
        if (meta) {
          console.log('原始 meta 数据:', meta)
          const mapped: any = mapBaiduMetaToAliFileItem(meta, drive_id, file_id)
          console.log('映射后的数据:', mapped)
          fileInfo.value = mapped
          const pathValue = meta.path || descInfo.path || ''
          if (pathValue) {
            const pathParts = pathValue.split('/').filter(Boolean)
            pathParts.pop()
            dirPath.value = '/' + pathParts.join('/')
          }
        } else {
          console.log('未找到 meta 数据')
        }
      } else {
        console.log('未从描述中解析到 fsid')
      }
    } else if (isPikPak) {
      const pathList = TreeStore.GetDirPath(drive_id, file_id)
      const pathNames = pathList.map((item) => item.name).filter((name) => name)
      dirPath.value = '/' + pathNames.join('/')
      const detail = await apiPikPakFileDetail(user_id, file_id)
      if (detail) {
        const mapped: any = mapPikPakFileToAliModel(detail, drive_id, detail.parent_id || 'pikpak_root')
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.created_time || ''
        mapped.updated_at = detail.modified_time || detail.created_time || ''
        fileInfo.value = mapped
      }
    } else if (isQuark) {
      const pathList = TreeStore.GetDirPath(drive_id, file_id)
      const pathNames = pathList.map((item) => item.name).filter((name) => name)
      dirPath.value = '/' + pathNames.join('/')
      const detail = await apiQuarkFileDetail(user_id, file_id)
      if (detail) {
        const mapped: any = mapQuarkFileToAliModel(detail, drive_id, detail.pdir_fid || 'quark_root')
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.created_at || ''
        mapped.updated_at = detail.updated_at || mapped.created_at
        fileInfo.value = mapped
      }
    } else if (isDropbox) {
      const detail = await apiDropboxFileDetail(user_id, file_id)
      if (detail) {
        const parentPath = detail.path_display?.split('/').filter(Boolean) || []
        parentPath.pop()
        dirPath.value = parentPath.length ? '/' + parentPath.join('/') : '/'
        const parentId = detail.path_display ? detail.path_display.split('/').slice(0, -1).join('/') : 'dropbox_root'
        const mapped: any = mapDropboxFileToAliModel(detail, drive_id, parentId || 'dropbox_root')
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.server_modified || detail.client_modified || ''
        mapped.updated_at = detail.server_modified || detail.client_modified || ''
        mapped.content_hash = detail.content_hash || ''
        fileInfo.value = mapped
      }
    } else if (isOneDrive) {
      const detail = await apiOneDriveFileDetail(user_id, file_id)
      if (detail) {
        const parentPath = (detail.parentReference?.path || '').replace(/^\/drive\/root:/, '') || '/'
        dirPath.value = parentPath || '/'
        const parentId = detail.parentReference?.id || 'onedrive_root'
        const mapped: any = mapOneDriveItemToAliModel(detail, drive_id || 'onedrive', parentId)
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.createdDateTime || ''
        mapped.updated_at = detail.lastModifiedDateTime || detail.createdDateTime || ''
        mapped.content_hash = detail.file?.hashes?.sha1Hash || detail.file?.hashes?.quickXorHash || ''
        fileInfo.value = mapped
      }
    } else if (isGuangya) {
      const pathList = TreeStore.GetDirPath(drive_id, file_id)
      const pathNames = pathList.map((item) => item.name).filter((name) => name)
      dirPath.value = '/' + pathNames.join('/')
      const detail = await apiGuangyaFileDetail(user_id, file_id)
      const source = detail && getGuangyaFileId(detail) ? detail : selectedFile
      if (source) {
        const mapped: any = mapGuangyaFileToAliModel(source, drive_id || 'guangya', source.parentId || source.parentFileId || source.parent_file_id || 'guangya_root')
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = source.createAt || source.createdAt || source.created_at || source.createTime || ''
        mapped.updated_at = source.updateAt || source.updatedAt || source.updated_at || source.updateTime || mapped.created_at
        mapped.content_hash = source.contentHash || source.content_hash || source.md5 || source.sha1 || source.gcid || ''
        fileInfo.value = mapped
      }
    } else if (isBox) {
      const detail = await apiBoxFileDetail(user_id, file_id, selectedIsDir)
      if (detail) {
        const mapped: any = mapBoxItemToAliModel(detail, drive_id || 'box', detail.parent?.id || 'box_root')
        mapped.type = mapped.isDir ? 'folder' : 'file'
        mapped.created_at = detail.created_at || ''
        mapped.updated_at = detail.modified_at || detail.created_at || ''
        mapped.content_hash = detail.sha1 || ''
        fileInfo.value = mapped
        const pathEntries = detail.path_collection?.entries || []
        dirPath.value = '/' + pathEntries.map((entry) => entry.name || '').filter(Boolean).join('/')
      }
    } else {
      let path_file_id = props.ispic ? 'pic_root' : file_id
      let fileName = pantreeStore.selectDir.name
      AliFile.ApiFileGetPathString(user_id, drive_id, path_file_id, '/').then((data) => {
        dirPath.value = '/' + data + (props.ispic ? '/' + fileName : '')
      })
      fileInfo.value = await AliFile.ApiFileInfo(user_id, drive_id, file_id, props.ispic)
    }
    if (fileInfo.value && ['audio', 'video'].includes(fileInfo.value.category)) {
      const encType = getEncType(fileInfo.value)
      const category = fileInfo.value.category
      const rawUrl = await getRawUrl(
        user_id, drive_id, file_id,
        encType, '',
        category === 'audio', category
      )
      if (typeof rawUrl == 'string') {
        message.error(rawUrl)
      } else if (rawUrl && rawUrl.url) {
        fileInfo.value.thumbnail = rawUrl.url
      }
    }
    if (fileInfo.value?.type == 'folder' && !isCloudUser && !is115User && !isBaidu && !isPikPak && !isQuark && !isDropbox && !isOneDrive && !isGuangya && !isBox) {
      dirInfo.value = await AliFile.ApiFileGetFolderSize(user_id, drive_id, file_id)
    }
  }
}

const handleClose = () => {

  if (okLoading.value) okLoading.value = false
  dirInfo.value = { size: 0, folder_count: 0, file_count: 0, reach_limit: undefined }
  fileInfo.value = undefined
  dirPath.value = ''
  isDropboxFile.value = false
  dropboxRevisions.value = []
  dropboxRevisionLoading.value = false
  isOneDriveFile.value = false
  oneDriveVersions.value = []
  oneDriveVersionLoading.value = false
  isBoxFile.value = false
  boxVersions.value = []
  boxVersionLoading.value = false
  activeUserId.value = ''
  activeDriveId.value = ''
}

const makeFenBianLv = (width: number | undefined, height: number | undefined) => {
  if (!width) width = 0
  if (!height) height = 0
  if (width == 0 || height == 0) return ''
  return width + ' x ' + height
}

const makeImageSheBei = (exif: string | undefined) => {
  if (!exif) return ''
  try {
    let msg = ''
    const exobj = JSON.parse(exif)
    if (exobj.Make && exobj.Make.value) msg += exobj.Make.value + ' '
    if (exobj.Model && exobj.Model.value) msg += exobj.Model.value + ' '
    return msg
  } catch (err: any) {
    DebugLog.mSaveWarning(exif, err)
  }
  return ''
}

const makeImageShiJian = (exif: string | undefined) => {
  if (!exif) return ''
  try {
    const exobj = JSON.parse(exif)
    if (exobj.DateTimeOriginal && exobj.DateTimeOriginal.value) return exobj.DateTimeOriginal.value
    if (exobj.DateTimeDigitized && exobj.DateTimeDigitized.value) return exobj.DateTimeDigitized.value
    if (exobj.DateTime && exobj.DateTime.value) return exobj.DateTime.value
  } catch (err: any) {
    DebugLog.mSaveWarning(exif, err)
  }
  return ''
}

const handleAudioPlay = () => {
  useFootStore().mSaveAudioUrl('')
}

const formateSize = ref(true)
const handleSize = () => {
  formateSize.value = !formateSize.value
}

const handleHide = () => {
  modalCloseAll()
}

const handleCopyFileName = () => {
  if (fileInfo.value?.name) {
    copyToClipboard(fileInfo.value?.name)
    message.success('文件名已复制到剪切板')
  }
}
const handleCopyJson = () => {
  if (fileInfo.value) {
    copyToClipboard(JSON.stringify(fileInfo.value))
    message.success('文件信息已复制到剪切板')
  }
}
const handleCopyDownload = () => {
  if (fileInfo.value && activeUserId.value && activeDriveId.value) {
    getRawUrl(activeUserId.value, activeDriveId.value, fileInfo.value.file_id || '', getEncType(fileInfo.value)).then(data => {
      if (data && typeof data !== 'string' && data.url) {
        copyToClipboard(data.url)
        message.success('下载链接已复制到剪切板，4小时内有效')
      } else {
        message.error('下载链接获取失败，请稍后重试')
      }
    })
  } else {
    message.error('下载链接获取失败，请稍后重试')
  }
}
const handleCopyThumbnail = () => {
  if (fileInfo.value?.thumbnail) {
    copyToClipboard(fileInfo.value?.thumbnail)
    message.success('预览链接已复制到剪切板')
  }
}

const handleLoadDropboxRevisions = async () => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !activeUserId.value) return
  dropboxRevisionLoading.value = true
  try {
    dropboxRevisions.value = await apiDropboxListRevisions(activeUserId.value, fileId, 20)
    if (dropboxRevisions.value.length === 0) message.info('没有可恢复的历史版本')
  } finally {
    dropboxRevisionLoading.value = false
  }
}

const handleRestoreDropboxRevision = (revision: DropboxMetadata) => {
  const filePath = fileInfo.value?.path || ''
  if (!filePath || !revision.rev || !activeUserId.value) return
  Modal.confirm({
    title: '恢复 Dropbox 版本',
    content: `恢复到 ${humanDateTimeDateStr(revision.server_modified || revision.client_modified)} 的版本？`,
    okText: '恢复',
    cancelText: '取消',
    onOk: async () => {
      const restored = await apiDropboxRestoreRevision(activeUserId.value, filePath, revision.rev || '')
      if (restored) {
        message.success('Dropbox 文件版本已恢复')
        dropboxRevisions.value = []
      }
    }
  })
}

const handleLoadOneDriveVersions = async () => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !activeUserId.value) return
  oneDriveVersionLoading.value = true
  try {
    oneDriveVersions.value = await apiOneDriveListVersions(activeUserId.value, fileId)
    if (oneDriveVersions.value.length === 0) message.info('没有可恢复的历史版本')
  } finally {
    oneDriveVersionLoading.value = false
  }
}

const handleRestoreOneDriveVersion = (version: OneDriveVersion) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !version.id || !activeUserId.value) return
  Modal.confirm({
    title: '恢复 OneDrive 版本',
    content: `恢复到 ${humanDateTimeDateStr(version.lastModifiedDateTime)} 的版本？`,
    okText: '恢复',
    cancelText: '取消',
    onOk: async () => {
      const restored = await apiOneDriveRestoreVersion(activeUserId.value, fileId, version.id || '')
      if (restored) {
        message.success('OneDrive 文件版本已恢复')
        oneDriveVersions.value = []
      }
    }
  })
}

const handleLoadBoxVersions = async () => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !activeUserId.value) return
  boxVersionLoading.value = true
  try {
    boxVersions.value = await apiBoxListVersions(activeUserId.value, fileId)
    if (boxVersions.value.length === 0) message.info('没有可恢复的历史版本')
  } finally {
    boxVersionLoading.value = false
  }
}

const handleRestoreBoxVersion = (version: BoxFileVersion) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !version.id || !activeUserId.value) return
  Modal.confirm({
    title: '恢复 Box 版本',
    content: `恢复到 ${humanDateTimeDateStr(version.modified_at)} 的版本？`,
    okText: '恢复',
    cancelText: '取消',
    onOk: async () => {
      if (await apiBoxPromoteVersion(activeUserId.value, fileId, version.id || '')) {
        message.success('Box 文件版本已恢复')
        boxVersions.value = []
      }
    }
  })
}

const handleDeleteBoxVersion = (version: BoxFileVersion) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !version.id || !activeUserId.value) return
  Modal.confirm({
    title: '删除 Box 历史版本',
    content: `永久删除 ${humanDateTimeDateStr(version.modified_at)} 的历史版本？此操作无法恢复。`,
    okText: '永久删除',
    cancelText: '取消',
    onOk: async () => {
      if (await apiBoxDeleteVersion(activeUserId.value, fileId, version.id || '')) {
        message.success('Box 历史版本已删除')
        await handleLoadBoxVersions()
      }
    }
  })
}

const parseBaiduDesc = (desc: string) => {
  const fsidMatch = desc.match(/baidu_fsid:([0-9]+)/)
  const pathMatch = desc.match(/baidu_path:([^;]+)/)
  return {
    fsid: fsidMatch ? Number(fsidMatch[1]) : 0,
    path: pathMatch ? pathMatch[1] : ''
  }
}
const handleLoadGoogleRevisions = async () => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !activeUserId.value) return
  googleRevisionLoading.value = true
  try {
    googleRevisions.value = await apiGoogleListRevisions(activeUserId.value, fileId)
    if (!googleRevisions.value.length) message.info('没有可管理的历史版本')
  } finally { googleRevisionLoading.value = false }
}

const handleLoadGooglePermissions = async () => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !activeUserId.value) return
  googlePermissionLoading.value = true
  try { googlePermissions.value = await apiGoogleListPermissions(activeUserId.value, fileId) } finally { googlePermissionLoading.value = false }
}

const handleRevokeGooglePermission = (permissionId: string) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !permissionId || !activeUserId.value) return
  Modal.confirm({ title: '撤销 Google Drive 分享', content: '确认撤销此公开分享权限？持有链接的用户将无法继续访问。', okText: '撤销', cancelText: '取消', onOk: async () => {
    if (await apiGoogleDeletePermission(activeUserId.value, fileId, permissionId)) {
      googlePermissions.value = googlePermissions.value.filter((item) => item.id !== permissionId)
      message.success('分享权限已撤销')
    }
  } })
}

const handleGoogleRevisionPinned = async (revision: GoogleRevision, keepForever: boolean) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !revision.id || !activeUserId.value) return
  const updated = await apiGoogleUpdateRevision(activeUserId.value, fileId, revision.id, keepForever)
  if (updated) {
    revision.keepForever = keepForever
    message.success(keepForever ? '版本已固定' : '已取消固定版本')
  }
}

const handleDeleteGoogleRevision = (revision: GoogleRevision) => {
  const fileId = fileInfo.value?.file_id || ''
  if (!fileId || !revision.id || !activeUserId.value) return
  Modal.confirm({ title: '删除 Google Drive 版本', content: '确认永久删除这个历史版本？此操作无法撤销。', okText: '删除', cancelText: '取消', onOk: async () => {
    if (await apiGoogleDeleteRevision(activeUserId.value, fileId, revision.id || '')) {
      googleRevisions.value = googleRevisions.value.filter((item) => item.id !== revision.id)
      message.success('历史版本已删除')
    }
  } })
}

</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass shuxingmodal' :footer='false' :unmount-on-close='true'
           :mask-closable='false' @cancel='handleHide' @before-open='handleOpen' @close='handleClose'>
    <template #title>
      <span class='modaltitle'>查看属性</span>
    </template>
    <div class='modalbody' style='width: 520px; max-height: calc(80vh - 100px); overflow-y: scroll'>
      <a-row>
        <a-col flex='auto'> 路径：</a-col>
      </a-row>
      <div class='pathtitle'>
        {{ dirPath }}
      </div>
      <div class='h16'></div>

      <a-row>
        <a-col flex='auto'> 文件名：</a-col>
      </a-row>
      <div class='shuxingbox'>
        <span class='shuxingtitle'>{{ fileInfo?.name }}</span>
        <a-button type='outline' size='mini' tabindex='-1' title='复制' @click='handleCopyFileName'>复制</a-button>
      </div>
      <div class='h16'></div>

      <a-row>
        <a-col flex='110px'> 文件大小： <IconFont name="iconchakan" class="link" title='点击切换格式' @click='handleSize' />
        </a-col>
        <a-col flex='auto'></a-col>
        <a-col flex='170px'> 创建日期：</a-col>
        <a-col flex='auto'></a-col>
        <a-col flex='180px'> 更新日期：</a-col>
      </a-row>
      <a-row>
        <a-col flex='110px'>
          <a-input size='small' tabindex='-1'
                   :model-value="formateSize ? humanSize(fileInfo?.size || dirInfo?.size || 0) : (fileInfo?.size || dirInfo?.size || 0) + ' 字节'"
                   readonly />
        </a-col>
        <a-col flex='auto'></a-col>
        <a-col flex='170px'>
          <a-input size='small' tabindex='-1' :model-value='humanDateTimeDateStr(fileInfo?.created_at)' readonly />
        </a-col>
        <a-col flex='auto'></a-col>
        <a-col flex='180px'>
          <a-input size='small' tabindex='-1' :model-value='humanDateTimeDateStr(fileInfo?.updated_at)' readonly />
        </a-col>
      </a-row>
      <div class='h16'></div>

      <div v-if="fileInfo?.type == 'file'">
        <a-row>
          <a-col flex='110px'> 分类：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'> 媒体类型：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'> 描述：</a-col>
        </a-row>
        <a-row>
          <a-col flex='110px'>
            <a-input size='small' tabindex='-1' :model-value='fileInfo?.category' readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'>
            <a-input size='small' tabindex='-1' :model-value='fileInfo?.mime_type' readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'>
            <a-input size='small' tabindex='-1' :model-value='fileInfo?.description' readonly />
          </a-col>
        </a-row>
        <div class='h16'></div>

        <a-row>
          <a-col flex='1'> SHA1：</a-col>
        </a-row>
        <a-row>
          <a-col flex='1'>
            <a-input size='small' class='small' tabindex='-1' :model-value='fileInfo?.content_hash' readonly />
          </a-col>
        </a-row>
      </div>
      <div v-else>
        <a-row>
          <a-col flex='1'> 文件夹信息：</a-col>
        </a-row>
        <a-row>
          <a-col flex='1'>
            <a-input size='small' class='small' tabindex='-1'
                     :model-value="'子文件大小：' + humanSize(dirInfo?.size) + '，子文件：' + dirInfo?.file_count + '个，子文件夹：' + dirInfo?.folder_count + '个'"
                     readonly />
          </a-col>
        </a-row>
      </div>

      <div v-if="fileInfo?.category == 'video'">
        <div class='h16'></div>
        <a-row>
          <a-col flex='110px'> 分辨率：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'> 视频时长：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'> 制作日期：</a-col>
        </a-row>
        <a-row>
          <a-col flex='110px'>
            <a-input size='small' tabindex='-1'
                     :model-value='makeFenBianLv(fileInfo?.video_media_metadata?.width, fileInfo?.video_media_metadata?.height)'
                     readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'>
            <a-input size='small' tabindex='-1' :model-value='humanTime(fileInfo?.video_media_metadata?.duration)'
                     readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'>
            <a-input size='small' tabindex='-1'
                     :model-value='humanDateTimeDateStr(fileInfo?.video_media_metadata?.time)' readonly />
          </a-col>
        </a-row>
      </div>

      <div v-if="fileInfo?.category == 'image'">
        <div class='h16'></div>
        <a-row>
          <a-col flex='110px'> 分辨率：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'> 拍摄设备：</a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'> 拍摄日期：</a-col>
        </a-row>
        <a-row>
          <a-col flex='110px'>
            <a-input size='small' tabindex='-1'
                     :model-value='makeFenBianLv(fileInfo?.image_media_metadata?.width, fileInfo?.image_media_metadata?.height)'
                     readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='170px'>
            <a-input size='small' tabindex='-1' :model-value='makeImageSheBei(fileInfo?.image_media_metadata?.exif)'
                     readonly />
          </a-col>
          <a-col flex='auto'></a-col>
          <a-col flex='180px'>
            <a-input size='small' tabindex='-1' :model-value='makeImageShiJian(fileInfo?.image_media_metadata?.exif)'
                     readonly />
          </a-col>
        </a-row>
      </div>

      <div v-if="fileInfo?.category == 'audio'">
        <div class='h16'></div>
        <div width='100%'>
          <audio controls style='width: 100%; height: 32px' :src='fileInfo?.thumbnail' @play='handleAudioPlay'>
            您的浏览器不支持 audio 元素
          </audio>
        </div>
      </div>

      <div v-if="isDropboxFile && fileInfo?.type == 'file'">
        <div class='h16'></div>
        <a-row>
          <a-col flex='1'> Dropbox 版本：</a-col>
          <a-col flex='120px'>
            <a-button type='outline' size='mini' :loading='dropboxRevisionLoading' @click='handleLoadDropboxRevisions'>
              加载版本
            </a-button>
          </a-col>
        </a-row>
        <div v-if='dropboxRevisions.length > 0' class='dropboxrevisionlist'>
          <div v-for='revision in dropboxRevisions' :key='revision.rev || revision.server_modified' class='dropboxrevisionitem'>
            <span>{{ humanDateTimeDateStr(revision.server_modified || revision.client_modified) }}</span>
            <span>{{ humanSize(revision.size || 0) }}</span>
            <a-button type='outline' size='mini' @click='() => handleRestoreDropboxRevision(revision)'>恢复</a-button>
          </div>
        </div>
      </div>

      <div v-if="isOneDriveFile && fileInfo?.type == 'file'">
        <div class='h16'></div>
        <a-row>
          <a-col flex='1'> OneDrive 版本：</a-col>
          <a-col flex='120px'>
            <a-button type='outline' size='mini' :loading='oneDriveVersionLoading' @click='handleLoadOneDriveVersions'>
              加载版本
            </a-button>
          </a-col>
        </a-row>
        <div v-if='oneDriveVersions.length > 0' class='dropboxrevisionlist'>
          <div v-for='version in oneDriveVersions' :key='version.id || version.lastModifiedDateTime' class='dropboxrevisionitem'>
            <span>{{ humanDateTimeDateStr(version.lastModifiedDateTime) }}</span>
            <span>{{ humanSize(version.size || 0) }}</span>
            <a-button type='outline' size='mini' @click='() => handleRestoreOneDriveVersion(version)'>恢复</a-button>
          </div>
        </div>
      </div>

      <div v-if="isBoxFile && fileInfo?.type == 'file'">
        <div class='h16'></div>
        <a-row>
          <a-col flex='1'> Box 版本：</a-col>
          <a-col flex='120px'>
            <a-button type='outline' size='mini' :loading='boxVersionLoading' @click='handleLoadBoxVersions'>加载版本</a-button>
          </a-col>
        </a-row>
        <div v-if='boxVersions.length > 0' class='dropboxrevisionlist'>
          <div v-for='version in boxVersions' :key='version.id || version.modified_at' class='dropboxrevisionitem'>
            <span>{{ humanDateTimeDateStr(version.modified_at) }}</span>
            <span>{{ humanSize(version.size || 0) }}</span>
            <a-button type='outline' size='mini' @click='() => handleRestoreBoxVersion(version)'>恢复</a-button>
            <a-button status='danger' type='outline' size='mini' @click='() => handleDeleteBoxVersion(version)'>删除</a-button>
          </div>
        </div>
      </div>

      <div v-if="isGoogleFile && fileInfo?.type == 'file'">
        <div class='h16'></div>
        <a-row><a-col flex='1'> Google Drive 版本：</a-col><a-col flex='120px'><a-button type='outline' size='mini' :loading='googleRevisionLoading' @click='handleLoadGoogleRevisions'>加载版本</a-button></a-col></a-row>
        <div v-if='googleRevisions.length > 0' class='dropboxrevisionlist'>
          <div v-for='revision in googleRevisions' :key='revision.id || revision.modifiedTime' class='dropboxrevisionitem'>
            <span>{{ humanDateTimeDateStr(revision.modifiedTime) }}</span><span>{{ humanSize(Number(revision.size || 0)) }}</span>
            <a-button type='outline' size='mini' @click='() => handleGoogleRevisionPinned(revision, !revision.keepForever)'>{{ revision.keepForever ? '取消固定' : '固定' }}</a-button>
            <a-button status='danger' type='outline' size='mini' @click='() => handleDeleteGoogleRevision(revision)'>删除</a-button>
          </div>
        </div>
      </div>

      <div v-if="isGoogleFile">
        <div class='h16'></div>
        <a-row><a-col flex='1'> Google Drive 分享权限：</a-col><a-col flex='120px'><a-button type='outline' size='mini' :loading='googlePermissionLoading' @click='handleLoadGooglePermissions'>加载权限</a-button></a-col></a-row>
        <div v-if='googlePermissions.length > 0' class='dropboxrevisionlist'>
          <div v-for='permission in googlePermissions' :key='permission.id' class='dropboxrevisionitem'>
            <span>{{ permission.type === 'anyone' ? '持有链接的任何人' : permission.type }}</span><span>{{ permission.role }}</span>
            <a-button v-if="permission.type === 'anyone'" status='danger' type='outline' size='mini' @click='() => handleRevokeGooglePermission(permission.id || "")'>撤销链接</a-button>
          </div>
        </div>
      </div>

      <div class='h16'></div>
    </div>
    <div class='h16'></div>
    <div class='modalfoot'>
      <a-button type='outline' size='small' @click='handleCopyJson'>复制JSON</a-button>
      <div style='flex-grow: 1'></div>
      <template v-if="fileInfo?.description && !fileInfo?.description.includes('xbyEncrypt')">
        <a-button v-if="fileInfo?.category == 'video'" type='outline' size='small' @click='handleCopyThumbnail'>
          复制M3U8链接
        </a-button>
        <a-button v-if="fileInfo?.category == 'audio'" type='outline' size='small' @click='handleCopyThumbnail'>
          复制M3U8链接
        </a-button>
      </template>
      <a-button v-if="fileInfo?.type !== 'folder'" type='outline' size='small' @click='handleCopyDownload'>
        复制下载链接
      </a-button>
    </div>
  </a-modal>
</template>

<style>
.shuxingbox {
  width: 100%;

  background-color: rgba(132, 133, 141, 0.08);
  border-radius: 4px;
  -webkit-backdrop-filter: saturate(150%) blur(30px);
  backdrop-filter: saturate(150%) blur(30px);
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.shuxingtitle {
  color: rosybrown;
  margin: 0;
  max-width: calc(100% - 48px);
  display: inline-block;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  word-wrap: break-word;
  user-select: text;
}

.shuxingbox button {
  align-self: flex-end;
  padding: 0 8px;
}

.pathtitle {
  color: var(--color-text-3);
  margin: 0;
  max-width: calc(100%);
  display: inline-block;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  word-wrap: break-word;
  user-select: text;

  background-color: var(--color-fill-2);
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
}

.dropboxrevisionlist {
  margin-top: 8px;
  border: 1px solid var(--color-border-2);
  border-radius: 4px;
  overflow: hidden;
}

.dropboxrevisionitem {
  display: grid;
  grid-template-columns: 1fr 88px 58px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-1);
  font-size: 12px;
}

.dropboxrevisionitem:last-child {
  border-bottom: none;
}

.h16 {
  padding-top: 16px;
}

.shuxingmodal .arco-input-wrapper {
  padding: 0 8px;
}

.shuxingmodal .small .arco-input {
  font-size: 13px !important;
  line-height: 22px !important;
}

i.link {
  color: rgb(var(--primary-6));
  cursor: pointer;
}
</style>
