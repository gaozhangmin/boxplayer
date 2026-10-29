<script lang="ts">
import { computed, defineAsyncComponent, h } from 'vue'
import { ConfigProvider } from '@arco-design/web-vue'
import enUS from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'
import { useLocale } from './i18n'
import { useAppStore } from './store'
import PageMain from './layout/PageMain.vue'
import './assets/global.css'
import './assets/fileitem.css'
import './assets/antd.css'
import './styles/overlaySurfaces.css'

const PageVideoXBTVue = defineAsyncComponent(() => import('./layout/PageVideoXBT.vue'))
const PageCode = defineAsyncComponent(() => import('./layout/PageCode.vue'))
const PageOffice = defineAsyncComponent(() => import('./layout/PageOffice.vue'))
const PagePdf = defineAsyncComponent(() => import('./layout/PagePdf.vue'))
const PageEpub = defineAsyncComponent(() => import('./layout/PageEpub.vue'))
const PageBookReader = defineAsyncComponent(() => import('./layout/PageBookReader.vue'))
const PageDocx = defineAsyncComponent(() => import('./layout/PageDocx.vue'))
const PageSheet = defineAsyncComponent(() => import('./layout/PageSheet.vue'))
const PageImage = defineAsyncComponent(() => import('./layout/PageImage.vue'))
const PageVideo = defineAsyncComponent(() => import('./layout/PageVideo.vue'))
const PageMusic = defineAsyncComponent(() => import('./layout/PageMusic.vue'))
const PageLyric = defineAsyncComponent(() => import('./lyric/PageLyric.vue'))
const PageWorker = defineAsyncComponent(() => import('./layout/PageWorker.vue'))

export default {
  setup() {
    const appStore = useAppStore()
    const locale = useLocale()
    const arcoLocale = computed(() => locale.value === 'en-US' ? enUS : zhCN)
    return () => {
      let page
      if (appStore.appPage == 'PageMain' || appStore.appPage == 'PageLoading') page = h(PageMain)
      else if (appStore.appPage == 'PageOffice') page = h(PageOffice)
      else if (appStore.appPage == 'PagePdf') page = h(PagePdf)
      else if (appStore.appPage == 'PageEpub') page = h(PageEpub)
      else if (appStore.appPage == 'PageBookReader') page = h(PageBookReader)
      else if (appStore.appPage == 'PageDocx') page = h(PageDocx)
      else if (appStore.appPage == 'PageSheet') page = h(PageSheet)
      else if (appStore.appPage == 'PageVideoXBT') page = h(PageVideoXBTVue)
      else if (appStore.appPage == 'PageCode') page = h(PageCode)
      else if (appStore.appPage == 'PageImage') page = h(PageImage)
      else if (appStore.appPage == 'PageVideo') page = h(PageVideo)
      else if (appStore.appPage == 'PageMusic') page = h(PageMusic)
      else if (appStore.appPage == 'PageLyric') page = h(PageLyric)
      else if (appStore.appPage == 'PageWorker') page = h(PageWorker)
      else page = h(PageMain)
      return h(ConfigProvider, { locale: arcoLocale.value }, () => page)
    }
  }
}
</script>
