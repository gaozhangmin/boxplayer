import {getDrivePane} from './ports'
import {ApiGetShareToken,ApiGetShareAnonymous,ApiShareFileList} from './electron/providers/aliImport'
import {createQuarkImportScope,quarkImportTokens} from './quarkImportTransport'
import {apiQuarkShareToken,apiQuarkShareAnonymous,apiQuarkShareFileList} from './electron/providers/quarkImport'
import {createGuangyaImportScope} from './guangyaImportTransport'
import {apiGuangyaShareToken,apiGuangyaShareAnonymous,apiGuangyaShareFileList} from './electron/providers/guangyaImport'
import {createPikpakImportScope} from './pikpakImportTransport'
import {apiPikPakShareToken,apiPikPakShareAnonymous,apiPikPakShareFileList} from './electron/providers/pikpakImport'
export function createShareImportSession(){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context
 let closed=false
 let pikpak:ReturnType<typeof createPikpakImportScope>|undefined
 function pikpakScope(){check();return pikpak??=createPikpakImportScope(source,check)}
 let quark:ReturnType<typeof createQuarkImportScope>|undefined
 let guangya:ReturnType<typeof createGuangyaImportScope>|undefined
 function guangyaScope(){check();return guangya??=createGuangyaImportScope(source,check)}
 function quarkScope(){check();return quark??=createQuarkImportScope(source,check)}
 const tokens=new Map<string,string>()
 const files=new Map<string,Set<string>>()
 function check(){if(closed||getDrivePane()!==pane||pane.sourceId!==source||pane.context!==context)throw Error('导入窗口已关闭或来源已切换')}
 function validate(id:string){if(id.startsWith('pikpak:')&&pane.account?.providerId==='pikpak'&&/^pikpak:[A-Za-z0-9_-]{1,128}$/.test(id))return;if(id.startsWith('guangya:')&&pane.account?.providerId==='guangya'&&/^guangya:[A-Za-z0-9_-]{1,128}$/.test(id))return;if(id.startsWith('quark:')&&pane.account?.providerId==='quark'&&/^quark:[A-Za-z0-9]{1,128}$/.test(id))return;if(!/^[A-Za-z0-9_]{11,128}$/.test(id))throw Error('此来源分享导入协议尚未接入')}
 return {check,quarkScope,guangyaScope,pikpakScope,dispose(){closed=true;pikpak?.dispose();quark?.dispose();guangya?.dispose();tokens.clear();files.clear()},
  selection(id:string,token:string,ids:string[]){check();validate(id);if(tokens.get(id)!==token||new Set(ids).size!==ids.length||ids.some(file=>!files.get(id)?.has(file)))throw Error('分享令牌或文件选择不匹配')},
  async token(id:string,password:string){check();validate(id);const result=await (id.startsWith('pikpak:')?apiPikPakShareToken(id,password,pikpakScope().id):id.startsWith('guangya:')?apiGuangyaShareToken(id,password,guangyaScope().id):id.startsWith('quark:')?apiQuarkShareToken(id,password,quarkScope().id):ApiGetShareToken(id,password));check();if(typeof result!=='string'||!result||result.startsWith('，'))throw Error(result||'分享访问令牌为空');tokens.set(id,result);files.delete(id);if(id.startsWith('quark:'))for(const key of [...quarkImportTokens(quarkScope().id).keys()])if(key.startsWith(id+':'))quarkImportTokens(quarkScope().id).delete(key);return result},
  async info(id:string,password:string){check();validate(id);const result=await (id.startsWith('pikpak:')?apiPikPakShareAnonymous(id,password,pikpakScope().id):id.startsWith('guangya:')?apiGuangyaShareAnonymous(id,password,guangyaScope().id):id.startsWith('quark:')?apiQuarkShareAnonymous(id,password,quarkScope().id):ApiGetShareAnonymous(id,password));check();if(result.error)throw Error(result.error);return result},
  async list(id:string,token:string,parent:string){check();validate(id);if(tokens.get(id)!==token)throw Error('分享令牌或来源不匹配');const result=await (id.startsWith('pikpak:')?apiPikPakShareFileList(id,token,parent,pikpakScope().id):id.startsWith('guangya:')?apiGuangyaShareFileList(id,token,parent,guangyaScope().id):id.startsWith('quark:')?apiQuarkShareFileList(id,token,parent,quarkScope().id):ApiShareFileList(id,token,parent,check));check();if('error' in result&&result.error)throw Error(String(result.error));if(result.next_marker)throw Error('分享文件未完整列出：'+result.next_marker);const known=files.get(id)||new Set<string>();for(const row of result.items){if(typeof row.file_id!=='string'||!row.file_id)throw Error('分享文件标识无效');known.add(row.file_id)}files.set(id,known);return {itemsKey:new Set(result.items.map(row=>row.file_id)),punished_file_count:0,m_user_id:source,m_share_id:id,dirID:parent,dirName:'',...result}}
 }
}
