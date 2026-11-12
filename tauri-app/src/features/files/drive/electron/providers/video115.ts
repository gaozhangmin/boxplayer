import {video115Account,video115Fetch,video115Headers} from '../../video115Transport'
const VIDEO_PUSH_URL = 'https://proapi.115.com/open/video/video_push'

export const apiDrive115VideoPush = async (user_id: string, pick_code: string, op: 'vip_push' | 'pay_push') => {
  const account = video115Account(user_id)
  if (!pick_code || !['vip_push', 'pay_push'].includes(op)) return { success: false, message: '参数错误' }
  const body = new URLSearchParams({ pick_code, op })
  try {
    const resp = await video115Fetch(account, VIDEO_PUSH_URL, {
      method: 'POST',
      headers: { ...video115Headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data?.code !== 0 || data?.state === false) return { success: false, message: data?.message || '提交视频转码失败' }
    return { success: true, message: data?.message || '视频转码任务已提交' }
  } catch (error: any) {
    return { success: false, message: error?.message || '提交视频转码失败' }
  }
}
