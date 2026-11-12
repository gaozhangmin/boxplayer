interface DirData {file_id:string}
export function TotalSize(file_id: string, DirTotalSizeMap: { [key: string]: number }, DirFileSizeMap: {
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
