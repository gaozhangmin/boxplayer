import { getCloud123Token } from './auth'

export type Cloud123ShareCreateResult = {
  shareId: string
  shareKey: string
  error: string
}

export type Cloud123ShareListItem = {
  shareId: number
  shareKey: string
  shareName: string
  expiration: string
  expired: number
  sharePwd: string
  trafficSwitch: number
  trafficLimitSwitch: number
  trafficLimit: number
  bytesCharge: number
  previewCount: number
  downloadCount: number
  saveCount: number
}

export type Cloud123ShareListResult = {
  list: Cloud123ShareListItem[]
  lastShareId: number
  error: string
}

export type Cloud123ShareUpdateResult = {
  success: boolean
  error: string
}

export type Cloud123PaidShareCreateResult = Cloud123ShareCreateResult

export type Cloud123PaidShareListItem = {
  shareId: number
  shareKey: string
  shareName: string
  payAmount: number
  amount: number
  expiration: string
  expired: number
  trafficSwitch: number
  trafficLimitSwitch: number
  trafficLimit: number
  bytesCharge: number
  previewCount: number
  downloadCount: number
  saveCount: number
  orderCnt: number
}

export type Cloud123PaidShareListResult = {
  list: Cloud123PaidShareListItem[]
  lastShareId: number
  error: string
}

const validateFileIDs = (fileIDList: string[]) => fileIDList.length > 0 && fileIDList.length <= 100

export const getCloud123ShareUrl = (user_id: string, shareKey: string) => {
  const uid = user_id.replace(/^cloud123_/, '')
  return uid && shareKey ? `https://${uid}.share.123pan.cn/123pan/${shareKey}` : ''
}

export const apiCloud123ShareCreate = async (
  user_id: string,
  shareName: string,
  shareExpire: number,
  fileIDList: string[],
  sharePwd: string,
  trafficSwitch?: number,
  trafficLimitSwitch?: number,
  trafficLimit?: number
): Promise<Cloud123ShareCreateResult> => {
  const result: Cloud123ShareCreateResult = { shareId: '', shareKey: '', error: '创建分享链接失败' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  const url = 'https://open-api.123pan.com/api/v1/share/create'
  if (!validateFileIDs(fileIDList)) {
    result.error = '123云盘单次最多分享100个文件'
    return result
  }
  if (![0, 1, 7, 30].includes(shareExpire)) {
    result.error = '123云盘分享有效期仅支持永久、1天、7天或30天'
    return result
  }
  const fileIDListStr = fileIDList.join(',')
  const safeShareName = shareName || '分享链接'
  const body: any = {
    shareName: safeShareName,
    shareExpire,
    fileIDList: fileIDListStr
  }
  if (sharePwd) body.sharePwd = sharePwd
  if (trafficSwitch !== undefined) body.trafficSwitch = trafficSwitch
  if (trafficLimitSwitch !== undefined) body.trafficLimitSwitch = trafficLimitSwitch
  if (trafficLimit !== undefined) body.trafficLimit = trafficLimit
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) return result
    const data = await resp.json()
    if (data?.code === 0) {
      const shareId = data?.data?.shareID ?? data?.data?.shareId ?? ''
      const shareKey = data?.data?.shareKey ?? ''
      return { shareId: shareId ? String(shareId) : '', shareKey: shareKey || '', error: '' }
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiCloud123PaidShareCreate = async (
  user_id: string,
  shareName: string,
  fileIDList: string[],
  payAmount: number,
  resourceDesc = '',
  isReward = 0,
  trafficSwitch?: number,
  trafficLimitSwitch?: number,
  trafficLimit?: number
): Promise<Cloud123PaidShareCreateResult> => {
  const result: Cloud123PaidShareCreateResult = { shareId: '', shareKey: '', error: '创建123云盘付费分享失败' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  if (!validateFileIDs(fileIDList)) {
    result.error = '123云盘单次最多分享100个文件'
    return result
  }
  if (!Number.isInteger(payAmount) || payAmount < 1 || payAmount > 1000) {
    result.error = '付费金额必须是1至1000元的整数'
    return result
  }
  const body: any = { shareName: shareName || '付费分享', fileIDList: fileIDList.join(','), payAmount, isReward: isReward ? 1 : 0 }
  if (resourceDesc) body.resourceDesc = resourceDesc
  if (trafficSwitch !== undefined) body.trafficSwitch = trafficSwitch
  if (trafficLimitSwitch !== undefined) body.trafficLimitSwitch = trafficLimitSwitch
  if (trafficLimit !== undefined) body.trafficLimit = trafficLimit
  try {
    const resp = await fetch('https://open-api.123pan.com/api/v1/share/content-payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Platform: 'open_platform', Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify(body)
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok) {
      result.error = data?.message || `创建123云盘付费分享失败（HTTP ${resp.status}）`
      return result
    }
    if (data?.code === 0) {
      const shareId = data?.data?.shareID ?? data?.data?.shareId ?? ''
      return { shareId: shareId ? String(shareId) : '', shareKey: data?.data?.shareKey || '', error: '' }
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiCloud123PaidShareList = async (user_id: string, lastShareId: number, limit: number): Promise<Cloud123PaidShareListResult> => {
  const result: Cloud123PaidShareListResult = { list: [], lastShareId: -1, error: '' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100)
  try {
    const resp = await fetch(`https://open-api.123pan.com/api/v1/share/payment/list?limit=${safeLimit}&lastShareId=${Math.max(0, Math.trunc(lastShareId) || 0)}`, {
      headers: { 'Content-Type': 'application/json', Platform: 'open_platform', Authorization: `Bearer ${token.access_token}` }
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok) {
      result.error = data?.message || '获取123云盘付费分享列表失败'
      return result
    }
    if (data?.code === 0) {
      result.list = Array.isArray(data?.data?.shareList) ? data.data.shareList : []
      result.lastShareId = typeof data?.data?.lastShareId === 'number' ? data.data.lastShareId : -1
      return result
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiCloud123PaidShareUpdate = async (user_id: string, shareIdList: string[], trafficSwitch?: number, trafficLimitSwitch?: number, trafficLimit?: number): Promise<Cloud123ShareUpdateResult> => {
  const result: Cloud123ShareUpdateResult = { success: false, error: '修改123云盘付费分享失败' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  const ids = shareIdList.map(Number).filter(Number.isFinite)
  if (ids.length === 0 || ids.length > 100) {
    result.error = '123云盘单次最多修改100个分享'
    return result
  }
  const body: any = { shareIdList: ids }
  if (trafficSwitch !== undefined) body.trafficSwitch = trafficSwitch
  if (trafficLimitSwitch !== undefined) body.trafficLimitSwitch = trafficLimitSwitch
  if (trafficLimit !== undefined) body.trafficLimit = trafficLimit
  try {
    const resp = await fetch('https://open-api.123pan.com/api/v1/share/list/payment/info', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Platform: 'open_platform', Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify(body)
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok) {
      result.error = data?.message || result.error
      return result
    }
    if (data?.code === 0) return { success: true, error: '' }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiCloud123ShareList = async (
  user_id: string,
  lastShareId: number,
  limit: number
): Promise<Cloud123ShareListResult> => {
  const result: Cloud123ShareListResult = { list: [], lastShareId: -1, error: '' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100)
  const url = `https://open-api.123pan.com/api/v1/share/list?limit=${safeLimit}&lastShareId=${Math.max(0, Math.trunc(lastShareId) || 0)}`
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      }
    })
    if (!resp.ok) {
      result.error = '获取分享列表失败'
      return result
    }
    const data = await resp.json()
    if (data?.code === 0) {
      result.list = Array.isArray(data?.data?.shareList) ? data.data.shareList : []
      result.lastShareId = typeof data?.data?.lastShareId === 'number' ? data.data.lastShareId : -1
      return result
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiCloud123ShareUpdate = async (
  user_id: string,
  shareIdList: string[],
  trafficSwitch?: number,
  trafficLimitSwitch?: number,
  trafficLimit?: number
): Promise<Cloud123ShareUpdateResult> => {
  const result: Cloud123ShareUpdateResult = { success: false, error: '修改分享链接失败' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    result.error = '请先登录123云盘'
    return result
  }
  const ids = shareIdList.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (ids.length === 0) {
    result.error = '分享链接ID错误'
    return result
  }
  const url = 'https://open-api.123pan.com/api/v1/share/list/info'
  const body: any = {
    shareIdList: ids
  }
  if (trafficSwitch !== undefined) body.trafficSwitch = trafficSwitch
  if (trafficLimitSwitch !== undefined) body.trafficLimitSwitch = trafficLimitSwitch
  if (trafficLimit !== undefined) body.trafficLimit = trafficLimit
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) return result
    const data = await resp.json()
    if (data?.code === 0) return { success: true, error: '' }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}
export const cloud123ShareUpdateNotice = '123云盘开放 API 仅支持修改分享流量设置，名称、有效期和提取码无法修改'
