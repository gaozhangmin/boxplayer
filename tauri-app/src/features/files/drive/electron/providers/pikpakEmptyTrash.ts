export async function clearOriginalPikpakTrash(user:string, listPage:(token:string)=>Promise<{items:{id:string}[];nextPageToken:string}>, deleteBatch:(ids:string[])=>Promise<string[]>) {
      let count = 0
      let pageToken = ''
      const trashIds: string[] = []
      do {
        const page = await listPage(pageToken)
        trashIds.push(...page.items.map(item => item.id).filter(Boolean))
        pageToken = page.nextPageToken
      } while (pageToken)
      for (let offset = 0; offset < trashIds.length; offset += 100) {
        const ids = trashIds.slice(offset, offset + 100)
        if (ids.length > 0) {
          const deleted = await deleteBatch(ids)
          if (deleted.length !== ids.length) throw new Error('部分 PikPak 回收站文件删除失败')
          count += deleted.length
        }
      }
      return count
    }
