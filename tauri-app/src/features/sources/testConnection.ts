import {rawRequest} from './transport'
import type {Account} from './contracts'
/** Read-only probe using the draft credentials, before creating an account. */
export async function testHttpConnection(account:Account,headers:Record<string,string>,signal?:AbortSignal){
 const webdav=account.providerId==='webdav'
 const result=await rawRequest(account,webdav?'PROPFIND':'POST',webdav?account.baseUrl:account.baseUrl.replace(/\/$/,'')+'/api/fs/list',webdav?'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>':JSON.stringify({path:'/',page:1,per_page:1}),{...headers,...(webdav?{Depth:'0','Content-Type':'application/xml'}:{'Content-Type':'application/json'})},30000,signal)
 if(result.status===401||result.status===403)throw Error('用户名或密码不正确，或没有访问权限。请重试。')
 if(result.status<200||result.status>=300)throw Error('连接测试失败（HTTP '+result.status+'）')
 const body=new TextDecoder().decode(new Uint8Array(result.body))
 if(webdav){if(!/<(?:[\w.-]+:)?multistatus(?:\s|>)/i.test(body))throw Error('服务器未返回有效的 WebDAV 响应')}
 else{const data=JSON.parse(body);if(data.code!==200||!data.data||!Array.isArray(data.data.content))throw Error('无法读取 AList 根目录，请检查访问权限')}
 signal?.throwIfAborted()
}
