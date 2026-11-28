import { computed, ref, watch, type Ref } from 'vue'
import type { PlayerSnapshot } from '@/platform/contracts'
import { asAppError, nativeCall } from '@/platform/native'

interface PlaybackQuality {
  id: string
  label: string
}

export function usePlaybackQuality(open: Readonly<Ref<boolean>>, snapshot: Readonly<Ref<PlayerSnapshot | null | undefined>>) {
  const qualities = ref<PlaybackQuality[]>([])
  const loading = ref(false)
  const changing = ref(false)
  const error = ref('')
  const selected = computed(() => snapshot.value?.cloudQuality || 'original')
  const identity = computed(() => {
    const current = snapshot.value
    if (!current?.sessionId || !current.itemId) return undefined
    return { sessionId: current.sessionId, itemId: current.itemId }
  })

  // The identity should only change when playback moves to a different item.
  const sessionId = computed(() => identity.value?.sessionId)
  const itemId = computed(() => identity.value?.itemId)
  const ready = computed(() => snapshot.value?.state !== 'loading' || Boolean(snapshot.value?.videoHeight))
  let switchRequest = 0
  watch([sessionId, itemId], () => {
    switchRequest++
    changing.value = false
  })
  watch([open, sessionId, itemId, ready], async ([visible], _, onCleanup) => {
    qualities.value = []
    loading.value = false
    error.value = ''
    const target = identity.value
    if (!visible || !target || !ready.value) return
    let active = true
    onCleanup(() => { active = false })
    loading.value = true
    try {
      const options = await nativeCall<PlaybackQuality[]>('player_cloud_qualities', target)
      if (active) qualities.value = options ?? []
    } catch (cause) {
      if (active) error.value = asAppError(cause).message
    } finally {
      if (active) loading.value = false
    }
  })

  async function select(qualityId: string) {
    const target = identity.value
    if (!target || changing.value || qualityId === selected.value) return
    const request = ++switchRequest
    changing.value = true
    error.value = ''
    try {
      await nativeCall('player_set_cloud_quality', { ...target, qualityId })
    } catch (cause) {
      if (request === switchRequest) error.value = asAppError(cause).message
    } finally {
      if (request === switchRequest) changing.value = false
    }
  }

  return { qualities, loading, changing, error, selected, select }
}
