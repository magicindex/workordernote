<template>
  <div class="animate-fade-in flex flex-col gap-2.5 lg:min-h-[calc(100dvh-8.5rem)]" :style="{ '--cal-task-font': calendarFontPx + 'px' }">
    <!-- 不再单独放一个页头：顶栏和侧栏已经表明当前在日历，重复的标题+描述白占 52px
         （外加两段 24px 间距），把这段还给日历格子。 -->
    <div v-if="errorMsg" class="surface rounded-2xl px-5 py-3 text-sm text-destructive">
      {{ errorMsg }}
    </div>

    <!-- 工具条：翻月 / 回今天 / 计数 -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div class="flex items-center gap-1.5 sm:gap-2">
        <button class="icon-button" aria-label="上个月" @click="shiftMonth(-1)">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m15 6-6 6 6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn-secondary !h-9 !px-3 !text-xs sm:!text-sm" @click="goToday">今天</button>
        <button class="icon-button" aria-label="下个月" @click="shiftMonth(1)">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m9 6 6 6-6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2 class="ml-1 text-base font-extrabold tracking-tight sm:text-lg">{{ monthTitle }}</h2>
        <span v-if="lunarYearName" class="hidden text-xs font-semibold text-muted-foreground md:inline">{{ lunarYearName }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <!-- 选择哪些清单显示在日历里；不选=全部。选择记在本地。 -->
        <!-- 用全部清单：信用卡账单栏目的提醒（账单日/还款日/提前提醒）也在日历里，要能按它筛 -->
        <ListFilter v-model="listFilter" :lists="lists" />
        <div class="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground sm:text-xs">
          <span class="inline-flex items-center gap-1.5"><i class="h-2 w-2 rounded-full bg-brand-500"></i>未完成 {{ openCount }}</span>
          <span class="inline-flex items-center gap-1.5"><i class="h-2 w-2 rounded-full bg-emerald-500"></i>已完成 {{ doneCount }}</span>
          <!-- 记事既不是未完成也不是「做完的任务」，单独计数，免得两个数字互相污染 -->
          <span v-if="noteCount" class="inline-flex items-center gap-1.5"><i class="h-2 w-2 rounded-full bg-slate-400"></i>记事 {{ noteCount }}</span>
        </div>
        <button
          type="button"
          class="btn-secondary !h-8 !gap-1.5 !px-3 !text-[11px] sm:!text-xs"
          :disabled="!cells.length"
          title="打印当前显示的这一个月（A4，弹窗里可预览与调版式）"
          aria-label="打印日历"
          @click="printOpen = true"
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" aria-hidden="true"><path d="M7 9V4h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2m-10 0v3h10v-3m-10 0h10" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          打印本月
        </button>
        <!-- 导出表格：手机上不提供（与列表页一致） -->
        <button
          type="button"
          class="btn-secondary hidden !h-8 !gap-1.5 !px-3 !text-[11px] sm:inline-flex sm:!text-xs"
          :disabled="exporting || !items.length"
          title="把本月日历上的内容导出成表格"
          @click="exportMonth"
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ exporting ? '导出中…' : '导出本月' }}
        </button>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <!-- 月历网格 -->
      <section class="surface flex min-h-0 flex-col overflow-hidden rounded-2xl p-2 sm:p-3">
        <!-- 月 / 周 切换（周视图＝7 列天 × 纵向小时，用户要求） -->
        <div class="mb-2 flex items-center gap-1.5" data-cal-view-toggle>
          <!-- 选中的那个字用**流光**（用户 2026-10-10 要求）：渐变文字 + 位移动画，
               按钮本身的选中底色不动，所以「月/周」两个字的大小与位置都不变。 -->
          <button class="seg-btn" :class="{ 'seg-btn-on': viewMode === 'month' }" data-cal-view="month" @click="setViewMode('month')">
            <span :class="{ 'flow-text': viewMode === 'month' }">月</span>
          </button>
          <button class="seg-btn" :class="{ 'seg-btn-on': viewMode === 'week' }" data-cal-view="week" @click="setViewMode('week')">
            <span :class="{ 'flow-text': viewMode === 'week' }">周</span>
          </button>
          <template v-if="viewMode === 'week'">
            <button class="btn-ghost !h-8 !px-2 text-xs" data-week-prev @click="shiftWeek(-1)">‹ 上一周</button>
            <button class="btn-ghost !h-8 !px-2 text-xs" data-week-today @click="goThisWeek">本周</button>
            <button class="btn-ghost !h-8 !px-2 text-xs" data-week-next @click="shiftWeek(1)">下一周 ›</button>
            <span class="ml-1 text-xs font-extrabold" data-week-label>{{ weekLabel }}</span>
          </template>
        </div>
        <div class="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 pb-1.5">
          <div
            v-for="(w, i) in weekdays"
            :key="w"
            class="py-1 text-center text-[11px] font-bold sm:text-xs"
            :class="i >= 5 ? 'text-rose-500/85' : 'text-muted-foreground'"
          >{{ w }}</div>
        </div>

        <!-- 周视图：左侧时刻列 + 7 天列；任务按时段画块，重叠的并排分栏 -->
        <div v-if="viewMode === 'week'" class="min-h-0 flex-1 overflow-auto" data-week-grid>
          <div class="grid" style="grid-template-columns: 3.25rem repeat(7, minmax(0, 1fr))">
            <div></div>
            <div
              v-for="d in weekDays"
              :key="'h' + dayKey(d)"
              class="sticky top-0 z-10 bg-surface px-1 pb-1 text-center text-[11px] font-bold"
            >{{ ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()] }} <span class="text-muted-foreground">{{ d.getMonth() + 1 }}/{{ d.getDate() }}</span></div>
            <div class="relative">
              <div v-for="h in 24" :key="'t' + h" class="pr-1 text-right text-[10px] text-muted-foreground" :style="{ height: HOUR_H + 'px' }">{{ pad(h - 1) }}:00</div>
            </div>
            <div
              v-for="d in weekDays"
              :key="dayKey(d)"
              class="relative border-l border-border/60"
              :style="{ height: 24 * HOUR_H + 'px' }"
              :data-week-col="dayKey(d)"
              @mousemove="onWeekMove($event, d)"
              @mouseleave="hoverTime = null"
              @dblclick="openCreateForSlot(d, $event)"
              title="双击在鼠标所在时分新建任务"
            >
              <div v-for="h in 24" :key="h" class="border-t border-border/40" :style="{ height: HOUR_H + 'px' }"></div>
              <div
                v-for="b in (weekBlocks[dayKey(d)] || [])"
                :key="b.item.id"
                class="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-white shadow"
                :class="{ 'ring-2 ring-rose-300': b.overlap > 1, 'opacity-55 line-through': b.item.completed && b.item.kind !== 'note' }"
                :style="{ top: b.top + 'px', height: b.height + 'px', left: (b.lane * 100) / b.lanes + '%', width: 100 / b.lanes + '%', background: listInk(b.item.list_color) }"
                :data-week-block="b.item.id"
                :data-overlap="b.overlap"
                :title="`${b.item.title} · ${timeLabel(b.item)}${b.overlap > 1 ? ` · 与 ${b.overlap - 1} 条重叠（并排显示）` : ''}`"
                @click.stop="onItemClick(b.item)"
                @dblclick.stop="onItemDblClick(b.item)"
              >
                <span class="block truncate">{{ b.item.title }}</span>
                <span class="block truncate opacity-85">{{ timeLabel(b.item) }}</span>
              </div>
              <div
                v-if="hoverTime && hoverTime.day === dayKey(d)"
                class="pointer-events-none absolute right-1 z-20 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background"
                :style="{ top: hoverTime.y + 'px' }"
                data-week-hover
              >{{ hoverTime.label }}</div>
            </div>
          </div>
        </div>

        <div v-if="viewMode === 'month' && loading && !cells.length" class="grid flex-1 grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
          <div v-for="n in 35" :key="n" class="min-h-[4.5rem] animate-pulse rounded-xl bg-muted/70"></div>
        </div>

        <div v-else-if="viewMode === 'month'" class="grid flex-1 auto-rows-fr grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
          <div
            v-for="cell in cells"
            :key="cellKey(cell)"
            role="button"
            tabindex="0"
            class="cal-cell group relative flex flex-col rounded-xl border p-1 text-left transition sm:p-1.5"
            :class="cellClass(cell)"
            @click="selectCell(cellKey(cell))"
            @dblclick="openCreateForDate(cellKey(cell))"
            @keydown.enter.prevent="selectCell(cellKey(cell))"
            :title="`双击在这天新建提醒`"
            :data-cal-date="cellKey(cell)"
          >
            <div class="flex items-start justify-between gap-1">
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none sm:h-6 sm:w-6 sm:text-xs"
                :class="dayNumberClass(cell)"
              >{{ cell.day }}</span>
              <span
                v-if="lunarLabel(cell)"
                class="mt-0.5 truncate text-[9px] font-semibold leading-none sm:text-[10px]"
                :class="lunarClass(cell)"
              >{{ lunarLabel(cell) }}</span>
              <!-- 信用卡：账单日（琥珀）/ 还款日（玫红）各一个小点，一眼看出这个月这两天在哪 -->
              <span v-if="cardMarks(cell).length" class="mt-0.5 flex shrink-0 gap-0.5" data-card-marks>
                <i
                  v-for="role in cardMarks(cell)"
                  :key="role"
                  class="h-1.5 w-1.5 rounded-full"
                  :style="{ background: role === 'statement' ? '#f59e0b' : role === 'advance' ? '#fb923c' : '#f43f5e' }"
                  :title="role === 'statement' ? '信用卡账单日' : role === 'advance' ? '信用卡还款提醒' : '信用卡还款日'"
                ></i>
              </span>
            </div>

            <!-- 时间段任务（计划页「任务周期」建的）：在**区间内每一天**都显示一条，
                 点一下就把整段（开始框 → 跨框 → 最后一天）高亮出来。底色与图标
                 参考信用卡/记事本那种「图标 + 浅色底」的样式，用清单色。 -->
            <div v-if="spansOf(cellKey(cell)).length" class="mt-1 flex flex-col gap-0.5" data-cal-spans>
              <button
                v-for="span in spansOf(cellKey(cell))"
                :key="`span-${span.item.id}`"
                type="button"
                class="cal-span flex min-w-0 items-center gap-1 rounded-md px-1 py-[1px] text-left font-semibold leading-tight"
                :class="spanClass(span)"
                :style="{ background: chipStyle(span.item).background, color: chipStyle(span.item).color }"
                :data-cal-span="`${span.item.id}:${span.role}`"
                :title="`${span.item.title}（${spanRangeText(span.item)}）`"
                @click.stop="onSpanClick(span.item)"
                @dblclick.stop="onItemDblClick(span.item)"
              >
                <span class="cal-plan-mark shrink-0" :style="{ background: chipDot(span.item) }">
                  <ListIcon name="clock" :size="10" class="text-white" />
                </span>
                <span class="truncate">{{ span.item.title }}</span>
              </button>
            </div>

            <!-- 桌面：显示提醒标题；手机：只显示圆点 -->
            <div class="mt-1 hidden min-w-0 flex-1 flex-col gap-0.5 sm:flex">
              <span
                v-for="item in visibleItems(cell)"
                :key="item.id"
                class="cal-task flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-[1px] font-semibold leading-tight transition hover:ring-1 hover:ring-brand-500/35"
                :class="{ 'opacity-55 line-through': item.completed && item.kind !== 'note' }"
                :style="chipStyle(item)"
                :title="`${item.title}（单击查看，双击编辑）`"
                :data-cal-task="item.id"
                @click.stop="onItemClick(item)"
                @dblclick.stop="onItemDblClick(item)"
              >
                <!-- 记事用「记」字标记；其余一律用图标（不再用圆点）：
                     普通提醒用清单图标，信用卡的账单日/还款日/提前提醒用**银行卡图标**（缩到 11px），
                     颜色仍按角色区分（账单日琥珀 / 还款日玫红 / 提前提醒橙）。 -->
                <i v-if="item.kind === 'note'" class="cal-note-mark shrink-0">记</i>
                <!-- 信用卡的账单日/还款日/提前提醒：图标加一块底色（参考「记」字底色），
                     底色按角色区分（账单日琥珀 / 还款日玫红 / 提前提醒橙）。 -->
                <span
                  v-else-if="item.card_role"
                  class="cal-card-mark shrink-0"
                  :style="{ background: chipDot(item) }"
                  :title="item.card_role === 'statement' ? '信用卡账单日' : item.card_role === 'advance' ? '信用卡还款提醒' : '信用卡还款日'"
                >
                  <ListIcon name="card" :size="10" class="text-white" />
                </span>
                <ListIcon
                  v-else
                  :name="iconOf(item)"
                  :size="11"
                  class="shrink-0"
                  :style="{ color: chipDot(item) }"
                />
                <span class="truncate">{{ item.title }}</span>
              </span>
              <!-- 超过上限的条目收进「+N 条」下拉里（用户要求：数量做限制，
                   超了改成下拉弹窗）。点条目直接打开编辑，点空白处收回。 -->
              <button
                v-if="extraCount(cell) > 0"
                type="button"
                class="cal-task w-full px-1 text-left font-bold text-muted-foreground hover:text-brand-600"
                data-cal-more
                @click.stop="toggleOverflow(cell)"
              >+{{ extraCount(cell) }} 条…</button>
            </div>
            <div
              v-if="overflowFor === cellKey(cell)"
              class="absolute inset-x-1 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-xl"
              data-cal-overflow
              @click.stop
            >
              <button
                v-for="item in overflowItems(cell)"
                :key="item.id"
                type="button"
                class="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px] font-semibold hover:bg-muted"
                @click.stop="onItemClick(item); overflowFor = ''"
                @dblclick.stop="onItemDblClick(item); overflowFor = ''"
              >
                <i v-if="item.kind === 'note'" class="cal-note-mark shrink-0">记</i>
                <span v-else-if="item.card_role" class="cal-card-mark shrink-0" :style="{ background: chipDot(item) }">
                  <ListIcon name="card" :size="10" class="text-white" />
                </span>
                <ListIcon v-else :name="iconOf(item)" :size="11" class="shrink-0" :style="{ color: chipDot(item) }" />
                <span class="truncate">{{ item.title }}</span>
              </button>
            </div>
            <div class="mt-auto flex flex-wrap gap-0.5 pt-0.5 sm:hidden">
              <ListIcon
                v-for="item in visibleItems(cell).slice(0, 4)"
                :key="item.id"
                :name="iconOf(item)"
                :size="10"
                :class="{ 'opacity-45': item.completed }"
                :style="{ color: dot(item.list_color) }"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- 选中日详情 -->
      <aside class="surface flex min-h-0 flex-col rounded-2xl p-3 sm:p-4">
        <div class="flex items-baseline justify-between gap-2">
          <div class="flex min-w-0 items-baseline gap-2">
            <h3 class="text-sm font-extrabold sm:text-base">{{ selectedTitle }}</h3>
            <span v-if="selectedLunar" class="truncate text-[11px] font-semibold text-muted-foreground">{{ selectedLunar }}</span>
          </div>
          <button
            class="btn-secondary !h-8 shrink-0 !px-3 !text-[11px]"
            :title="`在 ${selectedTitle} 新建提醒`"
            @click="openCreateForDate(selectedDate)"
          >＋ 新建</button>
        </div>
        <p v-if="selectedTags.length" class="mt-1 flex flex-wrap gap-1">
          <span v-for="tag in selectedTags" :key="tag.text" class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="tag.cls">{{ tag.text }}</span>
        </p>

        <div v-if="loading && !items.length" class="mt-3 space-y-2">
          <div v-for="n in 3" :key="n" class="h-12 animate-pulse rounded-xl bg-muted/70"></div>
        </div>

        <div v-else-if="selectedItems.length" class="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          <article
            v-for="item in selectedItems"
            :key="item.id"
            class="flex items-start gap-2 rounded-xl border border-border/70 bg-surface/60 p-2 transition hover:border-brand-500/35"
            :class="{ 'border-brand-500/35 bg-brand-500/5': menu.item?.id === item.id && menu.open }"
            @contextmenu.prevent.stop="openItemMenu(item, $event)"
          >
            <!-- 记事创建即完成、没有可勾选的状态，给一个静态的记录标记 -->
            <span
              v-if="item.kind === 'note'"
              class="cal-note-mark mt-0.5 h-5 w-5 shrink-0"
              title="记事（记录，无需完成）"
            >记</span>
            <button
              v-else
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition"
              :class="item.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-brand-500/30 text-transparent hover:border-brand-500'"
              :aria-label="item.completed ? '恢复提醒' : '完成提醒'"
              @click="toggle(item)"
            >
              <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button
              class="min-w-0 flex-1 text-left"
              :title="`${item.title}（单击查看，双击编辑）`"
              @click="onItemClick(item)"
              @dblclick="onItemDblClick(item)"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <h4 class="cal-task-lg truncate font-bold" :class="{ 'line-through opacity-60': item.completed && item.kind !== 'note' }">{{ item.title }}</h4>
                <span v-if="item.kind === 'note'" class="tiny-badge shrink-0">记事</span>
                <span v-if="item.priority" class="shrink-0 text-[10px] font-black text-rose-500">{{ '!'.repeat(item.priority) }}</span>
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span>{{ timeLabel(item) }}</span>
                <span v-if="item.repeat_rule && item.repeat_rule !== 'none'" class="tiny-badge">{{ ruleLabel(item.repeat_rule) }}</span>
              </div>
              <div class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <ListIcon :name="iconOf(item)" :size="13" class="shrink-0" :style="{ color: dot(item.list_color) }" />
                <span class="truncate">{{ item.list_name }}</span>
              </div>
            </button>
            <!-- 原来这里只有一支笔（只能编辑、删不掉）。改成「⋯」菜单：修改 / 删除，
                 右键这一行也能开同一个菜单（手机上右键不方便，所以按钮常显）。 -->
            <button
              type="button"
              class="row-action !opacity-100 shrink-0"
              :title="`「${item.title}」的更多操作（也可以右键这一行）`"
              :aria-label="`${item.title} 的更多操作`"
              :aria-haspopup="'menu'"
              :aria-expanded="menu.open && menu.item?.id === item.id ? 'true' : 'false'"
              @click.stop="openItemMenu(item, $event)"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
            </button>
          </article>
        </div>

        <p v-else class="mt-4 flex-1 text-sm text-muted-foreground">这天没有安排。</p>

        <p class="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-4 text-muted-foreground">
          双击日期格（周视图里双击空白时段）新建提醒；**单击任务看详情、双击任务就地编辑**；勾选即完成，重复提醒会自动排到下一次。
        </p>
      </aside>
    </div>

    <!-- 单击任务弹出的**查看页**（只读 + 底部「编辑」按钮） -->
    <ReminderViewDialog :item="viewItem" @close="closeView" @edit="editFromView" />

    <!-- 与列表页共用同一个提醒编辑器，改一处两边同时生效。
         editingId 为空、createPreset 有值 = 新建（双击日期格进来的）。 -->
    <ReminderEditor
      v-model="editorOpen"
      :reminder-id="editingId"
      :preset="createPreset"
      :lists="navLists"
      :channels="channels"
      presentation="modal"
      @saved="onEditorSaved"
      @deleted="onEditorDeleted"
    />

    <!-- 行菜单：右键 / 行尾「⋯」都能开（共享组件，Teleport 到 body，位置按实际尺寸收进视口） -->
    <ContextMenu
      v-model:open="menu.open"
      :x="menu.x"
      :y="menu.y"
      :heading="menu.item?.title || ''"
      :items="rowMenuItems"
      @select="onRowMenuSelect"
    />

    <!-- 删除确认：与列表页同一个浮层组件 -->
    <ConfirmDialog
      v-model="removeVisible"
      danger
      :title="removeTarget?.kind === 'note' ? '删除这条记事？' : '删除这条提醒？'"
      :message="`「${removeTarget?.title || ''}」删除后无法恢复。`"
      confirm-text="删除"
      loading-text="删除中…"
      :loading="removeLoading"
      @confirm="confirmRemove"
    />
    <CalendarPrintDialog
      v-model="printOpen"
      :cells="cells"
      :items="items"
      :year="cursor.year"
      :month="cursor.month"
      :list-label="printListLabel"
    />

    <Toast :message="toast.message" :type="toast.type" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useIsNarrow } from '../utils/use-narrow'
import ListFilter from '../components/ListFilter.vue'
import ListIcon from '../components/ListIcon.vue'
import ReminderEditor from '../components/ReminderEditor.vue'
import ReminderViewDialog from '../components/ReminderViewDialog.vue'
import Toast from '../components/Toast.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ContextMenu from '../components/ContextMenu.vue'
import CalendarPrintDialog from '../components/CalendarPrintDialog.vue'
import type { ContextMenuItem } from '../components/ContextMenu.vue'
import { getAllConfigs, getPublicConfigs } from '../api/config'
import {
  completeReminder, deleteReminder, exportReminders, getCalendarItems, getChannelStatuses, getLists,
  getLunarCalendar, listIdsParam, restoreReminder,

  type CalendarItem, type ChannelStatus, type LunarDayInfo, type ReminderList, type SaveReminderInput,
} from '../api/reminder'
import { listInk, listTint } from '../utils/list-colors'

// 手机上不提供日历视图：正常路径是入口隐藏 + 路由守卫拦掉；
// 这里再兜一层「从电脑宽度缩到手机宽度」——那种情况下路由不会重新匹配，
// 所以直接把人送回列表视图。
const isNarrow = useIsNarrow()
const router = useRouter()
watch(isNarrow, (narrow) => { if (narrow) void router.replace('/admin') })

const toast = reactive<{ message: string; type: 'success' | 'error' }>({ message: '', type: 'success' })
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.message = ''
  setTimeout(() => Object.assign(toast, { message, type }), 0)
}

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const dayKey = (d: Date) => keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())

// 月视图 / 周视图。周视图＝7 列（天）× 纵向小时，任务按它的时段画成块，
// 重叠的并排分栏；鼠标在时间线上移动显示时分，双击按所在时分新建。
const viewMode = ref<'month' | 'week'>('month')
// 后台「周起始日」（系统配置，默认周一）：月历表头与周视图第一列都跟着它
const weekStartPref = ref<'monday' | 'sunday'>('monday')
// 日历里新建提醒的默认时分：**写死 23:59**（用户 2026-10-13：芯片/默认时间一律 23:59，
// 除非手动改），不再跟后台配置联动。
const expireTimeParts = computed(() => ({ h: 23, m: 59 }))
const weekdays = computed(() => (weekStartPref.value === 'sunday'
  ? ['日', '一', '二', '三', '四', '五', '六']
  : ['一', '二', '三', '四', '五', '六', '日']))
function startOfWeek(d: Date) {
  const day = d.getDay() // 0=周日
  const offset = weekStartPref.value === 'sunday' ? day : (day === 0 ? 6 : day - 1)
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - offset)
  return s
}
const weekStart = ref(startOfWeek(new Date()))
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(weekStart.value)
  d.setDate(d.getDate() + i)
  return d
}))
const weekLabel = computed(() => {
  const a = weekDays.value[0], b = weekDays.value[6]
  const f = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  return `${a.getFullYear()} 年 ${f(a)} – ${f(b)}`
})
const HOUR_H = 44
const weekBlocks = computed<Record<string, Array<{ item: CalendarItem; top: number; height: number; lane: number; lanes: number; overlap: number }>>>(() => {
  const out: Record<string, Array<{ item: CalendarItem; top: number; height: number; lane: number; lanes: number; overlap: number }>> = {}
  for (const d of weekDays.value) out[dayKey(d)] = []
  const byDay: Record<string, CalendarItem[]> = {}
  for (const it of items.value) {
    if (it.all_day || !it.due_at) continue
    const k = String(it.due_date || '').slice(0, 10)
    if (!(k in out)) continue
    ;(byDay[k] ||= []).push(it)
  }
  for (const [k, list] of Object.entries(byDay)) {
    const spans = list.map((it) => {
      const start = new Date(it.due_at as string)
      const startMin = start.getHours() * 60 + start.getMinutes()
      const end = it.end_at ? new Date(it.end_at) : null
      let endMin = end ? end.getHours() * 60 + end.getMinutes() : startMin + 60
      // 跨天的时段先截到当天结束（周视图一天一列，不跨列画）
      if (end && end.toDateString() !== start.toDateString()) endMin = 24 * 60
      if (endMin <= startMin) endMin = startMin + 30
      return { it, startMin, endMin }
    }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
    // 贪心分道：同一天里重叠的并排分栏（各占 1/lanes 宽）
    const laneEnds: number[] = []
    const placed = spans.map((sp) => {
      let lane = laneEnds.findIndex((end) => end <= sp.startMin)
      if (lane === -1) { laneEnds.push(sp.endMin); lane = laneEnds.length - 1 } else laneEnds[lane] = sp.endMin
      return { ...sp, lane }
    })
    for (const a of placed) {
      const overlapGroup = placed.filter((b) => b.startMin < a.endMin && a.startMin < b.endMin)
      const lanes = Math.max(1, ...overlapGroup.map((b) => b.lane + 1))
      out[k].push({
        item: a.it,
        top: (a.startMin / 60) * HOUR_H,
        height: Math.max(22, ((a.endMin - a.startMin) / 60) * HOUR_H - 2),
        lane: a.lane, lanes, overlap: overlapGroup.length,
      })
    }
  }
  return out
})
const hoverTime = ref<{ day: string; y: number; label: string } | null>(null)
function minutesFromEvent(e: MouseEvent, cols = 4) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const y = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top))
  const step = 60 / cols
  return Math.floor((y / HOUR_H) * 60 / step) * step
}
function onWeekMove(e: MouseEvent, d: Date) {
  const minutes = minutesFromEvent(e)
  hoverTime.value = { day: dayKey(d), y: (minutes / 60) * HOUR_H, label: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` }
}
function shiftWeek(delta: number) {
  const d = new Date(weekStart.value)
  d.setDate(d.getDate() + delta * 7)
  weekStart.value = d
  void load()
}
function goThisWeek() {
  weekStart.value = startOfWeek(new Date())
  void load()
}
function setViewMode(mode: 'month' | 'week') {
  viewMode.value = mode
  if (mode === 'week') {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.value) ? new Date(`${selectedDate.value}T00:00:00`) : new Date()
    weekStart.value = startOfWeek(base)
  }
  void load()
}
async function loadWeekStart() {
  try {
    // 用公开配置：周起始日是**系统级**设置，公开接口里的就是权威值（管理员的
    // /api/configs 会把用户作用域的键合并进来，历史上可能留下同名用户行）
    const res = await getPublicConfigs()
    const cfgAll = (res.data?.data || {}) as Record<string, unknown>
    const v = String(cfgAll.calendar_week_start || '')
    if (v === 'sunday' || v === 'monday') {
      weekStartPref.value = v
      weekStart.value = startOfWeek(weekStart.value)
    }
  } catch { /* 拿不到就用默认周一 */ }
}

const now = new Date()
const cursor = ref({ year: now.getFullYear(), month: now.getMonth() + 1 })
const cells = ref<LunarDayInfo[]>([])
const items = ref<CalendarItem[]>([])
const selectedDate = ref(keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate()))
const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)
const exporting = ref(false)
// 打印弹窗（打印当前显示的这一个月）
const printOpen = ref(false)
// 顶部说明里的清单筛选文案：没勾 = 全部，勾了就列名字
const printListLabel = computed(() => {
  if (!listFilter.value.length) return '全部'
  return lists.value.filter((l) => listFilter.value.includes(l.id)).map((l) => l.name).join('、') || '全部'
})

// 编码器需要清单与通知渠道列表
const lists = ref<ReminderList[]>([])
// 「信用卡账单」是固定栏目，不是普通清单：筛选与下拉里都不出现（它有自己的页面）。
const navLists = computed(() => lists.value.filter((l) => l.template !== 'credit_card'))
const channels = ref<ChannelStatus[]>([])
const editorOpen = ref(false)
// 超过 MAX_CHIPS 的条目收在下拉里：记住当前展开的是哪一天
const overflowFor = ref('')
function overflowItems(c: LunarDayInfo) {
  return (byDate.value.get(cellKey(c)) || []).slice(MAX_CHIPS)
}
function toggleOverflow(c: LunarDayInfo) {
  const key = cellKey(c)
  overflowFor.value = overflowFor.value === key ? '' : key
}
const editingId = ref<number | null>(null)
// 新建模式的预填内容；非空即表示这次打开是「新建」而不是编辑。
const createPreset = ref<SaveReminderInput | null>(null)

// 日历任务字号：读「偏好设置 → 日历任务字号」，映射成像素后用 CSS 变量下发，
// 格子里的小字、详情面板的标题、格子最小高度都跟着它走。
// 日历里显示哪些清单；空数组 = 全部。跟人走、跟设备走，存本地即可。
const FILTER_KEY = 'ui_calendar_lists'
const listFilter = ref<number[]>(readFilter())
function readFilter(): number[] {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number' && n > 0) : []
  } catch { return [] }
}
watch(listFilter, (v) => {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(v)) } catch { /* 隐私模式忽略 */ }
  void load()
})

const FONT_SIZES: Record<string, number> = { small: 9, medium: 10, large: 12, xlarge: 13 }
const fontSizeKey = ref('medium')
const calendarFontPx = computed(() => FONT_SIZES[fontSizeKey.value] ?? FONT_SIZES.medium)

const monthTitle = computed(() => `${cursor.value.year} 年 ${cursor.value.month} 月`)
const lunarYearName = computed(() => cells.value.find(c => c.lunar_year_name)?.lunar_year_name || '')

const cellKey = (c: LunarDayInfo) => keyOf(c.year, c.month, c.day)
const isToday = (c: LunarDayInfo) => cellKey(c) === keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate())

// 后端已经按上海时区把每条提醒归到 due_date，这里直接按字符串分桶，
// 不用浏览器时区换算，避免非 +08 时区打开时整体错一天。
const byDate = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items.value) {
    const list = map.get(item.due_date)
    if (list) list.push(item)
    else map.set(item.due_date, [item])
  }
  return map
})
const selectedItems = computed(() => byDate.value.get(selectedDate.value) || [])

// 计数只看任务：记事既不是「未完成」也不是「做完的任务」，单独计数。
const openCount = computed(() => items.value.filter(i => i.kind !== 'note' && !i.completed).length)
const doneCount = computed(() => items.value.filter(i => i.kind !== 'note' && i.completed).length)
const noteCount = computed(() => items.value.filter(i => i.kind === 'note').length)

const selectedCell = computed(() => cells.value.find(c => cellKey(c) === selectedDate.value))
const selectedTitle = computed(() => {
  const c = selectedCell.value
  if (!c) return selectedDate.value
  const d = new Date(c.year, c.month - 1, c.day)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${c.month} 月 ${c.day} 日 周${week}`
})
const selectedLunar = computed(() => {
  const c = selectedCell.value
  if (!c) return ''
  return [c.lunar, c.term, c.festival].filter(Boolean).join(' · ')
})
const selectedTags = computed(() => {
  const c = selectedCell.value
  if (!c) return [] as { text: string; cls: string }[]
  const tags: { text: string; cls: string }[] = []
  if (c.festival) tags.push({ text: c.festival, cls: 'bg-rose-500/12 text-rose-500' })
  if (c.term) tags.push({ text: c.term, cls: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' })
  return tags
})

// 月历单元格里最多铺 3 条，其余折成 +N；手机上只显示圆点。
const MAX_CHIPS = 3
function visibleItems(c: LunarDayInfo) {
  return (byDate.value.get(cellKey(c)) || []).slice(0, MAX_CHIPS)
}
function extraCount(c: LunarDayInfo) {
  return Math.max(0, (byDate.value.get(cellKey(c)) || []).length - MAX_CHIPS)
}

// 农历标签优先显示节日/节气，其次才是农历日名——节日节气更值得一眼看到。
function lunarLabel(c: LunarDayInfo) {
  if (c.festival) return c.festival
  if (c.term) return c.term
  if (c.lunar_day === 1) return c.lunar
  return c.lunar
}
function lunarClass(c: LunarDayInfo) {
  if (c.festival) return 'text-rose-500'
  if (c.term) return 'text-emerald-600 dark:text-emerald-400'
  return 'text-muted-foreground/85'
}
function cellClass(c: LunarDayInfo) {
  const selected = cellKey(c) === selectedDate.value
  const inActiveSpan = activeSpanId.value !== null && spansOf(cellKey(c)).some((s) => s.item.id === activeSpanId.value)
  if (selected && inActiveSpan) return 'border-brand-500/70 bg-brand-500/15 ring-2 ring-brand-500/40'
  if (inActiveSpan) return 'border-brand-500/45 bg-brand-500/8'
  if (selected) return 'border-brand-500/60 bg-brand-500/8 ring-2 ring-brand-500/25'
  if (!c.in_month) return 'border-transparent bg-transparent opacity-45 hover:bg-muted/60'
  return 'border-border/60 bg-surface/50 hover:border-brand-500/35 hover:bg-muted/60'
}

// ---------- 时间段任务在日历上的「跨天」显示 ----------
// 后端把区间与窗口相交的任务都带回来了（见 listCalendarItems），这里按天判断：
// 某一天落在 [start_at, end_at] 之内就画一条；role 决定圆角（start / mid / end），
// 一天内首尾同格时按 start 处理，看起来还是一整段。
const activeSpanId = ref<number | null>(null)
/** ISO → 上海时区的 YYYY-MM-DD（与后端 due_date 同一口径；中国没有夏令时，直接 +8h 取日期）。 */
function isoDayKey(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}
function spansOf(key: string) {
  const out: Array<{ item: CalendarItem; role: 'start' | 'mid' | 'end' | 'single' }> = []
  for (const item of items.value) {
    if (!item.start_at || !item.end_at || item.kind === 'note') continue
    const from = isoDayKey(item.start_at)
    const to = isoDayKey(item.end_at)
    if (key < from || key > to) continue
    const role = from === to ? 'single' : key === from ? 'start' : key === to ? 'end' : 'mid'
    out.push({ item, role })
  }
  return out
}
function spanClass(span: { item: CalendarItem; role: string }) {
  const active = activeSpanId.value === span.item.id
  const ring = active ? 'ring-2 ring-brand-500/50' : ''
  if (span.role === 'start') return `rounded-r-none ${ring}`.trim()
  if (span.role === 'end') return `rounded-l-none ${ring}`.trim()
  if (span.role === 'mid') return `rounded-none ${ring}`.trim()
  return ring
}
function spanRangeText(item: CalendarItem) {
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
  if (!item.start_at || !item.end_at) return ''
  return `${fmt(item.start_at)} – ${fmt(item.end_at)}`
}
/** 点某一天：这一天有时间段任务就把它整段高亮出来；否则取消高亮（恢复单框显示）。 */
function selectCell(key: string) {
  selectedDate.value = key
  const span = spansOf(key)[0]
  activeSpanId.value = span ? span.item.id : null
}
function activateSpan(item: CalendarItem) {
  activeSpanId.value = activeSpanId.value === item.id ? null : item.id
}
function dayNumberClass(c: LunarDayInfo) {
  if (isToday(c)) return 'bg-brand-500 text-white shadow-sm'
  if (cellKey(c) === selectedDate.value) return 'text-brand-600 dark:text-brand-300'
  return 'text-foreground'
}

/** 日历里每条提醒前面的图标：信用卡的日子（账单日/还款日/提前提醒）用银行卡图标，其余用清单图标。 */
function iconOf(item: CalendarItem) {
  return item.card_role ? 'card' : (item.list_icon || 'list')
}

// 清单色表在 utils/list-colors.ts（与侧栏、列表页标题共用一份）。
// 用清单色做浅底 + 同色文字，同一清单在日历里和侧栏、列表页同色。
const tint = listTint
const ink = listInk
const dot = listInk

// 信用卡的两个日子用固定双色（账单日琥珀、还款日玫红），其余提醒仍用清单色——
// 这样即使在同一个清单里，这两天也能一眼分出来。
const CARD_STATEMENT_COLOR = 'amber'
const CARD_DUE_COLOR = 'rose'
// 提前提醒没有对应的清单色名，直接给固定色（橙），与账单日/还款日再区分一层
const CARD_ADVANCE_HEX = '#fb923c'
function cardColorRole(item: CalendarItem): string | null {
  if (item.card_role === 'statement') return CARD_STATEMENT_COLOR
  if (item.card_role === 'due') return CARD_DUE_COLOR
  return null
}
function chipStyle(item: CalendarItem) {
  if (item.card_role === 'advance') {
    return { background: 'rgba(251, 146, 60, 0.14)', color: '#c2410c' }
  }
  const role = cardColorRole(item)
  const colorName = role || item.list_color
  return { background: tint(colorName), color: ink(colorName) }
}
function chipDot(item: CalendarItem) {
  if (item.card_role === 'advance') return CARD_ADVANCE_HEX
  return ink(cardColorRole(item) || item.list_color)
}
/** 这一天里有哪些信用卡标记（账单日/还款日），按固定顺序返回。 */
function cardMarks(cell: LunarDayInfo) {
  const roles = new Set((byDate.value.get(cellKey(cell)) || []).map((i) => i.card_role).filter(Boolean) as string[])
  const out: string[] = []
  if (roles.has('statement')) out.push('statement')
  if (roles.has('due')) out.push('due')
  if (roles.has('advance')) out.push('advance')
  return out
}

function timeLabel(item: CalendarItem) {
  // 记事的 due_at 是它的记录时间（后端取 completed_at），说「记录」比「到期」准确。
  if (item.kind === 'note') {
    const d = new Date(item.due_at)
    return '记录 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (item.all_day) return '全天'
  const d = new Date(item.due_at)
  const start = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  // 时间段任务（计划页的「开始—结束」）显示成区间，格子里一眼看得出是两个小时的事
  const end = item.end_at
  if (end) {
    const e = new Date(end)
    const sameDay = e.toDateString() === d.toDateString()
    const endText = sameDay
      ? e.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(e)
    return `${start} – ${endText}`
  }
  return start
}
function ruleLabel(rule: string) {
  return ({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' } as Record<string, string>)[rule] || '循环'
}

// 导出当前这一屏：月份 + 当前清单筛选，参数与右侧详情/格子里的内容完全一致，
// 内容也和日历口径一致（任务看到期时间、记事看记录时间）。
async function exportMonth() {
  if (exporting.value) return
  exporting.value = true
  const month = `${cursor.value.year}-${String(cursor.value.month).padStart(2, '0')}`
  try {
    const res = await exportReminders({
      scope: 'calendar',
      month,
      list_ids: listIdsParam(listFilter.value),
    })
    const filename = `calendar-${month}.csv`
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

const rangeStart = computed(() => (cells.value.length ? cellKey(cells.value[0]) : ''))
const rangeEnd = computed(() => {
  if (!cells.value.length) return ''
  const last = cells.value[cells.value.length - 1]
  const d = new Date(last.year, last.month - 1, last.day + 1)
  return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    if (viewMode.value === 'week') {
      // 周视图：直接按这一周取（含起不含止的下一天），不拉农历格子
      const from = dayKey(weekDays.value[0])
      const end = new Date(weekDays.value[6])
      end.setDate(end.getDate() + 1)
      const res = await getCalendarItems({ from, to: dayKey(end), list_ids: listIdsParam(listFilter.value) })
      items.value = res.data?.data || []
      return
    }
    // 农历接口直接返回「整周对齐」的网格，含相邻月份的格子，
    // 所以日历网格不用自己算，节气/节日标签也是现成的。
    const lunarRes = await getLunarCalendar(cursor.value.year, cursor.value.month)
    cells.value = lunarRes.data?.data?.days || []
    if (!cells.value.length) {
      items.value = []
      return
    }
    const res = await getCalendarItems({
      from: rangeStart.value,
      to: rangeEnd.value,
      list_ids: listIdsParam(listFilter.value),
    })
    items.value = res.data?.data || []
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '加载日历失败'
  } finally {
    loading.value = false
  }
}

function shiftMonth(delta: number) {
  const d = new Date(cursor.value.year, cursor.value.month - 1 + delta, 1)
  cursor.value = { year: d.getFullYear(), month: d.getMonth() + 1 }
  load()
}
function goToday() {
  const d = new Date()
  cursor.value = { year: d.getFullYear(), month: d.getMonth() + 1 }
  selectedDate.value = keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
  load()
}

async function toggle(item: CalendarItem) {
  if (saving.value) return
  saving.value = true
  try {
    if (item.completed) await restoreReminder(item.id)
    else await completeReminder(item.id)
    await load()
    showToast(item.completed ? '已恢复提醒' : item.repeat_rule !== 'none' ? '已完成，下一次提醒已安排' : '做得好，已完成')
  } catch (err: any) {
    showToast(err.response?.data?.message || '操作失败', 'error')
  } finally {
    saving.value = false
  }
}

// 就地打开编辑器：与列表页共用同一个组件，不再跳走。
// 编辑器保存后重新拉一次日历，改动立刻反映在格子里。
function openEditor(item: CalendarItem) {
  createPreset.value = null
  editingId.value = item.id
  editorOpen.value = true
}

// ---- 单击 = 查看、双击 = 编辑（用户 2026-10-10 要求）----
// 浏览器的事件顺序是 click → click → dblclick，所以单击要先等一小会儿；
// 期间来了 dblclick 就把定时器撤掉，只进编辑器，避免「先弹查看页、再弹编辑器」。
const viewItem = ref<CalendarItem | null>(null)
let itemClickTimer: ReturnType<typeof setTimeout> | undefined
const CLICK_DELAY = 250
function onItemClick(item: CalendarItem) {
  if (itemClickTimer) clearTimeout(itemClickTimer)
  itemClickTimer = setTimeout(() => { itemClickTimer = undefined; viewItem.value = item }, CLICK_DELAY)
}
function onItemDblClick(item: CalendarItem) {
  if (itemClickTimer) { clearTimeout(itemClickTimer); itemClickTimer = undefined }
  viewItem.value = null
  openEditor(item)
}
/** 时间段任务：单击仍然把整段高亮出来（0.18.0 的行为），同时弹出查看页。 */
function onSpanClick(item: CalendarItem) {
  activateSpan(item)
  onItemClick(item)
}
function closeView() { viewItem.value = null }
function editFromView() {
  const it = viewItem.value
  viewItem.value = null
  if (it) openEditor(it)
}
async function onEditorSaved() {
  await load()
}
/** 编辑弹窗里直接删除（用户 2026-10-13 加）：重新载入日历并提示。 */
async function onEditorDeleted() {
  await load()
  showToast('提醒已删除')
}

/**
 * 双击日期格（或点「＋ 新建」）在这天新建提醒：弹出和列表页同一个编辑面板。
 * 预填那天的**「过期时间」**（后台偏好 task_expire_time，默认 23:59）——
 * 与首页「今天」新建的默认时间保持同一个约定（用户 2026-10-10 要求）。
 * 清单沿用当前选中清单，没选就用默认清单，与首页快速新建同规则。
 */
/**
 * 周视图双击：按鼠标所在的时分（15 分钟粒度）新建一个 **1 小时时段**的任务。
 * 任务按清单上色、允许重叠（重叠的会并排分栏显示，见 weekBlocks）。
 */
function openCreateForSlot(d: Date, e: MouseEvent) {
  const minutes = minutesFromEvent(e)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  editingId.value = null
  createPreset.value = {
    title: '', notes: '', kind: 'task',
    list_id: listFilter.value.length === 1
      ? listFilter.value[0]
      : lists.value.find(x => x.is_default)?.id || lists.value[0]?.id || 0,
    priority: 0,
    due_at: toLocalIso(start), start_at: toLocalIso(start), end_at: toLocalIso(end),
    all_day: false, repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
  }
  editorOpen.value = true
}

function openCreateForDate(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return
  const [y, m, d] = dateKey.split('-').map(Number)
  const due = new Date(y, m - 1, d, expireTimeParts.value.h, expireTimeParts.value.m, 0, 0)
  editingId.value = null
  createPreset.value = {
    title: '', notes: '', kind: 'task',
    list_id: listFilter.value.length === 1
      ? listFilter.value[0]
      : lists.value.find(x => x.is_default)?.id || lists.value[0]?.id || 0,
    priority: 0, due_at: toLocalIso(due), all_day: false,
    repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
  }
  editorOpen.value = true
}

// 后端 time.Time 只认 RFC3339，序列化时带上本机时区偏移，保住所选墙钟时间。
function toLocalIso(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// 清单与通知渠道是编辑器需要的，字号设置来自「偏好设置」。三者都只拉一次，
// 失败也不该挡住日历本身，所以单独 try 掉。
async function loadEditorContext() {
  try {
    const [listRes, channelRes, configRes] = await Promise.all([
      getLists(), getChannelStatuses(), getAllConfigs(),
    ])
    lists.value = listRes.data?.data || []
    channels.value = channelRes.data?.data || []
    const key = configRes.data?.data?.calendar_font_size
    if (key && FONT_SIZES[key]) fontSizeKey.value = key
  } catch {
    /* 读不到就用默认字号、空清单，日历照常可用 */
  }
}

// ---- 右侧当天列表的行菜单（右键 / 行尾「⋯」）：修改、删除 ----
// 这一列原来只能点标题编辑，删不掉；右键菜单是补齐入口，触屏上则靠行尾那个「⋯」。
const menu = reactive<{ open: boolean; x: number; y: number; item: CalendarItem | null }>({
  open: false, x: 0, y: 0, item: null,
})
const rowMenuItems = computed<ContextMenuItem[]>(() => [
  { key: 'edit', label: '修改', icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { key: 'delete', label: '删除', danger: true, icon: '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
])

function openItemMenu(item: CalendarItem, event: MouseEvent) {
  menu.x = event.clientX || 0
  menu.y = event.clientY || 0
  menu.item = item
  menu.open = true
}

function onRowMenuSelect(key: string) {
  if (key === 'edit') menuEdit()
  else if (key === 'delete') menuDelete()
}

function closeItemMenu() {
  menu.open = false
  menu.item = null
}

function menuEdit() {
  const item = menu.item
  closeItemMenu()
  if (item) openEditor(item)
}

function menuDelete() {
  const item = menu.item
  closeItemMenu()
  if (item) {
    removeTarget.value = { id: item.id, title: item.title, kind: item.kind }
    removeVisible.value = true
  }
}

// 删除确认（与列表页同一套浮层）
const removeVisible = ref(false)
const removeTarget = ref<{ id: number; title: string; kind: string } | null>(null)
const removeLoading = ref(false)

async function confirmRemove() {
  if (!removeTarget.value) return
  removeLoading.value = true
  try {
    await deleteReminder(removeTarget.value.id)
    removeVisible.value = false
    showToast('已删除')
    await load()
  } catch (err: any) {
    showToast(err?.response?.data?.message || '删除失败', 'error')
  } finally {
    removeLoading.value = false
  }
}

// 别的设备改了数据（或本机在侧栏改了清单颜色/名字）时重拉：日历原先完全不监听
// 实时事件，改完清单颜色得手动刷新页面才看得到，这正是「改了颜色日历不跟着变」。
function refreshFromEvent() {
  loadEditorContext()
  void load()
}

onMounted(() => {
  void loadWeekStart()
  loadEditorContext()
  load()
  window.addEventListener('reminder-realtime', refreshFromEvent)
  window.addEventListener('reminder-realtime-resume', refreshFromEvent)
})

onBeforeUnmount(() => {
  window.removeEventListener('reminder-realtime', refreshFromEvent)
  window.removeEventListener('reminder-realtime-resume', refreshFromEvent)
})
</script>

<style scoped>
/* 时间段任务在日历里的「时钟」图标块：与「记」字、信用卡图标同一套写法（白色图标 + 底色） */
.cal-plan-mark { @apply flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px]; }
/* 跨天的条：一天内首尾同格时也保持可点区域 */
.cal-span { min-height: 15px; }

/* 字号由根元素上的 --cal-task-font 变量驱动（见 calendarFontPx），
   格子最小高度也跟着缩放，字号调大时不会把任务条挤没。 */
.cal-task { font-size: var(--cal-task-font, 10px); }
.cal-task-lg { font-size: calc(var(--cal-task-font, 10px) + 4px); }
.cal-cell { min-height: calc(var(--cal-task-font, 10px) * 6.8); }
@media (min-width: 640px) {
  .cal-cell { min-height: calc(var(--cal-task-font, 10px) * 8.4); }
}
</style>
