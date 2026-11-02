// 管理员端：总览 / 计划 / 明细
window.Views = window.Views || {}

// 测试账号（学号 TEST 开头或姓名以「测试」开头）只在「成员管理」出现，
// 成员情况、课检、班级次数等业务列表一律隐藏，避免干扰真实统计。
function isTestAccount(u) {
  if (!u) return false
  return /^TEST/i.test(String(u.student_no || '')) || /^测试/.test(String(u.name || u.owner_name || ''))
}

window.Views.AdminHome = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"></div>
      <h1>{{ pageTitle }}</h1>
      <div class="side right"><button class="iconbtn" v-if="mode !== 'checks'" @click="go('/admin/export')" title="导出">⤓</button></div>
    </div>

    <div class="card mt12">
      <div class="weeknav">
        <button class="btn btn-sm" @click="shift(-1)">‹ 上周</button>
        <div class="cur" style="text-align:center"><div class="w">第 <span class="w-num">{{ week }}</span> 周</div><div class="d">{{ rangeText }}</div></div>
        <button class="btn btn-sm" :disabled="week >= maxWeek" @click="shift(1)">下周 ›</button>
      </div>
      <div class="progress"><i :style="{width: donePct + '%'}"></i></div>
      <div class="row between mt8 wkstat">
        <span>已查课 <b>{{ workDone.length }}</b> / 应查 <b>{{ weekCourses.length }}</b> 节</span>
        <span><b>{{ donePct }}%</b></span>
      </div>
    </div>

    <div class="stat-grid two" v-if="mode !== 'checks'">
      <div class="stat"><div class="n" style="color:var(--pri);font-size:26px">{{ stats.plans }}</div><div class="t">应查课</div></div>
      <div class="stat ok"><div class="n" style="font-size:26px">{{ stats.done }}</div><div class="t">已查课</div></div>
    </div>

    <template v-if="mode !== 'checks'">
    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">成员情况 <span class="tiny muted">（{{ users.length }} 人）</span></h2>
      <div class="row" style="gap:8px">
        <div class="seg" style="flex-wrap:wrap">
          <span class="seg-i" :class="{ on: memFilter === 'all' }" @click="setFilter('all')">全部 {{ users.length }}</span>
          <span class="seg-i" :class="{ on: memFilter === 'done' }" @click="setFilter('done')">已查完 {{ doneUsers.length }}</span>
          <span class="seg-i" :class="{ on: memFilter === 'pending' }" @click="setFilter('pending')">未查课 {{ pendingUsers.length }}</span>
          <span class="seg-i" :class="{ on: memFilter === 'none' }" @click="setFilter('none')">未选课 {{ noTaskUsers.length }}</span>
        </div>
      </div>
    </div>

    <div class="tiny muted mt8">
      课取消或调课？在成员的未查课清单里点课程进入编辑，或点「删除」删除选课。
    </div>

    <div class="tablewrap mt8 adm-wide-only">
      <table class="tb">
        <thead>
          <tr><th>成员</th><th class="num">应查</th><th class="num">已查</th><th class="num">未查</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="m in filteredUsers" :key="m.id">
            <tr class="clickable" @click="toggle(m.id)">
              <td><div class="strong">{{ m.name }}</div><div class="tiny muted">{{ m.student_no }}</div></td>
              <td class="num">{{ m.planned }}</td>
              <td class="num">{{ m.done }}</td>
              <td class="num" :style="pendingCount(m) ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'">{{ pendingCount(m) }}</td>
              <td class="tiny muted">{{ open === m.id ? '收起' : '展开' }}</td>
            </tr>
            <tr v-if="open === m.id" class="expand-tr">
              <td colspan="5">
                <div class="expand-hd">
                  <span class="strong">{{ m.name }} · 本周课程</span>
                  <span class="tiny muted">共 {{ memberCourses(m).length }} 节 · 已查 {{ recordsOf(m).length }} · 未查 {{ pendingCount(m) }}</span>
                </div>
                <div class="list" v-if="memberCourses(m).length">
                  <div class="litem" v-for="r in memberCourses(m)" :key="r._key" style="cursor:pointer" @click="openCourse(r)">
                    <div class="row between">
                      <div class="t1">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span><span class="ibox ibox-warn">预计到岗 {{ U.arriveText(r.arrive_before) || '—' }}</span></div>
                      <div class="row" style="gap:6px">
                        <span class="badge badge-bad" v-if="r._kind === 'pending' && r.note">打回</span>
                        <span class="badge badge-warn" v-if="r._kind === 'pending'">待填报</span>
                        <span class="badge badge-pri" v-if="r._kind === 'done' && r._resubmitted_at">重交</span> <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查课' : '未查课' }}</span>
                      </div>
                    </div>
                    <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-bad' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" style="cursor:pointer" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].open ? '收起' : '查看' }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].taken">拍摄 {{ photoMap[r.id].taken }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].created">上传 {{ photoMap[r.id].created }}</span></div>
          <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
                    <div class="row mt8" style="gap:8px" v-if="r._kind === 'pending'">
                      <button class="btn btn-sm" @click.stop="openReturn(r)">打回</button>
                      <button class="btn btn-sm btn-danger" @click.stop="removePlan(r)">删除</button>
                    </div>
                    <div class="row mt8" style="gap:8px" v-else>
                      <button class="btn btn-sm" @click.stop="go('/admin/records/' + r.id)">查看 / 修正</button>
                    </div>
                  </div>
                </div>
                <div class="muted sm" v-else>本周没有课程安排</div>
                <div class="tiny muted mt8">点击课程可查看详情或进入编辑；补填后状态自动更新。</div>
              </td>
            </tr>
          </template>
          <tr v-if="!filteredUsers.length"><td colspan="5" class="center muted" style="padding:24px">{{ memFilter === 'done' ? '本周还没有人查完' : (memFilter === 'pending' ? '本周没有人未查课' : (memFilter === 'none' ? '没有未选课的成员' : '还没有成员')) }}</td></tr>
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
          <span class="badge" :class="pendingCount(m) ? 'badge-bad' : (m.planned ? 'badge-ok' : '')">
            {{ pendingCount(m) ? '未查课 ' + pendingCount(m) : (m.planned ? '已完成' : '未选课') }}
          </span>
        </div>
        <div class="mrow-nums">
          <span>应查<b>{{ m.planned }}</b></span>
          <span>已查<b>{{ m.done }}</b></span>
          <span>未查<b :class="{ bad: pendingCount(m) }">{{ pendingCount(m) }}</b></span>
        </div>
        <div class="mrow-expand" v-if="open === m.id" @click.stop>
          <div class="expand-hd">
            <span class="strong">{{ m.name }} · 本周课程</span>
            <div class="row" style="gap:8px">
              <span class="tiny muted">共 {{ memberCourses(m).length }} 节 · 已查 {{ recordsOf(m).length }} · 未查 {{ pendingCount(m) }}</span>
              <span class="tiny link" @click="open = ''">收起</span>
            </div>
          </div>
          <div class="list" v-if="memberCourses(m).length">
            <div class="litem" v-for="r in memberCourses(m)" :key="r._key" style="cursor:pointer" @click="openCourse(r)">
              <div class="row between">
                <div class="t1">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span><span class="ibox ibox-warn">预计到岗 {{ U.arriveText(r.arrive_before) || '—' }}</span></div>
                <div class="row" style="gap:6px">
                  <span class="badge badge-bad" v-if="r._kind === 'pending' && r.note">打回</span>
                  <span class="badge badge-warn" v-if="r._kind === 'pending'">待填报</span>
                  <span class="badge badge-pri" v-if="r._kind === 'done' && r._resubmitted_at">重交</span> <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查课' : '未查课' }}</span>
                </div>
              </div>
              <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-bad' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" style="cursor:pointer" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].open ? '收起' : '查看' }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].taken">拍摄 {{ photoMap[r.id].taken }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].created">上传 {{ photoMap[r.id].created }}</span></div>
          <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
              <div class="row mt8" style="gap:8px" v-if="r._kind === 'pending'">
                <button class="btn btn-sm" @click.stop="openReturn(r)">打回</button>
                <button class="btn btn-sm btn-danger" @click.stop="removePlan(r)">删除</button>
              </div>
              <div class="row mt8" style="gap:8px" v-else>
                <button class="btn btn-sm" @click.stop="go('/admin/records/' + r.id)">查看 / 修正</button>
              </div>
            </div>
          </div>
          <div class="muted sm" v-else>本周没有课程安排</div>
          <div class="tiny muted mt8">点击课程可查看详情或进入编辑；补填后状态自动更新。</div>
        </div>
      </div>
      <div class="empty" v-if="!filteredUsers.length">{{ memFilter === 'done' ? '本周还没有人查完' : (memFilter === 'pending' ? '本周没有人未查课' : (memFilter === 'none' ? '没有未选课的成员' : '还没有成员')) }}</div>
    </div>
    </template>

    <div class="tiny muted mt8" v-if="mode === 'checks'">点击课程即可编辑：已查课进记录详情修正，未查课进选课编辑。</div>

    <template v-if="mode === 'checks'">
    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">本周课程</h2>
      <span class="tiny muted">{{ statusCourses.length }} 节 · 已查 {{ dayStats.done }} · 未查 {{ dayStats.pending }}</span>
    </div>

    <div class="chips mt8">
      <div class="chip" :class="{ on: courseStatus === 'all' }" @click="courseStatus = 'all'">全部 {{ dayCourses.length }}</div>
      <div class="chip" :class="{ on: courseStatus === 'done' }" @click="courseStatus = 'done'">已查 {{ dayStats.done }}</div>
      <div class="chip" :class="{ on: courseStatus === 'pending' }" @click="courseStatus = 'pending'">未查 {{ dayStats.pending }}</div>
      <div class="chip" :class="{ on: courseStatus === 'returned' }" @click="courseStatus = 'returned'">打回 {{ dayStats.returned }}</div>
      <div class="chip chip-sep" :class="{ on: !courseGrade }" @click="courseGrade = ''">全部年级</div>
      <div class="chip" :class="{ on: courseGrade === '大一' }" @click="courseGrade = courseGrade === '大一' ? '' : '大一'">大一</div>
      <div class="chip" :class="{ on: courseGrade === '大二' }" @click="courseGrade = courseGrade === '大二' ? '' : '大二'">大二</div>
      <div class="chip" :class="{ on: courseGrade === '大三' }" @click="courseGrade = courseGrade === '大三' ? '' : '大三'">大三</div>
    </div>

    <div class="chips mt8">
      <div class="chip" :class="{ on: !courseDay }" @click="courseDay = 0">全部</div>
      <div class="chip" v-for="(d, i) in DAY_LABELS" :key="d" :class="{ on: courseDay === i + 1 }" @click="courseDay = courseDay === i + 1 ? 0 : i + 1">{{ d }}</div>
    </div>

    <div class="mt12" v-for="g in courseGroups" :key="g.key">
      <div class="row between">
        <h3 style="font-size:14px;margin:0">{{ g.title }}</h3>
        <span class="tiny muted">{{ g.rows.length }} 节 · 已查 {{ g.done }} · 未查 {{ g.pending }}</span>
      </div>
      <div class="list mt8">
        <div class="litem" v-for="r in g.rows" :key="r._key" style="cursor:pointer" @click="openCourse(r)">
          <div class="row between">
            <div class="t1">{{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-muted">{{ r.owner_name }}</span><span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span><span class="ibox ibox-warn">预计到岗 {{ U.arriveText(r.arrive_before) || '—' }}</span></div>
            <div class="row" style="gap:6px">
              <span class="badge badge-bad" v-if="r._kind === 'pending' && r.note">打回</span>
              <span class="badge badge-warn" v-if="r._kind === 'pending'">待填报</span> <span class="badge badge-pri" v-if="r._kind === 'done' && r._resubmitted_at">重交</span> <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查课' : '未查课' }}</span>
            </div>
          </div>
          <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-bad' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" style="cursor:pointer" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].open ? '收起' : '查看' }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].taken">拍摄 {{ photoMap[r.id].taken }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].created">上传 {{ photoMap[r.id].created }}</span></div>
          <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
          <div class="row mt8" style="gap:8px">
            <button class="btn btn-sm" @click.stop="rejectCourse(r)">打回</button>
            <button class="btn btn-sm btn-danger" @click.stop="deleteCourse(r)">删除</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card mt12" v-if="!statusCourses.length"><div class="muted sm">{{ emptyText }}</div></div>
    </template>

    <div class="mask mask-center" v-if="returnTarget" @click.self="returnTarget = null">
      <div class="sheet sheet-center" style="max-width:360px">
        <h3>打回选课</h3>
        <div class="sub">打回后成员会在「我的选课」看到原因，可以修改后重新保存。</div>
        <div class="chips" style="justify-content:center">
          <div class="chip" v-for="r in RETURN_REASONS" :key="r" :class="{ on: returnNote === r }" @click="returnNote = returnNote === r ? '' : r">{{ r }}</div>
        </div>
        <textarea class="textarea mt8" v-model="returnNote" maxlength="100" placeholder="选上方常用原因，或自己填写"></textarea>
        <button class="btn btn-danger btn-block mt8" :disabled="returnBusy || !returnNote.trim()" @click="doReturn">
          {{ returnBusy ? '处理中…' : '确认打回' }}
        </button>
        <button class="btn btn-block mt8" @click="returnTarget = null">取消</button>
      </div>
    </div>

    <div class="mask mask-center" v-if="fullPhoto" @click.self="fullPhoto = null">
      <div class="sheet sheet-center" style="padding:10px">
        <img :src="fullPhoto.data || fullPhoto.thumb" style="width:100%;border-radius:10px;display:block" alt="原图">
        <div class="tiny muted mt8">拍摄 {{ fmtTime(fullPhoto.taken_at) }} · 上传 {{ fmtTime(fullPhoto.created_at) }}</div>
        <button class="btn btn-block mt8" @click="fullPhoto = null">关闭</button>
      </div>
    </div>
  </div>`,

  props: { mode: { type: String, default: 'members' } },
  data() {
    return { U, week: 0, users: [], records: [], assigned: {}, photoMap: {}, stats: { plans: 0, done: 0, expected: 0, actual: 0, overdue: 0 }, open: '', loading: true, memFilter: 'all', courseStatus: 'all', courseDay: 0, courseGrade: '', DAY_LABELS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], returnTarget: null, returnNote: '', returnBusy: false, mergeBusy: false, RETURN_REASONS: ['班级漏填', '时间不对', '课程不符', '人数合计不符'], photoLoading: false, fullPhoto: null }
  },
  computed: {
    pageTitle() { return this.mode === 'checks' ? '课检' : '成员情况' },
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
      const map = {}
      this.users.forEach((u) => {
        (u.pending_list || []).forEach((p) => {
          const key = [u.id, p.check_date, p.period_from, p.period_to, p.course_name].join('|')
          if (!map[key]) map[key] = Object.assign({}, p, { owner_name: u.name, owner_id: u.id, _classes: [], _ids: [p.id] })
          else if (map[key]._ids.indexOf(p.id) < 0) {
            map[key]._ids.push(p.id)
            if (p.note && !map[key].note) map[key].note = p.note
          }
          this.classCodes(p).forEach((c) => {
            if (map[key]._classes.indexOf(c) < 0) map[key]._classes.push(c)
          })
        })
      })
      const rows = Object.keys(map).map((k) => {
        const r = map[k]
        return Object.assign({}, r, { class_name: r._classes.slice().sort((a, b) => U.classCompare(a, b)).join('、') || r.class_name })
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
    weekCourses() {
      const done = this.workDone.map((r) => Object.assign({}, r, { _kind: 'done', _key: 'd' + r.id }))
      const pend = this.workPending.map((r) => Object.assign({}, r, { _kind: 'pending', _key: 'p' + r.id }))
      return done.concat(pend).sort((a, b) => {
        const da = String(a.check_date || ''), db = String(b.check_date || '')
        if (da !== db) return da < db ? -1 : 1
        const pa = Number(a.period_from) || 0, pb = Number(b.period_from) || 0
        if (pa !== pb) return pa - pb
        return Number(a.id) - Number(b.id)
      })
    },
    dayCourses() {
      const base = this.gradeCourses
      if (!this.courseDay) return base
      return base.filter((r) => ((U.parse(r.check_date).getUTCDay() + 6) % 7) + 1 === this.courseDay)
    },
    courseGrades(r) {
      const codes = []
      if (Array.isArray(r.classes)) r.classes.forEach((c) => { if (c && c.code) codes.push(String(c.code)) })
      if (Array.isArray(r._classes)) r._classes.forEach((c) => codes.push(String(c)))
      if (!codes.length) (String(r.class_name || '').match(/\d{8}/g) || []).forEach((c) => codes.push(c))
      const out = []
      codes.forEach((c) => {
        const y = c.slice(4, 6)
        const g = y === '26' ? '大一' : (y === '25' ? '大二' : (y === '24' ? '大三' : ''))
        if (g && out.indexOf(g) < 0) out.push(g)
      })
      return out
    },
    gradeCourses() {
      if (!this.courseGrade) return this.weekCourses
      return this.weekCourses.filter((r) => this.courseGrades(r).indexOf(this.courseGrade) >= 0)
    },
    dayStats() {
      const s = { done: 0, pending: 0, returned: 0 }
      this.dayCourses.forEach((r) => {
        if (r._kind === 'done') s.done += 1
        else {
          s.pending += 1
          if (r.note) s.returned += 1
        }
      })
      return s
    },
    statusCourses() {
      if (this.courseStatus === 'done') return this.dayCourses.filter((r) => r._kind === 'done')
      if (this.courseStatus === 'pending') return this.dayCourses.filter((r) => r._kind === 'pending')
      if (this.courseStatus === 'returned') return this.dayCourses.filter((r) => r._kind === 'pending' && r.note)
      return this.dayCourses
    },
    emptyText() {
      const scope = (this.courseDay ? '这一天' : '本周') + (this.courseGrade || '')
      if (this.courseStatus === 'done') return scope + '没有已查课程'
      if (this.courseStatus === 'pending') return scope + '没有未查课程'
      if (this.courseStatus === 'returned') return scope + '没有被打回的课程'
      return scope + '还没有课程安排'
    },
    courseGroups() {
      const map = {}
      this.statusCourses.forEach((r) => {
        const key = r.check_date || ''
        if (!map[key]) map[key] = { key, title: U.md(r.check_date) + ' ' + U.weekdayCN(r.check_date), rows: [], done: 0, pending: 0 }
        map[key].rows.push(r)
        if (r._kind === 'done') map[key].done += 1
        else map[key].pending += 1
      })
      return Object.keys(map).sort().map((k) => map[k])
    },
    donePct() { return this.weekCourses.length ? Math.round((this.workDone.length / this.weekCourses.length) * 100) : 0 },
    pendingUsers() { return this.users.filter((u) => u.pending > 0) },
    doneUsers() { return this.users.filter((u) => u.planned && this.pendingCount(u) === 0) },
    noTaskUsers() { return this.users.filter((u) => !u.planned) },
    filteredUsers() {
      let list = this.users
      if (this.memFilter === 'pending') list = this.pendingUsers
      else if (this.memFilter === 'done') list = this.doneUsers
      else if (this.memFilter === 'none') list = this.noTaskUsers
      return list.slice().sort((a, b) => U.nameCompare(a.name, b.name))
    },
  },
  mounted() {
    const saved = Number(localStorage.getItem('xfc_admin_week')) || 0
    this.week = (saved >= 1 && saved <= this.maxWeek) ? saved : Store.weekNow()
    this.restoreViewState()
    this.load().then(() => {
      if (!this._restoreScroll) return
      const y = this._restoreScroll
      this._restoreScroll = 0
      this.$nextTick(() => { window.scrollTo(0, y) })
    })
  },
  methods: {
    go(p) {
      if (p.indexOf('/admin/records/') === 0 || p.indexOf('/admin/plans/') === 0) this.saveViewState()
      Store.nav(p)
    },
    saveViewState() {
      try {
        sessionStorage.setItem('xfc_admin_view_' + this.mode, JSON.stringify({
          scroll: window.scrollY || 0,
          open: this.open || '',
          courseDay: this.courseDay,
          courseStatus: this.courseStatus,
        }))
      } catch (e) { /* 隐私模式忽略 */ }
    },
    restoreViewState() {
      try {
        const raw = sessionStorage.getItem('xfc_admin_view_' + this.mode)
        if (!raw) return
        const v = JSON.parse(raw)
        this.open = v.open || ''
        if (typeof v.courseDay === 'number') this.courseDay = v.courseDay
        if (v.courseStatus) this.courseStatus = v.courseStatus
        this._restoreScroll = Number(v.scroll) || 0
        sessionStorage.removeItem('xfc_admin_view_' + this.mode)
      } catch (e) { /* 隐私模式忽略 */ }
    },
    saveWeek() { try { localStorage.setItem('xfc_admin_week', String(this.week)) } catch (e) { /* 隐私模式忽略 */ } },
    shift(d) {
      const w = this.week + d
      if (w < 1 || w > this.maxWeek) return
      this.week = w
      this.open = ''
      this.courseDay = 0
      this.saveWeek()
      this.load()
    },
    toggle(id) { this.open = this.open === id ? '' : id },
    setFilter(f) { this.memFilter = f; this.open = '' },
    classCodes(p) {
      const list = (Array.isArray(p.classes) && p.classes.length)
        ? p.classes.map((c) => c.code).filter(Boolean)
        : String(p.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter((s) => s && s !== '其他')
      return list.sort((a, b) => U.classCompare(a, b))
    },
    classParts(r, ownerId) {
      const parts = String(r.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter(Boolean)
      const codes = this.assigned[String(ownerId)] || []
      return parts.map((code) => ({ code, on: codes.indexOf(code) >= 0 }))
    },
    memberPending(m) {
      const map = {}
      ;(m.pending_list || []).forEach((p) => {
        const key = [p.check_date, p.period_from, p.period_to, p.course_name].join('|')
        if (!map[key]) map[key] = Object.assign({}, p, { owner_name: m.name, owner_id: m.id, _classes: [], _ids: [p.id] })
        else if (map[key]._ids.indexOf(p.id) < 0) map[key]._ids.push(p.id)
        this.classCodes(p).forEach((c) => {
          if (map[key]._classes.indexOf(c) < 0) map[key]._classes.push(c)
        })
      })
      return Object.keys(map).map((k) => {
        const r = map[k]
        return Object.assign({}, r, { class_name: r._classes.slice().sort((a, b) => U.classCompare(a, b)).join('、') || r.class_name })
      })
    },
    pendingCount(m) { return this.memberPending(m).length },
    openReturn(p) { this.returnTarget = p; this.returnNote = '' },
    async doReturn() {
      const note = (this.returnNote || '').trim()
      if (!note || !this.returnTarget) return
      this.returnBusy = true
      try {
        const ids = (this.returnTarget._ids && this.returnTarget._ids.length)
          ? this.returnTarget._ids
          : [this.returnTarget.id]
        for (const id of ids) {
          const plan = await Store.rpc('admin_plan_get', { p_id: id })
          const cls = Array.isArray(plan.classes) ? plan.classes : []
          if (!cls.length) throw new Error('这条计划缺少班级数据，请直接编辑或作废')
          await Store.rpc('admin_plan_update', {
            p_id: id,
            p_payload: {
              owner_id: plan.owner_id,
              check_date: plan.check_date,
              period_from: plan.period_from,
              period_to: plan.period_to,
              course_name: plan.course_name,
              teacher: plan.teacher || '',
              room: plan.room || '',
              counselor: plan.counselor || '',
              classes: cls.map((c) => ({ code: c.code, expected: Number(c.expected) || 0 })),
              other_expected: Number(plan.other_expected) || 0,
              arrive_before: plan.arrive_before || '',
              note: '管理员打回：' + note,
            },
          })
        }
        U.toast('已打回，成员可在「我的选课」修改')
        this.returnTarget = null
        this.returnNote = ''
        this.load()
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.returnBusy = false
      }
    },
    async voidPlan(p) {
      const ids = (p._ids && p._ids.length) ? p._ids : [p.id]
      const more = ids.length > 1 ? `（合并的 ${ids.length} 个计划）` : ''
      if (!window.confirm(`作废 ${p.owner_name || ''} 的「${p.course_name}」${more}？\n\n作废后不再计入未查课统计。`)) return
      try {
        for (const id of ids) await Store.rpc('plan_void', { p_id: id })
        U.toast('已作废')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async editMerged(p) {
      const ids = (p._ids && p._ids.length) ? p._ids : [p.id]
      if (ids.length === 1) { this.go('/admin/plans/' + p.id); return }
      if (this.mergeBusy) return
      if (!window.confirm(`这节合并了 ${ids.length} 个计划，将合并为一条再编辑，其余计划作废。继续？`)) return
      this.mergeBusy = true
      try {
        const plans = await Promise.all(ids.map((id) => Store.rpc('admin_plan_get', { p_id: id })))
        const base = plans[0]
        const seen = {}
        const classes = []
        let other = 0
        plans.forEach((pl) => {
          ;(pl.classes || []).forEach((c) => {
            if (!seen[c.code]) {
              seen[c.code] = 1
              classes.push({ code: c.code, expected: Number(c.expected) || 0 })
            }
          })
          other = Math.max(other, Number(pl.other_expected) || 0)
        })
        if (!classes.length) throw new Error('这些计划缺少班级数据，无法合并编辑')
        await Store.rpc('admin_plan_update', {
          p_id: base.id,
          p_payload: {
            owner_id: base.owner_id,
            check_date: base.check_date,
            period_from: base.period_from,
            period_to: base.period_to,
            course_name: base.course_name,
            teacher: base.teacher || '',
            room: base.room || '',
            counselor: base.counselor || '',
            classes: classes,
            other_expected: other,
            arrive_before: base.arrive_before || '',
            note: base.note || '',
          },
        })
        for (const pl of plans.slice(1)) await Store.rpc('plan_void', { p_id: pl.id })
        U.toast('已合并为一条，继续编辑')
        this.go('/admin/plans/' + base.id)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.mergeBusy = false
      }
    },
    recordsOf(m) { return this.records.filter((r) => r.owner_id === m.id) },
    memberCourses(m) {
      const done = this.recordsOf(m).map((r) => Object.assign({}, r, { _kind: 'done', _key: 'd' + r.id }))
      const pend = this.memberPending(m).map((p) => Object.assign({}, p, { _kind: 'pending', _key: 'p' + p.id }))
      return done.concat(pend).sort((a, b) => {
        const da = String(a.check_date || ''), db = String(b.check_date || '')
        if (da !== db) return da < db ? -1 : 1
        const pa = Number(a.period_from) || 0, pb = Number(b.period_from) || 0
        if (pa !== pb) return pa - pb
        return Number(a.id) - Number(b.id)
      })
    },
    fmtTime(t) { return t ? U.shortTime(t) : '未知' },
    openCourse(r) {
      if (r._kind === 'done') this.go('/admin/records/' + r.id)
      else this.editMerged(r)
    },
    rejectCourse(r) {
      if (r._kind === 'done') this.returnRecord(r)
      else this.openReturn(r)
    },
    deleteCourse(r) {
      if (r._kind === 'done') this.removeRecord(r)
      else this.removePlan(r)
    },
    async removePlan(p) {
      const ids = (p._ids && p._ids.length) ? p._ids : [p.id]
      const more = ids.length > 1 ? `（合并的 ${ids.length} 个选课）` : ''
      if (!window.confirm(`删除 ${p.owner_name || ''} 的「${p.course_name}」${more}？\n\n选课将彻底删除，不可恢复。`)) return
      try {
        for (const id of ids) await Store.rpc('plan_delete', { p_id: id })
        U.toast('已删除')
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async loadRecordPhotos() {
      for (const r of this.records) {
        if (this.photoMap[r.id]) continue
        try {
          const list = await Store.rpc('photo_list', { p_record_id: r.id }) || []
          this.photoMap[r.id] = {
            list: list.map((p) => ({ id: p.id, thumb: p.thumb || '', taken_at: p.taken_at, created_at: p.created_at })),
            taken: list.map((p) => U.dayTime(p.taken_at)).filter(Boolean).join(' / '),
            created: list.map((p) => U.dayTime(p.created_at)).filter(Boolean).join(' / '),
            open: false,
          }
        } catch (e) { /* 单条失败忽略 */ }
      }
    },
    async toggleCoursePhotos(r) {
      const cur = this.photoMap[r.id]
      if (cur) { cur.open = !cur.open; return }
      this.photoMap[r.id] = { list: [], taken: '', created: '', open: true }
      try {
        const list = await Store.rpc('photo_list', { p_record_id: r.id }) || []
        this.photoMap[r.id] = {
          list: list.map((p) => ({ id: p.id, thumb: p.thumb || '', taken_at: p.taken_at, created_at: p.created_at })),
          taken: list.map((p) => U.dayTime(p.taken_at)).filter(Boolean).join(' / '),
          created: list.map((p) => U.dayTime(p.created_at)).filter(Boolean).join(' / '),
          open: true,
        }
      } catch (e) {
        this.photoMap[r.id] = { list: [], taken: '', created: '', open: true }
        U.toast(U.errText(e), 'bad')
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
        const [d, notes, classes, resubmits] = await Promise.all([
          Store.rpc('admin_week', { p_week: this.week }),
          Store.rpc('admin_plan_notes', { p_week: this.week }).catch(() => []),
          Store.rpc('admin_user_classes', {}).catch(() => null),
          Store.rpc('admin_week_resubmits', { p_week: this.week }).catch(() => []),
        ])
        const noteById = {}
        ;(notes || []).forEach((n) => { if (n && n.id != null && n.note) noteById[n.id] = n.note })
        const assigned = {}
        ;((classes && classes.users) || []).forEach((a) => {
          if (!a || a.id == null) return
          const codes = String(a.assigned_text || '').split(/[、,，/ ]+/).map((s) => s.trim()).filter(Boolean)
          if (codes.length) assigned[String(a.id)] = codes
        })
        this.assigned = assigned
        this.users = (d.users || []).filter((u) => !isTestAccount(u)).map((u) => Object.assign({}, u, {
          pending_list: (u.pending_list || []).map((p) => Object.assign({}, p, { note: p.note || noteById[p.id] || '' })),
        }))
        const resByPlan = {}
        ;(resubmits || []).forEach((x) => {
          if (x && x.plan_id != null) resByPlan[String(x.plan_id)] = x.resubmitted_at || ''
        })
        this.records = (d.records || []).filter((r) => !isTestAccount(r)).map((r) => Object.assign({}, r, {
          _resubmitted_at: r.plan_id != null ? (resByPlan[String(r.plan_id)] || '') : '',
        }))
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

/* 课检页：复用总览组件的课检模式，只显示本周课程列表（已查/未查合并） */
window.Views.AdminChecks = {
  template: '<admin-home mode="checks"></admin-home>',
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
