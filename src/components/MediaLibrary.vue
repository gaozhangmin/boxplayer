<template>
  <div class="media-library">
    <!-- 顶部导航 - 详情页面时隐藏 -->
    <div v-if="!showingDetail && !isHomeView" class="library-header">
      <div class="library-tabs">
        <a-tabs v-model:activeKey="activeTab" type="text" class="hidetabs">
          <a-tab-pane key="continue" tab="继续观看" />
          <a-tab-pane key="recent" tab="最近添加" />
          <a-tab-pane key="movies" tab="电影" />
          <a-tab-pane key="tv" tab="电视剧" />
          <a-tab-pane key="unmatched" tab="未匹配" />
        </a-tabs>
      </div>

      <!-- 筛选器和视图切换 - 只在显示媒体内容时显示，文件夹文件列表时隐藏 -->
      <div v-if="!props.selectedFolder || folderFileList.length === 0" class="library-controls">
        <div class="library-controls-left">
          <button
            v-if="showHeaderBackButton"
            type="button"
            class="library-arrow-back library-header-back-button"
            :title="resultBarTitle"
            @click="handleResultBack"
          >
            <i class="iconfont iconarrow-left-2-icon"></i>
            <span class="library-arrow-back-title">{{ resultBarTitle }}</span>
          </button>
        </div>
        <div class="library-filters-right">
<!--          <a-select v-model:value="selectedGenre" placeholder="按类型筛选" style="width: 120px;">-->
<!--            <a-option value="">全部类型</a-option>-->
<!--            <a-option v-for="genre in mediaStore.genres" :key="genre" :value="genre">-->
<!--              {{ genre }}-->
<!--            </a-option>-->
<!--          </a-select>-->

<!--          <a-select v-model:value="selectedYear" placeholder="按年份筛选" style="width: 120px;">-->
<!--            <a-option value="">全部年份</a-option>-->
<!--            <a-option v-for="year in mediaStore.years" :key="year" :value="year.toString()">-->
<!--              {{ year }}-->
<!--            </a-option>-->
<!--          </a-select>-->

<!--          <a-select v-model:value="selectedRating" placeholder="按评分筛选" style="width: 120px;">-->
<!--            <a-option value="">全部评分</a-option>-->
<!--            <a-option value="9-10">9-10分</a-option>-->
<!--            <a-option value="8-9">8-9分</a-option>-->
<!--            <a-option value="7-8">7-8分</a-option>-->
<!--            <a-option value="6-7">6-7分</a-option>-->
<!--            <a-option value="1-5">1-5分</a-option>-->
<!--          </a-select>-->

          <!-- 视图切换按钮 -->
          <div v-if="showBrowseModeToggle" class="view-toggle">
            <div class="view-toggle-group">
              <a-button :type="viewMode === 'grid' ? 'primary' : 'outline'" @click="viewMode = 'grid'">网格</a-button>
              <a-button :type="viewMode === 'list' ? 'primary' : 'outline'" @click="viewMode = 'list'">列表</a-button>
            </div>
            <div v-if="showPosterTypeToggle" class="view-toggle-group">
              <a-button :type="posterType === 'portrait' ? 'primary' : 'outline'" @click="posterType = 'portrait'">竖版海报</a-button>
              <a-button :type="posterType === 'landscape' ? 'primary' : 'outline'" @click="posterType = 'landscape'">横版海报</a-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="library-content">
      <div v-if="showResultBackBar && !showingDetail" class="library-result-bar">
        <button
          type="button"
          class="library-arrow-back library-top-back-button"
          :title="resultBarTitle"
          @click="handleResultBack"
        >
          <i class="iconfont iconarrow-left-2-icon"></i>
          <span class="library-arrow-back-title">{{ resultBarTitle }}</span>
        </button>
        <div class="library-result-bar-main">
          <div class="library-result-bar-subtitle">共 {{ filteredItems.length }} 项结果</div>
        </div>
      </div>

      <!-- 搜索界面 -->
      <div v-if="isSearchView && !showingDetail" class="search-panel">
        <div class="search-panel-title">聚合搜索</div>
        <div class="search-panel-input">
          <a-input-search v-model="localSearchQuery" allow-clear placeholder="搜索媒体库和所有媒体服务器">
            <template #prefix>
              <i class="iconfont iconsearch" />
            </template>
          </a-input-search>
        </div>
        <div class="search-panel-hint">上方同时搜索本地媒体库和所有媒体服务器</div>
      </div>

      <!-- 显示媒体详情 -->
      <MediaDetail
        v-if="showingDetail && currentMediaItem"
        :media-item="currentMediaItem"
        :active-playlist-name="selectedPlaylist"
        :playlist-items="selectedPlaylist ? filteredItems : []"
        @back="handleDetailBack"
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
            <a-button type="outline" @click="openLocalHomeManager">
              <template #icon><i class="iconfont iconlist" /></template>
              媒体管理
            </a-button>
            <div class="home-poster-toggle">
              <a-button
                :type="localHomePosterMode === 'landscape' ? 'primary' : 'outline'"
                @click="setLocalHomePosterMode('landscape')"
              >
                横版
              </a-button>
              <a-button
                :type="localHomePosterMode === 'portrait' ? 'primary' : 'outline'"
                @click="setLocalHomePosterMode('portrait')"
              >
                竖版
              </a-button>
            </div>
          </div>
        </div>

        <template v-for="section in visibleLocalHomeSections" :key="section.key">
          <MediaServerResumeRow
            v-if="section.kind === 'continue' && (localContinueCards.length > 0)"
            :items="localContinueCards"
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
            :show-top-overlay="true"
            :see-all-label="`查看全部 (${getLocalHomeSectionTotalCount(section)})`"
            subtitle-mode="year-only"
            @select="handleLocalHomeNodeSelect"
            @play="handleLocalHomeNodePlay"
            @action="handleLocalHomeCardAction"
            @see-all="handleLocalHomeSeeAll(section)"
          />

          <section
            v-else-if="section.kind === 'shortcut' && (section.entries?.length || 0) > 0"
            class="library-home-section"
          >
            <div class="home-section-header">
              <h4>{{ section.title }}</h4>
              <a-button
                v-if="section.key === 'genres' || section.key === 'ratings' || section.key === 'years' || section.key === 'playlists'"
                type="text"
                class="see-all-button"
                @click="handleLocalShortcutSeeAll(section.key)"
              >
                查看全部 ({{ getLocalHomeSectionTotalCount(section) }})
              </a-button>
              <span v-else>{{ (section.entries || []).length }} 项</span>
            </div>
            <div
              class="library-home-row"
              :class="section.variant === 'banner' ? 'library-home-row-banner' : 'library-home-row-category'"
            >
              <button
                v-for="entry in (section.entries || [])"
                :key="entry.key"
                type="button"
                class="library-home-shortcut-card"
                :class="section.variant === 'banner' ? 'library-home-banner-card' : 'library-home-mini-card'"
                :style="entry.style"
                @click="handleLocalShortcutSelect(entry)"
              >
                <template v-if="section.variant === 'banner'">
                  <div class="library-home-banner-image" :style="entry.style"></div>
                  <div class="category-list-overlay" :style="entry.overlayStyle"></div>
                  <div class="category-list-content">
                    <h3 class="category-list-title">{{ entry.title }}</h3>
                  </div>
                  <div v-if="entry.count !== undefined" class="category-list-count">{{ entry.count }}</div>
                </template>
                <template v-else>
                  <div class="library-home-mini-icon">
                    <i class="iconfont" :class="entry.icon" />
                  </div>
                  <div class="library-home-mini-main">
                    <h5>{{ entry.title }}</h5>
                    <p>{{ entry.description }}</p>
                  </div>
                  <div v-if="entry.count !== undefined" class="library-home-mini-count">{{ entry.count }}</div>
                </template>
              </button>
            </div>
          </section>
        </template>

        <a-modal
          v-model:visible="localHomeManagerVisible"
          title="媒体管理"
          :footer="false"
          width="560px"
          class="detail-media-modal"
        >
          <div class="home-library-manager-panel">
            <p class="home-library-manager-hint">拖动调整首页分区顺序，也可以隐藏你不想显示的栏目。</p>
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
                  <i class="iconfont iconmenu-unfold" />
                </div>
                <a-checkbox :model-value="item.visible" @change="toggleLocalHomeDraftVisible(item.key, $event)">
                  {{ item.title }}
                </a-checkbox>
              </div>
            </div>
            <div v-else class="home-library-manager-empty">还没有可管理的首页分区</div>
            <div class="home-library-manager-footer">
              <a-button type="outline" @click="cancelLocalHomeManager">取消</a-button>
              <a-button type="primary" @click="saveLocalHomeManager">保存</a-button>
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
            <div class="search-result-section-title">网盘搜索结果</div>
            <div v-if="hasLocalSearchResults" class="search-result-section-body">
              <div v-if="viewMode === 'grid'" class="media-grid search-media-grid">
                <div
                  v-for="item in filteredItems"
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
                      <i class="iconfont iconfile-video" />
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
                      {{ item.type === 'movie' ? '电影' : item.type === 'tv' ? '电视剧' : '未匹配' }}
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
                  v-for="item in filteredItems"
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
                      <i class="iconfont iconfile-video" />
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
                        已观看 {{ Math.round((item.watchProgress || 0) * 100) }}%
                      </p>
                    </div>

                    <div class="list-meta">
                      <span class="list-type">{{ item.type === 'movie' ? '电影' : item.type === 'tv' ? '电视剧' : '未匹配' }}</span>
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
                        {{ item.seasons.length }} 季
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="search-media-server-state">
              {{ localSearchQuery.trim() ? '网盘媒体库没有匹配结果' : '输入关键词后可搜索网盘媒体库' }}
            </div>
          </div>

          <div
            class="search-result-section"
            :class="{ 'search-result-section-divider': localSearchQuery.trim() }"
          >
            <div class="search-result-section-title">
              {{ localSearchQuery.trim() ? '媒体服务器结果' : '媒体服务器推荐' }}
            </div>
            <div v-if="mediaServerSearchLoading" class="search-media-server-state">
              {{ localSearchQuery.trim() ? '正在搜索所有媒体服务器...' : '正在加载所有媒体服务器推荐...' }}
            </div>
            <div v-else-if="mediaServerSearchError" class="search-media-server-state error">{{ mediaServerSearchError }}</div>
            <div v-else-if="mediaServerSearchGroups.length === 0" class="search-media-server-state">
              {{ localSearchQuery.trim() ? '媒体服务器没有匹配结果' : '暂时没有可推荐的媒体内容' }}
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

      <!-- 加载状态 -->
      <div v-else-if="mediaStore.isScanning" class="loading-state">
        <a-spin />
        <p>正在扫描媒体文件... {{ mediaStore.scanProgress }}/{{ mediaStore.scanTotal }}</p>
      </div>

      <!-- 文件列表 - 当选择文件夹时显示 PanRight 组件 -->
      <div v-else-if="props.selectedFolder && folderFileList.length >= 0" class="folder-file-list">
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
                <i class="iconfont iconarrow-left-2-icon"></i>
                <span class="library-arrow-back-title">{{ currentFolderInfo?.name || props.selectedFolder.name }}</span>
              </button>
            </div>
            <div class="folder-info">
              <h3>{{ currentFolderInfo?.name || props.selectedFolder.name }}</h3>
              <p>共 {{ folderFileList.length }} 个文件</p>
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
                <i class="iconfont iconarrow-left-2-icon"></i>
                <span class="library-arrow-back-title">{{ currentFolderInfo?.name || props.selectedFolder.name }}</span>
              </button>
            </div>
            <div class="folder-info">
              <h3>{{ currentFolderInfo?.name || props.selectedFolder.name }}</h3>
              <p>文件夹为空</p>
            </div>
          </div>
        </div>
        <div class="empty-state">
          <a-empty description="文件夹为空" />
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
            :gradient="getCategoryGradient(item.type)"
            :cover-image="getRandomCoverImage(item)"
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
            <div class="category-list-count">{{ item.count }} items</div>
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
              :gradient="getCategoryGradient('genre')"
              :cover-image="item.coverImage"
              @click="handleCategoryClick"
            />
            <template #content>
              <div class="playlist-card-context-menu">
                <button type="button" class="playlist-card-context-item" @click="playPlaylist(item.name)">
                  <span class="playlist-card-context-icon">▷</span>
                  <span>播放全部</span>
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
              <div class="category-list-count">{{ item.count }} items</div>
            </div>
            <template #content>
              <div class="playlist-card-context-menu">
                <button type="button" class="playlist-card-context-item" @click="playPlaylist(item.name)">
                  <span class="playlist-card-context-icon">▷</span>
                  <span>播放全部</span>
                </button>
              </div>
            </template>
          </a-trigger>
        </div>
      </div>

      <!-- 空状态 - 当没有媒体内容时 -->
      <div v-else-if="filteredItems.length === 0" class="empty-state">
        <a-empty description="暂无媒体内容" />
      </div>

      <!-- 媒体内容 -->
      <div v-else :class="['media-container', viewMode, `poster-${posterType}`]">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" class="media-grid" :class="`media-grid-${posterType}`">
          <div
            v-for="item in filteredItems"
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
                <i class="iconfont iconfile-video" />
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
            v-for="item in filteredItems"
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
                <i class="iconfont iconfile-video" />
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
                  {{ getItemOverview(item) || '暂无简介' }}
                </p>
                <p v-if="item.type === 'unmatched' && getUnmatchedPath(item)" class="list-path" :title="getUnmatchedPath(item)">
                  {{ getUnmatchedPath(item) }}
                </p>
                <p v-if="isContinueWatchingView && item.continueEpisodeLabel" class="list-episode">
                  {{ item.continueEpisodeLabel }}
                </p>
                <p v-if="isContinueWatchingView && item.watchProgress !== undefined" class="list-progress">
                  已观看 {{ Math.round((item.watchProgress || 0) * 100) }}%
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
      </div>
      </template>
    </div>

    <!-- 添加文件夹对话框 -->
    <a-modal
      v-model:visible="showAddFolderModal"
      title="添加到媒体库"
      @ok="handleAddFolder"
      @cancel="showAddFolderModal = false"
    >
      <a-form :model="folderForm" layout="vertical">
        <a-form-item label="文件夹名称">
          <a-input v-model:value="folderForm.name" placeholder="请输入媒体库名称" />
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
            <span>播放</span>
          </button>
          <template v-if="isContinueWatchingView">
            <div class="library-card-context-divider" />
            <button type="button" class="library-card-context-item" @click="removeFromContinueWatchingFromMenu">
              <span class="library-card-context-icon">↺</span>
              <span>从继续观看移除</span>
            </button>
          </template>
          <template v-else>
            <button type="button" class="library-card-context-item" @click="toggleFavoriteFromMenu">
              <span class="library-card-context-icon">{{ contextMenuIsFavorite ? '♥' : '♡' }}</span>
              <span>{{ contextMenuIsFavorite ? '取消收藏' : '收藏' }}</span>
            </button>
            <button type="button" class="library-card-context-item" @click="toggleWatchedFromMenu">
              <span class="library-card-context-icon context-icon-filled">✓</span>
              <span>{{ contextMenuIsWatched ? '标记为未观看' : '标记为已观看' }}</span>
            </button>
            <button v-if="hasPlaylists" type="button" class="library-card-context-item" @click="togglePlaylistFromMenu">
              <span class="library-card-context-icon">≡</span>
              <span>{{ contextMenuInPlaylist ? '移除播放列表' : '添加到播放列表' }}</span>
            </button>
            <div class="library-card-context-divider" />
            <button type="button" class="library-card-context-item danger" @click="deleteMediaFromMenu">
              <span class="library-card-context-icon">✕</span>
              <span>删除</span>
            </button>
          </template>
        </div>
      </template>
    </a-dropdown>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useMediaLibraryStore } from '../store/medialibrary'
import { useAppStore } from '../store'
import useMediaServerRegistryStore from '../store/mediaServerRegistry'
import useMediaServerNavigationStore from '../store/mediaServerNavigation'
import MediaPanRight from './MediaPanRight.vue'
import { useMediaPanFileStore, useMediaPanTreeStore } from './stores'
import CategoryCard from './CategoryCard.vue'
import MediaDetail from './MediaDetail.vue'
import MediaServerPosterRow from './media-server/home/MediaServerPosterRow.vue'
import MediaServerResumeRow from './media-server/home/MediaServerResumeRow.vue'
import type { MediaLibraryItem, MediaFilter } from '../types/media'
import type { DriveFileItem } from '../types/media'
import type { MediaServerLibraryNode } from '../types/mediaServerContent'
import type { MediaServerCardItem } from '../types/mediaServerContent'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { IPageVideoPlaylistEntry } from '../store/appstore'
import { getMediaServerSearch, getMediaServerSuggestions } from '../media-server/contentGateway'
import { resolveMediaServerImage } from '../media-server/imageSources'
import { toMsCacheUrl } from '../media-server/imageCache'
import { isAliyunUser, isCloud123User, isDrive115User, isBaiduUser, isBoxUser, isPikPakUser, isOneDriveUser } from '../aliapi/utils'
import AliDirFileList from '../aliapi/dirfilelist'
import { apiBaiduFileList, mapBaiduFileToAliModel } from '../cloudbaidu/dirfilelist'
import { getWebDavConnection, getWebDavConnectionId, isWebDavDrive, listWebDavDirectory } from '../utils/webdavClient'
import { menuOpenFile } from '../utils/openfile'
import message from '../utils/message'
import useLocalMediaHomePreferencesStore from '../store/localMediaHomePreferences'
import type { LocalMediaHomePosterType, LocalMediaHomeSectionKey } from '../store/localMediaHomePreferences'

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
const mediaServerSearchGroups = ref<Array<{
  server: { id: string; name: string }
  items: MediaServerLibraryNode[]
}>>([])
let mediaServerSearchTimer: ReturnType<typeof setTimeout> | undefined
const localHomeManagerVisible = ref(false)
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

// 计算属性
const filteredItems = computed(() => {
  let items: MediaListItem[] = []

  // 根据props或当前标签选择数据源
  const category = props.activeCategory || activeTab.value

  console.log('Filtering items - Category:', category, 'Selected folder:', props.selectedFolder?.name, 'Folder ID:', props.selectedFolder?.id)

  // 如果选择了文件夹，显示该文件夹的文件列表（直接显示，不转换为媒体项目）
  if (props.selectedFolder && folderFileList.value.length > 0) {
    // 这里我们将直接在模板中使用 folderFileList，而不是转换为 MediaLibraryItem
    return []
  }

  switch (category) {
    case 'continue-watching':
      items = [...continueWatchingItems.value]
      break
    case 'recently-added':
      items = [...mediaStore.recentlyAdded]
      break
    case 'movies':
      items = [...mediaStore.movies]
      break
    case 'tv-shows':
      items = [...mediaStore.tvShows]
      break
    case 'favorites':
      items = mediaStore.favorites
        .map(favoriteIdToMediaItem)
        .filter((item): item is MediaLibraryItem => Boolean(item))
      break
    case 'playlist':
      if (selectedPlaylist.value) {
        const ids = mediaStore.playlists[selectedPlaylist.value] || []
        items = ids
          .map(favoriteIdToMediaItem)
          .filter((item): item is MediaLibraryItem => Boolean(item))
      } else {
        items = []
      }
      break
    case 'unmatched':
      items = [...mediaStore.unmatchedItems]
      break
    case 'documentary':
      items = [...documentaryItems.value]
      break
    case 'animation':
      items = [...animationItems.value]
      break
    case 'unwatched':
      items = mediaStore.mediaItems.filter(item => {
        if (mediaStore.watchedItems.includes(item.id)) return false
        return !mediaStore.watchedItems.some(watchedId => String(watchedId).startsWith(`${item.id}_`))
      })
      break
    case 'search':
      items = [...mediaStore.mediaItems]
      break
    case 'genres':
      items = [...mediaStore.mediaItems]
      break
    case 'ratings':
      items = [...mediaStore.topRated]
      break
    case 'years':
      items = [...mediaStore.mediaItems]
      break
    default:
      items = [...mediaStore.mediaItems]
  }

  console.log('Initial items count:', items.length)

  // 应用筛选器
  const filter: MediaFilter = {
    genre: props.selectedGenre || selectedGenre.value || undefined,
    sortBy: 'added',
    sortOrder: 'desc'
  }

  const year = props.selectedYear || selectedYear.value
  if (year) {
    if (/^\d{4}s$/i.test(year)) {
      const start = parseInt(year, 10)
      filter.yearRange = [start, start + 9]
    } else {
      const yearNum = parseInt(year, 10)
      filter.yearRange = [yearNum, yearNum]
    }
  }

  const rating = props.selectedRating || selectedRating.value
  if (rating) {
    const [min, max] = rating.split('-').map(Number)
    filter.ratingRange = [min, max]
  }

  // 根据分类过滤类型
  if (category === 'movies') {
    filter.type = 'movie'
  } else if (category === 'tv-shows') {
    filter.type = 'tv'
  } else if (category === 'unmatched') {
    filter.type = 'unmatched'
  }

  let result = items

  if (!['favorites', 'playlist', 'continue-watching'].includes(category)) {
    result = mediaStore.filterItems(filter).filter(item => items.some(i => i.id === item.id))
  }
  if (selectedCast.value) {
    const keyword = selectedCast.value.toLowerCase()
    result = result.filter(item =>
      item.credits?.cast?.some(c => c.name?.toLowerCase().includes(keyword))
    )
  }
  if (selectedCountry.value) {
    const keyword = selectedCountry.value.toLowerCase()
    result = result.filter(item =>
      (item.productionCountries || []).some(c => c.toLowerCase().includes(keyword))
    )
  }
  const query = (localSearchQuery.value || '').trim().toLowerCase()
  if (query) {
    result = result.filter(item =>
      item.name?.toLowerCase().includes(query)
    )
  }
  return result
})

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
  if (props.selectedGenre) return `类型 · ${props.selectedGenre}`
  if (props.selectedYear) return `年份 · ${props.selectedYear}`
  if (props.selectedRating) return `评分 · ${props.selectedRating}`
  return '筛选结果'
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
const homeNavigationTitleMap: Record<string, string> = {
  'continue-watching': '继续观看',
  'recently-added': '最近添加',
  movies: '电影',
  'tv-shows': '电视剧',
  documentary: '纪录片',
  animation: '动画',
  unmatched: '未匹配',
  unwatched: '未观看',
  favorites: '收藏',
  playlist: '播放列表',
  genres: '类型',
  ratings: '评分',
  years: '年份'
}
const resultBarTitle = computed(() => {
  if (showHomeBackBar.value) {
    const category = props.activeCategory || activeTab.value
    return homeNavigationTitleMap[category] || '媒体库'
  }
  if (showPlaylistBackBar.value) return `播放列表 · ${selectedPlaylist.value}`
  return drillDownResultTitle.value
})
const hasLocalSearchResults = computed(() => {
  return isSearchView.value && !!localSearchQuery.value.trim() && filteredItems.value.length > 0
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
    isFavorite: mediaStore.isFavorite?.(item.id) || false
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
  if (folder.driveServerId === 'webdav' || (folder.driveId || '').startsWith('webdav:')) return 'WebDAV 文件源'
  if (folder.driveId === 'local' || folder.driveServerId === 'local') return '本地文件夹'
  if (folder.driveId === 'cloud123' || folder.driveServerId === 'cloud123') return '123 云盘'
  if (folder.driveId === 'drive115' || folder.driveServerId === 'drive115') return '115 网盘'
  if (folder.driveId === 'baidu' || folder.driveServerId === 'baidu') return '百度网盘'
  if (folder.driveId === 'pikpak' || folder.driveServerId === 'pikpak') return 'PikPak'
  if (folder.driveId === 'dropbox' || folder.driveServerId === 'dropbox') return 'Dropbox'
  if (folder.driveId === 'onedrive' || folder.driveServerId === 'onedrive') return 'OneDrive'
  if (folder.driveId === 'box' || folder.driveServerId === 'box') return 'Box'
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
    style: getBannerCardImageStyle(getRandomCoverImage(item)),
    overlayStyle: getBannerCardOverlayStyle(item.name, item.type || 'genre'),
    action: () => handleCategoryClick({ name: item.name, type: 'genre', count: item.count })
  }))

  const ratings = mediaStore.ratingCategories.slice(0, 18).map((item) => ({
    key: `rating-${item.name}`,
    title: item.name.replace('分', ''),
    description: `${item.count} 项`,
    icon: 'iconcrown2',
    count: item.count,
    style: getBannerCardImageStyle(getRandomCoverImage(item)),
    overlayStyle: getBannerCardOverlayStyle(item.name, 'rating'),
    action: () => handleCategoryClick({ name: item.name, type: 'rating', count: item.count })
  }))

  const years = mediaStore.yearGroups.slice(0, 18).map((item) => ({
    key: `year-${item.name}`,
    title: item.name,
    description: `${item.count} 项`,
    icon: 'iconcalendar',
    count: item.count,
    style: getBannerCardImageStyle(getRandomCoverImage(item)),
    overlayStyle: getBannerCardOverlayStyle(item.name, 'year'),
    action: () => handleCategoryClick({ name: item.name, type: 'year', count: item.count })
  }))

  const playlists = playlistItems.value.slice(0, 18).map((item) => ({
    key: `playlist-${item.name}`,
    title: item.name,
    description: `${item.count} 项`,
    icon: 'iconlist',
    count: item.count,
    style: getBannerCardImageStyle(item.coverImage),
    overlayStyle: getBannerCardOverlayStyle(item.name, 'playlist'),
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
      title: '继续观看'
    },
    {
      key: 'recent',
      kind: 'media',
      title: '最近添加',
      category: 'recently-added',
      posterType: localHomePreferences.recentlyAddedPosterType,
      items: mediaStore.recentlyAdded.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'movies',
      kind: 'media',
      title: '电影',
      category: 'movies',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.movies.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'tv',
      kind: 'media',
      title: '电视剧',
      category: 'tv-shows',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.tvShows.slice(0, 18).map((item) => localItemToNode(item, { kind: 'series' })),
    },
    {
      key: 'documentary',
      kind: 'media',
      title: '纪录片',
      category: 'documentary',
      posterType: localHomePreferences.libraryPosterType,
      items: documentaryItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'animation',
      kind: 'media',
      title: '动画',
      category: 'animation',
      posterType: localHomePreferences.libraryPosterType,
      items: animationItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'unmatched',
      kind: 'media',
      title: '未匹配',
      category: 'unmatched',
      posterType: localHomePreferences.libraryPosterType,
      items: mediaStore.unmatchedItems.slice(0, 18).map((item) => localItemToNode(item, { kind: 'folder' })),
    },
    {
      key: 'unwatched',
      kind: 'media',
      title: '未观看',
      category: 'unwatched',
      posterType: localHomePreferences.libraryPosterType,
      items: unwatchedItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'favorites',
      kind: 'media',
      title: '收藏',
      category: 'favorites',
      posterType: localHomePreferences.libraryPosterType,
      items: favoriteItems.value.slice(0, 18).map((item) => localItemToNode(item)),
    },
    {
      key: 'playlists',
      kind: 'shortcut',
      title: '播放列表',
      variant: 'banner',
      entries: localShortcutSections.value.playlists
    },
    {
      key: 'genres',
      kind: 'shortcut',
      title: '类型',
      variant: 'banner',
      entries: localShortcutSections.value.genres
    },
    {
      key: 'ratings',
      kind: 'shortcut',
      title: '评分',
      variant: 'banner',
      entries: localShortcutSections.value.ratings
    },
    {
      key: 'years',
      kind: 'shortcut',
      title: '年份',
      variant: 'banner',
      entries: localShortcutSections.value.years
    },
    {
      key: 'folders',
      kind: 'shortcut',
      title: '文件源',
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

const visibleLocalHomeSections = computed(() => {
  const hidden = new Set(localHomePreferences.hiddenHomeSectionIds || [])
  return orderedLocalHomeSections.value.filter((section) => !hidden.has(section.key))
})

const getLocalHomeSectionTotalCount = (section: LocalHomeMediaSection) => {
  if (section.kind === 'continue') return localContinueCards.value.length
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
  if (item.type === 'movie') return '电影'
  if (item.type === 'tv') return '剧集'
  return '未匹配'
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

const getItemMetaItems = (item: MediaLibraryItem) => {
  const parts = [
    item.year ? `${item.year}` : '',
    typeof item.rating === 'number' ? `评分 ${item.rating.toFixed(1)}` : '',
    item.type === 'tv' && item.seasons?.length ? `${item.seasons.length} 季` : '',
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

// 获取分类卡片渐变色
const getCategoryGradient = (type: string) => {
  const gradients = {
    genre: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    rating: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    year: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
  }
  return gradients[type as keyof typeof gradients] || gradients.genre
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

const getBannerCardImageStyle = (coverImage?: string) => {
  if (!coverImage) return {}
  return {
    backgroundImage: `url(${coverImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat'
  } as CSSProperties
}

const getBannerCardOverlayStyle = (seedSource: string, fallbackType: string) => ({
  backgroundImage: getSeededGradient(seedSource, fallbackType),
  opacity: '0.68'
} as CSSProperties)

// 获取随机封面图
const getRandomCoverImage = (categoryItem: any) => {
  if (categoryItem.items && categoryItem.items.length > 0) {
    // 随机选择一个有封面的项目
    const itemsWithCover = categoryItem.items.filter((item: any) => item.posterUrl || item.backdropUrl)
    if (itemsWithCover.length > 0) {
      const randomItem = itemsWithCover[Math.floor(Math.random() * itemsWithCover.length)]
      return randomItem.posterUrl || randomItem.backdropUrl
    }
  }
  return undefined
}

// 获取列表卡片样式
const getListCardStyle = (item: any) => {
  const coverImage = getRandomCoverImage(item)
  const gradient = getSeededGradient(item.name, item.type || 'genre')
  if (coverImage) {
    return {
      backgroundImage: `${gradient}, url(${coverImage})`,
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
  const parentFileId = (driveFile.driveId || '').startsWith('webdav:')
    ? ((driveFile.path || '').replace(/\/[^/]*$/, '') || '/')
    : 'root'
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
    user_id: driveFile.userId || ''
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
    message.warning('当前播放列表没有可播放的媒体')
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
    message.warning('当前媒体没有可播放的视频文件')
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
  return favoriteIdToMediaItem(id) || continueWatchingItems.value.find((item) => item.id === id) || null
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

const handleLocalHomeCardAction = async (item: MediaServerCardItem | MediaServerLibraryNode, action: 'watched' | 'favorite' | 'download') => {
  if (item.id.startsWith('playlist:')) return
  const target = findLocalMediaItemById(item.id)
  if (!target) return
  if (action === 'download') {
    message.info('本地媒体不需要下载')
    return
  }
  if (action === 'favorite') {
    mediaStore.toggleFavorite(target.id)
    message.success(mediaStore.isFavorite(target.id) ? '已加入收藏' : '已取消收藏')
    return
  }
  const nextWatched = !mediaStore.isWatchedById(target.id)
  mediaStore.markWatched(target.id, nextWatched)
  message.success(nextWatched ? '已标记为已观看' : '已标记为未观看')
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
  movies: '电影',
  tv: '电视剧',
  documentary: '纪录片',
  animation: '动画',
  unmatched: '未匹配',
  unwatched: '未观看',
  favorites: '收藏',
  playlists: '播放列表',
  genres: '分类',
  ratings: '评分',
  years: '年份',
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
    mediaServerSearchError.value = '还没有可搜索的媒体服务器'
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
    mediaServerSearchError.value = error?.message || '搜索媒体服务器失败'
  } finally {
    mediaServerSearchLoading.value = false
  }
}

async function loadMediaServerSuggestions() {
  const candidates = mediaServerRegistry.servers.filter((server) => !!server.baseUrl && !!server.userId)
  if (candidates.length === 0) {
    mediaServerSearchGroups.value = []
    mediaServerSearchError.value = '还没有可搜索的媒体服务器'
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
    mediaServerSearchError.value = error?.message || '加载媒体服务器推荐失败'
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
  if (kind === 'movie') return '电影'
  if (kind === 'series') return '电视剧'
  if (kind === 'season') return '季'
  if (kind === 'episode') return '剧集'
  if (kind === 'person') return '人物'
  if (kind === 'folder') return '文件夹'
  return '媒体'
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
  flex: 1 1 auto;
}

.library-filters-right {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
}

.view-toggle {
  margin-left: 8px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.view-toggle-group {
  display: inline-flex;
  gap: 10px;
  flex-wrap: wrap;
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

.library-result-bar {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px 20px 10px;
}

.library-arrow-back {
  height: 46px;
  max-width: min(420px, calc(100vw - 80px));
  padding: 0 18px;
  gap: 10px;
  width: auto;
  height: 46px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.36);
  box-shadow: 0 10px 30px rgba(130, 137, 152, 0.18);
  backdrop-filter: blur(26px) saturate(165%);
  -webkit-backdrop-filter: blur(26px) saturate(165%);
  color: #253045;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
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

.library-result-bar-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.library-result-bar-title {
  color: #111827;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.25;
}

.library-result-bar-subtitle {
  margin-top: 4px;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
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
  color: #1f2937;
  font-size: 16px;
  font-weight: 800;
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
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.media-grid.media-grid-landscape {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
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
[arco-theme='dark'] .library-result-bar-subtitle,
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
  padding: 4px 2px 2px;
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
  gap: 12px;
  flex-wrap: wrap;
}

.home-poster-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  font-size: 14px;
  box-shadow: 0 12px 30px rgba(63, 46, 37, 0.1);
  backdrop-filter: blur(18px) saturate(135%);
  cursor: pointer;
}

.see-all-button:hover {
  background: rgba(255, 255, 255, 0.68);
  border-color: rgba(255, 255, 255, 0.86);
  color: rgba(24, 24, 24, 0.96);
  box-shadow: 0 16px 34px rgba(63, 46, 37, 0.12);
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

.library-home-banner-card {
  width: 320px;
  height: 170px;
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
}

.library-home-banner-image {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  transform: scale(1.02);
  filter: saturate(1.02) contrast(1.02);
}

.library-home-banner-card .category-list-overlay {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.28) 0%, rgba(15, 23, 42, 0.42) 100%);
  mix-blend-mode: multiply;
}

.library-home-banner-card .category-list-content {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 56px;
  text-align: center;
}

.library-home-banner-card .category-list-title {
  font-size: 18px;
  font-weight: 800;
  margin: 0;
  width: 100%;
}

.library-home-banner-card .category-list-count {
  top: auto;
  right: 16px;
  bottom: 16px;
  padding: 6px 12px;
  font-size: 15px;
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
  background: rgba(247, 241, 234, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px);
  box-shadow: 0 28px 60px rgba(56, 44, 30, 0.18);
}

.home-library-manager-panel {
  padding: 8px 4px 2px;
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
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.32);
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
  background: rgba(255, 255, 255, 0.28);
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
  background: rgba(255, 255, 255, 0.48);
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

[arco-theme='dark'] .see-all-button {
  background: rgba(15, 23, 42, 0.52);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(233, 239, 247, 0.92);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
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
[arco-theme='dark'] .home-settings-row,
[arco-theme='dark'] .home-library-manager-hint,
[arco-theme='dark'] .home-library-manager-item :deep(.arco-checkbox-label) {
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

[arco-theme='dark'] .library-home-banner-card {
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

[arco-theme='dark'] .detail-media-modal :deep(.arco-modal-content) {
  background: rgba(18, 22, 30, 0.9);
  border-color: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .home-library-manager-list {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

[arco-theme='dark'] .home-library-manager-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

[arco-theme='dark'] .home-library-manager-drag-icon {
  color: rgba(203, 213, 225, 0.56);
}

[arco-theme='dark'] .home-library-manager-empty {
  color: rgba(203, 213, 225, 0.56);
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
  gap: 16px;
  padding: 22px 24px 28px;
}

/* 分类列表视图 - 横向卡片样式 */
.category-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.category-list-card {
  position: relative;
  height: 120px;
  border-radius: 12px;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.category-list-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
}

.category-list-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    135deg,
    rgba(0, 0, 0, 0.4) 0%,
    rgba(0, 0, 0, 0.6) 100%
  );
  transition: opacity 0.3s ease;
}

.category-list-card:hover .category-list-overlay {
  opacity: 0.8;
}

.category-list-content {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20px 24px;
  color: white;
  z-index: 2;
}

.category-list-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  line-height: 1.2;
}

.category-list-count {
  position: absolute;
  top: 20px;
  right: 24px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
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

  .view-toggle {
    margin-left: 0;
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
