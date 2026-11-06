import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import config from '../real-cloud-e2e-config.cjs'

const { ALL_REAL_CLOUD_PROVIDERS, EXCLUDED_REAL_CLOUD_PROVIDERS, loadRealCloudE2EConfig, parseRealCloudAccounts, REAL_CLOUD_PROVIDERS } = config

const cliAccount = provider => ({
  provider,
  accountId: `${provider}_ci`,
  displayName: `${provider} CI`,
  token: { user_id: `${provider}_ci`, refresh_token: `${provider}-refresh` }
})

describe('real cloud E2E configuration', () => {
  it('overrides only the 123 credential without changing other provider accounts or targets', () => {
    const config = loadRealCloudE2EConfig({
      BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts: [cliAccount('aliyun'), cliAccount('cloud123')] }),
      BOXPLAYER_E2E_CLOUD123_ACCOUNT_JSON: JSON.stringify({ accounts: [{ ...cliAccount('cloud123'), token: { user_id: 'cloud123_fresh', access_token: 'fresh' } }] }),
      BOXPLAYER_E2E_REQUIRED_PROVIDERS: 'aliyun'
    })
    expect(config.accounts.find(account => account.tokenfrom === 'aliyun').refresh_token).toBe('aliyun-refresh')
    expect(config.accounts.filter(account => account.tokenfrom === 'cloud123')).toHaveLength(1)
    expect(config.accounts.find(account => account.tokenfrom === 'cloud123')).toMatchObject({ user_id: 'cloud123_fresh', access_token: 'fresh' })
    expect(config.targets.map(target => target.provider)).toEqual(['aliyun'])
  })

  it('combines independent 123 and Quark overrides while preserving other accounts and targets', () => {
    const accounts = ['aliyun', 'quark', 'cloud123'].map(cliAccount)
    const targets = accounts.map(account => ({ provider: account.provider, path: ['Existing fixtures'], fileName: 'sample.mkv' }))
    const base = {
      BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts }),
      BOXPLAYER_E2E_REQUIRED_PROVIDERS: 'aliyun,quark',
      BOXPLAYER_E2E_TARGETS_JSON: JSON.stringify(targets)
    }
    const original = loadRealCloudE2EConfig(base)
    const updated = loadRealCloudE2EConfig({
      ...base,
      BOXPLAYER_E2E_CLOUD123_ACCOUNT_JSON: JSON.stringify({ accounts: [{ ...cliAccount('cloud123'), token: { user_id: 'fresh-123', access_token: 'test-123-access' } }] }),
      BOXPLAYER_E2E_QUARK_ACCOUNT_JSON: JSON.stringify({ accounts: [{ ...cliAccount('quark'), token: { user_id: 'fresh-quark', access_token: 'fresh-quark-cookie' } }] })
    })
    expect(updated.accounts.map(account => account.tokenfrom)).toEqual(original.accounts.map(account => account.tokenfrom))
    expect(updated.accounts[0]).toEqual(original.accounts[0])
    expect(updated.accounts[1]).toMatchObject({ user_id: 'fresh-quark', access_token: 'fresh-quark-cookie' })
    expect(updated.accounts[2]).toMatchObject({ user_id: 'fresh-123', access_token: 'test-123-access' })
    expect(updated.targets).toEqual(original.targets)
  })

  it('rejects a Quark override containing another provider or multiple accounts', () => {
    const base = JSON.stringify({ accounts: [cliAccount('aliyun')] })
    for (const accounts of [[cliAccount('cloud123')], [cliAccount('quark'), cliAccount('aliyun')]]) {
      expect(() => parseRealCloudAccounts(base, '', JSON.stringify({ accounts }))).toThrow('BOXPLAYER_E2E_QUARK_ACCOUNT_JSON 必须只包含一个 quark 账号')
    }
  })

  it('wires the Quark override into every Electron platform and account seeding', () => {
    for (const platform of ['linux', 'windows-x64', 'macos-arm64', 'macos-x64']) {
      const workflow = readFileSync(`.github/workflows/embedded-mpv-${platform}.yml`, 'utf8')
      expect(workflow).toContain('BOXPLAYER_E2E_QUARK_ACCOUNT_JSON: ${{ secrets.BOXPLAYER_E2E_QUARK_ACCOUNT_JSON }}')
    }
    expect(readFileSync('e2e/fixtures/boxPlayer.ts', 'utf8')).toContain('process.env.BOXPLAYER_E2E_QUARK_ACCOUNT_JSON)')
  })

  it('rejects overrides for other providers or multiple accounts', () => {
    const base = JSON.stringify({ accounts: [cliAccount('aliyun')] })
    for (const accounts of [[cliAccount('quark')], [cliAccount('cloud123'), cliAccount('aliyun')]]) {
      expect(() => parseRealCloudAccounts(base, JSON.stringify({ accounts }))).toThrow('必须只包含一个 cloud123 账号')
    }
  })

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

  it('excludes 123, 115, Tianyi 189, Box, Guangya, PikPak and China Mobile from every real-cloud test target', () => {
    const accounts = ALL_REAL_CLOUD_PROVIDERS.map(cliAccount)
    const config = loadRealCloudE2EConfig({
      BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts })
    })
    expect(EXCLUDED_REAL_CLOUD_PROVIDERS).toEqual(['115', '189', 'box', 'guangya', 'pikpak', '139', 'cloud123'])
    expect(config.requiredProviders).toEqual(REAL_CLOUD_PROVIDERS)
    expect(config.targets.map(target => target.provider)).toEqual(REAL_CLOUD_PROVIDERS)
  })

  it('rejects attempts to add an excluded provider back through workflow inputs', () => {
    const accounts = ALL_REAL_CLOUD_PROVIDERS.map(cliAccount)
    for (const provider of EXCLUDED_REAL_CLOUD_PROVIDERS) {
      expect(() => loadRealCloudE2EConfig({
        BOXPLAYER_E2E_ACCOUNTS_JSON: JSON.stringify({ accounts }),
        BOXPLAYER_E2E_REQUIRED_PROVIDERS: `aliyun,${provider}`
      })).toThrow(`包含已排除 provider: ${provider}`)
    }
  })

  it('keeps every release platform aligned with the default provider matrix', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const matrices = [...workflow.matchAll(/^\s+required_providers: (.+)$/gm)]
    expect(matrices).toHaveLength(4)
    for (const [, providers] of matrices) expect(providers.split(',')).toEqual(REAL_CLOUD_PROVIDERS)
  })

  it('does not accept duplicate provider accounts', () => {
    expect(() => parseRealCloudAccounts(JSON.stringify({ accounts: [cliAccount('baidu'), cliAccount('baidu')] }))).toThrow('每个 provider 只能配置一个 CI 测试账号')
  })
})
