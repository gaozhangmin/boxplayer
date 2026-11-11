import type { Readable } from 'node:stream'
import type { NetShareEntry } from '../../../shared/netShare'

export interface NetShareStat { isDir: boolean; size: number; mtime: number }

export interface NetShareDriver {
  list(relativePath: string): Promise<NetShareEntry[]>
  stat(relativePath: string): Promise<NetShareStat>
  /** Streams bytes [start, end] (inclusive; end undefined = to EOF). */
  createReadStream(relativePath: string, start: number, end?: number): Promise<Readable>
  close(): void
}
