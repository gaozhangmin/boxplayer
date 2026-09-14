import { expect, test } from './fixtures/boxPlayer'

test('document indexing native database loads in the launched Electron app', async ({ boxPlayer }) => {
  const { app, page, pageErrors, consoleErrors } = boxPlayer

  await expect(page.locator('#xbyhead2')).toBeVisible()
  const abi = await app.evaluate(() => {
    const { createRequire } = process.getBuiltinModule('module')
    const Database = createRequire(`${process.cwd()}/package.json`)('better-sqlite3')
    const database = new Database(':memory:')
    database.exec('create table document_chunks (id text primary key); insert into document_chunks values (\'chunk-1\');')
    const count = database.prepare('select count(*) as count from document_chunks').get().count
    database.close()
    return { abi: process.versions.modules, count }
  })

  expect(abi).toEqual({ abi: '143', count: 1 })
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
