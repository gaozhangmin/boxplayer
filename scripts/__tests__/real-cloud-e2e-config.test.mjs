import { describe, expect, it } from 'vitest'
import config from '../real-cloud-e2e-config.cjs'

const { loadRealCloudE2EConfig, parseRealCloudAccounts, REAL_CLOUD_PROVIDERS } = config

const cliAccount = provider => ({
  provider,
  accountId: `${provider}_ci`,
  displayName: `${provider} CI`,
  token: { user_id: `${provider}_ci`, refresh_token: `${provider}-refresh` }
})

describe('real cloud E2E configuration', () => {
  it('normalizes the existing clouddrive-cli token export', () => {
    const [account] = parseRealCloudAccounts(JSON.stringify({ accounts: [cliAccount('quark')] }))
    expect(account).toMatchObject({ tokenfrom: 'quark', user_id: 'quark_ci', refresh_token: 'quark-refresh', default_drive_id: '' })
  })

  it('requires exactly one account and playback target for every required provider', () => {
    const accounts = REAL_CLOUD_PROVIDERS.map(cliAccount)
    const config = loadRealCloudE2EConfig({
      BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts }),
      BOXPLAYER_E2E_MEDIA_FOLDER: 'BoxPlayer-E2E',
      BOXPLAYER_E2E_MEDIA_FILE: 'sample.mp4'
    })
    expect(config.requiredProviders).toEqual(REAL_CLOUD_PROVIDERS)
    expect(config.targets).toHaveLength(REAL_CLOUD_PROVIDERS.length)
    expect(config.targets[0]).toMatchObject({ path: ['BoxPlayer-E2E'], fileName: 'sample.mp4' })
  })

  it('fails closed when a release-required account is missing', () => {
    expect(() => loadRealCloudE2EConfig({
      BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts: [cliAccount('aliyun')] }),
      BOXPLAYER_E2E_REQUIRED_PROVIDERS: 'aliyun,quark'
    })).toThrow('缺少 CI 测试账号: quark')
  })

  it('does not accept duplicate provider accounts', () => {
    expect(() => parseRealCloudAccounts(JSON.stringify({ accounts: [cliAccount('baidu'), cliAccount('baidu')] }))).toThrow('每个 provider 只能配置一个 CI 测试账号')
  })
})
