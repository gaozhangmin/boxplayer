import { beforeEach, expect, it, vi } from 'vitest'
import { putFavorite, readPreferences, writePreferences, routeKey } from '@/features/servers/preferences'
beforeEach(() => { const entries = new Map<string,string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key,value) }) })
it('persists independently per account; adding/removing category favorites never changes Home shelves', () => {
 const base = readPreferences('a'), route = { kind: 'category', category: 'movies', title: 'Movies' } as const
 const next = putFavorite(base, route, ' My films '); expect(next.home).toEqual(base.home); expect(next.favorites[0]?.title).toBe('My films')
 writePreferences('a', next); expect(readPreferences('b').favorites).toEqual([]); expect(readPreferences('a').favorites).toHaveLength(1)
 const renamed = putFavorite({ ...next, home: [] }, route, 'Renamed'); expect(renamed.favorites).toHaveLength(1); expect(renamed.home).toEqual([]); expect(renamed.favorites[0]?.route.title).toBe('Movies')
 expect(routeKey(route)).not.toBe(routeKey({ ...route, favoriteType: 'Movie' }))
})
it('retains hidden-on-Home cards for external Files consumers, handles corrupt storage and rejects blank names', () => {
 const base = readPreferences('a'); const next = putFavorite(base, { kind: 'children', id: 'show', title: 'Show' }, 'Show', true); next.favorites[0]!.hiddenOnHome = true; writePreferences('a', next)
 expect(readPreferences('a').favorites[0]).toMatchObject({ hiddenOnHome: true, content: true }); expect(readPreferences('x', { getItem: () => '{broken' })).toEqual(base)
 expect(() => putFavorite(base, { kind: 'category', title: '' }, ' ')).toThrow('名称')
})

it('persists bounded native raster covers and rejects oversized, SVG and external HTTP covers', async () => {
 const {isLocalCoverData,maxCoverBytes}=await import('@/features/servers/cover'),data='data:image/png;base64,iVBORw0KGgo='
 const preferences=putFavorite(readPreferences('a'),{kind:'category',category:'movies',title:'Movies'},'Movies');preferences.favorites[0]!.cover=data;writePreferences('a',preferences);expect(readPreferences('a').favorites[0]?.cover).toBe(data)
 for(const invalid of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,broken','https://example.test/image.png','Items/1/Images/Primary?api_key=secret','data:image/webp;base64,'+'A'.repeat(Math.ceil(maxCoverBytes/3)*4+4)]){expect(isLocalCoverData(invalid)).toBe(false);preferences.favorites[0]!.cover=invalid;expect(()=>writePreferences('a',preferences)).toThrow('封面')}
})
