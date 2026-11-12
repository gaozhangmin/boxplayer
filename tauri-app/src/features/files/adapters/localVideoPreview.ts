import {localThumbnail} from '../thumbnails'
export interface LocalVideoPreview {thumbnail:string;duration:number;height:number}
export async function getLocalVideoPreview(path:string):Promise<LocalVideoPreview>{
 // The renderer receives an opaque source-relative reference, never filesystem access.
 try{const [sourceId,fileId]=JSON.parse(path) as [string,string];return {thumbnail:await localThumbnail(sourceId,fileId,()=>true)||'',duration:0,height:0}}catch{return {thumbnail:'',duration:0,height:0}}
}

export function previewFileName(path:string){try{return (JSON.parse(path) as [string,string])[1]}catch{return path}}
