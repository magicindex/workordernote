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

        <!-- 左上角入口：「呼叫小秘」（AI 助手）。
             「新建提醒」按钮已按用户 2026-10-16 的要求挪到首页看板「接下来 14 天」标题行右侧
             （见 HomeDashboardView），列表页自己的「+ 新建提醒」、手机悬浮 +、快捷键 N 都不变。
             窄栏（56px 图标栏）时收成 44px 圆按钮、居中（见 .rail-actions）。 -->
        <div class="rail-actions mx-4 flex flex-col gap-2">
          <button
            type="button"
            class="assistant-button"
            :title="railActive ? `呼叫${assistantName}（AI 助手）` : `呼叫${assistantName}：写周报、一句话建任务`"
            data-assistant-trigger
            @click="openAssistant"
          >
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m12 3.6 1.9 4.4 4.4 1.9-4.4 1.9L12 16.2l-1.9-4.4-4.4-1.9 4.4-1.9L12 3.6Z" stroke-width="1.7" stroke-linejoin="round"/><path d="M18.6 15.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </span>
            <span class="rail-hide">呼叫{{ assistantName }}</span>
            <span class="rail-hide ml-auto rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300">AI</span>
          </button>
        </div>

        <nav class="mt-6 flex-1 overflow-y-auto px-3 pb-5">
          <!-- 用户 2026-10-19：「智能清单、我的清单，分别用线框框起来隔成两个区」 -->
          <section class="nav-group" data-nav-group="smart">
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

          <!-- 课程表（用户 2026-10-18）：给家里人各排一张，课程与课外活动分开标色。
               入口跟信用卡/记事本一样由个人偏好 timetable_enabled 控制，默认开。 -->
          <RouterLink
            v-if="authStore.timetableEnabled"
            to="/admin/timetable"
            class="nav-row"
            :class="{ 'nav-row-active': isActive('/admin/timetable') }"
            :title="railActive ? '课程表' : '课程表：按周几排课，课程和课外活动分开'"
            data-nav-timetable
            @click="mobileOpen = false"
          >
            <span class="nav-symbol h-5 w-5 bg-violet-500/12 text-violet-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke-width="1.7"/><path d="M4 10h16M9 3.5v3M15 3.5v3M8.5 14h2M13.5 14h2M8.5 17h2" stroke-width="1.7" stroke-linecap="round"/></svg>
            </span>
            <span class="flex-1">课程表</span>
          </RouterLink>

          <!-- 提醒@他（用户 2026-10-13）：多人之间互相推提醒的页面。开关是**后台
             系统偏好** nudge_enabled（一个实例一份），关掉后这一行与页面一起隐藏。
             角标 = 别人提醒我、我还没做完的条数（/summary 的 nudge_pending）。
             2026-10-19 用户要求挪到「课程表」下面，不再跟「我的清单」一起排序。 -->
            <RouterLink
              v-if="authStore.nudgeEnabled"
              to="/admin/nudges"
              class="nav-row min-w-0 flex-1"
              :class="{ 'nav-row-active': isActive('/admin/nudges') }"
              :title="railActive ? '提醒@他' : '提醒@他：给别的用户推提醒，也看别人提醒我什么'"
              data-nav-nudges
              @click="mobileOpen = false"
            >
              <span class="nav-symbol h-5 w-5 bg-sky-500/12 text-sky-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15.5 8.5a3.5 3.5 0 1 0-7 0c0 4-2 4-2 5.5h11c0-1.5-2-1.5-2-5.5Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 17a1.6 1.6 0 0 0 3 0" stroke-width="1.7" stroke-linecap="round"/><circle cx="18.5" cy="6.5" r="3.2" fill="currentColor" stroke="none"/></svg>
              </span>
              <span class="flex-1">提醒@他</span>
              <span v-if="summary.nudge_pending" class="nav-count">{{ summary.nudge_pending }}</span>
            </RouterLink>

          </section>

          <section class="nav-group" data-nav-group="my-lists">
          <div class="my-lists-head flex items-center justify-between px-3 pt-1">
            <p class="nav-caption !px-0 !pb-0">我的清单</p>
            <span class="rail-hide flex items-center gap-0.5">
              <!-- 排序模式开关（用户 2026-10-15）：进去后这一段每一行都能用 ↑↓ 挪位置，
                   顺序存进用户配置 sidebar_order。排序中图标变成 ✓。 -->
              <button
                type="button"
                class="tiny-add"
                :data-my-order-toggle="sortingMyLists ? 'on' : 'off'"
                :aria-label="sortingMyLists ? '完成排序' : '调整「我的清单」顺序'"
                :title="sortingMyLists ? '完成排序' : '调整顺序：系统栏目与普通清单一起排'"
                @click="sortingMyLists = !sortingMyLists"
              >
                <svg v-if="sortingMyLists" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <svg v-else viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M8 5h9M8 10h9M8 15h5" stroke-width="1.8" stroke-linecap="round"/><path d="M17.5 12.5v7m0 0 2.5-2.5M17.5 19.5 15 17" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="tiny-add" aria-label="新建清单" @click="creatingList = true">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </span>
          </div>


          <!-- 排序模式提示（用户 2026-10-15）：「我的清单」这一段整段可排 -->
          <div
            v-if="sortingMyLists"
            class="rail-hide mx-3 mb-1 rounded-xl bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-brand-700 dark:text-brand-200"
          >
            排序中：用 ↑ ↓ 挪位置，点标题旁的 ✓ 完成
          </div>

          <!-- 「我的清单」这一段：信用卡账单 / 随手记事本 / 人生要有仪式感 / 自建清单
               统一由 myListRows 决定先后（顺序存用户配置 sidebar_order，清单行同时写回 position）。
               原来的「全部」入口 2026-10-19 已并入「智能清单」那一行，这里不再重复列。 -->
          <div
            v-for="row in myListRows"
            :key="row.key"
            class="group/list flex items-center"
            :data-my-row="row.key"
            @contextmenu.prevent.stop="onMyRowMenu(row, $event)"
            @touchstart.passive="onMyRowTouchStart(row, $event)"
            @touchmove.passive="cancelListLongPress"
            @touchend="cancelListLongPress"
            @touchcancel="cancelListLongPress"
            @click.capture="onListRowClick"
          >
            <!-- 清单行：信用卡账单 / 随手记事本 / 人生要有仪式感三个固定栏目与自建清单走同一套渲染。
                 三个栏目由偏好控制显示、图标与文案固定；自建清单可右键（桌面）或长按（触屏）重命名/
                 改色/删除，入口全收在菜单里，所以这里不摆常驻按钮，侧栏更干净。
                 信用卡账单：卡片一律归到这一栏，用户不用（也不能）自己建。
                 随手记事本 / 人生要有仪式感：与前者并列，记事与倒计时条目分别收在其中。 -->
            <RouterLink
              :to="`/admin/list/${row.list.id}`"
              class="nav-row min-w-0 flex-1"
              :class="{ 'nav-row-active': route.path === `/admin/list/${row.list.id}` }"
              :title="listRowTitle(row.list)"
              :data-nav-cards="row.list.template === 'credit_card' ? '' : undefined"
              :data-nav-notebook="row.list.template === 'notebook' ? '' : undefined"
              :data-nav-ceremony="row.list.template === 'ceremony' ? '' : undefined"
              @click="mobileOpen = false"
            >
              <!-- 图标：固定栏目沿用原来的卡片/笔记本/仪式感图标；自建清单用「形状 + 清单色」
                   （原来是同色圆点，颜色一多就分不清）。记事本的图标取图标库里那份（notebook），
                   与日历/清单筛选共用 utils/list-icons.ts 一份定义。 -->
              <span
                v-if="row.list.template === 'credit_card'"
                class="nav-symbol h-5 w-5 bg-brand-500/12 text-brand-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="12" rx="2.5" stroke-width="1.7"/><path d="M3 10h18M6.5 14h4" stroke-width="1.7" stroke-linecap="round"/></svg>
              </span>
              <span
                v-else-if="row.list.template === 'notebook'"
                class="nav-symbol h-5 w-5 bg-emerald-500/12 text-emerald-500"
              >
                <ListIcon name="notebook" :size="20" />
              </span>
              <span
                v-else-if="row.list.template === 'ceremony'"
                class="nav-symbol h-5 w-5 bg-rose-500/10 text-rose-500"
              >
                <ListIcon name="ceremony" :size="20" />
              </span>
              <span
                v-else
                class="nav-list-icon"
                :style="{ color: listColor(row.list.color), background: listColor(row.list.color) + '1f' }"
                :data-list-icon="row.list.icon || 'list'"
              >
                <ListIcon :name="row.list.icon" :size="14" />
              </span>
              <!-- 重命名就地改：回车保存、Esc 取消，不弹窗（只有自建清单能改名） -->
              <input
                v-if="renamingListId === row.list.id"
                ref="renameInput"
                v-model="renameDraft"
                class="min-w-0 flex-1 rounded-lg border border-brand-500/40 bg-surface px-2 py-1 text-sm font-semibold outline-none"
                maxlength="40"
                :aria-label="`重命名清单「${row.list.name}」`"
                @click.stop.prevent
                @keydown.enter.prevent="commitRename(row.list)"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename(row.list)"
              />
              <span v-else class="flex min-w-0 flex-1 items-center gap-1">
                <span class="truncate">{{ listRowLabel(row.list) }}</span>
              </span>
              <!-- 默认清单标识；改默认清单在「偏好设置」里操作（固定在自建清单上） -->
              <span v-if="row.list.is_default" class="rail-hide shrink-0 text-amber-400" title="默认清单" aria-label="默认清单">
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor"><path d="m12 3.6 2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.87l-5.2 2.75.99-5.8-4.21-4.1 5.82-.85L12 3.6Z"/></svg>
              </span>
              <span
                v-if="row.list.template === 'credit_card' && cardBucket && cardBucket.card_count"
                class="nav-count"
              >{{ cardBucket.card_count }}</span>
              <span v-else-if="row.list.template !== 'credit_card' && row.list.open_count" class="nav-count">{{ row.list.open_count }}</span>
            </RouterLink>

            <!-- 排序模式的 ↑ ↓：顺序存在服务端（sidebar_order），视觉顺序也是按它算的，
                 所以这里只报「把这一行往上/下挪一格」，不动 DOM。 -->
            <span v-if="sortingMyLists" class="rail-hide ml-1 flex shrink-0 items-center gap-0.5" :data-my-move="row.key">
              <button
                type="button"
                class="tiny-add !h-6 !w-6 disabled:opacity-30"
                :disabled="isMyRowEdge(row.key, -1)"
                :aria-label="`把「${myRowLabel(row)}」上移`"
                @click.stop.prevent="moveMyRow(row.key, -1)"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 14.5 6-6 6 6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button
                type="button"
                class="tiny-add !h-6 !w-6 disabled:opacity-30"
                :disabled="isMyRowEdge(row.key, 1)"
                :aria-label="`把「${myRowLabel(row)}」下移`"
                @click.stop.prevent="moveMyRow(row.key, 1)"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 9.5 6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </span>
          </div>
          </section>


        </nav>

        <!-- 垃圾箱（用户 2026-10-27）：所有软删除的提醒都收在这里，始终排在侧栏最后。 -->
        <RouterLink
          to="/admin/trash"
          class="nav-row mx-3 mb-2 mt-3"
          :class="{ 'nav-row-active': isActive('/admin/trash') }"
          :title="railActive ? '垃圾箱' : '垃圾箱：已删除的提醒，可随时恢复'"
          data-nav-trash
          @click="mobileOpen = false"
        >
          <span class="nav-symbol h-5 w-5 bg-slate-500/12 text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5h6v2M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7M10 11v6M14 11v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <span class="flex-1">垃圾箱</span>
          <span v-if="summary.trash" class="nav-count">{{ summary.trash }}</span>
        </RouterLink>

        <div class="border-t border-border/70 px-2 pb-2 pt-2">
          <!-- 设置区可折叠：折叠后清单列表能多显示好几项。
               默认折叠，展开状态记在本地。平时不带底色（用户 2026-10-20：
               「设置默认不选择状态，鼠标放在按钮上显示选中状态」），
               鼠标移上去才亮成选中态。 -->
          <button
            type="button"
            class="nav-settings-toggle group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left"
            :aria-expanded="settingsOpen"
            :title="railActive ? '设置' : undefined"
            aria-controls="sidebar-settings"
            @click="toggleSettings"
          >
            <span class="nav-symbol h-7 w-7 bg-transparent text-muted-foreground transition-colors group-hover:bg-brand-500/15 group-hover:text-brand-600 dark:group-hover:text-brand-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M10.3 3.6a2 2 0 0 1 3.4 0l.5.9a1.6 1.6 0 0 0 1.9.8l1-.3a2 2 0 0 1 2.4 2.4l-.3 1a1.6 1.6 0 0 0 .8 1.9l.9.5a2 2 0 0 1 0 3.4l-.9.5a1.6 1.6 0 0 0-.8 1.9l.3 1a2 2 0 0 1-2.4 2.4l-1-.3a1.6 1.6 0 0 0-1.9.8l-.5.9a2 2 0 0 1-3.4 0l-.5-.9a1.6 1.6 0 0 0-1.9-.8l-1 .3a2 2 0 0 1-2.4-2.4l.3-1a1.6 1.6 0 0 0-.8-1.9l-.9-.5a2 2 0 0 1 0-3.4l.9-.5a1.6 1.6 0 0 0 .8-1.9l-.3-1A2 2 0 0 1 6.9 5l1 .3a1.6 1.6 0 0 0 1.9-.8l.5-.9Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.1" stroke-width="1.7"/></svg>
            </span>
            <span class="rail-hide text-xs font-extrabold tracking-[.08em] text-foreground transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-200">设置</span>
            <span v-if="!settingsOpen && hiddenSettingCount" class="nav-count">{{ hiddenSettingCount }}</span>
            <svg
              viewBox="0 0 24 24"
              class="rail-hide ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-all duration-200 group-hover:text-brand-600 dark:group-hover:text-brand-300"
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
          <!-- 手机端（用户 2026-10-19）：「铃铛旁边增加 ai 图标，用于手机 ai 对话」——
               手机上侧栏是抽屉，呼叫小秘在抽屉里不好找，这里给一个常驻入口。
               桌面端已有左上角「呼叫小秘」，所以这个按钮只在 <640px 出现。 -->
          <button
            type="button"
            class="icon-button sm:hidden"
            :aria-label="`呼叫${assistantName}（AI 助手）`"
            :title="`呼叫${assistantName}：写周报、一句话建任务`"
            data-assistant-mobile
            @click="openAssistant"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m12 3.6 1.9 4.4 4.4 1.9-4.4 1.9L12 16.2l-1.9-4.4-4.4-1.9 4.4-1.9L12 3.6Z" stroke-width="1.7" stroke-linejoin="round"/><path d="M18.6 15.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </button>
          <!-- 免打扰（用户 2026-10-16）：「首行消息（铃铛图标）旁边放一个喇叭标志，点击进入静音标志，
               退出显示喇叭，点击进入免打扰模式。后台增加免打扰时间段。权责级别优先在 所有通知以上。」
               喇叭 = 正常；静音 = 免打扰中。后台时间段生效时按钮也变成静音，右上角再加一个小黄点
               （免得用户以为是自己开的、到处找怎么关）。点一下就是手动开关（服务端 dnd_manual）。 -->
          <button
            type="button"
            class="icon-button relative"
            :class="dndActive ? 'text-amber-500 dark:text-amber-400' : ''"
            :aria-label="dndActive ? '免打扰已开启，点击关闭' : '开启免打扰'"
            :title="dndTooltip"
            :data-dnd-active="dndActive ? 'true' : 'false'"
            data-dnd-toggle
            @click="toggleDND"
          >
            <svg v-if="dndActive" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 9 5 6M21 9l-5 6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke-width="1.8" stroke-linecap="round"/><path d="M18.5 5.5a9 9 0 0 1 0 13" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span v-if="dndInWindow" class="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-amber-400" data-dnd-window-dot></span>
          </button>
          <!-- 列表 / 日历 切换。放在主题按钮旁边，与它同为「换个看法」类操作。 -->
          <div
            v-if="showViewSwitch && !isNarrow"
            class="flex items-center gap-0.5 rounded-xl border border-border/70 bg-muted/55 p-0.5"
            role="group"
            aria-label="切换列表或日历视图"
          >
            <RouterLink
              :to="listRoute"
              class="inline-flex items-center justify-center rounded-[0.6rem] p-2 text-xs font-bold transition"
              :class="!isCalendar ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              title="列表视图"
              aria-label="列表视图"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2" stroke-linecap="round"/></svg>
            </RouterLink>
            <RouterLink
              to="/admin/calendar"
              class="inline-flex items-center justify-center rounded-[0.6rem] p-2 text-xs font-bold transition"
              :class="isCalendar ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              title="日历视图"
              aria-label="日历视图"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2.5" stroke-width="1.9"/><path d="M3 10h18M8 3v4m8-4v4" stroke-width="1.9" stroke-linecap="round"/></svg>
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
      <RouterLink to="/admin" class="mobile-tab" :class="{ active: route.path === '/admin' }"><span v-html="smartNav[1].icon"></span><small>待办</small></RouterLink>
      <RouterLink to="/admin/planned" class="mobile-tab" :class="{ active: route.path === '/admin/planned' }"><span v-html="smartNav[2].icon"></span><small>计划</small></RouterLink>
      <!-- 手机端中间那个标签：原来是「信用卡账单」的直接入口（只在开了信用卡、且确实有那一栏
           时出现）。用户 2026-10-16 要求改成「清单」——点它弹出**所有清单**的列表，选一个就切
           过去（信用卡账单 / 随手记事本 / 人生要有仪式感 / 自建清单都在里面，顺序与侧栏
           「我的清单」那一段一致，见 listsSheetOpen）。 -->
      <button
        type="button"
        class="mobile-tab"
        :class="{ active: isListTabActive }"
        data-tab-lists
        aria-label="清单"
        @click="openListsSheet"
      >
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.5 6h11m-11 6h11m-11 6h11M4 6h.01M4 12h.01M4 18h.01" stroke-width="1.9" stroke-linecap="round"/></svg></span>
        <small>清单</small>
      </button>
      <RouterLink to="/admin/notifications" class="mobile-tab" :class="{ active: route.path === '/admin/notifications' }"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke-width="1.8" stroke-linecap="round"/></svg></span><small>通知</small></RouterLink>
      <RouterLink
        v-if="authStore.nudgeEnabled"
        to="/admin/nudges"
        class="mobile-tab"
        :class="{ active: route.path === '/admin/nudges' }"
        data-tab-nudges
        aria-label="提醒"
      >
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15.5 8.5a3.5 3.5 0 1 0-7 0c0 4-2 4-2 5.5h11c0-1.5-2-1.5-2-5.5Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 17a1.6 1.6 0 0 0 3 0" stroke-width="1.7" stroke-linecap="round"/><circle cx="18.5" cy="6.5" r="3.2" fill="currentColor" stroke="none"/></svg></span>
        <small>提醒</small>
      </RouterLink>
    </nav>

    <!-- 「清单」标签弹出的清单列表（用户 2026-10-16）：手机底部弹层，列的就是侧栏「我的清单」
         那一段（信用卡账单 / 随手记事本 / 人生要有仪式感 / 自建清单，顺序与显示条件完全一致），
         点一行切过去、弹层关闭。
         课程表（用户 2026-10-23）：「手机页面 中间清单 显示不全，没有看到课程表」——它和
         「智能清单」一起排在侧栏，手机上原来只能从抽屉进，这里补在最上面，开关沿用
         authStore.timetableEnabled（默认开）。 -->
    <Transition name="sheet">
      <div v-if="listsSheetOpen" class="lg:hidden">
        <div class="sheet-backdrop" data-lists-sheet-backdrop @click="closeListsSheet"></div>
        <div class="lists-sheet" role="dialog" aria-label="全部清单" data-lists-sheet>
          <div class="lists-sheet-head">
            <p class="text-sm font-bold text-foreground">全部清单</p>
            <button type="button" class="icon-button !h-8 !w-8" aria-label="关闭" data-lists-sheet-close @click="closeListsSheet">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="lists-sheet-body">
            <button
              v-if="authStore.timetableEnabled"
              type="button"
              class="lists-sheet-row"
              :class="{ 'lists-sheet-row-active': route.path === '/admin/timetable' }"
              data-lists-sheet-row="timetable"
              @click="pickTimetable"
            >
              <span class="nav-symbol h-5 w-5 bg-violet-500/12 text-violet-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke-width="1.7"/><path d="M4 10h16M9 3.5v3M15 3.5v3M8.5 14h2M13.5 14h2M8.5 17h2" stroke-width="1.7" stroke-linecap="round"/></svg>
              </span>
              <span class="min-w-0 flex-1 truncate">课程表</span>
              <span v-if="route.path === '/admin/timetable'" class="shrink-0 text-brand-500" data-lists-sheet-current aria-label="当前页面">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
            <button
              v-if="authStore.nudgeEnabled"
              type="button"
              class="lists-sheet-row"
              :class="{ 'lists-sheet-row-active': route.path === '/admin/nudges' }"
              data-lists-sheet-row="nudge"
              @click="pickNudge"
            >
              <span class="nav-symbol h-5 w-5 bg-sky-500/12 text-sky-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3.4" stroke-width="1.7"/><path d="M15.4 12v1.6a2.2 2.2 0 0 0 4.4 0V12a7.8 7.8 0 1 0-3.1 6.2" stroke-width="1.7" stroke-linecap="round"/></svg>
              </span>
              <span class="min-w-0 flex-1 truncate">提醒@他</span>
              <span v-if="summary.nudge_pending" class="nav-count">{{ summary.nudge_pending }}</span>
              <span v-if="route.path === '/admin/nudges'" class="shrink-0 text-brand-500" data-lists-sheet-current aria-label="当前页面">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
            <button
              v-for="row in myListRows"
              :key="row.key"
              type="button"
              class="lists-sheet-row"
              :class="{ 'lists-sheet-row-active': isMyRowCurrent(row) }"
              :data-lists-sheet-row="row.key"
              :data-list-name="myRowLabel(row)"
              @click="pickMyRow(row)"
            >
              <span v-if="row.list.template === 'credit_card'" class="nav-symbol h-5 w-5 bg-brand-500/12 text-brand-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="12" rx="2.5" stroke-width="1.7"/><path d="M3 10h18M6.5 14h4" stroke-width="1.7" stroke-linecap="round"/></svg>
              </span>
              <span v-else-if="row.list.template === 'notebook'" class="nav-symbol h-5 w-5 bg-emerald-500/12 text-emerald-500">
                <ListIcon name="notebook" :size="20" />
              </span>
              <span v-else-if="row.list.template === 'ceremony'" class="nav-symbol h-5 w-5 bg-rose-500/12 text-rose-500">
                <ListIcon name="ceremony" :size="20" />
              </span>
              <span
                v-else
                class="nav-list-icon"
                :style="{ color: listColor(row.list.color), background: listColor(row.list.color) + '1f' }"
              >
                <ListIcon :name="row.list.icon" :size="14" />
              </span>
              <span class="min-w-0 flex-1 truncate">{{ myRowLabel(row) }}</span>
              <span v-if="myRowCount(row)" class="nav-count">{{ myRowCount(row) }}</span>
              <span v-if="isMyRowCurrent(row)" class="shrink-0 text-brand-500" data-lists-sheet-current aria-label="当前清单">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
            <button
              type="button"
              class="lists-sheet-row"
              :class="{ 'lists-sheet-row-active': route.path === '/admin/trash' }"
              data-lists-sheet-row="trash"
              @click="pickTrash"
            >
              <span class="nav-symbol h-5 w-5 bg-slate-500/12 text-slate-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5h6v2M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7M10 11v6M14 11v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="min-w-0 flex-1 truncate">垃圾箱</span>
              <span v-if="summary.trash" class="nav-count">{{ summary.trash }}</span>
              <span v-if="route.path === '/admin/trash'" class="shrink-0 text-brand-500" data-lists-sheet-current aria-label="当前页面">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 手机端「新建」改成**悬浮按钮**：脱离底部标签栏，右下角悬浮，键盘弹起/滚动时收起 -->
    <button
      v-if="canCreate && route.name !== 'Trash'"
      class="mobile-fab"
      :class="{ 'mobile-fab-hidden': keyboardOpen }"
      :aria-label="fabLabel"
      :title="fabLabel"
      :data-mobile-fab-action="fabAction"
      data-mobile-fab
      @click="onMobileFab"
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
      :show-snooze="!currentAlertIsNudge"
      :ack-label="currentAlertIsNudge ? '知道了' : ackLabel"
      :ack-hint="currentAlertIsNudge ? '去「提醒@他」页面查看并处理' : ackHint"
      @ack="ackCurrentAlert"
      @snooze="snoozeCurrentAlert"
      @dismiss="dismissCurrentAlert"
    />

    <!-- 版本信息与迭代说明 -->
    <VersionDialog v-model="versionOpen" :version="appVersion" :build-time="appBuildTime" />

    <!-- 呼叫小秘：AI 助手抽屉。接上模型后走真回复，没接上时用本地兜底文案 -->
    <AssistantPanel v-model="assistantOpen" />

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
import AssistantPanel from '../components/AssistantPanel.vue'
import { useAssistantStore } from '../stores/assistant'
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
  getDNDState,
  getLists,
  getNotifications,
  getRevision,
  getSummary,
  markNotificationRead,
  deleteList,
  reorderLists,
  setDNDManual,
  snoozeReminder,
  updateList,
  type DNDState,
  type ReminderList,
} from '../api/reminder'
import { getAllConfigs, getVersion, updateConfig } from '../api/config'
import { connectReminderEvents, type RealtimeNotification, type ReminderRealtimeEvent } from '../services/reminderRealtime'
import { ackMinutesLabel } from '../utils/reminder-options'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel } from '../utils/list-colors'
import { onFnOSGatewayOrigin } from '../utils/gateway'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
// 小秘的名字：每个人可在「偏好设置 → AI 提示词」里改，侧栏入口与面板共用。
const assistantStore = useAssistantStore()
const assistantName = computed(() => assistantStore.displayName)
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

// ---- 侧栏「我的清单」整段排序（用户 2026-10-15）----
// 原来「全部 / 提醒@他 / 信用卡账单 / 随手记事本 / 人生要有仪式感」是写死的几行，
// 只有普通清单能排，而且得进「偏好设置 → 清单顺序」里排（那块 2026-10-16 已删，见下）。
// 现在这一段整段可排：点标题旁那个小按钮进排序模式，用 ↑ ↓ 把**任意一行**（含系统内置的
// 4 个栏目）挪位置，点 ✓ 退出。顺序存在用户配置 sidebar_order（JSON 数组，
// token：all / list:<id>），同时把清单行的先后写回各清单的 position ——
// 清单筛选下拉拿到的顺序才跟侧栏一致。**这里现在是排序的唯一入口**
// （用户 2026-10-16：「前台可以调整 清单顺序，与后台偏好中 清单顺序 重复，删除后台清单顺序模块」）。
type MyListRow = { key: string; kind: 'list'; list: ReminderList }

const myListKey = (id: number) => `list:${id}`
// 三个系统栏目的**默认**先后：沿用改造前侧栏的视觉顺序（信用卡 → 记事本 → 仪式感），
// 它们各自的 position 是建栏目时按当时的最大值 +1 写的，不能拿来定这一段的老样子。
const MY_SYSTEM_ORDER = ['credit_card', 'notebook', 'ceremony']
const sidebarOrder = ref<string[]>([])
const sortingMyLists = ref(false)

// 可见性判断必须与模板里的 v-if 完全一致，否则「隐藏的行」会被当成可排的行插进顺序里
function myRowVisible(l: ReminderList): boolean {
  if (l.template === 'credit_card') return authStore.creditCardEnabled
  if (l.template === 'notebook') return authStore.notebookEnabled
  if (l.template === 'ceremony') return authStore.ceremonyEnabled
  return true
}
// 没保存过顺序（或新清单还没进顺序）时的默认排列
const defaultMyRows = computed<MyListRow[]>(() => {
  const rows: MyListRow[] = []
  const buckets: ReminderList[] = []
  for (const t of MY_SYSTEM_ORDER) {
    const found = lists.value.find((l) => String(l.template || 'general') === t)
    if (found) buckets.push(found)
  }
  const normal = lists.value.filter((l) => !MY_SYSTEM_ORDER.includes(String(l.template || 'general')))
  for (const l of [...buckets, ...normal]) {
    if (myRowVisible(l)) rows.push({ key: myListKey(l.id), kind: 'list', list: l })
  }
  return rows
})
// 真正渲染的顺序：保存过的 token 按其下标排；没进过顺序的行（新清单）按默认先后接在后面
const myListRows = computed<MyListRow[]>(() => {
  const rows = defaultMyRows.value
  if (!sidebarOrder.value.length) return rows
  const idx = new Map(sidebarOrder.value.map((k, i) => [k, i]))
  return rows
    .map((row, i) => ({ row, rank: idx.has(row.key) ? idx.get(row.key)! : 1000 + i }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.row)
})
function myRowLabel(row: MyListRow): string {
  return row.list.name
}

// 「清单」标签（手机端中间那个，用户 2026-10-16）：
//   「手机页面 中间 信用卡 改成 清单，点击清单弹出 所有清单列表，根据选择切换清单列表」
// 弹出的这一份列的就是侧栏「我的清单」那一段（同一份 myListRows、同一套显示条件与顺序），
// 选一行 → 切到那一页并收起弹层。原来那个标签是信用卡账单的直达入口，现在也还在弹层里
// （点一下就进去）——只是多了「所有清单」这一层。
const listsSheetOpen = ref(false)
const isListTabActive = computed(() => route.path.startsWith('/admin/list/') || route.path === '/admin/timetable')
function openListsSheet() { listsSheetOpen.value = true }
function closeListsSheet() { listsSheetOpen.value = false }
/** 课程表（用户 2026-10-23）：这一页现在也从「清单」弹层进，切过去就收起弹层 */
function pickTimetable() {
  listsSheetOpen.value = false
  if (route.path !== '/admin/timetable') void router.push('/admin/timetable')
}
/** 提醒@他：与课程表一样，内置栏目统一排在手机清单弹层最前面 */
function pickNudge() {
  listsSheetOpen.value = false
  if (route.path !== '/admin/nudges') void router.push('/admin/nudges')
}
/** 垃圾箱：始终排在手机清单弹层最后 */
function pickTrash() {
  listsSheetOpen.value = false
  if (route.path !== '/admin/trash') void router.push('/admin/trash')
}
/** 这一行是不是当前所在页面（弹层里打勾用） */
function isMyRowCurrent(row: MyListRow): boolean {
  return route.path === `/admin/list/${row.list.id}`
}
/** 弹层右边的条数，与侧栏同一口径 */
function myRowCount(row: MyListRow): number {
  if (row.list.template === 'credit_card') return cardBucket.value?.card_count || 0
  return row.list.open_count || 0
}
function pickMyRow(row: MyListRow) {
  const to = `/admin/list/${row.list.id}`
  listsSheetOpen.value = false
  if (route.path !== to) void router.push(to)
}
// 已经是这段的第一/最后一行时，↑（或 ↓）按钮置灰
function isMyRowEdge(key: string, delta: number): boolean {
  const rows = myListRows.value
  const i = rows.findIndex((r) => r.key === key)
  return i < 0 || i + delta < 0 || i + delta >= rows.length
}
function moveMyRow(key: string, delta: number) {
  const rows = myListRows.value
  const i = rows.findIndex((r) => r.key === key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rows.length) return
  const keys = rows.map((r) => r.key)
  const [moved] = keys.splice(i, 1)
  keys.splice(j, 0, moved)
  void saveMyOrder(keys)
}
/**
 * 保存这一段的新顺序。只传「当前看得见」的行：被偏好关掉的栏目此刻不显示，
 * 把它们按原来的槽位留在顺序里（重新打开时还回到老位置）。
 */
async function saveMyOrder(visibleKeys: string[]) {
  const prev = (sidebarOrder.value.length ? sidebarOrder.value.slice() : defaultMyRows.value.map((r) => r.key))
    .filter((k) => k !== 'nudge')
  const visible = new Set(visibleKeys)
  let cursor = 0
  const next = prev.map((k) => (visible.has(k) ? visibleKeys[cursor++] : k))
  for (const k of visibleKeys) if (!next.includes(k)) next.push(k)
  sidebarOrder.value = next
  const listIds = next
    .filter((k) => k.startsWith('list:'))
    .map((k) => Number(k.slice(5)))
    .filter((id) => Number.isFinite(id) && id > 0)
  try {
    await updateConfig('sidebar_order', JSON.stringify(next))
    // 清单行顺带写回 position：别的界面（清单筛选下拉、清单列表）才对得上
    if (listIds.length) await reorderLists(listIds)
  } catch (err) {
    // 保存失败不回滚本地顺序（界面已经按新顺序画好了），下次刷新回到服务端的顺序
    console.warn('保存侧栏「我的清单」顺序失败', err)
  }
}
async function loadSidebarOrder() {
  try {
    const res = await getAllConfigs()
    const raw = String(res.data?.data?.sidebar_order ?? '')
    const parsed = raw ? JSON.parse(raw) : []
    // 'nudge' 是旧版「提醒@他」在「我的清单」里的排序 token；2026-10-19 挪到「课程表」下面后不再参与排序。
    // 'all' 是旧版「我的清单 → 全部」，已并入「智能清单」的「全部」，同样丢掉。
    sidebarOrder.value = Array.isArray(parsed)
      ? parsed.filter((k) => typeof k === 'string' && k !== 'nudge' && k !== 'all')
      : []
  } catch {
    sidebarOrder.value = []
  }
}
function onMyRowMenu(row: MyListRow, event: MouseEvent) {
  if (sortingMyLists.value) return
  openListMenu(row.list, event)
}
function onMyRowTouchStart(row: MyListRow, event: TouchEvent) {
  if (sortingMyLists.value) return
  if (row.kind === 'list') onListTouchStart(row.list, event)
}
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
  // 「首页」排在最上面（用户 2026-10-13：「智能清单：今天上方增加首页」）
  { to: '/admin/home', label: '首页', key: 'home', tone: 'bg-brand-500/12 text-brand-500', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1v-9.5Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { to: '/admin', label: '待办', key: 'today', tone: 'bg-blue-500/12 text-blue-500', icon: icons.today },
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
// 页面切到日历没有意义。首页看板（Dashboard）2026-10-19 也加上了，与其他页面同一处、同一套样式。
const viewSwitchRoutes = ['Dashboard', 'Home', 'Planned', 'AllReminders', 'Completed', 'ReminderList', 'Calendar']
// 手机上没有日历视图（入口隐藏 + 路由守卫兜底），所以顶栏那组「列表 / 日历」切换也收起来
const isNarrow = useIsNarrow()
const showViewSwitch = computed(() => !isNarrow.value && viewSwitchRoutes.includes(String(route.name || '')))
const isCalendar = computed(() => route.name === 'Calendar')
// 从日历切回列表时回到「待办」，而不是记住上次那个智能清单：日历不区分清单，
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
/** 点设置菜单以外的任何地方也收起来（用户 2026-10-20「设置按钮自动回收」）。 */
function closeSettingsOnOutsideClick(event: Event) {
  if (!settingsOpen.value) return
  const target = event.target as Element | null
  if (target?.closest?.('.nav-settings-toggle') || target?.closest?.('#sidebar-settings')) return
  settingsOpen.value = false
}
// 切到其它页面时把手机抽屉收起（点导航项已经处理，这里兜住路由变化）
watch(() => route.fullPath, () => {
  mobileOpen.value = false
  // 用户 2026-10-20：「点击其他页面时自动收回设置菜单」。
  settingsOpen.value = false
})

// 日历视图里侧栏基本用不上（日历要的是横向空间），进这一页自动收成图标栏；
// 离开自动还原用户偏好。只看「路由变化」这一个事件，所以用户在日历里手动展开
// 之后不会被反复强行收起（手动动过就清掉临时态，见 toggleSidebar）。
watch(() => route.path, (path) => {
  railForced.value = path.startsWith('/admin/calendar')
}, { immediate: true })
// 清单色表已抽到 utils/list-colors.ts（侧栏/筛选/列表标题/日历共用一份）。
const listColor = listColorHex
// 「新建提醒」按钮派发的 open-quick-reminder 只有 HomeView 一族（列表视图）在监听，
// 所以按钮要先把用户送到**带快速新建面板的页面**再派发事件：
//   · 首页看板 / 通知中心 / 通知方式 / 偏好设置 / 个人资料 / 后台各页都没有那个面板，
//     以前只在「非 /admin」和那四个页面路径上做了跳转，首页看板（/admin/home）落进
//     空档 —— 事件派发了没人接，表现就是「点了没反应」（用户 2026-10-15 报的）。
//   · 用**路由名白名单**判断而不是路径片段，新增页面时不写名字就自动走跳转这条路，
//     不会再出现「某页按钮静默失效」。
// 顺序：先 await 导航，再等一帧让 HomeView 挂上，最后派发。
// 现在叫它的有三处：手机悬浮 +、这里挂的 window 事件 open-quick-add（首页看板标题行右侧
// 那个「新建提醒」派发的），以及 HomeView 自己的快捷键 N。
const QUICK_ADD_HOSTS = ['Home', 'Planned', 'AllReminders', 'Completed', 'ReminderList']
/** 手机悬浮按钮按频道决定动作：提醒@他/信用卡/仪式感打开各自的“新建”，其余进待办新建卡。 */
type FabAction = 'nudge' | 'credit' | 'ceremony' | 'reminder'
const fabAction = computed<FabAction>(() => {
  if (route.name === 'Nudges') return 'nudge'
  if (route.name === 'ReminderList') {
    const list = lists.value.find((l) => String(l.id) === String(route.params.id))
    if (list?.template === 'credit_card') return 'credit'
    if (list?.template === 'ceremony') return 'ceremony'
  }
  return 'reminder'
})
const fabLabel = computed(() => ({
  nudge: '新建提醒',
  credit: '新建卡片',
  ceremony: '新建事项',
  reminder: '新建待办',
}[fabAction.value]))
async function onMobileFab() {
  const selectors: Partial<Record<FabAction, string>> = {
    nudge: '[data-nudge-new]',
    credit: '[data-card-add]',
    ceremony: '[data-ceremony-add]',
  }
  const selector = selectors[fabAction.value]
  if (selector) {
    document.querySelector<HTMLElement>(selector)?.click()
    return
  }
  await openQuickAdd()
}
async function openQuickAdd() {
  mobileOpen.value = false
  if (!QUICK_ADD_HOSTS.includes(String(route.name || ''))) await router.push(listRoute.value)
  await nextTick()
  // HomeView 是懒加载路由：它的 open-quick-reminder 监听要等 `onMounted` 才挂上，
  // 只派发一次的话，从首页看板/通知中心跳过来时事件比监听早到、卡片根本不展开
  // （实测就是这么丢的）。事件本身幂等（重复派发＝再展开一次并聚焦），
  // 所以短窗内多派发几次，后挂上的监听也能接住。
  for (let i = 0; i < 5; i += 1) {
    window.dispatchEvent(new CustomEvent('open-quick-reminder'))
    await new Promise((resolve) => setTimeout(resolve, 70))
  }
}

// ---- 「呼叫小秘」：AI 助手面板（模型参数在「系统配置 → AI 助手」里填，见 api/assistant.ts）----
// 面板在任何页面都能叫出来，所以这里不做跳转；以后别的页面（空状态、看板卡片等）
// 想叫它，派发 window 事件 open-assistant 即可，和 open-quick-reminder 一个路子。
const assistantOpen = ref(false)
function openAssistant() {
  mobileOpen.value = false
  assistantOpen.value = true
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
  // 排序模式：这一段只用来点 ↑ ↓，别让整行的链接把人带走
  if (sortingMyLists.value) {
    const el = e.target as HTMLElement | null
    if (!el?.closest('[data-my-move]')) {
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  if (!suppressListClick) return
  suppressListClick = false
  e.preventDefault()
  e.stopPropagation()
}
// 行标题与显示名：三个系统栏目沿用改造前写死的文案，自建清单用清单名
function listRowTitle(list: ReminderList): string {
  const t = String(list.template || 'general')
  if (t === 'credit_card') return railActive.value ? '信用卡账单' : '信用卡账单：卡片、账单日与还款提醒都在这里'
  if (t === 'notebook') return railActive.value ? '随手记事本' : '随手记事本：新建的记事都收在这里'
  if (t === 'ceremony') return railActive.value ? '人生要有仪式感' : '人生要有仪式感：生日、纪念日、节日、考试的倒计时'
  return railActive.value ? list.name : `右键（手机上长按）可重命名、改颜色或删除「${list.name}」`
}
function listRowLabel(list: ReminderList): string {
  const t = String(list.template || 'general')
  if (t === 'credit_card') return '信用卡账单'
  if (t === 'notebook') return '随手记事本'
  if (t === 'ceremony') return '人生要有仪式感'
  return list.name
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
  /** 通知类型：nudge_* 是「提醒@他」推来的，弹窗文案与按钮不一样 */
  type?: string
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
// 主按钮必须写明「点了会怎样」：用户 2026-10-12 报「昨天到期的任务进了逾期，
// 点『知道了』它就出了逾期」——只写「知道了」让人以为是关掉提示，实际上是把提醒
// 顺延（默认第二天），逾期分组也跟着变了。文案按偏好的「知道了后提醒频率」走：
// 0 = 明年同一时间（写「延期明天提醒」），否则写实际分钟数，别写死。
// 按钮文案 = 后台偏好「点『知道了』后的提醒频率」的**选项文案**（用户 2026-10-13 要求
// 「内容等于后台偏好…显示保持与后台一致」）：后台选「1 小时后」，按钮就是
// 「知道了（1 小时后）」；选「第二天（当天不再提示）」，按钮就是同一句话。
const ackLabel = computed(() => `知道了（${ackMinutesLabel(ackMinutes.value)}）`)
// 当前弹窗是「提醒@他」推来的通知吗（那种没有关联任务，文案与按钮都不一样）
const currentAlertIsNudge = computed(() => NUDGE_NOTIFICATION_TYPES.includes(String(currentAlert.value?.type || '')))
const ackHint = computed(() => (ackMinutes.value > 0
  ? `要完成请到列表里勾选；${ackMinutes.value} 分钟后会再提醒一次`
  : '要完成请到列表里勾选；今天不再提示，明天同一时间继续提醒'))

// 会弹「屏幕中央弹窗」的站内通知类型：到点提醒 + 逾期提醒（用户 2026-10-12 加的
// 「到了逾期提醒时间还没完成就提醒」）。其它类型（例如渠道投递失败）仍是轻量 toast。
// 提醒@他推来的通知（收到 / 对方又提醒你一次）也走中央弹窗（用户 2026-10-13：
// 「提醒一下……即时发送提醒弹窗」）；它们没有关联任务，所以弹窗里不给「稍后提醒」。
const ALERT_NOTIFICATION_TYPES = ['reminder_due', 'reminder_overdue', 'nudge_received', 'nudge_reminded']
const NUDGE_NOTIFICATION_TYPES = ['nudge_received', 'nudge_reminded']

// 免打扰（用户 2026-10-16）：首行铃铛旁边那个喇叭/静音按钮。状态以服务端为准
// （手动开关 dnd_manual + 后台「免打扰时间段」），这里只负责显示、切换，
// 以及「免打扰期间不弹窗、不响铃」。服务端那一侧也会拦（投递任务继续留 pending、
// 逾期提醒跳过、提醒@他只记通知不实时推），前端这层是兜底：免打扰打开之前就已经
// 排进队列的通知，也不该继续打扰。
const dnd = ref<DNDState | null>(null)
const dndActive = computed(() => dnd.value?.active === true)
const dndInWindow = computed(() => dnd.value?.in_window === true)
const dndTooltip = computed(() => {
  const state = dnd.value
  if (!state) return '免打扰'
  if (state.active) return `${state.reason || '免打扰'}：这段安静时间不弹提醒、不响铃\n点击关闭免打扰`
  if (state.window_enabled) return `开启免打扰\n后台免打扰时间段 ${state.window_start}–${state.window_end}`
  return '开启免打扰'
})

async function refreshDND() {
  try {
    const res = await getDNDState()
    if (res.data?.code === 0) dnd.value = res.data.data as DNDState
  } catch {
    // 拿不到就保持现状：不能因为一个状态接口失败把免打扰按钮弄坏。
  }
}

// 点一下 = 切换手动开关。打开时把已经排队的弹窗清掉（用户点它就是要马上安静）；
// 关掉时补一次「错过的提醒」，免得免打扰期间到点的提醒再也不弹。
async function toggleDND() {
  const next = dnd.value?.manual !== true
  try {
    const res = await setDNDManual(next)
    if (res.data?.code !== 0) {
      realtimeToast.value = res.data?.message || '免打扰设置失败'
      return
    }
    dnd.value = res.data.data as DNDState
    if (dnd.value.active) {
      alertQueue.value = []
      realtimeToast.value = ''
    } else {
      void recoverMissedAlerts()
    }
  } catch (error: any) {
    realtimeToast.value = error?.response?.data?.message || '免打扰设置失败'
  }
}

function enqueueDueAlert(notification: ReminderRealtimeEvent['notification']) {
  if (!notification || !ALERT_NOTIFICATION_TYPES.includes(notification.type)) return
  if (alertQueue.value.some(item => item.notificationID === notification.id)) return
  alertQueue.value.push({
    notificationID: notification.id,
    reminderID: notification.reminder_id,
    type: notification.type,
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

/**
 * 把「已经在别处处理掉」的提醒弹窗从队列里摘掉。
 *
 * 场景（用户 2026-10-13 报的）：手机点了「知道了」，电脑上那条弹窗还杵着不走 ——
 * 服务端确实把通知标成已读了，也广播了 reminders.changed，但弹窗队列是本地的，
 * 没人去核对。这里在收到数据变更（以及页面重新可见）时，拿一次通知列表，
 * 把「已读 / 已经不存在」的从队列里去掉；正在显示的那条被摘掉后，队列头会自动
 * 换成下一条（currentAlert 就是队列头）。
 *
 * 队列为空时直接返回：普通编辑也会发 reminders.changed，不该为它多打一次请求。
 */
async function dropAcknowledgedAlerts() {
  if (!alertQueue.value.length) return
  try {
    const res = await getNotifications()
    const items = (res.data?.data || []) as RealtimeNotification[]
    const unread = new Set(items.filter((item) => !item.read_at).map((item) => item.id))
    const remaining = alertQueue.value.filter((item) => unread.has(item.notificationID))
    if (remaining.length !== alertQueue.value.length) {
      alertQueue.value = remaining
      alertError.value = ''
    }
  } catch { /* 拉不到就保持现状，下一次数据变更或轮询还会再试 */ }
}

function handleRealtimeEvent(event: ReminderRealtimeEvent) {
  // 数据变更（别的设备/窗口增删改了提醒、清单、通知、渠道）：本机不重新拉数据就会
  // 一直显示旧内容，这正是「手机端加了，PC 端看不到」的原因。
  if (event.type === 'reminders.changed') {
    lastRevision = event.revision ?? lastRevision
    // 通知被别处标已读（手机点了「知道了」）→ 本机也别再显示那条弹窗
    if (event.scope === 'notification') void dropAcknowledgedAlerts()
    refreshNavigation()
    window.dispatchEvent(new CustomEvent('reminder-realtime', { detail: event }))
    window.dispatchEvent(new CustomEvent('reminder-data-changed'))
    return
  }

  if (event.type !== 'notification.created' || !event.notification) return
  if (event.revision) lastRevision = event.revision
  window.dispatchEvent(new CustomEvent('reminder-realtime', { detail: event }))
  window.dispatchEvent(new CustomEvent('reminder-data-changed'))
  // 免打扰（用户 2026-10-16）：通知照旧进通知中心（未读角标照常），但一个弹窗、
  // 一声提示都不给 —— 这是「权责级别优先在所有通知以上」的前端那一半。
  if (dndActive.value) return
  // 站内提醒：手机端也能看到的弹窗（toast 在小屏上太容易被忽略，也容易被底部
  // 标签栏挡住）。其它类型（例如渠道投递失败）继续保持轻量的 toast。
  if (ALERT_NOTIFICATION_TYPES.includes(event.notification.type)) {
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
  // 免打扰期间不补弹（用户 2026-10-16）：通知中心的未读角标照常累积，
  // 等用户自己关了免打扰，或者点开通知中心，再看到它们。
  if (dndActive.value) return
  try {
    const res = await getNotifications()
    const items = (res.data?.data || []) as RealtimeNotification[]
    let added = 0
    for (const item of items) {
      if (!ALERT_NOTIFICATION_TYPES.includes(item.type) || item.read_at) continue
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
  // 免打扰状态跟着一起刷：时间段是按钟点生效的（到点自动进入/退出），
  // 另一台设备上点的开关、后台改的时间段，也要在这个按钮上跟上。
  void refreshDND()
  try {
    const res = await getRevision()
    if (res.data?.code !== 0) return
    const revision = Number(res.data.data?.revision || 0)
    if (revision === lastRevision) return
    lastRevision = revision
    refreshNavigation()
    // 修订号变了说明服务端发生过事件，长连接没送到的到点通知在这里补弹。
    void recoverMissedAlerts()
    // ……同样地：长连接没送到的「别处已确认」也要在这里撤掉弹窗。手机端长连接常被
    // 系统掐断，只靠 SSE 会出现「手机点了知道了、这台还杵着」（用户 2026-10-13 报的）。
    void dropAcknowledgedAlerts()
    window.dispatchEvent(new CustomEvent('reminder-realtime-resume'))
    window.dispatchEvent(new CustomEvent('reminder-data-changed'))
  } catch {
    // 轮询失败什么都不用做：下一次再问。
  }
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') {
    refreshNavigation()
    // 免打扰状态（手动开关 / 后台时间段）也是「回到前台就该是最新的」那类状态。
    void refreshDND()
    window.dispatchEvent(new CustomEvent('reminder-realtime-resume'))
    // 回到前台时立刻核一次：手机端常见路径是切到飞牛 App 退出登录再切回来，
    // 等下一次轮询太慢，回来这一下就该已经回登录页了。
    void checkFnOSSession()
    // 另一台设备在后台期间改过数据，回到前台要立刻跟上，不等下一次轮询。
    void pollRevision()
    // 另一台设备在后台期间把提醒「知道了」→ 本机这条弹窗也该撤掉（用户 2026-10-13 报的）。
    void dropAcknowledgedAlerts()
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

// 只在本次会话的第一次进入时套用「默认首页」，之后用户点「待办」不该被再拽去日历。
let defaultViewApplied = false
// 「默认首页」偏好（default_view）：home=首页看板 / list=列表（待办）/ calendar=日历。
// 用户 2026-10-13 加了首页看板并要求「打开默认显示页」，所以默认值是 home；
// 手机上没有日历视图，设成日历也按列表进。
const defaultView = ref<'home' | 'list' | 'calendar'>('home')
function defaultViewTarget(): { name: string } {
  if (defaultView.value === 'calendar' && !isNarrowNow()) return { name: 'Calendar' }
  if (defaultView.value === 'home') return { name: 'Dashboard' }
  return { name: 'Home' }
}
async function applyDefaultViewOnce() {
  if (defaultViewApplied) return
  defaultViewApplied = true
  try {
    const res = await getAllConfigs()
    const value = String(res.data?.data?.default_view || 'home')
    defaultView.value = value === 'calendar' ? 'calendar' : value === 'list' ? 'list' : 'home'
  } catch {
    /* 读不到就按首页看板来，不该因为一个偏好读失败挡住进入应用 */
  }
  if (route.name !== 'Home') return
  const target = defaultViewTarget()
  if (String(route.name) !== target.name) await router.replace(target)
}

// 「10 分钟不操作默认展示页」（用户 2026-10-13）：空闲满 10 分钟且不在首页时，自动回首页看板。
// 只有停在 /admin 里的页面才跳（登录页、注册页不掺和）；任何指针/键盘/滚轮/触摸操作都会重新计时。
const IDLE_BACK_TO_HOME_MS = 10 * 60 * 1000
let idleTimer: ReturnType<typeof setTimeout> | undefined
function armIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (!route.path.startsWith('/admin')) return
    // 「默认展示页」= 默认首页偏好那一档（默认就是首页看板）
    const target = defaultViewTarget()
    if (String(route.name) === target.name) return
    void router.push(target)
  }, IDLE_BACK_TO_HOME_MS)
}
function onUserActivity() {
  armIdleTimer()
}

onMounted(() => {
  void applyDefaultViewOnce()
  void assistantStore.loadName(true)
  refreshNavigation()
  // 侧栏「我的清单」的先后顺序（用户配置 sidebar_order，没配过就用默认先后）
  void loadSidebarOrder()
  loadVersion()
  window.visualViewport?.addEventListener('resize', syncKeyboardState)
  window.addEventListener('reminder-data-changed', refreshNavigation)
  window.addEventListener('open-assistant', openAssistant)
  window.addEventListener('open-quick-add', openQuickAdd)
  document.addEventListener('pointerdown', unlockReminderSound, { once: true })
  document.addEventListener('keydown', unlockReminderSound, { once: true })
  document.addEventListener('visibilitychange', refreshWhenVisible)
  document.addEventListener('pointerdown', closeSettingsOnOutsideClick)
  // 空闲回首页看板：任何操作都重新计时（见 armIdleTimer）
  armIdleTimer()
  for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(evt, onUserActivity, { passive: true })
  }
  // 网关域上没有本地 JWT 也要连：那条路的身份来自网关注入的 X-Trim-*。
  if (authStore.token || onFnOSGatewayOrigin()) stopRealtime = connectReminderEvents(authStore.token, handleRealtimeEvent)
  fnosSessionTimer = window.setInterval(() => { void checkFnOSSession() }, FNOS_SESSION_POLL_MS)
  // 先问一次当前修订号作为基准，之后只处理「变了」的情况（见 pollRevision）。
  void pollRevision()
  // 免打扰按钮的初始状态（喇叭 / 静音 + 后台时间段是否生效中）
  void refreshDND()
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
  window.removeEventListener('open-assistant', openAssistant)
  window.removeEventListener('open-quick-add', openQuickAdd)
  document.removeEventListener('pointerdown', unlockReminderSound)
  document.removeEventListener('keydown', unlockReminderSound)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  document.removeEventListener('pointerdown', closeSettingsOnOutsideClick)
  if (idleTimer) clearTimeout(idleTimer)
  for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.removeEventListener(evt, onUserActivity)
  }
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
/* 窄栏里「呼叫小秘」收成 44px 圆按钮、居中。外层容器先把左右外边距让开：
   56px 的图标栏减去 mx-4 只剩 24px，44px 的圆按钮会偏到左边去。 */
.sidebar-rail .rail-actions { @apply lg:mx-0 lg:items-center lg:gap-2; }
.sidebar-rail .assistant-button { @apply lg:h-11 lg:w-11 lg:justify-center lg:gap-0 lg:px-0; }
.sidebar-rail nav { @apply lg:px-2; }
/* 56px 的图标栏里再挤一条滚动条，图标会被推得偏左（实测差 5px），而且视觉上很脏。
   仍然可以滚（滚轮/触摸），只是不显示滚动条。 */
.sidebar-rail nav { scrollbar-width: none; }
.sidebar-rail nav::-webkit-scrollbar { display: none; }
/* 「我的清单」那一行在图标栏里只剩一个 + 按钮，居中放 */
.sidebar-rail .my-lists-head { @apply lg:justify-center lg:px-0; }
.sidebar-rail .nav-group { @apply lg:p-1; }
.logo-mark { @apply flex h-11 w-11 items-center justify-center rounded-[15px] bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_10px_30px_-10px_rgba(59,130,246,.75)]; }
.version-badge { @apply rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[11px] font-bold leading-none text-brand-600 dark:text-brand-300; }
/* 「呼叫小秘」：侧栏顶部的入口（「新建提醒」已挪到首页看板，见 HomeDashboardView）。
   用品牌色低透明度底 + 描边，浅深主题都不刺眼。 */
.assistant-button { @apply flex h-12 items-center gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/10 px-3.5 text-sm font-bold text-brand-700 transition hover:bg-brand-500/15 active:scale-[0.99] dark:text-brand-200; }
/* 折叠「设置」入口：平时不选（透明底、透明描边），鼠标移上去/键盘聚焦才亮成选中态；
   展开时保持浅蓝底，表示这一组正在展开（用户 2026-10-20）。 */
.nav-settings-toggle {
  @apply border border-transparent transition-colors hover:border-brand-500/25 hover:bg-brand-500/10 focus-visible:border-brand-500/25 focus-visible:bg-brand-500/10;
}
.nav-settings-toggle[aria-expanded='true'] {
  @apply border-brand-500/25 bg-brand-500/15;
}
.nav-caption { @apply px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground/75; }
/* 侧栏两个分区（用户 2026-10-19）：「智能清单」「我的清单」各用一圈细线框住，中间留一条缝 */
.nav-group { @apply rounded-2xl border border-border/70 bg-surface/40 p-2; }
.nav-group + .nav-group { @apply mt-3; }
.nav-row { @apply my-0.5 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground/80 transition-all hover:bg-muted hover:text-foreground; }
.nav-row-active { @apply bg-brand-500/10 text-brand-600 shadow-[inset_3px_0_0_rgb(var(--color-brand-500))] dark:text-brand-300; }
.nav-symbol { @apply flex h-8 w-8 items-center justify-center rounded-[10px]; }
/* 清单行的图标块：比原来的小圆点占位大一点，但比 nav-symbol 小，免得跟「智能清单」抢视线 */
.nav-list-icon { @apply flex h-6 w-6 shrink-0 items-center justify-center rounded-lg; }
.nav-symbol :deep(svg), .mobile-tab :deep(svg) { width: 18px; height: 18px; }
.nav-count { @apply min-w-6 rounded-full bg-muted px-1.5 py-0.5 text-center text-[10px] font-bold text-muted-foreground; }
.tiny-add { @apply flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground; }
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

/* 「清单」标签弹出的清单列表（手机底部弹层） */
.sheet-backdrop { @apply fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px]; }
.lists-sheet { @apply fixed inset-x-0 bottom-0 z-[71] max-h-[72vh] rounded-t-[26px] border-t border-border bg-surface pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_50px_-12px_rgba(15,23,42,.4)]; }
.lists-sheet-head { @apply sticky top-0 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-5 py-3 backdrop-blur; }
.lists-sheet-body { @apply max-h-[calc(72vh-3.25rem)] overflow-y-auto overscroll-contain; }
.lists-sheet-row { @apply flex w-full items-center gap-3 border-b border-border/60 px-5 py-3.5 text-left text-sm font-semibold text-foreground transition active:bg-muted; }
.lists-sheet-row-active { @apply text-brand-600 dark:text-brand-300; }
.sheet-enter-active, .sheet-leave-active { @apply transition duration-200 ease-out; }
.sheet-enter-from, .sheet-leave-to { @apply opacity-0; }
.sheet-enter-from .lists-sheet, .sheet-leave-to .lists-sheet { @apply translate-y-8; }
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
