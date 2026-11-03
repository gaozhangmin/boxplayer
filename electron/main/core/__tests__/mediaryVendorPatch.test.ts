import { describe, expect, it } from 'vitest'
import { PanSouResourceProvider } from '@mediary/pansou-provider'
import { allowedResourceTypesForKinds, getStorageBrand, isBoxPlayerDriveAuthError } from '@mediary/storage-brands'
import { readSkillSection } from '@mediary/acquisition-v2/skill'
import { transferModelLine } from '@mediary/acquisition-v2/task-agents'
import { isLlmAuthError } from '@mediary/agent-error'

const pansouResults = {
  code: 0,
  data: {
    results: [
      {
        title: '沙丘2 4K',
        channel: 'tg',
        links: [
          { type: 'aliyun', url: 'https://www.alipan.com/s/abc', password: '' },
          { type: 'pikpak', url: 'https://mypikpak.com/s/def', password: '' },
          { type: 'magnet', url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', password: '' },
          { type: 'quark', url: 'https://pan.quark.cn/s/ghi', password: '' }
        ]
      }
    ]
  }
}

function provider(kinds: string[]) {
  return new PanSouResourceProvider({
    baseURL: 'https://pansou.test',
    fetchJson: async () => pansouResults,
    maxSearchAttempts: 1,
    wait: async () => {},
    allowedTypes: allowedResourceTypesForKinds(kinds)
  })
}

describe('mediary vendor patch for BoxPlayer-hosted drives', () => {
  it('surfaces only the link types each BoxPlayer brand can transfer', async () => {
    expect((await provider(getStorageBrand('aliyun').resourceProviderKinds).search({ keyword: '沙丘2' })).candidates.map(item => item.type)).toEqual(['aliyun'])
    expect((await provider(getStorageBrand('pikpak').resourceProviderKinds).search({ keyword: '沙丘2' })).candidates.map(item => item.type)).toEqual(['pikpak', 'magnet'])
    expect((await provider(getStorageBrand('cloud123').resourceProviderKinds).search({ keyword: '沙丘2' })).candidates.map(item => item.type)).toEqual(['magnet'])
  })

  it('gives each BoxPlayer brand its own transfer prompt and dead-link manual', () => {
    expect(transferModelLine({ storageProvider: 'aliyun' } as any)).toContain('阿里云盘')
    expect(transferModelLine({ storageProvider: 'cloud123' } as any)).toContain('NO 分享链')
    expect(readSkillSection('dead-links-black-box', 'pikpak')).toContain('(PikPak)')
    expect(readSkillSection('dead-links-black-box', 'cloud123')).toContain('123云盘 离线下载')
  })

  it('treats a BoxPlayer drive login failure as a drive problem, not an AI model one', () => {
    const error = new Error('BOXPLAYER_DRIVE_AUTH: 阿里云盘登录已失效')
    expect(isBoxPlayerDriveAuthError(error)).toBe(true)
    expect(isLlmAuthError(Object.assign(error, { statusCode: 401 }))).toBe(false)
  })
})
