import {isNative} from '@/platform/native'
/** Public images go through native bounded disk cache. Account-bearing images
 * continue using their existing native account-bound Blob adapter. */
export function cachedArtwork(url:string|undefined):string|undefined{
 if(!url||!isNative())return url
 try{const parsed=new URL(url);if(parsed.origin!=='https://api.xbyvideohub.com'||!parsed.pathname.startsWith('/api/tmdb/image/')||parsed.search||parsed.hash||parsed.username||parsed.password)return url
 const scheme=/Windows|Android/.test(navigator.userAgent)?'http://mscache.localhost':'mscache://localhost'
 return scheme+'/image?url='+encodeURIComponent(url)
 }catch{return url}
}

export function originalArtwork(url:string|undefined):string|undefined{
 if(!url)return url
 try{const parsed=new URL(url);if(parsed.protocol==='mscache:'||parsed.hostname==='mscache.localhost')return parsed.searchParams.get('url')||undefined}catch{}
 return url
}
