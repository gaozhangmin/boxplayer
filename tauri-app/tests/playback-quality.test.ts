import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PlayerSnapshot } from '@/platform/contracts'
import { nativeCall } from '@/platform/native'
import { usePlaybackQuality } from '@/features/player/usePlaybackQuality'

vi.mock('@/platform/native', async original => ({
  ...await original<typeof import('@/platform/native')>(),
  nativeCall: vi.fn(),
}))
const invoke = vi.mocked(nativeCall)
beforeEach(() => invoke.mockReset())

it('retrieves the current item’s quality choices and switches the selected stream', async () => {
  const sessionId = 'session-a'
  const itemId = 'file-a'
  const snapshot = ref({ sessionId, itemId } as PlayerSnapshot)
  const open = ref(false)
  const scope = effectScope()
  const quality = scope.run(() => usePlaybackQuality(open, snapshot))!
  try {
    const qualities = [{ id: 'original', label: '原画' }, { id: 'LD', label: '360p' }]
    invoke.mockResolvedValueOnce(qualities)
    open.value = true
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith('player_cloud_qualities', { sessionId, itemId })
    expect(quality.qualities.value).toEqual(qualities)
    expect(quality.selected.value).toBe('original')
    await quality.select('LD')
    expect(invoke).toHaveBeenCalledWith('player_set_cloud_quality', { sessionId, itemId, qualityId: 'LD' })
    expect(quality.selected.value).toBe('original')
    snapshot.value = { ...snapshot.value, cloudQuality: 'LD' }
    expect(quality.selected.value).toBe('LD')
  } finally {
    scope.stop()
  }
})

it('ignores outdated list and switch responses after playback changes', async () => {
  const snapshot = ref({ sessionId: 'same-session', itemId: 'first' } as PlayerSnapshot)
  const open = ref(false)
  const scope = effectScope()
  const quality = scope.run(() => usePlaybackQuality(open, snapshot))!
  try {
    let releaseList!: (value: unknown) => void
    let failSwitch!: (reason: unknown) => void
    invoke.mockImplementationOnce(() => new Promise(resolve => { releaseList = resolve }))
    open.value = true
    await nextTick()
    invoke.mockImplementationOnce(() => new Promise((_, reject) => { failSwitch = reject }))
    const switchPromise = quality.select('LD')
    invoke.mockResolvedValueOnce([{ id: 'max', label: '最高（直接播放）' }, { id: '420000', label: '420 Kbps' }])
    snapshot.value = { ...snapshot.value, itemId: 'second', cloudQuality: 'max' }
    await flushPromises()
    releaseList([{ id: 'LD', label: '360p' }])
    failSwitch(new Error('旧条目切换失败'))
    await switchPromise
    expect(quality.qualities.value.map(row => row.id)).toEqual(['max', '420000'])
    expect(quality.error.value).toBe('')
    expect(quality.changing.value).toBe(false)
    expect(quality.selected.value).toBe('max')
  } finally {
    scope.stop()
  }
})
