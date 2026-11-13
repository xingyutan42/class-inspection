// 成员有效查课次数：按 docs/PRD-3.5-成员有效查课次数.md 实现
// 口径：有效次数 = class_stats_week 的 member.total（与看板「按成员 → 有效」同源，前端不重算）
//       记录数 = member.records
// 排除成员（stats_excluded）：文案替代数字、固定排末尾、不参与数值排序
// 标记来源（class_stats_week 不返回该字段）：管理员取 staff_list，成员取 Store.store.me
window.Views = window.Views || {}

// 测试账号（学号 TEST 开头或姓名以「测试」开头）不计入统计
function isTestMember(m) {
  if (!m) return false
  return /^TEST/i.test(String(m.student_no || '')) || /^测试/.test(String(m.name || ''))
}

const EXCLUDE_TEXT = '大三人员由管理员确认'

window.Views.ClassStatsView = {
  template: `
  <div class="shell" :class="{ 'shell-wide': isAdmin }">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>有效查课次数</h1>
      <div class="side right">
        <button class="btn btn-sm" v-if="isAdmin" @click="exportXlsx" :disabled="busy || !data">导出 Excel</button>
      </div>
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
      <div class="card mt12">
        <div class="weeknav">
          <button class="btn btn-sm" :disabled="selWeek <= 1" @click="shift(-1)">‹ 上周</button>
          <div class="cur">
            <div class="w">第 <span class="w-num">{{ selWeek }}</span> 周</div>
            <div class="d">{{ rangeText }}</div>
          </div>
          <button class="btn btn-sm" :disabled="selWeek >= maxWeek" @click="shift(1)">下周 ›</button>
        </div>
        <div class="tiny muted center mt8">按本人负责班级累计；一条记录查了几个班，每个班各记 1 次</div>
      </div>

      <div class="card mt12">
        <div class="chips">
          <div class="chip" :class="{ on: sortKey === 'name' }" @click="sortKey = 'name'">姓名</div>
          <div class="chip" :class="{ on: sortKey === 'valid_desc' }" @click="sortKey = 'valid_desc'">有效次数 ↓</div>
          <div class="chip" :class="{ on: sortKey === 'valid_asc' }" @click="sortKey = 'valid_asc'">有效次数 ↑</div>
          <div class="chip" :class="{ on: sortKey === 'rec_desc' }" @click="sortKey = 'rec_desc'">记录数 ↓</div>
        </div>
      </div>

      <div class="card mt12">
        <div class="tablewrap">
          <table class="tb">
            <thead>
              <tr>
                <th>成员</th>
                <th class="num">有效查课次数</th>
                <th class="num">查课记录数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="empty">
                <td colspan="3" class="center muted" style="padding:26px">{{ emptyText }}</td>
              </tr>
              <tr v-for="r in sortedRows" :key="r.key" v-else>
                <td class="strong">{{ r.name }}</td>
                <td class="num" v-if="r.excluded" style="color:var(--warn);font-size:11.5px;font-weight:600">{{ excludeText }}</td>
                <td class="num" v-else :style="r.valid ? '' : 'color:var(--muted);font-weight:600'">{{ r.valid }}</td>
                <td class="num muted" v-if="r.excluded">—</td>
                <td class="num" v-else>{{ r.rec }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="tiny muted center mt12" v-if="legacy">按周统计暂未启用，当前显示全学期累计。</div>
    </template>
  </div>`,

  data() {
    return {
      loading: true, err: '', data: null, busy: false, legacy: false,
      selWeek: 1, sortKey: 'valid_desc', excludeText: EXCLUDE_TEXT,
      excludeMap: {},
    }
  },
  computed: {
    isAdmin() { return !!(this.data && this.data.is_admin) },
    meId() { return (Store.store.me && Store.store.me.id) || 0 },
    maxWeek() {
      const d = this.data
      if (d && d.total_weeks) return Number(d.total_weeks) || 18
      const sem = Store.store.semester
      return sem ? Number(sem.total_weeks) || 18 : 18
    },
    rangeText() {
      const sem = Store.store.semester
      if (!sem || !this.selWeek) return ''
      const start = U.weekStartOf(sem.start_monday, this.selWeek)
      if (!start) return ''
      return U.md(start) + ' — ' + U.md(U.addDays(start, 6))
    },
    // 归一化后的行数据：valid 取 total，rec 取 records，excluded 取账号标记
    members() {
      const admin = !!(this.data && this.data.is_admin)
      const meExcluded = !!(Store.store.me && Store.store.me.stats_excluded)
      const list = ((this.data && this.data.members) || []).filter((m) => !isTestMember(m))
      const onlyMine = admin ? list : list.filter((m) => Number(m.id) === Number(this.meId))
      return onlyMine.map((m) => ({
        key: 'm' + m.id,
        id: m.id,
        name: m.name,
        valid: Number(m.total) || 0,
        rec: Number(m.records) || 0,
        excluded: admin ? !!this.excludeMap[m.id] : meExcluded,
        raw: m,
      }))
    },
    sortedRows() {
      const k = this.sortKey
      const byName = (a, b) => U.nameCompare(a.name, b.name)
      const exclLast = (a, b) => (a.excluded === b.excluded ? 0 : (a.excluded ? 1 : -1))
      const list = this.members.slice()
      if (k === 'name') list.sort((a, b) => exclLast(a, b) || byName(a, b))
      else if (k === 'valid_asc') list.sort((a, b) => exclLast(a, b) || (a.valid - b.valid) || (b.rec - a.rec) || byName(a, b))
      else if (k === 'rec_desc') list.sort((a, b) => exclLast(a, b) || (b.rec - a.rec) || (b.valid - a.valid) || byName(a, b))
      else list.sort((a, b) => exclLast(a, b) || (b.valid - a.valid) || (b.rec - a.rec) || byName(a, b))
      return list
    },
    // 下周尚未开始且无任何记录时给空状态，避免整屏 0 造成误判
    empty() {
      if (!this.data) return false
      if (!this.members.length) return true
      const now = Number(Store.weekNow()) || 1
      return this.selWeek > now && this.members.every((m) => !m.valid && !m.rec)
    },
    emptyText() {
      if (!this.members.length) return '还没有可统计的成员'
      const now = Number(Store.weekNow()) || 1
      return this.selWeek > now ? '下周还没有开始，暂无查课记录' : '这一周还没有查课记录'
    },
  },
  mounted() {
    this.selWeek = Math.max(1, Math.min(Store.weekMax() || 18, Store.weekNow() || 1))
    this.load()
  },
  methods: {
    back() {
      if (history.length > 1) history.back()
      else Store.nav(Store.store.isAdmin ? '/me' : '/')
    },
    shift(d) {
      const w = this.selWeek + d
      if (w < 1 || w > this.maxWeek) return
      this.selWeek = w
      this.load()
    },
    async load() {
      this.loading = true
      this.err = ''
      try {
        this.data = await Store.rpcCached('class_stats_week', {
          p_user_id: null,
          p_week_from: this.selWeek,
          p_week_to: this.selWeek,
        })
        this.legacy = false
        if (this.data && this.data.week_from && Number(this.data.week_from) !== this.selWeek) {
          this.selWeek = Number(this.data.week_from) || this.selWeek
        }
        await this.loadExcludeMap()
      } catch (e) {
        const msg = U.errText(e)
        if (/接口暂时不可用/.test(msg)) {
          // 兜底：旧接口全学期累计（口径与旧版一致）
          try {
            const d = await Store.rpcCached('class_stats', { p_user_id: null })
            if (!d) throw new Error('接口暂时不可用')
            d.week_from = 1
            d.week_to = Store.store.semester ? Number(Store.store.semester.total_weeks) || 18 : 18
            this.data = d
            this.legacy = true
            this.selWeek = 1
            await this.loadExcludeMap()
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
    // 管理员从 staff_list 取 stats_excluded；失败不阻塞页面（退化为全员显示数字）
    async loadExcludeMap() {
      if (!this.data || !this.data.is_admin) { this.excludeMap = {}; return }
      try {
        const staff = await Store.rpcCached('staff_list', {}, 120000)
        const map = {}
        ;(staff || []).forEach((s) => { if (s && s.stats_excluded) map[s.id] = true })
        this.excludeMap = map
      } catch (e) {
        this.excludeMap = {}
      }
    },
    async exportXlsx() {
      if (!this.data || this.busy) return
      this.busy = true
      try {
        const r = await window.XLS.exportClassStats({
          members: this.members.map((m) => Object.assign({}, m.raw, { total: m.valid, records: m.rec, stats_excluded: m.excluded })),
          semester: (this.data.semester && this.data.semester.name) || '',
          weekLabel: '第' + this.selWeek + '周',
        })
        U.toast('已导出：' + r.name)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.busy = false
      }
    },
  },
}
