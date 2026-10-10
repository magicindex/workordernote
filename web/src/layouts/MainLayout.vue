<template>
  <div class="min-h-screen text-foreground">
    <div class="ambient" aria-hidden="true">
      <span class="ambient-orb ambient-orb-one"></span>
      <span class="ambient-orb ambient-orb-two"></span>
    </div>

    <!-- 「服务已经更新，当前页面还是旧版本」提示。
         场景：应用被装在桌面/长期开着，我在后台发了新版本（今天一天连发几版），
         旧页面里的交互还是老代码，用户看到的症状是「有些东西不对，刷新一下又好了」。
         与其让用户自己猜，不如直接把刷新按钮递到手上。 -->
    <div v-if="staleBundle" class="stale-bundle" data-stale-bundle role="status">
      <span class="stale-bundle-text">
        工作序记已更新到 <b>{{ staleBundle.version }}</b>，当前页面还是旧版本
      </span>
      <button type="button" class="stale-bundle-btn" data-stale-reload @click="reloadPage">刷新</button>
      <button type="button" class="row-action !opacity-80" aria-label="稍后再说" @click="staleDismissed = true">✕</button>
    </div>

    <aside class="sidebar" :class="[mobileOpen ? 'sidebar-open' : '', railActive ? 'sidebar-rail' : 'sidebar-docked']">
      <div class="flex h-full flex-col">
        <div class="flex items-center justify-between px-5 pb-5 pt-6">
          <!-- 左上角这一块改成视图切换：点一下去日历、再点一下回列表（原来点它只是回首页）。
               品牌信息仍然保留，只是整体变成按钮；提示文字随当前视图变化。 -->
          <button
            type="button"
            class="group flex items-center gap-3 text-left"
            :title="logoTitle"
            :aria-label="logoAria"
            @click="toggleViewFromLogo"
          >
            <span class="logo-mark">
              <!-- 与新应用图标同形：记录本 + 已办结的勾 -->
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="5.2" y="3.4" width="13.6" height="17.2" rx="3" stroke-width="1.8"/>
                <path d="M9.4 3.4v17.2" stroke-width="1.8"/>
                <path d="m11.6 12.1 1.8 1.8 3.2-3.6" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="rail-hide">
              <span class="flex items-center gap-2">
                <span class="font-display text-lg font-extrabold tracking-tight">{{ authStore.siteTitle || '工作序记' }}</span>
                <span v-if="appVersion" class="version-badge" :title="appBuildTime ? `构建时间：${appBuildTime}` : ''">{{ appVersion }}</span>
              </span>
              <span class="block text-[11px] font-medium text-muted-foreground">
                {{ logoSubtitle }}
              </span>
            </span>
          </button>
          <button class="icon-button mobile-only" aria-label="关闭菜单" @click="mobileOpen = false">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>

        <button v-if="canCreate" class="new-reminder-button mx-4" :title="railActive ? '新建提醒（快捷键 N）' : undefined" @click="openQuickAdd">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2.2" stroke-linecap="round"/></svg>
          </span>
          <span class="rail-hide">新建提醒</span>
          <kbd class="rail-hide ml-auto hidden rounded-md bg-black/10 px-1.5 py-0.5 text-[10px] sm:inline">N</kbd>
        </button>

        <nav class="mt-6 flex-1 overflow-y-auto px-3 pb-5">
          <p class="nav-caption">智能清单</p>
          <RouterLink
            v-for="item in smartNav"
            :key="item.to"
            :to="item.to"
            class="nav-row"
            :class="{ 'nav-row-active': isActive(item.to) }"
            :title="railActive ? item.label : undefined"
            @click="mobileOpen = false"
          >
            <span class="nav-symbol" :class="item.tone" v-html="item.icon"></span>
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="summary[item.key]" class="nav-count">{{ summary[item.key] }}</span>
          </RouterLink>

          <div class="mt-7 flex items-center justify-between px-3">
            <p class="nav-caption !px-0 !pb-0">我的清单</p>
            <button class="tiny-add" aria-label="新建清单" @click="creatingList = true">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>


          <RouterLink
            to="/admin/all"
            class="nav-row"
            :class="{ 'nav-row-active': isActive('/admin/all') }"
            @click="mobileOpen = false"
          >
            <span class="h-2.5 w-2.5 rounded-full bg-violet-500 ring-4 ring-violet-500/10"></span>
            <span class="flex-1">全部</span>
            <span v-if="summary.all" class="nav-count">{{ summary.all }}</span>
          </RouterLink>

          <!-- 信用卡账单：固定栏目（不是普通清单）。由后台偏好控制显示，
               启用后卡片一律归到这一栏，用户不用（也不能）自己建这个清单。 -->
          <RouterLink
            v-if="authStore.creditCardEnabled && cardBucket"
            :to="`/admin/list/${cardBucket.id}`"
            class="nav-row"
            :class="{ 'nav-row-active': route.path === `/admin/list/${cardBucket.id}` }"
            :title="railActive ? '信用卡账单' : '信用卡账单：卡片、账单日与还款提醒都在这里'"
            data-nav-cards
            @click="mobileOpen = false"
          >
            <span class="nav-symbol h-5 w-5 bg-brand-500/12 text-brand-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="12" rx="2.5" stroke-width="1.7"/><path d="M3 10h18M6.5 14h4" stroke-width="1.7" stroke-linecap="round"/></svg>
            </span>
            <span class="flex-1">信用卡账单</span>
            <span v-if="cardBucket.card_count" class="nav-count">{{ cardBucket.card_count }}</span>
          </RouterLink>

          <!-- 记事本：与「信用卡账单」并列的固定栏目，由个人偏好 notebook_enabled 控制显示。
               记事一律收在这一栏里，不需要（也不能）自己建这个清单。 -->
          <RouterLink
            v-if="authStore.notebookEnabled && noteBucket"
            :to="`/admin/list/${noteBucket.id}`"
            class="nav-row"
            :class="{ 'nav-row-active': route.path === `/admin/list/${noteBucket.id}` }"
            :title="railActive ? '记事本' : '记事本：新建的记事都收在这里'"
            data-nav-notebook
            @click="mobileOpen = false"
          >
            <span class="nav-symbol h-5 w-5 bg-emerald-500/12 text-emerald-500">
              <!-- 图标取图标库里那个「笔记本」（notebook）：以前这里写死的是一本书，
                   与清单数据里的 icon 不是同一份来源，导致「改了图标库里那份、侧栏还是旧的」。
                   现在与日历/清单筛选共用 utils/list-icons.ts 一份定义。 -->
              <ListIcon name="notebook" :size="20" />
            </span>
            <span class="flex-1">记事本</span>
          </RouterLink>

          <!-- 人生要有仪式感：与「记事本」并列的固定栏目，由个人偏好 ceremony_enabled 控制显示。
               里面的条目在栏目页上用**倒计时卡片**展示（生日/纪念日/节日/考试…）。 -->
          <RouterLink
            v-if="authStore.ceremonyEnabled && ceremonyBucket"
            :to="`/admin/list/${ceremonyBucket.id}`"
            class="nav-row"
            :class="{ 'nav-row-active': route.path === `/admin/list/${ceremonyBucket.id}` }"
            :title="railActive ? '人生要有仪式感' : '人生要有仪式感：生日、纪念日、节日、考试的倒计时'"
            data-nav-ceremony
            @click="mobileOpen = false"
          >
            <span class="nav-symbol h-5 w-5 bg-rose-500/10 text-rose-500">
              <ListIcon name="ceremony" :size="20" />
            </span>
            <span class="flex-1">人生要有仪式感</span>
          </RouterLink>

          <!-- 清单行不再挂「笔」图标：右键（桌面）或长按（触屏）弹出菜单，里面有重命名 / 修改 / 删除。
               右键菜单藏起来的入口，所以这里不摆任何常驻按钮，侧栏更干净。 -->
          <div
            v-for="list in navLists"
            :key="list.id"
            class="group/list flex items-center"
            @contextmenu.prevent.stop="openListMenu(list, $event)"
            @touchstart.passive="onListTouchStart(list, $event)"
            @touchmove.passive="cancelListLongPress"
            @touchend="cancelListLongPress"
            @touchcancel="cancelListLongPress"
            @click.capture="onListRowClick"
          >
            <RouterLink
              :to="`/admin/list/${list.id}`"
              :title="railActive ? list.name : `右键（手机上长按）可重命名、改颜色或删除「${list.name}」`"
              class="nav-row min-w-0 flex-1"
              :class="{ 'nav-row-active': route.path === `/admin/list/${list.id}` }"
              @click="mobileOpen = false"
            >
              <!-- 图标（形状识别清单）+ 清单色着色；原来是同色圆点，颜色一多就分不清 -->
              <span
                class="nav-list-icon"
                :style="{ color: listColor(list.color), background: listColor(list.color) + '1f' }"
                :data-list-icon="list.icon || 'list'"
              >
                <ListIcon :name="list.icon" :size="14" />
              </span>
              <!-- 重命名就地改：回车保存、Esc 取消，不弹窗 -->
              <input
                v-if="renamingListId === list.id"
                ref="renameInput"
                v-model="renameDraft"
                class="min-w-0 flex-1 rounded-lg border border-brand-500/40 bg-surface px-2 py-1 text-sm font-semibold outline-none"
                maxlength="40"
                :aria-label="`重命名清单「${list.name}」`"
                @click.stop.prevent
                @keydown.enter.prevent="commitRename(list)"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename(list)"
              />
              <span v-else class="flex min-w-0 flex-1 items-center gap-1">
                <span class="truncate">{{ list.name }}</span>
              </span>
              <!-- 默认清单标识；改默认清单在「偏好设置」里操作 -->
              <span v-if="list.is_default" class="rail-hide shrink-0 text-amber-400" title="默认清单" aria-label="默认清单">
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor"><path d="m12 3.6 2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.87l-5.2 2.75.99-5.8-4.21-4.1 5.82-.85L12 3.6Z"/></svg>
              </span>
              <span v-if="list.open_count" class="nav-count">{{ list.open_count }}</span>
            </RouterLink>
          </div>
        </nav>

        <div class="border-t border-border/70 px-2 pb-2 pt-2">
          <!-- 设置区可折叠：折叠后清单列表能多显示好几项。
               默认折叠，展开状态记在本地。
               这一条用浅蓝底 + 齿轮图标凸显：它是侧栏里唯一的「入口」而不是「页面」，
               以前只用一行灰色小字，扫一眼容易漏掉。 -->
          <button
            type="button"
            class="nav-settings-toggle flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
            :aria-expanded="settingsOpen"
            :title="railActive ? '设置' : undefined"
            aria-controls="sidebar-settings"
            @click="toggleSettings"
          >
            <span class="nav-symbol h-7 w-7 bg-brand-500/20 text-brand-600 dark:text-brand-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M10.3 3.6a2 2 0 0 1 3.4 0l.5.9a1.6 1.6 0 0 0 1.9.8l1-.3a2 2 0 0 1 2.4 2.4l-.3 1a1.6 1.6 0 0 0 .8 1.9l.9.5a2 2 0 0 1 0 3.4l-.9.5a1.6 1.6 0 0 0-.8 1.9l.3 1a2 2 0 0 1-2.4 2.4l-1-.3a1.6 1.6 0 0 0-1.9.8l-.5.9a2 2 0 0 1-3.4 0l-.5-.9a1.6 1.6 0 0 0-1.9-.8l-1 .3a2 2 0 0 1-2.4-2.4l.3-1a1.6 1.6 0 0 0-.8-1.9l-.9-.5a2 2 0 0 1 0-3.4l.9-.5a1.6 1.6 0 0 0 .8-1.9l-.3-1A2 2 0 0 1 6.9 5l1 .3a1.6 1.6 0 0 0 1.9-.8l.5-.9Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.1" stroke-width="1.7"/></svg>
            </span>
            <span class="rail-hide text-xs font-extrabold tracking-[.08em] text-brand-700 dark:text-brand-200">设置</span>
            <span v-if="!settingsOpen && hiddenSettingCount" class="nav-count">{{ hiddenSettingCount }}</span>
            <svg
              viewBox="0 0 24 24"
              class="rail-hide ml-auto h-4 w-4 shrink-0 text-brand-600/80 transition-transform duration-200 dark:text-brand-300/80"
              :class="{ 'rotate-180': settingsOpen }"
              fill="none" stroke="currentColor" aria-hidden="true"
            ><path d="m6 15 6-6 6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div v-show="settingsOpen" id="sidebar-settings" class="max-h-[46vh] overflow-y-auto px-1 pb-3 pt-1">
          <RouterLink to="/admin/channels" class="nav-row" :class="{ 'nav-row-active': route.path === '/admin/channels' }" :title="railActive ? '通知方式' : undefined">
            <span class="nav-symbol bg-violet-500/12 text-violet-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 12h8m-8 4h5m6-11H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4l3 3 3-3h4a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span class="flex-1">通知方式</span>
          </RouterLink>
          <RouterLink to="/admin/settings" class="nav-row" :class="{ 'nav-row-active': route.path === '/admin/settings' }" :title="railActive ? '偏好设置' : undefined">
            <span class="nav-symbol bg-slate-500/10 text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.38.35.72.65 1 .3.28.7.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span class="flex-1">偏好设置</span>
          </RouterLink>
          <template v-if="authStore.isAdmin">
            <p class="nav-caption mt-3">系统管理</p>
            <RouterLink v-for="item in adminNav" :key="item.to" :to="item.to" class="nav-row" :class="{ 'nav-row-active': isActive(item.to) }" :title="railActive ? item.label : undefined">
              <span class="nav-symbol" :class="item.tone" v-html="item.icon"></span>
              <span class="flex-1">{{ item.label }}</span>
            </RouterLink>
          </template>

          <!-- 版本信息：放在系统管理下方，点开是迭代说明与原项目信息 -->
          <p class="nav-caption mt-3">关于</p>
          <button type="button" class="nav-row w-full text-left" :title="railActive ? '版本信息' : '查看版本信息与迭代说明'" @click="versionOpen = true">
            <span class="nav-symbol bg-brand-500/12 text-brand-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 11v5.5M12 7.6v.01" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <span class="flex-1">版本信息</span>
            <span v-if="appVersion" class="version-badge">{{ appVersion }}</span>
          </button>
          </div>
        </div>
      </div>
    </aside>

    <div v-if="mobileOpen" class="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden" @click="mobileOpen = false"></div>

    <div class="shell min-h-screen" :class="railActive ? 'lg:pl-14' : 'lg:pl-[292px]'">
      <header class="topbar">
        <button class="icon-button" :aria-label="railCollapsed ? '展开侧栏' : '收起侧栏'" @click="toggleSidebar">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 7h16M4 12h16M4 17h16" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="hidden min-w-0 sm:block">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{{ dayLabel }}</p>
          <h2 class="truncate text-base font-bold">{{ greeting }}，{{ authStore.user?.username }}</h2>
        </div>
        <div class="ml-auto flex items-center gap-1 sm:gap-2">
          <RouterLink to="/admin/notifications" class="icon-button relative" aria-label="通知中心">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span v-if="summary.unread" class="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-red-500"></span>
          </RouterLink>
          <!-- 列表 / 日历 切换。放在主题按钮旁边，与它同为「换个看法」类操作。 -->
          <div
            v-if="showViewSwitch && !isNarrow"
            class="flex items-center gap-0.5 rounded-xl border border-border/70 bg-muted/55 p-0.5"
            role="group"
            aria-label="切换列表或日历视图"
          >
            <RouterLink
              :to="listRoute"
              class="inline-flex items-center gap-1 rounded-[0.6rem] px-2.5 py-2 text-xs font-bold transition"
              :class="!isCalendar ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              title="列表视图"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2" stroke-linecap="round"/></svg>
              <span class="hidden lg:inline">列表</span>
            </RouterLink>
            <RouterLink
              to="/admin/calendar"
              class="inline-flex items-center gap-1 rounded-[0.6rem] px-2.5 py-2 text-xs font-bold transition"
              :class="isCalendar ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              title="日历视图"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2.5" stroke-width="1.9"/><path d="M3 10h18M8 3v4m8-4v4" stroke-width="1.9" stroke-linecap="round"/></svg>
              <span class="hidden lg:inline">日历</span>
            </RouterLink>
          </div>
          <UiThemeToggle />
          <div class="mx-1 hidden h-7 w-px bg-border sm:block"></div>
          <RouterLink to="/admin/profile" class="flex items-center gap-2 rounded-xl p-1.5 pr-2 hover:bg-muted">
            <span class="avatar">{{ userInitial }}</span>
            <span class="hidden text-sm font-semibold md:block">{{ authStore.user?.username }}</span>
          </RouterLink>
          <button class="icon-button !hidden sm:!flex" aria-label="退出登录" @click="logout">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m15 17 5-5-5-5M20 12H9m2 8H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </header>

      <main class="px-4 pb-[calc(4.25rem+env(safe-area-inset-bottom))] pt-2.5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10 xl:px-10">
        <RouterView v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <nav class="mobile-tabbar" :class="{ 'mobile-tabbar-hidden': keyboardOpen }">
      <RouterLink to="/admin" class="mobile-tab" :class="{ active: route.path === '/admin' }"><span v-html="smartNav[0].icon"></span><small>今天</small></RouterLink>
      <RouterLink to="/admin/planned" class="mobile-tab" :class="{ active: route.path === '/admin/planned' }"><span v-html="smartNav[1].icon"></span><small>计划</small></RouterLink>
      <!-- 信用卡账单：手机端也要有直接入口（抽屉里也有，但底部标签是主要导航）。
           只有个人偏好打开、且确实有这一栏时才出现。 -->
      <RouterLink
        v-if="authStore.creditCardEnabled && cardBucket"
        :to="`/admin/list/${cardBucket.id}`"
        class="mobile-tab"
        :class="{ active: route.path === `/admin/list/${cardBucket.id}` }"
        data-tab-cards
      >
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke-width="1.8"/><path d="M2.5 10h19M6 13.5h4" stroke-width="1.8" stroke-linecap="round"/></svg></span>
        <small>信用卡</small>
      </RouterLink>
      <RouterLink to="/admin/notifications" class="mobile-tab" :class="{ active: route.path === '/admin/notifications' }"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke-width="1.8" stroke-linecap="round"/></svg></span><small>通知</small></RouterLink>
      <RouterLink to="/admin/channels" class="mobile-tab" :class="{ active: route.path === '/admin/channels' }"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 12h8m-8 4h5m6-11H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4l3 3 3-3h4a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" stroke-width="1.8"/></svg></span><small>方式</small></RouterLink>
    </nav>

    <!-- 手机端「新建」改成**悬浮按钮**：脱离底部标签栏，右下角悬浮，键盘弹起/滚动时收起 -->
    <button
      v-if="canCreate"
      class="mobile-fab"
      :class="{ 'mobile-fab-hidden': keyboardOpen }"
      aria-label="新建提醒"
      data-mobile-fab
      @click="openQuickAdd"
    >
      <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>

    <Toast :message="realtimeToast" type="success" :duration="5000" />

    <!-- 站内提醒弹窗：PC 与手机一致，必须处理完才消失 -->
    <ReminderAlert
      :open="!!currentAlert"
      :title="currentAlert?.title || ''"
      :body="currentAlert?.body || ''"
      :created-at="currentAlert?.createdAt || ''"
      :pending-count="pendingAlertCount"
      :busy="alertBusy"
      :error="alertError"
      :snooze-label="`稍后提醒（${notifyMinutes} 分钟后）`"
      :ack-hint="ackHint"
      @ack="ackCurrentAlert"
      @snooze="snoozeCurrentAlert"
      @dismiss="dismissCurrentAlert"
    />

    <!-- 版本信息与迭代说明 -->
    <VersionDialog v-model="versionOpen" :version="appVersion" :build-time="appBuildTime" />

    <!-- 新建清单：先选模板（通用 / 信用卡），信用卡填完卡片信息自动生成还款计划 -->
    <ListCreateDialog
      v-model="creatingList"
      :default-color="['blue', 'violet', 'rose', 'amber', 'emerald'][navLists.length % 5]"
      @created="onListCreated"
    />

    <!-- 清单行的右键 / 长按菜单 -->
    <ContextMenu
      v-model:open="listMenu.open"
      :x="listMenu.x"
      :y="listMenu.y"
      :heading="listMenu.list?.name || ''"
      :items="listMenuItems"
      @select="onListMenuSelect"
    />

    <!-- 删除清单的确认浮层（与提醒删除同一套） -->
    <ConfirmDialog
      v-model="deleteListVisible"
      danger
      title="删除这个清单？"
      :message="`「${deleteListTarget?.name || ''}」里的提醒会移到默认清单，清单本身删除后无法恢复。`"
      confirm-text="删除清单"
      loading-text="删除中…"
      :loading="deleteListLoading"
      @confirm="confirmDeleteList"
    />

    <!-- 编辑清单：改名 / 换颜色。颜色是清单的属性，改完侧栏圆点、列表页任务标题、
         日历格子与详情面板一起变（前两者靠这里的 refreshNavigation + 广播数据变更事件，
         日历靠监听同一个事件重拉数据）。 -->
    <Modal v-model="listEditorOpen" :title="`编辑清单「${listEditorOriginalName}」`">
      <div class="space-y-4">
        <label class="block">
          <span class="text-xs font-bold text-foreground">名称</span>
          <input
            v-model="listEditorName"
            class="input-field mt-1.5 !py-2"
            maxlength="40"
            placeholder="清单名称"
            @keydown.enter.prevent="submitListEditor"
          />
        </label>

        <div>
          <span class="text-xs font-bold text-foreground">颜色</span>
          <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
            这个颜色用于侧栏圆点、清单里的任务标题和日历上的色块；改完立即生效。
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="清单颜色">
            <button
              v-for="color in LIST_COLOR_NAMES"
              :key="color"
              type="button"
              role="radio"
              :aria-checked="listEditorColor === color"
              :data-list-color="color"
              :aria-label="listColorLabel(color)"
              :title="listColorLabel(color)"
              class="flex h-9 w-9 items-center justify-center rounded-full border-2 transition"
              :class="listEditorColor === color ? 'border-foreground/60 scale-105' : 'border-transparent hover:scale-105'"
              @click="listEditorColor = color"
            >
              <span class="h-6 w-6 rounded-full" :style="{ background: listColor(color) }"></span>
            </button>
          </div>
        </div>

        <div>
          <span class="text-xs font-bold text-foreground">图标</span>
          <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
            侧栏与日历里用这个图标标识清单；颜色仍用于任务标题与日历色块。
          </p>
          <div class="mt-2 grid grid-cols-8 gap-1.5 sm:grid-cols-10" role="radiogroup" aria-label="清单图标">
            <button
              v-for="icon in LIST_ICONS"
              :key="icon.key"
              type="button"
              role="radio"
              :aria-checked="listEditorIcon === icon.key"
              :aria-label="icon.label"
              :title="icon.label"
              class="flex h-8 w-8 items-center justify-center rounded-lg border transition"
              :class="listEditorIcon === icon.key
                ? 'border-brand-500 bg-brand-500/12 text-brand-600 dark:text-brand-300'
                : 'border-border text-muted-foreground hover:border-brand-500/40 hover:text-foreground'"
              :data-list-icon-option="icon.key"
              @click="listEditorIcon = icon.key"
            >
              <ListIcon :name="icon.key" :size="16" />
            </button>
          </div>
        </div>

        <p v-if="listEditorError" class="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{{ listEditorError }}</p>

        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary !h-10" :disabled="listEditorSaving" @click="listEditorOpen = false">取消</button>
          <button type="button" class="btn-brand" :disabled="listEditorSaving || !listEditorDirty" @click="submitListEditor">
            {{ listEditorSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import Toast from '../components/Toast.vue'
import VersionDialog from '../components/VersionDialog.vue'
import Modal from '../components/Modal.vue'
import ListCreateDialog from '../components/ListCreateDialog.vue'
import ListIcon from '../components/ListIcon.vue'
import { LIST_ICONS } from '../utils/list-icons'
import ContextMenu from '../components/ContextMenu.vue'
import { isNarrowNow, useIsNarrow } from '../utils/use-narrow'
import type { ContextMenuItem } from '../components/ContextMenu.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import UiThemeToggle from '../components/ui/ThemeToggle.vue'
import ReminderAlert from '../components/ReminderAlert.vue'
import { useAuthStore } from '../stores/auth'
import {
  completeReminder,
  getLists,
  getNotifications,
  getRevision,
  getSummary,
  markNotificationRead,
  deleteList,
  snoozeReminder,
  updateList,
  type ReminderList,
} from '../api/reminder'
import { getAllConfigs, getVersion } from '../api/config'
import { connectReminderEvents, type RealtimeNotification, type ReminderRealtimeEvent } from '../services/reminderRealtime'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel } from '../utils/list-colors'
import { onFnOSGatewayOrigin } from '../utils/gateway'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const mobileOpen = ref(false)

// 界面折叠状态记在本地：这类偏好跟人走、跟设备走，不必上服务端。
const lsGet = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const lsSet = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* 隐私模式忽略 */ } }

// 桌面端把侧栏收成抽屉，内容区就能宽出来；手机端仍走原来的抽屉打开逻辑。
// 桌面折叠态。railCollapsed 是**用户偏好**（记在本地），railForced 是「当前视图
// 临时要求收成图标栏」（日历视图）——两者分开，进日历自动收起就不会把用户偏好改掉，
// 离开日历时能原样还原。手机端这两者都不影响抽屉（CSS 里的规则都带 lg: 前缀）。
const railCollapsed = ref(lsGet('ui_rail_collapsed') === '1')
const railForced = ref(false)
const railActive = computed(() => railCollapsed.value || railForced.value)
// 底部「设置」组**默认收起**，给清单列表腾出更多竖向空间；
// 而且**不记状态**：展开只是为了点一次里面的入口，刷新/重进页面就回到收起
// （用户要求：「点击刷新默认状态收起状态」）。
const settingsOpen = ref(false)

const lists = ref<ReminderList[]>([])
// 侧栏「我的清单」里只列普通清单：信用卡账单与记事本是上面那两个固定栏目，
// 不混在里面（也不出现在「新建提醒的清单下拉」里）。
// 「我的清单」里只列普通清单：信用卡账单 / 记事本 / 人生要有仪式感都是上面的**固定栏目**，
// 它们不该再作为普通清单出现一次 —— 否则「人生要有仪式感」会出现两行，而且普通清单那一行
// 不受偏好控制（用户报的「重复出现，有一个不受后台管理」就是这个）。
const navLists = computed(() => lists.value.filter(
  (l) => l.template !== 'credit_card' && l.template !== 'notebook' && l.template !== 'ceremony',
))
const cardBucket = computed(() => lists.value.find((l) => l.template === 'credit_card') || null)
const noteBucket = computed(() => lists.value.find((l) => l.template === 'notebook') || null)
const ceremonyBucket = computed(() => lists.value.find((l) => l.template === 'ceremony') || null)
const summary = ref<Record<string, number>>({})
const creatingList = ref(false)
const realtimeToast = ref('')
const appVersion = ref('')
const appBuildTime = ref('')
// 页面打开时看到的构建提交号；之后每 5 分钟（以及页面回到前台时）对一次，
// 变了就说明服务端已经换版本了 —— 提醒用户刷新，别让旧页面里的老行为误导人。
const seenCommit = ref('')
const staleBundle = ref<{ version: string; commit: string } | null>(null)
const staleDismissed = ref(false)
const versionOpen = ref(false)

const icons = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="3" stroke-width="1.8"/><path d="M8 3v4m8-4v4M4 10h16" stroke-width="1.8" stroke-linecap="round"/><path d="M9 15h6" stroke-width="2" stroke-linecap="round"/></svg>',
  planned: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 7v5l3.2 2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2" stroke-linecap="round"/></svg>',
  completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="m8 12 2.7 2.7L16.5 9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

const smartNav = [
  { to: '/admin', label: '今天', key: 'today', tone: 'bg-blue-500/12 text-blue-500', icon: icons.today },
  { to: '/admin/planned', label: '计划', key: 'planned', tone: 'bg-amber-500/12 text-amber-500', icon: icons.planned },
  { to: '/admin/all', label: '全部', key: 'all', tone: 'bg-violet-500/12 text-violet-500', icon: icons.all },
  { to: '/admin/completed', label: '已完成', key: 'completed', tone: 'bg-emerald-500/12 text-emerald-500', icon: icons.completed },
]
const adminNav = [
  { to: '/admin/users', label: '用户管理', tone: 'bg-blue-500/12 text-blue-500', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.6a3.5 3.5 0 0 1 0 6.79" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { to: '/admin/configs', label: '系统配置', tone: 'bg-violet-500/12 text-violet-500', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.38.35.72.65 1 .3.28.7.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { to: '/admin/audit', label: '操作日志', tone: 'bg-amber-500/12 text-amber-500', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="4" width="14" height="17" rx="2" stroke-width="1.8"/><path d="M9 4h6v3H9zM9 11h6M9 15h4" stroke-width="1.8" stroke-linecap="round"/></svg>' },
]

const userInitial = computed(() => (authStore.user?.username || 'R').charAt(0).toUpperCase())
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'
})
const dayLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()))

function isActive(to: string) {
  return to === '/admin' ? route.path === '/admin' : route.path === to
}

// 列表 / 日历 两种看法。只在提醒相关的页面上出现——系统配置、用户管理这些
// 页面切到日历没有意义。
const viewSwitchRoutes = ['Home', 'Planned', 'AllReminders', 'Completed', 'ReminderList', 'Calendar']
// 手机上没有日历视图（入口隐藏 + 路由守卫兜底），所以顶栏那组「列表 / 日历」切换也收起来
const isNarrow = useIsNarrow()
const showViewSwitch = computed(() => !isNarrow.value && viewSwitchRoutes.includes(String(route.name || '')))
const isCalendar = computed(() => route.name === 'Calendar')
// 从日历切回列表时回到「今天」，而不是记住上次那个智能清单：日历不区分清单，
// 回来落在固定的入口更符合直觉。
const listRoute = computed(() => (route.name === 'ReminderList' ? route.path : '/admin'))
// 左上角这块在手机上只承担「回到列表」：不再出现任何日历相关的提示文字
const logoTitle = computed(() => (isNarrow.value
  ? '回到列表视图'
  : railActive.value
    ? (isCalendar.value ? '切到列表视图' : '切到日历视图')
    : (isCalendar.value ? '点这里切回列表视图' : '点这里切到日历视图')))
const logoAria = computed(() => (isNarrow.value
  ? '回到列表视图'
  : isCalendar.value ? '切换到列表视图' : '切换到日历视图'))
const logoSubtitle = computed(() => (isNarrow.value
  ? '点一下回到列表'
  : isCalendar.value ? '点一下回到列表' : '点一下切到日历'))

// 日历是「看」的视图，不在那里新建内容：新建入口（侧栏大按钮、手机底部 +）一并隐藏。
// 需要新建时先切回列表视图。
const canCreate = computed(() => route.name !== 'Calendar')

// 折叠后设置组里藏了几项，给个小角标提示还有东西
const hiddenSettingCount = computed(() => 2 + (authStore.isAdmin ? adminNav.length : 0) + 1)

function toggleSidebar() {
  // 桌面：停靠 / 折叠；手机：抽屉开合。用媒体查询区分，避免两套按钮。
  if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
    // 翻转的是**当前看到的状态**（railActive），不是偏好本身：在日历里被临时收起时，
    // 点一下应当展开（而不是把偏好翻成 true 继续收着——那样点了没反应）。
    // 用户手动决定之后，日历的临时收起也不再压着他。
    const next = !railActive.value
    railForced.value = false
    railCollapsed.value = next
    lsSet('ui_rail_collapsed', next ? '1' : '0')
  } else {
    mobileOpen.value = true
  }
}
function toggleSettings() {
  // 只在内存里开合，不落 localStorage —— 刷新后回到默认（收起）。
  settingsOpen.value = !settingsOpen.value
}
// 切到其它页面时把手机抽屉收起（点导航项已经处理，这里兜住路由变化）
watch(() => route.fullPath, () => { mobileOpen.value = false })

// 日历视图里侧栏基本用不上（日历要的是横向空间），进这一页自动收成图标栏；
// 离开自动还原用户偏好。只看「路由变化」这一个事件，所以用户在日历里手动展开
// 之后不会被反复强行收起（手动动过就清掉临时态，见 toggleSidebar）。
watch(() => route.path, (path) => {
  railForced.value = path.startsWith('/admin/calendar')
}, { immediate: true })
// 清单色表已抽到 utils/list-colors.ts（侧栏/筛选/列表标题/日历共用一份）。
const listColor = listColorHex
function openQuickAdd() {
  if (!route.path.startsWith('/admin') || ['notifications', 'channels', 'settings', 'profile'].some(x => route.path.includes(x))) router.push('/admin')
  mobileOpen.value = false
  setTimeout(() => window.dispatchEvent(new CustomEvent('open-quick-reminder')), 80)
}
// ---- 左上角 logo：列表 / 日历 一键切换 ----
// 顶栏右侧那个「列表 / 日历」开关仍然保留（只在提醒相关页面出现），这里是从 logo 直接切。
function toggleViewFromLogo() {
  // 手机上没有日历视图，这一步永远只是「回到列表」
  if (isNarrow.value || isCalendar.value) router.push(listRoute.value)
  else router.push('/admin/calendar')
}


// ---- 清单行的右键 / 长按菜单：重命名、修改、删除 ----
const listMenu = reactive<{ open: boolean; x: number; y: number; list: ReminderList | null }>({
  open: false, x: 0, y: 0, list: null,
})
const listMenuItems = computed<ContextMenuItem[]>(() => {
  const target = listMenu.list
  return [
    {
      key: 'rename', label: '重命名',
      icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 7h10M4 12h16M4 17h7" stroke-width="1.8" stroke-linecap="round"/></svg>',
    },
    {
      key: 'edit', label: '修改（名称 / 颜色）',
      icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    {
      key: 'default', label: '设为默认清单',
      disabled: !!target?.is_default,
      title: target?.is_default ? '它已经是默认清单' : '新建提醒不带清单时放进这里',
      icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor"><path d="m12 3.6 2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.87l-5.2 2.75.99-5.8-4.21-4.1 5.82-.85L12 3.6Z"/></svg>',
    },
    {
      key: 'delete', label: '删除清单', danger: true,
      disabled: !!target?.is_default,
      title: target?.is_default ? '默认清单不能删除' : '里面的提醒会移到默认清单',
      icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
  ]
})

function openListMenu(list: ReminderList, event: MouseEvent) {
  listMenu.x = event.clientX || 0
  listMenu.y = event.clientY || 0
  listMenu.list = list
  listMenu.open = true
}

function onListMenuSelect(key: string) {
  const list = listMenu.list
  if (!list) return
  if (key === 'rename') startRename(list)
  else if (key === 'edit') openListEditor(list)
  else if (key === 'default') void makeDefaultList(list)
  else if (key === 'delete') askDeleteList(list)
}

// 触屏：长按 550ms 开同一个菜单；长按触发后要吃掉随后那次 click，
// 否则手指抬起会顺带跳进这个清单。
let listPressTimer: ReturnType<typeof setTimeout> | null = null
let suppressListClick = false

function onListTouchStart(list: ReminderList, event: TouchEvent) {
  cancelListLongPress()
  const touch = event.touches[0]
  if (!touch) return
  const point = { clientX: touch.clientX, clientY: touch.clientY }
  listPressTimer = setTimeout(() => {
    listPressTimer = null
    suppressListClick = true
    // 合成一个 MouseEvent：菜单只需要坐标
    openListMenu(list, point as MouseEvent)
    setTimeout(() => { suppressListClick = false }, 700)
  }, 550)
}

function cancelListLongPress() {
  if (listPressTimer) {
    clearTimeout(listPressTimer)
    listPressTimer = null
  }
}

function onListRowClick(e: MouseEvent) {
  if (!suppressListClick) return
  suppressListClick = false
  e.preventDefault()
  e.stopPropagation()
}

// ---- 重命名（就地改，不弹窗）----
const renamingListId = ref(0)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

async function startRename(list: ReminderList) {
  renamingListId.value = list.id
  renameDraft.value = list.name
  await nextTick()
  const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
  el?.focus()
  el?.select()
}

function cancelRename() {
  renamingListId.value = 0
  renameDraft.value = ''
}

async function commitRename(list: ReminderList) {
  if (renamingListId.value !== list.id) return
  const name = renameDraft.value.trim()
  cancelRename()
  if (!name || name === list.name) return
  try {
    await updateList(list.id, { name })
    await refreshNavigation()
    notifyDataChanged('list', 'updated', list.id)
  } catch (err: any) {
    realtimeToast.value = err?.response?.data?.message || '重命名失败'
  }
}

// ---- 设为默认 / 删除清单 ----
async function makeDefaultList(list: ReminderList) {
  try {
    await updateList(list.id, { is_default: true })
    await refreshNavigation()
    notifyDataChanged('list', 'updated', list.id)
    realtimeToast.value = `已把「${list.name}」设为默认清单`
  } catch (err: any) {
    realtimeToast.value = err?.response?.data?.message || '设置失败'
  }
}

const deleteListVisible = ref(false)
const deleteListTarget = ref<ReminderList | null>(null)
const deleteListLoading = ref(false)

function askDeleteList(list: ReminderList) {
  deleteListTarget.value = list
  deleteListVisible.value = true
}

async function confirmDeleteList() {
  const target = deleteListTarget.value
  if (!target) return
  deleteListLoading.value = true
  try {
    await deleteList(target.id)
    deleteListVisible.value = false
    await refreshNavigation()
    notifyDataChanged('list', 'deleted', target.id)
    realtimeToast.value = `已删除清单「${target.name}」`
    // 正停在这个清单页上时回首页，否则页面会因为清单没了而空白
    if (route.path === `/admin/list/${target.id}`) router.push('/admin')
  } catch (err: any) {
    realtimeToast.value = err?.response?.data?.message || '删除失败'
  } finally {
    deleteListLoading.value = false
  }
}

// 数据变更广播：列表页 / 日历页监听 reminder-realtime 重拉（与编辑清单同一套）
function notifyDataChanged(scope: string, action: string, targetId: number) {
  const event: ReminderRealtimeEvent = {
    type: 'reminders.changed', scope, action, target_id: targetId, sent_at: new Date().toISOString(),
  }
  window.dispatchEvent(new CustomEvent('reminder-realtime', { detail: event }))
  window.dispatchEvent(new CustomEvent('reminder-data-changed'))
}

// ---- 编辑清单（改名 / 换颜色）----
const listEditorOpen = ref(false)
const listEditorId = ref(0)
const listEditorOriginalName = ref('')
const listEditorName = ref('')
const listEditorColor = ref<string>('blue')
const listEditorOriginalColor = ref<string>('blue')
const listEditorIcon = ref<string>('list')
const listEditorOriginalIcon = ref<string>('list')
const listEditorSaving = ref(false)
const listEditorError = ref('')

const listEditorDirty = computed(() =>
  listEditorName.value.trim() !== listEditorOriginalName.value
  || listEditorColor.value !== listEditorOriginalColor.value
  || listEditorIcon.value !== listEditorOriginalIcon.value,
)

function openListEditor(list: ReminderList) {
  listEditorId.value = list.id
  listEditorOriginalName.value = list.name
  listEditorName.value = list.name
  listEditorColor.value = list.color || 'blue'
  listEditorOriginalColor.value = list.color || 'blue'
  listEditorIcon.value = list.icon || 'list'
  listEditorOriginalIcon.value = list.icon || 'list'
  listEditorError.value = ''
  listEditorOpen.value = true
}

async function submitListEditor() {
  if (listEditorSaving.value) return
  const name = listEditorName.value.trim()
  if (!name) {
    listEditorError.value = '清单名称不能为空'
    return
  }
  listEditorSaving.value = true
  listEditorError.value = ''
  try {
    await updateList(listEditorId.value, { name, color: listEditorColor.value, icon: listEditorIcon.value })
    listEditorOpen.value = false
    await refreshNavigation()
    // 广播「数据变了」：HomeView 与 CalendarView 监听 reminder-realtime 重拉自己的
    // 数据，于是颜色改动会立刻反映到列表页的任务标题和**已经打开的日历**上。
    // 事件形状与后端推送的保持一致（scope=list, action=updated），这样本机改动和
    // 另一台设备的改动走同一条刷新路径，不必为「本地」再写一套。
    notifyDataChanged('list', 'updated', listEditorId.value)
  } catch (err: any) {
    listEditorError.value = err?.response?.data?.message || '保存失败'
  } finally {
    listEditorSaving.value = false
  }
}

// 新建清单成功后：刷新侧栏，并直接进这个清单（信用卡清单进去就能看到还款计划）
async function onListCreated(created: { id: number }) {
  await refreshNavigation()
  if (created?.id) await router.push(`/admin/list/${created.id}`)
}
async function refreshNavigation() {
  try {
    const [listRes, summaryRes] = await Promise.all([getLists(), getSummary()])
    lists.value = listRes.data.data || []
    summary.value = summaryRes.data.data || {}
  } catch {}
}
async function loadVersion() {
  try {
    const res = await getVersion()
    const info = res.data?.data
    appVersion.value = info?.version || ''
    appBuildTime.value = info?.buildTime || ''
    const commit = String(info?.gitCommit || '')
    if (!seenCommit.value) {
      seenCommit.value = commit
      return
    }
    if (commit && commit !== seenCommit.value) {
      staleBundle.value = { version: info?.version || '', commit }
    }
  } catch {
    /* a version label must never block the main application */
  }
}
function reloadPage() { window.location.reload() }

// 服务端换版本的检测：每 5 分钟一次，加上「页面回到前台」时顺手查一次
// （旧页面长期开着不动，也能发现自己已经落后于服务端了）。
const VERSION_POLL_MS = 5 * 60_000
let versionTimer: number | undefined
function logout() {
  stopRealtime?.()
  // 服务端要先记下「主动登出」才轮得到清本地：网关域上只清前端会被网关注入的
  // NAS 身份立刻认回来，那正是用户报的「退不出去」（见 stores/auth.ts）。
  void authStore.endSession()
  router.push('/login')
}

// 飞牛授权只是身份来源，应用自己的登录态永远可以独立退出——网关域上也一样。
// 唯一需要跟随 NAS 的情况是「用户没在本应用显式登录过、当前登录态完全由网关
// 注入身份撑着」（authStore.followsFnOSSession），那时 NAS 一退出应用也就无法
// 再被认证，页面会自动回到登录页。

let stopRealtime: (() => void) | undefined
let audioContext: AudioContext | undefined

function unlockReminderSound() {
  if (!audioContext) audioContext = new AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
}

function playReminderSound() {
  if (!audioContext || audioContext.state !== 'running') return
  const start = audioContext.currentTime
  const gain = audioContext.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8)
  gain.connect(audioContext.destination)

  ;[
    { frequency: 659.25, offset: 0, duration: 0.32 },
    { frequency: 987.77, offset: 0.2, duration: 0.5 },
  ].forEach(note => {
    const oscillator = audioContext!.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, start + note.offset)
    oscillator.connect(gain)
    oscillator.start(start + note.offset)
    oscillator.stop(start + note.offset + note.duration)
  })
}

// 站内提醒弹窗队列：提醒到点可能一次来好几条（多个提醒同一分钟到期），排队逐条
// 处理，处理完一条自动上下一条。用 notification id 去重，避免重连后重复入队。
interface DueAlert {
  notificationID: number
  reminderID?: number
  title: string
  body: string
  createdAt: string
}

const alertQueue = ref<DueAlert[]>([])
const alertBusy = ref(false)
const alertError = ref('')
const currentAlert = computed(() => alertQueue.value[0] || null)
const pendingAlertCount = computed(() => Math.max(alertQueue.value.length - 1, 0))
// 提醒频率来自偏好设置（个人偏好）：未处理多久再提醒、点「知道了」后多久再提醒
const notifyMinutes = computed(() => authStore.reminderNotifyMinutes || 10)
const ackMinutes = computed(() => authStore.reminderAckMinutes || 0)
const ackHint = computed(() => (ackMinutes.value > 0
  ? `点「知道了」后 ${ackMinutes.value} 分钟再提醒；要完成请到列表里勾选`
  : '点「知道了」后今天不再提示，明天同一时间继续提醒；要完成请到列表里勾选'))

function enqueueDueAlert(notification: ReminderRealtimeEvent['notification']) {
  if (!notification || notification.type !== 'reminder_due') return
  if (alertQueue.value.some(item => item.notificationID === notification.id)) return
  alertQueue.value.push({
    notificationID: notification.id,
    reminderID: notification.reminder_id,
    title: notification.title,
    body: notification.body,
    createdAt: notification.created_at,
  })
}

function shiftAlert() {
  alertQueue.value.shift()
  alertError.value = ''
}

// 弹窗上的「完成 / 稍后提醒」都要改动提醒本身，因此除了跟进队列，还得让列表刷新；
// 服务端会把这次变更广播给同一账号的其它设备（本标签页被排除，自己手动刷）。
async function runAlertAction(action: () => Promise<unknown>) {
  if (alertBusy.value) return
  alertBusy.value = true
  alertError.value = ''
  try {
    await action()
    await acknowledgeCurrentAlert()
    shiftAlert()
    refreshNavigation()
    window.dispatchEvent(new CustomEvent('reminder-data-changed'))
  } catch (error: any) {
    // 提醒已经不在了（删掉卡片/提醒后，服务端可能还留着没处理的到点通知）：
    // 这时「知道了 / 稍后提醒」都会 404「提醒或清单不存在」，弹窗原来会卡死
    // —— 用户报的就是这个（点知道了提示不存在、对话框再也关不掉）。
    // 目标都没了，这条通知就没意义了：直接标已读并关掉弹窗。
    if (isReminderGone(error)) {
      await acknowledgeCurrentAlert()
      shiftAlert()
      refreshNavigation()
      window.dispatchEvent(new CustomEvent('reminder-data-changed'))
      realtimeToast.value = '这条提醒已经不在了，弹窗已为你关掉'
      return
    }
    alertError.value = error?.response?.data?.message || '操作失败，请重试'
  } finally {
    alertBusy.value = false
  }
}

/** 服务端 404 的统一文案是「提醒或清单不存在」；拿不到状态码时兜底看文案。 */
function isReminderGone(error: any): boolean {
  const status = error?.response?.status
  const message = String(error?.response?.data?.message || '')
  return status === 404 || /不存在/.test(message)
}

/** 操作失败时的兜底出口：只关掉这条弹窗（不动提醒），保证用户不会被困住。 */
function dismissCurrentAlert() {
  void acknowledgeCurrentAlert().finally(() => shiftAlert())
}

// 处理过的站内提醒标记为已读，未读小红点才会跟着消失。
async function acknowledgeCurrentAlert() {
  const alert = currentAlert.value
  if (!alert) return
  try {
    await markNotificationRead(alert.notificationID)
  } catch {
    // 已读只是角标状态，失败不该拦住「完成 / 稍后提醒」这类主操作。
  }
}

/** 「知道了」之后什么时刻再提醒：按偏好（0 = 第二天同一时刻）。 */
function ackUntil(): string {
  if (ackMinutes.value > 0) return new Date(Date.now() + ackMinutes.value * 60_000).toISOString()
  const t = new Date()
  t.setDate(t.getDate() + 1) // 明天同一时间
  return t.toISOString()
}

// 「知道了」是弹窗的主操作：顺延到偏好设定的时间（默认第二天），当天不再提示；
// 想真正完成就去列表里勾选——弹窗上不再放「完成」，避免误点把事办了。
function ackCurrentAlert() {
  const alert = currentAlert.value
  if (!alert) return
  void runAlertAction(async () => {
    if (alert.reminderID) await snoozeReminder(alert.reminderID, ackUntil())
  })
}

function snoozeCurrentAlert() {
  const alert = currentAlert.value
  if (!alert) return
  void runAlertAction(async () => {
    if (!alert.reminderID) return
    const until = new Date(Date.now() + notifyMinutes.value * 60_000).toISOString()
    await snoozeReminder(alert.reminderID, until)
  })
}

function handleRealtimeEvent(event: ReminderRealtimeEvent) {
  // 数据变更（别的设备/窗口增删改了提醒、清单、通知、渠道）：本机不重新拉数据就会
  // 一直显示旧内容，这正是「手机端加了，PC 端看不到」的原因。
  if (event.type === 'reminders.changed') {
    lastRevision = event.revision ?? lastRevision
    refreshNavigation()
    window.dispatchEvent(new CustomEvent('reminder-realtime', { detail: event }))
    window.dispatchEvent(new CustomEvent('reminder-data-changed'))
    return
  }

  if (event.type !== 'notification.created' || !event.notification) return
  if (event.revision) lastRevision = event.revision
  window.dispatchEvent(new CustomEvent('reminder-realtime', { detail: event }))
  window.dispatchEvent(new CustomEvent('reminder-data-changed'))
  // 站内提醒：手机端也能看到的弹窗（toast 在小屏上太容易被忽略，也容易被底部
  // 标签栏挡住）。其它类型（例如渠道投递失败）继续保持轻量的 toast。
  if (event.notification.type === 'reminder_due') {
    enqueueDueAlert(event.notification)
    realtimeToast.value = ''
    playReminderSound()
    return
  }
  realtimeToast.value = ''
  setTimeout(() => {
    realtimeToast.value = event.notification?.title || ''
  }, 0)
}

// 补弹错过的到点提醒。到点弹窗的唯一触发源本来是长连接推送的 notification.created
// 事件，但那条路要穿过飞牛统一网关的代理，响应被缓冲、手机切后台连接被系统掐断、
// 服务端重启，任何一种都会让事件丢掉——通知明明写进了通知中心，弹窗却永远不出现，
// 这正是「到时间了没有提示」。所以在修订号变化（以及刚进入应用）时拉一遍通知，
// 把还没处理的到点通知补进弹窗队列：弹窗上的三个操作（完成 / 稍后提醒 / 知道了）
// 都会把通知标为已读，处理过的不会再弹，未读的迟早要弹，正好符合“提醒必须被处理”。
const ALERT_RECOVERY_WINDOW_MS = 60 * 60 * 1000
// 页面打开前 60 分钟内到点且仍未读的也补弹：此刻打开应用，就该看到刚刚错过的提醒；
// 更早的留给通知中心的未读角标，避免离开几天回来被一屏旧弹窗轰炸。
const alertRecoverySince = new Date(Date.now() - ALERT_RECOVERY_WINDOW_MS)

async function recoverMissedAlerts() {
  try {
    const res = await getNotifications()
    const items = (res.data?.data || []) as RealtimeNotification[]
    let added = 0
    for (const item of items) {
      if (item.type !== 'reminder_due' || item.read_at) continue
      if (new Date(item.created_at).getTime() < alertRecoverySince.getTime()) continue
      const before = alertQueue.value.length
      enqueueDueAlert(item)
      added += alertQueue.value.length - before
    }
    if (added > 0) playReminderSound()
  } catch {
    // 拉取失败不拦主流程，下一次修订号变化还会再试。
  }
}

// 修订号轮询兜底：SSE 长连接要穿过飞牛统一网关那层代理，万一响应被代理缓冲，
// 事件就迟迟到不了前端。这里定时问一次「服务端的数据版本变了吗」，变了就重新
// 拉一遍——不依赖长连接一定通畅，「另一台设备改过了这边自动跟上」都能成立。
const REVISION_POLL_MS = 20000
let lastRevision = 0
let revisionTimer: number | undefined

async function pollRevision() {
  if (document.visibilityState !== 'visible' || !authStore.isAuthenticated) return
  try {
    const res = await getRevision()
    if (res.data?.code !== 0) return
    const revision = Number(res.data.data?.revision || 0)
    if (revision === lastRevision) return
    lastRevision = revision
    refreshNavigation()
    // 修订号变了说明服务端发生过事件，长连接没送到的到点通知在这里补弹。
    void recoverMissedAlerts()
    window.dispatchEvent(new CustomEvent('reminder-realtime-resume'))
    window.dispatchEvent(new CustomEvent('reminder-data-changed'))
  } catch {
    // 轮询失败什么都不用做：下一次再问。
  }
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') {
    refreshNavigation()
    window.dispatchEvent(new CustomEvent('reminder-realtime-resume'))
    // 回到前台时立刻核一次：手机端常见路径是切到飞牛 App 退出登录再切回来，
    // 等下一次轮询太慢，回来这一下就该已经回登录页了。
    void checkFnOSSession()
    // 另一台设备在后台期间改过数据，回到前台要立刻跟上，不等下一次轮询。
    void pollRevision()
    // 顺带核一下服务端版本：后台期间可能刚好发了新版本（今天一天连发几版）。
    void loadVersion()
  }
}

// NAS 侧退出登录后把应用一并登出（见 stores/auth.ts 的 dropIfFnOSSessionGone）。
// 服务端拒绝一切请求是兜底，但用户停在已登录界面上会一直看着报错，所以主动
// 定期核一次；只在会话确实归属 NAS 时才会真正发请求。
const FNOS_SESSION_POLL_MS = 45000
let fnosSessionTimer: number | undefined

async function checkFnOSSession() {
  if (await authStore.dropIfFnOSSessionGone()) {
    stopRealtime?.()
    router.push('/login')
  }
}

// 手机端键盘弹出时浏览器会压缩可视视口，fixed 定位的底部标签栏会跟着浮到
// 键盘上方、盖住正在输入的框。用 visualViewport 检测键盘（可视高度比布局
// 视口矮一大截即视为键盘弹出），弹出期间隐藏标签栏，收起后恢复。
const keyboardOpen = ref(false)
function syncKeyboardState() {
  const vv = window.visualViewport
  keyboardOpen.value = !!vv && window.innerHeight - vv.height > 120
}

// 只在本次会话的第一次进入时套用「默认首页」，之后用户点「今天」不该被再拽去日历。
let defaultViewApplied = false
async function applyDefaultViewOnce() {
  if (defaultViewApplied) return
  defaultViewApplied = true
  if (route.name !== 'Home') return
  try {
    const res = await getAllConfigs()
    // 手机上没有日历视图：默认首页即使设成「日历」，也按列表首页进
    if (res.data?.data?.default_view === 'calendar' && !isNarrowNow()) await router.replace({ name: 'Calendar' })
  } catch {
    /* 读不到就按列表首页来，不该因为一个偏好读失败挡住进入应用 */
  }
}

onMounted(() => {
  void applyDefaultViewOnce()
  refreshNavigation()
  loadVersion()
  window.visualViewport?.addEventListener('resize', syncKeyboardState)
  window.addEventListener('reminder-data-changed', refreshNavigation)
  document.addEventListener('pointerdown', unlockReminderSound, { once: true })
  document.addEventListener('keydown', unlockReminderSound, { once: true })
  document.addEventListener('visibilitychange', refreshWhenVisible)
  // 网关域上没有本地 JWT 也要连：那条路的身份来自网关注入的 X-Trim-*。
  if (authStore.token || onFnOSGatewayOrigin()) stopRealtime = connectReminderEvents(authStore.token, handleRealtimeEvent)
  fnosSessionTimer = window.setInterval(() => { void checkFnOSSession() }, FNOS_SESSION_POLL_MS)
  // 先问一次当前修订号作为基准，之后只处理「变了」的情况（见 pollRevision）。
  void pollRevision()
  // 进门先补一遍：应用没开着的时候到点且还没处理的提醒，打开就该看到。
  void recoverMissedAlerts()
  revisionTimer = window.setInterval(() => { void pollRevision() }, REVISION_POLL_MS)
  versionTimer = window.setInterval(() => { void loadVersion() }, VERSION_POLL_MS)
})
onBeforeUnmount(() => {
  stopRealtime?.()
  if (fnosSessionTimer !== undefined) window.clearInterval(fnosSessionTimer)
  if (revisionTimer !== undefined) window.clearInterval(revisionTimer)
  if (versionTimer !== undefined) window.clearInterval(versionTimer)
  audioContext?.close()
  window.visualViewport?.removeEventListener('resize', syncKeyboardState)
  window.removeEventListener('reminder-data-changed', refreshNavigation)
  document.removeEventListener('pointerdown', unlockReminderSound)
  document.removeEventListener('keydown', unlockReminderSound)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})
</script>

<style scoped>
/* 「服务已更新」提示条：固定在顶部中间，克制一点，点刷新就消失 */
.stale-bundle { @apply fixed left-1/2 top-3 z-[95] flex w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 items-center gap-2 rounded-2xl border border-brand-500/30 bg-surface/95 px-3 py-2 text-[12px] font-semibold shadow-[0_18px_40px_-24px_rgba(15,23,42,.6)] backdrop-blur sm:text-[13px]; }
.stale-bundle-text { @apply min-w-0 flex-1 leading-5 text-foreground; }
.stale-bundle-btn { @apply shrink-0 rounded-xl bg-brand-500 px-3 py-1 text-[12px] font-bold text-white transition hover:brightness-110; }

.ambient { position: fixed; inset: 0; z-index: -20; overflow: hidden; pointer-events: none; background: rgb(var(--color-background)); }
.ambient-orb { position: absolute; border-radius: 999px; filter: blur(110px); opacity: .16; }
.ambient-orb-one { width: 32rem; height: 32rem; left: 12%; top: -18rem; background: #60a5fa; }
.ambient-orb-two { width: 28rem; height: 28rem; right: -10rem; bottom: -12rem; background: #a78bfa; opacity: .11; }
/* 外壳禁止横向溢出：任何子元素意外撑宽都不会让整页能左右拖 */
.shell { overflow-x: clip; }
.sidebar { @apply fixed inset-y-0 left-0 z-50 w-[292px] -translate-x-full border-r border-border/80 bg-surface/90 backdrop-blur-2xl transition-transform duration-300; }
/* 手机：抽屉打开 */
.sidebar-open { @apply translate-x-0; }
/* 桌面：停靠在左侧常驻；不加这个类就是折叠成抽屉的状态 */
.sidebar-docked { @apply lg:translate-x-0; }
/* 折叠后桌面留一条 56px 的图标栏：只显示图标，文字与角标藏起来，
   鼠标悬停在图标上由 title 提示（浏览器原生提示，不会被侧栏的滚动容器裁掉）。 */
.sidebar-rail { @apply lg:translate-x-0 lg:w-14; }
.sidebar-rail .rail-hide { @apply lg:hidden; }
.sidebar-rail .nav-caption,
.sidebar-rail .nav-row > .flex-1,
.sidebar-rail .nav-count,
.sidebar-rail .version-badge { @apply lg:hidden; }
.sidebar-rail .nav-row,
.sidebar-rail .nav-settings-toggle { @apply lg:justify-center lg:gap-0 lg:px-0; }
.sidebar-rail .new-reminder-button { @apply lg:mx-auto lg:h-11 lg:w-11 lg:justify-center lg:gap-0 lg:px-0; }
.sidebar-rail nav { @apply lg:px-2; }
/* 56px 的图标栏里再挤一条滚动条，图标会被推得偏左（实测差 5px），而且视觉上很脏。
   仍然可以滚（滚轮/触摸），只是不显示滚动条。 */
.sidebar-rail nav { scrollbar-width: none; }
.sidebar-rail nav::-webkit-scrollbar { display: none; }
/* 「我的清单」那一行在图标栏里只剩一个 + 按钮，居中放 */
.sidebar-rail nav > div.mt-7 { @apply lg:justify-center lg:px-0; }
.sidebar-rail .mt-7 { @apply lg:mt-3; }
.logo-mark { @apply flex h-11 w-11 items-center justify-center rounded-[15px] bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_10px_30px_-10px_rgba(59,130,246,.75)]; }
.version-badge { @apply rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[11px] font-bold leading-none text-brand-600 dark:text-brand-300; }
.new-reminder-button { @apply flex h-12 items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 px-3.5 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(59,130,246,.8)] transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0; }
/* 折叠「设置」入口：浅蓝底 + 齿轮图标凸显。底色用品牌色低透明度叠加，
   在浅色与深色主题下都是「浅蓝」；展开时加深一点，表示这一组正在展开。 */
.nav-settings-toggle {
  @apply border border-brand-500/25 bg-brand-500/10 transition-colors hover:bg-brand-500/15;
}
.nav-settings-toggle[aria-expanded='true'] {
  @apply bg-brand-500/15;
}
.nav-caption { @apply px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground/75; }
.nav-row { @apply my-0.5 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground/80 transition-all hover:bg-muted hover:text-foreground; }
.nav-row-active { @apply bg-brand-500/10 text-brand-600 shadow-[inset_3px_0_0_rgb(var(--color-brand-500))] dark:text-brand-300; }
.nav-symbol { @apply flex h-8 w-8 items-center justify-center rounded-[10px]; }
/* 清单行的图标块：比原来的小圆点占位大一点，但比 nav-symbol 小，免得跟「智能清单」抢视线 */
.nav-list-icon { @apply flex h-6 w-6 shrink-0 items-center justify-center rounded-lg; }
.nav-symbol :deep(svg), .mobile-tab :deep(svg) { width: 18px; height: 18px; }
.nav-count { @apply min-w-6 rounded-full bg-muted px-1.5 py-0.5 text-center text-[10px] font-bold text-muted-foreground; }
.tiny-add { @apply flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground; }
.sub-link { @apply ml-11 block rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground; }
.topbar { @apply sticky top-0 z-30 flex h-12 items-center border-b border-border/70 bg-background/75 px-3.5 backdrop-blur-xl sm:h-16 sm:px-6 lg:h-[76px] lg:px-8 xl:px-10; }
.avatar { @apply flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-sm font-extrabold text-white shadow-sm sm:h-9 sm:w-9; }
/* 悬浮「新建」：右下角，浮在底部标签栏之上；手机端才有 */
.mobile-fab { @apply fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_16px_34px_-10px_rgba(59,130,246,.95)] transition-all duration-200 active:scale-95 lg:hidden; bottom: calc(5rem + env(safe-area-inset-bottom)); }
.mobile-fab-hidden { @apply pointer-events-none translate-y-24 opacity-0; }
.mobile-tabbar { @apply fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 flex h-14 items-center justify-around rounded-2xl border border-white/30 bg-surface/90 px-1.5 shadow-[0_14px_40px_-18px_rgba(15,23,42,.45)] backdrop-blur-2xl transition-all duration-200 lg:hidden; }
.mobile-tabbar-hidden { @apply pointer-events-none translate-y-28 opacity-0; }
.mobile-tab { @apply flex w-14 flex-col items-center gap-0.5 text-muted-foreground transition; }
.mobile-tab span { @apply flex h-6 w-6 items-center justify-center; }
.mobile-tab small { @apply text-[10px] font-semibold; }
.mobile-tab.active { @apply text-brand-500; }
.mobile-add { @apply -mt-6 flex h-12 w-12 items-center justify-center rounded-full border-4 border-background bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_12px_28px_-8px_rgba(59,130,246,.8)]; }
.page-enter-active, .page-leave-active { transition: opacity .18s ease, transform .18s ease; }
.page-enter-from { opacity: 0; transform: translateY(5px); }
.page-leave-to { opacity: 0; transform: translateY(-3px); }
@media (min-width: 1024px) { .mobile-only { display: none !important; } }
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .ambient-orb { display: none; }
  .sidebar, .topbar, .mobile-tabbar {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  /* 手机端禁用了 backdrop-blur，半透明底会让滚动内容透出来；
     改为不透明背景，接近原生导航栏的观感。 */
  .topbar { background: rgb(var(--color-background)); }
  .mobile-tabbar { background: rgb(var(--color-surface)); }
}
</style>
