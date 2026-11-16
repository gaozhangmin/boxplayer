import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
for (const file of ['boxplayer/src/layout/PageMusic.vue','boxplayer-tauri/tauri-app/src/features/media/electron/layout/PageMusic.vue']) {
 it(`${file}: missing local URL never resolves a cloud account`,async()=>{
  const source=readFileSync(new URL('../../../../'+file,import.meta.url),'utf8')
  const resolver=source.slice(source.indexOf('async function resolveUrl('),source.indexOf('async function loadIdx(')).replace('idx: number','idx')
  const cloud=vi.fn(()=>{throw Error('unexpected network routing')})
  const playlist={value:[] as any[]}
  const resolve=new Function('playlist','UserDAL','getRawUrl','t',resolver+';return resolveUrl')(playlist,{GetUserTokenFromDB:cloud,GetUserToken:cloud},cloud,(key:string)=>key)
  for(const identity of [{user_id:'local',drive_id:'local'},{user_id:'local',drive_id:''},{user_id:'',drive_id:'local'}]){
   playlist.value=[{...identity,file_id:'local-temp-song'}]
   await expect(resolve(0)).rejects.toThrow('music.getUrlFailed')
   playlist.value=[{...identity,local_url:'file:///Music/song.mp3'}]
   await expect(resolve(0)).resolves.toEqual({url:'file:///Music/song.mp3',headers:{}})
  }
  expect(cloud).not.toHaveBeenCalled()
 })
}
