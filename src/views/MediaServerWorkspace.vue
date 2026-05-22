<template>
  <div class="media-server-workspace">
    <MediaServerRegistryPanel v-if="currentRoute.kind === 'registry'" />

    <div v-else-if="!registry.currentServer" class="server-empty-shell">
      <h2>还没有可用的媒体服务器</h2>
      <p>先在左侧的“管理服务器”里添加一台服务器，我们再把 Home / Search / Library 主链路接进来。</p>
      <a-button type="primary" @click="navigation.openRegistry()">去管理服务器</a-button>
    </div>

    <div
      v-else
      ref="workspacePageRef"
      class="workspace-page"
      :class="{ 'workspace-page-detail': currentRoute.kind === 'item-detail' || currentRoute.kind === 'person-page' }"
      @scroll.passive="handleWorkspaceScroll"
    >
      <div v-if="currentRoute.kind !== 'item-detail' && currentRoute.kind !== 'person-page'" class="workspace-toolbar">
        <div class="toolbar-left">
          <a-button type="text" class="back-button" @click="handleBack">
            <template #icon><i class="iconfont iconarrow-left-2-icon" /></template>
            <span class="back-button-server-icon">
              <img :src="serverDisplayIcon(registry.currentServer)" :alt="registry.currentServer?.name || 'server'" />
            </span>
            {{ currentBackLabel }}
          </a-button>
        </div>

        <div class="toolbar-center">
          <div class="workspace-tabs">
            <div class="workspace-tab" :class="{ active: currentRoute.kind === 'home' }" @click="navigation.goHome()">主页</div>
            <div class="workspace-tab" :class="{ active: currentRoute.kind === 'search' }" @click="navigation.goSearch()">搜索</div>
            <div class="workspace-tab" :class="{ active: currentRoute.kind === 'library-root' || currentRoute.kind === 'library-page' }" @click="navigation.goLibraryRoot()">媒体库</div>
          </div>
        </div>

        <div class="toolbar-right">
          <a-button v-if="currentRoute.kind === 'home'" type="outline" @click="openHomeLibraryManager">
            <template #icon><i class="iconfont iconlist" /></template>
            媒体管理
          </a-button>
          <div v-if="currentRoute.kind === 'home'" class="home-poster-toggle">
            <a-button
              :type="homePosterMode === 'landscape' ? 'primary' : 'outline'"
              @click="setHomePosterMode('landscape')"
            >
              横版
            </a-button>
            <a-button
              :type="homePosterMode === 'portrait' ? 'primary' : 'outline'"
              @click="setHomePosterMode('portrait')"
            >
              竖版
            </a-button>
          </div>
          <a-dropdown trigger="click" class="server-switch-dropdown">
            <a-button type="outline">
              <span class="server-switch-trigger">
                <span class="server-switch-trigger-icon">
                  <img :src="serverDisplayIcon(registry.currentServer)" :alt="registry.currentServer.name" />
                </span>
                <span
                  class="server-switch-trigger-text"
                  :title="`${registry.currentServer.name} · ${currentServerLineLabel}`"
                >
                  {{ registry.currentServer.name }} · {{ currentServerLineLabel }}
                </span>
              </span>
            </a-button>
            <template #content>
              <div class="server-switch-menu">
                <div class="server-switch-section-title">媒体服务器</div>
                <template v-for="server in registry.filteredServers" :key="server.id">
                  <a-dsubmenu
                    v-if="hasServerBackupLines(server)"
                    class="server-switch-submenu"
                    trigger="hover"
                  >
                    <template #default>
                      <div class="server-option server-option-single">
                        <div class="server-option-main">
                          <span>{{ server.name }}</span>
                        </div>
                        <span v-if="registry.currentServer?.id === server.id" class="server-option-check">当前</span>
                      </div>
                    </template>
                    <template #content>
                      <a-doption
                        v-for="line in serverLineOptions(server)"
                        :key="`${server.id}-${line.key}`"
                        class="server-switch-option"
                        @click="switchServerWithLine(server.id, line.key)"
                      >
                        <div class="server-option server-option-single">
                          <div class="server-option-main">
                            <span>{{ line.name }}</span>
                          </div>
                          <span v-if="isServerLineActive(server.id, line.key)" class="server-option-check">当前</span>
                        </div>
                      </a-doption>
                    </template>
                  </a-dsubmenu>

                  <a-doption
                    v-else
                    class="server-switch-option"
                    @click="switchServer(server.id)"
                  >
                    <div class="server-option server-option-single">
                      <div class="server-option-main">
                        <span>{{ server.name }}</span>
                      </div>
                      <span v-if="registry.currentServer?.id === server.id" class="server-option-check">当前</span>
                    </div>
                  </a-doption>
                </template>
              </div>
            </template>
          </a-dropdown>
          <a-button type="outline" @click="handleRefresh">
            <template #icon><i class="iconfont iconreload-1-icon" /></template>
            刷新
          </a-button>
<!--          <a-button type="outline" @click="navigation.openRegistry()">管理服务器</a-button>-->
<!--          <a-button type="primary" @click="handleAddServer">添加服务器</a-button>-->
        </div>
      </div>

<!--      <div class="workspace-header-card">-->
<!--        <div class="workspace-header-main">-->
<!--          <div>-->
<!--            <div class="workspace-eyebrow">{{ serverTypeLabel(registry.currentServer.type) }} · 当前服务器</div>-->
<!--            <h2>{{ registry.currentServer.name }}</h2>-->
<!--            <p>{{ registry.currentServer.baseUrl }}</p>-->
<!--          </div>-->
<!--          <div class="workspace-summary">-->
<!--            <div class="summary-item">-->
<!--              <strong>{{ registry.filteredServers.length }}</strong>-->
<!--              <span>已连接服务器</span>-->
<!--            </div>-->
<!--            <div class="summary-item">-->
<!--              <strong>{{ currentPanelLabel }}</strong>-->
<!--              <span>当前视图</span>-->
<!--            </div>-->
<!--          </div>-->
<!--        </div>-->
<!--      </div>-->

      <div
        class="workspace-content"
        :class="{
          'placeholder-card': currentRoute.kind !== 'item-detail' && currentRoute.kind !== 'person-page',
          'workspace-content-detail': currentRoute.kind === 'item-detail' || currentRoute.kind === 'person-page'
        }"
      >
        <template v-if="currentRoute.kind === 'home'">
          <div class="home-page">
            <div v-if="content.loadingHome" class="workspace-center-progress">
              <a-spin size="large" />
            </div>

            <div v-else-if="content.homeError" class="home-error">
              <div class="home-error-text">{{ content.homeError }}</div>
              <a-button type="primary" @click="loadCurrentServerHome(true)">重试</a-button>
            </div>

            <template v-else>
              <template v-for="section in visibleHomeSections" :key="section.key">
                <MediaServerResumeRow
                  v-if="section.kind === 'resume' && (currentHome.resume.length > 0 || currentHomeSectionLoading.resume || currentHomeSectionError.resume)"
                  :items="currentHome.resume"
                  :loading="currentHomeSectionLoading.resume"
                  :error-text="currentHomeSectionError.resume"
                  @play="playHomeMediaItem"
                  @action="handleHomeMediaAction"
                  @retry="retryHomeSection('resume')"
                />

                <MediaServerPosterRow
                  v-else-if="section.kind === 'nextup' && (currentHome.nextUp.length > 0 || currentHomeSectionLoading.nextUp || currentHomeSectionError.nextUp)"
                  title="下一集"
                  :items="currentHome.nextUp as MediaServerLibraryNode[]"
                  :loading="currentHomeSectionLoading.nextUp"
                  :error-text="currentHomeSectionError.nextUp"
                  :poster-type="homePreferences.nextUpPosterType"
                  :show-poster-labels="homePreferences.showPosterLabels"
                  :enable-context-menu="true"
                  :see-all-label="`查看全部 (${currentHome.nextUpTotal || currentHome.nextUp.length})`"
                  heading-mode="parent-or-title"
                  subtitle-mode="year-only"
                  @select="handleLibraryItemClick($event.id, $event.title, $event)"
                  @play="playHomeMediaItem"
                  @action="handleHomeMediaAction"
                  @see-all="openHomeCollection('nextup', '下一集')"
                  @retry="retryHomeSection('nextup')"
                />

                <MediaServerPosterRow
                  v-else-if="section.kind === 'latest' && homePreferences.showRecentlyAdded && (currentHome.latest.length > 0 || currentHomeSectionLoading.latest || currentHomeSectionError.latest)"
                  title="最近添加"
                  :items="currentHome.latest as MediaServerLibraryNode[]"
                  :loading="currentHomeSectionLoading.latest"
                  :error-text="currentHomeSectionError.latest"
                  :poster-type="homePreferences.recentlyAddedPosterType"
                  :show-poster-labels="homePreferences.showPosterLabels"
                  :enable-context-menu="true"
                  :show-top-overlay="true"
                  :see-all-label="`查看全部 (${currentHome.latestTotal || currentHome.latest.length})`"
                  subtitle-mode="year-only"
                  @select="handleLibraryItemClick($event.id, $event.title, $event)"
                  @play="playHomeMediaItem"
                  @action="handleHomeMediaAction"
                  @see-all="openHomeCollection('latest', '最近添加')"
                  @retry="retryHomeSection('latest')"
                />

                <MediaServerPosterRow
                  v-else-if="section.kind === 'library' && section.library"
                  :title="section.library.title"
                  :items="section.library.items"
                  :loading="currentHomeLibrarySectionLoading(section.library.id)"
                  :error-text="currentHomeLibrarySectionError(section.library.id)"
                  :poster-type="homePreferences.latestInLibraryPosterType"
                  :show-poster-labels="homePreferences.showPosterLabels"
                  :enable-context-menu="true"
                  :show-top-overlay="true"
                  :see-all-label="`查看全部 (${section.library.total || section.library.items.length})`"
                  subtitle-mode="year-only"
                  @select="handleLibraryItemClick($event.id, $event.title, $event)"
                  @play="playHomeMediaItem"
                  @action="handleHomeMediaAction"
                  @see-all="navigation.push({ kind: 'library-page', libraryId: section.library.id, title: section.library.title })"
                  @retry="retryHomeLibrarySection(section.library.id)"
                />
              </template>

              <MediaServerStatsRow :statistics="currentHome.statistics" />
            </template>
          </div>
        </template>

        <template v-else-if="currentRoute.kind === 'search'">
          <div class="search-shell search-shell-media-server">
            <a-input-search
              v-model="searchText"
              class="search-input search-input-hero"
              placeholder="搜索电影、电视剧、人物、合集"
              allow-clear
              @search="handleSearch"
              @press-enter="handleSearch"
            />

            <div v-if="normalizedSearchQuery && content.loadingSearch" class="home-loading search-feedback-card">
              <a-spin size="large" />
              <span>正在搜索“{{ normalizedSearchQuery }}”...</span>
            </div>

            <div v-else-if="normalizedSearchQuery && content.searchError" class="home-error search-feedback-card">
              <div class="home-error-text">{{ content.searchError }}</div>
              <a-button type="primary" @click="loadCurrentSearch(true)">重试</a-button>
            </div>

            <template v-else-if="normalizedSearchQuery">
              <div v-if="currentSearch.items.length > 0" class="search-result-stack">
                <MediaServerPosterRow
                  v-if="searchSeriesItems.length > 0"
                  title="电视剧"
                  :items="searchSeriesItems"
                  poster-type="portrait"
                  :show-see-all="false"
                  subtitle-mode="year-only"
                  @select="handleSearchItemSelect"
                />
                <MediaServerPosterRow
                  v-if="searchMovieItems.length > 0"
                  title="电影"
                  :items="searchMovieItems"
                  poster-type="portrait"
                  :show-see-all="false"
                  subtitle-mode="year-only"
                  @select="handleSearchItemSelect"
                />
                <MediaServerPosterRow
                  v-if="searchEpisodeItems.length > 0"
                  title="剧集"
                  :items="searchEpisodeItems"
                  poster-type="landscape"
                  :show-see-all="false"
                  heading-mode="parent-or-title"
                  subtitle-mode="year-or-parent-or-overview"
                  @select="handleSearchItemSelect"
                />
                <MediaServerPosterRow
                  v-if="searchPersonItems.length > 0"
                  title="人物"
                  :items="searchPersonItems"
                  poster-type="portrait"
                  :show-see-all="false"
                  subtitle-mode="title"
                  @select="handleSearchItemSelect"
                />
              </div>
              <div v-else class="empty-placeholder">没有找到“{{ normalizedSearchQuery }}”相关内容</div>
            </template>

            <template v-else>
              <div v-if="content.loadingSearchSuggestions" class="home-loading search-feedback-card">
                <a-spin size="large" />
                <span>正在加载推荐剧集...</span>
              </div>
              <div v-else-if="content.searchSuggestionsError" class="home-error search-feedback-card">
                <div class="home-error-text">{{ content.searchSuggestionsError }}</div>
                <a-button type="primary" @click="loadCurrentSearchSuggestions(true)">重试</a-button>
              </div>
              <MediaServerPosterRow
                v-else-if="searchSuggestionItems.length > 0"
                title="推荐剧集"
                :items="searchSuggestionItems"
                poster-type="portrait"
                :show-see-all="false"
                subtitle-mode="year-only"
                @select="handleSearchItemSelect"
              />
              <div v-else class="empty-placeholder search-empty-state">
                <i class="iconfont iconsearch" />
                <span>暂时还没有可推荐的剧集</span>
              </div>
            </template>
          </div>
        </template>

        <template v-else-if="currentRoute.kind === 'library-root' || currentRoute.kind === 'library-page' || currentRoute.kind === 'genre-page' || currentRoute.kind === 'studio-page'">
          <div class="home-page">
            <div class="home-intro listing-intro">
              <div>
                <h3>{{ currentRoute.kind === 'library-root' ? '' : currentRoute.title }}</h3>
<!--                <p>-->
<!--                  {{-->
<!--                    currentRoute.kind === 'library-root'-->
<!--                      ? '这里展示当前服务器的顶层媒体库。'-->
<!--                      : '查看全部页面按媒体递归展开，不再显示文件夹，并支持和首页一致的海报样式。'-->
<!--                  }}-->
<!--                </p>-->
              </div>
              <div v-if="currentRoute.kind === 'library-page' || currentRoute.kind === 'genre-page' || currentRoute.kind === 'studio-page'" class="listing-display-toggle">
                <div class="listing-toggle-group">
                  <a-button
                    :type="currentListingBrowseMode === 'grid' ? 'primary' : 'outline'"
                    @click="setCurrentListingBrowseMode('grid')"
                  >
                    网格
                  </a-button>
                  <a-button
                    :type="currentListingBrowseMode === 'list' ? 'primary' : 'outline'"
                    @click="setCurrentListingBrowseMode('list')"
                  >
                    列表
                  </a-button>
                </div>
                <div class="listing-toggle-group">
                  <a-button
                    :type="currentListingPosterType === 'portrait' ? 'primary' : 'outline'"
                    @click="setCurrentListingPosterType('portrait')"
                  >
                    竖版海报
                  </a-button>
                  <a-button
                    :type="currentListingPosterType === 'landscape' ? 'primary' : 'outline'"
                    @click="setCurrentListingPosterType('landscape')"
                  >
                    横版海报
                  </a-button>
                </div>
              </div>
            </div>

            <div v-if="showInitialLibraryLoading" class="workspace-center-progress">
              <a-spin size="large" />
            </div>

            <div v-else-if="currentLibraryError && currentLibraryItems.length === 0" class="home-error">
              <div class="home-error-text">{{ currentLibraryError }}</div>
              <a-button type="primary" @click="loadCurrentLibrary(true)">重试</a-button>
            </div>

            <template v-else>
              <div class="library-shell" :class="listingShellClass">
                <button
                  v-for="item in currentLibraryItems"
                  :key="item.id"
                  class="library-card interactive"
                  :class="[listingCardClass, { 'library-card-hero': currentRoute.kind === 'library-root' }]"
                  @click="handleLibraryItemClick(item.id, item.title, item)"
                >
                  <div
                    class="library-cover media-image-frame"
                    :class="{
                      'has-image': !!pickLibraryListingImage(item),
                      'library-cover-fallback': !pickLibraryListingImage(item),
                      'library-cover-list': currentListingBrowseMode === 'list' && currentRoute.kind !== 'library-root'
                    }"
                  >
                    <img
                      v-if="pickLibraryListingImage(item)"
                      :src="pickLibraryListingImage(item)"
                      :alt="item.title"
                      @load="handleCardImageLoad"
                      @error="handleCardImageError"
                    />
                    <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                    <div v-if="currentRoute.kind === 'library-root'" class="library-cover-overlay"></div>
                    <div v-if="currentRoute.kind === 'library-root'" class="library-cover-title">{{ getListingHeading(item) }}</div>
                    <div v-if="getListingOverlay(item)" class="listing-overlay-badge">{{ getListingOverlay(item) }}</div>
                  </div>
                  <template v-if="currentRoute.kind !== 'library-root' && currentListingBrowseMode === 'grid'">
                    <h4>{{ getListingHeading(item) }}</h4>
                    <div class="library-meta-line">{{ getListingYearLabel(item) }}</div>
                  </template>
                  <template v-else-if="currentRoute.kind !== 'library-root'">
                    <div class="library-list-body">
                      <div class="library-list-head">
                        <div class="library-list-title-wrap">
                          <h4>{{ getListingHeading(item) }}</h4>
                        </div>
                      </div>
                      <div v-if="getListingMetaItems(item).length > 0" class="library-list-meta">
                        <span
                          v-for="meta in getListingMetaItems(item)"
                          :key="`${item.id}-${meta}`"
                          class="library-list-meta-chip"
                        >
                          {{ meta }}
                        </span>
                      </div>
                      <p class="library-list-overview" :class="{ 'is-empty': !getListingOverview(item) }">
                        {{ getListingOverview(item) || '暂无简介' }}
                      </p>
                    </div>
                  </template>
                </button>
              </div>
              <div v-if="currentLibraryItems.length === 0" class="empty-placeholder">当前媒体库下还没有内容</div>
              <div v-else-if="(currentRoute.kind === 'library-page' || currentRoute.kind === 'genre-page' || currentRoute.kind === 'studio-page') && currentLibraryPageLoading" class="home-loading collection-loading-inline">
                <a-spin />
                <span>正在加载更多内容...</span>
              </div>
              <div v-else-if="(currentRoute.kind === 'library-page' || currentRoute.kind === 'genre-page' || currentRoute.kind === 'studio-page') && currentLibraryError" class="home-error inline-home-error">
                <div class="home-error-text">{{ currentLibraryError }}</div>
                <a-button type="primary" @click="loadCurrentLibrary(false)">重试</a-button>
              </div>
              <div v-else-if="(currentRoute.kind === 'library-page' || currentRoute.kind === 'genre-page' || currentRoute.kind === 'studio-page') && !currentPagedLibrary.hasNextPage" class="empty-placeholder">已经到底了</div>
            </template>
          </div>
        </template>

        <template v-else-if="currentRoute.kind === 'collection-page'">
          <div class="home-page">
            <div class="home-intro listing-intro">
              <div>
                <h3>{{ currentRoute.title }}</h3>
                <p>这里展示首页卡片对应的完整列表，行为和 macOS 里的“查看全部”一致，并支持滚动分页加载。</p>
              </div>
              <div class="listing-display-toggle">
                <div class="listing-toggle-group">
                  <a-button
                    :type="currentListingBrowseMode === 'grid' ? 'primary' : 'outline'"
                    @click="setCurrentListingBrowseMode('grid')"
                  >
                    网格
                  </a-button>
                  <a-button
                    :type="currentListingBrowseMode === 'list' ? 'primary' : 'outline'"
                    @click="setCurrentListingBrowseMode('list')"
                  >
                    列表
                  </a-button>
                </div>
                <div class="listing-toggle-group">
                  <a-button
                    :type="currentListingPosterType === 'portrait' ? 'primary' : 'outline'"
                    @click="setCurrentListingPosterType('portrait')"
                  >
                    竖版海报
                  </a-button>
                  <a-button
                    :type="currentListingPosterType === 'landscape' ? 'primary' : 'outline'"
                    @click="setCurrentListingPosterType('landscape')"
                  >
                    横版海报
                  </a-button>
                </div>
              </div>
            </div>

            <div class="library-shell" :class="listingShellClass">
              <button
                v-for="item in currentCollectionItems"
                :key="`collection-${item.id}`"
                class="library-card interactive"
                :class="listingCardClass"
                @click="handleLibraryItemClick(item.id, item.title, item)"
              >
                <div
                  class="library-cover media-image-frame"
                  :class="{
                    'has-image': !!pickCollectionListingImage(item),
                    'library-cover-fallback': !pickCollectionListingImage(item),
                    'library-cover-list': currentListingBrowseMode === 'list'
                  }"
                >
                  <img
                    v-if="pickCollectionListingImage(item)"
                    :src="pickCollectionListingImage(item)"
                    :alt="item.title"
                    @load="handleCardImageLoad"
                    @error="handleCardImageError"
                  />
                  <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                  <div v-if="getListingOverlay(item)" class="listing-overlay-badge">{{ getListingOverlay(item) }}</div>
                </div>
                <template v-if="currentListingBrowseMode === 'grid'">
                  <h4>{{ getListingHeading(item) }}</h4>
                  <div class="library-meta-line">{{ getListingYearLabel(item) }}</div>
                </template>
                <template v-else>
                  <div class="library-list-body">
                    <div class="library-list-head">
                      <div class="library-list-title-wrap">
                        <h4>{{ getListingHeading(item) }}</h4>
                      </div>
                    </div>
                    <div v-if="getListingMetaItems(item).length > 0" class="library-list-meta">
                      <span
                        v-for="meta in getListingMetaItems(item)"
                        :key="`${item.id}-${meta}`"
                        class="library-list-meta-chip"
                      >
                        {{ meta }}
                      </span>
                    </div>
                    <p class="library-list-overview" :class="{ 'is-empty': !getListingOverview(item) }">
                      {{ getListingOverview(item) || '暂无简介' }}
                    </p>
                  </div>
                </template>
              </button>
            </div>
            <div v-if="currentCollectionError && currentCollectionItems.length === 0" class="home-error inline-home-error">
              <div class="home-error-text">{{ currentCollectionError }}</div>
              <a-button type="primary" @click="loadCurrentCollection(true)">重试</a-button>
            </div>
            <div v-else-if="currentCollectionItems.length === 0" class="empty-placeholder">当前列表还没有内容</div>
            <div v-else-if="currentCollectionLoading" class="home-loading collection-loading-inline">
              <a-spin />
              <span>正在加载更多内容...</span>
            </div>
            <div v-else-if="currentCollectionError" class="home-error inline-home-error">
              <div class="home-error-text">{{ currentCollectionError }}</div>
              <a-button type="primary" @click="loadCurrentCollection(false)">重试</a-button>
            </div>
            <div v-else-if="!currentCollection.hasNextPage" class="empty-placeholder">已经到底了</div>
          </div>
        </template>

        <template v-else-if="currentRoute.kind === 'item-detail' || currentRoute.kind === 'person-page'">
          <div class="detail-page">
            <div v-if="showDetailLoadingState" class="detail-loading-state">
              <div class="detail-loading-indicator">
                <a-spin size="large" />
              </div>
            </div>

            <div v-else-if="showDetailErrorState" class="home-error">
              <div class="home-error-text">{{ content.detailError }}</div>
              <a-button type="primary" @click="loadCurrentDetail(true)">重试</a-button>
            </div>
            <template v-else-if="currentDetail && currentRoute.kind === 'person-page'">
              <div class="person-shell">
                <div class="person-hero">
                  <img
                    v-if="personBackdropUrl"
                    class="person-hero-backdrop"
                    :src="personBackdropUrl"
                    :alt="currentDetail.title"
                    @error="handleBackdropImageError"
                  />
                  <div v-else class="person-hero-backdrop person-hero-backdrop-fallback" />
                  <div class="person-hero-mask" />

                  <div class="detail-top-back">
                    <a-button type="text" class="detail-back-button" @click="handleBack">
                      <template #icon><i class="iconfont iconarrow-left-2-icon" /></template>
                      <span class="back-button-server-icon">
                        <img :src="serverDisplayIcon(registry.currentServer)" :alt="registry.currentServer?.name || 'server'" />
                      </span>
                      {{ currentBackLabel }}
                    </a-button>
                  </div>

                  <div class="person-hero-overlay">
                    <div class="person-hero-card-row">
                      <div class="person-hero-poster media-image-frame" :class="{ 'has-image': !!pickPersonImage(currentDetail) }">
                        <img
                          v-if="pickPersonImage(currentDetail)"
                          :src="pickPersonImage(currentDetail)"
                          :alt="currentDetail.title"
                          @load="handleCardImageLoad"
                          @error="handleCardImageError"
                        />
                        <div class="media-card-placeholder media-image-placeholder">{{ currentDetail.title.slice(0, 1) }}</div>
                      </div>

                      <div class="person-shelf-card">
                        <div class="person-shelf-top">
                          <div class="person-shelf-title-group">
                            <div class="person-shelf-title">{{ currentDetail.title }}</div>
                            <div v-if="personAgeLabel" class="person-shelf-meta">{{ personAgeLabel }}</div>
                          </div>
                          <div class="person-shelf-actions">
                            <button
                              class="person-mini-action"
                              :class="{ active: detailIsFavorite }"
                              @click="handleDetailAction('favorite')"
                            >
                              <span class="detail-square-glyph">{{ detailIsFavorite ? '♥' : '♡' }}</span>
                            </button>
                          </div>
                        </div>

                        <div class="person-shelf-body">
                          <div v-if="currentDetail.birthday" class="person-bio-row person-bio-row-inline">
                            <span>出生</span>
                            <strong>{{ currentDetail.birthday }}</strong>
                          </div>
                          <div v-if="currentDetail.birthPlace" class="person-bio-row person-bio-row-inline">
                            <span>出生地</span>
                            <strong>{{ currentDetail.birthPlace }}</strong>
                          </div>
                          <div v-if="currentDetail.deathDate" class="person-bio-row person-bio-row-inline">
                            <span>逝世</span>
                            <strong>{{ currentDetail.deathDate }}</strong>
                          </div>
                          <p v-if="currentDetail.overview" class="person-shelf-overview">{{ currentDetail.overview }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="person-content">
                  <div class="person-content-divider" />
                  <section
                    v-for="section in orderedPersonSections"
                    :key="section.key"
                    class="detail-section person-section"
                  >
                    <div class="detail-section-header person-section-header">
                      <h4>{{ section.title }}</h4>
                      <button
                        v-if="section.items.length > 0"
                        type="button"
                        class="person-section-more"
                        @click="openPersonSection(section)"
                      >
                        查看所有
                        <i class="iconfont iconarrow-right-2-icon" />
                      </button>
                    </div>

                    <div v-if="section.type === 'episode'" class="person-episode-rail">
                      <button
                        v-for="item in section.items"
                        :key="item.id"
                        class="person-rail-card person-rail-card-episode"
                        @click="handleLibraryItemClick(item.id, item.title, item)"
                      >
                        <div class="person-rail-poster person-episode-cover media-image-frame" :class="{ 'has-image': !!pickEpisodeStillImage(item) }">
                          <img
                            v-if="pickEpisodeStillImage(item)"
                            :src="pickEpisodeStillImage(item)"
                            :alt="item.title"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                        </div>
                        <div class="person-rail-kicker">{{ item.parentTitle || section.title }}</div>
                        <div class="person-rail-title person-rail-title-episode">{{ detailEpisodeTitle(item) }}</div>
                        <div class="person-rail-overview">{{ item.overview || '无简介' }}</div>
                      </button>
                    </div>

                    <div v-else class="person-poster-rail">
                      <button
                        v-for="item in section.items"
                        :key="item.id"
                        class="person-rail-card person-rail-card-poster"
                        @click="handleLibraryItemClick(item.id, item.title, item)"
                      >
                        <div class="person-rail-poster person-poster-cover media-image-frame" :class="{ 'has-image': !!pickPrimaryImage(item) }">
                          <img
                            v-if="pickPrimaryImage(item)"
                            :src="pickPrimaryImage(item)"
                            :alt="item.title"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                          <div v-if="getListingOverlay(item)" class="person-poster-overlay">{{ getListingOverlay(item) }}</div>
                        </div>
                        <div class="person-rail-title">{{ item.title }}</div>
                        <div v-if="getListingSubtitle(item)" class="person-rail-subtitle">{{ getListingSubtitle(item) }}</div>
                      </button>
                    </div>
                  </section>

                  <section v-if="detailGenres.length > 0" class="detail-section person-section">
                    <div class="detail-section-header person-section-header">
                      <h4>类型</h4>
                    </div>
                    <div class="detail-chip-row person-chip-row">
                      <button
                        v-for="genre in detailGenres"
                        :key="genre"
                        class="detail-chip-button"
                        @click="openGenrePage(genre)"
                      >
                        {{ genre }}
                      </button>
                    </div>
                  </section>

                  <section v-if="detailStudios.length > 0" class="detail-section person-section">
                    <div class="detail-section-header person-section-header">
                      <h4>工作室</h4>
                    </div>
                    <div class="detail-chip-row person-chip-row">
                      <button
                        v-for="studio in detailStudios"
                        :key="studio"
                        class="detail-chip-button"
                        @click="openStudioSearch(studio)"
                      >
                        {{ studio }}
                      </button>
                    </div>
                  </section>

                  <section v-if="detailSimilarLoading || detailSimilarItems.length > 0 || detailSimilarError" class="detail-section person-section">
                    <div class="detail-section-header person-section-header">
                      <h4>推荐</h4>
                    </div>
                    <div v-if="detailSimilarLoading" class="detail-inline-state">正在加载推荐内容...</div>
                    <div v-else-if="detailSimilarError" class="detail-inline-state">{{ detailSimilarError }}</div>
                    <div class="person-poster-rail">
                      <button
                        v-for="item in detailSimilarItems"
                        :key="item.id"
                        class="person-rail-card person-rail-card-poster"
                        @click="handleLibraryItemClick(item.id, item.title, item)"
                      >
                        <div class="person-rail-poster person-poster-cover media-image-frame" :class="{ 'has-image': !!pickPrimaryImage(item) }">
                          <img
                            v-if="pickPrimaryImage(item)"
                            :src="pickPrimaryImage(item)"
                            :alt="item.title"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                        </div>
                        <div class="person-rail-title">{{ item.title }}</div>
                      </button>
                    </div>
                  </section>

                  <section v-if="detailDisplayedItem.externalLinks.length > 0" class="detail-section person-section">
                    <div class="detail-section-header person-section-header">
                      <h4>链接</h4>
                    </div>
                    <div class="detail-chip-row person-chip-row">
                      <a
                        v-for="link in detailDisplayedItem.externalLinks"
                        :key="link.url"
                        class="detail-chip-button person-link-chip"
                        :href="link.url"
                        @click.prevent="openExternalLink(link.url)"
                      >
                        {{ link.title }}
                      </a>
                    </div>
                  </section>
                </div>
              </div>
            </template>

            <template v-else-if="currentDetail">
              <div class="detail-shell">
                <img
                  v-if="detailBackdropUrl"
                  class="detail-page-backdrop"
                  :src="detailBackdropUrl"
                  :alt="currentDetail.title"
                  aria-hidden="true"
                />
                <div class="detail-page-tint" aria-hidden="true" />
                <div class="detail-backdrop-stage">
                  <img
                    v-if="detailBackdropUrl"
                    class="detail-backdrop-image"
                    :src="detailBackdropUrl"
                    :alt="currentDetail.title"
                    @error="handleBackdropImageError"
                  />
                  <div v-else class="detail-backdrop-fallback" />
                  <div class="detail-backdrop-mask" />
                  <div class="detail-backdrop-bottom-haze" />

                  <div class="detail-top-back">
                    <a-button type="text" class="detail-back-button" @click="handleBack">
                      <template #icon><i class="iconfont iconarrow-left-2-icon" /></template>
                      <span class="back-button-server-icon">
                        <img :src="serverDisplayIcon(registry.currentServer)" :alt="registry.currentServer?.name || 'server'" />
                      </span>
                      {{ currentBackLabel }}
                    </a-button>
                  </div>

                  <div class="detail-hero-copy">
                    <div class="detail-overlay-grid">
                      <div class="detail-hero-poster media-image-frame" :class="{ 'has-image': !!detailHeroPosterImage }">
                        <img
                          v-if="detailHeroPosterImage"
                          :src="detailHeroPosterImage"
                          :alt="currentDetail.title || detailDisplayedItem.title"
                          @load="handleCardImageLoad"
                          @error="handleCardImageError"
                        />
                        <div class="media-card-placeholder media-image-placeholder">{{ (currentDetail.title || detailDisplayedItem.title).slice(0, 1) }}</div>
                      </div>

                      <div class="detail-hero-main">
                        <div class="detail-title-block">
                          <img
                            v-if="detailLogoUrl"
                            class="detail-hero-logo"
                            :src="detailLogoUrl"
                            :alt="currentDetail.title"
                            @error="handleDetailLogoError"
                          />
                          <div v-else class="detail-hero-title">{{ currentDetail.title }}</div>
                        </div>

                        <div class="detail-synopsis-column">
                          <div v-if="detailEpisodeHeading" class="detail-episode-heading">{{ detailEpisodeHeading }}</div>
                          <div class="detail-rating-line">
                            <span v-if="typeof detailDisplayedItem.rating === 'number'" class="detail-star-rating">
                              ★ {{ detailDisplayedItem.rating.toFixed(1) }}
                            </span>
                            <span v-if="detailGenreLine">{{ detailGenreLine }}</span>
                          </div>
                          <div class="detail-tech-line">
                            {{ detailTechnicalLine }}
                          </div>
                          <div v-if="detailMetaBadges.length > 0" class="detail-meta-badges">
                            <span v-for="badge in detailMetaBadges" :key="badge" class="detail-meta-badge">{{ badge }}</span>
                          </div>
                          <div class="detail-overview-block" :class="{ 'is-empty': !currentOverviewText }">
                            <p
                              class="detail-overview"
                              :class="{ 'is-empty': !currentOverviewText }"
                              :title="currentOverviewText || '暂无简介'"
                            >
                              {{ currentOverviewText || '暂无简介' }}
                            </p>
                          </div>
                        </div>

                        <div class="detail-actions-column">
                          <div class="detail-icon-actions">
                            <button
                              class="detail-square-action"
                              :class="{ active: detailIsWatched }"
                              @click="handleDetailAction('watched')"
                            >
                              <span class="detail-square-glyph">✓</span>
                            </button>
                            <button
                              class="detail-square-action"
                              :class="{ active: detailIsFavorite }"
                              @click="handleDetailAction('favorite')"
                            >
                              <span class="detail-square-glyph">{{ detailIsFavorite ? '♥' : '♡' }}</span>
                            </button>
                            <a-trigger
                              v-if="detailSourceOptions.length > 0"
                              v-model:popup-visible="versionMenuVisible"
                              trigger="click"
                              position="bottom"
                              auto-fit-popup-width="false"
                              :unmount-on-close="false"
                            >
                              <button class="detail-square-action detail-square-action-version">
                                <span class="detail-square-glyph">⋯</span>
                              </button>
                              <template #content>
                                <div class="detail-version-menu">
                                  <button
                                  v-for="source in detailSourceOptions"
                                  :key="source.id"
                                  type="button"
                                  class="detail-version-option"
                                  :class="{ active: selectedSourceOption?.id === source.id }"
                                  @click="selectSourceOption(source.id); versionMenuVisible = false"
                                >
                                  <div class="detail-version-main">
                                    <span>{{ source.title }}</span>
                                    <small v-if="source.fileSubLabel">{{ source.fileSubLabel }}</small>
                                  </div>
                                  <span v-if="selectedSourceOption?.id === source.id" class="detail-version-check">当前</span>
                                </button>
                                </div>
                              </template>
                            </a-trigger>
                            <button v-else class="detail-square-action detail-square-action-version" disabled>
                              <span class="detail-square-glyph">⋯</span>
                            </button>
                          </div>

                          <button class="detail-primary-play" @click="handleDetailPlay">
                            <span class="detail-play-glyph">▶</span>
                            <span class="detail-play-label">{{ detailPlayLabel }}</span>
                          </button>
                          <a-trigger
                            v-if="detailDownloadOptions.length > 1"
                            trigger="click"
                            position="bottom"
                            auto-fit-popup-width="false"
                          >
                            <button class="detail-secondary-download">
                              <span class="detail-play-glyph">↓</span>
                              <span class="detail-play-label">下载</span>
                            </button>
                            <template #content>
                              <div class="detail-version-menu">
                                <button
                                  v-for="option in detailDownloadOptions"
                                  :key="option.key"
                                  type="button"
                                  class="detail-version-option"
                                  @click="handleDetailDownload(option.key)"
                                >
                                  <div class="detail-version-main">
                                    <span>{{ option.label }}</span>
                                    <small v-if="option.description">{{ option.description }}</small>
                                  </div>
                                </button>
                              </div>
                            </template>
                          </a-trigger>
                          <button v-else class="detail-secondary-download" @click="handleDetailDownload('current')">
                            <span class="detail-play-glyph">↓</span>
                            <span class="detail-play-label">下载</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="detail-lower-content">
                  <section
                    v-if="detailSeasonMenu.length > 0 || detailEpisodeItems.length > 0"
                    class="detail-section detail-section-episodes"
                  >
                    <div class="detail-section-header">
                      <h4>{{ detailSeasonTitle }}</h4>
                    </div>

                    <div v-if="detailSeasonMenu.length > 1" class="detail-season-picker">
                      <button
                        v-for="season in detailSeasonMenu"
                        :key="season.id"
                        class="detail-chip-button"
                        :class="{ active: selectedSeasonId === season.id }"
                        @click="selectDetailSeason(season.id)"
                      >
                        {{ season.title }}
                      </button>
                    </div>

                    <div class="detail-episodes-rail">
                      <button
                        v-for="episode in detailEpisodeItems"
                        :key="episode.id"
                        class="detail-episode-card"
                        :class="{ selected: selectedEpisodeId === episode.id }"
                        @click="selectDetailEpisode(episode.id)"
                      >
                        <div class="detail-episode-cover media-image-frame" :class="{ 'has-image': !!pickDetailEpisodeCardImage(episode) }">
                          <img
                            v-if="pickDetailEpisodeCardImage(episode)"
                            :src="pickDetailEpisodeCardImage(episode)"
                            :alt="episode.title"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="media-card-placeholder media-image-placeholder">{{ episode.title.slice(0, 1) }}</div>
                          <div v-if="selectedEpisodeId === episode.id" class="detail-episode-selected-badge">
                            <span>✓</span>
                          </div>
                          <div v-if="typeof episode.progress === 'number' && episode.progress > 0" class="detail-episode-progress">
                            <div class="detail-episode-progress-bar" :style="{ width: `${Math.min(100, episode.progress)}%` }" />
                          </div>
                        </div>
                        <div class="detail-episode-kicker">{{ detailEpisodeLocator(episode) }}</div>
                        <div class="detail-episode-title">{{ detailEpisodeTitle(episode) }}</div>
                      </button>
                    </div>

                  </section>

                  <section v-if="detailGenres.length > 0" class="detail-section">
                    <div class="detail-section-header">
                      <h4>类型</h4>
                    </div>
                    <div class="detail-chip-row">
                      <button
                        v-for="genre in detailGenres"
                        :key="genre"
                        class="detail-chip-button"
                        @click="openGenrePage(genre)"
                      >
                        {{ genre }}
                      </button>
                    </div>
                  </section>

                  <section v-if="detailStudios.length > 0" class="detail-section">
                    <div class="detail-section-header">
                      <h4>工作室</h4>
                    </div>
                    <div class="detail-chip-row">
                      <button
                        v-for="studio in detailStudios"
                        :key="studio"
                        class="detail-chip-button"
                        @click="openStudioSearch(studio)"
                      >
                        {{ studio }}
                      </button>
                    </div>
                  </section>

                  <section v-if="detailPeople.length > 0" class="detail-section">
                    <div class="detail-section-header">
                      <h4>演员与工作人员</h4>
                    </div>
                    <div class="people-rail detail-people-rail">
                      <button
                        v-for="person in detailPeople"
                        :key="person.id"
                        class="person-card person-card-rail person-card-button"
                        @click="openPersonPage(person.id, person.name)"
                      >
                        <div class="person-avatar media-image-frame" :class="{ 'has-image': !!person.image }">
                          <img
                            v-if="person.image"
                            :src="person.image"
                            :alt="person.name"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="person-placeholder media-image-placeholder">{{ person.name.slice(0, 1) }}</div>
                        </div>
                        <div class="person-name">{{ person.name }}</div>
                        <div class="person-role">{{ person.role || '—' }}</div>
                      </button>
                    </div>
                  </section>

                  <section v-if="detailSimilarLoading || detailSimilarItems.length > 0 || detailSimilarError" class="detail-section">
                    <div class="detail-section-header">
                      <h4>推荐</h4>
                    </div>
                    <div v-if="detailSimilarLoading" class="detail-inline-state">正在加载推荐内容...</div>
                    <div v-else-if="detailSimilarError" class="detail-inline-state">{{ detailSimilarError }}</div>
                    <div class="detail-recommendation-rail">
                      <button
                        v-for="item in detailSimilarItems"
                        :key="item.id"
                        class="detail-recommendation-card"
                        @click="handleLibraryItemClick(item.id, item.title, item)"
                      >
                        <div class="detail-recommendation-poster media-image-frame" :class="{ 'has-image': !!pickPrimaryImage(item) }">
                          <img
                            v-if="pickPrimaryImage(item)"
                            :src="pickPrimaryImage(item)"
                            :alt="item.title"
                            @load="handleCardImageLoad"
                            @error="handleCardImageError"
                          />
                          <div class="media-card-placeholder media-image-placeholder">{{ item.title.slice(0, 1) }}</div>
                          <div v-if="item.childCount" class="detail-recommendation-count">{{ item.childCount }}</div>
                        </div>
                        <div class="detail-recommendation-title">{{ item.title }}</div>
                      </button>
                    </div>
                  </section>

                  <section v-if="detailDisplayedItem.externalLinks.length > 0" class="detail-section">
                    <div class="detail-section-header">
                      <h4>链接</h4>
                    </div>
                    <div class="detail-chip-row">
                      <a
                        v-for="link in detailDisplayedItem.externalLinks"
                        :key="link.url"
                        class="detail-chip-link"
                        :href="link.url"
                        @click.prevent="openExternalLink(link.url)"
                      >
                        <span class="detail-link-glyph">↗</span>
                        {{ link.title }}
                      </a>
                    </div>
                  </section>

                  <section v-if="selectedSourceOption?.mediaInfoCards.length || selectedSourceOption?.fileLabel || detailDisplayedItem.mediaInfoCards.length || detailDisplayedItem.fileLabel" class="detail-section">
                    <div class="detail-section-header">
                      <h4>媒体</h4>
                    </div>
                    <div class="detail-media-card-rail">
                      <div
                        v-for="card in detailMediaCards"
                        :key="card.id"
                        class="detail-media-card"
                        :class="{ selected: card.selected }"
                        @click="handleMediaInfoCardClick(card)"
                      >
                        <div v-if="card.selected" class="detail-media-card-selected-badge">
                          <i class="iconfont iconcheck" />
                        </div>
                        <div class="detail-media-card-title">
                          <div class="detail-media-card-heading">
                            <span class="detail-media-kind-badge">{{ card.kind === 'video' ? '影' : card.kind === 'audio' ? '声' : '字' }}</span>
                            <span>{{ card.title }}</span>
                          </div>
                        </div>
                        <div class="detail-media-card-body">
                          <div v-for="row in card.rows" :key="`${card.id}-${row.label}`" class="detail-media-row">
                            <span>{{ row.label }}</span>
                            <strong>{{ row.value }}</strong>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div v-if="selectedSourceOption?.fileLabel || detailDisplayedItem.fileLabel" class="detail-file-bar">
                      <div class="detail-file-name">{{ selectedSourceOption?.fileLabel || detailDisplayedItem.fileLabel }}</div>
                      <div v-if="selectedSourceOption?.fileSubLabel || detailDisplayedItem.fileSubLabel" class="detail-file-meta">{{ selectedSourceOption?.fileSubLabel || detailDisplayedItem.fileSubLabel }}</div>
                    </div>
                  </section>
                </div>
              </div>
            </template>
          </div>
        </template>

        <template v-else>
          <h3>后续页面骨架已预留</h3>
          <p>当前路由：{{ currentRoute.kind }}</p>
        </template>

        <a-modal
          v-model:visible="homeLibraryManagerVisible"
          title="媒体管理"
          width="760px"
          class="home-library-manager-modal"
          modal-class="home-library-manager-modal-shell"
          :mask-closable="false"
          :esc-to-close="false"
          @cancel="cancelHomeLibraryManager"
        >
          <div class="home-library-manager-panel">
            <div class="home-library-manager-hint">长按可拖动排序</div>
            <div class="home-library-manager-list">
              <div
                v-for="item in homeLibraryManagerDraft"
                :key="item.key"
                class="home-library-manager-item"
                :data-section-key="item.key"
                :class="{ dragging: draggingHomeLibraryId === item.key }"
                @dragenter.prevent
                @dragover.prevent
                @drop="handleHomeLibraryDrop(item.key)"
                @dragend="handleHomeLibraryDragEnd"
              >
                <a-checkbox
                  :model-value="item.visible"
                  @change="toggleHomeLibraryDraftVisible(item.key, $event)"
                >
                  {{ item.title }}
                </a-checkbox>
                <i
                  class="iconfont iconlist home-library-manager-drag-icon"
                  draggable="true"
                  title="拖动排序"
                  @mousedown.prevent="handleHomeLibraryPointerDragStart(item.key)"
                  @dragstart="handleHomeLibraryDragStart($event, item.key)"
                  @dragend="handleHomeLibraryDragEnd"
                />
              </div>
              <div v-if="homeLibraryManagerDraft.length === 0" class="home-library-manager-empty">
                当前服务器还没有可管理的媒体库
              </div>
            </div>
          </div>
          <template #footer>
            <div class="home-library-manager-footer">
              <a-button @click="cancelHomeLibraryManager">取消</a-button>
              <a-button type="primary" @click="saveHomeLibraryManager">保存</a-button>
            </div>
          </template>
        </a-modal>

        <a-modal
          v-model:visible="mediaInfoModalVisible"
          :footer="false"
          width="920px"
          class="detail-media-modal"
          title="媒体元数据"
        >
          <template v-if="activeMediaInfoCard">
            <div class="detail-media-modal-panel">
              <div class="detail-media-modal-head">
                <div class="detail-media-card-heading">
                  <span class="detail-media-kind-badge">{{ activeMediaInfoCard.kind === 'video' ? '影' : activeMediaInfoCard.kind === 'audio' ? '声' : '字' }}</span>
                  <span>{{ activeMediaInfoCard.title }}</span>
                </div>
                <i v-if="activeMediaInfoCard.selected" class="iconfont iconcheck" />
              </div>
              <div class="detail-media-modal-body">
                <div
                  v-for="row in activeMediaInfoCard.rows"
                  :key="`${activeMediaInfoCard.id}-${row.label}`"
                  class="detail-media-modal-row"
                >
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                </div>
              </div>
            </div>
          </template>
        </a-modal>

        <a-modal
          v-model:visible="serverIconManagerVisible"
          :footer="false"
          width="980px"
          class="server-icon-manager-modal"
        >
          <div class="server-icon-manager">
            <div class="server-icon-manager-header">
              <div>
                <div class="server-icon-manager-title">媒体服务器图标</div>
                <div class="server-icon-manager-subtitle">
                  导入图标集 URL，选择图标后会保存到本地并应用到当前媒体服务器
                </div>
              </div>
              <div class="server-icon-manager-actions">
                <a-input
                  v-model="serverIconSearchText"
                  allow-clear
                  class="server-icon-search"
                  placeholder="搜索图标集或图标"
                />
                <a-button type="outline" @click="openAddServerIconSetModal">添加图标集 URL</a-button>
              </div>
            </div>

            <div class="server-icon-manager-layout">
              <div class="server-icon-set-column">
                <div class="server-icon-column-heading">图标集</div>
                <div v-if="serverIconSetsLoading" class="server-icon-empty">
                  <a-spin size="small" />
                  <span>正在加载图标集…</span>
                </div>
                <div v-else-if="filteredServerIconSets.length === 0" class="server-icon-empty">
                  <span>{{ serverIconSetError || '还没有可用的图标集' }}</span>
                </div>
                <div v-else class="server-icon-set-list">
                  <button
                    v-for="iconSet in filteredServerIconSets"
                    :key="iconSet.id"
                    type="button"
                    class="server-icon-set-card"
                    :class="{ active: selectedServerIconSetId === iconSet.id }"
                    @click="selectedServerIconSetId = iconSet.id"
                  >
                    <div class="server-icon-set-preview">
                      <img v-if="iconSet.previewImageURL" :src="iconSet.previewImageURL" :alt="iconSet.name" />
                      <div v-else class="server-icon-set-preview-empty">图标</div>
                    </div>
                    <div class="server-icon-set-meta">
                      <strong>{{ iconSet.name }}</strong>
                      <span>{{ iconSet.description || '没有描述' }}</span>
                    </div>
                  </button>
                </div>
              </div>

              <div class="server-icon-grid-column">
                <div class="server-icon-grid-header">
                  <div>
                    <div class="server-icon-column-heading">{{ selectedServerIconSet?.name || '图标' }}</div>
                    <div v-if="selectedServerIconSet?.description" class="server-icon-grid-subtitle">
                      {{ selectedServerIconSet.description }}
                    </div>
                  </div>
                  <div class="server-icon-grid-tools">
                    <a-button
                      v-if="selectedServerIconSet"
                      type="text"
                      size="small"
                      @click="refreshServerIconSet(selectedServerIconSet)"
                    >
                      刷新图标集
                    </a-button>
                    <a-button
                      v-if="selectedServerIconSet"
                      type="text"
                      size="small"
                      status="danger"
                      @click="removeServerIconSet(selectedServerIconSet.id)"
                    >
                      删除图标集
                    </a-button>
                  </div>
                </div>
                <div v-if="!selectedServerIconSet" class="server-icon-empty">
                  <span>先在左侧选择一个图标集</span>
                </div>
                <div v-else-if="filteredSelectedServerIcons.length === 0" class="server-icon-empty">
                  <span>没有匹配的图标</span>
                </div>
                <div v-else class="server-icon-grid">
                  <button
                    v-for="icon in filteredSelectedServerIcons"
                    :key="icon.id"
                    type="button"
                    class="server-icon-item"
                    :class="{ active: icon.url === registry.currentServer?.customIconUrl }"
                    @click="applyCurrentServerIcon(icon.url)"
                  >
                    <div class="server-icon-item-preview">
                      <img :src="icon.url" :alt="icon.name" />
                    </div>
                    <span>{{ icon.name }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </a-modal>

        <a-modal
          v-model:visible="addServerIconSetVisible"
          :footer="false"
          width="560px"
          class="server-icon-add-modal"
        >
          <div class="server-icon-add-panel">
            <div class="server-icon-manager-title">添加图标集 URL</div>
            <div class="server-icon-manager-subtitle">
              远程 JSON 需要包含 `name`、`description` 和 `icons[{ name, url }]`
            </div>
            <a-input
              v-model="serverIconSetUrlInput"
              allow-clear
              class="server-icon-add-input"
              placeholder="https://example.com/iconset.json"
              @press-enter="submitServerIconSetUrl"
            />
            <div class="server-icon-add-footer">
              <a-button @click="addServerIconSetVisible = false">取消</a-button>
              <a-button type="primary" :loading="serverIconAdding" @click="submitServerIconSetUrl">导入图标集</a-button>
            </div>
          </div>
        </a-modal>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import MediaServerRegistryPanel from '../components/media-server/MediaServerRegistryPanel.vue'
import MediaServerPosterRow from '../components/media-server/home/MediaServerPosterRow.vue'
import MediaServerResumeRow from '../components/media-server/home/MediaServerResumeRow.vue'
import MediaServerStatsRow from '../components/media-server/home/MediaServerStatsRow.vue'
import jellyfinIcon from '../assets/media-server/jellyfin.svg'
import embyIcon from '../assets/media-server/emby.svg'
import plexIcon from '../assets/media-server/plex.svg'
import { getMediaServerDownloadInfo, getMediaServerPlaybackInfo, getMediaServerSimilarItems, updateMediaServerFavoriteState, updateMediaServerPlayedState } from '../media-server/contentGateway'
import { resolveMediaServerImage } from '../media-server/imageSources'
import { toMsCacheUrl } from '../media-server/imageCache'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import useMediaServerNavigationStore from '../store/mediaServerNavigation'
import type { MediaServerConfig, MediaServerType } from '../types/mediaServer'
import message from '../utils/message'
import { openExternal } from '../utils/electronhelper'
import { modalDownload } from '../utils/modal'
import useMediaServerContentStore from '../store/mediaServerContent'
import type { MediaServerCardItem, MediaServerHomeLibrarySection, MediaServerItemDetail, MediaServerLibraryNode, MediaServerMediaInfoCard, MediaServerSearchData, MediaServerSourceOption } from '../types/mediaServerContent'
import useMediaServerHomePreferencesStore, { type MediaServerPosterType } from '../store/mediaServerHomePreferences'
import useSettingStore from '../setting/settingstore'
import DownDAL from '../down/DownDAL'

const registry = useMediaServerRegistryStore()
const wrapCacheUrl = (url: string): string => toMsCacheUrl(registry.currentServer?.id, url)
const navigation = useMediaServerNavigationStore()
const content = useMediaServerContentStore()
const homePreferences = useMediaServerHomePreferencesStore()
const settingStore = useSettingStore()
const searchText = ref('')
const workspacePageRef = ref<HTMLElement | null>(null)
const HOME_LIBRARY_BATCH_SIZE = 3
const visibleHomeLibraryCount = ref(HOME_LIBRARY_BATCH_SIZE)
const selectedSeasonId = ref('')
const selectedEpisodeId = ref('')
const selectedSourceId = ref('')
const versionMenuVisible = ref(false)
const detailSimilarItems = ref<MediaServerLibraryNode[]>([])
const homeLibraryManagerVisible = ref(false)
const draggingHomeLibraryId = ref('')
type HomeSectionKind = 'resume' | 'nextup' | 'latest' | 'library'
type HomeSectionDescriptor = {
  key: string
  id: string
  title: string
  kind: HomeSectionKind
  library?: MediaServerHomeLibrarySection
}
const homeLibraryManagerDraft = ref<Array<{ key: string; title: string; visible: boolean }>>([])
const detailSimilarLoading = ref(false)
const detailSimilarError = ref('')
const mediaInfoModalVisible = ref(false)
const activeMediaInfoCard = ref<MediaServerMediaInfoCard | null>(null)
const selectedAudioStreamIndex = ref<number>(-1)
const selectedSubtitleStreamIndex = ref<number>(-1)
const detailLogoLoadFailed = ref(false)
const MEDIA_SERVER_PLAYLIST_KEY = 'MediaServer_Playlist'
const MEDIA_SERVER_ICON_SET_URLS_KEY = 'MediaServer_IconSetUrls'
const MEDIA_SERVER_PRIMARY_LINE_KEY = '__primary__'
const playlistIds = ref<string[]>([])
const serverIconManagerVisible = ref(false)
const addServerIconSetVisible = ref(false)
const serverIconSearchText = ref('')
const serverIconSetUrlInput = ref('')
const serverIconSetsLoading = ref(false)
const serverIconAdding = ref(false)
const serverIconSetError = ref('')
const serverIconSetUrls = ref<string[]>([])
const selectedServerIconSetId = ref('')
let homeRefreshTimer: ReturnType<typeof setInterval> | null = null

type MediaServerIconSetPayload = {
  name: string
  description: string
  icons: Array<{ name: string; url: string }>
}

type MediaServerIconSet = {
  id: string
  sourceUrl: string
  name: string
  description: string
  previewImageURL: string
  icons: Array<{ id: string; name: string; url: string }>
}

const serverIconSets = ref<MediaServerIconSet[]>([])

const readLocalIdList = (key: string) => {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const writeLocalIdList = (key: string, items: string[]) => {
  localStorage.setItem(key, JSON.stringify(items))
}

playlistIds.value = readLocalIdList(MEDIA_SERVER_PLAYLIST_KEY)
serverIconSetUrls.value = readLocalIdList(MEDIA_SERVER_ICON_SET_URLS_KEY)

const currentRoute = computed(() => navigation.currentRoute)
const normalizeServerHost = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl)
    return url.host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '')
  }
}
const currentServerLineOptions = computed(() => registry.currentServerLineOptions)
const currentServerLineLabel = computed(() => registry.currentServerLineLabel)
const currentServerLineKey = computed(() => {
  const selectedLineName = registry.currentServerRecord?.selectedLineName || ''
  return selectedLineName || MEDIA_SERVER_PRIMARY_LINE_KEY
})
const providerIconByType = (type: MediaServerType) => {
  if (type === 'jellyfin') return jellyfinIcon
  if (type === 'emby') return embyIcon
  return plexIcon
}
const serverDisplayIcon = (server?: MediaServerConfig) => server?.customIconUrl || providerIconByType(server?.type || 'jellyfin')
const serverLineOptions = (server: MediaServerConfig) => {
  const options = [{
    key: MEDIA_SERVER_PRIMARY_LINE_KEY,
    name: '主线路',
    url: server.baseUrl
  }]
  for (const [name, url] of Object.entries(server.backupAddresses || {})) {
    if (!url) continue
    options.push({ key: name, name, url })
  }
  return options
}
const hasServerBackupLines = (server: MediaServerConfig) => serverLineOptions(server).length > 1
const isServerLineActive = (serverId: string, lineKey: string) => {
  return registry.currentServer?.id === serverId && currentServerLineKey.value === lineKey
}
const currentHome = computed(() => {
  const serverId = registry.currentServer?.id || ''
  return content.currentHomeData(serverId)
})
const currentHomeSectionLoading = computed(() => {
  const serverId = registry.currentServer?.id || ''
  return {
    resume: !!content.homeSectionLoading[`${serverId}:resume`],
    latest: !!content.homeSectionLoading[`${serverId}:latest`],
    nextUp: !!content.homeSectionLoading[`${serverId}:nextup`]
  }
})
const currentHomeSectionError = computed(() => {
  const serverId = registry.currentServer?.id || ''
  return {
    resume: content.homeSectionError[`${serverId}:resume`] || '',
    latest: content.homeSectionError[`${serverId}:latest`] || '',
    nextUp: content.homeSectionError[`${serverId}:nextup`] || ''
  }
})
const currentHomeLibrarySectionLoading = (libraryId: string) => {
  const serverId = registry.currentServer?.id || ''
  return !!content.homeLibrarySectionLoading[`${serverId}:library:${libraryId}`]
}
const currentHomeLibrarySectionError = (libraryId: string) => {
  const serverId = registry.currentServer?.id || ''
  return content.homeSectionError[`${serverId}:library:${libraryId}`] || ''
}
const orderedHomeLibraries = computed<MediaServerHomeLibrarySection[]>(() => {
  const order = homePreferences.homeLibraryOrder || []
  const orderIndex = new Map(order.map((id, index) => [id, index]))
  return currentHome.value.libraries
    .map((library, index) => ({ library, index }))
    .sort((left, right) => {
      const leftOrder = orderIndex.has(left.library.id) ? orderIndex.get(left.library.id)! : Number.MAX_SAFE_INTEGER
      const rightOrder = orderIndex.has(right.library.id) ? orderIndex.get(right.library.id)! : Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.index - right.index
    })
    .map(({ library }) => library)
})
const enabledHomeLibraries = computed(() => {
  const hidden = new Set(homePreferences.hiddenHomeLibraryIds || [])
  return orderedHomeLibraries.value.filter((library) => !hidden.has(library.id))
})
const visibleHomeLibraries = computed(() => enabledHomeLibraries.value)
const homeLibrariesHasMore = computed(() => false)
const homeSectionDescriptors = computed<HomeSectionDescriptor[]>(() => [
  { key: 'resume', id: 'resume', title: '继续观看', kind: 'resume' },
  { key: 'nextup', id: 'nextup', title: '下一集', kind: 'nextup' },
  { key: 'latest', id: 'latest', title: '最近添加', kind: 'latest' },
  ...orderedHomeLibraries.value.map((library) => ({
    key: `library:${library.id}`,
    id: library.id,
    title: library.title,
    kind: 'library' as const,
    library
  }))
])
const orderedHomeSections = computed(() => {
  const order = homePreferences.homeSectionOrder || []
  const orderIndex = new Map(order.map((key, index) => [key, index]))
  return homeSectionDescriptors.value
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftOrder = orderIndex.has(left.section.key) ? orderIndex.get(left.section.key)! : Number.MAX_SAFE_INTEGER
      const rightOrder = orderIndex.has(right.section.key) ? orderIndex.get(right.section.key)! : Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.index - right.index
    })
    .map(({ section }) => section)
})
const visibleHomeSections = computed(() => {
  const hiddenSections = new Set(homePreferences.hiddenHomeSectionIds || [])
  const visibleLibraryIds = new Set(visibleHomeLibraries.value.map((library) => library.id))
  return orderedHomeSections.value.filter((section) => {
    if (hiddenSections.has(section.key)) return false
    if (section.kind === 'latest' && !homePreferences.showRecentlyAdded) return false
    if (section.kind === 'library') return !!section.library && visibleLibraryIds.has(section.library.id)
    return true
  })
})
const homePosterMode = computed<MediaServerPosterType>(() => {
  const libraryPoster = homePreferences.latestInLibraryPosterType
  if (libraryPoster === 'landscape') return 'landscape'
  if (homePreferences.recentlyAddedPosterType === 'landscape') return 'landscape'
  if (homePreferences.nextUpPosterType === 'landscape') return 'landscape'
  return 'portrait'
})
const currentLibraryItems = computed<MediaServerLibraryNode[]>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return []
  if (currentRoute.value.kind === 'library-root') {
    return content.currentLibraryRoot(serverId)
  }
  if (currentRoute.value.kind === 'library-page') {
    return content.currentPagedLibrary(`${serverId}:${currentRoute.value.libraryId}`).items
  }
  if (currentRoute.value.kind === 'genre-page') {
    return content.currentPagedLibrary(`${serverId}:genre:${currentRoute.value.genre}`).items
  }
  if (currentRoute.value.kind === 'studio-page') {
    return content.currentPagedLibrary(`${serverId}:studio:${currentRoute.value.studio}`).items
  }
  return []
})
const currentPagedLibrary = computed(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) {
    return { key: '', items: [], total: 0, currentPage: -1, hasNextPage: true }
  }
  if (currentRoute.value.kind === 'library-page') {
    return content.currentPagedLibrary(`${serverId}:${currentRoute.value.libraryId}`)
  }
  if (currentRoute.value.kind === 'genre-page') {
    return content.currentPagedLibrary(`${serverId}:genre:${currentRoute.value.genre}`)
  }
  if (currentRoute.value.kind === 'studio-page') {
    return content.currentPagedLibrary(`${serverId}:studio:${currentRoute.value.studio}`)
  }
  return { key: '', items: [], total: 0, currentPage: -1, hasNextPage: true }
})
const currentLibraryPageLoading = computed(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return false
  if (currentRoute.value.kind === 'library-page') return !!content.libraryPageLoading[`${serverId}:${currentRoute.value.libraryId}`]
  if (currentRoute.value.kind === 'genre-page') return !!content.libraryPageLoading[`${serverId}:genre:${currentRoute.value.genre}`]
  if (currentRoute.value.kind === 'studio-page') return !!content.libraryPageLoading[`${serverId}:studio:${currentRoute.value.studio}`]
  return false
})
const currentLibraryError = computed(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return ''
  if (currentRoute.value.kind === 'library-page') {
    return content.libraryPageError[`${serverId}:${currentRoute.value.libraryId}`] || ''
  }
  if (currentRoute.value.kind === 'genre-page') {
    return content.libraryPageError[`${serverId}:genre:${currentRoute.value.genre}`] || ''
  }
  if (currentRoute.value.kind === 'studio-page') {
    return content.libraryPageError[`${serverId}:studio:${currentRoute.value.studio}`] || ''
  }
  return content.libraryError
})
const showInitialLibraryLoading = computed(() => {
  if (currentRoute.value.kind === 'library-root') return content.loadingLibrary && currentLibraryItems.value.length === 0
  if (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page') {
    return currentLibraryPageLoading.value && currentLibraryItems.value.length === 0
  }
  return false
})
const currentDetail = computed<MediaServerItemDetail | undefined>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return undefined
  if (currentRoute.value.kind === 'item-detail') {
    return content.currentItemDetail(`${serverId}:${currentRoute.value.itemId}`)
  }
  if (currentRoute.value.kind === 'person-page') {
    return content.currentItemDetail(`${serverId}:${currentRoute.value.personId}`)
  }
  return undefined
})
const showDetailLoadingState = computed(() => content.loadingDetail && !currentDetail.value)
const showDetailErrorState = computed(() => !!content.detailError && !currentDetail.value)
const detailChildren = computed<MediaServerLibraryNode[]>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return []
  if (currentRoute.value.kind === 'item-detail') {
    return content.currentLibraryPage(`${serverId}:${currentRoute.value.itemId}`)
  }
  if (currentRoute.value.kind === 'person-page') {
    return content.currentLibraryPage(`${serverId}:${currentRoute.value.personId}`)
  }
  return []
})
const normalizedSearchQuery = computed(() => currentRoute.value.kind === 'search' ? (currentRoute.value.query || '').trim() : '')
const currentSearch = computed<MediaServerSearchData>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId || currentRoute.value.kind !== 'search') return { query: '', items: [] }
  return content.currentSearchData(`${serverId}:${normalizedSearchQuery.value}`)
})
const currentSearchSuggestions = computed<MediaServerLibraryNode[]>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId) return []
  return content.currentSearchSuggestions(serverId)
})
const searchSuggestionItems = computed<MediaServerLibraryNode[]>(() => {
  const seriesItems = currentSearchSuggestions.value.filter((item) => item.kind === 'series')
  return seriesItems.length > 0 ? seriesItems : currentSearchSuggestions.value
})
const searchMovieItems = computed<MediaServerLibraryNode[]>(() => currentSearch.value.items.filter((item) => item.kind === 'movie'))
const searchSeriesItems = computed<MediaServerLibraryNode[]>(() => currentSearch.value.items.filter((item) => item.kind === 'series'))
const searchEpisodeItems = computed<MediaServerLibraryNode[]>(() => currentSearch.value.items.filter((item) => item.kind === 'episode' || item.kind === 'season'))
const searchPersonItems = computed<MediaServerLibraryNode[]>(() => currentSearch.value.items.filter((item) => item.kind === 'person' || (item.kind === 'unknown' && !item.childCount)))
const currentCollection = computed(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId || currentRoute.value.kind !== 'collection-page') {
    return {
      key: '',
      items: [],
      total: 0,
      currentPage: -1,
      hasNextPage: true
    }
  }
  const kind = currentRoute.value.collectionId === 'home:latest' ? 'latest' : 'nextup'
  return content.currentCollection(`${serverId}:${kind}`)
})
const currentCollectionItems = computed<MediaServerLibraryNode[]>(() => currentCollection.value.items)
const currentCollectionLoading = computed(() => {
  const serverId = registry.currentServer?.id || ''
  const kind = currentCollectionKind.value
  if (!serverId || !kind) return false
  return !!content.collectionLoading[`${serverId}:${kind}`]
})
const currentCollectionError = computed(() => {
  const serverId = registry.currentServer?.id || ''
  const kind = currentCollectionKind.value
  if (!serverId || !kind) return ''
  return content.collectionPageError[`${serverId}:${kind}`] || ''
})
const currentCollectionKind = computed<'latest' | 'nextup' | null>(() => {
  if (currentRoute.value.kind !== 'collection-page') return null
  if (currentRoute.value.collectionId === 'home:latest') return 'latest'
  if (currentRoute.value.collectionId === 'home:nextup') return 'nextup'
  return null
})
const currentListingPosterType = computed(() => {
  if (currentRoute.value.kind === 'collection-page') {
    return currentCollectionKind.value === 'nextup'
      ? homePreferences.nextUpPosterType
      : homePreferences.recentlyAddedPosterType
  }
  if (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page') {
    return homePreferences.latestInLibraryPosterType
  }
  return 'portrait' as const
})
const currentListingBrowseMode = computed(() => {
  if (currentRoute.value.kind === 'collection-page') return homePreferences.collectionBrowseMode
  if (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page') {
    return homePreferences.latestInLibraryBrowseMode
  }
  return 'grid' as const
})
const listingShellClass = computed(() => [
  currentListingPosterType.value === 'portrait' ? 'library-shell-portrait' : 'library-shell-landscape',
  currentListingBrowseMode.value === 'list' ? 'library-shell-list' : 'library-shell-grid'
])
const listingCardClass = computed(() => [
  currentListingPosterType.value === 'portrait' ? 'library-card-portrait' : 'library-card-landscape',
  currentListingBrowseMode.value === 'list' ? 'library-card-list' : 'library-card-grid'
])
const currentPanelLabel = computed(() => {
  switch (currentRoute.value.kind) {
    case 'home': return '主页'
    case 'search': return '搜索'
    case 'library-root':
    case 'library-page':
    case 'genre-page':
    case 'studio-page': return '媒体库'
    case 'collection-page': return currentRoute.value.title || '集合'
    case 'registry': return '管理服务器'
    default: return '媒体服务器'
  }
})
const currentBackLabel = computed(() => {
  if (currentRoute.value.kind === 'item-detail') {
    return detailDisplayedItem.value.title || currentRoute.value.title || '返回'
  }
  if (currentRoute.value.kind === 'library-page') return currentRoute.value.title || '媒体库'
  if (currentRoute.value.kind === 'studio-page') return currentRoute.value.title || '工作室'
  if (currentRoute.value.kind === 'collection-page') return currentRoute.value.title || '列表'
  if (currentRoute.value.kind === 'person-page') return currentDetail.value?.title || currentRoute.value.title || '人物'
  if (currentRoute.value.kind === 'genre-page') return currentRoute.value.title || '类型'
  return registry.currentServer?.name || '返回'
})
const normalizedServerIconSearchText = computed(() => serverIconSearchText.value.trim().toLowerCase())
const iconSetMatchesSearch = (iconSet: MediaServerIconSet, keyword: string) => {
  if (!keyword) return true
  if (iconSet.name.toLowerCase().includes(keyword) || iconSet.description.toLowerCase().includes(keyword)) return true
  return iconSet.icons.some((icon) => icon.name.toLowerCase().includes(keyword))
}
const filteredServerIconSets = computed(() => {
  const keyword = normalizedServerIconSearchText.value
  return serverIconSets.value.filter((iconSet) => iconSetMatchesSearch(iconSet, keyword))
})
const selectedServerIconSet = computed(() => {
  if (!serverIconSets.value.length) return undefined
  return serverIconSets.value.find((iconSet) => iconSet.id === selectedServerIconSetId.value) || serverIconSets.value[0]
})
const filteredSelectedServerIcons = computed(() => {
  const iconSet = selectedServerIconSet.value
  if (!iconSet) return []
  const keyword = normalizedServerIconSearchText.value
  if (!keyword) return iconSet.icons
  return iconSet.icons.filter((icon) => icon.name.toLowerCase().includes(keyword))
})

const upscaleHeroImageUrl = (value?: string) => {
  if (!value) return ''
  try {
    const url = new URL(value)
    url.searchParams.set('quality', '80')
    url.searchParams.set('maxWidth', '3840')
    url.searchParams.set('maxHeight', '2160')
    return url.toString()
  } catch {
    return value
  }
}

const pickPrimaryImage = (item?: MediaServerCardItem | MediaServerLibraryNode | MediaServerItemDetail) => {
  if (!item) return ''
  const url = item.images?.primary || (item.kind === 'person' ? item.images?.profile : '') || ''
  return wrapCacheUrl(url)
}

const pickPersonImage = (item?: MediaServerCardItem | MediaServerLibraryNode | MediaServerItemDetail) => {
  return wrapCacheUrl(resolveMediaServerImage(item, 'person'))
}

const pickLandscapeImage = (item?: MediaServerCardItem | MediaServerLibraryNode | MediaServerItemDetail) => {
  return wrapCacheUrl(resolveMediaServerImage(item, 'landscape'))
}

const pickEpisodeStillImage = (item?: MediaServerCardItem | MediaServerLibraryNode | MediaServerItemDetail) => {
  return wrapCacheUrl(resolveMediaServerImage(item, 'episode-still'))
}

const fallbackEpisodeOrderValue = (item: MediaServerLibraryNode, key: 'season' | 'episode') => {
  const title = item.title || ''
  const match = title.match(/S(\d+)E(\d+)/i)
  if (match) return Number.parseInt(key === 'season' ? match[1] : match[2], 10)
  if (key === 'episode') {
    const chineseEpisodeMatch = title.match(/第\s*(\d+)\s*集/)
    if (chineseEpisodeMatch) return Number.parseInt(chineseEpisodeMatch[1], 10)
  }
  return Number.MAX_SAFE_INTEGER
}

const compareSeasonItems = (left: MediaServerLibraryNode, right: MediaServerLibraryNode) => {
  const leftSeason = left.seasonNumber ?? fallbackEpisodeOrderValue(left, 'season')
  const rightSeason = right.seasonNumber ?? fallbackEpisodeOrderValue(right, 'season')
  if (leftSeason !== rightSeason) return leftSeason - rightSeason
  return left.title.localeCompare(right.title, 'zh-Hans-CN-u-kn-true')
}

const compareEpisodeItems = (left: MediaServerLibraryNode, right: MediaServerLibraryNode) => {
  const leftSeason = left.seasonNumber ?? fallbackEpisodeOrderValue(left, 'season')
  const rightSeason = right.seasonNumber ?? fallbackEpisodeOrderValue(right, 'season')
  if (leftSeason !== rightSeason) return leftSeason - rightSeason

  const leftEpisode = left.episodeNumber ?? fallbackEpisodeOrderValue(left, 'episode')
  const rightEpisode = right.episodeNumber ?? fallbackEpisodeOrderValue(right, 'episode')
  if (leftEpisode !== rightEpisode) return leftEpisode - rightEpisode

  return left.title.localeCompare(right.title, 'zh-Hans-CN-u-kn-true')
}

const pickLibraryListingImage = (item?: MediaServerLibraryNode) => {
  if (!item) return ''
  if (currentRoute.value.kind === 'library-root') return pickPrimaryImage(item) || pickLandscapeImage(item)
  return currentListingPosterType.value === 'landscape'
    ? pickLandscapeImage(item)
    : pickPrimaryImage(item)
}

const pickCollectionListingImage = (item?: MediaServerLibraryNode) => {
  if (!item) return ''
  return currentListingPosterType.value === 'landscape'
    ? pickLandscapeImage(item)
    : pickPrimaryImage(item)
}

const handleCardImageError = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.add('is-broken')
}

const handleCardImageLoad = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.remove('is-broken')
}

const handleBackdropImageError = (event: Event) => {
  const target = event.target as HTMLImageElement | null
  if (target) {
    target.style.display = 'none'
  }
}

const detailBackdropUrl = computed(() => {
  if (!currentDetail.value) return ''
  return wrapCacheUrl(upscaleHeroImageUrl(currentDetail.value.images?.backdrop))
})

const detailHeroPosterImage = computed(() => {
  const detailImage = pickPrimaryImage(currentDetail.value)
  if (detailImage) return detailImage
  return pickPrimaryImage(detailDisplayedItem.value)
})

const detailLogoUrl = computed(() => {
  if (!currentDetail.value || detailLogoLoadFailed.value) return ''
  return wrapCacheUrl(resolveMediaServerImage(currentDetail.value, 'logo'))
})

const handleDetailLogoError = () => {
  detailLogoLoadFailed.value = true
}

const detailSeasonMenu = computed<MediaServerLibraryNode[]>(() => {
  if (!currentDetail.value) return []
  if (currentDetail.value.kind !== 'series') return []
  return [...detailChildren.value.filter((item) => item.kind === 'season')].sort(compareSeasonItems)
})

const selectedDetailSeason = computed(() => detailSeasonMenu.value.find((season) => season.id === selectedSeasonId.value))
const activeDetailSeason = computed(() => selectedDetailSeason.value || detailSeasonMenu.value[0])

const detailEpisodeItems = computed<MediaServerLibraryNode[]>(() => {
  const serverId = registry.currentServer?.id || ''
  if (!serverId || !currentDetail.value) return []
  if (currentDetail.value.kind === 'series') {
    const season = activeDetailSeason.value
    if (season) {
      return [...content.currentLibraryPage(`${serverId}:${season.id}`).filter((item) => item.kind === 'episode')].sort(compareEpisodeItems)
    }
    return [...detailChildren.value.filter((item) => item.kind === 'episode')].sort(compareEpisodeItems)
  }
  if (currentDetail.value.kind === 'season') {
    return [...detailChildren.value.filter((item) => item.kind === 'episode')].sort(compareEpisodeItems)
  }
  return []
})

const pickDetailEpisodeCardImage = (item?: MediaServerLibraryNode) => {
  if (!item) return ''
  return pickEpisodeStillImage(item)
    || pickLandscapeImage(item)
    || pickPrimaryImage(item)
    || pickLandscapeImage(activeDetailSeason.value)
    || pickPrimaryImage(activeDetailSeason.value)
    || pickLandscapeImage(currentDetail.value)
    || pickPrimaryImage(currentDetail.value)
}

const detailDisplayedItem = computed<MediaServerItemDetail>(() => {
  const base = currentDetail.value
  const serverId = registry.currentServer?.id || ''
  if (!base || !serverId || (currentRoute.value.kind !== 'item-detail' && currentRoute.value.kind !== 'person-page')) {
    return {
      id: '',
      serverId: '',
      provider: 'jellyfin',
      kind: 'unknown',
      title: '',
      genres: [],
      studios: [],
      people: [],
      productionLocations: [],
      externalLinks: [],
      mediaInfoCards: [],
      sourceOptions: []
    }
  }

  const routeItemId = currentRoute.value.kind === 'item-detail' ? currentRoute.value.itemId : currentRoute.value.personId
  const activeId = selectedEpisodeId.value || routeItemId
  if (!activeId || activeId === routeItemId) return base

  const resolved = content.currentItemDetail(`${serverId}:${activeId}`)
  if (resolved) return resolved

  const fallback = detailEpisodeItems.value.find((item) => item.id === activeId)
  if (!fallback) return base

  return {
    ...base,
    ...fallback
  }
})

const detailSourceOptions = computed<MediaServerSourceOption[]>(() => detailDisplayedItem.value.sourceOptions || [])

const selectedSourceOption = computed<MediaServerSourceOption | undefined>(() => {
  if (!detailSourceOptions.value.length) return undefined
  return detailSourceOptions.value.find((source) => source.id === selectedSourceId.value) || detailSourceOptions.value[0]
})

const detailMediaCards = computed<MediaServerMediaInfoCard[]>(() => {
  const cards = selectedSourceOption.value?.mediaInfoCards?.length
    ? selectedSourceOption.value.mediaInfoCards
    : detailDisplayedItem.value.mediaInfoCards
  return cards.map((card) => {
    let selected = !!card.selected
    if (card.kind === 'audio') {
      selected = selectedAudioStreamIndex.value >= 0
        ? card.streamIndex === selectedAudioStreamIndex.value
        : !!card.selected
    } else if (card.kind === 'subtitle') {
      selected = selectedSubtitleStreamIndex.value >= 0
        ? card.streamIndex === selectedSubtitleStreamIndex.value
        : !!card.selected
    }
    return {
      ...card,
      selected
    }
  })
})

const selectSourceOption = (sourceId: string) => {
  selectedSourceId.value = sourceId
  versionMenuVisible.value = false
}

const detailIsWatched = computed(() => detailDisplayedItem.value.isPlayed === true)
const detailIsFavorite = computed(() => detailDisplayedItem.value.isFavorite === true)
const detailInPlaylist = computed(() => !!detailDisplayedItem.value.id && playlistIds.value.includes(detailDisplayedItem.value.id))

const detailPlayLabel = computed(() => {
  const match = detailDisplayedItem.value.title.match(/S(\d+)E(\d+)/i)
  if (match) return `S${match[1]} • E${match[2]}`
  if (detailDisplayedItem.value.kind === 'episode') return '继续播放'
  return '开始播放'
})

type DetailDownloadScope = 'current' | 'season' | 'series'

const detailDownloadOptions = computed<Array<{ key: DetailDownloadScope; label: string; description?: string }>>(() => {
  const item = detailDisplayedItem.value
  if (!item.id) return []
  if (currentDetail.value?.kind === 'series') {
    return [
      { key: 'current', label: item.kind === 'episode' ? '下载当前集' : '下载当前选择', description: item.title },
      { key: 'season', label: '下载当前季', description: activeDetailSeason.value?.title || detailSeasonTitle.value },
      { key: 'series', label: '下载整部剧集', description: currentDetail.value.title }
    ]
  }
  if (currentDetail.value?.kind === 'season') {
    return [
      { key: 'current', label: item.kind === 'episode' ? '下载当前集' : '下载当前选择', description: item.title },
      { key: 'season', label: '下载本季', description: currentDetail.value.title }
    ]
  }
  return [{ key: 'current', label: '下载', description: item.title }]
})

const currentOverviewText = computed(() => detailDisplayedItem.value.overview || currentDetail.value?.overview || '')

const detailEpisodeHeading = computed(() => {
  if (!currentDetail.value) return ''
  if (detailDisplayedItem.value.id === currentDetail.value.id) return ''
  if (detailDisplayedItem.value.kind === 'episode') {
    return detailEpisodeLocator(detailDisplayedItem.value)
  }
  return detailDisplayedItem.value.title
})

const detailGenreLine = computed(() => {
  return detailGenres.value.slice(0, 4).join(' · ')
})

const detailGenres = computed(() => {
  if (detailDisplayedItem.value.genres?.length) return detailDisplayedItem.value.genres
  return currentDetail.value?.genres || []
})

const detailStudios = computed(() => {
  if (detailDisplayedItem.value.studios?.length) return detailDisplayedItem.value.studios
  return currentDetail.value?.studios || []
})

const detailPeople = computed(() => {
  if (detailDisplayedItem.value.people?.length) return detailDisplayedItem.value.people
  return currentDetail.value?.people || []
})

const detailTechnicalLine = computed(() => {
  const parts: string[] = []
  if (detailDisplayedItem.value.year) parts.push(`${detailDisplayedItem.value.year}`)
  if (detailDisplayedItem.value.runtimeMinutes) parts.push(`${detailDisplayedItem.value.runtimeMinutes}分钟`)
  if (detailDisplayedItem.value.kind === 'episode') parts.push('播出')
  if (currentDetail.value?.kind === 'series' && detailSeasonMenu.value.length > 0) parts.push(`共${detailSeasonMenu.value.length}季`)
  const videoCard = detailDisplayedItem.value.mediaInfoCards.find((card) => card.kind === 'video')
  const resolution = videoCard?.rows.find((row) => row.label === '分辨率')?.value
  if (resolution?.includes('3840') || resolution?.includes('2160')) parts.push('4K')
  else if (resolution) parts.push(resolution.split('x')[1] ? `${resolution.split('x')[1]}P` : resolution)
  const range = videoCard?.rows.find((row) => row.label === 'Video range')?.value
  if (range) parts.push(range)
  const bitrate = videoCard?.rows.find((row) => row.label === '比特率')?.value
  if (bitrate) parts.push(bitrate.replace('Mbps', 'M').replace('kbps', 'K'))
  return parts.join('  ')
})

const detailMetaBadges = computed(() => {
  const badges: string[] = []
  if (detailDisplayedItem.value.officialRating) badges.push(detailDisplayedItem.value.officialRating)
  if (detailDisplayedItem.value.mediaInfoCards.some((card) => card.kind === 'video')) badges.push('HD')
  const channels = detailDisplayedItem.value.mediaInfoCards
    .find((card) => card.kind === 'audio')
    ?.rows.find((row) => row.label === 'Channels')?.value
  if (channels) badges.push(channels === '6' ? '5.1' : channels)
  if (detailDisplayedItem.value.mediaInfoCards.some((card) => card.kind === 'subtitle')) badges.push('CC')
  return badges
})

const detailSeasonTitle = computed(() => {
  if (activeDetailSeason.value) return activeDetailSeason.value.title
  if (currentDetail.value?.kind === 'season') return currentDetail.value.title
  return '内容'
})

const personBackdropUrl = computed(() => {
  if (currentRoute.value.kind !== 'person-page') return ''
  const childBackdrop = detailChildren.value.find((item) => pickLandscapeImage(item) || pickPrimaryImage(item))
  const rawUrl = resolveMediaServerImage(childBackdrop, 'hero')
    || resolveMediaServerImage(currentDetail.value, 'hero')
    || resolveMediaServerImage(childBackdrop, 'landscape')
    || resolveMediaServerImage(currentDetail.value, 'landscape')
    || resolveMediaServerImage(childBackdrop, 'portrait')
    || resolveMediaServerImage(currentDetail.value, 'portrait')
  return wrapCacheUrl(upscaleHeroImageUrl(rawUrl))
})

const personContentSections = computed(() => {
  if (currentRoute.value.kind !== 'person-page') return []
  const grouped = new Map<string, { key: string; title: string; type: 'poster' | 'episode'; items: MediaServerLibraryNode[] }>()
  const getSectionMeta = (item: MediaServerLibraryNode) => {
    if (item.kind === 'episode') return { key: 'episode', title: '单集', type: 'episode' as const }
    if (item.kind === 'movie') return { key: 'movie', title: '电影', type: 'poster' as const }
    if (item.kind === 'series') return { key: 'series', title: '电视剧', type: 'poster' as const }
    if (item.kind === 'season') return { key: 'season', title: '季', type: 'poster' as const }
    return { key: 'other', title: '作品', type: 'poster' as const }
  }
  for (const item of detailChildren.value) {
    const meta = getSectionMeta(item)
    if (!grouped.has(meta.key)) grouped.set(meta.key, { ...meta, items: [] })
    grouped.get(meta.key)!.items.push(item)
  }
  return Array.from(grouped.values()).filter((section) => section.items.length > 0)
})

const orderedPersonSections = computed(() => {
  const sections = [...personContentSections.value]
  const ordered: Array<{
    key: string
    title: string
    type: 'poster' | 'episode'
    items: MediaServerLibraryNode[]
  }> = []

  const take = (key: string) => {
    const index = sections.findIndex((section) => section.key === key)
    if (index >= 0) ordered.push(sections.splice(index, 1)[0])
  }

  take('movie')
  take('episode')
  take('series')
  take('season')
  take('other')

  return ordered
})

const personAgeLabel = computed(() => {
  if (!currentDetail.value?.birthday) return ''
  const birth = new Date(currentDetail.value.birthday.replace(/\//g, '-'))
  const death = currentDetail.value.deathDate ? new Date(currentDetail.value.deathDate.replace(/\//g, '-')) : new Date()
  if (Number.isNaN(birth.getTime()) || Number.isNaN(death.getTime())) return currentDetail.value.birthday
  let age = death.getFullYear() - birth.getFullYear()
  const beforeBirthday = death.getMonth() < birth.getMonth() || (death.getMonth() === birth.getMonth() && death.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return `${age} 岁`
})

const openPersonSection = (section: { title: string; items: MediaServerLibraryNode[]; type: 'poster' | 'episode' }) => {
  if (!section.items.length) return
  const keyword = section.title === '剧集' ? currentDetail.value?.title || section.title : section.title
  searchText.value = keyword
  navigation.goSearch(keyword)
  void loadCurrentSearch(true)
}

const serverTypeLabel = (type: MediaServerType) => {
  if (type === 'jellyfin') return 'Jellyfin'
  if (type === 'emby') return 'Emby'
  return 'Plex'
}

const selectFirstAvailableServerIconSet = () => {
  if (!selectedServerIconSetId.value || !serverIconSets.value.some((iconSet) => iconSet.id === selectedServerIconSetId.value)) {
    selectedServerIconSetId.value = serverIconSets.value[0]?.id || ''
  }
}

const normalizeServerIconSet = (sourceUrl: string, payload: MediaServerIconSetPayload): MediaServerIconSet => ({
  id: sourceUrl,
  sourceUrl,
  name: payload.name?.trim() || '未命名图标集',
  description: payload.description?.trim() || '',
  previewImageURL: payload.icons[0]?.url || '',
  icons: (payload.icons || [])
    .filter((icon) => typeof icon?.url === 'string' && icon.url.trim())
    .map((icon, index) => ({
      id: `${sourceUrl}#${index}`,
      name: icon.name?.trim() || `图标 ${index + 1}`,
      url: icon.url.trim()
    }))
})

const loadServerIconSetFromUrl = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as MediaServerIconSetPayload
  if (!payload || !Array.isArray(payload.icons)) throw new Error('图标集格式不正确')
  const iconSet = normalizeServerIconSet(sourceUrl, payload)
  if (!iconSet.icons.length) throw new Error('图标集里没有可用图标')
  return iconSet
}

const loadAllServerIconSets = async () => {
  if (!serverIconSetUrls.value.length) {
    serverIconSets.value = []
    selectedServerIconSetId.value = ''
    return
  }
  serverIconSetsLoading.value = true
  serverIconSetError.value = ''
  const loaded: MediaServerIconSet[] = []
  for (const sourceUrl of serverIconSetUrls.value) {
    try {
      loaded.push(await loadServerIconSetFromUrl(sourceUrl))
    } catch (error: any) {
      console.error(`failed to load media server icon set from ${sourceUrl}`, error)
      serverIconSetError.value = `部分图标集加载失败：${error?.message || '未知错误'}`
    }
  }
  serverIconSets.value = loaded
  selectFirstAvailableServerIconSet()
  serverIconSetsLoading.value = false
}

const openServerIconManager = () => {
  serverIconManagerVisible.value = true
}

const openAddServerIconSetModal = () => {
  addServerIconSetVisible.value = true
}

const submitServerIconSetUrl = async () => {
  const sourceUrl = serverIconSetUrlInput.value.trim()
  if (!sourceUrl) {
    message.error('先输入图标集 URL')
    return
  }
  if (serverIconSetUrls.value.includes(sourceUrl)) {
    message.info('这个图标集已经导入过了')
    addServerIconSetVisible.value = false
    serverIconSetUrlInput.value = ''
    return
  }
  serverIconAdding.value = true
  try {
    const iconSet = await loadServerIconSetFromUrl(sourceUrl)
    serverIconSetUrls.value = [...serverIconSetUrls.value, sourceUrl]
    writeLocalIdList(MEDIA_SERVER_ICON_SET_URLS_KEY, serverIconSetUrls.value)
    serverIconSets.value = [...serverIconSets.value, iconSet]
    selectedServerIconSetId.value = iconSet.id
    addServerIconSetVisible.value = false
    serverIconSetUrlInput.value = ''
    serverIconSetError.value = ''
    message.success('图标集已导入')
  } catch (error: any) {
    message.error(`导入失败：${error?.message || '未知错误'}`)
  } finally {
    serverIconAdding.value = false
  }
}

const refreshServerIconSet = async (iconSet: MediaServerIconSet) => {
  try {
    const refreshed = await loadServerIconSetFromUrl(iconSet.sourceUrl)
    serverIconSets.value = serverIconSets.value.map((item) => item.id === iconSet.id ? refreshed : item)
    if (selectedServerIconSetId.value === iconSet.id) {
      selectedServerIconSetId.value = refreshed.id
    }
    message.success('图标集已刷新')
  } catch (error: any) {
    message.error(`刷新失败：${error?.message || '未知错误'}`)
  }
}

const removeServerIconSet = (iconSetId: string) => {
  const target = serverIconSets.value.find((item) => item.id === iconSetId)
  if (!target) return
  serverIconSets.value = serverIconSets.value.filter((item) => item.id !== iconSetId)
  serverIconSetUrls.value = serverIconSetUrls.value.filter((url) => url !== target.sourceUrl)
  writeLocalIdList(MEDIA_SERVER_ICON_SET_URLS_KEY, serverIconSetUrls.value)
  if (selectedServerIconSetId.value === iconSetId) {
    selectedServerIconSetId.value = serverIconSets.value[0]?.id || ''
  }
  message.success('图标集已删除')
}

const applyCurrentServerIcon = (iconUrl: string) => {
  const currentServer = registry.currentServer
  if (!currentServer) return
  registry.updateServer(currentServer.id, { customIconUrl: iconUrl })
  message.success('媒体服务器图标已更新')
}

const resetCurrentServerIcon = () => {
  const currentServer = registry.currentServer
  if (!currentServer) return
  registry.updateServer(currentServer.id, { customIconUrl: '' })
  message.success('已恢复默认图标')
}

const handleAddServer = () => {
  navigation.openRegistry()
}

const switchServer = (serverId: string) => {
  registry.setCurrentServer(serverId)
  navigation.goHome()
}

const switchServerWithLine = (serverId: string, lineKey: string) => {
  registry.setCurrentServer(serverId)
  registry.setCurrentServerLine(lineKey)
  navigation.goHome()
}

const switchServerLine = (lineKey: string) => {
  if (!registry.currentServer) return
  registry.setCurrentServerLine(lineKey)
}

const handleRefresh = () => {
  if (currentRoute.value.kind === 'home') {
    loadCurrentServerHome(true)
    return
  }
  if (
    currentRoute.value.kind === 'library-root'
    || currentRoute.value.kind === 'library-page'
    || currentRoute.value.kind === 'genre-page'
    || currentRoute.value.kind === 'studio-page'
  ) {
    loadCurrentLibrary(true)
    return
  }
  if (currentRoute.value.kind === 'item-detail') {
    loadCurrentDetail(true)
    return
  }
  if (currentRoute.value.kind === 'collection-page') {
    loadCurrentCollection(true)
    return
  }
  message.info(`我们下一步继续把 ${registry.currentServer?.name || '当前服务器'} 的搜索和媒体库数据也接成真实内容`)
}

const handleBack = () => {
  if (currentRoute.value.kind === 'home' || currentRoute.value.kind === 'search' || currentRoute.value.kind === 'library-root') {
    navigation.openRegistry()
    return
  }
  navigation.back()
}

onMounted(() => {
  registry.ensureLoaded()
  homePreferences.ensureLoaded()
  void loadAllServerIconSets()
  if (currentRoute.value.kind === 'search') searchText.value = currentRoute.value.query || ''
  if (registry.currentServer && currentRoute.value.kind === 'home') {
    loadCurrentServerHome(false)
  }
  if (registry.currentServer && (currentRoute.value.kind === 'library-root' || currentRoute.value.kind === 'library-page')) {
    loadCurrentLibrary(false)
  }
  if (registry.currentServer && currentRoute.value.kind === 'item-detail') {
    loadCurrentDetail(false)
  }
  if (registry.currentServer && currentRoute.value.kind === 'search') {
    loadCurrentSearch(false)
  }
  if (registry.currentServer && currentRoute.value.kind === 'collection-page') {
    loadCurrentCollection(false)
  }
})

const loadCurrentServerHome = async (force = false) => {
  if (!registry.currentServer || currentRoute.value.kind !== 'home') return
  try {
    if (force) {
      visibleHomeLibraryCount.value = HOME_LIBRARY_BATCH_SIZE
    }
    await content.loadHomeShell(registry.currentServer, force)
    queueHomeSectionLoads(force)
  } catch {
    // store already keeps the error state
  }
}

const queueHomeSectionLoads = (force = false) => {
  if (!registry.currentServer) return
  void content.syncHomeExcludedLibraries(registry.currentServer, force).catch(() => {})
  void content.loadHomeResume(registry.currentServer, force).catch(() => {})
  void content.loadHomeNextUp(registry.currentServer, {
    resumeNextUp: homePreferences.resumeNextUp,
    maxNextUpDays: homePreferences.maxNextUpDays
  }, force).catch(() => {})
  if (homePreferences.showRecentlyAdded) {
    void content.loadHomeLatest(registry.currentServer, force).catch(() => {})
  }
  queueVisibleHomeLibrarySections(force)
}

const queueVisibleHomeLibrarySections = (force = false) => {
  if (!registry.currentServer) return
  for (const library of visibleHomeLibraries.value) {
    if (force || !library.attempted) {
      void content.loadHomeLibrarySection(registry.currentServer, library.id, force).catch(() => {})
    }
  }
}

const loadMoreHomeLibraries = () => {
  return
}

const retryHomeSection = (kind: 'resume' | 'latest' | 'nextup') => {
  if (!registry.currentServer) return
  if (kind === 'resume') void content.loadHomeResume(registry.currentServer, true).catch(() => {})
  if (kind === 'latest') void content.loadHomeLatest(registry.currentServer, true).catch(() => {})
  if (kind === 'nextup') void content.loadHomeNextUp(registry.currentServer, {
    resumeNextUp: homePreferences.resumeNextUp,
    maxNextUpDays: homePreferences.maxNextUpDays
  }, true).catch(() => {})
}

const retryHomeLibrarySection = (libraryId: string) => {
  if (!registry.currentServer) return
  void content.loadHomeLibrarySection(registry.currentServer, libraryId, true).catch(() => {})
}

watch(() => [registry.currentServer?.id, currentRoute.value.kind] as const, ([serverId, routeKind]) => {
  if (serverId && routeKind === 'home') {
    visibleHomeLibraryCount.value = HOME_LIBRARY_BATCH_SIZE
    loadCurrentServerHome(false)
  }
  if (homeRefreshTimer) {
    clearInterval(homeRefreshTimer)
    homeRefreshTimer = null
  }
  if (serverId && routeKind === 'home') {
    homeRefreshTimer = setInterval(() => {
      loadCurrentServerHome(true)
    }, 60_000)
  }
})

watch(() => currentDetail.value?.id, () => {
  detailLogoLoadFailed.value = false
})

const loadCurrentLibrary = async (force = false) => {
  if (!registry.currentServer) return
  try {
    if (currentRoute.value.kind === 'library-root') {
      await content.loadLibraries(registry.currentServer, force)
      return
    }
    if (currentRoute.value.kind === 'library-page') {
      await content.queueLibraryPageLoad(registry.currentServer, currentRoute.value.libraryId, force, true)
      return
    }
    if (currentRoute.value.kind === 'genre-page') {
      await content.loadFilteredPage(
        registry.currentServer,
        `genre:${currentRoute.value.genre}`,
        { genre: currentRoute.value.genre },
        force
      )
      return
    }
    if (currentRoute.value.kind === 'studio-page') {
      await content.loadFilteredPage(
        registry.currentServer,
        `studio:${currentRoute.value.studio}`,
        { studio: currentRoute.value.studio },
        force
      )
    }
  } catch {
    // store keeps error state
  }
}

const isDetailCandidate = (item: MediaServerLibraryNode) => ['movie', 'series', 'season', 'episode'].includes(item.kind)
const handleCardClick = (item: MediaServerCardItem) => {
  handleLibraryItemClick(item.id, item.title, item as MediaServerLibraryNode)
}

const refreshHomeAfterMediaAction = async () => {
  const server = registry.currentServer
  if (!server) return
  await Promise.allSettled([
    content.loadHomeResume(server, true),
    content.loadHomeLatest(server, true),
    content.loadHomeNextUp(server, {
      resumeNextUp: homePreferences.resumeNextUp,
      maxNextUpDays: homePreferences.maxNextUpDays
    }, true)
  ])
}

const openMediaServerPlayback = async (
  item: MediaServerCardItem | MediaServerItemDetail,
  options?: {
    sourceId?: string
    sourceLabel?: string
    sourceOptions?: Array<{ id: string, label: string, subLabel?: string }>
    videoStreamIndex?: number
    audioStreamIndex?: number
    subtitleStreamIndex?: number
    videoOptions?: Array<{ streamIndex: number, label: string }>
    audioOptions?: Array<{ streamIndex: number, label: string }>
    subtitleOptions?: Array<{ streamIndex: number, label: string }>
    videoLabel?: string
    audioLabel?: string
    subtitleLabel?: string
    playlistLabel?: string
    episodePlaylist?: Array<{ id: string, title: string }>
  }
) => {
  const server = registry.currentServer
  if (!server || !item.id) return
  const playback = await getMediaServerPlaybackInfo(
    server,
    item.id,
    options?.sourceId,
    options?.videoStreamIndex ?? -1,
    options?.audioStreamIndex ?? -1,
    options?.subtitleStreamIndex ?? -1,
    settingStore.uiMediaServerVideoQuality,
    settingStore.uiMediaServerCompatibilityMode,
    settingStore.uiMediaServerCustomDeviceProfile,
    settingStore.uiMediaServerBitrateTestSize
  )
  window.WebOpenWindow?.({
    page: 'PageVideo',
    theme: 'dark',
    data: {
      user_id: server.userId || '',
      drive_id: 'media_server',
      file_id: item.id,
      parent_file_id: '',
      parent_file_name: item.parentTitle || '',
      file_name: item.title,
      html: item.title,
      encType: '',
      password: '',
      expire_time: 0,
      play_cursor: playback.playCursorSeconds || 0,
      media_url: playback.url,
      media_headers: playback.headers,
      media_server_id: server.id,
      media_server_item_id: item.id,
      media_server_source_id: options?.sourceId || '',
      media_server_source_label: options?.sourceLabel || '',
      media_server_play_session_id: playback.playSessionId || '',
      media_server_source_options: options?.sourceOptions || [],
      media_server_video_label: options?.videoLabel || '',
      media_server_video_options: options?.videoOptions || [],
      media_server_audio_label: options?.audioLabel || '',
      media_server_subtitle_label: options?.subtitleLabel || '',
      media_server_audio_options: options?.audioOptions || [],
      media_server_subtitle_options: options?.subtitleOptions || [],
      media_server_playlist_label: options?.playlistLabel || '',
      media_server_episode_playlist: options?.episodePlaylist || []
    }
  })
}

const cleanDownloadSegment = (value: string) => {
  return (value || 'media').replace(/[<>:"/\\|?*\f\n\r\t\v]+/g, '').replace(/[ .]+$/g, '').replace(/^\.+/g, '') || 'media'
}

const joinDownloadPath = (base: string, ...segments: string[]) => {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  const normalizedBase = base.replace(/[\\/]+$/g, '')
  const normalizedSegments = segments.map(cleanDownloadSegment).filter(Boolean)
  return [normalizedBase, ...normalizedSegments].join(sep)
}

const mediaServerDownloadBasePath = () => {
  const savePath = settingStore.AriaIsLocal ? settingStore.downSavePath : settingStore.ariaSavePath
  if (!savePath?.trim()) {
    message.error('未设置保存路径')
    modalDownload(false)
    return ''
  }
  return savePath
}

const loadAllMediaServerChildren = async (server: MediaServerConfig, parentId: string, recursiveMedia = false) => {
  const key = `${server.id}:${parentId}`
  let guard = 0
  do {
    const current = content.currentPagedLibrary(key)
    const force = !current.items.length && current.currentPage < 0
    await content.loadLibraryPage(server, parentId, force, recursiveMedia)
    guard += 1
  } while (content.currentPagedLibrary(key).hasNextPage && guard < 20)
  return content.currentLibraryPage(key)
}

const enqueueMediaServerDownloadItems = async (
  items: Array<MediaServerCardItem | MediaServerItemDetail | MediaServerLibraryNode>,
  options?: { folderSegments?: string[]; sourceId?: string }
) => {
  const server = registry.currentServer
  const basePath = mediaServerDownloadBasePath()
  if (!server || !basePath || items.length === 0) return

  let created = 0
  for (const item of items) {
    if (!item.id || item.kind === 'series' || item.kind === 'season' || item.kind === 'folder' || item.kind === 'person') continue
    const downloadInfo = await getMediaServerDownloadInfo(server, item.id, options?.sourceId)
    const baseFolders = options?.folderSegments || []
    const itemFolder = item.kind === 'episode' && item.parentTitle && !baseFolders.includes(item.parentTitle)
      ? [...baseFolders, item.parentTitle]
      : baseFolders
    DownDAL.aAddUrlDownload({
      user_id: `media_server:${server.id}`,
      drive_id: 'media_server',
      file_id: item.id,
      url: downloadInfo.url,
      headers: downloadInfo.headers,
      savePath: itemFolder.length ? joinDownloadPath(basePath, ...itemFolder) : basePath,
      fileName: downloadInfo.fileName || item.title,
      fileSize: downloadInfo.fileSize,
      icon: 'iconfont iconshipin'
    })
    created += 1
  }
  if (created > 0) message.success(`成功创建 ${created} 个下载任务`)
  else message.warning('没有找到可以下载的媒体')
}

const resolveMediaServerDownloadItems = async (scope: DetailDownloadScope) => {
  const server = registry.currentServer
  const current = detailDisplayedItem.value
  if (!server || !current.id) return []
  if (scope === 'current') return [current]

  if (scope === 'season') {
    if (detailEpisodeItems.value.length > 0) return detailEpisodeItems.value
    if (current.kind === 'season') {
      return (await loadAllMediaServerChildren(server, current.id, false)).filter((item) => item.kind === 'episode')
    }
    return [current]
  }

  if (currentDetail.value?.kind !== 'series') return detailEpisodeItems.value.length > 0 ? detailEpisodeItems.value : [current]
  const episodes: MediaServerLibraryNode[] = []
  const seasons = detailSeasonMenu.value
  if (seasons.length === 0) return detailEpisodeItems.value.length > 0 ? detailEpisodeItems.value : [current]
  for (const season of seasons) {
    const seasonEpisodes = (await loadAllMediaServerChildren(server, season.id, false))
      .filter((item) => item.kind === 'episode')
      .sort(compareEpisodeItems)
    episodes.push(...seasonEpisodes)
  }
  return episodes
}

const handleDetailDownload = async (scope: DetailDownloadScope) => {
  try {
    const items = await resolveMediaServerDownloadItems(scope)
    const folderSegments = currentDetail.value?.kind === 'series'
      ? [currentDetail.value.title, scope === 'series' ? '' : activeDetailSeason.value?.title || '']
      : currentDetail.value?.kind === 'season'
        ? [currentDetail.value.parentTitle || currentDetail.value.title, currentDetail.value.title]
        : []
    await enqueueMediaServerDownloadItems(items, {
      folderSegments: folderSegments.filter(Boolean) as string[],
      sourceId: scope === 'current' ? selectedSourceOption.value?.id : undefined
    })
  } catch (error: any) {
    console.error('媒体服务器下载失败:', error)
    message.error(error?.message || '创建下载任务失败')
  }
}

const resolveSeriesHomePlaybackTarget = async (server: MediaServerConfig, item: MediaServerCardItem | MediaServerLibraryNode) => {
  const children = await content.loadLibraryPage(server, item.id, true, false)
  const seasons = children.filter((child) => child.kind === 'season').sort(compareSeasonItems)
  const directEpisodes = children.filter((child) => child.kind === 'episode').sort(compareEpisodeItems)

  if (directEpisodes.length > 0) {
    return {
      item: directEpisodes[0],
      playlistLabel: item.title,
      episodePlaylist: directEpisodes.map((episode) => ({ id: episode.id, title: episode.title }))
    }
  }

  const regularSeason = seasons.find((season) => season.seasonNumber !== 0) || seasons[0]
  if (!regularSeason) {
    throw new Error('没有找到可播放剧集')
  }

  const episodes = (await content.loadLibraryPage(server, regularSeason.id, true, false))
    .filter((child) => child.kind === 'episode')
    .sort(compareEpisodeItems)
  if (episodes.length === 0) {
    throw new Error('没有找到可播放剧集')
  }

  return {
    item: episodes[0],
    playlistLabel: regularSeason.title || item.title,
    episodePlaylist: episodes.map((episode) => ({ id: episode.id, title: episode.title }))
  }
}

const resolveHomePlaybackTarget = async (server: MediaServerConfig, item: MediaServerCardItem | MediaServerLibraryNode) => {
  if (item.kind === 'series') {
    return resolveSeriesHomePlaybackTarget(server, item)
  }

  if (item.kind === 'season') {
    const episodes = (await content.loadLibraryPage(server, item.id, true, false))
      .filter((child) => child.kind === 'episode')
      .sort(compareEpisodeItems)
    if (episodes.length === 0) {
      throw new Error('没有找到可播放剧集')
    }
    return {
      item: episodes[0],
      playlistLabel: item.title,
      episodePlaylist: episodes.map((episode) => ({ id: episode.id, title: episode.title }))
    }
  }

  return {
    item,
    playlistLabel: '',
    episodePlaylist: []
  }
}

const resolveHomeDownloadItems = async (server: MediaServerConfig, item: MediaServerCardItem | MediaServerLibraryNode) => {
  if (item.kind === 'series') {
    const children = await loadAllMediaServerChildren(server, item.id, false)
    const directEpisodes = children.filter((child) => child.kind === 'episode').sort(compareEpisodeItems)
    if (directEpisodes.length > 0) return directEpisodes
    const seasons = children.filter((child) => child.kind === 'season').sort(compareSeasonItems)
    const episodes: MediaServerLibraryNode[] = []
    for (const season of seasons) {
      episodes.push(...(await loadAllMediaServerChildren(server, season.id, false)).filter((child) => child.kind === 'episode').sort(compareEpisodeItems))
    }
    return episodes
  }

  if (item.kind === 'season') {
    return (await loadAllMediaServerChildren(server, item.id, false)).filter((child) => child.kind === 'episode').sort(compareEpisodeItems)
  }

  return [item]
}

const playHomeMediaItem = async (item: MediaServerCardItem | MediaServerLibraryNode) => {
  const server = registry.currentServer
  if (!server) return
  try {
    const target = await resolveHomePlaybackTarget(server, item)
    await openMediaServerPlayback(target.item, {
      playlistLabel: target.playlistLabel,
      episodePlaylist: target.episodePlaylist
    })
  } catch (error: any) {
    console.error('媒体服务器播放失败:', error)
    message.error(error?.message || '媒体服务器播放失败')
  }
}

const handleHomeMediaAction = async (item: MediaServerCardItem | MediaServerLibraryNode, action: 'watched' | 'favorite' | 'download') => {
  const server = registry.currentServer
  if (!server || !item.id) return
  try {
    if (action === 'download') {
      const downloadItems = await resolveHomeDownloadItems(server, item)
      await enqueueMediaServerDownloadItems(downloadItems, { folderSegments: item.kind === 'series' || item.kind === 'season' ? [item.title] : item.parentTitle ? [item.parentTitle] : [] })
      return
    }
    if (action === 'watched') {
      const wasPlayed = item.isPlayed === true
      await updateMediaServerPlayedState(server, item.id, wasPlayed)
      await refreshHomeAfterMediaAction()
      message.success(wasPlayed ? '已标记为未观看' : '已标记为已观看')
      return
    }

    const wasFavorite = item.isFavorite === true
    await updateMediaServerFavoriteState(server, item.id, wasFavorite)
    await refreshHomeAfterMediaAction()
    message.success(wasFavorite ? '已取消收藏' : '已加入收藏')
  } catch (error: any) {
    message.error(error?.message || '操作失败')
  }
}

const openHomeCollection = (kind: 'latest' | 'nextup', title: string) => {
  navigation.push({ kind: 'collection-page', collectionId: `home:${kind}`, title })
}

const toggleHomePreference = (key: 'showRecentlyAdded' | 'resumeNextUp' | 'showPosterLabels', value: any) => {
  const checked = typeof value === 'boolean' ? value : !!value
  homePreferences.setPartial({ [key]: checked })
  if (registry.currentServer && currentRoute.value.kind === 'home') {
    loadCurrentServerHome(true)
  }
}

const openHomeLibraryManager = () => {
  const hiddenSections = new Set(homePreferences.hiddenHomeSectionIds || [])
  const hiddenLibraries = new Set(homePreferences.hiddenHomeLibraryIds || [])
  homeLibraryManagerDraft.value = orderedHomeSections.value.map((section) => ({
    key: section.key,
    title: section.title,
    visible: section.kind === 'library'
      ? !hiddenSections.has(section.key) && !hiddenLibraries.has(section.id)
      : !hiddenSections.has(section.key)
  }))
  draggingHomeLibraryId.value = ''
  homeLibraryManagerVisible.value = true
}

const cancelHomeLibraryManager = () => {
  homeLibraryManagerVisible.value = false
  draggingHomeLibraryId.value = ''
}

const toggleHomeLibraryDraftVisible = (sectionKey: string, value: any) => {
  const checked = typeof value === 'boolean' ? value : !!value
  homeLibraryManagerDraft.value = homeLibraryManagerDraft.value.map((item) =>
    item.key === sectionKey ? { ...item, visible: checked } : item
  )
}

const handleHomeLibraryDragStart = (event: DragEvent, sectionKey: string) => {
  draggingHomeLibraryId.value = sectionKey
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.dropEffect = 'move'
    event.dataTransfer.setData('text/plain', sectionKey)
  }
}

const handleHomeLibraryDrop = (targetKey: string) => {
  const sourceKey = draggingHomeLibraryId.value
  if (!sourceKey || sourceKey === targetKey) return
  moveHomeLibraryDraftItem(sourceKey, targetKey)
}

const moveHomeLibraryDraftItem = (sourceKey: string, targetKey: string) => {
  const draft = [...homeLibraryManagerDraft.value]
  const sourceIndex = draft.findIndex((item) => item.key === sourceKey)
  const targetIndex = draft.findIndex((item) => item.key === targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [moved] = draft.splice(sourceIndex, 1)
  draft.splice(targetIndex, 0, moved)
  homeLibraryManagerDraft.value = draft
}

const handleHomeLibraryDragEnd = () => {
  draggingHomeLibraryId.value = ''
}

const handleHomeLibraryPointerDragStart = (sectionKey: string) => {
  draggingHomeLibraryId.value = sectionKey
  const handlePointerMove = (event: MouseEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const row = target?.closest?.('.home-library-manager-item') as HTMLElement | null
    const targetKey = row?.dataset.sectionKey
    if (targetKey && targetKey !== draggingHomeLibraryId.value) {
      moveHomeLibraryDraftItem(draggingHomeLibraryId.value, targetKey)
    }
  }
  const handlePointerUp = () => {
    draggingHomeLibraryId.value = ''
    window.removeEventListener('mousemove', handlePointerMove)
    window.removeEventListener('mouseup', handlePointerUp)
  }
  window.addEventListener('mousemove', handlePointerMove)
  window.addEventListener('mouseup', handlePointerUp, { once: true })
}

const saveHomeLibraryManager = () => {
  const draft = homeLibraryManagerDraft.value
  const sectionByKey = new Map(homeSectionDescriptors.value.map((section) => [section.key, section]))
  const hiddenKeys = draft.filter((item) => !item.visible).map((item) => item.key)
  homePreferences.setPartial({
    homeSectionOrder: draft.map((item) => item.key),
    hiddenHomeSectionIds: hiddenKeys,
    homeLibraryOrder: draft
      .map((item) => sectionByKey.get(item.key))
      .filter((section): section is HomeSectionDescriptor => !!section && section.kind === 'library')
      .map((section) => section.id),
    hiddenHomeLibraryIds: hiddenKeys
      .map((key) => sectionByKey.get(key))
      .filter((section): section is HomeSectionDescriptor => !!section && section.kind === 'library')
      .map((section) => section.id)
  })
  visibleHomeLibraryCount.value = HOME_LIBRARY_BATCH_SIZE
  homeLibraryManagerVisible.value = false
  draggingHomeLibraryId.value = ''
  queueVisibleHomeLibrarySections(false)
}

const setPosterType = (key: 'nextUpPosterType' | 'recentlyAddedPosterType' | 'latestInLibraryPosterType', value: string | number | Record<string, any> | undefined) => {
  if (value !== 'portrait' && value !== 'landscape') return
  homePreferences.setPartial({ [key]: value })
}

const setHomePosterMode = (value: MediaServerPosterType) => {
  homePreferences.setPartial({
    nextUpPosterType: value,
    recentlyAddedPosterType: value,
    latestInLibraryPosterType: value
  })
}

const setCurrentListingPosterType = (value: 'portrait' | 'landscape') => {
  if (currentRoute.value.kind === 'collection-page') {
    if (currentCollectionKind.value === 'nextup') {
      homePreferences.setPartial({ nextUpPosterType: value })
      return
    }
    homePreferences.setPartial({ recentlyAddedPosterType: value })
    return
  }
  if (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page') {
    homePreferences.setPartial({ latestInLibraryPosterType: value })
  }
}

const setCurrentListingBrowseMode = (value: 'grid' | 'list') => {
  if (currentRoute.value.kind === 'collection-page') {
    homePreferences.setPartial({ collectionBrowseMode: value })
    return
  }
  if (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page') {
    homePreferences.setPartial({ latestInLibraryBrowseMode: value })
  }
}

const getListingHeading = (item: MediaServerLibraryNode) => item.parentTitle || item.title

const getListingYearLabel = (item: MediaServerLibraryNode) => {
  if (item.year) return `${item.year}`
  if (typeof item.rating === 'number') return `评分 ${item.rating.toFixed(1)}`
  return ''
}

const getListingSubtitle = (item: MediaServerLibraryNode) => {
  if (item.parentTitle && item.parentTitle !== item.title) return item.title
  if (item.year) return `${item.year}`
  if (typeof item.rating === 'number') return `评分 ${item.rating.toFixed(1)}`
  return item.collectionType || item.kind || '媒体'
}

const getListingOverlay = (item: MediaServerLibraryNode) => {
  if (typeof item.rating === 'number') return `★ ${item.rating.toFixed(1)}`
  if (item.year) return `${item.year}`
  if (item.kind === 'series') return '剧集'
  if (item.kind === 'movie') return '电影'
  return ''
}

const formatRuntimeMinutes = (runtimeMinutes?: number) => {
  if (!runtimeMinutes || runtimeMinutes <= 0) return ''
  if (runtimeMinutes < 60) return `${runtimeMinutes} 分钟`
  const hours = Math.floor(runtimeMinutes / 60)
  const minutes = runtimeMinutes % 60
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
}

const getListingKindLabel = (item: MediaServerLibraryNode) => {
  if (item.kind === 'series') return '剧集'
  if (item.kind === 'movie') return '电影'
  if (item.kind === 'season') return item.seasonNumber ? `第 ${item.seasonNumber} 季` : '季度'
  if (item.kind === 'episode') {
    if (typeof item.seasonNumber === 'number' && typeof item.episodeNumber === 'number') {
      return `S${item.seasonNumber} · E${item.episodeNumber}`
    }
    if (typeof item.episodeNumber === 'number') return `第 ${item.episodeNumber} 集`
    return '剧集'
  }
  return item.collectionType || '媒体'
}

const getListingMetaItems = (item: MediaServerLibraryNode) => {
  const parts = [
    item.year ? `${item.year}` : '',
    typeof item.rating === 'number' ? `评分 ${item.rating.toFixed(1)}` : '',
    formatRuntimeMinutes(item.runtimeMinutes),
    item.parentTitle && item.parentTitle !== item.title ? item.parentTitle : ''
  ].filter(Boolean)
  return [...new Set(parts)]
}

const getListingOverview = (item: MediaServerLibraryNode) => {
  return item.overview || ''
}

const detailEpisodeLocator = (item: MediaServerLibraryNode) => {
  const match = item.title.match(/S(\d+)E(\d+)/i)
  if (match) return `第${match[2]}集`
  return item.kind === 'episode' ? '剧集' : item.kind
}

const detailEpisodeTitle = (item: MediaServerLibraryNode) => item.title.replace(/^S\d+E\d+\s*[·.-]?\s*/i, '')

const selectDetailSeason = async (seasonId: string) => {
  if (!registry.currentServer || !seasonId || seasonId === selectedSeasonId.value) return
  selectedSeasonId.value = seasonId
  selectedEpisodeId.value = ''
  try {
    await content.loadLibraryPage(registry.currentServer, seasonId, false, false)
  } catch {
    // store keeps state
  }
}

const selectDetailEpisode = async (episodeId: string) => {
  if (!registry.currentServer || !episodeId) return
  selectedEpisodeId.value = episodeId
  try {
    await content.loadItemDetail(registry.currentServer, episodeId, false)
  } catch {
    // store keeps state
  }
}

const handleDetailAction = async (action: 'watched' | 'favorite' | 'playlist') => {
  const itemId = detailDisplayedItem.value.id
  const server = registry.currentServer
  if (!itemId || !server) return
  if (action === 'watched') {
    const wasPlayed = detailIsWatched.value
    try {
      await updateMediaServerPlayedState(server, itemId, wasPlayed)
      await content.loadItemDetail(server, itemId, true)
      if (currentDetail.value?.id && currentDetail.value.id !== itemId) {
        await content.loadItemDetail(server, currentDetail.value.id, true)
      }
      message.success(wasPlayed ? '已取消观看标记' : '已标记为已观看')
    } catch (error: any) {
      message.error(error?.message || '标记观看失败')
    }
    return
  }
  if (action === 'favorite') {
    const wasFavorite = detailIsFavorite.value
    try {
      await updateMediaServerFavoriteState(server, itemId, wasFavorite)
      await content.loadItemDetail(server, itemId, true)
      if (currentDetail.value?.id && currentDetail.value.id !== itemId) {
        await content.loadItemDetail(server, currentDetail.value.id, true)
      }
      message.success(wasFavorite ? '已取消收藏' : '已加入收藏')
    } catch (error: any) {
      message.error(error?.message || '收藏操作失败')
    }
    return
  }
  const next = detailInPlaylist.value
    ? playlistIds.value.filter((id) => id !== itemId)
    : [...playlistIds.value, itemId]
  playlistIds.value = next
  writeLocalIdList(MEDIA_SERVER_PLAYLIST_KEY, next)
  message.success(detailInPlaylist.value ? '已加入播放列表' : '已移出播放列表')
}

const handleDetailPlay = async () => {
  const server = registry.currentServer
  const item = detailDisplayedItem.value
  if (!server || !item.id) return
  try {
    const selectedVideoCard = detailMediaCards.value.find((card) => card.kind === 'video' && card.selected)
      || detailMediaCards.value.find((card) => card.kind === 'video')
    const selectedAudioCard = detailMediaCards.value.find((card) => card.kind === 'audio' && card.selected)
    const selectedSubtitleCard = detailMediaCards.value.find((card) => card.kind === 'subtitle' && card.selected)
    const videoOptions = detailMediaCards.value
      .filter((card) => card.kind === 'video' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    const audioOptions = detailMediaCards.value
      .filter((card) => card.kind === 'audio' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    const subtitleOptions = detailMediaCards.value
      .filter((card) => card.kind === 'subtitle' && typeof card.streamIndex === 'number')
      .map((card) => ({
        streamIndex: card.streamIndex as number,
        label: card.title
      }))
    await openMediaServerPlayback(item, {
      sourceId: selectedSourceOption.value?.id || detailSourceOptions.value[0]?.id || '',
      sourceLabel: selectedSourceOption.value?.title || detailSourceOptions.value[0]?.title || '',
      sourceOptions: detailSourceOptions.value.map((source) => ({
        id: source.id,
        label: source.title,
        subLabel: source.fileSubLabel
      })),
      videoStreamIndex: typeof selectedVideoCard?.streamIndex === 'number' ? selectedVideoCard.streamIndex : -1,
      audioStreamIndex: selectedAudioStreamIndex.value,
      subtitleStreamIndex: selectedSubtitleStreamIndex.value,
      videoLabel: selectedVideoCard?.title || '',
      videoOptions,
      audioLabel: selectedAudioCard?.title || '',
      subtitleLabel: selectedSubtitleCard?.title || '',
      audioOptions,
      subtitleOptions,
      playlistLabel: detailSeasonTitle.value || '当前季剧集',
      episodePlaylist: detailEpisodeItems.value.map((episode) => ({
        id: episode.id,
        title: episode.title
      }))
    })
  } catch (error: any) {
    console.error('媒体服务器播放失败:', error)
    message.error(error?.message || '媒体服务器播放失败')
  }
}

const openPersonPage = (personId: string, title: string) => {
  if (!personId) return
  navigation.push({ kind: 'person-page', personId, title })
}

const openGenrePage = (genre: string) => {
  if (!genre) return
  navigation.push({ kind: 'genre-page', genre, title: genre })
}

const openStudioSearch = (studio: string) => {
  if (!studio) return
  navigation.push({ kind: 'studio-page', studio, title: studio })
}

const openExternalLink = (url: string) => {
  if (!url) return
  openExternal(url)
}

const selectMediaInfoCard = (card: MediaServerMediaInfoCard) => {
  if (card.kind === 'audio' && typeof card.streamIndex === 'number') {
    selectedAudioStreamIndex.value = card.streamIndex
  } else if (card.kind === 'subtitle' && typeof card.streamIndex === 'number') {
    selectedSubtitleStreamIndex.value = card.streamIndex
  }
}

const openMediaInfoCard = (card: MediaServerMediaInfoCard) => {
  activeMediaInfoCard.value = detailMediaCards.value.find((item) => item.id === card.id) || card
  mediaInfoModalVisible.value = true
}

const handleMediaInfoCardClick = (card: MediaServerMediaInfoCard) => {
  selectMediaInfoCard(card)
}

const setMaxNextUpDays = (value: string | number | undefined) => {
  const days = Math.max(0, Number(value || 0))
  homePreferences.setPartial({ maxNextUpDays: Number.isFinite(days) ? days : 0 })
  if (registry.currentServer && (currentRoute.value.kind === 'home' || currentRoute.value.kind === 'collection-page')) {
    if (currentRoute.value.kind === 'home') loadCurrentServerHome(true)
    if (currentRoute.value.kind === 'collection-page') loadCurrentCollection(true)
  }
}

const loadCurrentCollection = async (force = false) => {
  if (!registry.currentServer || currentRoute.value.kind !== 'collection-page') return
  const kind = currentCollectionKind.value
  if (!kind) return
  try {
    await content.queueCollectionPageLoad(registry.currentServer, kind, {
      resumeNextUp: homePreferences.resumeNextUp,
      maxNextUpDays: homePreferences.maxNextUpDays
    }, force)
  } catch {
    // store keeps error state
  }
}

const handleWorkspaceScroll = () => {
  if (!workspacePageRef.value) return
  const el = workspacePageRef.value
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  if (currentRoute.value.kind === 'home' && distanceToBottom < 360 && homeLibrariesHasMore.value) {
    loadMoreHomeLibraries()
  }
  if (currentRoute.value.kind === 'collection-page' && !currentCollectionLoading.value && distanceToBottom < 240 && currentCollection.value.hasNextPage) {
    loadCurrentCollection(false)
  }
  if (
    (currentRoute.value.kind === 'library-page' || currentRoute.value.kind === 'genre-page' || currentRoute.value.kind === 'studio-page')
    && !currentLibraryPageLoading.value
    && distanceToBottom < 240
    && currentPagedLibrary.value.hasNextPage
  ) {
    loadCurrentLibrary(false)
  }
}

const handleLibraryItemClick = (itemId: string, title: string, item?: MediaServerLibraryNode) => {
  if (item && isDetailCandidate(item)) {
    navigation.push({ kind: 'item-detail', itemId, title })
    return
  }
  navigation.push({ kind: 'library-page', libraryId: itemId, title })
}

const handleSearchItemSelect = (item: MediaServerLibraryNode) => {
  handleLibraryItemClick(item.id, item.title, item)
}

const loadCurrentSearchSuggestions = async (force = false) => {
  if (!registry.currentServer || currentRoute.value.kind !== 'search') return
  if (normalizedSearchQuery.value) return
  try {
    await content.loadSearchSuggestions(registry.currentServer, force)
  } catch (error: any) {
    console.error('[media-server-search] load suggestions failed', error)
  }
}

const handleSearch = () => {
  const query = searchText.value.trim()
  navigation.goSearch(query)
  if (!query) {
    loadCurrentSearchSuggestions(false)
    return
  }
  loadCurrentSearch(true)
}

watch(() => [
  registry.currentServer?.id,
  currentRoute.value.kind,
  currentRoute.value.kind === 'library-page'
    ? currentRoute.value.libraryId
    : currentRoute.value.kind === 'genre-page'
      ? currentRoute.value.genre
      : currentRoute.value.kind === 'studio-page'
        ? currentRoute.value.studio
        : ''
] as const, ([serverId, routeKind]) => {
  if (serverId && (routeKind === 'library-root' || routeKind === 'library-page' || routeKind === 'genre-page' || routeKind === 'studio-page')) {
    loadCurrentLibrary(false)
  }
})

const loadCurrentDetail = async (force = false) => {
  if (!registry.currentServer || (currentRoute.value.kind !== 'item-detail' && currentRoute.value.kind !== 'person-page')) return
  const detailId = currentRoute.value.kind === 'item-detail' ? currentRoute.value.itemId : currentRoute.value.personId
  const shouldForceDetailLoad = force || currentRoute.value.kind === 'person-page'
  try {
    selectedSeasonId.value = ''
    selectedEpisodeId.value = ''
    selectedSourceId.value = ''
    versionMenuVisible.value = false
    detailSimilarError.value = ''
    if (force) detailSimilarItems.value = []
    await Promise.all([
      content.loadItemDetail(registry.currentServer, detailId, shouldForceDetailLoad),
      currentRoute.value.kind === 'person-page'
        ? content.loadPersonPage(registry.currentServer, detailId, force)
        : content.loadLibraryPage(registry.currentServer, detailId, force, false)
    ])
    detailSimilarLoading.value = true
    detailSimilarItems.value = await getMediaServerSimilarItems(registry.currentServer, detailId)
  } catch {
    // store keeps error state
    detailSimilarError.value = '推荐内容加载失败'
  } finally {
    detailSimilarLoading.value = false
  }
}

watch(() => [
  registry.currentServer?.id,
  currentRoute.value.kind,
  currentRoute.value.kind === 'item-detail' ? currentRoute.value.itemId : currentRoute.value.kind === 'person-page' ? currentRoute.value.personId : ''
] as const, ([serverId, routeKind]) => {
  if (serverId && (routeKind === 'item-detail' || routeKind === 'person-page')) {
    loadCurrentDetail(false)
  }
})

watch(() => [currentDetail.value?.id, currentDetail.value?.kind, detailSeasonMenu.value.map((item) => item.id).join(',')] as const, async ([detailId, detailKind]) => {
  if (!detailId) return
  if (detailKind === 'series' && detailSeasonMenu.value.length > 0 && !selectedDetailSeason.value) {
    selectedSeasonId.value = activeDetailSeason.value?.id || ''
    if (registry.currentServer) {
      try {
        await content.loadLibraryPage(registry.currentServer, selectedSeasonId.value, false, false)
      } catch {
        // ignore
      }
    }
  }
  if (detailKind !== 'series') {
    selectedSeasonId.value = ''
  }
})

watch(() => detailEpisodeItems.value.map((item) => item.id).join(','), async (episodeIds) => {
  if (!episodeIds || selectedEpisodeId.value) return
  const firstEpisode = detailEpisodeItems.value[0]
  if (!firstEpisode) return
  selectedEpisodeId.value = firstEpisode.id
  if (registry.currentServer) {
    try {
      await content.loadItemDetail(registry.currentServer, firstEpisode.id, false)
    } catch {
      // ignore
    }
  }
})

watch(() => detailDisplayedItem.value.id, () => {
  selectedSourceId.value = ''
  versionMenuVisible.value = false
  mediaInfoModalVisible.value = false
  activeMediaInfoCard.value = null
  selectedAudioStreamIndex.value = -1
  selectedSubtitleStreamIndex.value = -1
})

watch(detailMediaCards, (cards) => {
  if (!cards.length) {
    selectedAudioStreamIndex.value = -1
    selectedSubtitleStreamIndex.value = -1
    return
  }
  const defaultAudio = cards.find((card) => card.kind === 'audio' && card.selected && typeof card.streamIndex === 'number')
    || cards.find((card) => card.kind === 'audio' && typeof card.streamIndex === 'number')
  const defaultSubtitle = cards.find((card) => card.kind === 'subtitle' && card.selected && typeof card.streamIndex === 'number')
    || cards.find((card) => card.kind === 'subtitle' && typeof card.streamIndex === 'number')

  selectedAudioStreamIndex.value = typeof defaultAudio?.streamIndex === 'number' ? defaultAudio.streamIndex : -1
  selectedSubtitleStreamIndex.value = typeof defaultSubtitle?.streamIndex === 'number' ? defaultSubtitle.streamIndex : -1
  if (activeMediaInfoCard.value) {
    activeMediaInfoCard.value = cards.find((card) => card.id === activeMediaInfoCard.value?.id) || activeMediaInfoCard.value
  }
}, { immediate: true })

watch(() => [registry.currentServer?.id, currentRoute.value.kind, currentRoute.value.kind === 'collection-page' ? currentRoute.value.collectionId : ''] as const, ([serverId, routeKind]) => {
  if (serverId && routeKind === 'collection-page') {
    loadCurrentCollection(false)
  }
})

const loadCurrentSearch = async (force = false) => {
  if (!registry.currentServer || currentRoute.value.kind !== 'search') return
  const query = (currentRoute.value.query || '').trim()
  searchText.value = query
  if (!query) {
    await loadCurrentSearchSuggestions(force)
    return
  }
  try {
    await content.loadSearch(registry.currentServer, query, force)
  } catch {
    // store keeps error state
  }
}

watch(() => [registry.currentServer?.id, currentRoute.value.kind, currentRoute.value.kind === 'search' ? currentRoute.value.query || '' : ''] as const, ([serverId, routeKind, query]) => {
  if (routeKind === 'search') {
    searchText.value = query
  }
  if (serverId && routeKind === 'search') {
    loadCurrentSearch(false)
  }
})

watch(() => registry.currentServer?.baseUrl, () => {
  if (!registry.currentServer) return
  if (currentRoute.value.kind === 'home') {
    visibleHomeLibraryCount.value = HOME_LIBRARY_BATCH_SIZE
    loadCurrentServerHome(true)
    return
  }
  if (
    currentRoute.value.kind === 'library-root'
    || currentRoute.value.kind === 'library-page'
    || currentRoute.value.kind === 'genre-page'
    || currentRoute.value.kind === 'studio-page'
  ) {
    loadCurrentLibrary(true)
    return
  }
  if (currentRoute.value.kind === 'item-detail' || currentRoute.value.kind === 'person-page') {
    loadCurrentDetail(true)
    return
  }
  if (currentRoute.value.kind === 'collection-page') {
    loadCurrentCollection(true)
    return
  }
  if (currentRoute.value.kind === 'search') {
    if ((currentRoute.value.query || '').trim()) loadCurrentSearch(true)
    else loadCurrentSearchSuggestions(true)
  }
})

onUnmounted(() => {
  if (homeRefreshTimer) {
    clearInterval(homeRefreshTimer)
    homeRefreshTimer = null
  }
})
</script>

<style scoped>
.media-server-workspace {
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
}

.server-empty-shell,
.workspace-page {
  height: 100%;
  overflow: auto;
  padding: 28px;
}

.server-empty-shell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 16px;
}

.server-empty-shell h2,
.workspace-header h2 {
  margin: 0;
  font-size: 32px;
}

.server-empty-shell p,
.workspace-header p {
  margin: 0;
  color: var(--color-text-2);
  line-height: 1.7;
}

.workspace-header {
  margin-bottom: 24px;
}

.workspace-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, auto);
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
  padding: 12px 18px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.7));
  backdrop-filter: blur(22px);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
}

.workspace-toolbar :deep(.arco-btn),
.home-page :deep(.arco-btn),
.search-shell-media-server :deep(.arco-btn),
.library-shell :deep(.arco-btn),
.collection-shell :deep(.arco-btn),
.server-empty-shell :deep(.arco-btn),
.home-settings-menu :deep(.arco-select-view),
.home-settings-menu :deep(.arco-input-wrapper),
.home-settings-menu :deep(.arco-input-number) {
  background: rgba(250, 245, 240, 0.52);
  border-color: rgba(255, 255, 255, 0.72);
  color: rgba(24, 24, 24, 0.88);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
}

.workspace-toolbar :deep(.arco-btn:hover),
.home-page :deep(.arco-btn:hover),
.search-shell-media-server :deep(.arco-btn:hover),
.library-shell :deep(.arco-btn:hover),
.collection-shell :deep(.arco-btn:hover),
.server-empty-shell :deep(.arco-btn:hover) {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  color: rgba(24, 24, 24, 0.96);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.12);
}

.toolbar-left {
  min-width: 0;
}

.toolbar-center {
  display: flex;
  justify-content: center;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
  max-width: 100%;
}

.home-poster-toggle {
  display: inline-flex;
  gap: 8px;
}

.home-settings-menu {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 320px;
  padding: 14px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(244, 248, 255, 0.4));
  border: 1px solid rgba(255, 255, 255, 0.64);
  box-shadow:
    0 18px 40px rgba(63, 46, 37, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.38);
  backdrop-filter: blur(22px) saturate(140%);
}

.home-settings-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.home-settings-title {
  font-size: 18px;
  font-weight: 800;
  color: rgba(15, 23, 42, 0.96);
}

.home-settings-subtitle {
  color: rgba(71, 85, 105, 0.86);
  font-size: 12px;
  line-height: 1.55;
}

.home-settings-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.home-settings-group-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(100, 116, 139, 0.92);
}

.home-settings-check {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(17, 24, 39, 0.92);
  font-size: 14px;
  font-weight: 700;
}

.home-settings-check :deep(.arco-checkbox-label) {
  display: none;
}

.home-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: rgba(17, 24, 39, 0.88);
  font-weight: 700;
}

.server-switch-menu {
  padding: 8px;
  min-width: 240px;
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(244, 248, 255, 0.36));
  border: 1px solid rgba(255, 255, 255, 0.56);
  box-shadow:
    0 22px 48px rgba(63, 46, 37, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(24px) saturate(145%);
}

:deep(.server-switch-dropdown .arco-dropdown-list-wrapper),
:deep(.server-switch-dropdown .arco-dropdown-list) {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.back-button {
  min-height: 52px;
  padding: 0 18px;
}

.workspace-header-card {
  margin-bottom: 24px;
  padding: 20px 22px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.workspace-header-main {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}

.workspace-header-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.workspace-summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.summary-item {
  min-width: 120px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.summary-item strong {
  display: block;
  margin-bottom: 4px;
  font-size: 18px;
}

.summary-item span {
  color: var(--color-text-2);
  font-size: 12px;
}

.workspace-eyebrow {
  margin-bottom: 8px;
  color: var(--color-primary-6);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.workspace-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.workspace-tab {
  min-height: 52px;
  padding: 0 18px;
  border-radius: 18px;
  font-weight: 700;
  color: rgba(17, 24, 39, 0.92);
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.workspace-tab.active {
  background: rgba(240, 235, 230, 0.74);
  color: rgba(22, 22, 22, 0.92);
}

.placeholder-card {
  padding: 28px;
  border-radius: 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.72));
  backdrop-filter: blur(20px);
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.08);
}

.placeholder-card h3 {
  margin: 0 0 10px;
  font-size: 24px;
}

.placeholder-card p {
  margin: 0;
  color: var(--color-text-2);
  line-height: 1.8;
  max-width: 760px;
}

.home-page {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.home-intro h3 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #111827;
}

.home-intro p {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
}

.listing-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 6px 0;
}

.listing-display-toggle {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.listing-toggle-group {
  display: inline-flex;
  gap: 10px;
  flex-wrap: wrap;
}

.workspace-toolbar :deep(.arco-btn),
.home-page :deep(.arco-btn),
.search-shell-media-server :deep(.arco-btn),
.library-shell :deep(.arco-btn),
.collection-shell :deep(.arco-btn),
.server-empty-shell :deep(.arco-btn),
.back-button,
.workspace-tab,
.server-switcher-chip {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background:
    linear-gradient(180deg, rgba(226, 232, 240, 0.52), rgba(203, 213, 225, 0.32)),
    radial-gradient(circle at top, rgba(255, 255, 255, 0.3), transparent 70%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.46),
    0 14px 30px rgba(148, 163, 184, 0.22),
    0 4px 12px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(24px) saturate(145%);
  color: rgba(22, 22, 22, 0.92);
  font-weight: 700;
}

.workspace-toolbar :deep(.arco-btn),
.home-page :deep(.arco-btn),
.search-shell-media-server :deep(.arco-btn),
.library-shell :deep(.arco-btn),
.collection-shell :deep(.arco-btn),
.server-empty-shell :deep(.arco-btn),
.server-switcher-chip {
  min-height: 52px;
  padding: 0 18px;
  border-radius: 18px;
}

.workspace-toolbar :deep(.arco-btn:hover),
.home-page :deep(.arco-btn:hover),
.search-shell-media-server :deep(.arco-btn:hover),
.library-shell :deep(.arco-btn:hover),
.collection-shell :deep(.arco-btn:hover),
.server-empty-shell :deep(.arco-btn:hover),
.back-button:hover,
.workspace-tab:hover,
.server-switcher-chip:hover {
  border-color: rgba(96, 165, 250, 0.34);
  background:
    linear-gradient(180deg, rgba(219, 234, 254, 0.58), rgba(191, 219, 254, 0.34)),
    radial-gradient(circle at top, rgba(255, 255, 255, 0.38), transparent 70%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.54),
    0 18px 36px rgba(96, 165, 250, 0.2),
    0 4px 12px rgba(15, 23, 42, 0.06);
  color: rgba(22, 22, 22, 0.92);
}

.workspace-toolbar :deep(.arco-btn.arco-btn-primary),
.home-page :deep(.arco-btn.arco-btn-primary),
.search-shell-media-server :deep(.arco-btn.arco-btn-primary),
.library-shell :deep(.arco-btn.arco-btn-primary),
.collection-shell :deep(.arco-btn.arco-btn-primary),
.server-empty-shell :deep(.arco-btn.arco-btn-primary),
.workspace-tab.active,
.server-switcher-chip.active {
  border-color: rgba(96, 165, 250, 0.4);
  background:
    linear-gradient(180deg, rgba(191, 219, 254, 0.72), rgba(147, 197, 253, 0.4)),
    radial-gradient(circle at top, rgba(255, 255, 255, 0.34), transparent 70%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 18px 38px rgba(96, 165, 250, 0.24),
    0 4px 12px rgba(15, 23, 42, 0.06);
  color: rgba(22, 22, 22, 0.92);
}

.home-loading,
.home-error {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.75);
}

.home-error {
  justify-content: space-between;
}

.workspace-center-progress {
  min-height: min(56vh, 520px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.workspace-center-progress :deep(.arco-spin) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.detail-loading-state {
  min-height: 72vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-loading-indicator {
  width: 88px;
  height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(22px);
  box-shadow: 0 16px 40px rgba(45, 34, 24, 0.12);
}

.inline-home-error {
  margin-top: 8px;
}

.home-error-text {
  color: #b42318;
  font-weight: 600;
}

.home-library-load-more {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}

.home-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.resume-strip,
.poster-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 6px;
}

.resume-card,
.poster-tile {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.resume-card {
  width: 320px;
}

.resume-card-poster,
.poster-image {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
}

.resume-card-poster {
  width: 320px;
  height: 180px;
}

.poster-tile-landscape {
  width: 320px;
}

.poster-tile-portrait {
  width: 150px;
}

.poster-image {
  width: 320px;
  height: 180px;
}

.poster-tile-portrait .poster-image {
  width: 150px;
  height: 225px;
}

.resume-card-poster img,
.poster-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.resume-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.18) 0%, rgba(15, 23, 42, 0.06) 45%, rgba(15, 23, 42, 0.75) 100%);
}

.resume-badge {
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.cinematic-progress {
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.28);
}

.resume-card-body,
.poster-meta {
  padding: 10px 4px 0;
}

.poster-meta h5,
.resume-card-body h5 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.poster-meta p,
.resume-card-body p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.home-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.home-section-header h4 {
  margin: 0;
  font-size: 18px;
  color: #111827;
}

.home-section-header span {
  color: #94a3b8;
  font-size: 13px;
}

.see-all-button {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(250, 245, 240, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.72);
  color: rgba(24, 24, 24, 0.88);
  font-weight: 700;
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
}

.see-all-button:hover {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  color: rgba(24, 24, 24, 0.96);
}

.home-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
}

.media-card {
  padding: 0;
  overflow: hidden;
  border-radius: 22px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
}

.interactive-card {
  cursor: pointer;
  text-align: left;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.interactive-card:hover {
  transform: translateY(-2px);
  border-color: rgba(22, 119, 255, 0.2);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12);
}

.media-card-poster {
  position: relative;
  aspect-ratio: 2 / 3;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
}

.media-card-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-card-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  position: relative;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.42), transparent 56%),
    linear-gradient(180deg, rgba(226, 232, 240, 0.92) 0%, rgba(203, 213, 225, 0.96) 100%);
  color: transparent;
  user-select: none;
}

.media-card-placeholder::before {
  content: '';
  width: clamp(48px, 20%, 76px);
  height: clamp(48px, 20%, 76px);
  border-radius: 18px;
  background: center / contain no-repeat url('/icon.svg');
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
  filter: grayscale(1) brightness(0.72) contrast(0.92);
  opacity: 0.88;
}

.media-image-frame .media-image-placeholder {
  display: none;
}

.media-image-frame:not(.has-image) .media-image-placeholder,
.media-image-frame.is-broken .media-image-placeholder {
  display: flex;
}

.media-image-frame.is-broken img {
  display: none;
}

.media-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
}

.media-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #fb923c, #f97316);
}

.media-card-body {
  padding: 14px 14px 16px;
}

.media-card-body h5 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
}

.media-card-body p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-width: none;
}

.empty-placeholder {
  padding: 18px 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  color: #94a3b8;
  font-size: 14px;
}

.placeholder-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 24px;
}

.placeholder-block {
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.placeholder-block h4 {
  margin: 0 0 6px;
  font-size: 17px;
}

.placeholder-block span {
  color: var(--color-text-2);
  font-size: 13px;
}

.server-switcher-block {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.server-switcher-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.server-switcher-header h4 {
  margin: 0;
  font-size: 18px;
}

.server-switcher-header span {
  color: var(--color-text-2);
  font-size: 13px;
}

.server-switcher-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.server-switcher-chip {
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.server-switcher-chip.active {
  color: #1677ff;
  border-color: rgba(22, 119, 255, 0.2);
  background: rgba(22, 119, 255, 0.08);
}

.search-shell {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.search-shell-media-server {
  gap: 28px;
}

.search-input {
  max-width: 720px;
}

.search-input-hero {
  width: min(760px, 100%);
  align-self: center;
}

.search-input-hero :deep(.arco-input-wrapper),
.search-input-hero :deep(.arco-input-group-wrapper),
.search-input-hero :deep(.arco-input-search) {
  min-height: 60px;
  border-radius: 22px;
}

.search-input-hero :deep(.arco-input) {
  height: 58px;
  font-size: 18px;
  padding-left: 18px;
}

.search-input-hero :deep(.arco-input-search-btn) {
  height: 52px;
  margin: 4px;
  border-radius: 18px;
  padding: 0 22px;
  font-size: 15px;
  font-weight: 700;
}

.search-input-hero :deep(.arco-input-prefix),
.search-input-hero :deep(.arco-input-suffix) {
  font-size: 18px;
}

.search-feedback-card {
  width: min(760px, 100%);
  align-self: center;
}

.search-result-stack {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.search-empty-state {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 16px;
}

.search-empty-state i {
  font-size: 44px;
  color: rgba(140, 152, 168, 0.8);
}

.collection-loading-inline {
  margin-top: 8px;
}

.statistics-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 4px;
}

.stat-card {
  padding: 18px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(15, 23, 42, 0.08);
  text-align: center;
}

.stat-card strong {
  display: block;
  margin-bottom: 6px;
  font-size: 22px;
  color: #111827;
}

.stat-card span {
  color: #64748b;
  font-size: 13px;
}

.search-sections {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.library-shell {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin-top: 24px;
  align-items: start;
}

.library-shell.library-shell-portrait {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.library-shell.library-shell-landscape {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

.library-shell.library-shell-list {
  grid-template-columns: 1fr;
  gap: 16px;
}

.library-card {
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
  backdrop-filter: none;
  align-self: start;
}

.library-card.library-card-hero {
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
  backdrop-filter: none;
}

.library-card:not(.library-card-hero) {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.library-card.library-card-list {
  flex-direction: row;
  align-items: stretch;
  gap: 18px;
}

.library-card.library-card-portrait {
  padding: 0;
}

.library-card.library-card-list.library-card-portrait .library-cover {
  width: 170px;
  min-width: 170px;
}

.library-card.library-card-list.library-card-landscape .library-cover {
  width: 280px;
  min-width: 280px;
}

.library-card.interactive {
  cursor: pointer;
  text-align: left;
  transition: transform 0.24s ease;
}

.library-card.interactive:hover {
  transform: translateY(-2px);
}

.library-cover {
  position: relative;
  display: block;
  width: 100%;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 16px;
  aspect-ratio: 16 / 9;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
}

.library-cover.library-cover-fallback {
  background: transparent;
}

.library-cover.library-cover-list {
  margin-bottom: 0;
}

.library-card-hero .library-cover {
  margin-bottom: 0;
  border-radius: 24px;
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.08);
}

.listing-overlay-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.74);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.library-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(8, 15, 28, 0.14) 0%,
    rgba(8, 15, 28, 0.24) 54%,
    rgba(8, 15, 28, 0.38) 100%
  );
}

.library-cover-title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(82%, 360px);
  text-align: center;
  color: #fff;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 800;
  text-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.library-card-portrait .library-cover {
  aspect-ratio: 2 / 3;
  min-height: 0;
}

.library-card-landscape .library-cover {
  aspect-ratio: 16 / 9;
  min-height: 0;
}

.library-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease;
}

.library-cover .media-image-placeholder {
  position: absolute;
  inset: 0;
}

.library-cover.library-cover-fallback .media-image-placeholder {
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.42), transparent 56%),
    linear-gradient(180deg, rgba(226, 232, 240, 0.94) 0%, rgba(203, 213, 225, 0.98) 100%);
}

.detail-shell {
  display: flex;
  flex-direction: column;
  gap: 26px;
  position: relative;
}

.detail-experience {
  padding-top: 12px;
}

.detail-backdrop-layer {
  position: absolute;
  inset: 0 0 auto 0;
  height: 520px;
  overflow: hidden;
  border-radius: 28px;
  pointer-events: none;
}

.detail-backdrop-layer img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.04);
  filter: saturate(0.92) blur(1px);
}

.detail-backdrop-fade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.22) 48%, rgba(255, 255, 255, 0.82) 82%, rgba(255, 255, 255, 0.96) 100%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 42%, rgba(255, 255, 255, 0.3) 100%);
}

.detail-backdrop-glow {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 24px;
  height: 180px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  filter: blur(80px);
}

.detail-glass-panel {
  position: relative;
  z-index: 1;
  padding: 24px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.58));
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: 0 26px 56px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(26px);
}

.detail-hero {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.detail-poster {
  overflow: hidden;
  border-radius: 24px;
  aspect-ratio: 2 / 3;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 22px 42px rgba(15, 23, 42, 0.14);
}

.detail-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.detail-main h3 {
  margin: 0 0 10px;
  font-size: 40px;
  line-height: 1.06;
  letter-spacing: -0.03em;
  color: #111827;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
  color: #64748b;
  font-size: 14px;
}

.detail-attribute-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.detail-attribute-chip {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #1f2937;
  font-size: 12px;
  font-weight: 700;
  backdrop-filter: blur(10px);
}

.detail-overview {
  margin: 0 0 16px;
  max-width: none;
  color: #334155;
  line-height: 1.9;
  font-size: 15px;
}

.detail-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}

.detail-action-button {
  padding: 10px 16px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.62);
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.detail-action-button:hover {
  transform: translateY(-1px);
  border-color: rgba(22, 119, 255, 0.16);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.08);
}

.detail-action-button-primary {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.92), rgba(59, 130, 246, 0.84));
  color: #fff;
  border-color: rgba(37, 99, 235, 0.18);
}

.detail-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.detail-pill-button {
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.7);
  color: #1f2937;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.detail-pill-button:hover {
  transform: translateY(-1px);
  border-color: rgba(22, 119, 255, 0.16);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.08);
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-tag {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.56);
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(37, 99, 235, 0.12);
}

.detail-section-block {
  position: relative;
  z-index: 1;
  padding: 20px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.68));
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(20px);
}

.detail-about-grid {
  display: grid;
  grid-template-columns: 1.3fr 0.9fr 0.8fr;
  gap: 16px;
}

.detail-info-card {
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.76));
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
}

.detail-info-title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}

.detail-info-text {
  color: #475569;
  font-size: 14px;
  line-height: 1.85;
}

.detail-info-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #64748b;
  font-size: 13px;
}

.detail-info-row strong {
  color: #111827;
  font-size: 14px;
}

.detail-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.detail-mini-chip {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #374151;
  font-size: 12px;
  font-weight: 700;
}

.people-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}

.people-rail {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 2px 10px;
  scroll-padding-inline: 2px;
}

.person-card {
  padding: 16px 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.76));
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
  text-align: center;
}

.person-card-rail {
  width: 170px;
  flex: 0 0 auto;
}

.person-card-button {
  cursor: pointer;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}

.person-card-button:hover {
  transform: translateY(-2px);
  border-color: rgba(22, 119, 255, 0.16);
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.1);
}

.person-avatar {
  width: 84px;
  height: 84px;
  margin: 0 auto 12px;
  overflow: hidden;
  border-radius: 999px;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
}

.person-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.person-placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  position: relative;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.42), transparent 56%),
    linear-gradient(180deg, rgba(226, 232, 240, 0.92) 0%, rgba(203, 213, 225, 0.96) 100%);
  color: transparent;
  user-select: none;
}

.person-placeholder::before {
  content: '';
  width: clamp(40px, 40%, 58px);
  height: clamp(40px, 40%, 58px);
  border-radius: 16px;
  background: center / contain no-repeat url('/icon.svg');
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
  filter: grayscale(1) brightness(0.72) contrast(0.92);
  opacity: 0.88;
}

.person-name {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}

.person-role {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.detail-content-rail {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 2px 10px;
  scroll-padding-inline: 2px;
}

.detail-content-card {
  width: 280px;
  flex: 0 0 auto;
}

.detail-content-card .library-cover {
  aspect-ratio: 16 / 9;
}

.library-card:not(.library-card-hero) > h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  line-height: 1.4;
  min-height: 1.4em;
  max-height: 1.4em;
  width: 100%;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap !important;
  word-break: keep-all;
}

.library-card.library-card-list > h4,
.library-card.library-card-list > .library-meta-line {
  display: none;
}

.library-meta-line {
  margin-top: -8px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
  min-height: 1.5em;
  max-height: 1.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-list-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 6px 0;
}

.library-list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.library-list-title-wrap {
  min-width: 0;
  flex: 1;
}

.library-list-kicker {
  margin-bottom: 6px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 700;
  color: rgba(86, 97, 117, 0.82);
}

.library-list-body h4 {
  margin: 0;
  font-size: 24px;
  line-height: 1.28;
  font-weight: 800;
  color: #0f172a;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal !important;
}

.library-list-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: rgba(15, 23, 42, 0.76);
  font-size: 12px;
  font-weight: 800;
}

.library-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.library-list-meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.08);
  color: rgba(25, 56, 120, 0.88);
  font-size: 12px;
  font-weight: 700;
}

.library-list-overview {
  margin: 0;
  font-size: 14px;
  line-height: 1.72;
  color: rgba(33, 41, 56, 0.82);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

.library-list-overview.is-empty {
  color: rgba(100, 116, 139, 0.72);
}

.library-card.interactive:hover .library-cover img {
  transform: scale(1.03);
}

.server-option {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  min-width: 180px;
  align-items: center;
}

.server-option-single {
  min-height: 24px;
}

.server-option-main {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.server-option-main > span {
  font-weight: 600;
  color: #111827;
}

.server-option-icon,
.server-switch-trigger-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  overflow: hidden;
  border-radius: 9px;
  background: rgba(148, 163, 184, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.54);
}

.server-option-icon img,
.server-switch-trigger-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-switch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
}

.server-switch-trigger-text {
  display: block;
  min-width: 0;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-switch-dropdown {
  width: 260px;
  flex: 0 0 260px;
  min-width: 260px;
  max-width: 260px;
}

:deep(.server-switch-dropdown .arco-btn) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

:deep(.server-switch-dropdown .arco-btn-content) {
  min-width: 0;
  max-width: 100%;
}

.back-button-server-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 2px;
  overflow: hidden;
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.54);
}

.back-button-server-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-option-main > small {
  display: block;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.3;
  word-break: break-all;
}

:deep(.server-switch-dropdown .arco-dropdown-option),
:deep(.server-switch-dropdown .arco-dropdown-submenu) {
  width: calc(100% - 8px) !important;
  margin: 0 4px !important;
  min-height: 44px;
  padding: 10px 12px !important;
  line-height: 1.2 !important;
  border-radius: 12px !important;
  background: rgba(255, 255, 255, 0.12);
}

:deep(.server-switch-dropdown .arco-dropdown-option-content) {
  display: block;
  width: 100%;
}

.server-tree-children {
  margin: 2px 0 4px;
  padding-left: 18px;
}

.server-tree-child {
  min-height: 48px;
  padding: 8px 12px;
}

.server-tree-child.active {
  background: rgba(22, 119, 255, 0.08);
}

.server-switch-section-title {
  padding: 8px 14px 6px;
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
}

.server-switch-divider {
  height: 1px;
  margin: 6px 0;
  background: rgba(148, 163, 184, 0.18);
}

.server-icon-manager {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.server-icon-manager-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.server-icon-manager-title {
  font-size: 24px;
  font-weight: 800;
  color: #111827;
}

.server-icon-manager-subtitle,
.server-icon-grid-subtitle {
  margin-top: 6px;
  color: rgba(71, 85, 105, 0.78);
  line-height: 1.5;
}

.server-icon-manager-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.server-icon-search {
  width: 280px;
}

.server-icon-manager-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  min-height: 420px;
  max-height: 68vh;
}

.server-icon-set-column,
.server-icon-grid-column,
.server-icon-add-panel {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 255, 0.82));
  box-shadow:
    0 22px 44px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px);
}

.server-icon-set-column,
.server-icon-grid-column {
  padding: 18px;
}

.server-icon-column-heading {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.server-icon-set-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
  max-height: 454px;
  overflow: auto;
}

.server-icon-set-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.56);
  cursor: pointer;
  transition: 0.18s ease;
}

.server-icon-set-card:hover,
.server-icon-set-card.active {
  border-color: rgba(59, 130, 246, 0.28);
  background: linear-gradient(180deg, rgba(240, 247, 255, 0.92), rgba(230, 240, 255, 0.84));
  box-shadow: 0 16px 30px rgba(37, 99, 235, 0.12);
}

.server-icon-set-preview {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.14);
  flex: 0 0 auto;
}

.server-icon-set-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-icon-set-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(71, 85, 105, 0.72);
  font-size: 12px;
  font-weight: 700;
}

.server-icon-set-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  text-align: left;
}

.server-icon-set-meta strong,
.server-icon-item span {
  color: #0f172a;
}

.server-icon-set-meta span {
  color: rgba(71, 85, 105, 0.76);
  font-size: 12px;
  line-height: 1.5;
}

.server-icon-grid-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.server-icon-grid-tools {
  display: flex;
  gap: 8px;
}

.server-icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 14px;
  max-height: 420px;
  overflow: auto;
  padding-right: 4px;
}

.server-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.56);
  cursor: pointer;
  transition: 0.18s ease;
}

.server-icon-item:hover,
.server-icon-item.active {
  border-color: rgba(59, 130, 246, 0.3);
  background: linear-gradient(180deg, rgba(240, 247, 255, 0.94), rgba(230, 240, 255, 0.86));
  box-shadow: 0 16px 28px rgba(37, 99, 235, 0.12);
}

.server-icon-item-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border-radius: 22px;
  background: rgba(148, 163, 184, 0.14);
}

.server-icon-item-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.server-icon-item span {
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  line-height: 1.45;
}

.server-icon-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 240px;
  color: rgba(71, 85, 105, 0.72);
}

.server-icon-add-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px;
}

.server-icon-add-input {
  width: 100%;
}

.server-icon-add-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.server-option-check {
  color: #1677ff;
  font-weight: 700;
}

.workspace-page-detail {
  padding: 0;
}

.workspace-content-detail {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.detail-page {
  min-height: 100%;
  color: #171717;
  background: transparent;
}

.person-shell {
  min-height: 100%;
}

.person-hero {
  position: relative;
  min-height: 880px;
  overflow: hidden;
}

.person-hero-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  image-rendering: -webkit-optimize-contrast;
}

.person-hero-backdrop-fallback {
  background: linear-gradient(180deg, rgba(144, 136, 128, 0.92), rgba(190, 178, 165, 0.9));
}

.person-hero-mask {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(10, 10, 10, 0.03) 0%, rgba(20, 20, 20, 0.05) 34%, rgba(231, 224, 216, 0.52) 78%, rgba(228, 216, 204, 0.74) 100%),
    linear-gradient(180deg, transparent 60%, rgba(228, 216, 204, 0.52) 100%);
}

.person-hero-overlay {
  position: relative;
  z-index: 2;
  min-height: 880px;
  display: flex;
  align-items: flex-end;
  padding: 0 20px 20px;
}

.person-hero-card-row {
  display: flex;
  align-items: flex-end;
  gap: 20px;
}

.person-hero-poster {
  width: 130px;
  height: 195px;
  overflow: hidden;
  border-radius: 10px;
  box-shadow: 0 18px 36px rgba(25, 20, 18, 0.22);
  background: rgba(255, 255, 255, 0.22);
  flex: 0 0 auto;
}

.person-hero-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.person-shelf-card {
  width: min(520px, calc(100vw - 210px));
  min-height: 195px;
  padding: 6px 18px 10px;
  border-radius: 18px;
  background: rgba(248, 244, 239, 0.56);
  border: 1px solid rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(18px);
  box-shadow: 0 14px 32px rgba(48, 38, 31, 0.12);
}

.person-shelf-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.person-shelf-title {
  font-size: 28px;
  line-height: 1.15;
  font-weight: 800;
  color: rgba(10, 10, 10, 0.96);
}

.person-shelf-meta {
  margin-top: 10px;
  font-size: 18px;
  color: rgba(70, 70, 70, 0.78);
}

.person-shelf-actions {
  display: flex;
  gap: 10px;
}

.person-mini-action {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(250, 245, 240, 0.48);
  backdrop-filter: blur(16px);
  color: rgba(20, 20, 20, 0.92);
  cursor: pointer;
}

.person-mini-action.active {
  background: rgba(255, 251, 247, 0.72);
}

.person-shelf-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.person-shelf-overview {
  margin: 0;
  max-width: none;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(25, 25, 25, 0.9);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.person-bio-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.person-bio-row-inline {
  gap: 6px;
}

.person-bio-row span {
  font-size: 12px;
  font-weight: 700;
  color: rgba(84, 84, 84, 0.78);
}

.person-bio-row strong {
  font-size: 13px;
  font-weight: 600;
  color: rgba(23, 23, 23, 0.92);
}

.person-content {
  padding: 12px 0 44px;
  background: rgba(255, 255, 255, 1);
}

.person-content-divider {
  height: 1px;
  margin-bottom: 20px;
  background: rgba(15, 23, 42, 0.08);
}

.person-section {
  padding: 0 20px;
  margin-bottom: 28px;
}

.person-section-header {
  margin-bottom: 16px;
}

.person-section-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(27, 27, 27, 0.84);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.person-poster-rail,
.person-episode-rail,
.person-people-rail {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding: 4px 2px 10px;
  scroll-padding-inline: 2px;
}

.person-rail-card {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.person-rail-card-poster {
  width: 156px;
}

.person-rail-card-episode {
  width: 282px;
}

.person-rail-poster {
  overflow: hidden;
  border-radius: 14px;
  background: rgba(243, 244, 246, 0.92);
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
  position: relative;
}

.person-poster-cover {
  aspect-ratio: 2 / 3;
}

.person-episode-cover {
  aspect-ratio: 16 / 9;
}

.person-rail-poster img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.person-poster-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(100, 212, 102, 0.92);
  color: rgba(8, 28, 10, 0.9);
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(46, 125, 50, 0.18);
}

.person-rail-kicker {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(72, 72, 72, 0.76);
}

.person-rail-title {
  margin-top: 8px;
  font-size: 16px;
  line-height: 1.35;
  font-weight: 800;
  color: rgba(17, 17, 17, 0.96);
}

.person-rail-title-episode {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.person-rail-subtitle {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(98, 98, 98, 0.82);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.person-rail-overview {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(88, 88, 88, 0.84);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.person-chip-row {
  gap: 14px;
}

.person-link-chip {
  text-decoration: none;
}

.person-about-section {
  padding-bottom: 20px;
}

.person-about-card {
  max-width: 760px;
  padding: 20px 22px;
  border-radius: 20px;
  background: rgba(248, 244, 239, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(16px);
}

.person-about-title {
  font-size: 22px;
  font-weight: 800;
  color: rgba(20, 20, 20, 0.96);
}

.person-about-subtitle {
  margin-top: 4px;
  font-size: 15px;
  color: rgba(88, 88, 88, 0.78);
}

.person-about-text {
  margin-top: 14px;
  font-size: 15px;
  line-height: 1.8;
  color: rgba(26, 26, 26, 0.82);
}

.detail-shell {
  gap: 0;
  isolation: isolate;
  overflow: hidden;
  --detail-fog-rgb: 174, 188, 196;
  background: rgba(var(--detail-fog-rgb), 0.88);
}

.detail-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(var(--detail-fog-rgb), 0.06) 28%, rgba(var(--detail-fog-rgb), 0.1) 100%),
    radial-gradient(circle at 26% 18%, rgba(232, 238, 240, 0.08), transparent 32%),
    radial-gradient(circle at 78% 16%, rgba(82, 103, 116, 0.06), transparent 34%);
  backdrop-filter: blur(10px) saturate(106%);
}

.detail-page-backdrop {
  position: absolute;
  inset: 0;
  z-index: -3;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  object-fit: cover;
  object-position: center top;
  transform: scale(1.04);
  filter: blur(34px) saturate(0.92) brightness(0.96);
  opacity: 0.56;
}

.detail-page-tint {
  position: absolute;
  inset: 0;
  z-index: -2;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(210, 222, 228, 0.08) 0%, rgba(188, 203, 212, 0.16) 42%, rgba(var(--detail-fog-rgb), 0.18) 100%);
}

.detail-backdrop-stage {
  position: relative;
  min-height: clamp(940px, 96vh, 1180px);
  overflow: hidden;
  border-radius: 0;
}

.detail-backdrop-image,
.detail-backdrop-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.detail-backdrop-image {
  object-fit: cover;
  object-position: center 28%;
  image-rendering: -webkit-optimize-contrast;
}

.detail-backdrop-fallback {
  background: linear-gradient(180deg, rgba(122, 101, 88, 0.82), rgba(208, 190, 176, 0.76));
}

.detail-backdrop-mask {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.01) 0%, rgba(0, 0, 0, 0.005) 34%, rgba(178, 196, 207, 0.06) 58%, rgba(178, 194, 203, 0.16) 78%, rgba(var(--detail-fog-rgb), 0.08) 100%),
    linear-gradient(90deg, rgba(176, 194, 204, 0.06) 0%, rgba(214, 225, 230, 0.2) 48%, rgba(98, 116, 126, 0.12) 100%);
}

.detail-backdrop-bottom-haze {
  position: absolute;
  left: -8%;
  right: -8%;
  bottom: -90px;
  height: 440px;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, rgba(215, 226, 231, 0.6) 0%, rgba(191, 206, 214, 0.48) 28%, rgba(var(--detail-fog-rgb), 0.3) 58%, transparent 84%);
  filter: blur(30px);
}

.detail-top-back {
  position: absolute;
  top: 16px;
  left: 18px;
  z-index: 3;
}

.detail-back-button {
  height: 44px;
  padding: 0 18px;
  border-radius: 18px;
  color: rgba(17, 17, 17, 0.92);
  font-size: 15px;
  font-weight: 700;
  background: rgba(250, 245, 240, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.12);
  backdrop-filter: blur(18px) saturate(135%);
}

.detail-back-button:hover {
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(255, 255, 255, 0.86);
}

.detail-hero-copy {
  position: absolute;
  inset: 0;
  z-index: 2;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 120px 58px 78px;
}

.detail-title-block {
  margin-bottom: 0;
  max-width: 760px;
}

.detail-hero-title {
  max-width: 760px;
  font-size: clamp(34px, 4.2vw, 62px);
  line-height: 1.08;
  font-weight: 900;
  letter-spacing: -0.03em;
  color: rgba(10, 15, 24, 0.98);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.16);
}

.detail-hero-logo {
  display: block;
  max-width: 430px;
  max-height: 130px;
  object-fit: contain;
  object-position: left center;
  filter:
    drop-shadow(0 8px 18px rgba(255, 255, 255, 0.22))
    drop-shadow(0 14px 30px rgba(0, 0, 0, 0.18));
}

.detail-overlay-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  column-gap: 30px;
  align-items: end;
  width: min(1880px, 100%);
}

.detail-hero-poster {
  width: 280px;
  aspect-ratio: 2 / 3;
  border-radius: 24px;
  overflow: hidden;
  background: rgba(18, 24, 36, 0.08);
  box-shadow: 0 26px 64px rgba(34, 43, 58, 0.18);
}

.detail-hero-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.detail-hero-main {
  min-height: 470px;
  max-width: 1040px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
}

.detail-actions-column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 340px;
  min-width: 340px;
  max-width: 340px;
}

.detail-icon-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
}

.detail-square-action,
.detail-primary-play,
.detail-secondary-download,
.detail-chip-button,
.detail-chip-link {
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px);
}

.detail-square-action {
  width: 100%;
  height: 62px;
  border-radius: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(22, 22, 22, 0.92);
  cursor: pointer;
}

.detail-square-action.active {
  background: rgba(240, 235, 230, 0.74);
}

.detail-square-glyph {
  font-size: 22px;
  line-height: 1;
  font-weight: 700;
}

.detail-primary-play {
  width: 100%;
  min-width: 0;
  height: 62px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  font-size: 17px;
  font-weight: 800;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.96), rgba(59, 130, 246, 0.88));
  border-color: rgba(96, 165, 250, 0.38);
  box-shadow: 0 22px 42px rgba(24, 70, 166, 0.32);
  cursor: pointer;
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.detail-secondary-download {
  width: 100%;
  min-width: 0;
  height: 52px;
  border-radius: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(22, 22, 22, 0.92);
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

.detail-secondary-download:hover {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.12);
}

.detail-primary-play:hover {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(96, 165, 250, 0.9));
  border-color: rgba(147, 197, 253, 0.48);
  box-shadow: 0 26px 52px rgba(24, 70, 166, 0.42);
}

.detail-primary-play > span {
  position: relative;
  z-index: 1;
}

.detail-play-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-square-action-version[disabled] {
  opacity: 0.65;
  cursor: default;
}

.detail-version-menu {
  min-width: 268px;
  padding: 10px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  background: rgba(236, 230, 224, 0.92);
  backdrop-filter: blur(26px);
  box-shadow: 0 18px 40px rgba(32, 18, 8, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-version-option {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.52);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.detail-version-option:hover {
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(53, 93, 255, 0.22);
  transform: translateY(-1px);
}

.detail-version-option.active {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(53, 93, 255, 0.24);
}

.detail-version-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.detail-version-main span {
  color: rgba(25, 25, 25, 0.94);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  text-align: left;
}

.detail-version-main small {
  color: rgba(90, 90, 90, 0.72);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
}

.detail-version-check {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 999px;
  color: #2457ff;
  font-size: 12px;
  font-weight: 700;
  background: rgba(36, 87, 255, 0.12);
}

.detail-play-glyph {
  font-size: 15px;
  line-height: 1;
}

.detail-synopsis-column {
  max-width: 760px;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
  padding-top: 0;
  padding-bottom: 0;
  overflow: visible;
}

.detail-episode-heading {
  font-size: 18px;
  font-weight: 800;
  color: rgba(22, 22, 22, 0.94);
}

.detail-rating-line {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 16px;
  font-weight: 700;
  color: rgba(18, 24, 35, 0.9);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.detail-star-rating {
  color: #ff5c4d;
}

.detail-tech-line {
  font-size: 16px;
  line-height: 1.5;
  font-weight: 800;
  color: rgba(18, 24, 35, 0.9);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.detail-meta-badges {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.detail-meta-badge {
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  background: rgba(255, 255, 255, 0.46);
  color: rgba(17, 24, 39, 0.9);
  font-size: 14px;
  font-weight: 700;
}

.detail-overview-block {
  display: block;
  min-height: 0;
  padding-top: 6px;
}

.detail-overview-block.is-empty {
  min-height: 0;
}

.detail-overview {
  margin: 0;
  font-size: 15px;
  line-height: 1.72;
  color: rgba(12, 18, 28, 0.9);
  font-weight: 600;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.detail-overview.is-empty {
  min-height: calc(1.72em * 2);
}

.detail-lower-content {
  position: relative;
  z-index: 1;
  margin-top: 0;
  padding: 26px 30px 34px;
  background: transparent;
}

.detail-section {
  margin-bottom: 38px;
}

.detail-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.detail-section-header h4 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: rgba(20, 20, 20, 0.96);
}

.detail-season-picker,
.detail-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.detail-season-picker {
  margin-bottom: 18px;
}

.detail-chip-button,
.detail-chip-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  border-radius: 18px;
  color: rgba(17, 24, 39, 0.94);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.detail-chip-button.active {
  background: rgba(255, 250, 245, 0.68);
}

.detail-chip-link {
  text-decoration: none;
}

.detail-link-glyph {
  font-size: 16px;
  line-height: 1;
}

.detail-episodes-rail,
.detail-recommendation-rail,
.detail-people-rail {
  display: flex;
  gap: 34px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.detail-episode-card {
  width: 320px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.detail-episode-cover {
  position: relative;
  width: 100%;
  height: 180px;
  overflow: hidden;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.16);
  box-shadow: 0 18px 30px rgba(63, 46, 37, 0.18);
}

.detail-episode-card.selected .detail-episode-cover {
  outline: 3px solid rgba(255, 255, 255, 0.92);
  outline-offset: -3px;
}

.detail-episode-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.detail-episode-selected-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #4a7df1;
  color: #fff;
  font-size: 16px;
  font-weight: 800;
}

.detail-episode-progress {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.36);
}

.detail-episode-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #ff8f42;
}

.detail-episode-kicker {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 700;
  color: rgba(30, 30, 30, 0.78);
}

.detail-episode-title {
  margin-top: 2px;
  font-size: 18px;
  font-weight: 800;
  color: rgba(20, 20, 20, 0.96);
  line-height: 1.42;
  min-height: 51px;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.detail-episode-overview {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(32, 32, 32, 0.66);
  min-height: 58px;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.detail-recommendation-card {
  width: 170px;
  flex: 0 0 auto;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}

.detail-inline-state {
  margin-bottom: 14px;
  color: rgba(32, 32, 32, 0.72);
  font-size: 14px;
  font-weight: 600;
}

.detail-recommendation-poster {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: 10px;
  box-shadow: 0 16px 26px rgba(63, 46, 37, 0.14);
}

.detail-recommendation-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.detail-recommendation-count {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border-radius: 0 0 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #71da6a;
  color: #152615;
  font-size: 14px;
  font-weight: 800;
}

.detail-recommendation-title {
  margin-top: 10px;
  font-size: 15px;
  line-height: 1.45;
  color: rgba(21, 21, 21, 0.94);
}

.detail-media-card-rail {
  display: flex;
  gap: 18px;
  overflow-x: auto;
  padding: 4px 2px 12px;
  scroll-padding-inline: 2px;
}

.detail-media-card {
  position: relative;
  width: 360px;
  min-width: 360px;
  min-height: 278px;
  flex: 0 0 auto;
  padding: 20px 22px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 16px 36px rgba(63, 46, 37, 0.12);
  backdrop-filter: blur(18px);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.detail-media-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 22px 42px rgba(63, 46, 37, 0.16);
}

.detail-media-card.selected {
  border-color: rgba(37, 99, 235, 0.26);
  background: rgba(241, 244, 251, 0.72);
  box-shadow: 0 24px 48px rgba(37, 99, 235, 0.14);
}

.detail-media-card-selected-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.96), rgba(59, 130, 246, 0.9));
  color: #fff;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.28);
  z-index: 1;
}

.detail-media-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  color: rgba(28, 28, 28, 0.96);
  font-size: 20px;
  font-weight: 800;
}

.detail-media-card-heading {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.detail-media-kind-badge {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.48);
  font-size: 17px;
  font-weight: 800;
}

.detail-media-card-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-media-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.detail-media-row span {
  color: rgba(40, 40, 40, 0.9);
  font-size: 14px;
  font-weight: 700;
}

.detail-media-row strong {
  color: rgba(79, 79, 79, 0.92);
  font-size: 14px;
  font-weight: 600;
}

.detail-file-bar {
  margin-top: 22px;
  padding: 18px 26px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  background: rgba(250, 245, 240, 0.52);
  text-align: center;
  box-shadow: 0 16px 36px rgba(63, 46, 37, 0.12);
  backdrop-filter: blur(18px);
}

.detail-media-modal :deep(.ant-modal-content) {
  border-radius: 28px;
  background: rgba(247, 241, 234, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px);
  box-shadow: 0 28px 60px rgba(56, 44, 30, 0.18);
}

.home-library-manager-panel {
  padding: 8px 4px 2px;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(244, 248, 255, 0.36));
  border: 1px solid rgba(255, 255, 255, 0.56);
  box-shadow:
    0 22px 48px rgba(63, 46, 37, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(24px) saturate(145%);
}

.home-library-manager-hint {
  margin: 0 0 14px 8px;
  color: rgba(24, 24, 24, 0.86);
  font-size: 17px;
  font-weight: 800;
}

.home-library-manager-list {
  padding: 8px 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.32);
  background: rgba(255, 255, 255, 0.18);
  min-height: 280px;
}

.home-library-manager-item {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  cursor: default;
  transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease;
}

.home-library-manager-item:last-child {
  border-bottom: 0;
}

.home-library-manager-item.dragging {
  opacity: 0.56;
  transform: scale(0.99);
}

.home-library-manager-item:hover {
  background: rgba(255, 255, 255, 0.2);
}

.home-library-manager-item :deep(.arco-checkbox) {
  flex: 1;
  min-width: 0;
}

.home-library-manager-item :deep(.arco-checkbox-label) {
  color: rgba(24, 24, 24, 0.88);
  font-size: 18px;
  font-weight: 700;
}

.home-library-manager-drag-icon {
  flex: 0 0 auto;
  color: rgba(24, 24, 24, 0.42);
  font-size: 18px;
  cursor: grab;
  padding: 6px;
  border-radius: 8px;
  -webkit-user-drag: element;
  user-select: none;
}

.home-library-manager-drag-icon:hover {
  background: rgba(255, 255, 255, 0.22);
  color: rgba(24, 24, 24, 0.72);
}

.home-library-manager-drag-icon:active {
  cursor: grabbing;
}

.home-library-manager-empty {
  padding: 56px 12px;
  text-align: center;
  color: rgba(24, 24, 24, 0.48);
  font-size: 14px;
  font-weight: 700;
}

.home-library-manager-footer {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  width: 100%;
}

.home-library-manager-footer :deep(.arco-btn) {
  min-width: 110px;
  height: 38px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 800;
}

.detail-media-modal-panel {
  padding: 20px 22px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 16px 36px rgba(63, 46, 37, 0.12);
  backdrop-filter: blur(18px);
}

.detail-media-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  color: rgba(28, 28, 28, 0.96);
  font-size: 24px;
  font-weight: 800;
}

.detail-media-modal-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px 18px;
}

.detail-media-modal-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 10px 0 12px;
  border-bottom: 1px solid rgba(120, 98, 80, 0.12);
}

.detail-media-modal-row:last-child {
  border-bottom: none;
}

.detail-media-modal-row span {
  color: rgba(40, 40, 40, 0.9);
  font-size: 15px;
  font-weight: 700;
}

.detail-media-modal-row strong {
  color: rgba(70, 70, 70, 0.96);
  font-size: 15px;
  font-weight: 600;
  word-break: break-word;
}

.detail-file-name {
  font-size: 19px;
  line-height: 1.45;
  font-weight: 700;
  color: rgba(61, 61, 61, 0.92);
  word-break: break-word;
}

.detail-file-meta {
  margin-top: 6px;
  font-size: 14px;
  color: rgba(83, 83, 83, 0.76);
}

@media (max-width: 1280px) {
  .workspace-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-center {
    justify-content: flex-start;
  }

  .toolbar-right {
    justify-content: flex-start;
  }

  .listing-intro {
    flex-direction: column;
    align-items: stretch;
  }

  .placeholder-grid,
  .search-sections,
  .library-shell,
  .statistics-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .library-shell.library-shell-list {
    grid-template-columns: 1fr;
  }

  .library-card.library-card-list {
    gap: 16px;
  }

  .library-card.library-card-list.library-card-landscape .library-cover {
    width: 240px;
    min-width: 240px;
  }

  .detail-backdrop-stage {
    min-height: 980px;
  }

  .detail-hero-copy {
    min-height: 980px;
    padding: 108px 28px 34px;
  }

  .detail-hero-title {
    font-size: 44px;
  }

  .detail-hero-logo {
    max-width: min(420px, 82vw);
    max-height: 118px;
  }

  .detail-overlay-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .detail-hero-poster {
    width: min(300px, 54vw);
  }

  .detail-actions-column {
    max-width: 460px;
  }

  .detail-synopsis-column {
    min-height: auto;
    max-height: none;
  }

  .detail-lower-content {
    margin-top: 0;
    padding: 24px 22px 28px;
  }

  .detail-media-card {
    width: 300px;
    min-width: 300px;
  }

  .person-hero {
    min-height: 760px;
  }

  .person-hero-overlay {
    padding: 500px 18px 20px;
  }

  .person-hero-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .person-shelf-card {
    width: 100%;
  }
}

@media (max-width: 900px) {
  .library-card.library-card-list {
    flex-direction: column;
  }

  .library-card.library-card-list.library-card-portrait .library-cover,
  .library-card.library-card-list.library-card-landscape .library-cover {
    width: 100%;
    min-width: 0;
  }

  .library-list-body {
    padding: 0;
  }

  .library-list-head {
    flex-direction: column;
    gap: 10px;
  }
}

[arco-theme='dark'] .media-server-workspace {
  background: linear-gradient(180deg, #0f141c 0%, #0b1017 100%);
}

[arco-theme='dark'] .search-empty-state {
  color: rgba(218, 226, 238, 0.82);
}

[arco-theme='dark'] .search-empty-state i {
  color: rgba(133, 160, 210, 0.82);
}

[arco-theme='dark'] .home-loading,
[arco-theme='dark'] .home-error {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(244, 247, 252, 0.92);
}

[arco-theme='dark'] .home-loading :deep(.arco-icon-loading),
[arco-theme='dark'] .collection-loading-inline :deep(.arco-icon-loading),
[arco-theme='dark'] .detail-loading-state :deep(.arco-icon-loading) {
  color: #7fb0ff;
}

[arco-theme='dark'] .server-empty-shell h2,
[arco-theme='dark'] .workspace-header h2,
[arco-theme='dark'] .workspace-header-card h3,
[arco-theme='dark'] .home-section-header h4,
[arco-theme='dark'] .placeholder-card h3,
[arco-theme='dark'] .workspace-eyebrow,
[arco-theme='dark'] .library-card:not(.library-card-hero) > h4,
[arco-theme='dark'] .detail-section-header h4,
[arco-theme='dark'] .detail-media-card-title,
[arco-theme='dark'] .detail-media-modal-head,
[arco-theme='dark'] .person-section-header,
[arco-theme='dark'] .person-shelf-title,
[arco-theme='dark'] .person-about-title,
[arco-theme='dark'] .detail-file-name,
[arco-theme='dark'] .detail-recommendation-title,
[arco-theme='dark'] .detail-episode-title,
[arco-theme='dark'] .detail-hero-title,
[arco-theme='dark'] .detail-main h3,
[arco-theme='dark'] .person-name,
[arco-theme='dark'] .person-role,
[arco-theme='dark'] .person-rail-title,
[arco-theme='dark'] .person-rail-title-episode,
[arco-theme='dark'] .library-list-body h4 {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-empty-shell p,
[arco-theme='dark'] .workspace-header p,
[arco-theme='dark'] .home-section-header span,
[arco-theme='dark'] .placeholder-card p,
[arco-theme='dark'] .workspace-summary,
[arco-theme='dark'] .library-meta-line,
[arco-theme='dark'] .detail-overview,
[arco-theme='dark'] .detail-tech-line,
[arco-theme='dark'] .detail-file-meta,
[arco-theme='dark'] .detail-episode-overview,
[arco-theme='dark'] .detail-episode-kicker,
[arco-theme='dark'] .detail-media-row span,
[arco-theme='dark'] .detail-media-row strong,
[arco-theme='dark'] .person-shelf-meta,
[arco-theme='dark'] .person-shelf-overview,
[arco-theme='dark'] .person-bio-row span,
[arco-theme='dark'] .person-bio-row strong,
[arco-theme='dark'] .person-about-text,
[arco-theme='dark'] .person-about-subtitle,
[arco-theme='dark'] .person-link-chip,
[arco-theme='dark'] .detail-chip-link,
[arco-theme='dark'] .detail-chip-button,
[arco-theme='dark'] .detail-meta,
[arco-theme='dark'] .detail-attribute-chip,
[arco-theme='dark'] .detail-tag,
[arco-theme='dark'] .detail-inline-state,
[arco-theme='dark'] .detail-version-main small,
[arco-theme='dark'] .detail-version-main span,
[arco-theme='dark'] .library-list-kicker,
[arco-theme='dark'] .library-list-overview,
[arco-theme='dark'] .person-rail-subtitle,
[arco-theme='dark'] .person-rail-overview {
  color: rgba(191, 201, 216, 0.78);
}

[arco-theme='dark'] .library-list-overview.is-empty {
  color: rgba(148, 163, 184, 0.74);
}

[arco-theme='dark'] .library-list-badge {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(241, 245, 249, 0.88);
}

[arco-theme='dark'] .library-list-meta-chip {
  background: rgba(96, 165, 250, 0.14);
  color: rgba(219, 234, 254, 0.92);
}

[arco-theme='dark'] .server-option-main > span {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-option-icon,
[arco-theme='dark'] .server-switch-trigger-icon {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .back-button-server-icon {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .server-option-main > small,
[arco-theme='dark'] .server-switch-section-title {
  color: rgba(191, 201, 216, 0.68);
}

[arco-theme='dark'] .server-switch-divider {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .workspace-header-card h3,
[arco-theme='dark'] .home-section-header h4,
[arco-theme='dark'] .detail-hero-title,
[arco-theme='dark'] .detail-main h3,
[arco-theme='dark'] .detail-section-header h4 {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .detail-overview,
[arco-theme='dark'] .person-shelf-overview,
[arco-theme='dark'] .person-about-text {
  color: rgba(230, 236, 244, 0.9);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
}

[arco-theme='dark'] .detail-backdrop-mask {
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.03) 0%, rgba(0, 0, 0, 0.04) 38%, rgba(10, 14, 20, 0.08) 58%, rgba(24, 32, 42, 0.14) 78%, rgba(18, 25, 34, 0.08) 100%);
}

[arco-theme='dark'] .detail-backdrop-bottom-haze {
  background:
    radial-gradient(circle at center, rgba(44, 56, 70, 0.56) 0%, rgba(30, 40, 52, 0.46) 28%, rgba(18, 25, 34, 0.3) 58%, transparent 84%);
  filter: blur(32px);
}

[arco-theme='dark'] .detail-shell {
  --detail-fog-rgb: 18, 25, 34;
  background: rgba(15, 22, 31, 0.88);
}

[arco-theme='dark'] .detail-shell::before {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.01) 0%, rgba(18, 25, 34, 0.06) 28%, rgba(18, 25, 34, 0.1) 100%),
    radial-gradient(circle at 26% 18%, rgba(72, 88, 108, 0.08), transparent 32%),
    radial-gradient(circle at 78% 16%, rgba(4, 8, 14, 0.08), transparent 34%);
}

[arco-theme='dark'] .detail-page-backdrop {
  opacity: 0.44;
  filter: blur(36px) saturate(0.9) brightness(0.58);
}

[arco-theme='dark'] .detail-page-tint {
  background:
    linear-gradient(180deg, rgba(12, 18, 26, 0.08) 0%, rgba(16, 24, 34, 0.16) 54%, rgba(12, 18, 26, 0.18) 100%);
}

[arco-theme='dark'] .workspace-toolbar,
[arco-theme='dark'] .workspace-header-card,
[arco-theme='dark'] .placeholder-card,
[arco-theme='dark'] .search-shell,
[arco-theme='dark'] .detail-loading-state,
[arco-theme='dark'] .library-card:not(.library-card-hero),
[arco-theme='dark'] .detail-glass-panel,
[arco-theme='dark'] .detail-section-block,
[arco-theme='dark'] .detail-info-card,
[arco-theme='dark'] .person-card,
[arco-theme='dark'] .person-about-card,
[arco-theme='dark'] .detail-media-card,
[arco-theme='dark'] .detail-file-bar,
[arco-theme='dark'] .detail-media-modal-panel,
[arco-theme='dark'] .home-library-manager-list,
[arco-theme='dark'] .detail-version-menu,
[arco-theme='dark'] .detail-episode-card,
[arco-theme='dark'] .detail-recommendation-card,
[arco-theme='dark'] .person-rail-card,
[arco-theme='dark'] .person-shelf-card {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .workspace-center-progress :deep(.arco-icon-loading) {
  color: rgba(140, 170, 255, 0.96);
}

[arco-theme='dark'] .detail-media-card.selected {
  border-color: rgba(96, 165, 250, 0.34);
  background: linear-gradient(180deg, rgba(34, 56, 92, 0.95), rgba(28, 45, 76, 0.92));
  box-shadow: 0 22px 42px rgba(24, 70, 166, 0.28);
}

[arco-theme='dark'] .detail-lower-content,
[arco-theme='dark'] .person-content {
  background: rgba(10, 14, 20, 0.82);
}

[arco-theme='dark'] .detail-media-modal :deep(.ant-modal-content) {
  background: rgba(18, 22, 30, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 28px 60px rgba(0, 0, 0, 0.4);
}

[arco-theme='dark'] .home-library-manager-hint,
[arco-theme='dark'] .home-library-manager-item :deep(.arco-checkbox-label) {
  color: rgba(233, 239, 247, 0.92);
}

[arco-theme='dark'] .home-library-manager-drag-icon {
  color: rgba(233, 239, 247, 0.42);
}

[arco-theme='dark'] .home-library-manager-item {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .home-library-manager-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .home-library-manager-empty {
  color: rgba(191, 201, 216, 0.62);
}

[arco-theme='dark'] .workspace-tab,
[arco-theme='dark'] .detail-chip-button,
[arco-theme='dark'] .detail-chip-link,
[arco-theme='dark'] .detail-square-action,
[arco-theme='dark'] .detail-pill-button,
[arco-theme='dark'] .person-mini-action {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(233, 239, 247, 0.92);
}

[arco-theme='dark'] .detail-square-action {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .workspace-toolbar :deep(.arco-btn),
[arco-theme='dark'] .home-page :deep(.arco-btn),
[arco-theme='dark'] .search-shell-media-server :deep(.arco-btn),
[arco-theme='dark'] .library-shell :deep(.arco-btn),
[arco-theme='dark'] .collection-shell :deep(.arco-btn),
[arco-theme='dark'] .server-empty-shell :deep(.arco-btn),
[arco-theme='dark'] .back-button,
[arco-theme='dark'] .workspace-tab,
[arco-theme='dark'] .server-switcher-chip {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .detail-square-action {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .workspace-toolbar :deep(.arco-btn:hover),
[arco-theme='dark'] .home-page :deep(.arco-btn:hover),
[arco-theme='dark'] .search-shell-media-server :deep(.arco-btn:hover),
[arco-theme='dark'] .library-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .collection-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .server-empty-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .back-button:hover,
[arco-theme='dark'] .workspace-tab:hover,
[arco-theme='dark'] .server-switcher-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.98);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .home-settings-menu {
  background:
    linear-gradient(180deg, rgba(24, 29, 40, 0.64), rgba(17, 21, 30, 0.48));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 24px 52px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] .home-settings-title,
[arco-theme='dark'] .home-settings-subtitle,
[arco-theme='dark'] .home-settings-group-title,
[arco-theme='dark'] .home-settings-check,
[arco-theme='dark'] .home-settings-label,
[arco-theme='dark'] .home-settings-row {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .home-settings-subtitle {
  color: rgba(148, 163, 184, 0.88);
}

[arco-theme='dark'] .home-settings-group {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] .home-settings-select :deep(.arco-select-view),
[arco-theme='dark'] .home-settings-number :deep(.arco-input-wrapper),
[arco-theme='dark'] .home-settings-number :deep(.arco-input-number) {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] .server-switch-menu,
[arco-theme='dark'] .home-library-manager-panel {
  background:
    linear-gradient(180deg, rgba(24, 29, 40, 0.64), rgba(17, 21, 30, 0.48));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 24px 52px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] :deep(.server-switch-dropdown .arco-dropdown-option),
[arco-theme='dark'] :deep(.server-switch-dropdown .arco-dropdown-submenu),
[arco-theme='dark'] .home-library-manager-list {
  background: rgba(255, 255, 255, 0.03);
}

[arco-theme='dark'] .home-settings-select :deep(.arco-select-view-value),
[arco-theme='dark'] .home-settings-select :deep(.arco-select-view-icon),
[arco-theme='dark'] .home-settings-number :deep(input),
[arco-theme='dark'] .home-settings-number :deep(.arco-input-number-input) {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-icon-manager-title,
[arco-theme='dark'] .server-icon-column-heading,
[arco-theme='dark'] .server-icon-set-meta strong,
[arco-theme='dark'] .server-icon-item span {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .server-icon-manager-subtitle,
[arco-theme='dark'] .server-icon-grid-subtitle,
[arco-theme='dark'] .server-icon-set-meta span,
[arco-theme='dark'] .server-icon-empty,
[arco-theme='dark'] .server-icon-set-preview-empty {
  color: rgba(191, 201, 216, 0.72);
}

[arco-theme='dark'] .server-icon-set-column,
[arco-theme='dark'] .server-icon-grid-column,
[arco-theme='dark'] .server-icon-add-panel {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(24, 29, 40, 0.96), rgba(17, 21, 30, 0.92));
  box-shadow:
    0 24px 52px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .server-icon-set-card,
[arco-theme='dark'] .server-icon-item {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
}

[arco-theme='dark'] .server-icon-set-card:hover,
[arco-theme='dark'] .server-icon-set-card.active,
[arco-theme='dark'] .server-icon-item:hover,
[arco-theme='dark'] .server-icon-item.active {
  border-color: rgba(96, 165, 250, 0.3);
  background: linear-gradient(180deg, rgba(31, 49, 78, 0.92), rgba(24, 40, 66, 0.88));
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.3);
}

[arco-theme='dark'] .server-icon-set-preview,
[arco-theme='dark'] .server-icon-item-preview {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .detail-square-action:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.98);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .detail-primary-play {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.96), rgba(59, 130, 246, 0.88));
  border-color: rgba(96, 165, 250, 0.38);
  color: #fff;
  box-shadow: 0 22px 42px rgba(24, 70, 166, 0.32);
}

[arco-theme='dark'] .detail-primary-play:hover {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.98), rgba(96, 165, 250, 0.9));
  border-color: rgba(147, 197, 253, 0.48);
  box-shadow: 0 26px 52px rgba(24, 70, 166, 0.42);
}

[arco-theme='dark'] .detail-secondary-download {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .detail-secondary-download:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
}

[arco-theme='dark'] .detail-play-label,
[arco-theme='dark'] .detail-play-glyph,
[arco-theme='dark'] .detail-square-glyph {
  color: currentColor;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .detail-episode-heading,
[arco-theme='dark'] .detail-rating-line,
[arco-theme='dark'] .detail-tech-line,
[arco-theme='dark'] .detail-overview {
  color: rgba(248, 250, 252, 0.94);
}

[arco-theme='dark'] .detail-rating-line span,
[arco-theme='dark'] .detail-tech-line,
[arco-theme='dark'] .detail-overview {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.26);
}

[arco-theme='dark'] .detail-meta-badge {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(248, 250, 252, 0.9);
}

[arco-theme='dark'] .detail-chip-button,
[arco-theme='dark'] .detail-chip-link,
[arco-theme='dark'] .workspace-tab {
  color: rgba(248, 250, 252, 0.92);
}

[arco-theme='dark'] .detail-chip-button.active,
[arco-theme='dark'] .workspace-tab.active {
  color: #fff;
}

[arco-theme='dark'] .workspace-toolbar :deep(.arco-btn),
[arco-theme='dark'] .home-page :deep(.arco-btn),
[arco-theme='dark'] .search-shell-media-server :deep(.arco-btn),
[arco-theme='dark'] .library-shell :deep(.arco-btn),
[arco-theme='dark'] .collection-shell :deep(.arco-btn),
[arco-theme='dark'] .server-empty-shell :deep(.arco-btn),
[arco-theme='dark'] .home-settings-menu :deep(.arco-select-view),
[arco-theme='dark'] .home-settings-menu :deep(.arco-input-wrapper),
[arco-theme='dark'] .home-settings-menu :deep(.arco-input-number),
[arco-theme='dark'] .back-button,
[arco-theme='dark'] .detail-back-button,
[arco-theme='dark'] .server-switcher-chip {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(233, 239, 247, 0.92);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .workspace-toolbar :deep(.arco-btn:hover),
[arco-theme='dark'] .home-page :deep(.arco-btn:hover),
[arco-theme='dark'] .search-shell-media-server :deep(.arco-btn:hover),
[arco-theme='dark'] .library-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .collection-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .server-empty-shell :deep(.arco-btn:hover),
[arco-theme='dark'] .back-button:hover,
[arco-theme='dark'] .detail-back-button:hover,
[arco-theme='dark'] .server-switcher-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.98);
}

[arco-theme='dark'] .workspace-tab.active,
[arco-theme='dark'] .workspace-toolbar :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .home-page :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .search-shell-media-server :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .library-shell :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .collection-shell :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .server-empty-shell :deep(.arco-btn.arco-btn-primary),
[arco-theme='dark'] .detail-chip-button.active,
[arco-theme='dark'] .detail-square-action.active,
[arco-theme='dark'] .person-mini-action.active,
[arco-theme='dark'] .detail-version-option.active,
[arco-theme='dark'] .server-switcher-chip.active {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.98);
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .search-input,
[arco-theme='dark'] .library-cover,
[arco-theme='dark'] .detail-episode-cover,
[arco-theme='dark'] .detail-recommendation-poster,
[arco-theme='dark'] .person-poster-cover,
[arco-theme='dark'] .person-episode-cover,
[arco-theme='dark'] .person-avatar,
[arco-theme='dark'] .detail-poster,
[arco-theme='dark'] .detail-top-back {
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .library-cover.library-cover-fallback {
  background: transparent;
}

[arco-theme='dark'] .library-cover.library-cover-fallback .media-image-placeholder {
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 54%),
    linear-gradient(180deg, rgba(44, 52, 66, 0.94) 0%, rgba(28, 34, 46, 0.98) 100%);
}

[arco-theme='dark'] .detail-backdrop-bottom-haze {
  background:
    linear-gradient(180deg, rgba(10, 14, 20, 0.04) 0%, rgba(10, 14, 20, 0.18) 40%, rgba(10, 14, 20, 0.86) 84%, rgba(10, 14, 20, 0.97) 100%),
    linear-gradient(90deg, rgba(10, 14, 20, 0.12) 0%, rgba(10, 14, 20, 0.04) 42%, rgba(10, 14, 20, 0.18) 100%);
}

[arco-theme='dark'] .detail-backdrop-glow,
[arco-theme='dark'] .person-hero-mask {
  opacity: 0.7;
}

[arco-theme='dark'] .person-content-divider {
  background: rgba(255, 255, 255, 0.08);
}
</style>
