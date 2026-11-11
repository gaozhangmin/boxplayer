import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ settings: { uiVideoPlayer: 'other', uiVideoPlayerPath: 'C:\\PotPlayer\\PotPlayerMin64.exe' }, start: vi.fn(), error: vi.fn(), open: vi.fn() }))
vi.mock('../../setting/settingstore', () => ({ default: () => mocks.settings }))
vi.mock('../playerhelper', () => ({ default: { startPlayer: mocks.start } }))
vi.mock('../message', () => ({ default: { error: mocks.error } }))
import { openVideoPage } from '../videoPlayback'
const base = { user_id: 'local', drive_id: 'local', file_id: 'D:\\Movies\\test.mkv', file_name: 'test', parent_file_id: '', parent_file_name: '', html: '', encType: '', password: '', expire_time: 0, play_cursor: 12 }
describe('selected video player routing', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.settings.uiVideoPlayer = 'other'; vi.stubGlobal('window', { WebOpenWindow: mocks.open }) })
  it('launches PotPlayerMin64 for a local file without opening the web player', async () => {
    await openVideoPage({ page: 'PageVideo', data: base })
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), mocks.settings.uiVideoPlayerPath, expect.objectContaining({ resolvedSource: true, rawData: { qualities: [{ quality: 'Origin', url: base.file_id, headers: {} }] } }))
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('preserves a media server URL and authorization headers', async () => {
    await openVideoPage({ page: 'PageVideo', data: { ...base, drive_id: 'media_server', media_url: 'https://server/video', media_headers: { Authorization: 'test' } } })
    expect(mocks.start.mock.calls[0][2].rawData.qualities[0]).toEqual({ quality: 'Origin', url: 'https://server/video', headers: { Authorization: 'test' } })
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it.each(['web', 'mpv'])('retains the %s built-in player', async player => {
    mocks.settings.uiVideoPlayer = player
    await openVideoPage({ page: 'PageVideo', data: base })
    expect(mocks.open).toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('reports launch failure without falling back to web playback', async () => {
    mocks.start.mockRejectedValueOnce(new Error('missing player'))
    await openVideoPage({ page: 'PageVideo', data: base })
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
