// 共享脚本：深色模式切换 + 真实后端登录（与主项目共用同一云端服务）
(function () {
  var THEME_KEY = 'demo_theme'
  var TOKEN_KEY = 'site_token'

  // ---------- 云端 ----------
  var cloud = null
  var initError = ''
  var cfg = window.APP_CONFIG || {}

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

  function errText(e) {
    if (!e) return '操作失败，请重试'
    var code = e.code || e.kind
    var msg = String(e.message || e.error_description || '')
    if (/permission denied/i.test(msg)) return '没有权限执行此操作'
    if (/row-level security|violates row-level/i.test(msg)) return '这条数据不属于你，或已被锁定'
    if (/登录已失效/.test(msg)) return '登录已失效，请重新登录'
    if (/JWT|access token|refresh token|Bearer|unauthori[sz]ed|not signed in/i.test(msg)) return '登录已失效，请重新登录'
    if (/Could not find the function/i.test(msg)) return '接口暂时不可用，请刷新页面后重试'
    if (code === '23505') return '这条记录已经存在了'
    if (code === '23514') return '数据不符合要求，请检查填写内容'
    if (code === '42501') return '没有权限执行此操作'
    if (code === 'P0001') return e.message || '操作失败'
    if (code === 'network') return '网络不稳定，请稍后重试'
    if (code === 'unauthenticated' || code === 'invalid_grant') return '登录已失效，请重新登录'
    return msg || '操作失败，请重试'
  }

  // ---------- 会话 ----------
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
      else localStorage.removeItem(TOKEN_KEY)
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function rpc(name, params, skipToken) {
    if (!cloud) return Promise.reject(new Error(initError || '云端服务未就绪，请刷新页面'))
    var body = Object.assign({}, params || {})
    if (!skipToken) body.p_token = getToken()
    return cloud.database.rpc(name, body).then(function (res) {
      if (res.error) {
        var msg = String(res.error.message || '')
        if (/登录已失效/.test(msg)) setToken('')
        throw res.error
      }
      return res.data
    })
  }

  // 登录：成功后保存 token
  function login(name, pwd) {
    return rpc('app_login', { p_name: name, p_password: pwd }, true).then(function (d) {
      setToken(d.token)
      return d
    })
  }

  // 登出：清除本地 token
  function logout() {
    return rpc('app_logout').catch(function () { /* 忽略 */ }).then(function () {
      setToken('')
    })
  }

  // 会话校验：返回 boot 数据（me / stats 等），失败时清 token 并抛错
  function boot() {
    return rpc('app_boot').catch(function (e) {
      setToken('')
      throw e
    })
  }

  // ---------- 深色模式 ----------
  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
  }

  function applyTheme() {
    try {
      if (localStorage.getItem(THEME_KEY) === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    } catch (e) {}
    // 同步所有主题按钮的图标（月亮 / 太阳）
    var dark = isDark()
    var btns = document.querySelectorAll('[data-theme-toggle]')
    for (var i = 0; i < btns.length; i++) {
      var moon = btns[i].querySelector('.ic-moon')
      var sun = btns[i].querySelector('.ic-sun')
      if (moon) moon.style.display = dark ? 'none' : 'block'
      if (sun) sun.style.display = dark ? 'block' : 'none'
    }
  }

  function toggleTheme() {
    try {
      localStorage.setItem(THEME_KEY, isDark() ? 'light' : 'dark')
    } catch (e) {}
    applyTheme()
  }

  window.App = {
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    login: login,
    logout: logout,
    boot: boot,

    getToken: getToken,
    errText: errText,
  }

  // 页面加载完成后应用主题（配合 head 中的首屏防闪脚本）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme)
  } else {
    applyTheme()
  }
})()
