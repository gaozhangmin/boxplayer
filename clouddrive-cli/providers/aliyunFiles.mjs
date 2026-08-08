import { aliPost } from './aliyunHttp.mjs'
import { open } from 'node:fs/promises'
import { readSlice, toConflictMode } from './uploadUtils.mjs'
import { downloadUrlToFile } from '../core/downloadFile.mjs'

function mapFileItem(raw, driveId, accountId) {
  return {
    provider: 'aliyun',
    accountId,
    driveId: raw.drive_id || driveId,
    fileId: raw.file_id,
    parentFileId: raw.parent_file_id,
    name: raw.name,
    type: raw.type === 'folder' ? 'folder' : 'file',
    size: raw.size,
    contentHash: raw.content_hash,
    mimeType: raw.mime_type,
    category: raw.category,
    updatedAt: raw.updated_at,
    createdAt: raw.created_at,
  }
}

export async function aliListDir(token, driveId, parentFileId = 'root', marker = '', limit = 100) {
  const accountId = token.user_id
  const pageSize = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 100))
  const data = await aliPost('adrive/v3/file/list', {
    drive_id: driveId,
    parent_file_id: parentFileId,
    marker,
    limit: pageSize,
    all: false,
    url_expire_sec: 14400,
    fields: '*',
    order_by: 'updated_at',
    order_direction: 'DESC',
  }, token)

  return {
    items: (data.items || []).map((f) => mapFileItem(f, driveId, accountId)),
    nextMarker: data.next_marker || '',
  }
}

export async function aliListAll(token, driveId, parentFileId = 'root') {
  const allItems = []
  let marker = ''
  do {
    const page = await aliListDir(token, driveId, parentFileId, marker)
    allItems.push(...page.items)
    marker = page.nextMarker
  } while (marker)
  return allItems
}

export async function* aliWalk(token, driveId, parentFileId = 'root', maxDepth = 10) {
  const queue = [{ parentFileId, depth: 0 }]
  while (queue.length > 0) {
    const { parentFileId: pid, depth } = queue.shift()
    const items = await aliListAll(token, driveId, pid)
    for (const item of items) {
      yield item
      if (item.type === 'folder' && depth < maxDepth) {
        queue.push({ parentFileId: item.fileId, depth: depth + 1 })
      }
    }
  }
}

export async function aliSearch(token, driveId, query, { limit = 100, orderBy = 'updated_at DESC' } = {}) {
  const accountId = token.user_id
  const allItems = []
  let marker = ''
  do {
    const data = await aliPost('adrive/v3/file/search', {
      drive_id: driveId,
      query,
      marker,
      limit,
      fields: '*',
      order_by: orderBy,
    }, token)
    const items = (data.items || []).map((f) => mapFileItem(f, driveId, accountId))
    allItems.push(...items)
    marker = data.next_marker || ''
  } while (marker)
  return allItems
}

export async function aliRenameBatch(token, driveId, renames) {
  // OpenAPI has no /batch endpoint; loop single-file update calls.
  const results = []
  for (const { fileId, newName } of renames) {
    try {
      const data = await aliPost('adrive/v1.0/openFile/update', {
        drive_id: driveId,
        file_id: fileId,
        name: newName,
        check_name_mode: 'refuse',
      }, token)
      results.push({ fileId, status: 'success', newName: data?.name })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function aliGetFile(token, driveId, fileId) {
  const accountId = token.user_id
  const data = await aliPost('v2/file/get', { drive_id: driveId, file_id: fileId, fields: '*' }, token)
  return mapFileItem(data, driveId, accountId)
}

export async function aliDownloadFile(token, driveId, { fileId, outputPath }) {
  const accountId = token.user_id
  const data = await aliPost('v2/file/get', { drive_id: driveId, file_id: fileId, fields: '*', url_expire_sec: 14400 }, token)
  if (data.type === 'folder') {
    const err = new Error(`Cannot download folder: ${fileId}`)
    err.code = 'ERR_ALIYUN_DOWNLOAD_FOLDER'
    throw err
  }
  const url = data.download_url || data.url
  if (!url) {
    const err = new Error(`Aliyun returned no download url for file: ${fileId}`)
    err.code = 'ERR_ALIYUN_DOWNLOAD_URL'
    throw err
  }
  await downloadUrlToFile(url, outputPath, { headers: { Referer: 'https://www.aliyundrive.com/' } })
  return { ok: true, provider: 'aliyun', accountId, driveId, fileId, name: data.name || '', size: data.size || 0, output: outputPath }
}

export async function aliMove(token, driveId, moves) {
  // OpenAPI has no /batch endpoint; loop single-file move calls.
  const results = []
  for (const { fileId, toParentId } of moves) {
    try {
      const data = await aliPost('adrive/v1.0/openFile/move', {
        drive_id: driveId,
        file_id: fileId,
        to_drive_id: driveId,
        to_parent_file_id: toParentId,
        check_name_mode: 'refuse',
      }, token)
      results.push({ fileId, status: 'success', newFileId: data?.file_id })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function aliMkdir(token, driveId, parentId, name) {
  const accountId = token.user_id
  const data = await aliPost('adrive/v3/file/create', {
    drive_id: driveId,
    name,
    type: 'folder',
    parent_file_id: parentId,
    check_name_mode: 'refuse',
  }, token)
  return mapFileItem({ ...data, parent_file_id: parentId }, driveId, accountId)
}

export async function aliTrash(token, driveId, fileIds) {
  const results = []
  for (const fileId of fileIds) {
    try {
      await aliPost('adrive/v3/file/recyclebin/trash', { drive_id: driveId, file_id: fileId }, token)
      results.push({ fileId, status: 'success' })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

function aliPartList(size) {
  const parts = []
  let partSize = 10 * 1024 * 1024
  while (size > partSize * 8000) partSize += 10 * 1024 * 1024
  if (size === 0) return []
  for (let offset = 0, index = 1; offset < size; offset += partSize, index++) {
    parts.push({ part_number: index, part_size: Math.min(partSize, size - offset) })
  }
  return parts
}

async function putAliPart(uploadUrl, token, body) {
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': String(body.length),
      Authorization: `${token.token_type || 'Bearer'} ${token.access_token}`,
    },
    body,
  })
  if (!resp.ok && resp.status !== 409) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Aliyun upload part failed ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_ALIYUN_UPLOAD_PART'
    throw err
  }
}

export async function aliUploadFile(token, driveId, { parentId = 'root', localPath, name, size = 0, conflict = 'skip' }) {
  const accountId = token.user_id
  const data = await aliPost('adrive/v2/file/createWithFolders', {
    drive_id: driveId,
    parent_file_id: parentId && String(parentId).includes('root') ? 'root' : parentId,
    name,
    type: 'file',
    check_name_mode: toConflictMode(conflict) === 'overwrite' ? 'overwrite' : toConflictMode(conflict),
    size,
    part_info_list: aliPartList(size),
  }, token)

  if (data.exist || data.rapid_upload || data.part_info_list?.length === 0) {
    return mapFileItem({ ...data, name, parent_file_id: parentId, type: 'file', size }, driveId, accountId)
  }

  const handle = await open(localPath, 'r')
  try {
    let offset = 0
    for (const part of data.part_info_list || []) {
      const partSize = part.part_size || Math.min(10 * 1024 * 1024, size - ((part.part_number - 1) * 10 * 1024 * 1024))
      const body = await readSlice(handle, offset, partSize)
      await putAliPart(part.upload_url, token, body)
      offset += body.length
    }
  } finally {
    await handle.close().catch(() => {})
  }

  const completed = await aliPost('v2/file/complete', {
    drive_id: driveId,
    upload_id: data.upload_id,
    file_id: data.file_id,
  }, token)
  return mapFileItem({ ...completed, file_id: data.file_id, name, parent_file_id: parentId, type: 'file', size }, driveId, accountId)
}
