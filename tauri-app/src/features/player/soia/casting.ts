import type { CastingClient } from '@/vendor/soia/core-client/CastingClient'
const unavailable = async (): Promise<never> => { throw new Error('投屏尚未接入（M7），不会搜索或连接设备。') }
export const tauriCastingClient: CastingClient = {
  getSnapshot: unavailable, getDevices: unavailable, discover: unavailable, connect: unavailable,
  pause: unavailable, play: unavailable, seek: unavailable, stop: unavailable, setVolume: unavailable, disconnect: unavailable,
  subscribe: () => () => {}
}
