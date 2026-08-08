import { aliRefreshToken } from './aliyunHttp.mjs'
import { aliListAll, aliListDir, aliWalk, aliRenameBatch, aliSearch, aliGetFile, aliMove, aliMkdir, aliTrash, aliUploadFile, aliDownloadFile } from './aliyunFiles.mjs'

export function createAliyunProvider() {
  return {
    id: 'aliyun',
    displayName: 'Aliyun Drive',
    capabilities: {
      batchRename: true,
      recursiveWalk: true,
      serverSideSearch: true,
      trash: true,
      permanentDelete: false,
      share: true,
      pathAddressable: false,
      fileIdAddressable: true,
      mkdir: true,
      move: true,
      uploadFile: true,
      downloadFile: true,
    },

    auth: {
      async login() {
        const err = new Error(
          'Interactive login is not supported in clouddrive-cli. ' +
          'Import a token via auth import-electron or set the token directly in ~/.clouddrive-cli/tokens.json.'
        )
        err.code = 'ERR_PROVIDER_OPERATION_UNIMPLEMENTED'
        throw err
      },

      refresh: aliRefreshToken,

      async listAccounts() {
        return []
      },
    },

    files: {
      async list({ token, driveId, parentFileId = 'root' }) {
        return aliListAll(token, driveId, parentFileId)
      },

      async listPage({ token, driveId, parentFileId = 'root', cursor = '', limit = 100 }) {
        const page = await aliListDir(token, driveId, parentFileId, cursor, limit)
        return { items: page.items, nextCursor: page.nextMarker }
      },

      async *walk({ token, driveId, parentFileId = 'root', maxDepth = 10 }) {
        yield* aliWalk(token, driveId, parentFileId, maxDepth)
      },

      async get({ token, driveId, fileId }) {
        return aliGetFile(token, driveId, fileId)
      },

      async rename({ token, driveId, fileId, newName }) {
        const results = await aliRenameBatch(token, driveId, [{ fileId, newName }])
        return results[0]
      },

      async renameBatch({ token, driveId, renames }) {
        return aliRenameBatch(token, driveId, renames)
      },

      async search({ token, driveId, query, limit }) {
        return aliSearch(token, driveId, query, { limit })
      },

      async moveBatch({ token, driveId, moves }) {
        return aliMove(token, driveId, moves)
      },

      async mkdir({ token, driveId, parentId, name }) {
        return aliMkdir(token, driveId, parentId, name)
      },

      async trash({ token, driveId, items }) {
        return aliTrash(token, driveId, items.map((i) => i.fileId))
      },

      async uploadFile({ token, driveId, parentId, localPath, name, size, conflict }) {
        return aliUploadFile(token, driveId, { parentId, localPath, name, size, conflict })
      },

      async downloadFile({ token, driveId, fileId, outputPath }) {
        return aliDownloadFile(token, driveId, { fileId, outputPath })
      },
    },
  }
}
