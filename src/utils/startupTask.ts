export const STARTUP_TASK_TIMEOUT_MS = 5_000

/** Prevent one unavailable cloud provider from blocking the whole application startup. */
export const withStartupTimeout = <T>(task: Promise<T>, label: string, timeoutMs = STARTUP_TASK_TIMEOUT_MS): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export interface IBackgroundStartupTask {
  label: string
  run: () => Promise<void>
}

/** Starts independent post-login work without making application readiness wait for it. */
export const startBackgroundStartupTasks = (tasks: IBackgroundStartupTask[], onError: (label: string, error: unknown) => void): void => {
  for (const task of tasks) {
    void task.run().catch((error) => onError(task.label, error))
  }
}

/** Observe an already-running refresh after its startup timeout, without retrying HTTP. */
export const recoverLateStartupTask = async <T>(task: Promise<T>, canRecover: (value: T) => boolean, recover: (value: T) => Promise<void>, onError: (error: unknown) => void): Promise<void> => {
  try {
    const value = await task
    if (canRecover(value)) await recover(value)
  } catch (error) {
    onError(error)
  }
}
