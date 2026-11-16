import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const here = new URL('./',import.meta.url)
const workspace = new URL('../../../',here)
const targets = ['boxplayer/src/module/music-head/', 'boxplayer-tauri/tauri-app/src/features/music/shared/', 'boxplayer-tauri/tauri-app/src/features/media/electron/module/music-head/', 'BoxPlayer_Android/app/src/main/assets/music-head/', 'XbyVideoHub/Shared/Resources/MusicHead/']
const bundle=await readFile(new URL('dist/music-head.js',here))
const manifest=await readFile(new URL('dist/manifest.json',here))
const client=await readFile(new URL('client.ts',here))
const notice=await readFile(new URL('dist/THIRD-PARTY-NOTICES.txt',here))
for(const target of targets){
  const dir=new URL(target,workspace)
  if(process.argv.includes('--check')) {
    for(const [name,bytes] of [['music-head.js',bundle],['manifest.json',manifest],['THIRD-PARTY-NOTICES.txt',notice], ...(target.includes('/src/') && !target.includes('Android') ? [['client.ts',client]] : [])]){
      const local=await readFile(new URL(name,dir))
      if(!local.equals(bytes))throw new Error(`Shared music core drift: ${target}${name}`)
    }
  }else{
    await mkdir(dir,{recursive:true})
    await writeFile(new URL('music-head.js',dir),bundle)
    await writeFile(new URL('manifest.json',dir),manifest)
    if(target.includes('/src/') && !target.includes('Android')) await writeFile(new URL('client.ts',dir),client)
    await writeFile(new URL('THIRD-PARTY-NOTICES.txt',dir),notice)
  }
}
console.log(`Shared local parser identical across ${targets.length} parser copies: ${createHash('sha256').update(bundle).digest('hex')}`)
