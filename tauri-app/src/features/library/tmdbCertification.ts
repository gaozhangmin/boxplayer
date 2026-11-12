// Content certification is not the numeric community score.
export function tmdbCertification(data: any, tv: boolean): string | undefined {
  const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const direct = clean(data?.certification) || clean(data?.officialRating) || (tv ? clean(data?.rating) : '')
  if (direct) return direct
  const entries = tv ? data?.content_ratings?.results ?? data?.contentRatings?.results ?? []
    : data?.release_dates?.results ?? data?.releases?.results ?? data?.releases?.countries ?? []
  const ratings = entries.flatMap((entry: any) => tv
    ? [{ country: entry.iso_3166_1, value: clean(entry.rating) }]
    : (entry.release_dates ?? entry.releaseDates ?? [entry]).map((release: any) => ({ country: entry.iso_3166_1, value: clean(release.certification) })))
    .filter((entry: any) => entry.value)
  return (ratings.find((entry: any) => entry.country === 'US') ?? ratings[0])?.value
}
