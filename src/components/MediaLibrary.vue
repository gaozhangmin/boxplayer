<template>
  <div class="media-library">
    <!-- 顶部导航 - 详情页面时隐藏 -->
    <div v-if="!showingDetail && !isHomeView && !props.selectedFolder" class="library-header">
      <div class="library-tabs">
        <a-tabs v-model:activeKey="activeTab" type="text" class="hidetabs">
          <a-tab-pane key="continue" :tab="t('mediaLibrary.continue')" />
          <a-tab-pane key="recent" :tab="t('mediaLibrary.recent')" />
          <a-tab-pane key="movies" :tab="t('mediaLibrary.movies')" />
          <a-tab-pane key="tv" :tab="t('mediaLibrary.tv')" />
          <a-tab-pane key="unmatched" :tab="t('mediaLibrary.unmatched')" />
        </a-tabs>
      </div>

      <!-- 控件行：返回按钮 + 快捷搜索 + 结果计数 + 视图切换 — 同一行 -->
      <div v-if="!props.selectedFolder || folderFileList.length === 0" class="library-controls">
        <div class="library-controls-left">
          <button
            v-if="showHeaderBackButton || showTopBar"
            type="button"
            class="library-arrow-back library-header-back-button"
            :title="resultBarTitle"
            @click="handleResultBack"
          >
            <IconFont name="iconarrow-left-2-icon" />
            <span class="library-arrow-back-title">{{ resultBarTitle }}</span>
          </button>
        </div>
        <div class="library-controls-center" />
        <div class="library-filters-right">
          <template v-if="showQuickSearch">
            <button
              v-if="!searchExpanded"
              class="view-toggle-seg"
              :title="t('mediaLibrary.searchFilter')"
              @click="searchExpanded = true"
            >
              <IconFont name="iconsearch" />
            </button>
            <a-input-search
              v-else
              ref="quickSearchInputRef"
              v-model="localSearchQuery"
              allow-clear
              :placeholder="t('mediaLibrary.filterPlaceholder')"
              size="small"
              class="library-quick-search"
              @blur="onQuickSearchBlur"
            >
              <template #prefix>
                <IconFont name="iconsearch" />
              </template>
            </a-input-search>
          </template>
          <div v-if="showResultCount" class="library-result-count">{{ t('mediaLibrary.resultCount', { count: pagedTotal }) }}</div>

          <!-- 视图切换 — 毛玻璃分段胶囊 -->
          <div v-if="showBrowseModeToggle" class="view-toggle-pill">
            <button
              class="view-toggle-seg"
              :class="{ active: viewMode === 'grid' }"
              :title="t('mediaServer.gridView')"
              @click="viewMode = 'grid'"
            >
              <IconFont name="iconfangkuang" />
            </button>
            <button
              class="view-toggle-seg"
              :class="{ active: viewMode === 'list' }"
              :title="t('mediaServer.listView')"
              @click="viewMode = 'list'"
            >
              <IconFont name="iconlist" />
            </button>
            <span v-if="showPosterTypeToggle" class="view-toggle-divider" />
            <button
              v-if="showPosterTypeToggle"
              class="view-toggle-seg view-toggle-seg--label"
              :class="{ active: posterType === 'landscape' }"
              :title="posterType === 'portrait' ? t('mediaLibrary.switchLandscape') : t('mediaLibrary.switchPortrait')"
              @click="posterType = posterType === 'portrait' ? 'landscape' : 'portrait'"
            >
              <span class="view-toggle-seg-label">{{ posterType === 'portrait' ? t('mediaLibrary.portrait') : t('mediaLibrary.landscape') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="library-content">
      <div v-if="mediaStore.isScanning && !showingDetail" class="library-scan-status">
        <a-spin :size="16" />
        <span>{{ t('mediaLibrary.scanningFiles', { progress: mediaStore.scanProgress, total: mediaStore.scanTotal }) }}</span>
      </div>

      <!-- 搜索界面 -->
      <div v-if="isSearchView && !showingDetail" class="search-panel">
        <div class="search-panel-title">{{ t('mediaLibrary.aggregateSearch') }}</div>
        <div class="search-panel-input">
          <a-input-search v-model="localSearchQuery" allow-clear :placeholder="t('mediaLibrary.searchAllPlaceholder')">
            <template #prefix>
              <IconFont name="iconsearch" />
            </template>
          </a-input-search>
        </div>
        <div class="search-panel-hint">{{ t('mediaLibrary.searchAllHint') }}</div>
      </div>

      <!-- 显示媒体详情 -->
      <MediaDetail
        v-if="showingDetail && currentMediaItem"
        :media-item="currentMediaItem"
        :active-playlist-name="selectedPlaylist"
        :playlist-items="selectedPlaylist ? pagedItems : []"
        @ai-rescrape="handleManualAIScrape"
        @back="handleDetailBack"
        @metadata-updated="handleMetadataUpdated"
        @tag-click="handleDetailTagClick"
      />

      <!-- 显示媒体库内容 -->
      <template v-else-if="showSearchResults">
      <div
        v-if="isHomeView"
        class="library-home-page"
      >
        <div class="library-home-toolbar">
          <div class="library-home-toolbar-spacer" />
          <div class="library-home-toolbar-right">
            <a-input
              v-model="homeSearchQuery"
              allow-clear
              class="library-home-search"
              :placeholder="t('mediaLibrary.filterPlaceholder')"
            >
              <template #prefix><IconFont name="iconsearch" /></template>
            </a-input>
            <button type="button" class="toolbar-btn" @click="openLocalHomeManager">
              <IconFont name="iconlist" />
              <span>{{ t('mediaServer.mediaManagement') }}</span>
            </button>
            <div class="view-toggle-pill">
              <button
                class="view-toggle-seg"
                :class="{ active: localHomePosterMode === 'landscape' }"
                :title="t('mediaServer.landscapePoster')"
                @click="setLocalHomePosterMode('landscape')"
              >
                <IconFont name="iconfangkuang" />
              </button>
              <span class="view-toggle-divider" />
              <button
                class="view-toggle-seg"
                :class="{ active: localHomePosterMode === 'portrait' }"
                :title="t('mediaServer.portraitPoster')"
                @click="setLocalHomePosterMode('portrait')"
              >
                <IconFont name="iconxiaotumoshi" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="homeSearchQuery.trim() && visibleLocalHomeSections.length === 0" class="library-home-search-empty">
          <IconFont name="iconsearch" />
          <span>{{ t('mediaLibrary.noCloudMatches') }}</span>
        </div>

        <template v-for="section in visibleLocalHomeSections" :key="section.key">
          <MediaServerResumeRow
            v-if="section.kind === 'continue' && (filteredLocalContinueCards.length > 0)"
            :items="filteredLocalContinueCards"
            @play="handleLocalHomeResumePlay"
            @action="handleLocalHomeCardAction"
          />

          <MediaServerPosterRow
            v-else-if="section.kind === 'media' && (section.items?.length || 0) > 0"
            :title="section.title"
            :items="section.items || []"
            :poster-type="section.posterType"
            :show-poster-labels="localHomePreferences.showPosterLabels"
            :enable-context-menu="true"
            :show-edit-metadata="true"
            :show-top-overlay="true"
            :see-all-label="t('mediaServer.seeAll', { count: getLocalHomeSectionTotalCount(section) })"
            subtitle-mode="year-only"
            @select="handleLocalHomeNodeSelect"
            @play="handleLocalHomeNodePlay"
            @action="handleLocalHomeCardAction"
            @metadata="openLocalHomeMetadataEditor"
            @see-all="handleLocalHomeSeeAll(section)"
          />

          <section
            v-else-if="section.kind === 'shortcut' && (section.entries?.length || 0) > 0"
            class="library-home-section"
          >
            <div class="home-section-header">
              <h4>{{ section.title }}</h4>
              <button
                v-if="section.key === 'genres' || section.key === 'ratings' || section.key === 'years' || section.key === 'playlists'"
                type="button"
                class="toolbar-btn"
                @click="handleLocalShortcutSeeAll(section.key)"
              >
                {{ t('mediaServer.seeAll', { count: getLocalHomeSectionTotalCount(section) }) }}
              </button>
              <span v-else>{{ t('mediaServer.itemsCount', { count: (section.entries || []).length }) }}</span>
            </div>
            <div
              class="library-home-row"
              :class="section.variant === 'banner' ? 'library-home-row-banner' : 'library-home-row-category'"
            >
              <CategoryCard
                v-for="entry in (section.entries || [])"
                v-show="section.variant === 'banner'"
                :key="entry.key"
                :name="entry.title"
                :count="entry.count ?? 0"
                :type="entry.cardType ?? 'genre'"
                :cover-images="entry.coverImages ?? []"
                class="library-home-category-card"
                @click="handleLocalShortcutSelect(entry)"
              />
              <button
                v-for="entry in (section.entries || [])"
                v-show="section.variant === 'mini'"
                :key="entry.key"
                type="button"
                class="library-home-shortcut-card library-home-mini-card"
                @click="handleLocalShortcutSelect(entry)"
              >
                  <div class="library-home-mini-icon">
                    <i class="iconfont" :class="entry.icon" />
                  </div>
                  <div class="library-home-mini-main">
                    <h5>{{ entry.title }}</h5>
                    <p>{{ entry.description }}</p>
                  </div>
                  <div v-if="entry.count !== undefined" class="library-home-mini-count">{{ entry.count }}</div>
              </button>
            </div>
          </section>
        </template>

        <a-modal
          v-model:visible="localHomeManagerVisible"
          :title="t('mediaServer.mediaManagement')"
          :footer="false"
          width="560px"
          class="detail-media-modal"
        >
          <div class="home-library-manager-panel">
            <p class="home-library-manager-hint">{{ t('mediaLibrary.homeManagerHint') }}</p>
            <div v-if="localHomeManagerDraft.length > 0" class="home-library-manager-list">
              <div
                v-for="item in localHomeManagerDraft"
                :key="item.key"
                class="home-library-manager-item"
                :class="{ dragging: draggingLocalHomeSectionId === item.key }"
                :data-section-key="item.key"
                draggable="true"
                @dragstart="handleLocalHomeDragStart($event, item.key)"
                @dragover.prevent
                @drop.prevent="handleLocalHomeDrop(item.key)"
                @dragend="handleLocalHomeDragEnd"
              >
                <div
                  class="home-library-manager-drag-icon"
                  @mousedown.prevent="handleLocalHomePointerDragStart(item.key)"
                >
                  <IconFont name="iconmenu-unfold" />
                </div>
                <a-checkbox :model-value="item.visible" @change="toggleLocalHomeDraftVisible(item.key, $event)">
                  {{ item.title }}
                </a-checkbox>
              </div>
            </div>
            <div v-else class="home-library-manager-empty">{{ t('mediaLibrary.noHomeSections') }}</div>
            <div class="home-library-manager-footer">
              <a-button type="outline" @click="cancelLocalHomeManager">{{ t('common.cancel') }}</a-button>
              <a-button type="primary" @click="saveLocalHomeManager">{{ t('common.save') }}</a-button>
            </div>
          </div>
        </a-modal>
      </div>

      <div
        v-else-if="isSearchView"
        class="search-results-hub"
      >
        <div class="search-media-server-panel integrated">
          <div v-if="localSearchQuery.trim()" class="search-result-section">
            <div class="search-result-section-title">{{ t('mediaLibrary.cloudSearchResults') }}</div>
            <div v-if="hasLocalSearchResults" class="search-result-section-body">
              <div v-if="viewMode === 'grid'" class="media-grid search-media-grid">
                <div
                  v-for="item in pagedItems"
                  :key="item.id"
                  class="media-item"
                  @click="openMedia(item)"
                  @contextmenu.prevent="openContextMenu($event, item)"
                >
                  <div class="media-poster">
                    <img
                      v-if="item.posterUrl"
                      :src="item.posterUrl"
                      :alt="item.name"
                      @error="handleImageError"
                    />
                    <div v-else class="poster-placeholder">
                      <IconFont name="iconfile-video" />
                    </div>

                    <div v-if="isContinueWatchingView && item.watchProgress !== undefined" class="watch-progress">
                      <div
                        class="watch-progress-bar"
                        :style="{ width: `${Math.round((item.watchProgress || 0) * 100)}%` }"
                      ></div>
                    </div>

                    <div v-if="item.rating" class="rating-badge">
                      {{ item.rating.toFixed(1) }}
                    </div>

                    <div class="type-badge">
                      {{ item.type === 'movie' ? t('mediaLibrary.typeMovie') : item.type === 'tv' ? t('mediaLibrary.typeTv') : t('mediaLibrary.typeUnmatched') }}
                    </div>
                    <div v-if="getCoverageBadge(item)" class="media-coverage-badge" :title="getCoverageBadge(item)">
                      <span>!</span>{{ getCoverageBadge(item) }}
                    </div>
                  </div>

                  <div class="media-info">
                    <h3 class="media-title" :title="item.name">
                      {{ item.name }}
                      <span v-if="getEpisodeTitleSuffix(item)" class="episode-suffix">
                        {{ getEpisodeTitleSuffix(item) }}
                      </span>
                    </h3>
                    <p v-if="item.year" class="media-year">{{ item.year }}</p>
                    <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="media-path" :title="getUnmatchedPath(item)">
                      {{ getUnmatchedPath(item) }}
                    </p>
                    <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="media-episode">
                      {{ item.continueEpisodeLabel }}
                    </p>
                    <p v-if="item.genres.length" class="media-genres">
                      {{ item.genres.slice(0, 3).join(', ') }}
                    </p>
                  </div>
                </div>
              </div>

              <div v-else-if="viewMode === 'list'" class="media-list search-media-list">
                <div
                  v-for="item in pagedItems"
                  :key="item.id"
                  class="media-list-item"
                  @click="openMedia(item)"
                  @contextmenu.prevent="openContextMenu($event, item)"
                >
                  <div class="list-poster">
                    <img
                      v-if="item.posterUrl"
                      :src="item.posterUrl"
                      :alt="item.name"
                      @error="handleImageError"
                    />
                    <div v-else class="poster-placeholder">
                      <IconFont name="iconfile-video" />
                    </div>
                    <div v-if="getCoverageBadge(item)" class="media-coverage-badge" :title="getCoverageBadge(item)">
                      <span>!</span>{{ getCoverageBadge(item) }}
                    </div>
                  </div>

                  <div class="list-info">
                    <div class="list-main">
                      <h3 class="list-title">
                        {{ item.name }}
                        <span v-if="getEpisodeTitleSuffix(item)" class="episode-suffix">
                          {{ getEpisodeTitleSuffix(item) }}
                        </span>
                      </h3>
                      <p v-if="item.overview" class="list-overview">
                        {{ item.overview.length > 120 ? item.overview.substring(0, 120) + '...' : item.overview }}
                      </p>
                      <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="list-path" :title="getUnmatchedPath(item)">
                        {{ getUnmatchedPath(item) }}
                      </p>
                      <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="list-episode">
                        {{ item.continueEpisodeLabel }}
                      </p>
                      <p v-if="isContinueWatchingView && item.watchProgress !== undefined" class="list-progress">
                        {{ t('mediaLibrary.watchedPercent', { percent: Math.round((item.watchProgress || 0) * 100) }) }}
                      </p>
                    </div>

                    <div class="list-meta">
                      <span class="list-type">{{ item.type === 'movie' ? t('mediaLibrary.typeMovie') : item.type === 'tv' ? t('mediaLibrary.typeTv') : t('mediaLibrary.typeUnmatched') }}</span>
                      <span v-if="item.year" class="list-year">{{ item.year }}</span>
                      <span v-if="item.rating" class="list-rating">
                        ⭐ {{ item.rating.toFixed(1) }}
                      </span>
                    </div>

                    <div v-if="item.genres.length" class="list-genres">
                      <span v-for="genre in item.genres.slice(0, 5)" :key="genre" class="genre-tag">
                        {{ genre }}
                      </span>
                    </div>

                    <div v-if="item.type === 'tv' && item.seasons?.length" class="tv-info">
                      <span v-if="item.seasons?.length" class="tv-seasons">
                        {{ t('mediaLibrary.seasonsCount', { count: item.seasons.length }) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="search-media-server-state">
              {{ localSearchQuery.trim() ? t('mediaLibrary.noCloudMatches') : t('mediaLibrary.searchCloudHint') }}
            </div>
          </div>

          <div
            class="search-result-section"
            :class="{ 'search-result-section-divider': localSearchQuery.trim() }"
          >
            <button
              type="button"
              class="search-result-section-title"
              :aria-expanded="!isMediaServerSectionCollapsed"
              aria-controls="media-server-search-section"
              @click="toggleMediaServerSection"
            >
              <span>{{ localSearchQuery.trim() ? t('mediaLibrary.serverResults') : t('mediaLibrary.serverRecommendations') }}</span>
              <IconFont class="search-result-section-toggle" name="icondown" />
            </button>
            <div id="media-server-search-section" v-show="!isMediaServerSectionCollapsed">
              <div v-if="mediaServerSearchLoading" class="search-media-server-state">
                {{ localSearchQuery.trim() ? t('mediaLibrary.searchingServers') : t('mediaLibrary.loadingServerRecommendations') }}
              </div>
              <div v-else-if="mediaServerSearchError" class="search-media-server-state error">{{ mediaServerSearchError }}</div>
              <div v-else-if="mediaServerSearchGroups.length === 0" class="search-media-server-state">
                {{ localSearchQuery.trim() ? t('mediaLibrary.noServerMatches') : t('mediaLibrary.noServerRecommendations') }}
              </div>
              <template v-else>
                <div
                  v-for="group in mediaServerSearchGroups"
                  :key="group.server.id"
                  class="search-media-server-group"
                >
                  <div class="search-media-server-group-title">{{ group.server.name }}</div>
                  <div class="search-media-server-grid">
                    <button
                      v-for="item in group.items"
                      :key="`${group.server.id}-${item.id}`"
                      class="search-media-server-result"
                      type="button"
                      @click="openMediaServerSearchResult(group.server.id, item)"
                    >
                      <div
                        class="search-media-server-result-poster media-image-frame"
                        :class="{ 'has-image': !!resolveMediaServerSearchImage(item) }"
                      >
                        <img
                          v-if="resolveMediaServerSearchImage(item)"
                          :src="resolveMediaServerSearchImage(item)"
                          :alt="item.title"
                          @load="handleMediaServerSearchImageLoad"
                          @error="handleMediaServerSearchImageError"
                        />
                        <div class="media-card-placeholder media-image-placeholder">
                          {{ item.title.slice(0, 1) }}
                        </div>
                      </div>
                      <div class="search-media-server-result-main">
                        <span class="search-media-server-result-title">{{ item.title }}</span>
                        <span v-if="item.year" class="search-media-server-result-year">{{ item.year }}</span>
                      </div>
                      <div class="search-media-server-result-meta">
                        <span>{{ mediaServerKindLabel(item.kind) }}</span>
                        <span v-if="item.parentTitle">{{ item.parentTitle }}</span>
                      </div>
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 文件列表 - 当选择文件夹时显示 PanRight 组件 -->
      <div v-else-if="props.selectedFolder && folderFileList.length > 0" class="folder-file-list">
        <div class="folder-header">
          <div class="folder-header-content">
            <div class="folder-actions">
              <button
                v-if="folderNavigationStack.length > 0"
                type="button"
                class="library-arrow-back library-top-back-button"
                :title="currentFolderInfo?.name || props.selectedFolder.name"
                @click="handleGoBack"
              >
                <IconFont name="iconarrow-left-2-icon" />
                <span class="library-arrow-back-title">{{ currentFolderInfo?.name || props.selectedFolder.name }}</span>
              </button>
            </div>
            <div class="folder-info">
              <h3>{{ currentFolderInfo?.name || props.selectedFolder.name }}</h3>
              <p>{{ t('mediaLibrary.fileCount', { count: folderFileList.length }) }}</p>
            </div>
          </div>
        </div>
        <div class="pan-right-container">
          <MediaPanRight @enter-folder="handleEnterFolder" />
        </div>
      </div>

      <!-- 空状态 - 当选择文件夹但没有文件时 -->
      <div v-else-if="props.selectedFolder && folderFileList.length === 0" class="folder-file-list">
        <div class="folder-header">
          <div class="folder-header-content">
            <div class="folder-actions">
              <button
                v-if="folderNavigationStack.length > 0"
                type="button"
                class="library-arrow-back library-top-back-button"
                :title="currentFolderInfo?.name || props.selectedFolder.name"
                @click="handleGoBack"
              >
                <IconFont name="iconarrow-left-2-icon" />
                <span class="library-arrow-back-title">{{ currentFolderInfo?.name || props.selectedFolder.name }}</span>
              </button>
            </div>
            <div class="folder-info">
              <h3>{{ currentFolderInfo?.name || props.selectedFolder.name }}</h3>
              <p>{{ t('mediaLibrary.emptyFolder') }}</p>
            </div>
          </div>
        </div>
        <div class="empty-state">
          <a-empty :description="t('mediaLibrary.emptyFolder')" />
        </div>
      </div>

      <!-- 分类聚合视图 -->
      <div v-else-if="showCategoryView" class="category-view">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" class="category-grid">
          <CategoryCard
            v-for="item in categoryItems"
            :key="`${item.type}-${item.name}`"
            :name="item.name"
            :count="item.count"
            :type="item.type"
            :cover-images="getDeterministicCoverImages(item)"
            @click="handleCategoryClick"
          />
        </div>

        <!-- 列表视图 - 横向卡片布局 -->
        <div v-else-if="viewMode === 'list'" class="category-list">
          <div
            v-for="item in categoryItems"
            :key="`${item.type}-${item.name}`"
            class="category-list-card"
            :style="getListCardStyle(item)"
            @click="handleCategoryClick({ name: item.name, type: item.type, count: item.count })"
          >
            <div class="category-list-overlay"></div>
            <div class="category-list-content">
              <h3 class="category-list-title">{{ item.name }}</h3>
            </div>
            <div class="category-list-count">{{ t('mediaLibrary.items', { count: item.count }) }}</div>
          </div>
        </div>
      </div>

      <!-- 播放列表视图 -->
      <div v-else-if="showPlaylistView" class="category-view">
        <div v-if="viewMode === 'grid'" class="category-grid">
          <a-trigger
            v-for="item in playlistItems"
            :key="`playlist-${item.name}`"
            trigger="contextMenu"
            align-point
            auto-fit-position
            :popup-offset="6"
          >
            <CategoryCard
              :name="item.name"
              :count="item.count"
              :type="item.type as 'year' | 'rating' | 'genre'"
              :cover-image="item.coverImage"
              @click="handleCategoryClick"
            />
            <template #content>
              <div class="playlist-card-context-menu">
                <button type="button" class="playlist-card-context-item" @click="playPlaylist(item.name)">
                  <span class="playlist-card-context-icon">▷</span>
                  <span>{{ t('mediaLibrary.playAll') }}</span>
                </button>
              </div>
            </template>
          </a-trigger>
        </div>

        <div v-else-if="viewMode === 'list'" class="category-list">
          <a-trigger
            v-for="item in playlistItems"
            :key="`playlist-${item.name}`"
            trigger="contextMenu"
            align-point
            auto-fit-position
            :popup-offset="6"
          >
            <div
              class="category-list-card"
              :style="getPlaylistCardStyle(item)"
              @click="handleCategoryClick({ name: item.name, type: item.type, count: item.count })"
            >
              <div class="category-list-overlay"></div>
              <div class="category-list-content">
                <h3 class="category-list-title">{{ item.name }}</h3>
              </div>
              <div class="category-list-count">{{ t('mediaLibrary.items', { count: item.count }) }}</div>
            </div>
            <template #content>
              <div class="playlist-card-context-menu">
                <button type="button" class="playlist-card-context-item" @click="playPlaylist(item.name)">
                  <span class="playlist-card-context-icon">▷</span>
                  <span>{{ t('mediaLibrary.playAll') }}</span>
                </button>
              </div>
            </template>
          </a-trigger>
        </div>
      </div>

      <!-- 空状态 - 当没有媒体内容时 -->
      <div v-else-if="pagedItems.length === 0" class="empty-state">
        <a-empty :description="t('mediaLibrary.noMediaContent')" />
      </div>

      <!-- 媒体内容 -->
      <div v-else :class="['media-container', viewMode, `poster-${posterType}`]">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" class="media-grid" :class="`media-grid-${posterType}`">
          <div
            v-for="item in pagedItems"
            :key="item.id"
            class="media-item"
            :class="`media-item-${posterType}`"
            @click="openMedia(item)"
            @contextmenu.prevent="openContextMenu($event, item)"
          >
            <div class="media-poster" :class="{ 'has-image': !!getItemDisplayImage(item) }">
              <img
                v-if="getItemDisplayImage(item)"
                :src="getItemDisplayImage(item)"
                :alt="item.name"
                @load="handlePosterLoad"
                @error="handleImageError"
              />
              <div class="poster-placeholder">
                <img class="poster-placeholder-app-icon" :src="appIconUrl" alt="BoxPlayer" />
              </div>

              <div v-if="isContinueWatchingView && item.watchProgress !== undefined" class="watch-progress">
                <div
                  class="watch-progress-bar"
                  :style="{ width: `${Math.round((item.watchProgress || 0) * 100)}%` }"
                ></div>
              </div>

              <div class="type-badge">
                {{ getItemTypeLabel(item) }}
              </div>

              <div
                v-if="getPosterContextBadge(item)"
                class="poster-context-badge"
              >
                {{ getPosterContextBadge(item) }}
              </div>
              <div v-if="getCoverageBadge(item)" class="media-coverage-badge" :title="getCoverageBadge(item)">
                <span>!</span>{{ getCoverageBadge(item) }}
              </div>
            </div>

            <div class="media-info">
              <h3 class="media-title" :title="item.name">
                {{ item.name }}
                <span v-if="getEpisodeTitleSuffix(item)" class="episode-suffix">
                  {{ getEpisodeTitleSuffix(item) }}
                </span>
              </h3>
              <div v-if="item.year" class="media-meta media-meta--minimal">
                <span class="media-meta-year">{{ item.year }}</span>
              </div>
              <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="media-path" :title="getUnmatchedPath(item)">
                {{ getUnmatchedPath(item) }}
              </p>
              <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="media-episode">
                {{ item.continueEpisodeLabel }}
              </p>
            </div>
          </div>
        </div>

        <!-- 列表视图 -->
        <div v-else-if="viewMode === 'list'" class="media-list">
          <div
            v-for="item in pagedItems"
            :key="item.id"
            class="media-list-item"
            :class="`media-list-item-${posterType}`"
            @click="openMedia(item)"
            @contextmenu.prevent="openContextMenu($event, item)"
          >
            <div
              class="list-poster"
              :class="{ 'has-image': !!getItemDisplayImage(item) }"
            >
              <img
                v-if="getItemDisplayImage(item)"
                :src="getItemDisplayImage(item)"
                :alt="item.name"
                @load="handlePosterLoad"
                @error="handleImageError"
              />
              <div class="poster-placeholder">
                <img class="poster-placeholder-app-icon" :src="appIconUrl" alt="BoxPlayer" />
              </div>
              <div class="type-badge">
                {{ getItemTypeLabel(item) }}
              </div>

              <div
                v-if="getPosterContextBadge(item)"
                class="poster-context-badge"
              >
                {{ getPosterContextBadge(item) }}
              </div>
              <div v-if="getCoverageBadge(item)" class="media-coverage-badge" :title="getCoverageBadge(item)">
                <span>!</span>{{ getCoverageBadge(item) }}
              </div>
            </div>

            <div class="list-info">
              <div class="list-head">
                <div class="list-title-wrap">
                  <h3 class="list-title">
                    {{ item.name }}
                    <span v-if="getEpisodeTitleSuffix(item)" class="episode-suffix">
                      {{ getEpisodeTitleSuffix(item) }}
                    </span>
                  </h3>
                </div>
              </div>

              <div v-if="getItemMetaItems(item).length" class="list-meta">
                <span
                  v-for="meta in getItemMetaItems(item)"
                  :key="`${item.id}-${meta}`"
                  class="list-meta-chip"
                >
                  {{ meta }}
                </span>
              </div>

              <div class="list-main">
                <p class="list-overview" :class="{ 'is-empty': !item.overview }">
                  {{ getItemOverview(item) || t('mediaServer.noOverview') }}
                </p>
                <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="list-path" :title="getUnmatchedPath(item)">
                  {{ getUnmatchedPath(item) }}
                </p>
                <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="list-episode">
                  {{ item.continueEpisodeLabel }}
                </p>
                <p v-if="isContinueWatchingView && item.watchProgress !== undefined" class="list-progress">
                  {{ t('mediaLibrary.watchedPercent', { percent: Math.round((item.watchProgress || 0) * 100) }) }}
                </p>
              </div>

              <div v-if="item.genres.length" class="list-genres">
                <span v-for="genre in item.genres.slice(0, 5)" :key="genre" class="genre-tag">
                  {{ genre }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="pagedItems.length < pagedTotal" class="media-library-load-more">
          <a-button :loading="isLoadingPage" @click="loadNextPage">加载更多</a-button>
        </div>
      </div>
      </template>
    </div>

    <!-- 添加文件夹对话框 -->
    <a-modal
      v-model:visible="showAddFolderModal"
      :title="t('mediaLibrary.addToLibrary')"
      @ok="handleAddFolder"
      @cancel="showAddFolderModal = false"
    >
      <a-form :model="folderForm" layout="vertical">
        <a-form-item :label="t('mediaLibrary.folderName')">
          <a-input v-model:value="folderForm.name" :placeholder="t('mediaLibrary.libraryNamePlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>
    <a-dropdown
      class="rightmenu"
      popup-class="library-context-popup"
      :popup-visible="showContextMenu"
      :style="contextMenuStyle"
      @popup-visible-change="handleContextMenuClose"
    >
      <div style="width: 1px; height: 1px; visibility: hidden;" />
      <template #content>
        <div class="library-card-context-menu">
          <button type="button" class="library-card-context-item" @click="playFromMenu">
            <span class="library-card-context-icon">▷</span>
            <span>{{ t('mediaLibrary.play') }}</span>
          </button>
          <template v-if="isContinueWatchingView">
            <div class="library-card-context-divider" />
            <button type="button" class="library-card-context-item" @click="removeFromContinueWatchingFromMenu">
              <span class="library-card-context-icon">↺</span>
              <span>{{ t('mediaLibrary.removeContinue') }}</span>
            </button>
          </template>
          <template v-else>
            <button type="button" class="library-card-context-item" @click="toggleFavoriteFromMenu">
              <span class="library-card-context-icon">{{ contextMenuIsFavorite ? '♥' : '♡' }}</span>
              <span>{{ contextMenuIsFavorite ? t('mediaServer.removeFavorite') : t('mediaLibrary.favorite') }}</span>
            </button>
            <button type="button" class="library-card-context-item" @click="toggleWatchedFromMenu">
              <span class="library-card-context-icon context-icon-filled">✓</span>
              <span>{{ contextMenuIsWatched ? t('mediaServer.markUnwatched') : t('mediaServer.markWatched') }}</span>
            </button>
            <button v-if="hasPlaylists" type="button" class="library-card-context-item" @click="togglePlaylistFromMenu">
              <span class="library-card-context-icon">≡</span>
              <span>{{ contextMenuInPlaylist ? t('mediaLibrary.removePlaylist') : t('mediaLibrary.addPlaylist') }}</span>
            </button>
            <button type="button" class="library-card-context-item" @click="aiRescrapeFromMenu">
              <span class="library-card-context-icon">AI</span>
              <span>{{ t('mediaLibrary.aiRescrape') }} <span class="ai-pro-badge">Pro</span></span>
            </button>
            <button type="button" class="library-card-context-item" @click="openManualMetadataEditor">
              <span class="library-card-context-icon">✎</span>
              <span>{{ t('mediaLibrary.manualEdit') }}</span>
            </button>
            <div class="library-card-context-divider" />
            <button type="button" class="library-card-context-item danger" @click="deleteMediaFromMenu">
              <span class="library-card-context-icon">✕</span>
              <span>{{ t('common.delete') }}</span>
            </button>
          </template>
        </div>
      </template>
    </a-dropdown>
    <MediaMetadataEditorModal
      v-if="manualMetadataTarget"
      :defaults-to-whole-tv-series="manualMetadataDefaultsToWholeTvSeries"
      :item="manualMetadataTarget"
      :visible="manualMetadataVisible"
      @close="closeManualMetadataEditor"
      @save="saveManualMetadata"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useMediaLibraryStore } from '../store/medialibrary'
import DB from '../utils/db'
import { useAppStore } from '../store'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import useMediaServerNavigationStore from '../store/mediaServerNavigation'
import MediaPanRight from './MediaPanRight.vue'
import { useMediaPanFileStore, useMediaPanTreeStore } from './stores'
import CategoryCard from './CategoryCard.vue'
import MediaDetail from './MediaDetail.vue'
import MediaMetadataEditorModal from './MediaMetadataEditorModal.vue'
import MediaServerPosterRow from './media-server/home/MediaServerPosterRow.vue'
import MediaServerResumeRow from './media-server/home/MediaServerResumeRow.vue'
import type { MediaLibraryItem } from '../types/media'
import type { DriveFileItem } from '../types/media'
import type { MediaServerLibraryNode } from '../types/mediaServerContent'
import type { MediaServerCardItem } from '../types/mediaServerContent'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { IPageVideoPlaylistEntry } from '../store/appstore'
import { getMediaServerSearch, getMediaServerSuggestions } from '../media-server/contentGateway'
import { resolveMediaServerImage } from '../media-server/imageSources'
import { toMsCacheUrl } from '../media-server/imageCache'
import { isAliyunUser, isCloud123User, isDrive115User, isBaiduUser, isBoxUser, isGoogleUser, isPikPakUser, isOneDriveUser } from '../aliapi/utils'
import AliDirFileList from '../aliapi/dirfilelist'
import { apiBaiduFileList, mapBaiduFileToAliModel } from '../cloudbaidu/dirfilelist'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from '../utils/webdavClient'
import { menuOpenFile } from '../utils/openfile'
import message from '../utils/message'
import { manualAIScrapeItems } from '../utils/mediaAIScrape'
import useLocalMediaHomePreferencesStore from '../store/localMediaHomePreferences'
import { getMediaCoverage } from '../utils/mediaCoverage'
import type { LocalMediaHomePosterType, LocalMediaHomeSectionKey } from '../store/localMediaHomePreferences'
import { t } from '../i18n'
import { appIconUrl } from '../utils/appAssets'

type MediaListItem = MediaLibraryItem & {
  continueEpisodeLabel?: string
}

type LocalHomeMediaSection = {
  key: LocalMediaHomeSectionKey
  kind: 'continue' | 'media' | 'shortcut'
  title: string
  category?: string
  posterType?: 'portrait' | 'landscape'
  items?: MediaServerLibraryNode[]
  variant?: 'banner' | 'mini'
  entries?: Array<{
    key: string
    title: string
    description: string
    icon: string
    count?: number
    coverImages?: string[]
    cardType?: 'genre' | 'rating' | 'year' | 'playlist'
    style?: CSSProperties
    overlayStyle?: CSSProperties
    action: () => void
  }>
}

const props = defineProps<{
  activeCategory?: string
  selectedFolder?: any
  selectedGenre?: string
  selectedYear?: string
  selectedRating?: string
  searchQuery?: string
  fromHomeNavigation?: boolean
}>()

const mediaStore = useMediaLibraryStore()
const appStore = useAppStore()
const mediaServerRegistry = useMediaServerRegistryStore()
const mediaServerNavigation = useMediaServerNavigationStore()
const mediaPanFileStore = useMediaPanFileStore()
const mediaPanTreeStore = useMediaPanTreeStore()
const localHomePreferences = useLocalMediaHomePreferencesStore()

// 状态
const activeTab = ref('recently-added')
const showAddFolderModal = ref(false)
const folderForm = ref({ name: '' })
const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const contextMenuItem = ref<MediaLibraryItem | null>(null)
const manualMetadataVisible = ref(false)
const manualMetadataTarget = ref<MediaLibraryItem | null>(null)
const manualMetadataDefaultsToWholeTvSeries = ref(false)
const selectedGenre = ref('')
const selectedYear = ref('')
const selectedRating = ref('')
const selectedCast = ref('')
const selectedCountry = ref('')
const selectedPlaylist = ref('')
const localSearchQuery = ref(props.searchQuery || '')
const viewMode = ref<'grid' | 'list'>('grid') // 添加视图模式状态
const posterType = ref<'portrait' | 'landscape'>('portrait')
const showingDetail = ref(false)
const currentMediaItem = ref<MediaLibraryItem>()
const mediaServerSearchLoading = ref(false)
const mediaServerSearchError = ref('')
const mediaServerSearchCollapsed = ref(false)
const mediaServerRecommendationCollapsed = ref(false)
const mediaServerSearchGroups = ref<Array<{
  server: { id: string; name: string }
  items: MediaServerLibraryNode[]
}>>([])
let mediaServerSearchTimer: ReturnType<typeof setTimeout> | undefined

const isMediaServerSectionCollapsed = computed(() => (
  localSearchQuery.value.trim()
    ? mediaServerSearchCollapsed.value
    : mediaServerRecommendationCollapsed.value
))

const toggleMediaServerSection = () => {
  if (localSearchQuery.value.trim()) {
    mediaServerSearchCollapsed.value = !mediaServerSearchCollapsed.value
  } else {
    mediaServerRecommendationCollapsed.value = !mediaServerRecommendationCollapsed.value
  }
}

const localHomeManagerVisible = ref(false)
const homeSearchQuery = ref('')
const draggingLocalHomeSectionId = ref<LocalMediaHomeSectionKey | ''>('')
const localHomeManagerDraft = ref<Array<{ key: LocalMediaHomeSectionKey; title: string; visible: boolean }>>([])

// 文件夹文件列表
const folderFileList = ref<any[]>([])
const currentFolderInfo = ref<any>(null)
const folderNavigationStack = ref<any[]>([]) // 文件夹导航堆栈

watch(
  () => [
    props.activeCategory,
    props.selectedFolder,
    props.selectedGenre,
    props.selectedYear,
    props.selectedRating
  ],
  () => {
    if (showingDetail.value) {
      showingDetail.value = false
      currentMediaItem.value = undefined
    }
    selectedGenre.value = props.selectedGenre || ''
    selectedYear.value = props.selectedYear || ''
    selectedRating.value = props.selectedRating || ''
    selectedCast.value = ''
    selectedCountry.value = ''
    if (props.activeCategory !== 'playlist') {
      selectedPlaylist.value = ''
    }
  }
)

watch(
  () => props.searchQuery,
  (value) => {
    localSearchQuery.value = value || ''
  }
)

watch(localSearchQuery, (value) => {
  if (mediaServerSearchTimer) clearTimeout(mediaServerSearchTimer)
  if (!isSearchView.value) {
    mediaServerSearchLoading.value = false
    mediaServerSearchError.value = ''
    mediaServerSearchGroups.value = []
    return
  }
  mediaServerSearchTimer = setTimeout(() => {
    if (value.trim()) {
      void runMediaServerSearch(value)
      return
    }
    void loadMediaServerSuggestions()
  }, 260)
})

const MEDIA_PAGE_SIZE = 80
const pagedItems = ref<MediaListItem[]>([])
const pagedTotal = ref(0)
const isLoadingPage = ref(false)
let pageRequestId = 0

const getMediaPageQuery = () => {
  const category = props.activeCategory || activeTab.value
  const selectedGenreValue = props.selectedGenre || selectedGenre.value
  const selectedYearValue = props.selectedYear || selectedYear.value
  const selectedRatingValue = props.selectedRating || selectedRating.value
  const query = (localSearchQuery.value || '').trim().toLowerCase()
  const watchedIds = mediaStore.watchedItems
  const type: MediaLibraryItem['type'] | undefined = category === 'movies' ? 'movie' : ['tv', 'tv-shows'].includes(category) ? 'tv' : category === 'unmatched' ? 'unmatched' : undefined
  const predicate = (item: MediaLibraryItem) => {
    if (category === 'documentary' && !item.genres.some(genre => String(genre).toLowerCase() === '99' || String(genre).includes('纪录'))) return false
    if (category === 'animation' && !item.genres.some(genre => String(genre).toLowerCase() === '16' || String(genre).includes('动画') || String(genre).includes('动漫'))) return false
    if (category === 'unwatched' && (watchedIds.includes(item.id) || watchedIds.some(id => String(id).startsWith(`${item.id}_`)))) return false
    if (selectedGenreValue && !item.genres.includes(selectedGenreValue)) return false
    if (selectedYearValue) {
      const year = Number(item.year || 0)
      const decade = selectedYearValue.match(/^(\d{4})s$/i)
      if (decade ? year < Number(decade[1]) || year > Number(decade[1]) + 9 : year !== Number(selectedYearValue)) return false
    }
    if (selectedRatingValue) {
      const [min, max] = selectedRatingValue.split('-').map(Number)
      if (!item.rating || item.rating < min || item.rating > max) return false
    }
    if (selectedCast.value && !item.credits?.cast?.some(c => c.name?.toLowerCase().includes(selectedCast.value.toLowerCase()))) return false
    if (selectedCountry.value && !(item.productionCountries || []).some(country => country.toLowerCase().includes(selectedCountry.value.toLowerCase()))) return false
    return !query || item.name?.toLowerCase().includes(query)
  }
  return { category, type, predicate }
}

const loadMediaPage = async (reset = false) => {
  if (props.selectedFolder && folderFileList.value.length > 0) {
    pagedItems.value = []
    pagedTotal.value = 0
    return
  }
  const requestId = ++pageRequestId
  const { category, type, predicate } = getMediaPageQuery()
  const localItems = ['continue', 'continue-watching'].includes(category) ? continueWatchingItems.value
    : ['recent', 'recently-added'].includes(category) ? mediaStore.recentlyAdded
      : category === 'favorites' ? mediaStore.favorites.map(favoriteIdToMediaItem).filter((item): item is MediaLibraryItem => !!item)
        : category === 'playlist' ? (selectedPlaylist.value ? (mediaStore.playlists[selectedPlaylist.value] || []).map(favoriteIdToMediaItem).filter((item): item is MediaLibraryItem => !!item) : [])
          : undefined
  if (localItems) {
    const matched = localItems.filter(predicate)
    pagedTotal.value = matched.length
    pagedItems.value = reset ? matched.slice(0, MEDIA_PAGE_SIZE) : [...pagedItems.value, ...matched.slice(pagedItems.value.length, pagedItems.value.length + MEDIA_PAGE_SIZE)]
    return
  }
  isLoadingPage.value = true
  try {
    const offset = reset ? 0 : pagedItems.value.length
    const [items, total] = await Promise.all([
      DB.getMediaLibraryPage({ offset, limit: MEDIA_PAGE_SIZE, type, predicate }),
      DB.countMediaLibraryItems({ type, predicate })
    ])
    if (requestId !== pageRequestId) return
    const liveItems = mediaStore.isScanning
      ? mediaStore.mediaItems.filter(item => (!type || item.type === type) && predicate(item))
      : []
    const merged = new Map<string, MediaLibraryItem>()
    const pageItems = reset ? items : [...pagedItems.value, ...items]
    pageItems.forEach(item => merged.set(String(item.id), item))
    liveItems.forEach(item => merged.set(String(item.id), item))
    pagedItems.value = Array.from(merged.values())
    pagedTotal.value = Math.max(total, pagedItems.value.length)
  } finally {
    if (requestId === pageRequestId) isLoadingPage.value = false
  }
}

const loadNextPage = () => void loadMediaPage(false)

watch(
  () => [props.activeCategory, props.selectedFolder?.id, props.selectedGenre, props.selectedYear, props.selectedRating, activeTab.value, selectedPlaylist.value, selectedCast.value, selectedCountry.value, localSearchQuery.value, mediaStore.watchedItems.join('\n'), mediaStore.favorites.join('\n'), mediaStore.recentlyAdded.length, mediaStore.isScanning],
  () => void loadMediaPage(true)
)

const isSearchView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'search'
})

const showSearchResults = computed(() => {
  if (!isSearchView.value) return true
  return true
})

const isHomeView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'home' && !props.selectedFolder
})

const showMediaServerSearchPanel = computed(() => {
  return isSearchView.value
})
const showDrillDownBackBar = computed(() => {
  if (isSearchView.value || props.selectedFolder) return false
  const category = props.activeCategory || activeTab.value
  if (category !== 'all') return false
  return !!(props.selectedGenre || props.selectedYear || props.selectedRating)
})
const drillDownResultTitle = computed(() => {
  if (props.selectedGenre) return t('mediaLibrary.filterGenre', { value: props.selectedGenre })
  if (props.selectedYear) return t('mediaLibrary.filterYear', { value: props.selectedYear })
  if (props.selectedRating) return t('mediaLibrary.filterRating', { value: props.selectedRating })
  return t('mediaLibrary.filterResults')
})
const showPlaylistBackBar = computed(() => {
  if (isSearchView.value || props.selectedFolder) return false
  const category = props.activeCategory || activeTab.value
  return category === 'playlist' && !!selectedPlaylist.value
})
const showHomeBackBar = computed(() => {
  if (!props.fromHomeNavigation) return false
  if (isSearchView.value || props.selectedFolder || isHomeView.value) return false
  return true
})
const showHeaderBackButton = computed(() => showHomeBackBar.value)
const showResultBackBar = computed(() => showDrillDownBackBar.value || showPlaylistBackBar.value)

// 顶部操作栏：返回按钮 + 快捷搜索 + 结果计数
const showTopBar = computed(() => {
  if (showDrillDownBackBar.value || showPlaylistBackBar.value) return true
  if (showHomeBackBar.value) return true
  return false
})
const quickSearchCategories = new Set([
  'continue', 'continue-watching', 'recent', 'recently-added', 'movies', 'tv', 'tv-shows',
  'documentary', 'animation', 'unmatched', 'unwatched', 'favorites'
])
const showQuickSearch = computed(() => {
  if (isSearchView.value || isHomeView.value || props.selectedFolder) return false
  const category = props.activeCategory || activeTab.value
  return quickSearchCategories.has(category) || showDrillDownBackBar.value || showPlaylistBackBar.value
})
const showResultCount = computed(() => showQuickSearch.value)
const searchExpanded = ref(false)
const quickSearchInputRef = ref<InstanceType<typeof HTMLInputElement>>()

const onQuickSearchBlur = () => {
  if (!localSearchQuery.value.trim()) {
    searchExpanded.value = false
  }
}
const homeNavigationTitleMap: Record<string, string> = {
  'continue-watching': t('mediaLibrary.continue'),
  'recently-added': t('mediaLibrary.recent'),
  movies: t('mediaLibrary.movies'),
  'tv-shows': t('mediaLibrary.tv'),
  documentary: t('mediaLibrary.documentary'),
  animation: t('mediaLibrary.animation'),
  unmatched: t('mediaLibrary.unmatched'),
  unwatched: t('mediaLibrary.unwatched'),
  favorites: t('mediaLibrary.favorite'),
  playlist: t('mediaLibrary.playlist'),
  genres: t('mediaLibrary.genres'),
  ratings: t('mediaLibrary.ratings'),
  years: t('mediaLibrary.years')
}
const resultBarTitle = computed(() => {
  if (showHomeBackBar.value) {
    const category = props.activeCategory || activeTab.value
    return homeNavigationTitleMap[category] || t('mediaLibrary.library')
  }
  if (showPlaylistBackBar.value) return t('mediaLibrary.playlistTitle', { name: selectedPlaylist.value })
  return drillDownResultTitle.value
})
const hasLocalSearchResults = computed(() => {
  return isSearchView.value && !!localSearchQuery.value.trim() && pagedItems.value.length > 0
})
const hasIntegratedSearchResults = computed(() => {
  return hasLocalSearchResults.value
    || mediaServerSearchLoading.value
    || !!mediaServerSearchError.value
    || mediaServerSearchGroups.value.length > 0
})

watch(isSearchView, (value) => {
  if (!value) return
  if (mediaServerSearchTimer) clearTimeout(mediaServerSearchTimer)
  if (localSearchQuery.value.trim()) {
    void runMediaServerSearch(localSearchQuery.value)
    return
  }
  void loadMediaServerSuggestions()
}, { immediate: true })

// 分类聚合视图相关计算属性
const showCategoryView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return ['genres', 'ratings', 'years'].includes(category) && !props.selectedFolder
})

const showBrowseModeToggle = computed(() => {
  if (isSearchView.value) return false
  if (isHomeView.value) return false
  return !showingDetail.value
})

const showPosterTypeToggle = computed(() => {
  if (!showBrowseModeToggle.value) return false
  return !showCategoryView.value
})

const showPlaylistView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'playlist' && !props.selectedFolder && !selectedPlaylist.value
})

const isContinueWatchingView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'continue-watching'
})

const documentaryItems = computed(() => mediaStore.mediaItems.filter((item) => {
  return item.genres.some((genre) => {
    const normalized = String(genre).toLowerCase()
    return normalized === '99' || normalized.includes('纪录')
  })
}))

const animationItems = computed(() => mediaStore.mediaItems.filter((item) => {
  return item.genres.some((genre) => {
    const normalized = String(genre).toLowerCase()
    return normalized === '16' || normalized.includes('动画') || normalized.includes('动漫')
  })
}))

const unwatchedItems = computed(() => mediaStore.mediaItems.filter(item => {
  if (mediaStore.watchedItems.includes(item.id)) return false
  return !mediaStore.watchedItems.some(watchedId => String(watchedId).startsWith(`${item.id}_`))
}))

const favoriteItems = computed(() => mediaStore.favorites
  .map(favoriteIdToMediaItem)
  .filter((item): item is MediaLibraryItem => Boolean(item)))

const localItemToNode = (
  item: MediaLibraryItem | MediaListItem,
  options: {
    posterType?: 'portrait' | 'landscape'
    title?: string
    overview?: string
    kind?: MediaServerLibraryNode['kind']
    progress?: number
  } = {}
): MediaServerLibraryNode => {
  const kind = options.kind || (item.type === 'movie' ? 'movie' : item.type === 'tv' ? 'series' : 'folder')
  return {
    id: item.id,
    serverId: 'local-media-library',
    provider: 'jellyfin',
    kind,
    rawType: kind,
    title: options.title || item.name,
    overview: options.overview ?? item.overview ?? '',
    poster: item.posterUrl,
    backdrop: item.backdropUrl,
    images: {
      primary: item.posterUrl,
      backdrop: item.backdropUrl
    },
    year: item.year ? Number(item.year) : undefined,
    rating: typeof item.rating === 'number' ? item.rating : undefined,
    progress: options.progress,
    parentTitle: item.type === 'tv' && getEpisodeTitleSuffix(item) ? getEpisodeTitleSuffix(item) : undefined,
    isPlayed: mediaStore.isWatchedById?.(item.id) || false,
    isFavorite: mediaStore.isFavorite?.(item.id) || false,
    coverageBadge: getMediaCoverage(item)?.summary
  }
}

const localContinueCards = computed<MediaServerCardItem[]>(() => continueWatchingItems.value.slice(0, 12).map((item) => ({
  ...localItemToNode(item, {
    kind: item.type === 'tv' ? 'episode' : 'movie',
    title: item.name,
    overview: String((item as MediaListItem).continueEpisodeLabel || ''),
    progress: typeof item.watchProgress === 'number' ? Math.round((item.watchProgress || 0) * 100) : undefined
  })
})))

const getFolderSourceLabel = (folder: any) => {
  const connectionId = folder.userId || getWebDavConnectionId(folder.driveId)
  if (connectionId && getWebDavConnection(connectionId)?.kind === 'alist') return 'AList 文件源'
  if (folder.driveServerId === 'webdav' || (folder.driveId || '').startsWith('webdav:')) return 'WebDAV 文件源'
  if (folder.driveId === 'local' || folder.driveServerId === 'local') return '本地文件夹'
  if (folder.driveId === 'cloud123' || folder.driveServerId === 'cloud123') return '123 云盘'
  if (folder.driveId === 'drive115' || folder.driveServerId === 'drive115') return '115 网盘'
  if (folder.driveId === 'baidu' || folder.driveServerId === 'baidu') return '百度网盘'
  if (folder.driveId === 'pikpak' || folder.driveServerId === 'pikpak') return 'PikPak'
  if (folder.driveId === 'quark' || folder.driveServerId === 'quark') return '夸克网盘'
  if (folder.driveId === 'dropbox' || folder.driveServerId === 'dropbox') return 'Dropbox'
  if (folder.driveId === 'onedrive' || folder.driveServerId === 'onedrive') return 'OneDrive'
  if (folder.driveId === 'box' || folder.driveServerId === 'box') return 'Box'
  if (folder.driveId === 'cloud139' || folder.driveServerId === 'cloud139') return '139 云盘'
  if (folder.driveId === 'cloud189' || folder.driveServerId === 'cloud189') return '天翼云盘'
  if (folder.driveId === 'guangya' || folder.driveServerId === 'guangya') return '光鸭云盘'
  return '阿里云盘'
}

const getFolderCoverImage = (folder: any) => {
  const related = mediaStore.mediaItems.find((item) => item.folderId === folder.id || (folder.path && item.folderPath === folder.path))
  return related?.posterUrl || related?.backdropUrl || ''
}

const localShortcutSections = computed(() => {
  const genres = mediaStore.genreCategories.slice(0, 18).map((item) => ({
    key: `genre-${item.name}`,
    title: item.name,
    description: `${item.count} 项`,
    icon: 'iconwbiaoqian',
    count: item.count,
    coverImages: getDeterministicCoverImages(item),
    cardType: 'genre' as const,
    action: () => handleCategoryClick({ name: item.name, type: 'genre', count: item.count })
  }))

  const ratings = mediaStore.ratingCategories.slice(0, 18).map((item) => ({
    key: `rating-${item.name}`,
    title: item.name.replace('分', ''),
    description: `${item.count} 项`,
    icon: 'iconcrown2',
    count: item.count,
    coverImages: getDeterministicCoverImages(item),
    cardType: 'rating' as const,
    action: () => handleCategoryClick({ name: item.name, type: 'rating', count: item.count })
  }))

  const years = mediaStore.yearGroups.slice(0, 18).map((item) => ({
    key: `year-${item.name}`,
    title: item.name,
    description: `${item.count} 项`,
    icon: 'iconcalendar',
    count: item.count,
    coverImages: getDeterministicCoverImages(item),
    cardType: 'year' as const,
    action: () => handleCategoryClick({ name: item.name, type: 'year', count: item.count })
  }))

  const playlists = playlistItems.value.slice(0, 18).map((item) => ({
    key: `playlist-${item.name}`,
    title: item.name,
    description: `${item.count} 项`,
    icon: 'iconlist',
    count: item.count,
    coverImages: item.coverImage ? [item.coverImage] : [],
    cardType: 'playlist' as const,
    action: () => {
      selectedPlaylist.value = item.name
      emit('navigateCategory', 'playlist')
    }
  }))

  const folderEntries = mediaStore.folders.map((folder) => ({
    key: `folder-${folder.id}`,
    title: folder.name,
    description: getFolderSourceLabel(folder),
    icon: 'iconfolder',
    action: () => emit('navigateFolder', folder)
  }))

  return {
    genres,
    ratings,
    years,
    playlists,
    folders: folderEntries
  }
})

const localHomeSections = computed<LocalHomeMediaSection[]>(() => {
  const sections: LocalHomeMediaSection[] = [
    {
      key: 'continue',
      kind: 'continue',
      title: t('mediaLibrary.continue')
    },
    {
      key: 'recent',
      kind: 'media',
      title: t('mediaLibrary.recent'),
      category: 'recently-added',
      posterType: localHomePreferences.recentlyAddedPosterType,
      items: mediaStore.recentlyAdded.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'movies',
      kind: 'media',
      title: t('mediaLibrary.movies'),
      category: 'movies',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.movies.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'tv',
      kind: 'media',
      title: t('mediaLibrary.tv'),
      category: 'tv-shows',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.tvShows.slice(0, 18).map((item) => localItemToNode(item, { kind: 'series' })),
    },
    {
      key: 'documentary',
      kind: 'media',
      title: t('mediaLibrary.documentary'),
      category: 'documentary',
      posterType: localHomePreferences.libraryPosterType,
      items: documentaryItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'animation',
      kind: 'media',
      title: t('mediaLibrary.animation'),
      category: 'animation',
      posterType: localHomePreferences.libraryPosterType,
      items: animationItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'unmatched',
      kind: 'media',
      title: t('mediaLibrary.unmatched'),
      category: 'unmatched',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.unmatchedItems.slice(0, 18).map((item) => localItemToNode(item, { kind: 'folder' })),
    },
    {
      key: 'unwatched',
      kind: 'media',
      title: t('mediaLibrary.unwatched'),
      category: 'unwatched',
      posterType: localHomePreferences.libraryPosterType,
      items: unwatchedItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'favorites',
      kind: 'media',
      title: t('mediaLibrary.favorite'),
      category: 'favorites',
      posterType: localHomePreferences.libraryPosterType,
      items: favoriteItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'playlists',
      kind: 'shortcut',
      title: t('mediaLibrary.playlist'),
      variant: 'banner',
      entries: localShortcutSections.value.playlists
    },
    {
      key: 'genres',
      kind: 'shortcut',
      title: t('mediaLibrary.genres'),
      variant: 'banner',
      entries: localShortcutSections.value.genres
    },
    {
      key: 'ratings',
      kind: 'shortcut',
      title: t('mediaLibrary.ratings'),
      variant: 'banner',
      entries: localShortcutSections.value.ratings
    },
    {
      key: 'years',
      kind: 'shortcut',
      title: t('mediaLibrary.years'),
      variant: 'banner',
      entries: localShortcutSections.value.years
    },
    {
      key: 'folders',
      kind: 'shortcut',
      title: t('mediaLibrary.folders'),
      variant: 'mini',
      entries: localShortcutSections.value.folders
    }
  ]

  return sections.filter((section) => {
    if (section.key === 'folders') return false
    if (section.key === 'recent' && !localHomePreferences.showRecentlyAdded) return false
    if (section.kind === 'continue') return localContinueCards.value.length > 0
    if (section.kind === 'media') return (section.items?.length || 0) > 0
    return (section.entries?.length || 0) > 0
  })
})

const orderedLocalHomeSections = computed(() => {
  const order = localHomePreferences.homeSectionOrder || []
  if (!order.length) return localHomeSections.value
  const byKey = new Map(localHomeSections.value.map((section) => [section.key, section]))
  const ordered = order.map((key) => byKey.get(key)).filter((section): section is LocalHomeMediaSection => !!section)
  const rest = localHomeSections.value.filter((section) => !order.includes(section.key))
  return [...ordered, ...rest]
})

const matchesLocalHomeSearch = (item: MediaServerLibraryNode | MediaServerCardItem, query: string) => {
  const searchable = [item.title, item.parentTitle, item.overview, item.year].filter((value) => value !== undefined && value !== null).join(' ').toLowerCase()
  return searchable.includes(query)
}

const filteredLocalContinueCards = computed(() => {
  const query = homeSearchQuery.value.trim().toLowerCase()
  return query ? localContinueCards.value.filter((item) => matchesLocalHomeSearch(item, query)) : localContinueCards.value
})

const visibleLocalHomeSections = computed(() => {
  const hidden = new Set(localHomePreferences.hiddenHomeSectionIds || [])
  const query = homeSearchQuery.value.trim().toLowerCase()
  return orderedLocalHomeSections.value.flatMap((section) => {
    if (hidden.has(section.key)) return []
    if (!query) return [section]
    if (section.kind === 'continue') return filteredLocalContinueCards.value.length > 0 ? [section] : []
    if (section.kind !== 'media') return []
    const items = (section.items || []).filter((item) => matchesLocalHomeSearch(item, query))
    return items.length > 0 ? [{ ...section, items }] : []
  })
})

const getLocalHomeSectionTotalCount = (section: LocalHomeMediaSection) => {
  if (section.kind === 'continue') return filteredLocalContinueCards.value.length
  if (section.kind === 'media') return section.items?.length || 0
  return (section.entries || []).reduce((total, entry) => total + (entry.count || 0), 0)
}

const currentCategorySourceItems = computed<MediaLibraryItem[]>(() => {
  const category = props.activeCategory || activeTab.value
  switch (category) {
    case 'continue':
    case 'continue-watching':
      return [...continueWatchingItems.value]
    case 'recent':
    case 'recently-added':
      return [...mediaStore.recentlyAdded]
    case 'movies':
      return [...mediaStore.movies]
    case 'tv':
    case 'tv-shows':
      return [...mediaStore.tvShows]
    case 'unmatched':
      return [...mediaStore.unmatchedItems]
    default:
      return [...mediaStore.mediaItems]
  }
})

const categoryItems = computed(() => {
  const category = props.activeCategory || activeTab.value
  const sourceItems = currentCategorySourceItems.value

  switch (category) {
    case 'genres': {
      const genreMap = new Map<string, MediaLibraryItem[]>()
      sourceItems.forEach(item => {
        item.genres.forEach(genre => {
          if (!genreMap.has(genre)) genreMap.set(genre, [])
          genreMap.get(genre)!.push(item)
        })
      })
      return Array.from(genreMap.entries())
        .map(([name, items]) => ({
          name,
          count: items.length,
          type: 'genre' as const,
          items
        }))
        .sort((a, b) => b.count - a.count)
    }
    case 'ratings': {
      const categories = [
        { range: [1, 5.99], label: '1-5分', items: [] as MediaLibraryItem[] },
        { range: [6, 6.99], label: '6分', items: [] as MediaLibraryItem[] },
        { range: [7, 7.99], label: '7分', items: [] as MediaLibraryItem[] },
        { range: [8, 8.99], label: '8分', items: [] as MediaLibraryItem[] },
        { range: [9, 9.99], label: '9分', items: [] as MediaLibraryItem[] },
        { range: [10, 10], label: '10分', items: [] as MediaLibraryItem[] }
      ]
      sourceItems.forEach(item => {
        const rating = item.rating == null ? NaN : Number(item.rating)
        if (Number.isNaN(rating) || rating <= 0 || rating > 10) return
        const group = categories.find(c => rating >= c.range[0] && rating <= c.range[1])
        if (group) group.items.push(item)
      })
      return categories
        .filter(c => c.items.length > 0)
        .map(c => ({
          name: c.label,
          count: c.items.length,
          type: 'rating' as const,
          range: c.range,
          items: c.items
        }))
    }
    case 'years': {
      const groups: Record<string, MediaLibraryItem[]> = {}
      sourceItems.forEach(item => {
        if (!item.year) return
        const year = parseInt(String(item.year))
        if (!Number.isFinite(year)) return
        const decade = Math.floor(year / 10) * 10
        const key = `${decade}s`
        if (!groups[key]) groups[key] = []
        groups[key].push(item)
      })
      return Object.entries(groups)
        .sort(([a], [b]) => parseInt(b) - parseInt(a))
        .map(([name, items]) => ({
          name,
          count: items.length,
          type: 'year' as const,
          items
        }))
    }
    default:
      return []
  }
})

const playlistItems = computed(() => {
  const entries = Object.entries(mediaStore.playlists || {})
  return entries.map(([name, itemIds]) => {
    const firstId = itemIds[0]
    let coverImage: string | undefined

    if (firstId) {
      const direct = mediaStore.mediaItems.find(item => item.id === firstId)
      if (direct?.posterUrl) {
        coverImage = direct.posterUrl
      } else {
        const tvBase = mediaStore.tvShows.find(item => String(firstId).startsWith(`${item.id}_`))
        if (tvBase?.posterUrl) coverImage = tvBase.posterUrl
      }
    }

    return {
      name,
      count: itemIds.length,
      type: 'playlist' as const,
      coverImage
    }
  })
})

const favoriteIdToMediaItem = (favoriteId: string): MediaLibraryItem | null => {
  const favoriteKey = String(favoriteId)
  const direct = mediaStore.mediaItems.find(item => item.id === favoriteKey)
  if (direct) {
    return direct
  }

  const tvBase = mediaStore.tvShows.find(item => favoriteKey.startsWith(`${item.id}_`))
  if (!tvBase) return null

  const suffix = favoriteKey.slice(tvBase.id.length + 1)
  const parts = suffix.split('_').filter(Boolean)
  const seasonNumber = parseInt(parts[0] || '', 10)
  const episodeNumber = parts.length > 1 ? parseInt(parts[1] || '', 10) : undefined

  if (!Number.isFinite(seasonNumber)) return tvBase

  const season = tvBase.seasons?.find(s => s.seasonNumber === seasonNumber)
  if (!episodeNumber) {
    return {
      ...tvBase,
      name: `${tvBase.name} S${seasonNumber}`,
      seasons: season ? [season] : tvBase.seasons
    }
  }

  const episode = season?.episodes?.find(e => e.episodeNumber === episodeNumber)
  const driveFiles = episode?.driveFiles || tvBase.driveFiles

  return {
    ...tvBase,
    name: `${tvBase.name} S${seasonNumber}E${episodeNumber}`,
    seasons: season ? [{
      ...season,
      episodes: episode ? [episode] : season.episodes
    }] : tvBase.seasons,
    driveFiles
  }
}

const parseEpisodeId = (id: string) => {
  const parts = String(id).split('_')
  if (parts.length < 3) return null
  const seasonNumber = parseInt(parts[parts.length - 2] || '', 10)
  const episodeNumber = parseInt(parts[parts.length - 1] || '', 10)
  if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) return null
  const tvId = parts.slice(0, -2).join('_')
  return { seasonNumber, episodeNumber, tvId }
}

const getEpisodeTitleSuffix = (item: MediaLibraryItem) => {
  if (/第\s*\d+\s*季/.test(item.name) || /S\d+E\d+/i.test(item.name)) {
    return ''
  }
  const info = parseEpisodeId(item.id)
  if (!info) return ''
  return `S${info.seasonNumber}E${info.episodeNumber}`
}

const getUnmatchedPath = (item: MediaLibraryItem) => {
  return item.driveFiles?.[0]?.path || ''
}

const getItemDisplayImage = (item: MediaLibraryItem) => {
  return posterType.value === 'landscape'
    ? (item.backdropUrl || item.posterUrl || '')
    : (item.posterUrl || item.backdropUrl || '')
}

const getItemTypeLabel = (item: MediaLibraryItem) => {
  if (item.scrapeRetrying) return t('media.retryable')
  if (item.type === 'movie') return t('mediaLibrary.typeMovie')
  if (item.type === 'tv') return t('mediaLibrary.typeTv')
  return t('mediaLibrary.typeUnmatched')
}

const getPosterContextBadge = (item: MediaLibraryItem) => {
  if (props.selectedYear && item.year) {
    return String(item.year)
  }
  if (props.selectedRating && typeof item.rating === 'number') {
    return item.rating.toFixed(1)
  }
  return ''
}

const getCoverageBadge = (item: MediaLibraryItem) => getMediaCoverage(item)?.summary || ''

const getItemMetaItems = (item: MediaLibraryItem) => {
  const parts = [
    item.year ? `${item.year}` : '',
    typeof item.rating === 'number' ? t('mediaLibrary.ratingText', { rating: item.rating.toFixed(1) }) : '',
    item.type === 'tv' && item.seasons?.length ? t('mediaLibrary.seasonsCount', { count: item.seasons.length }) : '',
    item.productionCountries?.[0] || ''
  ].filter(Boolean)
  return [...new Set(parts)]
}

const getItemOverview = (item: MediaLibraryItem) => {
  const overview = (item.overview || '').trim()
  if (!overview) return ''
  return overview.length > 160 ? `${overview.slice(0, 160)}...` : overview
}

const parseContinueEpisode = (id: string) => {
  return parseEpisodeId(id)
}

const mapContinueWatchingItem = (cw: MediaLibraryItem): MediaListItem => {
  const result: MediaListItem = {
    ...cw,
    watchProgress: cw.watchProgress,
    lastWatched: cw.lastWatched
  }

  if (cw.type === 'tv') {
    const episodeInfo = parseContinueEpisode(cw.id)
    if (episodeInfo) {
      const tvId = episodeInfo.tvId
      const base = mediaStore.tvShows.find(item => item.id === tvId) || cw
      const season = base.seasons?.find(s => s.seasonNumber === episodeInfo.seasonNumber)
      const episode = season?.episodes?.find(ep => ep.episodeNumber === episodeInfo.episodeNumber)

      result.name = `${base.name} 第${episodeInfo.seasonNumber}季 第${episodeInfo.episodeNumber}集`
      result.continueEpisodeLabel = `第 ${episodeInfo.seasonNumber} 季 · 第 ${episodeInfo.episodeNumber} 集`
      result.posterUrl = base.posterUrl || result.posterUrl
      result.backdropUrl = base.backdropUrl || result.backdropUrl
      result.type = 'tv'
      result.seasons = season && episode ? [{
        ...season,
        episodes: [episode]
      }] : base.seasons
    }
  }

  return result
}

const continueWatchingItems = computed(() => {
  // const list = Array.isArray(mediaStore.continueWatching) ? mediaStore.continueWatching : []
  // return list.map(mapContinueWatchingItem)
  return mediaStore.continueWatching
})

const contextMenuIsFavorite = computed(() => {
  if (!contextMenuItem.value || typeof mediaStore.isFavorite !== 'function') return false
  return mediaStore.isFavorite(contextMenuItem.value.id)
})

const contextMenuIsWatched = computed(() => {
  if (!contextMenuItem.value || typeof mediaStore.isWatched !== 'function') return false
  return mediaStore.isWatched(contextMenuItem.value.id)
})

const contextMenuInPlaylist = computed(() => {
  if (!contextMenuItem.value) return false
  return Object.values(mediaStore.playlists || {}).some(list => list.includes(contextMenuItem.value!.id))
})

const hasPlaylists = computed(() => {
  return Object.keys(mediaStore.playlists || {}).length > 0
})

const contextMenuStyle = computed(() => {
  const position = contextMenuPosition.value || { x: 0, y: 0 }
  return {
    position: 'fixed',
    left: `${position.x}px`,
    top: `${position.y}px`,
    zIndex: 9999,
    opacity: showContextMenu.value ? 1 : 0
  }
})

const contextMenuInContinueWatching = computed(() => {
  if (!contextMenuItem.value) return false
  return mediaStore.continueWatching.some(item => item.id === contextMenuItem.value!.id)
})

// 方法
const openMedia = (item: MediaLibraryItem) => {
  console.log('Opening media:', item.name)

  // 显示详情页面
  currentMediaItem.value = item
  showingDetail.value = true
}

const openContextMenu = (event: MouseEvent, item: MediaLibraryItem) => {
  contextMenuItem.value = item
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  showContextMenu.value = true
}

const handleContextMenuClose = () => {
  showContextMenu.value = false
  contextMenuItem.value = null
}

const toggleFavoriteFromMenu = () => {
  if (!contextMenuItem.value || typeof mediaStore.toggleFavorite !== 'function') return
  mediaStore.toggleFavorite(contextMenuItem.value.id)
  handleContextMenuClose()
}

const toggleWatchedFromMenu = () => {
  if (!contextMenuItem.value || typeof mediaStore.markWatched !== 'function') return
  mediaStore.markWatched(contextMenuItem.value.id, !contextMenuIsWatched.value)
  handleContextMenuClose()
}

const togglePlaylistFromMenu = () => {
  if (!contextMenuItem.value) return
  const playlistName = Object.keys(mediaStore.playlists || {})[0]
  if (!playlistName) return
  mediaStore.togglePlaylistItem(playlistName, contextMenuItem.value.id)
  handleContextMenuClose()
}

const removeFromContinueWatchingFromMenu = () => {
  if (!contextMenuItem.value) return
  if (typeof mediaStore.removeFromContinueWatching === 'function') {
    mediaStore.removeFromContinueWatching(contextMenuItem.value.id)
  }
  handleContextMenuClose()
}

const handleManualAIScrape = async (item: MediaLibraryItem) => {
  const scrapedItems = await manualAIScrapeItems(item)
  if (!scrapedItems.length) return
  if (!scrapedItems.some(scraped => scraped.id === item.id)) {
    mediaStore.removeMediaItem(item.id)
  }
  for (const scraped of scrapedItems) {
    if (scraped.type === 'tv') {
      mediaStore.addOrMergeTvSeries(scraped)
    } else {
      mediaStore.addMediaItem(scraped)
    }
    mediaStore.addToRecentlyAdded(scraped)
  }
  currentMediaItem.value = scrapedItems[0]
  message.success(t('mediaLibrary.aiRescrapeDone'))
}

const aiRescrapeFromMenu = async () => {
  const target = contextMenuItem.value
  handleContextMenuClose()
  if (!target) return
  await handleManualAIScrape(target)
}

const openManualMetadataEditor = () => {
  const target = contextMenuItem.value
  handleContextMenuClose()
  if (!target) return
  manualMetadataTarget.value = target
  manualMetadataDefaultsToWholeTvSeries.value = target.type === 'tv'
  manualMetadataVisible.value = true
}

const closeManualMetadataEditor = () => {
  manualMetadataVisible.value = false
  manualMetadataTarget.value = null
  manualMetadataDefaultsToWholeTvSeries.value = false
}

const saveManualMetadata = (updated: MediaLibraryItem) => {
  const target = manualMetadataTarget.value
  if (!target) return
  mediaStore.replaceMediaItemMetadata(updated)
  if (currentMediaItem.value?.id === updated.id) currentMediaItem.value = updated
  closeManualMetadataEditor()
  message.success(t('mediaLibrary.metadataUpdated'))
}

const getBaseMediaId = (item: MediaLibraryItem) => {
  const parts = String(item.id).split('_')
  if (parts.length >= 3) return parts.slice(0, -2).join('_')
  return item.id
}

const deleteMediaFromMenu = () => {
  if (!contextMenuItem.value) return
  const baseId = getBaseMediaId(contextMenuItem.value)
  mediaStore.removeMediaItem(baseId)
  if (typeof mediaStore.removeFromContinueWatching === 'function') {
    mediaStore.removeFromContinueWatching(contextMenuItem.value.id)
  }
  if (typeof mediaStore.removeFromFavorites === 'function') {
    mediaStore.removeFromFavorites(contextMenuItem.value.id)
  }
  if (typeof mediaStore.removeFromPlaylists === 'function') {
    mediaStore.removeFromPlaylists(contextMenuItem.value.id)
  }
  if (typeof mediaStore.removeWatchedByPrefix === 'function') {
    mediaStore.removeWatchedByPrefix(baseId)
  }
  handleContextMenuClose()
}

// 返回媒体库列表
const handleDetailBack = () => {
  showingDetail.value = false
  currentMediaItem.value = undefined
}

const handleMetadataUpdated = (item: MediaLibraryItem) => {
  currentMediaItem.value = item
}

// 处理详情页标签点击
const handleDetailTagClick = (tagType: string, tagValue: string) => {
  console.log(`Tag clicked: ${tagType} = ${tagValue}`)

  // 返回列表并应用筛选
  showingDetail.value = false
  currentMediaItem.value = undefined
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
  selectedCast.value = ''
  selectedCountry.value = ''

  // 根据标签类型设置筛选条件
  switch (tagType) {
    case 'genre':
      selectedGenre.value = tagValue
      break
    case 'year':
      selectedYear.value = tagValue
      break
    case 'cast':
      selectedCast.value = tagValue
      break
    case 'country':
      selectedCountry.value = tagValue
      break
    // 可以扩展更多标签类型
  }
}

const categoryListPalette = [
  ['#5b7cfa', '#7c4dff'],
  ['#10b981', '#06b6d4'],
  ['#f59e0b', '#ef4444'],
  ['#ec4899', '#8b5cf6'],
  ['#14b8a6', '#3b82f6'],
  ['#84cc16', '#22c55e']
]

const getSeededGradient = (seedSource: string, fallbackType: string) => {
  const base = String(seedSource || fallbackType || '')
  let hash = 0
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash * 37 + base.charCodeAt(index)) >>> 0
  }
  const [from, to] = categoryListPalette[hash % categoryListPalette.length]
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
}

// 获取确定性封面图（基于分类名哈希，避免每次渲染变化）
const getDeterministicCoverImages = (categoryItem: any): string[] => {
  if (categoryItem.items && categoryItem.items.length > 0) {
    const itemsWithCover = categoryItem.items.filter((item: any) => item.posterUrl || item.backdropUrl)
    if (itemsWithCover.length === 0) return []
    // 基于分类名确定性洗牌，选取最多 4 张
    const seed = String(categoryItem.name || '')
    let hash = 0
    for (let i = 0; i < seed.length; i++) hash = (hash * 37 + seed.charCodeAt(i)) >>> 0
    const shuffled = [...itemsWithCover]
    for (let i = shuffled.length - 1; i > 0; i--) {
      hash = (hash * 1103515245 + 12345) >>> 0
      const j = hash % (i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, 4).map((item: any) => item.posterUrl || item.backdropUrl)
  }
  return []
}

// 获取列表卡片样式
const getListCardStyle = (item: any) => {
  const covers = getDeterministicCoverImages(item)
  const gradient = getSeededGradient(item.name, item.type || 'genre')
  if (covers.length > 0) {
    const coverUrl = covers[0]
    return {
      backgroundImage: `${gradient}, url(${coverUrl})`,
      backgroundSize: '100% 100%, auto 100%',
      backgroundPosition: 'center center, center center',
      backgroundRepeat: 'no-repeat, no-repeat'
    }
  }
  return {
    background: gradient
  }
}

const getPlaylistCardStyle = (item: { coverImage?: string }) => {
  const gradient = getSeededGradient(item.coverImage || '', 'genre')
  if (item.coverImage) {
    return {
      backgroundImage: `${gradient}, url(${item.coverImage})`,
      backgroundSize: '100% 100%, auto 100%',
      backgroundPosition: 'center center, center center',
      backgroundRepeat: 'no-repeat, no-repeat'
    }
  }
  return {
    background: gradient
  }
}

// 处理分类卡片点击事件
const handleCategoryClick = (data: { name: string; type: string; count: number }) => {
  console.log('Category clicked:', data)

  // 根据类型设置相应的筛选条件
  switch (data.type) {
    case 'genre':
      selectedGenre.value = data.name
      break
    case 'rating':
      if (data.name === '1-5分') {
        selectedRating.value = '1-5.99'
      } else {
        const rating = Number.parseInt(data.name.replace('分', ''), 10)
        selectedRating.value = Number.isFinite(rating) ? `${rating}-${rating + 0.99}` : ''
      }
      break
    case 'year':
      selectedYear.value = data.name
      break
    case 'playlist':
      selectedPlaylist.value = data.name
      break
  }

  if (data.type === 'playlist') {
    return
  }

  // 发射事件通知父组件进行钻取
  emit('categoryDrillDown', {
    categoryType: data.type,
    categoryValue: data.name,
    filter: {
      genre: data.type === 'genre' ? data.name : undefined,
      rating: data.type === 'rating' ? selectedRating.value : undefined,
      year: data.type === 'year' ? selectedYear.value : undefined
    }
  })
}

const openFile = (file: any) => {
  console.log('Opening file:', file.name)
  if (file.isDir) {
    // 如果是文件夹，可以进一步进入
    console.log('Enter directory:', file.name)
  } else {
    // 如果是文件，打开播放器或下载
    console.log('Open file:', file.name)
  }
}

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement
  img.closest('.media-poster, .list-poster')?.classList.add('is-broken')
  img.style.display = 'none'
}

const handlePosterLoad = (event: Event) => {
  const img = event.target as HTMLImageElement
  img.closest('.media-poster, .list-poster')?.classList.remove('is-broken')
  img.style.display = ''
}

const showAddFolder = (folder: any) => {
  folderForm.value.name = folder.name
  showAddFolderModal.value = true
}

const handleAddFolder = async () => {
  console.log('Adding folder to library:', folderForm.value.name)
  showAddFolderModal.value = false
}

const buildAliFileModel = (driveFile: DriveFileItem): IAliGetFileModel => {
  const ext = driveFile.name.split('.').pop() || ''
  const parentFileId = driveFile.parentFileId || ((driveFile.driveId || '').startsWith('webdav:')
    ? ((driveFile.path || '').replace(/\/[^/]*$/, '') || '/')
    : 'root')
  return {
    __v_skip: true,
    drive_id: driveFile.driveId,
    file_id: driveFile.id,
    parent_file_id: parentFileId,
    name: driveFile.name,
    namesearch: driveFile.name.toLowerCase(),
    ext,
    mime_type: '',
    mime_extension: '',
    category: 'video',
    icon: 'iconfile_video',
    size: driveFile.fileSize || 0,
    sizeStr: '',
    time: 0,
    timeStr: '',
    starred: false,
    isDir: false,
    thumbnail: driveFile.thumbnailLink || '',
    description: driveFile.contentHash || '',
    media_width: driveFile.height,
    media_height: driveFile.height,
    media_duration: driveFile.videoDuration,
    media_play_cursor: '',
    media_time: '',
    user_meta: '',
    user_id: driveFile.userId || '',
    library_subtitle_files: driveFile.subtitleFiles || []
  } as IAliGetFileModel
}

const buildPlaylistEntry = (aliFile: IAliGetFileModel, title: string): IPageVideoPlaylistEntry => ({
  user_id: (aliFile as any).user_id || '',
  drive_id: aliFile.drive_id,
  file_id: aliFile.file_id,
  parent_file_id: aliFile.parent_file_id,
  file_name: aliFile.name,
  html: title,
  ext: aliFile.ext,
  description: aliFile.description,
  play_cursor: aliFile.media_play_cursor ? parseInt(aliFile.media_play_cursor, 10) || 0 : 0,
  encType: aliFile.description || ''
})

const resolveEpisodeByPlaylistId = (item: MediaLibraryItem, playlistId: string) => {
  for (const season of item.seasons || []) {
    for (const episode of season.episodes || []) {
      const episodeId = `${item.id}_${episode.seasonNumber}_${episode.episodeNumber}`
      if (episodeId === playlistId && episode.driveFiles?.length) return episode
    }
  }
  return undefined
}

const resolvePlayablePlaylistItem = (playlistId: string) => {
  const exact = mediaStore.mediaItems.find((item) => item.id === playlistId)
  if (exact) {
    if (exact.type === 'tv') {
      const episode = (exact.seasons || []).flatMap((season) => season.episodes || []).find((candidate) => candidate.driveFiles?.length)
      const driveFile = episode?.driveFiles?.[0]
      if (!episode || !driveFile) return null
      const aliFile = buildAliFileModel(driveFile)
      return { aliFile, entry: buildPlaylistEntry(aliFile, `${exact.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
    }
    const driveFile = exact.driveFiles?.[0]
    if (!driveFile) return null
    const aliFile = buildAliFileModel(driveFile)
    return { aliFile, entry: buildPlaylistEntry(aliFile, exact.name) }
  }

  const series = mediaStore.mediaItems.find((item) => item.type === 'tv' && playlistId.startsWith(`${item.id}_`))
  if (!series) return null
  const episode = resolveEpisodeByPlaylistId(series, playlistId)
  const driveFile = episode?.driveFiles?.[0]
  if (!episode || !driveFile) return null
  const aliFile = buildAliFileModel(driveFile)
  return { aliFile, entry: buildPlaylistEntry(aliFile, `${series.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
}

const resolvePlayableMediaItem = (item: MediaLibraryItem) => {
  if (item.type === 'tv') {
    const episode = (item.seasons || []).flatMap((season) => season.episodes || []).find((candidate) => candidate.driveFiles?.length)
    const driveFile = episode?.driveFiles?.[0]
    if (!episode || !driveFile) return null
    const aliFile = buildAliFileModel(driveFile)
    return { aliFile, entry: buildPlaylistEntry(aliFile, `${item.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
  }
  const driveFile = item.driveFiles?.[0]
  if (!driveFile) return null
  const aliFile = buildAliFileModel(driveFile)
  return { aliFile, entry: buildPlaylistEntry(aliFile, item.name) }
}

const playPlaylist = async (playlistName: string) => {
  const ids = mediaStore.playlists[playlistName] || []
  const playable = ids
    .map((id) => resolvePlayablePlaylistItem(id))
    .filter((item): item is NonNullable<ReturnType<typeof resolvePlayablePlaylistItem>> => !!item)

  if (!playable.length) {
    message.warning(t('mediaLibrary.noPlayablePlaylist'))
    return
  }

  await menuOpenFile(playable[0].aliFile, '', {
    customPlaylistLabel: playlistName,
    customPlaylist: playable.map((item) => item.entry)
  })
}

const playFromMenu = async () => {
  if (!contextMenuItem.value) return

  if (selectedPlaylist.value) {
    await playPlaylist(selectedPlaylist.value)
    handleContextMenuClose()
    return
  }

  const playable = resolvePlayableMediaItem(contextMenuItem.value)
  if (!playable) {
    message.warning(t('mediaLibrary.noPlayableVideo'))
    return
  }

  await menuOpenFile(playable.aliFile)
  handleContextMenuClose()
}

// 显示文件夹文件列表
const showFolderFiles = (files: any[], folder: any) => {
  const driveId = folder.driveId || 'default'
  const dirId = folder.fileId || folder.id
  const userId = folder.userId || ''
  const normalizedFiles = files.map((item: any) => ({
    ...item,
    drive_id: item.drive_id || driveId,
    user_id: item.user_id || userId
  }))

  folderFileList.value = normalizedFiles
  currentFolderInfo.value = folder
  console.log(`显示文件夹 ${folder.name} 的 ${normalizedFiles.length} 个文件`)

  // 使用媒体库专用的 store
  mediaPanFileStore.mSaveDirFileLoading(driveId, dirId, folder.name, '')
  if (driveId !== 'local') {
    mediaPanTreeStore.user_id = userId
    mediaPanTreeStore.drive_id = driveId
    mediaPanTreeStore.selectDir = {
      __v_skip: true,
      drive_id: driveId,
      user_id: userId,
      file_id: dirId,
      album_id: '',
      album_type: '',
      parent_file_id: folder.parentFileId || '',
      name: folder.name,
      namesearch: folder.name,
      path: folder.path || dirId,
      size: 0,
      time: Date.now(),
      description: folder.description || ''
    }
    mediaPanTreeStore.selectDirPath = [mediaPanTreeStore.selectDir]
  }

  // 直接设置数据到媒体库专用 store
  mediaPanFileStore.mSaveDirFileLoadingFinish(driveId, dirId, normalizedFiles, normalizedFiles.length)
}

// 处理进入子文件夹
const handleEnterFolder = async (file: any) => {
  try {
    console.log('进入文件夹:', file.name, file)

    // 将当前文件夹信息推入导航堆栈
    if (currentFolderInfo.value) {
      folderNavigationStack.value.push({
        ...currentFolderInfo.value,
        files: [...folderFileList.value]
      })
    }

    const userId = file.user_id || currentFolderInfo.value?.userId || ''
    const driveId = file.drive_id || currentFolderInfo.value?.driveId || ''
    const fileId = file.file_id

    console.log('获取子文件夹内容:', { userId, driveId, fileId })

    // 构建子文件夹信息
    const subFolder = {
      id: fileId,
      fileId: fileId,
      name: file.name,
      driveId: driveId,
      userId: userId,
      path: file.path || fileId,
      parentFileId: currentFolderInfo.value?.fileId || currentFolderInfo.value?.id
    }

    let items: any[] = []

    // 检查是否为 WebDAV 驱动器
    if (isWebDavDrive(driveId)) {
      console.log('使用WebDAV API获取子文件夹文件列表')
      const connectionId = getWebDavConnectionId(driveId)
      const connection = getWebDavConnection(connectionId)

      if (!connection) {
        message.warning('WebDAV 连接不存在，请重新连接')
        return
      }

      const requestPath = fileId === '/' ? '/' : fileId
      const allItems = await listWebDavDirectory(connection, requestPath)
      items = allItems // WebDAV 已经返回了正确格式的数据
    }
    // 根据不同的网盘类型获取文件列表
    else if (isCloud123User(userId) || driveId === 'cloud123') {
      // 123云盘
      const { apiCloud123FileList, mapCloud123FileToAliModel } = await import('../cloud123/dirfilelist')
      const list = await apiCloud123FileList(userId, fileId, 100)
      items = list.map((item) => {
        const mapped = mapCloud123FileToAliModel(item)
        mapped.drive_id = driveId
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用123云盘API获取子文件夹文件列表')
    } else if (isDrive115User(userId) || driveId === 'drive115') {
      // 115网盘
      const { apiDrive115FileList, mapDrive115FileToAliModel } = await import('../cloud115/dirfilelist')
      const list = await apiDrive115FileList(userId, fileId, 200, 0, true)
      items = list.map((item) => {
        const mapped = mapDrive115FileToAliModel(item, driveId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用115网盘API获取子文件夹文件列表')
    } else if (isBaiduUser(userId) || driveId === 'baidu') {
      // 百度网盘
      const parentPath = file.path || file.file_id || '/'
      const list = await apiBaiduFileList(userId, parentPath, 'name', 0, 1000)
      items = list.map((item: any) => {
        const mapped = mapBaiduFileToAliModel(item, driveId, parentPath)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用百度网盘API获取子文件夹文件列表，路径:', parentPath)
    } else if (isPikPakUser(userId) || driveId === 'pikpak') {
      const { apiPikPakFileList, mapPikPakFileToAliModel } = await import('../pikpak/dirfilelist')
      const parentId = fileId === 'pikpak_root' ? 'pikpak_root' : fileId
      const { items: list } = await apiPikPakFileList(userId, parentId, 100)
      items = list.map((item) => {
        const mapped = mapPikPakFileToAliModel(item, driveId, parentId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用PikPak API获取子文件夹文件列表')
    } else if (driveId === 'dropbox') {
      const { apiDropboxFileList, mapDropboxFileToAliModel } = await import('../dropbox/dirfilelist')
      const parentId = fileId === 'dropbox_root' ? 'dropbox_root' : fileId
      const list = await apiDropboxFileList(userId, parentId, 500)
      items = list.map((item) => {
        const mapped = mapDropboxFileToAliModel(item, driveId, parentId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用Dropbox API获取子文件夹文件列表')
    } else if (isOneDriveUser(userId) || driveId === 'onedrive') {
      const { apiOneDriveFileList, mapOneDriveItemToAliModel } = await import('../onedrive/dirfilelist')
      const parentId = fileId === 'onedrive_root' ? 'onedrive_root' : fileId
      const list = await apiOneDriveFileList(userId, parentId)
      items = list.map((item) => {
        const mapped = mapOneDriveItemToAliModel(item, driveId, parentId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用OneDrive API获取子文件夹文件列表')
    } else if (isBoxUser(userId) || driveId === 'box') {
      const { apiBoxFileList, mapBoxItemToAliModel } = await import('../box/dirfilelist')
      const parentId = fileId === 'box_root' ? 'box_root' : fileId
      const list = await apiBoxFileList(userId, parentId, 500)
      items = list.map((item) => {
        const mapped = mapBoxItemToAliModel(item, driveId, parentId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用Box API获取子文件夹文件列表')
    } else if (isGoogleUser(userId) || driveId === 'google') {
      const { apiGoogleFileList, mapGoogleFileToAliModel } = await import('../google/dirfilelist')
      const parentId = fileId === 'google_root' ? 'google_root' : fileId
      const list = await apiGoogleFileList(userId, parentId)
      items = list.map((item) => {
        const mapped = mapGoogleFileToAliModel(item, driveId, parentId)
        ;(mapped as any).user_id = userId
        return mapped
      })
      console.log('使用Google Drive API获取子文件夹文件列表')
    } else if (isAliyunUser(userId)) {
      // 阿里云盘（默认）
      const result = await AliDirFileList.ApiDirFileList(
        userId,
        driveId,
        fileId,
        file.name,
        'name asc',
        ''
      )
      items = result.items || []
      console.log('使用阿里云盘API获取子文件夹文件列表')
    } else {
      console.warn('[MediaLibrary] skip Aliyun file list for non-Aliyun source', {
        userId,
        driveId,
        fileId
      })
    }

    if (items && items.length >= 0) {
      showFolderFiles(items, subFolder)
    } else {
      console.log(`文件夹 ${file.name} 为空`)
      showFolderFiles([], subFolder)
    }

  } catch (error) {
    console.error('获取文件夹内容失败:', error)
    message.error('获取文件夹内容失败: ' + (error as Error).message)
  }
}

// 暴露方法给父组件
// 返回上级目录
const handleGoBack = () => {
  if (folderNavigationStack.value.length > 0) {
    const parentFolder = folderNavigationStack.value.pop()
    if (parentFolder) {
      currentFolderInfo.value = {
        id: parentFolder.id,
        fileId: parentFolder.fileId,
        name: parentFolder.name,
        driveId: parentFolder.driveId,
        userId: parentFolder.userId,
        path: parentFolder.path,
        parentFileId: parentFolder.parentFileId
      }
      folderFileList.value = parentFolder.files || []

      // 更新 store 状态
      const driveId = parentFolder.driveId || 'default'
      const dirId = parentFolder.fileId || parentFolder.id
      const userId = parentFolder.userId || ''

      mediaPanFileStore.mSaveDirFileLoading(driveId, dirId, parentFolder.name, '')
      mediaPanFileStore.mSaveDirFileLoadingFinish(driveId, dirId, parentFolder.files || [], (parentFolder.files || []).length)

      console.log('返回上级目录:', parentFolder.name)
    }
  }
}

const refreshLibrary = () => {
  // 清除导航堆栈
  folderNavigationStack.value = []
  // 刷新媒体库
}

// 生命周期
onMounted(() => {
  // 初始化媒体库
  mediaServerRegistry.ensureLoaded()
  localHomePreferences.ensureLoaded()
  void loadMediaPage(true)
})

// 定义事件
const emit = defineEmits<{
  categoryDrillDown: [data: {
    categoryType: string
    categoryValue: string
    filter: {
      genre?: string
      rating?: string
      year?: string
    }
  }]
  categoryDrillBack: [data: { categoryType: string }]
  navigateCategory: [category: string]
  homeNavigationBack: []
  navigateFolder: [folder: any]
  manageLibrary: []
  mediaServerNavigate: [route: any]
}>()

const localHomePosterMode = computed<LocalMediaHomePosterType>(() => {
  if (localHomePreferences.libraryPosterType === 'landscape') return 'landscape'
  if (localHomePreferences.recentlyAddedPosterType === 'landscape') return 'landscape'
  return 'portrait'
})

const setLocalHomePosterMode = (value: LocalMediaHomePosterType) => {
  localHomePreferences.setPartial({
    recentlyAddedPosterType: value,
    libraryPosterType: value
  })
}

const findLocalMediaItemById = (id: string) => {
  const itemId = String(id)
  return favoriteIdToMediaItem(itemId)
    || mediaStore.mediaItems.find((item) => String(item.id) === itemId)
    || mediaStore.recentlyAdded.find((item) => String(item.id) === itemId)
    || continueWatchingItems.value.find((item) => String(item.id) === itemId)
    || null
}

const handleLocalHomeResumePlay = (item: MediaServerCardItem) => {
  const target = findLocalMediaItemById(item.id)
  if (target) openMedia(target)
}

const handleLocalHomeNodeSelect = (item: MediaServerLibraryNode) => {
  if (item.id.startsWith('playlist:')) {
    emit('navigateCategory', 'playlist')
    return
  }
  const target = findLocalMediaItemById(item.id)
  if (target) openMedia(target)
}

const handleLocalHomeNodePlay = (item: MediaServerLibraryNode) => {
  handleLocalHomeNodeSelect(item)
}

const openLocalHomeMetadataEditor = (item: MediaServerLibraryNode) => {
  if (item.id.startsWith('playlist:')) return
  const target = findLocalMediaItemById(item.id)
  if (!target) return
  manualMetadataTarget.value = target
  manualMetadataDefaultsToWholeTvSeries.value = target.type === 'tv'
  manualMetadataVisible.value = true
}

const handleLocalHomeCardAction = async (item: MediaServerCardItem | MediaServerLibraryNode, action: 'watched' | 'favorite' | 'download') => {
  if (item.id.startsWith('playlist:')) return
  const target = findLocalMediaItemById(item.id)
  if (!target) return
  if (action === 'download') {
    message.info(t('mediaLibrary.localNoDownload'))
    return
  }
  if (action === 'favorite') {
    mediaStore.toggleFavorite(target.id)
    message.success(mediaStore.isFavorite(target.id) ? t('mediaLibrary.addedFavorite') : t('mediaLibrary.removedFavorite'))
    return
  }
  const nextWatched = !mediaStore.isWatchedById(target.id)
  mediaStore.markWatched(target.id, nextWatched)
  message.success(nextWatched ? t('mediaLibrary.markedWatched') : t('mediaLibrary.markedUnwatched'))
}

const handleLocalHomeSeeAll = (section: LocalHomeMediaSection) => {
  if (section.category) emit('navigateCategory', section.category)
}

const handleLocalShortcutSelect = (entry: { action: () => void }) => {
  entry.action()
}

const handleLocalShortcutSeeAll = (sectionKey: LocalMediaHomeSectionKey) => {
  switch (sectionKey) {
    case 'genres':
      emit('navigateCategory', 'genres')
      break
    case 'ratings':
      emit('navigateCategory', 'ratings')
      break
    case 'years':
      emit('navigateCategory', 'years')
      break
    case 'playlists':
      emit('navigateCategory', 'playlist')
      break
  }
}

const localHomeSectionTitleMap: Record<LocalMediaHomeSectionKey, string> = {
  continue: '继续观看',
  recent: '最近添加',
  movies: t('mediaLibrary.movies'),
  tv: '电视剧',
  documentary: t('mediaLibrary.documentary'),
  animation: t('mediaLibrary.animation'),
  unmatched: t('mediaLibrary.unmatched'),
  unwatched: t('mediaLibrary.unwatched'),
  favorites: t('mediaLibrary.favorite'),
  playlists: '播放列表',
  genres: '分类',
  ratings: t('mediaLibrary.ratings'),
  years: t('mediaLibrary.years'),
  folders: '文件源'
}

const openLocalHomeManager = () => {
  const hiddenSections = new Set(localHomePreferences.hiddenHomeSectionIds || [])
  localHomeManagerDraft.value = orderedLocalHomeSections.value.map((section) => ({
    key: section.key,
    title: localHomeSectionTitleMap[section.key],
    visible: !hiddenSections.has(section.key)
  }))
  draggingLocalHomeSectionId.value = ''
  localHomeManagerVisible.value = true
}

const cancelLocalHomeManager = () => {
  localHomeManagerVisible.value = false
  draggingLocalHomeSectionId.value = ''
}

const toggleLocalHomeDraftVisible = (sectionKey: LocalMediaHomeSectionKey, value: any) => {
  const checked = typeof value === 'boolean' ? value : !!value
  localHomeManagerDraft.value = localHomeManagerDraft.value.map((item) =>
    item.key === sectionKey ? { ...item, visible: checked } : item
  )
}

const moveLocalHomeDraftItem = (sourceKey: LocalMediaHomeSectionKey, targetKey: LocalMediaHomeSectionKey) => {
  const draft = [...localHomeManagerDraft.value]
  const sourceIndex = draft.findIndex((item) => item.key === sourceKey)
  const targetIndex = draft.findIndex((item) => item.key === targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [moved] = draft.splice(sourceIndex, 1)
  draft.splice(targetIndex, 0, moved)
  localHomeManagerDraft.value = draft
}

const handleLocalHomeDragStart = (event: DragEvent, sectionKey: LocalMediaHomeSectionKey) => {
  draggingLocalHomeSectionId.value = sectionKey
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.dropEffect = 'move'
    event.dataTransfer.setData('text/plain', sectionKey)
  }
}

const handleLocalHomeDrop = (targetKey: LocalMediaHomeSectionKey) => {
  const sourceKey = draggingLocalHomeSectionId.value
  if (!sourceKey || sourceKey === targetKey) return
  moveLocalHomeDraftItem(sourceKey, targetKey)
}

const handleLocalHomeDragEnd = () => {
  draggingLocalHomeSectionId.value = ''
}

const handleLocalHomePointerDragStart = (sectionKey: LocalMediaHomeSectionKey) => {
  draggingLocalHomeSectionId.value = sectionKey
  const handlePointerMove = (event: MouseEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const row = target?.closest?.('.home-library-manager-item') as HTMLElement | null
    const targetKey = row?.dataset.sectionKey as LocalMediaHomeSectionKey | undefined
    if (targetKey && targetKey !== draggingLocalHomeSectionId.value) {
      moveLocalHomeDraftItem(draggingLocalHomeSectionId.value as LocalMediaHomeSectionKey, targetKey)
    }
  }
  const handlePointerUp = () => {
    draggingLocalHomeSectionId.value = ''
    window.removeEventListener('mousemove', handlePointerMove)
    window.removeEventListener('mouseup', handlePointerUp)
  }
  window.addEventListener('mousemove', handlePointerMove)
  window.addEventListener('mouseup', handlePointerUp, { once: true })
}

const saveLocalHomeManager = () => {
  const draft = localHomeManagerDraft.value
  const hiddenKeys = draft.filter((item) => !item.visible).map((item) => item.key)
  localHomePreferences.setPartial({
    homeSectionOrder: draft.map((item) => item.key),
    hiddenHomeSectionIds: hiddenKeys
  })
  localHomeManagerVisible.value = false
  draggingLocalHomeSectionId.value = ''
}

const handleDrillDownBack = () => {
  if (props.selectedGenre) {
    emit('categoryDrillBack', { categoryType: 'genre' })
    return
  }
  if (props.selectedYear) {
    emit('categoryDrillBack', { categoryType: 'year' })
    return
  }
  if (props.selectedRating) {
    emit('categoryDrillBack', { categoryType: 'rating' })
  }
}

const handlePlaylistBack = () => {
  selectedPlaylist.value = ''
}

const handleResultBack = () => {
  if (showHomeBackBar.value) {
    emit('homeNavigationBack')
    return
  }
  if (showPlaylistBackBar.value) {
    handlePlaylistBack()
    return
  }
  handleDrillDownBack()
}

async function runMediaServerSearch(rawQuery: string) {
  const query = rawQuery.trim()
  if (!query) {
    mediaServerSearchLoading.value = false
    mediaServerSearchError.value = ''
    mediaServerSearchGroups.value = []
    return
  }
  const candidates = mediaServerRegistry.servers.filter((server) => !!server.baseUrl && !!server.userId)
  if (candidates.length === 0) {
    mediaServerSearchGroups.value = []
    mediaServerSearchError.value = t('mediaLibrary.noSearchableServers')
    return
  }
  mediaServerSearchLoading.value = true
  mediaServerSearchError.value = ''
  try {
    const groups = await Promise.all(
      candidates.map(async (server) => {
        try {
          const result = await getMediaServerSearch(server, query)
          const items = result.items.slice(0, 8)
          if (items.length === 0) return null
          return {
            server: { id: server.id, name: server.name },
            items
          }
        } catch {
          return null
        }
      })
    )
    mediaServerSearchGroups.value = groups.filter(Boolean) as Array<{
      server: { id: string; name: string }
      items: MediaServerLibraryNode[]
    }>
  } catch (error: any) {
    mediaServerSearchGroups.value = []
    mediaServerSearchError.value = error?.message || t('mediaLibrary.searchServersFailed')
  } finally {
    mediaServerSearchLoading.value = false
  }
}

async function loadMediaServerSuggestions() {
  const candidates = mediaServerRegistry.servers.filter((server) => !!server.baseUrl && !!server.userId)
  if (candidates.length === 0) {
    mediaServerSearchGroups.value = []
    mediaServerSearchError.value = t('mediaLibrary.noSearchableServers')
    mediaServerSearchLoading.value = false
    return
  }

  mediaServerSearchLoading.value = true
  mediaServerSearchError.value = ''
  try {
    const groups = await Promise.all(
      candidates.map(async (server) => {
        try {
          const items = (await getMediaServerSuggestions(server)).slice(0, 8)
          if (items.length === 0) return null
          return {
            server: { id: server.id, name: server.name },
            items
          }
        } catch {
          return null
        }
      })
    )
    mediaServerSearchGroups.value = groups.filter(Boolean) as Array<{
      server: { id: string; name: string }
      items: MediaServerLibraryNode[]
    }>
  } catch (error: any) {
    mediaServerSearchGroups.value = []
    mediaServerSearchError.value = error?.message || t('mediaLibrary.loadServerRecommendationsFailed')
  } finally {
    mediaServerSearchLoading.value = false
  }
}

const openMediaServerSearchResult = (serverId: string, item: MediaServerLibraryNode) => {
  mediaServerRegistry.setCurrentServer(serverId)
  mediaServerNavigation.goSearch(localSearchQuery.value.trim())
  mediaServerNavigation.push({ kind: 'item-detail', itemId: item.id, title: item.title })
  emit('mediaServerNavigate', { kind: 'item-detail', itemId: item.id, title: item.title })
}

const resolveMediaServerSearchImage = (item: MediaServerLibraryNode) => {
  const raw = resolveMediaServerImage(item, 'portrait')
    || resolveMediaServerImage(item, 'landscape')
    || resolveMediaServerImage(item, 'cinematic')
  return toMsCacheUrl(mediaServerRegistry.currentServer?.id, raw)
}

const handleMediaServerSearchImageError = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.add('is-broken')
}

const handleMediaServerSearchImageLoad = (event: Event) => {
  const frame = (event.target as HTMLElement | null)?.closest('.media-image-frame')
  frame?.classList.remove('is-broken')
}

const mediaServerKindLabel = (kind: MediaServerLibraryNode['kind']) => {
  if (kind === 'movie') return t('mediaLibrary.typeMovie')
  if (kind === 'series') return t('mediaLibrary.typeTv')
  if (kind === 'season') return t('mediaLibrary.kindSeason')
  if (kind === 'episode') return t('mediaLibrary.typeTv')
  if (kind === 'person') return t('mediaServer.people')
  if (kind === 'folder') return t('mediaLibrary.kindFolder')
  return t('mediaLibrary.kindMedia')
}

// 暴露给父组件的方法
defineExpose({
  showAddFolder,
  showFolderFiles,
  refreshLibrary
})
</script>

<style scoped>
.media-library {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.library-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  padding: 16px;
  border-bottom: 1px solid var(--color-neutral-3);
}

.library-tabs {
  width: 100%;
}

.library-content {
  flex: 1;
  overflow-y: auto;
  padding: 0; /* 移除 padding，让子元素自己管理 */
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  padding: 16px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  padding: 16px;
}

.library-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.library-controls-left {
  min-width: 0;
  flex: 0 0 auto;
}

.library-controls-center {
  flex: 1 1 auto;
  display: flex;
  justify-content: center;
  max-width: 360px;
}

.library-filters-right {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
}

/* 视图切换 — 毛玻璃分段胶囊 */
.view-toggle-pill {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 3px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.view-toggle-seg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  font-size: 16px;
  line-height: 1;
}

.view-toggle-seg:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.04);
}

.view-toggle-seg.active {
  color: rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.view-toggle-seg:active {
  transform: scale(0.94);
}

/* 带文字标签的分段按钮 */
.view-toggle-seg--label {
  width: auto;
  padding: 0 10px;
}

.view-toggle-seg-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  line-height: 1;
}

/* 分段之间的分隔线 */
.view-toggle-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 1px;
  flex-shrink: 0;
}

.media-library :deep(.arco-btn) {
  min-height: 52px;
  padding: 0 18px;
  border-radius: 18px;
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

.media-library :deep(.arco-btn:hover) {
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

.media-library :deep(.arco-btn.arco-btn-primary) {
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

.media-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.library-quick-search {
  width: 240px;
}

.library-scan-status {
  position: sticky;
  z-index: 8;
  top: 0;
  display: flex;
  width: fit-content;
  max-width: calc(100% - 32px);
  align-items: center;
  gap: 8px;
  margin: 0 16px 12px auto;
  padding: 8px 12px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  color: rgba(255, 255, 255, 0.76);
  font-size: 12px;
  backdrop-filter: blur(16px);
}

.library-result-count {
  color: rgba(255, 255, 255, 0.48);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.library-arrow-back {
  height: 42px;
  max-width: min(380px, calc(100vw - 120px));
  padding: 0 18px;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: rgba(255, 255, 255, 0.88);
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  flex-shrink: 0;
}

.library-arrow-back .iconfont {
  font-size: 16px;
  flex-shrink: 0;
}

.library-arrow-back-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
}

.library-arrow-back:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 36px rgba(130, 137, 152, 0.22);
  background: rgba(255, 255, 255, 0.46);
}

.library-header-back-button,
.library-top-back-button {
  flex: 0 0 auto;
}

.search-panel {
  padding: 28px 20px 22px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0.72));
  backdrop-filter: blur(22px);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.search-panel-title {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 14px;
  color: #111827;
}

.search-panel-input {
  width: 100%;
  max-width: 680px;
}

.search-panel-input :deep(.arco-input-wrapper) {
  min-height: 48px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(250, 245, 240, 0.52);
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
}

.search-panel-hint {
  margin-top: 10px;
  font-size: 13px;
  color: #64748b;
}

.search-media-server-panel {
  width: 100%;
  max-width: 860px;
  margin-top: 16px;
  padding: 10px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(247, 241, 234, 0.78);
  box-shadow: 0 18px 36px rgba(63, 46, 37, 0.12);
  backdrop-filter: blur(24px);
}

.search-media-server-title {
  padding: 6px 10px 10px;
  color: #1f2937;
  font-size: 15px;
  font-weight: 800;
}

.search-media-server-state {
  padding: 16px 12px;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
}

.search-media-server-state.error {
  color: #dc2626;
}

.search-media-server-group {
  position: relative;
  padding: 14px 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.84));
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.06);
}

.search-media-server-group + .search-media-server-group {
  margin-top: 18px;
}

.search-media-server-group + .search-media-server-group::before {
  content: '';
  position: absolute;
  top: -10px;
  left: 14px;
  right: 14px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(15, 23, 42, 0.14), transparent);
}

.search-media-server-group-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 7px 12px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  border-radius: 999px;
  background: rgba(239, 246, 255, 0.92);
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.search-media-server-group-title::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
}

.search-media-server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px 12px;
}

.search-media-server-result {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.search-media-server-result:hover {
  transform: translateY(-2px);
}

.search-media-server-result-poster {
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
}

.search-media-server-result-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.search-media-server-result-poster .media-image-placeholder {
  display: none;
}

.search-media-server-result-poster .media-card-placeholder {
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

.search-media-server-result-poster .media-card-placeholder::before {
  content: '';
  width: clamp(48px, 20%, 76px);
  height: clamp(48px, 20%, 76px);
  border-radius: 18px;
  background: center / contain no-repeat url('/favicon.ico');
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
  filter: grayscale(1) brightness(0.72) contrast(0.92);
  opacity: 0.88;
}

.search-media-server-result-poster:not(.has-image) .media-image-placeholder,
.search-media-server-result-poster.is-broken .media-image-placeholder {
  display: flex;
}

.search-media-server-result-poster.is-broken img {
  display: none;
}

.search-media-server-result-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-width: 0;
  padding: 0 2px;
}

.search-media-server-result-title {
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  min-height: calc(1.45em * 2);
}

.search-media-server-result-year {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  padding-top: 1px;
}

.search-media-server-result-meta {
  display: flex;
  gap: 8px;
  min-width: 0;
  color: #64748b;
  font-size: 12px;
  padding: 0 2px;
  min-height: 18px;
}

.search-media-server-result-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-section {
  padding: 16px 20px 0;
}

.search-result-section-body {
  margin-top: 8px;
}

.search-result-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: #1f2937;
  font-size: 16px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}

.search-result-section-toggle {
  flex: 0 0 auto;
  transition: transform 0.2s ease;
}

.search-result-section-title[aria-expanded='false'] .search-result-section-toggle {
  transform: rotate(-90deg);
}

.search-result-section-title::after {
  content: '';
  flex: 1;
  min-width: 32px;
  height: 1px;
  background: linear-gradient(90deg, rgba(15, 23, 42, 0.14), transparent);
}

.search-result-section-divider {
  margin-top: 6px;
  padding-top: 18px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}

.search-results-hub {
  padding-top: 4px;
}

.search-media-server-panel.integrated {
  margin: 14px 20px 0;
  max-width: none;
}

.media-grid {
  display: grid;
  gap: 18px;
  padding: 18px 20px 24px;
}

.media-grid.media-grid-portrait {
  grid-template-columns: repeat(auto-fill, 150px);
}

.media-grid.media-grid-landscape {
  grid-template-columns: repeat(auto-fill, 320px);
}

.media-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.media-item {
  cursor: pointer;
  transition: transform 0.22s ease;
}

.media-item:hover {
  transform: translateY(-2px);
}

.media-poster {
  position: relative;
  width: 100%;
  aspect-ratio: 2/3;
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-bg-2) 88%, #eef2f7 12%);
  border: 1px solid color-mix(in srgb, var(--color-neutral-3) 82%, white 18%);
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.media-item-landscape .media-poster {
  aspect-ratio: 16 / 9;
}

.media-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease, filter 0.28s ease;
}

.media-item:hover .media-poster img {
  transform: scale(1.025);
  filter: saturate(1.04) contrast(1.02);
}

/* Keep cloud-drive search cards visually aligned with media-server search results. */
.search-media-grid {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px 12px;
  padding: 0;
}

.search-media-grid .media-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-media-grid .media-poster {
  aspect-ratio: 2 / 3;
  border-radius: 14px;
  border: 0;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
}

.search-media-grid .media-info {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  margin-top: 0;
  padding: 0 2px;
}

.search-media-grid .media-title {
  display: -webkit-box;
  min-height: calc(1.45em * 2);
  margin: 0;
  overflow: hidden;
  text-overflow: clip;
  white-space: normal;
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.search-media-grid .media-year {
  padding-top: 1px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}

.search-media-grid .media-genres,
.search-media-grid .media-path,
.search-media-grid .media-episode {
  grid-column: 1 / -1;
  margin: -4px 0 0;
  color: #64748b;
  font-size: 12px;
}

.watch-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 12px;
  background: rgba(0, 0, 0, 0.45);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.35);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  z-index: 2;
}

.watch-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #f97316);
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
}

.poster-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-3);
  font-size: 44px;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.72), transparent 34%),
    linear-gradient(180deg, rgba(240, 244, 248, 0.94), rgba(221, 228, 236, 0.92));
}

.poster-placeholder-app-icon {
  width: 42px !important;
  height: 42px !important;
  max-width: 42px !important;
  min-width: 0 !important;
  object-fit: contain !important;
  display: block !important;
  opacity: .72;
  filter: drop-shadow(0 8px 14px rgba(15, 23, 42, .14)) !important;
  transform: none !important;
  transition: none !important;
}

.media-item:hover .poster-placeholder-app-icon,
.media-list-item:hover .poster-placeholder-app-icon {
  transform: none !important;
  filter: drop-shadow(0 8px 14px rgba(15, 23, 42, .14)) !important;
}

.media-poster.has-image .poster-placeholder,
.list-poster.has-image .poster-placeholder {
  display: none;
}

.media-poster.is-broken .poster-placeholder,
.list-poster.is-broken .poster-placeholder,
.media-poster:not(.has-image) .poster-placeholder,
.list-poster:not(.has-image) .poster-placeholder {
  display: flex;
}

.media-poster.is-broken img,
.list-poster.is-broken img {
  display: none !important;
}

.type-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(15, 23, 42, 0.74);
  color: #fff;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
}

.poster-context-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.72);
  color: rgba(17, 24, 39, 0.9);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  backdrop-filter: blur(12px) saturate(140%);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
}

.media-coverage-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 16px);
  padding: 5px 8px;
  border: 1px solid rgba(255, 190, 92, 0.45);
  border-radius: 999px;
  background: rgba(43, 27, 8, 0.86);
  color: #ffd18a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  backdrop-filter: blur(10px);
}

.media-coverage-badge span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f5a524;
  color: #201506;
  font-size: 10px;
  font-weight: 900;
}

.media-info {
  margin-top: 10px;
  padding: 0 2px;
}

.media-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-1);
}

.episode-suffix {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-3);
  white-space: nowrap;
}

.media-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 0 0 4px;
  font-size: 10px;
  color: var(--color-text-3);
  white-space: nowrap;
  overflow: hidden;
}

.media-meta-type {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary-light-4) 72%, white 28%);
  color: var(--color-primary-6);
  font-weight: 700;
}

.media-meta-year,
.media-meta-rating {
  flex: 0 0 auto;
}

.media-meta-year {
  color: var(--color-text-3);
}

.media-meta-rating {
  color: #f59e0b;
}

.media-path {
  font-size: 12px;
  color: var(--color-text-3);
  margin: 6px 0 0 0;
  line-height: 1.45;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.media-genres {
  font-size: 11px;
  color: var(--color-text-2);
  margin: 4px 0 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-episode {
  font-size: 12px;
  color: var(--color-text-3);
  margin: 4px 0 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-file-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.folder-header {
  padding: 16px 16px 12px 16px;
  border-bottom: 1px solid var(--color-neutral-3);
  flex-shrink: 0;
}

.folder-header-content {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  flex-direction: column;
}

.folder-info h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-1);
}

.folder-info p {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-3);
}

.folder-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-start;
}

.pan-right-container {
  flex: 1;
  overflow: hidden;
}

/* 列表视图样式 */
.media-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.media-list-item {
  display: flex;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0;
  align-items: stretch;
  cursor: pointer;
  gap: 18px;
  transition: transform 0.22s ease;
}

.media-list-item:hover {
  transform: translateY(-2px);
}

.list-poster {
  width: 170px;
  min-width: 170px;
  aspect-ratio: 2 / 3;
  flex-shrink: 0;
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-fill-2) 88%, white 12%);
  border: 1px solid color-mix(in srgb, var(--color-neutral-3) 82%, white 18%);
  box-shadow:
    0 8px 20px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.media-list-item-landscape .list-poster {
  width: 280px;
  min-width: 280px;
  aspect-ratio: 16 / 9;
}

.list-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease;
}

.media-list-item:hover .list-poster img {
  transform: scale(1.03);
}

.list-poster .poster-placeholder {
  width: 100%;
  height: 100%;
  background: transparent;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.list-poster .poster-placeholder .iconfont {
  font-size: 24px;
  color: rgba(255, 255, 255, 0.82);
}

.list-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 6px 0;
}

.list-main {
  flex: 0 0 auto;
}

.list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.list-title-wrap {
  min-width: 0;
  flex: 1;
}

.list-title {
  font-size: 24px;
  font-weight: 800;
  margin: 0;
  color: var(--color-text-1);
  line-height: 1.32;
}

.list-overview {
  font-size: 14px;
  color: var(--color-text-2);
  margin: 0;
  line-height: 1.72;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

.list-overview.is-empty {
  color: var(--color-text-3);
}

.list-path {
  font-size: 13px;
  color: var(--color-text-3);
  margin: 6px 0 0;
  line-height: 1.5;
  word-break: break-all;
}

.list-episode {
  font-size: 13px;
  color: var(--color-text-3);
  margin: 6px 0 0;
  line-height: 1.4;
}

.list-progress {
  margin: 6px 0 0;
  color: var(--color-primary-6);
  font-size: 12px;
  font-weight: 600;
}

.list-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}

.list-meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary-light-4) 72%, white 28%);
  color: var(--color-primary-6);
  font-size: 12px;
  font-weight: 700;
}

.list-genres {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.genre-tag {
  background: var(--color-neutral-2);
  color: var(--color-text-2);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

[arco-theme='dark'] .search-panel {
  border-bottom-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(15, 20, 28, 0.96), rgba(15, 20, 28, 0.88));
}

[arco-theme='dark'] .search-panel-title,
[arco-theme='dark'] .search-result-section-title,
[arco-theme='dark'] .search-media-server-title,
[arco-theme='dark'] .library-result-bar-title,
[arco-theme='dark'] .search-media-server-result-title {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .library-arrow-back {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(24, 29, 40, 0.72);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
  color: rgba(244, 247, 252, 0.94);
}

[arco-theme='dark'] .library-arrow-back:hover {
  background: rgba(31, 39, 54, 0.84);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.3);
}

[arco-theme='dark'] .search-panel-input :deep(.arco-input-wrapper) {
  background: rgba(24, 28, 36, 0.74);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .search-panel-hint,
[arco-theme='dark'] .search-media-server-state,
[arco-theme='dark'] .search-media-server-result-year,
[arco-theme='dark'] .search-media-server-result-meta {
  color: rgba(191, 201, 216, 0.76);
}

[arco-theme='dark'] .search-media-server-panel {
  background: rgba(18, 22, 30, 0.92);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .playlist-card-context-menu {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(18, 22, 30, 0.96);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .playlist-card-context-item {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .playlist-card-context-item:hover {
  background: rgba(59, 130, 246, 0.18);
}

[arco-theme='dark'] .library-card-context-menu {
  background: rgba(24, 28, 36, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
}

[arco-theme='dark'] .library-card-context-item {
  color: rgba(238, 243, 250, 0.94);
}

[arco-theme='dark'] .library-card-context-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .library-card-context-item.danger {
  color: #fca5a5;
}

[arco-theme='dark'] .library-card-context-icon {
  color: rgba(238, 243, 250, 0.92);
}

[arco-theme='dark'] .library-card-context-divider {
  background: rgba(255, 255, 255, 0.12);
}

[arco-theme='dark'] .search-result-section-divider {
  border-top-color: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .search-result-section-title::after {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.16), transparent);
}

[arco-theme='dark'] .search-media-server-group {
  border-color: rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(28, 33, 44, 0.9), rgba(18, 22, 30, 0.82));
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .search-media-server-group + .search-media-server-group::before {
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.14), transparent);
}

[arco-theme='dark'] .search-media-server-group-title {
  color: rgba(244, 247, 252, 0.96);
  border-color: rgba(96, 165, 250, 0.2);
  background: rgba(37, 99, 235, 0.16);
}

[arco-theme='dark'] .search-media-server-group-title::before {
  background: #60a5fa;
  box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.18);
}

[arco-theme='dark'] .media-library :deep(.arco-btn) {
  background: linear-gradient(180deg, rgba(28, 32, 42, 0.96), rgba(20, 24, 33, 0.94));
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .media-library :deep(.arco-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.98);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .media-library :deep(.arco-btn.arco-btn-primary) {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.98);
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34);
}

[arco-theme='dark'] .search-media-server-result-poster {
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .search-media-grid .media-title {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .search-media-grid .media-year,
[arco-theme='dark'] .search-media-grid .media-genres,
[arco-theme='dark'] .search-media-grid .media-path,
[arco-theme='dark'] .search-media-grid .media-episode {
  color: rgba(203, 213, 225, 0.72);
}

[arco-theme='dark'] .search-media-grid .media-poster {
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .type-badge {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .poster-context-badge {
  background: rgba(15, 23, 42, 0.66);
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(244, 247, 252, 0.96);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
}

[arco-theme='dark'] .media-meta-type {
  background: rgba(96, 165, 250, 0.18);
  color: #dbeafe;
}

[arco-theme='dark'] .list-meta-chip {
  background: rgba(96, 165, 250, 0.14);
  color: rgba(219, 234, 254, 0.92);
}

[arco-theme='dark'] .genre-tag {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(203, 213, 225, 0.88);
}

[arco-theme='dark'] .search-media-server-result:hover {
  transform: translateY(-2px);
}

.library-home-page {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 20px 2px 2px;
}

.library-home-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.library-home-toolbar-spacer {
  flex: 1;
}

.library-home-toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.library-home-search {
  width: min(280px, 32vw);
}

.library-home-search :deep(.arco-input-wrapper) {
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
}

.library-home-search-empty {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  font-size: 13px;
}

.library-home-search-empty .iconfont {
  font-size: 28px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--app-mineradio-ink, #e8ecef);
  font-size: 12px;
  font-weight: 600;
  line-height: 36px;
  cursor: pointer;
  white-space: nowrap;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
}

.toolbar-btn:active {
  transform: scale(0.97);
}

.toolbar-btn .iconfont {
  font-size: 14px;
  opacity: 0.72;
}

.home-settings-menu {
  min-width: 320px;
  padding: 16px;
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 252, 247, 0.96), rgba(246, 240, 233, 0.9));
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow:
    0 22px 48px rgba(63, 46, 37, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(145%);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.home-settings-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.home-settings-title {
  font-size: 18px;
  font-weight: 800;
  color: rgba(15, 23, 42, 0.94);
}

.home-settings-subtitle {
  color: rgba(71, 85, 105, 0.9);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.home-settings-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.44);
}

.home-settings-group-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(71, 85, 105, 0.92);
}

.home-settings-check {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 0 2px;
  color: rgba(15, 23, 42, 0.92);
  font-size: 15px;
  font-weight: 700;
}

.home-settings-check :deep(.arco-checkbox) {
  flex: 0 0 auto;
}

.home-settings-check :deep(.arco-checkbox-label) {
  display: none;
}

.home-settings-label {
  flex: 0 0 108px;
  color: rgba(15, 23, 42, 0.92);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.home-settings-select {
  flex: 1;
}

.home-settings-select :deep(.arco-select-view) {
  min-height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(255, 255, 255, 0.74);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.home-settings-select :deep(.arco-select-view-value) {
  color: rgba(15, 23, 42, 0.92);
  font-weight: 700;
}

.home-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(24, 24, 24, 0.82);
  font-size: 14px;
  font-weight: 700;
}

.home-settings-dropdown {
  padding: 8px;
  border-radius: 28px;
  background: transparent;
  box-shadow: none;
}

.home-settings-dropdown .arco-dropdown-list-wrapper,
.home-settings-dropdown .arco-dropdown-list {
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.library-home-intro h3 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #111827;
}

.library-home-intro p {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
}

.library-home-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.library-home-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.library-home-section-header h4 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #111827;
}

.library-home-section-header span {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 13px;
}

.home-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
}

.home-section-header h4 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #111827;
}

.home-section-header span {
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.48;
  font-size: 12px;
  font-weight: 600;
  line-height: 30px;
}

.library-home-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 2px 8px 10px;
  scroll-padding-inline: 8px;
}

.library-home-resume-card,
.library-home-poster-tile,
.library-home-mini-card {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.library-home-resume-card {
  width: 320px;
}

.library-home-row-landscape .library-home-poster-tile {
  width: 320px;
}

.library-home-row-portrait .library-home-poster-tile {
  width: 150px;
}

.library-home-resume-poster,
.library-home-poster-image {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  background: linear-gradient(135deg, #dbeafe, #f8fafc);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
}

.library-home-resume-poster {
  width: 320px;
  height: 180px;
}

.library-home-poster-tile.poster-tile-landscape .library-home-poster-image {
  width: 320px;
  height: 180px;
}

.library-home-poster-tile.poster-tile-portrait .library-home-poster-image {
  width: 150px;
  height: 225px;
}

.library-home-resume-poster img,
.library-home-poster-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.library-home-resume-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.18) 0%, rgba(15, 23, 42, 0.06) 45%, rgba(15, 23, 42, 0.42) 100%);
}

.library-home-play-indicator {
  width: 62px;
  height: 62px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #111827;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
}

.library-home-play-indicator .iconfont {
  font-size: 30px;
  margin-left: 4px;
}

.library-home-poster-meta {
  padding: 10px 4px 0;
}

.library-home-poster-meta h5 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.library-home-poster-meta p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.library-home-row-category {
  padding-top: 6px;
}

.library-home-row-banner {
  padding-top: 2px;
}

/* CategoryCard on home page — fixed size for horizontal scroll */
.library-home-category-card {
  flex: 0 0 auto;
  width: 260px;
  min-height: 162px;
}

.library-home-mini-card {
  min-width: 260px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(22px) saturate(140%);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.library-home-mini-card:hover {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.24);
  box-shadow: 0 22px 42px rgba(96, 165, 250, 0.14);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(239, 246, 255, 0.86));
}

.library-home-mini-icon {
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(219, 234, 254, 0.74), rgba(191, 219, 254, 0.46));
  color: #2563eb;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
}

.library-home-mini-icon .iconfont {
  font-size: 24px;
}

.library-home-mini-main {
  flex: 1;
  min-width: 0;
}

.library-home-mini-main h5 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}

.library-home-mini-main p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.65;
}

.library-home-mini-count {
  flex: 0 0 auto;
  min-width: 40px;
  height: 40px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #111827;
  font-size: 15px;
  font-weight: 800;
}

.detail-media-modal :deep(.arco-modal-content) {
  border-radius: 28px;
  background:
    radial-gradient(circle at 72% 8%, rgba(0, 245, 212, 0.08), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36, 66, 255, 0.1), transparent 34%),
    var(--app-mineradio-bg, #08090b);
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 28px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.detail-media-modal :deep(.arco-modal-header) {
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06));
}

.detail-media-modal :deep(.arco-modal-title) {
  color: var(--app-mineradio-ink, #e8ecef);
}

.home-library-manager-panel {
  padding: 8px 4px 2px;
}

.home-library-manager-hint {
  margin: 0 0 14px 8px;
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.56;
  font-size: 14px;
  font-weight: 500;
}

.home-library-manager-list {
  padding: 8px 18px;
  border-radius: 16px;
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06));
  background: var(--app-glass-panel);
  min-height: 280px;
}

.home-library-manager-item {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.05));
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
  background: rgba(255, 255, 255, 0.04);
}

.home-library-manager-item :deep(.arco-checkbox) {
  flex: 1;
  min-width: 0;
}

.home-library-manager-item :deep(.arco-checkbox-label) {
  color: var(--app-mineradio-ink, #e8ecef);
  font-size: 15px;
  font-weight: 600;
}

.home-library-manager-drag-icon {
  flex: 0 0 auto;
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.32;
  font-size: 18px;
  cursor: grab;
  padding: 6px;
  border-radius: 8px;
  -webkit-user-drag: element;
  user-select: none;
}

.home-library-manager-drag-icon:hover {
  background: rgba(255, 255, 255, 0.06);
  opacity: 0.6;
}

.home-library-manager-drag-icon:active {
  cursor: grabbing;
}

.home-library-manager-empty {
  padding: 56px 12px;
  text-align: center;
  color: var(--app-mineradio-ink, #e8ecef);
  opacity: 0.32;
  font-size: 14px;
  font-weight: 600;
}

.home-library-manager-footer {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  width: 100%;
  margin-top: 18px;
}

[arco-theme='dark'] .library-home-intro h3,
[arco-theme='dark'] .library-home-section-header h4,
[arco-theme='dark'] .home-section-header h4,
[arco-theme='dark'] .library-home-poster-meta h5,
[arco-theme='dark'] .library-home-mini-main h5,
[arco-theme='dark'] .library-home-mini-count {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .library-home-intro p,
[arco-theme='dark'] .library-home-section-header span,
[arco-theme='dark'] .home-section-header span,
[arco-theme='dark'] .library-home-poster-meta p,
[arco-theme='dark'] .library-home-mini-main p {
  color: rgba(203, 213, 225, 0.78);
}


[arco-theme='dark'] .home-settings-menu {
  background:
    linear-gradient(180deg, rgba(24, 29, 40, 0.96), rgba(17, 21, 30, 0.92));
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 24px 52px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .home-settings-title,
[arco-theme='dark'] .home-settings-subtitle,
[arco-theme='dark'] .home-settings-group-title,
[arco-theme='dark'] .home-settings-check,
[arco-theme='dark'] .home-settings-label,
[arco-theme='dark'] .home-settings-row {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .home-settings-group {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] .home-settings-subtitle {
  color: rgba(148, 163, 184, 0.88);
}

[arco-theme='dark'] .home-settings-select :deep(.arco-select-view) {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

[arco-theme='dark'] .home-settings-select :deep(.arco-select-view-value),
[arco-theme='dark'] .home-settings-select :deep(.arco-select-view-icon) {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .library-home-mini-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(28, 33, 44, 0.88), rgba(18, 22, 30, 0.8));
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
}

[arco-theme='dark'] .library-home-mini-card:hover {
  border-color: rgba(96, 165, 250, 0.26);
  background: linear-gradient(180deg, rgba(35, 45, 68, 0.92), rgba(20, 27, 42, 0.86));
  box-shadow: 0 24px 44px rgba(0, 0, 0, 0.28);
}

[arco-theme='dark'] .library-home-mini-icon {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.26), rgba(30, 64, 175, 0.18));
  color: #bfdbfe;
}

[arco-theme='dark'] .library-home-mini-count {
  background: rgba(255, 255, 255, 0.08);
}

/* 分类聚合视图样式 */
.category-view {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
  padding: 22px 24px 28px;
}

/* 分类列表视图 - 横向卡片样式 */
.category-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.category-list-card {
  position: relative;
  height: 140px;
  border-radius: 16px;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.category-list-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
}

.category-list-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    0deg,
    rgba(12, 14, 18, 0.78) 0%,
    rgba(12, 14, 18, 0.28) 55%,
    rgba(12, 14, 18, 0.08) 100%
  );
  transition: opacity 0.3s ease;
}

.category-list-card:hover .category-list-overlay {
  opacity: 0.88;
}

.category-list-content {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 18px 20px;
  color: white;
  z-index: 2;
}

.category-list-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  line-height: 1.2;
  letter-spacing: -0.2px;
}

.category-list-count {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.9);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.playlist-card-context-menu {
  min-width: 160px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.14);
  backdrop-filter: blur(14px);
}

.playlist-card-context-item {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 10px 12px;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.playlist-card-context-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.playlist-card-context-icon {
  color: #2563eb;
  font-size: 15px;
  line-height: 1;
}

.library-card-context-menu {
  min-width: 184px;
  padding: 7px;
  border-radius: 18px;
  background: rgba(250, 246, 239, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 18px 42px rgba(45, 35, 25, 0.2);
  backdrop-filter: blur(22px) saturate(145%);
}

.library-card-context-item {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgba(24, 24, 24, 0.92);
  font-size: 16px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.library-card-context-item:hover {
  background: rgba(255, 255, 255, 0.48);
}

.library-card-context-item.danger {
  color: #b91c1c;
}

.ai-pro-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 14px;
  padding: 0 5px;
  margin-left: 4px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f59e0b, #f97316);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  line-height: 14px;
  vertical-align: middle;
}

.library-card-context-icon {
  width: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 19px;
  color: rgba(18, 18, 18, 0.9);
}

:deep(.library-context-popup .arco-dropdown-list-wrapper) {
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}

:deep(.library-context-popup .arco-dropdown-option) {
  padding: 0;
  line-height: normal;
}

.library-card-context-divider {
  height: 1px;
  margin: 6px 8px;
  background: rgba(24, 24, 24, 0.12);
}

/* 响应式样式 */
@media (max-width: 768px) {
  .media-grid.media-grid-portrait,
  .media-grid.media-grid-landscape {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .category-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .library-home-resume-card,
  .library-home-row-landscape .library-home-poster-tile {
    width: 280px;
  }

  .library-home-resume-poster,
  .library-home-poster-tile.poster-tile-landscape .library-home-poster-image {
    width: 280px;
    height: 158px;
  }

  .library-home-mini-card {
    min-width: 220px;
  }

  .category-list-card {
    height: 100px;
  }

  .category-list-content {
    padding: 16px 20px;
  }

  .category-list-title {
    font-size: 20px;
  }

  .category-list-count {
    top: 16px;
    right: 20px;
    padding: 6px 12px;
    font-size: 13px;
  }

  .library-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .library-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .library-filters {
    width: 100%;
    justify-content: flex-start;
  }

  .view-toggle-pill {
    align-self: flex-start;
  }

  /* 移动端列表视图调整 */
  .media-list-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .list-poster {
    width: 100%;
    min-width: 0;
    margin-bottom: 0;
  }

  .media-list-item-landscape .list-poster {
    width: 100%;
    min-width: 0;
  }

  .list-overview {
    display: none; /* 移动端隐藏简介 */
  }

  .list-meta {
    flex-wrap: wrap;
    gap: 8px;
  }
}

</style>

<style>
/* 媒体管理弹窗 — 非 scoped，覆盖 Arco Design portal 渲染的 modal 样式 */
body[arco-theme='dark'] .detail-media-modal .arco-modal,
body[arco-theme='dark'] .detail-media-modal .arco-modal-content {
  background:
    radial-gradient(circle at 72% 8%, rgba(0, 245, 212, 0.08), transparent 28%),
    radial-gradient(circle at 12% 72%, rgba(36, 66, 255, 0.1), transparent 34%),
    var(--app-mineradio-bg, #08090b) !important;
  border-color: var(--app-glass-line, rgba(255, 255, 255, 0.08)) !important;
}

body[arco-theme='dark'] .detail-media-modal .arco-modal-header {
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06)) !important;
}

body[arco-theme='dark'] .detail-media-modal .arco-modal-title {
  color: var(--app-mineradio-ink, #e8ecef) !important;
}

body:not([arco-theme='dark']) #xbybody .media-library {
  --app-mineradio-ink: rgba(17, 24, 39, 0.94);
  --app-glass-panel: rgba(255, 255, 255, 0.72);
  --app-glass-line: rgba(15, 23, 42, 0.08);
}

body:not([arco-theme='dark']) #xbybody .media-library .toolbar-btn,
body:not([arco-theme='dark']) #xbybody .media-library .library-arrow-back,
body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-pill {
  color: rgba(17, 24, 39, 0.88) !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
  background: rgba(255, 255, 255, 0.66) !important;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.72) !important;
}

body:not([arco-theme='dark']) #xbybody .media-library .toolbar-btn:hover,
body:not([arco-theme='dark']) #xbybody .media-library .library-arrow-back:hover {
  color: rgba(17, 24, 39, 0.96) !important;
  border-color: rgba(15, 23, 42, 0.12) !important;
  background: rgba(255, 255, 255, 0.84) !important;
}

body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-seg {
  color: rgba(17, 24, 39, 0.54) !important;
  background: transparent !important;
  box-shadow: none !important;
}

body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-seg:hover,
body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-seg.active {
  color: rgba(17, 24, 39, 0.94) !important;
  background: rgba(15, 23, 42, 0.08) !important;
}

body:not([arco-theme='dark']) #xbybody .media-library .toolbar-btn .iconfont,
body:not([arco-theme='dark']) #xbybody .media-library .library-arrow-back .iconfont,
body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-seg .iconfont {
  color: currentColor !important;
  opacity: 0.82 !important;
  text-shadow: none !important;
}

body:not([arco-theme='dark']) #xbybody .media-library .view-toggle-divider {
  background: rgba(15, 23, 42, 0.1) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .arco-modal,
body:not([arco-theme='dark']) .detail-media-modal .arco-modal-content {
  color: rgba(17, 24, 39, 0.94) !important;
  border: 1px solid rgba(15, 23, 42, 0.08) !important;
  background: rgba(255, 255, 255, 0.88) !important;
  box-shadow: 0 28px 60px rgba(15, 23, 42, 0.14) !important;
  backdrop-filter: blur(24px) saturate(1.2) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.2) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .arco-modal-header {
  border-bottom: 1px solid rgba(15, 23, 42, 0.08) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .arco-modal-title {
  color: rgba(17, 24, 39, 0.94) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .home-library-manager-hint {
  color: rgba(31, 41, 55, 0.76) !important;
  opacity: 1 !important;
}

body:not([arco-theme='dark']) .detail-media-modal .home-library-manager-list {
  color: rgba(17, 24, 39, 0.94) !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
  background: rgba(255, 255, 255, 0.72) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .home-library-manager-item .arco-checkbox-label,
body:not([arco-theme='dark']) .detail-media-modal .home-library-manager-empty {
  color: rgba(17, 24, 39, 0.92) !important;
  opacity: 1 !important;
}

body:not([arco-theme='dark']) .detail-media-modal .home-library-manager-drag-icon {
  color: rgba(17, 24, 39, 0.54) !important;
  opacity: 1 !important;
}

.manual-metadata-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
</style>
