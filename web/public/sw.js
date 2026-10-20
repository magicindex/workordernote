/**
 * 工作序记 Service Worker。
 *
 * 作用有两个：让浏览器把网页当成「可安装的应用」（PWA 安装要求有 manifest +
 * 一个带 fetch 处理的 Service Worker），以及弱网/离线时还能打开。
 *
 * 缓存策略按「文件名会不会变」分开，别一刀切：
 *   · /assets/**  —— Vite 产物带内容 hash，文件名一变就是新文件，缓存优先最安全也最快；
 *   · 页面导航   —— 网络优先，失败才回退缓存的 index.html（离线时至少能打开壳）；
 *   · 其它同源 GET（manifest、图标、fnos-entry.html…）—— **网络优先**：
 *     这些文件名字不变、内容会变，缓存优先会让升级后还一直拿旧版本
 *     （踩过：manifest 被缓存后，安装卡片认不出新的快捷入口）。
 *   · /api/** 与所有非 GET —— 一律不碰，直接走网络。
 */
const CACHE = 'workordernote-v2'
const PRECACHE = ['/index.html', '/manifest.webmanifest', '/favicon-192.png', '/favicon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // 预缓存失败不能挡住安装（某个文件暂时 404 时仍要能装）
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    await self.clients.claim()
  })())
})

async function networkFirst(req, fallback) {
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      const cache = await caches.open(CACHE)
      cache.put(req, res.clone()).catch(() => {})
    }
    return res
  } catch (err) {
    const cached = await caches.match(req)
    if (cached) return cached
    if (fallback) {
      const shell = await caches.match(fallback)
      if (shell) return shell
    }
    throw err
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res && res.ok) {
    const cache = await caches.open(CACHE)
    cache.put(req, res.clone()).catch(() => {})
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, '/index.html'))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
    return
  }
  // 其余静态文件：网络优先，拿不到再用缓存
  event.respondWith(networkFirst(req))
})
