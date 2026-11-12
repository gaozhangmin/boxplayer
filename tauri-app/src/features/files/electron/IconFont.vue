<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Plus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Lightbulb, Calendar, Camera, Eye, Check, CheckSquare,
  Chrome, Send, X, Cloud, CloudCheck, CloudDownload, RefreshCcw, CloudUpload,
  Copy, Crown, FolderOpen, Sun, Bug, Trash2, Monitor, MoreHorizontal, MapPin,
  Bell, BellOff, ArrowDown, Download, SquarePen, Inbox, Square, Share2, GitBranch,
  Video as VideoIcon, FileAudio, FileText, Folder as FolderIcon, FileImage, FileSpreadsheet,
  FilePlus, Maximize2, MoreVertical, Home, Hourglass, Info, Scissors, List as ListIcon,
  Link, Link2, ListMusic, LogOut, Camera as Camera2, Menu, EyeOff, Move, Film, Music,
  Moon, Network, BellRing, ArrowUpDown, Pause, Image as ImageIcon, Eraser, Undo2, RotateCw,
  Trash, Bot, SearchCheck, Rss, Crown as CrownVip, ShieldCheck, Search, Server, Settings,
  Gauge, Tv, Layers, Sparkles, Cast, Info as InfoIcon, Layout, Upload,
  Tag, ShieldAlert, Box as BoxIcon, FileText as DocIcon, ChevronDown as ChevronDownAlt,
  Image, AlertCircle, Files, Star, Heart, Grid3X3, Palette, AlertTriangle, Shuffle,
  RotateCcw, RadioTower, Compass, FileVideo as FileVideoIcon, AlertOctagon, Box, Volume2,
  Minus, RefreshCw, Play, Pin, PinOff, ArrowUp,
  FileArchive, Disc3, Package, Smartphone, BookOpen, ScanSearch
} from 'lucide-vue-next'

interface Props {
  name: string
  size?: number | string
  strokeWidth?: number | string
  fill?: string
  color?: string
}
const props = withDefaults(defineProps<Props>(), {
  strokeWidth: 1.8,
  fill: 'none'
})

// 把项目里所有 iconfont 类名映射到 Lucide 组件
const ICON_MAP: Record<string, Component> = {
  // 通用动作
  iconadd: Plus,
  iconplus: Plus,
  icondelete: Trash2,
  iconcopy: Copy,
  'iconedit-square': SquarePen,
  iconclose: X,
  iconcheck: Check,
  'iconcheckbox-full': CheckSquare,
  iconmoveto: Move,
  iconrecover: Undo2,
  iconqingkong: Eraser,
  iconclear: Eraser,
  iconfenxiang: Share2,
  iconfenxiang1: Share2,
  iconfenzhi1: GitBranch,
  iconlink: Link,
  iconlink2: Link2,
  iconscissor: Scissors,
  iconjietu: Camera2,
  iconscan: ScanSearch,
  iconxuanzhuan: RotateCw,
  iconxiaotumoshi: Layout,
  iconsuoluetumoshi: Grid3X3,
  iconliebiaomoshi: ListIcon,
  iconpaixu1: ArrowUpDown,
  iconshuxing: Info,
  iconchakan: Eye,
  iconrest: Trash,
  iconcameraadd: Camera,
  icondakaiwenjianjia1: FolderOpen,

  // 箭头方向
  'iconarrow-left-1-icon': ChevronLeft,
  'iconarrow-left-2-icon': ChevronLeft,
  'iconarrow-right-1-icon': ChevronRight,
  'iconarrow-right-2-icon': ChevronRight,
  'iconarrow-top-2-icon-copy': ChevronUp,
  'iconArrow-Down2': ChevronDown,
  'iconArrow-Right2': ChevronRight,
  icondown: ChevronDown,
  iconxia: ChevronDown,

  // 文件类型
  iconwenjian: FileText,
  iconbook: BookOpen,
  'iconfile-audio': FileAudio,
  'iconfile-mp3': FileAudio,
  'iconfile-flac': FileAudio,
  'iconfile-wav': FileAudio,
  'iconfile-ape': FileAudio,
  'iconfile-ogg': FileAudio,
  'iconfile-video': FileVideoIcon,
  iconfile_video: FileVideoIcon,
  'iconfile-doc': DocIcon,
  'iconfile-img': FileImage,
  'iconfile-image': FileImage,
  'iconfile-pdf': DocIcon,
  'iconfile-txt': FileText,
  iconfile_txt2: FileText,
  'iconfile-wps': DocIcon,
  'iconfile-xsl': FileSpreadsheet,
  'iconfile-ppt': DocIcon,
  'iconfile-zip': FileArchive,
  'iconfile-rar': FileArchive,
  'iconfile-tar': FileArchive,
  'iconfile-7z': FileArchive,
  'iconfile-iso': Disc3,
  'iconfile-bt': Share2,
  'iconfile-exe': Package,
  'iconfile-apk': Smartphone,
  'iconfile-psd': FileImage,
  'iconfile-folder': FolderIcon,
  iconfolder: FolderIcon,
  iconfolderadd: FilePlus,

  // 媒体
  iconmusic: Music,
  iconmovie: Film,
  iconshipin: VideoIcon,
  iconluxiang: VideoIcon,
  iconpic2: Square,
  icontupianyulan: Image,
  iconpause: Pause,

  // 视图/导航
  iconhome: Home,
  iconlist: ListIcon,
  icontuijian: Sparkles,
  icondingwei: Compass,
  iconmenuon: Menu,
  iconmenuoff: EyeOff,
  'iconmenu-unfold': Menu,
  'iconnode-tree1': Network,
  iconfullscreen: Maximize2,
  iconzuixiaohua: Minus,
  iconzhiding: Pin,
  iconquxiaozhiding: PinOff,

  // 状态/提示
  iconbulb: Lightbulb,
  iconinfo_circle: Info,
  iconnotification: BellRing,
  icondingyue: Bell,
  icondingyueno: BellOff,
  icontongzhiblue: BellRing,
  iconrsuccess: CheckSquare,
  iconempty: Inbox,
  iconfangkuang: Square,
  icondian: AlertCircle,
  iconweifa: AlertTriangle,
  iconweixiang: AlertCircle,
  iconcrown: Crown,
  iconcrown2: Crown,
  iconcrown3: Crown,
  iconrvip: CrownVip,
  iconrobot: Bot,
  iconrsearch: SearchCheck,

  // 云/上传/下载
  iconcloud: Cloud,
  iconcloud_success: CloudCheck,
  'iconcloud-download': CloudDownload,
  'iconcloud-sync': RefreshCcw,
  'iconcloud-upload': CloudUpload,
  iconupload: Upload,
  icondownload: Download,
  iconxiazaisudu: Gauge,
  iconshangchuansudu: Gauge,
  iconchuanshu: Send,
  iconchuanshu2: Send,
  iconcalendar: Calendar,
  iconhourglass: Hourglass,
  iconyibu: Shuffle,
  iconyouxian: ArrowUp,

  // 系统/外观
  iconchrome: Chrome,
  iconday: Sun,
  iconnight: Moon,
  iconsetting: Settings,
  iconserver: Server,
  iconsafebox: ShieldCheck,
  icondebug: Bug,
  icondesktop: Monitor,
  iconlogoff: LogOut,
  iconui: Palette,

  // 其他常见
  iconsearch: Search,
  iconreload: RefreshCw,
  'iconreload-1-icon': RefreshCw,
  iconrss: Rss,
  iconrss_video: RadioTower,
  iconstar: Star,
  iconstart: Play,
  icontouping2: Cast,
  icongengduo: MoreHorizontal,
  icongengduo1: MoreVertical,
  iconwbiaoqian: Tag,
  iconbiaozhang: Layers,
  iconyuanduanfuzhi: Files,
  iconArrowDown2: ChevronDown
}

const fallback = AlertCircle

const Comp = computed<Component>(() => ICON_MAP[props.name] || fallback)
</script>

<template>
  <component
    :is="Comp"
    v-bind="props.size != null ? { size: props.size } : {}"
    :stroke-width="props.strokeWidth"
    :color="props.color"
    :fill="props.fill"
    :class="['iconfont-svg', props.name]"
    :style="props.size != null ? { width: typeof props.size === 'number' ? props.size + 'px' : props.size, height: typeof props.size === 'number' ? props.size + 'px' : props.size } : undefined"
  />
</template>

<style>
.iconfont-svg {
  /* 让 svg 的描述空间按字体大小自适应（兼容老 .iconfont CSS 规则用 font-size 控制大小） */
  width: 1em;
  height: 1em;
  display: inline-block;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
</style>
