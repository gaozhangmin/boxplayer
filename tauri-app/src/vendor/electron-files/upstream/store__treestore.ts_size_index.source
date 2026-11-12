import { IAliFileResp } from '../aliapi/dirfilelist'
import { IAliGetDirModel, IAliGetFileModel } from '../aliapi/alimodels'
import DB from '../utils/db'
import { ArrayCopy } from '../utils/utils'
import { usePanTreeStore, useSettingStore } from '../store'
import { throttle } from '../utils/debounce'
import { OrderNode } from '../utils/filenameorder'
import { GetDriveType } from '../aliapi/utils'
import { t } from '../i18n'

export interface TreeNodeData {
  __v_skip: true
  key: string
  drive_id?: string
  parent_file_id?: string
  path?: string
  title: string
  namesearch?: string
  description?: string
  children: TreeNodeData[]
  icon?: any
  isLeaf?: boolean
}

export interface DirData {
  file_id: string
  drive_id: string
  parent_file_id: string
  path?: string
  description: string
  name: string
  time: number
  size: number
}

export interface IDriverModel {
  drive_id: string

  DirMap: Map<string, DirData>

  DirChildrenMap: Map<string, DirData[]>

  DirFileSizeMap: { [key: string]: number }

  DirFileSizeTimeMap: { [key: string]: number }

  DirTotalSizeMap: { [key: string]: number }

  FileOrderMap: { [key: string]: string }
}

const DriverData = new Map<string, IDriverModel>()

const UserAllDir = new Map<string, number>()

export default class TreeStore {

  static async ConvertToOneDriver(user_id: string, drive_id: string, children: DirData[], saveToDB: boolean, saveToDriverData: boolean): Promise<IDriverModel> {
    console.log('ConvertToOneDriver', drive_id)
    if (saveToDB) {
      UserAllDir.set(drive_id, new Date().getTime())
      await DB.saveValueObject('AllDir_' + drive_id, children)
      await DB.saveValueNumber('AllDir_' + drive_id, Date.now())
    }

    const OneDriver: IDriverModel = {
      drive_id,
      DirMap: new Map<string, DirData>(),
      DirChildrenMap: new Map<string, DirData[]>(),
      DirFileSizeMap: {},
      DirFileSizeTimeMap: {},
      DirTotalSizeMap: {},
      FileOrderMap: {}
    }

    const jsonSize = await DB.getValueObject('DirFileSize_' + drive_id)
    const sizeMap = jsonSize ? (jsonSize as { [key: string]: number }) : {}
    const jsonSizeTime = await DB.getValueObject('DirFileSizeTime_' + drive_id)
    const sizeTimeMap = jsonSizeTime ? (jsonSizeTime as { [key: string]: number }) : {}

    const jsonOrder = await DB.getValueObject('DirFileOrder_' + drive_id)
    OneDriver.FileOrderMap = jsonOrder ? (jsonOrder as { [key: string]: string }) : {}
    const driveType = GetDriveType(user_id, drive_id)
    const root: DirData = {
      file_id: driveType.key,
      parent_file_id: '',
      drive_id: drive_id,
      name: driveType.title,
      description: '',
      time: 0,
      size: 0
    }
    OneDriver.DirMap.set(root.file_id, root)
    const childrenMap = new Map<string, DirData[]>()
    childrenMap.set(root.file_id, [])

    try {
      let parent_file_id: string = ''
      let childDirList: DirData[] = []
      let item: DirData
      for (let i = 0, maxi = children.length; i < maxi; i++) {
        item = children[i]
        OneDriver.DirMap.set(item.file_id, item)
        OneDriver.DirFileSizeMap[item.file_id] = sizeMap[item.file_id] || 0
        OneDriver.DirFileSizeTimeMap[item.file_id] = sizeTimeMap[item.file_id] || 0
        if (parent_file_id != item.parent_file_id) {
          if (childrenMap.has(item.parent_file_id)) {
            childDirList = childrenMap.get(item.parent_file_id)!
          } else {
            childDirList = []
            childrenMap.set(item.parent_file_id, childDirList)
          }
          parent_file_id = item.parent_file_id
        }
        childDirList.push(item)
      }
    } catch {
    }
    if (saveToDriverData) {
      const childrenMap2 = new Map<string, DirData[]>()
      childrenMap.forEach(function(value, key) {
        Object.freeze(value)
        childrenMap2.set(key, value)
      })
      OneDriver.DirChildrenMap = childrenMap2
      OneDriver.DirTotalSizeMap.root = TotalSize(driveType.key, OneDriver.DirTotalSizeMap, OneDriver.DirFileSizeMap, OneDriver.DirChildrenMap)
      DriverData.set(OneDriver.drive_id, OneDriver)
    } else {
      OneDriver.DirChildrenMap = childrenMap
    }
    return OneDriver
  }


  static async SaveOneDriver(OneDriver: IDriverModel): Promise<void> {
    const childrenMap2 = new Map<string, DirData[]>()
    // console.warn('SaveOneDriver.OneDriver', OneDriver)
    OneDriver.DirChildrenMap.forEach((value, key) => {
      Object.freeze(value)
      childrenMap2.set(key, value)
    })
    OneDriver.DirChildrenMap = childrenMap2
    DriverData.set(OneDriver.drive_id, OneDriver)
    _RefreshAllDirTotalSizeFunc(OneDriver.drive_id)
  }


  static async SaveOneDirFileList(oneDir: IAliFileResp, hasFiles: boolean): Promise<void> {
    console.log('SaveOneDirFileList', oneDir.dirID)
    if (oneDir.dirID == 'favorite' || oneDir.dirID == 'trash'
      || oneDir.dirID == 'recover' || oneDir.dirID.includes('pic')
      || oneDir.dirID.startsWith('search') || oneDir.dirID.startsWith('video')
      || oneDir.dirID.startsWith('color')) {
      return
    }
    let driverData = DriverData.get(oneDir.m_drive_id)
    if (!driverData) {
      const cache = await DB.getValueObject('AllDir_' + oneDir.m_drive_id)
      if (cache) {
        console.log('SaveOneDirFileList LoadCacheAllDir')
        driverData = await TreeStore.ConvertToOneDriver(oneDir.m_user_id, oneDir.m_drive_id, cache as DirData[], false, true)
      } else {
        console.log('SaveOneDirFileList 初始化空目录树')
        driverData = await TreeStore.ConvertToOneDriver(oneDir.m_user_id, oneDir.m_drive_id, [], false, true)
      }
    }

    const dirs: IAliGetFileModel[] = []
    const files: IAliGetFileModel[] = []
    for (let i = 0, maxi = oneDir.items.length; i < maxi; i++) {
      if (oneDir.items[i].isDir) dirs.push(oneDir.items[i])
      else files.push(oneDir.items[i])
    }
    if (hasFiles) {

      let dirSize = 0
      for (let i = 0, maxi = files.length; i < maxi; i++) {
        if (!files[i].isDir) dirSize += files[i].size
      }
      driverData.DirFileSizeMap[oneDir.dirID] = dirSize
      driverData.DirFileSizeTimeMap[oneDir.dirID] = Math.floor(Date.now() / 1000) - 1654500000
    }


    const dirList: DirData[] = []
    const driveType = GetDriveType(oneDir.m_user_id, oneDir.m_drive_id)
    const isRootDir = oneDir.dirID == driveType.key
    for (let i = 0, maxi = dirs.length; i < maxi; i++) {
      const item = dirs[i]
      let parent_file_id = item.parent_file_id || oneDir.dirID
      if (isRootDir && (!parent_file_id || parent_file_id == '0' || parent_file_id == '/' || parent_file_id == 'root')) parent_file_id = driveType.key
      const dirItem: DirData = {
        file_id: item.file_id,
        drive_id: item.drive_id,
        parent_file_id,
        path: item.path,
        name: item.name,
        time: item.time,
        description: item.description,
        size: 0
      }
      dirList.push(dirItem)
      driverData.DirMap.set(dirItem.file_id, dirItem)
    }
    Object.freeze(dirList)
    driverData.DirChildrenMap.set(oneDir.dirID, dirList)


    let dirID = oneDir.dirID
    while (true) {
      driverData.DirTotalSizeMap[dirID] = TotalSize(dirID, driverData.DirTotalSizeMap, driverData.DirFileSizeMap, driverData.DirChildrenMap)
      const tdir = driverData.DirMap.get(dirID)
      if (tdir && !tdir.parent_file_id.includes('root') && tdir.parent_file_id != '') {
        dirID = tdir.parent_file_id
      } else break
    }
    if (!oneDir.dirID.includes('_root')) _SaveDirSize()
  }


  static GetDirOrder(drive_id: string, file_id: string): string {
    const settingStore = useSettingStore()
    let order = settingStore.uiFileListOrder || 'name asc'
    if (settingStore.uiFileOrderDuli != 'null') {
      const driverData = DriverData.get(drive_id)
      if (driverData) order = driverData.FileOrderMap[file_id] || settingStore.uiFileOrderDuli || order
    }
    return order.toLowerCase()
  }


  static SaveDirOrder(drive_id: string, file_id: string, order: string): void {
    const settingStore = useSettingStore()
    if (settingStore.uiFileOrderDuli != 'null') {
      const driverData = DriverData.get(drive_id)
      if (driverData) {
        driverData.FileOrderMap[file_id] = order
        DB.saveValueObject('DirFileOrder_' + drive_id, driverData.FileOrderMap)
      }
    } else {
      settingStore.updateStore({ uiFileListOrder: order })
    }
  }

  static GetTreeDataToShow(driverData: IDriverModel, node: TreeNodeData, expandedKeys: Set<string>, map: Map<string, TreeNodeData>, getChildren: boolean, order: string = '', isLeafForce: boolean = false): void {
    let childDirList: DirData[] = ArrayCopy(driverData.DirChildrenMap.get(node.key) || [])
    node.isLeaf = isLeafForce ? false : childDirList.length == 0
    let dirOrder = ''
    if (!order) {
      const settingStore = useSettingStore()
      if (settingStore.uiFileOrderDuli != 'null') {
        dirOrder = driverData.FileOrderMap[node.key] || settingStore.uiFileOrderDuli || settingStore.uiFileListOrder || 'name asc'
      } else {
        dirOrder = settingStore.uiFileListOrder || 'name asc'
        order = dirOrder
      }
    } else dirOrder = order
    if (dirOrder.startsWith('size ')) {
      for (let i = 0, maxi = childDirList.length; i < maxi; i++) {
        const item = childDirList[i]
        item.size = driverData.DirTotalSizeMap[item.file_id] || 0
      }
    }
    childDirList = OrderNode(dirOrder, childDirList) as DirData[]
    const children: TreeNodeData[] = []
    for (let i = 0, maxi = childDirList.length; i < maxi; i++) {
      const item = childDirList[i]
      const itemNode: TreeNodeData = {
        __v_skip: true,
        key: item.file_id,
        drive_id: item.drive_id,
        parent_file_id: item.parent_file_id,
        path: item.path,
        title: item.name,
        description: item.description,
        children: []
      }
      if (expandedKeys.has(itemNode.key) || getChildren) {
        TreeStore.GetTreeDataToShow(driverData, itemNode, expandedKeys, map, true, order, isLeafForce)
      }
      children.push(itemNode)
      map.set(itemNode.key, itemNode)
    }
    node.children = children
  }

  static GetDriver(drive_id: string): IDriverModel | undefined {
    return DriverData.get(drive_id)
  }


  static GetDir(drive_id: string, file_id: string): IAliGetDirModel | undefined {
    if (file_id == 'backup_root') return {
      __v_skip: true,
      drive_id,
      file_id: 'backup_root',
      parent_file_id: '',
      name: t('media.backupDrive'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'resource_root') return {
      __v_skip: true,
      drive_id,
      file_id: 'resource_root',
      parent_file_id: '',
      name: t('media.resourceDrive'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'pic_root') return {
      __v_skip: true,
      drive_id,
      file_id: 'pic_root',
      parent_file_id: '',
      name: t('tree.allAlbums'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'mypic') return {
      __v_skip: true,
      drive_id,
      file_id: 'mypic',
      parent_file_id: '',
      name: t('tree.myAlbums'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'favorite') return {
      __v_skip: true,
      drive_id,
      file_id: 'favorite',
      parent_file_id: '',
      name: t('tree.favorites'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'recent') return {
      __v_skip: true,
      drive_id,
      file_id: 'recent',
      parent_file_id: '',
      name: '最近文件',
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'trash') return {
      __v_skip: true,
      drive_id,
      file_id: 'trash',
      parent_file_id: '',
      name: t('tree.trash'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'recover') return {
      __v_skip: true,
      drive_id,
      file_id: 'recover',
      parent_file_id: '',
      name: t('tree.recover'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id.startsWith('search')) return {
      __v_skip: true,
      drive_id,
      file_id: file_id,
      parent_file_id: '',
      name: (t('tree.search') + ' ' + file_id.substring(6)).trimEnd(),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id.startsWith('color')) return {
      __v_skip: true,
      drive_id,
      file_id: file_id,
      parent_file_id: '',
      name: t('tree.mark') + ' · ' + file_id.substring(file_id.indexOf(' ') + 1),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id == 'video') return {
      __v_skip: true,
      drive_id,
      file_id: 'video',
      parent_file_id: '',
      name: t('tree.screeningRoom'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }
    if (file_id.startsWith('video')) {
      let videoType = file_id.substring('video'.length)
      // console.log('videoType', videoType)
      if (videoType == '.compilation') {
        videoType = t('file.allAlbums')
      } else if (videoType == '.recentplay') {
        videoType = t('file.nowWatching')
      }
      return {
        __v_skip: true,
        drive_id,
        file_id: file_id,
        parent_file_id: '',
        name: t('tree.screeningRoom') + ' · ' + videoType,
        namesearch: '',
        size: 0,
        time: 0,
        description: ''
      }
    }

    const driverData = DriverData.get(drive_id)
    if (!driverData) return undefined
    const dir = driverData.DirMap.get(file_id)
    if (!dir) return undefined
    const driveType = GetDriveType(usePanTreeStore().user_id, drive_id)
    if (dir.parent_file_id === 'root') dir.parent_file_id = driveType.key
    if (dir.file_id === 'root') dir.file_id = driveType.key
    return { __v_skip: true, namesearch: '', ...dir }
  }


  static GetDirPath(drive_id: string, file_id: string): IAliGetDirModel[] {
    const dirPath: IAliGetDirModel[] = []
    if (!drive_id || !file_id) return dirPath
    if (file_id == 'backup_root') return [{
      __v_skip: true,
      drive_id,
      file_id: 'backup_root',
      parent_file_id: '',
      name: t('media.backupDrive'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'resource_root') return [{
      __v_skip: true,
      drive_id,
      file_id: 'resource_root',
      parent_file_id: '',
      name: t('media.resourceDrive'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'pic_root') return [{
      __v_skip: true,
      drive_id,
      file_id: 'pic_root',
      parent_file_id: '',
      name: t('tree.allAlbums'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'mypic') return [{
      __v_skip: true,
      drive_id,
      file_id: 'mypic',
      parent_file_id: '',
      name: t('tree.myAlbums'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'favorite') return [{
      __v_skip: true,
      drive_id,
      file_id: 'favorite',
      parent_file_id: '',
      name: t('tree.favorites'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'recent') return [{
      __v_skip: true,
      drive_id,
      file_id: 'recent',
      parent_file_id: '',
      name: '最近文件',
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'trash') return [{
      __v_skip: true,
      drive_id,
      file_id: 'trash',
      parent_file_id: '',
      name: t('tree.trash'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'recover') return [{
      __v_skip: true,
      drive_id,
      file_id: 'recover',
      parent_file_id: '',
      name: t('tree.recover'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'search') return [{
      __v_skip: true,
      drive_id,
      file_id: 'search',
      parent_file_id: '',
      name: t('tree.globalSearch'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id.startsWith('search')) {
      return [
        {
          __v_skip: true,
          drive_id,
          file_id: 'search',
          parent_file_id: '',
          name: t('tree.globalSearch'),
          namesearch: '',
          size: 0,
          time: 0,
          description: ''
        },
        {
          __v_skip: true,
          drive_id,
          file_id: file_id,
          parent_file_id: 'search',
          name: file_id.substring(6),
          namesearch: '',
          size: 0,
          time: 0,
          description: ''
        }
      ]
    }
    if (file_id.startsWith('color')) return [{
      __v_skip: true,
      drive_id,
      file_id: file_id,
      parent_file_id: '',
      name: t('tree.mark') + ' · ' + file_id.substring(file_id.indexOf(' ') + 1),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id == 'video') return [{
      __v_skip: true,
      drive_id,
      file_id: 'video',
      parent_file_id: '',
      name: t('tree.screeningRoom'),
      namesearch: '',
      size: 0,
      time: 0,
      description: ''
    }]
    if (file_id.startsWith('video')) {
      let videoType = file_id.substring('video'.length)
      if (videoType == '.compilation') {
        videoType = t('file.allAlbums')
      } else if (videoType == '.recentplay') {
        videoType = t('file.nowWatching')
      }
      return [
        {
          __v_skip: true,
          drive_id,
          file_id: 'video',
          parent_file_id: '',
          name: t('tree.screeningRoom'),
          namesearch: '',
          size: 0,
          time: 0,
          description: ''
        },
        {
          __v_skip: true,
          drive_id,
          file_id: file_id,
          parent_file_id: '',
          name: t('tree.screeningRoom') + ' · ' + videoType,
          namesearch: '',
          size: 0,
          time: 0,
          description: ''
        }
      ]
    }

    const driverData = DriverData.get(drive_id)
    if (!driverData) return dirPath
    const dirMap = driverData.DirMap
    const driveType = GetDriveType(usePanTreeStore().user_id, drive_id)
    while (true) {
      const dir = dirMap.get(file_id)
      if (!dir) break
      if (dir.parent_file_id === 'root') dir.parent_file_id = driveType.key
      if (dir.file_id === 'root') dir.file_id = driveType.key
      dirPath.push({ __v_skip: true, namesearch: '', ...dir } as IAliGetDirModel)
      file_id = dir.parent_file_id
    }
    dirPath.reverse()
    return dirPath
  }


  static GetDirChildDirID(drive_id: string, file_id: string): string[] {
    const allList: string[] = []
    const driverData = DriverData.get(drive_id)
    if (!driverData) return allList
    const childrens = driverData.DirChildrenMap.get(file_id)
    if (childrens) childrens.map((t) => allList.push(t.file_id))
    return allList
  }


  static RenameDirs(drive_id: string, fileList: {
    file_id: string;
    parent_file_id: string;
    name: string;
    isDir: boolean
  }[]): void {
    const driverData = DriverData.get(drive_id)
    if (!driverData) return
    const dirMap = driverData.DirMap
    for (let i = 0, maxi = fileList.length; i < maxi; i++) {
      const item = fileList[i]
      if (!item.isDir) continue
      const findNode = dirMap.get(item.file_id)
      if (findNode) findNode.name = item.name
    }
  }


  static DeleteDirs(drive_id: string, file_idList: string[]): void {
    const driverData = DriverData.get(drive_id)
    if (!driverData) return
    const dirMap = driverData.DirMap
    const dirChildrenMap = driverData.DirChildrenMap
    for (let i = 0, maxi = file_idList.length; i < maxi; i++) {
      const dirID = file_idList[i]
      const dir = dirMap.get(dirID)
      if (dir) {
        const parent_file_id = dir.parent_file_id
        let clist = dirChildrenMap.get(parent_file_id)
        if (clist) {
          clist = clist.filter((t) => t.file_id != dirID)
          Object.freeze(clist)
          dirChildrenMap.set(parent_file_id, clist)
        }
      }
      dirMap.delete(dirID)
      dirChildrenMap.delete(dirID)
    }
  }


  static GetDirSizeNeedRefresh(drive_id: string, maxCacheTime: number = 604800): string[] {
    const driverData = DriverData.get(drive_id)
    if (!driverData) return []
    const map = driverData.DirMap.keys()
    const timeMap = driverData.DirFileSizeTimeMap
    const timeNow = Math.floor(Date.now() / 1000) - 1654500000
    const diridList: string[] = []
    while (true) {
      const next = map.next()
      if (next.done) break
      const file_id = next.value as string
      const time = timeMap[file_id] || 0
      if (file_id && (time == 0 || timeNow - time > maxCacheTime)) {
        diridList.push(file_id)
      }
    }
    return diridList
  }


  static SaveDirSizeNeedRefresh(drive_id: string, dirSizeList: {
    dirID: string;
    size: number
  }[]): void {
    const driverData = DriverData.get(drive_id)
    if (!driverData) return
    console.log('SaveDirSizeNeedRefresh', drive_id)
    const fileMap = driverData.DirFileSizeMap
    const timeMap = driverData.DirFileSizeTimeMap
    const timeNow = Math.floor(Date.now() / 1000) - 1654500000
    for (let i = 0, maxi = dirSizeList.length; i < maxi; i++) {
      const t = dirSizeList[i]
      fileMap[t.dirID] = t.size
      timeMap[t.dirID] = timeNow
    }
    _SaveDirSize(drive_id)
    _RefreshAllDirTotalSize(drive_id)
  }


  static ClearDirSize(drive_id: string, parentDirIDList: string[]) {
    const driverData = DriverData.get(drive_id)
    if (!driverData) return
    const timeMap = driverData.DirFileSizeTimeMap
    for (let i = 0, maxi = parentDirIDList.length; i < maxi; i++) {
      timeMap[parentDirIDList[i]] = 0
    }
  }
}

const _SaveDirSize = throttle((drive_id: string) => {
  const driverData = DriverData.get(drive_id)
  if (!driverData) return
  DB.saveValueObjectBatch(['DirFileSize_' + drive_id, 'DirFileSizeTime_' + drive_id], [driverData.DirFileSizeMap, driverData.DirFileSizeTimeMap])
}, 5000)

const _RefreshAllDirTotalSize = throttle((drive_id: string) => {
  _RefreshAllDirTotalSizeFunc(drive_id)
}, 12000, false, true)

function _RefreshAllDirTotalSizeFunc(drive_id: string): void {
  const driverData = DriverData.get(drive_id)
  if (!driverData) return
  console.log('_RefreshAllDirTotalSizeFunc', drive_id)
  const driveType = GetDriveType(usePanTreeStore().user_id, drive_id)
  driverData.DirTotalSizeMap.root = TotalSize(driveType.key, driverData.DirTotalSizeMap, driverData.DirFileSizeMap, driverData.DirChildrenMap)
  _SaveDirSize(drive_id)
}

function TotalSize(file_id: string, DirTotalSizeMap: { [key: string]: number }, DirFileSizeMap: {
  [key: string]: number
}, DirChildrenMap: Map<string, DirData[]>): number {
  const dirChildrenList = DirChildrenMap.get(file_id) || []
  let size = DirFileSizeMap[file_id] || 0
  for (let i = 0, maxi = dirChildrenList.length; i < maxi; i++) {
    size += TotalSize(dirChildrenList[i].file_id, DirTotalSizeMap, DirFileSizeMap, DirChildrenMap)
  }
  DirTotalSizeMap[file_id] = size
  return size
}
