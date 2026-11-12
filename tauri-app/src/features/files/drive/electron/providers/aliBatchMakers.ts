import {ApiBatch} from '../../aliBatchTransport'
export function ApiBatchMaker2(url: string, idList: string[], namelist: string[], bodymake: (file_id: string, name: string) => any): string[] {
  if (!idList || idList.length == 0) return []
  const batchList: string[] = []
  const batchSet = new Set()
  for (let i = 0, maxi = idList.length; i < maxi; i++) {
    const id = idList[i]!
    if (batchSet.has(id)) continue
    batchSet.add(id)
    batchList.push(JSON.stringify({
      body: bodymake(id, namelist[i]!),
      headers: { 'Content-Type': 'application/json' },
      id: id,
      method: 'POST',
      url
    }))
  }
  batchSet.clear()
  return batchList
}

export function ApiBatchMaker(url: string, idList: string[], bodymake: (file_id: string) => any): string[] {
  if (!idList || idList.length == 0) return []
  const batchList: string[] = []
  const batchSet = new Set()
  for (let i = 0, maxi = idList.length; i < maxi; i++) {
    const id = idList[i]!
    if (batchSet.has(id)) continue
    batchSet.add(id)
    batchList.push(JSON.stringify({
      body: bodymake(id),
      headers: { 'Content-Type': 'application/json' },
      id: id,
      method: 'POST',
      url
    }))
  }
  batchSet.clear()
  return batchList
}

export async function ApiBatchSuccess(title: string, batchList: string[], user_id: string, share_token: string): Promise<string[]> {
  if (batchList.length == 0) return Promise.resolve(batchList)
  const successList: string[] = []
  const result = await ApiBatch(title, batchList, user_id, share_token)
  result.reslut.map((t) => successList.push(t.id))
  return successList
}
