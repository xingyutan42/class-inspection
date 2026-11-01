// 登录 / 忘记密码 / 修改密码
window.Views = window.Views || {}

window.Views.LoginView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="auth-hero">
      <h1>学风建设</h1>
      <p>学院学风建设课堂检查小组 · 查课登记与统计</p>
    </div>

    <div class="auth-card">
      <div class="formerr" v-if="err">{{ err }}</div>

      <div class="field">
        <label class="label">姓名</label>
        <input class="input" v-model="name" placeholder="请输入你的姓名" autocomplete="username" @keyup.enter="doLogin">
      </div>
      <div class="field">
        <label class="label">密码</label>
        <input class="input" v-model="pwd" type="password" placeholder="请输入密码" autocomplete="current-password" @keyup.enter="doLogin">
      </div>

      <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="doLogin">
        {{ busy ? '登录中…' : '登录' }}
      </button>

      <div class="row between mt12">
        <span class="tiny muted">账号：姓名 · 初始密码为本人学号 · 首次登录须修改密码</span>
        <a class="link tiny" @click="goForgot">忘记密码？</a>
      </div>
    </div>

    <div class="center tiny muted mt16">仅限本小组组员使用</div>
  </div>`,

  data() { return { name: '', pwd: '', busy: false, err: '' } },
  methods: {
    goForgot() { Store.nav('/forgot') },
    async doLogin() {
      this.err = ''
      if (!this.name.trim()) { this.err = '请输入姓名'; return }
      if (!this.pwd) { this.err = '请输入密码'; return }
      this.busy = true
      try {
        const d = await Store.login(this.name.trim(), this.pwd)
        if (d.must_change) Store.nav('/change')
        else Store.nav(Store.store.isAdmin ? '/admin' : '/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}

window.Views.ForgotView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>忘记密码</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <p class="sm ink2" style="margin-top:0">提交后由管理员审核，通过后密码会重置为你的学号，登录后需立即修改。</p>

      <div class="formerr" v-if="err">{{ err }}</div>
      <div class="okbox" v-if="ok">{{ ok }}</div>

      <div class="field">
        <label class="label">姓名</label>
        <input class="input" v-model="name" placeholder="你的姓名">
      </div>
      <div class="field">
        <label class="label">学号</label>
        <input class="input" v-model="no" inputmode="numeric" placeholder="用于核对身份">
      </div>

      <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="submit">
        {{ busy ? '提交中…' : '提交重置申请' }}
      </button>
      <div class="center tiny muted mt12">管理员审核通过后，用「姓名 + 学号」重新登录</div>
    </div>
  </div>`,

  data() { return { name: '', no: '', busy: false, err: '', ok: '' } },
  methods: {
    back() { Store.nav('/login') },
    async submit() {
      this.err = ''
      this.ok = ''
      if (!this.name.trim()) { this.err = '请输入姓名'; return }
      if (!this.no.trim()) { this.err = '请输入学号'; return }
      this.busy = true
      try {
        const d = await Store.rpc('app_forgot_password', { p_name: this.name.trim(), p_student_no: this.no.trim() }, true)
        this.ok = d && d.already ? '你已经提交过申请，请耐心等待管理员审核。' : '申请已提交，请等待管理员审核。'
        this.name = ''
        this.no = ''
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}

window.Views.ChangePasswordView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" v-if="!forced" @click="back">‹</button></div>
      <h1>{{ forced ? '设置新密码' : '修改密码' }}</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12" v-if="forced">
      <div class="notice">
        <strong>首次登录需要修改密码</strong>
        <div class="tiny mt8">你的初始密码是本人学号。为了账号安全，请设置一个只有你知道的新密码（至少 8 位、需含字母）。设置后才能使用其他功能。</div>
      </div>
    </div>

    <div class="card mt12">
      <div class="formerr" v-if="err">{{ err }}</div>

      <div class="field" v-if="!forced">
        <label class="label">当前密码</label>
        <input class="input" v-model="oldPwd" type="password" placeholder="当前密码" autocomplete="current-password">
      </div>
      <div class="field">
        <label class="label">新密码</label>
        <input class="input" v-model="newPwd" type="password" placeholder="至少 8 位，需包含字母" autocomplete="new-password">
      </div>
      <div class="field">
        <label class="label">确认新密码</label>
        <input class="input" v-model="newPwd2" type="password" placeholder="再输一次" autocomplete="new-password" @keyup.enter="submit">
      </div>

      <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="submit">
        {{ busy ? '提交中…' : '确认修改' }}
      </button>

      <div class="center tiny muted mt12">
        <a class="link" @click="openForgot">忘记密码？</a>
        <span v-if="forced"> · <a class="link" @click="logout">退出登录</a></span>
      </div>
    </div>

    <div class="mask mask-center" v-if="showForgot">
      <div class="sheet sheet-center">
        <h3>忘记密码</h3>
        <div class="sub">提交后由管理员审核，通过后密码重置为学号</div>
        <div class="field" style="text-align:left">
          <label class="label">姓名</label>
          <input class="input" v-model="fName" maxlength="20" placeholder="填写姓名">
        </div>
        <div class="field" style="text-align:left">
          <label class="label">学号</label>
          <input class="input" v-model="fNo" maxlength="20" placeholder="填写学号">
        </div>
        <div class="formerr" v-if="fErr">{{ fErr }}</div>
        <div class="okbox" v-if="fOk">{{ fOk }}</div>
        <button class="btn btn-primary btn-block" :disabled="fBusy" @click="submitForgot">{{ fBusy ? '提交中…' : '提交申请' }}</button>
        <button class="btn btn-block mt8" @click="showForgot = false">关闭</button>
      </div>
    </div>
  </div>`,

  data() {
    return {
      oldPwd: '', newPwd: '', newPwd2: '', busy: false, err: '',
      showForgot: false, fName: '', fNo: '', fBusy: false, fErr: '', fOk: '',
    }
  },
  computed: {
    forced() { return !!(Store.store.me && Store.store.me.must_change) },
  },
  methods: {
    back() { Store.nav(Store.store.isAdmin ? '/me' : '/settings') },
    logout() { Store.logout() },
    openForgot() {
      this.fName = ''
      this.fNo = ''
      this.fErr = ''
      this.fOk = ''
      this.showForgot = true
    },
    async submitForgot() {
      this.fErr = ''
      this.fOk = ''
      if (!this.fName.trim() || !this.fNo.trim()) { this.fErr = '请填写姓名和学号'; return }
      this.fBusy = true
      try {
        const d = await Store.rpc('app_forgot_password', { p_name: this.fName.trim(), p_student_no: this.fNo.trim() })
        this.fOk = d && d.already ? '已经提交过了，请等待管理员审核' : '已提交，请等待管理员审核'
      } catch (e) {
        this.fErr = U.errText(e)
      } finally {
        this.fBusy = false
      }
    },
    async submit() {
      this.err = ''
      if (!this.forced && !this.oldPwd) { this.err = '请输入当前密码'; return }
      if (this.newPwd.length < 8) { this.err = '新密码至少 8 位'; return }
      if (!/[A-Za-z]/.test(this.newPwd)) { this.err = '新密码需要包含字母，不能是纯数字'; return }
      if (this.newPwd !== this.newPwd2) { this.err = '两次输入不一致'; return }
      this.busy = true
      try {
        await Store.rpc('app_change_password', { p_old: this.forced ? '' : this.oldPwd, p_new: this.newPwd })
        await Store.refresh()
        U.toast('密码已更新')
        Store.nav(Store.store.isAdmin ? '/admin' : '/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}
