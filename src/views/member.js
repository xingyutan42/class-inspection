// 组员端：本周 / 计划
window.Views = window.Views || {}

function weekRangeText(w) {
  const s = Store.store.semester
  if (!s || !w) return ''
  const st = U.weekStartOf(s.start_monday, w)
  return U.md(st) + ' — ' + U.md(U.addDays(st, 6))
}

const TAGS = ['说话', '吃东西', '后排聚集', '随意进出', '其他']

window.Views.HomeView = {
  template: `
  <div class="hm">
    <section class="hm-info">
      <div class="grow">
        <div class="hm-info-name">{{ me.name }} <span class="hm-info-no">{{ me.student_no }}</span></div>
        <div class="hm-info-sub">{{ todayText }} · {{ semName }} · 第 {{ week }} 周</div>
        <div class="hm-info-cls" v-if="me.own_class || me.duty_classes">
          <div v-if="me.own_class">
            <span class="k">我的班级</span><b>{{ me.own_class }}</b>
          </div>
          <div v-if="me.duty_classes">
            <span class="k">负责班级</span><b>{{ me.duty_classes }}</b>
            <span class="g" v-if="me.duty_grade">（{{ me.duty_grade }}）</span>
          </div>
        </div>
      </div>
    </section>

    <button class="admin-entry" v-if="isAdmin" @click="goAdmin">
      <span class="admin-entry-ic">⚙</span>
      <span class="admin-entry-main">
        <span class="admin-entry-t">管理后台</span>
        <span class="admin-entry-s">总览 · 明细 · 成员 · 导出</span>
      </span>
      <span class="admin-entry-go">›</span>
    </button>

    <section class="card hm-panel" v-if="!isAdmin">
      <div class="hd"><h2>查课</h2><span class="tiny link" @click="goStats">班级次数 ›</span></div>
      <div v-if="loading"><div class="empty">加载中…</div></div>
      <template v-else>
        <div class="hm-count" v-if="due.length"><b>{{ due.length }}</b><span>节待查</span></div>
        <ul class="hm-list" v-if="due.length">
          <li v-for="p in due" :key="p.id" class="hm-item" @click="fill(p)">
            <div class="hm-item-main">
              <div class="hm-item-t">{{ p.course_name }} <span class="badge badge-bad" v-if="overdue(p)">已过期</span><span class="badge badge-bad" v-if="p.note">打回</span></div>
              <div class="hm-item-s">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}</div>
              <div class="mt8">
                <span class="ibox" :class="classOn(c) ? 'ibox-bad' : ''" v-for="(c, ci) in classParts(p)" :key="c + ci">{{ c }}</span>
                <span class="ibox ibox-pri" v-if="p.room">教室 {{ p.room }}</span>
                <span class="ibox ibox-warn">预计到岗 {{ U.arriveText(p.arrive_before) || '—' }}</span>
              </div>
            </div>
            <span class="hm-go">查课</span>
          </li>
        </ul>
        <div class="empty" v-else>最近没有待查的课</div>

        <div class="hm-sub" v-if="history.length">
          <div class="row between">
            <div class="hm-sub-t">本周已查 {{ historyTotal }} 条</div>
            <span class="tiny link" @click="goMyRecords">全部历史 ›</span>
          </div>
          <ul class="hm-list">
            <li v-for="r in recentHistory" :key="r.id" class="hm-item" @click="goRecord(r)">
              <div class="hm-item-main">
                <div class="hm-item-t">
                  {{ r.course_name }}
                  <span class="badge badge-warn" v-if="r.is_extra">计划外</span>
                  <span class="badge badge-warn" v-if="r.corrected_count">已修正</span>
                </div>
                <div class="hm-item-s">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
                <div class="mt8">
                  <span class="ibox" :class="classOn(c) ? 'ibox-bad' : ''" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span>
                  <span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span>
                  <span class="ibox ibox-warn" v-if="r.arrive_before">预计到岗 {{ U.arriveText(r.arrive_before) }}</span>
                </div>
              </div>
              <span class="hm-att">{{ r.actual_count }}/{{ r.expected_count }}</span>
            </li>
          </ul>
          <button class="btn btn-block mt12" v-if="historyTotal > 5" @click="showHistory = true">
            查看本周全部 {{ historyTotal }} 条
          </button>
        </div>
      </template>
    </section>

    <section class="card hm-panel" v-if="!isAdmin">
      <div class="hd"><h2>选课</h2><span class="tiny muted">本周已选 {{ weekPlanCount }} 节</span></div>
      <p class="hm-hint">周五下午 5 点开放下一周选课，工作日直接填结果。</p>
      <button class="btn btn-danger btn-block mt8" v-if="returnedCount" @click="goReturned">
        被打回的课 {{ returnedCount }} 节 · 查看并重新提交 ›
      </button>
      <button class="btn btn-change btn-block btn-lg mt8" @click="goMyPlans">更改已选课程</button>
      <button class="btn btn-primary btn-block mt8" @click="goPlanNew">{{ isWeekend ? '选下周要查的课' : '新增查课计划' }}</button>
    </section>

    <button class="btn btn-block mt12" v-if="!isAdmin" @click="goMyRecords">查看我的历史记录</button>
    <button class="btn btn-block mt8" @click="goSettings">设置</button>

    <div class="mask mask-center" v-if="showHistory" @click.self="showHistory = false">
      <div class="sheet sheet-center">
        <h3>本周查课记录</h3>
        <div class="his-scroll" v-if="history.length">
          <ul class="hm-list">
            <li v-for="r in history" :key="r.id" class="hm-item" @click="goRecord(r)">
              <div class="hm-item-main">
                <div class="hm-item-t">
                  {{ r.course_name }}
                  <span class="badge badge-warn" v-if="r.is_extra">计划外</span>
                </div>
                <div class="hm-item-s">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
                <div class="mt8">
                  <span class="ibox" :class="classOn(c) ? 'ibox-bad' : ''" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span>
                  <span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span>
                </div>
              </div>
              <span class="hm-att">{{ r.actual_count }}/{{ r.expected_count }}</span>
            </li>
          </ul>
        </div>
        <div class="muted sm" v-else>还没有查课记录</div>
        <button class="btn btn-block mt12" @click="showHistory = false">关闭</button>
      </div>
    </div>
  </div>`,

  data() {
    return { U, loading: true, due: [], history: [], historyTotal: 0, showHistory: false, week: 0, weekPlanCount: 0, returnedCount: 0 }
  },
  computed: {
    me() { return Store.store.me || {} },
    isAdmin() { return Store.store.isAdmin },
    sem() { return Store.store.semester },
    semName() { return this.sem ? this.sem.name : '未设置学期' },
    todayText() { return U.md(U.today()) + ' ' + U.weekdayCN(U.today()) },
    isWeekend() { return U.isWeekend(U.today()) },
    recentHistory() { return this.history.slice(0, 5) },
    myClasses() {
      const me = this.me || {}
      return String(me.duty_classes || me.own_class || '').split(/[、,，/ ]+/).map((s) => s.trim()).filter(Boolean)
    },
  },
  mounted() { this.load() },
  methods: {
    overdue(p) { return p.check_date < U.today() },
    classParts(x) {
      return String(x.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter(Boolean)
    },
    classOn(c) { return this.myClasses.indexOf(c) >= 0 },
    goRecord(r) { this.showHistory = false; Store.nav('/record/' + r.id) },
    goMyRecords() { Store.nav('/my-records') },
    goMyPlans() { Store.nav('/my-plans') },
    goAdmin() { Store.nav('/admin') },
    goStats() { Store.nav('/class-stats') },
    goReturned() { Store.nav('/my-returned') },
    noteNeedsFill(p) { return String(p.note || '').indexOf('重新填报') >= 0 },
    goPlanNew() {
      if (this.isWeekend && this.week + 1 > Store.weekMax()) { U.toast('已到学期最后一周，无法再选下周'); return }
      Store.nav('/plan/new')
    },
    goExtra() { Store.nav('/fill/new') },
    goSettings() { Store.nav('/settings') },
    fill(p) {
      if (p.note && !this.noteNeedsFill(p)) Store.nav('/plan/' + p.id)
      else Store.nav('/fill/' + p.id)
    },
    async load() {
      this.week = Store.weekNow()
      try {
        const nextW = this.week + 1
        const canNext = this.sem && nextW <= this.sem.total_weeks
        const [due, wk, his, wkNext] = await Promise.all([
          Store.rpc('my_due', {}),
          this.sem ? Store.rpc('my_week', { p_week: this.week }) : Promise.resolve({ plans: [] }),
          Store.rpc('my_history', { p_limit: 60 }),
          canNext ? Store.rpc('my_week', { p_week: nextW }) : Promise.resolve({ plans: [] }),
        ])
        const seen = {}
        this.due = (due || []).filter((p) => {
          const k = [p.check_date, p.period_from, p.period_to, p.course_name, p.class_name].join('|')
          if (seen[k]) return false
          seen[k] = 1
          return true
        }).sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
        this.weekPlanCount = (wk.plans || []).length
        this.history = (his && his.rows) || []
        this.historyTotal = (his && his.total) || 0
        const allPlans = (wk.plans || []).concat((wkNext && wkNext.plans) || [])
        this.returnedCount = allPlans.filter((p) => p.status === 'planned' && p.note).length
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
  },
}

window.Views.PlanFormView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>{{ id ? '更改我的选课' : '新增我的查课' }}</h1>
      <div class="side right"></div>
    </div>

    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>保存失败</h3>
        <div class="sub errmsg">{{ err }}</div>
        <button class="btn btn-primary btn-block" @click="err = ''">知道了</button>
      </div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>课检时间</h2><span class="tiny muted">第 {{ weekTarget }} 周</span></div>

      <div class="field">
        <label class="label">星期<i class="req">*</i></label>
        <div class="chips">
          <div class="chip" v-for="(w, i) in WDS" :key="w" :class="{on: form.weekday === i + 1}" @click="form.weekday = i + 1">{{ w }}</div>
        </div>
      </div>

      <div class="field">
        <label class="label">节次<i class="req">*</i></label>
        <div class="chips mt8">
          <div class="chip" v-for="n in 12" :key="n" :class="{on: inRange(n)}" @click="pickPeriod(n)">{{ n }}</div>
        </div>
        <div class="mt8" v-if="form.period_from">
          <button type="button" class="btn btn-sm btn-reset" @click="resetPeriods">重选</button>
        </div>
        <div class="hint" v-if="!form.period_from">先点起始节，再点结束节</div>
        <div class="hint bad" v-if="periodWarn">{{ periodWarn }}</div>
      </div>

      <div class="field mb0">
        <label class="label">预计到岗时间<i class="req">*</i></label>
        <div class="chips mt8">
          <div class="chip" :class="{on: form.arrive_before === 'p1'}" @click="form.arrive_before = 'p1'">第一节课前</div>
          <div class="chip" :class="{on: form.arrive_before === 'p2'}" @click="form.arrive_before = 'p2'">第二节课前</div>
        </div>
        <div class="hint">选你计划到达教室的时间，便于安排查课</div>
      </div>
    </div>

    <div class="card mt12">
      <div class="field">
        <label class="label">课程名称<i class="req">*</i></label>
        <input class="input" v-model="form.course_name" maxlength="40" placeholder="如：高等数学A（上）">
      </div>

      <div class="field">
        <label class="label">任课老师<i class="req">*</i></label>
        <input class="input" v-model="form.teacher" maxlength="20" placeholder="输入姓名">
      </div>

      <div class="field">
        <label class="label">教室<i class="req">*</i></label>
        <input class="input" v-model="form.room" maxlength="20" placeholder="如：2106">
      </div>

      <div class="field">
        <div class="row between">
          <label class="label">本节课总应到人数<i class="req">*</i></label>
          <span class="tiny link" @click="toggleAutoTotal">{{ totalAuto ? '改为手动填写' : '按合计自动填入' }}</span>
        </div>
        <input class="input" v-model="form.total_expected" inputmode="numeric" :readonly="totalAuto"
               @click="makeManual" @focus="makeManual" placeholder="填本节课所有被查班级的总人数">
        <div class="hint" v-if="totalAuto">已按各班应到 + 其他自动汇总为 {{ classSum }} 人，修改班级人数会自动更新；点击输入框可直接手动填写。</div>
        <div class="hint" v-else>各班应到人数 + 其他人数必须等于总应到人数，否则说明漏填了班级。</div>
        <div class="hint bad" v-if="!totalAuto && totalWarn">{{ totalWarn }}</div>
      </div>

      <div class="field">
        <label class="label">
          被查班级<i class="req">*</i>
          <span class="cls-grades" v-if="gradeText">{{ gradeText }}</span>
        </label>

        <div class="hint" style="margin:-2px 0 8px">请把这节课所有被查班级都填上（人数较多的班级也要填）。</div>
        <div class="hint" v-if="dutyClassList.length">你的负责班级：{{ dutyClassList.join(' / ') }}。请优先填写这些班级；其他被查班级也可手动输入。</div>
        <div class="cls-row" v-for="(c, i) in form.classes" :key="i">
          <input class="input" v-model="c.code" maxlength="8" inputmode="numeric"
                 placeholder="如：13002605" @input="normCode(i)" :ref="'code' + i">
          <input class="input cls-num" v-if="c.code.length === 8" v-model="c.expected"
                 inputmode="numeric" placeholder="应到" :ref="'exp' + i" @keyup.enter="onExpectedEnter(i)">
          <button type="button" class="cls-add" v-if="canAdd(i)" @click="addClass" title="新增一个班级">＋</button>
        </div>

        <label class="label cls-other-label">其他人数<i class="req">*</i></label>
        <div class="cls-row">
          <button type="button" class="cls-no" @click="form.other_expected = '0'">无</button>
          <input class="input" v-model="form.other_expected" inputmode="numeric">
        </div>
        <div class="cls-other-tip">其他类应到人数</div>
      </div>
    </div>

    <div class="mask mask-center" v-if="confirmSave">
      <div class="sheet sheet-center">
        <h3>确认提交</h3>
        <div class="sub">请确认数据检查正确</div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doSave">确认提交</button>
        <button class="btn btn-block mt8" @click="confirmSave = false">再检查一下</button>
      </div>
    </div>

    <div class="actionbar">
      <div class="inner">
        <button class="btn grow" v-if="id && planStatus==='planned'" @click="cancelPlan">取消这节</button>
        <button class="btn grow btn-lg" :class="id ? 'btn-change' : 'btn-primary'" :disabled="busy" @click="save">
          {{ busy ? '保存中…' : (id ? '保存更改选课' : '保存') }}
        </button>
      </div>
    </div>

    <div class="mask mask-center" v-if="doneShow">
      <div class="sheet sheet-center">
        <h3>已保存</h3>
        <div class="sub">已保存到第 {{ weekTarget }} 周</div>
        <button class="btn btn-primary btn-block" @click="goHome">返回首页</button>
        <button class="btn btn-block mt8" @click="addAnother">再选一节</button>
      </div>
    </div>
  </div>`,

  data() {
    return {
      U, id: '', planStatus: 'planned', busy: false, err: '', doneShow: false, confirmSave: false,
      totalAuto: false,
      weekTarget: 0,
      WDS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      form: {
        weekday: 1, period_from: 0, period_to: 0, arrive_before: '',
        course_name: '', teacher: '', room: '',
        classes: [{ code: '', expected: '' }],
        other_expected: '',
        total_expected: '',
      },
    }
  },
  computed: {
    periods() { return U.PERIODS },
    sem() { return Store.store.semester },
    weekStart() {
      return this.sem && this.weekTarget ? U.weekStartOf(this.sem.start_monday, this.weekTarget) : ''
    },
    checkDate() {
      return this.weekStart ? U.addDays(this.weekStart, this.form.weekday - 1) : ''
    },
    periodWarn() {
      const a = Number(this.form.period_from)
      const b = Number(this.form.period_to)
      if (!a || !b) return ''
      const bad = []
      if (a % 2 === 0) bad.push('起始节次为偶数')
      if (Math.abs(b - a) > 2) bad.push('跨度超过 2 节')
      return bad.length ? '请确认查课节次是否正确：' + bad.join('，') + '（仍能提交）' : ''
    },
    classSum() {
      const s = this.form.classes.reduce((sum, c) => sum + (Number(c.expected) || 0), 0)
      return s + (Number(this.form.other_expected) || 0)
    },
    totalWarn() {
      if (String(this.form.total_expected).trim() === '') return ''
      if (Number(this.form.total_expected) !== this.classSum) {
        return '各班应到 + 其他 = ' + this.classSum + '，与总应到 ' + this.form.total_expected + ' 不一致，请检查是否漏填班级'
      }
      return ''
    },
    gradeText() {
      const map = { '26': '大一', '25': '大二', '24': '大三' }
      const order = ['大一', '大二', '大三']
      const set = []
      this.form.classes.forEach((c) => {
        if (c.code && c.code.length === 8) {
          const g = map[c.code.slice(4, 6)]
          if (g && set.indexOf(g) < 0) set.push(g)
        }
      })
      set.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      return set.join('、')
    },
    dutyClassList() {
      const me = Store.store.me || {}
      const raw = String(me.duty_classes || me.own_class || '')
      return raw.split(/[、,，+ ]+/).map((s) => s.trim()).filter((s) => s && s !== '其他')
    },
  },
  watch: {
    classSum(v) {
      if (this.totalAuto) this.form.total_expected = String(v)
    },
  },
  mounted() {
    this.id = this.$root.route.params.id || ''
    const max = this.sem ? this.sem.total_weeks : 18
    const q = this.$root.route.query
    this.weekTarget = q.week ? Math.min(Number(q.week), max) : Math.min(Store.weekNow() + 1, max)
    this.form.weekday = U.diffDays(U.mondayOf(U.today()), U.today()) + 1
    if (this.id) this.load()
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    setPeriod(p) { this.form.period_from = p[0]; this.form.period_to = p[1] },
    pickPeriod(n) {
      const a = Number(this.form.period_from)
      const b = Number(this.form.period_to)
      if (!a) { this.form.period_from = n; this.form.period_to = 0; return }
      if (!b) {
        if (n === a) return
        if (n < a) { this.form.period_to = a; this.form.period_from = n }
        else this.form.period_to = n
        return
      }
      this.form.period_from = n
      this.form.period_to = 0
    },
    resetPeriods() {
      this.form.period_from = 0
      this.form.period_to = 0
    },
    inRange(n) {
      const a = Number(this.form.period_from)
      const b = Number(this.form.period_to)
      if (!a) return false
      if (!b) return n === a
      return n >= a && n <= b
    },
    normCode(i) {
      const c = this.form.classes[i]
      c.code = String(c.code || '').replace(/\D/g, '').slice(0, 8)
      if (c.code.length === 8) {
        this.$nextTick(() => {
          const el = this.$refs['exp' + i]
          const target = Array.isArray(el) ? el[0] : el
          if (target && target.focus) target.focus()
        })
      }
    },
    canAdd(i) {
      const c = this.form.classes[i]
      return i === this.form.classes.length - 1
        && c.code.length === 8
        && String(c.expected).trim() !== ''
    },
    addClass() {
      this.form.classes.push({ code: '', expected: '' })
      this.$nextTick(() => {
        const n = this.form.classes.length - 1
        const el = this.$refs['code' + n]
        const target = Array.isArray(el) ? el[0] : el
        if (target && target.focus) target.focus()
      })
    },
    onExpectedEnter(i) {
      if (!this.canAdd(i)) return
      this.addClass()
    },
    toggleAutoTotal() {
      this.totalAuto = !this.totalAuto
      if (this.totalAuto) this.form.total_expected = String(this.classSum)
    },
    makeManual() { if (this.totalAuto) this.totalAuto = false },
    async load() {
      try {
        const d = await Store.rpc('my_due', {})
        const row = (d || []).find((x) => String(x.id) === String(this.id))
        if (!row) { U.toast('计划不存在或已填报', 'bad'); return Store.nav('/') }
        this.planStatus = row.status
        this.weekTarget = row.week_no
        this.totalAuto = false
        const ws = U.weekStartOf(this.sem.start_monday, row.week_no)
        const cls = Array.isArray(row.classes) && row.classes.length
          ? row.classes.slice().sort((a, b) => U.classCompare(a.code, b.code)).map((x) => ({ code: x.code || '', expected: x.expected === 0 ? '0' : String(x.expected) }))
          : [{ code: '', expected: '' }]
        const other = String(row.other_expected || 0)
        const sum = cls.reduce((s, c) => s + (Number(c.expected) || 0), 0) + (Number(other) || 0)
        this.form = {
          weekday: U.diffDays(ws, row.check_date) + 1,
          period_from: row.period_from, period_to: row.period_to,
          arrive_before: row.arrive_before || '',
          course_name: row.course_name,
          teacher: row.teacher || '', room: row.room || '',
          classes: cls,
          other_expected: other,
          total_expected: String(sum),
        }
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    check() {
      if (!this.sem) return '尚未设置学期，请联系管理员'
      if (!this.weekTarget || this.weekTarget < 1) return '周次不正确'
      if (!this.form.course_name.trim()) return '请填写课程名称'
      if (!this.form.teacher.trim()) return '请填写任课老师'
      if (!this.form.room.trim()) return '请填写教室'
      const rows = this.form.classes.filter((c) => c.code)
      if (!rows.length) return '请填写被查班级'
      for (const c of rows) {
        if (c.code.length !== 8) return '班级号必须是 8 位数字'
        if (String(c.expected).trim() === '') return '请填写每个班的应到人数'
        if (Number(c.expected) < 0) return '应到人数不能为负'
      }
      if (String(this.form.other_expected).trim() === '') return '请填写其他类应到人数'
      if (Number(this.form.other_expected) < 0) return '其他类人数不能为负'
      if (String(this.form.total_expected).trim() === '') return '请填写本节课总应到人数'
      if (Number(this.form.total_expected) <= 0) return '总应到人数必须大于 0'
      const sum = rows.reduce((s, c) => s + (Number(c.expected) || 0), 0) + (Number(this.form.other_expected) || 0)
      if (Number(this.form.total_expected) !== sum) {
        return '各班应到 + 其他 = ' + sum + '，与总应到 ' + this.form.total_expected + ' 不一致，请检查是否漏填班级'
      }
      if (!this.form.period_from || !this.form.period_to) return '请选择节次：先点起始节，再点结束节'
      if (!this.form.arrive_before) return '请选择预计到岗时间'
      return ''
    },
    save() {
      const bad = this.check()
      if (bad) { this.err = bad; return }
      this.err = ''
      this.confirmSave = true
    },
    async doSave() {
      this.confirmSave = false
      this.busy = true
      try {
        const rows = this.form.classes.filter((c) => c.code)
        const payload = {
          check_date: this.checkDate,
          period_from: Number(this.form.period_from),
          period_to: Number(this.form.period_to),
          course_name: this.form.course_name.trim(),
          teacher: this.form.teacher.trim(),
          room: this.form.room.trim(),
          classes: rows.map((c) => ({ code: c.code, expected: Number(c.expected) })),
          other_expected: Number(this.form.other_expected),
          total_expected: Number(this.form.total_expected),
          arrive_before: this.form.arrive_before,
        }
        if (this.id) payload.id = this.id
        const row = await Store.rpc('plan_save', { p_payload: payload })
        U.toast('已保存到第 ' + row.week_no + ' 周')
        if (this.id) Store.nav('/')
        else this.doneShow = true
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
    goHome() { Store.nav('/') },
    addAnother() {
      this.doneShow = false
      this.err = ''
      this.form.course_name = ''
      this.form.teacher = ''
      this.form.room = ''
      this.form.classes = [{ code: '', expected: '' }]
      this.form.other_expected = ''
      this.form.total_expected = ''
      this.form.arrive_before = ''
      this.totalAuto = false
      window.scrollTo(0, 0)
    },
    async cancelPlan() {
      if (!window.confirm('取消这节查课计划？取消后不计入未查课统计。')) return
      try {
        await Store.rpc('plan_void', { p_id: Number(this.id) })
        U.toast('已取消')
        Store.nav('/')
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
  },
}

window.Views.MyPlansView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>我的选课</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>本周选课</h2><span class="tiny muted">第 {{ week }} 周</span></div>
      <div class="list" v-if="mergedCurrent.length">
        <div class="litem" v-for="p in mergedCurrent" :key="p._key" style="cursor:default">
          <div class="row between">
            <div class="t1">{{ p.course_name }} <span class="muted sm" v-if="p.teacher">· {{ p.teacher }}</span></div>
            <span class="badge" :class="planBadge(p)">{{ planText(p) }}</span>
          </div>
          <div class="t2">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}</div>
          <div class="mt8">
            <span class="ibox" :class="classOn(c) ? 'ibox-bad' : ''" v-for="(c, ci) in p._classes" :key="c + ci">{{ c }}</span>
            <span class="ibox ibox-pri" v-if="p.room">教室 {{ p.room }}</span>
            <span class="ibox ibox-warn" v-if="p.arrive_before">预计到岗 {{ U.arriveText(p.arrive_before) }}</span>
          </div>
          <div class="plan-note" v-if="p.note">{{ p.note }}</div>
          <div class="row mt8" style="gap:8px;flex-wrap:wrap" v-if="p.status === 'planned'">
            <button v-for="q in p._plans" :key="q.id" class="btn btn-sm btn-change" @click="edit(q)">{{ p._plans.length > 1 ? '改 ' + (q.class_name || '班级') : '更改选课' }}</button>
          </div>
          <div class="tiny muted mt8" v-else-if="p.status === 'submitted'">已查课，不能再改选课</div>
        </div>
      </div>
      <div class="muted sm" v-else>本周还没有选课</div>
    </div>

    <div class="card mt12" v-if="nextWeek <= maxWeek">
      <div class="hd"><h2>下周选课</h2><span class="tiny muted">第 {{ nextWeek }} 周</span></div>
      <div class="list" v-if="mergedNext.length">
        <div class="litem" v-for="p in mergedNext" :key="p._key" style="cursor:default">
          <div class="row between">
            <div class="t1">{{ p.course_name }} <span class="muted sm" v-if="p.teacher">· {{ p.teacher }}</span></div>
            <span class="badge" :class="planBadge(p)">{{ planText(p) }}</span>
          </div>
          <div class="t2">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}</div>
          <div class="mt8">
            <span class="ibox" :class="classOn(c) ? 'ibox-bad' : ''" v-for="(c, ci) in p._classes" :key="c + ci">{{ c }}</span>
            <span class="ibox ibox-pri" v-if="p.room">教室 {{ p.room }}</span>
            <span class="ibox ibox-warn" v-if="p.arrive_before">预计到岗 {{ U.arriveText(p.arrive_before) }}</span>
          </div>
          <div class="plan-note" v-if="p.note">{{ p.note }}</div>
          <div class="row mt8" style="gap:8px;flex-wrap:wrap" v-if="p.status === 'planned'">
            <button v-for="q in p._plans" :key="q.id" class="btn btn-sm btn-change" @click="edit(q)">{{ p._plans.length > 1 ? '改 ' + (q.class_name || '班级') : '更改选课' }}</button>
          </div>
          <div class="tiny muted mt8" v-else-if="p.status === 'submitted'">已查课，不能再改选课</div>
        </div>
      </div>
      <div class="muted sm" v-else>下周还没有选课</div>
    </div>

    <button class="btn btn-change btn-block btn-lg mt12" @click="newPlan">新增选课</button>
  </div>`,

  data() {
    return { U, week: 0, nextWeek: 0, maxWeek: 18, currentPlans: [], nextPlans: [] }
  },
  computed: {
    me() { return Store.store.me || {} },
    myClasses() { return String(this.me.duty_classes || this.me.own_class || '').split(/[、,，/ ]+/).map((s) => s.trim()).filter(Boolean) },
    mergedCurrent() { return this.merge(this.currentPlans) },
    mergedNext() { return this.merge(this.nextPlans) },
  },
  mounted() {
    this.week = Store.weekNow()
    this.maxWeek = Store.weekMax()
    this.nextWeek = this.week + 1
    this.load()
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    merge(list) {
      const map = {}
      ;(list || []).forEach((p) => {
        const key = [p.check_date, p.period_from, p.period_to, p.course_name].join('|')
        if (!map[key]) map[key] = Object.assign({}, p, { _key: key, _plans: [p], _classes: this.planClasses(p) })
        else {
          const m = map[key]
          m._plans.push(p)
          this.planClasses(p).forEach((c) => { if (m._classes.indexOf(c) < 0) m._classes.push(c) })
          if (!m.note && p.note) m.note = p.note
          if (p.status === 'submitted') m.status = 'submitted'
        }
      })
      return Object.keys(map).map((k) => map[k]).sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
    },
    planClasses(p) {
      const list = (Array.isArray(p.classes) && p.classes.length)
        ? p.classes.map((c) => c.code)
        : String(p.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim())
      return list.filter(Boolean)
    },
    classOn(c) { return this.myClasses.indexOf(c) >= 0 },
    planText(p) {
      if (p.status === 'void') return '已取消'
      if (p.status === 'submitted') return '已查课'
      return p.note ? '被打回' : '待查课'
    },
    planBadge(p) {
      if (p.status === 'void') return ''
      if (p.status === 'submitted') return 'badge-ok'
      return p.note ? 'badge-bad' : 'badge-warn'
    },
    edit(p) { Store.nav('/plan/' + p.id) },
    newPlan() { Store.nav('/plan/new?week=' + Math.min(this.nextWeek, this.maxWeek)) },
    async load() {
      if (!Store.store.semester) return
      try {
        const [wk, wkNext] = await Promise.all([
          Store.rpc('my_week', { p_week: this.week }),
          this.nextWeek <= this.maxWeek ? Store.rpc('my_week', { p_week: this.nextWeek }) : Promise.resolve({ plans: [] }),
        ])
        this.currentPlans = (wk.plans || []).slice().sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
        this.nextPlans = ((wkNext && wkNext.plans) || []).slice().sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      }
    },
  },
}

window.Views.MyReturnedView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>被打回的课</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12" v-if="items.length">
      <div class="hd"><h2>待重新提交</h2><span class="tiny muted">{{ items.length }} 节</span></div>
      <div class="list">
        <div class="litem" v-for="p in items" :key="p.id" style="cursor:default">
          <div class="row between">
            <div class="t1">{{ p.course_name }} <span class="muted sm">· {{ p.class_name }}</span></div>
            <span class="badge badge-bad">打回</span>
          </div>
          <div class="t2">{{ line(p) }}</div>
          <div class="plan-note">{{ p.note }}</div>
          <button class="btn btn-primary btn-block mt8" @click="handle(p)">{{ needFill(p) ? '修改并重新提交查课结果' : '修改并重新提交选课' }}</button>
        </div>
      </div>
      <div class="tiny muted mt8">重新提交后，管理员端会标记「重交」。</div>
    </div>
    <div class="card mt12" v-else><div class="muted sm">没有被退回的课</div></div>
  </div>`,
  data() { return { U, items: [] } },
  mounted() { this.load() },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    line(p) {
      const arrive = U.arriveText(p.arrive_before)
      return [U.md(p.check_date), U.weekdayCN(p.check_date), U.periodText(p.period_from, p.period_to)]
        .join(' ') + (p.room ? ' · ' + p.room : '') + (arrive ? ' · ' + arrive : '')
    },
    needFill(p) { return String(p.note || '').indexOf('重新填报') >= 0 },
    handle(p) { Store.nav((this.needFill(p) ? '/fill/' : '/plan/') + p.id) },
    async load() {
      try {
        const rows = await Store.rpc('my_due', {})
        this.items = (rows || []).filter((p) => p.note).slice().sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
  },
}

window.Views.SettingsView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>设置</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="row between">
        <div>
          <div style="font-size:16px;font-weight:650">{{ me.name }}</div>
          <div class="tiny muted mt8">学号 {{ me.student_no }}<span v-if="me.title"> · {{ me.title }}</span></div>
        </div>
        <span class="badge">{{ isAdmin ? '管理员' : '组员' }}</span>
      </div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>外观</h2></div>
      <div class="row between">
        <div class="grow">
          <div class="strong sm">黑暗模式</div>
          <div class="tiny muted mt8">深色背景，夜间查看更舒适</div>
        </div>
        <button class="switch" :class="{ on: dark }" role="switch" :aria-checked="dark ? 'true' : 'false'" @click="toggleTheme">
          <i></i>
        </button>
      </div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>账号</h2></div>
      <div class="list">
        <div class="litem" @click="goChange">
          <div class="row between">
            <div class="t1">修改密码</div>
            <span class="tiny muted">›</span>
          </div>
          <div class="t2">修改后下次用新密码登录</div>
        </div>
      </div>
    </div>

    <button class="btn btn-danger btn-block mt12" @click="logout">退出登录</button>
  </div>`,

  computed: {
    me() { return Store.store.me || {} },
    isAdmin() { return Store.store.isAdmin },
    dark() { return Store.store.theme === 'dark' },
  },
  methods: {
    back() { Store.nav('/') },
    goChange() { Store.nav('/change') },
    toggleTheme() { Store.toggleTheme() },
    logout() { Store.logout() },
  },
}
