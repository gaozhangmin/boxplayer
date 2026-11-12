const labels:Record<string,string>={'common.retry':'重试','common.loading':'正在加载…','mediaServer.seeAllPlain':'查看全部','mediaServer.sectionLoadFailed':'加载失败','libraryBrowse.empty':'暂无内容','mediaServer.noOverview':'暂无简介','mediaServer.markUnwatched':'标记为未观看','mediaServer.markWatched':'标记为已观看','unified.watched':'已观看'}
export function t(key:string){return labels[key]||key}
