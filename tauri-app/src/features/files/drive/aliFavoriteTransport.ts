import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
export async function ApiBatch(_title:string,rows:string[],user:string,share:string){
 const account=mutationAccount(user,'aliyun'),pane=getDrivePane(),epoch=pane.context
 const check=()=>{mutationAccount(user,'aliyun');if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==epoch)throw Error('收藏来源已切换')}
 check();if(share)throw Error('收藏不接受分享令牌')
 const reslut:Array<{id:string}>=[],seen=new Set<string>()
 for(const raw of rows){
  check();const row=JSON.parse(raw),body=row?.body
  if(row?.url!=='/file/update'||row.method!=='POST'||typeof row.id!=='string'||!row.id||row.id==='root'||seen.has(row.id)||body?.file_id!==row.id||typeof body.drive_id!=='string'||!body.drive_id||typeof body.starred!=='boolean'||body.custom_index_key!==(body.starred?'starred_yes':''))throw Error('收藏请求参数无效');seen.add(row.id)
  const response=await request(account,'POST','https://api.aliyundrive.com/adrive/v4/batch',JSON.stringify({requests:[row],resource:'file'}),{'Content-Type':'application/json'});check()
  const data=JSON.parse(text(response));if(response.status!==200||data?.code||!Array.isArray(data?.responses)||data.responses.length!==1||data.responses[0]?.id!==row.id)throw Error('收藏缺少匹配完成回执')
  const reply=data.responses[0],value=reply.body
  if(reply.status!==200||value?.code||value?.async_task_id||value?.file_id!==row.id||value?.drive_id!==body.drive_id||value?.starred!==body.starred)throw Error('收藏操作未确认完成，请刷新确认')
  reslut.push({id:row.id})
 }
 return {reslut}
}
