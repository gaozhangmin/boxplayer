import {useSettingStore} from '@/features/files/drive/ports'
export function GetShareUrlFormate(share_name: string, share_url: string, share_pwd: string): string {
  let Formate = useSettingStore().uiShareFormate.replaceAll('\\n', '\n')
  const s1 = Formate.indexOf('URL')
  if (!share_pwd) {
    const s2 = Formate.indexOf('PWD')
    if (s1 >= 0 && s2 > s1) Formate = Formate.substring(0, s1 + 3) + Formate.substring(s2 + 3)
  }
  const url = Formate.replace('URL', share_url).replace('PWD', share_pwd).replace('NAME', share_name)
  if (url && s1 >= 0) return url
  return share_name + ' ' + share_url + (share_pwd ? ' 提取码：' + share_pwd : '')
}
