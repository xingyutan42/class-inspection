// 应用外壳：路由守卫、底部导航
(function () {
  const store = Store.store

  // 建议改密提示：本次会话内可关闭，下次打开再提醒一次；不阻断任何功能
  const PW_HINT_KEY = 'xfc_pw_hint_off'
  function pwHintOff() {
    try { return sessionStorage.getItem(PW_HINT_KEY) === '1' } catch (e) { return false }
  }

  const Root = {
    data() { return { store, pwOff: pwHintOff(), netStatus: '', onlineVersion: '', checkingVersion: false } },
    computed: {
      route() { return store.route },
      viewKey() {
        const r = store.route
        return [r.name, r.params.id || '', r.params.planId || '', r.query.week || ''].join('|')
      },
      view() {
        if (store.initError) return ''
        if (!store.booted) return ''
        const r = store.route.name
        if (!store.me) {
          if (r === 'claim') return 'claim-view'
          if (r === 'forgot') return 'forgot-view'
          return 'login-view'
        }
        if (r === 'login') return 'home-view'

        const map = {
          home: 'home-view', planEdit: 'plan-form-view', fill: 'fill-view',
          record: 'record-view', me: 'me-view', myRecords: 'my-records-view', change: 'change-password-view', settings: 'settings-view',
          classStats: 'class-stats-view', myPlans: 'my-plans-view',
          adminHome: 'admin-home', adminChecks: 'admin-checks', adminPlan: 'admin-plan-edit',
          adminRecord: 'admin-record', adminMembers: 'admin-members',
          adminTrash: 'admin-trash',
          adminCoverage: 'admin-coverage',
          adminSemesters: 'admin-semesters', adminExport: 'admin-export', adminPhotos: 'photo-migrate',
        }
        const target = map[r] || 'home-view'
        if (r.indexOf('admin') === 0 && !store.isAdmin) return 'home-view'
        return target
      },
      showPwHint() {
        return !!(store.me && store.me.must_change && !this.pwOff)
      },
      tabs() {
        if (!store.isAdmin) return []
        return [
          { href: '#/admin/checks', icon: 'list', t: '课检', match: ['adminChecks', 'adminHome', 'adminRecord', 'adminPlan'] },
          { href: '#/me', icon: 'me', t: '我的', match: ['me', 'change', 'adminMembers'] },
        ]
      },
      showTabs() {
        if (!this.view) return false
        if (!store.me) return false
        // 成员端是单页面板，不使用底部导航
        if (!store.isAdmin) return false
        // 只有一级菜单常驻底部导航，二级页（成员管理/学期设置/导出/记录详情）不显示
        return ['adminHome', 'adminChecks', 'me'].indexOf(store.route.name) >= 0
      },
    },
    watch: {
      'store.impersonation.active': {
        immediate: true,
        handler(v) { document.body.classList.toggle('imp-on', !!v) },
      },
      showPwHint: {
        immediate: true,
        handler(v) { document.body.classList.toggle('pw-on', !!v) },
      },
    },
    mounted() {
      this._onOffline = () => { this.netStatus = 'offline'; this.syncStatusClasses() }
      this._onOnline = () => { this.checkOnlineVersion() }
      this._onNetworkFailure = () => { this.netStatus = 'offline'; this.syncStatusClasses() }
      this._onSwMessage = (event) => {
        if (event.data && event.data.type === 'xfc-offline-fallback') {
          this.netStatus = 'offline'
          this.syncStatusClasses()
        }
      }
      window.addEventListener('offline', this._onOffline)
      window.addEventListener('online', this._onOnline)
      window.addEventListener('xfc-network-failure', this._onNetworkFailure)
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', this._onSwMessage)
      if (document.documentElement.getAttribute('data-xfc-offline-fallback') === '1' || !navigator.onLine) {
        this.netStatus = 'offline'
        this.syncStatusClasses()
      }
      this.checkOnlineVersion()
      this._versionRetryTimer = window.setInterval(() => {
        if (this.netStatus === 'offline' && navigator.onLine) this.checkOnlineVersion()
      }, 30000)
      window.addEventListener('hashchange', () => {
        Store.syncRoute()
      })
      Store.syncRoute()
      Store.boot().then(() => {
        if (!location.hash) location.hash = '#/'
        Store.syncRoute()
      })
    },
    methods: {
      reload() { location.reload() },
      syncStatusClasses() {
        document.body.classList.toggle('net-on', !!this.netStatus)
      },
      async checkOnlineVersion() {
        if (!navigator.onLine || this.checkingVersion) return
        this.checkingVersion = true
        try {
          const url = 'src/config.js?__xfc_version_probe=' + Date.now()
          const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
          if (!res.ok) throw new Error('version probe failed')
          const source = await res.text()
          const match = source.match(/version:\s*'([^']+)'/)
          const current = window.APP_CONFIG && window.APP_CONFIG.version
          if (!match || !current) throw new Error('version unavailable')
          this.onlineVersion = match[1]
          this.netStatus = match[1] !== current ? 'update' : (navigator.onLine ? '' : 'offline')
          this.syncStatusClasses()
        } catch (e) {
          this.netStatus = 'offline'
          this.syncStatusClasses()
        } finally {
          this.checkingVersion = false
        }
      },
      async refreshLatest() {
        if (['fill', 'planEdit'].includes(store.route.name)) {
          const ok = window.confirm('刷新前会先保存当前填写内容到本机草稿。继续刷新吗？')
          if (!ok) return
          const save = window.__xfcSaveDraftBeforeRefresh
          if (typeof save === 'function') {
            const saved = await save()
            if (saved === false) {
              U.toast('草稿保存失败，已取消刷新', 'bad')
              return
            }
          }
        }
        location.reload()
      },
      stopImp() { Store.stopImpersonation() },
      goChange() { Store.nav('/change') },
      dismissPw() {
        this.pwOff = true
        try { sessionStorage.setItem(PW_HINT_KEY, '1') } catch (e) { /* 隐私模式忽略 */ }
      },
    },
    template: `
    <div>
      <div v-if="netStatus" class="net-bar" :class="netStatus" role="status" aria-live="polite">
        <span v-if="netStatus === 'update'">发现新版本，刷新后生效</span>
        <span v-else>网络不可用，当前页面可能来自缓存；提交和数据更新需要联网。</span>
        <button v-if="netStatus === 'update'" class="net-action" @click="refreshLatest">立即刷新</button>
      </div>
      <div v-if="store.impersonation && store.impersonation.active" class="imp-bar">
        <span>管理员模式 · 以 <b>{{ store.impersonation.name }}</b> 的身份操作</span>
        <button class="imp-exit" @click="stopImp">退出</button>
      </div>
      <div v-if="showPwHint" class="pwbar">
        <span class="pwbar-t">密码还是初始学号，建议改一下</span>
        <span class="pwbar-a">
          <button class="pwbar-go" @click="goChange">去修改</button>
          <button class="pwbar-x" @click="dismissPw">稍后</button>
        </span>
      </div>
      <div v-if="store.initError" class="shell">
        <div class="empty" style="padding-top:100px">
          <div class="big">⚠</div>
          {{ store.initError }}
          <div class="mt12"><button class="btn" @click="reload">刷新页面</button></div>
        </div>
      </div>

      <div v-else-if="!store.booted" class="shell">
        <div class="empty" style="padding-top:120px">正在加载…</div>
      </div>

      <component v-else :is="view" :key="viewKey"></component>

      <nav class="tabbar" :class="{ narrow: !store.isAdmin }" v-if="showTabs">
        <a v-for="t in tabs" :key="t.href" :href="t.href"
           :class="{on: t.match.indexOf(store.route.name) >= 0}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <template v-if="t.icon === 'home'">
              <path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.6V20.6h12.8V9.6"/>
            </template>
            <template v-else-if="t.icon === 'list'">
              <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/>
              <circle cx="3.8" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="3.8" cy="12" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="3.8" cy="17.5" r="1.2" fill="currentColor" stroke="none"/>
            </template>
            <template v-else-if="t.icon === 'users'">
              <circle cx="9.2" cy="8" r="3.3"/>
              <path d="M2.9 20.2c0-3.4 2.8-5.6 6.3-5.6s6.3 2.2 6.3 5.6"/>
              <path d="M17.2 5.4a3.1 3.1 0 0 1 0 5.9"/>
              <path d="M18.6 14.9c1.9.8 3.1 2.4 3.1 4.3"/>
            </template>
            <template v-else-if="t.icon === 'me'">
              <circle cx="12" cy="8.2" r="3.6"/>
              <path d="M4.6 20.4c0-3.9 3.3-6.1 7.4-6.1s7.4 2.2 7.4 6.1"/>
            </template>
            <template v-else>
              <path d="M3.5 20.5h17"/><path d="M6.5 20.5v-6.2"/><path d="M12 20.5V4.5"/><path d="M17.5 20.5v-9.4"/>
            </template>
          </svg>
          <span>{{ t.t }}</span>
        </a>
      </nav>
    </div>`,
  }

  const app = Vue.createApp(Root)

  Object.keys(window.Views).forEach((name) => {
    const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    app.component(kebab, window.Views[name])
  })

  app.config.errorHandler = function (err) {
    console.error('[app]', err)
    U.toast((err && err.message) || '页面出错，请刷新重试', 'bad')
  }

  app.mount('#app')
})()

// Service Worker：断网时仍能打开页面（只接管静态资源，RPC 照常走网络）
// 只在 https 或 localhost 生效；注册失败不影响正常使用，所以静默处理。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 不支持或被隐私设置禁用 */ })
  })
}
