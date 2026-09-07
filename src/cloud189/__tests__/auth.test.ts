import { describe, expect, it } from 'vitest'
import { cloud189EncryptParams } from '../auth'

describe('cloud189 signed parameters', () => {
  it('encrypts sorted business parameters for the list API', () => {
    const secret = '0123456789abcdef-session-secret'
    expect(cloud189EncryptParams({ pageSize: '1000', folderId: '-11', pageNum: '1' }, secret))
      .toBe('825C2FE582CBDD429FC44C2CBF1C5031F1FCD46C38D8E9340AA9DB9952BDD1DAFA6E0E05EDA3B8E796329266E716E0F6')
  })
})
