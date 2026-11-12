import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
export const AliHistoryHttp={IsSuccess:(status:number)=>status===200,async Post(path:string,body:Record<string,unknown>,user:string,share:string){
 const account=mutationAccount(user,'aliyun')
 if(path!=='adrive/v1.0/openFile/video/updateRecord'||share||!body||typeof body.drive_id!=='string'||!body.drive_id||typeof body.file_id!=='string'||!body.file_id||body.file_id==='root'||body.play_cursor!=='0'||Object.keys(body).some(key=>!['drive_id','file_id','play_cursor'].includes(key)))throw Error('阿里清除历史参数无效')
 const response=await request(account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(body),{'Content-Type':'application/json'})
 const data=JSON.parse(text(response))
 if(response.status!==200||!data||typeof data!=='object'||Array.isArray(data)||data.code||data.error)throw Error('阿里未确认清除历史请求')
 return {code:response.status,body:data}
}}
