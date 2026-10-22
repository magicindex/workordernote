<template>
  <div class="mx-auto max-w-6xl">
    <!-- 信用卡账单是固定栏目：这一页**只有卡片**——没有快速新建、没有提醒列表、
         没有完成记录筛选；要加东西就点「新建卡片」。 -->
    <template v-if="isCardBucketPage">
      <!-- 页面标题那一行右侧就是时间卡片：宽屏并排（有最大宽度），窄屏自动折到标题下方 -->
      <section class="mb-3 flex flex-col gap-2.5 sm:mb-5">
        <div class="min-w-0">
          <div class="mb-2 hidden items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground sm:flex">
            <span class="h-2 w-2 rounded-full" :style="{ background: accentColor }"></span>
            信用卡账单
          </div>
          <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">信用卡账单</h1>
          <p class="mt-2 hidden text-sm text-muted-foreground sm:block">卡片、账单日与本周待还都在这一页；一个栏目装下所有卡。</p>
          <p class="truncate text-xs text-muted-foreground sm:hidden">卡片与本周待还都在这一页</p>
        </div>
        <!-- 到期卡片**单独一行**、放在标题下方（用户 2026-10-10 要求）：占满整行宽度，
             不再挤在标题右侧，也不再因为窄屏折行而跑到标题中间。 -->
        <div class="min-w-0 w-full" data-billing-row>
          <BillingStrip :refresh-key="weekRefreshKey" />
        </div>
      </section>
      <CreditCardPanel v-if="selectedList" :list="selectedList" @changed="onCardsChanged" @refresh-strip="weekRefreshKey += 1" />
    </template>

    <!-- 「人生要有仪式感」栏目页：条目用倒计时卡片展示（生日/纪念日/节日/考试…） -->
    <template v-else-if="isCeremonyBucketPage">
      <section class="mb-3 flex flex-col gap-2 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <div class="mb-2 hidden items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground sm:flex">
            <ListIcon name="ceremony" :size="14" />
            <span>固定栏目</span>
          </div>
          <h1 class="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-[26px]" data-ceremony-page-title>
            <ListIcon name="ceremony" :size="24" />
            {{ pageTitle }}
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">生日、纪念日、节日、考试 —— 还有多少天，一眼就看到。</p>
        </div>
      </section>
      <CeremonyPanel v-if="selectedList" :list="selectedList" @changed="onCardsChanged" @toast="(m, t) => showToast(m, t)" />
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
        <!-- 搜索框左边就是收窄的「新建」按钮（用户 2026-10-10 要求：折叠后的新建按钮
             调整宽度、放到搜索框左边）。点它展开整块新建卡片。 -->
        <div class="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:justify-end">
          <button
            v-if="canQuickAdd && !quickOpen"
            type="button"
            class="quick-new-button"
            data-quick-add
            data-quick-new
            title="新建提醒（快捷键 N）"
            @click="expandQuickAdd"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2.2" stroke-linecap="round"/></svg>
            新建提醒
          </button>
          <label class="search-box">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" stroke-width="1.8"/><path d="m16.5 16.5 4 4" stroke-width="1.8" stroke-linecap="round"/></svg>
            <input v-model="search" placeholder="搜索提醒…" @input="debouncedLoad" />
            <kbd class="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] sm:inline">⌘ K</kbd>
          </label>
        </div>
      </section>

      <!-- 展开后的新建卡片（用户 2026-10-10 要求）：默认收起成上面那个「新建」按钮，
           点按钮展开；**刷新、切换页面都回到收起状态**。全部页不给新建入口（见 canQuickAdd）。
           卡片左上角那个圆形「＋」现在是**收起**按钮（用户要求：点圆圈＋号图标折叠）。 -->
      <section v-if="canQuickAdd && quickOpen" data-quick-add>
        <!-- 流光边框挂在**新建任务卡片**上（用户 2026-10-10 要求：原来错挂在「更多」面板里，
             反了）。外面这层 shell 负责 .flow-frame/.flow-glow：卡片自己有 overflow-hidden
             （用来裁左边那条品牌色竖条），把发光放在它身上会被裁掉，所以套一层不裁剪的壳。 -->
        <div class="quick-shell flow-frame flow-glow">
          <div class="quick-card" :class="{ 'quick-card-expanded': quickExpanded }">
        <div class="flex items-start gap-3">
          <button
            type="button"
            class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-brand-500/25 text-brand-500 transition hover:border-brand-500 hover:bg-brand-500/10"
            aria-label="收起新建窗口"
            data-quick-collapse
            title="收起新建窗口（回到「新建」按钮）"
            @click="collapseQuickAdd"
          >
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
            />
            <p v-if="quick.notes" class="mt-1 break-words text-xs leading-4 text-muted-foreground sm:truncate">{{ quick.notes }}</p>
          </div>
          <button v-if="quick.title" class="btn-primary !h-9 !px-4" :disabled="saving" @click="submitQuick">{{ saving ? '保存中' : quick.kind === 'note' ? '记下' : '添加' }}</button>
        </div>

        <div class="mt-3 border-t border-border/60 pt-3 sm:mt-4 sm:pt-4">
          <!-- 计划页的输入窗口与今天页**刻意不同**（用户要求）：
               没有「记事」（计划里只有任务）、没有「今天/明天/本周末」这类相对快捷项，
               改成自定义的**开始 / 结束**（结束留空就是单点时间）+ 重复规则。 -->
          <!-- 计划页这一排：带标题的字段（开始/周期/结束/重复）统一成「标题在上、控件在下」，
               整行改成 items-end 按**底边**对齐 —— 这样带标题的控件与「重要/清单/更多」这些
               纯按钮芯片都落在同一条水平线上（用户报的「周期和控件错位」就是原来
               「开始」的按钮跟在标题同一行、而「周期」的多控件块掉了下去）。 -->
          <div v-if="isPlanned" class="flex flex-wrap items-end gap-1.5 sm:gap-2">
            <label class="field-label relative !flex flex-col items-start gap-1">
              开始
              <button ref="planStartAnchor" type="button" class="quick-chip !h-8" :class="{ active: !!quick.start_at }" @click="planStartOpen = !planStartOpen">
                {{ quick.start_at ? formatFullDue(quick.start_at) : '选择开始时间' }}
              </button>
              <LunarDatePicker v-if="planStartOpen" v-model="planStartPicked" with-time :anchor-el="planStartAnchor" @commit="commitPlanStart" />
            </label>
            <!-- 任务周期（用户要求）：不再让用户手挑结束时间，而是选一个周期 ——
                 N 天 / 1 周 / 1 月 / 年终 / 1 年，或「自定义」自己挑结束时间。
                 结束时间由开始时间 + 周期算出来，落在**最后一天的 23:59**（整天都算在任务里）。 -->
            <label class="field-label !flex flex-col items-start gap-1">
              周期
              <span class="flex items-center gap-1">
                <!-- 数量输入框**所有按数量的档位都保留**（用户 2026-10-10 要求：
                     原来只有「天」能调数量，周/月/年都是写死的 1）——N 天 / N 周 / N 月 / N 年。
                     「年终」是按日历年锚定的，不是数量，所以那一档不显示输入框。 -->
                <input
                  v-if="planPeriod !== 'yearend' && planPeriod !== 'custom'"
                  v-model.number="planDays"
                  type="number"
                  min="1"
                  max="3650"
                  class="quick-chip !h-8 !w-16 !px-2 !text-[11px]"
                  data-plan-days
                  :aria-label="planCountLabel"
                  @change="applyPlanPeriod"
                />
                <select v-model="planPeriod" class="quick-chip !h-8 !px-2 !text-[11px]" data-plan-period @change="applyPlanPeriod">
                  <option value="days">{{ planDays }} 天</option>
                  <option value="week">{{ planDays }} 周</option>
                  <option value="month">{{ planDays }} 月</option>
                  <option value="yearend">年终</option>
                  <option value="year">{{ planDays }} 年</option>
                  <option value="custom">自定义</option>
                </select>
              </span>
            </label>
            <label v-if="planPeriod === 'custom'" class="field-label relative !flex flex-col items-start gap-1">
              结束
              <button ref="planEndAnchor" type="button" class="quick-chip !h-8" :class="{ active: !!quick.end_at }" @click="planEndOpen = !planEndOpen">
                {{ quick.end_at ? formatFullDue(quick.end_at) : '选择结束时间' }}
              </button>
              <LunarDatePicker v-if="planEndOpen" v-model="planEndPicked" with-time :anchor-el="planEndAnchor" @commit="commitPlanEnd" />
            </label>
            <button v-if="quick.end_at" class="quick-chip !h-8" title="清掉结束时间，改成单点时间" data-plan-clear-end @click="clearPlanEnd">清除结束</button>
            <label class="field-label !flex flex-col items-start gap-1">
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
              <!-- 日期与重复从「更多」里搬出来（用户要求：「更多」只留备注/农历/过期提醒频率/通知方式）：
                   日期芯片点开就是完整的选择器，右边跟着「清空」；重复直接是个小下拉。 -->
              <span class="relative inline-flex items-center gap-1">
                <button
                  ref="quickDateAnchor"
                  type="button"
                  class="quick-chip"
                  :class="{ active: !!quick.due_at, '!border-brand-500/50': quickDateOpen }"
                  data-quick-date
                  @click="quickDateOpen = !quickDateOpen"
                >{{ quick.due_at ? formatFullDue(quick.due_at) : '选择日期' }}</button>
                <!-- 剩余时间：实时显示「剩余 时:分」（用户 2026-10-13 要求） -->
                <span
                  v-if="quickRemaining"
                  class="quick-chip !cursor-default !border-transparent !bg-muted/40 !text-muted-foreground"
                  data-quick-remaining
                >{{ quickRemaining }}</span>
                <button
                  v-if="quick.due_at"
                  type="button"
                  class="quick-chip"
                  title="清空日期：这条会变成「无日期」，只在「全部」里出现"
                  data-quick-clear-due
                  @click="clearQuickDue"
                >清空</button>
                <LunarDatePicker v-if="quickDateOpen" v-model="quickDatePicked" with-time :anchor-el="quickDateAnchor" @commit="quickDateOpen = false" />
              </span>
              <select v-model="quick.repeat_rule" class="quick-chip max-w-[6.5rem] !px-2 !text-[11px]" data-quick-repeat aria-label="重复">
                <option value="none">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="yearly">每年</option>
              </select>
              <button class="quick-chip" :class="{ active: quick.priority === 3 }" @click="quick.priority = quick.priority === 3 ? 0 : 3">
                <span class="text-rose-500">!!!</span> 重要
              </button>
              <!-- 清单选择常显（原来藏在「更多」里）：默认是「偏好设置 → 默认清单」里那一本，
                   临时想放到别的清单就在这里改，改完只影响这一次新建。 -->
              <label class="ml-0.5 inline-flex items-center gap-1.5" title="这条提醒加到哪个清单（默认取偏好设置里的默认清单）">
                <i class="h-2 w-2 shrink-0 rounded-full" :style="{ background: listColor(quickListColor) }"></i>
                <select
                  v-model.number="quick.list_id"
                  class="quick-chip max-w-[9rem] !px-2 !text-[11px]"
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
            <span v-if="quick.kind === 'note'" class="ml-auto text-xs font-semibold text-muted-foreground">记事保存后进入「随手记事本」</span>
            <span v-else-if="quick.due_at" class="ml-auto text-xs font-semibold text-brand-600 dark:text-brand-300">{{ formatDue(quick.due_at) }}</span>
          </div>

          <!-- 无日期提示：保存前就让用户看到「这条不会进今天/计划」（0.15.4 的 bug）。
               0.18.2 起从「更多」面板搬到这里 —— 面板默认收起时也要能看到，两条分支都覆盖。 -->
          <p
            v-if="quick.kind !== 'note' && !quick.due_at && !quick.start_at"
            class="mt-2 rounded-xl bg-amber-500/12 px-3 py-2 text-[11px] font-semibold leading-4 text-amber-600 dark:text-amber-400"
            data-quick-undated-hint
          >
            这条没有日期：不会出现在「待办 / 计划」里，只在「全部」里显示为「无日期」。
            <button type="button" class="underline underline-offset-2" @click="setPreset('today')">设为今天</button>
          </p>

          <!-- 「更多」面板**不带流光**（用户 2026-10-10 要求：流光属于新建任务卡片，
               原来挂在这里是挂反了）。 -->
          <Transition name="expand">
            <div
              v-if="quickExpanded && quick.kind !== 'note'"
              class="quick-panel relative mt-3 grid gap-2.5 rounded-2xl bg-muted/65 p-3 sm:mt-4 sm:grid-cols-2 sm:gap-3 sm:p-4 lg:grid-cols-4"
              data-quick-panel
            >
              <!-- 「更多」里只保留这四项（用户要求）：备注 / 按农历循环 / 过期提醒频率 / 通知方式。
                   日期与重复已经搬到上面的芯片行，随时可点。 -->
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
          </div>
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
          <!-- 「全部」页的时间范围条：今天 / 昨天 / 本周 / 上周 / 本月 / 今年 / 自定义。
               默认「本月」（旧的按月翻页），状态开关与它各自独立。
               导出**不受**这里影响——导出永远是所有数据（见 runExport）。 -->
          <div v-if="isAllPage" class="flex flex-wrap items-center gap-1" data-range-bar>
            <button
              v-for="opt in listRangeOptions"
              :key="opt.value"
              type="button"
              class="quick-chip !h-7"
              :class="{ active: listRange === opt.value }"
              :data-range="opt.value"
              @click="setListRange(opt.value)"
            >{{ opt.label }}</button>
            <template v-if="listRange === 'custom'">
              <input v-model="rangeFrom" type="date" class="compact-input !h-8 !w-auto" aria-label="开始日期" data-range-from />
              <span class="text-[11px] text-muted-foreground">至</span>
              <input v-model="rangeTo" type="date" class="compact-input !h-8 !w-auto" aria-label="结束日期" data-range-to />
              <button class="quick-chip !h-7" :disabled="!rangeFrom || !rangeTo" @click="loadItems">查询</button>
            </template>
          </div>
          <!-- 未完成 / 全部：只有「全部」页需要它（用户要求：今天页与计划页取消这个开关，
               一律只显示未完成）。选择记在本地（跟人走、跟设备走），与清单筛选一致。
               记事本页固定显示全部记事，所以那里也收起这个开关。 -->
          <div
            v-if="view === 'all' && !isNoteBucketPage"
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
          <!-- 排序（用户 2026-10-12：「给清单页面增加排序功能（升序/倒序）」）：按**到期时间**
               排整页 —— 日期卡片整体倒过来，卡片内的条目也倒序。「已逾期」始终第一、
               「无日期」始终最后（见 listSortDir 的说明）。选择记在本地。
               记事本栏目不给这个按钮：记事没有到期时间，那一页有自己「新在前」的规矩。 -->
          <button
            v-if="view !== 'completed' && !isNoteBucketPage"
            type="button"
            class="toolbar-btn inline-flex"
            data-sort-toggle
            :data-sort-dir="listSortDir"
            :aria-pressed="listSortDir === 'desc'"
            :title="listSortDir === 'asc'
              ? '按到期时间升序：近的在前（逾期 → 今天 → 明天 …）。点一下改成倒序'
              : '按到期时间倒序：远的在前（日期卡片整体倒过来）。点一下改回升序'"
            @click="toggleListSort"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path v-if="listSortDir === 'asc'" d="M12 19V5m0 0-5 5m5-5 5 5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
              <path v-else d="M12 5v14m0 0 5-5m-5 5-5-5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ listSortDir === 'asc' ? '时间升序' : '时间倒序' }}</span>
          </button>
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
          <!-- 导出表格：手机上不提供（屏幕小、CSV 也不好用），电脑上照旧。
               点开的是导出对话框（选清单与列），不再直接下载。 -->
          <button data-export-open class="toolbar-btn hidden sm:inline-flex" @click="exportOpen = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>导出表格</span>
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

      <!-- 已完成：只读的完成记录，不能「完成 / 稍后提醒」；底层提醒还在时才可以编辑或删除。
           与「按天分卡片」的列表同一套外观：整段是一张卡片，行与行之间用横线分隔。 -->
      <section v-else-if="view === 'completed' && completedItems.length" class="day-card">
        <div class="day-card-body">
        <article v-for="entry in completedItems" :key="`${entry.source}-${entry.id}`" class="reminder-row reminder-completed">
          <button class="complete-button cursor-default" disabled :aria-label="entry.kind === 'note' ? '记事' : '已完成'">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="min-w-0 flex-1 text-left" :disabled="!entry.reminder_exists" @click="openCompletedEntry(entry)">
            <div class="flex items-center gap-2">
              <h3 class="min-w-0 break-words text-sm font-bold leading-5 sm:truncate sm:text-[15px]">{{ entry.title }}</h3>
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
            <!-- 完成时段（用户 2026-10-22）：录入时间 → 完成时间，并给出一共多久。
                 记事创建即完成，没有「做完」的过程，所以只给任务显示。 -->
            <div
              v-if="entry.kind !== 'note' && completionSpanRange(entry)"
              class="mt-1.5 inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
              data-completion-span
            >
              <span class="font-extrabold">完成时段</span>
              <span class="break-words">{{ completionSpanRange(entry) }}</span>
              <span class="whitespace-nowrap rounded-md bg-amber-400/20 px-1.5 py-0.5 font-extrabold text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">{{ completionSpanDuration(entry) }}</span>
            </div>
          </button>
          <div class="row-actions">
            <button v-if="entry.reminder_exists" class="row-action hover:!text-rose-500" title="删除提醒" @click="removeCompleted(entry)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </article>
        </div>
      </section>

      <!-- 按天分卡片（用户要求「同一天的放同一个卡片」）：一天一张卡，卡的标题行是
           日期与条数，卡内是那一天的条目。分组顺序沿用接口给的顺序（今天页的
           「逾期置顶」、记事本的「新在前」都不打乱），不另外排序。 -->
      <section v-else-if="view !== 'completed' && items.length" class="space-y-3">
        <article
          v-for="group in dayGroups"
          :key="group.key"
          class="day-card"
          :data-day-group="group.key"
        >
          <header class="day-card-head">
            <span class="day-card-label">{{ group.label }}</span>
            <span class="day-card-weekday" v-if="group.weekday">{{ group.weekday }}</span>
            <span class="day-card-count">{{ group.items.length }} 条</span>
          </header>
          <div class="day-card-body">
            <article
              v-for="item in group.items"
              :key="item.id"
              class="reminder-row group"
              :class="{ 'reminder-completed': !!item.completed_at && item.kind !== 'note', 'reminder-overdue': isOverdue(item), 'reminder-highlight': highlightedId === item.id }"
              :data-reminder-row="item.id"
            >
              <!-- 记事行前面那个位置放**它所属清单的图标**（记事本图标）并用清单颜色上色，
                   不再画一个点了也没用的勾选框（用户 2026-10-17：「随手记事本 页面，
                   项目列表前边的复选按钮改成 记事本图标，颜色与列表颜色一致」）。
                   任务行仍然是勾选框，样式与行为一点没动。 -->
              <button
                class="complete-button"
                :class="{ 'complete-button-note cursor-default': item.kind === 'note' }"
                :disabled="item.kind === 'note'"
                :aria-label="item.kind === 'note' ? '记事，无需完成' : item.completed_at ? '恢复提醒' : '完成提醒'"
                :style="item.kind === 'note' ? { color: listColor(item.list_color) } : undefined"
                @click.stop="toggleComplete(item)"
              >
                <ListIcon v-if="item.kind === 'note'" :name="iconOfItem(item)" :size="19" />
                <svg v-else-if="item.completed_at" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="min-w-0 flex-1 text-left" @click="editItem(item)">
                <div class="flex items-center gap-2">
                  <!-- 任务标题用所属清单的颜色：侧栏圆点、这里的标题、日历色块三处同色。
                       颜色在侧栏「编辑清单」里改，改完会广播数据变更，本页与日历立即刷新。 -->
                  <h3 class="min-w-0 break-words text-sm font-bold leading-5 sm:truncate sm:text-[15px]" :style="{ color: listColor(item.list_color) }">{{ item.title }}</h3>
                  <span v-if="item.kind === 'note'" class="tiny-badge">记事</span>
                  <span v-if="item.priority" class="priority-mark" :class="`priority-${item.priority}`">{{ '!'.repeat(item.priority) }}</span>
                  <span v-if="item.repeat_rule !== 'none'" class="tiny-badge">{{ item.calendar === 'lunar' ? `农历${ruleLabel(item.repeat_rule)}` : ruleLabel(item.repeat_rule) }}</span>
                  <span v-if="item.repeat_notify_minutes" class="tiny-badge">过期提醒</span>
                  <!-- 循环周期：计划页看成「这一轮到什么时候」，其余页面仍显示第几次。
                       倒计时跟着页面每分钟的 E 走（下面 setInterval 已经在跳）。 -->
                  <span v-if="item.cycle_index" class="tiny-badge !text-brand-600 dark:!text-brand-300" data-cycle-badge :data-cycle-remaining="isPlanned ? cycleRemaining(item) : ''">
                    {{ isPlanned ? cycleRemaining(item) || `第 ${item.cycle_index} 次` : `第 ${item.cycle_index} 次` }}
                  </span>
                </div>
                <p v-if="item.notes" class="mt-0.5 break-words text-xs leading-4 text-muted-foreground sm:mt-1 sm:truncate">{{ item.notes }}</p>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground sm:mt-2">
                  <span class="inline-flex items-center gap-1" :class="{ 'text-rose-500': isOverdue(item) }">
                    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 7v5l3 2" stroke-width="1.8" stroke-linecap="round"/></svg>
                    {{ dueLabel(item) }}
                  </span>
                  <span class="h-1 w-1 rounded-full bg-border"></span>
                  <span>{{ item.list_name }}</span>
                  <span v-if="item.channels?.length" class="h-1 w-1 rounded-full bg-border"></span>
                  <span v-if="item.channels?.length">{{ item.channels.map(channelName).join(' · ') }}</span>
                  <!-- 行尾倒计时（用户 2026-10-20）：已逾期的写「已逾期 N 天 H 小时」，
                       未逾期的写「剩余 N 天 H 小时 M 分」；计划页的循环徽章已经带了倒计时，不重复。 -->
                  <template v-if="itemRemaining(item) && !(isPlanned && item.cycle_index)">
                    <span class="h-1 w-1 rounded-full bg-border"></span>
                    <span
                      class="font-bold"
                      :class="isOverdue(item) || remainingUrgent(item) ? 'text-rose-500' : 'text-brand-600 dark:text-brand-300'"
                      data-item-remaining
                    >{{ itemRemaining(item) }}</span>
                  </template>
                </div>
                <!-- 完成时段（用户 2026-10-22）：接口连已完成的条目一起返回时，
                     已完成任务后边同样补上「录入 → 完成 · 共多久」。 -->
                <div
                  v-if="item.completed_at && item.kind !== 'note' && completionSpanRange(item)"
                  class="mt-1.5 inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                  data-completion-span
                >
                  <span class="font-extrabold">完成时段</span>
                  <span class="break-words">{{ completionSpanRange(item) }}</span>
                  <span class="whitespace-nowrap rounded-md bg-amber-400/20 px-1.5 py-0.5 font-extrabold text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">{{ completionSpanDuration(item) }}</span>
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
        <button v-if="canQuickAdd" class="btn-primary mt-5" @click="expandQuickAdd">添加第一条提醒</button>
      </section>

      <!-- 月份翻页：只在「按月看」时出现——「全部」页选了「本月」，或普通清单页
           （记事本页按记录时间倒序看全部，不分月，所以不出现）。 -->
      <div
        v-if="monthScoped"
        class="mt-4 flex items-center justify-center gap-2 sm:gap-4"
        data-month-nav
      >
        <button class="btn-ghost !h-9 !px-3 text-xs sm:text-sm" :disabled="!canPrevMonth" data-month-prev @click="shiftMonth(-1)">‹ 上个月</button>
        <span class="min-w-[7rem] text-center text-sm font-extrabold" data-month-label>{{ monthLabel }}</span>
        <button class="btn-ghost !h-9 !px-3 text-xs sm:text-sm" :disabled="!canNextMonth" data-month-next @click="shiftMonth(1)">下个月 ›</button>
      </div>

      <!-- 提醒编辑器：与日历视图共用同一个组件，改一处两边同时生效 -->
      <ReminderEditor
        v-model="editorOpen"
        :reminder-id="editingId"
        :lists="navLists"
        :channels="selectableChannels"
        :side="isNoteBucketPage ? 'left' : 'right'"
        @saved="onEditorSaved"
        @deleted="onEditorDeleted"
      />

      <!-- 打印完成记录：勾选要打印的列，纸张方向/字号按列数自动适配 -->
      <PrintDialog
        v-model="printOpen"
        :items="completedItems"
        :range-label="completedSpan"
        :list-label="completedFilterSummary"
        :site-title="authStore.siteTitle || '工作序记'"
      />

      <!-- 导出对话框：选清单与列。导出永远是所有数据（不带页面上的月份/时间范围）。 -->
      <ExportDialog v-model="exportOpen" :lists="lists" @confirm="runExport" />

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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import Toast from '../components/Toast.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ListFilter from '../components/ListFilter.vue'
import ListIcon from '../components/ListIcon.vue'
import BillingStrip from '../components/BillingStrip.vue'
import LunarDatePicker from '../components/LunarDatePicker.vue'
import RepeatNotifySelect from '../components/RepeatNotifySelect.vue'
import PrintDialog from '../components/PrintDialog.vue'
import ExportDialog from '../components/ExportDialog.vue'
import CreditCardPanel from '../components/CreditCardPanel.vue'
import CeremonyPanel from '../components/CeremonyPanel.vue'
import { listColorHex } from '../utils/list-colors'
import { remainingText } from '../utils/remaining'
import {
  overdueStamp as overdueStampShared,
  overdueDeadlineAt,
  isOverdueAt as isOverdueShared,
} from '../utils/overdue'
import { getPublicConfigs } from '../api/config'
import ReminderEditor from '../components/ReminderEditor.vue'
import {
  completeReminder, createReminder, deleteReminder, exportReminders, getChannelStatuses, getCompletedHistory, getLists,
  getReminder, getReminderMonths, getReminders, listIdsParam, restoreReminder, snoozeReminder, updateReminder,
  type ChannelStatus, type CompletedItem, type CompletedRangeOption, type ReminderChannel,
  type ReminderItem, type ReminderKind, type ReminderList, type SaveReminderInput
} from '../api/reminder'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
// 「首页」看板点某条任务 → 跳到它所在的清单，并带上 ?highlight=<id>：
// 这里把那条滚进视野 + 闪一下底色，用户一眼能找到（用户 2026-10-14：「首页点击提醒定位到对应清单」）。
const highlightedId = ref(0)
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
// 用户要求：已完成页默认显示「本月」全部清单的已完成内容（原来默认「全部」）。
const completedRange = ref<CompletedRangeOption>('month')
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

// 清单页排序（用户 2026-10-12 要求：「给清单页面增加排序功能（升序/倒序）」，按**到期时间**排、
// 整页重排）。升序 = 时间早的在前（默认，与原来完全一致，不动任何既有行为）；倒序 = 远的在前。
// 两条既有规矩不参与反转，因为它们不是「某一天」：
//   · **「已逾期」永远第一** —— 它是「欠着的事」的收件箱（用户 2026-10-09 明确要求逾期置顶）；
//   · **「无日期」永远最后** —— 它没有到期时间，排在哪一头都是错的。
// 其余日期卡片整体倒过来，卡片内部（先看没做完的）也按到期时间反向。
// 选择记在本地：这类偏好跟人走、跟设备走，不必上服务端（与「未完成 / 全部」一致）。
const LIST_SORT_KEY = 'ui_list_sort_dir'
const listSortDir = ref<'asc' | 'desc'>(readListSortDir())
function readListSortDir(): 'asc' | 'desc' {
  try { return localStorage.getItem(LIST_SORT_KEY) === 'desc' ? 'desc' : 'asc' } catch { return 'asc' }
}
function toggleListSort() {
  const next: 'asc' | 'desc' = listSortDir.value === 'asc' ? 'desc' : 'asc'
  listSortDir.value = next
  try { localStorage.setItem(LIST_SORT_KEY, next) } catch { /* 隐私模式忽略 */ }
}
const customFrom = ref('')
const customTo = ref('')
const lists = ref<ReminderList[]>([])
const selectableChannels = ref<ChannelStatus[]>([])
const loading = ref(true)
const saving = ref(false)
const search = ref('')
const quickInput = ref<HTMLInputElement | null>(null)
// 新建入口的形态（用户 2026-10-10 要求）：
//   · **默认收起成一个「新建」按钮**（quickOpen = false）：不占地方，页面干净；
//     点一下（或侧栏「新建提醒」/ 手机悬浮 + / 快捷键 N）才展开整块输入窗口；
//   · **刷新、切换页面都回到收起状态**（见 route.fullPath 的 watcher）；
//   · **「全部」页没有新建入口**（见 canQuickAdd）。
//   · 展开后：「芯片行」可见、「更多」面板仍默认收起（quickExpanded = false）。
const quickOpen = ref(false)
const quickExpanded = ref(false)
const preset = ref('today')
// 「清空」是**明确**动作：按过之后，这一次新建才是真正的「无日期」；
// 只要又选了日期（芯片或日期选择器）就复位。提交时的兜底用它区分
// 「用户故意不要日期」与「状态里没日期」（后者补今天）。
const quickDueCleared = ref(false)
const editorOpen = ref(false)
const clockNow = ref(Date.now())
const toast = reactive<{ message: string; type: 'success' | 'error' }>({ message: '', type: 'success' })

// 新建提醒的默认结束时间：**写死 23:59**。
//
// 用户 2026-10-13 明确：「今天 / 明天 / 本周末这些芯片的时间一律 23:59，除非自己手动
// 自定义设定结束时间，否则不做改变」——所以不再跟任何后台设置联动（原来跟着
// task_expire_time 走，顺手把那个配置项删掉了，见 server/sysconfig/registry.go）。
// 逾期判定看的是个人偏好「逾期提醒时间」（task_overdue_time，见 overdueTimeParts），
// 与这里的默认时刻互不影响。
const DEFAULT_DUE_TIME = '23:59'
function defaultQuickDue(): string {
  const d = new Date()
  const { h, m } = clockParts(DEFAULT_DUE_TIME)
  d.setHours(h, m, 0, 0)
  return toLocalIso(d)
}
// 「任务过期多久算逾期」按**分钟**存，前端从公开配置读（系统级设置，公开接口里的就是权威值）。
const overdueGraceMinutes = ref(30)
// 「逾期提醒时间」（个人偏好 task_overdue_time，默认 23:59）：**到期日当天过了这个点
// 就算逾期**，与任务写了几点无关（写 00:00 表示按到期时刻算、不按天顺延）。
const overdueTimeParts = computed(() => clockParts(authStore.reminderOverdueTime))
function clockParts(value: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!match) return { h: 23, m: 59 }
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return { h: 23, m: 59 }
  return { h, m }
}
/**
 * 快速新建里的「剩余时间」：距离所选结束时间还有多久（用户 2026-10-13 要求
 * 「新建提醒 增加剩余时间（实时显示时：分）」）。
 *
 * 分钟级实时（页面本来就有 clockNow 每分钟跳一次）。超过一天就先写天数，
 * 后面仍是「时:分」——用户要的时:分不被天数吃掉。
 */
const quickRemaining = computed(() => remainingText(quick.due_at, clockNow.value))

const blankInput = (): SaveReminderInput => ({
  title: '', notes: '', kind: 'task', list_id: 0, priority: 0, due_at: defaultQuickDue(),
  start_at: null, end_at: null,
  all_day: false, repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
})
const quick = reactive<SaveReminderInput>(blankInput())
// 「全部」页的月份游标（YYYY-MM）与可翻范围（有数据的最早/最晚月，用户要求只在
// 有数据的月份之间翻）。范围由 /items/months 提供，翻到两端时箭头置灰。
const monthCursor = ref(new Date().toISOString().slice(0, 7))
const monthRange = ref<{ first: string; last: string }>({ first: '', last: '' })
const monthLabel = computed(() => {
  const [y, m] = monthCursor.value.split('-')
  return `${y} 年 ${Number(m)} 月`
})
const canPrevMonth = computed(() => !!monthRange.value.first && monthCursor.value > monthRange.value.first)
const canNextMonth = computed(() => !!monthRange.value.last && monthCursor.value < monthRange.value.last)
function shiftMonth(delta: number) {
  const [y, m] = monthCursor.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  monthCursor.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  void loadItems()
}
async function loadMonthRange() {
  try {
    const res = await getReminderMonths()
    const data = res.data?.data || {}
    monthRange.value = { first: data.first || '', last: data.last || '' }
    // 首次进入时如果当月超出范围（比如数据是往月的），挪到范围内最近的月份
    if (data.first && monthCursor.value < data.first) monthCursor.value = data.first
    if (data.last && monthCursor.value > data.last) monthCursor.value = data.last
  } catch { /* 拿不到范围就保持现状：箭头置灰、只看当月 */ }
}
const editingId = ref<number | null>(null)
let quickChannelsTouched = false

const view = computed(() => String(route.meta.reminderView || 'today'))
// 「全部」页的时间范围条。默认「本月」（＝原来的按月翻页），其余范围用 from/to 请求。
// **不**写进 localStorage：范围描述的是「这一屏在看什么」，刷新回到默认「本月」才不会
// 让人以为数据丢了（状态开关那种长期偏好才需要记住）。
type ListRangeOption = 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | 'year' | 'custom'
const isAllPage = computed(() => route.name === 'AllReminders')
// 新建入口出现在哪些页（用户要求「全部页面取消新建提醒」）：
// 已完成页本来就没有；「全部」页是翻月/查历史用的浏览页，也一并去掉。
const canQuickAdd = computed(() => view.value !== 'completed' && !isAllPage.value)
const listRange = ref<ListRangeOption>('month')
const listRangeOptions: { value: ListRangeOption; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'week', label: '本周' },
  { value: 'lastweek', label: '上周' },
  { value: 'month', label: '本月' },
  { value: 'year', label: '今年' },
  { value: 'custom', label: '自定义' },
]
const rangeFrom = ref('')
const rangeTo = ref('')
function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
// 选中的范围换算成 from/to（YYYY-MM-DD，含起不含止，与后端口径一致）。
// 「本月」返回空对象——它走原来的 month=YYYY-MM 与底部翻月。
const rangeWindow = computed<{ from?: string; to?: string }>(() => {
  const today = startOfDay(new Date())
  switch (listRange.value) {
    case 'today':
      return { from: dateKey(today), to: dateKey(addDays(today, 1)) }
    case 'yesterday':
      return { from: dateKey(addDays(today, -1)), to: dateKey(today) }
    case 'week': {
      const monday = addDays(today, -((today.getDay() + 6) % 7))
      return { from: dateKey(monday), to: dateKey(addDays(monday, 7)) }
    }
    case 'lastweek': {
      const monday = addDays(today, -((today.getDay() + 6) % 7) - 7)
      return { from: dateKey(monday), to: dateKey(addDays(monday, 7)) }
    }
    case 'year':
      return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear() + 1}-01-01` }
    case 'custom': {
      const from = rangeFrom.value || undefined
      const to = rangeTo.value ? dateKey(addDays(new Date(`${rangeTo.value}T00:00:00`), 1)) : undefined
      return { from, to }
    }
    default:
      return {}
  }
})
function setListRange(value: ListRangeOption) {
  listRange.value = value
  if (value === 'custom') {
    // 自定义先给「本月」的初值，用户改完再点「查询」，避免先请求一次空区间。
    if (!rangeFrom.value) {
      const today = startOfDay(new Date())
      rangeFrom.value = dateKey(new Date(today.getFullYear(), today.getMonth(), 1))
      rangeTo.value = dateKey(today)
    }
    return
  }
  if (value === 'month') {
    // 回到「本月」时刷新一次可翻月份范围：中间切走过其它范围后，箭头才不会停在
    // 之前那份（或空的）范围上。
    void loadMonthRange().then(() => loadItems())
    return
  }
  void loadItems()
}
// 什么时候按「月」看：全部页（非范围条模式）与普通清单页；记事本页按记录时间倒序
// 看全部，不分月。
const monthScoped = computed(() => view.value === 'all' && !isNoteBucketPage.value && (!isAllPage.value || listRange.value === 'month'))
// 只有「全部」页选了非「本月」范围时才带 from/to。导出**不**受它影响。
const dateWindow = computed(() => (isAllPage.value && listRange.value !== 'month' ? rangeWindow.value : {}))
// 计划页的输入窗口与今天页不同：只用自定义时间/时间段，没有任何相对快捷项，
// 也没有「记事」（计划里只有任务）。见模板里的 v-if="isPlanned" 一支。
const isPlanned = computed(() => view.value === 'planned')

// 计划页循环卡片上的倒计时：当前这一轮的到期时间还剩多久。
// 口径是页面自己的 clockNow（每分钟跳一次），不单独起定时器；
// 用户要的是「天 / 小时 / 分」都写出来，所以不用时:分那种紧凑格式。
function spanText(diff: number): string {
  const total = Math.abs(diff)
  const days = Math.floor(total / 86_400_000)
  const hours = Math.floor((total % 86_400_000) / 3_600_000)
  const minutes = Math.max(1, Math.floor((total % 3_600_000) / 60_000))
  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (days > 0 || hours > 0) parts.push(`${hours} 小时`)
  parts.push(`${minutes} 分`)
  return parts.join(' ')
}

function cycleRemaining(item: { due_at?: string | null }): string {
  if (!item.due_at) return ''
  const at = new Date(item.due_at).getTime()
  if (!Number.isFinite(at)) return ''
  const diff = at - clockNow.value
  return `${diff < 0 ? '已逾期' : '剩余'} ${spanText(diff)}`
}

/** 行尾倒计时：未完成、有日期的条目才有（用户 2026-10-20）。 */
/** 剩余不足 24 小时（用户 2026-10-20：倒计时只剩小时数时变红，其余字色不变）。 */
function remainingUrgent(item: ReminderItem): boolean {
  const deadline = overdueDeadlineAt(item, overdueTimeParts.value)
  if (deadline === null) return false
  const target = deadline + overdueGraceMinutes.value * 60_000
  return target - clockNow.value < 24 * 3_600_000
}

function itemRemaining(item: ReminderItem): string {
  // 与「已逾期」判定同一口径：截止日当天的过期时间 + 宽限才算逾期，
  // 所以倒计时也数到那个时刻，不能直接拿 due_at（否则今天 00:10 到期的一条中午就显示已逾期）。
  const deadline = overdueDeadlineAt(item, overdueTimeParts.value)
  if (deadline === null) return ''
  const target = deadline + overdueGraceMinutes.value * 60_000
  const diff = target - clockNow.value
  return `${diff < 0 ? '已逾期' : '剩余'} ${spanText(diff)}`
}
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
  // 选完开始时间就把周期算成结束时间（默认 1 天 = 当天 23:59；周期选自定义时不动）
  applyPlanPeriod()
}
function commitPlanEnd() { planEndOpen.value = false }
function clearPlanEnd() { quick.end_at = null; planPeriod.value = 'none' }

// 「任务周期」：开始时间 + 周期 → 结束时间（最后一天的 23:59）。
// 1 天 = 当天；N 天 = 开始那天往后的第 N 天（含首尾）；1 周 = 7 天；
// 1 月 = 下个月同一天的前一天；年终 = 当年 12-31；1 年 = 明年同一天的前一天。
const planPeriod = ref<'days' | 'week' | 'month' | 'yearend' | 'year' | 'custom' | 'none'>('days')
const planDays = ref(1)
function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 0, 0)
  return x
}
/**
 * 周期 → 结束时刻（落在最后一天的 23:59）。
 *
 * `n` 是**数量**，各档位都通用（用户 2026-10-10 要求：天/周/月/年都能调数量）：
 *   · N 天 → 开始那天起 N 天；· N 周 = N×7 天；· N 月 = N 个自然月；
 *   · N 年 = N 个自然年；· 年终 = 开始那一年的 12-31（锚定日历年，不用数量）。
 * 都用「日期 + 天数 − 1」的算法，所以结束日当天整天都算在任务里。
 */
function periodEnd(startIso: string, kind: string, n: number): Date {
  const start = new Date(startIso)
  const base = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const count = Math.min(3650, Math.max(1, Math.round(n) || 1))
  switch (kind) {
    case 'week': return endOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + count * 7 - 1))
    case 'month': return endOfDay(new Date(base.getFullYear(), base.getMonth() + count, base.getDate() - 1))
    case 'year': return endOfDay(new Date(base.getFullYear() + count, base.getMonth(), base.getDate() - 1))
    case 'yearend': return endOfDay(new Date(base.getFullYear(), 11, 31))
    default: return endOfDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + count - 1))
  }
}
/** 按当前周期重算结束时间；「自定义」交给用户自己挑，不动 end_at。 */
function applyPlanPeriod() {
  if (planPeriod.value === 'custom' || planPeriod.value === 'none') return
  if (!quick.start_at) return
  const end = periodEnd(quick.start_at, planPeriod.value, planDays.value)
  quick.end_at = toLocalIso(end)
}

/** 当前周期档位对应的数量输入框可访问名（读屏用；不影响界面）。 */
const planCountLabel = computed(() => ({
  days: '任务周期天数',
  week: '任务周期周数',
  month: '任务周期月数',
  year: '任务周期年数',
} as Record<string, string>)[planPeriod.value] || '任务周期数量')
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
// 「记事本」也是固定栏目：它不是卡片页那种特殊页面，而是一个内容全是记事的普通清单页
// （按记录时间倒序、固定显示全部）。偏好关掉时不认这一页。
const isNoteBucketPage = computed(() => selectedList.value?.template === 'notebook' && authStore.notebookEnabled)
// 「人生要有仪式感」：固定栏目，页面是倒计时卡片（不是普通清单列表）
const isCeremonyBucketPage = computed(() => selectedList.value?.template === 'ceremony' && authStore.ceremonyEnabled)
// 下拉/筛选里能选的只有普通清单（信用卡/记事本栏目不是「清单」，不该出现在这些地方）
const navLists = computed(() => lists.value.filter((l) => l.template !== 'credit_card' && l.template !== 'notebook' && l.template !== 'ceremony'))
const pageTitle = computed(() => selectedList.value?.name || String(route.meta.title || '待办'))
const eyebrow = computed(() => selectedList.value ? '我的清单' : view.value === 'today' ? '近 7 天要办的' : '工作序记')
const accentColor = computed(() => selectedList.value ? listColor(selectedList.value.color) : view.value === 'completed' ? '#10b981' : '#3182f6')
const subtitle = computed(() => {
  if (isNoteBucketPage.value) return `${items.value.length} 条记事，按记录时间倒序`
  if (selectedList.value) return `${selectedList.value.open_count || 0} 件事情正在等你`
  if (view.value === 'today') {
    // 待办页＝今天到第 7 天（用户 2026-10-16），副标题把区间写出来，免得以为只看今天。
    const start = new Date()
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    const head = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(start)
    const tail = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(end)
    return `${head} – ${tail}`
  }
  if (view.value === 'planned') return '按时间整理好接下来的安排'
  if (view.value === 'completed') return '每一个勾选，都是向前一步'
  return '所有未完成的提醒都在这里'
})
const overdueCount = computed(() => items.value.filter(isOverdue).length)
const emptyTitle = computed(() => view.value === 'completed'
  ? (completedRange.value === 'all' ? '还没有完成记录' : '这个时间段没有记录')
  : view.value === 'today' ? '近 7 天都清空了' : '这里还没有提醒')
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
  // 切换页面（或换清单 / 换查询参数）时，新建窗口**回到收起状态**（用户要求）。
  quickOpen.value = false
  quickExpanded.value = false
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
    // 「全部」页要按月翻：每次（含首屏 onMounted → loadData 这条路径）先拿一次可用月份范围，
    // 否则首屏进来 monthRange 是空的、两个箭头都置灰（翻月点击无效）。
    if (view.value === 'all') await loadMonthRange()
    await loadItems()
    // 数据到位后再定位一次（从首页看板点进来时，高亮的那条此刻才在 DOM 里）
    applyHighlightFromRoute()
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
    // 需要按「月」看的视图先拿一次可用月份范围（只在两端之间可翻）。
    if (monthScoped.value) await loadMonthRange()
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
    // 今天页与计划页固定只看未完成（开关已经取消）；「全部」页才跟随 未完成/全部；
    // 记事本页固定看全部——记事创建即完成，不开「全部」的话这一页会永远是空的。
    status: isNoteBucketPage.value
      ? 'all'
      : view.value !== 'all' ? undefined : (showCompleted.value ? 'all' : undefined),
    // 时间窗口二选一：普通视图按 month 翻月；「全部」页选了其它范围时用 from/to。
    // 记事本页不带时间窗口（记的是流水账，不该被月份藏起来）。
    month: monthScoped.value ? monthCursor.value : undefined,
    from: dateWindow.value.from,
    to: dateWindow.value.to,
    // 记事本按生效时间倒序（记事没有 due_at，默认排序会把它们甩到最后）。
    sort: isNoteBucketPage.value ? 'created_desc' : undefined,
  })
  items.value = res.data.data || []
}
// 导出对话框：选清单（默认全选，含信用卡/记事本系统栏目）与列（默认全选）。
// 导出永远是**所有数据**：不带页面上的月份与时间范围（用户要求）。
const exportOpen = ref(false)
const exporting = ref(false)
async function runExport(payload: { lists: number[]; columns: string[] }) {
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
      // 清单筛选来自对话框（默认全选；空数组不会发生——确定键在未选时禁用）。
      lists: listIdsParam(payload.lists),
      columns: payload.columns.join(','),
      q: search.value || undefined,
      // 「未完成 / 全部」开关不是时间范围，导出仍跟随它：这是列表页既有的口径，
      // 旧用例（verify-040）与界面「导出所见即所得」都依赖它。
      status: !completed && view.value === 'all' && showCompleted.value ? 'all' : undefined,
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
    // 记事一律进「记事本」固定栏目（后端 createReminder 归一），所以单独说明去处，
    // 并且保持「记事」模式不变，方便连着记好几条。
    const isNote = quick.kind === 'note'
    const planned = isPlanned.value
    const undated = !quick.due_at && !quick.start_at
    // 计划页：只用时间段（结束留空＝单点），due_at 由后端按开始时间归位。
    // 非计划页：日期为空只可能是「用户按了清空」（quickDueCleared）或状态里没日期。
    // 后者按今天兜底 —— 否则又会存出「无日期」的任务：保存成功、今天页里却找不到
    // （用户报过的那个 bug）。记事由后端统一清空日期，这里给不给都不影响。
    const fallbackDue = quick.due_at || (quickDueCleared.value ? null : defaultQuickDue())
    const payload: SaveReminderInput = planned
      ? { ...quick, kind: 'task', title: quick.title.trim(), due_at: null, end_at: quick.end_at || null }
      : { ...quick, title: quick.title.trim(), due_at: isNote ? null : fallbackDue }
    await createReminder(payload)
    quickChannelsTouched = false
    Object.assign(quick, blankInput(), {
      kind: isNote ? 'note' : 'task',
      list_id: quickTargetListID.value,
      // 计划页默认不带「今天 20:00」，免得一进页面就误以为是今天的事
      due_at: planned ? null : defaultQuickDue(),
    })
    // 任务周期跟着复位（下一条重新选开始时间时按默认 1 天算）
    planPeriod.value = 'days'
    planDays.value = 1
    // 归位到「今天」：新建提醒默认带当天「过期时间」，芯片状态也要跟着点亮。
    // 保存后**自动收起**（用户 2026-10-11 要求：新建提交后自动隐藏）——
    // 收起成一个「新建」按钮，「更多」面板也一并回到默认收起状态。
    preset.value = isNote || planned ? '' : 'today'
    quickDueCleared.value = false
    quickExpanded.value = false
    quickOpen.value = false
    if (isNote) {
      // 记事本页要立刻把新记的这条显示出来（其它视图它本来就不出现）。
      await loadItems()
      showToast('记事已保存到「随手记事本」')
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
  } else if (isNoteBucketPage.value) {
    // 记事本页的目标清单是栏目本身（不在下拉的普通清单里）；改成任务时要挪回
    // 默认清单，否则下拉框显示不出选中项。
    quick.list_id = defaultListID.value
  }
}
// 记事本页快速新建默认就是「记事」：这一页做的主要是记一笔。离开时恢复「任务」。
watch(isNoteBucketPage, (on) => {
  if (on) setQuickKind('note')
  else if (quick.kind === 'note') quick.kind = 'task'
}, { immediate: true })
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
type CompletionSpanEntry = { created_at?: string | null; completed_at?: string | null }
/** 「完成时段」的原始数据；缺任一端或时间非法时返回 null，那一行不显示。 */
function completionSpanInfo(entry: CompletionSpanEntry) {
  if (!entry.created_at || !entry.completed_at) return null
  const start = new Date(entry.created_at)
  const end = new Date(entry.completed_at)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  // 同步过来的数据可能有时钟差：结束早于开始时按 0 算，不显示负数。
  return { start, end, span: Math.max(0, end.getTime() - start.getTime()) }
}
/** 起止时间：录入 → 完成。 */
function completionSpanRange(entry: CompletionSpanEntry) {
  const info = completionSpanInfo(entry)
  return info ? `${formatSpanStamp(info.start)} – ${formatSpanStamp(info.end)}` : ''
}
/** 总时长单独拿出来，模板里用明亮色显示，和起止时间区分开。 */
function completionSpanDuration(entry: CompletionSpanEntry) {
  const info = completionSpanInfo(entry)
  return info ? `共 ${formatSpanDuration(info.span)}` : ''
}
/** 时段两端：同年不写年份，跨年才补上，避免一行太长。 */
function formatSpanStamp(d: Date) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** 总时长按「天 / 小时 / 分钟」给到能看懂的最大两级；不足一分钟单独说。 */
function formatSpanDuration(ms: number) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '不足 1 分钟'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days) return hours ? `${days} 天 ${hours} 小时` : `${days} 天`
  if (hours) return mins ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`
  return `${mins} 分钟`
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
// 「今天 / 明天 / 本周末」是**选中**语义，不是开关：再点一次不该把日期清掉。
//
// 0.15.4 上线当天踩到的真 bug：这三个芯片原来是 toggle，用户在「今天」页点了
// 已经亮着的「今天」，`due_at` 被清成 null，任务就存成「无日期」——今天页里
// 找不到，去「全部」看只显示「无日期」。用户报的正是这一条。
// 要「不要日期」请用清空按钮（clearQuickDue），芯片永远只负责选中。
function setPreset(kind: string) {
  preset.value = kind
  quickDueCleared.value = false
  const d = new Date()
  d.setSeconds(0, 0)
  if (kind === 'tomorrow') d.setDate(d.getDate() + 1)
  if (kind === 'weekend') { const add = (6 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add) }
  // 所有芯片的时间一律 23:59（用户 2026-10-13；原来今天＝20:00、明天/本周末＝09:00）
  const { h, m } = clockParts(DEFAULT_DUE_TIME)
  d.setHours(h, m, 0, 0)
  quick.due_at = toLocalIso(d)
}
/** 明确「这条不要日期」。只有这里会把日期清空，并且立刻给出可见提示。 */
function clearQuickDue() {
  preset.value = ''
  quick.due_at = null
  quickDueCleared.value = true
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
/** 编辑弹窗里直接删除（用户 2026-10-13 加）：刷新列表并提示。 */
async function onEditorDeleted() {
  await loadItems()
  changed()
  showToast('提醒已删除')
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
// 展开新建窗口并把光标放进去。侧栏「新建提醒」、手机悬浮 +、快捷键 N、
// 列表空状态那个「添加第一条提醒」都走这里（MainLayout 派发 open-quick-reminder 事件）。
//
// 「全部」页没有新建入口（用户要求），从那里点新建就先去「今天」页 ——
// 注意顺序：先 await 导航，再置 quickOpen —— 否则会被 route.fullPath 的
// watcher（切页收起）盖掉，出现「跳过去了却没展开」。
async function expandQuickAdd() {
  if (isAllPage.value) await router.push({ name: 'Home' })
  quickExpanded.value = false
  quickOpen.value = true
  await nextTick()
  quickInput.value?.focus()
  quickInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function collapseQuickAdd() {
  quickOpen.value = false
  quickExpanded.value = false
}
/** 逾期判定用的「生效时间」：稍后提醒优先；**有时间段的任务看最后一天**（用户要求：
    「计时最后一天遵守后台偏好设置的过期时间」—— 3 天期的任务要到第 3 天过完、
    再加上宽限时间才算逾期）；其余看到期时间。
    记事没有排期，永远不算逾期；已完成的也不算。
    逾期分组卡片与行上的「已逾期」标记共用这一个函数，避免两处口径跑偏。 */
// 逾期判定的口径统一放在 utils/overdue.ts（首页看板用的是同一份，抄一份迟早跑偏）：
// 生效时间不看 snoozed_until、按「逾期提醒时间」当天算、再加宽限分钟。
function overdueStamp(item: ReminderItem): number | null {
  return overdueStampShared(item)
}
function isOverdue(item: ReminderItem) {
  // 过了「宽限时间」才算逾期：默认时间就是当前时刻，不留余量的话新建即逾期
  return isOverdueShared(item, {
    cutoff: overdueTimeParts.value,
    graceMinutes: overdueGraceMinutes.value,
    now: clockNow.value,
  })
}
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
/** 列表行里的时间：记事显示**记录时间**，有计划时间段就显示「开始 – 结束」，
    否则沿用原来的相对日期。
    记事没有到期时间，原来一律显示「无日期」——记事本里每条都看不出是哪天记的
    （用户要求补上）。记事创建即完成，completed_at 就是它的记录时刻。 */
function dueLabel(item: ReminderItem) {
  if (item.kind === 'note') {
    const stamp = item.completed_at || item.created_at
    return stamp ? `记于 ${formatDue(stamp)}` : '无日期'
  }
  if (item.start_at) {
    // 稍后提醒不改展示时间（用户 2026-10-14），行里始终显示原来的排期
    const startText = formatDue(item.start_at)
    if (!item.end_at) return startText
    const sameDay = new Date(item.start_at).toDateString() === new Date(item.end_at).toDateString()
    const endText = sameDay
      ? new Date(item.end_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : formatDue(item.end_at)
    return `${startText} – ${endText}`
  }
  return item.due_at ? formatDue(item.due_at) : '无日期'
}

/** 一条提醒「算哪一天」：有计划时间段看开始时间，否则看到期时间；记事看记录时间。
    都取不到就归到「无日期」那一组（永远排在最后）。 */
function dayKeyOf(item: ReminderItem): string {
  const stamp = item.kind === 'note'
    ? (item.completed_at || item.created_at)
    : (item.start_at || item.due_at)
  if (!stamp) return 'undated'
  const d = new Date(stamp)
  if (Number.isNaN(d.getTime())) return 'undated'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function dayLabelOf(key: string): { label: string; weekday: string } {
  if (key === 'undated') return { label: '无日期', weekday: '' }
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((midnight(date) - midnight(now)) / 86400000)
  // 待办页是「今天到第 7 天」这一段（用户 2026-10-16），所以近三天用口语词标出来。
  const relative = diffDays === 0 ? '今天' : diffDays === 1 ? '明天' : diffDays === 2 ? '后天' : diffDays === -1 ? '昨天' : ''
  const base = y === now.getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`
  return { label: relative ? `${relative} · ${base}` : base, weekday: WEEKDAY_CN[date.getDay()] }
}

/** 按天分组：同一天的条目放进同一张卡片（用户要求：「同一天的放同一个卡片」）。
    组与组之间沿用 items 的既有顺序（接口已按各视图的口径排好），只分组、不重排；
    但**卡片内部**把已完成的排到后面 —— 「先看没做完的」这条规矩在分卡片之后落在
    每张卡片里（跨卡片不再保证：昨天已完成的条目本来就排在今天之前）。

    另外（用户 2026-10-09 追加要求）：**逾期未完成的**不再按各自的日期散在各处，
    统一收进最前面那张「已逾期」卡片 —— 一眼先看到欠着的事，再按天看后面的安排。 */
const dayGroups = computed(() => {
  const groups: { key: string; label: string; weekday: string; items: ReminderItem[] }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  const overdue: (typeof groups)[number] = { key: 'overdue', label: '已逾期', weekday: '', items: [] }
  // 逾期的判断与行里的「已逾期」标记同一套口径（overdueStamp）。
  for (const item of items.value) {
    if (isOverdue(item)) {
      overdue.items.push(item)
      continue
    }
    const key = dayKeyOf(item)
    let group = byKey.get(key)
    if (!group) {
      group = { key, ...dayLabelOf(key), items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }
  const dated = groups.filter(g => g.key !== 'undated')
  const undated = groups.filter(g => g.key === 'undated')
  // 倒序：日期卡片整体倒过来（最远的日期在最上面）；「无日期」仍然收尾（见 listSortDir 的说明）。
  // 记事本栏目不参与：它按「新在前」排（接口 created_desc），那是它自己的规矩不是到期时间。
  const desc = listSortDir.value === 'desc' && !isNoteBucketPage.value
  const ordered = [...(desc ? [...dated].reverse() : dated), ...undated]
  const seq = (rows: ReminderItem[]) => (desc ? [...rows].reverse() : rows)
  for (const group of ordered) {
    const open = group.items.filter((i) => !i.completed_at)
    const done = group.items.filter((i) => !!i.completed_at)
    // 卡片内部：没做完的仍然在前；同一段里按到期时间，倒序时反向。
    group.items = [...seq(open), ...seq(done)]
  }
  overdue.items = overdue.items.sort((a, b) => (overdueStamp(a) || 0) - (overdueStamp(b) || 0))
  // 「已逾期」卡片永远第一；卡片内部在倒序时也反过来（最近逾期的在前）。
  if (desc) overdue.items = [...overdue.items].reverse()
  // 逾期排第一（没有逾期条目时这张卡片不出现），「无日期」永远排最后。
  return overdue.items.length ? [overdue, ...ordered] : ordered
})
function channelName(ch: ReminderChannel) { return ({ inapp: '站内', email: '邮件', sms: '短信', feishu: '飞书', qq: 'QQ', dingtalk: '钉钉' } as Record<string, string>)[ch] || ch }
function ruleLabel(rule: string) { return ({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' } as Record<string, string>)[rule] || '循环' }
// 清单色表在 utils/list-colors.ts（侧栏/筛选/标题/日历共用一份，改一处不会走样）。
function listColor(color: string) { return listColorHex(color) }

// 条目接口不带 list_icon（只有清单接口有），记事行前面那个图标就从已加载的清单里查一份。
const listIcons = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  for (const l of lists.value) map[l.id] = l.icon || 'list'
  return map
})
function iconOfItem(item: ReminderItem) { return listIcons.value[item.list_id] || 'list' }

// 快速新建里那个清单下拉当前选中项的色名（色点跟清单同色）
const quickListColor = computed(() => navLists.value.find((l) => l.id === quick.list_id)?.color || 'blue')
function changed() { window.dispatchEvent(new CustomEvent('reminder-data-changed')) }
function showToast(message: string, type: 'success' | 'error' = 'success') { toast.message = ''; setTimeout(() => Object.assign(toast, { message, type }), 0) }

let clockTimer: ReturnType<typeof setInterval> | undefined
function refreshRealtimeData() {
  clockNow.value = Date.now()
  void loadItems()
}

// 管理员/用户在偏好里把「信用卡账单」或「记事本」栏目关掉后，还停在那一页的窗口
// 要送回「今天」。
watch([selectedList, () => authStore.creditCardEnabled, () => authStore.notebookEnabled], () => {
  const template = selectedList.value?.template
  if (template === 'credit_card' && !authStore.creditCardEnabled) {
    void router.replace('/admin')
  }
  if (template === 'notebook' && !authStore.notebookEnabled) {
    void router.replace('/admin')
  }
})

async function loadOverdueGrace() {
  try {
    const res = await getPublicConfigs()
    const cfg = (res.data?.data || {}) as Record<string, unknown>
    const v = Number(cfg.task_overdue_after_minutes)
    if (Number.isFinite(v) && v >= 0) overdueGraceMinutes.value = v
    // 默认结束时间已经写死 23:59（DEFAULT_DUE_TIME），不再读配置
  } catch { /* 拿不到就按默认 30 分钟 / 23:59 */ }
}
/** 从 URL 的 ?highlight= 取要高亮的那条，滚过去闪一下。 */
function applyHighlightFromRoute() {
  const raw = Number(route.query.highlight || 0)
  if (!raw) {
    highlightedId.value = 0
    return
  }
  highlightedId.value = raw
  void nextTick(() => {
    const el = document.querySelector(`[data-reminder-row="${raw}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  window.setTimeout(() => { highlightedId.value = 0 }, 4000)
}

onMounted(() => {
  loadData()
  void loadOverdueGrace()
  openRequestedEditor()
  clockTimer = setInterval(() => { clockNow.value = Date.now() }, 60_000)
  window.addEventListener('open-quick-reminder', expandQuickAdd)
  window.addEventListener('reminder-realtime', refreshRealtimeData)
  window.addEventListener('reminder-realtime-resume', refreshRealtimeData)
  window.addEventListener('keydown', onShortcut)
  applyHighlightFromRoute()
})
onBeforeUnmount(() => {
  window.removeEventListener('open-quick-reminder', expandQuickAdd)
  window.removeEventListener('reminder-realtime', refreshRealtimeData)
  window.removeEventListener('reminder-realtime-resume', refreshRealtimeData)
  window.removeEventListener('keydown', onShortcut)
  clearTimeout(searchTimer)
  clearInterval(clockTimer)
})
function onShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault(); expandQuickAdd()
  }
  // Esc：还没写东西就收起新建窗口（写了标题时留给输入框自己处理，避免误丢内容）
  if (e.key === 'Escape' && quickOpen.value && !quick.title.trim()) {
    collapseQuickAdd()
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); (document.querySelector('.search-box input') as HTMLInputElement)?.focus()
  }
}
</script>

<style scoped>
.search-box { @apply flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border/80 bg-surface/80 px-3 text-muted-foreground shadow-sm backdrop-blur transition focus-within:border-brand-500/40 focus-within:ring-4 focus-within:ring-brand-500/10 sm:h-11 sm:w-64 sm:flex-none; }
.search-box input { @apply min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/65; }
.quick-card { @apply relative overflow-hidden rounded-[24px] border border-border/70 bg-surface/90 p-3 shadow-[0_20px_50px_-30px_rgba(15,23,42,.35)] backdrop-blur-xl transition-all sm:p-5; }
/* 收起态的「新建」按钮（用户要求：新建提醒控件折叠成一个按钮、放到搜索框左边）：
   **实线边框 + 流光**（.flow-frame 那条旋转的 1px 光带，见 style.css）——
   边框本身仍是实线，光带叠在它上面转，所以看起来是「实线在流动」。 */
/* 蓝紫过渡色（用户 2026-10-11 要求：见左侧菜单栏第一个「新建提醒」按钮那套渐变色），
   底色深、字用白色。**不加流光**（用户 2026-10-11 第二次明确：收缩态这个按钮取消流光、
   只留底色；流光仍在展开后的新建卡片上）。 */
.quick-new-button { @apply inline-flex h-10 shrink-0 items-center gap-1.5 rounded-2xl border border-solid border-white/25 bg-gradient-to-r from-blue-500 to-indigo-500 px-2.5 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(59,130,246,.8)] transition hover:brightness-105 sm:h-11 sm:px-3.5; }
/* 流光外壳：圆角与卡片一致（.flow-frame::before 的 1px 光带靠 border-radius: inherit），
   自己不裁剪，好让 .flow-glow::after 那团柔光露出来。 */
.quick-shell { @apply relative rounded-[24px]; }
.quick-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: linear-gradient(#3b82f6, #6366f1); opacity: .75; }
.field-label { @apply block text-[11px] font-bold text-muted-foreground; }
/* 按天分卡片：一天一张卡（用户要求「同一天的放同一个卡片」）。
   行自己仍是一张张小卡（.reminder-row 的形状、悬停、逾期红条都不动），
   外面这层负责「这一天」的标题与分组底色。 */
/* 按天分卡片：一天一张卡（用户要求「同一天的放同一个卡片」）。
   卡片里的条目**不再各自是一张小卡**（用户 2026-10-09：「合并的自身卡片将不再使用，
   使用横线分割」）—— 去掉边框/圆角/阴影/悬浮位移，行与行之间用一条细横线分隔，
   整张卡片只有一个外框，看起来就是「这一天的清单」。 */
.day-card { @apply overflow-hidden rounded-2xl border border-border/70 bg-surface/85 shadow-[0_10px_30px_-26px_rgba(15,23,42,.45)] backdrop-blur sm:rounded-[22px]; }
.day-card-head { @apply flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 sm:px-4; }
.day-card-label { @apply text-[13px] font-extrabold tracking-tight text-foreground sm:text-sm; }
.day-card-weekday { @apply text-[11px] font-bold text-muted-foreground; }
.day-card-count { @apply ml-auto text-[11px] font-bold text-muted-foreground; }
/* 逾期那张卡片的标题行染一点红，与行里的「已逾期」标记呼应 */
.day-card[data-day-group='overdue'] .day-card-head { @apply bg-rose-500/10; }
.day-card[data-day-group='overdue'] .day-card-label { @apply text-rose-600 dark:text-rose-400; }
.day-card-body { @apply divide-y divide-border/55; }
.reminder-row { @apply relative flex min-h-0 items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40 sm:gap-3 sm:px-4 sm:py-3; content-visibility: auto; contain-intrinsic-size: 64px; }
.reminder-row::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 2px; background: transparent; }
.reminder-overdue::before { background: #f43f5e; }
/* 从「首页」看板点进来定位到的那一条：底色闪一下，一眼能找到 */
.reminder-highlight { @apply bg-brand-500/[.09]; animation: reminder-highlight-flash 1.6s ease-in-out 2; }
@keyframes reminder-highlight-flash {
  0%, 100% { background-color: rgba(var(--color-brand-500) / .09); }
  50% { background-color: rgba(var(--color-brand-500) / .2); }
}
.reminder-completed { @apply opacity-60; }
.reminder-completed h3 { @apply line-through; }
.complete-button { @apply flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-brand-500/35 text-white transition hover:scale-110 hover:border-brand-500 hover:bg-brand-500; }
/* 记事行的那个位置放清单图标（用户 2026-10-17）：没有圈、没有底色、不跟着悬停放大，
   颜色由行内样式按清单色给（浅色/深色主题都不用另外配色）。 */
.complete-button-note { @apply border-0 bg-transparent; }
.complete-button-note:hover { @apply scale-100 border-0 bg-transparent; }
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
/* 「过期提醒频率」是子组件，scoped 样式穿不进去；快速新建这排字段用的是
   .compact-input（h-9 + text-xs），所以把它对齐成同一套，避免这一格比
   旁边的「清单 / 重复 / 按农历循环」高一截。 */
.field-label :deep(.repeat-notify) { @apply mt-1.5; }
.field-label :deep(.repeat-notify select), .field-label :deep(.repeat-notify input) { @apply h-9 w-full rounded-xl border border-border bg-surface px-3 text-xs font-medium text-foreground outline-none focus:border-brand-500/50; }
.expand-enter-active, .expand-leave-active { transition: all .2s ease; }.expand-enter-from, .expand-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
