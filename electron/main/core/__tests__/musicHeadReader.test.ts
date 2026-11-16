import {expect,it,vi} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const request=vi.hoisted(()=>vi.fn())
vi.mock('electron',()=>({net:{fetch:request},ipcMain:{handle:vi.fn()}}))
import {readMusicHead,readLocalMusicChunk} from '../../musicHeadReader'
it('rejects network metadata reads before making any HTTP request',async()=>{
  await expect(readMusicHead({url:'https://example.test/audio'})).rejects.toThrow('disabled')
  await expect(readLocalMusicChunk({url:'https://example.test/audio',offset:0,length:64})).rejects.toThrow('Local audio path required')
  expect(request).not.toHaveBeenCalled()
})
it('reads local tail chunks beyond 1 MiB and detects a changed file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'music-full-'))
  try{
    const path=join(directory,'song.wav');await writeFile(path,Buffer.concat([Buffer.alloc(2*1048576),Buffer.from('trailing-tags')]))
    const info=await readLocalMusicChunk({url:path})
    const result=await readLocalMusicChunk({url:path,offset:2*1048576,length:13,version:info.version})
    expect(Buffer.from(result.base64!,'base64').toString()).toBe('trailing-tags')
    await expect(readLocalMusicChunk({url:path,offset:0,length:65537})).rejects.toThrow('Invalid local audio range')
    await writeFile(path,Buffer.from('changed'))
    await expect(readLocalMusicChunk({url:path,offset:0,length:4,version:info.version})).rejects.toThrow('changed')
  }finally{await rm(directory,{recursive:true,force:true})}
})
