import {describe,it,expect} from 'vitest'
import {validateAliCrossDriveIdentity,type AliMoveNode} from '@/features/files/drive/aliCrossDriveIdentity'
const id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),old=(file:string)=>id('resource',file),next=(file:string)=>id('backup',file)
const node=(id:string,parent:string,isDirectory:boolean,name:string,size=0):AliMoveNode=>({id,parent,isDirectory,name,size})
function fixture(){const before=[node(old('folder'),old('root'),true,'Folder'),node(old('child'),old('folder'),true,'Child'),{...node(old('video'),old('child'),false,'movie.mkv',123),contentHash:'same-content'}],after=[node(next('new-folder'),next('target'),true,'Folder (1)'),node(next('new-child'),next('new-folder'),true,'Child'),{...node(next('new-video'),next('new-child'),false,'movie.mkv',123),contentHash:'same-content'}];return {before,after,pairs:before.map((row,index)=>({from:row.id,to:after[index]!.id}))}}
const validate=(value:ReturnType<typeof fixture>)=>validateAliCrossDriveIdentity(value.before,value.after,[old('folder')],next('target'),value.pairs)
describe('complete explicit cross-drive move identity contract',()=>{
 it('accepts verified new descendant IDs and a server-renamed root without deriving IDs',()=>{const value=fixture(),result=validate(value);expect(result.mapping.get(old('video'))).toBe(next('new-video'));expect(result.mapping.size).toBe(3);expect(value.before[0]!.name).toBe('Folder')})
 it('rejects a root-only receipt when descendant mappings are absent',()=>{const value=fixture();value.pairs=value.pairs.slice(0,1);expect(()=>validate(value)).toThrow('完整根或后代映射')})
 it('rejects duplicated target IDs',()=>{const value=fixture();value.pairs[2]!.to=value.pairs[1]!.to;expect(()=>validate(value)).toThrow('重复')})
 it('rejects a new child parent that is not the mapped old parent',()=>{const value=fixture();value.after[2]!.parent=next('target');expect(()=>validate(value)).toThrow('后代父目录')})
 it('rejects changed child names, sizes and hashes',()=>{for(const patch of [{name:'other.mkv'},{size:124},{contentHash:'different'}]){const value=fixture();Object.assign(value.after[2]!,patch);expect(()=>validate(value)).toThrow('目标身份')}})
 it('rejects an orphan source subtree even if every ID has a pair',()=>{const value=fixture();value.before[1]!.parent=old('missing');expect(()=>validate(value)).toThrow()})
 it('rejects a cyclic source subtree before reconciliation',()=>{const value=fixture();value.before[1]!.parent=old('video');value.before[2]!.parent=old('child');value.before[2]!.isDirectory=true;value.after[2]!.isDirectory=true;value.after[1]!.parent=next('new-video');expect(()=>validate(value)).toThrow('成环')})
 it('rejects destination-drive mismatch and changed file type',()=>{const value=fixture();value.after[2]!.isDirectory=true;expect(()=>validate(value)).toThrow('目标身份');const other=fixture();other.pairs[2]!.to=id('third','new-video');expect(()=>validate(other)).toThrow()})
 it('requires canonical source locations without extra or reordered fields',()=>{const value=fixture();value.before[0]!.id='{"fileId":"folder","driveId":"resource"}';expect(()=>validate(value)).toThrow('位置无效')})
})
