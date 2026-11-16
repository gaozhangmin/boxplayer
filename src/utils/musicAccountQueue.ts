/** One outstanding head read per account, shared cooldown and per-file single flight. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number {
  if (!value) return 60000
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) ? Math.max(1000, delay) : 60000
}
export class MusicAccountQueue {
  private tails = new Map<string, Promise<unknown>>()
  private next = new Map<string, number>()
  private flights = new Map<string, Promise<unknown>>()
  constructor(private now = () => Date.now(), private wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}
  cool(account: string, delay: number) { this.next.set(account, Math.max(this.next.get(account) || 0, this.now() + delay)) }
  run<T>(account: string, file: string, task: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([account, file]), flight = this.flights.get(key)
    if (flight) return flight as Promise<T>
    const job = (this.tails.get(account) || Promise.resolve()).catch(() => {}).then(async () => {
      while ((this.next.get(account) || 0) > this.now()) await this.wait(Math.min(30000, this.next.get(account)! - this.now()))
      try { return await task() } catch (error: any) {
        if (Number(error?.status || error?.response?.status) === 429) this.cool(account, retryAfterMs(error.retryAfter || error.response?.headers?.['retry-after']))
        else this.cool(account, 30000)
        throw error
      } finally { this.cool(account, 1000) }
    }).finally(() => { this.flights.delete(key); if (this.tails.get(account) === job) this.tails.delete(account) })
    this.flights.set(key, job); this.tails.set(account, job)
    return job
  }
}
export const musicHeadQueue = new MusicAccountQueue()
