import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getAllConfigs } from '../api/config'
import { isNarrowNow } from '../utils/use-narrow'
import { SK } from '../utils/storage-keys'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('../views/RegisterView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/forgot-password',
      name: 'ForgotPassword',
      component: () => import('../views/ForgotPasswordView.vue'),
      meta: { requiresAuth: false }
    },
    {
      // 后台路由统一前缀为 /admin，需要登录。
      path: '/admin',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        // 「首页」看板（用户 2026-10-13）：14 天待办 + 已逾期两列。**打开应用的默认页**，
        // 10 分钟不操作也回到这里（见 MainLayout 的空闲跳转）。
        { path: 'home', name: 'Dashboard', component: () => import('../views/HomeDashboardView.vue'), meta: { title: '首页' } },
        { path: '', name: 'Home', component: () => import('../views/HomeView.vue'), meta: { reminderView: 'today', title: '待办' } },
        { path: 'planned', name: 'Planned', component: () => import('../views/HomeView.vue'), meta: { reminderView: 'planned', title: '计划' } },
        { path: 'all', name: 'AllReminders', component: () => import('../views/HomeView.vue'), meta: { reminderView: 'all', title: '全部' } },
        { path: 'completed', name: 'Completed', component: () => import('../views/HomeView.vue'), meta: { reminderView: 'completed', title: '已完成' } },
        { path: 'trash', name: 'Trash', component: () => import('../views/TrashView.vue'), meta: { title: '垃圾箱' } },
        // 日历是与列表并列的另一种看法，顶栏的「列表 / 日历」开关在这里切换。
        { path: 'calendar', name: 'Calendar', component: () => import('../views/CalendarView.vue'), meta: { title: '日历' } },
        { path: 'list/:id', name: 'ReminderList', component: () => import('../views/HomeView.vue'), meta: { reminderView: 'all', title: '我的清单' } },
        // 「提醒@他」：多人之间互相推提醒（侧栏「我的清单」下的入口，开关是系统偏好 nudge_enabled）。
        // 「课程表」：每人一张或多张表，课程/课外活动分开标色；入口随个人偏好 timetable_enabled 显示。
        { path: 'timetable', name: 'Timetable', component: () => import('../views/TimetableView.vue'), meta: { title: '课程表' } },
        { path: 'nudges', name: 'Nudges', component: () => import('../views/NudgeView.vue'), meta: { title: '提醒@他' } },
        { path: 'notifications', name: 'Notifications', component: () => import('../views/NotificationsView.vue'), meta: { title: '通知中心' } },
        { path: 'channels', name: 'Channels', component: () => import('../views/ChannelsView.vue'), meta: { title: '通知方式' } },
        { path: 'profile', name: 'Profile', component: () => import('../views/ProfileView.vue') },
        { path: 'settings', name: 'Settings', component: () => import('../views/SettingsView.vue') },
        { path: 'users', name: 'AdminUsers', component: () => import('../views/AdminUsersView.vue'), meta: { requiresAdmin: true } },
        { path: 'configs', name: 'AdminConfigs', component: () => import('../views/AdminConfigView.vue'), meta: { requiresAdmin: true } },
        // Provider credentials belong to “通知方式”; retain old URLs as a safe redirect.
        { path: 'providers', redirect: '/admin/channels' },
        { path: 'audit', name: 'AdminAudit', component: () => import('../views/AdminAuditView.vue'), meta: { requiresAdmin: true } },
      ]
    },
    {
      // 后期 / 用于免登录的门户或前端页面，当前先重定向到后台首页。
      // 进「今天」还是「首页」看板由个人偏好 default_view 决定（见 MainLayout.applyDefaultViewOnce）。
      path: '/',
      redirect: '/admin',
      meta: { requiresAuth: false }
    },
    {
      // 兜底路由：飞牛远程地址的入口可能落在不带末尾斜杠的网关前缀上
      //（如 /app/workordernote），vue-router 剥离 base 后得到的
      // 路径匹配不到任何路由，router-view 会渲染成一片空白（手机端白屏）。
      // 一律送回首页，未登录时由全局守卫转入登录页。
      path: '/:pathMatch(.*)*',
      redirect: '/',
      meta: { requiresAuth: false }
    }
  ]
})

let initialViewChecked = false

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  await authStore.init()

  if (authStore.setupRequired && to.name !== 'Register') {
    // 首次安装默认走普通的用户名密码创建管理员流程，不做任何默认的飞牛
    // 授权；只有用户主动点击「使用飞牛 NAS 登录」并确认后，才进入飞牛绑定
    // 创建模式（注册页内会带上 fnos=bind 查询参数）。
    next({ name: 'Register' })
    return
  }

  // 手机上没有日历视图：入口已隐藏，直接输网址/书签进 /admin/calendar 也送回列表视图
  if (to.name === 'Calendar' && isNarrowNow()) {
    next({ path: '/admin' })
    return
  }

  // 「默认首页=日历」在首次进入 /admin 时就决定，不能只靠 MainLayout 的挂载时序：
  // 首页看板异步挂载时可能先读到旧状态，导致设置不同步。这里只检查一次，
  // 不影响之后用户手动点「待办」等导航。
  if (!initialViewChecked && authStore.isAuthenticated && to.name === 'Home' && !isNarrowNow()) {
    initialViewChecked = true
    try {
      const res = await getAllConfigs()
      if (String(res.data?.data?.default_view || 'home') === 'calendar') {
        next({ name: 'Calendar' })
        return
      }
    } catch {
      // 配置读不到就按首页看板继续；MainLayout 还有一次兜底。
    }
  }

  if (to.meta.requiresAuth !== false && !authStore.isAuthenticated && authStore.requireLogin) {
    next({ name: 'Login' })
  } else if ((to.name === 'Login' || to.name === 'Register' || to.name === 'ForgotPassword')
    && authStore.isAuthenticated && !hasFnOSFlow(to)) {
    // 已经登录了就别再摆登录页：旧客户端启动时固定打开 /login，不拦的话「记住我」
    // 明明勾着、token 也还在，用户每次仍要重输一遍密码。
    // 带飞牛授权参数的链接例外——那条路要继续走绑定/换账号流程。
    next({ path: '/admin' })
  } else if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next({ name: 'Home' })
  } else if (isNarrowNow() && to.name === 'Home' && !from.matched.length) {
    // 手机端「打开应用的第一页」固定是首页看板（用户 2026-11-17 再次要求
    // 「增加手机打开后的初始页面，默认显示首页」）。
    // 关键是在**守卫里**就改道：原来靠 MainLayout 挂载后 applyDefaultViewOnce
    // 再 replace，会先渲染出「待办」列表（实测约 130ms）再跳首页，看起来像
    // 默认页是待办。这里只在「冷启动的第一次导航」（from 为空）生效，
    // 之后用户点底栏「待办」不会被拽回首页。
    next({ name: 'Dashboard', replace: true })
  } else {
    next()
  }
})

/** 正在走飞牛授权的链接（带 fnos 参数，或刚拿到票据还没处理）不该被弹回工作台。 */
function hasFnOSFlow(to: RouteLocationNormalized): boolean {
  if (to.query.fnos || to.query.ticket) return true
  try {
    return !!sessionStorage.getItem(SK.fnosTicket)
  } catch {
    return false
  }
}

export default router
