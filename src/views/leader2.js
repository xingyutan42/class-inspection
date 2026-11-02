// 管理员端（续）：记录详情与修正 / 成员 / 学期 / 导出
window.Views = window.Views || {}

// 姓名首字拼音首字母（覆盖名单用字与常见姓氏，未收录的归入 #）
const PY_INITIAL = {
  '李':'L','黄':'H','董':'D','黎':'L','王':'W','韦':'W','赵':'Z','雷':'L','刘':'L','朱':'Z',
  '杨':'Y','白':'B','盛':'S','谭':'T','周':'Z','测':'C','试':'S','金':'J','睿':'R','庭':'T',
  '满':'M','又':'Y','精':'J','玥':'Y','含':'H','荣':'R','锦':'J','馨':'X','若':'R','帆':'F',
  '杰':'J','宇':'Y','成':'C','婧':'J','怡':'Y','洋':'Y','香':'X','子':'Z','皓':'H','璐':'L',
  '智':'Z','博':'B','梦':'M','玲':'L','励':'L','勤':'Q','佳':'J','琦':'Q','亮':'L','星':'X',
  '张':'Z','陈':'C','林':'L','吴':'W','郑':'Z','孙':'S','马':'M','胡':'H','郭':'G','何':'H',
  '高':'G','罗':'L','梁':'L','宋':'S','唐':'T','许':'X','邓':'D','冯':'F','韩':'H','曹':'C',
  '彭':'P','曾':'Z','田':'T','潘':'P','袁':'Y','蔡':'C','蒋':'J','余':'Y','于':'Y','杜':'D',
  '叶':'Y','程':'C','苏':'S','魏':'W','吕':'L','丁':'D','任':'R','沈':'S','姚':'Y','卢':'L',
  '姜':'J','崔':'C','钟':'Z','汪':'W','范':'F','傅':'F','方':'F','石':'S','陆':'L','贾':'J',
  '夏':'X','付':'F','邹':'Z','熊':'X','秦':'Q','江':'J','尹':'Y','薛':'X','段':'D','郝':'H',
  '孔':'K','邵':'S','史':'S','毛':'M','常':'C','万':'W','顾':'G','武':'W','康':'K','贺':'H',
  '严':'Y','施':'S','牛':'N','洪':'H','龚':'G','汤':'T','戴':'D','侯':'H','孟':'M','龙':'L',
}
function pyInitial(name) {
  const c = (name || '').trim().charAt(0)
  return PY_INITIAL[c] || '#'
}

const FIELD_LABELS = {
  expected_count: '应到', actual_count: '实到', late_count: '迟到',
  absent_count: '旷课', leave_count: '请假', discipline_tags: '纪律问题', discipline_note: '课程主要内容',
  remark: '检查备注', course_name: '课程', class_name: '班级', room: '教室', teacher: '任课老师',
  check_date: '查课日期', period_from: '节次起', period_to: '节次止',
}

window.Views.AdminRecord = {
  template: `
  <div class="shell shell-wide" v-if="rec">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>记录详情</h1>
      <div class="side right" style="display:flex;gap:6px">
        <button class="btn btn-sm" @click="openEdit">修正</button>
        <button class="btn btn-sm" @click="confirmDel = true">打回</button>
        <button class="btn btn-sm btn-danger" @click="confirmHard = true">删除</button>
      </div>
    </div>

    <div class="card mt12">
      <div class="row between">
        <div>
          <div class="strong" style="font-size:16px">{{ rec.course_name }} · {{ rec.class_name }}</div>
          <div class="tiny muted mt8">第{{ rec.week_no }}周 · {{ U.md(rec.check_date) }} {{ U.weekdayCN(rec.check_date) }} {{ U.periodText(rec.period_from, rec.period_to) }}</div>
        </div>
        <span class="badge" :class="rec.is_extra ? 'badge-warn' : 'badge-pri'">{{ rec.is_extra ? '计划外' : '计划内' }}</span>
      </div>
      <div class="divider"></div>
      <div class="grid2 tiny">
        <div><span class="muted">检查人</span> <span class="strong">{{ rec.owner_name }}</span></div>
        <div><span class="muted">教室</span> {{ rec.room || '—' }}</div>
        <div><span class="muted">任课老师</span> {{ rec.teacher || '—' }}</div>
        <div><span class="muted">辅导员</span> {{ counselorText }}</div>
        <div><span class="muted">预计到岗</span> {{ U.arriveText(rec.arrive_before) || '—' }}</div>
        <div><span class="muted">提交时间</span> {{ U.dayTime(rec.submitted_at) }}</div>
      </div>
      <div class="kvrow mt12"><span class="k">课程主要内容</span><span class="v">{{ rec.discipline_note || '—' }}</span></div>
    </div>

    <div class="card" v-if="classList.length">
      <div class="hd"><h2>课检班级</h2><span class="tiny muted">实到 / 应到</span></div>
      <div class="cstat" v-for="c in classList" :key="c.code">
        <div class="cstat-code">{{ c.code }}</div>
        <div class="cstat-exp"><b class="num">{{ actualOf(c) }}</b> / {{ c.expected }}</div>
      </div>
      <div class="cstat" v-if="Number(rec.other_expected) > 0">
        <div class="cstat-code">其他</div>
        <div class="cstat-exp"><b class="num">{{ Number(rec.other_actual) || 0 }}</b> / {{ rec.other_expected }}</div>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h2>出勤</h2><span class="tiny muted">出勤率 {{ U.rate(rec.actual_count, rec.expected_count) || '—' }}</span></div>
      <div class="stat-grid">
        <div class="stat"><div class="n">{{ rec.expected_count }}</div><div class="t">应到</div></div>
        <div class="stat ok"><div class="n">{{ rec.actual_count }}</div><div class="t">实到</div></div>
        <div class="stat warn"><div class="n">{{ rec.absent_count }}</div><div class="t">旷课</div></div>
      </div>
      <div class="row between tiny muted mt12">
        <span>迟到 {{ rec.late_count }}</span><span>请假 {{ rec.leave_count }}</span>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h2>课堂纪律</h2></div>
      <div class="tagcloud" v-if="rec.discipline_tags && rec.discipline_tags.length">
        <span class="tagpill on" v-for="t in rec.discipline_tags" :key="t">{{ t }}</span>
      </div>
      <div class="muted sm" v-else>无纪律问题</div>
      <div class="sm mt12" v-if="rec.remark"><span class="muted">备注：</span>{{ rec.remark }}</div>
    </div>

    <div class="card">
      <div class="hd">
        <h2>现场照片</h2>
        <button class="btn btn-sm" v-if="!photosLoaded" :disabled="photoLoading" @click="loadPhotos()">
          {{ photoLoading ? '加载中…' : '查看照片' }}
        </button>
        <span class="tiny muted" v-else>{{ photos.length }} 张</span>
      </div>
      <div v-if="photosLoaded && photos.length">
        <div class="photo-row" v-for="(ph, i) in photos" :key="ph.id">
          <div class="photo-row-img" @click="openPhoto(i)">
            <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
            <div v-else class="photo-ph">原图</div>
          </div>
          <div class="photo-row-meta">
            <div class="sm"><span class="muted">拍摄</span> {{ fmtTime(ph.taken_at) }}</div>
            <div class="sm"><span class="muted">上传</span> {{ fmtTime(ph.created_at) }}</div>
            <div class="tiny muted">点击图片查看原图</div>
          </div>
        </div>
      </div>
      <div class="muted sm" v-if="photosLoaded && !photos.length">这条记录没有照片</div>
    </div>

    <div class="mask mask-center" v-if="fullPhoto" @click.self="fullPhoto = null">
      <div class="sheet sheet-center" style="padding:10px">
        <img :src="fullPhoto.data || fullPhoto.thumb" style="width:100%;border-radius:10px;display:block" alt="原图">
        <div class="tiny muted mt8">
          拍摄 {{ fmtTime(fullPhoto.taken_at) }} · 上传 {{ fmtTime(fullPhoto.created_at) }}
        </div>
        <button class="btn btn-block mt8" @click="fullPhoto = null">关闭</button>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h2>修改记录</h2><span class="tiny muted">{{ revisions.length }} 次</span></div>
      <div class="list" v-if="revisions.length">
        <div class="litem" v-for="r in revisions" :key="r.id" style="cursor:default">
          <div class="row between">
            <span class="sm strong">{{ r.editor_role === 'leader' ? '管理员修正' : '本人更正' }}</span>
            <span class="tiny muted">{{ U.dayTime(r.created_at) }}</span>
          </div>
          <div class="t2">{{ diffText(r) }}</div>
          <div class="t2" v-if="r.reason">原因：{{ r.reason }}</div>
        </div>
      </div>
      <div class="muted sm" v-else>暂无修改</div>
    </div>

    <div class="mask mask-center" v-if="confirmDel" @click.self="confirmDel = false">
      <div class="sheet sheet-center">
        <h3>打回记录</h3>
        <div class="sub" style="white-space:pre-line">打回「{{ rec.course_name }} · {{ rec.class_name }}」？\n\n记录将删除，修改留痕与照片一并清除。\n如果它来自选课计划，计划会回到「待填报」，成员可重新填写。</div>
        <button class="btn btn-danger btn-block" :disabled="busy" @click="doDelete">{{ busy ? '处理中…' : '确认打回' }}</button>
        <button class="btn btn-block mt8" @click="confirmDel = false">取消</button>
      </div>
    </div>

    <div class="mask mask-center" v-if="confirmHard" @click.self="confirmHard = false">
      <div class="sheet sheet-center">
        <h3>彻底删除</h3>
        <div class="sub" style="white-space:pre-line">彻底删除「{{ rec.course_name }} · {{ rec.class_name }}」？\n\n记录、修改留痕与照片完全删除，不可恢复。\n如果它来自选课计划，该计划也会一并删除。</div>
        <button class="btn btn-danger btn-block" :disabled="busy" @click="doHardDelete">{{ busy ? '删除中…' : '确认彻底删除' }}</button>
        <button class="btn btn-block mt8" @click="confirmHard = false">取消</button>
      </div>
    </div>

    <div class="mask" v-if="editing" @click.self="editing=false">
      <div class="sheet">
        <h3>修正这条记录</h3>
        <div class="formerr" v-if="err">{{ err }}</div>
        <div class="field">
          <label class="label">课程名称</label>
          <input class="input" v-model="edit.course_name" maxlength="40">
        </div>
        <div class="field">
          <label class="label">任课老师</label>
          <input class="input" v-model="edit.teacher" maxlength="20">
        </div>
        <div class="field">
          <label class="label">教室</label>
          <input class="input" v-model="edit.room" maxlength="20">
        </div>
        <div class="field">
          <label class="label">课检日期 / 节次</label>
          <input class="input" type="date" v-model="edit.check_date" :min="minDate" :max="maxDate">
          <div class="chips mt8">
            <div class="chip" v-for="p in periods" :key="p[0]" :class="{on: edit.period_from === p[0]}" @click="edit.period_from = p[0]; edit.period_to = p[1]">
              {{ U.periodText(p[0], p[1]) }}
            </div>
          </div>
        </div>
        <div v-if="edit.classes && edit.classes.length">
          <div class="tiny muted" style="margin:6px 0">逐班实到</div>
          <div class="cstat" v-for="c in edit.classes" :key="c.code">
            <div class="cstat-code">{{ c.code }}</div>
            <div class="cstat-exp">应到 {{ c.expected }}</div>
            <input class="input" style="width:72px;text-align:center" type="number" inputmode="numeric" v-model.number="c.actual">
          </div>
          <div class="cstat" v-if="edit.other_expected > 0">
            <div class="cstat-code">其他</div>
            <div class="cstat-exp">应到 {{ edit.other_expected }}</div>
            <input class="input" style="width:72px;text-align:center" type="number" inputmode="numeric" v-model.number="edit.other_actual">
          </div>
        </div>
        <template v-else>
          <div class="field"><label class="label">应到</label><input class="input" type="number" v-model.number="edit.expected_count"></div>
          <div class="field"><label class="label">实到</label><input class="input" type="number" v-model.number="edit.actual_count"></div>
        </template>
        <div class="grid2">
          <div class="field"><label class="label">旷课</label><input class="input" type="number" v-model.number="edit.absent_count"></div>
          <div class="field"><label class="label">请假</label><input class="input" type="number" v-model.number="edit.leave_count"></div>
          <div class="field"><label class="label">迟到</label><input class="input" type="number" v-model.number="edit.late_count"></div>
        </div>
        <div class="tiny" style="margin-bottom:12px" :style="sumOkEdit ? 'color:var(--muted)' : 'color:var(--bad)'">
          {{ sumOkEdit ? '人数合计一致' : (edit.classes && edit.classes.length ? '每班实到不能超过应到' : '应到应等于 实到 + 旷课 + 请假') }}
        </div>
        <div class="field"><label class="label">课程主要内容</label><textarea class="textarea textarea-xs" v-model="edit.discipline_note" maxlength="200"></textarea></div>
        <div class="field"><label class="label">检查备注</label><input class="input" v-model="edit.remark"></div>
        <div class="field"><label class="label">修正原因<i class="req">*</i></label><input class="input" v-model="edit.correction_note" placeholder="必填，会记入留痕"></div>
        <div class="row">
          <button class="btn grow" @click="editing=false">取消</button>
          <button class="btn btn-primary grow" :disabled="saving || !sumOkEdit" @click="save">{{ saving ? '保存中…' : '保存修正' }}</button>
        </div>
      </div>
    </div>
  </div>`,

  data() { return { U, rec: null, revisions: [], editing: false, saving: false, err: '', edit: {}, confirmDel: false, confirmHard: false, busy: false, photos: [], photosLoaded: false, photoLoading: false, fullPhoto: null } },
  computed: {
    periods() { return U.PERIODS },
    minDate() {
      const s = Store.store.semester
      return s ? s.start_monday : ''
    },
    maxDate() {
      const s = Store.store.semester
      return s ? U.addDays(s.start_monday, s.total_weeks * 7 - 1) : ''
    },
    classList() {
      if (!this.rec || !Array.isArray(this.rec.classes)) return []
      return this.rec.classes.map((c) => ({
        code: c.code || '',
        expected: Number(c.expected) || 0,
        actual: c.actual === null || c.actual === undefined ? null : Number(c.actual),
      })).sort((a, b) => U.classCompare(a.code, b.code))
    },
    counselorText() {
      if (!this.rec) return '—'
      return U.matchCounselors(Store.store.counselorMap, U.recordClassHints(this.rec)) || this.rec.counselor || '—'
    },
    sumOkEdit() {
      if (Array.isArray(this.edit.classes) && this.edit.classes.length) {
        return this.edit.classes.every((c) => {
          const a = Number(c.actual) || 0
          return a >= 0 && a <= (Number(c.expected) || 0)
        })
      }
      const e = Number(this.edit.expected_count) || 0
      const s = (Number(this.edit.actual_count) || 0) + (Number(this.edit.absent_count) || 0) + (Number(this.edit.leave_count) || 0)
      return e > 0 && e === s
    },
  },
  mounted() { this.load() },
  methods: {
    back() { if (history.length > 1) history.back(); else Store.nav('/admin/checks') },
    actualOf(c) { return c.actual === null ? '—' : c.actual },
    fmtTime(t) { return t ? U.shortTime(t) : '未知' },
    async loadPhotos() {
      if (!this.rec || this.photoLoading) return
      this.photoLoading = true
      try {
        const list = await Store.rpc('photo_list', { p_record_id: Number(this.rec.id) }) || []
        const out = []
        for (const p of list) {
          const hit = window.PhotoCache ? await PhotoCache.get(p.id) : null
          out.push({
            id: p.id,
            created_at: p.created_at,
            taken_at: p.taken_at || null,
            thumb: (hit && hit.thumb) || p.thumb || '',
            data: (hit && hit.data) || '',
          })
        }
        this.photos = out
        this.photosLoaded = true
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.photoLoading = false }
    },
    async openPhoto(i) {
      const ph = this.photos[i]
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
    async doDelete() {
      this.busy = true
      try {
        await Store.rpc('record_delete', { p_id: this.rec.id })
        U.toast('已打回，成员可重新填报')
        this.confirmDel = false
        Store.nav('/admin')
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.busy = false
      }
    },
    async doHardDelete() {
      this.busy = true
      try {
        await Store.rpc('record_delete_hard', { p_id: this.rec.id })
        U.toast('已彻底删除')
        this.confirmHard = false
        Store.nav('/admin')
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.busy = false
      }
    },
    openEdit() {
      this.err = ''
      const cls = this.classList
      this.edit = {
        expected_count: this.rec.expected_count, actual_count: this.rec.actual_count,
        late_count: this.rec.late_count,
        absent_count: this.rec.absent_count, leave_count: this.rec.leave_count,
        remark: this.rec.remark || '', correction_note: '',
        course_name: this.rec.course_name || '', teacher: this.rec.teacher || '', room: this.rec.room || '',
        check_date: this.rec.check_date, period_from: this.rec.period_from, period_to: this.rec.period_to,
        discipline_note: this.rec.discipline_note || '',
        classes: cls.map((c) => ({ code: c.code, expected: c.expected, actual: c.actual === null ? c.expected : c.actual })),
        other_expected: Number(this.rec.other_expected) || 0,
        other_actual: Number(this.rec.other_actual) || 0,
      }
      this.editing = true
    },
    diffText(r) {
      const before = r.before_row || {}
      const after = r.after_row || {}
      const parts = []
      Object.keys(FIELD_LABELS).forEach((k) => {
        const a = before[k]
        const b = after[k]
        const sa = Array.isArray(a) ? a.join('、') : (a === null || a === undefined ? '' : String(a))
        const sb = Array.isArray(b) ? b.join('、') : (b === null || b === undefined ? '' : String(b))
        if (sa !== sb) parts.push(`${FIELD_LABELS[k]}：${sa || '空'} → ${sb || '空'}`)
      })
      return parts.length ? parts.join('；') : '保存了一次修改（内容与之前一致）'
    },
    async save() {
      if (!this.edit.correction_note.trim()) { this.err = '请填写修正原因'; return }
      this.saving = true
      this.err = ''
      try {
        const hasCls = Array.isArray(this.edit.classes) && this.edit.classes.length > 0
        const sumExp = hasCls
          ? this.edit.classes.reduce((s, c) => s + (Number(c.expected) || 0), 0) + (Number(this.edit.other_expected) || 0)
          : Number(this.edit.expected_count) || 0
        const sumAct = hasCls
          ? this.edit.classes.reduce((s, c) => s + (Number(c.actual) || 0), 0) + (Number(this.edit.other_actual) || 0)
          : Number(this.edit.actual_count) || 0
        const row = await Store.rpc('admin_record_update', {
          p_id: this.rec.id,
          p_payload: {
            course_name: (this.edit.course_name || '').trim(),
            teacher: (this.edit.teacher || '').trim(),
            room: (this.edit.room || '').trim(),
            check_date: this.edit.check_date,
            period_from: Number(this.edit.period_from),
            period_to: Number(this.edit.period_to),
            expected_count: sumExp,
            actual_count: sumAct,
            classes: hasCls ? this.edit.classes.map((c) => ({ code: c.code, expected: Number(c.expected) || 0, actual: Number(c.actual) || 0 })) : [],
            other_actual: Number(this.edit.other_actual) || 0,
            late_count: Number(this.edit.late_count) || 0,
            absent_count: Number(this.edit.absent_count) || 0,
            leave_count: Number(this.edit.leave_count) || 0,
            remark: this.edit.remark || '',
            discipline_note: this.edit.discipline_note || '',
            correction_note: this.edit.correction_note.trim(),
          },
        })
        this.rec = row
        this.editing = false
        U.toast('已修正并留痕')
        this.load()
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.saving = false
      }
    },
    async load() {
      const id = this.$root.route.params.id
      try {
        const d = await Store.rpc('admin_record_get', { p_id: Number(id) })
        this.rec = d.record
        this.revisions = d.revisions || []
      } catch (e) { U.toast(U.errText(e), 'bad'); this.back() }
    },
  },
}

window.Views.AdminMembers = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="go('/me')">‹</button></div>
      <h1>成员管理</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd">
        <h2>全部成员</h2>
        <span class="tiny muted">{{ kw ? filtered.length + ' / ' : '' }}{{ users.length }} 人</span>
      </div>

      <div class="mem-search">
        <input class="input" v-model="kw" placeholder="搜索姓名或学号" autocomplete="off">
        <button class="mem-search-x" v-if="kw" @click="kw = ''" title="清空">✕</button>
      </div>

      <div class="tablewrap adm-wide-only mem-tb-compact">
        <table class="tb">
          <thead><tr><th>姓名</th><th>学号</th><th>职务</th><th>身份</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
          <tbody v-for="g in groups" :key="'g' + g.key">
            <tr class="grp"><td colspan="7" :id="'mem-' + g.key">{{ g.key }}</td></tr>
            <tr v-for="m in g.list" :key="m.id">
              <td class="strong">{{ m.name }}<span class="badge badge-warn" v-if="m.must_change" style="margin-left:6px">未改密</span></td>
              <td class="num">{{ m.student_no }}</td>
              <td>{{ m.title || '—' }}</td>
              <td><span class="badge" :class="m.role === 'admin' ? 'badge-pri' : ''">{{ m.role === 'admin' ? '管理员' : '组员' }}</span></td>
              <td><span class="badge" :class="m.status === 'active' ? 'badge-ok' : 'badge-bad'">{{ m.status === 'active' ? '在用' : '已停用' }}</span></td>
              <td class="tiny muted">{{ m.last_login_at ? U.dayTime(m.last_login_at) : '从未' }}</td>
              <td>
                <div class="row" style="gap:6px">
                  <button class="btn btn-sm" @click="toggleRole(m)">{{ m.role === 'admin' ? '降为组员' : '设为管理员' }}</button>
                  <button class="btn btn-sm" @click="resetPwd(m)">重置密码</button>
                  <button class="btn btn-sm" :class="m.status === 'active' ? 'btn-danger' : ''" @click="toggleStatus(m)">
                    {{ m.status === 'active' ? '停用' : '恢复' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
          <tbody v-if="!filtered.length">
            <tr><td colspan="7" class="center muted" style="padding:24px">{{ kw ? '没有匹配的成员' : '还没有成员，请先导入名单' }}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="adm-narrow-only">
        <div v-for="g in groups" :key="'cg' + g.key">
          <div class="mem-group-t" :id="'memc-' + g.key">{{ g.key }}</div>
          <div class="mem-card mem-compact" v-for="m in g.list" :key="'c' + m.id">
            <div class="mem-top">
              <div class="mem-name">
                {{ m.name }}
                <span class="badge badge-warn" v-if="m.must_change">未改密</span>
              </div>
              <span class="mem-no">{{ m.student_no }}</span>
            </div>
            <div class="mem-meta">
              <span>{{ m.title || '—' }}</span>
              <span class="badge" :class="m.role === 'admin' ? 'badge-pri' : ''">{{ m.role === 'admin' ? '管理员' : '组员' }}</span>
              <span class="badge" :class="m.status === 'active' ? 'badge-ok' : 'badge-bad'">{{ m.status === 'active' ? '在用' : '已停用' }}</span>
              <span>{{ m.last_login_at ? U.dayTime(m.last_login_at) : '从未登录' }}</span>
            </div>
            <div class="mem-acts">
              <button class="btn btn-sm" @click="toggleRole(m)">{{ m.role === 'admin' ? '降为组员' : '设为管理员' }}</button>
              <button class="btn btn-sm" @click="resetPwd(m)">重置密码</button>
              <button class="btn btn-sm" :class="m.status === 'active' ? 'btn-danger' : ''" @click="toggleStatus(m)">
                {{ m.status === 'active' ? '停用' : '恢复' }}
              </button>
            </div>
          </div>
        </div>
        <div class="empty" v-if="!filtered.length">{{ kw ? '没有匹配的成员' : '还没有成员' }}</div>
      </div>

      <div class="mem-index" v-if="groups.length">
        <span v-for="l in indexLetters" :key="l" :class="{ off: !letterCount[l] }" @click="jumpTo(l)">{{ l }}</span>
      </div>
    </div>

    <div class="mask mask-center" v-if="confirmAct" @click.self="confirmAct = null">
      <div class="sheet sheet-center">
        <h3>{{ confirmAct.title }}</h3>
        <div class="sub" style="white-space:pre-line">{{ confirmAct.desc }}</div>
        <button class="btn btn-danger btn-block" :disabled="busy" @click="doConfirm">
          {{ busy ? '处理中…' : '确认' + confirmAct.okText }}
        </button>
        <button class="btn btn-block mt8" @click="confirmAct = null">取消</button>
      </div>
    </div>

    <div class="card">
      <div class="hd"><h2>发给组员的说明</h2></div>
      <textarea class="textarea invite-box" readonly rows="6" :value="inviteText"></textarea>
      <div class="row mt8"><button class="btn btn-sm" @click="copyInvite">复制文字</button></div>
    </div>

    <div class="tiny muted mt12">
      初始密码为本人学号，首次登录强制修改密码。忘记密码请联系管理员，由管理员在成员管理中重置为学号，登录后需重新设密。
    </div>
  </div>`,

  data() { return { U, users: [], confirmAct: null, busy: false, kw: '' } },
  computed: {
    filtered() {
      const k = this.kw.trim().toLowerCase()
      if (!k) return this.users
      return this.users.filter((m) => (m.name || '').toLowerCase().includes(k) || (m.student_no || '').toLowerCase().includes(k))
    },
    groups() {
      const map = {}
      this.filtered.slice().sort((a, b) => U.nameCompare(a.name, b.name)).forEach((m) => {
        const key = pyInitial(m.name)
        if (!map[key]) map[key] = []
        map[key].push(m)
      })
      const keys = Object.keys(map).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
      return keys.map((key) => ({ key, list: map[key] }))
    },
    letterCount() {
      const c = {}
      this.groups.forEach((g) => { c[g.key] = g.list.length })
      return c
    },
    indexLetters() {
      const arr = []
      for (let i = 65; i <= 90; i++) arr.push(String.fromCharCode(i))
      arr.push('#')
      return arr
    },
    inviteText() {
      const link = location.origin + location.pathname
      return `【学风建设系统使用说明】\n1. 手机浏览器打开：${link}\n2. 账号是你的姓名，初始密码是你的学号\n3. 首次登录会强制修改密码，请立即设置新密码\n4. 周末先「选下周要查的课」，工作日回来填写查课结果\n5. 忘记密码：联系管理员，在成员管理中重置为你的学号，登录后需重新设密`
    },
  },
  mounted() { this.load() },
  methods: {
    go(p) { Store.nav(p) },
    jumpTo(letter) {
      if (!this.letterCount[letter]) return
      const prefix = window.innerWidth >= 720 ? 'mem-' : 'memc-'
      const el = document.getElementById(prefix + letter)
      if (!el) return
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' })
    },
    async load() {
      try { this.users = await Store.rpc('staff_list') || [] } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    resetPwd(m) {
      this.confirmAct = {
        title: '重置密码',
        desc: `将「${m.name}」的密码重置为其学号？\n\n重置后对方会被强制下线，用学号登录后需立即修改密码。`,
        okText: '重置',
        run: async () => {
          await Store.rpc('staff_reset_password', { p_id: m.id })
          U.toast('已重置为学号，对方登录后需改密')
          this.load()
        },
      }
    },
    async doConfirm() {
      if (!this.confirmAct) return
      this.busy = true
      try {
        await this.confirmAct.run()
        this.confirmAct = null
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.busy = false
      }
    },
    toggleRole(m) {
      const role = m.role === 'admin' ? 'member' : 'admin'
      const toAdmin = role === 'admin'
      this.confirmAct = {
        title: toAdmin ? '设为管理员' : '降为组员',
        desc: `将「${m.name}」${toAdmin ? '设为管理员？\n\n管理员可查看和修改全部成员的数据。' : '降为普通组员？\n\n对方将失去管理后台权限。'}`,
        okText: toAdmin ? '设为管理员' : '降为组员',
        run: async () => {
          await Store.rpc('staff_update', { p_id: m.id, p_status: '', p_role: role })
          U.toast('已更新')
          this.load()
        },
      }
    },
    toggleStatus(m) {
      const status = m.status === 'active' ? 'disabled' : 'active'
      const restore = status === 'active'
      this.confirmAct = {
        title: restore ? '恢复账号' : '停用账号',
        desc: `确定要${restore ? '恢复' : '停用'}「${m.name}」吗？${restore ? '' : '\n\n停用后对方将被强制下线，且无法再登录。'}`,
        okText: restore ? '恢复' : '停用',
        run: async () => {
          await Store.rpc('staff_update', { p_id: m.id, p_status: status, p_role: '' })
          U.toast('已更新')
          this.load()
        },
      }
    },
    copyInvite() {
      const text = this.inviteText
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => U.toast('已复制')).catch(() => U.toast('复制失败，请长按选择'))
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        U.toast('已复制')
      }
    },
  },
}

window.Views.AdminSemesters = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="go('/me')">‹</button></div>
      <h1>学期设置</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>{{ form.id ? '编辑学期' : '新增学期' }}</h2></div>
      <div class="field"><label class="label">学期名称</label><input class="input" v-model="form.name" placeholder="如 2026-2027 学年第一学期"></div>
      <div class="field"><label class="label">第 1 周的周一</label><input class="input" type="date" v-model="form.start_monday"></div>
      <div class="field"><label class="label">总周数</label><input class="input" type="number" v-model.number="form.total_weeks" min="1" max="30"></div>
      <div class="row">
        <button class="btn grow" v-if="form.id" @click="reset">取消编辑</button>
        <button class="btn btn-primary grow" :disabled="busy" @click="save">{{ form.id ? '保存' : '新增' }}</button>
      </div>
      <div class="hint">周次由「第 1 周周一」自动推算，改动只影响之后的换算，历史记录已存快照。</div>
    </div>

    <div class="card">
      <div class="hd"><h2>学期列表</h2></div>
      <div class="list">
        <div class="litem" v-for="s in list" :key="s.id" style="cursor:default">
          <div class="row between">
            <div>
              <div class="t1">{{ s.name }} <span class="badge badge-pri" v-if="s.is_current">当前</span></div>
              <div class="t2">{{ s.start_monday }} 起 · 共 {{ s.total_weeks }} 周</div>
            </div>
            <div class="row">
              <button class="btn btn-sm" v-if="!s.is_current" @click="setCurrent(s)">设为当前</button>
              <button class="btn btn-sm" @click="edit(s)">编辑</button>
            </div>
          </div>
        </div>
        <div class="muted sm" v-if="!list.length">还没有学期，请先新增</div>
      </div>
    </div>
  </div>`,

  data() { return { U, list: [], busy: false, form: { id: '', name: '', start_monday: '', total_weeks: 18 } } },
  mounted() { this.load() },
  methods: {
    go(p) { Store.nav(p) },
    reset() { this.form = { id: '', name: '', start_monday: '', total_weeks: 18 } },
    edit(s) { this.form = { id: s.id, name: s.name, start_monday: s.start_monday, total_weeks: s.total_weeks } },
    async load() {
      try { this.list = await Store.rpc('semester_list') || [] } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async save() {
      if (!this.form.name.trim()) return U.toast('请填写学期名称', 'bad')
      if (!this.form.start_monday) return U.toast('请选择第 1 周周一', 'bad')
      this.busy = true
      try {
        await Store.rpc('semester_save', {
          p_payload: {
            id: this.form.id || null,
            name: this.form.name.trim(),
            start_monday: this.form.start_monday,
            total_weeks: Number(this.form.total_weeks) || 18,
          },
        })
        U.toast('已保存')
        this.reset()
        await this.load()
        await Store.refresh()
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.busy = false }
    },
    async setCurrent(s) {
      try {
        await Store.rpc('semester_set_current', { p_id: s.id })
        U.toast('已设为当前学期')
        await this.load()
        await Store.refresh()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
  },
}

window.Views.AdminExport = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="go('/admin')">‹</button></div>
      <h1>导出 Excel 台账</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>选择周次</h2><span class="tiny muted">{{ sem ? sem.name : '' }}</span></div>
      <div class="row wrap">
        <select class="select" style="max-width:150px" v-model.number="week">
          <option v-for="w in weekList" :key="w" :value="w">第 {{ w }} 周</option>
        </select>
        <button class="btn btn-sm" @click="shiftWeek(-1)">上周</button>
        <button class="btn btn-sm" @click="shiftWeek(0)">本周</button>
        <button class="btn btn-sm" @click="shiftWeek(1)">下周</button>
      </div>
      <div class="hint">按周导出：包含「大一 / 大二 / 大三」三个工作表，按查课时间排序。</div>
    </div>

    <div class="card">
      <div class="row between">
        <div>
          <div class="strong">{{ count === null ? '正在统计…' : '将导出 ' + count + ' 条记录' }}</div>
          <div class="tiny muted mt8">{{ summary || '按所选周次统计中…' }}</div>
        </div>
      </div>
      <div class="stat-grid mt12">
        <div class="stat"><div class="n">{{ gradeCounts['大一'] }}</div><div class="t">大一 已查</div></div>
        <div class="stat ok"><div class="n">{{ gradeCounts['大二'] }}</div><div class="t">大二 已查</div></div>
        <div class="stat"><div class="n">{{ gradeCounts['大三'] }}</div><div class="t">大三 已查</div></div>
      </div>
    </div>

    <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="doExport">
      {{ busy ? '正在生成…' : '生成并下载' }}
    </button>
  </div>`,

  data() { return { week: 0, busy: false, loading: false, count: null, summary: '', gradeCounts: { '大一': 0, '大二': 0, '大三': 0 } } },
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
    this.week = Store.weekNow() || 1
    // 提前加载 SheetJS，避免点「生成并下载」时因异步加载丢失用户手势导致不触发下载
    XLS.loadXLSX().catch(() => {})
  },
  watch: {
    // 进入页面（首次赋值）与切换周次时自动统计，无需手动点「预览数量」
    week() { this.preview() },
  },
  methods: {
    go(p) { Store.nav(p) },
    shiftWeek(d) {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const base = d === 0 ? (Store.weekNow() || 1) : (this.week + d)
      this.week = Math.max(1, Math.min(max, base))
    },
    range() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const w = Math.max(1, Math.min(max, this.week | 0))
      return [w, w]
    },
    async collect() {
      const [a, b] = this.range()
      const d = await Store.rpc('export_data', { p_from: Number(a), p_to: Number(b) })
      return {
        records: d.records || [],
        plans: d.plans || [],
        members: (d.users || []).map((u) => ({ owner_id: u.id, display_name: u.name })),
        semester: this.sem,
        weekFrom: a,
        weekTo: b,
      }
    },
    async preview() {
      this.loading = true
      try {
        const data = await this.collect()
        this.count = data.records.length
        const pending = data.plans.filter((p) => p.status === 'planned').length
        const total = data.records.length + pending
        this.summary = `课程总节数 ${total} 节（已查 ${data.records.length} · 未查 ${pending}）`
        const gc = { '大一': 0, '大二': 0, '大三': 0 }
        data.records.forEach((r) => {
          const gs = (window.XLS && XLS.gradesOf) ? XLS.gradesOf(r) : []
          gs.forEach((g) => { if (gc[g] != null) gc[g] += 1 })
        })
        this.gradeCounts = gc
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally { this.loading = false }
    },
    async doExport() {
      this.busy = true
      try {
        const data = await this.collect()
        if (!data.records.length && !data.plans.length) { U.toast('这个区间没有数据', 'bad'); return }
        const out = await XLS.exportLedger(data)
        this.count = data.records.length
        U.toast('已生成：' + out.name)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally { this.busy = false }
    },
  },
}

window.Views.AdminPlanEdit = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>编辑选课计划</h1>
      <div class="side right"></div>
    </div>

    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>保存失败</h3>
        <div class="sub errmsg">{{ err }}</div>
        <button class="btn btn-primary btn-block" @click="err = ''">知道了</button>
      </div>
    </div>

    <div class="card mt12" v-if="loading"><div class="empty">加载中…</div></div>

    <template v-else-if="plan">
      <div class="card mt12" v-if="plan.status !== 'planned'">
        <div class="notice">这条计划当前是「{{ statusText }}」，只有待填报的计划可以编辑。</div>
      </div>

      <div class="card mt12">
        <div class="hd"><h2>归属成员</h2></div>
        <select class="select" v-model.number="form.owner_id">
          <option v-for="m in members" :key="m.id" :value="m.id" :disabled="m.status !== 'active' && m.id !== form.owner_id">
            {{ m.name }}（{{ m.student_no }}）{{ m.status !== 'active' ? ' · 已停用' : '' }}
          </option>
        </select>
        <div class="hint">改归属后，这条计划会出现在新成员的待查列表里。</div>
      </div>

      <div class="card mt12">
        <div class="hd"><h2>课检时间</h2><span class="tiny muted">第 {{ weekTarget }} 周</span></div>
        <div class="field">
          <label class="label">查课日期<i class="req">*</i></label>
          <input class="input" type="date" v-model="form.check_date" :min="minDate" :max="maxDate">
        </div>
        <div class="field mb0">
          <label class="label">节次<i class="req">*</i></label>
          <div class="chips">
            <div class="chip" v-for="p in periods" :key="p[0]" :class="{on: form.period_from === p[0]}" @click="setPeriod(p)">
              {{ U.periodText(p[0], p[1]) }}
            </div>
          </div>
        </div>
      </div>

      <div class="card mt12">
        <div class="field">
          <label class="label">课程名称<i class="req">*</i></label>
          <input class="input" v-model="form.course_name" maxlength="40" placeholder="如：高等数学A（上）">
        </div>
        <div class="field">
          <label class="label">任课老师<i class="req">*</i></label>
          <input class="input" v-model="form.teacher" maxlength="20" placeholder="如：王老师">
        </div>
        <div class="field">
          <label class="label">教室<i class="req">*</i></label>
          <input class="input" v-model="form.room" maxlength="20" placeholder="如：2106">
        </div>

        <div class="field">
          <label class="label">被查班级<i class="req">*</i></label>
          <div class="cls-row" v-for="(c, i) in form.classes" :key="i">
            <input class="input" v-model="c.code" maxlength="8" inputmode="numeric" placeholder="8 位班级号" @input="normCode(i)">
            <input class="input cls-num" v-model="c.expected" inputmode="numeric" placeholder="应到">
            <button type="button" class="btn btn-sm btn-danger" v-if="form.classes.length > 1" @click="removeClass(i)">删</button>
            <button type="button" class="cls-add" v-if="canAdd(i)" @click="addClass">＋</button>
          </div>
          <div class="tiny muted">班级号填 8 位数字，应到填该班点名册人数。</div>

          <label class="label cls-other-label mt12">其他人数</label>
          <div class="cls-row">
            <button type="button" class="cls-no" @click="form.other_expected = '0'">无</button>
            <input class="input" v-model="form.other_expected" inputmode="numeric">
          </div>
        </div>

        <div class="field mb0">
          <label class="label">预计到岗<i class="req">*</i></label>
          <div class="chips">
            <div class="chip" :class="{on: form.arrive_before === 'p1'}" @click="form.arrive_before = 'p1'">第一节课前</div>
            <div class="chip" :class="{on: form.arrive_before === 'p2'}" @click="form.arrive_before = 'p2'">第二节课前</div>
          </div>
        </div>
      </div>

      <div class="actionbar" v-if="plan.status === 'planned'">
        <div class="inner">
          <button class="btn btn-primary btn-block btn-lg" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存修改' }}</button>
        </div>
      </div>
    </template>
  </div>`,

  data() {
    return {
      U, loading: true, busy: false, err: '', id: '', plan: null, members: [],
      form: {
        owner_id: 0, check_date: '', period_from: 1, period_to: 2,
        course_name: '', teacher: '', room: '',
        classes: [{ code: '', expected: '' }], other_expected: '0', arrive_before: '',
      },
    }
  },
  computed: {
    periods() { return U.PERIODS },
    sem() { return Store.store.semester },
    minDate() { return this.sem ? this.sem.start_monday : '' },
    maxDate() { return this.sem ? U.addDays(this.sem.start_monday, this.sem.total_weeks * 7 - 1) : '' },
    weekTarget() {
      if (!this.sem || !this.form.check_date) return '—'
      return U.weekNo(this.sem.start_monday, this.form.check_date)
    },
    statusText() {
      if (!this.plan) return ''
      return this.plan.status === 'submitted' ? '已提交' : (this.plan.status === 'void' ? '已作废' : '待填报')
    },
  },
  mounted() {
    this.id = this.$root.route.params.id
    this.load()
  },
  methods: {
    back() { if (history.length > 1) history.back(); else Store.nav('/admin/checks?week=' + (this.plan ? this.plan.week_no : Store.weekNow())) },
    setPeriod(p) { this.form.period_from = p[0]; this.form.period_to = p[1] },
    normCode(i) {
      const c = this.form.classes[i]
      c.code = String(c.code || '').replace(/\D/g, '').slice(0, 8)
    },
    canAdd(i) {
      const c = this.form.classes[i]
      return i === this.form.classes.length - 1 && c.code.length === 8 && String(c.expected).trim() !== ''
    },
    addClass() { this.form.classes.push({ code: '', expected: '' }) },
    removeClass(i) { this.form.classes.splice(i, 1) },
    check() {
      if (!this.sem) return '尚未设置学期，请联系管理员'
      if (!this.form.owner_id) return '请选择归属成员'
      if (!this.form.check_date) return '请选择查课日期'
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
      if (!this.form.period_from || !this.form.period_to) return '请选择节次'
      if (!this.form.arrive_before) return '请选择预计到岗时间'
      return ''
    },
    async load() {
      try {
        const [plan, staff] = await Promise.all([
          Store.rpc('admin_plan_get', { p_id: Number(this.id) }),
          Store.rpc('staff_list'),
        ])
        this.plan = plan
        this.members = staff || []
        this.fill(plan)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
        Store.nav('/admin/checks')
      } finally {
        this.loading = false
      }
    },
    fill(p) {
      this.form.owner_id = Number(p.owner_id) || 0
      this.form.check_date = p.check_date || ''
      this.form.period_from = Number(p.period_from) || 1
      this.form.period_to = Number(p.period_to) || 2
      this.form.course_name = p.course_name || ''
      this.form.teacher = p.teacher || ''
      this.form.room = p.room || ''
      const cls = Array.isArray(p.classes) ? p.classes : []
      this.form.classes = cls.length
        ? cls.slice().sort((a, b) => U.classCompare(a.code, b.code)).map((c) => ({ code: c.code || '', expected: c.expected === 0 ? '0' : String(c.expected) }))
        : [{ code: '', expected: '' }]
      this.form.other_expected = String(Number(p.other_expected) || 0)
      this.form.arrive_before = p.arrive_before || ''
    },
    async save() {
      const bad = this.check()
      if (bad) { this.err = bad; return }
      this.busy = true
      try {
        const rows = this.form.classes.filter((c) => c.code)
        await Store.rpc('admin_plan_update', {
          p_id: Number(this.id),
          p_payload: {
            owner_id: Number(this.form.owner_id),
            check_date: this.form.check_date,
            period_from: Number(this.form.period_from),
            period_to: Number(this.form.period_to),
            course_name: this.form.course_name.trim(),
            teacher: this.form.teacher.trim(),
            room: this.form.room.trim(),
            classes: rows.map((c) => ({ code: c.code, expected: Number(c.expected) })),
            other_expected: Number(this.form.other_expected),
            arrive_before: this.form.arrive_before,
          },
        })
        U.toast('已保存')
        Store.nav('/admin/checks?week=' + this.weekTarget)
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}
