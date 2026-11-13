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

  // ---------- SDK 身份（3.2 起鉴权统一走 SDK） ----------
  function sdk() { return cloud && cloud.auth ? cloud.auth : null }

  // 取当前 SDK 用户 id；未登录时平台返回 'anon'，这里统一当空
  async function currentUid() {
    const a = sdk()
    if (!a || !a.getSession) return ''
    try {
      const s = await a.getSession()
      const d = (s && s.data) || {}
      const u = d.user || (d.session && d.session.user) || null
      const id = u && (u.id || u.uid)
      return id && id !== 'anon' ? String(id) : ''
    } catch (e) {
      return ''
    }
  }

  const TOKEN_KEY = 'xfc_token'
  const THEME_KEY = 'xfc_theme'
  const ADMIN_TOKEN_KEY = 'xfc_admin_token'
  // 代登录来源页（含 query）：退出时回到发起前的界面，而不是固定回成员管理
  const IMP_FROM_KEY = 'xfc_imp_from'

  const store = Vue.reactive({
    booted: false,
    token: '',
    me: null,
    semester: null,
    settings: { max_plans: 4 },
    stats: { week_records: 0, total_records: 0, total_plans: 0 },
    counselorMap: {},
    isAdmin: false,
    impersonation: { active: false, name: '', userId: 0 },
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
    let res
    try {
      res = await cloud.database.rpc(name, body)
    } catch (e) {
      const msg = String((e && e.message) || '')
      if (e instanceof TypeError || /network|fetch failed|failed to fetch|connection|timeout/i.test(msg)) {
        window.dispatchEvent(new Event('xfc-network-failure'))
      }
      if (/unauthenticated|jwt|token|401|not signed in/i.test(msg)) {
        setToken('')
        store.me = null
        clearImpersonationState()
        if (store.route.name !== 'login') nav('/login')
      }
      throw e
    }
    if (res.error) {
      const msg = String(res.error.message || '')
      if (/登录已失效/.test(msg)) {
        setToken('')
        store.me = null
        clearImpersonationState()
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
    my_week: 20000, my_due: 20000, my_records: 20000,
    record_get: 20000, plan_get: 20000,
    photo_times: 300000, photo_list: 300000,
    class_stats: 60000, class_stats_week: 60000,
    admin_record_get: 30000,
    admin_plan_trash_list: 30000,
    staff_list: 120000, semester_list: 120000,
    admin_week_photos: 300000,
  }
  // 通用签名 URL（对象存储）
  async function signedUrl(path, ttl) {
    if (!path || !window.cloud || !window.cloud.storage || !window.cloud.storage.createSignedUrl) return ''
    try { return (await window.cloud.storage.createSignedUrl(path, ttl || 600)) || '' } catch (e) { return '' }
  }

  // 照片地址：新照片在文件存储（取签名 URL），老照片是 base64
  async function photoUrl(p, ttl) {
    if (p && p.storage_path) {
      const u = await signedUrl(p.storage_path, ttl)
      if (u) return u
    }
    return (p && (p.data || p.thumb)) || ''
  }

  // 缩略图地址：优先 thumb_path，其次原图路径，最后退回 base64
  async function thumbUrl(p, ttl) {
    if (!p) return ''
    if (p.thumb_path) { const u = await signedUrl(p.thumb_path, ttl); if (u) return u }
    if (p.storage_path) { const u = await signedUrl(p.storage_path, ttl); if (u) return u }
    return p.thumb || p.data || ''
  }

  // 批量给照片列表补缩略图地址（迁移后 thumb 为空但 thumb_path 有值）
  async function hydrateThumbs(list) {
    const arr = list || []
    for (const ph of arr) {
      if (!ph || ph.thumb) continue
      if (!ph.thumb_path && !ph.storage_path) continue
      ph.thumb = await thumbUrl(ph)
    }
    return arr
  }

  function rpcCached(name, params, ttlMs, skipToken) {
    const key = name + '|' + JSON.stringify(params || {})
    const hit = rpcCache.get(key)
    const ttl = ttlMs == null ? (CACHE_TTL[name] == null ? 60000 : CACHE_TTL[name]) : ttlMs
    if (hit && Date.now() - hit.t < ttl) {
      try { return Promise.resolve(JSON.parse(hit.json)) } catch (e) { rpcCache.delete(key) }
    }
    // skipToken：零参 RPC（如 app_plan_window）不附带 p_token，避免网关按参数名匹配失败
    return rpc(name, params, skipToken).then((v) => {
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
    else if (seg[0] === 'claim') name = 'claim'
    else if (seg[0] === 'forgot') name = 'forgot'
    else if (seg[0] === 'change') name = 'change'
    else if (seg[0] === 'me') name = 'me'
    else if (seg[0] === 'my-records') name = 'myRecords'
    else if (seg[0] === 'my-plans') name = 'myPlans'
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
      else if (seg[1] === 'trash') name = 'adminTrash'
      else if (seg[1] === 'coverage') name = 'adminCoverage'
      else if (seg[1] === 'semesters') name = 'adminSemesters'
      else if (seg[1] === 'export') name = 'adminExport'
      else if (seg[1] === 'photos') name = 'adminPhotos'
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
    let adminSaved = ''
    try { adminSaved = localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch (e) { /* 隐私模式 */ }
    if (saved) store.token = saved
    // 有自建 token，或浏览器里还留着 SDK 会话，都尝试恢复登录态
    const sdkUid = saved ? '' : await currentUid()
    if (saved || sdkUid) {
      try {
        await refresh()
        // 刷新时仍在切换状态：黄条要能恢复
        if (adminSaved && store.me) store.impersonation = { active: true, name: store.me.name || '', userId: store.me.id || 0 }
      } catch (e) {
        if (saved) setToken('')
      }
    }
    store.booted = true
  }

  function afterLogin(d) {
    setToken(d.token)
    clearRpcCache()
    return refresh().then(() => d)
  }

  // 邮箱 + 密码：SDK 先认证拿到身份，再换业务启动数据
  async function login(email, pwd) {
    const a = sdk()
    if (!a || !a.signInWithPassword) throw new Error('云端服务未就绪，请刷新页面')
    const r = await a.signInWithPassword({ email: String(email).trim(), password: pwd })
    if (r && r.error) throw r.error
    const d = await rpc('app_login', { p_name: String(email).trim(), p_password: pwd }, true)
    return afterLogin(d)
  }

  // ---------- 首次认领 ----------
  async function claimCheck(name, studentNo) {
    return rpc('app_claim_check', {
      p_name: name, p_student_no: studentNo,
    }, true)
  }

  async function claimSendOtp(email) {
    const a = sdk()
    if (!a || !a.sendOtp) throw new Error('云端服务未就绪，请刷新页面')
    const r = await a.sendOtp({ email: String(email).trim() })
    if (r && r.error) throw r.error
    return r.data || {}
  }

  async function claimBind(opts) {
    const a = sdk()
    if (!a) throw new Error('云端服务未就绪，请刷新页面')
    // 1) 验证码校验；新用户同时完成建号与设密
    const v = await a.verifyOtp({
      email: String(opts.email).trim(),
      verificationId: opts.verificationId,
      isExistingUser: !!opts.isExisting,
      token: opts.code,
      password: opts.isExisting ? undefined : opts.password,
    })
    if (v && v.error) throw v.error
    // 初次认领不校验「当前密码」：验证码通过即证明邮箱归属。
    // 邮箱此前已注册过云账号时（isExisting），verifyOtp 已直接建立该云账号的会话，
    // 沿用原密码登录；忘记原密码可到登录页用同一邮箱走「忘记密码」重置。
    const uid = await currentUid()
    if (!uid) throw new Error('邮箱验证已失效，请重新获取验证码')
    // 云端要求 p_new_password 至少 6 位才能写业务库 password_hash。
    // 邮箱已有云账号时前端不再收集密码，这里生成一次性占位值：
    // 邮箱登录只认 SDK 身份（app_login 在 sdk_uid 匹配时跳过该 hash），不影响登录。
    const pwd = String(opts.password || '').length >= 6
      ? opts.password
      : 'xfc-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4)
    const d = await rpc('app_claim_bind', {
      p_name: opts.name,
      p_student_no: opts.studentNo,
      p_email: String(opts.email).trim(),
      p_sdk_uid: uid,
      p_new_password: pwd,
    }, true).catch(async (e) => {
      // 邮箱属于已有云账号时，上面的 verifyOtp 已建立会话；绑定失败必须退出，避免留下别人的登录态
      if (opts.isExisting) { try { await a.signOut() } catch (e2) { /* ignore */ } }
      throw e
    })
    return afterLogin(d)
  }

  // ---------- 自助找回密码（3.3） ----------
  // 三步：发 PASSWORD_RESET 验证码 → 改云账号密码 → 同步业务库 hash
  // 第三步不能省：SDK 改的是它自己那份密码，业务库 password_hash 仍是旧的，
  // 用户能登录，但下次「我的 → 修改密码」会被旧 hash 挡成「原密码不正确」。
  async function resetSendOtp(email) {
    const a = sdk()
    if (!a || !a.resetPasswordForEmail) throw new Error('云端服务未就绪，请刷新页面')
    const r = await a.resetPasswordForEmail(String(email).trim())
    if (r && r.error) throw r.error
    return r.data || {}
  }

  async function resetCommit(email, handle, code, newPwd) {
    const a = sdk()
    if (!a) throw new Error('云端服务未就绪，请刷新页面')
    if (!handle || !handle.updateUser) throw new Error('请先点「获取验证码」')
    const v = await handle.updateUser({ nonce: String(code).trim(), password: newPwd })
    if (v && v.error) throw v.error

    try {
      await rpc('app_set_password_after_reset', { p_new_password: newPwd }, true)
    } catch (e) {
      const msg = String((e && e.message) || '')
      if (/账号状态异常/.test(msg)) {
        throw new Error('这个邮箱还没有绑定到账号，请改用「用姓名 + 学号认领」')
      }
      throw e
    }

    // SDK 此刻已认证，app_login 会跳过业务库密码校验，直接换业务 token
    const d = await rpc('app_login', {
      p_name: String(email).trim(), p_password: newPwd,
    }, true)
    return afterLogin(d)
  }

  // 公开配置仍供其他未登录页面使用。
  async function publicFlags() {
    try {
      return (await rpc('app_public_flags', {}, true)) || {}
    } catch (e) {
      return {}
    }
  }

  // 改密：SDK 侧先改，业务库再改；业务库失败就把 SDK 改回去
  async function changePassword(oldPwd, newPwd) {
    const a = sdk()
    const bound = !!(store.me && store.me.has_email)
    if (bound && oldPwd && a && a.resetPasswordForOld) {
      const r = await a.resetPasswordForOld({ oldPassword: oldPwd, newPassword: newPwd })
      if (r && r.error) throw r.error
    }
    try {
      await rpc('app_change_password', { p_old: oldPwd, p_new: newPwd })
    } catch (e) {
      if (bound && oldPwd && a && a.resetPasswordForOld) {
        try { await a.resetPasswordForOld({ oldPassword: newPwd, newPassword: oldPwd }) } catch (e2) { /* 回滚失败只能人工处理 */ }
      }
      throw e
    }
  }

  // 代登录来源只认管理端路由；/login、空 hash、成员端一律不记，交给兜底
  function currentAdminHash() {
    const raw = location.hash.replace(/^#/, '') || '/'
    return /^\/admin(\/|$)/.test(raw) ? raw : ''
  }
  // 统一清理：登出、登录失效、退出代登录都走这里，避免 xfc_admin_token 残留
  function clearImpersonationState() {
    try {
      sessionStorage.removeItem(IMP_FROM_KEY)
      localStorage.removeItem(ADMIN_TOKEN_KEY)
    } catch (e) { /* 隐私模式忽略 */ }
    store.impersonation = { active: false, name: '', userId: 0 }
  }

  // 管理员以成员身份登录（验收用）：保存自己的 token，切到成员会话
  async function impersonate(p_user_id) {
    const d = await rpc('admin_impersonate', { p_user_id })
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, store.token)
      // 发起前的界面（含 ?week= 等 query）；看板的周次/分组由视图自己存
      const from = currentAdminHash()
      if (from) sessionStorage.setItem(IMP_FROM_KEY, from)
      else sessionStorage.removeItem(IMP_FROM_KEY)
    } catch (e) { /* 隐私模式忽略 */ }
    setToken(d.token)
    clearRpcCache()
    store.impersonation = { active: true, name: d.name || '', userId: d.user_id || 0 }
    await refresh()
    nav('/')
    return d
  }

  async function stopImpersonation() {
    try { await rpc('admin_impersonate_stop') } catch (e) { /* 会话可能已过期 */ }
    let at = ''
    let from = ''
    try {
      at = localStorage.getItem(ADMIN_TOKEN_KEY) || ''
      from = sessionStorage.getItem(IMP_FROM_KEY) || ''
    } catch (e) { /* 隐私模式 */ }
    clearImpersonationState()
    if (!at) { setToken(''); nav('/login'); return }
    setToken(at)
    clearRpcCache()
    try { await refresh() } catch (e) { setToken(''); nav('/login'); return }
    nav(from || '/admin/members')
  }

  async function logout() {
    try { await rpc('app_logout') } catch (e) { /* ignore */ }
    try { if (cloud && cloud.auth && cloud.auth.signOut) await cloud.auth.signOut() } catch (e) { /* ignore */ }
    setToken('')
    clearRpcCache()
    store.me = null
    store.isAdmin = false
    clearImpersonationState()
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
    store, rpc, rpcCached, photoUrl, thumbUrl, signedUrl, hydrateThumbs, clearRpcCache, boot, refresh, login, logout,
    claimCheck, claimSendOtp, claimBind, changePassword, currentUid,
    resetSendOtp, resetCommit, publicFlags,
    impersonate, stopImpersonation, nav, syncRoute, setToken, weekNow, weekMax,
    applyTheme, toggleTheme,
  }
})()
