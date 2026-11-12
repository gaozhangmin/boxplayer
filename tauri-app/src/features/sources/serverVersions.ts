const versions=new Map<string,string>()
export function getServerPlaybackSource(accountId:string,itemId:string){return versions.get(JSON.stringify([accountId,itemId]))||null}
export function setServerPlaybackSource(accountId:string,itemId:string,sourceId:string){const key=JSON.stringify([accountId,itemId]);if(sourceId)versions.set(key,sourceId);else versions.delete(key)}
