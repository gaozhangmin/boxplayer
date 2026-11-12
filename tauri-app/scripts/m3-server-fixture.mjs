// Local-only disposable Jellyfin/Emby protocol fixture. No real accounts or data.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const video=readFileSync(new URL('../../e2e/assets/mpv-sample.mp4',import.meta.url))
const token='boxplayer-m3-synthetic-token'
const reports=[],requests={video:0,subtitle:0,resolve:0,auth:0}
const items=['one','two'].map((Id,index)=>({Id,Name:`M3 Fixture Episode ${index+1}`,Type:'Episode',Size:video.length,UserData:{IsFavorite:false}}))
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
 const body=async()=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString()||'{}')}
 try{
  if(path==='/fixture-status'){json({requests,reports});return}
  if(path==='/Users/AuthenticateByName'){
   const value=await body();if(value.Username!=='fixture-user'||value.Pw!=='fixture-password'){json({error:'fixture_credentials_only'},401);return}
   requests.auth++;json({AccessToken:token,User:{Id:'fixture-user',Name:'M3 Synthetic'},ServerId:'fixture-server'});return
  }
  if(req.headers['x-emby-token']!==token){json({error:'fixture_auth_required'},401);return}
  if(path==='/Users/fixture-user/Views'){json({Items:[{Id:'fixture-library',Name:'M3 Fixture Library',Type:'CollectionFolder',IsFolder:true}],TotalRecordCount:1});return}
  if(path==='/Users/fixture-user/Items'){const rows=url.searchParams.has('SearchTerm')?items.filter(i=>i.Name.toLowerCase().includes(url.searchParams.get('SearchTerm').toLowerCase())):items;json({Items:rows,TotalRecordCount:rows.length});return}
  if(/^\/Items\/(one|two)\/PlaybackInfo$/.test(path)){
   await body();requests.resolve++;const id=path.split('/')[2];json({MediaSources:[{Id:`source-${id}`,SupportsDirectPlay:true,Bitrate:1000000,MediaStreams:[{Type:'Subtitle',IsExternal:true,Index:2,Codec:'srt',Language:'en',DisplayTitle:'M3 fixture subtitle',DeliveryUrl:`/subtitles/${id}.srt`}]}],PlaySessionId:`fixture-session-${id}`});return
  }
  if(/^\/subtitles\/(one|two)\.srt$/.test(path)){requests.subtitle++;res.writeHead(200,{'content-type':'application/x-subrip'});res.end('1\n00:00:00,000 --> 00:00:15,000\nM3 SYNTHETIC SUBTITLE\n');return}
  if(/^\/Videos\/(one|two)\/stream$/.test(path)||/^\/Items\/(one|two)\/Download$/.test(path)){
   requests.video++;const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),video.length-1):video.length-1;
   if(start>=video.length||end<start){res.writeHead(416,{'content-range':`bytes */${video.length}`});res.end();return}
   res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${video.length}`}:{})});res.end(req.method==='HEAD'?undefined:video.subarray(start,end+1));return
  }
  if(path.startsWith('/Sessions/Playing')){const value=await body();reports.push({event:path.split('/').at(-1),item:value.ItemId,position:value.PositionTicks,session:value.PlaySessionId});json({});return}
  if(path==='/Playback/BitrateTest'){const bytes=Buffer.alloc(5000000);res.writeHead(200,{'content-length':bytes.length});res.end(bytes);return}
  json({error:'fixture_endpoint_not_implemented'},404)
 }catch{json({error:'fixture_request_invalid'},400)}
})
server.listen(0,'127.0.0.1',()=>console.log(`M3 fixture listening at http://127.0.0.1:${server.address().port}`))
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)))
