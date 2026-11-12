export type {MediaServerConfig,MediaServerType} from '../electron/serverTypes'
import type {PlexResource} from '../electron/plexTypes'
export interface NativePlexResource extends PlexResource {selectable?:boolean}
