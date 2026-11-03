// 班级查课次数：成员看自己，管理员看全部成员（支持按周区间、排序与各班展开）
window.Views = window.Views || {}

// 测试账号（学号 TEST 开头或姓名以「测试」开头）不计入次数统计，只在成员管理中可见
function isTestMember(m) {
  if (!m) return false
  return /^TEST/i.test(String(m.student_no || '')) || /^测试/.test(String(m.name || ''))
}

// 由班级号推算年级：取第 5-6 位两位年份（如 13002401 → 24 级）
// 学年从 9 月算起：2026-27 学年时 26 级=大一、25 级=大二、24 级=大三
function classGrade(code) {
  const yy = Number(String(code || '').slice(4, 6))
  if (!yy) return 0
  const now = new Date()
  const acadStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  const g = acadStart - (2000 + yy) + 1
  return g >= 1 && g <= 3 ? g : 0
}

// 同一成员多班级取主要年级（出现次数最多的年级）
function memberGradeOf(m) {
  const tally = {}
  ;(m.classes || []).forEach((c) => {
    const g = classGrade(c.code)
    if (g) tally[g] = (tally[g] || 0) + 1
  })
  const keys = Object.keys(tally).map(Number)
  if (!keys.length) return 0
  keys.sort((a, b) => tally[b] - tally[a] || a - b)
  return keys[0]
}

window.Views.ClassStatsView = {
  template: `
  <div class="shell" :class="{ 'shell-wide': isAdmin }">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>班级查课次数</h1>
      <div class="side right"></div>
    </div>

    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>加载失败</h3>
        <div class="sub errmsg">{{ err }}</div>
        <button class="btn btn-primary btn-block" @click="load">重试</button>
        <button class="btn btn-block mt8" @click="err = ''">关闭</button>
      </div>
    </div>

    <div class="card mt12" v-if="loading"><div class="empty">加载中…</div></div>

    <template v-else-if="data">
      <div class="card mt12" v-if="legacy">
        <div class="notice">按周统计暂未启用，当前显示全学期累计。</div>
      </div>

      <div class="card mt12" v-if="!legacy">
        <div class="row wrap">
          <select class="select" style="max-width:120px" v-model.number="selFrom" @change="reload">
            <option v-for="w in weeks" :key="'f' + w" :value="w">第 {{ w }} 周</option>
          </select>
          <span class="muted tiny">至</span>
          <select class="select" style="max-width:120px" v-model.number="selTo" @change="reload">
            <option v-for="w in weeks" :key="'t' + w" :value="w">第 {{ w }} 周</option>
          </select>
          <button class="btn btn-sm" @click="prevWeek">上周</button>
          <button class="btn btn-sm" @click="thisWeek">本周</button>
          <button class="btn btn-sm" @click="nextWeek">下周</button>
          <button class="btn btn-sm" @click="allWeeks">全学期</button>
        </div>
        <div class="hint">统计与导出都按所选周区间计算；默认第 1 周至本周。</div>
      </div>

      <div class="card mt12">
        <div class="hd">
          <h2>{{ semName }} · {{ weekLabel }}</h2>
          <span class="tiny muted">{{ isAdmin ? '全体成员 ' + members.length + ' 人' : '我的负责班级' }}</span>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="n">{{ totalClasses }}</div><div class="t">{{ isAdmin ? '总班级' : '负责班级' }}</div></div>
          <div class="stat ok"><div class="n">{{ totalClasses ? coveredClasses + ' / ' + totalClasses : '—' }}</div><div class="t">已覆盖班级</div></div>
          <div class="stat"><div class="n">{{ totalCount }}</div><div class="t">查课次数</div></div>
        </div>
        <div class="tiny muted mt12">按本人提交的查课记录统计；一条记录查了几个班，每个班各记 1 次。统计范围：{{ weekLabel }}，共 {{ totalRecords }} 条记录。</div>
      </div>

      <div class="mt8" v-if="!isAdmin">
        <div class="mem-card" v-for="m in members" :key="m.id">
          <div class="mem-top">
            <div class="mem-name">{{ m.name }}</div>
            <span class="mem-no">{{ m.student_no }}</span>
          </div>
          <div class="mem-meta">
            <span v-if="m.duty_grade">{{ m.duty_grade }}</span>
            <span>{{ m.assigned_text || '未分配负责班级' }}</span>
          </div>
          <div class="cls-stat" v-if="m.classes.length">
            <div class="cls-stat-item" v-for="c in m.classes" :key="c.code" :class="{ zero: !c.count }">
              <div class="cls-stat-code"><span v-if="c.grade" class="cls-stat-grade">{{ c.grade }}</span>{{ c.code }}</div>
              <div class="cls-stat-n">{{ c.count }}<span>次</span></div>
              <div class="cls-stat-d">{{ c.last_date ? '最近 ' + U.md(c.last_date) : '还没查过' }}</div>
            </div>
          </div>
          <div class="muted sm mt8" v-else>未分配负责班级，请联系管理员</div>
          <div class="row between tiny muted mt12" v-if="m.classes.length">
            <span>已覆盖 {{ m.covered }} / {{ m.classes.length }}</span>
            <span>查课记录 {{ m.records }} 条</span>
          </div>
        </div>
        <div class="empty" v-if="!members.length">还没有可统计的成员</div>
      </div>

      <div class="mt8" v-if="isAdmin">
        <div class="seg mt12" style="flex-wrap:wrap">
          <span class="seg-i" :class="{ on: sortKey === 'total_desc' }" @click="sortKey = 'total_desc'">次数从多到少</span>
          <span class="seg-i" :class="{ on: sortKey === 'total_asc' }" @click="sortKey = 'total_asc'">次数从少到多</span>
          <span class="seg-i" :class="{ on: sortKey === 'name' }" @click="sortKey = 'name'">按姓名</span>
          <span class="seg-i" :class="{ on: sortKey === 'grade' }" @click="sortKey = 'grade'">按年级</span>
        </div>
        <div class="mem-card" v-for="m in sortedMembers" :key="'a' + m.id">
          <div class="mem-top" style="cursor:pointer" @click="toggleExpand(m.id)">
            <div class="mem-name">
              {{ m.name }}
              <span class="badge badge-pri" v-if="memberGrade(m)">{{ memberGrade(m) === 1 ? '大一' : (memberGrade(m) === 2 ? '大二' : '大三') }}</span>
            </div>
            <span class="mem-no">{{ m.student_no }}</span>
          </div>
          <div class="row between tiny muted mt8" style="cursor:pointer;flex-wrap:wrap;gap:4px 10px" @click="toggleExpand(m.id)">
            <span>负责班级 {{ m.classes.length }}</span>
            <span>已覆盖 {{ m.covered }} / {{ m.classes.length }}</span>
            <span>记录 {{ m.records }} 条</span>
            <span>合计 <b>{{ m.total }}</b> 次</span>
          </div>
          <div class="cls-stat" v-if="expanded[m.id] && m.classes.length">
            <div class="cls-stat-item" v-for="c in m.classes" :key="c.code" :class="{ zero: !c.count }">
              <div class="cls-stat-code"><span v-if="c.grade" class="cls-stat-grade">{{ c.grade }}</span>{{ c.code }}</div>
              <div class="cls-stat-n">{{ c.count }}<span>次</span></div>
              <div class="cls-stat-d">{{ c.last_date ? '最近 ' + U.md(c.last_date) : '还没查过' }}</div>
            </div>
          </div>
          <div class="muted sm mt8" v-if="expanded[m.id] && !m.classes.length">未分配负责班级</div>
          <div class="tiny muted mt8" v-if="m.classes.length">{{ expanded[m.id] ? '点击收起各班次数' : '点击展开各班次数' }}</div>
        </div>
        <div class="empty" v-if="!members.length">还没有可统计的成员</div>
      </div>
    </template>
  </div>`,

  data() {
    return { U, loading: true, err: '', data: null, sortKey: 'total_desc', expanded: {}, selFrom: 1, selTo: 1, legacy: false }
  },
  computed: {
    isAdmin() { return !!(this.data && this.data.is_admin) },
    members() { return ((this.data && this.data.members) || []).filter((m) => !isTestMember(m)) },
    semName() {
      return (this.data && this.data.semester && this.data.semester.name) || '未设置学期'
    },
    weeks() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const list = []
      for (let w = 1; w <= max; w++) list.push(w)
      return list
    },
    weekLabel() {
      if (!this.data) return ''
      if (this.data.week_label) return this.data.week_label
      return this.data.week_from === this.data.week_to
        ? '第' + this.data.week_from + '周'
        : '第' + this.data.week_from + '-' + this.data.week_to + '周'
    },
    totalClasses() { return this.data ? Number(this.data.total_classes) || 0 : 0 },
    coveredClasses() { return this.data ? Number(this.data.covered_classes) || 0 : 0 },
    totalCount() { return this.members.reduce((s, m) => s + (Number(m.total) || 0), 0) },
    totalRecords() { return this.members.reduce((s, m) => s + (Number(m.records) || 0), 0) },
    sortedMembers() {
      const list = this.members.slice()
      const k = this.sortKey
      if (k === 'name') list.sort((a, b) => U.nameCompare(a.name, b.name))
      else if (k === 'grade') list.sort((a, b) => (memberGradeOf(a) || 9) - (memberGradeOf(b) || 9) || U.nameCompare(a.name, b.name))
      else if (k === 'total_asc') list.sort((a, b) => (Number(a.total) || 0) - (Number(b.total) || 0) || U.nameCompare(a.name, b.name))
      else list.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0) || U.nameCompare(a.name, b.name))
      return list
    },
  },
  mounted() {
    this.selFrom = 1
    this.selTo = Math.max(1, Math.min(Store.weekMax(), Store.weekNow() || 1))
    this.load()
  },
  methods: {
    back() {
      if (history.length > 1) history.back()
      else Store.nav(Store.store.isAdmin ? '/me' : '/')
    },
    clampWeek(w) {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      return Math.max(1, Math.min(max, Number(w) || 1))
    },
    async load() {
      this.loading = true
      this.err = ''
      try {
        this.data = await Store.rpcCached('class_stats_week', {
          p_user_id: null,
          p_week_from: this.selFrom,
          p_week_to: this.selTo,
        })
        this.legacy = false
        this.selFrom = Number(this.data.week_from) || this.selFrom
        this.selTo = Number(this.data.week_to) || this.selTo
      } catch (e) {
        const msg = U.errText(e)
        if (/接口暂时不可用/.test(msg)) {
          try {
            const d = await Store.rpcCached('class_stats', { p_user_id: null })
            const all = []
            const cov = []
            ;(d.members || []).forEach((m) => {
              ;(m.classes || []).forEach((c) => {
                all.push(c.code)
                if (Number(c.count) > 0) cov.push(c.code)
              })
            })
            d.week_from = 1
            d.week_to = Store.store.semester ? Store.store.semester.total_weeks : 18
            d.week_label = '全学期'
            d.total_classes = new Set(all).size
            d.covered_classes = new Set(cov).size
            this.data = d
            this.legacy = true
            this.selFrom = 1
            this.selTo = d.week_to
          } catch (e2) {
            this.err = U.errText(e2)
          }
        } else {
          this.err = msg
        }
      } finally {
        this.loading = false
      }
    },
    reload() {
      if (this.legacy) return
      if (this.selFrom > this.selTo) {
        const t = this.selFrom
        this.selFrom = this.selTo
        this.selTo = t
      }
      this.load()
    },
    thisWeek() {
      if (this.legacy) return
      const w = this.clampWeek(Store.weekNow())
      this.selFrom = w
      this.selTo = w
      this.load()
    },
    prevWeek() {
      if (this.legacy) return
      const w = this.clampWeek(Math.min(this.selFrom, this.selTo) - 1)
      this.selFrom = w
      this.selTo = w
      this.load()
    },
    nextWeek() {
      if (this.legacy) return
      const w = this.clampWeek(Math.max(this.selFrom, this.selTo) + 1)
      this.selFrom = w
      this.selTo = w
      this.load()
    },
    allWeeks() {
      if (this.legacy) return
      this.selFrom = 1
      this.selTo = Store.store.semester ? Store.store.semester.total_weeks : 18
      this.load()
    },
    toggleExpand(id) {
      this.expanded[id] = !this.expanded[id]
    },
    memberGrade(m) {
      return memberGradeOf(m)
    },
  },
}
