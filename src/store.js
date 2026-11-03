// 全局状态 + 路由 + 数据访问（自建账号体系：本地 token + 服务端校验）
(function () {
  const cfg = window.APP_CONFIG
  let cloud = null
  let initError = ''

  try {
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
      publishableKey: cfg.publishableKey,
    })
  } catch (e) {
    initError = '云端服务初始化失败，请刷新页面重试'
    console.error('[cloud] init failed', e && e.message)
  }
  window.cloud = cloud

  const TOKEN_KEY = 'xfc_token'
  const THEME_KEY = 'xfc_theme'

  const store = Vue.reactive({
    booted: false,
    token: '',
    me: null,
    semester: null,
    settings: { max_plans: 4 },
    stats: { week_records: 0, total_records: 0, total_plans: 0 },
    counselorMap: {},
    isAdmin: false,
    pendingResets: 0,
    theme: 'light',
    route: { name: 'login', params: {}, query: {} },
    initError,
  })

  function applyTheme(t, save) {
    const dark = t === 'dark'
    store.theme = dark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', store.theme)
    if (save !== false) {
      try { localStorage.setItem(THEME_KEY, store.theme) } catch (e) { /* 隐私模式忽略 */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? '#0e1014' : '#3056d3')
  }

  function initTheme() {
    let t = 'light'
    try { t = localStorage.getItem(THEME_KEY) || 'light' } catch (e) { /* 隐私模式忽略 */ }
    applyTheme(t, false)
  }

  function toggleTheme() {
    applyTheme(store.theme === 'dark' ? 'light' : 'dark')
  }

  initTheme()

  function setToken(t) {
    store.token = t || ''
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
      else localStorage.removeItem(TOKEN_KEY)
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function applyBoot(d) {
    if (!d) return
    store.me = d.me || null
    store.semester = d.semester || null
    store.settings = d.settings || store.settings
    store.stats = d.stats || store.stats
    store.counselorMap = d.counselor_map || store.counselorMap || {}
    store.isAdmin = !!(d.me && d.me.role === 'admin')
  }

  async function rpc(name, params, skipToken) {
    if (!cloud) throw new Error('云端服务未就绪，请刷新页面')
    const body = Object.assign({}, params || {})
    if (!skipToken) body.p_token = store.token
    const res = await cloud.database.rpc(name, body)
    if (res.error) {
      const msg = String(res.error.message || '')
      if (/登录已失效/.test(msg)) {
        setToken('')
        store.me = null
        if (store.route.name !== 'login') nav('/login')
      }
      throw res.error
    }
    return res.data
  }

  // ---------- 轻量读缓存：管理员端切页/切周时复用，减少云端请求 ----------
  const rpcCache = new Map()
  // 各读接口的默认缓存时长（毫秒）；成员端数据要求更实时，TTL 更短
  const CACHE_TTL = {
    my_week: 20000, my_due: 20000, my_records: 20000, my_history: 60000,
    record_get: 20000, plan_get: 20000, record_of_plan: 20000,
    photo_times: 300000, photo_list: 300000,
    class_stats: 60000, class_stats_week: 60000,
    admin_week: 60000, admin_plan_notes: 60000, admin_week_resubmits: 60000,
    admin_returned: 30000, admin_record_get: 30000,
    staff_list: 120000, semester_list: 120000, admin_user_classes: 120000,
    admin_week_photos: 300000,
  }
  function rpcCached(name, params, ttlMs) {
    const key = name + '|' + JSON.stringify(params || {})
    const hit = rpcCache.get(key)
    const ttl = ttlMs == null ? (CACHE_TTL[name] == null ? 60000 : CACHE_TTL[name]) : ttlMs
    if (hit && Date.now() - hit.t < ttl) {
      try { return Promise.resolve(JSON.parse(hit.json)) } catch (e) { rpcCache.delete(key) }
    }
    return rpc(name, params).then((v) => {
      try { rpcCache.set(key, { t: Date.now(), json: JSON.stringify(v) }) } catch (e) { /* 不可序列化则跳过缓存 */ }
      return v
    })
  }
  function clearRpcCache(prefix) {
    if (!prefix) { rpcCache.clear(); return }
    Array.from(rpcCache.keys()).forEach((k) => { if (k.indexOf(prefix) === 0) rpcCache.delete(k) })
  }

  // ---------- 路由 ----------
  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/'
    const qIndex = raw.indexOf('?')
    const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : ''
    const seg = path.split('/').filter(Boolean)
    const query = {}
    if (qs) new URLSearchParams(qs).forEach((v, k) => { query[k] = v })

    let name = 'home'
    const params = {}
    if (seg.length === 0) name = 'home'
    else if (seg[0] === 'login') name = 'login'
    else if (seg[0] === 'change') name = 'change'
    else if (seg[0] === 'me') name = 'me'
    else if (seg[0] === 'my-records') name = 'myRecords'
    else if (seg[0] === 'my-plans') name = 'myPlans'
    else if (seg[0] === 'my-returned') name = 'myReturned'
    else if (seg[0] === 'settings') name = 'settings'
    else if (seg[0] === 'class-stats') name = 'classStats'
    else if (seg[0] === 'plan') {
      name = 'planEdit'
      params.id = seg[1] === 'new' ? '' : (seg[1] || '')
    } else if (seg[0] === 'fill') {
      if (seg[1] === 'new') { name = 'fill'; params.extra = '1' }
      else { name = 'fill'; params.planId = seg[1] }
    } else if (seg[0] === 'record') {
      name = 'record'; params.id = seg[1]
    } else if (seg[0] === 'admin') {
      if (seg.length === 1) name = 'adminChecks'
      else if (seg[1] === 'checks') name = 'adminChecks'
      else if (seg[1] === 'plans') {
        if (seg[2]) { name = 'adminPlan'; params.id = seg[2] } else name = 'adminChecks'
      }
      else if (seg[1] === 'records') { name = seg[2] ? 'adminRecord' : 'adminChecks'; params.id = seg[2] }
      else if (seg[1] === 'members') name = 'adminMembers'
      else if (seg[1] === 'semesters') name = 'adminSemesters'
      else if (seg[1] === 'export') name = 'adminExport'
      else if (seg[1] === 'returned') name = 'adminReturned'
    }
    return { name, params, query }
  }

  function nav(path) {
    const target = path.startsWith('#') ? path : '#' + (path.startsWith('/') ? path : '/' + path)
    if (location.hash === target) store.route = parseHash()
    else location.hash = target
    window.scrollTo(0, 0)
  }

  function syncRoute() {
    store.route = parseHash()
    window.scrollTo(0, 0)
  }

  // ---------- 会话 ----------
  async function refresh() {
    applyBoot(await rpc('app_boot'))
  }

  async function boot() {
    const saved = (function () { try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } })()
    if (saved) {
      store.token = saved
      try { await refresh() } catch (e) { setToken('') }
    }
    store.booted = true
  }

  async function login(name, pwd) {
    const d = await rpc('app_login', { p_name: name, p_password: pwd }, true)
    setToken(d.token)
    clearRpcCache()
    await refresh()
    return d
  }

  async function logout() {
    try { await rpc('app_logout') } catch (e) { /* ignore */ }
    setToken('')
    clearRpcCache()
    store.me = null
    store.isAdmin = false
    nav('/login')
  }

  function weekNow() {
    if (!store.semester) return 0
    return U.weekNo(store.semester.start_monday, U.today())
  }

  function weekMax() {
    return store.semester ? store.semester.total_weeks : 18
  }

  window.Store = {
    store, rpc, rpcCached, clearRpcCache, boot, refresh, login, logout, nav, syncRoute, setToken, weekNow, weekMax,
    applyTheme, toggleTheme,
  }
})()
