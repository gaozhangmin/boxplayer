import {TotalSize} from './electron/providers/aliDirectoryTotal'
export interface DirectorySizeNode {file_id:string;parent_file_id:string}
interface SizeData {
 DirMap:Map<string,DirectorySizeNode>;
 DirChildrenMap:Map<string,DirectorySizeNode[]>;
 DirFileSizeMap:Record<string,number>;
 DirFileSizeTimeMap:Record<string,number>;
 DirTotalSizeMap:Record<string,number>;
 persist?():void;
}
export const DriverData=new Map<string,SizeData>()
export function installAliSizeIndex(key:string,nodes:DirectorySizeNode[]){
 const map=new Map<string,DirectorySizeNode>([['root',{file_id:'root',parent_file_id:''}]])
 for(const node of nodes){if(!node.file_id||node.file_id==='root'||map.has(node.file_id)||!node.parent_file_id)throw Error('目录大小索引重复或标识无效');map.set(node.file_id,{...node})}
 for(const node of nodes){const seen=new Set<string>();let current=node.file_id;while(current!=='root'){if(seen.has(current)||seen.size>=512)throw Error('目录大小索引成环或层级过深');seen.add(current);const parent=map.get(current)?.parent_file_id;if(!parent||!map.has(parent))throw Error('目录大小索引父目录缺失');current=parent}}
 const children=new Map<string,DirectorySizeNode[]>()
 for(const node of nodes){const list=children.get(node.parent_file_id)||[];list.push(node);children.set(node.parent_file_id,list)}
 const before=DriverData.get(key),direct:Record<string,number>=Object.create(null),time:Record<string,number>=Object.create(null)
 for(const id of map.keys())if(before&&Number.isSafeInteger(before.DirFileSizeMap[id])&&before.DirFileSizeMap[id]!>=0){direct[id]=before.DirFileSizeMap[id]!;time[id]=before.DirFileSizeTimeMap[id]||0}
 const data:SizeData={DirMap:map,DirChildrenMap:children,DirFileSizeMap:direct,DirFileSizeTimeMap:time,DirTotalSizeMap:Object.create(null),persist:before?.persist}
 DriverData.set(key,data);_RefreshAllDirTotalSize(key);return data
}
export function _SaveDirSize(key:string){DriverData.get(key)?.persist?.()}
export function _RefreshAllDirTotalSize(key:string){
 const data=DriverData.get(key);if(!data)return
 const totals:Record<string,number>=Object.create(null)
 TotalSize('root',totals,data.DirFileSizeMap,data.DirChildrenMap)
 if(Object.values(totals).some(size=>!Number.isSafeInteger(size)||size<0))throw Error('目录大小合计超过可表示范围')
 data.DirTotalSizeMap=totals
}
