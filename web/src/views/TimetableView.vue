<template>
  <div class="page-container animate-fade-in">
    <PageHeader title="课程表" description="按周几排课：一张表一个人，课程与课外活动分开标色。">
      <template #actions>
        <button type="button" class="btn-primary !h-9 !px-3 !text-xs" data-timetable-add-table @click="openNewTable">
          <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>
          新建表
        </button>
        <button
          v-if="tables.length && isOwner"
          type="button"
          class="btn-secondary !h-9 !px-3 !text-xs"
          title="改这张表的名称、班级、课时与各段节次"
          data-timetable-settings
          @click="openTableSettings"
        >
          <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4" fill="none" stroke="currentColor"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 4.14l.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.44.66.84.76H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.24Z" stroke-width="1.6" stroke-linejoin="round"/></svg>
          设置
        </button>
        <button
          v-if="tables.length && isOwner"
          type="button"
          class="btn-secondary !h-9 !px-3 !text-xs"
          title="把这张表共享给另一个账号（只读或读写）"
          data-timetable-share
          @click="openShareDialog"
        >
          <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><path d="M17 8h5M19.5 5.5v5"/></svg>
          共享
        </button>
        <button
          v-if="tables.length"
          type="button"
          class="btn-secondary !h-9 !px-3 !text-xs"
          title="打印当前这张表（A4 横向，一周一页）"
          data-timetable-print
          @click="printTimetable"
        >
          <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M7 13h10v7.5H7z"/></svg>
          打印
        </button>
      </template>
    </PageHeader>

    <div v-if="errorMsg" class="mt-4 surface rounded-2xl px-5 py-3 text-sm text-destructive">{{ errorMsg }}</div>

    <div v-if="loading" class="mt-4 space-y-3">
      <div class="h-10 w-64 rounded-xl bg-muted animate-pulse"></div>
      <div class="h-64 rounded-2xl bg-muted/60 animate-pulse"></div>
    </div>

    <template v-else>
      <!-- 多张表：一人一张，顶部标签切换（用户 2026-10-18「支持多人表，通过索引分割标签切换」）。
           2026-10-18 二次改版：每张表带自己的浅彩色（与它课程卡的色系一致），标签与表头背景同色。 -->
      <div v-if="tables.length" class="mt-4 flex min-w-0 items-center gap-2">
        <div class="timetable-tabs" role="tablist" aria-label="课程表">
          <button
            v-for="table in tables"
            :key="table.id"
            type="button"
            role="tab"
            class="timetable-tab"
            :class="table.id === activeId ? tableAccent(table).tabText : ''"
            :style="table.id === activeId ? { backgroundColor: tableAccent(table).tint + '2b' } : undefined"
            :aria-selected="table.id === activeId"
            :data-timetable-tab="table.name"
            @click="selectTable(table.id)"
          >
            <span class="timetable-tab-dot" :class="tableAccent(table).barBg"></span>
            {{ table.name }}
            <span
              v-if="table.is_shared"
              class="timetable-share-chip"
              :class="table.permission === 'read' ? 'is-readonly' : 'is-write'"
              :title="`由 ${table.owner_name || '对方'} 共享`"
            >{{ table.permission === 'read' ? '只读' : '可编辑' }}</span>
            <span class="timetable-tab-count">{{ table.entry_count }}</span>
          </button>
        </div>
        <!-- 用户 2026-10-20：「编辑按钮和空节次合并成一个按钮」——
             进编辑态就铺出空节次（有落点、可点可拖），退出就收起。 -->
        <button
          v-if="canWrite"
          type="button"
          class="timetable-edit-toggle"
          :class="editing ? 'is-on' : ''"
          :data-timetable-edit="editing ? 'on' : 'off'"
          title="编辑：铺出空节次，点一格加课，拖动课程可换位置"
          @click="toggleEditing"
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke-width="1.8" stroke-linejoin="round"/></svg>
          {{ editing ? '完成' : '编辑课程表' }}
        </button>
      </div>

      <div v-if="activeSummary && !isOwner" class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-timetable-shared-note>
        <span class="rounded-full bg-brand-500/10 px-2 py-0.5 font-bold text-brand-600 dark:text-brand-300">共享表</span>
        <span>由 <b class="font-bold text-foreground">{{ activeSummary.owner_name || '对方' }}</b> 共享给你 · {{ activePermission === 'read' ? '只读，只能查看' : '可编辑课程，不能改表设置' }}</span>
      </div>

      <div v-if="!tables.length" class="mt-6 surface rounded-2xl px-6 py-14 text-center" data-timetable-empty>
        <p class="text-base font-bold text-foreground">还没有课程表</p>
        <p class="mt-1 text-sm text-muted-foreground">给家里每个人建一张，课程和课外活动都能放进来。</p>
        <button type="button" class="btn-primary mt-4 !h-9 !px-4 !text-xs" @click="openNewTable">建第一张表</button>
      </div>

      <!-- 一周七天，各一列；窄屏自动堆成一天一块，手机上不用横向拖。
           七天共用一块底板，列与列之间只留 1px 细线，比七张独立卡片更整。 -->
      <div v-else class="timetable-shell mt-4" data-timetable-board :style="{ backgroundImage: shellGlow }">
        <div class="timetable-grid">
          <section
            v-for="day in days"
            :key="day.weekday"
            class="timetable-day"
            :class="day.weekday === todayWeekday ? 'timetable-day-today' : ''"
            :data-day-column="day.weekday"
          >
            <header class="timetable-day-head">
              <div class="flex items-baseline gap-1.5">
                <span class="timetable-day-name" :class="day.weekday === todayWeekday ? 'text-brand-600 dark:text-brand-300' : 'text-foreground'">{{ day.label }}</span>
                <span class="timetable-day-date">{{ day.date }}</span>
              </div>
              <span v-if="day.weekday === todayWeekday" class="timetable-today">今天</span>
              <span v-else class="timetable-day-count">{{ day.entries.length || '—' }}</span>
            </header>

            <div class="flex flex-1 flex-col gap-2">
              <div
                v-for="period in day.periods"
                :key="period.key"
                class="timetable-period"
                :data-timetable-period="period.key"
              >
                <p class="timetable-period-label" :data-timetable-period-label="period.key" :data-section-color="sectionColors[period.key]">
                    <span class="timetable-period-dot" :style="{ background: paletteOfKey(sectionColors[period.key]).tint }"></span>
                    {{ period.label }}
                    <span v-if="period.count" class="timetable-period-count">{{ period.count }}</span>
                  </p>
                  <template v-for="item in period.items" :key="item.kind === 'entry' ? 'e' + item.entry.id : 's' + item.slot.index">
                    <button
                      v-if="item.kind === 'entry'"
                      type="button"
                      class="timetable-card"
                      :class="[paletteOf(item.entry).card, item.entry.kind === 'activity' ? 'timetable-card-activity' : '', editing ? 'timetable-card-draggable' : '']"
                      :data-entry-id="item.entry.id"
                      :data-entry-kind="item.entry.kind"
                      :data-align-row="`r${item.row}`"
                      :draggable="editing"
                      @click="openEntry(item.entry)"
                      @dragstart="onDragStart($event, item.entry)"
                      @dragend="onDragEnd"
                      @dragover="onDragOver"
                      @dragleave="onDragLeave"
                      @drop="onDropOnEntry($event, item.entry)"
                    >
                      <span class="timetable-card-bar" :class="paletteOf(item.entry).barBg"></span>
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="timetable-card-time">{{ item.entry.start_time }}<span class="opacity-40">–</span>{{ item.entry.end_time }}</span>
                        <span class="flex items-center gap-1">
                          <span class="timetable-card-title" :title="item.entry.title">{{ item.entry.title }}</span>
                          <span v-if="item.entry.kind === 'activity'" class="timetable-activity-tag">活动</span>
                        </span>
                        <span v-if="entryLocation(item.entry) || item.entry.teacher || item.entry.note" class="flex min-w-0 items-center gap-1">
                          <span v-if="entryLocation(item.entry) || item.entry.teacher" class="timetable-card-meta min-w-0 flex-1">
                            {{ [entryLocation(item.entry), item.entry.teacher].filter(Boolean).join(' · ') }}
                          </span>
                          <span v-if="item.entry.note" class="timetable-card-note" :title="item.entry.note">{{ item.entry.note }}</span>
                        </span>
                      </span>
                    </button>
                    <button
                      v-else-if="item.kind === 'slot'"
                      type="button"
                      class="timetable-slot"
                      :data-timetable-slot="item.slot.index"
                      :data-align-row="`r${item.row}`"
                      @click="openNewEntry(day.weekday, item.slot.start)"
                      @dragover="onDragOver"
                      @dragleave="onDragLeave"
                      @drop="onDropOnSlot($event, day.weekday, item.slot)"
                    >
                      <span class="timetable-slot-index">第{{ item.slot.sectionIndex }}节</span>
                      <span class="timetable-slot-time">{{ item.slot.start }}</span>
                      <svg viewBox="0 0 24 24" class="ml-auto h-3 w-3 opacity-50" fill="none" stroke="currentColor"><path d="M12 6v12M6 12h12" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                    <span v-else class="timetable-slot-filler" :data-align-row="`r${item.row}`" aria-hidden="true"></span>
                  </template>
              </div>

              <button
                v-if="editing"
                type="button"
                class="timetable-add"
                :data-timetable-add-entry="day.weekday"
                :aria-label="`给${day.label}加一节`"
                @click="openNewEntry(day.weekday)"
              >
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M12 6v12M6 12h12" stroke-width="2" stroke-linecap="round"/></svg>
                添加
              </button>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- 新建/编辑课程 -->
    <Modal v-model="entryOpen" :title="entryEditing ? '编辑课程' : '添加课程'">
      <form class="space-y-3" data-entry-dialog @submit.prevent="saveEntry">
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="timetable-kind" :class="form.kind === 'course' ? 'timetable-kind-on' : ''" data-entry-kind-course @click="form.kind = 'course'">课程</button>
          <button type="button" class="timetable-kind" :class="form.kind === 'activity' ? 'timetable-kind-on' : ''" data-entry-kind-activity @click="form.kind = 'activity'">课外活动</button>
        </div>

        <label class="block">
          <span class="text-xs font-bold text-foreground">名称</span>
          <input v-model="form.title" class="input-field mt-1" maxlength="40" placeholder="例如：数学 / 机器人社团" data-entry-title />
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">星期</span>
            <select v-model.number="form.weekday" class="input-field mt-1" data-entry-weekday>
              <option v-for="day in weekdays" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select>
          </label>
          <label class="block">
            <span class="flex items-center justify-between text-xs font-bold text-foreground">
              颜色
              <span class="text-[10px] font-medium text-muted-foreground">{{ currentColorLabel }}</span>
            </span>
            <span class="mt-1 flex h-[38px] items-center gap-2">
              <button
                v-for="color in palette"
                :key="color.key"
                type="button"
                class="relative flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-transparent transition duration-150"
                :class="[color.dot, form.color === color.key ? 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-surface' : '']"
                :data-entry-color="color.key"
                :data-entry-color-on="form.color === color.key ? '1' : '0'"
                :aria-label="color.label"
                :aria-pressed="form.color === color.key"
                @click="form.color = color.key; colorTouched = true"
              >
                <svg v-if="form.color === color.key" viewBox="0 0 24 24" class="h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]" fill="none" stroke="currentColor"><path d="m5 12.5 4.5 4.5L19 7.5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </span>
          </label>
        </div>

        <label class="block">
          <span class="flex items-center justify-between text-xs font-bold text-foreground">
            节次
            <span class="text-[10px] font-medium text-muted-foreground">按表设置里的节次排</span>
          </span>
          <select class="input-field mt-1" :value="selectedSlotIndex" @change="onPickSlot" data-entry-slot>
            <option :value="0">自定义时间</option>
            <option v-for="slot in slots" :key="slot.index" :value="slot.index">
              {{ sectionLabel(slot.section) }} 第{{ slot.sectionIndex }}节 · {{ slot.start }}–{{ slot.end }}
            </option>
          </select>
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">开始</span>
            <input v-model="form.start_time" type="time" class="input-field mt-1" data-entry-start @input="syncEndFromStart" />
          </label>
          <label class="block">
            <span class="flex items-center justify-between text-xs font-bold text-foreground">
              结束
              <button type="button" class="text-[10px] font-semibold text-brand-600 dark:text-brand-300" @click="syncEndFromStart">按课时</button>
            </span>
            <input v-model="form.end_time" type="time" class="input-field mt-1" data-entry-end />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">地点（可选）</span>
            <input v-model="form.location" class="input-field mt-1" maxlength="40" placeholder="三班 / 体育馆" data-entry-location />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">老师（可选）</span>
            <input v-model="form.teacher" class="input-field mt-1" maxlength="30" placeholder="李老师" data-entry-teacher />
          </label>
        </div>

        <label class="block">
          <span class="text-xs font-bold text-foreground">备注（可选）</span>
          <textarea v-model="form.note" rows="2" maxlength="300" class="input-field mt-1" placeholder="带泳衣 / 周五交作业…" data-entry-note></textarea>
        </label>

        <p v-if="entryError" class="text-xs font-semibold text-destructive">{{ entryError }}</p>

        <div class="flex items-center gap-2 pt-1">
          <button v-if="entryEditing" type="button" class="btn-secondary !h-9 !px-3 !text-xs text-destructive" data-entry-delete @click="removeEntry">删除</button>
          <span class="flex-1"></span>
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="entryOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="savingEntry" data-entry-save>
            {{ savingEntry ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </Modal>

    <!-- 只读共享：点课程看详情，不进入编辑表单 -->
    <Modal v-model="viewOpen" title="课程详情">
      <div v-if="viewEntry" class="space-y-2.5 text-sm" data-entry-view>
        <div class="flex items-center gap-2">
          <span class="timetable-card-bar relative !inset-y-0 !left-0 !h-8" :class="paletteOf(viewEntry).barBg"></span>
          <p class="text-base font-bold text-foreground" data-entry-view-title>{{ viewEntry.title }}</p>
          <span v-if="viewEntry.kind === 'activity'" class="timetable-activity-tag">活动</span>
        </div>
        <p class="text-xs text-muted-foreground" data-entry-view-time>{{ viewWeekday }} · {{ viewEntry.start_time }}–{{ viewEntry.end_time }}</p>
        <p v-if="viewEntry.location || viewEntry.teacher" class="text-xs text-muted-foreground">
          {{ [viewEntry.location, viewEntry.teacher].filter(Boolean).join(' · ') }}
        </p>
        <p v-if="viewEntry.note" class="whitespace-pre-wrap rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-foreground/80">{{ viewEntry.note }}</p>
        <p class="text-[11px] text-muted-foreground">这张表由对方共享给你，当前权限为只读。</p>
      </div>
      <div class="mt-4 flex justify-end">
        <button type="button" class="btn-secondary !h-9 !px-4 !text-xs" data-entry-view-close @click="viewOpen = false">关闭</button>
      </div>
    </Modal>

    <!-- 共享：只允许表主管理；接收方按 read/write 权限使用 -->
    <Modal v-model="shareOpen" title="共享课程表">
      <div class="space-y-3" data-share-dialog>
        <p class="text-xs leading-5 text-muted-foreground">
          把「<b class="font-bold text-foreground">{{ activeSummary?.name }}</b>」共享给另一个账号。
          只读只能查看；读写可以增删改课程，不能改表设置、删表或再共享。
        </p>
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="addShare">
          <input
            v-model="shareUsername"
            class="input-field !h-9 min-w-0 flex-1 !text-xs"
            maxlength="40"
            placeholder="对方登录用户名"
            data-share-username
          />
          <select v-model="sharePermission" class="input-field !h-9 !w-[92px] !px-2 !text-xs" data-share-permission>
            <option value="read">只读</option>
            <option value="write">读写</option>
          </select>
          <button type="submit" class="btn-primary !h-9 !px-3 !text-xs" :disabled="shareBusy" data-share-add>
            {{ shareBusy ? '共享中…' : '共享' }}
          </button>
        </form>
        <p v-if="shareError" class="text-xs font-semibold text-destructive" data-share-error>{{ shareError }}</p>

        <div v-if="sharesLoading" class="rounded-xl border border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">读取共享名单…</div>
        <div v-else-if="!shares.length" class="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground" data-share-empty>还没有共享给任何人</div>
        <ul v-else class="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70" data-share-list>
          <li v-for="share in shares" :key="share.id" class="flex items-center gap-2 px-3 py-2" data-share-row>
            <span class="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" data-share-row-name>{{ share.username }}</span>
            <select
              class="input-field !h-8 !w-[86px] !px-2 !text-[11px]"
              :value="share.permission"
              data-share-row-permission
              @change="changeSharePermission(share, $event)"
            >
              <option value="read">只读</option>
              <option value="write">读写</option>
            </select>
            <button type="button" class="shrink-0 text-[11px] font-semibold text-destructive" data-share-remove @click="removeShare(share)">移除</button>
          </li>
        </ul>
        <p class="text-[11px] leading-4 text-muted-foreground">
          对方需要在偏好设置里开启「课程表栏目」才能从侧栏进入；共享按登录用户名精确匹配。
        </p>
      </div>
    </Modal>

    <!-- 表设置：改名 / 删除 -->
    <Modal v-model="tableOpen" title="课程表设置" size="lg">
      <form class="space-y-3" @submit.prevent="saveTableSettings">
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">名字</span>
            <input v-model="tableName" class="input-field mt-1" maxlength="20" placeholder="例如：哥哥 / 妹妹 / 我" data-table-name />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">班级 / 地点（可选）</span>
            <input
              v-model="tableLocation"
              class="input-field mt-1"
              maxlength="40"
              placeholder="例如：三班 / 教学楼 201"
              title="课程自己没填地点时显示它"
              data-table-location
            />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">一节课（分钟）</span>
            <input v-model.number="tableForm.lesson" type="number" min="15" max="180" step="5" class="input-field mt-1" data-table-lesson />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">课间（分钟）</span>
            <input v-model.number="tableForm.brk" type="number" min="0" max="60" step="5" class="input-field mt-1" data-table-break />
          </label>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-muted-foreground">重排按每段自己的第 1 节起算，段内课时 + 课间往后排。</span>
          <button type="button" class="btn-secondary !h-8 shrink-0 !px-3 !text-[11px]" data-table-regenerate @click="regenerateAll">
            按课时重排
          </button>
        </div>

        <div class="space-y-2">
          <p class="text-xs font-bold text-foreground">各段节次与时间段</p>
          <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="section in SECTIONS" :key="section.key" class="rounded-xl border border-border/70 p-2">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1 text-[11.5px] font-bold">
                {{ section.label }}
                <input
                  type="number"
                  min="0"
                  max="16"
                  class="w-9 rounded-md border border-border/70 bg-surface px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums"
                  :value="tableForm.periods.filter((p) => p.section === section.key).length"
                  :data-table-section-count="section.key"
                  @change="setSectionCount(section.key, Number(($event.target as HTMLInputElement).value))"
                />
                <span class="font-medium text-muted-foreground">节</span>
              </span>
              <button
                type="button"
                class="rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-500/10 dark:text-brand-300"
                :data-table-add="section.key"
                @click="addPeriod(section.key)"
              >+ 加一节</button>
            </div>
            <div v-if="!tableForm.periods.some((p) => p.section === section.key)" class="px-1 py-1 text-[10.5px] text-muted-foreground">还没有节次</div>
            <div class="space-y-1">
              <template v-for="(period, index) in tableForm.periods" :key="index">
                <div v-if="period.section === section.key" class="grid grid-cols-[42px_1fr_1fr_22px] items-center gap-1.5">
                  <span class="text-[10.5px] font-semibold tabular-nums text-muted-foreground">第{{ sectionIndexAt(index) }}节</span>
                  <input v-model="period.start" type="time" class="input-field !h-8 !px-2 !text-[11px]" :data-table-period-start="index" />
                  <input v-model="period.end" type="time" class="input-field !h-8 !px-2 !text-[11px]" :data-table-period-end="index" />
                  <button
                    type="button"
                    class="text-muted-foreground transition hover:text-destructive"
                    :data-table-remove="index"
                    @click="removePeriod(index)"
                  >×</button>
                </div>
              </template>
            </div>
          </div>
          </div>
        </div>

        <p class="text-[11px] leading-4 text-muted-foreground">
          一个账号可以建多张表，顶部标签切换；每张表的课程各归各的。每节次的时间段按学校作息自己排
          （早课/上午/下午/晚课分开，每段都从自己的第 1 节算起）；新建课程时选节次就直接带出起止时间。
        </p>
        <p v-if="tableError" class="text-xs font-semibold text-destructive">{{ tableError }}</p>
        <div class="flex items-center gap-2 pt-1">
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs text-destructive" data-table-delete @click="removeTable">删除这张表</button>
          <span class="flex-1"></span>
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="tableOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="savingTable" data-table-save>保存</button>
        </div>
      </form>
    </Modal>

    <!-- 新建表（与设置共用一个弹窗会分不清「新建」还是「改名」） -->
    <Modal v-model="createOpen" title="新建课程表">
      <form class="space-y-3" @submit.prevent="submitNewTable">
        <label class="block">
          <span class="text-xs font-bold text-foreground">名字</span>
          <input v-model="newTableName" class="input-field mt-1" maxlength="20" placeholder="例如：哥哥 / 妹妹" data-new-table-name />
        </label>
        <p v-if="newTableError" class="text-xs font-semibold text-destructive">{{ newTableError }}</p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="createOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="creatingTable" data-new-table-save>
            {{ creatingTable ? '创建中…' : '创建' }}
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import Modal from '../components/Modal.vue'
import {
  addTimetableShare, createEntry, createTimetable, deleteEntry, deleteTimetable,
  getTimetable, getTimetableShares, getTimetables, removeTimetableShare,
  updateEntry, updateTimetable, updateTimetableShare,
  type EntryInput, type TimetableEntry, type TimetablePermission, type TimetableShare, type TimetableSummary,
} from '../api/timetable'

const weekdays = [
  { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
  { value: 4, label: '周四' }, { value: 5, label: '周五' }, { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

// 课程配色：与清单/卡片同一套审美，浅底 + 同色描边；深色模式自动降透明度。
const palette = [
  { key: 'indigo', label: '靛蓝', dot: 'bg-indigo-500', card: 'bg-indigo-50/80 border-indigo-200/80 dark:bg-indigo-500/[0.12] dark:border-indigo-400/25', time: 'text-indigo-600 dark:text-indigo-300', barBg: 'bg-indigo-400', tint: '#6366f1', tabText: 'text-indigo-700 dark:text-indigo-300' },
  { key: 'rose', label: '玫红', dot: 'bg-rose-500', card: 'bg-rose-50/80 border-rose-200/80 dark:bg-rose-500/[0.12] dark:border-rose-400/25', time: 'text-rose-600 dark:text-rose-300', barBg: 'bg-rose-400', tint: '#f43f5e', tabText: 'text-rose-700 dark:text-rose-300' },
  { key: 'emerald', label: '翠绿', dot: 'bg-emerald-500', card: 'bg-emerald-50/80 border-emerald-200/80 dark:bg-emerald-500/[0.12] dark:border-emerald-400/25', time: 'text-emerald-600 dark:text-emerald-300', barBg: 'bg-emerald-400', tint: '#10b981', tabText: 'text-emerald-700 dark:text-emerald-300' },
  { key: 'amber', label: '琥珀', dot: 'bg-amber-500', card: 'bg-amber-50/80 border-amber-200/80 dark:bg-amber-500/[0.12] dark:border-amber-400/25', time: 'text-amber-600 dark:text-amber-300', barBg: 'bg-amber-400', tint: '#f59e0b', tabText: 'text-amber-700 dark:text-amber-300' },
  { key: 'sky', label: '天蓝', dot: 'bg-sky-500', card: 'bg-sky-50/80 border-sky-200/80 dark:bg-sky-500/[0.12] dark:border-sky-400/25', time: 'text-sky-600 dark:text-sky-300', barBg: 'bg-sky-400', tint: '#0ea5e9', tabText: 'text-sky-700 dark:text-sky-300' },
  { key: 'violet', label: '紫罗兰', dot: 'bg-violet-500', card: 'bg-violet-50/80 border-violet-200/80 dark:bg-violet-500/[0.12] dark:border-violet-400/25', time: 'text-violet-600 dark:text-violet-300', barBg: 'bg-violet-400', tint: '#8b5cf6', tabText: 'text-violet-700 dark:text-violet-300' },
  { key: 'teal', label: '青碧', dot: 'bg-teal-500', card: 'bg-teal-50/80 border-teal-200/80 dark:bg-teal-500/[0.12] dark:border-teal-400/25', time: 'text-teal-600 dark:text-teal-300', barBg: 'bg-teal-400', tint: '#14b8a6', tabText: 'text-teal-700 dark:text-teal-300' },
  { key: 'slate', label: '石墨', dot: 'bg-slate-500', card: 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-500/[0.12] dark:border-slate-400/25', time: 'text-slate-600 dark:text-slate-300', barBg: 'bg-slate-400', tint: '#64748b', tabText: 'text-slate-700 dark:text-slate-300' },
]

const tables = ref<TimetableSummary[]>([])
const activeId = ref<number>(0)
const entries = ref<TimetableEntry[]>([])
const loading = ref(true)
const errorMsg = ref('')

const todayWeekday = (() => {
  const d = new Date().getDay()
  return d === 0 ? 7 : d
})()

// 本周一到周日的日期，列头写「周一 10/19」；跨天时也一眼知道是哪天。
const weekDates = computed(() => {
  const now = new Date()
  const dow = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1))
  return weekdays.map((day) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day.value - 1)
    return `${dt.getMonth() + 1}/${dt.getDate()}`
  })
})

// 一天分早课 / 上午 / 下午 / 晚课四段（用户 2026-10-18 要求）。
// 每节次的时间段是表设置里自己排的（用户 2026-10-19：「允许设置每节次时间段」），
// 所以换学校作息不用改代码；卡片落在哪一段看它离哪一节最近。
const activeTable = ref<TimetableSummary | null>(null)
const activeSummary = computed(() => tables.value.find((t) => t.id === activeId.value) || null)
const activePermission = computed<TimetablePermission>(() => activeSummary.value?.permission || 'owner')
const isOwner = computed(() => activePermission.value === 'owner')
const canWrite = computed(() => activePermission.value !== 'read')

// 表级「班级 / 地点」：课程条目自己不填地点时，卡片与弹窗都退回用它（用户 2026-10-19）。
const activeLocation = computed(() => (activeTable.value?.location || '').trim())
function entryLocation(entry: TimetableEntry) {
  return (entry.location || '').trim() || activeLocation.value
}
// 空节次不再是独立开关（用户 2026-10-20：与「编辑」合并成一个按钮）：
// 编辑态铺出空节次，退出编辑收起，避免两个按钮表达同一个意图。
const showSlots = computed(() => editing.value)

// 行对齐：同一节次在七列里高度取最大值，空位补一块同高的占位。
// 不靠固定高度，卡片会因为备注/老师多寡长高，旧的错位就是这么来的。
const desktopQuery = typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)') : null
async function alignRows() {
  await nextTick()
  // 手机是一列一天，不存在跨列的「同一行」，强行等高只会让卡片底下空一截。
  if (!desktopQuery?.matches) {
    document.querySelectorAll<HTMLElement>('[data-align-row]').forEach((node) => { node.style.minHeight = '' })
    return
  }
  document.body.dataset.alignPass = String(Date.now())
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-align-row]'))
  const groups = new Map<string, HTMLElement[]>()
  for (const node of nodes) {
    const key = node.dataset.alignRow || ''
    const list = groups.get(key)
    if (list) list.push(node)
    else groups.set(key, [node])
  }
  let applied = 0
  for (const list of groups.values()) {
    list.forEach((node) => { node.style.minHeight = '' })
    const tallest = list.reduce((max, node) => Math.max(max, node.offsetHeight), 0)
    if (tallest > 0) {
      list.forEach((node) => { node.style.minHeight = `${tallest}px` })
      applied += 1
    }
  }
  document.body.dataset.alignGroups = String(applied)
}

const onResize = () => { void alignRows() }
const onLayoutChange = () => { void alignRows() }

const SECTIONS = [
  { key: 'early', label: '早课' },
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚课' },
] as const
type PeriodKey = typeof SECTIONS[number]['key']
const sectionLabel = (key: string) => SECTIONS.find((item) => item.key === key)?.label || '上午'

const pacing = computed(() => ({
  lesson: activeTable.value?.lesson_minutes || 45,
  brk: activeTable.value?.break_minutes ?? 10,
}))

// 骨架直接来自表设置里的节次表：第 N 节 + 自己的起止。空格子不写数据库，
// 点一下才变成真正的课程，所以整周模板不会把空节塞进数据里。
const slots = computed(() => {
  const list = activeTable.value?.periods || []
  const counters: Record<string, number> = {}
  return list.map((period, i) => {
    const section = (period.section || 'morning') as PeriodKey
    counters[section] = (counters[section] || 0) + 1
    return { index: i + 1, section, sectionIndex: counters[section], start: period.start, end: period.end }
  })
})

const sectionsWithSlots = computed(() => SECTIONS.map((section) => ({
  ...section,
  slots: slots.value.filter((slot) => slot.section === section.key),
})))

function minutesOf(hhmm: string) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// 归段：先看有没有正好对上某节；没有就按四段的「起点」落段
// （早课从 0 点到上午第一节，上午到下午第一节，下午到晚课第一节，之后算晚课）。
// 某一节次没排时，用 12:00 / 18:00 兜底，免得手工加的 19:30 课被塞回下午。
// 四段各配一个颜色：按表 id 做种子随机挑四个互不相同的色，
// 同一张表刷新前后不变；新建课程默认用所在段的色，用户仍可单独改。
function seededColors(seed: number) {
  // 只在这四个对比明显的色里打乱：八色里随机容易碰上翠绿/青碧这种近色，四段就分不清了。
  const pool = ['violet', 'sky', 'emerald', 'amber']
  let state = (seed * 2654435761) >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const map: Record<string, string> = {}
  SECTIONS.forEach((section, index) => { map[section.key] = pool[index] })
  return map
}
const sectionColors = computed<Record<string, string>>(() => seededColors(activeId.value || 1))
function sectionColorForStart(start: string) {
  return sectionColors.value[sectionOfStart(start)] || palette[0].key
}

function sectionOfStart(start: string): PeriodKey {
  const list = slots.value
  if (!list.length) return 'morning'
  const at = minutesOf(start)
  const exact = list.find((slot) => slot.start === start)
  if (exact) return exact.section
  const firstStart = (key: PeriodKey, fallback: string) => {
    const own = list.filter((slot) => slot.section === key)
    return own.length ? minutesOf(own[0].start) : minutesOf(fallback)
  }
  const morningAt = firstStart('morning', '12:00')
  const afternoonAt = firstStart('afternoon', '12:00')
  const eveningAt = firstStart('evening', '18:00')
  if (at < morningAt) return 'early'
  if (at < afternoonAt) return 'morning'
  if (at < eveningAt) return 'afternoon'
  return 'evening'
}

// 把一节课塞进它所在的节次格：开始时间落在哪一节的 [start, end) 就进哪一格，
// 跨过末尾的挂到最后一个节次，早于第一节的挂到第一节。这样卡片永远排在第 1…N 节里，
// 不会再出现「节次外多出一行」——空节次开关关掉时，排了课的那一节也不再显示空格子。
type TimetableSlot = { index: number; section: string; sectionIndex: number; start: string; end: string }
type PeriodItem =
  | { kind: 'entry'; at: string; entry: TimetableEntry; row: number }
  | { kind: 'slot'; at: string; slot: TimetableSlot; row: number }
  | { kind: 'filler'; at: string; slot: TimetableSlot; row: number }

function slotIndexFor(entry: TimetableEntry, sectionSlots: { start: string; end: string }[]) {
  const at = entry.start_time
  const inside = sectionSlots.findIndex((slot) => at >= slot.start && at < slot.end)
  if (inside >= 0) return inside
  for (let i = sectionSlots.length - 1; i >= 0; i -= 1) {
    if (at >= sectionSlots[i].start) return i
  }
  return sectionSlots.length ? 0 : -1
}

// 整周哪些节次上有课：别的天有课时，本天空位补一块同高的占位，
// 这样七列的「第 3 节」永远在同一水平线上，扫一眼就知道是同一时间段。
const rowsWithContent = computed(() => {
  const set = new Set<number>()
  for (const entry of entries.value) {
    const section = sectionOfStart(entry.start_time)
    const sectionSlots = slots.value.filter((slot) => slot.section === section)
    const index = slotIndexFor(entry, sectionSlots)
    if (index >= 0) set.add(sectionSlots[index].index)
  }
  return set
})

const days = computed(() => weekdays.map((day, i) => {
  const own = entries.value
    .filter((entry) => entry.weekday === day.value)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  return {
    weekday: day.value,
    label: day.label,
    date: weekDates.value[i],
    entries: own,
    periods: SECTIONS
      .map((period) => {
        const ownInSection = own.filter((entry) => sectionOfStart(entry.start_time) === period.key)
        const sectionSlots = slots.value.filter((slot) => slot.section === period.key)
        const buckets: TimetableEntry[][] = sectionSlots.map(() => [])
        const loose: TimetableEntry[] = []
        for (const entry of ownInSection) {
          const index = slotIndexFor(entry, sectionSlots)
          if (index >= 0) buckets[index].push(entry)
          else loose.push(entry)
        }
        const items: PeriodItem[] = []
        sectionSlots.forEach((slot, index) => {
          const list = buckets[index].sort((a, b) => a.start_time.localeCompare(b.start_time))
          if (list.length) {
            list.forEach((entry) => items.push({ kind: 'entry', at: entry.start_time, entry, row: slot.index }))
          } else if (showSlots.value) {
            items.push({ kind: 'slot', at: slot.start, slot, row: slot.index })
          } else if (rowsWithContent.value.has(slot.index)) {
            items.push({ kind: 'filler', at: slot.start, slot, row: slot.index })
          }
        })
        for (const entry of loose) items.push({ kind: 'entry', at: entry.start_time, entry, row: -1 })
        return { ...period, items, count: ownInSection.length }
      })
      .filter((period) => period.items.length > 0),
  }
}))

// 每张表带一个稳定的浅彩色（按表 id 落在色板里），标签、底板光晕与它自己的课程同色系。
function tableAccent(table: TimetableSummary) {
  return palette[(table.id - 1 + palette.length) % palette.length]
}
const activeAccent = computed(() => {
  const current = tables.value.find((t) => t.id === activeId.value)
  return current ? tableAccent(current) : palette[0]
})
const shellGlow = computed(() => `radial-gradient(760px 300px at 12% -20%, ${activeAccent.value.tint}1f, transparent 68%)`)

function paletteOfKey(key: string) {
  return palette.find((item) => item.key === key) || palette[0]
}

function paletteOf(entry: TimetableEntry) {
  // 没选颜色时按标题做稳定落档：同一个课程刷新后颜色不变。
  if (entry.color) {
    const hit = palette.find((p) => p.key === entry.color)
    if (hit) return hit
  }
  let hash = 0
  for (const ch of entry.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

async function loadTables(keep = 0) {
  const res = await getTimetables()
  if (res.data?.code !== 0) throw new Error(res.data?.message || '读取课程表失败')
  const list: TimetableSummary[] = res.data.data?.tables || []
  tables.value = list
  const nextId = keep && list.some((t) => t.id === keep) ? keep : list[0]?.id || 0
  activeId.value = nextId
  if (nextId) await loadEntries(nextId)
  else entries.value = []
}

async function loadEntries(id: number) {
  const res = await getTimetable(id)
  if (res.data?.code !== 0) throw new Error(res.data?.message || '读取课程表失败')
  entries.value = res.data.data?.entries || []
  activeTable.value = res.data.data?.table || null
  if (!canWrite.value) editing.value = false
}

async function selectTable(id: number) {
  if (id === activeId.value) return
  activeId.value = id
  shareOpen.value = false
  viewOpen.value = false
  if (!canWrite.value) editing.value = false
  errorMsg.value = ''
  try {
    await loadEntries(id)
  } catch (err: any) {
    errorMsg.value = err.message || '读取课程表失败'
  }
}

// 等 DOM 换完再量：days 一变（切表、加课、开关空节次、周日期到位）就重新对齐一次。
watch(days, () => { void alignRows() }, { flush: 'post' })

onMounted(async () => {
  window.addEventListener('resize', onResize)
  desktopQuery?.addEventListener('change', onLayoutChange)
  loading.value = true
  try {
    await loadTables()
  } catch (err: any) {
    errorMsg.value = err.message || '读取课程表失败'
  } finally {
    loading.value = false
    // 板子在 loading 期间是 v-if 掉的，等它真正挂上再量一次行高。
    void alignRows()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  desktopQuery?.removeEventListener('change', onLayoutChange)
})

// ---------- 新建 / 改名 / 删除表 ----------
const createOpen = ref(false)
const newTableName = ref('')
const newTableError = ref('')
const creatingTable = ref(false)

// 打印：另开一页纯 HTML（A4 横向、一周一页），不把侧栏/按钮/空节次带进纸里。
// 数据直接用当前这张表，标题带上表名与班级/地点。
function printTimetable() {
  const table = activeTable.value
  if (!table) return
  const esc = (value: string) =>
    (value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
  // 按「节次 × 星期」排成表格：每一行就是一个节次，课程按开始时间落进对应那一行，
  // 所以打印出来的行数永远等于表里配的节次数，不会因为手工时间多长出一行。
  const dayLists = days.value.map((day) => day.entries)
  // 版面色：跟这张表在页面上用的浅色一致（把强调色往白里兑 90%），
  // 节次行、节次列、早课/上午/下午/晚课分界行都用它，打印出来是同一块浅底。
  const light = (hex: string) => '#' + [1, 3, 5]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) * 0.88))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
  const band = light(tableAccent(table).tint)
  // 四段各给一种浅底色（顺序：早课琥珀、上午天蓝、下午翠绿、晚课紫罗兰），
  // 节次行与节次列仍用这张表的浅色，一眼能看出段落又不抢课程的字。
  const sectionBands: Record<PeriodKey, string> = {
    early: light('#f59e0b'),
    morning: light('#0ea5e9'),
    afternoon: light('#10b981'),
    evening: light('#8b5cf6'),
  }
  const rows: {
    section: PeriodKey
    start: string
    end: string
    number: number | null
    cells: TimetableEntry[][]
  }[] = []
  for (const section of SECTIONS) {
    const sectionSlots = slots.value.filter((slot) => slot.section === section.key)
    if (sectionSlots.length) {
      sectionSlots.forEach((slot, index) => {
        rows.push({
          section: section.key,
          start: slot.start,
          end: slot.end,
          number: slot.sectionIndex,
          cells: dayLists.map((list) =>
            list
              .filter((entry) => sectionOfStart(entry.start_time) === section.key && slotIndexFor(entry, sectionSlots) === index)
              .sort((a, b) => a.start_time.localeCompare(b.start_time)),
          ),
        })
      })
      continue
    }
    // 这张表还没配节次时，退化成按课程时间成行，至少不会丢课。
    const byStart = new Map<string, { end: string; cells: TimetableEntry[][] }>()
    dayLists.forEach((list, dayIndex) => {
      for (const entry of list) {
        if (sectionOfStart(entry.start_time) !== section.key) continue
        if (!byStart.has(entry.start_time)) {
          byStart.set(entry.start_time, { end: entry.end_time, cells: dayLists.map(() => []) })
        }
        byStart.get(entry.start_time)!.cells[dayIndex].push(entry)
      }
    })
    for (const [start, info] of [...byStart.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({ section: section.key, start, end: info.end, number: null, cells: info.cells })
    }
  }
  const head = days.value
    .map((day) => `<th>${esc(day.label)}<span class="th-date">${esc(day.date)}</span></th>`)
    .join('')
  const body = SECTIONS.map((section) => {
    const own = rows.filter((row) => row.section === section.key)
    if (!own.length) return ''
    const divider = `<tr class="sec"><th colspan="8" style="background:${sectionBands[section.key]}">${esc(section.label)}</th></tr>`
    const lines = own.map((row) => {
      const cells = row.cells.map((list, i) => {
        const today = days.value[i].weekday === todayWeekday ? ' class="today"' : ''
        if (!list.length) return `<td${today}></td>`
        const inner = list.map((entry) => {
          const meta = [entryLocation(entry), entry.teacher].filter(Boolean).join(' · ')
          // 备注不另起一行（会顶出 A4），跟页面卡片一样挤在地点·老师这行的右端。
          const metaLine = (meta || entry.note)
            ? `<span class="meta">${meta ? `<span class="meta-text">${esc(meta)}</span>` : ''}${entry.note ? `<span class="note">${esc(entry.note)}</span>` : ''}</span>`
            : ''
          return `<div class="cell"><span class="e-time">${esc(entry.start_time)}–${esc(entry.end_time)}</span>` +
            `<span class="title">${esc(entry.title)}${entry.kind === 'activity' ? '<em>活动</em>' : ''}</span>` +
            metaLine + '</div>'
        }).join('')
        return `<td${today}>${inner}</td>`
      }).join('')
      const number = row.number ? `<span class="t-no">第${row.number}节</span>` : ''
      return `<tr><th class="t"><span class="t-time">${esc(row.start)}–${esc(row.end)}</span>${number}</th>${cells}</tr>`
    }).join('')
    return divider + lines
  }).join('')
  const range = `${weekDates.value[0] || ''} – ${weekDates.value[6] || ''}`
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(table.name)} 课程表</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #111827; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #111827; padding-bottom: 6px; margin-bottom: 10px; }
h1 { font-size: 20px; margin: 0; letter-spacing: .02em; }
h1 span { font-size: 12px; font-weight: 500; color: #4b5563; margin-left: 8px; }
.sub { font-size: 11px; color: #6b7280; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 1px solid #cbd5e1; vertical-align: top; padding: 4px 5px; }
thead th { background: ${band}; font-size: 11.5px; text-align: left; font-weight: 700; }
th .th-date { display: block; font-weight: 400; font-size: 9.5px; color: #6b7280; }
th.t { width: 13%; background: ${band}; text-align: left; }
.t-time { display: block; font-size: 10px; color: #374151; font-variant-numeric: tabular-nums; }
.t-no { display: block; font-size: 9px; font-weight: 500; color: #6b7280; }
td.today { background: #f8fafc; }
.title { display: block; font-size: 11.5px; font-weight: 600; line-height: 1.3; }
.title em { font-style: normal; font-size: 9px; font-weight: 500; color: #6b7280; border: 1px solid #d1d5db; border-radius: 3px; padding: 0 3px; margin-left: 3px; vertical-align: 1px; }
.meta { display: flex; justify-content: space-between; gap: 4px; font-size: 9px; color: #6b7280; margin-top: 1px; }
.meta-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.note { flex: none; max-width: 52%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 8.5px; color: #4b5563; text-align: right; }
.e-time { display: block; font-size: 8.5px; color: #6b7280; font-variant-numeric: tabular-nums; }
.cell + .cell { margin-top: 3px; padding-top: 3px; border-top: 1px dashed #d1d5db; }
tr.sec th { background: ${band}; font-size: 10.5px; letter-spacing: .18em; text-align: left; padding: 3px 6px; }
footer { margin-top: 8px; font-size: 9px; color: #9ca3af; display: flex; justify-content: space-between; }
</style></head><body>
<header>
  <h1>${esc(table.name)} 课程表${table.location ? `<span>${esc(table.location)}</span>` : ''}</h1>
  <div class="sub">${esc(range)}</div>
</header>
<table>
  <thead><tr><th class="t">节次</th>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<footer><span>工作序记 · 打印时间 ${esc(new Date().toLocaleString('zh-CN', { hour12: false }))}</span><span>${esc(table.name)}</span></footer>
</body></html>`
  const win = window.open('', '_blank', 'width=1180,height=820')
  if (!win) return
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  // 等字体/布局稳定再唤起打印，避免首帧空白。
  win.setTimeout(() => win.print(), 300)
}

function openNewTable() {
  newTableName.value = ''
  newTableError.value = ''
  createOpen.value = true
}

async function submitNewTable() {
  const name = newTableName.value.trim()
  if (!name) { newTableError.value = '给表起个名字'; return }
  creatingTable.value = true
  newTableError.value = ''
  try {
    // 新表沿用当前这张表的节次与课时，不用每次重填（没有当前表时服务端给默认骨架）。
    const res = await createTimetable(name, activeId.value || undefined)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '创建失败')
    createOpen.value = false
    await loadTables(res.data.data?.id || 0)
  } catch (err: any) {
    newTableError.value = err.message || '创建失败'
  } finally {
    creatingTable.value = false
  }
}

const tableOpen = ref(false)
const tableName = ref('')
const tableLocation = ref('')
const tableError = ref('')
const savingTable = ref(false)
type DraftPeriod = { section: PeriodKey; start: string; end: string }
const currentColorLabel = computed(() => palette.find((item) => item.key === form.color)?.label || '未选')
const tableForm = reactive({
  lesson: 45, brk: 10,
  periods: [] as DraftPeriod[],
})

function openTableSettings() {
  // 节次表在详情接口里（列表接口只有摘要），所以以 activeTable 为准。
  const current = activeTable.value?.id === activeId.value
    ? activeTable.value
    : tables.value.find((t) => t.id === activeId.value)
  if (!current) return
  tableName.value = current.name
  tableLocation.value = current.location || ''
  tableForm.lesson = pacing.value.lesson
  tableForm.brk = pacing.value.brk
  tableForm.periods = (current.periods || []).map((period) => ({
    section: (period.section || 'morning') as PeriodKey,
    start: period.start,
    end: period.end,
  }))
  tableError.value = ''
  tableOpen.value = true
}

// 加一节：接在该段最后一节后面（没有就接在上一段后面），时长按「一节课」。
function addPeriod(section: PeriodKey) {
  const list = tableForm.periods
  const inSection = list.filter((period) => period.section === section)
  const previous = inSection.length
    ? inSection[inSection.length - 1]
    : [...list].reverse()[0]
  const start = previous ? addMinutes(previous.end, tableForm.brk) : '08:00'
  const insertAt = inSection.length
    ? list.map((period, i) => (period.section === section ? i + 1 : -1)).filter((i) => i >= 0).pop() ?? list.length
    : list.length
  list.splice(insertAt as number, 0, { section, start, end: addMinutes(start, tableForm.lesson) })
}

// 直接改「几节」：多了按课时/课间往后补，少了从这一段的末尾删。
function setSectionCount(section: PeriodKey, raw: number) {
  const list = tableForm.periods
  const own = list.filter((period) => period.section === section)
  const target = Math.max(0, Math.min(16, Math.round(raw || 0)))
  if (target === own.length) return
  if (target > own.length) {
    for (let i = own.length; i < target; i += 1) addPeriod(section)
    return
  }
  let removed = 0
  for (let i = list.length - 1; i >= 0 && removed < own.length - target; i -= 1) {
    if (list[i].section === section) {
      list.splice(i, 1)
      removed += 1
    }
  }
}

function removePeriod(index: number) {
  tableForm.periods.splice(index, 1)
}

// 按「段内课时+课间、跨段加早休/午休/晚修」重排，段结构不动。
// 起点用表内第一节自己的时间，不再单独设一个「第一节课开始」。
function regenerateAll() {
  const lesson = Number(tableForm.lesson) || 45
  const brk = Number(tableForm.brk) || 0
  let section = ''
  let cursor = ''
  tableForm.periods = tableForm.periods.map((period) => {
    // 换段就回到这一段的第 1 节：每段时间各排各的，互不影响。
    if (period.section !== section) {
      section = period.section
      cursor = period.start || '08:00'
    }
    const start = cursor
    const end = addMinutes(start, lesson)
    cursor = addMinutes(end, brk)
    return { ...period, start, end }
  })
}

// 编辑区显示「第几节」时按段内序号算（早课第 1 节、上午也有自己的第 1 节）。
function sectionIndexAt(index: number) {
  const section = tableForm.periods[index]?.section
  return tableForm.periods.slice(0, index + 1).filter((period) => period.section === section).length
}

async function saveTableSettings() {
  const name = tableName.value.trim()
  if (!name) { tableError.value = '名字不能为空'; return }
  if (!tableForm.periods.length) { tableError.value = '至少留一节课'; return }
  for (let i = 0; i < tableForm.periods.length; i += 1) {
    const period = tableForm.periods[i]
    if (!period.start || !period.end) { tableError.value = `第 ${i + 1} 节没填时间`; return }
    if (period.end <= period.start) { tableError.value = `第 ${i + 1} 节的结束要晚于开始`; return }
    if (i > 0 && period.start < tableForm.periods[i - 1].end) {
      tableError.value = `第 ${i + 1} 节和第 ${i} 节叠在一起了`
      return
    }
  }
  savingTable.value = true
  tableError.value = ''
  try {
    const res = await updateTimetable(activeId.value, {
      name,
      location: tableLocation.value.trim(),
      lesson_minutes: tableForm.lesson,
      break_minutes: tableForm.brk,
      periods: tableForm.periods,
    })
    if (res.data?.code !== 0) throw new Error(res.data?.message || '保存失败')
    tableOpen.value = false
    await loadTables(activeId.value)
  } catch (err: any) {
    tableError.value = err.message || '保存失败'
  } finally {
    savingTable.value = false
  }
}

async function removeTable() {
  const current = tables.value.find((t) => t.id === activeId.value)
  if (!current) return
  if (!window.confirm(`删除「${current.name}」和里面的全部课程？`)) return
  tableError.value = ''
  try {
    const res = await deleteTimetable(current.id)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '删除失败')
    tableOpen.value = false
    await loadTables()
  } catch (err: any) {
    tableError.value = err.message || '删除失败'
  }
}

// ---------- 课程 / 课外活动 ----------
const entryOpen = ref(false)
const entryEditing = ref<TimetableEntry | null>(null)
const entryError = ref('')
const savingEntry = ref(false)
const form = reactive<EntryInput>(blankEntry())

// 把 HH:MM 往后推 n 分钟；跨过 23:59 就卡在当天最后一分钟，不滚到第二天。
function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number)
  const total = Math.min(23 * 60 + 59, (h || 0) * 60 + (m || 0) + minutes)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function blankEntry(start = '08:00'): EntryInput {
  return {
    title: '', kind: 'course', weekday: todayWeekday,
    start_time: start, end_time: addMinutes(start, pacing.value.lesson),
    location: '', teacher: '', note: '', color: palette[0].key,
  }
}

// 新的一节默认接在当天最后一节后面（结束时间 + 课间），没有课就从 08:00 开始。
function nextStartFor(weekday: number) {
  const own = entries.value
    .filter((entry) => entry.weekday === weekday)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  const last = own[own.length - 1]
  return last ? addMinutes(last.end_time, pacing.value.brk) : '08:00'
}

const colorTouched = ref(false)

function openNewEntry(weekday: number, start?: string) {
  // 刚拖完手一松可能还带一次 click，别顺手把「添加」弹窗打开。
  if (Date.now() - lastDropAt < 400) return
  entryEditing.value = null
  const at = start || nextStartFor(weekday)
  Object.assign(form, blankEntry(at), { weekday, start_time: at })
  form.end_time = addMinutes(at, pacing.value.lesson)
  form.color = sectionColorForStart(at)
  colorTouched.value = false
  entryError.value = ''
  entryOpen.value = true
}

const selectedSlotIndex = computed(() => slots.value.find((slot) => slot.start === form.start_time)?.index || 0)

function onPickSlot(event: Event) {
  const index = Number((event.target as HTMLSelectElement).value)
  const slot = slots.value.find((item) => item.index === index)
  if (!slot) return
  form.start_time = slot.start
  form.end_time = slot.end
  if (!colorTouched.value) form.color = sectionColorForStart(slot.start)
}

// 改了开始时间就按「一节课」重算结束；想手动改结束仍然可以。
function syncEndFromStart() {
  if (!form.start_time) return
  form.end_time = addMinutes(form.start_time, pacing.value.lesson)
  if (!colorTouched.value) form.color = sectionColorForStart(form.start_time)
}

// ---------------- 拖动换课 ----------------
// 编辑态下把课程拖到空节次 = 挪过去（星期与起止一起改，长度按目标节次）；
// 拖到另一节课上 = 两节课互换位置（星期与起止对调）。只改这两条，不动同一天的其他课。
const editing = ref(false)
const dragId = ref<number | null>(null)
// 编辑态 = 可拖动 + 空白节次；两者原本是两个开关，2026-10-20 合并成一个按钮。
function toggleEditing() {
  if (!canWrite.value) return
  editing.value = !editing.value
  void alignRows()
}
let lastDropAt = 0

function onDragStart(event: DragEvent, entry: TimetableEntry) {
  if (!editing.value) {
    event.preventDefault()
    return
  }
  dragId.value = entry.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(entry.id))
  }
}

function onDragEnd() {
  dragId.value = null
}

function onDragOver(event: DragEvent) {
  if (!editing.value || !dragId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  ;(event.currentTarget as HTMLElement)?.classList.add('is-drop')
}

function onDragLeave(event: DragEvent) {
  ;(event.currentTarget as HTMLElement)?.classList.remove('is-drop')
}

async function patchEntryPosition(entry: TimetableEntry, weekday: number, start: string, end: string) {
  const res = await updateEntry(entry.id, {
    title: entry.title,
    kind: entry.kind,
    weekday,
    start_time: start,
    end_time: end,
    location: entry.location,
    teacher: entry.teacher,
    note: entry.note,
    color: entry.color,
  })
  if (res.data?.code !== 0) throw new Error(res.data?.message || '移动失败')
}

async function onDropOnSlot(event: DragEvent, weekday: number, slot: { start: string; end: string }) {
  event.preventDefault()
  onDragLeave(event)
  const source = entries.value.find((entry) => entry.id === dragId.value)
  dragId.value = null
  if (!editing.value || !source) return
  lastDropAt = Date.now()
  try {
    await patchEntryPosition(source, weekday, slot.start, slot.end)
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    window.alert(err.message || '移动失败')
  }
}

async function onDropOnEntry(event: DragEvent, target: TimetableEntry) {
  event.preventDefault()
  onDragLeave(event)
  const source = entries.value.find((entry) => entry.id === dragId.value)
  dragId.value = null
  if (!editing.value || !source || source.id === target.id) return
  lastDropAt = Date.now()
  try {
    // 只换「上什么课」，不换节次：两边各自保留原来的星期与起止时间，
    // 把课程内容（名称/类型/地点/老师/备注/颜色）对调过去。
    const swap = (from: TimetableEntry, to: TimetableEntry) => updateEntry(to.id, {
      title: from.title,
      kind: from.kind,
      weekday: to.weekday,
      start_time: to.start_time,
      end_time: to.end_time,
      location: from.location,
      teacher: from.teacher,
      note: from.note,
      color: from.color,
    })
    const resA = await swap(source, target)
    if (resA.data?.code !== 0) throw new Error(resA.data?.message || '交换失败')
    const resB = await swap(target, source)
    if (resB.data?.code !== 0) throw new Error(resB.data?.message || '交换失败')
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    window.alert(err.message || '交换失败')
    await loadEntries(activeId.value)
  }
}

function openEditEntry(entry: TimetableEntry) {
  if (!canWrite.value) return
  entryEditing.value = entry
  Object.assign(form, {
    title: entry.title, kind: entry.kind, weekday: entry.weekday,
    start_time: entry.start_time, end_time: entry.end_time,
    location: entry.location, teacher: entry.teacher,
    note: entry.note, color: entry.color || '',
  })
  colorTouched.value = true
  entryError.value = ''
  entryOpen.value = true
}

// 只读详情与共享管理
const viewOpen = ref(false)
const viewEntry = ref<TimetableEntry | null>(null)
const viewWeekday = computed(() => weekdays.find((d) => d.value === viewEntry.value?.weekday)?.label || '')
function openEntry(entry: TimetableEntry) {
  if (canWrite.value) openEditEntry(entry)
  else {
    viewEntry.value = entry
    viewOpen.value = true
  }
}

const shareOpen = ref(false)
const shares = ref<TimetableShare[]>([])
const sharesLoading = ref(false)
const shareUsername = ref('')
const sharePermission = ref<'read' | 'write'>('read')
const shareBusy = ref(false)
const shareError = ref('')

async function loadShares() {
  if (!activeId.value) return
  sharesLoading.value = true
  shareError.value = ''
  try {
    const res = await getTimetableShares(activeId.value)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '读取共享名单失败')
    shares.value = res.data.data?.shares || []
  } catch (err: any) {
    shareError.value = err.message || '读取共享名单失败'
    shares.value = []
  } finally {
    sharesLoading.value = false
  }
}

async function openShareDialog() {
  if (!isOwner.value) return
  shareUsername.value = ''
  sharePermission.value = 'read'
  shareError.value = ''
  shareOpen.value = true
  await loadShares()
}

async function addShare() {
  const username = shareUsername.value.trim()
  if (!username) { shareError.value = '请输入对方的登录用户名'; return }
  if (!activeId.value || shareBusy.value) return
  shareBusy.value = true
  shareError.value = ''
  try {
    const res = await addTimetableShare(activeId.value, username, sharePermission.value)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '共享失败')
    shareUsername.value = ''
    await loadShares()
  } catch (err: any) {
    shareError.value = err.message || '共享失败'
  } finally {
    shareBusy.value = false
  }
}

async function changeSharePermission(share: TimetableShare, event: Event) {
  const select = event.target as HTMLSelectElement
  const next = select.value === 'write' ? 'write' : 'read'
  const previous = share.permission
  if (next === previous) return
  try {
    const res = await updateTimetableShare(share.id, next)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '修改权限失败')
    share.permission = next
    shareError.value = ''
  } catch (err: any) {
    select.value = previous
    shareError.value = err.message || '修改权限失败'
  }
}

async function removeShare(share: TimetableShare) {
  if (!window.confirm(`不再把课程表共享给「${share.username}」？`)) return
  shareError.value = ''
  try {
    const res = await removeTimetableShare(share.id)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '移除失败')
    await loadShares()
  } catch (err: any) {
    shareError.value = err.message || '移除失败'
  }
}

async function saveEntry() {
  if (!form.title.trim()) { entryError.value = '课程名称不能为空'; return }
  if (form.start_time >= form.end_time) { entryError.value = '结束时间要晚于开始时间'; return }
  savingEntry.value = true
  entryError.value = ''
  try {
    const payload: EntryInput = { ...form, title: form.title.trim() }
    const res = entryEditing.value
      ? await updateEntry(entryEditing.value.id, payload)
      : await createEntry(activeId.value, payload)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '保存失败')
    entryOpen.value = false
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    entryError.value = err.message || '保存失败'
  } finally {
    savingEntry.value = false
  }
}

async function removeEntry() {
  if (!entryEditing.value) return
  if (!window.confirm(`删掉「${entryEditing.value.title}」这节课？`)) return
  try {
    const res = await deleteEntry(entryEditing.value.id)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '删除失败')
    entryOpen.value = false
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    entryError.value = err.message || '删除失败'
  }
}
</script>

<style scoped>
.timetable-tabs {
  @apply flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-surface/85 p-1 shadow-sm backdrop-blur;
  scrollbar-width: none;
}
.timetable-tabs::-webkit-scrollbar { display: none; }
.timetable-tab {
  @apply inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold text-muted-foreground transition duration-150;
}
.timetable-tab:hover { @apply bg-muted/70 text-foreground; }
.timetable-tab-dot { @apply h-2 w-2 rounded-full opacity-90; }
.timetable-tab-count {
  @apply rounded-md bg-foreground/[0.07] px-1 py-0.5 text-[10px] font-semibold leading-none opacity-80;
}
.timetable-share-chip {
  @apply rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none;
}
.timetable-share-chip.is-readonly { @apply bg-slate-500/15 text-slate-600 dark:text-slate-300; }
.timetable-share-chip.is-write { @apply bg-emerald-500/15 text-emerald-700 dark:text-emerald-300; }

/* 七天共用一块底板：列间只留 1px 细线，整块像一张纸上的周历 */
.timetable-shell { @apply overflow-hidden rounded-[22px] border border-border bg-surface bg-no-repeat shadow-sm; }
.timetable-grid { @apply grid grid-cols-1 gap-px bg-border/70 sm:grid-cols-2 xl:grid-cols-7; }
.timetable-day { @apply flex min-h-[13rem] flex-col gap-2 bg-surface p-3; }
.timetable-day-today { @apply bg-brand-500/[0.035]; }
.timetable-day-head { @apply flex items-center justify-between pb-0.5; }
.timetable-day-name { @apply text-[12.5px] font-extrabold tracking-wide; }
.timetable-day-date { @apply text-[10.5px] font-semibold tabular-nums text-muted-foreground/80; }
.timetable-day-count { @apply text-[10px] font-semibold tabular-nums text-muted-foreground/60; }
.timetable-today {
  @apply rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-brand-600 dark:text-brand-300;
}

.timetable-edit-toggle {
  /* 与左侧「课程表」标签条整体等高（用户 2026-10-20）：标签条是 28px 标签 + p-1 + 边框，
     所以不写死高度，直接拉伸到同一行的高度，顶边与底边自然齐平。 */
  @apply inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-2xl border border-border/70 bg-surface px-3.5 text-xs font-bold text-muted-foreground transition duration-150;
}
.timetable-edit-toggle:hover { @apply text-foreground; }
.timetable-edit-toggle.is-on { @apply border-brand-400/60 bg-brand-500/10 text-brand-600 dark:text-brand-300; }
.timetable-card { @apply relative flex overflow-hidden rounded-xl border p-2.5 pl-3 text-left transition duration-150; }
.timetable-card-draggable { @apply cursor-grab active:cursor-grabbing; }
.timetable-slot.is-drop,
.timetable-card.is-drop { @apply border-brand-400 bg-brand-500/10; outline: 2px dashed rgb(var(--brand-400)); outline-offset: -2px; }
.timetable-card:hover { @apply -translate-y-0.5 shadow-md; }
.timetable-card-bar { @apply absolute inset-y-1.5 left-0 w-[3px] rounded-full; }
.timetable-card-activity { @apply border-dashed; }
.timetable-card-time { @apply whitespace-nowrap text-[10.5px] font-bold tabular-nums leading-4 text-foreground/60; }
.timetable-card-title { @apply mt-0.5 truncate text-[13px] font-bold leading-5 text-foreground; }
.timetable-card-meta { @apply truncate text-[10.5px] leading-4 text-foreground/55; }
.timetable-card-note { @apply ml-auto max-w-[52%] shrink-0 truncate text-right text-[10px] leading-4 text-foreground/50; }
.timetable-activity-tag {
  @apply shrink-0 whitespace-nowrap rounded bg-surface/70 px-1 py-px text-[9px] font-bold leading-4 text-foreground/60;
}

.timetable-period { @apply flex flex-col gap-1.5; }
/* 用户 2026-10-20：取消四段之间的间隔线，直接让「早课 / 上午 / 下午 / 晚课」自己当分隔。 */
.timetable-period + .timetable-period { @apply mt-3; }
.timetable-period-label {
  @apply flex items-center gap-1 px-0.5 text-[10px] font-bold tracking-wide text-muted-foreground/70;
}
.timetable-period-count { @apply tabular-nums text-[9.5px] font-semibold text-muted-foreground/50; }
.timetable-period-dot { @apply h-1.5 w-1.5 shrink-0 rounded-full; opacity: .85; }

.timetable-slot {
  @apply flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2 py-1 text-left text-muted-foreground/70 transition;
}
.timetable-slot:hover { @apply border-brand-300 bg-brand-50/40 text-brand-700 dark:border-brand-400/40 dark:bg-brand-500/[0.06] dark:text-brand-300; }
.timetable-slot-index { @apply text-[10px] font-bold tabular-nums; }
.timetable-slot-time { @apply text-[10px] tabular-nums opacity-70; }
.timetable-slot-filler { @apply block min-h-[1px]; }

.timetable-add {
  @apply mt-auto flex items-center justify-center gap-1 rounded-lg border border-dashed border-border/80 py-1.5 text-[11px] font-semibold text-muted-foreground/70 transition;
}
.timetable-add:hover { @apply border-brand-400 bg-brand-500/5 text-brand-600 dark:text-brand-300; }

.timetable-kind { @apply rounded-xl border border-border py-2 text-xs font-bold text-muted-foreground transition; }
.timetable-kind-on { @apply border-brand-400 bg-brand-500/10 text-brand-600 dark:text-brand-300; }
</style>
