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
    store.pendingResets = d.pending_resets || 0
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
    else if (seg[0] === 'forgot') name = 'forgot'
    else if (seg[0] === 'change') name = 'change'
    else if (seg[0] === 'me') name = 'me'
    else if (seg[0] === 'my-records') name = 'myRecords'
    else if (seg[0] === 'settings') name = 'settings'
    else if (seg[0] === 'class-stats') name = 'classStats'
    else if (seg[0] === 'plan') {
      name = 'planEdit'
      params.id = seg[1] === 'new' ? '' : (seg[1] || '')
    } else if (seg[0] === 'fill') {
      if (seg[1] === 'edit') { name = 'fill'; params.recordId = seg[2] }
      else if (seg[1] === 'new') { name = 'fill'; params.extra = '1' }
      else { name = 'fill'; params.planId = seg[1] }
    } else if (seg[0] === 'record') {
      name = 'record'; params.id = seg[1]
    } else if (seg[0] === 'admin') {
      if (seg.length === 1) name = 'adminHome'
      else if (seg[1] === 'plans') {
        if (seg[2]) { name = 'adminPlan'; params.id = seg[2] } else name = 'adminHome'
      }
      else if (seg[1] === 'records') { name = seg[2] ? 'adminRecord' : 'adminHome'; params.id = seg[2] }
      else if (seg[1] === 'members') name = 'adminMembers'
      else if (seg[1] === 'semesters') name = 'adminSemesters'
      else if (seg[1] === 'export') name = 'adminExport'
      else if (seg[1] === 'resets') name = 'adminResets'
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
    await refresh()
    return d
  }

  async function logout() {
    try { await rpc('app_logout') } catch (e) { /* ignore */ }
    setToken('')
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
    store, rpc, boot, refresh, login, logout, nav, syncRoute, setToken, weekNow, weekMax,
    applyTheme, toggleTheme,
  }
})()
