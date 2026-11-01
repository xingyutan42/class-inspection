// 管理员端：总览 / 计划 / 明细
window.Views = window.Views || {}

window.Views.AdminHome = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"></div>
      <h1>本周总览</h1>
      <div class="side right"><button class="iconbtn" @click="go('/admin/export')" title="导出">⤓</button></div>
    </div>

    <div class="card mt12">
      <div class="weeknav">
        <button class="btn btn-sm" @click="shift(-1)">‹ 上周</button>
        <div class="cur" style="text-align:center"><div class="w">第 {{ week }} 周</div><div class="d">{{ rangeText }}</div></div>
        <button class="btn btn-sm" :disabled="week >= maxWeek" @click="shift(1)">下周 ›</button>
      </div>
      <div class="progress"><i :style="{width: donePct + '%'}"></i></div>
      <div class="row between tiny muted mt8">
        <span>已查课 {{ stats.done }} / 应查 {{ stats.plans }} 节</span>
        <span>{{ donePct }}%</span>
      </div>
    </div>

    <div class="stat-grid two">
      <div class="stat" :class="avgRate === null ? '' : 'ok'">
        <div class="n" :style="avgRate === null ? 'color:var(--muted);font-size:17px;font-weight:600' : ''">
          {{ avgRate === null ? '暂无' : avgRate + '%' }}
        </div>
        <div class="t">平均出勤率</div>
      </div>
      <div class="stat" :class="stats.overdue ? 'warn' : ''"><div class="n">{{ stats.overdue }}</div><div class="t">往周漏填</div></div>
    </div>

    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">成员完成情况 <span class="tiny muted">（{{ users.length }} 人）</span></h2>
      <div class="row" style="gap:8px">
        <div class="seg" v-if="!memCollapsed">
          <span class="seg-i" :class="{ on: memFilter === 'all' }" @click="setFilter('all')">全部 {{ users.length }}</span>
          <span class="seg-i" :class="{ on: memFilter === 'pending' }" @click="setFilter('pending')">未查课 {{ pendingUsers.length }}</span>
          <span class="seg-i" :class="{ on: memFilter === 'none' }" @click="setFilter('none')">未选课 {{ noTaskUsers.length }}</span>
        </div>
        <button class="btn btn-sm" @click="toggleMem">{{ memCollapsed ? '展开' : '收起' }}</button>
      </div>
    </div>

    <template v-if="!memCollapsed">
    <div class="tiny muted mt8">
      课取消或调课？在成员的未查课清单里点「编辑」或「作废」。
    </div>

    <div class="tablewrap mt8 adm-wide-only">
      <table class="tb">
        <thead>
          <tr><th>成员</th><th class="num">计划</th><th class="num">已填</th><th class="num">未填</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="m in filteredUsers" :key="m.id">
            <tr class="clickable" @click="toggle(m.id)">
              <td><div class="strong">{{ m.name }}</div><div class="tiny muted">{{ m.student_no }}</div></td>
              <td class="num">{{ m.planned }}</td>
              <td class="num">{{ m.done }}</td>
              <td class="num" :style="m.pending ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'">{{ m.pending }}</td>
              <td class="tiny muted">{{ open === m.id ? '收起' : '展开' }}</td>
            </tr>
            <tr v-if="open === m.id" class="expand-tr">
              <td colspan="5">
                <div class="expand-hd">
                  <span class="strong">{{ m.name }} · 未查课清单</span>
                  <span class="tiny muted">{{ m.pending }} 节</span>
                </div>
                <div class="list" v-if="m.pending_list && m.pending_list.length">
                  <div class="litem" v-for="p in m.pending_list" :key="p.id">
                    <div class="row between">
                      <div class="t1">{{ p.course_name }} <span class="muted sm">· {{ p.class_name }}</span></div>
                      <span class="badge" :class="p.week_no < week ? 'badge-bad' : 'badge-warn'">
                        {{ p.week_no < week ? '第' + p.week_no + '周' : '待填' }}
                      </span>
                    </div>
                    <div class="t2">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}<span v-if="p.room"> · {{ p.room }}</span><span v-if="p.arrive_before"> · {{ U.arriveText(p.arrive_before) }}</span></div>
                    <div class="row mt8" style="gap:8px">
                      <button class="btn btn-sm" @click.stop="go('/admin/plans/' + p.id)">编辑</button>
                      <button class="btn btn-sm" @click.stop="voidPlan(p)">作废</button>
                    </div>
                  </div>
                </div>
                <div class="muted sm" v-else>本周没有未查课的安排</div>
                <div class="tiny muted mt8">补填后会自动从清单移除。</div>
                <div class="divider"></div>
                <div class="expand-hd">
                  <span class="strong">{{ m.name }} · 本周记录</span>
                  <span class="tiny muted">{{ recordsOf(m).length }} 条</span>
                </div>
                <div class="list" v-if="recordsOf(m).length">
                  <div class="litem" v-for="r in recordsOf(m)" :key="r.id">
                    <div class="row between">
                      <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
                      <span class="tiny muted">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span>
                    </div>
                    <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
                    <div class="mt8" v-if="r.photosLoaded && r.photos.length">
                      <div class="photo-row" v-for="(ph, i) in r.photos" :key="ph.id">
                        <div class="photo-row-img" @click.stop="openFullPhoto(ph)">
                          <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
                          <div v-else class="photo-ph">原图</div>
                        </div>
                        <div class="photo-row-meta">
                          <div class="sm"><span class="muted">拍摄</span> {{ fmtTime(ph.taken_at) }}</div>
                          <div class="sm"><span class="muted">上传</span> {{ fmtTime(ph.created_at) }}</div>
                        </div>
                      </div>
                    </div>
                    <div class="tiny muted mt8" v-else-if="r.photosLoaded">无照片</div>
                    <div class="row mt8" style="gap:8px">
                      <button class="btn btn-sm" @click.stop="go('/admin/records/' + r.id)">查看 / 修正</button>
                    </div>
                  </div>
                </div>
                <div class="muted sm" v-else>本周还没有记录</div>
              </td>
            </tr>
          </template>
          <tr v-if="!filteredUsers.length"><td colspan="5" class="center muted" style="padding:24px">{{ memFilter === 'pending' ? '本周没有人未查课' : (memFilter === 'none' ? '没有未选课的成员' : '还没有成员') }}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="adm-narrow-only mt8">
      <div class="mrow" v-for="m in filteredUsers" :key="m.id" @click="toggle(m.id)">
        <div class="mrow-top">
          <div>
            <span class="mrow-name">{{ m.name }}</span>
            <span class="mrow-no">{{ m.student_no }}</span>
          </div>
          <span class="badge" :class="m.pending ? 'badge-bad' : (m.planned ? 'badge-ok' : '')">
            {{ m.pending ? '未查课 ' + m.pending : (m.planned ? '已完成' : '未选课') }}
          </span>
        </div>
        <div class="mrow-nums">
          <span>计划<b>{{ m.planned }}</b></span>
          <span>已填<b>{{ m.done }}</b></span>
          <span>未填<b :class="{ bad: m.pending }">{{ m.pending }}</b></span>
        </div>
        <div class="mrow-expand" v-if="open === m.id" @click.stop>
          <div class="expand-hd">
            <span class="strong">{{ m.name }} · 未查课清单</span>
            <div class="row" style="gap:8px">
              <span class="tiny muted">{{ m.pending }} 节</span>
              <span class="tiny link" @click="open = ''">收起</span>
            </div>
          </div>
          <div class="list" v-if="m.pending_list && m.pending_list.length">
            <div class="litem" v-for="p in m.pending_list" :key="p.id">
              <div class="row between">
                <div class="t1">{{ p.course_name }} <span class="muted sm">· {{ p.class_name }}</span></div>
                <span class="badge" :class="p.week_no < week ? 'badge-bad' : 'badge-warn'">
                  {{ p.week_no < week ? '第' + p.week_no + '周' : '待填' }}
                </span>
              </div>
              <div class="t2">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }} {{ U.periodText(p.period_from, p.period_to) }}<span v-if="p.room"> · {{ p.room }}</span><span v-if="p.arrive_before"> · {{ U.arriveText(p.arrive_before) }}</span></div>
              <div class="row mt8" style="gap:8px">
                <button class="btn btn-sm" @click.stop="go('/admin/plans/' + p.id)">编辑</button>
                <button class="btn btn-sm" @click.stop="voidPlan(p)">作废</button>
              </div>
            </div>
          </div>
          <div class="muted sm" v-else>本周没有未查课的安排</div>
          <div class="tiny muted mt8">补填后会自动从清单移除。</div>
          <div class="divider"></div>
          <div class="expand-hd">
            <span class="strong">{{ m.name }} · 本周记录</span>
            <span class="tiny muted">{{ recordsOf(m).length }} 条</span>
          </div>
          <div class="list" v-if="recordsOf(m).length">
            <div class="litem" v-for="r in recordsOf(m)" :key="r.id">
              <div class="row between">
                <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
                <span class="tiny muted">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span>
              </div>
              <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
                <div class="mt8" v-if="r.photosLoaded && r.photos.length">
                  <div class="photo-row" v-for="(ph, i) in r.photos" :key="ph.id">
                    <div class="photo-row-img" @click.stop="openFullPhoto(ph)">
                      <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
                      <div v-else class="photo-ph">原图</div>
                    </div>
                    <div class="photo-row-meta">
                      <div class="sm"><span class="muted">拍摄</span> {{ fmtTime(ph.taken_at) }}</div>
                      <div class="sm"><span class="muted">上传</span> {{ fmtTime(ph.created_at) }}</div>
                    </div>
                  </div>
                </div>
                <div class="tiny muted mt8" v-else-if="r.photosLoaded">无照片</div>
              <div class="row mt8" style="gap:8px">
                <button class="btn btn-sm" @click.stop="go('/admin/records/' + r.id)">查看 / 修正</button>
              </div>
            </div>
          </div>
          <div class="muted sm" v-else>本周还没有记录</div>
        </div>
      </div>
      <div class="empty" v-if="!filteredUsers.length">{{ memFilter === 'pending' ? '本周没有人未查课' : (memFilter === 'none' ? '没有未选课的成员' : '还没有成员') }}</div>
    </div>
    </template>

    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">本周工作 · 已查课 <span class="tiny muted">（按课程时间）</span></h2>
      <div class="row" style="gap:8px">
        <span class="tiny muted">{{ workDone.length }} 条</span>
        <button class="btn btn-sm" @click="toggleWorkDone">{{ workDoneCollapsed ? '展开' : '收起' }}</button>
      </div>
    </div>

    <template v-if="!workDoneCollapsed">
    <div class="list mt8" v-if="workDone.length">
      <div class="litem" v-for="r in workDone" :key="'w' + r.id" style="cursor:default">
        <div class="row between">
          <div class="t1">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}</div>
          <span class="tiny muted">{{ r.owner_name }}</span>
        </div>
        <div class="t2">{{ r.class_name }} · 出勤 {{ r.actual_count }}/{{ r.expected_count }}<span v-if="r.arrive_before"> · {{ U.arriveText(r.arrive_before) }}</span></div>
        <div class="mt8" v-if="r.photosLoaded && r.photos.length">
          <div class="photo-row" v-for="(ph, i) in r.photos" :key="ph.id">
            <div class="photo-row-img" @click.stop="openFullPhoto(ph)">
              <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
              <div v-else class="photo-ph">原图</div>
            </div>
            <div class="photo-row-meta">
              <div class="sm"><span class="muted">拍摄</span> {{ fmtTime(ph.taken_at) }}</div>
              <div class="sm"><span class="muted">上传</span> {{ fmtTime(ph.created_at) }}</div>
            </div>
          </div>
        </div>
        <div class="tiny muted mt8" v-else-if="r.photosLoaded">无照片</div>
      </div>
    </div>
    <div class="card mt8" v-else><div class="muted sm">本周还没有已查课的记录</div></div>
    </template>

    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">本周工作 · 未查课 <span class="tiny muted">（按课程时间）</span></h2>
      <div class="row" style="gap:8px">
        <span class="tiny muted">{{ workPending.length }} 节</span>
        <button class="btn btn-sm" @click="toggleWorkPending">{{ workPendingCollapsed ? '展开' : '收起' }}</button>
      </div>
    </div>

    <template v-if="!workPendingCollapsed">
    <div class="list mt8" v-if="workPending.length">
      <div class="litem" v-for="r in workPending" :key="'p' + r.id" style="cursor:default">
        <div class="row between">
          <div class="t1">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}
            <span class="badge badge-bad">未查课</span>
          </div>
          <span class="tiny muted">{{ r.owner_name }}</span>
        </div>
        <div class="t2">{{ r.class_name }}<span v-if="r.room"> · {{ r.room }}</span><span v-if="r.arrive_before"> · {{ U.arriveText(r.arrive_before) }}</span> · 待填报</div>
      </div>
    </div>
    <div class="card mt8" v-else><div class="muted sm">本周没有未查课的安排</div></div>
    </template>

    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">本周已查记录</h2>
      <span class="tiny muted">{{ records.length }} 条</span>
    </div>

    <div class="list mt8" v-if="records.length">
      <div class="litem" v-for="r in records" :key="r.id">
        <div class="row between">
          <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
          <span class="badge" :class="r.discipline_tags && r.discipline_tags.length ? 'badge-bad' : 'badge-ok'">
            出勤 {{ r.actual_count }}/{{ r.expected_count }}
          </span>
        </div>
        <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · {{ r.owner_name }}<span v-if="r.arrive_before"> · {{ U.arriveText(r.arrive_before) }}</span></div>
        <div class="mt8" v-if="r.photosLoaded && r.photos.length">
          <div class="photo-row" v-for="(ph, i) in r.photos" :key="ph.id">
            <div class="photo-row-img" @click.stop="openFullPhoto(ph)">
              <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
              <div v-else class="photo-ph">原图</div>
            </div>
            <div class="photo-row-meta">
              <div class="sm"><span class="muted">拍摄</span> {{ fmtTime(ph.taken_at) }}</div>
              <div class="sm"><span class="muted">上传</span> {{ fmtTime(ph.created_at) }}</div>
            </div>
          </div>
        </div>
        <div class="tiny muted mt8" v-else-if="r.photosLoaded">无照片</div>
        <div class="row mt8" style="gap:8px">
          <button class="btn btn-sm" @click="go('/admin/records/' + r.id)">查看 / 修正</button>
          <button class="btn btn-sm" @click="returnRecord(r)">打回</button>
          <button class="btn btn-sm btn-danger" @click="removeRecord(r)">删除</button>
        </div>
      </div>
    </div>
    <div class="card mt8" v-else><div class="muted sm">本周还没有查课记录</div></div>

    <div class="mask mask-center" v-if="fullPhoto" @click.self="fullPhoto = null">
      <div class="sheet sheet-center" style="padding:10px">
        <img :src="fullPhoto.data || fullPhoto.thumb" style="width:100%;border-radius:10px;display:block" alt="原图">
        <div class="tiny muted mt8">拍摄 {{ fmtTime(fullPhoto.taken_at) }} · 上传 {{ fmtTime(fullPhoto.created_at) }}</div>
        <button class="btn btn-block mt8" @click="fullPhoto = null">关闭</button>
      </div>
    </div>
  </div>`,

  data() {
    return { U, week: 0, users: [], records: [], stats: { plans: 0, done: 0, expected: 0, actual: 0, overdue: 0 }, open: '', loading: true, memFilter: 'all', memCollapsed: (() => { try { return localStorage.getItem('xfc_mem_collapsed') === '1' } catch (e) { return false } })(), workDoneCollapsed: (() => { try { return localStorage.getItem('xfc_work_done_collapsed') === '1' } catch (e) { return false } })(), workPendingCollapsed: (() => { try { return localStorage.getItem('xfc_work_pending_collapsed') === '1' } catch (e) { return false } })(), photoLoading: false, fullPhoto: null }
  },
  computed: {
    sem() { return Store.store.semester },
    maxWeek() { return Store.store.semester ? Store.store.semester.total_weeks : 18 },
    rangeText() { return weekRangeText(this.week) },
    workDone() {
      return this.records.slice().sort((a, b) => {
        const da = String(a.check_date || ''), db = String(b.check_date || '')
        if (da !== db) return da < db ? -1 : 1
        const pa = Number(a.period_from) || 0, pb = Number(b.period_from) || 0
        if (pa !== pb) return pa - pb
        return Number(a.id) - Number(b.id)
      })
    },
    workPending() {
      const rows = []
      this.users.forEach((u) => {
        (u.pending_list || []).forEach((p) => {
          rows.push(Object.assign({}, p, { owner_name: u.name }))
        })
      })
      rows.sort((a, b) => {
        const da = String(a.check_date || ''), db = String(b.check_date || '')
        if (da !== db) return da < db ? -1 : 1
        const pa = Number(a.period_from) || 0, pb = Number(b.period_from) || 0
        if (pa !== pb) return pa - pb
        return Number(a.id) - Number(b.id)
      })
      return rows
    },
    donePct() { return this.stats.plans ? Math.round((this.stats.done / this.stats.plans) * 100) : 0 },
    avgRate() {
      const e = Number(this.stats.expected) || 0
      const a = Number(this.stats.actual) || 0
      if (!e) return null
      return Math.round((a / e) * 1000) / 10
    },
    pendingUsers() { return this.users.filter((u) => u.pending > 0) },
    noTaskUsers() { return this.users.filter((u) => !u.planned) },
    filteredUsers() {
      let list = this.users
      if (this.memFilter === 'pending') list = this.pendingUsers
      else if (this.memFilter === 'none') list = this.noTaskUsers
      return list.slice().sort((a, b) => U.nameCompare(a.name, b.name))
    },
  },
  mounted() {
    const saved = Number(localStorage.getItem('xfc_admin_week')) || 0
    this.week = (saved >= 1 && saved <= this.maxWeek) ? saved : Store.weekNow()
    this.load()
  },
  methods: {
    go(p) { Store.nav(p) },
    saveWeek() { try { localStorage.setItem('xfc_admin_week', String(this.week)) } catch (e) { /* 隐私模式忽略 */ } },
    shift(d) {
      const w = this.week + d
      if (w < 1 || w > this.maxWeek) return
      this.week = w
      this.open = ''
      this.saveWeek()
      this.load()
    },
    toggle(id) { this.open = this.open === id ? '' : id },
    toggleMem() {
      this.memCollapsed = !this.memCollapsed
      try { localStorage.setItem('xfc_mem_collapsed', this.memCollapsed ? '1' : '0') } catch (e) { /* 隐私模式忽略 */ }
    },
    setFilter(f) { this.memFilter = f; this.open = '' },
    async voidPlan(p) {
      if (!window.confirm(`作废 ${p.owner_name} 的「${p.course_name}」？\n\n作废后不再计入未查课统计。`)) return
      try {
        await Store.rpc('plan_void', { p_id: p.id })
        U.toast('已作废')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    recordsOf(m) { return this.records.filter((r) => r.owner_id === m.id) },
    fmtTime(t) { return t ? U.shortTime(t) : '未知' },
    toggleWorkDone() {
      this.workDoneCollapsed = !this.workDoneCollapsed
      try { localStorage.setItem('xfc_work_done_collapsed', this.workDoneCollapsed ? '1' : '0') } catch (e) { /* 隐私模式忽略 */ }
    },
    toggleWorkPending() {
      this.workPendingCollapsed = !this.workPendingCollapsed
      try { localStorage.setItem('xfc_work_pending_collapsed', this.workPendingCollapsed ? '1' : '0') } catch (e) { /* 隐私模式忽略 */ }
    },
    async loadRecordPhotos() {
      for (const r of this.records) {
        if (r.photosLoaded) continue
        try {
          const list = await Store.rpc('photo_list', { p_record_id: r.id }) || []
          r.photos = list.map((p) => ({ id: p.id, thumb: p.thumb || '', taken_at: p.taken_at, created_at: p.created_at }))
          r.photosLoaded = true
        } catch (e) { /* 单条失败忽略 */ }
      }
    },
    async openFullPhoto(ph) {
      if (!ph) return
      if (ph.data) { this.fullPhoto = ph; return }
      const hit = window.PhotoCache ? await PhotoCache.get(ph.id) : null
      if (hit && hit.data) {
        ph.data = hit.data
        if (!ph.thumb && hit.thumb) ph.thumb = hit.thumb
        this.fullPhoto = ph
        return
      }
      this.photoLoading = true
      try {
        const d = await Store.rpc('photo_get', { p_id: ph.id })
        ph.data = d.data
        if (!ph.thumb && d.thumb) ph.thumb = d.thumb
        if (window.PhotoCache) PhotoCache.put(ph.id, { thumb: ph.thumb, data: d.data })
        this.fullPhoto = ph
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.photoLoading = false }
    },
    async returnRecord(r) {
      if (!window.confirm(`打回 ${r.owner_name} 的「${r.course_name} · ${r.class_name}」？\n\n记录将删除，照片与修改留痕一并清除。\n若来自选课计划，计划会回到「待填报」，成员可重新填写。`)) return
      try {
        await Store.rpc('record_delete', { p_id: r.id })
        U.toast('已打回，成员可重新填报')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async removeRecord(r) {
      if (!window.confirm(`彻底删除 ${r.owner_name} 的「${r.course_name} · ${r.class_name}」？\n\n记录、照片、修改留痕完全删除，不可恢复。\n若来自选课计划，该计划也会一并删除。`)) return
      try {
        await Store.rpc('record_delete_hard', { p_id: r.id })
        U.toast('已彻底删除')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async load() {
      if (!Store.store.semester) return
      this.loading = true
      try {
        const d = await Store.rpc('admin_week', { p_week: this.week })
        this.users = d.users || []
        this.records = d.records || []
        this.stats = d.stats || this.stats
        this.loadRecordPhotos()
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
  },
}

/* 计划管理页已停用（功能并入总览），以下组件不再使用 */
window.Views.AdminPlans_DEPRECATED = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="go('/admin')">‹</button></div>
      <h1>计划管理</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="row wrap">
        <select class="select" style="max-width:180px" v-model.number="week" @change="onWeekChange">
          <option v-for="w in weekList" :key="w" :value="w">第 {{ w }} 周</option>
        </select>
        <select class="select" style="max-width:200px" v-model="statusFilter" @change="load">
          <option value="">全部状态</option>
          <option value="planned">待填报</option>
          <option value="submitted">已提交</option>
          <option value="void">已作废</option>
        </select>
      </div>
    </div>

    <div class="tablewrap mt12">
      <table class="tb">
        <thead><tr><th>日期</th><th>节次</th><th>到岗</th><th>课程</th><th>班级</th><th>成员</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in plans" :key="p.id">
            <td class="num">{{ U.md(p.check_date) }} {{ U.weekdayCN(p.check_date) }}</td>
            <td>{{ U.periodText(p.period_from, p.period_to) }}</td>
            <td>{{ U.arriveText(p.arrive_before) || '—' }}</td>
            <td>{{ p.course_name }}</td>
            <td>{{ p.class_name }}</td>
            <td>{{ p.owner_name }}</td>
            <td>
              <span class="badge" :class="p.status === 'submitted' ? 'badge-ok' : (p.status === 'void' ? '' : 'badge-warn')">
                {{ p.status === 'submitted' ? '已提交' : (p.status === 'void' ? '已作废' : '待填报') }}
              </span>
            </td>
            <td>
              <div class="row" style="gap:6px">
                <button class="btn btn-sm" v-if="p.status === 'planned'" @click="go('/admin/plans/' + p.id + '?week=' + week)">编辑</button>
                <button class="btn btn-sm" v-if="p.status === 'planned'" @click="voidPlan(p)">作废</button>
              </div>
            </td>
          </tr>
          <tr v-if="!plans.length"><td colspan="8" class="center muted" style="padding:24px">这一周还没有计划</td></tr>
        </tbody>
      </table>
    </div>
    <div class="tiny muted mt8">作废后该节课不再计入未查课统计，但记录仍保留在库中。</div>
  </div>`,

  data() { return { U, week: 0, statusFilter: '', plans: [], loading: true, autoJump: true } },
  computed: {
    sem() { return Store.store.semester },
    weekList() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const list = []
      for (let w = 1; w <= max; w++) list.push(w)
      return list
    },
  },
  mounted() {
    const w = Number(this.$root.route.query.week)
    if (w >= 1 && w <= this.weekList.length) { this.week = w; this.autoJump = false }
    else this.week = Store.weekNow()
    this.load()
  },
  methods: {
    go(p) { Store.nav(p) },
    onWeekChange() { this.autoJump = false; this.load() },
    async load() {
      if (!Store.store.semester) return
      this.loading = true
      try {
        this.plans = await Store.rpc('admin_plans', { p_week: this.week, p_status: this.statusFilter }) || []
        // 打开时若本周没有任何计划、而下周有，自动跳到下周（成员通常在周末选下周的课）
        if (this.autoJump && !this.plans.length && this.week < Store.weekMax()) {
          this.autoJump = false
          this.week += 1
          return this.load()
        }
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.loading = false }
    },
    async voidPlan(p) {
      if (!window.confirm(`作废 ${p.owner_name} 的「${p.course_name}」？`)) return
      try {
        await Store.rpc('plan_void', { p_id: p.id })
        U.toast('已作废')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
  },
}
