const labels={
 'zh-CN':{name:'名称',modified:'修改时间',added:'添加时间',watched:'观看时间',manual:'自定义顺序',size:'大小',ascending:'升序',descending:'降序',sort:'排序方式',all:'全部',video:'视频',image:'图片',document:'文档',subtitle:'字幕',filter:'文件类型'},
 'zh-TW':{name:'名稱',modified:'修改時間',added:'加入時間',watched:'觀看時間',manual:'自訂順序',size:'大小',ascending:'升冪',descending:'降冪',sort:'排序方式',all:'全部',video:'影片',image:'圖片',document:'文件',subtitle:'字幕',filter:'檔案類型'},
 'en-US':{name:'Name',modified:'Modified time',added:'Added time',watched:'Watched time',manual:'Custom order',size:'Size',ascending:'Ascending',descending:'Descending',sort:'Sort by',all:'All',video:'Videos',image:'Images',document:'Documents',subtitle:'Subtitles',filter:'File type'}
}
export const fileLabels=(locale:string)=>labels[locale as keyof typeof labels]||labels['en-US']
