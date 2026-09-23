import { describe, expect, it } from 'vitest'
import path from 'path'
import { resolveCloudDriveCliConfigDir } from '../cliConfigPath'

describe('resolveCloudDriveCliConfigDir', () => {
  it('keeps normal app exports in the user CLI directory', () => {
    expect(resolveCloudDriveCliConfigDir(undefined, '/users/boxplayer')).toBe(path.join('/users/boxplayer', '.clouddrive-cli'))
  })

  it('isolates E2E token exports when an override is configured', () => {
    expect(resolveCloudDriveCliConfigDir('/tmp/boxplayer-e2e/cloud-cli', '/users/boxplayer')).toBe(path.resolve('/tmp/boxplayer-e2e/cloud-cli'))
  })
})
