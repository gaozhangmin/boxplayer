import { describe, expect, it } from 'vitest'
import { mediaTransferReceiptOutcome } from '../../services/mediaAcquisition/transferReceipt'

describe('media acquisition transfer receipts', () => {
  it('records a landed transfer as succeeded and an accepted one as pending', () => {
    expect(mediaTransferReceiptOutcome({ submitted: true, staging: { primaryVideos: ['file-1'] } }).status).toBe('succeeded')
    expect(mediaTransferReceiptOutcome({ submitted: true, taskStatus: 'transferring', staging: { primaryVideos: [] } }).status).toBe('pending')
    expect(mediaTransferReceiptOutcome({ submitted: true }).status).toBe('pending')
  })

  it('records an unconfirmed provider takeover as unknown instead of failed', () => {
    expect(mediaTransferReceiptOutcome({ error: 'SANDBOX_TRANSFER_NOT_CLAIMED：网盘转存尚未确认接管该候选' })).toEqual({ status: 'unknown', message: 'SANDBOX_TRANSFER_NOT_CLAIMED：网盘转存尚未确认接管该候选' })
    expect(mediaTransferReceiptOutcome({ error: '候选不在本回合已观察的资源快照中，未提交转存。' }).status).toBe('failed')
    expect(mediaTransferReceiptOutcome(undefined)).toEqual({ status: 'failed', message: '网盘未提交候选转存' })
  })
})
