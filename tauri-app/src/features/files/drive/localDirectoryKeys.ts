/** View-state keys isolate physical local paths from Electron virtual-directory
 * and navigation tokens. Native IO and bookmarks continue using actual paths. */
export const localDirectoryKey=(path:string)=>'local-dir:'+encodeURIComponent(path)+':'
export const localDirectoryPath=(key:string)=>key.startsWith('local-dir:')&&key.endsWith(':')?decodeURIComponent(key.slice(10,-1)):undefined
