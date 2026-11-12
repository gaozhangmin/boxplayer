import {afterEach} from 'vitest'
import {config,enableAutoUnmount} from '@vue/test-utils'
import Arco from '@arco-design/web-vue'
import {setLocale} from '@/features/files/electron/i18n'
config.global.plugins.push(Arco)
setLocale('zh-CN')
enableAutoUnmount(afterEach)
