import { getOssExpiryTime } from './ossExpiry'
import { deflateRawSync, inflateRawSync } from 'zlib'
import crypto from 'crypto'
import pkg from '../../package.json'
import { getUserDataPath } from './electronhelper'
import fs, { stat } from 'node:fs'
import net from 'net'
import { Buffer } from 'buffer'


export function ArrayCopyReverse(arr: any[]): any[] {
  const copy: any[] = []
  for (let i = arr.length - 1; i >= 0; i--) {
    copy.push(arr[i])
  }
  return copy
}

export function ArrayCopy(arr: any[]): any[] {
  const copy: any[] = []
  for (let i = 0, maxi = arr.length; i < maxi; i++) {
    copy.push(arr[i])
  }
  return copy
}

export function MapKeyToArray<T>(map: Map<T, any>): T[] {
  const arr: T[] = []
  const keys = map.keys()
  for (let i = 0, maxi = map.size; i < maxi; i++) {
    const value = keys.next().value
    if (value !== undefined) {
      arr.push(value)
    }
  }
  return arr
}

export function MapValueToArray<T>(map: Map<any, T>): T[] {
  const arr: T[] = []
  const keys = map.values()
  for (let i = 0, maxi = map.size; i < maxi; i++) {
    const value = keys.next().value
    if (value !== undefined) {
      arr.push(value)
    }
  }
  return arr
}

export function ArrayToMap<T>(keyname: string, arr: T[]) {
  const map = new Map<any, T>()
  let item: any
  for (let i = 0, maxi = arr.length; i < maxi; i++) {
    item = arr[i]
    map.set(item[keyname], item)
  }
  return map
}

export function ArrayKeyList<T>(keyname: string, arr: any[]): T[] {
  const selectkeys: T[] = []
  for (let i = 0, maxi = arr.length; i < maxi; i++) {
    selectkeys.push(arr[i][keyname])
  }
  return selectkeys
}

export function BlobToString(body: Blob, encoding: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsText(body, encoding)
    reader.onload = function() {
      resolve((reader.result as string) || '')
    }
  })
}

export function BlobToBuff(body: Blob): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.readAsArrayBuffer(body)
    reader.onload = function() {
      resolve(reader.result as ArrayBuffer)
    }
  })
}

export function GzipObject(input: object): Buffer {
  return deflateRawSync(JSON.stringify(input))
}

export function UnGzipObject(input: Buffer): object {
  return JSON.parse(inflateRawSync(input).toString())
}

export function HanToPin(input: string): string {
  if (!input) return ''
  // eslint-disable-next-line no-undef
  const arr = pinyinlite(input, { keepUnrecognized: true })
  const strarr = new Array<string>(arr.length * 2 + 1)
  let l = false
  for (let p = 1, i = 0, maxi = arr.length; i < maxi; p += 2, i++) {
    strarr[p] = arr[i].join(' ')
    l = strarr[p].length > 1
    if (l) {
      strarr[p - 1] = ' '
      strarr[p + 1] = ' '
    } else {
      strarr[p + 1] = ''
    }
  }
  strarr[0] = ''
  return strarr.join('')
}

export function GetExpiresTime(downUrl: string) {
  return getOssExpiryTime(downUrl)
}

export function GetOssExpires(downUrl: string) {
  const expires = getOssExpiryTime(downUrl)
  return expires ? Math.floor(expires / 1000) - Math.floor(Date.now() / 1000) : 0
}

export function hashCode(key: string) {
  let hash = 0
  for (let i = 0, maxi = key.length; i < maxi; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i++)) << 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function md5Code(key: string) {
  const buffa = Buffer.from(key)
  const md5a = crypto.createHash('md5').update(buffa).digest('hex')
  return md5a
}

export function getPkgVersion() {
  return pkg.version
}

export function createTmpFile(content: string, name: string) {
  let tmpFile = ''
  try {
    // 生成临时文件路径
    tmpFile = getUserDataPath(name)
    // 向临时文件中写入数据
    fs.writeFileSync(tmpFile, content)
  } catch (err) {
  }
  return tmpFile
}

export function delTmpFile(tmpFilePath: string) {
  stat(tmpFilePath, async (err, stats) => {
    if (!err) {
      fs.rmSync(tmpFilePath, { recursive: true })
    }
  })
}

export function portIsOccupied(port: number) {
  return new Promise<number>((resolve, reject) => {
    let server = net.createServer().listen(port)
    server.on('listening', async () => {
      console.log(`the server is runnint on port ${port}`)
      server.close()
      resolve(port) // 返回可用端口
    })
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(portIsOccupied(port + 1)) // 如传入端口号被占用则 +1
        console.log(`this port ${port} is occupied.try another.`)
      } else {
        // reject(err)
        resolve(port)
      }
    })
  })
}