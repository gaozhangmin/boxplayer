import { expect, it } from 'vitest'
import { validatedEndpoint, reorderCard } from '@/features/files/sourcePresentation'
const account={id:'a',providerId:'webdav' as const,name:'Share',baseUrl:'https://files.example/dav',authOrigins:['https://files.example','https://backup.example:8443']}
it('accepts paths and previously authorized exact origins without extending authorization',()=>{
 expect(validatedEndpoint(account,'https://files.example/another/')).toBe('https://files.example/another')
 expect(validatedEndpoint(account,'https://backup.example:8443/dav')).toBe('https://backup.example:8443/dav')
 expect(account.authOrigins).toHaveLength(2)
 for(const address of ['https://files.example:8443/dav','http://files.example/dav','https://files.example.evil/dav','https://user:pass@files.example/dav','https://files.example/dav?token=x','https://files.example/dav#x','file:///tmp/a'])expect(()=>validatedEndpoint(account,address)).toThrow()
})
it('moves cards in both directions without accepting unknown drop identities or mutating input',()=>{
 const ids=['a','b','c'];expect(reorderCard(ids,'a','c')).toEqual(['b','c','a']);expect(reorderCard(ids,'c','a')).toEqual(['c','a','b']);expect(reorderCard(ids,'x','b')).toEqual(ids);expect(ids).toEqual(['a','b','c'])
})
