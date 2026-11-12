import {seriesPreferences,generalPreferences} from './electron/seriesVersionPreferences'
export {seriesPreferences,generalPreferences} from './electron/seriesVersionPreferences'
export function setDisplayPreference(group:'series'|'general',key:string,value:string|boolean){const target=group==='series'?seriesPreferences:generalPreferences;if(!(key in target)||typeof value!==typeof(target as Record<string,unknown>)[key])throw new Error('显示设置无效');localStorage.setItem(group+'.'+key,JSON.stringify(value));window.dispatchEvent(new Event('boxplayer:'+group+'-preferences'))}
export function displayScopeAllows(scope:string|undefined,isMovie:boolean){return scope!=='none'&&(scope!=='movies'||isMovie)&&(scope!=='tv'||!isMovie)}
