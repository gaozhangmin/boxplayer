const BASE = 'https://api.box.com/2.0'
const UPLOAD_BASE = 'https://upload.box.com/api/2.0'
const TOKEN_URL = 'https://api.box.com/oauth2/token'
const CLIENT_ID = ''
const CLIENT_SECRET = ''

import { readFileBuffer } from './uploadUtils.mjs'
import { downloadResponseToFile } from '../core/downloadFile.mjs'

function boxHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token.access_token}`,
    'x-rep-hints': '[jpg?dimensions=320x320]',
  }
}

async function boxGet(url, token) {
  const resp = await fetch(url, { headers: boxHeaders(token) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Box API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_BOX_HTTP'
    err.status = resp.status
    throw err
  }
  return resp.json()
}

async function boxPut(url, body, token) {
  const resp = await fetch(url, { method: 'PUT', headers: boxHeaders(token), body: JSON.stringify(body) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Box API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_BOX_HTTP'
    throw err
  }
  return resp.json()
}

async function boxPost(url, body, token) {
  const resp = await fetch(url, { method: 'POST', headers: boxHeaders(token), body: JSON.stringify(body) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Box API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_BOX_HTTP'
    throw err
  }
  return resp.json()
}

async function boxDelete(url, token) {
  const resp = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token.access_token}` } })
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Box API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_BOX_HTTP'
    throw err
  }
}

export async function boxRefreshToken(token) {
  const clientId = token.device_id || CLIENT_ID
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    client_id: clientId,
  })
  if (CLIENT_SECRET) params.set('client_secret', CLIENT_SECRET)
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Box token refresh failed ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_BOX_AUTH'
    throw err
  }
  const data = await resp.json()
  const expiresIn = Number(data.expires_in || token.expires_in || 3600)
  return {
    ...token,
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_in: expiresIn,
    expire_time: new Date(Date.now() + expiresIn * 1000).toISOString(),
    token_type: data.token_type || 'Bearer',
  }
}

const FIELDS = 'id,type,name,size,sha1,parent,created_at,modified_at,item_status'

function mapFileItem(item, accountId) {
  return {
    provider: 'box',
    accountId,
    driveId: 'box',
    fileId: item.id,
    parentFileId: item.parent?.id || 'box_root',
    name: item.name,
    type: item.type === 'folder' ? 'folder' : 'file',
    size: item.size,
    contentHash: item.sha1,
    updatedAt: item.modified_at,
    createdAt: item.created_at,
  }
}

export async function boxListDir(token, folderId = 'box_root') {
  const accountId = token.user_id
  const id = folderId === 'box_root' ? '0' : folderId
  const allItems = []
  let offset = 0
  const limit = 500
  while (true) {
    const url = `${BASE}/folders/${id}/items?fields=${FIELDS}&limit=${limit}&offset=${offset}`
    const data = await boxGet(url, token)
    for (const item of data.entries || []) allItems.push(mapFileItem(item, accountId))
    offset += limit
    if (offset >= (data.total_count || 0)) break
  }
  return allItems
}

export async function* boxWalk(token, folderId = 'box_root', maxDepth = 10) {
  const queue = [{ folderId, depth: 0 }]
  while (queue.length > 0) {
    const { folderId: fid, depth } = queue.shift()
    const items = await boxListDir(token, fid)
    for (const item of items) {
      yield item
      if (item.type === 'folder' && depth < maxDepth) {
        queue.push({ folderId: item.fileId, depth: depth + 1 })
      }
    }
  }
}

export async function boxSearch(token, keyword, { limit = 100 } = {}) {
  const accountId = token.user_id
  const allItems = []
  let offset = 0
  const pageSize = Math.min(limit, 200)
  while (allItems.length < limit) {
    const url = `${BASE}/search?query=${encodeURIComponent(keyword)}&fields=${FIELDS}&limit=${pageSize}&offset=${offset}&content_types=name`
    const data = await boxGet(url, token)
    for (const item of data.entries || []) allItems.push(mapFileItem(item, accountId))
    offset += pageSize
    if ((data.entries || []).length < pageSize || offset >= (data.total_count || 0)) break
  }
  return allItems.slice(0, limit)
}

export async function boxRenameBatch(token, renames) {
  const results = []
  for (const { fileId, newName, itemType = 'file' } of renames) {
    try {
      const endpoint = itemType === 'folder' ? `/folders/${fileId}` : `/files/${fileId}`
      const data = await boxPut(`${BASE}${endpoint}`, { name: newName }, token)
      results.push({ fileId, status: 'success', newName: data.name || newName })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function boxGetFile(token, fileId, itemType = 'file') {
  const accountId = token.user_id
  try {
    const url = `${BASE}/${itemType === 'folder' ? 'folders' : 'files'}/${fileId}?fields=${FIELDS}`
    const data = await boxGet(url, token)
    return mapFileItem(data, accountId)
  } catch (e) {
    if (e.status === 404 && itemType === 'file') {
      const data = await boxGet(`${BASE}/folders/${fileId}?fields=${FIELDS}`, token)
      return mapFileItem(data, accountId)
    }
    throw e
  }
}

export async function boxDownloadFile(token, fileId, outputPath) {
  const meta = await boxGet(`${BASE}/files/${fileId}?fields=${FIELDS}`, token)
  const resp = await fetch(`${BASE}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    redirect: 'follow',
  })
  await downloadResponseToFile(resp, outputPath)
  return { ok: true, provider: 'box', accountId: token.user_id, driveId: 'box', fileId, name: meta.name || '', size: meta.size || 0, output: outputPath }
}

export async function boxMove(token, moves) {
  const results = []
  for (const { fileId, toParentId, itemType = 'file' } of moves) {
    try {
      const endpoint = itemType === 'folder' ? `/folders/${fileId}` : `/files/${fileId}`
      const id = toParentId === 'box_root' ? '0' : toParentId
      const data = await boxPut(`${BASE}${endpoint}`, { parent: { id } }, token)
      results.push({ fileId, status: 'success', newParentId: data.parent?.id || toParentId })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function boxMkdir(token, parentId, name) {
  const accountId = token.user_id
  const id = parentId === 'box_root' ? '0' : parentId
  const data = await boxPost(`${BASE}/folders`, { name, parent: { id } }, token)
  return mapFileItem(data, accountId)
}

export async function boxTrash(token, items) {
  const results = []
  for (const { fileId, itemType = 'file' } of items) {
    try {
      const endpoint = itemType === 'folder'
        ? `${BASE}/folders/${fileId}?recursive=true`
        : `${BASE}/files/${fileId}`
      await boxDelete(endpoint, token)
      results.push({ fileId, status: 'success' })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function boxUploadFile(token, { parentId = 'box_root', localPath, name, size = 0 }) {
  const id = parentId === 'box_root' ? '0' : parentId
  const form = new FormData()
  form.set('attributes', JSON.stringify({ name, parent: { id } }))
  form.set('file', new Blob([new Uint8Array(await readFileBuffer(localPath))]), name)
  const resp = await fetch(`${UPLOAD_BASE}/files/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}` },
    body: form,
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok) {
    const err = new Error(data?.message || data?.error || `Box upload failed ${resp.status}`)
    err.code = 'ERR_BOX_UPLOAD'
    throw err
  }
  const file = data?.entries?.[0]
  if (!file?.id) {
    const err = new Error('Box upload returned no file id')
    err.code = 'ERR_BOX_UPLOAD'
    throw err
  }
  return mapFileItem({ ...file, size: file.size ?? size }, token.user_id)
}
