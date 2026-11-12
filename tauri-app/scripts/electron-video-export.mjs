/** Read-only transition exporter. Call with an IndexedDB *copy* opened by the
 * caller, never an account database export. Only imedia_item is read. Explicit
 * source bindings are required because Electron and Tauri account IDs differ. */
export async function readVideoTable(database){
 if(!database.objectStoreNames.contains('imedia_item'))throw Error('Missing Electron media table')
 return new Promise((resolve,reject)=>{const transaction=database.transaction(['imedia_item'],'readonly');const request=transaction.objectStore('imedia_item').getAll();request.onerror=()=>reject(Error('Cannot read media export copy'));transaction.onabort=()=>reject(Error('Media export transaction aborted'));transaction.oncomplete=()=>resolve(request.result)})
}
export function canonicalJSON(value){if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonicalJSON(value[key])).join(',')+'}';return JSON.stringify(value)}
export async function exportVideoLibrary({items,bindings,sources=[],playlists={},series={},positions=[],sourceVersion,flags={},preferences={}}){
 if(!sourceVersion||!Array.isArray(items)||items.length>100000)throw Error('Invalid export snapshot')
 const output=[],aliases=new Map()
 for(const item of items){
  const versions=item.type==='tv'?(item.seasons||[]).flatMap(season=>(season.episodes||[]).flatMap(episode=>(episode.driveFiles||[]).map(file=>({file,season:season.seasonNumber,episode:episode.episodeNumber})))):(item.driveFiles||[]).map(file=>({file}))
  for(const {file,season,episode}of versions){
   const source=bindings[JSON.stringify([file.userId||file.driveServerId,file.driveId])]
   if(!source?.sourceId)throw Error('Each exported file must have an explicit target source binding')
   let fileId=source.local?file.path:file.id
   if(source.local){const root=sources.find(entry=>entry.id===source.sourceId)?.path;if(!root)throw Error('Local binding requires a source directory');const prefix=root.replace(/\\/g,'/').replace(/[\\/]+$/, '')+'/';const normalized=String(fileId||'').replace(/\\/g,'/');fileId=normalized.startsWith(prefix)?normalized.slice(prefix.length):normalized;if(/^(?:[A-Za-z]:|\/)/.test(fileId)||fileId.split('/').some(part=>part==='..'||part==='.'||!part))throw Error('Local file path must stay inside its exported source directory')}
   if(!fileId)throw Error('Exported file has no stable identity')
   const id=JSON.stringify([source.sourceId,file.id]),user=flags[item.id]||{}
   if(!aliases.has(item.id))aliases.set(item.id,[]);aliases.get(item.id).push(id)
   const progress=Number(item.watchProgress||0)*100
   const originalMetadata=JSON.parse(JSON.stringify(item));delete originalMetadata.driveFiles
   // Per-file projection contains metadata only, never provider request headers,
   // account tokens, arbitrary localStorage, or signed download URLs.
   const row={id,sourceId:source.sourceId,fileId,fileName:file.name,name:item.name,type:item.type,local:!!source.local,addedAt:new Date(item.addedAt).toISOString(),genres:item.genres||[],size:Number(file.fileSize||0),...(Number(file.videoDuration)>0?{duration:Number(file.videoDuration)}:{}),progress:Math.max(0,Math.min(100,progress)),originalMetadata}
   for(const key of ['year','releaseDate','rating','certification','overview','tmdbId','collectionId','collectionName','metadataSource'])if(item[key]!==undefined)row[key]=item[key]
   if(season!==undefined){row.seasonNumber=season;row.episodeNumber=episode}
   if(item.lastWatched)row.lastWatched=new Date(item.lastWatched).toISOString()
   if(item.posterUrl?.startsWith('https://api.xbyvideohub.com/api/tmdb/image/'))row.poster=item.posterUrl
   if(item.backdropUrl?.startsWith('https://api.xbyvideohub.com/api/tmdb/image/'))row.backdrop=item.backdropUrl
   for(const key of ['favorite','watched','personalRating','continueHidden','continueAdded'])if(user[key]!==undefined)row[key]=user[key]
   // Remove file links embedded in seasons/collections: full metadata is retained
   // but account credentials/thumbnail signed URLs are not portable data.
   row.originalMetadata=sanitizeMetadata(originalMetadata)
   const previous=output.find(value=>value.id===id);if(!previous)output.push(row)
  }
 }
 const groups=input=>Object.fromEntries(Object.entries(input).map(([name,ids])=>[name,[...new Set(ids.flatMap(id=>{const mapped=aliases.get(id);if(!mapped)throw Error('Collection references an unexported media item');return mapped}))]]))
 const payload={sources,positions,preferences,catalog:{schemaVersion:1,revision:0,items:output,playlists:groups(playlists),series:groups(series)}}
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(payload))))).map(byte=>byte.toString(16).padStart(2,'0')).join('')
 return{schemaVersion:2,sourceVersion,tables:{sources:sources.length,positions:positions.length,media:output.length,playlists:Object.keys(playlists).length,series:Object.keys(series).length,preferences:Object.keys(preferences).length},sha256,payload}
}
function sanitizeMetadata(value){
 if(Array.isArray(value))return value.map(sanitizeMetadata)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['driveFiles','cloudItem','posterFile','backdropFile','subtitleFiles','thumbnailLink'].includes(key)&&!/(?:token|cookie|authorization|headers|secret|password)/i.test(key)).map(([key,value])=>[key,sanitizeMetadata(value)]))
 if(typeof value==='string'&&/^https?:/.test(value)&&(/[?&](?:token|access_token|sign|api_key|x-plex-token)=/i.test(value)||!/^(https:\/\/api\.xbyvideohub\.com\/api\/tmdb\/image\/)/.test(value)))return undefined
 return value
}
