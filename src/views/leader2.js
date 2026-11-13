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
  const c = String(name == null ? '' : name).trim().charAt(0)
  return PY_INITIAL[c] || '#'
}

const FIELD_LABELS = {
  expected_count: '应到', actual_count: '实到',
  absent_count: '旷课', leave_count: '请假', discipline_tags: '纪律问题', discipline_note: '课程主要内容',
  remark: '检查备注', course_name: '课程', class_name: '班级', room: '教室', teacher: '任课老师',
  check_date: '查课日期', period_from: '节次起', period_to: '节次止',
  teacher_status: '教师上课情况', phone_count: '玩手机', sleep_count: '睡觉',
  phone_10: '10分钟玩手机', sleep_10: '10分钟睡觉', phone_30: '30分钟玩手机', sleep_30: '30分钟睡觉',
  teacher_score: '老师评分', student_score: '学生评分',
  absent_students: '旷课名单', leave_students: '请假名单',
}
// 留痕展示：数组（含名单对象）转可读文本
function fieldText(v) {
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === 'object')
      ? ((x.cls || '') + (x.name ? ('班 ' + x.name) : ''))
      : String(x)).filter(Boolean).join('、')
  }
  return v === null || v === undefined ? '' : String(v)
}

window.Views.AdminRecord = {
  template: `
  <div class="shell shell-wide" v-if="rec">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>记录详情</h1>
      <div class="side right" style="display:flex;gap:6px">
        <button class="btn btn-sm" @click="openEdit">修正</button>
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
        <span class="badge badge-warn" v-if="Number(rec.self_edit_count) > 0">本人自行改过 {{ rec.self_edit_count }} 次</span>
      </div>
      <div class="divider"></div>
      <div class="grid2 tiny">
        <div><span class="muted">检查人</span> <span class="strong">{{ rec.owner_name }}</span>
          <span v-if="rec.admin_note" class="badge badge-warn" style="margin-left:6px">{{ rec.admin_note }}</span></div>
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
      <div class="hd"><h2>课堂</h2></div>
      <div class="stat-grid">
        <div class="stat"><div class="n">{{ rec.expected_count }}</div><div class="t">应到</div></div>
        <div class="stat ok"><div class="n">{{ rec.actual_count }}</div><div class="t">实到</div></div>
        <div class="stat" :class="attendanceOk ? 'ok' : 'warn'"><div class="n" style="font-size:21px">{{ U.rate(rec.actual_count, rec.expected_count) || '—' }}</div><div class="t">出勤率</div></div>
        <div class="stat warn"><div class="n">{{ rec.absent_count }}</div><div class="t">旷课</div></div>
        <div class="stat"><div class="n">{{ rec.leave_count || 0 }}</div><div class="t">请假</div></div>
        <div class="stat" :class="rec.phone_count ? 'warn' : ''"><div class="n">{{ rec.phone_count || 0 }}</div><div class="t">玩手机</div></div>
        <div class="stat" :class="rec.sleep_count ? 'warn' : ''"><div class="n">{{ rec.sleep_count || 0 }}</div><div class="t">睡觉</div></div>
        <div class="stat" :class="rec.phone_10 ? 'warn' : ''"><div class="n">{{ rec.phone_10 || 0 }}</div><div class="t">10分钟玩手机</div></div>
        <div class="stat" :class="rec.sleep_10 ? 'warn' : ''"><div class="n">{{ rec.sleep_10 || 0 }}</div><div class="t">10分钟睡觉</div></div>
        <div class="stat" :class="rec.phone_30 ? 'warn' : ''"><div class="n">{{ rec.phone_30 || 0 }}</div><div class="t">30分钟玩手机</div></div>
        <div class="stat" :class="rec.sleep_30 ? 'warn' : ''"><div class="n">{{ rec.sleep_30 || 0 }}</div><div class="t">30分钟睡觉</div></div>
      </div>
      <div class="stu-list mt12" v-if="(rec.absent_count || 0) > 0 || (rec.absent_students || []).length">
        <div class="tiny muted mb8">旷课名单（{{ rec.absent_count || 0 }} 人）</div>
        <div class="sm stu-line" v-for="(s2, i) in (rec.absent_students || [])" :key="'ra' + i">
          <span class="stu-no">{{ i + 1 }}</span>{{ s2.cls ? s2.cls + '班 ' : '' }}{{ s2.name }}
        </div>
        <div class="sm muted" v-if="!(rec.absent_students || []).length">未填写名单</div>
      </div>

      <div class="stu-list mt8" v-if="(rec.leave_count || 0) > 0 || (rec.leave_students || []).length">
        <div class="tiny muted mb8">请假名单（{{ rec.leave_count || 0 }} 人）</div>
        <div class="sm stu-line" v-for="(s2, i) in (rec.leave_students || [])" :key="'rl' + i">
          <span class="stu-no">{{ i + 1 }}</span>{{ s2.cls ? s2.cls + '班 ' : '' }}{{ s2.name }}
        </div>
        <div class="sm muted" v-if="!(rec.leave_students || []).length">未填写名单</div>
      </div>

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
      <div class="tiny muted mt8">拍摄 {{ photoTakeText() }} · 提交 {{ U.dayTime(rec.submitted_at) || '—' }}</div>
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
          <div class="field"><label class="label">旷课</label><input class="input" type="number" v-model.number="edit.absent_count" @input="syncEditStudents('absent')"></div>
          <div class="field"><label class="label">请假</label><input class="input" type="number" v-model.number="edit.leave_count" @input="syncEditStudents('leave')"></div>
        </div>

        <datalist id="cls-suggest-edit">
          <option v-for="c in classOptionsEdit" :key="c" :value="c"></option>
        </datalist>

        <div class="stu-wrap" v-if="Number(edit.absent_count) > 0">
          <div class="row between mb8">
            <span class="tiny muted">旷课名单（{{ Number(edit.absent_count) || 0 }} 人）</span>
            <button class="btn btn-sm" type="button" @click="pasteEditStudents('absent')">批量粘贴</button>
          </div>
          <div class="stu-row" v-for="(s2, i) in edit.absent_students" :key="'ea' + i">
            <div class="stu-idx">第 {{ i + 1 }} 个</div>
            <input class="input" list="cls-suggest-edit" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
            <input class="input" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
          </div>
        </div>

        <div class="stu-wrap mt12" v-if="Number(edit.leave_count) > 0">
          <div class="row between mb8">
            <span class="tiny muted">请假名单（{{ Number(edit.leave_count) || 0 }} 人）</span>
            <button class="btn btn-sm" type="button" @click="pasteEditStudents('leave')">批量粘贴</button>
          </div>
          <div class="stu-row" v-for="(s2, i) in edit.leave_students" :key="'el' + i">
            <div class="stu-idx">第 {{ i + 1 }} 个</div>
            <input class="input" list="cls-suggest-edit" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
            <input class="input" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
          </div>
        </div>
        <div class="tiny" style="margin-bottom:12px" :style="sumOkEdit ? 'color:var(--muted)' : 'color:var(--bad)'">
          {{ sumOkEdit ? '人数合计一致' : (edit.classes && edit.classes.length ? '每班实到不能超过应到' : '应到应等于 实到 + 旷课 + 请假') }}
        </div>
        <div class="field"><label class="label">教师上课情况</label>
          <select class="select" v-model="edit.teacher_status">
            <option value="">未填写</option>
            <option v-for="t in TEACHER_OPTS" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="tiny muted" style="margin:4px 0 6px">课堂纪律（人数）</div>
        <div class="grid2">
          <div class="field"><label class="label">玩手机</label><input class="input" type="number" v-model.number="edit.phone_count"></div>
          <div class="field"><label class="label">睡觉</label><input class="input" type="number" v-model.number="edit.sleep_count"></div>
          <div class="field"><label class="label">10分钟玩手机</label><input class="input" type="number" v-model.number="edit.phone_10"></div>
          <div class="field"><label class="label">10分钟睡觉</label><input class="input" type="number" v-model.number="edit.sleep_10"></div>
          <div class="field"><label class="label">30分钟玩手机</label><input class="input" type="number" v-model.number="edit.phone_30"></div>
          <div class="field"><label class="label">30分钟睡觉</label><input class="input" type="number" v-model.number="edit.sleep_30"></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="label">老师评分</label><input class="input" type="number" step="0.1" min="9" max="10" v-model.number="edit.teacher_score"></div>
          <div class="field"><label class="label">学生评分</label><input class="input" type="number" step="0.1" min="9" max="10" v-model.number="edit.student_score"></div>
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

  data() { return { U, rec: null, revisions: [], editing: false, saving: false, err: '', edit: {}, confirmHard: false, busy: false, photos: [], photosLoaded: false, photoLoading: false, fullPhoto: null, photoTimes: null, TEACHER_OPTS: [
    '老师备课充分，授课条理清楚，学生积极互动。',
    '老师讲解细致，节奏适中，课堂秩序良好。',
    '老师讲课认真、热情，学生积极配合老师回答问题。',
    '老师讲课认真，时常关注学生听课状态，与学生互动并解答问题。',
    '老师备课充分，板书详细，授课条理清楚，循循善诱，学生积极互动。',
    '老师讲课认真，条理清晰，关注学生状态，积极与学生互动。',
    '老师上课重点突出，大部分学生上课积极融入课堂。',
  ] } },
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
    // 出勤率 ≥ 90% 显示绿色，否则黄色提示
    attendanceOk() {
      const e = Number(this.rec && this.rec.expected_count) || 0
      if (!e) return true
      return ((Number(this.rec.actual_count) || 0) / e) >= 0.9
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
    classOptionsEdit() {
      const set = []
      const add = (v) => {
        String(v || '').split(/[、,，+\s]+/).forEach((x) => {
          const t = x.trim()
          if (t && t !== '其他' && set.indexOf(t) < 0) set.push(t)
        })
      }
      ;(this.edit.classes || []).forEach((c) => add(c.code))
      const me = Store.store.me || {}
      add(me.duty_classes)
      add(me.own_class)
      return set.sort((a, b) => U.classCompare(a, b))
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
        const list = await Store.rpcCached('photo_list', { p_record_id: Number(this.rec.id) }, 300000) || []
        const out = []
        for (const p of list) {
          const signUrl = p.storage_path ? await Store.photoUrl(p, 600) : ''
          const thumbSrc = p.thumb || ((p.thumb_path || p.storage_path) ? await Store.thumbUrl(p, 600) : '')
          const hit = p.storage_path ? null : (window.PhotoCache ? await PhotoCache.get(p.id) : null)
          out.push({
            id: p.id,
            created_at: p.created_at,
            taken_at: p.taken_at || null,
            thumb: thumbSrc || (hit && hit.thumb) || signUrl || '',
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
        if (d.storage_path) {
          ph.data = await Store.photoUrl(d, 600)
        } else {
          ph.data = d.data
          if (!ph.thumb && d.thumb) ph.thumb = d.thumb
          if (window.PhotoCache) PhotoCache.put(ph.id, { thumb: ph.thumb, data: d.data })
        }
        this.fullPhoto = ph
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.photoLoading = false }
    },
    async doHardDelete() {
      this.busy = true
      try {
        await Store.rpc('record_delete_hard', { p_id: this.rec.id })
        U.toast('已彻底删除')
        Store.clearRpcCache()
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
        absent_count: this.rec.absent_count, leave_count: this.rec.leave_count,
        remark: this.rec.remark || '', correction_note: '',
        course_name: this.rec.course_name || '', teacher: this.rec.teacher || '', room: this.rec.room || '',
        check_date: this.rec.check_date, period_from: this.rec.period_from, period_to: this.rec.period_to,
        discipline_note: this.rec.discipline_note || '',
        teacher_status: this.rec.teacher_status || '',
        phone_count: Number(this.rec.phone_count) || 0,
        sleep_count: Number(this.rec.sleep_count) || 0,
        phone_10: Number(this.rec.phone_10) || 0,
        sleep_10: Number(this.rec.sleep_10) || 0,
        phone_30: Number(this.rec.phone_30) || 0,
        sleep_30: Number(this.rec.sleep_30) || 0,
        teacher_score: this.rec.teacher_score == null ? 9.5 : Number(this.rec.teacher_score),
        student_score: this.rec.student_score == null ? 9.5 : Number(this.rec.student_score),
        classes: cls.map((c) => ({ code: c.code, expected: c.expected, actual: c.actual === null ? c.expected : c.actual })),
        other_expected: Number(this.rec.other_expected) || 0,
        other_actual: Number(this.rec.other_actual) || 0,
        absent_students: (this.rec.absent_students || []).map((s) => ({ cls: s.cls || '', name: s.name || '' })),
        // 请假原因已下线：历史 reason/note 不再读入修正表单
        leave_students: (this.rec.leave_students || []).map((s) => ({
          cls: s.cls || '', name: s.name || '',
        })),
      }
      // 人数>0 但原名单不足时补齐空行，方便直接编辑
      this.syncEditStudents('absent')
      this.syncEditStudents('leave')
      this.editing = true
    },
    // 人数变化时同步名单行数（加人补空行、减人截断）
    pasteEditStudents(kind) {
      const label = kind === 'absent' ? '旷课' : '请假'
      const text = window.prompt(
        `粘贴${label}名单，每行一个同学\n格式：班级 姓名（空格或逗号分隔）\n例如：\n13002608 张三`,
        ''
      )
      if (!text) return
      const rows = []
      text.split(/\r?\n/).forEach((line) => {
        const t = line.trim()
        if (!t) return
        const parts = t.split(/[\s,，\t]+/).filter(Boolean)
        if (!parts.length) return
        rows.push({ cls: parts[0], name: parts.slice(1).join('') })
      })
      if (!rows.length) { U.toast('没识别到内容', 'bad'); return }
      const cntKey = kind === 'absent' ? 'absent_count' : 'leave_count'
      const key = kind === 'absent' ? 'absent_students' : 'leave_students'
      this.edit[key] = rows
      this.edit[cntKey] = rows.length
      U.toast(`已导入 ${rows.length} 条${label}名单`)
    },
    syncEditStudents(kind) {
      const cntKey = kind === 'absent' ? 'absent_count' : 'leave_count'
      const key = kind === 'absent' ? 'absent_students' : 'leave_students'
      const n = Math.max(0, Math.min(Number(this.edit[cntKey]) || 0, 100))
      const arr = this.edit[key] || (this.edit[key] = [])
      if (arr.length > n) {
        const dropped = arr.slice(n)
        const hasData = dropped.some((x) => String(x.cls || '').trim() || String(x.name || '').trim())
        if (hasData && !window.confirm(`人数减少，将删除最后 ${dropped.length} 条已填名单，确定？`)) {
          this.edit[cntKey] = arr.length
          return
        }
      }
      this.edit[cntKey] = n
      while (arr.length < n) arr.push({ cls: '', name: '' })
      if (arr.length > n) arr.splice(n)
    },
    diffText(r) {
      const before = r.before_row || {}
      const after = r.after_row || {}
      const parts = []
      Object.keys(FIELD_LABELS).forEach((k) => {
        const a = before[k]
        const b = after[k]
        const sa = fieldText(a)
        const sb = fieldText(b)
        if (sa !== sb) parts.push(`${FIELD_LABELS[k]}：${sa || '空'} → ${sb || '空'}`)
      })
      return parts.length ? parts.join('；') : '保存了一次修改（内容与之前一致）'
    },
    async save() {
      if (!this.edit.correction_note.trim()) { this.err = '请填写修正原因'; return }
      // 名单必须与人数一致，且每行班级+姓名都填
      for (const kind of ['absent', 'leave']) {
        const cnt = Number(this.edit[kind === 'absent' ? 'absent_count' : 'leave_count']) || 0
        const arr = this.edit[kind === 'absent' ? 'absent_students' : 'leave_students'] || []
        const label = kind === 'absent' ? '旷课' : '请假'
        if (arr.length !== cnt) { this.err = label + '名单与人数不一致，请补全'; return }
        if (arr.some((s) => !String(s.cls || '').trim() || !String(s.name || '').trim())) {
          this.err = label + '名单里每位同学的班级和姓名都要填'
          return
        }
      }
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
            absent_count: Number(this.edit.absent_count) || 0,
            leave_count: Number(this.edit.leave_count) || 0,
            absent_students: this.edit.absent_students || [],
            // 请假名单只提交班级与姓名（原因字段已下线）
            leave_students: (this.edit.leave_students || []).map((s) => ({
              cls: s.cls, name: s.name,
            })),
            remark: this.edit.remark || '',
            discipline_note: this.edit.discipline_note || '',
            teacher_status: this.edit.teacher_status || '',
            phone_count: Number(this.edit.phone_count) || 0,
            sleep_count: Number(this.edit.sleep_count) || 0,
            phone_10: Number(this.edit.phone_10) || 0,
            sleep_10: Number(this.edit.sleep_10) || 0,
            phone_30: Number(this.edit.phone_30) || 0,
            sleep_30: Number(this.edit.sleep_30) || 0,
            teacher_score: Number(this.edit.teacher_score) || 9.5,
            student_score: Number(this.edit.student_score) || 9.5,
            correction_note: this.edit.correction_note.trim(),
          },
        })
        this.rec = row
        this.editing = false
        U.toast('已修正并留痕')
        Store.clearRpcCache()
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
        const d = await Store.rpcCached('admin_record_get', { p_id: Number(id) }, 30000)
        this.rec = d.record
        this.revisions = d.revisions || []
        Store.rpcCached('photo_times', { p_record_id: Number(id) }, 300000)
          .then((t) => { this.photoTimes = t })
          .catch(() => {})
      } catch (e) { U.toast(U.errText(e), 'bad'); this.back() }
    },
    photoTakeText() {
      const t = this.photoTimes && (this.photoTimes.taken_at || this.photoTimes.created_at)
      return t ? U.dayTime(t) : '—'
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
              <td>
                <span class="badge" :class="m.role === 'admin' ? 'badge-pri' : ''">{{ m.role === 'admin' ? '管理员' : '组员' }}</span>
                <span class="badge" :class="m.has_email ? 'badge-ok' : 'badge-warn'" style="margin-left:4px">{{ m.has_email ? '已绑邮箱' : '未绑邮箱' }}</span>
              </td>
              <td><span class="badge" :class="m.status === 'active' ? 'badge-ok' : 'badge-bad'">{{ m.status === 'active' ? '在用' : '已停用' }}</span></td>
              <td class="tiny muted">{{ m.last_login_at ? U.dayTime(m.last_login_at) : '从未' }}</td>
              <td>
                <div class="row" style="gap:6px">
                  <button class="btn btn-sm" @click="toggleRole(m)">{{ m.role === 'admin' ? '降为组员' : '设为管理员' }}</button>
                  <button class="btn btn-sm" v-if="m.has_email" @click="unbindEmail(m)">解绑邮箱</button>
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
              <span class="badge" :class="m.has_email ? 'badge-ok' : 'badge-warn'">{{ m.has_email ? '已绑邮箱' : '未绑邮箱' }}</span>
              <span class="badge" :class="m.status === 'active' ? 'badge-ok' : 'badge-bad'">{{ m.status === 'active' ? '在用' : '已停用' }}</span>
              <span>{{ m.last_login_at ? U.dayTime(m.last_login_at) : '从未登录' }}</span>
            </div>
            <div class="mem-acts">
              <button class="btn btn-sm" @click="toggleRole(m)">{{ m.role === 'admin' ? '降为组员' : '设为管理员' }}</button>
              <button class="btn btn-sm" v-if="m.has_email" @click="unbindEmail(m)">解绑邮箱</button>
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
      初始密码为本人学号，建议首次登录后自行修改（不强制）。忘记密码请联系管理员，由管理员在成员管理中重置为学号，登录后建议重新设密。
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
      return `【学风建设系统使用说明】\n1. 手机浏览器打开：${link}\n2. 账号是你的姓名，初始密码是你的学号\n3. 初始密码是学号，建议登录后在「我的 → 设置」改成只有你知道的密码\n4. 周末先「选下周要查的课」，工作日回来填写查课结果\n5. 忘记密码：联系管理员，在成员管理中重置为你的学号，登录后建议重新设密`
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
      try { this.users = await Store.rpcCached('staff_list', {}, 120000) || [] } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    // 3.3：删掉「重置密码」——SDK 是唯一身份来源，改业务库 password_hash 对邮箱登录无效。
    // 解绑邮箱：清空绑定，账号进入「待认领」状态。
    // 3.8.1 起姓名登录已在服务端关闭，所以解绑后用户不能再用姓名登录，
    // 必须让本人用「姓名 + 学号」重新认领邮箱（认领会同时设置新密码）。
    unbindEmail(m) {
      this.confirmAct = {
        title: '解绑邮箱',
        desc: `将「${m.name}」的邮箱（${m.email || '已绑定'}）解绑？\n\n解绑后会做三件事：\n· 清空邮箱绑定，账号进入「待认领」状态\n· 请让本人用「姓名 + 学号」重新认领邮箱，认领时设置新密码\n· 写一条操作留痕\n\n注意：姓名登录已关闭，解绑后本人不能用姓名登录，只能走认领。\n历史记录、照片、课检数据都不受影响。`,
        okText: '解绑',
        run: async () => {
          await Store.rpc('admin_unbind_email', { p_user_id: m.id })
          U.toast('已解绑，请让本人用姓名 + 学号重新认领邮箱')
          Store.clearRpcCache()
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
          Store.clearRpcCache()
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
          Store.clearRpcCache()
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

    <!-- 3.5 选课时间窗口设置（PRD §5.3：四个输入 + 总开关 + 当前状态实时预览） -->
    <div class="card">
      <div class="hd"><h2>选课时间窗口</h2><span class="tiny muted">{{ gateWin ? (gateWin.open ? '当前已开放' : '当前已关闭') : '' }}</span></div>
      <div class="field">
        <label class="label">总开关</label>
        <div class="chips">
          <div class="chip" :class="{ on: gateForm.plan_gate_on }" @click="gateForm.plan_gate_on = true">开启</div>
          <div class="chip" :class="{ on: !gateForm.plan_gate_on }" @click="gateForm.plan_gate_on = false">关闭（全天开放）</div>
        </div>
        <div class="hint">关闭后选课行为与旧版完全一致（应急回滚开关）；开启后仅在下方时间窗内可新增选课，已选课程随时可改。</div>
      </div>
      <div class="row" style="gap:8px">
        <div class="field grow">
          <label class="label">开放星期</label>
          <select class="input" v-model.number="gateForm.plan_open_wd">
            <option v-for="(w, i) in WDS" :key="'o' + i" :value="i + 1">{{ w }}</option>
          </select>
        </div>
        <div class="field grow">
          <label class="label">开放时刻</label>
          <input class="input" type="time" v-model="gateForm.plan_open_at">
        </div>
      </div>
      <div class="row" style="gap:8px">
        <div class="field grow">
          <label class="label">关闭星期</label>
          <select class="input" v-model.number="gateForm.plan_close_wd">
            <option v-for="(w, i) in WDS" :key="'c' + i" :value="i + 1">{{ w }}</option>
          </select>
        </div>
        <div class="field grow">
          <label class="label">关闭时刻</label>
          <input class="input" type="time" v-model="gateForm.plan_close_at">
        </div>
      </div>
      <div class="sub" v-if="gateWin" style="color:var(--pri)">当前状态：{{ gateWin.nextOpenText }}（{{ gateWin.openText }} → {{ gateWin.closeText }}）</div>
      <div class="tiny muted" v-else-if="!gateWin">正在读取窗口状态…</div>
      <button class="btn btn-primary btn-block mt8" :disabled="gateBusy" @click="saveGate">保存窗口设置</button>
    </div>
  </div>`,

  data() { return { U, list: [], busy: false, form: { id: '', name: '', start_monday: '', total_weeks: 18 },
    WDS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    gateForm: { plan_gate_on: true, plan_open_wd: 5, plan_open_at: '17:00', plan_close_wd: 7, plan_close_at: '23:59' },
    gateWin: null, gateBusy: false } },
  mounted() { this.load(); this.loadGate() },
  methods: {
    go(p) { Store.nav(p) },
    reset() { this.form = { id: '', name: '', start_monday: '', total_weeks: 18 } },
    edit(s) { this.form = { id: s.id, name: s.name, start_monday: s.start_monday, total_weeks: s.total_weeks } },
    async load() {
      try { this.list = await Store.rpcCached('semester_list', {}, 120000) || [] } catch (e) { U.toast(U.errText(e), 'bad') }
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
        Store.clearRpcCache()
        this.reset()
        await this.load()
        await Store.refresh()
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.busy = false }
    },
    async setCurrent(s) {
      try {
        await Store.rpc('semester_set_current', { p_id: s.id })
        U.toast('已设为当前学期')
        Store.clearRpcCache()
        await this.load()
        await Store.refresh()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    // ---------- 3.5 选课时间窗口 ----------
    async loadGate() {
      try {
        const cfg = await Store.rpc('admin_config_get', {})
        if (cfg) this.gateForm = {
          plan_gate_on: !!cfg.plan_gate_on,
          plan_open_wd: Number(cfg.plan_open_wd) || 5,
          plan_open_at: cfg.plan_open_at || '17:00',
          plan_close_wd: Number(cfg.plan_close_wd) || 7,
          plan_close_at: cfg.plan_close_at || '23:59',
        }
        this.gateWin = await Store.rpc('app_plan_window', {}, true)
      } catch (e) { this.gateWin = null; U.toast(U.errText(e), 'bad') }
    },
    async saveGate() {
      const f = this.gateForm
      if (!f.plan_open_at || !f.plan_close_at) return U.toast('请填写开放与关闭时刻', 'bad')
      if (f.plan_gate_on && f.plan_open_wd === f.plan_close_wd && f.plan_open_at === f.plan_close_at) {
        return U.toast('开放与关闭时刻相同，窗口永远为空，请调整', 'bad')
      }
      this.gateBusy = true
      try {
        this.gateWin = await Store.rpc('admin_config_save', { p_payload: { ...f } })
        U.toast('已保存，状态预览已刷新')
        Store.clearRpcCache()
      } catch (e) { U.toast(U.errText(e), 'bad') } finally { this.gateBusy = false }
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
      <div class="hd"><h2>选择范围</h2><span class="tiny muted">{{ sem ? sem.name : '' }}</span></div>
      <div class="chips mt8">
        <div class="chip" :class="{ on: mode === 'this' }" @click="setMode('this')">本周</div>
        <div class="chip" :class="{ on: mode === 'last' }" :style="canLast ? '' : 'opacity:.45;pointer-events:none'"
             @click="setMode('last')">上周</div>
        <div class="chip" :class="{ on: mode === 'range' }" @click="setMode('range')">区间</div>
      </div>
      <div class="row wrap mt8" v-if="mode === 'range'">
        <select class="select" style="max-width:130px" v-model.number="from" @change="preview()">
          <option v-for="w in weekList" :key="'f' + w" :value="w">第 {{ w }} 周</option>
        </select>
        <span class="muted">至</span>
        <select class="select" style="max-width:130px" v-model.number="to" @change="preview()">
          <option v-for="w in weekList" :key="'t' + w" :value="w">第 {{ w }} 周</option>
        </select>
      </div>
      <div class="hint">{{ rangeHint }}</div>
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

  data() {
    return {
      // 三种范围：this=本周（默认） / last=上周 / range=按周次区间
      mode: 'this', from: 0, to: 0,
      busy: false, loading: false, count: null, summary: '', gradeCounts: { '大一': 0, '大二': 0, '大三': 0 },
    }
  },
  computed: {
    sem() { return Store.store.semester },
    weekList() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const list = []
      for (let w = 1; w <= max; w++) list.push(w)
      return list
    },
    curWeek() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      return Math.max(1, Math.min(max, Store.weekNow() || 1))
    },
    canLast() { return this.curWeek > 1 },
    rangeHint() {
      const [a, b] = this.range()
      const scope = a === b ? `第 ${a} 周` : `第 ${a}-${b} 周`
      return `${scope} · 包含「大一 / 大二 / 大三」三个工作表，按查课时间排序`
    },
  },
  mounted() {
    const cur = this.curWeek
    this.from = cur
    this.to = cur
    if (this.mode === 'last' && !this.canLast) this.mode = 'this'
    this.preview()
    // 提前加载 SheetJS，避免点「生成并下载」时因异步加载丢失用户手势导致不触发下载
    XLS.loadXLSX().catch(() => {})
  },
  watch: {
    // 进入页面与切换范围时自动统计，无需手动点「预览数量」
    mode() { this.preview() },
  },
  methods: {
    go(p) { Store.nav(p) },
    setMode(m) {
      if (m === 'last' && !this.canLast) return
      this.mode = m
      if (m === 'range') {
        const cur = this.curWeek
        if (!this.from) this.from = cur
        if (!this.to) this.to = cur
      }
    },
    // 统一出口：所有取数都走这里，避免「显示的范围」与「实际取数」不一致
    range() {
      const max = Store.store.semester ? Store.store.semester.total_weeks : 18
      const clamp = (v) => Math.max(1, Math.min(max, Number(v) || 1))
      const cur = this.curWeek
      if (this.mode === 'last') { const w = clamp(cur - 1); return [w, w] }
      if (this.mode === 'range') {
        let a = clamp(this.from), b = clamp(this.to)
        if (a > b) { const t = a; a = b; b = t }   // 起止填反了自动纠正，不报错
        return [a, b]
      }
      return [clamp(cur), clamp(cur)]
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
            <input class="input cls-num" v-model="c.expected" inputmode="numeric" placeholder="应到 1~50">
            <button type="button" class="btn btn-sm btn-danger" v-if="form.classes.length > 1" @click="removeClass(i)">删</button>
            <button type="button" class="cls-add" v-if="canAdd(i)" @click="addClass">＋</button>
          </div>
          <div class="tiny muted">班级号填 8 位数字，应到填该班点名册人数（<b>每班 1~50 人</b>）。</div>

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
        const exp = Number(c.expected)
        if (!Number.isFinite(exp) || exp < 1 || exp > 50) return c.code + ' 的应到人数需在 1~50 之间（单班最多 50 人）'
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
          Store.rpcCached('staff_list', {}, 120000),
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
        Store.clearRpcCache()
        Store.nav('/admin/checks?week=' + this.weekTarget)
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
  },
}

/* 选课回收站：plan_delete 是软删除，删除的选课存在 check_plan_trash，可在此恢复 */
window.Views.AdminTrash = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>选课回收站</h1>
      <div class="side right">
        <button class="iconbtn" @click="load" title="刷新" :disabled="loading">↻</button>
      </div>
    </div>

    <div class="card mt12">
      <div class="row between">
        <span class="strong">已删除的选课</span>
        <span class="tiny muted">{{ list.length }} 条</span>
      </div>
      <div class="tiny muted mt8">删除选课只是把它移到这里，不会真正丢失；点「恢复」即可放回原成员的课表。</div>

      <div class="list mt12" v-if="list.length">
        <div class="litem" v-for="t in list" :key="t.id">
          <div class="row between">
            <div class="t1">{{ t.course_name }}<span class="ibox ibox-muted">{{ t.owner_name }}</span><span class="ibox ibox-pri" v-if="t.room">教室 {{ t.room }}</span></div>
            <span class="badge">第 {{ t.week_no }} 周</span>
          </div>
          <div class="t2">
            <span class="ibox">{{ U.md(t.check_date) }} {{ U.weekdayCN(t.check_date) }}</span>
            <span class="ibox">{{ U.periodText(t.period_from, t.period_to) }}</span>
            <span class="ibox" v-for="(c, ci) in classCodes(t)" :key="'c' + ci">{{ c }}</span>
          </div>
          <div class="tiny muted mt8">删除于 {{ U.dayTime(t.deleted_at) }}{{ t.deleted_by_name ? ' · ' + t.deleted_by_name : '' }}</div>
          <div class="row mt8" style="gap:8px">
            <button class="btn btn-sm" :disabled="busy === t.id" @click="restore(t)">{{ busy === t.id ? '恢复中…' : '恢复这节课' }}</button>
          </div>
        </div>
      </div>

      <div class="muted sm mt12" v-else-if="loading">正在加载…</div>
      <div class="muted sm mt12" v-else>回收站是空的，没有已删除的选课。</div>
    </div>
  </div>`,

  data() { return { U, list: [], loading: true, busy: 0 } },
  mounted() { this.load() },
  methods: {
    back() { if (history.length > 1) history.back(); else Store.nav('/admin/checks') },
    classCodes(t) {
      const arr = Array.isArray(t.classes) ? t.classes.map((c) => c && c.code).filter(Boolean) : []
      if (arr.length) return arr.sort((a, b) => U.classCompare(a, b))
      return String(t.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter((s) => s && s !== '其他')
    },
    async load() {
      this.loading = true
      try {
        this.list = (await Store.rpc('admin_plan_trash_list', {})) || []
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
    async restore(t) {
      this.busy = t.id
      try {
        await Store.rpc('plan_restore', { p_trash_id: t.id })
        U.toast('已恢复「' + t.course_name + '」')
        Store.clearRpcCache()
        this.list = this.list.filter((x) => x.id !== t.id)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.busy = 0
      }
    },
  },
}

/* 班级查课覆盖：按周统计大一年级各班的查课次数（PRD v1.0）
   数据源 admin_class_coverage，班级全集来自 duty_classes，保证 0 次的班也会出现 */
window.Views.AdminCoverage = {
  template: `
  <div class="shell shell-wide">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>班级查课覆盖</h1>
      <div class="side right">
        <button class="iconbtn" @click="load" title="刷新" :disabled="loading">↻</button>
      </div>
    </div>

    <div class="card mt12" v-if="err">
      <div class="empty">{{ err }}</div>
      <button class="btn btn-primary btn-block mt12" @click="goSemesters">去学期设置</button>
    </div>

    <template v-else>
      <div class="card mt12">
        <div class="weeknav">
          <button class="btn btn-sm" :disabled="week <= 1 || loading" @click="shift(-1)">‹ 上一周</button>
          <div class="cur"><div class="w">第 <span class="w-num">{{ week }}</span> 周</div><div class="d">{{ rangeText }}</div></div>
          <button class="btn btn-sm" :disabled="week >= maxWeek || loading" @click="shift(1)">下一周 ›</button>
        </div>
        <div class="tiny muted center mt8">大一 {{ rows.length }} 个班 · 按班级号排序</div>
      </div>

      <div class="card mt12">
        <div class="tablewrap">
          <table class="tb">
            <thead>
              <tr><th>班级</th><th class="num">计划</th><th class="num">已查</th><th class="num">待查</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.code">
                <td class="strong cov-code">{{ r.code }}</td>
                <td class="num">{{ r.plans }}</td>
                <td class="num">{{ r.records }}</td>
                <td class="num" :class="Number(r.pending) > 0 ? 'cov-pend' : 'muted'">{{ r.pending }}</td>
              </tr>
              <tr v-if="!rows.length">
                <td colspan="4" class="center muted" style="padding:24px">{{ loading ? '加载中…' : '这一周还没有查课记录' }}</td>
              </tr>
            </tbody>
            <tfoot v-if="rows.length">
              <tr>
                <td class="strong">合计 {{ rows.length }} 个班</td>
                <td class="num strong">{{ totals.plans }}</td>
                <td class="num strong">{{ totals.records }}</td>
                <td class="num strong">{{ totals.pending }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>`,

  data() { return { U, week: 0, maxWeek: 18, rows: [], loading: true, err: '' } },
  computed: {
    rangeText() { return weekRangeText(this.week) },
    totals() {
      return this.rows.reduce((a, r) => ({
        plans: a.plans + (Number(r.plans) || 0),
        records: a.records + (Number(r.records) || 0),
        pending: a.pending + (Number(r.pending) || 0),
      }), { plans: 0, records: 0, pending: 0 })
    },
  },
  mounted() { this.init() },
  methods: {
    back() { if (history.length > 1) history.back(); else Store.nav('/me') },
    goSemesters() { Store.nav('/admin/semesters') },
    // 每次进入都回到当前周，不记忆上次浏览的周次（PRD 5.1）
    init() {
      if (!Store.store.semester) {
        this.err = '请先在学期设置里配置当前学期'
        this.loading = false
        return
      }
      this.maxWeek = Store.weekMax() || 18
      const w = Store.weekNow() || 1
      this.week = Math.min(Math.max(1, w), this.maxWeek)
      this.load()
    },
    shift(d) {
      const w = this.week + d
      if (w < 1 || w > this.maxWeek) return
      this.week = w
      this.load()
    },
    async load() {
      this.loading = true
      try {
        this.rows = (await Store.rpcCached('admin_class_coverage', { p_week: this.week }, 30000)) || []
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
  },
}

/* 照片迁移：把历史 base64 照片搬到对象存储（3.5.3）
   安全策略：逐张处理；上传成功才提交路径，提交成功才清空 base64；失败保留原数据。
   时间戳（taken_at / created_at）由 photo_migrate_commit 原样保留，不做修改。 */
window.Views.PhotoMigrate = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="go('/me')">‹</button></div>
      <h1>照片迁移</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>历史照片转对象存储</h2></div>
      <div class="stat-grid">
        <div class="stat"><div class="n">{{ total }}</div><div class="t">待迁移</div></div>
        <div class="stat ok"><div class="n">{{ done }}</div><div class="t">本次成功</div></div>
        <div class="stat warn"><div class="n">{{ failed }}</div><div class="t">本次失败</div></div>
      </div>
      <div class="tiny muted mt12">合计约 {{ sizeText }}。只搬位置，不改拍摄与提交时间；失败的照片会保留原数据，可重试。</div>
      <button class="btn btn-primary btn-block mt12" :disabled="busy || loading || !total" @click="run">
        {{ busy ? '迁移中 ' + done + '/' + (done + failed + (total - done - failed)) : (total ? '开始迁移 ' + total + ' 张' : '没有待迁移的照片') }}
      </button>
      <button class="btn btn-block mt8" :disabled="busy" @click="loadPending">刷新</button>
    </div>

    <div class="card" v-if="fails.length">
      <div class="hd"><h2>失败明细（保留原数据）</h2></div>
      <div class="list">
        <div class="litem" v-for="f in fails" :key="'f' + f.id" style="cursor:default">
          <div class="t1">照片 #{{ f.id }}</div>
          <div class="t2">{{ f.msg }}</div>
        </div>
      </div>
    </div>

    <div class="card" v-if="finished && !busy">
      <div class="hd"><h2>迁移完成</h2></div>
      <div class="sub">全部照片已在对象存储，数据库里的 base64 已清空。</div>
      <div class="tiny muted mt8">磁盘空间需管理员在库端执行 VACUUM 后才会真正释放（页面上做不到）。</div>
      <button class="btn btn-block mt12" @click="go('/me')">返回我的</button>
    </div>
  </div>`,

  data() {
    return { pending: [], busy: false, loading: true, done: 0, failed: 0, fails: [], finished: false }
  },
  computed: {
    total() { return this.pending.length },
    sizeText() {
      const b = this.pending.reduce((s, p) => s + (Number(p.bytes) || 0), 0)
      if (!b) return '0 KB'
      if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'
      return (b / 1024 / 1024).toFixed(1) + ' MB'
    },
  },
  mounted() { this.loadPending() },
  methods: {
    go(p) { Store.nav(p) },
    async loadPending() {
      this.loading = true
      try {
        const list = await Store.rpc('photo_migrate_pending', {})
        this.pending = Array.isArray(list) ? list : []
        this.finished = this.pending.length === 0
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
    // base64 data URL → Blob（走 fetch 解码，兼容 data:image/jpeg;base64,...）
    async toBlob(dataUrl, mime) {
      const r = await fetch(dataUrl)
      const b = await r.blob()
      return mime ? new Blob([b], { type: mime }) : b
    },
    async upload(path, dataUrl, mime) {
      if (!window.cloud || !window.cloud.storage || !window.cloud.storage.upload) throw new Error('文件存储未就绪，请刷新重试')
      const blob = await this.toBlob(dataUrl, mime)
      await window.cloud.storage.upload(path, blob)
    },
    async run() {
      if (this.busy) return
      this.busy = true
      this.done = 0
      this.failed = 0
      this.fails = []
      const list = this.pending.slice()
      for (const it of list) {
        try {
          const ph = await Store.rpc('photo_get', { p_id: it.id })
          if (!ph || !ph.data) throw new Error('这条照片没有原图数据，跳过')
          const dataPath = 'users/' + it.owner_id + '/photos/' + it.id + '-full.jpg'
          await this.upload(dataPath, ph.data, ph.mime || 'image/jpeg')
          let thumbPath = ''
          if (ph.thumb) {
            thumbPath = 'users/' + it.owner_id + '/photos/' + it.id + '-thumb.jpg'
            try { await this.upload(thumbPath, ph.thumb, 'image/jpeg') } catch (e) { thumbPath = '' }
          }
          await Store.rpc('photo_migrate_commit', {
            p_id: it.id,
            p_storage_path: dataPath,
            p_thumb_path: thumbPath,
            p_bytes: Number(it.bytes) || 0,
          })
          this.done += 1
        } catch (e) {
          this.failed += 1
          this.fails.push({ id: it.id, msg: U.errText(e) || String((e && e.message) || e) })
        }
      }
      await this.loadPending()
      this.busy = false
    },
  },
}
