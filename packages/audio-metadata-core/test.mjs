import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const script = await readFile(new URL('./dist/music-head.js', import.meta.url), 'utf8')
function core() {
  // Native-style environment: no network, Node Buffer, filesystem, streams,
  // native TextDecoder/Encoder or document. The bundle must be self-contained.
  const context = vm.createContext({ console })
  try { vm.runInContext(script, context, { timeout: 3000 }) } catch (error) { throw new Error(error.message) }
  return context.BoxPlayerMusicHead
}
function id3(title) {
  const value = Buffer.concat([Buffer.from([3]), Buffer.from(title)])
  const frame = Buffer.alloc(10); frame.write('TIT2'); frame.writeUInt32BE(value.length, 4)
  const payload = Buffer.concat([frame, value]); const head = Buffer.from([73,68,51,3,0,0,0,0,0,payload.length])
  return Buffer.concat([head, payload])
}
test('same local bundle reads leading ID3 in a native-style VM', async () => {
  const result = await core().parseBase64(id3('晴天').toString('base64'))
  assert.equal(result.tags.title, '晴天'); assert.equal(result.status, 'parsed')
})
test('never consumes trailing ID3v1, including a small complete file', async () => {
  const tail=Buffer.alloc(128); tail.write('TAGwrong title')
  const result=await core().parseBase64(Buffer.concat([Buffer.alloc(30), tail]).toString('base64'))
  assert.equal(result.tags.title, undefined)
  const leading=await core().parseBase64(Buffer.concat([id3('head wins'),tail]).toString('base64'))
  assert.equal(leading.tags.title,'head wins')
})
test('rejects input above the fixed byte budget', async () => {
  await assert.rejects(core().parseBase64(Buffer.alloc(1048577).toString('base64')), /budget/)
})
test('does not follow a trailing MP4 moov past mdat', async () => {
  const ftyp=Buffer.from([0,0,0,16,102,116,121,112,77,52,65,32,0,0,0,0])
  const mdat=Buffer.from([0,0,0,8,109,100,97,116])
  const result=await core().parseBase64(Buffer.concat([ftyp,mdat,id3('tail')]).toString('base64'))
  assert.equal(result.tags.title,undefined)
})
test('reports a truncated leading tag rather than claiming a complete empty parse', async () => {
  const data=id3('Long title').subarray(0,16)
  assert.equal((await core().parseBase64(data.toString('base64'))).status,'truncated')
})
test('normalizes leading FLAC multi-artist and identity tags', async () => {
  const comments=['TITLE=Local Song','ARTIST=Artist A','ARTIST=Artist B','ALBUM=Local Album','ALBUMARTIST=Various','TRACKNUMBER=2','DISCNUMBER=1','DATE=2026-11-13','ISRC=USAAA2600001','MUSICBRAINZ_TRACKID=recording-123','MUSICBRAINZ_ALBUMID=release-123','REPLAYGAIN_TRACK_GAIN=-4.5 dB']
  const number=(n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
  const data=Buffer.concat([number(4),Buffer.from('test'),number(comments.length),...comments.flatMap(value=>[number(Buffer.byteLength(value)),Buffer.from(value)])])
  const block=Buffer.alloc(4);block[0]=0x84;block.writeUIntBE(data.length,1,3)
  const stream=Buffer.concat([Buffer.from('fLaC'),Buffer.from([0,0,0,34]),Buffer.alloc(34),block,data,Buffer.from('TAGmust not parse')])
  const result=await core().parseBase64(stream.toString('base64'))
  assert.equal(result.tags.title,'Local Song'); assert.deepEqual(Array.from(result.tags.artists),['Artist A','Artist B'])
  assert.equal(result.tags.trackNumber,2); assert.equal(result.tags.discNumber,1)
  assert.equal(result.tags.musicBrainzRecordingID,'recording-123'); assert.equal(result.tags.musicBrainzReleaseID,'release-123')
  assert.equal(result.tags.replayGainTrack,-4.5)
})

test('reads WMA content descriptions only from the leading ASF header', async () => {
  const title = Buffer.from('Local WMA', 'utf16le'), artist = Buffer.from('Local Artist', 'utf16le')
  const lengths = Buffer.alloc(10); lengths.writeUInt16LE(title.length); lengths.writeUInt16LE(artist.length, 2)
  const content = Buffer.concat([lengths, title, artist])
  const object = Buffer.alloc(24); Buffer.from('3326b2758e66cf11a6d900aa0062ce6c','hex').copy(object); object.writeBigUInt64LE(BigInt(24+content.length),16)
  const header=Buffer.alloc(30); Buffer.from('3026b2758e66cf11a6d900aa0062ce6c','hex').copy(header); header.writeBigUInt64LE(BigInt(30+object.length+content.length),16); header.writeUInt32LE(1,24)
  const result=await core().parseBase64(Buffer.concat([header,object,content,Buffer.from('audio and trailing tags')]).toString('base64'))
  assert.equal(result.tags.title,'Local WMA'); assert.equal(result.tags.artists[0],'Local Artist')
})

function wavWithTrailingInfo(title, audioSize = 2 * 1024 * 1024) {
  const fmt=Buffer.alloc(24);fmt.write('fmt ');fmt.writeUInt32LE(16,4);fmt.writeUInt16LE(1,8);fmt.writeUInt16LE(1,10);fmt.writeUInt32LE(8000,12);fmt.writeUInt32LE(16000,16);fmt.writeUInt16LE(2,20);fmt.writeUInt16LE(16,22)
  const pcm=Buffer.alloc(8+audioSize);pcm.write('data');pcm.writeUInt32LE(audioSize,4)
  const text=Buffer.from(title+'\0');const tag=Buffer.alloc(8+text.length+(text.length%2));tag.write('INAM');tag.writeUInt32LE(text.length,4);text.copy(tag,8)
  const list=Buffer.alloc(12+tag.length);list.write('LIST');list.writeUInt32LE(4+tag.length,4);list.write('INFO',8);tag.copy(list,12)
  const file=Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'),fmt,pcm,list]);file.writeUInt32LE(file.length-8,4);return file
}
test('local random access reads post-audio tags beyond 1 MiB without materializing PCM', async () => {
  const file=wavWithTrailingInfo('Trailing local title');let read=0;let tail=false
  const result=await core().parseLocalFile(file.length,'local.wav',(position,length)=>{
    assert.ok(length<=65536);read+=length;tail ||= position>1048576;return file.subarray(position,position+length)
  })
  assert.equal(result.tags.title,'Trailing local title');assert.equal(result.status,'parsed');assert.ok(tail)
  assert.ok(read<file.length/2);assert.ok(result.tags.durationSec>0)
  const prefix=await core().parseBase64(file.subarray(0,1048576).toString('base64'))
  assert.equal(prefix.tags.title,undefined)
})
test('local native reader supports the same full parser and propagates read failure', async () => {
  const file=wavWithTrailingInfo('Native tail',16000)
  const result=await new Promise(resolve=>core().parseLocalNative(file.length,'local.wav',(offset,length)=>file.subarray(offset,offset+length).toString('base64'),json=>resolve(JSON.parse(json))))
  assert.equal(result.tags.title,'Native tail')
  await assert.rejects(core().parseLocalFile(file.length,'local.wav',()=>{throw new Error('Local permission lost')}),/permission lost/)
})
