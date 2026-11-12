import type { Identity } from '../trakt/client'
export function serverIdentity(row: Record<string, any>, plex: boolean): Pick<Identity,'tmdbId'|'imdbId'> {
 let tmdb = plex ? undefined : row.ProviderIds?.Tmdb ?? row.ProviderIds?.tmdb
 let imdb = plex ? undefined : row.ProviderIds?.Imdb ?? row.ProviderIds?.imdb
 if (plex) for (const value of [...(row.Guid || []).map((guid: any) => guid.id), row.guid].filter((value): value is string => typeof value === 'string')) {
  const movie = value.match(/^(?:tmdb|com\.plexapp\.agents\.themoviedb):\/\/(\d+)(?:[?/#]|$)/i)
  const external = value.match(/^(?:imdb|com\.plexapp\.agents\.imdb):\/\/(tt\d+)(?:[?/#]|$)/i)
  if (movie) tmdb = movie[1]; if (external) imdb = external[1]
 }
 const number = Number(tmdb)
 return { tmdbId: Number.isSafeInteger(number) && number > 0 ? number : undefined, imdbId: typeof imdb === 'string' && /^tt\d+$/.test(imdb) ? imdb : undefined }
}
