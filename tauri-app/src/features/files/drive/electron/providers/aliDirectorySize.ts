import {AliDirectorySizeHttp as AliHttp} from '../../aliDirectorySizePorts'
const MapValueToArray=<T>(values:Map<string,T>)=>Array.from(values.values())
const DebugLog={mSaveWarning:(_message:string,_detail?:unknown)=>{}}
export async function ApiDirFileSize(user_id: string, drive_id: string, file_idList: string[]): Promise<{
    dirID: string;
    size: number
  }[] | undefined> {
    const list: Map<string, { dirID: string; size: number }> = new Map<string, { dirID: string; size: number }>()
    for (let i = 0, maxi = file_idList.length; i < maxi; i++) {
      list.set(file_idList[i], { dirID: file_idList[i], size: 0 })
      let id = file_idList[i].includes('root') ? 'root' : file_idList[i]
      let postData = {
        drive_id: drive_id,
        limit: 100,
        query: 'parent_file_id="' + id + '" and type="file"',
        fields: 'thumbnail',
        order_by: 'size DESC'
      }
      const url = 'adrive/v3/file/search?jsonmask=next_marker%2Citems(size)'
      const resp = await AliHttp.Post(url, postData, user_id, '')
      try {
        if (AliHttp.IsSuccess(resp.code)) {
          if (resp.body && resp.body.items && resp.body.items.length > 0) {
            let size = 0
            const items = resp.body.items
            for (let k = 0, maxk = items.length; k < maxk; k++) {
              size += items[k].size || 0
            }
            const find = list.get(id)
            if (find) find.size = size
          }
          return MapValueToArray(list)
        } else {
          DebugLog.mSaveWarning('ApiDirFileSize err=' + (resp.code || ''), resp.body)
          return undefined
        }
      } catch (err: any) {
        DebugLog.mSaveWarning('ApiDirFileSize', err)
      }
    }
    return MapValueToArray(list)
  }
