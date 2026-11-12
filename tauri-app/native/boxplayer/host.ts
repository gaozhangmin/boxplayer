import {createHash} from 'node:crypto'
import type {BoxPlayerDriveTarget} from './boxplayer'
import {openWorkflowRepository} from './sqlite'
import {normalizeBoxPlayerPlatform,providerFolderId} from './driveIdentity'
export const LAST_SWEEP_SETTING='boxplayer_last_sweep_completed_at'
const TARGET_SETTING_PREFIX='boxplayer_drive_target:'
const SWEEP_TIMES_SETTING='daily_sweep_times'
const DEFAULT_SWEEP_TIME='06:00'
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/
let repository:ReturnType<typeof openWorkflowRepository>|undefined
let changed:((workflowRunId?:string)=>void)|undefined
export async function openHost(path:string,onChanged?:(workflowRunId?:string)=>void){
 if(repository)throw new Error('BoxPlayer storage already opened')
 repository=openWorkflowRepository(path)
 try{await repository.requeueRunningWorkflowRuns()}catch(error){repository.close();repository=undefined;throw error}
 changed=onChanged
}
export function closeHost(){repository?.close();repository=undefined;changed=undefined}
export function getBoxPlayerRepository(){if(!repository)throw new Error('BoxPlayer storage not opened');return repository}
export function notifyBoxPlayerChanged(workflowRunId?:string){changed?.(workflowRunId)}
/** Folder ids are normalized so the same folder chosen twice maps to one connected storage. */
export function driveTargetId(target: Pick<BoxPlayerDriveTarget, 'platform' | 'userId' | 'driveId' | 'folderId'>): string {
  const platform = normalizeBoxPlayerPlatform(target.platform)
  const key = [platform, target.userId, target.driveId, providerFolderId(platform, target.folderId)].join('|')
  return `bp_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`
}

export async function saveDriveTarget(input: Omit<BoxPlayerDriveTarget, 'id' | 'createdAt'>): Promise<BoxPlayerDriveTarget> {
  const id = driveTargetId(input)
  const existing = await getDriveTarget(id)
  const target: BoxPlayerDriveTarget = { ...input, platform: normalizeBoxPlayerPlatform(input.platform), id, createdAt: existing?.createdAt || Date.now() }
  await getBoxPlayerRepository().setSetting(`${TARGET_SETTING_PREFIX}${id}`, JSON.stringify(target))
  return target
}

export async function getDriveTarget(id: string | null | undefined): Promise<BoxPlayerDriveTarget | null> {
  if (!id) return null
  const raw = await getBoxPlayerRepository().getSetting(`${TARGET_SETTING_PREFIX}${id}`)
  try {
    return raw ? JSON.parse(raw) as BoxPlayerDriveTarget : null
  } catch {
    return null
  }
}

export async function sweepTimes(): Promise<string[]> {
  const raw = (await getBoxPlayerRepository().getSetting(SWEEP_TIMES_SETTING))?.trim()
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const valid = [...new Set(parsed.filter((slot): slot is string => typeof slot === 'string' && HHMM.test(slot)))].sort().slice(0, 6)
      if (valid.length) return valid
    }
  } catch {}
  return [DEFAULT_SWEEP_TIME]
}

/** Epoch ms of the next daily patrol slot (slots are Beijing wall-clock times). */
export function nextSweepAt(times: string[], now = new Date()): number {
  const { hhmm } = beijingDateTime(now)
  const slot = times.find(time => time > hhmm) || times[0]
  const [hour, minute] = slot.split(':').map(Number)
  const beijingNow = new Date(now.getTime() + 8 * 3600_000)
  const next = Date.UTC(beijingNow.getUTCFullYear(), beijingNow.getUTCMonth(), beijingNow.getUTCDate(), hour, minute) - 8 * 3600_000
  return next > now.getTime() ? next : next + 24 * 3600_000
}

export function beijingDateTime(now = new Date()): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}` }
}

