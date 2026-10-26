<template>
  <!-- 「人生要有仪式感」栏目页：把这一栏里的事项做成**倒计时卡片**。
       生日、结婚纪念日、情人节、七夕、中秋、高考……这些「一年一次」的事，
       最关心的就是「还有多少天」，所以卡片上最显眼的就是那个天数。 -->
  <section class="space-y-3" data-ceremony-panel>
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-primary !h-9 !px-4 !text-xs" data-ceremony-add @click="openCreate()">＋ 新建事项</button>
      <button class="btn-secondary !h-9 !px-3 !text-xs" data-ceremony-presets @click="presetOpen = true">常用事项模板</button>
      <span class="ml-auto text-[11px] font-semibold text-muted-foreground" data-ceremony-count>
        共 {{ cards.length }} 项
      </span>
    </div>

    <p v-if="!loading && !cards.length" class="surface rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">
      还没有事项。点「常用事项模板」一键添加生日、结婚纪念日、情人节、七夕、中秋、高考……
      也可以自己「新建事项」。
    </p>

    <!-- 倒计时卡片：近的排前面 -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="entry in cards"
        :key="entry.id"
        class="surface ceremony-card !bg-transparent"
        :class="{ 'has-image': !!cardImage(entry) }"
        :style="cardStyle(entry)"
        :data-ceremony-card="entry.id"
        :data-ceremony-days="entry.days"
        :data-ceremony-bg="entry.accent || 'default'"
        :data-ceremony-image="cardImage(entry) ? (entry.background || '') : ''"
        :data-ceremony-bg-blur="entry.bgBlur || 0"
        :data-ceremony-bg-mask="entry.bgMask ?? 45"
      >
        <!-- 卡面配色单独一层（用户 2026-10-19：「卡片透明度可调，整张卡片透明但不含文字」）：
             透明度只作用在这层背景上，文字/图标/按钮都在它上面，不跟着变淡。 -->
        <span class="ceremony-bg-fill" :style="bgFillStyle(entry)" :data-ceremony-bg-fill="entry.bgAlpha ?? 100" aria-hidden="true"></span>
        <!-- 背景图（用户 2026-10-13）：预设主题图或自己上传的图片。
             只在本机有文件的上传图在对端会加载失败 → @error 把它从这张卡片上去掉，
             卡片回落到配色渐变，不显示破图。 -->
        <img
          v-if="cardImage(entry)"
          :src="cardImage(entry)"
          class="ceremony-bg-img"
          :class="{ 'ceremony-bg-img-blurred': (entry.bgBlur || 0) > 0 }"
          :style="{ filter: (entry.bgBlur || 0) > 0 ? `blur(${entry.bgBlur}px)` : 'none', opacity: bgAlpha(entry) }"
          alt=""
          aria-hidden="true"
          @error="markImageFailed(entry.id)"
        />
        <span
          v-if="cardImage(entry)"
          class="ceremony-bg-scrim"
          :style="{ backgroundImage: maskGradient(entry.bgMask), opacity: bgAlpha(entry) }"
          :data-ceremony-bg-mask="entry.bgMask ?? 45"
          aria-hidden="true"
        ></span>
        <!-- 倒计时**放到最上面、放大**（用户 2026-10-10 要求：卡片加高、倒计时醒目）：
             天数用 30px 的字、单位小一号，整块带底色，一眼就能看到还有多少天。 -->
        <div
          class="ceremony-hero"
          :class="entry.daysClass"
          :style="heroStyle(entry)"
          :data-ceremony-countdown="entry.id"
          :data-ceremony-accent="entry.accent || 'default'"
        >
          <template v-if="entry.days === 0"><span class="ceremony-lead">就是</span> <b>今天</b></template>
          <template v-else-if="entry.days === 1"><span class="ceremony-lead">还有</span> <b data-count="1">1</b> <span class="ceremony-unit">天</span></template>
          <template v-else-if="entry.days > 1"><span class="ceremony-lead">还有</span> <b :data-count="entry.days">{{ entry.days }}</b> <span class="ceremony-unit">天</span></template>
          <template v-else><span class="ceremony-lead">已过</span> <b :data-count="-entry.days">{{ -entry.days }}</b> <span class="ceremony-unit">天</span></template>
        </div>
        <!-- 倒计时与下方信息之间的分隔线（用户 2026-10-13 要求）：
             半透明、跟卡面字色同色系 —— 深色卡面是白线，浅色卡面是深线。 -->
        <span class="ceremony-divider" data-ceremony-divider aria-hidden="true"></span>
        <!-- 图标挪到内容**左侧**并放大 2 倍（用户 2026-10-12：「图标放内容左侧放大2倍」）；
             名称 / 时间 / 循环 / 次数等一并放大。整组（图标 + 文字）在卡片里居中。 -->
        <div class="ceremony-body">
          <span class="ceremony-icon"><ListIcon :name="entry.icon" :size="44" /></span>
          <div class="min-w-0 text-left">
            <h3 class="ceremony-title" :data-ceremony-title="entry.id">{{ entry.title }}</h3>
            <p class="ceremony-date">
              <span class="ceremony-date-line" data-ceremony-solar>
                <span class="ceremony-date-year" data-ceremony-solar-year>{{ entry.solarYear }}</span>
                <span
                  class="ceremony-date-md"
                  :class="!entry.undated && entry.calendar !== 'lunar' ? 'ceremony-date-chip ceremony-date-chip-solar is-primary' : ''"
                  data-ceremony-solar-md
                >
                  {{ entry.solarMonthDay }}
                </span>
                <span v-if="entry.repeatLabel && entry.calendar !== 'lunar'" class="tiny-badge ceremony-repeat-badge">{{ entry.repeatLabel }}</span>
              </span>
              <span v-if="entry.lunarMonthDay" class="ceremony-date-line" data-ceremony-lunar>
                <span class="ceremony-date-year" data-ceremony-lunar-year>{{ entry.lunarYear }}</span>
                <span
                  class="ceremony-date-md"
                  :class="entry.calendar === 'lunar' ? 'ceremony-date-chip ceremony-date-chip-lunar is-primary' : ''"
                  data-ceremony-lunar-md
                >
                  {{ entry.lunarMonthDay }}
                </span>
                <span v-if="entry.repeatLabel && entry.calendar === 'lunar'" class="tiny-badge ceremony-repeat-badge">{{ entry.repeatLabel }}</span>
              </span>
            </p>
            <p v-if="entry.bottomText || entry.passLabel || entry.cycle > 0 || entry.notes" class="ceremony-extra">
              <span v-if="entry.bottomText" class="tiny-badge" :data-ceremony-cycle="entry.id" data-ceremony-bottom>{{ entry.bottomText }}</span>
              <span v-else-if="entry.passLabel" class="tiny-badge" :data-ceremony-cycle="entry.id" data-ceremony-pass>{{ entry.passLabel }}</span>
              <span v-else-if="entry.cycle > 0" class="tiny-badge" :data-ceremony-cycle="entry.id">与你共度第 {{ entry.cycle }} 次</span>
              <span v-if="entry.notes" class="truncate">{{ entry.notes }}</span>
            </p>
          </div>
        </div>
        <div class="ceremony-actions">
          <span class="flex items-center gap-1">
            <button class="row-action !opacity-100" title="编辑" :data-ceremony-edit="entry.id" @click="edit(entry)">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke-width="1.7" stroke-linejoin="round"/></svg>
            </button>
            <button class="row-action !opacity-100 hover:!text-rose-500" title="删除" :data-ceremony-delete="entry.id" @click="askRemove(entry)">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </span>
        </div>
      </article>
    </div>

    <!-- 常用事项模板：一键创建（固定日期的节日直接算下一次；生日/纪念日/中考要选日期） -->
    <Modal v-model="presetOpen" title="常用事项模板" size="lg">
      <p class="mb-3 text-xs text-muted-foreground">
        点一个模板就会在这一栏里建好条目（每年自动重复）。生日、结婚纪念日、中考/高考这类
        需要填日期的，选好日期再确定。
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="preset in PRESETS"
          :key="preset.key"
          class="ceremony-preset"
          :data-ceremony-preset="preset.key"
          @click="choosePreset(preset)"
        >
          <ListIcon :name="preset.icon" :size="18" />
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-[13px] font-bold">{{ preset.label }}</span>
            <span class="block text-[11px] text-muted-foreground">{{ preset.hint }}</span>
          </span>
        </button>
      </div>
    </Modal>

    <!-- 填日期 / 改名字（模板与「新建事项」共用） -->
    <Modal v-model="createOpen" :title="editingId ? '编辑事项' : '新建事项'" size="lg">
      <div class="space-y-3">
        <label class="field-label">名称
          <input v-model="form.title" class="compact-input mt-1" maxlength="100" data-ceremony-form-title placeholder="例如：妈妈生日" />
        </label>
        <!-- 日期 / 历法 / 重复：同一行、三列等宽（用户 2026-10-26 要求）。 -->
        <div class="grid grid-cols-3 items-end gap-2">
          <label class="field-label min-w-0">
            <span class="block truncate">{{ form.dateField }}</span>
            <div class="relative mt-1">
              <button ref="dateAnchor" type="button" class="compact-input flex h-9 w-full items-center justify-between gap-1 px-2 text-left text-[11px]" data-ceremony-form-date @click="dateOpen = !dateOpen">
                <span class="truncate">
                  <template v-if="form.dueAt">
                    <span class="sm:hidden">{{ formatCompact(form.dueAt) }}</span>
                    <span class="hidden sm:inline">{{ formatFull(form.dueAt) }}</span>
                  </template>
                  <template v-else>选择日期</template>
                </span>
                <svg viewBox="0 0 24 24" class="hidden h-3 w-3 shrink-0 text-muted-foreground sm:block" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              <LunarDatePicker
                v-if="dateOpen"
                v-model="datePicked"
                :calendar="form.calendar === 'lunar' ? 'lunar' : 'solar'"
                with-time
                @update:calendar="form.calendar = $event"
                :anchor-el="dateAnchor"
                @commit="dateOpen = false"
              />
            </div>
          </label>
          <label class="field-label min-w-0">倒计时历法
            <select v-model="form.calendar" class="compact-input mt-1 h-9 px-1 text-[11px]" aria-label="倒计时历法" data-ceremony-form-calendar>
              <option value="solar">公历</option>
              <option value="lunar">农历</option>
            </select>
          </label>
          <label class="field-label min-w-0">重复
            <select v-model="form.repeat" class="compact-input mt-1 h-9 px-1 text-[11px]" data-ceremony-form-repeat>
              <option value="yearly">每年</option>
              <option value="monthly">每月</option>
              <option value="none">不重复</option>
            </select>
          </label>
        </div>
        <label class="field-label">卡片底部文字
          <input v-model="form.bottomText" class="compact-input mt-1" maxlength="120" data-ceremony-form-bottom placeholder="留空自动显示「与你共度第 N 次…」" />
        </label>
        <!-- 卡片配色（用户 2026-10-11 要求：多种过渡色、可自行选择）。
             2026-10-13 起这一档颜色**同时**决定整张卡面与倒计时的底色（原来是两块色），
             所以不再有「单独设卡片颜色」这回事。 -->
        <div class="field-label">
          卡片与倒计时颜色
          <div class="mt-1.5 flex flex-wrap gap-1.5" data-ceremony-form-accents>
            <button
              v-for="a in CARD_ACCENTS"
              :key="a.key || 'default'"
              type="button"
              class="accent-swatch"
              :class="{ selected: form.accent === a.key }"
              :style="{ background: swatchGradient(a) }"
              :title="a.label"
              :aria-label="`卡片颜色：${a.label}`"
              :data-ceremony-form-accent="a.key || 'default'"
              @click="form.accent = a.key"
            ><span v-if="form.accent === a.key">✓</span></button>
            <button
              v-for="a in LIGHT_ACCENTS"
              :key="a.key"
              type="button"
              class="accent-swatch"
              :class="{ selected: form.accent === a.key }"
              :style="{ background: swatchGradient(a) }"
              :title="a.label"
              :aria-label="`卡片颜色：${a.label}`"
              :data-ceremony-form-accent="a.key"
              @click="form.accent = a.key"
            ><span v-if="form.accent === a.key">✓</span></button>
          </div>
        </div>
        <!-- 背景图（用户 2026-10-13：「可以更换图片作为背景」「针对不同主题预置一些
             对应的背景图片，可以直接选择，跟随模板不会被删除」）：预设主题图随版本走、
             不会被删；自己上传的图片在卡片删除时会跟着删（服务端清理）。 -->
        <div class="field-label">
          卡片背景图
          <p class="mt-1 text-[11px] font-medium text-muted-foreground">
            不选就是用上面的配色；选了图片后整张卡片铺满图片（倒计时仍是配色块）。
            内置主题图不会因为删卡片而消失。
          </p>
          <div class="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5" data-ceremony-form-backgrounds>
            <button
              type="button"
              class="ceremony-bg-option"
              :class="{ selected: !form.background }"
              data-ceremony-form-bg="none"
              @click="form.background = ''"
            >
              <span class="ceremony-bg-none">纯色</span>
            </button>
            <button
              v-for="bg in CEREMONY_BACKGROUNDS"
              :key="bg.key"
              type="button"
              class="ceremony-bg-option"
              :class="{ selected: form.background === `preset:${bg.key}` }"
              :data-ceremony-form-bg="bg.key"
              :title="`${bg.label}（${bg.hint}）`"
              @click="form.background = `preset:${bg.key}`"
            >
              <img :src="bg.url" alt="" class="ceremony-bg-thumb" />
              <span class="ceremony-bg-label">{{ bg.label }}</span>
            </button>
          </div>
          <!-- 背景蒙板（用户 2026-10-13：「背景增加蒙板功能，可调整虚化、透明度两个指标」）：
               虚化让照片柔和，透明度控制压在上面的暗色蒙板有多淡（越小蒙板越浓、字越清楚）。
               **一直显示**（哪怕还没选背景图）—— 之前是「选了背景图才出现」，用户 2026-10-13
               反馈「没看到蒙板设置」：得先知道要选图才看得到，等于藏起来了。
               没选图时滑块置灰 + 一句提示。 -->
          <div class="mt-2 space-y-1.5 rounded-xl border border-border/70 bg-muted/30 p-2" data-ceremony-form-bg-mask-block>
            <div class="flex flex-wrap items-baseline justify-between gap-x-2">
              <span class="text-[11px] font-bold text-foreground">背景蒙板</span>
              <span v-if="!form.background" class="text-[11px] font-medium text-muted-foreground" data-ceremony-form-bg-mask-need>
                先在上面选一张背景图，再调虚化与透明度
              </span>
            </div>
            <label class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground" :class="{ 'opacity-50': !form.background }">
              <span class="w-14 shrink-0">虚化</span>
              <input
                v-model.number="form.bgBlur"
                type="range" min="0" max="24" step="1"
                :disabled="!form.background"
                class="h-1.5 flex-1 accent-brand-500 disabled:cursor-not-allowed"
                data-ceremony-form-bg-blur
              />
              <span class="w-10 shrink-0 text-right tabular-nums">{{ form.bgBlur }}px</span>
            </label>
            <label class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground" :class="{ 'opacity-50': !form.background }">
              <span class="w-14 shrink-0">透明度</span>
              <input
                v-model.number="form.bgMask"
                type="range" min="0" max="100" step="5"
                :disabled="!form.background"
                class="h-1.5 flex-1 accent-brand-500 disabled:cursor-not-allowed"
                data-ceremony-form-bg-mask
              />
              <span class="w-10 shrink-0 text-right tabular-nums">{{ form.bgMask }}%</span>
            </label>
            <p class="text-[11px] font-medium text-muted-foreground">
              透明度越大背景越清透；越小蒙板越浓、字越清楚。
            </p>
            <label class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
              <span class="w-14 shrink-0">卡片透明度</span>
              <input
                v-model.number="form.bgAlpha"
                type="range" min="0" max="100" step="5"
                class="h-1.5 flex-1 accent-brand-500"
                data-ceremony-form-bg-alpha
              />
              <span class="w-10 shrink-0 text-right tabular-nums">{{ form.bgAlpha }}%</span>
            </label>
            <p class="text-[11px] font-medium text-muted-foreground">
              整张卡片的背景（配色 / 图片 / 蒙板）一起变淡，文字和图标不受影响；100% 就是原来的实心卡。
            </p>
            <p v-if="form.bgMask >= 80" class="text-[11px] font-semibold text-amber-600 dark:text-amber-400" data-ceremony-form-bg-mask-warn>
              透明度偏高：背景很亮（浅色照片或浅色主题图）时，卡面上的白字可能看不清，建议 30–60%。
            </p>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <label class="btn-secondary !h-8 !px-3 !text-[11px] cursor-pointer">
              {{ uploadingBackground ? '上传中…' : '上传图片' }}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                class="hidden"
                data-ceremony-form-bg-upload
                @change="pickBackgroundFile"
              />
            </label>
            <span v-if="form.background.startsWith('/uploads/')" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              已上传自己的图片
            </span>
            <button
              v-if="form.background"
              type="button"
              class="text-[11px] font-semibold text-rose-500 hover:underline"
              data-ceremony-form-bg-clear
              @click="form.background = ''"
            >清除背景</button>
          </div>
        </div>
        <p class="text-[11px] text-muted-foreground">
          农历 + 每年 = 按农历月日重复（生日、七夕、中秋、春节都用这个）。
        </p>
      </div>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button class="btn-secondary !h-9 !px-4 !text-xs" data-ceremony-form-cancel @click="createOpen = false">取消</button>
        <button class="btn-primary !h-9 !px-4 !text-xs" :disabled="saving || !form.title.trim() || !form.dueAt" data-ceremony-form-save @click="save">保存</button>
      </div>
    </Modal>

    <ConfirmDialog
      :model-value="!!removeTarget"
      danger
      title="删除事项"
      :message="`确定删除「${removeTarget?.title || ''}」吗？倒计时记录会一起消失。`"
      confirm-text="删除"
      @update:model-value="(v: boolean) => { if (!v) removeTarget = null }"
      @confirm="confirmRemove"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { CARD_ACCENTS, LIGHT_ACCENTS, accentSheen, accentSurface, heroInk, softInk, type CardAccent } from '../utils/card-accents'
import { CEREMONY_BACKGROUNDS, backgroundImageUrl } from '../utils/ceremony-backgrounds'
import ConfirmDialog from './ConfirmDialog.vue'
import ListIcon from './ListIcon.vue'
import LunarDatePicker from './LunarDatePicker.vue'
import { createReminder, deleteReminder, updateReminder, convertLunarDate, getReminders, uploadImage, type ReminderItem, type SaveReminderInput } from '../api/reminder'
import { formatLunarDate } from '../utils/lunar'

const props = defineProps<{ list: { id: number; name: string } }>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'toast', message: string, type?: 'success' | 'error'): void }>()

const items = ref<ReminderItem[]>([])
const loading = ref(true)
const saving = ref(false)
const presetOpen = ref(false)
const createOpen = ref(false)
const dateOpen = ref(false)
const dateAnchor = ref<HTMLElement | null>(null)
const editingId = ref<number | null>(null)
const removeTarget = ref<ReminderItem | null>(null)
/**
 * 当前表单来自哪个「婚庆里程碑」模板（0 = 不是里程碑）。
 * 用户填的是**结婚日期**，保存时换算成「结婚 + N 年」那一天再落库（银婚 25 / 金婚 50 / 钻石婚 60、75）。
 */
const milestoneYears = ref(0)

const form = reactive({
  title: '', dueAt: '' as string, repeat: 'yearly', calendar: 'solar', accent: '', background: '',
  bgBlur: 0, bgMask: 45, // 背景蒙板：虚化像素 / 蒙板透明度百分比（见 server/reminder/models.go）
  bgAlpha: 100, // 整卡背景透明度：100 = 不透明，0 = 只剩文字
  bottomText: '', // 卡片底部自定义文案；空 = 自动次数文案
  // 日期这一栏的标题：生日模板写「第一次生日时间」、结婚纪念日/金婚写「结婚日期」、
  // 情人节/七夕写「第一次情人节 / 第一次七夕」，其余（含「新建事项」）还是「日期」
  // ——用户 2026-10-13：「选择生日模板日期模板改成 出生年月日会不会更好理解」，
  // 2026-10-15 又把这几个标题统一成「第一次…」/「结婚日期」。
  dateField: '日期',
})
const uploadingBackground = ref(false)
// 图片加载失败的卡片（对端没有这个上传文件时）：这张卡回落到配色渐变，不显示破图
const failedImages = ref<Set<number>>(new Set())

/** 色板按钮的底色 */
const swatchGradient = (a: CardAccent) => `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`
/**
 * 倒计时块：选了颜色用该色的浓郁渐变 + 配套字色；「默认」档也给一档**浅色**
 * （按 id 稳定随机，见 utils/card-accents.ts），不再是一块死灰。
 */
// 透明卡（背景透明度 ≤ 55%）不再用卡面派生的白字/深字：底下是什么颜色由页面主题决定，
// 只有主题字色才稳定可读（暗色主题下 --color-foreground 是浅色，反之亦然）。
function cardInk(entry: { accent?: string; id: number; background?: string; bgAlpha?: number }) {
  if ((entry.bgAlpha ?? 100) <= 55) return 'rgb(var(--color-foreground))'
  if (cardImage(entry)) return '#ffffff'
  // 显式选了「浅色」档：卡面是浅底，字必须用这一档配好的深字（倒计时块仍是浓色，另算）。
  const light = LIGHT_ACCENTS.find((a) => a.key === entry.accent)
  if (light) return light.ink
  return heroInk(entry.accent, entry.id)
}

function heroStyle(entry: { accent?: string; id: number; background?: string; bgAlpha?: number }) {
  // 倒计时**不再有自己的卡片效果**（用户 2026-10-13：「倒计时不增加卡片效果，直接显示在
  // 大卡片中」）：这里只给字色与流光要用的变量，不再画独立底色/描边。
  //   --ceremony-ink 数字的基色（也是流光渐变的两端；对比度用例读它 —— 数字本身是
  //                  background-clip:text + 透明色，量不到 color）
  //   --ceremony-flow-1/2/3 彩色流光的三段颜色（用户 2026-10-13：「使用彩色流光」）：
  //                  深色卡面用**亮**的靛蓝/紫/青（一眼能看清），浅色卡面（琥珀/鎏金）
  //                  用**深**的同色系（否则亮青亮紫压在浅金上会糊成一片）。
  //                  与登录页/日历「月·周」那套 .flow-text 是同一个视觉语言。
  const ink = cardInk(entry)
  const white = ink === '#ffffff'
  // 流光的三种颜色改成**贴着卡面同色系**的柔光（用户 2026-10-18：「卡片不美观」）：
  // 原来固定用靛蓝/紫/青，压在红卡面上像贴纸；现在玫红卡面扫的是白→浅玫→粉，
  // 天蓝卡面扫的是白→浅天蓝→天蓝，整体还是一套色，数字仍然是「会流动的亮字」。
  const [s1, s2, s3] = accentSheen(entry.accent, entry.id)
  return {
    color: ink,
    '--ceremony-ink': ink,
    '--ceremony-flow-1': s1,
    '--ceremony-flow-2': s2,
    '--ceremony-flow-3': s3,
    // 数字描边（两层，用户 2026-10-13）：
    //   --ceremony-stroke = **外圈**（深色卡面白边、浅色卡面同族深边）；
    //   --ceremony-edge   = **内圈**，贴在渐变字边缘、比外圈细 —— 用户要求
    //   「白色边内侧加黑边衬托数字更清晰」：深色卡面白边里再压一道黑边，
    //   浅色卡面深边里压一道白边，数字在两种卡面上都立得住。
    '--ceremony-stroke': white ? 'rgba(255, 255, 255, .92)' : 'rgba(15, 23, 42, .28)',
    '--ceremony-edge': white ? 'rgba(2, 6, 23, .62)' : 'rgba(255, 255, 255, .9)',
    // 倒计时与信息之间的分隔线：跟字色同色系的一条半透明细线
    '--ceremony-divider': white ? 'rgba(255, 255, 255, .30)' : 'rgba(15, 23, 42, .20)',
  }
}
/**
 * 整卡底色 + **配套的字色**（用户 2026-10-11：纯白不好看 → 加浅色底；
 * 接着又报「浅色背景影响字体显示，字体是白色的，自动调整字体颜色」）。
 * 默认档的浅色卡面是不透明浅底，这里按卡面颜色自动给一套深字（含次级文字的柔化色）；
 * 选了颜色的卡面只是薄薄一层同色系浅淡底，字色交回主题。
 */
/**
 * 蒙板层：压住背景图的暗色渐变，浓度由「透明度」反推 ——
 * 透明度 45%（默认）= 蒙板浓度 55%，与上一版写死的 rgba(2,6,23,.42→.62) 观感一致。
 * 透明度 100% = 不压蒙板（背景原样），0% = 全黑（只剩字）。
 */
function maskGradient(mask?: number | null): string {
  const transparency = Math.min(100, Math.max(0, mask ?? 45))
  const alpha = (100 - transparency) / 100
  return `linear-gradient(180deg, rgba(2, 6, 23, ${(alpha * 0.76).toFixed(3)}) 0%, rgba(2, 6, 23, ${alpha.toFixed(3)}) 100%)`
}

function cardImage(entry: { background?: string; id: number }): string {
  if (failedImages.value.has(entry.id)) return ''
  return backgroundImageUrl(entry.background)
}

function markImageFailed(id: number) {
  failedImages.value = new Set(failedImages.value).add(id)
}

// 卡面背景的透明度：100 完全不透明，0 只剩文字。卡面本身不再画底色，
// 底色改由 .ceremony-bg-fill 这一层承担，所以这里只管「这层有多淡」。
function bgAlpha(entry: { bgAlpha?: number }) {
  const value = entry.bgAlpha ?? 100
  return Math.min(100, Math.max(0, value)) / 100
}
function bgFillStyle(entry: { accent?: string; id: number; bgAlpha?: number }) {
  return {
    backgroundImage: accentSurface(entry.accent, entry.id),
    opacity: bgAlpha(entry),
  }
}

function cardStyle(entry: { accent?: string; id: number; background?: string; bgAlpha?: number }) {
  // 整张卡片 = 倒计时那一套渐变（用户 2026-10-13：「卡片颜色也与倒计时颜色一致，
  // 不再单独设定卡片颜色」）。原来卡面是同色系的一层浅淡底、倒计时是浓渐变两块色，
  // 现在合成一块：字色、次级字色、图标底盘都按这套渐变算。
  // 有背景图时：渐变仍在（图片没加载出来时就是它），字色固定用白色（蒙版保证对比度）。
  const ink = cardInk(entry)
  return {
    color: ink,
    '--ceremony-ink-soft': softInk(ink),
    // 图标底盘：深字（浅色渐变）用一层淡黑，白字用一层淡白，保证图标看得清
    '--ceremony-chip': ink === '#ffffff' ? 'rgba(255,255,255,.18)' : 'rgba(15,23,42,.10)',
    '--ceremony-badge-bg': ink === '#ffffff' ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.08)',
    '--ceremony-badge-border': ink === '#ffffff' ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.12)',
  }
}

const datePicked = computed({
  get: () => (form.dueAt ? new Date(form.dueAt) : null),
  set: (v: Date | null) => { form.dueAt = v ? toLocalIso(v) : '' },
})

function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
function formatFull(v: string) {
  const d = new Date(v)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 手机窄屏三列时用短日期，避免「2011年10月13日」被截成省略号。 */
function formatCompact(v: string) {
  const d = new Date(v)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function repeatLabelOf(rule: string) {
  return ({ yearly: '每年', monthly: '每月', daily: '每天', weekly: '每周' } as Record<string, string>)[rule] || ''
}

/** 还有几天（按自然日算，今天=0，明天=1，已过=负数）。 */
function daysUntil(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.round((midnight(d) - midnight(new Date())) / 86400000)
}

/**
 * 年度循环事项（生日 / 结婚纪念日 / 节日…）的「下一次」与「已过多少次」。
 *
 * 为什么要单独算：`due_at` 存的是**第一次**的那个日子 —— 生日就是出生那天
 * （用户填了 1989-09-17）。直接拿它跟今天做差就成了**累积天数**，卡片上显示
 * 「已过 13540 天」（用户 2026-10-13 报的问题）。生日/纪念日要看的是
 * 「下一次还有多少天」+「已经过了多少次」，不是从出生到今天一共多少天。
 *
 * 返回 null 表示这条不该按年度看（比如中考这种一次性日期、或者没日期）。
 */
function nextSolarAnnual(from: Date) {
  const today = new Date()
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  let next = new Date(today.getFullYear(), from.getMonth(), from.getDate())
  if (midnight(next) < midnight(today)) next = new Date(today.getFullYear() + 1, from.getMonth(), from.getDate())
  return next
}

/** 农历年度循环：拿「月:日」锚点问服务端今年的公历日期，过了就取明年。 */
async function nextLunarAnnual(anchor: string) {
  const [rawMonth, day] = anchor.split(':').map((v) => Number(v))
  const month = Math.abs(rawMonth || 0)
  if (!month || !day) return null
  const year = new Date().getFullYear()
  for (const y of [year, year + 1]) {
    try {
      const res = await convertLunarDate({ lunar_year: y, lunar_month: month, lunar_day: day })
      const converted = res.data?.data
      if (!converted) continue
      const when = new Date(converted.year, converted.month - 1, converted.day)
      if (daysUntil(when.toISOString()) !== null && (daysUntil(when.toISOString()) as number) >= 0) return when
    } catch { /* 试下一年 */ }
  }
  return null
}

/** 农历年度事项的下一次（异步算完放这里；没算出来就回落到 due_at 的老口径）。 */
const lunarAnnual = ref<Record<number, { days: number; passed: number }>>({})

async function loadLunarAnnual() {
  const out: Record<number, { days: number; passed: number }> = {}
  for (const item of items.value) {
    if (item.repeat_rule !== 'yearly' || item.calendar !== 'lunar' || !item.due_at || !item.lunar_anchor) continue
    const next = await nextLunarAnnual(item.lunar_anchor)
    if (!next) continue
    const days = daysUntil(next.toISOString())
    if (days === null) continue
    out[item.id] = { days, passed: Math.max(0, next.getFullYear() - new Date(item.due_at).getFullYear() - 1) }
  }
  lunarAnnual.value = out
}

/**
 * 年度循环事项的「第几次 / 已过几次」文案（用户 2026-10-15 要求各模板都按「第一次」的日期来数）。
 *   - 生日：与你共度第 15 次生日
 *   - 节日（情人节、七夕、中秋…）：与你共度第 11 次情人节
 *   - 婚龄（结婚纪念日、银婚、金婚、钻石婚）：与你共度第 13 周年 / 第 12 年
 */
function anniversaryLabel(title: string, passed: number, isToday: boolean) {
  if (/银婚|金婚|钻石婚|纪念日|结婚/.test(title)) return isToday ? `与你共度第 ${passed + 1} 周年` : `与你共度第 ${passed} 年`
  const noun = /生日/.test(title) ? '生日' : title
  return `与你共度第 ${isToday ? passed + 1 : passed} 次${noun}`
}

/** 公历日期 -> 农历中文写法（同一天只请求一次，切清单时复用）。 */
const lunarLabels = ref<Record<string, string>>({})
const lunarInFlight = new Set<string>()
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
async function loadLunarLabels() {
  const pending = new Map<string, { year: number; month: number; day: number }>()
  for (const item of items.value) {
    if (!item.due_at) continue
    const d = new Date(item.due_at)
    if (Number.isNaN(d.getTime())) continue
    const key = dayKey(d)
    if (!lunarLabels.value[key] && !lunarInFlight.has(key)) {
      pending.set(key, { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() })
    }
  }
  await Promise.all([...pending].map(async ([key, date]) => {
    lunarInFlight.add(key)
    try {
      const res = await convertLunarDate(date)
      const c = res.data?.data
      if (c) lunarLabels.value = { ...lunarLabels.value, [key]: formatLunarDate(c.lunar_year, c.lunar_month, c.lunar_day) }
    } catch { /* 换算失败就不显示第二行，公历日期照常 */ }
    finally {
      lunarInFlight.delete(key)
    }
  }))
}

const cards = computed(() => items.value
  .map((item) => {
    const lunar = item.calendar === 'lunar'
    const d = item.due_at ? new Date(item.due_at) : null
    // 年度循环（生日/纪念日/节日…）：下一次的月-日 + 已经过过几次。
    // due_at 是「第一次」的日期，不能直接跟今天做差（那会变成「已过 13540 天」）。
    const annual = item.repeat_rule === 'yearly' && !!d
    const progress = annual
      ? (lunar ? lunarAnnual.value[item.id] : (() => {
          const next = nextSolarAnnual(d as Date)
          return { days: daysUntil(next.toISOString()) as number, passed: Math.max(0, next.getFullYear() - (d as Date).getFullYear() - 1) }
        })())
      : null
    const days = progress ? progress.days : daysUntil(item.due_at)
    // 「与你共度第 N 次生日」；婚龄类写「与你共度第 N 周年 / 第 N 年」
    const passLabel = !progress || progress.passed <= 0
      ? ''
      : anniversaryLabel(item.title, progress.passed, days === 0)
    return {
      ...item,
      icon: item.kind === 'note' ? 'notebook' : (item.repeat_rule === 'yearly' && /生日|纪念/.test(item.title) ? 'cake' : 'ceremony'),
      annual: !!annual,
      passLabel,
      days: days ?? 9999,
      undated: days === null,
      daysClass: days === null ? '' : days < 0 ? 'ceremony-days-past' : days <= 7 ? 'ceremony-days-soon' : '',
      dateLabel: d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '未设日期',
      solarYear: d ? `${d.getFullYear()}年` : '',
      solarMonthDay: d ? `${d.getMonth() + 1}月${d.getDate()}日` : '未设日期',
      lunarYear: d ? (lunarLabels.value[dayKey(d)] || '').split(' ')[0] : '',
      lunarMonthDay: d ? (lunarLabels.value[dayKey(d)] || '').split(' ')[1] || '' : '',
      lunarLabel: d ? lunarLabels.value[dayKey(d)] || '' : '',
      bottomText: item.bottom_text || '',
      repeatLabel: repeatLabelOf(item.repeat_rule),
      cycle: item.cycle_index || 0,
      accent: item.accent || '',
      background: item.background || '',
      bgBlur: item.bg_blur ?? 0,
      bgMask: item.bg_mask ?? 45,
      bgAlpha: item.bg_alpha ?? 100,
    }
  })
  // 排序（用户 2026-10-11 要求「倒计时最短的在最前边，以此类推」）：
  //   ① 还没到的按「还有 N 天」从小到大（就是今天 0 → 1 天 → 2 天 …）；
  //   ② 「已过 N 天」的排到最后（过得最少的在前 —— 它离下一次最近）；
  //   ③ 没日期的排最末。
  // 原来直接 `a.days - b.days`，负数（已过）会顶到最前面，一开页先看到「已过 2817 天」。
  .sort((a, b) => {
    const key = (e: { days: number; undated: boolean }) => (e.undated ? 2_000_000 : e.days >= 0 ? e.days : 1_000_000 + -e.days)
    return key(a) - key(b)
  }))

async function load() {
  loading.value = true
  try {
    const res = await getReminders({ view: 'all', status: 'all', list_id: props.list.id, sort: 'created_desc' })
    items.value = res.data?.data || []
    void loadLunarAnnual()
    void loadLunarLabels()
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.list.id, () => { void load() }, { immediate: true })
onMounted(() => { if (!items.value.length) void load() })

/**
 * 表单复位：把**所有**字段都拉回默认值，再叠加 overrides。
 *
 * 为什么不能只 assign 一部分：配色、背景图、蒙板都是「上一张卡片带过来的」状态，
 * 只改标题/日期的话，用「常用事项模板」新建出来的卡片会莫名其妙继承上一张卡片的
 * 背景图与蒙板（2026-10-13 实测踩到：三张模板卡片被写进了 preset: 背景）。
 */
function resetForm(overrides: Partial<typeof form> = {}) {
  milestoneYears.value = 0
  Object.assign(form, {
    title: '', dueAt: '', repeat: 'yearly', calendar: 'solar',
    accent: '', background: '', bgBlur: 0, bgMask: 45, bottomText: '', dateField: '日期',
    ...overrides,
  })
}

function openCreate() {
  editingId.value = null
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  resetForm({ dueAt: toLocalIso(d) })
  createOpen.value = true
}

/** 日期这一栏的标题：按卡片名字猜（模板创建与编辑已有卡片走同一套口径）。 */
function dateFieldForTitle(title: string) {
  if (/生日/.test(title)) return '第一次生日时间'
  if (/情人节/.test(title)) return '第一次情人节'
  if (/七夕/.test(title)) return '第一次七夕'
  if (/银婚|金婚|钻石婚|结婚|纪念日/.test(title)) return '结婚日期'
  return '日期'
}

function edit(entry: ReminderItem) {
  editingId.value = entry.id
  milestoneYears.value = 0
  Object.assign(form, {
    title: entry.title,
    dueAt: entry.due_at || '',
    repeat: entry.repeat_rule === 'none' ? 'none' : entry.repeat_rule,
    calendar: entry.calendar === 'lunar' ? 'lunar' : 'solar',
    accent: entry.accent || '',
    background: entry.background || '',
    bgBlur: entry.bg_blur ?? 0,
    bgMask: entry.bg_mask ?? 45,
    bgAlpha: entry.bg_alpha ?? 100,
    bottomText: entry.bottom_text || '',
    dateField: dateFieldForTitle(entry.title),
  })
  createOpen.value = true
}

/** 选图并上传：成功后把 `/uploads/...` 填进 form.background（保存时随条目落库）。 */
async function pickBackgroundFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选同一个文件
  if (!file) return
  if (file.size > 8 * 1024 * 1024) {
    emit('toast', '图片太大了（最大 8MB）', 'error')
    return
  }
  uploadingBackground.value = true
  try {
    const res = await uploadImage(file)
    const path = res.data?.data?.path
    if (!path) throw new Error('上传接口没有返回路径')
    form.background = path
    emit('toast', '背景图已选好，保存后生效')
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '图片上传失败', 'error')
  } finally {
    uploadingBackground.value = false
  }
}

async function save() {
  if (saving.value || !form.title.trim() || !form.dueAt) return
  saving.value = true
  try {
    const payload: SaveReminderInput = {
      title: form.title.trim(),
      kind: 'task',
      list_id: props.list.id,
      due_at: form.dueAt,
      repeat_rule: form.repeat as SaveReminderInput['repeat_rule'],
      calendar: form.calendar as SaveReminderInput['calendar'],
      accent: form.accent,
      background: form.background,
      bg_blur: form.bgBlur,
      bg_mask: form.bgMask,
      bg_alpha: form.bgAlpha,
      bottom_text: form.bottomText.trim(),
      channels: ['inapp'],
    }
    // 婚庆里程碑模板（银婚 25 / 金婚 50 / 钻石婚 60、75）：用户填的是**结婚日期**，
    // 卡片要倒计时到「结婚 + N 年」那一天，所以在这里换算 due_at（不每年重复，用户要的是
    // 「离金婚还差多少天」）。原始结婚日期写进备注，免得以后看不出这张卡是怎么算出来的。
    if (milestoneYears.value > 0 && payload.due_at) {
      const wedding = new Date(payload.due_at)
      if (!Number.isNaN(wedding.getTime())) {
        const day = new Date(wedding.getFullYear() + milestoneYears.value, wedding.getMonth(), wedding.getDate(), wedding.getHours(), wedding.getMinutes(), 0, 0)
        // 2 月 29 日结婚、周年落在平年时：退回那个月的最后一天（2 月 28 日）
        if (day.getMonth() !== wedding.getMonth()) day.setDate(0)
        payload.notes = `结婚日期：${wedding.getFullYear()}年${wedding.getMonth() + 1}月${wedding.getDate()}日（${milestoneYears.value} 周年倒计时）`
        payload.due_at = toLocalIso(day)
      }
    }
    if (editingId.value) await updateReminder(editingId.value, { ...payload, version: items.value.find((i) => i.id === editingId.value)?.version })
    else await createReminder(payload)
    createOpen.value = false
    presetOpen.value = false
    await load()
    emit('changed')
    emit('toast', editingId.value ? '事项已保存' : '事项已添加')
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function askRemove(entry: ReminderItem) { removeTarget.value = entry }
async function confirmRemove() {
  const target = removeTarget.value
  removeTarget.value = null
  if (!target) return
  try {
    await deleteReminder(target.id)
    await load()
    emit('changed')
    emit('toast', '事项已删除')
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '删除失败', 'error')
  }
}

/**
 * 常用事项模板。
 * needsDate = 需要用户填日期（生日/纪念日/节日/考试），其余是固定日期的节日（自动算下一次）。
 * milestone = 婚庆里程碑的周年数（银婚 25 / 金婚 50 / 钻石婚 60、75）：用户填的是结婚日期，
 *   保存时换算成「结婚 + N 年」那一天再落库（不每年重复）。
 * lunar = 按农历月日（七夕/中秋/春节…），创建时用服务端的农历换算接口算下一次的公历日期，
 * 并把农历锚点一起存进去（这样每年都能按农历重复）。
 */
const PRESETS: { key: string; label: string; hint: string; icon: string; title: string; needsDate?: boolean; lunar?: boolean; month?: number; day?: number; dateField?: string; milestone?: number }[] = [
  { key: 'birthday-solar', label: '生日（公历）', hint: '填第一次过生日的时间，每年重复', icon: 'cake', title: '生日', needsDate: true, dateField: '第一次生日时间' },
  { key: 'birthday-lunar', label: '生日（农历）', hint: '填第一次过生日的农历日期，每年按农历重复', icon: 'cake', title: '生日', needsDate: true, lunar: true, dateField: '第一次生日时间' },
  { key: 'anniversary', label: '结婚纪念日', hint: '填结婚日期，每年重复', icon: 'ceremony', title: '结婚纪念日', needsDate: true, dateField: '结婚日期' },
  // 婚庆里程碑（用户 2026-10-15：「25 年是银婚，50 年是金婚，60 年或 75 年是钻石婚，补充进模板」）：
  // 填的是**结婚日期**，卡片直接倒计时到「结婚 + N 年」那一天，不每年重复 —— 离金婚还差多少天一眼看清。
  { key: 'silver-wedding', label: '银婚纪念', hint: '结婚 25 周年（填结婚日期，倒计时到那天）', icon: 'ceremony', title: '银婚纪念', needsDate: true, milestone: 25, dateField: '结婚日期' },
  { key: 'golden-wedding', label: '金婚纪念', hint: '结婚 50 周年（填结婚日期，倒计时到那天）', icon: 'ceremony', title: '金婚纪念', needsDate: true, milestone: 50, dateField: '结婚日期' },
  { key: 'diamond-wedding-60', label: '钻石婚纪念（60 周年）', hint: '结婚 60 周年（填结婚日期，倒计时到那天）', icon: 'ceremony', title: '钻石婚纪念', needsDate: true, milestone: 60, dateField: '结婚日期' },
  { key: 'diamond-wedding-75', label: '钻石婚纪念（75 周年）', hint: '结婚 75 周年（填结婚日期，倒计时到那天）', icon: 'ceremony', title: '钻石婚纪念', needsDate: true, milestone: 75, dateField: '结婚日期' },
  // 情人节 / 七夕：以前是「固定日期，自动算下一次」，现在改成**填第一次**
  // （用户 2026-10-15：「情人节：第一次情人节，七夕：第一次七夕」）——
  // 有了第一次，卡片才算得出「已过 N 次情人节」「第 N 次七夕」。
  { key: 'valentine', label: '情人节', hint: '填第一次情人节，每年重复', icon: 'ceremony', title: '情人节', needsDate: true, dateField: '第一次情人节' },
  { key: 'qixi', label: '七夕', hint: '填第一次七夕（农历七月初七），每年按农历重复', icon: 'ceremony', title: '七夕', needsDate: true, lunar: true, dateField: '第一次七夕' },
  { key: 'mid-autumn', label: '中秋', hint: '农历八月十五', icon: 'ceremony', title: '中秋节', lunar: true, month: 8, day: 15 },
  { key: 'spring-festival', label: '春节', hint: '农历正月初一', icon: 'ceremony', title: '春节', lunar: true, month: 1, day: 1 },
  { key: 'dragon-boat', label: '端午', hint: '农历五月初五', icon: 'ceremony', title: '端午节', lunar: true, month: 5, day: 5 },
  { key: 'lantern', label: '元宵', hint: '农历正月十五', icon: 'ceremony', title: '元宵节', lunar: true, month: 1, day: 15 },
  { key: 'national-day', label: '国庆节', hint: '10 月 1 日', icon: 'ceremony', title: '国庆节', month: 10, day: 1 },
  { key: 'new-year', label: '元旦', hint: '1 月 1 日', icon: 'ceremony', title: '元旦', month: 1, day: 1 },
  { key: 'gaokao', label: '高考', hint: '6 月 7 日', icon: 'ceremony', title: '高考', month: 6, day: 7 },
  { key: 'zhongkao', label: '中考', hint: '填当地中考日期', icon: 'ceremony', title: '中考', needsDate: true },
]

function nextSolar(month: number, day: number) {
  const now = new Date()
  let d = new Date(now.getFullYear(), month - 1, day, 9, 0, 0, 0)
  if (d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    d = new Date(now.getFullYear() + 1, month - 1, day, 9, 0, 0, 0)
  }
  return d
}

async function nextLunar(month: number, day: number) {
  const now = new Date()
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    try {
      const res = await convertLunarDate({ lunar_year: year, lunar_month: month, lunar_day: day })
      const d = res.data?.data
      if (!d) continue
      const when = new Date(d.year, d.month - 1, d.day, 9, 0, 0, 0)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (when.getTime() >= today.getTime()) return when
    } catch { /* 换下一年 */ }
  }
  return null
}

async function choosePreset(preset: (typeof PRESETS)[number]) {
  editingId.value = null
  if (preset.needsDate) {
    // 需要日期的：把表单填好让用户选日期（农历生日让他用农历选择器）。
    // **整表复位**再填 —— 否则会继承上一张卡片的配色/背景图/蒙板。
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    resetForm({
      title: preset.title,
      dueAt: toLocalIso(d),
      // 婚庆里程碑（银婚/金婚/钻石婚）是**一次性**倒计时（结婚 + N 年那天），不是每年重复
      repeat: preset.milestone ? 'none' : 'yearly',
      calendar: preset.lunar ? 'lunar' : 'solar',
      // 「第一次生日时间」/「结婚日期」/「第一次情人节」比干巴巴一个「日期」好懂
      dateField: preset.dateField || '日期',
    })
    milestoneYears.value = preset.milestone || 0
    presetOpen.value = false
    createOpen.value = true
    return
  }
  const when = preset.lunar && preset.month && preset.day
    ? await nextLunar(preset.month, preset.day)
    : preset.month && preset.day ? nextSolar(preset.month, preset.day) : null
  if (!when) {
    emit('toast', '算不出下一次日期，请手动新建', 'error')
    return
  }
  saving.value = true
  try {
    await createReminder({
      title: preset.title,
      kind: 'task',
      list_id: props.list.id,
      due_at: toLocalIso(when),
      repeat_rule: 'yearly',
      calendar: preset.lunar ? 'lunar' : 'solar',
      // 模板建出来的卡片不继承任何「上一张」的状态
      accent: '', background: '', bg_blur: 0, bg_mask: 45,
      channels: ['inapp'],
    })
    presetOpen.value = false
    await load()
    emit('changed')
    emit('toast', `已添加「${preset.title}」`)
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '添加失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* 卡片加高（用户要求）：倒计时独占最上面一行，所以卡片比原来高、信息也不会挤。
   2026-10-11 用户又说「倒计时还不够显眼，继续放大」——数字从 30px 提到 44px（手机 36px），
   底色更实、上下留白更多，整块成为卡片的视觉重心。 */
/* 底色由 cardStyle() 内联给（浅色随机 / 同色系浅淡版），这里只保证圆角、内边距与居中；
   不加 bg-* 类，免得把内联的渐变盖掉。深色主题下这些浅色只是很淡的一层，不刺眼。 */
.ceremony-card {
  @apply relative flex min-h-[11rem] flex-col items-stretch overflow-hidden rounded-[22px] p-5 text-center;
  /* 卡面本身的三层渐变由 cardStyle() 内联；这里只补两样东西：
     · 顶部一道 1px 内高光 + 一层贴地的投影，卡片像一张有厚度的纸；
     · hover 时轻轻抬起，鼠标扫过能感觉到它是「一张卡」。 */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .24),
    0 2px 6px rgba(15, 23, 42, .16),
    0 18px 40px -18px rgba(15, 23, 42, .55);
  transition: box-shadow .25s ease, transform .25s ease;
}
.ceremony-card:hover {
  transform: translateY(-2px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .3),
    0 4px 10px rgba(15, 23, 42, .2),
    0 30px 56px -20px rgba(15, 23, 42, .62);
}
/* 「渐变色蒙版」：一层很细的斜纹，被右上角的径向渐变吃掉边缘 ——
   卡面因此有了纸面/绸面的质感，而不是一整块纯色。
   用户自己传了背景图时关掉（那层质感交给图片和它的蒙板）。 */
.ceremony-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(118deg, rgba(255, 255, 255, .06) 0 1px, transparent 1px 12px);
  -webkit-mask-image: radial-gradient(125% 95% at 82% -6%, #000 0%, rgba(0, 0, 0, .55) 38%, transparent 68%);
  mask-image: radial-gradient(125% 95% at 82% -6%, #000 0%, rgba(0, 0, 0, .55) 38%, transparent 68%);
  opacity: .5;
}
.ceremony-card.has-image::before { content: none; }
/* 图标：从 36px 方框 / 22px 图标放大 2 倍 → 64px 方框 / 44px 图标（用户 2026-10-12） */
.ceremony-icon {
  @apply flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px];
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .14);
}
/* 内容整组（图标 + 文字）在卡片里居中，文字内部左对齐 */
.ceremony-body { @apply flex items-center justify-center gap-3.5; }
/* 编辑/删除挪到卡片右上角：内容不再被一排按钮压住，卡面更干净；
   手机上常显，桌面上半隐，指到卡片才完全亮起来。 */
.ceremony-actions { @apply flex items-center gap-0.5 opacity-70 transition-opacity; }
/* 注意：下面那条「卡片所有子元素 position: relative」的规则选择器更长，
   会把这里的 absolute 盖掉，所以定位要写一条更具体的选择器。 */
.ceremony-card > .ceremony-actions { position: absolute; top: .75rem; right: .75rem; }
.ceremony-card:hover .ceremony-actions, .ceremony-card:focus-within .ceremony-actions { @apply opacity-100; }
@media (hover: none) { .ceremony-actions { @apply opacity-100; } }
/* 名称 / 时间 / 次数都放大（用户 2026-10-12：「所有内容均放大」） */
.ceremony-title { @apply truncate text-[19px] font-extrabold leading-6 tracking-tight; }
.ceremony-date { @apply mt-1 space-y-1 text-[13.5px] font-semibold leading-5 text-muted-foreground; }
/* 年与月日分开：年始终不加底色；只有创建时选中的那种日历，给「月日 + 每年」套彩色药丸。
   未选中的日期整行透明，没有边框（用户 2026-10-26 要求）。 */
.ceremony-date-line { @apply flex flex-wrap items-baseline gap-1.5; }
.ceremony-date-year { @apply opacity-75; }
.ceremony-date-md { @apply inline-flex items-center gap-1; }
.ceremony-date-chip {
  @apply inline-flex items-center gap-1 rounded-full border px-2 py-0.5;
}
.ceremony-date-chip-solar { background: rgba(59, 130, 246, .24); border-color: rgba(96, 165, 250, .45); }
.ceremony-date-chip-lunar { background: rgba(245, 158, 11, .24); border-color: rgba(251, 191, 36, .48); }
/* 选中/创建时用的那种日历用高饱和实色，保证在深浅、彩色卡面上都一眼能认出来。 */
.ceremony-date-chip-solar.is-primary {
  background: linear-gradient(135deg, #1d4ed8, #3b82f6);
  border-color: #93c5fd;
  color: #fff;
  text-shadow: 0 1px 2px rgba(15, 23, 42, .28);
}
.ceremony-date-chip-lunar.is-primary {
  background: linear-gradient(135deg, #d97706, #fbbf24);
  border-color: #fde68a;
  color: #3b1d02;
}
.ceremony-extra { @apply mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-muted-foreground; }
/* 卡面上的小徽标（农历 / 每年 / 第 N 次）改成半透明药丸：比裸文字更像标签，
   又不会像实色块那样跳出来抢倒计时的视线。 */
.ceremony-card .tiny-badge {
  @apply rounded-full border px-2 py-0.5 text-[11.5px] font-bold;
  background: var(--ceremony-badge-bg, rgba(255, 255, 255, .16));
  border-color: var(--ceremony-badge-border, rgba(255, 255, 255, .22));
}
/* 次级文字与行内按钮一律用卡面配套的柔化字色（整卡都是一套渐变，见 cardStyle） */
.ceremony-date, .ceremony-extra, .ceremony-actions { color: var(--ceremony-ink-soft, currentColor); }
.ceremony-card .tiny-badge,
.ceremony-card .row-action { color: var(--ceremony-ink-soft, currentColor); }
/* 图标底盘：跟着卡面字色走的一层薄底（原来是固定的玫瑰色块，在彩色卡面上很跳） */
.ceremony-icon { background: var(--ceremony-chip, rgba(255,255,255,.18)); color: inherit; }
/* 倒计时：大字 + 底色，放在卡片最上面 */
/* 倒计时直接显示在大卡片里：没有自己的底色、圆角与边框（用户 2026-10-13 要求）。 */
.ceremony-hero { @apply flex items-baseline justify-center gap-1.5 text-center text-[18px] font-extrabold leading-none; }
/* 「还有 / 已过」与「天」用小一号的字、稍低的存在感，把视觉重心全部留给数字 */
.ceremony-lead, .ceremony-unit { @apply text-[15px] font-bold tracking-wide; opacity: .82; }
.ceremony-unit { letter-spacing: .12em; }
/* 数字「流光」：渐变字 + 背景位移动画，一道亮光从左到右扫过数字
   （和登录页/新建窗口的 .flow-frame 是同一套视觉语言）。
   prefers-reduced-motion 时停住动画、定在中点，只留静态的亮色数字。 */
.ceremony-hero b {
  @apply text-[44px] font-black leading-none tracking-tight sm:text-[52px];
  /* 彩色流光：靛蓝 → 紫 → 青 三段滚动（两端回到基色，整体色调仍贴着卡面字色） */
  background-image: linear-gradient(100deg,
    var(--ceremony-ink, #ffffff) 0%,
    var(--ceremony-flow-1, #a5b4fc) 22%,
    var(--ceremony-flow-2, #d8b4fe) 42%,
    var(--ceremony-flow-3, #67e8f9) 62%,
    var(--ceremony-flow-1, #a5b4fc) 80%,
    var(--ceremony-ink, #ffffff) 100%);
  background-size: 260% 100%;
  background-position: 50% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  /* 描边：-webkit-text-stroke 画在字形轮廓上，和渐变填充叠在一起 —— 深色卡面上
     数字就有一圈亮白边（用户 2026-10-13：「背景暗时看不清，增加白边」）。
     不支持这个属性的内核忽略它即可，不影响渐变字。 */
  position: relative;
  /* 内圈描边（用户 2026-10-13「白色边内侧加黑边衬托数字更清晰」）：直接画在
     <b> 自己身上，压住渐变字的边缘；它比外圈细，所以外圈那张白边会露在它外侧。
     从外到内 = 白边 → 黑边 → 彩色渐变。 */
  -webkit-text-stroke: .9px var(--ceremony-edge, rgba(2, 6, 23, .62));
  filter: drop-shadow(0 3px 10px rgba(2, 6, 23, .22));
  animation: ceremony-countdown-flow 3.6s linear infinite;
}
/* 外圈描边：同一串数字再叠一层放在 <b> 底下，只描边不填色（颜色交给上面的渐变）。
   宽度比内圈大一档，于是白边只露在黑边外侧那一圈。 */
.ceremony-hero b::before {
  content: attr(data-count);
  position: absolute;
  inset: 0;
  z-index: -1;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: none;
  -webkit-text-stroke: 1.6px var(--ceremony-stroke, rgba(255, 255, 255, .92));
}
@media (max-width: 640px) {
  .ceremony-hero b { -webkit-text-stroke-width: .95px; }
  .ceremony-hero b::before { -webkit-text-stroke-width: 1.55px; }
}
/* 兜底：老内核不支持 background-clip:text 时字会整个透明、等于看不见 —— 退回静态字色 */
@supports not ((background-clip: text) or (-webkit-background-clip: text)) {
  .ceremony-hero b {
    color: var(--ceremony-ink, inherit);
    -webkit-text-fill-color: var(--ceremony-ink, inherit);
    background-image: none;
    animation: none;
  }
  /* 不支持 background-clip:text 的内核上，外层伪元素只剩一圈描边、看着像空心字 */
  .ceremony-hero b::before { content: none; }
}
@keyframes ceremony-countdown-flow {
  0% { background-position: 130% 0; }
  100% { background-position: -130% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ceremony-hero b { animation: none; }
}
/* 倒计时与信息之间的横线（用户 2026-10-13）：
   1px、半透明、跟卡面字色同色系；上下留白由这里的 margin 控制，
   信息块自己的 mt-3 让位（见 .ceremony-body）。 */
.ceremony-divider {
  @apply my-3.5 block h-px w-full shrink-0 border-0;
  background: var(--ceremony-divider, rgba(255, 255, 255, .3));
  /* 两头淡出：不是一条硬邦邦的横杠，而是一道「呼吸」的分隔 */
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%);
}
/* 「快到了」/「已过」不再改底色（会盖掉卡面渐变），只加粗提示由字号承担 */
.ceremony-days-soon { @apply tracking-tight; }
.ceremony-days-past { @apply opacity-90; }
/* 背景图（用户 2026-10-13）：图片铺满整卡，上面压一层暗色蒙版保证白字可读；
   卡片自身的配色渐变仍在内联 style 里 —— 图片没加载出来/对端没有这个文件时就是它。 */
.ceremony-bg-fill { @apply pointer-events-none absolute inset-0; }
.ceremony-bg-img { @apply pointer-events-none absolute inset-0 h-full w-full object-cover; }
/* 蒙板层：颜色/浓度由 maskGradient() 内联给（可调「透明度」） */
.ceremony-bg-scrim { @apply pointer-events-none absolute inset-0; }
/* 虚化时放大一点：否则模糊会把卡片边缘也「吃掉」，四边透出底色 */
.ceremony-bg-img-blurred { transform: scale(1.08); }
.ceremony-card > .ceremony-bg-fill { position: absolute; inset: 0; }
.ceremony-card > *:not(.ceremony-bg-img):not(.ceremony-bg-scrim):not(.ceremony-bg-fill):not(.ceremony-actions) { position: relative; z-index: 1; }
.ceremony-actions { z-index: 2; }
/* 背景图选择器（预设主题图 + 纯色） */
.ceremony-bg-option { @apply flex flex-col items-center gap-1 overflow-hidden rounded-xl border border-border/70 bg-surface p-1 text-[10px] font-bold text-muted-foreground transition hover:border-brand-500/40; }
.ceremony-bg-option.selected { @apply border-brand-500 text-foreground ring-2 ring-brand-500/30; }
.ceremony-bg-thumb { @apply h-9 w-full rounded-md object-cover; }
.ceremony-bg-label { @apply max-w-full truncate; }
.ceremony-bg-none { @apply flex h-9 w-full items-center justify-center rounded-md bg-muted/60 text-[11px]; }
.accent-swatch { @apply flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent text-[12px] font-black text-white/95 shadow-sm transition hover:scale-105; }
.accent-swatch.selected { @apply border-foreground/60 ring-2 ring-brand-500/40; }
.ceremony-preset { @apply flex items-center gap-2.5 rounded-xl border border-border/70 bg-surface px-3 py-2 text-left transition hover:border-brand-500/40 hover:bg-muted/40; }
.field-label { @apply block text-[11px] font-bold text-muted-foreground; }
</style>
