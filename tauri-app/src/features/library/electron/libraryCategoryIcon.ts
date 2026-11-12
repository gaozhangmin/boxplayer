import { BookOpen, CalendarDays, CalendarRange, Clapperboard, EyeOff, Film, Folder, Grid2X2, History, Images, Library, ListVideo, Music, Play, Sparkles, SquarePlay, Star, Tv, TvMinimal } from 'lucide-vue-next'

export function libraryCategoryIcon(route: string) {
  const [root, category = ''] = route.split('/')
  if (root === 'library') return Library
  if (root === 'playlist') return ListVideo
  if (root === 'series') return Clapperboard
  if (root === 'daily') return Sparkles
  if (root === 'recent' || category === 'recent') return History
  if (root === 'unwatched' || category === 'unwatched') return EyeOff
  if (root === 'music') return Music
  if (root === 'books') return BookOpen
  if (root === 'other') return Play
  if (category === 'genres') return root === 'tv' ? Tv : Clapperboard
  if (category === 'ratings') return Star
  if (category === 'years' || category === 'certification') return CalendarDays
  if (category === 'resolution' || category === 'networks') return Grid2X2
  if (category === 'mini') return TvMinimal
  if (category === 'concerts') return Music
  if (category === 'shorts') return Play
  if (root === 'movies') return category === 'all' ? Film : Clapperboard
  if (root === 'tv') return Tv
  return Folder
}

export function librarySidebarCategoryIcon(route: string) {
  switch (route) {
    case 'daily': return CalendarRange
    case 'movies/all': case 'movies/shorts': return Film
    case 'tv/all': case 'tv/mini': return TvMinimal
    case 'series': case 'other': return SquarePlay
    case 'movies/genres': return Images
    case 'movies/certification': return Folder
    default: return libraryCategoryIcon(route)
  }
}
