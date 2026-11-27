<template>
  <!-- 打赏页面（用户 2026-11-27）：从「打赏页面」模板搬进应用，作为独立路由
       /admin/donate；全站只保留顶栏一个咖啡杯入口。
       收款码为 CyberZero 的真实微信/支付宝赞赏码（用户 2026-11-27 提供）。 -->
  <div class="mx-auto max-w-3xl pb-28 lg:pb-0" data-donate-page>
    <!-- 首屏：咖啡杯 + 说明 -->
    <section class="relative overflow-hidden rounded-[28px] border border-border/70 card-bg px-5 py-10 text-center shadow-card backdrop-blur-xl sm:px-8 sm:py-12">
      <div
        class="pointer-events-none absolute inset-x-0 -top-24 h-56 opacity-70"
        style="background: radial-gradient(60% 70% at 50% 20%, rgb(251 191 36 / 0.18), transparent 72%)"
        aria-hidden="true"
      ></div>

      <div class="relative">
        <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-amber-400/40 bg-gradient-to-br from-amber-100/80 via-amber-200/35 to-amber-500/10 shadow-[0_0_34px_rgba(251,191,36,0.2),inset_0_1px_0_rgba(255,255,255,0.55)] dark:from-amber-500/20 dark:via-amber-500/10 dark:to-transparent dark:shadow-[0_0_34px_rgba(251,191,36,0.14)]">
          <CoffeeCupGold :size="38" />
        </span>

        <p class="mt-4 font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">BUY ME A COFFEE</p>
        <h1 class="mt-2 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">请作者喝杯咖啡</h1>
        <p class="mx-auto mt-3 max-w-xl text-[13px] leading-7 text-muted-foreground sm:text-sm">
          工作序记一直免费、无广告，数据保存在你自己的设备上。如果它帮到了你，可以请作者喝杯咖啡；
          付不付费都不影响你继续使用全部功能。
        </p>

        <div class="mt-4 flex flex-wrap justify-center gap-2" aria-label="关于赞赏">
          <span class="rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">永久免费</span>
          <span class="rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">赞赏完全自愿</span>
          <span class="rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">无广告</span>
        </div>
      </div>
    </section>

    <!-- 收款方式：微信 / 支付宝（真实赞赏码，图片来自 assets/donate/） -->
    <section class="mt-4 grid gap-4 sm:mt-5 sm:grid-cols-2" aria-label="赞赏方式">
      <article
        v-for="method in methods"
        :key="method.id"
        class="flex min-w-0 flex-col rounded-[24px] border border-border/70 card-bg p-4 shadow-card backdrop-blur-xl"
        :data-donate-method="method.id"
      >
        <header class="flex items-center justify-between gap-2">
          <h2 class="text-base font-extrabold text-foreground">{{ method.title }}</h2>
          <span class="shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px]" :class="method.chipClass">{{ method.badge }}</span>
        </header>

        <div class="mx-auto mt-3 w-full max-w-[300px] overflow-hidden rounded-2xl border border-border/60 bg-white">
          <img :src="method.image" :alt="method.alt" class="block h-auto w-full" loading="eager" />
        </div>

        <p class="mt-3 text-center text-[13px] font-bold text-foreground">{{ method.tip }}</p>
        <p class="mt-0.5 text-center text-[11px] text-muted-foreground">{{ method.account }}</p>
      </article>
    </section>

    <!-- 支持说明 -->
    <section class="mt-4 rounded-[24px] border border-border/70 card-bg p-5 shadow-card backdrop-blur-xl sm:mt-5 sm:p-6">
      <h2 class="text-base font-extrabold text-foreground">一杯咖啡，一点支持</h2>
      <p class="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        从清单、日历到「提醒@他」和 AI 小秘，很多个晚上都花在了这个项目上。
      </p>

      <ul class="mt-4 grid gap-2.5">
        <li v-for="point in points" :key="point" class="relative pl-5 text-[13px] leading-5 text-muted-foreground">
          <span class="absolute left-0 top-0 font-bold text-emerald-500">✓</span>
          {{ point }}
        </li>
      </ul>

      <div class="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[.06] px-4 py-3">
        <p class="text-xs font-bold text-amber-600 dark:text-amber-300">感谢每一位支持者</p>
        <p class="mt-0.5 text-[12px] leading-5 text-muted-foreground">
          即使不赞赏，也欢迎反馈问题、把工作序记分享给需要的人。
        </p>
      </div>

      <p class="mt-3 text-[11px] text-muted-foreground/80">联系作者：<strong class="font-semibold text-foreground">CyberZero</strong></p>
    </section>

    <!-- 开源与赞赏说明（原项目出处与 MIT 许可是必须保留的） -->
    <section class="mt-4 rounded-[24px] border border-border/60 card-bg p-5 text-[12px] leading-6 text-muted-foreground shadow-card backdrop-blur-xl sm:mt-5 sm:p-6">
      <h2 class="text-sm font-extrabold text-foreground">关于开源与赞赏</h2>
      <p class="mt-2">
        工作序记基于
        <a class="font-semibold text-brand-600 hover:underline dark:text-brand-300" href="https://github.com/TechFunWay/reminders" target="_blank" rel="noreferrer">TechFunWay/reminders</a>
        衍生开发，依据 <strong class="font-semibold text-foreground">MIT</strong> 许可发布；原项目的著作权与出处均予保留。
        赞赏是自愿支持，不是授权费，也不会改变许可证赋予你的权利。
      </p>
      <p class="mt-2">感谢每一位使用、反馈、测试和请作者喝咖啡的朋友。</p>
      <p class="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground/70">
        工作序记 · WorkOrderNote · © 2026 CyberZero · MIT
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import CoffeeCupGold from '../components/CoffeeCupGold.vue'
import wechatQr from '../assets/donate/qr-wechat.jpg'
import alipayQr from '../assets/donate/qr-alipay.jpg'

// 收款方式：CyberZero 的真实赞赏码（微信 / 支付宝），图片在 assets/donate/ 下。
const methods = [
  {
    id: 'wechat',
    title: '微信赞赏',
    badge: '微信支付',
    chipClass: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    image: wechatQr,
    alt: 'CyberZero 的微信赞赏码',
    tip: '打开微信「扫一扫」，金额随意',
    account: '收款方：CyberZero（**辉）',
  },
  {
    id: 'alipay',
    title: '支付宝赞赏',
    badge: '支付宝',
    chipClass: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300',
    image: alipayQr,
    alt: 'CyberZero 的支付宝赞赏码',
    tip: '打开支付宝「扫一扫」，金额随意',
    account: '收款方：TOPZERO.W（**辉）',
  },
]

const points = [
  '全部功能免费开放，不设付费墙',
  '赞赏完全自愿，不影响使用与更新',
  '微信 / 支付宝任选，金额随意',
  '赞赏用于支持项目长期维护',
]
</script>
