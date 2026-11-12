export const personalRatingsKey = 'MediaLibrary_PersonalRatings_v1'
export const serverRatingKey = (accountId: string, itemId: string) => `${accountId}:${itemId}`
export function readServerRatings(): Record<string,number> {
 const value = JSON.parse(localStorage.getItem(personalRatingsKey) || '{}')
 if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('无法读取本地个人评分')
 return Object.fromEntries(Object.entries(value).filter(([,rating]) => typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 10)) as Record<string,number>
}
export function saveServerRating(accountId: string, itemId: string, rating?: number) {
 if (!accountId || !itemId || rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 10)) throw new Error('个人评分无效')
 const values = readServerRatings(), key = serverRatingKey(accountId,itemId)
 if (rating === undefined) delete values[key]; else values[key] = rating
 localStorage.setItem(personalRatingsKey,JSON.stringify(values))
 window.dispatchEvent(new CustomEvent('boxplayer:personal-rating-changed',{detail:{accountId,itemId,rating}}))
}
