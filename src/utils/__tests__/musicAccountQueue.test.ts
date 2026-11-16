import { describe, expect, it } from 'vitest'
import { MusicAccountQueue, retryAfterMs } from '../musicAccountQueue'
describe('music head account queue', () => {
  it('parses delta seconds and HTTP-date with bounded defaults', () => {
    expect(retryAfterMs('120', 0)).toBe(120000)
    expect(retryAfterMs('172800', 0)).toBe(172800000)
    expect(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 0)).toBe(120000)
    expect(retryAfterMs('invalid', 0)).toBe(60000)
    expect(retryAfterMs(undefined, 0)).toBe(60000)
  })
  it('single-flights each file and serializes the account with spacing', async () => {
    let now = 0, calls = 0
    const queue = new MusicAccountQueue(() => now, async ms => { now += ms })
    const a = queue.run('account', 'file', async () => { calls++; return 1 })
    const duplicate = queue.run('account', 'file', async () => { calls++; return 9 })
    expect(a).toBe(duplicate)
    const b = queue.run('account', 'other', async () => { expect(now).toBeGreaterThanOrEqual(1000); calls++; return 2 })
    expect(await Promise.all([a,duplicate,b])).toEqual([1,1,2]); expect(calls).toBe(2)
  })
  it('a 429 pauses later work on that account while another account can proceed', async () => {
    let now = 0
    const queue = new MusicAccountQueue(() => now, async ms => { now += ms })
    await expect(queue.run('a','first', async () => { throw { status:429, retryAfter:'120' } })).rejects.toMatchObject({status:429})
    await queue.run('b','independent',async () => { expect(now).toBe(0) })
    await queue.run('a','second',async () => { expect(now).toBeGreaterThanOrEqual(120000) })
  })
})
