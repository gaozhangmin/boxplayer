import { describe, expect, it } from 'vitest'
import { recoverLateStartupTask, startBackgroundStartupTasks, withStartupTimeout } from '../startupTask'

describe('startup task timeout', () => {
  it('does not let one stalled provider block application startup', async () => {
    await expect(withStartupTimeout(new Promise<never>(() => {}), 'provider startup', 1)).rejects.toThrow('provider startup timed out')
  })

  it('starts later post-login work even when an earlier task never resolves', async () => {
    const completed: string[] = []
    startBackgroundStartupTasks([
      { label: 'stalled', run: () => new Promise<void>(() => {}) },
      { label: 'ready', run: async () => { completed.push('ready') } }
    ], () => {})

    await Promise.resolve()
    expect(completed).toEqual(['ready'])
  })
  it('recovers a refresh that succeeds after startup timed out without retrying it', async () => {
    let finish!: (value: string) => void
    const refresh = new Promise<string>(resolve => { finish = resolve })
    await expect(withStartupTimeout(refresh, 'login', 1)).rejects.toThrow('timed out')
    const recovered: string[] = []
    const recovery = recoverLateStartupTask(refresh, () => true, async value => { recovered.push(value) }, error => { throw error })
    finish('account')
    await recovery
    expect(recovered).toEqual(['account'])
  })

  it('does not replace an account selected while refresh was pending', async () => {
    let finish!: (value: string) => void
    const refresh = new Promise<string>(resolve => { finish = resolve })
    let signedIn = false
    const recovered: string[] = []
    const recovery = recoverLateStartupTask(refresh, () => !signedIn, async value => { recovered.push(value) }, error => { throw error })
    signedIn = true
    finish('old account')
    await recovery
    expect(recovered).toEqual([])
  })

  it('reports a failed late refresh without signing in', async () => {
    const errors: unknown[] = []
    await recoverLateStartupTask(Promise.reject(new Error('refresh rejected')), () => true,
      async () => { throw new Error('must not sign in') }, error => { errors.push(error) })
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('refresh rejected')
  })

})
