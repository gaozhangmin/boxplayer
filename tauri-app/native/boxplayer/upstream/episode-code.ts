/**
 * The episode-identity contract between storage listings and workflow state:
 * a file is "visible" as an episode exactly when its FILE NAME alone exposes
 * an episode code. Path context (season folders) does not survive moves, so
 * anything the workflow lands in a canonical season directory must carry its
 * code in the name — see the rename step in staging normalization.
 */
export function episodeCodeFromFileName(name: string): string | null {
  // Episode allows up to 4 digits for 1000+ episode anime (One Piece/柯南/蜡笔小新);
  // \d{1,3} truncated "E1050" → "E105".
  const seasonEpisodeMatch = /[Ss](\d{1,2})[Ee](\d{1,4})/.exec(name);
  if (seasonEpisodeMatch?.[1] && seasonEpisodeMatch[2]) {
    return `S${seasonEpisodeMatch[1].padStart(2, "0")}E${seasonEpisodeMatch[2].padStart(2, "0")}`;
  }

  // Name-only heuristic: a bare "第N集" cannot reveal its season, so this
  // reading is only trustworthy for season 1. Files like these landing in
  // other seasons are exactly what the canonical rename step eliminates.
  const chineseEpisodeMatch = /第\s*(\d{1,4})\s*集/.exec(name);
  if (chineseEpisodeMatch?.[1]) {
    return `S01E${chineseEpisodeMatch[1].padStart(2, "0")}`;
  }

  return null;
}

export function canonicalEpisodeFileName(input: {
  title: string;
  episodeCode: string;
  sourceName: string;
}): string {
  const extensionMatch = /\.[A-Za-z0-9]+$/.exec(input.sourceName);
  const extension = extensionMatch?.[0] ?? "";
  return `${input.title}.${input.episodeCode}${extension}`;
}
