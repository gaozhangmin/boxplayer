<script setup lang='ts'>
import message from '../utils/message'
import UserDAL, { UserTokenMap } from '../user/userdal'
import { ITokenInfo, useSettingStore, useUserStore } from '../store'
import { copyToClipboard, openExternal } from '../utils/electronhelper'
import Db from '../utils/db'
import fs from 'node:fs'
import path from 'path'
import { decodeName, encodeName } from '../module/flow-enc/utils'
import { localPwd } from '../utils/aria2c'
import { t } from '../i18n'

const settingStore = useSettingStore()

const cb = (val: any) => {
  settingStore.updateStore(val)
}

const openWebUrl = (type: string) => {
  switch (type) {
    case 'developer':
      openExternal('https://www.aliyundrive.com/developer')
      break
    case 'pkce':
      openExternal('https://www.yuque.com/aliyundrive/zpfszx/eam8ls1lmawwwksv')
      break
    case 'AList':
      openExternal('https://alist.nn.ci/tool/aliyundrive/request.html')
      break
  }
}

const copyCookies = async () => {
  let cookies = await window.WebGetCookies({ url: 'https://www.aliyundrive.com' }) as []
  if (cookies.length == 0) cookies = await window.WebGetCookies({ url: 'https://www.aliyundrive.com' }) as []
  if (cookies.length > 0) {
    let cookiesText = ''
    cookies.forEach(cookie => {
      cookiesText += cookie['name'] + '=' + cookie['value'] + ';'
    })
    copyToClipboard(cookiesText)
    message.success(t('settings.account.cookiesCopied'))
  } else {
    message.error(t('settings.account.cookiesMissing'))
  }
}

const handlerAccountImport = () => {
  window.WebShowOpenDialogSync({
    title: t('settings.account.selectImportFile'),
    buttonLabel: t('settings.account.importSelectedFile'),
    filters: [{ name: 'user.db', extensions: ['db'] }],
    properties: ['openFile', 'multiSelections', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
  }, async (files: string[] | undefined) => {
    if (files && files.length > 0) {
      try {
        // 获取内容
        let userList: ITokenInfo[] = []
        let uniqueUserIds = new Set()
        for (let filePath of files) {
          let readData = fs.readFileSync(filePath, 'utf-8')
          let parsedData: any = JSON.parse(<string>decodeName(localPwd, 'aesctr', readData))
          if (Array.isArray(parsedData) && parsedData.every(item => item.hasOwnProperty('access_token'))) {
            let filteredData: ITokenInfo[] = parsedData.filter((item: ITokenInfo) => {
              if (!uniqueUserIds.has(item.user_id)) {
                uniqueUserIds.add(item.user_id)
                return true
              }
              return false
            })
            userList.push(...filteredData)
          }
        }
        if (userList.length > 0) {
          // 设置UserTokenMap
          for (let token of userList) {
            if (token.user_id) {
              UserTokenMap.set(token.user_id, token)
            }
          }
          // 导入到数据库
          Db.saveUserBatch(userList).then(() => {
            window.WinMsgToUpload({ cmd: 'ClearUserToken' })
            window.WinMsgToDownload({ cmd: 'ClearUserToken' })
          }).catch()
          await UserDAL.UserLogin(userList[0])
          message.success(t('settings.account.importSuccess'))
        } else {
          message.error(t('settings.account.importFailed'))
        }
      } catch (err) {
        message.error(t('settings.account.importFailed'))
      }
    }
  })
}

const handlerAccountExport = () => {
  if (window.WebShowOpenDialogSync) {
    window.WebShowOpenDialogSync(
      {
        title: t('settings.account.selectExportFolder'),
        buttonLabel: t('media.selectFolder'),
        properties: ['openDirectory', 'createDirectory']
      },
      (result: string[] | undefined) => {
        if (result && result[0]) {
          let exportFile = path.join(result[0], 'user.db')
          let userList = JSON.stringify(UserDAL.GetUserList())
          let data = encodeName(localPwd, 'aesctr', userList)
          fs.writeFileSync(exportFile, data)
          message.success(t('settings.account.exportSuccess'))
        }
      }
    )
  }
}

const handlerExportCliTokens = async () => {
  const result = await UserDAL.SyncCliAccountsToCli()
  if (result?.ok) {
    message.success(`${t('settings.account.exportCliSuccessPrefix')} ${result.exported} ${t('settings.account.exportCliSuccessSuffix')} ${result.path}`)
  } else {
    message.error(`${t('settings.account.exportFailed')}: ${result?.error || t('media.unknownError')}`)
  }
}
</script>

<template>
  <div class='settingcard'>
    <div class='settinghead'>{{ t('settings.account.aliyun') }}</div>
    <div class='settingrow'>
      <a-button type='outline' size='small' tabindex='-1' @click='copyCookies()'>
        {{ t('settings.account.copyCookies') }}
      </a-button>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead' data-testid="account-import-export-heading">{{ t('settings.account.importExport') }}
      <a-popover position="bottom">
        <IconFont name="iconbulb" />
        <template #content>
          <div>
            {{ t('settings.account.importExportTip') }}<br />
            <hr />
            <div class="hrspace"></div>
            <span class="opred">{{ t('settings.account.importExportAll') }}</span><br />
          </div>
        </template>
      </a-popover>
    </div>
    <div class="settingrow">
      <a-button type='outline' status="danger" size='small' tabindex='-1' data-testid="export-account-button"
                @click='handlerAccountExport'>
        {{ t('settings.account.export') }}
      </a-button>
      <a-button type='outline' size='small' status="success" tabindex='-1' @click='handlerAccountImport'>
        {{ t('settings.account.import') }}
      </a-button>
      <a-button type='outline' size='small' tabindex='-1'
                @click='handlerExportCliTokens'>
        {{ t('settings.account.exportCli') }}
      </a-button>
    </div>
  </div>
</template>

<style scoped>

</style>
