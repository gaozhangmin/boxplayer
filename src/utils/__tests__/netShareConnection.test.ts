import { describe, expect, it } from 'vitest'
import { createNetShareConnection, getRemoteSourceLabel, isNetShareConnection, normalizeNetShareHost, toNetShareConfig } from '../webdavClient'
import { createRemoteDriveAccount } from '../remoteDriveAccount'
import { resolveDriveProvider } from '../driveProvider'
import { getProviderCapabilities, normalizeProviderPlatform } from '../../services/agent/providerCapabilities'

describe('network share connections', () => {
  it('normalizes user-entered hosts', () => {
    expect(normalizeNetShareHost('smb://user@nas.local/share')).toBe('nas.local')
    expect(normalizeNetShareHost('\\\\NAS\\video')).toBe('NAS')
    expect(normalizeNetShareHost('192.168.1.2:2121')).toBe('192.168.1.2')
    expect(normalizeNetShareHost('[fe80::1]:21')).toBe('fe80::1')
  })

  it('builds per-kind configs and virtual accounts', () => {
    const smb = createNetShareConnection({ kind: 'smb', name: '', host: 'smb://nas', share: '/video/', username: 'u', password: 'safe:x', rootPath: 'tv' })
    expect(smb).toMatchObject({ kind: 'smb', host: 'nas', share: 'video', rootPath: '/tv', url: 'smb://nas/video', name: 'video (nas)' })
    expect(isNetShareConnection(smb)).toBe(true)
    expect(toNetShareConfig(smb)).toMatchObject({ kind: 'smb', password: 'safe:x', passive: true })
    const nfs = createNetShareConnection({ kind: 'nfs', name: 'N', host: 'h', exportPath: 'vol/x', username: 'ignored' })
    expect(nfs).toMatchObject({ anonymous: true, username: '', exportPath: '/vol/x', url: 'nfs://h/vol/x' })
    const ftp = createNetShareConnection({ kind: 'ftp', name: 'F', host: 'h', port: '2121', anonymous: true, username: 'x', password: 'y', secure: true })
    expect(ftp).toMatchObject({ port: 2121, username: '', password: '', secure: true, passive: true, encoding: 'utf8' })
    const edited = createNetShareConnection({ kind: 'ftp', name: 'F2', host: 'h2' }, ftp)
    expect([edited.id, edited.createdAt]).toEqual([ftp.id, ftp.createdAt])

    for (const [connection, kind] of [[smb, 'smb'], [nfs, 'nfs'], [ftp, 'ftp']] as const) {
      const { token, folder } = createRemoteDriveAccount(connection)
      expect(token.tokenfrom).toBe(kind)
      expect(token.user_id).toBe(`${kind}_${connection.id}`)
      expect(folder.driveId).toBe(`webdav:${connection.id}`)
      expect(resolveDriveProvider(token.user_id, folder.driveId, token.tokenfrom)).toMatchObject({ isValid: true, provider: kind })
      expect(getRemoteSourceLabel(kind)).toBe(kind.toUpperCase())
      expect(normalizeProviderPlatform(kind)).toBe('webdav')
    }
    expect(getProviderCapabilities('smb').operations['files.rename']).toBeFalsy()
  })
})
