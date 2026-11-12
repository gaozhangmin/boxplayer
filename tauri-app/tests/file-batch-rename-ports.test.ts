import {describe,it,expect} from 'vitest'
import {safeRenamePreview,path} from '@/features/files/drive/batchRenamePorts'
describe('original batch preview native boundary',()=>{
 it('keeps original highlight tags while making filenames and replacement HTML inert',()=>{
  const html=safeRenamePreview('<i>Old</i><s>New</s><img src=x onerror=alert(1)>&#60;script>')
  expect(html).toBe('<i>Old</i><s>New</s>&lt;img src=x onerror=alert(1)&gt;&amp;#60;script&gt;')
  expect(safeRenamePreview('<i onclick="bad()">X</i>')).not.toContain('<i onclick')
 })
 it.each([['Movie.mkv','Movie'],['.hidden','.hidden'],['a.b.mkv','a.b'],['name.','name'],['..','..'],['dir/Movie.mkv/','Movie']])('retains original filename stem for %s',(value,name)=>{expect(path.parse(value).name).toBe(name)})
})
