import { describe, expect, it } from 'vitest'
import { buildNetShareStreamPath, describeNetShare, joinSharePath, normalizeSharePath, parseByteRange, parseNetShareStreamPath, resolveSmbPath, shareBaseName, shareDirName, sortShareEntries } from '../netShare'

describe('net share paths', () => {
  it('normalizes separators, dot segments and leading slash', () => {
    expect(normalizeSharePath('')).toBe('/')
    expect(normalizeSharePath(undefined)).toBe('/')
    expect(normalizeSharePath('a\\b//c/')).toBe('/a/b/c')
    expect(normalizeSharePath('/a/./b/../c')).toBe('/a/c')
    expect(normalizeSharePath('../../etc')).toBe('/etc')
    expect(joinSharePath('/root/', 'Movies', '电影 1.mkv')).toBe('/root/Movies/电影 1.mkv')
    expect(joinSharePath('/', undefined, '/x')).toBe('/x')
    expect(shareBaseName('/a/b.mkv')).toBe('b.mkv')
    expect(shareBaseName('/')).toBe('')
    expect(shareDirName('/a/b.mkv')).toBe('/a')
    expect(shareDirName('/b.mkv')).toBe('/')
  })

  it('splits SMB share and in-share path', () => {
    expect(resolveSmbPath({ share: 'video', rootPath: '/media' }, '/tv/a.mkv')).toEqual({ share: 'video', path: '/media/tv/a.mkv' })
    expect(resolveSmbPath({ share: '\\video\\', rootPath: '/' }, '/')).toEqual({ share: 'video', path: '/' })
    expect(resolveSmbPath({ share: '', rootPath: '/ignored' }, '/public/x/y.mp4')).toEqual({ share: 'public', path: '/x/y.mp4' })
    expect(resolveSmbPath({ share: '', rootPath: '/' }, '/')).toEqual({ share: '', path: '/' })
  })

  it('describes connections and sorts folders first', () => {
    expect(describeNetShare({ kind: 'smb', host: 'nas', port: 445, share: 'v' })).toBe('smb://nas/v')
    expect(describeNetShare({ kind: 'nfs', host: 'nas', exportPath: 'vol1/video' })).toBe('nfs://nas/vol1/video')
    expect(describeNetShare({ kind: 'ftp', host: 'h', port: 2121 })).toBe('ftp://h:2121')
    const sorted = sortShareEntries([{ name: 'b10.mkv', isDir: false }, { name: 'z', isDir: true }, { name: 'b2.mkv', isDir: false }, { name: 'a', isDir: true }])
    expect(sorted.map(e => e.name)).toEqual(['a', 'z', 'b2.mkv', 'b10.mkv'])
  })
})

describe('stream url path', () => {
  it('round-trips unicode paths and keeps the file name visible', () => {
    const p = buildNetShareStreamPath('s3cr', 'conn1', '/剧集/S01 E01 #1?.mkv')
    expect(p.endsWith('/' + encodeURIComponent('S01 E01 #1?.mkv'))).toBe(true)
    expect(parseNetShareStreamPath(p)).toEqual({ secret: 's3cr', connectionId: 'conn1', path: '/剧集/S01 E01 #1?.mkv' })
    expect(parseNetShareStreamPath('/other/x')).toBeUndefined()
    expect(parseNetShareStreamPath('/netshare/a/b/!!!/x')).toBeUndefined()
  })
})

describe('parseByteRange', () => {
  it('handles open, closed, suffix and invalid ranges', () => {
    expect(parseByteRange(undefined, 100)).toBeUndefined()
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=20-10', 100)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-1,5-6', 100)).toBeUndefined()
    expect(parseByteRange('items=0-1', 100)).toBeUndefined()
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})
