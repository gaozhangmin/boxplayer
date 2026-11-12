import crypto from 'crypto'
import nodehttps from 'https'
import type { ClientRequest } from 'http'
import path from 'path'
import { FileHandle } from 'fs/promises'
import { BAIDU_PCS_APP_ID } from '../secrets.generated'
import { getBaiduToken } from './auth'

const BAIDU_API_HOST = 'https://pan.baidu.com'
const BAIDU_PCS_HOST = 'https://d.pcs.baidu.com'

const BAIDU_BLOCK_SIZE = 4 * 1024 * 1024
const BAIDU_SLICE_SIZE = 256 * 1024

export type BaiduPrecreateResp = {
  errno: number
  return_type?: number
  uploadid?: string
  block_list?: string[]
}

export type BaiduLocateUploadResp = {
  errno: number
  host?: string[]
}

export type BaiduCreateResp = {
  errno: number
  fs_id?: number
  path?: string
}

const md5Buffer = (buff: Buffer) => crypto.createHash('md5').update(buff).digest('hex')

const normalizePath = (parentPath: string, name: string) => {
  let base = parentPath || '/'
  if (base.includes('root')) base = '/'
  if (!base.startsWith('/')) base = '/' + base
  if (base !== '/' && base.endsWith('/')) base = base.slice(0, -1)
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export const buildBaiduUploadPath = (parentPath: string, name: string) => {
  const folder = parentPath || '/'
  return normalizePath(folder, name)
}

export const computeBaiduBlockList = async (fileHandle: FileHandle, size: number) => {
  const blockList: string[] = []
  const fullHash = crypto.createHash('md5')
  let sliceMd5 = ''
  if (size === 0) {
    const empty = md5Buffer(Buffer.alloc(0))
    return {
      blockList: [empty],
      contentMd5: empty,
      sliceMd5: empty
    }
  }
  let offset = 0
  while (offset < size) {
    const chunkSize = Math.min(BAIDU_BLOCK_SIZE, size - offset)
    const buff = Buffer.alloc(chunkSize)
    const read = await fileHandle.read(buff, 0, chunkSize, offset)
    if (!read.bytesRead) break
    const realBuff = buff.subarray(0, read.bytesRead)
    if (!sliceMd5) {
      const sliceBuff = realBuff.subarray(0, Math.min(BAIDU_SLICE_SIZE, realBuff.length))
      sliceMd5 = md5Buffer(sliceBuff)
    }
    blockList.push(md5Buffer(realBuff))
    fullHash.update(realBuff)
    offset += read.bytesRead
  }
  return {
    blockList,
    contentMd5: fullHash.digest('hex'),
    sliceMd5: sliceMd5 || ''
  }
}

export const apiBaiduPrecreate = async (
  user_id: string,
  filePath: string,
  size: number,
  blockList: string[],
  contentMd5: string,
  sliceMd5: string,
  rtype: number = 2
): Promise<BaiduPrecreateResp | null> => {
  const token = await getBaiduToken(user_id)
  if (!token?.access_token) return null
  const url = new URL('/rest/2.0/xpan/file', BAIDU_API_HOST)
  url.searchParams.set('method', 'precreate')
  url.searchParams.set('access_token', token.access_token)
  const params = new URLSearchParams()
  params.set('path', filePath)
  params.set('size', String(size))
  params.set('isdir', '0')
  params.set('autoinit', '1')
  params.set('rtype', String(rtype))
  params.set('block_list', JSON.stringify(blockList))
  if (contentMd5) params.set('content-md5', contentMd5)
  if (sliceMd5) params.set('slice-md5', sliceMd5)
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body: params.toString()
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as BaiduPrecreateResp
  return data
}

export const apiBaiduLocateUpload = async (
  user_id: string,
  filePath: string,
  uploadid: string
): Promise<BaiduLocateUploadResp | null> => {
  const token = await getBaiduToken(user_id)
  if (!token?.access_token) return null
  const url = new URL('/rest/2.0/pcs/file', BAIDU_PCS_HOST)
  url.searchParams.set('method', 'locateupload')
  url.searchParams.set('access_token', token.access_token)
  url.searchParams.set('appid', BAIDU_PCS_APP_ID)
  url.searchParams.set('path', filePath)
  url.searchParams.set('uploadid', uploadid)
  url.searchParams.set('upload_version', '2.0')
  const resp = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'pan.baidu.com'
    }
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as BaiduLocateUploadResp
  return data
}

const buildMultipart = (fieldName: string, filename: string, buff: Buffer) => {
  const boundary = '----xbybaidu' + Date.now().toString(16) + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`))
  parts.push(Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`))
  parts.push(buff)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  const body = Buffer.concat(parts)
  return { body, boundary }
}

export const apiBaiduUploadPart = async (
  server: string,
  accessToken: string,
  filePath: string,
  uploadid: string,
  partseq: number,
  buff: Buffer
): Promise<boolean> => {
  return new Promise((resolve) => {
    const host = server.startsWith('http') ? server : `https://${server}`
    const url = new URL('/rest/2.0/pcs/superfile2', host)
    url.searchParams.set('method', 'upload')
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('type', 'tmpfile')
    url.searchParams.set('path', filePath)
    url.searchParams.set('uploadid', uploadid)
    url.searchParams.set('partseq', String(partseq))
    const { body, boundary } = buildMultipart('file', path.basename(filePath), buff)
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }
    const req: ClientRequest = nodehttps.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(false)
          return
        }
        try {
          const data = JSON.parse(raw)
          // PCS upload nodes may acknowledge a successful part with its md5 only.
          resolve(data?.errno === 0 || typeof data?.md5 === 'string')
        } catch {
          resolve(false)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.write(body)
    req.end()
  })
}

export const apiBaiduCreateFile = async (
  user_id: string,
  filePath: string,
  size: number,
  uploadid: string,
  blockList: string[],
  rtype: number = 2
): Promise<BaiduCreateResp | null> => {
  const token = await getBaiduToken(user_id)
  if (!token?.access_token) return null
  const url = new URL('/rest/2.0/xpan/file', BAIDU_API_HOST)
  url.searchParams.set('method', 'create')
  url.searchParams.set('access_token', token.access_token)
  const params = new URLSearchParams()
  params.set('path', filePath)
  params.set('size', String(size))
  params.set('isdir', '0')
  params.set('uploadid', uploadid)
  params.set('rtype', String(rtype))
  params.set('block_list', JSON.stringify(blockList))
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body: params.toString()
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as BaiduCreateResp
  return data
}

export const apiBaiduCreateDir = async (
  user_id: string,
  dirPath: string,
  rtype: number = 0
): Promise<{ error: string; path: string }> => {
  const token = await getBaiduToken(user_id)
  if (!token?.access_token) return { error: '未登录百度网盘', path: '' }
  const url = new URL('/rest/2.0/xpan/file', BAIDU_API_HOST)
  url.searchParams.set('method', 'create')
  url.searchParams.set('access_token', token.access_token)
  const params = new URLSearchParams()
  params.set('path', dirPath)
  params.set('isdir', '1')
  params.set('rtype', String(rtype))
  const now = Math.floor(Date.now() / 1000)
  params.set('local_ctime', String(now))
  params.set('local_mtime', String(now))
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body: params.toString()
  })
  if (!resp.ok) return { error: '创建文件夹失败', path: '' }
  const data = (await resp.json()) as BaiduCreateResp
  if (data?.errno !== 0) {
    if (data.errno === -8) return { error: '文件夹已存在', path: '' }
    if (data.errno === -10) return { error: '云端容量已满', path: '' }
    if (data.errno === -7) return { error: '文件夹名错误或无权限', path: '' }
    return { error: '创建文件夹失败', path: '' }
  }
  return { error: '', path: data.path || dirPath }
}
