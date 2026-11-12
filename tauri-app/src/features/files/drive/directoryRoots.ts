import type {Account} from '@/features/sources/contracts'
export const directoryRootKeys:Partial<Record<Account['providerId'],string>>={onedrive:'onedrive_root',google:'google_root',box:'box_root',dropbox:'dropbox_root','123':'cloud123_root','115':'drive115_root',baidu:'baidu_root',pikpak:'pikpak_root',quark:'quark_root','139':'cloud139_root','189':'cloud189_root',guangya:'guangya_root'}
/** Original picker keys are UI identities; native drivers receive their root path. */
export function remoteDirectoryPath(provider:Account['providerId'],path:string,initialPath=''){
 if(['root','backup_root'].includes(path))return initialPath
 if(path===directoryRootKeys[provider])return ''
 if(provider==='115'&&path==='0'||provider==='quark'&&path==='0'||provider==='guangya'&&['0','/'].includes(path)||provider==='baidu'&&path==='/'||provider==='139'&&['0','/'].includes(path))return ''
 return path
}
