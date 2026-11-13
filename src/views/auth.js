// 登录 / 首次认领 / 修改密码
// 登录统一使用邮箱；未绑定账号可通过姓名 + 学号认领邮箱。
window.Views = window.Views || {}

window.Views.LoginView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="auth-hero">
      <h1>学风建设</h1>
      <p>学院学风建设课堂检查小组 · 查课登记与统计</p>
    </div>

    <div class="auth-card">
      <div class="segtab"><button type="button" class="on">邮箱登录</button></div>

      <div class="formerr" v-if="err">{{ err }}</div>

      <!-- 登录只有邮箱通道：姓名登录已下线，未绑定账号走「认领」 -->
      <div class="field">
        <label class="label">邮箱</label>
        <input class="input" v-model="email" type="email" inputmode="email" placeholder="you@example.com"
               autocomplete="username" @keyup.enter="focusPwd">
      </div>
      <div class="field">
        <label class="label">密码</label>
        <input ref="pwdInput" class="input" v-model="pwd" type="password" placeholder="请输入密码"
               autocomplete="current-password" @keyup.enter="doLogin">
      </div>
      <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="doLogin">
        {{ busy ? '登录中…' : '登录' }}
      </button>
      <div class="center tiny muted mt12">
        还没绑定邮箱？<a class="link" @click="goClaim">用姓名 + 学号认领</a>
      </div>
      <div class="center tiny muted" style="margin-top:6px">
        <a class="link" @click="goForgot">忘记密码？</a>
      </div>

    </div>

    <div class="center tiny muted mt16">仅限本小组组员使用</div>
    <div class="center tiny muted" style="opacity:.7">v{{ version }}</div>
  </div>`,

  data() {
    return {
      email: '', pwd: '', busy: false, err: '',
      version: (window.APP_CONFIG && window.APP_CONFIG.version) || '',
    }
  },
  methods: {
    goClaim() { Store.nav('/claim') },
    goForgot() { Store.nav('/forgot') },
    // 邮箱框回车：先跳到密码框，不要直接提交
    focusPwd() {
      this.err = ''
      if (!this.email.trim()) { this.err = '请输入邮箱'; return }
      const el = this.$refs.pwdInput
      if (el && el.focus) el.focus()
    },
    async doLogin() {
      this.err = ''
      if (!this.email.trim()) { this.err = '请输入邮箱'; return }
      if (!this.pwd) { this.err = '请输入密码'; return }
      this.busy = true
      try {
        await Store.login(this.email.trim(), this.pwd)
        Store.nav(Store.store.isAdmin ? '/admin' : '/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}

window.Views.ClaimView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>认领账号</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="steps">
        <span :class="{on: step >= 1}">1 核对身份</span>
        <span :class="{on: step >= 2}">2 验证邮箱</span>
        <span :class="{on: step >= 3}">{{ isExisting ? '3 完成绑定' : '3 设置密码' }}</span>
      </div>

      <div class="formerr" v-if="err">{{ err }}</div>

      <template v-if="step === 1">
        <div class="field">
          <label class="label">姓名</label>
          <input class="input" v-model="name" placeholder="与名单一致的姓名" @keyup.enter="doCheck">
        </div>
        <div class="field">
          <label class="label">学号</label>
          <input class="input" v-model="studentNo" inputmode="numeric" placeholder="本人学号" @keyup.enter="doCheck">
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doCheck">{{ busy ? '核对中…' : '下一步' }}</button>
        <div class="center tiny muted mt12">姓名与学号需和成员名单一致</div>
      </template>

      <template v-else-if="step === 2">
        <div class="field">
          <label class="label">邮箱</label>
          <input class="input" v-model="email" type="email" inputmode="email" placeholder="接收验证码的邮箱">
        </div>
        <div class="field">
          <label class="label">验证码</label>
          <div class="row" style="gap:8px">
            <input class="input" v-model="code" inputmode="numeric" placeholder="6 位验证码" style="flex:1" @keyup.enter="next2">
            <button type="button" class="btn" :disabled="sending || countdown > 0" @click="sendCode">
              {{ countdown > 0 ? countdown + 's' : (sending ? '发送中…' : '获取验证码') }}
            </button>
          </div>
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="next2">下一步</button>
        <div class="center tiny muted mt12">没收到？看看垃圾邮件，或 60 秒后重发</div>
      </template>

      <template v-else>
        <template v-if="!isExisting">
          <div class="field">
            <label class="label">设置密码</label>
            <input class="input" v-model="pwd" type="password" placeholder="至少 6 位" autocomplete="new-password">
          </div>
          <div class="field">
            <label class="label">确认密码</label>
            <input class="input" v-model="pwd2" type="password" placeholder="再输一次" autocomplete="new-password" @keyup.enter="doBind">
          </div>
        </template>
        <div v-else class="muted tiny" style="line-height:1.7;padding:2px 0 10px">
          这个邮箱之前注册过账号，<b>不需要再设密码</b>，绑定后继续用该邮箱原来的密码登录。<br>
          想不起来原密码也没关系：绑定完成后到登录页点「忘记密码」，用这个邮箱收验证码重设即可。
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doBind">{{ busy ? '提交中…' : '完成认领' }}</button>
        <div class="center tiny muted mt12">{{ isExisting ? '绑定后请用该邮箱原有密码登录' : '之后请用邮箱 + 这个密码登录' }}</div>
      </template>
    </div>
  </div>`,

  data() {
    return {
      step: 1, name: '', studentNo: '', email: '', code: '', pwd: '', pwd2: '',
      verificationId: '', isExisting: false,
      busy: false, sending: false, countdown: 0, err: '', timer: null,
    }
  },
  beforeUnmount() { if (this.timer) clearInterval(this.timer) },
  methods: {
    back() {
      if (this.step > 1) { this.step -= 1; this.err = ''; return }
      Store.nav('/login')
    },
    async doCheck() {
      this.err = ''
      if (!this.name.trim()) { this.err = '请输入姓名'; return }
      if (!this.studentNo.trim()) { this.err = '请输入学号'; return }
      this.busy = true
      try {
        const r = await Store.claimCheck(this.name.trim(), this.studentNo.trim())
        if (!r || !r.ok) { this.err = (r && r.reason) || '姓名或学号不正确'; return }
        this.step = 2
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
    startCountdown() {
      this.countdown = 60
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => {
        this.countdown -= 1
        if (this.countdown <= 0) { clearInterval(this.timer); this.timer = null }
      }, 1000)
    },
    async sendCode() {
      this.err = ''
      const email = this.email.trim()
      if (!email || email.indexOf('@') < 0) { this.err = '请先填一个正确邮箱'; return }
      this.sending = true
      try {
        const r = await Store.claimSendOtp(email)
        this.verificationId = r.verificationId
        this.isExisting = !!r.isExistingUser
        this.startCountdown()
        U.toast('验证码已发送')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.sending = false
      }
    },
    next2() {
      this.err = ''
      if (!this.email.trim()) { this.err = '请输入邮箱'; return }
      if (!this.verificationId) { this.err = '请先点「获取验证码」'; return }
      if (String(this.code).trim().length < 4) { this.err = '请输入收到的验证码'; return }
      this.step = 3
    },
    async doBind() {
      this.err = ''
      // 只有新用户（邮箱未注册过云账号）才需要设密码；已有云账号沿用其原密码，不再要求输入
      if (!this.isExisting) {
        if (this.pwd.length < 6) { this.err = '密码至少 6 位'; return }
        if (this.pwd !== this.pwd2) { this.err = '两次输入不一致'; return }
      }
      this.busy = true
      try {
        await Store.claimBind({
          name: this.name.trim(),
          studentNo: this.studentNo.trim(),
          email: this.email.trim(),
          code: String(this.code).trim(),
          password: this.isExisting ? '' : this.pwd,
          verificationId: this.verificationId,
          isExisting: this.isExisting,
        })
        U.toast('认领成功')
        Store.nav(Store.store.isAdmin ? '/admin' : '/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}

// 3.3 自助找回密码：邮箱验证码 → 改 SDK 密码 → 同步业务库 → 自动登录
// 全程不需要旧密码，也不需要管理员。已绑定邮箱的账号忘记密码就走这里。
window.Views.ForgotView = {
  template: `
  <div class="shell" style="max-width:460px">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>重设密码</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="steps">
        <span :class="{on: step >= 1}">1 填邮箱</span>
        <span :class="{on: step >= 2}">2 验证码</span>
        <span :class="{on: step >= 3}">3 新密码</span>
      </div>

      <div class="formerr" v-if="err">{{ err }}</div>

      <template v-if="step === 1">
        <div class="field">
          <label class="label">账号邮箱</label>
          <input class="input" v-model="email" type="email" inputmode="email"
                 placeholder="当初认领时绑定的邮箱" autocomplete="username" @keyup.enter="sendCode">
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="sendCode">
          {{ busy ? '发送中…' : '获取验证码' }}
        </button>
        <div class="center tiny muted mt12">只给已绑定邮箱的账号用。没绑定过请返回，走「姓名 + 学号认领」</div>
      </template>

      <template v-else-if="step === 2">
        <div class="field">
          <label class="label">验证码</label>
          <div class="row" style="gap:8px">
            <input class="input" v-model="code" inputmode="numeric" placeholder="收到的验证码"
                   style="flex:1" @keyup.enter="next2">
            <button type="button" class="btn" :disabled="sending || countdown > 0" @click="resend">
              {{ countdown > 0 ? countdown + 's' : (sending ? '发送中…' : '重新发送') }}
            </button>
          </div>
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="next2">下一步</button>
        <div class="center tiny muted mt12">没收到？看看垃圾邮件，或 60 秒后重发</div>
      </template>

      <template v-else>
        <div class="field">
          <label class="label">新密码</label>
          <input class="input" v-model="pwd" type="password" placeholder="至少 8 位，需包含字母" autocomplete="new-password">
        </div>
        <div class="field">
          <label class="label">确认新密码</label>
          <input class="input" v-model="pwd2" type="password" placeholder="再输一次"
                 autocomplete="new-password" @keyup.enter="submit">
        </div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="submit">
          {{ busy ? '提交中…' : '完成并登录' }}
        </button>
        <div class="center tiny muted mt12">设好后直接登录，其他设备上的登录不受影响</div>
      </template>
    </div>
  </div>`,

  data() {
    return {
      step: 1, email: '', code: '', pwd: '', pwd2: '',
      busy: false, sending: false, countdown: 0, err: '', timer: null,
      // resetPasswordForEmail 返回的句柄，第二步要用它的 updateUser
      handle: null,
    }
  },
  beforeUnmount() { if (this.timer) clearInterval(this.timer) },
  methods: {
    back() {
      if (this.step > 1) { this.step -= 1; this.err = ''; return }
      Store.nav('/login')
    },
    startCountdown() {
      this.countdown = 60
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => {
        this.countdown -= 1
        if (this.countdown <= 0) { clearInterval(this.timer); this.timer = null }
      }, 1000)
    },
    async sendCode() {
      this.err = ''
      const email = this.email.trim()
      if (!email || email.indexOf('@') < 0) { this.err = '请填一个正确的邮箱'; return }
      this.busy = true
      try {
        this.handle = await Store.resetSendOtp(email)
        this.step = 2
        this.startCountdown()
        U.toast('验证码已发送')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
    async resend() {
      this.err = ''
      this.sending = true
      try {
        this.handle = await Store.resetSendOtp(this.email.trim())
        this.startCountdown()
        U.toast('验证码已重发')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.sending = false
      }
    },
    next2() {
      this.err = ''
      if (String(this.code).trim().length < 4) { this.err = '请输入收到的验证码'; return }
      this.step = 3
    },
    async submit() {
      this.err = ''
      if (this.pwd.length < 8) { this.err = '新密码至少 8 位'; return }
      if (!/[A-Za-z]/.test(this.pwd)) { this.err = '新密码需要包含字母，不能是纯数字'; return }
      if (this.pwd !== this.pwd2) { this.err = '两次输入不一致'; return }
      this.busy = true
      try {
        await Store.resetCommit(this.email.trim(), this.handle, this.code, this.pwd)
        U.toast('密码已重设')
        Store.nav(Store.store.isAdmin ? '/admin' : '/')
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
        <strong>建议修改初始密码</strong>
        <div class="tiny mt8">你的初始密码是本人学号，别人也可能猜到。建议设置一个只有你知道的密码（至少 8 位、需含字母）。不修改也能正常使用，之后随时可以在「我的 → 设置」里改。</div>
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

      <div class="center tiny muted mt12" v-if="forced">
        <a class="link" @click="logout">退出登录</a>
      </div>
    </div>

  </div>`,

  data() {
    return {
      oldPwd: '', newPwd: '', newPwd2: '', busy: false, err: '',
    }
  },
  computed: {
    forced() { return !!(Store.store.me && Store.store.me.must_change) },
  },
  methods: {
    back() { Store.nav(Store.store.isAdmin ? '/me' : '/settings') },
    logout() { Store.logout() },
    async submit() {
      this.err = ''
      if (!this.forced && !this.oldPwd) { this.err = '请输入当前密码'; return }
      if (this.newPwd.length < 8) { this.err = '新密码至少 8 位'; return }
      if (!/[A-Za-z]/.test(this.newPwd)) { this.err = '新密码需要包含字母，不能是纯数字'; return }
      if (this.newPwd !== this.newPwd2) { this.err = '两次输入不一致'; return }
      this.busy = true
      try {
        await Store.changePassword(this.forced ? '' : this.oldPwd, this.newPwd)
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
