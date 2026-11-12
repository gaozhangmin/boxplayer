import {Database} from 'bun:sqlite'
import {SqliteWorkflowRepository} from './upstream/sqlite'

/** The original repository uses better-sqlite3's synchronous transaction API.
 * Bun's bundled SQLite supplies the same statements and transactions; only pragma
 * needs adapting. No Electron ABI addon, external database, or renderer SQL API. */
export function openWorkflowRepository(path:string):SqliteWorkflowRepository {
 const db=new Database(path,{create:true,strict:true})
 const compatible={
  pragma:(sql:string)=>db.exec(`PRAGMA ${sql}`),
  exec:(sql:string)=>db.exec(sql),
  prepare:(sql:string)=>db.prepare(sql),
  transaction:(body:()=>unknown)=>db.transaction(body),
  close:()=>db.close()
 }
 try{return new SqliteWorkflowRepository(compatible as unknown as ConstructorParameters<typeof SqliteWorkflowRepository>[0])}
 catch(error){db.close();throw error}
}
