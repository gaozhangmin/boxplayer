import { beforeEach, expect, it, vi } from 'vitest'
import { mediaServer, serverReport } from '@/features/sources/mediaServer'
import { plex } from '@/features/sources/plex'
import { getSettings, nativeCall } from '@/platform/native'
import { defaultSettings } from '@/platform/contracts'
import { request } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/platform/native', () => ({ getSettings: vi.fn(), nativeCall: vi.fn() }))
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), request: vi.fn() }))
const account: Account = { id: 'server-a', providerId: 'emby', userId: 'user', name: 'Server', baseUrl: 'https://server.test', authOrigins: ['https://server.test'] }
const entry = { id: 'video', name: 'Film', isDirectory: false, size: 0, playable: true }
beforeEach(() => vi.clearAllMocks())
it('passes configured policy to native and reports the actual negotiated play method', async () => {
  const settings = defaultSettings();settings.serverPlayback.quality = '20000000';settings.serverPlayback.compatibility = 'custom';settings.serverPlayback.customProfile = { Action: 'replace', DirectPlayProfiles: [{ Type: 'Video', VideoCodec: 'h264' }], TranscodingProfiles: [] }
  vi.mocked(getSettings).mockResolvedValue(settings)
  const media = { schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: entry.id, url: 'boxplayer-prepared:test', headers: {} }
  vi.mocked(nativeCall).mockResolvedValueOnce({ media, context: { mediaSourceId: 'source', playSessionId: 'session', playMethod: 'Transcode' } })
  expect(await mediaServer.resolve(account, entry)).toEqual(media)
  expect(nativeCall).toHaveBeenCalledWith('server_resolve', expect.objectContaining({ accountId: account.id, itemId: entry.id, maxBitrate: 20000000, directOnly: false, autoBitrate: false, profile: expect.objectContaining({ DirectPlayProfiles: [expect.objectContaining({ VideoCodec: 'h264' })] }) }))
  await serverReport(account, entry.id, 'start', 0)
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toMatchObject({ PlayMethod: 'Transcode', PlaySessionId: 'session', MediaSourceId: 'source' })
})
it('Plex resolves privately without applying Jellyfin/Emby profiles', async () => {
  vi.mocked(nativeCall).mockResolvedValueOnce({ media: { url: 'boxplayer-prepared:plex' }, context: null })
  expect(await plex.resolve({ ...account, providerId: 'plex' }, entry)).toEqual({ url: 'boxplayer-prepared:plex' });expect(getSettings).not.toHaveBeenCalled()
})

it('automatic quality requests native sampling instead of timing IPC byte serialization',async()=>{
 const settings=defaultSettings();settings.serverPlayback.quality='auto';vi.mocked(getSettings).mockResolvedValue(settings);
 vi.mocked(nativeCall).mockResolvedValueOnce({media:{url:'boxplayer-prepared:auto'},context:{mediaSourceId:'source',playSessionId:'auto',playMethod:'DirectPlay'}});
 await mediaServer.resolve(account,entry);expect(nativeCall).toHaveBeenCalledWith('server_resolve',expect.objectContaining({autoBitrate:true,maxBitrate:null}));
});

it('keeps chosen source IDs isolated by account and applies the same choice to Plex and JF resolution',async()=>{
 const {setServerPlaybackSource}=await import('@/features/sources/serverVersions')
 const settings=defaultSettings();vi.mocked(getSettings).mockResolvedValue(settings)
 vi.mocked(nativeCall).mockResolvedValue({media:{url:'boxplayer-prepared:version'},context:null})
 setServerPlaybackSource(account.id,entry.id,'version-two');await mediaServer.resolve(account,entry)
 expect(nativeCall).toHaveBeenLastCalledWith('server_resolve',expect.objectContaining({preferredSourceId:'version-two',accountId:account.id}))
 await plex.resolve({...account,id:'other-account',providerId:'plex'},entry)
 expect(nativeCall).toHaveBeenLastCalledWith('server_resolve',expect.objectContaining({preferredSourceId:null,accountId:'other-account'}))
 setServerPlaybackSource(account.id,entry.id,'')
})
