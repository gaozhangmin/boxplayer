import { expect, test } from './fixtures/boxPlayer'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'fs'
import { createHash } from 'crypto'
import os from 'os'
import path from 'path'
import type { Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

function unexpectedCloudErrors(errors: string[]): string[] {
  return errors.filter((error) => {
    if (error.includes('api.aliyundrive.com/v2/file/download') && error.includes('office_thumbnail_process=')) return false
    if (error.includes('member.aliyundrive.com/v1/activity/sign_in_reward')) return false
    if (error.includes('www.googleapis.com/books/v1/volumes')) return false
    return true
  })
}

function listedItemCount(text: string): number {
  const match = text.match(/\/\s*(\d+)\s*个/)
  return match ? Number(match[1]) : 0
}

async function scrollFileListToBottom(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#panfilelist:visible').evaluate((root) => {
    const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))] as HTMLElement[]
    const scrollable = candidates.find((element) => element.scrollHeight > element.clientHeight + 5)
    if (!scrollable) throw new Error('No scrollable cloud file list was found')
    scrollable.scrollTop = scrollable.scrollHeight
    scrollable.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

function fileListItem(page: Page, name: string) {
  return page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ has: page.getByText(name, { exact: true }) }).first()
}

async function openListedFolder(page: Page, name: string): Promise<void> {
  const label = page.locator('#panfilelist:visible').getByText(name, { exact: true })
  await expect(label).toBeVisible({ timeout: 45_000 })
  await label.evaluate((element: HTMLElement) => element.click())
  await expect.poll(() => page.locator('.toppannavitem:visible').last().getAttribute('title'), { timeout: 45_000 }).toBe(name)
}

async function refreshUntilListed(page: Page, name: string): Promise<void> {
  await expect.poll(async () => {
    await page.locator('#xbybody').getByTitle('\u5237\u65b0 F5').click()
    await page.waitForTimeout(1_000)
    return fileListItem(page, name).count()
  }, { timeout: 60_000, intervals: [1_000, 2_000, 3_000] }).toBeGreaterThan(0)
}

async function trashSelectedItems(page: Page): Promise<void> {
  await page.locator('#xbybody').getByRole('button', { name: '\u5220\u9664', exact: true }).hover()
  await page.getByText('\u653e\u56de\u6536\u7ad9', { exact: true }).click()
}

async function clearFileSelection(page: Page): Promise<void> {
  const cancelSelection = page.getByRole('button', { name: '\u53d6\u6d88\u5df2\u9009', exact: true })
  if (await cancelSelection.isVisible()) await cancelSelection.click()
}

async function openCloudRoot(page: Page): Promise<void> {
  const cloudNav = page.locator('#xbyhead2 .arco-menu-item').getByText('\u7f51\u76d8', { exact: true })
  if (await cloudNav.isVisible()) await cloudNav.click()
  const breadcrumbs = page.locator('#xbybody > .arco-tabs > .arco-tabs-content > .arco-tabs-content-list > .arco-tabs-content-item-active .toppannavitem:visible')
  const currentBreadcrumb = breadcrumbs.last()
  if (await currentBreadcrumb.isVisible() && (await currentBreadcrumb.getAttribute('title')) === '\u6839\u76ee\u5f55') return
  const rootNode = page.locator('.dirtree:visible .dirtitle').getByText('\u6839\u76ee\u5f55', { exact: true })
  if (await rootNode.isVisible()) {
    await rootNode.click()
    await expect.poll(() => breadcrumbs.last().getAttribute('title'), { timeout: 45_000 }).toBe('\u6839\u76ee\u5f55')
    return
  }
  const firstBreadcrumb = breadcrumbs.first()
  await expect(firstBreadcrumb).toBeVisible({ timeout: 45_000 })
  await firstBreadcrumb.locator('span').first().click()
  await expect.poll(() => breadcrumbs.count(), { timeout: 45_000 }).toBe(1)
}

async function switchToRealProvider(page: Page, providerLabel: string): Promise<void> {
  const accountTrigger = page.locator('.user-avatar-trigger')
  await expect(accountTrigger).toBeVisible({ timeout: 45_000 })
  await accountTrigger.hover()
  const accountRows = page.locator('.userlist .user-list-row').filter({ hasText: providerLabel })
  await expect(accountRows, `真实账号配置中必须包含${providerLabel}账号`).not.toHaveCount(0, { timeout: 10_000 })
  const accountSwitch = accountRows.first().locator('.arco-switch')
  if (!(await accountSwitch.getAttribute('class'))?.includes('arco-switch-checked')) await accountSwitch.click()
  await expect(accountTrigger).toHaveAttribute('title', providerLabel, { timeout: 45_000 })
  await page.keyboard.press('Escape')
}

async function ensureCloudTestFileTrashed(page: Page, folderName: string, fileName: string): Promise<void> {
  try {
    if (page.isClosed()) return
    await page.keyboard.press('Escape')
    await openCloudRoot(page)
    if (folderName) {
      if (!(await fileListItem(page, folderName).count())) return
      await openListedFolder(page, folderName)
    }
    await page.locator('#xbybody').getByTitle('\u5237\u65b0 F5').click()
    await page.waitForTimeout(1_000)
    const uploadedRow = fileListItem(page, fileName)
    if (!(await uploadedRow.count())) return
    await clearFileSelection(page)
    await uploadedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(uploadedRow).toHaveCount(0, { timeout: 45_000 })
  } catch (error) {
    console.warn(`Failed to clean up real cloud E2E file ${fileName}`, error)
  }
}

async function trashCloudSearchMatches(page: Page, query: string): Promise<void> {
  try {
    if (page.isClosed()) return
    await page.keyboard.press('Escape')
    await openCloudRoot(page)
    const search = page.getByPlaceholder('\u5168\u76d8\u641c\u7d22')
    await search.fill(query)
    await search.press('Enter')
    await page.waitForTimeout(1_500)
    const rows = page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ hasText: query })
    const count = await rows.count()
    await clearFileSelection(page)
    for (let index = 0; index < count; index++) await rows.nth(index).locator('button.select').click()
    if (count) {
      await trashSelectedItems(page)
      await expect(rows).toHaveCount(0, { timeout: 45_000 })
    }
  } catch (error) {
    console.warn(`Failed to clean up real cloud E2E search matches for ${query}`, error)
  }
}

async function startPendingUpload(page: Page): Promise<void> {
  const startUpload = page.getByRole('button', { name: '\u5f00\u59cb\u4e0a\u4f20', exact: true })
  await startUpload.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
  if (await startUpload.isVisible()) await startUpload.click()
}

test('startup opens one real cloud root and keeps it selected', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await expect(page.locator('.userloginmodal')).toBeHidden()
  await expect.poll(() => page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').count(), { timeout: 45_000 }).toBeGreaterThan(0)
  await expect(page.locator('#panfilelist:visible')).toContainText(/\S+/)
  const selectedRoot = await page.locator('.toppannavitem:visible').first().getAttribute('title')
  await page.waitForTimeout(2_000)
  await expect(page.locator('.toppannavitem:visible').first()).toHaveAttribute('title', selectedRoot || '')
  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('a real 123 account can find the isolated E2E folder with global search', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const search = page.getByPlaceholder('\u5168\u76d8\u641c\u7d22')
  await expect(search).toBeVisible({ timeout: 45_000 })
  await search.fill('BoxPlayer-E2E')
  await search.press('Enter')
  await expect(fileListItem(page, 'BoxPlayer-E2E')).toBeVisible({ timeout: 45_000 })
  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('scrolling a real cloud folder loads more than one page', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await page.route('https://open-api.123pan.com/api/v2/file/list**', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('limit', '10')
    await route.continue({ url: url.toString() })
  })
  const folderPath = (process.env.BOXPLAYER_E2E_PAGINATION_FOLDER || '行尸走肉/S10').split('/').filter(Boolean)
  for (const folderName of folderPath) {
    const folder = page.locator('#panfilelist:visible').getByText(folderName, { exact: true })
    for (let attempt = 0; attempt < 8 && !(await folder.isVisible()); attempt++) {
      await scrollFileListToBottom(page)
      await page.waitForTimeout(800)
    }
    await expect(folder).toBeVisible({ timeout: 45_000 })
    const row = folder.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " fileitem ")][1]')
    await row.locator('button.select').click()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('.toppannavitem:visible').last().getAttribute('title'), { timeout: 45_000 }).toBe(folderName)
  }

  const selectionInfo = page.locator('.selectInfo')
  await expect.poll(async () => listedItemCount(await selectionInfo.innerText()), { timeout: 45_000 }).toBeGreaterThan(0)
  expect(listedItemCount(await selectionInfo.innerText())).toBeLessThanOrEqual(10)
  for (let attempt = 0; attempt < 8; attempt++) {
    if (listedItemCount(await selectionInfo.innerText()) > 10) break
    await scrollFileListToBottom(page)
    await page.waitForTimeout(800)
  }

  await expect.poll(async () => listedItemCount(await selectionInfo.innerText()), { timeout: 30_000 }).toBeGreaterThan(10)
  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('downloading a real 123 folder enumerates every provider page', async ({ boxPlayer }) => {
  const { app, page, pageErrors } = boxPlayer
  const context = app.context()
  const cursors: string[] = []
  let downloadStarted = false

  const folderPath = (process.env.BOXPLAYER_E2E_PAGINATION_FOLDER || '行尸走肉/S10').split('/').filter(Boolean)
  const targetFolder = folderPath.pop()
  if (!targetFolder) throw new Error('BOXPLAYER_E2E_PAGINATION_FOLDER must contain a folder name')
  for (const folderName of folderPath) {
    for (let attempt = 0; attempt < 12 && !(await fileListItem(page, folderName).isVisible()); attempt++) {
      await scrollFileListToBottom(page)
      await page.waitForTimeout(500)
    }
    await openListedFolder(page, folderName)
  }
  for (let attempt = 0; attempt < 12 && !(await fileListItem(page, targetFolder).isVisible()); attempt++) {
    await scrollFileListToBottom(page)
    await page.waitForTimeout(500)
  }
  const folderRow = fileListItem(page, targetFolder)
  await expect(folderRow).toBeVisible({ timeout: 45_000 })
  await folderRow.locator('button.select').click()

  await context.route('https://open-api.123pan.com/api/v2/file/list**', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('limit', '2')
    if (downloadStarted) cursors.push(url.searchParams.get('lastFileId') || '')
    await route.continue({ url: url.toString() })
  })
  downloadStarted = true
  await page.locator('#xbybody').getByRole('button', { name: '下载', exact: true }).click()
  await page.locator('#xbyhead2 .arco-menu-item').getByText('传输', { exact: true }).click()
  await expect(page.getByText(targetFolder, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '开始全部', exact: true }).first().click()
  await expect.poll(() => cursors.filter(Boolean).length, { timeout: 45_000 }).toBeGreaterThan(0)
  expect(cursors[0]).toBe('')
  expect(new Set(cursors).size).toBeGreaterThan(1)
  expect(pageErrors).toEqual([])
})

test('downloads every file in a real cloud folder (BP-000077 BP-000084)', async ({ boxPlayer }) => {
  test.setTimeout(180_000)
  const { app, page } = boxPlayer
  page.setDefaultTimeout(15_000)
  await switchToRealProvider(page, '123网盘')
  await openCloudRoot(page)
  const folderName = `BoxPlayer-E2E-download-${Date.now()}`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-folder-download-'))
  const names = ['first.txt', 'second.txt', 'third.txt']
  for (const name of names) writeFileSync(path.join(tempDir, name), `Folder download regression: ${name}`)
  try {
    await page.getByRole('button', { name: /新建/ }).hover()
    await page.getByText('新建文件夹', { exact: true }).click()
    await page.locator('#CreatNewDirInput').fill(folderName)
    await page.getByRole('button', { name: '创建', exact: true }).click()
    await refreshUntilListed(page, folderName)
    await openListedFolder(page, folderName)
    await page.evaluate((paths) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback(paths)
    }, names.map(name => path.join(tempDir, name)))
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    for (const name of names) await refreshUntilListed(page, name)
    await openCloudRoot(page)
    await fileListItem(page, folderName).locator('button.select').click()
    await page.locator('#xbybody').getByRole('button', { name: '下载', exact: true }).click()
    await page.locator('#xbyhead2 .arco-menu-item').getByText('传输', { exact: true }).click()
    await page.getByRole('button', { name: '开始全部', exact: true }).first().click()
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const downloadRoot = path.join(userData, 'E2E Downloads')
    await expect.poll(() => readdirSync(downloadRoot, { recursive: true }).map(String).filter(name => names.some(file => name.endsWith(path.sep + file))).length,
      { timeout: 60_000, message: 'All three folder files must finish downloading, not only the first' }).toBe(3)
    for (const name of names) {
      const relative = readdirSync(downloadRoot, { recursive: true }).map(String).find(file => file.endsWith(path.sep + name))!
      expect(readFileSync(path.join(downloadRoot, relative), 'utf8')).toBe(`Folder download regression: ${name}`)
    }
  } finally {
    await page.keyboard.press('Escape')
    const closeModal = page.locator('.arco-modal:visible').getByRole('button', { name: 'Close', exact: true })
    if (await closeModal.count()) await closeModal.first().click()
    await page.locator('#xbyhead2 .arco-menu-item').getByText('网盘', { exact: true }).click()
    await expect(page.locator('#panfilelist:visible')).toBeVisible()
    await ensureCloudTestFileTrashed(page, '', folderName)
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('queues every existing Aliyun folder file and downloads more than the first (BP-000077 BP-000084)', async ({ boxPlayer }) => {
  test.setTimeout(180_000)
  const { app, page } = boxPlayer
  await switchToRealProvider(page, '阿里云盘')
  await openCloudRoot(page)
  await page.locator('.dirtree:visible .dirtitle').getByText('资源盘', { exact: true }).click()
  const folderName = process.env.BOXPLAYER_E2E_ALIYUN_DOWNLOAD_FOLDER || '口语3'
  await expect(fileListItem(page, folderName)).toBeVisible({ timeout: 45_000 })
  await openListedFolder(page, folderName)
  const listing = page.waitForResponse(response => response.url().includes('api.aliyundrive.com/adrive/v3/file/list') && response.request().postDataJSON()?.type !== 'folder')
  await page.locator('#xbybody').getByTitle('刷新 F5').click()
  const body = await (await listing).json()
  const files = body.items as Array<{ name: string; type: string; size: number; content_hash?: string; content_hash_name?: string }>
  expect(body.next_marker || '').toBe('')
  expect(files.length).toBeGreaterThan(1)
  expect(files.every(file => file.type === 'file')).toBe(true)
  expect(files.reduce((sum, file) => sum + file.size, 0)).toBeLessThan(100 * 1024 * 1024)
  await expect.poll(async () => (await page.locator('#panfilelist .filename').allTextContents()).map(name => name.trim()).sort()).toEqual(files.map(file => file.name).sort())
  await openCloudRoot(page)
  await fileListItem(page, folderName).locator('button.select').click()
  await page.locator('#xbybody').getByRole('button', { name: '下载', exact: true }).click()
  await page.locator('#xbyhead2 .arco-menu-item').getByText('传输', { exact: true }).click()
  await expect(page.getByTitle('总共文件数量')).toHaveText(`总数 ${files.length}`)
  await page.getByRole('button', { name: '开始全部', exact: true }).first().click()
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  const downloadRoot = path.join(userData, 'E2E Downloads')
  const downloaded = () => readdirSync(downloadRoot, { recursive: true }).map(String)
  await expect.poll(() => files.filter(file => downloaded().some(name => name.endsWith(path.sep + file.name))).length,
    { timeout: 120_000, message: 'Aliyun folder download must continue beyond the first file' }).toBeGreaterThan(1)
  for (const file of files.filter(item => downloaded().some(name => name.endsWith(path.sep + item.name)))) {
    const target = path.join(downloadRoot, downloaded().find(name => name.endsWith(path.sep + file.name))!)
    expect(statSync(target).size).toBe(file.size)
    if (file.content_hash && file.content_hash_name?.toLowerCase() === 'sha1') {
      expect(createHash('sha1').update(readFileSync(target)).digest('hex').toLowerCase()).toBe(file.content_hash.toLowerCase())
    }
  }
})

test('uploads, scrapes and trashes a test media file in the isolated E2E folder', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const fileName = `Forrest.Gump.1994.BoxPlayer-E2E-${Date.now()}.mp4`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-upload-'))
  const localFile = path.join(tempDir, fileName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright real-account upload smoke test'))

  try {
    if (!(await fileListItem(page, folderName).count())) {
      await page.getByRole('button', { name: /\u65b0\u5efa/ }).hover()
      await page.getByText('\u65b0\u5efa\u6587\u4ef6\u5939', { exact: true }).click()
      await page.locator('#CreatNewDirInput').fill(folderName)
      await page.getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
      await refreshUntilListed(page, folderName)
    }
    await openListedFolder(page, folderName)
    const staleRows = page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ hasText: 'Forrest.Gump.1994.BoxPlayer-E2E-' })
    for (let index = 0; index < await staleRows.count(); index++) await staleRows.nth(index).locator('button.select').click()
    if (await staleRows.count()) {
      await trashSelectedItems(page)
      await expect(staleRows).toHaveCount(0, { timeout: 45_000 })
    }

    await page.evaluate((uploadPath) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, localFile)
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    await refreshUntilListed(page, fileName)

    await page.getByTitle(/\u540e\u9000/).click()
    await expect.poll(() => page.locator('.toppannavitem:visible').last().getAttribute('title'), { timeout: 45_000 }).not.toBe(folderName)
    const folderRow = fileListItem(page, folderName)
    await folderRow.locator('button.select').click()
    await folderRow.click({ button: 'right' })
    await page.getByText('\u626b\u63cf\u6570\u636e', { exact: true }).hover()
    await page.getByText('\u5f00\u59cb\u626b\u63cf', { exact: true }).click()
    await expect(page.locator('.media-library-nav')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(folderName, { exact: true }).first()).toBeVisible({ timeout: 90_000 })

    await page.locator('#xbyhead2 .arco-menu-item').getByText('\u7f51\u76d8', { exact: true }).click()
    await openListedFolder(page, folderName)
    const uploadedRow = fileListItem(page, fileName)
    await uploadedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(uploadedRow).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, fileName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('opens Aliyun Word with the native Office preview instead of the book reader (BP-000080)', async ({ boxPlayer }) => {
  const { app, page, pageErrors, consoleErrors } = boxPlayer
  await switchToRealProvider(page, '阿里云盘')
  await openCloudRoot(page)
  const search = page.getByPlaceholder('全盘搜索')
  await search.fill('docx')
  await search.press('Enter')
  const wordRow = page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ hasText: /\.docx/i }).first()
  await expect(wordRow, '真实阿里云盘账号中必须存在可用于回归的 DOCX').toBeVisible({ timeout: 45_000 })

  const previewPromise = app.waitForEvent('window')
  await wordRow.click()
  const preview = await previewPromise
  try {
    await preview.waitForLoadState('domcontentloaded')
    await expect(preview.locator('#doc-preview'), '阿里云盘 Word 应进入原生 Office 版式预览').toBeVisible({ timeout: 60_000 })
    await expect(preview.getByText('Search in the Book')).toHaveCount(0)
  } finally {
    if (!preview.isClosed()) await preview.close()
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors).filter((error) => !(error.includes('openapi.alipan.com/adrive/v1.0/openFile/search') && error.includes('401')))).toEqual([])
})

test('loads the real Tianyi Cloud root with the signed Date header (BP-000081)', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  await switchToRealProvider(page, '天翼云盘')
  await expect(page.locator('#panfilelist:visible')).toBeVisible({ timeout: 45_000 })

  const responsePromise = page.waitForResponse((response) => response.url().startsWith('https://api.cloud.189.cn/listFiles.action'))
  await page.locator('#xbybody').getByTitle('刷新 F5').click()
  const response = await responsePromise
  const headers = await response.request().allHeaders()
  const payload = await response.json().catch(() => ({}))

  expect(response.status(), JSON.stringify(payload)).toBe(200)
  expect(headers.date).toBeTruthy()
  expect(headers.signature).toBeTruthy()
  expect(headers.sessionkey).toBeTruthy()
  expect(payload?.errorCode).not.toBe('InvalidArgument')
  await expect(page.getByText(/date\/signature is null/i)).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('uploads a desktop-dropped file to the selected real cloud folder', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const fileName = `BoxPlayer-E2E-Drop-${Date.now()}.txt`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-drop-'))
  const localFile = path.join(tempDir, fileName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright desktop drag-and-drop upload smoke test'))

  try {
    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await page.evaluate((uploadPath) => {
      window.WebGetPathForFile = () => uploadPath
    }, localFile)
    await page.locator('#panfilelist:visible').evaluate((target, droppedFileName) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['BoxPlayer Playwright drag payload'], droppedFileName, { type: 'text/plain' }))
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }, fileName)
    await startPendingUpload(page)
    await refreshUntilListed(page, fileName)

    const uploadedRow = fileListItem(page, fileName)
    await expect(uploadedRow).toBeVisible()
    await uploadedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(uploadedRow).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, fileName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('renames and trashes an uploaded file in the isolated E2E folder', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const originalName = `BoxPlayer-E2E-Rename-${Date.now()}.txt`
  const renamedName = originalName.replace('.txt', '-Renamed.txt')
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-rename-'))
  const localFile = path.join(tempDir, originalName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright rename smoke test'))

  try {
    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    const staleRows = page.locator('#panfilelist:visible .fileitem, #panfilelist:visible .griditem').filter({ hasText: 'BoxPlayer-E2E-Rename-' })
    const staleCount = await staleRows.count()
    for (let index = 0; index < staleCount; index++) await staleRows.nth(index).locator('button.select').click()
    if (staleCount) {
      await trashSelectedItems(page)
      await expect(staleRows).toHaveCount(0, { timeout: 45_000 })
    }
    await page.evaluate((uploadPath) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, localFile)
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    await refreshUntilListed(page, originalName)

    const originalRow = fileListItem(page, originalName)
    await originalRow.locator('button.select').click()
    await page.keyboard.press('F2')
    const renameInput = page.locator('#RenameInput')
    await expect(renameInput).toBeVisible()
    await renameInput.fill(renamedName)
    await page.locator('.arco-modal').filter({ has: renameInput }).getByRole('button', { name: '\u91cd\u547d\u540d', exact: true }).click()
    await expect(fileListItem(page, renamedName)).toBeVisible({ timeout: 45_000 })
    await expect(fileListItem(page, originalName)).toHaveCount(0)

    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await refreshUntilListed(page, renamedName)
    const renamedRow = fileListItem(page, renamedName)
    await renamedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(renamedRow).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, originalName)
    await ensureCloudTestFileTrashed(page, folderName, renamedName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('moves an uploaded file into an existing child folder through the real cloud picker', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const fileName = `BoxPlayer-E2E-Move-${Date.now()}.txt`
  const targetName = `BoxPlayer-E2E-Move-Target-${Date.now()}`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-move-'))
  const localFile = path.join(tempDir, fileName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright move picker smoke test'))

  try {
    await trashCloudSearchMatches(page, 'BoxPlayer-E2E-Move-')
    await openCloudRoot(page)
    await openListedFolder(page, folderName)

    await page.getByRole('button', { name: /\u65b0\u5efa/ }).hover()
    await page.getByText('\u65b0\u5efa\u6587\u4ef6\u5939', { exact: true }).click()
    await page.locator('#CreatNewDirInput').fill(targetName)
    await page.getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
    await refreshUntilListed(page, targetName)

    await page.evaluate((uploadPath) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, localFile)
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    await refreshUntilListed(page, fileName)

    await fileListItem(page, fileName).locator('button.select').click()
    await page.keyboard.press('Control+x')
    const picker = page.locator('.showpandirmodal')
    await expect(picker).toBeVisible()
    await picker.getByText(folderName, { exact: true }).click()
    await expect(picker.locator('#selectdir')).toContainText(folderName)
    await picker.getByText(targetName, { exact: true }).click()
    await expect(picker.locator('#selectdir')).toContainText(targetName)
    await picker.getByRole('button', { name: '\u9009\u62e9', exact: true }).click()
    await expect(picker).toBeHidden({ timeout: 45_000 })

    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await refreshUntilListed(page, targetName)
    await expect(fileListItem(page, fileName)).toHaveCount(0)
    await openListedFolder(page, targetName)
    await refreshUntilListed(page, fileName)
    const movedRow = fileListItem(page, fileName)
    await movedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(movedRow).toHaveCount(0, { timeout: 45_000 })

    await page.getByTitle(/\u540e\u9000/).click()
    await refreshUntilListed(page, targetName)
    const targetRow = fileListItem(page, targetName)
    await clearFileSelection(page)
    await targetRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(targetRow).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, fileName)
    await ensureCloudTestFileTrashed(page, folderName, targetName)
    await trashCloudSearchMatches(page, targetName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('cancelling the real cloud move picker leaves the source file unchanged', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const fileName = `BoxPlayer-E2E-Move-Cancel-${Date.now()}.txt`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-move-cancel-'))
  const localFile = path.join(tempDir, fileName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright cancelled move smoke test'))

  try {
    await trashCloudSearchMatches(page, 'BoxPlayer-E2E-Move-Cancel-')
    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await page.evaluate((uploadPath) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, localFile)
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    await refreshUntilListed(page, fileName)

    const sourceRow = fileListItem(page, fileName)
    await sourceRow.locator('button.select').click()
    await page.keyboard.press('Control+x')
    const picker = page.locator('.showpandirmodal')
    await expect(picker).toBeVisible()
    await picker.getByText(folderName, { exact: true }).click()
    await expect(picker.locator('#selectdir')).toContainText(folderName)
    await picker.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    await expect(picker).toBeHidden()

    await page.locator('#xbybody').getByTitle('\u5237\u65b0 F5').click()
    await expect(fileListItem(page, fileName)).toBeVisible({ timeout: 45_000 })
    await clearFileSelection(page)
    await fileListItem(page, fileName).locator('button.select').click()
    await trashSelectedItems(page)
    await expect(fileListItem(page, fileName)).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, fileName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('copies an uploaded file into a picker-created folder on the real cloud account', async ({ boxPlayer }) => {
  const { page, pageErrors, consoleErrors } = boxPlayer
  const folderName = 'BoxPlayer-E2E'
  const fileName = `BoxPlayer-E2E-Copy-${Date.now()}.txt`
  const targetName = `BoxPlayer-E2E-Copy-Target-${Date.now()}`
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'boxplayer-real-copy-'))
  const localFile = path.join(tempDir, fileName)
  writeFileSync(localFile, Buffer.from('BoxPlayer Playwright copy picker smoke test'))

  try {
    await trashCloudSearchMatches(page, 'BoxPlayer-E2E-Copy-Target-')
    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await page.evaluate((uploadPath) => {
      window.WebShowOpenDialogSync = (_options, callback) => callback([uploadPath])
    }, localFile)
    await page.keyboard.press('Control+u')
    await startPendingUpload(page)
    await refreshUntilListed(page, fileName)

    await fileListItem(page, fileName).locator('button.select').click()
    await page.keyboard.press('Control+c')
    const picker = page.locator('.showpandirmodal')
    await expect(picker).toBeVisible()
    await picker.getByText(folderName, { exact: true }).click()
    await expect(picker.locator('#selectdir')).toContainText(folderName)
    await picker.getByRole('button', { name: '\u65b0\u5efa\u6587\u4ef6\u5939', exact: true }).click()
    const newFolderInput = page.locator('#SelectDirCreatNewDirInput')
    await expect(newFolderInput).toBeVisible()
    await newFolderInput.fill(targetName)
    await page.locator('.arco-modal').filter({ has: newFolderInput }).getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
    await expect(newFolderInput).toBeHidden({ timeout: 45_000 })
    await expect(picker.locator('#selectdir')).toContainText(targetName)
    await picker.getByRole('button', { name: '\u9009\u62e9', exact: true }).click()
    await expect(picker).toBeHidden({ timeout: 45_000 })

    await openCloudRoot(page)
    await openListedFolder(page, folderName)
    await refreshUntilListed(page, targetName)
    await openListedFolder(page, targetName)
    await refreshUntilListed(page, fileName)
    const copiedRow = fileListItem(page, fileName)
    await clearFileSelection(page)
    await copiedRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(copiedRow).toHaveCount(0, { timeout: 45_000 })

    await page.getByTitle(/\u540e\u9000/).click()
    await refreshUntilListed(page, targetName)
    const targetRow = fileListItem(page, targetName)
    await clearFileSelection(page)
    await targetRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(targetRow).toHaveCount(0, { timeout: 45_000 })

    const originalRow = fileListItem(page, fileName)
    await clearFileSelection(page)
    await originalRow.locator('button.select').click()
    await trashSelectedItems(page)
    await expect(originalRow).toHaveCount(0, { timeout: 45_000 })
  } finally {
    await ensureCloudTestFileTrashed(page, folderName, fileName)
    await ensureCloudTestFileTrashed(page, folderName, targetName)
    await trashCloudSearchMatches(page, targetName)
    rmSync(tempDir, { recursive: true, force: true })
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})

test('opens an existing real cloud video in the player briefly', async ({ boxPlayer }) => {
  const { app, page, pageErrors, consoleErrors } = boxPlayer
  const videoName = '\u6cf3\u8005\u4e4b\u5fc3.2024.2160p.HDR.WEB-DL.H265.DDP5.1.Atmos.ADWeb.mkv'
  let playbackSourceResolved = false
  let playbackBlockedReason = ''
  const playbackProviderRequests: string[] = []
  const playbackResponseSummaries: string[] = []
  const captureProviderRequest = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (url.hostname === 'open-api.123pan.com') playbackProviderRequests.push(url.pathname)
  }
  const capturePlaybackSource = async (response: import('@playwright/test').Response) => {
    const pathname = new URL(response.url()).pathname
    if (pathname !== '/api/v1/video/transcode/list' && pathname !== '/api/v1/file/download_info') return
    try {
      const body = await response.json()
      const transcodeUrl = Array.isArray(body?.data?.list) && body.data.list.some((item: any) => typeof item?.url === 'string' && item.url.length > 0)
      const downloadUrl = typeof body?.data?.downloadUrl === 'string' && body.data.downloadUrl.length > 0
      const message = String(body?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 160)
      playbackResponseSummaries.push(`${pathname}:${response.status()}:code=${String(body?.code)}:message=${message || 'none'}:transcodeUrl=${transcodeUrl}:downloadUrl=${downloadUrl}:dataKeys=${Object.keys(body?.data || {}).sort().join('|') || 'none'}`)
      if (response.ok() && body?.code === 0 && (transcodeUrl || downloadUrl)) playbackSourceResolved = true
      if (pathname === '/api/v1/file/download_info' && response.ok() && body?.code !== 0) playbackBlockedReason = `code ${String(body?.code)}: ${message || 'provider rejected the download request'}`
    } catch (error) {
      playbackResponseSummaries.push(`${pathname}:${response.status()}:unreadable=${error instanceof Error ? error.name : 'unknown'}`)
    }
  }
  app.context().on('request', captureProviderRequest)
  app.context().on('response', capturePlaybackSource)
  const video = page.locator('#panfilelist:visible').getByText(videoName, { exact: true })
  await expect(video).toBeVisible({ timeout: 45_000 })
  const playerPromise = app.waitForEvent('window')
  await video.click()
  const player = await playerPromise
  try {
    await player.waitForLoadState('domcontentloaded')
    const mpvSurface = player.locator('#mpvEmbeddedPlayer.mpv-embedded-surface')
    const webVideo = player.locator('#artPlayer video, .art-video-player video').first()
    await expect(player.locator('#mpvEmbeddedPlayer.mpv-embedded-surface, #artPlayer video, .art-video-player video').first()).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => playbackSourceResolved || Boolean(playbackBlockedReason), { timeout: 30_000 }).toBe(true).catch(async () => {
      const notices = await player.locator('.art-notice-inner, .mpv-embedded-error, .arco-message-content').allInnerTexts().catch(() => [])
      throw new Error(`No real 123 playback URL was resolved. Provider API paths: ${playbackProviderRequests.join(', ') || 'none'}. Playback responses: ${playbackResponseSummaries.join(', ') || 'none'}. Player notices: ${notices.join(' | ') || 'none'}`)
    })
    if (playbackBlockedReason) throw new Error(`123 provider blocked this account's playback request (${playbackBlockedReason})`)
    if (await mpvSurface.isVisible()) {
      await expect(mpvSurface.locator('canvas').first()).toBeVisible()
      await expect(mpvSurface.locator('.mpv-embedded-error')).toHaveCount(0)
    } else {
      await expect(webVideo).toBeVisible()
      await expect(player.locator('.art-notice-inner')).not.toContainText(/\u5931\u8d25|\u9519\u8bef|failed|error/i)
    }
    await player.waitForTimeout(3_000)
  } finally {
    app.context().off('request', captureProviderRequest)
    app.context().off('response', capturePlaybackSource)
    if (!player.isClosed()) await player.close()
  }

  expect(pageErrors).toEqual([])
  expect(unexpectedCloudErrors(consoleErrors)).toEqual([])
})
