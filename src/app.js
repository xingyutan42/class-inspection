// 应用外壳：路由守卫、底部导航
(function () {
  const store = Store.store

  const Root = {
    data() { return { store } },
    computed: {
      route() { return store.route },
      viewKey() {
        const r = store.route
        return [r.name, r.params.id || '', r.params.planId || '', r.params.recordId || '', r.query.week || ''].join('|')
      },
      view() {
        if (store.initError) return ''
        if (!store.booted) return ''
        const r = store.route.name
        if (!store.me) return r === 'forgot' ? 'forgot-view' : 'login-view'
        if (store.me.must_change && r !== 'change') return 'change-password-view'
        if (r === 'login' || r === 'forgot') return 'home-view'

        const map = {
          home: 'home-view', planEdit: 'plan-form-view', fill: 'fill-view',
          record: 'record-view', me: 'me-view', myRecords: 'my-records-view', change: 'change-password-view', settings: 'settings-view',
          classStats: 'class-stats-view',
          adminHome: 'admin-home', adminPlan: 'admin-plan-edit',
          adminRecord: 'admin-record', adminMembers: 'admin-members',
          adminSemesters: 'admin-semesters', adminExport: 'admin-export', adminResets: 'admin-resets',
        }
        const target = map[r] || 'home-view'
        if (r.indexOf('admin') === 0 && !store.isAdmin) return 'home-view'
        return target
      },
      tabs() {
        if (!store.isAdmin) return []
        return [
          { href: '#/admin', icon: 'chart', t: '总览', match: ['adminHome', 'adminRecord', 'adminPlan'] },
          { href: '#/me', icon: 'me', t: '我的', match: ['me', 'change', 'adminMembers'] },
        ]
      },
      showTabs() {
        if (!this.view) return false
        if (!store.me || store.me.must_change) return false
        // 成员端是单页面板，不使用底部导航
        if (!store.isAdmin) return false
        // 只有一级菜单常驻底部导航，二级页（成员管理/学期设置/导出/审核/记录详情）不显示
        return ['adminHome', 'adminRecord', 'adminPlan', 'me'].indexOf(store.route.name) >= 0
      },
    },
    mounted() {
      window.addEventListener('hashchange', () => {
        Store.syncRoute()
        this.afterRoute()
      })
      Store.syncRoute()
      Store.boot().then(() => {
        if (!location.hash) location.hash = '#/'
        Store.syncRoute()
        this.afterRoute()
      })
    },
    methods: {
      reload() { location.reload() },
      afterRoute() {
        const r = store.route.name
        if (store.me && store.me.must_change && r !== 'change') Store.nav('/change')
      },
    },
    template: `
    <div>
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
