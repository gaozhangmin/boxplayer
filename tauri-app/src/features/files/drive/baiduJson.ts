import {preserveCloud189LargeIds} from './electron/providers/cloud189Identity'
// Reuse Electron's existing token-aware integer preservation before JSON.parse.
// Already-decoded unsafe Numbers still fail baiduFileId; never guess their digits.
export const parseBaiduJson=(raw:string)=>JSON.parse(preserveCloud189LargeIds(raw))
