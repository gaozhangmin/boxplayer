import { isLocalCoverData } from '@/features/servers/cover'
export function isCoverDataUri(value:unknown):value is string {return typeof value==='string'&&isLocalCoverData(value)}
export function isPublicCover(value:unknown):value is string {
 if(isCoverDataUri(value))return true
 if(typeof value!=='string')return false
 try{const url=new URL(value);return url.origin==='https://api.xbyvideohub.com'&&!url.username&&!url.password&&!/(?:[?&])(?:token|api_key|authorization)=/i.test(value)}catch{return false}
}
export function isServerCover(value:string){return !value||isCoverDataUri(value)||(!/^(?:[a-z]+:|\/\/)/i.test(value)&&!/(?:[?&])(?:token|api_key|authorization|x-plex-token)=/i.test(value))}
