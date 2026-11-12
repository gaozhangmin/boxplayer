export function cloud139Id(value:unknown,root=false):string{
 if(root&&['','0','/','root','backup_root','cloud139_root'].includes(String(value)))return '/'
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw Error('139 文件标识超出安全范围')
 if(typeof value!=='string'&&typeof value!=='number')throw Error('139 文件标识无效')
 const id=String(value)
 if(!id||['/','0','root','backup_root','cloud139_root'].includes(id)||id.length>4096||/[\u0000-\u0020/\\]/.test(id))throw Error('139 文件标识无效')
 return id
}
