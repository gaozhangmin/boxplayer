import { describe, it, expect } from 'vitest'
import { parseDav } from '@/features/sources/webdav'
import type { Account } from '@/features/sources/contracts'
const account:Account={id:'a',providerId:'webdav',name:'dav',baseUrl:'https://example.test/dav/',authOrigins:['https://example.test']}
describe('WebDAV listing boundary',()=>{
 it('parses namespaced successful props and skips self/failed props',()=>{
  const xml=`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href></d:response><d:response><d:href>/dav/a%20b.mp4</d:href><d:propstat><d:prop><d:getcontentlength>42</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/no.mp4</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>`
  expect(parseDav(account,'',xml).entries[0]).toMatchObject({id:'https://example.test/dav/a%20b.mp4',name:'a b.mp4',size:42,isDirectory:false,playable:true,electronModel:{drive_id:'a',file_id:'https://example.test/dav/a%20b.mp4',icon:'iconfile_video'}})
 })
 it('rejects a cross-origin or escaped root href',()=>{
  for(const path of ['https://evil.test/dav/a.mp4','/outside/a.mp4'])expect(()=>parseDav(account,'',`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href></d:response></d:multistatus>`)).toThrow()
 })
})
