<template>
  <div class="mx-auto max-w-6xl">
    <!-- 信用卡账单是固定栏目：这一页**只有卡片**——没有快速新建、没有提醒列表、
         没有完成记录筛选；要加东西就点「新建卡片」。 -->
    <template v-if="isCardBucketPage">
      <!-- 页面标题那一行右侧就是时间卡片：宽屏并排（有最大宽度），窄屏自动折到标题下方 -->
      <section class="mb-3 flex flex-col gap-2.5 sm:mb-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div class="min-w-0 lg:shrink-0">
          <div class="mb-2 hidden items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground sm:flex">
            <span class="h-2 w-2 rounded-full" :style="{ background: accentColor }"></span>
            信用卡账单
          </div>
          <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">信用卡账单</h1>
          <p class="mt-2 hidden text-sm text-muted-foreground sm:block">卡片、账单日与本周待还都在这一页；一个栏目装下所有卡。</p>
          <p class="truncate text-xs text-muted-foreground sm:hidden">卡片与本周待还都在这一页</p>
        </div>
        <!-- 宽度放到最大：占满标题右侧剩下的空间（不再设上限），窄屏自动折到标题下方 -->
        <div class="min-w-0 w-full lg:flex-1">
          <BillingStrip :refresh-key="weekRefreshKey" />
        </div>
      </section>
      <CreditCardPanel v-if="selectedList" :list="selectedList" @changed="onCardsChanged" @refresh-strip="weekRefreshKey += 1" />
    </template>

    <template v-else>
      <section class="mb-3 flex flex-col gap-2.5 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div class="min-w-0">
          <div class="mb-2 hidden items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground sm:flex">
            <ListIcon
              v-if="selectedList"
              :name="selectedList.icon"
              :size="14"
              :style="{ color: accentColor }"
            />
            <span v-else class="h-2 w-2 rounded-full" :style="{ background: accentColor }"></span>
            {{ eyebrow }}
          </div>
          <div class="flex flex-wrap items-baseline gap-x-2">
            <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">{{ pageTitle }}</h1>
            <p class="truncate text-xs text-muted-foreground sm:hidden">{{ subtitle }}</p>
          </div>
          <p class="mt-2 hidden text-sm text-muted-foreground sm:block">{{ subtitle }}</p>
        </div>
        <label class="search-box">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" stroke-width="1.8"/><path d="m16.5 16.5 4 4" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input v-model="search" placeholder="搜索提醒…" @input="debouncedLoad" />
          <kbd class="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] sm:inline">⌘ K</kbd>
        </label>
      </section>

      <section v-if="view !== 'completed'" class="quick-card" :class="{ 'quick-card-expanded': quickExpanded }">
        <div class="flex items-start gap-3">
          <button class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-brand-500/25 text-brand-500" aria-label="新提醒">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <div class="min-w-0 flex-1">
            <input
              ref="quickInput"
              v-model="quick.title"
              class="w-full bg-transparent text-[17px] font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground/65"
              :placeholder="quick.kind === 'note' ? '记一笔…' : '添加一条提醒…'"
              maxlength="200"
              @keydown.enter.prevent="submitQuick"
              @focus="quickFocused = true"
              @click="quickFocused = true"
            />
            <p v-if="quick.notes" class="mt-1 truncate text-xs text-muted-foreground">{{ quick.notes }}</p>
          </div>
          <button v-if="quick.title" class="btn-primary !h-9 !px-4" :disabled="saving" @click="submitQuick">{{ saving ? '保存中' : quick.kind === 'note' ? '记下' : '添加' }}</button>
        </div>

        <div v-if="quickFocused || quick.title" class="mt-3 border-t border-border/60 pt-3 sm:mt-4 sm:pt-4">
          <!-- 计划页的输入窗口与今天页**刻意不同**（用户要求）：
               没有「记事」（计划里只有任务）、没有「今天/明天/本周末」这类相对快捷项，
               改成自定义的**开始 / 结束**（结束留空就是单点时间）+ 重复规则。 -->
          <div v-if="isPlanned" class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <label class="field-label relative">
              开始
              <button ref="planStartAnchor" type="button" class="quick-chip !h-8" :class="{ active: !!quick.start_at }" @click="planStartOpen = !planStartOpen">
                {{ quick.start_at ? formatFullDue(quick.start_at) : '选择开始时间' }}
              </button>
              <LunarDatePicker v-if="planStartOpen" v-model="planStartPicked" with-time :anchor-el="planStartAnchor" @commit="commitPlanStart" />
            </label>
            <label class="field-label relative">
              结束
              <button ref="planEndAnchor" type="button" class="quick-chip !h-8" :class="{ active: !!quick.end_at }" @click="planEndOpen = !planEndOpen">
                {{ quick.end_at ? formatFullDue(quick.end_at) : '可选（时间段）' }}
              </button>
              <LunarDatePicker v-if="planEndOpen" v-model="planEndPicked" with-time :anchor-el="planEndAnchor" @commit="commitPlanEnd" />
            </label>
            <button v-if="quick.end_at" class="quick-chip !h-8" title="清掉结束时间，改成单点时间" @click="clearPlanEnd">清除结束</button>
            <label class="field-label">
              重复
              <select v-model="quick.repeat_rule" class="quick-chip !h-8 !px-2">
                <option value="none">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="yearly">每年</option>
              </select>
            </label>
            <button class="quick-chip !h-8" :class="{ active: quick.priority === 3 }" @click="quick.priority = quick.priority === 3 ? 0 : 3">
              <span class="text-rose-500">!!!</span> 重要
            </button>
            <label class="ml-0.5 inline-flex items-center gap-1.5" title="这条计划加到哪个清单（默认取偏好设置里的默认清单）">
              <i class="h-2 w-2 shrink-0 rounded-full" :style="{ background: listColor(quickListColor) }"></i>
              <select v-model.number="quick.list_id" class="quick-chip !h-8 max-w-[9rem] !px-2 !text-[11px]" aria-label="选择清单">
                <option v-for="list in navLists" :key="list.id" :value="list.id">{{ list.name }}</option>
              </select>
            </label>
            <button class="quick-chip !h-8" :class="{ active: quickExpanded }" @click="quickExpanded = !quickExpanded">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 6v.01M12 12v.01M12 18v.01" stroke-width="3" stroke-linecap="round"/></svg>
              更多
            </button>
            <span v-if="quick.start_at" class="ml-auto text-xs font-semibold text-brand-600 dark:text-brand-300">
              {{ planRangeLabel }}
            </span>
          </div>
          <div v-else class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button class="quick-chip" :class="{ active: quick.kind !== 'note' }" @click="setQuickKind('task')">任务</button>
            <button class="quick-chip" :class="{ active: quick.kind === 'note' }" @click="setQuickKind('note')">记事</button>
            <span v-if="quick.kind !== 'note'" class="mx-0.5 h-4 w-px bg-border"></span>
            <template v-if="quick.kind !== 'note'">
              <button class="quick-chip" :class="{ active: preset === 'today' }" @click="setPreset('today')">今天</button>
              <button class="quick-chip" :class="{ active: preset === 'tomorrow' }" @click="setPreset('tomorrow')">明天</button>
              <button class="quick-chip" :class="{ active: preset === 'weekend' }" @click="setPreset('weekend')">本周末</button>
              <button class="quick-chip" :class="{ active: quick.priority === 3 }" @click="quick.priority = quick.priority === 3 ? 0 : 3">
                <span class="text-rose-500">!!!</span> 重要
              </button>
              <!-- 清单选择常显（原来藏在「更多」里）：默认是「偏好设置 → 默认清单」里那一本，
                   临时想放到别的清单就在这里改，改完只影响这一次新建。 -->
              <label class="ml-0.5 inline-flex items-center gap-1.5" title="这条提醒加到哪个清单（默认取偏好设置里的默认清单）">
                <i class="h-2 w-2 shrink-0 rounded-full" :style="{ background: listColor(quickListColor) }"></i>
                <select
                  v-model.number="quick.list_id"
                  class="quick-chip !h-7 max-w-[9rem] !px-2 !text-[11px]"
                  aria-label="选择清单"
                >
                  <option v-for="list in navLists" :key="list.id" :value="list.id">{{ list.name }}</option>
                </select>
              </label>
              <button class="quick-chip" :class="{ active: quickExpanded }" @click="quickExpanded = !quickExpanded">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 6v.01M12 12v.01M12 18v.01" stroke-width="3" stroke-linecap="round"/></svg>
                更多
              </button>
            </template>
            <span v-if="quick.kind === 'note'" class="ml-auto text-xs font-semibold text-muted-foreground">记事保存后直接归入「已完成」</span>
            <span v-else-if="quick.due_at" class="ml-auto text-xs font-semibold text-brand-600 dark:text-brand-300">{{ formatDue(quick.due_at) }}</span>
          </div>

          <Transition name="expand">
            <div v-if="quickExpanded && quick.kind !== 'note'" class="mt-3 grid gap-2.5 rounded-2xl bg-muted/65 p-3 sm:mt-4 sm:grid-cols-2 sm:gap-3 sm:p-4 lg:grid-cols-4">
              <div class="field-label relative">
                日期时间
                <button ref="quickDateAnchor" type="button" class="compact-input mt-1.5 flex h-9 w-full items-center justify-between px-3 text-left text-xs font-medium" :class="{ '!border-brand-500/50': quickDateOpen }" @click="quickDateOpen = !quickDateOpen">
                  <span :class="{ 'text-muted-foreground/60': !quick.due_at }">{{ quick.due_at ? formatFullDue(quick.due_at) : '选择日期' }}</span>
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
                <LunarDatePicker v-if="quickDateOpen" v-model="quickDatePicked" with-time :anchor-el="quickDateAnchor" @commit="quickDateOpen = false" />
              </div>
              <label class="field-label">重复<select v-model="quick.repeat_rule" class="compact-input"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>
              <label class="field-label">备注<input v-model="quick.notes" class="compact-input" placeholder="可选" maxlength="5000" /></label>
              <label class="field-label">按农历循环<select v-model="quick.calendar" class="compact-input" @change="upgradeCalendarToYearly(quick)"><option value="solar">公历</option><option value="lunar">农历</option></select></label>
              <label class="field-label">过期提醒频率<RepeatNotifySelect :model-value="quick.repeat_notify_minutes ?? 0" @update:model-value="quick.repeat_notify_minutes = $event" /></label>
              <p v-if="quick.calendar === 'lunar'" class="text-[10px] leading-4 text-muted-foreground sm:col-span-2 lg:col-span-4">已按农历循环：提醒按所选日期的农历月/日重复，腊月三十遇小年自动改为除夕当天，闰月日期遇无闰月年份自动用对应平月。</p>
              <div class="sm:col-span-2 lg:col-span-4">
                <p class="field-label mb-2">通知方式</p>
                <div class="flex flex-wrap gap-2">
                  <button v-for="channel in selectableChannels" :key="channel.channel" class="channel-pill" :class="{ selected: isQuickChannelSelected(channel.channel) }" :disabled="channel.channel !== 'inapp' && (!channel.bound || channel.status !== 'active')" @click="toggleQuickChannel(channel.channel)">
                    {{ channel.label }}
                  </button>
                </div>
              </div>
              <!-- 底部提交按钮：手机端填完下方字段后无需滚回顶部再点添加 -->
              <div class="sm:col-span-2 lg:col-span-4">
                <button class="btn-primary w-full" :disabled="saving || !quick.title?.trim()" @click="submitQuick">{{ saving ? '保存中…' : '添加提醒' }}</button>
              </div>
            </div>
          </Transition>
        </div>
      </section>

      <!-- 标题工具栏：条数 / 过期提示 / 未完成·全部 / 刷新（导出只在电脑上出现） -->
      <div class="list-toolbar">
        <div class="list-toolbar-count">
          <span class="count-number">{{ view === 'completed' ? completedItems.length : items.length }}</span>
          <span class="count-unit">项</span>
          <span
            v-if="view !== 'completed' && overdueCount"
            class="count-overdue"
            :title="`已经过了提醒时间还没做的：${overdueCount} 项`"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ overdueCount }} 项已过期
          </span>
        </div>
        <div class="list-toolbar-actions">
          <!-- 未完成 / 全部：记事创建即完成，想在这个页面看见记事就得切到「全部」。
               选择记在本地（跟人走、跟设备走），与清单筛选一致。 -->
          <div
            v-if="view !== 'completed'"
            class="seg-group"
            role="group"
            aria-label="显示范围"
          >
            <button
              type="button"
              class="seg-btn"
              :class="{ 'seg-btn-on': listStatus === 'open' }"
              :aria-pressed="listStatus === 'open'"
              title="只看还没完成的"
              @click="setListStatus('open')"
            >未完成</button>
            <button
              type="button"
              class="seg-btn"
              :class="{ 'seg-btn-on': listStatus === 'all' }"
              :aria-pressed="listStatus === 'all'"
              title="未完成和已完成都显示（含记事）"
              @click="setListStatus('all')"
            >全部</button>
          </div>
          <button
            class="toolbar-btn inline-flex"
            :class="{ 'is-spinning': loading }"
            :disabled="loading"
            aria-label="刷新"
            title="重新读取这一页的数据"
            @click="loadData"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>刷新</span>
          </button>
          <!-- 导出表格：手机上不提供（屏幕小、CSV 也不好用），电脑上照旧 -->
          <button class="toolbar-btn hidden sm:inline-flex" :class="{ 'is-spinning': exporting }" :disabled="exporting" @click="handleExport">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>{{ exporting ? '导出中…' : '导出表格' }}</span>
          </button>
          <button
            v-if="view === 'completed'"
            class="toolbar-btn hidden sm:inline-flex"
            :disabled="!completedItems.length"
            @click="printOpen = true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M7 9V4h10v5M7 19H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 15h10v6H7z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>打印</span>
          </button>
        </div>
      </div>

      <!-- 已完成的时间段筛选。记录来源包含 completions 历史（重复提醒的每次完成），
           所以这里的数字通常远大于「有 completed_at 的提醒数」。 -->
      <section v-if="view === 'completed'" class="mb-4 rounded-2xl bg-muted/55 p-3 sm:p-4">
        <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            v-for="opt in rangeOptions"
            :key="opt.value"
            class="quick-chip"
            :class="{ active: completedRange === opt.value }"
            @click="setCompletedRange(opt.value)"
          >{{ opt.label }}</button>
        </div>
        <!-- 后端算出来的实际区间（含当天）+ 生效的清单筛选。放在这里是为了让
             「这个时间段是哪几天、还筛了哪些清单」一眼可见：条数不对时能立刻
             看出是哪一层筛选造成的，而不是只能猜。 -->
        <p v-if="completedSpan" class="mt-2 text-[11px] font-medium text-muted-foreground">
          当前区间：<span class="font-bold text-foreground/80">{{ completedSpan }}</span>
          <template v-if="completedFilterSummary">
            <span class="mx-1">·</span>清单：<span class="font-bold text-foreground/80">{{ completedFilterSummary }}</span>
          </template>
        </p>
        <!-- 选择显示哪些清单的完成记录；不选=全部。选择记在本地。 -->
        <!-- 筛选用**全部**清单（含「信用卡账单」栏目）：卡片提醒也会出现在完成记录里，
             能按它筛；而「新建提醒的清单下拉」仍用 navLists（不能往卡片栏目里塞任务）。 -->
        <ListFilter v-model="completedListFilter" :lists="lists" class="mt-3" />
        <div v-if="completedRange === 'custom'" class="mt-3 flex flex-wrap items-center gap-2">
          <input v-model="customFrom" type="date" class="compact-input !w-auto" aria-label="开始日期" />
          <span class="text-xs text-muted-foreground">至</span>
          <input v-model="customTo" type="date" class="compact-input !w-auto" aria-label="结束日期" />
          <button class="btn-primary !h-9 !px-4" :disabled="!customFrom || !customTo" @click="loadItems">查询</button>
        </div>
      </section>

      <section v-if="loading" class="space-y-3">
        <div v-for="n in 4" :key="n" class="h-20 animate-pulse rounded-2xl bg-surface/80"></div>
      </section>

      <!-- 已完成：只读的完成记录，不能「完成 / 稍后提醒」；底层提醒还在时才可以编辑或删除 -->
      <section v-else-if="view === 'completed' && completedItems.length" class="space-y-2">
        <article v-for="entry in completedItems" :key="`${entry.source}-${entry.id}`" class="reminder-row reminder-completed">
          <button class="complete-button cursor-default" disabled :aria-label="entry.kind === 'note' ? '记事' : '已完成'">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="min-w-0 flex-1 text-left" :disabled="!entry.reminder_exists" @click="openCompletedEntry(entry)">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-sm font-bold sm:text-[15px]">{{ entry.title }}</h3>
              <span v-if="entry.kind === 'note'" class="tiny-badge">记事</span>
              <span v-else-if="entry.repeat_rule && entry.repeat_rule !== 'none'" class="tiny-badge">{{ ruleLabel(entry.repeat_rule) }}</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground sm:mt-2">
              <span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 7v5l3 2" stroke-width="1.8" stroke-linecap="round"/></svg>
                {{ formatCompletedAt(entry.completed_at) }}
              </span>
              <template v-if="entry.list_name">
                <span class="h-1 w-1 rounded-full bg-border"></span>
                <span>{{ entry.list_name }}</span>
              </template>
              <template v-if="!entry.reminder_exists">
                <span class="h-1 w-1 rounded-full bg-border"></span>
                <span>提醒已删除</span>
              </template>
            </div>
          </button>
          <div class="row-actions">
            <button v-if="entry.reminder_exists" class="row-action hover:!text-rose-500" title="删除提醒" @click="removeCompleted(entry)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="view !== 'completed' && items.length" class="space-y-2">
        <article
          v-for="item in items"
          :key="item.id"
          class="reminder-row group"
          :class="{ 'reminder-completed': !!item.completed_at, 'reminder-overdue': isOverdue(item) }"
        >
          <button
            class="complete-button"
            :class="{ 'cursor-default': item.kind === 'note' }"
            :disabled="item.kind === 'note'"
            :aria-label="item.kind === 'note' ? '记事，无需完成' : item.completed_at ? '恢复提醒' : '完成提醒'"
            @click.stop="toggleComplete(item)"
          >
            <svg v-if="item.completed_at" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="min-w-0 flex-1 text-left" @click="editItem(item)">
            <div class="flex items-center gap-2">
              <!-- 任务标题用所属清单的颜色：侧栏圆点、这里的标题、日历色块三处同色。
                   颜色在侧栏「编辑清单」里改，改完会广播数据变更，本页与日历立即刷新。 -->
              <h3 class="truncate text-sm font-bold sm:text-[15px]" :style="{ color: listColor(item.list_color) }">{{ item.title }}</h3>
              <span v-if="item.kind === 'note'" class="tiny-badge">记事</span>
              <span v-if="item.priority" class="priority-mark" :class="`priority-${item.priority}`">{{ '!'.repeat(item.priority) }}</span>
              <span v-if="item.repeat_rule !== 'none'" class="tiny-badge">{{ item.calendar === 'lunar' ? `农历${ruleLabel(item.repeat_rule)}` : ruleLabel(item.repeat_rule) }}</span>
              <span v-if="item.repeat_notify_minutes" class="tiny-badge">过期提醒</span>
            </div>
            <p v-if="item.notes" class="mt-0.5 truncate text-xs text-muted-foreground sm:mt-1">{{ item.notes }}</p>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground sm:mt-2">
              <span class="inline-flex items-center gap-1" :class="{ 'text-rose-500': isOverdue(item) }">
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 7v5l3 2" stroke-width="1.8" stroke-linecap="round"/></svg>
                {{ dueLabel(item) }}
              </span>
              <span v-if="isOverdue(item)" class="tiny-badge !text-rose-500">已逾期</span>
              <span class="h-1 w-1 rounded-full bg-border"></span>
              <span>{{ item.list_name }}</span>
              <span v-if="item.channels?.length" class="h-1 w-1 rounded-full bg-border"></span>
              <span v-if="item.channels?.length">{{ item.channels.map(channelName).join(' · ') }}</span>
            </div>
          </button>
          <div class="row-actions">
            <button v-if="!item.completed_at && item.due_at && item.kind !== 'note'" class="row-action" title="稍后提醒" @click="snooze(item, 10)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M12 8v4l3 2M5 3l-2 3m16-3 2 3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <button class="row-action hover:!text-rose-500" title="删除" @click="removeItem(item)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </article>
      </section>

      <section v-else class="empty-state">
        <div class="empty-art" aria-hidden="true">
          <span class="empty-ring"></span>
          <span class="empty-check"><svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <span class="empty-dot dot-one"></span><span class="empty-dot dot-two"></span><span class="empty-dot dot-three"></span>
        </div>
        <h3 class="mt-5 text-lg font-extrabold">{{ emptyTitle }}</h3>
        <p class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{{ emptyText }}</p>
        <button v-if="view !== 'completed'" class="btn-primary mt-5" @click="focusQuickAdd">添加第一条提醒</button>
      </section>

      <!-- 提醒编辑器：与日历视图共用同一个组件，改一处两边同时生效 -->
      <ReminderEditor
        v-model="editorOpen"
        :reminder-id="editingId"
        :lists="navLists"
        :channels="selectableChannels"
        @saved="onEditorSaved"
      />

      <!-- 打印完成记录：勾选要打印的列，纸张方向/字号按列数自动适配 -->
      <PrintDialog
        v-model="printOpen"
        :items="completedItems"
        :range-label="completedSpan"
        :list-label="completedFilterSummary"
        :site-title="authStore.siteTitle || '工作序记'"
      />

      <Toast :message="toast.message" :type="toast.type" />

      <ConfirmDialog
        v-model="removeVisible"
        danger
        title="删除这条提醒？"
        :message="`「${removeTarget?.title || ''}」删除后无法恢复。`"
        confirm-text="删除"
        loading-text="删除中…"
        :loading="removeLoading"
        @confirm="confirmRemove"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import Toast from '../components/Toast.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ListFilter from '../components/ListFilter.vue'
import ListIcon from '../components/ListIcon.vue'
import BillingStrip from '../components/BillingStrip.vue'
import LunarDatePicker from '../components/LunarDatePicker.vue'
import RepeatNotifySelect from '../components/RepeatNotifySelect.vue'
import PrintDialog from '../components/PrintDialog.vue'
import CreditCardPanel from '../components/CreditCardPanel.vue'
import { listColorHex } from '../utils/list-colors'
import ReminderEditor from '../components/ReminderEditor.vue'
import {
  completeReminder, createReminder, deleteReminder, exportReminders, getChannelStatuses, getCompletedHistory, getLists,
  getReminder, getReminders, listIdsParam, restoreReminder, snoozeReminder, updateReminder,
  type ChannelStatus, type CompletedItem, type CompletedRangeOption, type ReminderChannel,
  type ReminderItem, type ReminderKind, type ReminderList, type SaveReminderInput
} from '../api/reminder'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const items = ref<ReminderItem[]>([])
// 「已完成」的数据源与普通列表不同（历史表 ∪ 完成记录），单独存一份。
const completedItems = ref<CompletedItem[]>([])
// 后端算出来的实际区间文案（含当天），显示在筛选器下方供核对。
const completedSpan = ref('')
// 打印弹窗开关
const printOpen = ref(false)
// 生效中的清单筛选；空字符串=没筛（全部）。条数对不上时，第一眼要能看出
// 是不是这层筛选造成的——它就写在「当前区间」后面。
const completedFilterSummary = computed(() => {
  const ids = completedListFilter.value
  if (!ids.length) return ''
  const names = lists.value.filter((l) => ids.includes(l.id)).map((l) => l.name)
  return names.length ? names.join('、') : `${ids.length} 个清单`
})
const completedRange = ref<CompletedRangeOption>('all')
// 已完成页显示哪些清单；空数组 = 全部
const COMPLETED_FILTER_KEY = 'ui_completed_lists'
// 「未完成 / 全部」开关记在本地：这类偏好跟人走、跟设备走，不必上服务端。
const LIST_STATUS_KEY = 'ui_list_status'
const completedListFilter = ref<number[]>(readCompletedFilter())
function readCompletedFilter(): number[] {
  try {
    const raw = localStorage.getItem(COMPLETED_FILTER_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number' && n > 0) : []
  } catch { return [] }
}
watch(completedListFilter, (v) => {
  try { localStorage.setItem(COMPLETED_FILTER_KEY, JSON.stringify(v)) } catch { /* 隐私模式忽略 */ }
  if (view.value === 'completed') void loadItems()
})

// 列表页的「未完成 / 全部」：'all' 时后端连已完成的也返回（记事因此可见）。
// 「已完成」页有自己的口径，不受这个开关影响（模板里也不显示它）。
const listStatus = ref<'open' | 'all'>(readListStatus())
const showCompleted = computed(() => listStatus.value === 'all')
function readListStatus(): 'open' | 'all' {
  try { return localStorage.getItem(LIST_STATUS_KEY) === 'all' ? 'all' : 'open' } catch { return 'open' }
}
function setListStatus(next: 'open' | 'all') {
  if (listStatus.value === next) return
  listStatus.value = next
  try { localStorage.setItem(LIST_STATUS_KEY, next) } catch { /* 隐私模式忽略 */ }
  void loadItems()
}
const customFrom = ref('')
const customTo = ref('')
const lists = ref<ReminderList[]>([])
const selectableChannels = ref<ChannelStatus[]>([])
const loading = ref(true)
const saving = ref(false)
const search = ref('')
const quickInput = ref<HTMLInputElement | null>(null)
const quickFocused = ref(false)
const quickExpanded = ref(false)
const preset = ref('today')
const editorOpen = ref(false)
const clockNow = ref(Date.now())
const toast = reactive<{ message: string; type: 'success' | 'error' }>({ message: '', type: 'success' })

// 新建提醒默认落在「今天」。时间沿用「今天」芯片既有的 20:00 约定，
// 这样默认值与芯片点亮状态一致，不会出现「日期是今天、芯片却没点亮」的错位。
function defaultQuickDue(): string {
  const d = new Date()
  d.setHours(20, 0, 0, 0)
  return toLocalIso(d)
}
const blankInput = (): SaveReminderInput => ({
  title: '', notes: '', kind: 'task', list_id: 0, priority: 0, due_at: defaultQuickDue(),
  start_at: null, end_at: null,
  all_day: false, repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
})
const quick = reactive<SaveReminderInput>(blankInput())
const editingId = ref<number | null>(null)
let quickChannelsTouched = false

const view = computed(() => String(route.meta.reminderView || 'today'))
// 计划页的输入窗口与今天页不同：只用自定义时间/时间段，没有任何相对快捷项，
// 也没有「记事」（计划里只有任务）。见模板里的 v-if="isPlanned" 一支。
const isPlanned = computed(() => view.value === 'planned')
const planStartOpen = ref(false)
const planEndOpen = ref(false)
const planStartAnchor = ref<HTMLElement | null>(null)
const planEndAnchor = ref<HTMLElement | null>(null)
const planStartPicked = computed({
  get: () => (quick.start_at ? new Date(quick.start_at) : null),
  set: value => { quick.start_at = value ? toLocalIso(value) : null },
})
const planEndPicked = computed({
  get: () => (quick.end_at ? new Date(quick.end_at) : null),
  set: value => { quick.end_at = value ? toLocalIso(value) : null },
})
function commitPlanStart() {
  planStartOpen.value = false
  // 结束时间没填或填得比开始还早：跟着开始时间顺延一小时，省得用户再点一次
  if (!quick.start_at) return
  if (!quick.end_at || new Date(quick.end_at).getTime() <= new Date(quick.start_at).getTime()) {
    quick.end_at = toLocalIso(new Date(new Date(quick.start_at).getTime() + 60 * 60 * 1000))
  }
}
function commitPlanEnd() { planEndOpen.value = false }
function clearPlanEnd() { quick.end_at = null }
const planRangeLabel = computed(() => {
  if (!quick.start_at) return ''
  const start = formatFullDue(quick.start_at)
  if (!quick.end_at) return start
  const end = new Date(quick.end_at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = new Date(quick.start_at).toDateString() === end.toDateString()
  return `${start} – ${sameDay ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : formatFullDue(quick.end_at)}`
})
const selectedListID = computed(() => route.name === 'ReminderList' ? Number(route.params.id) : undefined)
const selectedList = computed(() => lists.value.find(x => x.id === selectedListID.value))
// 「信用卡账单」是固定栏目：这一页只渲染卡片面板（见模板最上面那一支），
// 快速新建、提醒列表、完成记录筛选都不出现。栏目被后台关掉时不认这一页。
// 卡片有增删改时 +1，头部时间卡片据此重新拉一次（它自己管数据）
const weekRefreshKey = ref(0)
function onCardsChanged() {
  weekRefreshKey.value += 1
  void loadData()
}
const isCardBucketPage = computed(() => selectedList.value?.template === 'credit_card' && authStore.creditCardEnabled)
// 下拉/筛选里能选的只有普通清单（卡片栏目不是「清单」，不该出现在这些地方）
const navLists = computed(() => lists.value.filter((l) => l.template !== 'credit_card'))
const pageTitle = computed(() => selectedList.value?.name || String(route.meta.title || '今天'))
const eyebrow = computed(() => selectedList.value ? '我的清单' : view.value === 'today' ? '此刻最重要' : '工作序记')
const accentColor = computed(() => selectedList.value ? listColor(selectedList.value.color) : view.value === 'completed' ? '#10b981' : '#3182f6')
const subtitle = computed(() => {
  if (selectedList.value) return `${selectedList.value.open_count || 0} 件事情正在等你`
  if (view.value === 'today') return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  if (view.value === 'planned') return '按时间整理好接下来的安排'
  if (view.value === 'completed') return '每一个勾选，都是向前一步'
  return '所有未完成的提醒都在这里'
})
const overdueCount = computed(() => items.value.filter(isOverdue).length)
const emptyTitle = computed(() => view.value === 'completed'
  ? (completedRange.value === 'all' ? '还没有完成记录' : '这个时间段没有记录')
  : view.value === 'today' ? '今天轻松了' : '这里还没有提醒')
const emptyText = computed(() => view.value === 'completed'
  ? (completedRange.value === 'all' ? '完成的提醒会安静地收在这里。' : '换一个时间段看看，或者选「全部」。')
  : '把脑海里惦记的事情记下来，剩下的交给 Reminder。')

const quickDateOpen = ref(false)
const quickDateAnchor = ref<HTMLElement | null>(null)

// 新建框里那个「任务清单」选择框该默认选谁：
//   - 在某个具体清单页面（/admin/list/:id）→ 跟着当前清单走；
//   - 今天 / 计划 / 全部 / 已完成       → 用后台设置的默认清单。
// 只依赖「路由里的清单」和「后台默认清单」这两个来源，别依赖整个 lists 数组：
// 别人同步过来的实时刷新会重取清单列表，那样会把用户刚手动选的清单冲掉。
const defaultListID = computed(() => navLists.value.find(x => x.is_default)?.id || navLists.value[0]?.id || 0)
const quickTargetListID = computed(() => selectedListID.value || defaultListID.value || 0)
watch([selectedListID, defaultListID], () => {
  quick.list_id = quickTargetListID.value
}, { immediate: true })

const quickDatePicked = computed({
  get: () => (quick.due_at ? new Date(quick.due_at) : null),
  set: value => {
    quick.due_at = value ? toLocalIso(value) : null
    preset.value = ''
  },
})

// toLocalIso 序列化为带本地时区偏移的 RFC3339 串（后端 time.Time 只认
// RFC3339），既保住所选墙钟时间又不会因缺时区后缀被拒。
function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMinutes = -d.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function debouncedLoad() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadItems, 250)
}

watch(() => route.fullPath, () => {
  loadRouteData()
  openRequestedEditor()
})

// 日历页点标题会带着 ?edit=<id> 跳过来。这里打开那条提醒的编辑面板，
// 并立刻把参数从地址上抹掉，免得刷新或返回时又弹出一次。
async function openRequestedEditor() {
  const raw = route.query.edit
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  if (raw === undefined || !Number.isFinite(id) || id <= 0) return
  const rest = { ...route.query }
  delete rest.edit
  router.replace({ path: route.path, query: rest })
  try {
    const res = await getReminder(id)
    if (res.data?.data) editItem(res.data.data)
  } catch {
    showToast('这条提醒已不存在', 'error')
  }
}

async function loadData() {
  loading.value = true
  try {
    const [listRes, channelRes] = await Promise.all([getLists(), getChannelStatuses()])
    lists.value = listRes.data.data || []
    selectableChannels.value = channelRes.data.data || []
    if (!quickChannelsTouched) {
      quick.channels = selectableChannels.value
        .filter(channel => channel.channel === 'inapp' || (channel.bound && channel.status === 'active'))
        .map(channel => channel.channel)
      if (!quick.channels.length) quick.channels = ['inapp']
    }
    // 清单选择框的默认值由 quickTargetListID 的 watcher 统一负责（进具体清单跟随、其余用后台默认）
    await loadItems()
  } catch (err: any) {
    showToast(err.response?.data?.message || '读取提醒失败', 'error')
  } finally {
    loading.value = false
  }
}
async function loadRouteData() {
  loading.value = true
  try {
    if (selectedListID.value && !lists.value.some(list => list.id === selectedListID.value)) {
      await loadData()
      return
    }
    // 信用卡账单页只有卡片：这一页不需要（也不该）拉提醒列表。
    if (isCardBucketPage.value) return
    await loadItems()
  } catch (err: any) {
    showToast(err.response?.data?.message || '读取提醒失败', 'error')
  } finally {
    loading.value = false
  }
}
async function loadItems() {
  // 信用卡账单页不显示提醒列表；卡片面板自己会去拉卡片与本周待还。
  if (isCardBucketPage.value) return
  if (view.value === 'completed') {
    const res = await getCompletedHistory({
      range: completedRange.value,
      from: completedRange.value === 'custom' ? customFrom.value || undefined : undefined,
      to: completedRange.value === 'custom' ? customTo.value || undefined : undefined,
      // 已完成页自己带清单筛选；进具体清单时（列表页）仍有 selectedListID 兜底
      list_ids: listIdsParam(completedListFilter.value),
      list_id: completedListFilter.value.length ? undefined : selectedListID.value,
      q: search.value || undefined,
    })
    // 接口返回 { items, span }：span 是后端算出来的实际区间，直接显示出来，
    // 免得「这个时间段到底是哪几天」只能靠猜（用户核对条数时最需要它）。
    const payload = res.data.data || {}
    completedItems.value = payload.items || []
    completedSpan.value = payload.span?.label || ''
    return
  }
  const res = await getReminders({
    view: view.value,
    list_id: selectedListID.value,
    q: search.value || undefined,
    status: showCompleted.value ? 'all' : undefined,
  })
  items.value = res.data.data || []
}
// 导出「当前屏幕上这一份筛选结果」。已完成页带时间段与清单筛选，列表页带视图/清单/搜索，
// 参数与 loadItems 完全一致，避免导出内容和看到的列表对不上。
const exporting = ref(false)
async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  const completed = view.value === 'completed'
  try {
    const res = await exportReminders({
      scope: completed ? 'completed' : 'active',
      view: completed ? undefined : view.value,
      range: completed ? completedRange.value : undefined,
      from: completed && completedRange.value === 'custom' ? customFrom.value || undefined : undefined,
      to: completed && completedRange.value === 'custom' ? customTo.value || undefined : undefined,
      list_ids: listIdsParam(completed ? completedListFilter.value : (selectedListID.value ? [selectedListID.value] : [])),
      list_id: completed && !completedListFilter.value.length ? selectedListID.value : undefined,
      q: search.value || undefined,
      // 导出必须和屏幕上这一份一致：开关在「全部」时连已完成的一起导出。
      status: !completed && showCompleted.value ? 'all' : undefined,
    })
    const filename = completed ? 'completed-list.csv' : 'task-list.csv'
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
    showToast(`已导出 ${filename}`, 'success')
  } catch (err: any) {
    showToast(err?.response?.data?.message || '导出失败', 'error')
  } finally {
    exporting.value = false
  }
}
async function submitQuick() {
  if (!quick.title?.trim() || saving.value) return
  // 计划页必须有开始时间：计划任务就是「有预设」的任务，没有时间就没有预设可言。
  if (isPlanned.value && !quick.start_at) {
    planStartOpen.value = true
    showToast('请先选择开始时间', 'error')
    return
  }
  saving.value = true
  try {
    // 没设日期的提醒不会出现在按到期时间过滤的「今天 / 计划」视图里：留在原地
    // 重新拉取会让用户以为没保存成功（接口 200、列表却毫无变化），所以切到
    // 「全部」并说明原因；已经在「全部 / 清单」里时行为不变。
    // 记事属于「已完成」，任何列表视图都不会出现它，所以单独说明去处，
    // 并且保持「记事」模式不变，方便连着记好几条。
    const isNote = quick.kind === 'note'
    const planned = isPlanned.value
    const undated = !quick.due_at && !quick.start_at
    // 计划页：只用时间段（结束留空＝单点），due_at 由后端按开始时间归位。
    const payload: SaveReminderInput = planned
      ? { ...quick, kind: 'task', title: quick.title.trim(), due_at: null, end_at: quick.end_at || null }
      : { ...quick, title: quick.title.trim() }
    await createReminder(payload)
    quickChannelsTouched = false
    Object.assign(quick, blankInput(), {
      kind: isNote ? 'note' : 'task',
      list_id: quickTargetListID.value,
      // 计划页默认不带「今天 20:00」，免得一进页面就误以为是今天的事
      due_at: planned ? null : defaultQuickDue(),
    })
    // 归位到「今天」：新建提醒默认带今天 20:00，芯片状态也要跟着点亮
    preset.value = isNote || planned ? '' : 'today'
    quickExpanded.value = false
    quickFocused.value = false
    if (isNote) {
      if (view.value === 'completed') await loadItems()
      showToast('记事已保存到「已完成」')
    } else if (undated && !selectedListID.value && (view.value === 'today' || view.value === 'planned')) {
      await router.push({ name: 'AllReminders' })
      showToast('已保存到「全部」：这条提醒没有设置日期')
    } else {
      await loadItems()
      showToast(planned ? '计划任务已添加' : '提醒已添加')
    }
    changed()
  } catch (err: any) {
    showToast(err.response?.data?.message || '添加失败', 'error')
  } finally {
    saving.value = false
    quickInput.value?.focus()
  }
}
// 任务 / 记事 切换。记事没有排期，切过去时把已经填好的日期、重复、优先级等
// 一并清掉，免得界面上留下选不了也删不掉的残留值；后端保存时还会再清一次。
function setQuickKind(kind: ReminderKind) {
  quick.kind = kind
  if (kind === 'note') {
    quick.due_at = null
    quick.priority = 0
    quick.repeat_rule = 'none'
    quick.calendar = 'solar'
    quick.repeat_notify_minutes = 0
    preset.value = ''
    quickExpanded.value = false
  }
}
// 已完成页的时间段选项。「全部」放第一个并作为默认，这样角标数字和列表条数
// 从一开始就是一致的；其余按时间由近到远排；自定义需要选完起止日期再点查询。
const rangeOptions: { value: CompletedRangeOption; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'week', label: '本周' },
  { value: 'lastweek', label: '上周' },
  { value: 'month', label: '本月' },
  { value: 'lastmonth', label: '上月' },
  { value: 'year', label: '今年' },
  { value: 'custom', label: '自定义' },
]
function setCompletedRange(option: CompletedRangeOption) {
  completedRange.value = option
  if (option !== 'custom') loadItems()
}
// 完成记录显示到分钟即可，且不显示「今天/明天」这类相对说法——它描述的是过去。
function formatCompletedAt(value: string | null | undefined) {
  if (!value) return ''
  return formatFullDue(value)
}
async function openCompletedEntry(entry: CompletedItem) {
  if (!entry.reminder_exists) return
  try {
    const res = await getReminder(entry.reminder_id)
    if (res.data?.data) editItem(res.data.data)
  } catch (err: any) {
    showToast(err.response?.data?.message || '这条提醒已不存在', 'error')
  }
}
function removeCompleted(entry: CompletedItem) {
  if (!entry.reminder_exists) return
  removeItem({ id: entry.reminder_id, title: entry.title })
}
function setPreset(kind: string) {
  preset.value = preset.value === kind ? '' : kind
  if (!preset.value) {
    quick.due_at = null
    return
  }
  const d = new Date()
  d.setSeconds(0, 0)
  if (kind === 'today') d.setHours(20, 0)
  if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0) }
  if (kind === 'weekend') { const add = (6 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); d.setHours(9, 0) }
  quick.due_at = d.toISOString()
}
function toggleQuickChannel(channel: ReminderChannel) {
  quickChannelsTouched = true
  const list = quick.channels || []
  quick.channels = list.includes(channel) ? list.filter(x => x !== channel) : [...list, channel]
  if (!quick.channels.length) quick.channels = ['inapp']
}
function isQuickChannelSelected(channel: ReminderChannel) { return (quick.channels || []).includes(channel) }

// 农历循环只对每月/每年重复生效（后端会拒绝其余组合）。用户直接选农历时
// 自动把重复规则升到每年（农历生日等纪念日的默认用法）；反之把重复规则
// 切走时回退公历，避免残留 lunar 导致保存被拒。
function upgradeCalendarToYearly(target: SaveReminderInput) {
  if (target.calendar === 'lunar' && target.repeat_rule !== 'monthly' && target.repeat_rule !== 'yearly') {
    target.repeat_rule = 'yearly'
  }
}
watch(() => quick.repeat_rule, rule => {
  if (rule !== 'monthly' && rule !== 'yearly') quick.calendar = 'solar'
})

function editItem(item: ReminderItem) {
  editingId.value = item.id
  editorOpen.value = true
}
// ReminderEditor 保存成功后回调：刷新列表并通知其它视图。
async function onEditorSaved() {
  await loadItems()
  changed()
  showToast('提醒已保存')
}
async function toggleComplete(item: ReminderItem) {
  // 记事默认就是完成，没有「完成 / 恢复」这回事：恢复会把它变成一个没有
  // 日期的未完成任务。要改类型请用编辑器里的「类型」切换。
  if (item.kind === 'note') return
  try {
    if (item.completed_at) await restoreReminder(item.id)
    else await completeReminder(item.id)
    await loadItems()
    changed()
    showToast(item.completed_at ? '已恢复提醒' : item.repeat_rule !== 'none' ? '已完成，下一次提醒已安排' : '做得好，已完成')
  } catch (err: any) { showToast(err.response?.data?.message || '操作失败', 'error') }
}
// 删除确认走应用内浮层（见 ConfirmDialog）：原生 confirm 在飞牛 App 的网页
// 视图里是系统级弹窗，与应用样式割裂，手机端也容易被当成浏览器提示忽略。
const removeVisible = ref(false)
// 只用到 id 和标题，这样已完成页的历史记录也能复用同一个删除确认浮层。
const removeTarget = ref<{ id: number; title: string } | null>(null)
const removeLoading = ref(false)

function removeItem(item: { id: number; title: string }) {
  removeTarget.value = item
  removeVisible.value = true
}

async function confirmRemove() {
  const item = removeTarget.value
  if (!item) return
  removeLoading.value = true
  try {
    await deleteReminder(item.id)
    await loadItems()
    changed()
    showToast('提醒已删除')
    removeVisible.value = false
    removeTarget.value = null
  } catch (err: any) {
    showToast(err.response?.data?.message || '删除失败', 'error')
  } finally { removeLoading.value = false }
}
async function snooze(item: ReminderItem, minutes: number) {
  const until = new Date(Date.now() + minutes * 60_000)
  try {
    await snoozeReminder(item.id, until.toISOString())
    await loadItems()
    changed()
    showToast(`已稍后 ${minutes} 分钟提醒`)
  } catch (err: any) { showToast(err.response?.data?.message || '设置稍后提醒失败', 'error') }
}
function focusQuickAdd() {
  quickFocused.value = true
  quickInput.value?.focus()
  quickInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function isOverdue(item: ReminderItem) { return !!item.due_at && !item.completed_at && new Date(item.snoozed_until || item.due_at).getTime() < clockNow.value }
// 日期按钮用完整格式：选中后能直接核对年月日时分，避免跨年日期歧义。
function formatFullDue(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function formatDue(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const day = sameDay ? '今天' : d.toDateString() === tomorrow.toDateString() ? '明天' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(d)
  return `${day} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}
/** 列表行里的时间：有计划时间段就显示「开始 – 结束」，否则沿用原来的相对日期。 */
function dueLabel(item: ReminderItem) {
  if (item.start_at) {
    const startText = formatDue(item.snoozed_until || item.start_at)
    if (!item.end_at) return startText
    const sameDay = new Date(item.start_at).toDateString() === new Date(item.end_at).toDateString()
    const endText = sameDay
      ? new Date(item.end_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : formatDue(item.end_at)
    return `${startText} – ${endText}`
  }
  return item.due_at ? formatDue(item.snoozed_until || item.due_at) : '无日期'
}
function channelName(ch: ReminderChannel) { return ({ inapp: '站内', email: '邮件', sms: '短信', feishu: '飞书', qq: 'QQ', dingtalk: '钉钉' } as Record<string, string>)[ch] || ch }
function ruleLabel(rule: string) { return ({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' } as Record<string, string>)[rule] || '循环' }
// 清单色表在 utils/list-colors.ts（侧栏/筛选/标题/日历共用一份，改一处不会走样）。
function listColor(color: string) { return listColorHex(color) }

// 快速新建里那个清单下拉当前选中项的色名（色点跟清单同色）
const quickListColor = computed(() => navLists.value.find((l) => l.id === quick.list_id)?.color || 'blue')
function changed() { window.dispatchEvent(new CustomEvent('reminder-data-changed')) }
function showToast(message: string, type: 'success' | 'error' = 'success') { toast.message = ''; setTimeout(() => Object.assign(toast, { message, type }), 0) }

let clockTimer: ReturnType<typeof setInterval> | undefined
function refreshRealtimeData() {
  clockNow.value = Date.now()
  void loadItems()
}

// 管理员在后台把「信用卡账单」栏目关掉后，还停在那一页的窗口要送回「今天」。
watch([selectedList, () => authStore.creditCardEnabled], () => {
  if (selectedList.value?.template === 'credit_card' && !authStore.creditCardEnabled) {
    void router.replace('/admin')
  }
})

onMounted(() => {
  loadData()
  openRequestedEditor()
  clockTimer = setInterval(() => { clockNow.value = Date.now() }, 60_000)
  window.addEventListener('open-quick-reminder', focusQuickAdd)
  window.addEventListener('reminder-realtime', refreshRealtimeData)
  window.addEventListener('reminder-realtime-resume', refreshRealtimeData)
  window.addEventListener('keydown', onShortcut)
})
onBeforeUnmount(() => {
  window.removeEventListener('open-quick-reminder', focusQuickAdd)
  window.removeEventListener('reminder-realtime', refreshRealtimeData)
  window.removeEventListener('reminder-realtime-resume', refreshRealtimeData)
  window.removeEventListener('keydown', onShortcut)
  clearTimeout(searchTimer)
  clearInterval(clockTimer)
})
function onShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault(); focusQuickAdd()
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); (document.querySelector('.search-box input') as HTMLInputElement)?.focus()
  }
}
</script>

<style scoped>
.search-box { @apply flex h-10 w-full items-center gap-2 rounded-2xl border border-border/80 bg-surface/80 px-3 text-muted-foreground shadow-sm backdrop-blur transition focus-within:border-brand-500/40 focus-within:ring-4 focus-within:ring-brand-500/10 sm:h-11 sm:w-64; }
.search-box input { @apply min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/65; }
.quick-card { @apply relative overflow-hidden rounded-[24px] border border-border/70 bg-surface/90 p-3 shadow-[0_20px_50px_-30px_rgba(15,23,42,.35)] backdrop-blur-xl transition-all sm:p-5; }
.quick-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: linear-gradient(#3b82f6, #6366f1); opacity: .75; }
.field-label { @apply block text-[11px] font-bold text-muted-foreground; }
.reminder-row { @apply relative flex min-h-0 items-center gap-2.5 overflow-hidden rounded-2xl border border-border/65 bg-surface/85 px-3 py-2.5 shadow-[0_6px_24px_-20px_rgba(15,23,42,.5)] backdrop-blur transition-all hover:-translate-y-0.5 hover:border-brand-500/20 hover:shadow-[0_16px_36px_-26px_rgba(15,23,42,.65)] sm:gap-3 sm:px-4 sm:py-3.5; content-visibility: auto; contain-intrinsic-size: 64px; }
.reminder-row::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 2px; background: transparent; }
.reminder-overdue::before { background: #f43f5e; }
.reminder-completed { @apply opacity-60; }
.reminder-completed h3 { @apply line-through; }
.complete-button { @apply flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-brand-500/35 text-white transition hover:scale-110 hover:border-brand-500 hover:bg-brand-500; }
.reminder-completed .complete-button { @apply border-emerald-500 bg-emerald-500; }
.priority-mark { @apply text-[11px] font-black tracking-[-.12em]; }
.priority-1 { @apply text-blue-500; }.priority-2 { @apply text-amber-500; }.priority-3 { @apply text-rose-500; }
.empty-state { @apply mt-4 flex min-h-[230px] flex-col items-center justify-center rounded-[28px] border border-dashed border-border bg-surface/35 px-6 text-center sm:min-h-[280px]; }
.empty-art { @apply relative h-28 w-28; }

/* 手机端渲染开销：滚动时最贵的是「每行一个模糊阴影 + 每行 backdrop-blur + hover 位移」。
   模糊与位移在触屏上没有意义（还会被 hover 卡住留下残影），阴影改由细边框表达，
   transition 从 all 收窄成颜色/边框，避免滚动中触发布局与大范围重绘。 */
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .reminder-row {
    box-shadow: none;
    transition: background-color .15s ease, border-color .15s ease;
  }
  .reminder-row:hover { transform: none; }
  .quick-card { box-shadow: none; }
  .empty-state { min-height: 200px; }
}
.empty-ring { @apply absolute inset-2 rounded-full border border-brand-500/20 bg-brand-500/5; }
.empty-check { @apply absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_16px_35px_-12px_rgba(59,130,246,.65)]; }
.empty-dot { @apply absolute h-2.5 w-2.5 rounded-full; }.dot-one { @apply left-0 top-5 bg-amber-400; }.dot-two { @apply right-1 top-1 bg-violet-400; }.dot-three { @apply bottom-0 right-6 bg-emerald-400; }
.channel-check { @apply flex h-5 w-5 items-center justify-center rounded-full border border-current; }
/* 「过期提醒频率」是子组件，scoped 样式穿不进去；快速新建这排字段用的是
   .compact-input（h-9 + text-xs），所以把它对齐成同一套，避免这一格比
   旁边的「清单 / 重复 / 按农历循环」高一截。 */
.field-label :deep(.repeat-notify) { @apply mt-1.5; }
.field-label :deep(.repeat-notify select), .field-label :deep(.repeat-notify input) { @apply h-9 w-full rounded-xl border border-border bg-surface px-3 text-xs font-medium text-foreground outline-none focus:border-brand-500/50; }
.expand-enter-active, .expand-leave-active { transition: all .2s ease; }.expand-enter-from, .expand-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
