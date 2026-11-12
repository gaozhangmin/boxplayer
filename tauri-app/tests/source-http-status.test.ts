import {beforeEach,it,expect,vi} from 'vitest'
import {nativeCall} from '@/platform/native'
import {request,rawRequest,SourceHttpError} from '@/features/sources/transport'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn()}))
const account={id:'fixture',providerId:'dropbox' as const,name:'Fixture',baseUrl:'',authOrigins:[]},response={status:409,headers:{},body:Array.from(new TextEncoder().encode('{"error_summary":"path/conflict/file"}')),finalUrl:'https://content.dropboxapi.com/2/files/upload'}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(nativeCall).mockResolvedValue(response)})
it('keeps raw provider status and body available to original protocol-specific error handling',async()=>{expect(await rawRequest(account,'POST',response.finalUrl,'中文',{'Content-Type':'application/octet-stream'})).toEqual(response);expect(nativeCall).toHaveBeenCalledWith('http_request',{request:expect.objectContaining({accountId:account.id,providerId:'dropbox',method:'POST',body:Array.from(new TextEncoder().encode('中文'))})})})
it('preserves the normal request error behavior for existing drivers',async()=>{await expect(request(account,'POST',response.finalUrl)).rejects.toThrow('来源请求失败（409）')})

it.each([400,401,403,404,408,409,429,500])('preserves numeric HTTP %s independently of error message text',async status=>{
 vi.mocked(nativeCall).mockResolvedValue({...response,status})
 const failure=await request(account,'POST',response.finalUrl).catch(error=>error)
 expect(failure).toBeInstanceOf(SourceHttpError);expect(failure.status).toBe(status)
 expect(failure.message).toBe(status===401||status===403?'账号鉴权失败，请重新登录':`来源请求失败（${status}）`)
})
