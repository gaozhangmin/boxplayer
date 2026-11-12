import {useFileSourcesStore} from '@/stores/fileSources'
import {createSourceShare,supportsSourceShare} from '@/features/sources/share'
export function supportsCreateShare(userId:string,_driveId:string){const account=useFileSourcesStore().accounts.find(a=>a.id===userId);return !!account&&supportsSourceShare(account)}
export const DriveShare={async ApiCreatShare(userId:string,_driveId:string,_a:string,_b:string,title:string,ids:string[]){const account=useFileSourcesStore().accounts.find(a=>a.id===userId);if(!account)throw Error('来源不存在');const value=await createSourceShare(account,ids[0],title);return {share_url:value.url,share_pwd:value.password}}}
export function copyToClipboard(value:string){void navigator.clipboard.writeText(value).catch(()=>{})}
