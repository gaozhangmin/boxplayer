import {getDrivePane} from './ports'
import {mutationAccount} from './providerTransport'
import {request,text} from '@/features/sources/transport'
export async function ApiBatch(_title:string,rows:string[],user:string,share:string){
 const account=mutationAccount(user,'aliyun'),pane=getDrivePane(),epoch=pane.context,check=()=>{mutationAccount(user,'aliyun');if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==user)throw Error('颜色标记来源已切换')}
 check();if(share)throw Error('颜色标记不接受分享令牌')
 const reslut:Array<{id:string}>=[],seen=new Set<string>()
 for(const raw of rows){const row=JSON.parse(raw),body=row?.body;check()
  if(row?.url!=='/file/update'||row.method!=='POST'||typeof row.id!=='string'||!row.id||row.id==='root'||seen.has(row.id)||body?.file_id!==row.id||typeof body.drive_id!=='string'||!body.drive_id||typeof body.description!=='string'||Object.keys(body).some(key=>!['drive_id','file_id','description'].includes(key)))throw Error('颜色标记请求参数无效');seen.add(row.id)
  const response=await request(account,'POST','https://api.aliyundrive.com/adrive/v4/batch',JSON.stringify({requests:[row],resource:'file'}),{'Content-Type':'application/json'});check()
  const data=JSON.parse(text(response));if(response.status!==200||data?.code||!Array.isArray(data?.responses)||data.responses.length!==1||data.responses[0]?.id!==row.id)throw Error('颜色标记缺少匹配回执')
  const reply=data.responses[0],value=reply.body
  if(reply.status!==200||value?.code||value?.async_task_id||value?.file_id!==row.id||value?.drive_id!==body.drive_id||value?.description!==body.description)throw Error('颜色标记未确认完成，请刷新确认')
  reslut.push({id:row.id})
 }
 return {reslut}
}
export function applyColorResult(user:string,drive:string,description:string,ids:string[]){
 const pane=getDrivePane();if(pane.sourceId!==user)throw Error('颜色标记来源已切换')
 const keys=ids.map(fileId=>JSON.stringify({driveId:drive,fileId}));for(const key of keys){const row=pane.file?.(key);if(row)row.description=description}pane.store.mColorFiles(description,keys)
}
