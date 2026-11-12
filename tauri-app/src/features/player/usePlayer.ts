import { onMounted, onUnmounted, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { asAppError, isNative, playerControl, playerState } from '@/platform/native'
import type { PlayerSnapshot } from '@/platform/contracts'
export function usePlayer() {
  const snapshot = ref<PlayerSnapshot | null>(null)
  const error = ref('')
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  function accept(next: PlayerSnapshot) { if (!disposed && (!snapshot.value || next.sequence >= snapshot.value.sequence)) snapshot.value = next }
  async function refresh() { try { accept(await playerState()) } catch (e) { if (!disposed) error.value = asAppError(e).message } }
  async function control(action: string, value?: number, trackId?: number) {
    const session = snapshot.value?.sessionId
    if (!session) return
    try { await playerControl(session, action, value, trackId); error.value = ''; await refresh() }
    catch (e) { error.value = asAppError(e).message }
  }
  onMounted(async () => {
    if (!isNative()) return
    try { const unlisten = await listen<PlayerSnapshot>('player:state', event => accept(event.payload)); if (disposed) { unlisten(); return } stop = unlisten; await refresh(); if (!disposed) timer = setInterval(() => void refresh(), 1000) }
    catch (e) { error.value = asAppError(e).message }
  })
  onUnmounted(() => { disposed = true; stop?.(); if (timer) clearInterval(timer) })
  return { snapshot, error, control }
}
