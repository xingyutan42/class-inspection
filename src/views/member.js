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

    <section class="card mt12" style="padding:14px">
      <div class="hd" style="margin-bottom:12px">
        <h2 style="font-size:14px">本周总览</h2>
        <span class="tiny muted">{{ weekRange }}</span>
      </div>
      <div class="stat-grid">
        <div class="stat" style="background:var(--pri-soft);border-color:rgba(48,86,211,.14)">
          <div class="n" style="color:var(--pri)">{{ week }}<span style="font-size:12px;font-weight:600;margin-left:2px">周</span></div>
          <div class="t" style="font-size:12px;white-space:nowrap">本周周数</div>
        </div>
        <div class="stat" style="background:var(--pri-soft);border-color:rgba(48,86,211,.14)">
          <div class="n" style="color:var(--pri)">{{ weekRecordCount }}<span style="font-size:12px;font-weight:600;margin-left:2px">节</span></div>
          <div class="t" style="font-size:12px;white-space:nowrap">本周查课节数</div>
        </div>
        <div class="stat" style="background:var(--pri-soft);border-color:rgba(48,86,211,.14)">
          <div class="n" style="color:var(--pri)" v-if="!meExcluded">{{ classHitCount }}<span style="font-size:12px;font-weight:600;margin-left:2px">次</span></div>
          <div class="n" style="color:var(--pri);font-size:12.5px;line-height:1.35;font-weight:650" v-else>大三人员由管理员确认</div>
          <div class="t" style="font-size:12px;white-space:nowrap">本周有效查课数</div>
        </div>
      </div>
      <div class="tiny muted mt8">查课节数按记录条数（一条记录 = 1 节）；有效查课数按负责班级累计，与统计页一致。</div>
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
              <div class="hm-item-t">{{ p.course_name }} <span class="badge badge-bad" v-if="overdue(p)">已过期</span></div>
              <div class="hm-item-s">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}</div>
              <div class="mt8">
                <span class="ibox" :class="classOn(c) ? 'ibox-mine' : ''" v-for="(c, ci) in classParts(p)" :key="c + ci">{{ c }}</span>
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
                  <span class="ibox" :class="classOn(c) ? 'ibox-mine' : ''" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span>
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
      <div class="hd"><h2>选课</h2></div>
      <div class="hm-infobox">
        <div class="row between"><span class="muted">本周已选</span><b class="num">{{ weekPlanCount }} 节</b></div>
        <div class="tiny muted mt8">{{ gateHint }}</div>
      </div>
      <button class="btn btn-change btn-block mt8" @click="goMyPlans">更改已选课程</button>
      <button class="btn btn-primary btn-block mt8" :disabled="gateClosed"
             :style="gateClosed ? 'opacity:.5' : ''" @click="goPlanNew">{{ planNewLabel }}</button>
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
                  <span class="ibox" :class="classOn(c) ? 'ibox-mine' : ''" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span>
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
    return { U, loading: true, due: [], history: [], historyTotal: 0, showHistory: false, week: 0, weekPlanCount: 0, weekRecordCount: 0, classHitCount: 0, gate: null }
  },
  computed: {
    weekRange() {
      const sem = Store.store.semester
      if (!sem || !this.week) return ''
      const start = U.weekStartOf(sem.start_monday, this.week)
      if (!start) return ''
      return U.md(start) + ' — ' + U.md(U.addDays(start, 6))
    },
    me() { return Store.store.me || {} },
    isAdmin() { return Store.store.isAdmin },
    // T3：被标记排除的账号，本周有效查课数改显示「大三人员由管理员确认」
    meExcluded() { return !!(Store.store.me && Store.store.me.stats_excluded) },
    sem() { return Store.store.semester },
    semName() { return this.sem ? this.sem.name : '未设置学期' },
    todayText() { return U.md(U.today()) + ' ' + U.weekdayCN(U.today()) },
    isWeekend() { return U.isWeekend(U.today()) },
    // 3.5 选课时间闸门：前端只读 app_plan_window() 的结果，不自行重算时间（PRD §3.3）
    gateClosed() { return !!(this.gate && this.gate.open === false) },
    gateHint() {
      if (this.gate && this.gate.gateOn && this.gate.openText) {
        return '选课开放时间：' + this.gate.openText + ' → ' + this.gate.closeText + '。'
      }
      return '周五下午 5 点开放下一周选课，工作日直接填结果。'
    },
    planNewLabel() {
      if (this.gateClosed) return '选课已关闭 · ' + (this.gate.nextOpenText || '')
      return this.isWeekend ? '选下周要查的课' : '新增查课计划'
    },
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
    goPlanNew() {
      if (this.gateClosed) { U.toast('选课已关闭，' + (this.gate.nextOpenText || '') , 'bad'); return }
      if (this.isWeekend && this.week + 1 > Store.weekMax()) { U.toast('已到学期最后一周，无法再选下周'); return }
      Store.nav('/plan/new')
    },
    goSettings() { Store.nav('/settings') },
    fill(p) {
      // 「查课」一律进填报页；改选课走「更改已选课程」入口
      Store.nav('/fill/' + p.id)
    },
    async load() {
      this.week = Store.weekNow()
      // 3.5 闸门状态：独立拉取，失败不阻塞首页（gate=null 时按钮可点，
      // 窗口外提交会被后端拒绝——可接受降级，见 PRD R7）
      try { this.gate = await Store.rpcCached('app_plan_window', {}, 30000, true) } catch (e) { this.gate = null }
      try {
        // 一次请求拿回 待填 + 本周 + 下周 + 历史（原为 4 个请求）
        const home = await Store.rpcCached('my_home', {}, 60000)
        const due = home.due || []
        const wk = home.week || { plans: [] }
        const wkNext = home.next || { plans: [] }
        const his = home.history || { rows: [], total: 0 }
        const seen = {}
        this.due = (due || []).filter((p) => {
          const k = U.sessionKey(p)
          if (seen[k]) return false
          seen[k] = 1
          return true
        }).sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
        this.weekPlanCount = (wk.plans || []).length
        // 本周查课节数 = 记录条数
        this.weekRecordCount = (wk.records || []).filter((r) => !r.returned).length
        this.history = (his && his.rows) || []
        this.historyTotal = (his && his.total) || 0
        // 本周有效查课数 = 按负责班级累计（口径 A，与统计页/导出一致）
        try {
          const wc = await Store.rpcCached('week_counts', { p_week_from: this.week, p_week_to: this.week }, 60000)
          this.classHitCount = ((wc && wc.rows) || []).reduce((s, r) => s + (Number(r.count) || 0), 0)
        } catch (e) { /* 统计失败不影响首页其它内容 */ }
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
      <div class="side right"><button class="btn btn-sm" @click="saveDraft(false)">存草稿</button></div>
    </div>

    <!-- 3.5 闸门：窗口外直链进入新增表单的兜底拦截（编辑态不受影响，PRD §5.2） -->
    <div class="card mt12" v-if="gateBlocked">
      <div class="hd"><h2>选课已关闭</h2></div>
      <div class="sub" style="color:var(--warn)">{{ gate && gate.nextOpenText ? gate.nextOpenText + ' 可新增选课' : '当前不在选课开放时间内' }}</div>
      <div class="tiny muted mt8">已选的课程不受影响，可从「更改已选课程」进入修改。</div>
      <button class="btn btn-block mt12" @click="back">返回</button>
    </div>

    <template v-if="!gateBlocked">
    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>保存失败</h3>
        <div class="sub errmsg">{{ err }}</div>
        <button class="btn btn-primary btn-block" @click="err = ''">知道了</button>
      </div>
    </div>

    <div class="card mt12 draft-tip" v-if="draftTip">
      <div class="strong" style="color:var(--warn)">发现未提交的草稿（{{ draftTip.time }}）</div>
      <div class="tiny muted mt8">{{ draftTip.text || '本机保存的填写内容' }}</div>
      <div class="row mt8" style="gap:8px">
        <button class="btn btn-sm btn-primary" @click="restoreDraft">恢复草稿</button>
        <button class="btn btn-sm" @click="dropDraft">丢弃</button>
      </div>
    </div>

    <div class="tiny muted mt8" v-if="draftSavedAt && !draftTip">草稿已保存在本机 · {{ draftSavedText }}</div>

    <div class="card mt12">
      <div class="hd" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center">
        <h2 style="text-align:left">课检时间</h2>
        <span style="font-size:20px;font-weight:700;color:var(--pri);text-align:center">第 {{ weekTarget }} 周</span>
        <span></span>
      </div>

      <div class="field">
        <label class="label">周次<i class="req">*</i></label>
        <div class="chips">
          <div class="chip" v-for="opt in weekChoices" :key="'wk' + opt.w"
               :class="{ on: weekTarget === opt.w }" @click="setWeek(opt.w)">{{ opt.label }}</div>
        </div>
        <div class="hint" v-if="id">改到另一周会把这节课整体挪过去；本周已过去的日期也可以选（补录）</div>
      </div>

      <div class="field">
        <label class="label">星期<i class="req">*</i></label>
        <div class="chips">
          <div class="chip" v-for="(w, i) in WDS" :key="w"
               :class="{ on: form.weekday === i + 1 }"
               :style="isPastDay(i + 1) ? 'opacity:.35' : ''"
               @click="pickWeekday(i + 1)">{{ w }}</div>
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
        <input class="input" v-model="form.course_name" maxlength="40" placeholder="如：高等数学A（上）" @blur="fillFromLast">
      </div>

      <div class="field">
        <label class="label">任课老师<i class="req">*</i></label>
        <input class="input" v-model="form.teacher" maxlength="20" placeholder="输入姓名" @blur="fillFromLast">
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
               @click="makeManual" @focus="makeManual" @blur="normTotal" placeholder="填本节课所有被查班级的总人数">
        <div class="hint" v-if="totalAuto">已按各班应到 + 其他自动汇总为 {{ classSum }} 人，修改班级人数会自动更新；点击输入框可直接手动填写。</div>
        <div class="hint" v-else>各班应到人数 + 其他人数必须等于总应到人数。也可以直接写 26+30+26+28+4，会自动相加。</div>
        <div class="hint bad" v-if="!totalAuto && totalWarn">{{ totalWarn }}</div>
      </div>

      <div class="field">
        <label class="label">
          被查班级<i class="req">*</i>
          <span class="cls-grades" v-if="gradeText">{{ gradeText }}</span>
        </label>

        <div class="hint" style="margin:-2px 0 8px">请把这节课所有被查班级都填上（人数较多的班级也要填），<b>每班一般不超过50人</b>。</div>
        <div class="hint" v-if="dutyClassList.length">你的负责班级：{{ dutyClassList.join(' / ') }}。</div>
        <template v-for="(c, i) in form.classes" :key="i">
        <div class="cls-row">
          <input class="input" v-model="c.code" maxlength="8" inputmode="numeric"
                 :style="codeBad(c) ? 'border-color:var(--bad)' : ''"
                 placeholder="如：13002605" @input="normCode(i)" :ref="'code' + i">
          <input class="input cls-num" v-if="c.code.length === 8" v-model="c.expected"
                 inputmode="numeric" placeholder="应到 1~50" :ref="'exp' + i" @keyup.enter="onExpectedEnter(i)">
          <button type="button" class="cls-add" v-if="canAdd(i)" @click="addClass" title="新增一个班级">＋</button>
        </div>
        <div class="hint bad" v-if="codeBad(c)">{{ c.code }} 的末两位应在 00~20 之间，请检查是否输错</div>
        </template>
        <div class="hint bad" v-if="gradeMixed">当前填写班级的年级不同！同一节课请填写同年级的班级（仍可保存，请确认无误）</div>

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
        <div class="sub" v-if="id && originalWeek && weekTarget !== originalWeek" style="color:var(--warn)">
          这节课会从第 {{ originalWeek }} 周挪到第 {{ weekTarget }} 周
        </div>
        <div class="sub" v-else>将保存到第 {{ weekTarget }} 周</div>
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
    </template>
  </div>`,

  data() {
    return {
      U, id: '', planStatus: 'planned', busy: false, err: '', doneShow: false, confirmSave: false, draftTip: null, draftSavedAt: 0, draftReady: false,
      totalAuto: false,
      gate: null, gateBlocked: false,
      weekTarget: 0,
      originalWeek: 0,
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
    // 新增选课可选的周次：本周 / 下周（下周超出学期就不显示）
    curWeek() { return Math.max(1, Math.min(Store.weekMax(), Store.weekNow() || 1)) },
    weekChoices() {
      const max = this.sem ? this.sem.total_weeks : 18
      const cur = this.curWeek
      const list = []
      // 编辑一条不在本周/下周的计划时，把它原本那周也列出来，否则看不到当前值
      if (this.weekTarget && this.weekTarget !== cur && this.weekTarget !== cur + 1) {
        list.push({ w: this.weekTarget, label: '第' + this.weekTarget + '周' })
      }
      // 3.5 闸门：窗口内才给「本周」选项（补填）；编辑态始终可见（PRD §5.2 allowThisWeek）
      const gateOpen = !this.gate || this.gate.open !== false
      if (gateOpen || this.id) list.push({ w: cur, label: '本周' })
      if (cur + 1 <= max) list.push({ w: cur + 1, label: '下周' })
      return list
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
    // 总应到允许直接写算式（26+30+26+28+4）：把全角＋、逗号、空格统一成 +，再求和
    totalParsed() {
      let raw = String(this.form.total_expected === undefined || this.form.total_expected === null ? '' : this.form.total_expected)
        .replace(/[，,＋+\s]/g, '+')
      raw = raw.replace(/\++/g, '+').replace(/^\+|\+$/g, '')
      if (!raw) return NaN
      if (!/^\d+(\+\d+)*$/.test(raw)) return NaN
      return raw.split('+').reduce((s, x) => s + (Number(x) || 0), 0)
    },
    totalWarn() {
      if (String(this.form.total_expected).trim() === '') return ''
      if (isNaN(this.totalParsed)) return '总应到请填数字，或写成 26+30+26+28+4 这样的加法算式'
      if (this.totalParsed !== this.classSum) {
        return '各班应到 + 其他 = ' + this.classSum + '，与总应到 ' + this.totalParsed + ' 不一致，请检查是否漏填班级'
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
    // T2 软限制：同一节课的被查班级必须同年级（判据见 U.gradeKeysOf，取第 5-6 位）
    gradeMixed() {
      return U.gradeKeysOf(this.form.classes.map((c) => c.code)).length > 1
    },
    dutyClassList() {
      const me = Store.store.me || {}
      const raw = String(me.duty_classes || me.own_class || '')
      return raw.split(/[、,，+ ]+/).map((s) => s.trim()).filter((s) => s && s !== '其他')
    },
    draftKey() {
      const uid = (Store.store.me && Store.store.me.id) || 0
      if (!window.Draft) return ''
      return this.id ? Draft.keyOf(uid, this.id, '') : Draft.keyOf(uid, 0, 'plan|' + this.weekTarget)
    },
    draftText() {
      const f = this.form
      const wd = this.WDS[(Number(f.weekday) || 1) - 1]
      return ['第' + (this.weekTarget || '?') + '周', wd, U.periodText(f.period_from, f.period_to), f.course_name].filter(Boolean).join(' ')
    },
    draftSavedText() {
      return this.draftSavedAt ? U.shortTime(new Date(this.draftSavedAt).toISOString()) : ''
    },
  },
  watch: {
    classSum(v) {
      if (this.totalAuto) this.form.total_expected = String(v)
    },
    form: { deep: true, handler() { this.autoSaveDraft() } },
  },
  mounted() {
    window.__xfcSaveDraftBeforeRefresh = async () => {
      if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null }
      if (!this.draftReady) return false
      if (this.draftTip) return true
      return await this.saveDraft(true)
    }
    this.id = this.$root.route.params.id || ''
    const max = this.sem ? this.sem.total_weeks : 18
    const q = this.$root.route.query
    this.weekTarget = q.week ? Math.min(Number(q.week), max) : Math.min(Store.weekNow() + 1, max)
    this.form.weekday = U.diffDays(U.mondayOf(U.today()), U.today()) + 1
    // 3.5 闸门：新增态窗口外直接给出拦截卡片（编辑态放行，PRD §5.2）
    Store.rpc('app_plan_window', {}, true).then((g) => {
      this.gate = g || null
      if (!this.id && this.gate && this.gate.open === false) this.gateBlocked = true
    }).catch(() => { this.gate = null })
    if (this.id) this.load(); else this.checkDraft().finally(() => { this.draftReady = true })
  },
  beforeUnmount() {
    if (this._draftTimer) clearTimeout(this._draftTimer)
    if (window.__xfcSaveDraftBeforeRefresh) delete window.__xfcSaveDraftBeforeRefresh
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    // ---------- 周次：本周 / 下周 ----------
    setWeek(w) {
      if (!w || this.weekTarget === w) return
      this.weekTarget = w
      // 新增时切回本周，若当前星期已过就落到今天；改课允许选过去日期
      if (!this.id && this.isPastDay(this.form.weekday)) {
        this.form.weekday = U.diffDays(U.mondayOf(U.today()), U.today()) + 1
      }
      this.checkDraft().finally(() => { this.draftReady = true })
    },
    isPastDay(d) {
      if (this.id || !this.weekStart || !this.sem) return false
      const date = U.addDays(this.weekStart, Number(d) - 1)
      return date < U.today()
    },
    pickWeekday(d) {
      if (this.isPastDay(d)) { U.toast('这周这一天已经过去了，请选今天或之后', 'bad'); return }
      this.form.weekday = d
    },
    // 失焦时把 26+30+26+28+4 这类算式直接换成结果，避免以为没生效
    normTotal() {
      const raw = String(this.form.total_expected || '')
      if (!/[+＋,，]/.test(raw)) return
      if (!isNaN(this.totalParsed)) this.form.total_expected = String(this.totalParsed)
    },
    // ---------- 草稿：本机自动保存，不请求云端 ----------
    autoSaveDraft() {
      if (this._draftTimer) clearTimeout(this._draftTimer)
      this._draftTimer = setTimeout(() => { this.saveDraft(true) }, 1500)
    },
    async saveDraft(silent) {
      if (!window.Draft) return false
      const key = this.draftKey
      if (!key) return false
      const ok = await Draft.save(key, {
        userId: (Store.store.me && Store.store.me.id) || 0,
        planId: this.id || 0,
        form: JSON.parse(JSON.stringify(this.form)),
        photos: [],
        meta: { text: this.draftText },
      })
      if (ok) {
        this.draftSavedAt = Date.now()
        if (silent === false) U.toast('草稿已保存在本机')
        return true
      } else {
        if (silent === false) U.toast('草稿保存失败（浏览器存储不可用）', 'bad')
        return false
      }
    },
    async checkDraft() {
      if (!window.Draft) return
      const d = await Draft.get(this.draftKey)
      if (!d) { this.draftTip = null; return }
      this.draftTip = {
        time: U.shortTime(new Date(Number(d.savedAt) || Date.now()).toISOString()),
        text: (d.meta && d.meta.text) || '',
      }
    },
    async restoreDraft() {
      if (!window.Draft) return
      const d = await Draft.get(this.draftKey)
      if (!d) { this.draftTip = null; return }
      Object.assign(this.form, d.form || {})
      this.draftTip = null
      this.draftSavedAt = Number(d.savedAt) || 0
      U.toast('草稿已恢复')
    },
    async dropDraft() {
      if (window.Draft) await Draft.del(this.draftKey)
      this.draftTip = null
      U.toast('草稿已丢弃')
    },
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
      // 末两位超出 00~20 时不自动跳格，先让用户看到红框改对
      if (c.code.length === 8 && !this.codeBad(c)) {
        this.$nextTick(() => {
          const el = this.$refs['exp' + i]
          const target = Array.isArray(el) ? el[0] : el
          if (target && target.focus) target.focus()
        })
      }
    },
    // 班级号末两位应在 00~20（现存班级实际只到 13，上限留余量）
    codeBad(c) {
      const code = String((c && c.code) || '')
      if (code.length !== 8) return false
      return Number(code.slice(6, 8)) > 20
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
    // 一键沿用：3.7 改为按「课程名 + 任课老师 + 班级集合」精确匹配上次记录；
    // 找不到时由后端回退到同名课程最近一条并标记 fallback，前端提示核对（PRD 3.7 D2）。
    // 仍遵守「只填空着的，不覆盖已填」。
    async fillFromLast() {
      const name = String(this.form.course_name || '').trim()
      if (!name) return
      const hasClasses = Array.isArray(this.form.classes) && this.form.classes.some((c) => String(c.code || '').trim())
      if (this.form.teacher && this.form.room && hasClasses) return
      try {
        const codes = (this.form.classes || []).map((c) => String(c.code || '').trim()).filter((c) => /^\d{8}$/.test(c))
        let d
        try {
          d = await Store.rpc('my_last_course', {
            p_course_name: name,
            p_teacher: String(this.form.teacher || '').trim(),
            p_classes: codes.map((code) => ({ code: code })),
          })
        } catch (e) {
          // 迁移未执行（四参重载还不存在）时降级为原两参调用，避免沿用功能整页失效
          d = await Store.rpc('my_last_course', { p_course_name: name })
        }
        if (!d || !d.teacher) return
        const filled = []
        if (!this.form.teacher && d.teacher) { this.form.teacher = d.teacher; filled.push('教师') }
        if (!this.form.room && d.room) { this.form.room = d.room; filled.push('教室') }
        if (!hasClasses && Array.isArray(d.classes) && d.classes.length) {
          this.form.classes = d.classes.map((c) => ({ code: String(c.code || ''), expected: String(c.expected || '') }))
          const cur = String(this.form.other_expected == null ? '' : this.form.other_expected)
          if (cur === '' || cur === '0') this.form.other_expected = String(d.other_expected || 0)
          filled.push('班级')
        }
        if (d.fallback) U.toast('已沿用同名课程上次内容，请核对老师/班级')
        else if (filled.length) U.toast('已沿用上次的' + filled.join('、'))
      } catch (e) { /* 静默失败，不打扰 */ }
    },
    toggleAutoTotal() {
      this.totalAuto = !this.totalAuto
      if (this.totalAuto) this.form.total_expected = String(this.classSum)
    },
    makeManual() { if (this.totalAuto) this.totalAuto = false },
    async load() {
      try {
        const d = await Store.rpcCached('my_due', {})
        const row = (d || []).find((x) => String(x.id) === String(this.id))
        if (!row) { U.toast('计划不存在或已填报', 'bad'); return Store.nav('/') }
        this.planStatus = row.status
        this.weekTarget = row.week_no
        this.originalWeek = Number(row.week_no) || 0
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
      this.checkDraft()
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
        if (this.codeBad(c)) return c.code + ' 的末两位超出范围（应在 00~20 之间），请检查是否输错'
        if (String(c.expected).trim() === '') return '请填写每个班的应到人数'
        const exp = Number(c.expected)
        if (!Number.isFinite(exp) || exp < 1 || exp > 50) return c.code + ' 的应到人数需在 1~50 之间（单班最多 50 人）'
      }
      if (String(this.form.other_expected).trim() === '') return '请填写其他类应到人数'
      if (Number(this.form.other_expected) < 0) return '其他类人数不能为负'
      if (String(this.form.total_expected).trim() === '') return '请填写本节课总应到人数'
      if (isNaN(this.totalParsed)) return '总应到人数请填数字，也可以写成 26+30+26+28+4（会自动相加）'
      if (this.totalParsed <= 0) return '总应到人数必须大于 0'
      const sum = rows.reduce((s, c) => s + (Number(c.expected) || 0), 0) + (Number(this.form.other_expected) || 0)
      if (this.totalParsed !== sum) {
        return '各班应到 + 其他 = ' + sum + '，与总应到 ' + this.totalParsed + ' 不一致，请检查是否漏填班级'
      }
      if (!this.form.period_from || !this.form.period_to) return '请选择节次：先点起始节，再点结束节'
      if (!this.form.arrive_before) return '请选择预计到岗时间'
      return ''
    },
    // 3.7：同节次同名课程但老师/班级不同 → 软提示（不阻断，后端仅拦完整键全等）
    async conflictHint() {
      try {
        const due = await Store.rpc('my_due', {})
        const me = Store.store.me || {}
        const cur = {
          owner_id: me.id, check_date: this.checkDate,
          period_from: Number(this.form.period_from), period_to: Number(this.form.period_to),
          course_name: this.form.course_name, teacher: this.form.teacher,
          classes: (this.form.classes || []).filter((c) => c.code).map((c) => ({ code: c.code })),
        }
        let hint = ''
        ;(due || []).forEach((p) => {
          if (!hint && String(p.id) !== String(this.id || '')) {
            const t = U.sessionHint(p, cur)
            if (t) hint = t
          }
        })
        return hint
      } catch (e) { return '' }
    },
    async save() {
      const bad = this.check()
      if (bad) { this.err = bad; return }
      this.err = ''
      // T2 软限制：年级不同只提示、不阻断（PRD 明确「提示后仍可提交」）
      if (this.gradeMixed) U.toast('当前填写班级的年级不同！', 'bad')
      const hint = await this.conflictHint()
      if (hint) U.toast(hint)
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
          total_expected: this.totalParsed,
          arrive_before: this.form.arrive_before,
        }
        if (this.id) payload.id = this.id
        const row = await Store.rpc('plan_save', { p_payload: payload })
        if (window.Draft) Draft.del(this.draftKey)
        U.toast('已保存到第 ' + row.week_no + ' 周')
        Store.clearRpcCache()
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
        Store.clearRpcCache()
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
            <span class="ibox" :class="classOn(c) ? 'ibox-mine' : ''" v-for="(c, ci) in p._classes" :key="c + ci">{{ c }}</span>
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
            <span class="ibox" :class="classOn(c) ? 'ibox-mine' : ''" v-for="(c, ci) in p._classes" :key="c + ci">{{ c }}</span>
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

    <button class="btn btn-primary btn-block btn-lg mt12" @click="newPlan">新增选课</button>
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
        const key = U.sessionKey(p)
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
      return '待查课'
    },
    planBadge(p) {
      if (p.status === 'void') return ''
      if (p.status === 'submitted') return 'badge-ok'
      return 'badge-warn'
    },
    edit(p) { Store.nav('/plan/' + p.id) },
    newPlan() { Store.nav('/plan/new?week=' + Math.min(this.nextWeek, this.maxWeek)) },
    async load() {
      if (!Store.store.semester) return
      try {
        const [wk, wkNext] = await Promise.all([
          Store.rpcCached('my_week', { p_week: this.week }),
          this.nextWeek <= this.maxWeek ? Store.rpcCached('my_week', { p_week: this.nextWeek }) : Promise.resolve({ plans: [] }),
        ])
        this.currentPlans = (wk.plans || []).slice().sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
        this.nextPlans = ((wkNext && wkNext.plans) || []).slice().sort((a, b) => (a.check_date < b.check_date ? -1 : 1))
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      }
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

    <div class="center tiny muted mt16">学风查课 v{{ version }}</div>
  </div>`,

  computed: {
    me() { return Store.store.me || {} },
    isAdmin() { return Store.store.isAdmin },
    dark() { return Store.store.theme === 'dark' },
    version() { return (window.APP_CONFIG && window.APP_CONFIG.version) || '' },
  },
  methods: {
    back() { Store.nav('/') },
    goChange() { Store.nav('/change') },
    toggleTheme() { Store.toggleTheme() },
    logout() { Store.logout() },
  },
}
