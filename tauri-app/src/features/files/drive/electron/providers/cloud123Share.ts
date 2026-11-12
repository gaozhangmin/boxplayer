import {cloud123ShareRequest} from '../../shareProviderTransport'
export type Cloud123ShareCreateResult = {
  shareId: string
  shareKey: string
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
    const resp = await cloud123ShareRequest(user_id,url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform'
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

export type Cloud123PaidShareCreateResult = Cloud123ShareCreateResult

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
    const resp = await cloud123ShareRequest(user_id,'https://open-api.123pan.com/api/v1/share/content-payment/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Platform: 'open_platform' },
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
