export type PlaylistEntry = {
    coreEntryId?: string;
    path: string;
    title?: string;
    iconUrl?: string;
    addedAt: number;
};

export type Playlist = {
    id: string;
    coreRevision?: number;
    name: string;
    entries: PlaylistEntry[];
    createdAt: number;
};

export const FAVORITES_PLAYLIST_ID = "favorites";
export const LEGACY_FAVOURITE_PLAYLIST_ID = "favourite";
export const FAVORITES_PLAYLIST_NAME = "Favorites";

export type PlaylistLoopMode = "list" | "shuffle";

export type PlaylistSortMode = "name" | "added";

export type PlaylistScrollState = {
    list: number;
    playlists: Record<string, number>;
};
