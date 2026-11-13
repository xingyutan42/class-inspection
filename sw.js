// Service Worker：断网时仍能打开页面、继续填写
//
// 策略选择：**网络优先，失败回缓存**（不是缓存优先）
// 原因：这套系统发版频繁，缓存优先会让用户看到旧版本，而且极难排查。
// 网络优先保证有网时永远拿最新代码，只有断网才用缓存兜底。
//
// 不缓存的东西：
//   - 所有 RPC 请求（/rpc/*）：数据必须实时，缓存会造成"看到别人的数据"或"改了不生效"
//   - 跨域请求：不受本 SW 管理
//
// ⚠️ CACHE_NAME 必须随版本更新，否则旧缓存永远不会被清。
//    已接入 tests/bump.sh，发版时会自动改这一行。

const CACHE_NAME = 'xfc-3.9.0'

// 首屏必需资源（离线时要能完整打开应用）
const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './vendor/vue.global.prod.js',
  './vendor/workbuddy-cloud-sdk.js',
  './src/config.js',
  './src/lib/util.js',
  './src/lib/image.js',
  './src/lib/photocache.js',
  './src/lib/recordcache.js',
  './src/lib/draft.js',
  './src/lib/media.js',
  './src/lib/excel.js',
  './src/store.js',
  './src/views/auth.js',
  './src/views/member.js',
  './src/views/fill.js',
  './src/views/leader.js',
  './src/views/leader2.js',
  './src/views/stats.js',
  './src/app.js',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 单个文件失败不能让整个安装失败（比如某个文件临时 404）
      .then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try { url = new URL(req.url) } catch (e) { return }

  // 只管同源
  if (url.origin !== self.location.origin) return
  // 线上版本探测必须绕过 SW，否则整页来自旧缓存时会把旧版本误当线上版本
  if (url.searchParams.has('__xfc_version_probe')) return
  // RPC 一律走网络，不缓存（缓存会读到过期数据）
  if (url.pathname.indexOf('/rpc/') >= 0) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 只缓存成功的同源响应
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => null)
        }
        return res
      })
      .catch(() => {
        notifyOfflineFallback()
        // 断网：先按完整 URL 找（含 ?v=），再忽略查询参数找
        return caches.match(req).then((hit) => {
          if (hit) return markNavigationFallback(req, hit)
          return caches.match(req, { ignoreSearch: true }).then((hit2) => {
            if (hit2) return markNavigationFallback(req, hit2)
            // 页面请求兜底到 index.html（否则刷新会白屏）
            if (req.mode === 'navigate') {
              return caches.match('./index.html').then((page) => page ? markNavigationFallback(req, page) : null)
            }
            return new Response('', { status: 504, statusText: 'Offline' })
          })
        })
      })
  )
})

function notifyOfflineFallback() {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'xfc-offline-fallback' }))
  }).catch(() => {})
}

async function markNavigationFallback(req, response) {
  if (req.mode !== 'navigate' || !response) return response
  try {
    const html = await response.text()
    const marked = html.replace(/<html\b/i, '<html data-xfc-offline-fallback="1"')
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.set('content-type', 'text/html; charset=utf-8')
    headers.set('x-xfc-offline-fallback', '1')
    return new Response(marked, { status: response.status, statusText: response.statusText, headers })
  } catch (e) { return response }
}
