// Source-audit normalization only. Archived upstream names stay in source
// snapshots; compiled application code uses BoxPlayer throughout.
export function boxPlayerBranding(text){
 return text.replace(/mediary[-_ ]?scou(?:n)?t/gi,'boxplayer')
  .replaceAll('Mediary','BoxPlayer').replaceAll('MEDIARY','BOXPLAYER').replaceAll('mediary','boxplayer')
  .replace(/\bscou(?:n)?t\b/gi,'BoxPlayer')
  .replaceAll('MEDIA_TRACK','BOXPLAYER').replaceAll('media-track','boxplayer').replaceAll('media_track','boxplayer').replaceAll('MediaTrack','BoxPlayer')
}
