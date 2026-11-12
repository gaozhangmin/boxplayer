import type {IAliGetDirModel} from '../aliapi/alimodels'
import {AliDirectoryIndexHttp as AliHttp} from '../../aliDirectoryIndexPorts'
const MapValueToArray=<T>(values:Map<string,T>)=>Array.from(values.values())
const DebugLog={mSaveWarning:(_message:string,_detail?:unknown)=>{}}
interface IAliDirResp {items:IAliGetDirModel[];next_marker:string;m_user_id:string;m_drive_id:string;dirID:string;dirName:string}
export async function ApiFastAllDirList(user_id: string, drive_id: string): Promise<IAliDirResp> {
    const result: IAliDirResp = {
      items: [],
      next_marker: '',
      m_user_id: user_id,
      m_drive_id: drive_id,
      dirID: 'root',
      dirName: ''
    }
    if (!user_id || !drive_id) return result

    const lockSet = new Set<string>()
    const allMap = new Map<string, IAliGetDirModel>()
    let errorMessage = ''
    let next_marker1 = ''
    let next_marker2 = ''
    while (true) {
      let postData = '{"requests":['
      postData += '{"body": {"drive_id": "' + drive_id + '","query": "type = \\"folder\\"","limit": 100,"fields": "thumbnail","order_by":"name ASC"' + (next_marker1 ? ',"marker":"' + next_marker1 + '"' : '') + '},'
      postData += '"headers": { "Content-Type": "application/json" }, "id": "id1","method": "POST","url": "/file/search"},'
      postData += '{"body": {"drive_id": "' + drive_id + '","query": "type = \\"folder\\"","limit": 100,"fields": "thumbnail","order_by":"name DESC"' + (next_marker2 ? ',"marker":"' + next_marker2 + '"' : '') + '},'
      postData += '"headers": { "Content-Type": "application/json" }, "id": "id2","method": "POST","url": "/file/search"}'
      postData += '],"resource":"file"}'

      const url = 'adrive/v4/batch?jsonmask=responses(id%2Cstatus%2Cbody(next_marker%2Citems(name%2Cfile_id%2Cdrive_id%2Cupdated_at%2Csize%2Cdescription%2Cparent_file_id)))'
      const resp = await AliHttp.Post(url, postData, user_id, '')

      try {
        if (AliHttp.IsSuccess(resp.code)) {
          const resp1 = resp.body.responses[0]
          const resp2 = resp.body.responses[1]
          if (resp1.status >= 200 && resp1.status <= 205 && resp2.status >= 200 && resp2.status <= 205) {
            next_marker1 = resp1.body.next_marker
            next_marker2 = resp2.body.next_marker

            let isFind = false
            for (let i = 0, maxi = resp1.body.items.length; i < maxi; i++) {
              const item = resp1.body.items[i]
              if (lockSet.has(item.file_id)) {
                isFind = true
              } else {
                const add: IAliGetDirModel = {
                  __v_skip: true,
                  drive_id: item.drive_id,
                  file_id: item.file_id,
                  parent_file_id: item.parent_file_id,
                  name: item.name,
                  namesearch: '',
                  size: item.size || 0,
                  time: new Date(item.updated_at).getTime(),

                  description: item.description || ''
                }
                allMap.set(add.file_id, add)
                lockSet.add(item.file_id)
              }
            }
            for (let i = 0, maxi = resp2.body.items.length; i < maxi; i++) {
              const item = resp2.body.items[i]
              if (lockSet.has(item.file_id)) {
                isFind = true
              } else {
                const add: IAliGetDirModel = {
                  __v_skip: true,
                  drive_id: item.drive_id,
                  file_id: item.file_id,
                  parent_file_id: item.parent_file_id,
                  name: item.name,
                  namesearch: '',
                  size: item.size || 0,
                  time: new Date(item.updated_at).getTime(),

                  description: item.description || ''
                }
                allMap.set(add.file_id, add)
                lockSet.add(item.file_id)
              }
            }
            if (isFind) break
            if (resp1.body.next_marker == '' && resp2.body.next_marker == '') break
          } else {

            errorMessage += 'err1' + (resp1.status || '')
            errorMessage += 'err2' + (resp2.status || '')
            break
          }
        } else if (resp.code == 402) {
          DebugLog.mSaveWarning('ApiFastAllDirList err=' + drive_id + ' ' + (resp.code || ''), resp.body)
          break
        } else if (!AliHttp.HttpCodeBreak(resp.code)) {
          errorMessage += 'err' + (resp.code || '')
          DebugLog.mSaveWarning('ApiFastAllDirList err=' + (resp.code || ''), resp.body)
        }
      } catch (err: any) {

        errorMessage += 'err' + (err.message || '')
        DebugLog.mSaveWarning('ApiFastAllDirList', err)
        break
      }
    }

    const list = MapValueToArray(allMap)
    console.log('listcount', list.length)
    result.items = errorMessage ? [] : list
    result.next_marker = errorMessage

    return result
  }
