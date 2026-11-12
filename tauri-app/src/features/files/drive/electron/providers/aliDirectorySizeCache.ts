import {DriverData,_SaveDirSize,_RefreshAllDirTotalSize} from '../../aliDirectoryCachePorts'
export function GetDirSizeNeedRefresh(drive_id: string, maxCacheTime: number = 604800): string[] {
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

export function SaveDirSizeNeedRefresh(drive_id: string, dirSizeList: {
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
