import type {MediaServerConfig} from '../electron/serverTypes'
export type {MediaServerConfig} from '../electron/serverTypes'
export interface ElectronFolder {file_id:string;drive_id:string;user_id:string;name:string;path:string;isDir:boolean;category?:string;size:number;[key:string]:unknown}
export interface SavedSource {id:string;name:string;icon?:string;driveServerId?:string;favorite?:boolean;server?:MediaServerConfig;folder:ElectronFolder;drives?:Array<{label:string;folder:ElectronFolder}>}
