// Original music player sends current/next text; PageLyric also accepts full timelines.
export function normalizeLyricPayload(input:any){const data=input&&typeof input==='object'?input:{};return{...data,lines:Array.isArray(data.lines)?data.lines:[{time:0,text:String(data.text||data.title||'暂无歌词')},{time:1,text:String(data.next||'')}],activeIndex:data.activeIndex??0,isPlaying:data.isPlaying??!!data.playing,isLocked:data.isLocked??!!data.locked}}
const number=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback
const color=(value:unknown,fallback:string)=>typeof value==='string'&&/^#[\da-f]{3,8}$/i.test(value)?value:fallback
/** Adapt the original player's rich desktop-lyric payload to the reused lyric view. */
export function lyricAppearance(data:Record<string,unknown>){
 return {
  fontSize:number(data.fontSize,28,12,96),opacity:number(data.opacity,.85,.15,1),
  fontFamily:typeof data.fontFamily==='string'?data.fontFamily.slice(0,128):'system-ui',
  fontWeight:number(data.fontWeight,700,100,1000),letterSpacing:number(data.letterSpacing,0,-2,20),
  lineHeight:number(data.lineHeight,1.4,1,3),scale:number(data.lyricScale,1,.5,3),y:number(data.y,.5,0,1),
  backgroundOpacity:number(data.backgroundOpacity,0,0,1),shake:number(data.shake,0,0,1),
  primaryColor:color(data.primaryColor,'#ffffff'),secondaryColor:color(data.secondaryColor,'#aaaaaa'),
  highlightFollow:data.highlightFollow!==false,
 }
}

export function flowingAppearance(data: Record<string, unknown>) {
 const value = data.flowingColors && typeof data.flowingColors === 'object' ? data.flowingColors as Record<string, unknown> : {}
 const valid = (input: unknown, fallback: string) => typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback
 return { presentation: data.presentation === 'flowing' ? 'flowing' : 'standard', colors: {
  text: valid(value.text, '#D6ADFF'), light: valid(value.light, '#9850FF'), background: valid(value.background, '#090310')
 } }
}
