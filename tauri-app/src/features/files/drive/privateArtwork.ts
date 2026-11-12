import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
/** Original thumbnail UI keeps its src binding; native owns authenticated fetches. */
export function aliVideoArtwork(account:Account,model:IAliGetFileModel){
 if(!model.thumbnail)return ''
 if(account.providerId!=='aliyun')throw Error('阿里缩略图来源不匹配')
 const url=new URL(model.thumbnail)
 const keys=[...url.searchParams.keys()]
 if(keys.length!==4||new Set(keys).size!==4||keys.some(key=>!['t','drive_id','file_id','video_thumbnail_process'].includes(key))||!/^\d{1,20}$/.test(url.searchParams.get('t')||''))throw Error('阿里缩略图文件身份无效')
 if(url.origin!=='https://api.aliyundrive.com'||url.pathname!=='/v2/file/download'||url.username||url.password||url.hash||url.searchParams.get('drive_id')!==model.drive_id||url.searchParams.get('file_id')!==model.file_id||url.searchParams.get('video_thumbnail_process')!=='video/snapshot,t_106000,f_jpg,ar_auto,m_fast')throw Error('阿里缩略图文件身份无效')
 const scheme=/Windows|Android/.test(navigator.userAgent)?'http://mscache.localhost':'mscache://localhost'
 return scheme+'/file-thumbnail?'+new URLSearchParams({account:account.id,url:url.href,revision:model.content_hash||String(model.time||'')})
}
