<template>
  <div class="media-library" :class="{ 'unified-category': props.unifiedBrowse, 'unified-folder': props.unifiedFiles }">
    <!-- 内容区域 -->
    <div class="library-content">
      <div v-if="mediaStore.isScanning && !showingDetail" class="library-scan-status">
        <MediaLoadingIndicator :size="16" />
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
        v-if="currentMediaItem"
        v-show="showingDetail"
        :media-item="currentMediaItem"
        :active-playlist-name="selectedPlaylist"
        :playlist-items="activePlaylistItems"
        @open-playlist-item="openMedia"
        @ai-rescrape="handleManualAIScrape"
        @back="handleDetailBack"
        @metadata-updated="handleMetadataUpdated"
        @tag-click="handleDetailTagClick"
      />

      <!-- 显示媒体库内容 -->
      <template v-if="!showingDetail && showSearchResults">
      <div
        v-if="isSearchView"
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
                    <WatchedIndicator v-if="!isContinueWatchingView" corner :watched="isMediaWatched(item, mediaStore.watchedItems)" />
                    <PosterRatingBadge :rating="item.rating" />
                    <img
                      v-if="item.posterUrl"
                      :src="item.posterUrl"
                      :alt="item.name"
                      @error="handleImageError"
                    />
                    <div v-else class="poster-placeholder">
                      <MediaPosterPlaceholder :kind="isContinueWatchingView ? 'resume' : 'film'" />
                    </div>

                    <div v-if="isContinueWatchingView && item.watchProgress !== undefined" class="watch-progress">
                      <div
                        class="watch-progress-bar"
                        :style="{ width: `${Math.round((item.watchProgress || 0) * 100)}%` }"
                      ></div>
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
                      <span v-if="!selectedPlaylist && getEpisodeTitleSuffix(item)" class="episode-suffix">
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
                    <WatchedIndicator v-if="!isContinueWatchingView" corner :watched="isMediaWatched(item, mediaStore.watchedItems)" />
                    <PosterRatingBadge :rating="item.rating" />
                    <img
                      v-if="item.posterUrl"
                      :src="item.posterUrl"
                      :alt="item.name"
                      @error="handleImageError"
                    />
                    <div v-else class="poster-placeholder">
                      <MediaPosterPlaceholder :kind="isContinueWatchingView ? 'resume' : 'film'" />
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
                      <div class="list-meta">
                        <span v-if="item.rating != null" class="list-rating"><IconFont name="iconstar" />{{ item.rating.toFixed(1) }}</span>
                        <span v-if="item.year">{{ item.year }}</span>
                        <span v-if="item.certification">{{ item.certification }}</span>
                      </div>
                      <p v-if="item.overview" class="list-overview">
                        {{ item.overview }}
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

                    <WatchedIndicator :watched="isMediaWatched(item, mediaStore.watchedItems)" @toggle="toggleLocalMediaWatched(item)" />
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
                <MediaLoadingIndicator />
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
                        <div class="media-card-placeholder media-image-placeholder"><MediaPosterPlaceholder /></div>
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
        <div v-if="!props.unifiedFiles" class="folder-header">
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
          <MediaPanRight :unified-files="props.unifiedFiles" :favorite-browse="favoriteBrowse" :browse-mode="props.browseMode" :browse-selection="effectiveBrowseSelection" :descending="props.folderDescending" @open-media="openMedia" @enter-folder="handleEnterFolder" @file-action="handleBrowserFileAction" />
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
          <MediaEmptyFolder />
        </div>
      </div>

      <!-- 分类聚合视图 -->
      <div v-else-if="showCategoryView" class="category-view">
        <div class="category-list">
          <div
            v-for="item in categoryItems"
            :key="`${item.type}-${item.name}`"
            class="category-list-card"
            role="button" tabindex="0"
            @keydown.enter="handleCategoryClick({ name: item.name, type: item.type, count: item.count })"
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
        <MediaEmptyFolder />
      </div>

      <!-- 媒体内容 -->
      <div v-else :class="['media-container', viewMode, `poster-${posterType}`]">
        <div v-if="localSelection" class="poster-selection-bar"><span>{{ t('posterMenu.selectedCount', { count: selectedBrowseIds.length }) }}</span><button @click="localSelection = false; selectedBrowseIds = []">{{ t('common.cancel') }}</button></div>
        <div v-if="props.unifiedBrowse && pagedItems.every(item => localFileForMedia(item))" class="local-file-collection" :class="{ 'local-file-collection-list': viewMode === 'list' }">
          <LocalMediaFileCard portrait-list v-for="item in pagedItems" :key="item.id" :name="localFileForMedia(item)!.name" :path="localFileForMedia(item)!.path" :thumbnail="localFileForMedia(item)!.thumbnailLink" :duration="localFileForMedia(item)!.videoDuration" :height="localFileForMedia(item)!.height" :mode="viewMode" :selection="effectiveBrowseSelection" :selected="selectedBrowseIds.includes(item.id)" :watched="isMediaWatched(item, mediaStore.watchedItems)" @open="handleBrowseClick(item)" @watched="toggleLocalMediaWatched(item)" @context="openContextMenu($event, item)" />
        </div>
        <!-- 网格视图 -->
        <div v-else-if="viewMode === 'grid'" class="media-grid" :class="`media-grid-${posterType}`">
          <template v-for="item in pagedItems" :key="item.id">
          <LocalMediaFileCard portrait-list v-if="props.unifiedBrowse && localFileForMedia(item)" :name="localFileForMedia(item)!.name" :path="localFileForMedia(item)!.path" :thumbnail="localFileForMedia(item)!.thumbnailLink" :duration="localFileForMedia(item)!.videoDuration" :height="localFileForMedia(item)!.height" :mode="viewMode" :selection="effectiveBrowseSelection" :selected="selectedBrowseIds.includes(item.id)" :watched="isMediaWatched(item, mediaStore.watchedItems)" @open="handleBrowseClick(item)" @watched="toggleLocalMediaWatched(item)" @context="openContextMenu($event, item)" />
          <div v-else
            class="media-item"
            :class="`media-item-${posterType}`"
            :data-selected="selectedBrowseIds.includes(item.id)"
            @click="handleBrowseClick(item)"
            @contextmenu.prevent="openContextMenu($event, item)"
          >
            <div class="media-poster" :class="{ 'has-image': !!getItemDisplayImage(item) }">
              <WatchedIndicator v-if="!isContinueWatchingView" corner :watched="isMediaWatched(item, mediaStore.watchedItems)" />
              <PosterRatingBadge :rating="item.rating" />
              <img
                v-if="getItemDisplayImage(item)"
                :src="getItemDisplayImage(item)"
                :alt="item.name"
                @load="handlePosterLoad"
                @error="handleImageError"
              />
              <div class="poster-placeholder">
                <MediaPosterPlaceholder :kind="isContinueWatchingView ? 'resume' : 'film'" />
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
              <div v-if="playlistEpisodeLabel(item) || item.year" class="media-meta media-meta--minimal">
                <span class="media-meta-year">{{ playlistEpisodeLabel(item) || item.year }}</span>
              </div>
              <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="media-path" :title="getUnmatchedPath(item)">
                {{ getUnmatchedPath(item) }}
              </p>
              <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="media-episode">
                {{ item.continueEpisodeLabel }}
              </p>
            </div>
          </div>
          </template>
        </div>

        <!-- 列表视图 -->
        <div v-else-if="viewMode === 'list'" class="media-list">
          <template v-for="item in pagedItems" :key="item.id">
          <LocalMediaFileCard portrait-list v-if="props.unifiedBrowse && localFileForMedia(item)" :name="localFileForMedia(item)!.name" :path="localFileForMedia(item)!.path" :thumbnail="localFileForMedia(item)!.thumbnailLink" :duration="localFileForMedia(item)!.videoDuration" :height="localFileForMedia(item)!.height" :mode="viewMode" :selection="effectiveBrowseSelection" :selected="selectedBrowseIds.includes(item.id)" :watched="isMediaWatched(item, mediaStore.watchedItems)" @open="handleBrowseClick(item)" @watched="toggleLocalMediaWatched(item)" @context="openContextMenu($event, item)" />
          <div v-else
            class="media-list-item"
            :class="`media-list-item-${posterType}`"
            :data-selected="selectedBrowseIds.includes(item.id)"
            @click="handleBrowseClick(item)"
            @contextmenu.prevent="openContextMenu($event, item)"
            @dragover.prevent="selectedPlaylist && ($event.dataTransfer!.dropEffect = 'move')"
            @drop.stop.prevent="dropPlaylistItem($event, item.id)"
          >
            <button v-if="selectedPlaylist" type="button" class="playlist-drag-handle" draggable="true"
              aria-label="排序" @click.stop @dragstart.stop="startPlaylistDrag($event, item.id)">☰</button>
            <div
              class="list-poster"
              :class="{ 'has-image': !!getItemDisplayImage(item) }"
            >
              <WatchedIndicator v-if="!isContinueWatchingView" corner :watched="isMediaWatched(item, mediaStore.watchedItems)" />
              <PosterRatingBadge :rating="item.rating" />
              <img
                v-if="getItemDisplayImage(item)"
                :src="getItemDisplayImage(item)"
                :alt="item.name"
                @load="handlePosterLoad"
                @error="handleImageError"
              />
              <div class="poster-placeholder">
                <MediaPosterPlaceholder :kind="isContinueWatchingView ? 'resume' : 'film'" />
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
                    {{ selectedPlaylist ? playlistListTitle(item) : item.name }}
                    <span v-if="!selectedPlaylist && getEpisodeTitleSuffix(item)" class="episode-suffix">
                      {{ getEpisodeTitleSuffix(item) }}
                    </span>
                  </h3>
                </div>
              </div>

              <div v-if="props.unifiedBrowse" class="list-meta unified-list-meta">
                <span v-if="item.rating != null" class="list-rating"><IconFont name="iconstar" />{{ item.rating.toFixed(1) }}</span>
                <span v-if="item.year">{{ item.year }}</span>
                <span v-if="item.certification" class="list-certification">{{ item.certification }}</span>
              </div>
              <div v-else-if="getItemMetaItems(item).length" class="list-meta">
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
                  {{ (props.unifiedBrowse ? item.overview : getItemOverview(item)) || t('mediaServer.noOverview') }}
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

              <WatchedIndicator :watched="isMediaWatched(item, mediaStore.watchedItems)" @toggle="toggleLocalMediaWatched(item)" />
              <div v-if="!props.unifiedBrowse && item.genres.length" class="list-genres">
                <span v-for="genre in item.genres.slice(0, 5)" :key="genre" class="genre-tag">
                  {{ genre }}
                </span>
              </div>
            </div>
          </div>
          </template>
        </div>
        <div v-if="pagedItems.length < pagedTotal" class="media-library-load-more">
          <a-button :loading="isLoadingPage" @click="loadNextPage">加载更多</a-button>
        </div>
      </div>
      </template>
    </div>

    <a-modal :visible="!!pendingFavoriteFolder" :title="t('unified.addToFavorites')" @ok="saveBrowserFolderFavorite" @cancel="pendingFavoriteFolder = undefined">
      <a-form layout="vertical"><a-form-item :label="t('mediaLibrary.folderName')"><a-input v-model="folderFavoriteName" :placeholder="t('mediaLibrary.libraryNamePlaceholder')" @press-enter="saveBrowserFolderFavorite" /></a-form-item></a-form>
    </a-modal>

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
    <a-trigger
      popup-class="library-context-popup"
      :popup-visible="showContextMenu"
      auto-fit-position
      @popup-visible-change="(visible: boolean) => { if (!visible) handleContextMenuClose() }"
    >
      <div :style="contextMenuStyle" style="width: 1px; height: 1px; visibility: hidden;" />
      <template #content>
        <MediaPosterMenu :tv="contextMenuItem?.type === 'tv'" :playlist-item="!!selectedPlaylist" :continuing="contextMenuInContinueWatching" :watched="contextMenuIsWatched" :disabled="contextMenuItem && downloadableMediaFiles(contextMenuItem).length ? [] : ['download']" @action="handlePosterAction" />
      </template>
    </a-trigger>
    <MediaCollectionPicker
      :visible="playlistVisible"
      heading="播放列表"
      :item-title="playlistTargetTitle"
      :rows="playlistRows"
      :editing="playlistEditing"
      v-model:name="playlistTitle"
      :error="playlistError"
      removable
      hint="选择播放列表，点击完成保存；取消不会修改当前条目的归属。"
      @close="playlistVisible = false"
      @done="savePlaylistSelection"
      @create="startPlaylistName()"
      @rename="startPlaylistName"
      @toggle="togglePlaylistSelection"
      @remove="removePlaylist"
      @cancel-name="playlistEditing = null; playlistError = ''"
      @confirm-name="confirmPlaylistName"
    />
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
import { MediaScanner } from '../utils/mediaScanner'
import { isFileSourceRoot } from '../utils/fileSourceRoots'
import { playbackVersions } from '../utils/seriesVersionPreferences'
import { openMediaShare } from '../utils/mediaShare'
import { openPersonalRating } from '../utils/mediaPersonalRating'
import { Modal } from '@arco-design/web-vue'
import MediaPosterPlaceholder from './MediaPosterPlaceholder.vue'
import MediaLoadingIndicator from './MediaLoadingIndicator.vue'
import MediaEmptyFolder from './MediaEmptyFolder.vue'
import { compareMediaBrowseValues, nextMediaBrowseSort, type MediaBrowseSort } from '../utils/mediaBrowseSort'
import { ref, computed, onMounted, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useMediaLibraryStore } from '../store/medialibrary'
import DB from '../utils/db'
import { useAppStore } from '../store'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import useMediaServerNavigationStore from '../store/mediaServerNavigation'
import { openCustomSeries } from '../utils/customMediaSeries'
import MediaPosterMenu from './MediaPosterMenu.vue'
import type { PosterAction } from '../utils/mediaPosterMenu'
import LocalMediaFileCard from './LocalMediaFileCard.vue'
import WatchedIndicator from './WatchedIndicator.vue'
import { useLibraryBrowseMode } from '../store/libraryBrowseMode'
import PosterRatingBadge from './PosterRatingBadge.vue'
import { isMediaWatched, localWatchedKeys, setMediaWatched } from '../utils/localWatchedState'
import MediaPanRight from './MediaPanRight.vue'
import { useMediaPanFileStore, useMediaPanTreeStore } from './stores'
import CategoryCard from './CategoryCard.vue'
import MediaDetail from './MediaDetail.vue'
import MediaCollectionPicker from './MediaCollectionPicker.vue'
import { isContinueWatchingMember, toggleContinueWatching } from '../utils/continueWatchingAction'
import { applyPlaylistSelection, playlistEntryIds } from '../utils/detailCollections'
import { tmdbImageUrl } from '../utils/tmdb'
import { matchesMediaPerson } from '../utils/mediaPersonFilter'
import MediaMetadataEditorModal from './MediaMetadataEditorModal.vue'
import type { MediaLibraryItem } from '../types/media'
import type { DriveFileItem } from '../types/media'
import type { MediaServerLibraryNode } from '../types/mediaServerContent'
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
import DownDAL from '../down/DownDAL'
import useSettingStore from '../setting/settingstore'
import { refreshMediaMetadata } from '../utils/mediaMetadataRefresh'
import { manualAIScrapeItems } from '../utils/mediaAIScrape'
import { mediaDriveFileKey } from '../utils/mediaSourceMembership'
import { getMediaCoverage } from '../utils/mediaCoverage'
import { t } from '../i18n'
import { appIconUrl } from '../utils/appAssets'
import { hasLocalMedia } from '../utils/unifiedMediaScope'

type MediaListItem = MediaLibraryItem & {
  continueEpisodeLabel?: string
}

const props = withDefaults(defineProps<{
  activeCategory?: string
  selectedFolder?: any
  selectedGenre?: string
  selectedYear?: string
  selectedRating?: string
  searchQuery?: string
  fromHomeNavigation?: boolean
  unifiedBrowse?: boolean
  unifiedFiles?: boolean
  folderDescending?: boolean
  browseMode?: 'grid' | 'list'
  localOnly?: boolean
  browseSort?: MediaBrowseSort
  browseSortDescending?: boolean
  browseSelection?: boolean
}>(), { browseSortDescending: undefined })
const localSelection = ref(false)
const effectiveBrowseSelection = computed(() => props.browseSelection || localSelection.value)
const playlistVisible = ref(false)
const playlistTargetId = ref('')
const playlistTargetIds = ref<string[]>([])
const playlistTargetTitle = ref('')
const playlistTitle = ref('')
const playlistError = ref('')
const playlistEditing = ref<string | null>(null)
const selectedPlaylists = ref<string[]>([])
const playlistRows = computed(() => Object.entries(mediaStore.playlists).map(([name, ids]) => ({ id: name, title: name, count: ids.length, selected: selectedPlaylists.value.includes(name) })))
function showPlaylistPicker() {
  if (!contextMenuItem.value) return
  playlistTargetId.value = contextMenuItem.value.id
  playlistTargetTitle.value = contextMenuItem.value.name
  playlistTargetIds.value = playlistEntryIds(contextMenuItem.value)
  selectedPlaylists.value = Object.keys(mediaStore.playlists).filter(name => playlistTargetIds.value.length > 0 && playlistTargetIds.value.every(id => mediaStore.playlists[name].includes(id)))
  playlistEditing.value = null
  playlistTitle.value = ''
  playlistError.value = ''
  playlistVisible.value = true
  handleContextMenuClose()
}
function savePlaylistSelection() {
  mediaStore.playlists = applyPlaylistSelection(mediaStore.playlists, playlistTargetId.value, selectedPlaylists.value,
    playlistTargetIds.value)
  playlistVisible.value = false
}
function startPlaylistName(name = '') {
  playlistEditing.value = name
  playlistTitle.value = name
  playlistError.value = ''
}
function confirmPlaylistName() {
  const name = playlistTitle.value.trim(), oldName = playlistEditing.value
  if (!name || oldName === null) return
  if (Object.keys(mediaStore.playlists).some(existing => existing.toLocaleLowerCase() === name.toLocaleLowerCase() && existing !== oldName)) {
    playlistError.value = t('posterMenu.duplicatePlaylist')
    return
  }
  if (oldName) {
    mediaStore.renamePlaylist(oldName, name)
    selectedPlaylists.value = selectedPlaylists.value.map(selected => selected === oldName ? name : selected)
  } else mediaStore.addPlaylist(name)
  playlistEditing.value = null
}
function togglePlaylistSelection(name: string) {
  selectedPlaylists.value = selectedPlaylists.value.includes(name) ? selectedPlaylists.value.filter(selected => selected !== name) : [...selectedPlaylists.value, name]
}
function removePlaylist(name: string) {
  mediaStore.removePlaylist(name)
  selectedPlaylists.value = selectedPlaylists.value.filter(selected => selected !== name)
}
const selectedBrowseIds = ref<string[]>([])
const handleBrowseClick = (item: MediaLibraryItem) => {
  if (!effectiveBrowseSelection.value) {
    openMedia(item); return
  }
  const index = selectedBrowseIds.value.indexOf(item.id)
  if (index < 0) selectedBrowseIds.value.push(item.id)
  else selectedBrowseIds.value.splice(index, 1)
}

const mediaStore = useMediaLibraryStore()
const appStore = useAppStore()
const mediaServerRegistry = useMediaServerRegistryStore()
const mediaServerNavigation = useMediaServerNavigationStore()
const mediaPanFileStore = useMediaPanFileStore()
const mediaPanTreeStore = useMediaPanTreeStore()

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
const selectedGenre = ref(props.selectedGenre || '')
const selectedYear = ref(props.selectedYear || '')
const selectedRating = ref(props.selectedRating || '')
const selectedCast = ref('')
const selectedPersonId = ref<number>()
const selectedCountry = ref('')
const selectedPlaylist = ref('')
const localSearchQuery = ref(props.searchQuery || '')
const viewMode = useLibraryBrowseMode()
const posterType = ref<'portrait' | 'landscape'>('portrait')
watch(() => props.browseMode, mode => { if (mode) viewMode.value = mode }, { immediate: true })
const showingDetail = ref(false)
const currentMediaItem = ref<MediaLibraryItem>()
let restoreDetailFilters: (() => void) | undefined
function returnToTagDetail() {
  if (!restoreDetailFilters || !currentMediaItem.value) return false
  restoreDetailFilters()
  restoreDetailFilters = undefined
  emit('tagTitleChange', '')
  showingDetail.value = true
  return true
}
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


// 文件夹文件列表
const folderFileList = ref<any[]>([])
// A saved favorite browses as a poster library (folders and videos only); opening a drive itself is file browsing.
const favoriteBrowse = computed(() => {
  const root = folderNavigationStack.value[0] || currentFolderInfo.value
  const id = String(root?.id || '')
  if (!props.unifiedFiles || !id || id.startsWith('account:') || id.startsWith('webdav:')) return false
  return mediaStore.folders.some(folder => folder.id === id && folder.isFavorite !== false)
})
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
    restoreDetailFilters = undefined
    if (!showingDetail.value) currentMediaItem.value = undefined
    selectedYear.value = props.selectedYear || ''
    selectedRating.value = props.selectedRating || ''
    selectedCast.value = ''
    selectedPersonId.value = undefined
    selectedCountry.value = ''
    emit('tagTitleChange', '')
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
  const category = selectedCast.value ? 'all' : props.activeCategory || activeTab.value
  const selectedGenreValue = selectedGenre.value
  const selectedYearValue = selectedYear.value
  const selectedRatingValue = selectedRating.value
  const topRatedIds = selectedRatingValue === 'top30'
    ? new Set(currentCategorySourceItems.value
        .filter(item => Number(item.rating) > 0 && Number(item.rating) <= 10)
        .sort((a, b) => Number(b.rating) - Number(a.rating))
        .slice(0, 30)
        .map(item => item.id))
    : undefined
  const query = (localSearchQuery.value || '').trim().toLowerCase()
  const watchedIds = mediaStore.watchedItems
  const type: MediaLibraryItem['type'] | undefined = category === 'movies' ? 'movie' : ['tv', 'tv-shows'].includes(category) ? 'tv' : category === 'unmatched' ? 'unmatched' : undefined
  const predicate = (item: MediaLibraryItem) => {
    if (props.localOnly && !hasLocalMedia(item)) return false
    if (category === 'documentary' && !item.genres.some(genre => String(genre).toLowerCase() === '99' || String(genre).includes('纪录'))) return false
    if (category === 'animation' && !item.genres.some(genre => String(genre).toLowerCase() === '16' || String(genre).includes('动画') || String(genre).includes('动漫'))) return false
    if (category === 'unwatched' && isMediaWatched(item, watchedIds)) return false
    if (selectedGenreValue && !item.genres.includes(selectedGenreValue)) return false
    if (selectedYearValue) {
      const year = Number(item.year || 0)
      const decade = selectedYearValue.match(/^(\d{4})s$/i)
      if (decade ? year < Number(decade[1]) || year > Number(decade[1]) + 9 : year !== Number(selectedYearValue)) return false
    }
    if (selectedRatingValue) {
      if (topRatedIds) {
        if (!topRatedIds.has(item.id)) return false
      } else {
        const [min, max] = selectedRatingValue.split('-').map(Number)
        if (!item.rating || item.rating < min || item.rating > max) return false
      }
    }
    if (selectedCast.value && !matchesMediaPerson(item, selectedCast.value, selectedPersonId.value)) return false
    if (selectedCountry.value && !(item.productionCountries || []).some(country => country.toLowerCase().includes(selectedCountry.value.toLowerCase()))) return false
    return !query || item.name?.toLowerCase().includes(query)
  }
  return { category, type, predicate }
}

const loadMediaPage = async (reset = false) => {
  if (!selectedCast.value && props.selectedFolder && folderFileList.value.length > 0) {
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
    if (props.browseSort && !(category === 'playlist' && selectedPlaylist.value && props.browseSort === 'addedAt')) matched.sort(compareBrowseItems)
    pagedTotal.value = matched.length
    pagedItems.value = reset ? matched.slice(0, MEDIA_PAGE_SIZE) : [...pagedItems.value, ...matched.slice(pagedItems.value.length, pagedItems.value.length + MEDIA_PAGE_SIZE)]
    return
  }
  isLoadingPage.value = true
  try {
    const offset = reset ? 0 : pagedItems.value.length
    const [items, total] = await Promise.all([
      DB.getMediaLibraryPage({ offset, limit: MEDIA_PAGE_SIZE, type, predicate, sort: props.browseSort ? compareBrowseItems : undefined }),
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
watch(() => [props.browseSort, props.browseSortDescending], () => void loadMediaPage(true))
watch(() => props.browseSelection, () => { localSelection.value = false; selectedBrowseIds.value = [] })
watch(() => props.localOnly, () => void loadMediaPage(true))

watch(
  () => [props.activeCategory, props.selectedFolder?.id, props.selectedGenre, props.selectedYear, props.selectedRating, selectedGenre.value, selectedYear.value, selectedRating.value, activeTab.value, selectedPlaylist.value, selectedCast.value, selectedCountry.value, localSearchQuery.value, mediaStore.watchedItems.join('\n'), mediaStore.favorites.join('\n'), mediaStore.recentlyAdded.length, mediaStore.isScanning],
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
  if (isSearchView.value || props.selectedFolder) return false
  return true
})
const showResultBackBar = computed(() => showDrillDownBackBar.value || showPlaylistBackBar.value)
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

const showPlaylistView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'playlist' && !props.selectedFolder && !selectedPlaylist.value
})

const isContinueWatchingView = computed(() => {
  const category = props.activeCategory || activeTab.value
  return category === 'continue-watching' || category === 'continue'
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

const unwatchedItems = computed(() => mediaStore.mediaItems.filter(item => !isMediaWatched(item, mediaStore.watchedItems)))

const favoriteItems = computed(() => mediaStore.favorites
  .map(favoriteIdToMediaItem)
  .filter((item): item is MediaLibraryItem => Boolean(item)))

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

type CategoryGroup = { name: string; count: number; type: 'genre' | 'rating' | 'year'; items: MediaLibraryItem[]; range?: number[] }
const getCategoryGroups = (category: string): CategoryGroup[] => {
  const sourceItems = props.localOnly ? currentCategorySourceItems.value.filter(hasLocalMedia) : currentCategorySourceItems.value

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
      const topRated = sourceItems
        .filter(item => Number(item.rating) > 0 && Number(item.rating) <= 10)
        .sort((a, b) => Number(b.rating) - Number(a.rating))
        .slice(0, 30)
      const categories = [
        { range: [8, 10], label: t('aggregation.rating8To10'), items: [] as MediaLibraryItem[] },
        { range: [7, 7.99], label: t('home.ratingStars', { count: 7 }), items: [] as MediaLibraryItem[] },
        { range: [6, 6.99], label: t('home.ratingStars', { count: 6 }), items: [] as MediaLibraryItem[] },
        { range: [5, 5.99], label: t('home.ratingStars', { count: 5 }), items: [] as MediaLibraryItem[] },
        { range: [1, 4.99], label: t('aggregation.rating1To4'), items: [] as MediaLibraryItem[] }
      ]
      sourceItems.forEach(item => {
        const rating = item.rating == null ? NaN : Number(item.rating)
        if (Number.isNaN(rating) || rating <= 0 || rating > 10) return
        const group = categories.find(c => rating >= c.range[0] && rating <= c.range[1])
        if (group) group.items.push(item)
      })
      return [{
        name: t('aggregation.top30'),
        count: topRated.length,
        type: 'rating' as const,
        items: topRated
      }, ...categories
        .filter(c => c.items.length > 0)
        .map(c => ({
          name: c.label,
          count: c.items.length,
          type: 'rating' as const,
          range: c.range,
          items: c.items
        }))]
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
}
const categoryItems = computed(() => {
  const category = props.activeCategory || activeTab.value
  const items = props.unifiedBrowse && category === 'genres'
    ? ['genres', 'years', 'ratings'].flatMap(getCategoryGroups)
    : getCategoryGroups(category)
  if (!props.unifiedBrowse) return items
  const values = (group: typeof items[number]) => ({ title: group.name, fileName: group.name,
    addedAt: Math.max(0, ...group.items.map(item => new Date(item.addedAt || 0).getTime() || 0)),
    premiereDate: String(Math.max(0, ...group.items.map(item => Number(item.year) || 0))) + '-01-01' })
  return [...items].sort((a, b) => {
    const sort = props.browseSort || 'title'
    if (sort === 'title' || sort === 'fileName') {
      const rank = { genre: 0, year: 1, rating: 2 }
      const groupOrder = rank[a.type] - rank[b.type]
      if (groupOrder) return groupOrder
    }
    return compareMediaBrowseValues(values(a), values(b), sort)
  })
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
  if (direct) return direct
  for (const collection of mediaStore.mediaItems) {
    const member = collection.collectionMovies?.find(movie => movie.id === favoriteKey)
    if (member) return { ...collection, ...member, type: 'movie', collectionMovies: undefined }
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
      id: favoriteKey,
      name: `${tvBase.name} S${seasonNumber}`,
      seasons: season ? [season] : tvBase.seasons
    }
  }

  const episode = season?.episodes?.find(e => e.episodeNumber === episodeNumber)
  const driveFiles = episode?.driveFiles || tvBase.driveFiles

  return {
    ...tvBase,
    id: favoriteKey,
    parentId: tvBase.id,
    name: tvBase.name,
    posterUrl: season?.posterPath ? tmdbImageUrl(season.posterPath) : tvBase.posterUrl,
    releaseDate: episode?.airDate || tvBase.releaseDate,
    rating: episode?.rating ?? tvBase.rating,
    overview: episode?.overview || tvBase.overview,
    seasons: season ? [{
      ...season,
      episodes: episode ? [episode] : season.episodes
    }] : tvBase.seasons,
    driveFiles
  }
}

const playlistEpisodeLabel = (item: MediaLibraryItem): string => {
  if (!selectedPlaylist.value || item.type !== 'tv') return ''
  const match = item.id.match(/_(\d+)_(\d+)$/)
  return match ? `第 ${Number(match[1])} 季 · 第 ${Number(match[2])} 集` : ''
}
const playlistListTitle = (item: MediaLibraryItem): string => {
  const episode = item.seasons?.[0]?.episodes?.[0]
  return [item.name, playlistEpisodeLabel(item), episode?.name].filter(Boolean).join(' - ')
}
const startPlaylistDrag = (event: DragEvent, id: string) => {
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
const dropPlaylistItem = (event: DragEvent, targetId: string) => {
  const name = selectedPlaylist.value
  const sourceId = event.dataTransfer?.getData('text/plain')
  if (!name || !sourceId || sourceId === targetId) return
  const ids = [...(mediaStore.playlists[name] || [])]
  const source = ids.indexOf(sourceId), target = ids.indexOf(targetId)
  if (source < 0 || target < 0) return
  ids.splice(source, 1)
  ids.splice(target, 0, sourceId)
  mediaStore.playlists = { ...mediaStore.playlists, [name]: ids }
  pagedItems.value = ids.map(favoriteIdToMediaItem).filter((item): item is MediaLibraryItem => !!item)
}

const activePlaylistItems = computed(() => selectedPlaylist.value
  ? (mediaStore.playlists[selectedPlaylist.value] || []).map(favoriteIdToMediaItem)
      .filter((item): item is MediaLibraryItem => !!item)
  : [])

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

const toggleLocalMediaWatched = (item: MediaLibraryItem) => {
  const watched = !isMediaWatched(item, mediaStore.watchedItems)
  setMediaWatched(item, watched, mediaStore)
}
const localFileForMedia = (item: MediaLibraryItem) => {
  // A scraped poster wins over the local preview regardless of metadata provider.
  // Matched records without artwork still need the local video fallback.
  if (item.posterUrl || item.backdropUrl) return undefined
  return [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))].find(file => file.driveId === 'local' || file.driveServerId === 'local')
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
  return isMediaWatched(contextMenuItem.value, mediaStore.watchedItems)
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
  return mediaStore.continueWatching.some(item => isContinueWatchingMember(item, contextMenuItem.value!))
})

// 方法
const openMedia = (item: MediaLibraryItem) => {
  console.log('Opening media:', item.name)

  // 显示详情页面
  currentMediaItem.value = item
  showingDetail.value = true
}

const pendingFavoriteFolder = ref<IAliGetFileModel>()
const folderFavoriteName = ref('')
function saveBrowserFolderFavorite() {
  const folder = pendingFavoriteFolder.value
  if (!folder) return
  // As on macOS, an emptied name keeps the default: "All Files" for a drive root, else the folder name.
  const name = folderFavoriteName.value.trim() || (isFileSourceRoot(folder) ? t('unified.allFiles') : folder.name)
  pendingFavoriteFolder.value = undefined
  if (folder.drive_id === 'local') {
    void MediaScanner.getInstance().scanLocalFolder(folder.file_id, name).catch(error => message.error(String(error)))
    return
  }
  // Inside a favorite card everything was scraped with that favorite (macOS browsesInsideFavorite).
  void MediaScanner.getInstance().favoriteFolder(folder, folder.drive_id, name, isFileSourceRoot(folder), favoriteBrowse.value)
    .catch(error => message.error(String(error)))
}

const handleBrowserFileAction = async (action: string, file: IAliGetFileModel) => {
  if (action === 'download' && !file.isDir && file.drive_id !== 'local') {
    const settings = useSettingStore()
    const savePath = settings.AriaIsLocal ? settings.downSavePath : settings.ariaSavePath
    if (!savePath?.trim()) { message.error(t('posterMenu.downloadPathRequired')); return }
    try { await DownDAL.aAddDownload([Object.assign({}, file, { user_id: mediaPanTreeStore.user_id })], savePath, false) }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
    return
  }
  const target = mediaStore.mediaItems.find(item => [...(item.driveFiles || []), ...(item.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))].some(candidate => candidate.id === file.file_id || candidate.path === file.file_id))
  if (file.isDir && action === 'favorite') {
    const saved = mediaStore.folders.find(folder => folder.userId === mediaPanTreeStore.user_id && folder.driveId === file.drive_id && folder.fileId === file.file_id)
    if (saved && saved.isFavorite !== false && (!isFileSourceRoot(file) || saved.isDriveRootFavorite)) {
      // Removing a favorite also clears the media scraped from it; remote files stay.
      Modal.confirm({
        title: t('unified.removeFavoriteFolder'), content: t('unified.removeFavoriteConfirmation'),
        okText: t('unified.removeFavoriteFolder'), cancelText: t('common.cancel'), okButtonProps: { status: 'danger' },
        onOk: () => mediaStore.removeFolder(saved.id)
      })
    } else {
      pendingFavoriteFolder.value = { ...file, user_id: mediaPanTreeStore.user_id } as IAliGetFileModel
      folderFavoriteName.value = saved?.name || (isFileSourceRoot(file) ? t('unified.allFiles') : file.name)
    }
    return
  }
  if (['play', 'loop', 'shuffle'].includes(action)) {
    if (file.isDir) { const folder = mediaStore.folders.find(folder => folder.fileId === file.file_id); if (folder) await playBrowse(action as 'play' | 'loop' | 'shuffle', folder.id); else message.warning(t('mediaLibrary.noPlayableVideo')); }
    else await menuOpenFile(file, '', { playlistLoop: action === 'loop' })
    return
  }
  if (action === 'series') { openCustomSeries({ id: target?.id || JSON.stringify([mediaPanTreeStore.user_id, file.drive_id, file.file_id]), title: target?.name || file.name }); return }
  if (!target) { message.warning(t('fileContext.requiresScan')); return }
  contextMenuItem.value = target
  if (action === 'share') openMediaShare({ id: target.id, title: target.name, year: target.year, overview: target.overview, files: target.driveFiles })
  else if (action === 'metadata') openManualMetadataEditor()
  else if (action === 'continue') { handleContextMenuClose(); await updateWatching(target) }
  else if (action === 'playlist') showPlaylistPicker()
}
const openContextMenu = (event: MouseEvent, item: MediaLibraryItem) => {
  contextMenuItem.value = item
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  showContextMenu.value = true
}

const handlePosterAction = (action: PosterAction) => {
 if (action === 'removePlaylistItem' && contextMenuItem.value && selectedPlaylist.value) {
   const ids = mediaStore.playlists[selectedPlaylist.value] || []
   mediaStore.playlists = { ...mediaStore.playlists,
     [selectedPlaylist.value]: ids.filter(id => id !== contextMenuItem.value!.id) }
   pagedItems.value = (mediaStore.playlists[selectedPlaylist.value] || []).map(favoriteIdToMediaItem).filter((item): item is MediaLibraryItem => !!item)
   handleContextMenuClose()
   return
 }
 if (action === 'share' && contextMenuItem.value) { const item = contextMenuItem.value; openMediaShare({ id: item.id, title: item.name, year: item.year, overview: item.overview, files: item.driveFiles }); handleContextMenuClose(); return }
 if (action === 'rating' && contextMenuItem.value) { openPersonalRating(contextMenuItem.value); handleContextMenuClose(); return }
 if (action === 'play' || action === 'loop' || action === 'shuffle') { void playFromMenu(action === 'loop', action === 'shuffle'); return }
 if (action === 'download' && contextMenuItem.value) { void downloadMediaItem(contextMenuItem.value); handleContextMenuClose(); return }
 if (action === 'watched') { toggleWatchedFromMenu(); return }
 if (action === 'series') { openSeriesFromMenu(); return }
 if (action === 'metadata') { openManualMetadataEditor(); return }
 if (action === 'playlist') { showPlaylistPicker(); return }
 if (action === 'delete') { deleteMediaFromMenu(); return }
 if (action === 'continue' && contextMenuItem.value) { const target = contextMenuItem.value; handleContextMenuClose(); void updateWatching(target); return }
 if (action === 'select' && contextMenuItem.value) { localSelection.value = true; if (!selectedBrowseIds.value.includes(contextMenuItem.value.id)) selectedBrowseIds.value.push(contextMenuItem.value.id) }
 handleContextMenuClose()
}
const openSeriesFromMenu = () => { if (contextMenuItem.value) openCustomSeries({ id: contextMenuItem.value.id, title: contextMenuItem.value.name }); handleContextMenuClose() }
async function updateWatching(target: MediaLibraryItem) {
  try { await toggleContinueWatching(mediaStore, target) } catch (error) { message.error(error instanceof Error ? error.message : '更新观看列表失败') }
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
  toggleLocalMediaWatched(contextMenuItem.value)
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
  const movedFiles = new Set(scrapedItems.flatMap(scraped => [
    ...(scraped.driveFiles || []),
    ...(scraped.seasons || []).flatMap(season => (season.episodes || []).flatMap(episode => episode.driveFiles || []))
  ]).map(mediaDriveFileKey))
  const remaining = removeRescrapedFiles(item, movedFiles)
  if (remaining) mediaStore.replaceMediaItemMetadata(remaining)
  else mediaStore.removeMediaItem(item.id)
  for (const scraped of scrapedItems) {
    if (scraped.type === 'tv') mediaStore.addOrMergeTvSeries(scraped)
    else mediaStore.addMediaItem(scraped)
    mediaStore.addToRecentlyAdded(scraped)
  }
  currentMediaItem.value = scrapedItems[0]
  message.success(t('mediaLibrary.aiRescrapeDone'))
}

const removeRescrapedFiles = (item: MediaLibraryItem, movedFiles: Set<string>): MediaLibraryItem | null => {
  const retain = (files: NonNullable<MediaLibraryItem['driveFiles']> = []) => files.filter(file => !movedFiles.has(mediaDriveFileKey(file)))
  const driveFiles = retain(item.driveFiles)
  const seasons = item.seasons?.map(season => ({ ...season, episodes: season.episodes?.map(episode => ({ ...episode, driveFiles: retain(episode.driveFiles) })).filter(episode => episode.driveFiles.length) })).filter(season => season.episodes?.length)
  const collectionMovies = item.collectionMovies?.map(movie => ({ ...movie, driveFiles: retain(movie.driveFiles) })).filter(movie => movie.driveFiles.length)
  if (!driveFiles.length && !seasons?.some(season => season.episodes?.some(episode => episode.driveFiles.length)) && !collectionMovies?.some(movie => movie.driveFiles.length)) return null
  return { ...item, driveFiles, seasons, collectionMovies }
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
  if (mediaStore.mediaItems.some(media => media.id === item.id)) return item.id
  const parts = String(item.id).split('_')
  if (item.type === 'tv' && /_\d+_\d+$/.test(item.id)) return parts.slice(0, -2).join('_')
  return item.id
}

const deleteMediaFromMenu = () => {
  const target = contextMenuItem.value
  if (!target) return
  handleContextMenuClose()
  Modal.confirm({ title: t('posterMenu.deleteConfirm'), content: t('posterMenu.deleteRecordOnly', { title: target.name }), onOk: () => {
  const baseId = getBaseMediaId(target)
  mediaStore.removeMediaItem(baseId)
  if (typeof mediaStore.removeFromContinueWatching === 'function') {
    mediaStore.removeFromContinueWatching(target.id)
  }
  if (typeof mediaStore.removeFromFavorites === 'function') {
    mediaStore.removeFromFavorites(target.id)
  }
  if (typeof mediaStore.removeFromPlaylists === 'function') {
    mediaStore.removeFromPlaylists(target.id)
  }
  if (typeof mediaStore.removeWatchedByPrefix === 'function') {
    mediaStore.removeWatchedByPrefix(baseId)
  }
  } })
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
const handleDetailTagClick = (tagType: string, tagValue: string, personId?: number) => {
  console.log(`Tag clicked: ${tagType} = ${tagValue}`)

  // 返回列表并应用筛选
  const previous = { genre: selectedGenre.value, year: selectedYear.value, rating: selectedRating.value, cast: selectedCast.value, country: selectedCountry.value, personId: selectedPersonId.value }
  restoreDetailFilters = () => {
    selectedGenre.value = previous.genre
    selectedYear.value = previous.year
    selectedRating.value = previous.rating
    selectedCast.value = previous.cast
    selectedCountry.value = previous.country
    selectedPersonId.value = previous.personId
  }
  showingDetail.value = false
  selectedGenre.value = ''
  selectedYear.value = ''
  selectedRating.value = ''
  selectedCast.value = ''
  selectedPersonId.value = undefined
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
      selectedPersonId.value = personId
      break
    case 'country':
      selectedCountry.value = tagValue
      break
    // 可以扩展更多标签类型
  }
  emit('tagTitleChange', tagValue)
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
    const sourceUrl = item.items?.find((media: MediaLibraryItem) => media.backdropUrl)?.backdropUrl || covers[0]
    // Wide Retina banners need the source image, not a stretched poster thumbnail.
    // Only upgrade TMDB image routes; preserve other providers' URL semantics.
    const coverUrl = sourceUrl.replace(/(\/api\/tmdb\/image\/|\/t\/p\/)w\d+\//, '$1original/')
    return {
      backgroundImage: `${gradient.replace(/#[0-9a-f]{6}/gi, color => color + '40')}, url(${coverUrl})`,
      backgroundSize: '100% 100%, cover',
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
      if (data.name === t('aggregation.top30')) selectedRating.value = 'top30'
      else if (data.name === t('aggregation.rating8To10')) selectedRating.value = '8-10'
      else if (data.name === t('aggregation.rating1To4')) selectedRating.value = '1-4.99'
      else {
        const rating = Number.parseInt(data.name, 10)
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
      const driveFile = playbackVersions(episode?.driveFiles || [])[0]
      if (!episode || !driveFile) return null
      const aliFile = buildAliFileModel(driveFile)
      return { aliFile, entry: buildPlaylistEntry(aliFile, `${exact.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
    }
    const driveFile = playbackVersions(exact.driveFiles || [])[0]
    if (!driveFile) return null
    const aliFile = buildAliFileModel(driveFile)
    return { aliFile, entry: buildPlaylistEntry(aliFile, exact.name) }
  }

  const series = mediaStore.mediaItems.find((item) => item.type === 'tv' && playlistId.startsWith(`${item.id}_`))
  if (!series) return null
  const episode = resolveEpisodeByPlaylistId(series, playlistId)
  const driveFile = playbackVersions(episode?.driveFiles || [])[0]
  if (!episode || !driveFile) return null
  const aliFile = buildAliFileModel(driveFile)
  return { aliFile, entry: buildPlaylistEntry(aliFile, `${series.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
}

const resolvePlayableMediaItem = (item: MediaLibraryItem) => {
  if (item.type === 'tv') {
    const episode = (item.seasons || []).flatMap((season) => season.episodes || []).find((candidate) => candidate.driveFiles?.length)
    const driveFile = playbackVersions(episode?.driveFiles || [])[0]
    if (!episode || !driveFile) return null
    const aliFile = buildAliFileModel(driveFile)
    return { aliFile, entry: buildPlaylistEntry(aliFile, `${item.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim()) }
  }
  const driveFile = playbackVersions(item.driveFiles || [])[0]
  if (!driveFile) return null
  const aliFile = buildAliFileModel(driveFile)
  return { aliFile, entry: buildPlaylistEntry(aliFile, item.name) }
}

async function resumeMedia(item: MediaLibraryItem) {
  const files = item.type === 'tv'
    ? (item.seasons || []).flatMap(season => season.episodes || []).flatMap(episode => episode.driveFiles || [])
    : item.driveFiles || []
  const file = files.find(file => file.id === item.lastPlayedFileId) || files[0]
  if (!file) { message.warning(t('mediaLibrary.noPlayableVideo')); return }
  await menuOpenFile(buildAliFileModel(file), '')
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]] }
}
function downloadableMediaFiles(item: MediaLibraryItem): DriveFileItem[] {
  const files = item.type === 'tv' ? (item.seasons || []).flatMap(season => season.episodes || []).flatMap(episode => episode.driveFiles || []) : item.driveFiles
  const unique = new Map<string, DriveFileItem>()
  for (const file of files) if (file.driveId !== 'local' && file.userId && file.userId !== 'local') unique.set(JSON.stringify([file.userId, file.driveId, file.id]), file)
  return [...unique.values()]
}
const mediaDownloadPending = new Set<string>()
async function downloadMediaItem(item: MediaLibraryItem) {
  if (mediaDownloadPending.has(item.id)) return
  const files = downloadableMediaFiles(item)
  if (!files.length) { message.info(t('mediaLibrary.localNoDownload')); return }
  const settings = useSettingStore()
  const savePath = settings.AriaIsLocal ? settings.downSavePath : settings.ariaSavePath
  if (!savePath?.trim()) { message.error(t('posterMenu.downloadPathRequired')); return }
  mediaDownloadPending.add(item.id)
  try { await DownDAL.aAddDownload(files.map(buildAliFileModel), savePath, false) }
  catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally { mediaDownloadPending.delete(item.id) }
}
const playPlaylist = async (playlistName: string, loop = false, shuffle = false) => {
  const ids = mediaStore.playlists[playlistName] || []
  const playable = ids
    .map((id) => resolvePlayablePlaylistItem(id))
    .filter((item): item is NonNullable<ReturnType<typeof resolvePlayablePlaylistItem>> => !!item)

  if (!playable.length) {
    message.warning(t('mediaLibrary.noPlayablePlaylist'))
    return
  }

  if (shuffle) shuffleInPlace(playable)
  await menuOpenFile(playable[0].aliFile, '', {
    playlistLoop: loop,
    customPlaylistLabel: playlistName,
    customPlaylist: playable.map((item) => item.entry)
  })
}

const playFromMenu = async (loop = false, shuffle = false) => {
  if (!contextMenuItem.value) return

  if (selectedPlaylist.value) {
    const ids = mediaStore.playlists[selectedPlaylist.value] || []
    const selectedIndex = ids.indexOf(contextMenuItem.value.id)
    const ordered = selectedIndex < 0 ? ids : [...ids.slice(selectedIndex), ...ids.slice(0, selectedIndex)]
    const playable = ordered.map(resolvePlayablePlaylistItem)
      .filter((item): item is NonNullable<ReturnType<typeof resolvePlayablePlaylistItem>> => !!item)
    if (shuffle) shuffleInPlace(playable)
    if (!playable.length) message.warning(t('mediaLibrary.noPlayablePlaylist'))
    else await menuOpenFile(playable[0].aliFile, '', {
      playlistLoop: loop,
      customPlaylistLabel: selectedPlaylist.value,
      customPlaylist: playable.map(item => item.entry)
    })
    handleContextMenuClose()
    return
  }

  const playable = resolvePlayableMediaItem(contextMenuItem.value)
  if (!playable) {
    message.warning(t('mediaLibrary.noPlayableVideo'))
    return
  }

  const episodes = contextMenuItem.value.type === 'tv'
    ? (contextMenuItem.value.seasons || []).flatMap(season => season.episodes || []).filter(episode => episode.driveFiles?.length).map(episode => {
      const file = buildAliFileModel(playbackVersions(episode.driveFiles)[0])
      return buildPlaylistEntry(file, contextMenuItem.value!.name + ' · S' + episode.seasonNumber + 'E' + episode.episodeNumber)
    }) : []
  if (shuffle) shuffleInPlace(episodes)
  const firstEntry = episodes[0]
  const firstFile = firstEntry ? { ...playable.aliFile, user_id: firstEntry.user_id, drive_id: firstEntry.drive_id, file_id: firstEntry.file_id, parent_file_id: firstEntry.parent_file_id, name: firstEntry.file_name, description: firstEntry.description } as IAliGetFileModel : playable.aliFile
  await menuOpenFile(firstFile, '', { playlistLoop: loop, ...(episodes.length ? { customPlaylistLabel: contextMenuItem.value.name, customPlaylist: episodes } : {}) })
  handleContextMenuClose()
}

function compareBrowseItems(a: MediaLibraryItem, b: MediaLibraryItem) {
  const values = (item: MediaLibraryItem) => ({ title: item.name, fileName: item.driveFiles[0]?.name || item.seasons?.flatMap(season => season.episodes || [])[0]?.driveFiles[0]?.name, addedAt: item.addedAt, premiereDate: item.releaseDate })
  return compareMediaBrowseValues(values(a), values(b), props.browseSort || 'fileName', props.browseSortDescending)
}

async function playBrowse(mode: 'play' | 'loop' | 'shuffle', folderId?: string) {
  const { type, predicate } = getMediaPageQuery()
  const items = await DB.getMediaLibraryPage({ type, predicate, limit: Number.MAX_SAFE_INTEGER, sort: compareBrowseItems })
  return playItems(items.filter(item => (!folderId || item.folderId === folderId)).filter(item => !effectiveBrowseSelection.value || selectedBrowseIds.value.includes(item.id)), mode, resultBarTitle.value)
}

async function playItems(items: MediaLibraryItem[], mode: 'play' | 'loop' | 'shuffle', title: string) {
  const playable = items.map(resolvePlayableMediaItem).filter((item): item is NonNullable<ReturnType<typeof resolvePlayableMediaItem>> => !!item)
  if (mode === 'shuffle') {
    for (let i = playable.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [playable[i], playable[j]] = [playable[j], playable[i]] }
  }
  if (!playable.length) { message.warning(t('mediaLibrary.noPlayableVideo')); return }
  await menuOpenFile(playable[0].aliFile, '', { customPlaylistLabel: title, customPlaylist: playable.map(item => item.entry), playlistLoop: mode === 'loop' })
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
    } else if (driveId === 'quark') {
      const { apiQuarkFileList, mapQuarkFileToAliModel } = await import('../quark/dirfilelist')
      const { items: list } = await apiQuarkFileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapQuarkFileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (driveId === 'cloud139') {
      const { apiCloud139FileList, mapCloud139FileToAliModel } = await import('../cloud139/dirfilelist')
      const list = await apiCloud139FileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapCloud139FileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (driveId === 'cloud189') {
      const { apiCloud189FileList, mapCloud189FileToAliModel } = await import('../cloud189/dirfilelist')
      const list = await apiCloud189FileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapCloud189FileToAliModel(item, driveId, fileId), user_id: userId }))
    } else if (driveId === 'guangya') {
      const { apiGuangyaFileList, mapGuangyaFileToAliModel } = await import('../guangya/dirfilelist')
      const list = await apiGuangyaFileList(userId, fileId, 200)
      items = list.map(item => ({ ...mapGuangyaFileToAliModel(item, driveId, fileId), user_id: userId }))
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

const refreshMetadata = async () => {
 await mediaStore.flushPersistence()
 const { items } = await DB.getMediaLibrary()
 const targets = items.filter(item => item.tmdbId || item.collectionMovies?.some(movie => movie.tmdbId))
 return new Promise<void>(resolve => {
  Modal.confirm({ title: t('librarySettings.refreshMetadata'), content: t('librarySettings.metadataConfirm', { count: targets.length }), onCancel: () => resolve(), onBeforeOk: async () => {
   const failures: string[] = []
   for (const item of targets) {
    try { await DB.upsertMediaLibraryItems([await refreshMediaMetadata(item)], false) }
    catch (error) { failures.push(`${item.name}: ${String(error)}`) }
   }
   try { await mediaStore.hydrate() } finally { resolve() }
   if (failures.length) message.error(failures.join('\n'))
   return true
  } })
 })
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
  void loadMediaPage(true)
})

// 定义事件
const emit = defineEmits<{
  tagTitleChange: [title: string]
  detailVisibilityChange: [visible: boolean]
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

watch(() => showingDetail.value && !!currentMediaItem.value, visible => emit('detailVisibilityChange', visible), { immediate: true, flush: 'sync' })

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

async function runMediaServerSearch(rawQuery: string) {
  const query = rawQuery.trim()
  if (!query) {
    mediaServerSearchLoading.value = false
    mediaServerSearchError.value = ''
    mediaServerSearchGroups.value = []
    return
  }
  const candidates = mediaServerRegistry.servers.filter((server) => server.libraryMode !== false && !!server.baseUrl && !!server.userId)
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
  const candidates = mediaServerRegistry.servers.filter((server) => server.libraryMode !== false && !!server.baseUrl && !!server.userId)
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
  resumeMedia,
  returnToTagDetail,
  playItems,
  posterAction: (item: MediaLibraryItem, action: PosterAction) => { contextMenuItem.value = item; handlePosterAction(action) },
  playBrowse,
  openMedia,
  showAddFolder,
  showFolderFiles,
  showRootFolderFiles: (files: any[], folder: any) => { folderNavigationStack.value = []; showFolderFiles(files, folder) },
  folderTitle: computed(() => currentFolderInfo.value?.name || props.selectedFolder?.name || ''),
  goFolderBack: () => { if (!folderNavigationStack.value.length) return false; handleGoBack(); return true },
  refreshLibrary,
  refreshMetadata
})
</script>

<style scoped>
.playlist-drag-handle { flex: 0 0 30px; align-self: center; border: 0; background: none; color: #999; font-size: 24px; cursor: grab; }
.playlist-drag-handle:active { cursor: grabbing; }
.poster-playlist-picker{display:flex;flex-direction:column;gap:14px}.poster-playlist-picker label{display:flex;align-items:center;gap:10px;padding:10px;background:var(--color-fill-2);border-radius:8px}.poster-playlist-picker form{display:flex;gap:8px}.poster-selection-bar{display:flex;align-items:center;gap:16px;margin-bottom:12px}.poster-selection-bar button{border:0;background:var(--color-fill-2);padding:6px 12px;color:var(--color-text-1);border-radius:6px;cursor:pointer}
.local-file-collection{display:grid;grid-template-columns:repeat(auto-fill,174px);gap:24px 20px;padding:20px;align-content:start}.local-file-collection-list{display:flex;flex-direction:column;gap:0;padding:0 16px}

.unified-folder .folder-header{display:none}
.unified-folder .pan-right-container{overflow:auto}
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
  height: 100%;
  min-height: 260px;
  padding: 0;
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

.search-media-server-state:has(.media-loading-indicator) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
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

.unified-category .media-list { gap: 0; padding: 0 8px; }
.unified-category .media-list-item { position: relative; gap: 22px; padding: 12px 0; align-items: center; }
.unified-category .media-list-item + .media-list-item::before { content: ''; position: absolute; top: 0; left: 120px; right: 0; border-top: 1px solid var(--color-border-2); }
.unified-category .list-poster { width: 98px; min-width: 98px; height: 147px; border-radius: 8px; border: 0; box-shadow: none; }
.unified-category .list-info { gap: 4px; padding: 0; }
.unified-category .list-title { font-size: 16px; font-weight: 600; line-height: 1.4; }
.unified-category .list-meta { font-size: 13px; color: var(--color-text-3); gap: 8px; }
.unified-category .list-rating { display: inline-flex; align-items: center; gap: 4px; }
.unified-category .list-rating .iconfont { color: inherit; }
.unified-category .list-overview { font-size: 13px; line-height: 1.4; -webkit-line-clamp: 3; }
.unified-category .list-certification { border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; font-size: 11px; line-height: 1.2; }
.unified-category .list-path { display: none; }
.unified-category [data-selected='true'] { background: var(--color-fill-3); outline: 2px solid #ff8b25; outline-offset: -2px; border-radius: 8px; }

.unified-category .media-grid.media-grid-portrait { grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 22px 20px; padding: 16px; }
.unified-category .media-poster { border-radius: 12px; border: 0; box-shadow: none; }
.unified-category .media-info { margin-top: 6px; padding: 0; }
.unified-category .media-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
.unified-category .media-meta { font-size: 12px; }
.unified-category .type-badge { display: none; }
@media (max-width: 1100px) { .unified-category .media-grid.media-grid-portrait { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
@media (max-width: 800px) { .unified-category .media-grid.media-grid-portrait { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

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
  position: relative;
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
  background: var(--app-overlay-bg);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.32);
}

[arco-theme='dark'] .playlist-card-context-item {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .playlist-card-context-item:hover {
  background: rgba(59, 130, 246, 0.18);
}

[arco-theme='dark'] .library-card-context-menu {
  background: var(--app-overlay-bg);
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

/* CategoryCard on home page — fixed size for horizontal scroll */

.detail-media-modal :deep(.arco-modal-content) {
  border-radius: 28px;
  background: var(--app-overlay-bg);
  border: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 28px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.detail-media-modal :deep(.arco-modal-header) {
  border-bottom: 1px solid var(--app-glass-line, rgba(255, 255, 255, 0.06));
}

.detail-media-modal :deep(.arco-modal-title) {
  color: var(--app-mineradio-ink, #e8ecef);
}

[arco-theme='dark'] .home-section-header h4 {
  color: rgba(244, 247, 252, 0.96);
}

[arco-theme='dark'] .home-section-header span {
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

/* Unified category index has one banner layout, including year and rating groups. */
.unified-category .category-list { padding: 0 16px 16px; gap: 10px; }
.unified-category .category-list-card { height: 230px; flex-shrink: 0; border: 0; box-shadow: none; }
.unified-category .category-list-content { inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; }
.unified-category .category-list-title { font-size: 22px; }
.unified-category .category-list-count, .unified-category .category-list-overlay { display: none; }
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
  background: var(--app-overlay-bg);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.14);
  backdrop-filter: none;
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
  background: var(--app-overlay-bg);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 18px 42px rgba(45, 35, 25, 0.2);
  backdrop-filter: none;
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
  background: var(--app-overlay-bg) !important;
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
  background: var(--app-overlay-bg) !important;
  box-shadow: 0 28px 60px rgba(15, 23, 42, 0.14) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

body:not([arco-theme='dark']) .detail-media-modal .arco-modal-header {
  border-bottom: 1px solid rgba(15, 23, 42, 0.08) !important;
}

body:not([arco-theme='dark']) .detail-media-modal .arco-modal-title {
  color: rgba(17, 24, 39, 0.94) !important;
}

.manual-metadata-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
</style>
