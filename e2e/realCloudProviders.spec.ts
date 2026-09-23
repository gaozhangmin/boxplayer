import { expect, test } from './fixtures/boxPlayer'
import type { Page } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { getProviderCapabilities } from '../src/services/agent/providerCapabilities'
// @ts-expect-error CommonJS helper is also executed directly by Actions.
import { loadRealCloudE2EConfig } from '../scripts/real-cloud-e2e-config.cjs'

const providerLabels: Record<string, string> = {
  aliyun: '阿里云盘', cloud123: '123网盘', '115': '115网盘', baidu: '百度网盘', pikpak: 'PikPak',
  quark: '夸克网盘', '139': '139云盘', '189': '天翼云盘', guangya: '光鸭云盘', dropbox: 'Dropbox',
  onedrive: 'OneDrive', box: 'Box', google: 'Google Drive'
}

const enabled = Boolean(process.env.BOXPLAYER_E2E_ACCOUNTS_JSON?.trim())
const config = enabled ? loadRealCloudE2EConfig() : undefined

test.setTimeout(45 * 60_000)

function fileListItem(page: Page, name: string) {
  return page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ has: page.getByText(name, { exact: true }) }).first()
}

async function switchToProvider(page: Page, provider: string): Promise<void> {
  const label = providerLabels[provider]
  if (!label) throw new Error(`No UI label is configured for ${provider}`)
  const accountTrigger = page.locator('.user-avatar-trigger')
  await expect(accountTrigger).toBeVisible({ timeout: 60_000 })
  await accountTrigger.hover()
  const accountRow = page.locator('.user-list-row').filter({ has: page.locator(`.user-provider[title="${label}"]`) }).first()
  await expect(accountRow, `${label} CI 测试账号没有出现在账号列表`).toBeVisible({ timeout: 15_000 })
  const accountSwitch = accountRow.locator('.arco-switch')
  try {
    if (!(await accountSwitch.getAttribute('class'))?.includes('arco-switch-checked')) await accountSwitch.click()
    await expect(accountTrigger).toHaveAttribute('title', label, { timeout: 60_000 })
  } finally {
    // The account chooser is a hover popover. Escape does not dismiss it and
    // leaves an invisible-looking overlay that intercepts the next file click.
    // Always close it, including after a failed account refresh, so one
    // provider cannot contaminate the rest of the matrix.
    await page.mouse.move(0, 0)
    await expect(page.locator('.arco-trigger-popup.arco-popover:visible')).toHaveCount(0, { timeout: 15_000 })
  }
}

async function openCloudRoot(page: Page): Promise<void> {
  const cloudNav = page.locator('#xbyhead2 .arco-menu-item').getByText('网盘', { exact: true })
  if (await cloudNav.isVisible()) await cloudNav.click()
  const breadcrumbs = page.locator('#xbybody > .arco-tabs > .arco-tabs-content > .arco-tabs-content-list > .arco-tabs-content-item-active .toppannavitem:visible')
  const rootNode = page.locator('.dirtree:visible .dirtitle').getByText('根目录', { exact: true })
  if (await rootNode.isVisible()) await rootNode.click()
  await expect.poll(async () => {
    const title = await breadcrumbs.last().getAttribute('title').catch(() => '')
    return title === '根目录'
  }, { timeout: 60_000 }).toBe(true)
  await expect.poll(() => page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').count(), { timeout: 60_000 }).toBeGreaterThan(0)
}

async function openFolder(page: Page, name: string): Promise<void> {
  const row = fileListItem(page, name)
  await expect(row, `找不到测试目录 ${name}`).toBeVisible({ timeout: 60_000 })
  await row.getByText(name, { exact: true }).click()
  await expect.poll(() => page.locator('.toppannavitem:visible').last().getAttribute('title'), { timeout: 60_000 }).toBe(name)
}

async function clearSelection(page: Page): Promise<void> {
  const cancel = page.getByRole('button', { name: '取消已选', exact: true })
  if (await cancel.isVisible()) await cancel.click()
}

async function refreshUntilListed(page: Page, name: string): Promise<void> {
  await expect.poll(async () => {
    await page.locator('#xbybody').getByTitle('刷新 F5').click()
    await page.waitForTimeout(750)
    return fileListItem(page, name).count()
  }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000] }).toBeGreaterThan(0)
}

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /新建/ }).hover()
  await page.getByText('新建文件夹', { exact: true }).click()
  const input = page.locator('#CreatNewDirInput')
  await expect(input).toBeVisible()
  await input.fill(name)
  await page.locator('.arco-modal:visible').filter({ has: input }).getByRole('button', { name: '创建', exact: true }).click()
  await refreshUntilListed(page, name)
}

async function uploadLocalFile(page: Page, localFile: string, name: string): Promise<void> {
  await page.evaluate(uploadPath => { window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath]) }, localFile)
  await page.keyboard.press('Control+u')
  const start = page.getByRole('button', { name: '开始上传', exact: true })
  await start.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
  if (await start.isVisible()) await start.click()
  await refreshUntilListed(page, name)
}

async function renameItem(page: Page, from: string, to: string): Promise<void> {
  await clearSelection(page)
  await fileListItem(page, from).locator('button.select').click()
  await page.keyboard.press('F2')
  const input = page.locator('#RenameInput')
  await expect(input).toBeVisible()
  await input.fill(to)
  await page.locator('.arco-modal:visible').filter({ has: input }).getByRole('button', { name: '重命名', exact: true }).click()
  await expect(fileListItem(page, to)).toBeVisible({ timeout: 60_000 })
  await expect(fileListItem(page, from)).toHaveCount(0)
}

async function choosePickerFolder(page: Page, segments: string[]): Promise<void> {
  const picker = page.locator('.showpandirmodal')
  await expect(picker).toBeVisible()
  for (const segment of segments) {
    const entry = picker.getByText(segment, { exact: true }).last()
    await expect(entry).toBeVisible({ timeout: 45_000 })
    await entry.click()
    await expect(picker.locator('#selectdir')).toContainText(segment)
  }
  await picker.getByRole('button', { name: '选择', exact: true }).click()
  await expect(picker).toBeHidden({ timeout: 60_000 })
}

async function transferItem(page: Page, name: string, shortcut: 'Control+c' | 'Control+x', destination: string[]): Promise<void> {
  await clearSelection(page)
  await fileListItem(page, name).locator('button.select').click()
  await page.keyboard.press(shortcut)
  await choosePickerFolder(page, destination)
}

async function trashItem(page: Page, name: string): Promise<void> {
  await clearSelection(page)
  const row = fileListItem(page, name)
  if (!(await row.count())) return
  await row.locator('button.select').click()
  await page.locator('#xbybody').getByRole('button', { name: '删除', exact: true }).hover()
  await page.getByText('放回收站', { exact: true }).click()
  await expect(row).toHaveCount(0, { timeout: 60_000 })
}

async function returnToTargetFolder(page: Page, target: { path: string[] }): Promise<void> {
  await openCloudRoot(page)
  for (const folder of target.path) await openFolder(page, folder)
}

async function assertProviderOperations(app: import('@playwright/test').ElectronApplication, page: Page, target: { provider: string, path: string[], fileName: string }): Promise<void> {
  const capabilities = getProviderCapabilities(target.provider).operations
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const runFolder = `BoxPlayer-E2E-Run-${stamp}`
  const childCopy = `Copy-${stamp}`
  const childMove = `Move-${stamp}`
  const originalName = `api-${stamp}.txt`
  const renamedName = `api-${stamp}-renamed.txt`
  const copyName = `copy-${stamp}.txt`
  const moveName = `move-${stamp}.txt`
  const content = `BoxPlayer ${target.provider} API regression ${stamp}`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `boxplayer-${target.provider}-api-`))
  const localOriginal = path.join(tempDir, originalName)
  const localCopy = path.join(tempDir, copyName)
  const localMove = path.join(tempDir, moveName)
  writeFileSync(localOriginal, content)
  writeFileSync(localCopy, `${content} copy`)
  writeFileSync(localMove, `${content} move`)

  try {
    if (capabilities['files.search']) {
      await openCloudRoot(page)
      const search = page.getByPlaceholder('全盘搜索')
      await search.fill(target.fileName)
      await search.press('Enter')
      await expect(fileListItem(page, target.fileName), `${target.provider} search API did not find the playback fixture`).toBeVisible({ timeout: 60_000 })
      await returnToTargetFolder(page, target)
    }

    await clearSelection(page)
    await fileListItem(page, target.fileName).locator('button.select').click()
    await page.keyboard.press('Control+p')
    const properties = page.locator('.shuxingmodal')
    await expect(properties, `${target.provider} file-detail API did not open properties`).toBeVisible({ timeout: 60_000 })
    await expect(properties).toContainText(target.fileName)
    await properties.getByRole('button', { name: 'Close', exact: true }).click()

    if (!capabilities['files.createFolder']) return
    await createFolder(page, runFolder)
    await openFolder(page, runFolder)
    await createFolder(page, childCopy)
    await createFolder(page, childMove)

    if (!capabilities['upload.local']) {
      const copyFolder = `CopySource-${stamp}`
      const moveFolder = `MoveSource-${stamp}`
      const renamedFolder = `MoveSourceRenamed-${stamp}`
      await createFolder(page, copyFolder)
      await createFolder(page, moveFolder)
      if (capabilities['files.rename']) await renameItem(page, moveFolder, renamedFolder)
      const movableFolder = capabilities['files.rename'] ? renamedFolder : moveFolder
      if (capabilities['files.copy']) {
        await transferItem(page, copyFolder, 'Control+c', [...target.path, runFolder, childCopy])
        await returnToTargetFolder(page, target)
        await openFolder(page, runFolder)
        await openFolder(page, childCopy)
        await refreshUntilListed(page, copyFolder)
        await page.getByTitle(/后退/).click()
      }
      if (capabilities['files.move']) {
        await transferItem(page, movableFolder, 'Control+x', [...target.path, runFolder, childMove])
        await returnToTargetFolder(page, target)
        await openFolder(page, runFolder)
        await expect(fileListItem(page, movableFolder)).toHaveCount(0)
        await openFolder(page, childMove)
        await refreshUntilListed(page, movableFolder)
      }
      return
    }

    await uploadLocalFile(page, localOriginal, originalName)
    await uploadLocalFile(page, localCopy, copyName)
    await uploadLocalFile(page, localMove, moveName)
    if (capabilities['files.rename']) await renameItem(page, originalName, renamedName)
    else await expect(fileListItem(page, originalName)).toBeVisible()
    const downloadableName = capabilities['files.rename'] ? renamedName : originalName

    if (capabilities['files.download']) {
      await clearSelection(page)
      await fileListItem(page, downloadableName).locator('button.select').click()
      await page.locator('#xbybody').getByRole('button', { name: '下载', exact: true }).click()
      await page.locator('#xbyhead2 .arco-menu-item').getByText('传输', { exact: true }).click()
      await page.getByRole('button', { name: '开始全部', exact: true }).first().click()
      const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      const downloadRoot = path.join(userData, 'E2E Downloads')
      const downloaded = () => readdirSync(downloadRoot, { recursive: true }).map(String).find(file => file.endsWith(path.sep + downloadableName))
      await expect.poll(downloaded, { timeout: 120_000 }).toBeTruthy()
      expect(readFileSync(path.join(downloadRoot, downloaded()!), 'utf8')).toBe(content)
      await page.locator('#xbyhead2 .arco-menu-item').getByText('网盘', { exact: true }).click()
      await returnToTargetFolder(page, target)
      await openFolder(page, runFolder)
    }

    if (capabilities['files.copy']) {
      await transferItem(page, copyName, 'Control+c', [...target.path, runFolder, childCopy])
      await returnToTargetFolder(page, target)
      await openFolder(page, runFolder)
      await openFolder(page, childCopy)
      await refreshUntilListed(page, copyName)
      await page.getByTitle(/后退/).click()
    }

    if (capabilities['files.move']) {
      await transferItem(page, moveName, 'Control+x', [...target.path, runFolder, childMove])
      await returnToTargetFolder(page, target)
      await openFolder(page, runFolder)
      await expect(fileListItem(page, moveName)).toHaveCount(0)
      await openFolder(page, childMove)
      await refreshUntilListed(page, moveName)
    }
  } finally {
    await returnToTargetFolder(page, target).catch(() => undefined)
    if (capabilities['trash.move']) await trashItem(page, runFolder).catch(error => console.warn(`${target.provider} cleanup failed`, error))
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function assertRealMpvPlayback(player: Page, provider: string): Promise<void> {
  await player.waitForLoadState('domcontentloaded')
  const surface = player.locator('#mpvEmbeddedPlayer.mpv-embedded-surface')
  await expect(surface, `${provider} 没有打开内置 MPV`).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => {
    const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
    const status = {
      ok: Boolean(result?.ok),
      duration: Number(result?.status?.duration || 0),
      position: Number(result?.status?.position || 0),
      error: result?.error || result?.status?.error || ''
    }
    return status.ok && status.duration > 0 && status.position > 0 ? 'playing' : JSON.stringify(status)
  }, { message: `${provider} MPV did not begin playback`, timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe('playing')
  const started = await player.evaluate(() => window.WebMpvEmbeddedStatus())
  expect(Number(started.status?.duration || 0), `${provider} MPV duration`).toBeGreaterThan(0)
  expect(Number(started.status?.position || 0), `${provider} MPV position`).toBeGreaterThan(0)

  const pause = await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'pause' }))
  expect(pause.ok, `${provider} MPV pause: ${pause.error || 'unknown error'}`).toBe(true)
  const pausedPosition = Number(pause.status?.position || 0)
  const duration = Number(pause.status?.duration || 0)
  const seekTarget = Math.max(0.5, Math.min(duration > 2 ? duration - 1 : duration / 2, pausedPosition + 2))
  const seek = await player.evaluate(value => window.WebMpvEmbeddedControl({ action: 'seek', value }), seekTarget)
  expect(seek.ok, `${provider} MPV seek: ${seek.error || 'unknown error'}`).toBe(true)
  const play = await player.evaluate(() => window.WebMpvEmbeddedControl({ action: 'play' }))
  expect(play.ok, `${provider} MPV play: ${play.error || 'unknown error'}`).toBe(true)
  await expect.poll(async () => {
    const result = await player.evaluate(() => window.WebMpvEmbeddedStatus())
    return Number(result.status?.position || 0)
  }, { timeout: 30_000 }).toBeGreaterThan(Math.max(0, seekTarget - 1.5))
  await expect(surface.locator('.mpv-embedded-error')).toHaveCount(0)
}

if (!enabled) {
  test('real cloud provider matrix requires encrypted CI account secrets', async () => {
    test.skip(true, 'Set BOXPLAYER_E2E_ACCOUNTS_JSON to run the real-provider release gate')
  })
} else {
  test('all configured cloud providers refresh, list files, resolve authenticated URLs and play through MPV', async ({ boxPlayer }) => {
    const { app, page, pageErrors, consoleErrors } = boxPlayer
    const failures: string[] = []
    for (const target of config!.targets) {
      pageErrors.splice(0)
      consoleErrors.splice(0)
      let player: Page | undefined
      try {
        await switchToProvider(page, target.provider)
        await openCloudRoot(page)
        for (const folder of target.path) await openFolder(page, folder)
        const video = fileListItem(page, target.fileName)
        await expect(video, `${target.provider} 找不到测试视频 ${target.fileName}`).toBeVisible({ timeout: 60_000 })
        const playerPromise = app.waitForEvent('window', { timeout: 60_000 })
        await video.getByText(target.fileName, { exact: true }).click()
        player = await playerPromise
        await assertRealMpvPlayback(player, target.provider)
        if (!player.isClosed()) await player.close()
        player = undefined
        if (process.env.BOXPLAYER_E2E_CLOUD_MUTATIONS === '1') await assertProviderOperations(app, page, target)
        expect(pageErrors, `${target.provider} renderer errors`).toEqual([])
        expect(consoleErrors, `${target.provider} console errors`).toEqual([])
      } catch (error) {
        failures.push(`${target.provider}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (player && !player.isClosed()) await player.close().catch(() => undefined)
      }
    }
    expect(failures, failures.join('\n\n')).toEqual([])
  })
}
