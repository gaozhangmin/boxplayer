import { ref } from 'vue'
import { nativeCall, asAppError } from '@/platform/native'
export interface SyncSettings {enabled:boolean;range:number}
export interface Status {configured:boolean;connected:boolean;settings:SyncSettings}
export interface Account {username:string;name:string;avatar?:string;vip:boolean;episodes:number;shows:number;movies:number}
export interface DeviceLogin {userCode:string;verificationUrl:string;expiresAt:number;interval:number}
export interface Identity {type:'movie'|'tv'|'episode';tmdbId?:number;imdbId?:string}
export interface PlaybackProgress {type:'movie'|'episode';tmdbId:number;season?:number;episode?:number;progress:number;pausedAt:string}
export const traktStatus=ref<Status>({configured:false,connected:false,settings:{enabled:true,range:-1}})
export const traktAccount=ref<Account>()
export async function loadTraktStatus(){return traktStatus.value=await nativeCall<Status>('trakt_status')}
export async function loadTraktAccount(){return traktAccount.value=await nativeCall<Account>('trakt_account')}
export const startTraktLogin=()=>nativeCall<{expiresAt:number;interval:number}>('trakt_web_start')
export const connectDeviceAuth=()=>nativeCall<DeviceLogin>('trakt_connect_device_auth')
export async function pollDeviceAuth(){const result=await nativeCall<{state:'pending';interval:number}|{state:'connected';status:Status}>('trakt_poll');if(result.state==='connected')traktStatus.value=result.status;return result}
export const cancelTraktLogin=()=>nativeCall<void>('trakt_cancel')
export async function disconnectTrakt(){traktStatus.value=await nativeCall<Status>('trakt_disconnect');traktAccount.value=undefined}
export async function setTraktSettings(settings:SyncSettings){return traktStatus.value=await nativeCall<Status>('trakt_settings',{settings})}
export const openTraktPage=(target:'verification'|'vip')=>nativeCall<void>('trakt_open',{target})
export const syncTrakt=(identity:Identity,action:'watchlist-add'|'watchlist-remove'|'rating'|'rating-remove',rating?:number)=>nativeCall<void>('trakt_sync',{identity,action,rating:rating??null})
export const loadTraktPlayback=()=>nativeCall<PlaybackProgress[]>('trakt_playback_progress')
export function traktError(cause:unknown){const e=asAppError(cause);const messages:Record<string,string>={TRAKT_CONFIG:'Trakt 服务尚未配置。',TRAKT_CANCELLED:'授权已取消。',TRAKT_SECURE_STORAGE:'无法安全读取或保存 Trakt 凭据，请检查系统钥匙串。',TRAKT_EXPIRED:'授权码已失效，请重新连接。',TRAKT_DENIED:'Trakt 授权被拒绝，请重新连接。',TRAKT_LOGIN:'Trakt 登录已失效，请重新连接。',TRAKT_METADATA:'缺少准确的 TMDB / IMDb 标识，请先修正元数据。',TRAKT_NOT_FOUND:'Trakt 未找到该媒体。',TRAKT_RATING:'个人评分必须为 1–10 的整数。',TRAKT_RATE_LIMIT:'Trakt 请求过于频繁，请稍后重试。',TRAKT_LIMIT:'Trakt 列表已达上限。',TRAKT_FORBIDDEN:'Trakt 拒绝访问，请检查账户授权。',TRAKT_STATS:'观看统计格式异常，请重试。'};return messages[e.code]||'Trakt 请求失败，请检查网络后重试。'}
export const publicTraktRating=(identity:Identity)=>nativeCall<{rating:number;votes:number;distribution:Record<string,number>}>('trakt_public_rating',{identity})
export const personalTraktRatings=(kind:'movies'|'shows'|'episodes',page=1)=>nativeCall<Array<{rating:number;rated_at:string;movie?:{ids:{tmdb?:number;imdb?:string}};show?:{ids:{tmdb?:number;imdb?:string}};episode?:{ids:{tmdb?:number;imdb?:string}}}>>('trakt_personal_ratings',{kind,page})
