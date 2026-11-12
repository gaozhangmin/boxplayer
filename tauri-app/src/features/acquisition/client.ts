import {nativeCall} from '@/platform/native'
import {listen} from '@tauri-apps/api/event'
import type {MediaAcquisitionRunView,MediaAcquisitionState,MediaAcquisitionTrackingItem,MediaAcquisitionNotification} from '../../../native/boxplayer/mediaAcquisition'
export type {MediaAcquisitionRequest,MediaAcquisitionRunView,MediaAcquisitionState,MediaAcquisitionTrackingItem,MediaAcquisitionNotification} from '../../../native/boxplayer/mediaAcquisition'
export interface AcquisitionStatus {storageReady:boolean;engineReady:boolean;workerReady:boolean;reason:string}
const call=<T>(method:string,args:Record<string,unknown>={})=>nativeCall<T>('boxplayer_request',{method,args})
export const acquisitionStatus=()=>call<AcquisitionStatus>('status')
export const listAcquisitionRuns=(limit=50)=>call<MediaAcquisitionRunView[]>('listRuns',{limit})
export const getAcquisitionRun=(id:string)=>call<MediaAcquisitionRunView|null>('getRun',{id})
export const listAcquisitionStates=()=>call<MediaAcquisitionState[]>('listStates')
export const listAcquisitionTracking=()=>call<MediaAcquisitionTrackingItem[]>('listTracking')
export const listAcquisitionNotifications=(limit=100)=>call<MediaAcquisitionNotification[]>('listNotifications',{limit})
export const cancelAcquisitionRun=(id:string)=>call<null>('cancelRun',{id})
export const endAcquisitionTracking=(id:string)=>call<null>('endTracking',{id})
export const clearCompletedAcquisitionRuns=()=>call<number>('clearCompletedRuns')
export const clearAcquisitionNotifications=()=>call<number>('clearNotifications')
export const markAcquisitionNotificationsRead=(ids?:string[])=>call<void>('markNotificationsRead',ids?{ids}:{})
export const onAcquisitionChanged=(callback:()=>void)=>listen('boxplayer:changed',callback)
// No create/retry/patrol wrapper until the worker can actually execute them.
