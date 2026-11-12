/** Keep original templates while handling their legacy inline fallback under CSP. */
export function installDriveImageErrors(root:HTMLElement,isActive:()=>boolean){
 const document=root.ownerDocument
 const adopted=new WeakSet<HTMLImageElement>(),display=new WeakMap<HTMLImageElement,string>()
 const handle=(event:Event)=>{
  const image=event.target
  if(!(image instanceof HTMLImageElement)||!isActive()||!root.isConnected)return
  if(!root.contains(image)&&!image.closest('.popimg .preimg'))return
  // Only the unchanged Electron popup's missing imgerror.png fallback is bridged.
  const preview=image.closest('.folderPreviewPanel')&&root.contains(image)&&image.getAttribute('onerror')==="this.style.display='none'"
  if(!adopted.has(image)&&!preview&&image.getAttribute('onerror')!=="javascript:this.src='imgerror.png';")return
  adopted.add(image)
  image.removeAttribute('onerror')
  if(!display.has(image))display.set(image,image.style.display)
  image.style.display='none'
 }
 const loaded=(event:Event)=>{const image=event.target;if(image instanceof HTMLImageElement&&display.has(image)&&isActive()&&root.isConnected){image.style.display=display.get(image)!;display.delete(image)}}
 document.addEventListener('error',handle,true)
 document.addEventListener('load',loaded,true)
 return ()=>{document.removeEventListener('error',handle,true);document.removeEventListener('load',loaded,true)}
}
