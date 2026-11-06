/** Runs independent sources with bounded concurrency and stable source ordering. */
export async function incrementalSearch<T>(
  tasks: Array<() => Promise<T[]>>,
  options: { concurrency?: number; signal?: AbortSignal; onUpdate?: (items: T[]) => void } = {}
): Promise<T[]> {
  const slots: T[][] = tasks.map(() => [])
  let next = 0
  const worker = async () => {
    while (!options.signal?.aborted && next < tasks.length) {
      const index = next++
      try {
        const items = await tasks[index]()
        if (options.signal?.aborted) return
        slots[index] = items
      } catch {
        if (options.signal?.aborted) return
      }
      options.onUpdate?.(slots.flat())
    }
  }
  await Promise.all(Array.from({ length: Math.min(tasks.length, Math.max(1, options.concurrency ?? 3)) }, worker))
  return options.signal?.aborted ? [] : slots.flat()
}
