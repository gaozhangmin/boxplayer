const BASE = 'https://proapi.115.com/open'
const UPLOAD_BASE = 'https://proapi.115.com'
const REFRESH_URL = 'https://passportapi.115.com/open/refreshToken'
const CLIENT_ID = ''
const CLIENT_SECRET = ''

import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { hashFile, readSlice } from './uploadUtils.mjs'
import { ossCompleteMultipart, ossInitiateMultipart, ossUploadPart } from './ossUpload.mjs'

function drive115Headers(token) {
  return { 'Authorization': `Bearer ${token.access_token}` }
}

async function drive115Get(url, token) {
  const resp = await fetch(url, { headers: drive115Headers(token) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`115 API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_115_HTTP'
    err.status = resp.status
    throw err
  }
  const data = await resp.json()
  if (data.code != null && data.code !== 0) {
    const err = new Error(`115 API error code=${data.code}: ${data.message || ''}`)
    err.code = 'ERR_115_API'
    throw err
  }
  return data
}

async function drive115Post(url, formBody, token) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...drive115Headers(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(formBody).toString(),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`115 API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_115_HTTP'
    throw err
  }
  const data = await resp.json()
  if (data.code != null && data.code !== 0) {
    const err = new Error(`115 API error code=${data.code}: ${data.message || ''}`)
    err.code = 'ERR_115_API'
    throw err
  }
  return data
}

export async function drive115RefreshToken(token) {
  const resp = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: token.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }).toString(),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`115 token refresh failed ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_115_AUTH'
    throw err
  }
  const data = await resp.json()
  if (data.code != null && data.code !== 0) {
    const err = new Error(`115 token refresh error: ${data.message || data.code}`)
    err.code = 'ERR_115_AUTH'
    throw err
  }
  const expiresIn = Number(data.data?.expires_in || data.expires_in || token.expires_in || 7200)
  return {
    ...token,
    access_token: data.data?.access_token || data.access_token,
    refresh_token: data.data?.refresh_token || data.refresh_token || token.refresh_token,
    expires_in: expiresIn,
    expire_time: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}

function mapFileItem(item, accountId) {
  const isFolder = item.fc === '1' || item.isdir === 1 || (!item.fid && !!item.cid)
  return {
    provider: '115',
    accountId,
    driveId: '115',
    fileId: String(item.fid || item.cid || item.file_id || ''),
    parentFileId: String(item.pid || item.parent_id || '0'),
    name: item.n || item.fn || item.file_name || '',
    type: isFolder ? 'folder' : 'file',
    size: item.s != null ? Number(item.s) : undefined,
    contentHash: item.sha,
    updatedAt: item.te ? new Date(Number(item.te) * 1000).toISOString() : undefined,
    createdAt: item.tp ? new Date(Number(item.tp) * 1000).toISOString() : undefined,
  }
}

export async function drive115ListDir(token, cid = '0') {
  const accountId = token.user_id
  const allItems = []
  let offset = 0
  const limit = 200
  while (true) {
    const qs = new URLSearchParams({ cid, limit: String(limit), offset: String(offset), cur: '1', show_dir: '1' })
    const data = await drive115Get(`${BASE}/ufile/files?${qs}`, token)
    for (const item of data.data || []) allItems.push(mapFileItem(item, accountId))
    offset += limit
    if (offset >= (data.count || 0)) break
  }
  return allItems
}

export async function* drive115Walk(token, cid = '0', maxDepth = 10) {
  const queue = [{ cid, depth: 0 }]
  while (queue.length > 0) {
    const { cid: c, depth } = queue.shift()
    const items = await drive115ListDir(token, c)
    for (const item of items) {
      yield item
      if (item.type === 'folder' && depth < maxDepth) {
        queue.push({ cid: item.fileId, depth: depth + 1 })
      }
    }
  }
}

export async function drive115Search(token, keyword, { limit = 200 } = {}) {
  const accountId = token.user_id
  const allItems = []
  let offset = 0
  const pageSize = Math.min(limit, 200)
  while (allItems.length < limit) {
    const qs = new URLSearchParams({ search_value: keyword, limit: String(pageSize), offset: String(offset), show_dir: '1' })
    const data = await drive115Get(`${BASE}/ufile/search?${qs}`, token)
    for (const item of data.data || []) allItems.push(mapFileItem(item, accountId))
    offset += pageSize
    if (!data.data || data.data.length < pageSize) break
  }
  return allItems.slice(0, limit)
}

export async function drive115RenameBatch(token, renames) {
  const results = []
  for (const { fileId, newName } of renames) {
    try {
      await drive115Post(`${BASE}/ufile/update`, { file_id: fileId, file_name: newName }, token)
      results.push({ fileId, status: 'success', newName })
    } catch (e) {
      results.push({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })
    }
  }
  return results
}

export async function drive115GetFile(token, fileId) {
  const accountId = token.user_id
  const qs = new URLSearchParams({ file_id: fileId, cid: '', limit: '1', show_dir: '1' })
  const data = await drive115Get(`${BASE}/ufile/files?${qs}`, token)
  const item = (data.data || [])[0]
  if (!item) {
    const err = new Error(`File not found: ${fileId}`)
    err.code = 'ERR_115_NOT_FOUND'
    throw err
  }
  return mapFileItem(item, accountId)
}

export async function drive115MoveBatch(token, moves) {
  if (moves.length === 0) return []
  const groups = new Map()
  for (const m of moves) {
    const key = m.toParentId
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  const results = []
  for (const [toParentId, group] of groups) {
    try {
      const formBody = { pid: String(toParentId) }
      group.forEach(({ fileId }, i) => { formBody[`fid[${i}]`] = String(fileId) })
      await drive115Post(`${BASE}/ufile/move`, formBody, token)
      results.push(...group.map(({ fileId }) => ({ fileId, status: 'success' })))
    } catch (e) {
      results.push(...group.map(({ fileId }) => ({ fileId, status: 'error', code: e.code || 'ERR', message: e.message })))
    }
  }
  return results
}

export async function drive115Mkdir(token, parentId, name) {
  const accountId = token.user_id
  const data = await drive115Post(`${BASE}/ufile/mkdir`, { cid: String(parentId), cname: name }, token)
  return {
    provider: '115',
    accountId,
    driveId: '115',
    fileId: String(data.file_id || data.cid || ''),
    parentFileId: String(parentId),
    name,
    type: 'folder',
  }
}

export async function drive115Trash(token, fileIds) {
  if (fileIds.length === 0) return []
  const formBody = {}
  fileIds.forEach((id, i) => { formBody[`fid[${i}]`] = String(id) })
  await drive115Post(`${BASE}/ufile/delete`, formBody, token)
  return fileIds.map((fileId) => ({ fileId, status: 'success' }))
}

function build115Target(parentId) {
  const id = parentId === undefined || parentId === null || parentId === '' ? 0 : Number(parentId)
  return `U_1_${Number.isFinite(id) ? id : 0}`
}

async function drive115UploadInit(token, fields) {
  const data = await drive115Post(`${UPLOAD_BASE}/open/upload/init`, fields, token)
  return data.data || data
}

async function drive115UploadToken(token) {
  const data = await drive115Get(`${UPLOAD_BASE}/open/upload/get_token`, token)
  const list = Array.isArray(data.data) ? data.data : []
  return list[0] || null
}

async function sha1Range(localPath, start, end) {
  const handle = await open(localPath, 'r')
  try {
    return createHash('sha1').update(await readSlice(handle, start, end - start + 1)).digest('hex')
  } finally {
    await handle.close().catch(() => {})
  }
}

export async function drive115UploadFile(token, { parentId = '0', localPath, name, size = 0 }) {
  const { hash: fileSha1, firstSlice: preSha1 } = await hashFile(localPath, 'sha1', { firstSliceSize: 128 * 1024 })
  const target = build115Target(parentId)
  let init = await drive115UploadInit(token, {
    file_name: name,
    file_size: String(size),
    target,
    fileid: fileSha1,
    preid: preSha1,
    topupload: '0',
  })
  if (init.sign_key && init.sign_check) {
    const [start, end] = String(init.sign_check).split('-').map((value) => Number(value))
    const signVal = Number.isFinite(start) && Number.isFinite(end) ? (await sha1Range(localPath, start, end)).toUpperCase() : ''
    init = await drive115UploadInit(token, {
      file_name: name,
      file_size: String(size),
      target,
      fileid: fileSha1,
      preid: preSha1,
      topupload: '0',
      sign_key: init.sign_key,
      sign_val: signVal,
    })
  }
  if (Number(init.status) === 2) {
    return { provider: '115', accountId: token.user_id, driveId: '115', fileId: String(init.file_id || ''), parentFileId: String(parentId || '0'), name, type: 'file', size, rapid: true }
  }
  if (!init.bucket || !init.object || !init.pick_code) {
    const err = new Error('115 upload init returned incomplete upload info')
    err.code = 'ERR_115_UPLOAD_INIT'
    throw err
  }
  const ossToken = await drive115UploadToken(token)
  if (!ossToken?.endpoint || !ossToken.AccessKeyId || !ossToken.AccessKeySecrett || !ossToken.SecurityToken) {
    const err = new Error('115 upload token is incomplete')
    err.code = 'ERR_115_UPLOAD_TOKEN'
    throw err
  }
  const cred = {
    endpoint: ossToken.endpoint,
    accessKeyId: ossToken.AccessKeyId,
    accessKeySecret: ossToken.AccessKeySecrett,
    securityToken: ossToken.SecurityToken,
  }
  const initOss = await ossInitiateMultipart(cred, init.bucket, init.object, { callback: init.callback, callback_var: init.callback_var })
  if (initOss.status !== 200) throw new Error(`115 OSS initiate failed ${initOss.status}`)
  const uploadId = initOss.body.match(/<UploadId>(.+)<\/UploadId>/i)?.[1]
  if (!uploadId) throw new Error('115 OSS initiate returned no UploadId')
  const handle = await open(localPath, 'r')
  const parts = []
  try {
    let offset = 0
    let partNumber = 1
    while (offset < size) {
      const body = await readSlice(handle, offset, Math.min(8 * 1024 * 1024, size - offset))
      const uploaded = await ossUploadPart(cred, init.bucket, init.object, uploadId, partNumber, body)
      if (uploaded.status !== 200 || !uploaded.etag) throw new Error(`115 OSS part failed ${uploaded.status}`)
      parts.push({ partNumber, etag: uploaded.etag.replace(/"/g, '') })
      offset += body.length
      partNumber += 1
    }
  } finally {
    await handle.close().catch(() => {})
  }
  const complete = await ossCompleteMultipart(cred, init.bucket, init.object, uploadId, parts, { callback: init.callback, callback_var: init.callback_var })
  if (complete.status !== 200) throw new Error(`115 OSS complete failed ${complete.status}`)
  return { provider: '115', accountId: token.user_id, driveId: '115', fileId: String(init.file_id || init.pick_code || ''), parentFileId: String(parentId || '0'), name, type: 'file', size }
}
