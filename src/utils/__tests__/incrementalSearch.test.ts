import { describe, expect, it, vi } from 'vitest'
import { incrementalSearch } from '../incrementalSearch'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('incremental source search', () => {
  it('publishes fast hits before a slow source completes and retains configured order', async () => {
    const slow = deferred<string[]>()
    const updates: string[][] = []
    let complete = false
    const run = incrementalSearch([() => slow.promise, async () => ['fast']], { onUpdate: items => updates.push(items) }).then(items => { complete = true; return items })
    await vi.waitFor(() => expect(updates).toEqual([['fast']]))
    expect(complete).toBe(false)
    slow.resolve(['slow'])
    expect(await run).toEqual(['slow', 'fast'])
  })

  it('retains successful sources when another source fails', async () => {
    const updates: string[][] = []
    const result = await incrementalSearch([async () => ['hit'], async () => { throw new Error('offline') }, async () => ['another']], { onUpdate: items => updates.push(items) })
    expect(result).toEqual(['hit', 'another'])
    expect(updates.some(items => items.includes('hit'))).toBe(true)
  })

  it('bounds in-flight requests and starts queued work when a slot becomes available', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<string[]>())
    const started: number[] = []
    const run = incrementalSearch(gates.map((gate, i) => () => { started.push(i); return gate.promise }), { concurrency: 2 })
    expect(started).toEqual([0, 1])
    gates[1].resolve(['one'])
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    gates.forEach((gate, i) => gate.resolve([String(i)]))
    await run
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  it('stops queued sources and rejects late publications after changing the keyword', async () => {
    const old = deferred<string[]>()
    const controller = new AbortController()
    const publish = vi.fn()
    const queued = vi.fn(async () => ['queued'])
    const run = incrementalSearch([() => old.promise, queued], { concurrency: 1, signal: controller.signal, onUpdate: publish })
    controller.abort()
    old.resolve(['stale'])
    expect(await run).toEqual([])
    expect(queued).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(await incrementalSearch([async () => ['new']], { onUpdate: publish })).toEqual(['new'])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(['new'])
  })
})
