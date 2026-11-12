# Tauri video server workspace

Only the video workspace is implemented here. Source root edit/delete/reauthorize,
Files and global Home composition belong to their owning agents. Existing drivers,
serverMetadata, playlists, catalog, Trakt client and player UI are not modified.
ServerHomeSections.vue is owned by the main agent, not this implementation.

## Component interface

`ServerWorkspace.vue` props:

- `account: Account` (required): every request and native action binds this account.
- `initialRoute?: BrowseRoute`: default `{kind:'root',title:'媒体库'}`. Account/base
  URL/user/initialRoute changes reset navigation and invalidate pending reads.
- `searchQuery?: string`, `searchRevision?: number`: searches run within the account;
  changing revision resubmits identical text. A blank query backs out of search.
- `toolbarTarget?: string`: optional Vue Teleport selector; otherwise toolbar is inline.

Events:

- `title(string)`, `can-go-back(boolean)`, `go-back()` when internal history is empty.
- `navigate(BrowseRoute)` describes the visible route.
- `preferences-change(accountId, ServerPreferences)` after successful persistence.
- `account-updated(Account)` after native metadata save: host must replace account
  in its account store, so the workspace reads the new authorized base URL.
- `download-complete(itemId)` only when native download returns true (not cancellation).

Exposed methods: `goBack(): boolean`, `navigate(route)`, `refresh()`,
`openLibraryRoot()`, `openCategory(category,title?)`,
`playServerCategory(accountId,category,mode?)`, `favoriteSelectedLibraries()`,
`openFavorite(favorite)`, `getPreferences()`.

`BrowseRoute` is exported from `workspace.ts`. Route kinds are home/root/category/
children/detail/search/person. Use `id` for library/container/detail IDs, `libraryId`
for retained library scope, `category` for all/movies/shows/collections/playlists/
resume/nextup/latest/favorites. A category with `facet` and no `value` opens its index;
adding `value` opens the filtered child page. Facets: genre/studio/network/year/
certification/rating. `personId` opens server cast bibliography. Plex library IDs
are `section:<key>`, playlist IDs `playlist:<id>`. Titles are display text only.

Library cards enter library-scoped categories. Shows/seasons enter detail with
server synopsis, season/episode cards, cast and similar media. Raw external children
routes to shows/seasons are canonicalized to detail when their metadata is available.

## Shared components and preferences

`ServerRating.vue`: required `accountId: string`, `item: ServerItem`; emits `close()`
and `rated(rating?:number)`. Reads local `MediaLibrary_PersonalRatings_v1` using
`accountId:item.id`. Disconnected or disabled Trakt saves locally. Connected AND
sync enabled calls syncTrakt first; failure does not overwrite local score. Only
server ProviderIds/Plex Guid identities are used, never guessed from names/file IDs.
Empty value removes the score. ServerShare.vue requires only item and emits close;
it really copies name/year/overview even without a server file-share capability.

`readPreferences`, `writePreferences`, `preferenceKey`, `routeKey`, `putFavorite`
are exported from preferences.ts. Home shelf keys and Favorites are independent.
A hiddenOnHome favorite stays persisted for Files; portrait stays account-specific.
The legacy layout field is retained for schema compatibility but workspace layout
uses global `MediaLibrary_BrowseMode`, never the per-account layout value.

Workspace saves dispatch `boxplayer:server-home-changed`, detail=accountId, and
listen to the same event plus storage. Layout dispatches/listens to
`boxplayer:browse-mode-changed` (existing LibraryWorkspace event), also supports
`boxplayer:library-browse-mode-changed` with detail=grid/list and storage events.
`boxplayer:personal-rating-changed` carries {accountId,itemId,rating}.

## Implemented behavior and verification boundary

Jellyfin/Emby account-bound Views, item pages, Genres/Studios/Filters indexes,
Person favorites, detail, cast, bibliography, similar, favorite/watched mutations;
Plex section enumeration, section-scoped indexes and genre/studio key resolution,
video-section global merge, child/detail/person/playlist/continueWatching/onDeck.
Rating facet bins are computed from all paginated server metadata because there
is no provider rating-bin index. Networks map to server Studios, not TMDB networks.
Plex does not advertise Jellyfin-style favorite category queries.

All 19 Electron sort keys are exported. Unsupported Plex fields and random sort
load complete pagination before local ordering; missing values sort last. Fields
not returned by the server remain missing, never fabricated. Full local-order/
facet reads are bounded at 100 pages of 100 and fail explicitly if incomplete.
Playback traversal/queues are bounded at 1000 entries and detect repeated pages.
Playback delegates to catalog.playMany for true queue loop and shuffle; individual
episode playback continues through its remaining season, with whole-season rotation
for loop. Player UI is unchanged. Download delegates to native source_download;
backend cancellation/errors (including HLS) never produce completion events.

Root menu supports selection/title-sort/favorite-selected plus disabled password.
Category menus allow Favorites only, with rename/hide/cover/remove for saved cards;
Home is managed independently. Content favorite cards toggle server favorite.
Poster playlist action stays disabled per Electron baseline; explicit
“管理播放列表” implements listing, membership add/remove and creating a new list.
Playlist browsing and confirmed deletion are implemented. Media deletion respects
generalPreferences.fileManagement and requires confirmation. Refresh reloads server
metadata; no TMDB scanning is invoked. Cover selection offers real server posters
plus an optional credential-free relative image path. All images use account-bound
serverArtwork and revoke replaced/stale/unmounted Blob URLs. Styling uses primary
green, never orange.

Validation: focused happy-dom/Vitest tests use synthetic accounts and mocked
transport/native/Trakt APIs. They do not establish live Jellyfin/Emby/Plex version
compatibility, native download/playback behavior, visual parity or real-account
acceptance. No app launch/restart, root build, real credentials or live account calls.
