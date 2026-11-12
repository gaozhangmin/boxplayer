import {applyColorResult} from '../../aliColorTransport'
import {ApiBatchMaker,ApiBatchSuccess} from './aliBatchMakers'
import {ApiBatch} from '../../aliRenameTransport'
import {ApiBatchMaker2} from './aliBatchMakers'
import {AliFileHttp as AliHttp,EncodeEncName,DebugLog,type ProviderFileCommandOptions} from '../../aliFileHttp'
import {mutationAccount} from '../../providerTransport'
import {aliFolderAccount,aliFolderAccount as aliRenameAccount,aliFolderAccount as aliRelocationAccount,aliFolderAccount as aliTrashAccount} from '../../aliFolderTransport'
export async function ApiCreatNewForder(
    user_id: string, drive_id: string,
    parent_file_id: string, creatDirName: string,
    encType: string = '', check_name_mode: string = 'refuse', providerOptions: ProviderFileCommandOptions = {}
  ): Promise<{ file_id: string; error: string }> {
    const result = { file_id: '', error: '新建文件夹失败' }
    if (!user_id || !drive_id || !parent_file_id) return result
    aliFolderAccount(user_id)
    if (parent_file_id === 'root') parent_file_id = 'root'
    const url = 'adrive/v2/file/createWithFolders'
    const name = EncodeEncName(user_id, creatDirName, true, encType)
    const postData = JSON.stringify({
      drive_id: drive_id,
      parent_file_id: parent_file_id,
      name: name,
      check_name_mode: check_name_mode,
      type: 'folder',
      description: encType
    })
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const file_id = resp.body.file_id as string | undefined
      if (file_id) return { file_id, error: '' }
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiCreatNewForder err=' + parent_file_id + ' ' + (resp.code || ''), resp.body)
    }
    if (resp.body?.code == 'QuotaExhausted.Drive') return { file_id: '', error: '网盘空间已满,无法创建' }
    if (resp.body?.code) return { file_id: '', error: resp.body?.code }
    return result
  }

export async function ApiRenameBatch(user_id: string, drive_id: string, file_idList: string[], names: string[]): Promise<{
    file_id: string;
    parent_file_id: string;
    name: string;
    isDir: boolean
  }[]> {
    aliRenameAccount(user_id)
    const batchList = ApiBatchMaker2('/file/update', file_idList, names, (file_id: string, name: string) => {
      return { drive_id: drive_id, file_id: file_id, name: name, check_name_mode: 'refuse' }
    })

    if (batchList.length == 0) return Promise.resolve([])
    const successList: { file_id: string; parent_file_id: string; name: string; isDir: boolean }[] = []
    const result = await ApiBatch(file_idList.length <= 1 ? '' : '批量重命名', batchList, user_id, '')
    result.reslut.map((t) => successList.push({
      file_id: t.file_id!,
      name: t.name!,
      parent_file_id: t.parent_file_id!,
      isDir: t.type !== 'folder'
    }))
    return successList
  }

export async function ApiMoveBatch(user_id: string, drive_id: string, file_idList: string[], to_drive_id: string, to_parent_file_id: string, to_parent_description: string = ''): Promise<string[]> {
    aliRelocationAccount(user_id)
    if (to_parent_file_id === 'root') to_parent_file_id = 'root'
    const batchList = ApiBatchMaker('/file/move', file_idList, (file_id: string) => {
      if (drive_id == to_drive_id) return {
        drive_id: drive_id,
        file_id: file_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
      else return {
        drive_id: drive_id,
        file_id: file_id,
        to_drive_id: to_drive_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
    })
    return ApiBatchSuccess(file_idList.length <= 1 ? '移动' : '批量移动', batchList, user_id, '')
  }

export async function ApiCopyBatch(user_id: string, drive_id: string, file_idList: string[], to_drive_id: string, to_parent_file_id: string, to_parent_description: string = ''): Promise<string[]> {
    aliRelocationAccount(user_id)
    if (to_parent_file_id === 'root') to_parent_file_id = 'root'
    const batchList = ApiBatchMaker('/file/copy', file_idList, (file_id: string) => {
      if (drive_id == to_drive_id) return {
        drive_id: drive_id,
        file_id: file_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
      else return {
        drive_id: drive_id,
        file_id: file_id,
        to_drive_id: to_drive_id,
        to_parent_file_id: to_parent_file_id,
        auto_rename: true
      }
    })
    return ApiBatchSuccess(file_idList.length <= 1 ? '复制' : '批量复制', batchList, user_id, '')
  }

export async function ApiTrashBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<string[]> {
    aliTrashAccount(user_id)
    const batchList = ApiBatchMaker('/recyclebin/trash', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess('放入回收站', batchList, user_id, '')
  }

export async function ApiDeleteBatch(user_id: string, drive_id: string, file_idList: string[]): Promise<string[]> {
    aliTrashAccount(user_id)
    const batchList = ApiBatchMaker('/file/delete', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess('彻底删除', batchList, user_id, '')
  }

export async function ApiTrashCleanBatch(user_id: string, drive_id: string, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    mutationAccount(user_id,'aliyun')
    const batchList = ApiBatchMaker('/file/delete', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess(ismessage ? '从回收站删除' : '', batchList, user_id, '')
  }

export async function ApiTrashRestoreBatch(user_id: string, drive_id: string, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    mutationAccount(user_id,'aliyun')
    const batchList = ApiBatchMaker('/recyclebin/restore', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id }
    })
    return ApiBatchSuccess(ismessage ? '从回收站还原' : '', batchList, user_id, '')
  }

export async function ApiRecoverBatch(user_id: string, resumeList: {
    drive_id: string;
    file_id: string;
    content_hash: string;
    size: number;
    name: string
  }[]): Promise<string[] | string> {
    const successList: string[] = []
    if (!resumeList || resumeList.length == 0) return Promise.resolve(successList)
    mutationAccount(user_id,'aliyun')

    const url = 'adrive/v1/file/resumeDeleted'
    const postData = JSON.stringify({ resume_file_list: resumeList })
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const task_id = resp.body.task_id as string
      if (!user_id || !task_id) return []
      for (let j = 0; j < 100; j++) {
        const url2 = 'adrive/v1/file/checkResumeTask'
        const resp2 = await AliHttp.Post(url2, { task_id }, user_id, '')
        if (AliHttp.IsSuccess(resp2.code)) {

          if (resp2.body.state == 'running') continue
          if (resp2.body.state == 'done') {
            const results = resp2.body.results as any[]
            if (results) {
              results.map((t: any) => {
                if (t.status && t.status == 200) successList.push(t.file_id)
                return true
              })
            }
            return successList
          }
        }
      }
    } else if (resp.code && resp.code == 403) {
      if (resp.body?.code == 'UserNotVip') return '文件恢复功能需要开通阿里云盘会员'
      else return resp.body?.code || '拒绝访问'
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiRecoverBatch err=' + (resp.code || ''), resp.body)
      return '操作失败'
    }
    return successList
  }

export async function ApiFavorBatch(user_id: string, drive_id: string, isfavor: boolean, ismessage: boolean, file_idList: string[]): Promise<string[]> {
    mutationAccount(user_id,'aliyun')
    const batchList = ApiBatchMaker('/file/update', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id, custom_index_key: isfavor ? 'starred_yes' : '', starred: isfavor }
    })
    return ApiBatchSuccess(ismessage ? (isfavor ? '收藏文件' : '取消收藏') : '', batchList, user_id, '')
  }

export async function ApiFileColorBatch(user_id: string, drive_id: string, description: string, color: string, file_idList: string[]) {
    mutationAccount(user_id,'aliyun')
    // 防止加密标记清空
    let parts = description.split(',') || []
    let encryptPart = parts.find((part: any) => part.includes('xbyEncrypt')) || ''
    let colorPart = parts.find((part: any) => /c.{6}$/.test(part)) || ''
    if (color) {
      if (color.includes('xbyEncrypt')) {
        encryptPart = color
      } else if (color === 'notEncrypt') {
        encryptPart = ''
      } else {
        colorPart = color
      }
    }
    color = color ? [encryptPart, colorPart].filter(Boolean).join(',') : encryptPart
    let batchList = ApiBatchMaker('/file/update', file_idList, (file_id: string) => {
      return { drive_id: drive_id, file_id: file_id, description: color }
    })
    let title = ''
    if (color == '' || color == 'notEncrypt') {
      title = '清除标记'
    } else if (color.includes('ce74c3c')) {
      title = ''
    } else if (color.includes('xbyEncrypt')) {
      title = '标记加密'
    }
    let successList = await ApiBatchSuccess(title, batchList, user_id, '')
    applyColorResult(user_id, drive_id, color, successList)
  }
