// 填报 / 记录详情 / 我的
window.Views = window.Views || {}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('照片读取失败'))
    fr.readAsDataURL(blob)
  })
}

// 老记录只有总实到、没有逐班实到：按应到占比拆到各班，保证合计不变
function spreadActual(list, total) {
  const sum = list.reduce((s, c) => s + c.expected, 0)
  if (!sum) return list.map((c) => ({ ...c, actual: 0 }))
  let used = 0
  return list.map((c, i) => {
    let a = i === list.length - 1 ? total - used : Math.round((total * c.expected) / sum)
    a = Math.max(0, Math.min(c.expected, a))
    used += a
    return { ...c, actual: a }
  })
}

window.Views.ConfNum = {
  props: { label: String, modelValue: Number, confirmed: Boolean },
  emits: ['update:modelValue', 'update:confirmed', 'confirm'],
  template: `
  <div class="card tight num-field" style="margin-bottom:10px">
    <div class="row between" style="margin-bottom:6px">
      <span class="label" style="margin:0">{{ label }}</span>
      <span class="tiny" :style="confirmed ? 'color:var(--ok)' : 'color:var(--muted)'">{{ confirmed ? '✓ 已确定' : '点确定' }}</span>
    </div>
    <div class="stepper">
      <button type="button" @click="bump(-1)">−</button>
      <input class="val num" type="number" inputmode="numeric" :value="modelValue" @input="onInput" @blur="normalize" @keyup.enter="$event.target.blur()">
      <button type="button" @click="bump(1)">＋</button>
      <button type="button" class="btn btn-sm btn-primary" style="margin-left:6px" @click="$emit('confirm')">确定</button>
    </div>
  </div>`,
  methods: {
    bump(d) {
      const v = Math.max(0, (Number(this.modelValue) || 0) + d)
      this.$emit('update:modelValue', v)
      this.$emit('update:confirmed', false)
    },
    onInput(e) {
      const raw = e.target.value
      if (raw === '') { this.$emit('update:modelValue', 0); this.$emit('update:confirmed', false); return }
      this.$emit('update:modelValue', Math.max(0, Math.floor(Number(raw) || 0)))
      this.$emit('update:confirmed', false)
    },
    normalize(e) { e.target.value = Number(this.modelValue) || 0 },
  },
}

window.Views.NumField = {
  props: { label: String, modelValue: Number, hint: String, min: { type: Number, default: 0 } },
  emits: ['update:modelValue'],
  template: `
  <div class="card tight num-field" style="margin-bottom:10px">
    <div class="row between" style="margin-bottom:6px">
      <span class="label" style="margin:0">{{ label }}</span>
      <span class="tiny muted" v-if="hint">{{ hint }}</span>
    </div>
    <div class="stepper">
      <button type="button" @click="bump(-1)">−</button>
      <input class="val num" type="number" inputmode="numeric" :value="modelValue" @input="onInput" @blur="normalize">
      <button type="button" @click="bump(1)">＋</button>
    </div>
  </div>`,
  methods: {
    bump(d) {
      const v = Math.max(this.min, (Number(this.modelValue) || 0) + d)
      this.$emit('update:modelValue', v)
    },
    onInput(e) {
      const raw = e.target.value
      if (raw === '') { this.$emit('update:modelValue', 0); return }
      const v = Math.max(this.min, Math.floor(Number(raw) || 0))
      this.$emit('update:modelValue', v)
    },
    normalize(e) {
      e.target.value = Number(this.modelValue) || 0
    },
  },
}

window.Views.FillView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>{{ isEdit ? '申请修改查课结果' : '填写查课结果' }}</h1>
      <div class="side right"></div>
    </div>

    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>{{ isEdit ? '保存失败' : '提交失败' }}</h3>
        <div class="sub errmsg">{{ err }}</div>
        <button class="btn btn-primary btn-block" @click="err = ''">知道了</button>
      </div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>现场照片 <span class="badge badge-bad">必填</span></h2><span class="tiny muted">{{ photos.length }} / 2</span></div>
      <div class="photo-grid">
        <div class="photo-item" v-for="(ph, i) in photos" :key="ph.key">
          <img v-if="ph.preview" :src="ph.preview" alt="现场照片">
          <div v-else class="photo-ph">照片</div>
          <button type="button" class="photo-x" @click="removePhoto(i)">✕</button>
        </div>
        <label class="photo-add" v-if="photos.length < 2">
          <input type="file" accept="image/*" capture="environment" @change="onPick" hidden>
          <span class="photo-add-ic">＋</span>
          <span class="photo-add-t">拍照 / 选择</span>
        </label>
      </div>
      <div class="tiny mt8" style="color:var(--bad)">课检员考勤需要，至少上传 1 张现场照片后才能提交。</div>
      <div class="tiny muted mt8">最多 2 张，自动压缩到 500KB 以内。建议拍教室全景或黑板，避免人脸特写。</div>
    </div>

    <!-- ===== 课程信息 + 出勤情况（合并：出勤紧跟课检班级实到） ===== -->
    <div class="card mt12">
      <template v-if="isExtra">
      <div class="hd"><h2>课程信息</h2><span class="badge badge-warn">计划外</span></div>

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
        <label class="label">课检时间<i class="req">*</i></label>
        <input class="input" type="date" v-model="form.check_date" :min="minDate" :max="maxDate">
        <div class="chips mt8">
          <div class="chip" v-for="p in periods" :key="p[0]" :class="{on: form.period_from===p[0]}" @click="setPeriod(p)">
            {{ U.periodText(p[0], p[1]) }}
          </div>
        </div>
      </div>
      <div class="field">
        <label class="label">预计到岗时间</label>
        <div class="chips mt8">
          <div class="chip" :class="{on: form.arrive_before === 'p1'}" @click="form.arrive_before = 'p1'">第一节课前</div>
          <div class="chip" :class="{on: form.arrive_before === 'p2'}" @click="form.arrive_before = 'p2'">第二节课前</div>
        </div>
      </div>
      <div class="field">
        <label class="label">被查班级<i class="req">*</i></label>
        <input class="input" v-model="form.class_name" maxlength="40" placeholder="如：13002605">
      </div>
      <num-field label="应到人数" v-model="form.expected_count" hint="点名册人数"></num-field>
      </template>

      <template v-else>
      <div class="center" style="margin-bottom:12px">
        <button type="button" class="btn btn-sm" @click="courseEdit = !courseEdit">
          {{ courseEdit ? '完成更改' : '更改课程信息' }}
        </button>
      </div>
      <div class="hd">
        <h2>课程信息</h2>
        <span class="badge" :class="isEdit ? 'badge-warn' : 'badge-pri'">{{ isEdit ? '修改中' : '计划内' }}</span>
      </div>

      <template v-if="courseEdit">
        <div class="kvrow"><span class="k">课程名称</span><span class="v strong">{{ form.course_name }}</span></div>
        <div class="kvrow"><span class="k">任课老师</span><span class="v">{{ form.teacher || '—' }}</span></div>
        <div class="kvrow"><span class="k">教室</span><span class="v strong">{{ form.room || '—' }}</span></div>
        <div class="kvrow"><span class="k">课检时间</span><span class="v">{{ weekText }} {{ U.periodText(form.period_from, form.period_to) }}</span></div>
        <div class="tiny muted mt8">课程名称、任课老师、教室、课检时间与计划一致，不可更改；确实有误请联系管理员修正。</div>
        <div class="field mt12">
          <label class="label">预计到岗时间</label>
          <div class="chips mt8">
            <div class="chip" :class="{on: form.arrive_before === 'p1'}" @click="form.arrive_before = 'p1'">第一节课前</div>
            <div class="chip" :class="{on: form.arrive_before === 'p2'}" @click="form.arrive_before = 'p2'">第二节课前</div>
          </div>
          <div class="hint">与选课时一致，二选一</div>
        </div>
        <div class="tiny muted">应到人数在下方「课检班级」里逐班修改（其他类同）。</div>
      </template>
      <template v-else>
        <div class="kvrow"><span class="k">课程名称</span><span class="v strong">{{ form.course_name }}</span></div>
        <div class="kvrow"><span class="k">任课老师</span><span class="v">{{ form.teacher || '—' }}</span></div>
        <div class="kvrow"><span class="k">教室</span><span class="v strong">{{ form.room || '—' }}</span></div>
        <div class="kvrow"><span class="k">课检时间</span><span class="v">{{ weekText }} {{ U.periodText(form.period_from, form.period_to) }}</span></div>
        <div class="kvrow" v-if="form.arrive_before"><span class="k">预计到岗</span><span class="v">{{ U.arriveText(form.arrive_before) }}</span></div>
      </template>

      <div class="kvrow" v-if="!form.classes.length"><span class="k">课检班级</span><span class="v">{{ form.class_name }}</span></div>

      <template v-if="form.classes.length">
        <div class="cstat-hd">
          <span class="label" style="margin:0">课检班级</span>
          <span class="tiny muted">逐班填实到</span>
        </div>
        <div class="cstat" v-for="(c, i) in form.classes" :key="c.code + i">
          <div class="cstat-code">{{ c.code }}</div>
          <div class="cstat-exp">
            <template v-if="courseEdit">应到 <input class="val num" style="width:48px;text-align:center" type="number" min="0" v-model.number="c.expected" @blur="clampExpected(i)"></template>
            <template v-else>应到 {{ c.expected }}</template>
          </div>
          <div class="stepper mini">
            <button type="button" @click="bumpActual(i, -1)">−</button>
            <input class="val num" type="number" inputmode="numeric" v-model.number="c.actual" @blur="clampActual(i)">
            <button type="button" @click="bumpActual(i, 1)">＋</button>
          </div>
        </div>
        <div class="cstat" v-if="otherExpected > 0">
          <div class="cstat-code">其他</div>
          <div class="cstat-exp">
            <template v-if="courseEdit">应到 <input class="val num" style="width:48px;text-align:center" type="number" min="0" v-model.number="form.other_expected" @blur="clampOtherExpected"></template>
            <template v-else>应到 {{ otherExpected }}</template>
          </div>
          <div class="stepper mini">
            <button type="button" @click="bumpOther(-1)">−</button>
            <input class="val num" type="number" inputmode="numeric" v-model.number="form.other_actual" @blur="clampOther">
            <button type="button" @click="bumpOther(1)">＋</button>
          </div>
        </div>
        <div class="cstat-total">
          <span class="k">合计</span>
          <span>应到 <b>{{ expectedTotal }}</b> · 实到 <b>{{ actualCount }}</b> <span class="muted">（{{ U.rate(actualCount, expectedTotal) || '—' }}）</span></span>
        </div>
      </template>
      </template>

      <div class="divider"></div>
      <div class="hd">
        <h2>出勤情况</h2>
        <span class="tiny muted" v-if="planMode">实到 {{ actualCount }} / 应到 {{ expectedTotal }}</span>
        <span class="tiny muted" v-else>实到自动计算</span>
      </div>

      <num-field v-if="!isExtra && !form.classes.length" label="应到人数" v-model="form.expected_count" hint="点名册人数"></num-field>

      <div class="grid2">
        <div class="count-col">
          <num-field label="旷课" v-model="form.absent_count"></num-field>
          <div class="stu-wrap" v-if="form.absent_count > 0">
            <div class="tiny muted mb8">旷课名单</div>
            <div class="stu-row" v-for="(s2, i) in form.absent_students" :key="'a' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" v-model="s2.cls" maxlength="20" placeholder="班级">
              <input class="input" v-model="s2.name" maxlength="20" placeholder="姓名">
            </div>
          </div>
        </div>
        <div class="count-col">
          <num-field label="请假" v-model="form.leave_count"></num-field>
          <div class="stu-wrap" v-if="form.leave_count > 0">
            <div class="tiny muted mb8">请假名单</div>
            <div class="stu-row" v-for="(s2, i) in form.leave_students" :key="'l' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" v-model="s2.cls" maxlength="20" placeholder="班级">
              <input class="input" v-model="s2.name" maxlength="20" placeholder="姓名">
            </div>
          </div>
        </div>
      </div>

      <div class="row between kv mt8" v-if="!planMode">
        <span class="muted">实到人数</span>
        <span class="strong num" :style="actualCount < 0 ? 'color:var(--bad)' : ''">{{ actualCount < 0 ? '人数超出' : actualCount }}</span>
      </div>
      <div class="tiny muted" v-if="!planMode">实到 = 应到 − 旷课 − 请假</div>
      <div class="tiny muted" v-else>实到按上方班级明细汇总；旷课、请假只用于记录名单。</div>

      <div class="kvrow mt12"><span class="k">应到人数</span><span class="v strong num">{{ expectedTotal }}</span></div>
      <div class="kvrow"><span class="k">辅导员</span><span class="v">{{ counselorText }}</span></div>
      <div class="kvrow"><span class="k">课检员</span><span class="v">{{ memberName }}</span></div>
    </div>


    <!-- ===== 课程主要内容 ===== -->
    <div class="card mt12">
      <div class="hd"><h2>课程主要内容</h2></div>
      <div class="field mb0">
        <label class="label">本节课程主要内容<i class="req">*</i></label>
        <textarea class="textarea textarea-xs" v-model="form.course_content" maxlength="200" placeholder="如：第三章 极限的计算"></textarea>
      </div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>课堂纪律</h2><span class="tiny muted">各项填完点确定</span></div>

      <div class="field">
        <label class="label">教师上课情况<i class="req">*</i></label>
        <select class="select" v-model="form.teacher_status">
          <option value="">请选择</option>
          <option v-for="opt in TEACHER_OPTS" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </div>

      <conf-num label="玩手机人数" v-model="form.phone_count" v-model:confirmed="confirmed.phone_count" @confirm="confirmed.phone_count = true"></conf-num>
      <conf-num label="睡觉人数" v-model="form.sleep_count" v-model:confirmed="confirmed.sleep_count" @confirm="confirmed.sleep_count = true"></conf-num>

      <div class="tiny muted mt16">开课 10 分钟</div>
      <conf-num label="10分钟玩手机" v-model="form.phone_10" v-model:confirmed="confirmed.phone_10" @confirm="confirmed.phone_10 = true"></conf-num>
      <conf-num label="10分钟睡觉" v-model="form.sleep_10" v-model:confirmed="confirmed.sleep_10" @confirm="confirmed.sleep_10 = true"></conf-num>

      <div class="tiny muted mt16">开课 30 分钟</div>
      <conf-num label="30分钟玩手机" v-model="form.phone_30" v-model:confirmed="confirmed.phone_30" @confirm="confirmed.phone_30 = true"></conf-num>
      <conf-num label="30分钟睡觉" v-model="form.sleep_30" v-model:confirmed="confirmed.sleep_30" @confirm="confirmed.sleep_30 = true"></conf-num>

      <div class="tiny muted mt8">每项填好后都要点「确定」。</div>
    </div>

    <div class="card mt12">
      <div class="hd"><h2>老师评分 / 学生评分</h2><span class="tiny muted">9.0 ~ 10.0 · 默认 9.5</span></div>
      <div class="card tight num-field" style="margin-bottom:10px">
        <div class="row between" style="margin-bottom:6px">
          <span class="label" style="margin:0">老师评分</span>
          <span class="tiny" :style="confirmed.teacher_score ? 'color:var(--ok)' : 'color:var(--muted)'">{{ confirmed.teacher_score ? '✓ 已确定' : '调好后点「确定」' }}</span>
        </div>
        <div class="stepper">
          <button type="button" @click="bumpScore('teacher_score', -0.1)">−</button>
          <input class="val num" type="number" step="0.1" min="9" max="10" inputmode="decimal" v-model.number="form.teacher_score" @input="confirmed.teacher_score = false" @blur="clampScore('teacher_score')" @keyup.enter="$event.target.blur()">
          <button type="button" @click="bumpScore('teacher_score', 0.1)">＋</button>
          <button type="button" class="btn btn-sm btn-primary" style="margin-left:6px" @click="confirmScore('teacher_score')">确定</button>
        </div>
      </div>
      <div class="card tight num-field" style="margin-bottom:10px">
        <div class="row between" style="margin-bottom:6px">
          <span class="label" style="margin:0">学生评分</span>
          <span class="tiny" :style="confirmed.student_score ? 'color:var(--ok)' : 'color:var(--muted)'">{{ confirmed.student_score ? '✓ 已确定' : '调好后点「确定」' }}</span>
        </div>
        <div class="stepper">
          <button type="button" @click="bumpScore('student_score', -0.1)">−</button>
          <input class="val num" type="number" step="0.1" min="9" max="10" inputmode="decimal" v-model.number="form.student_score" @input="confirmed.student_score = false" @blur="clampScore('student_score')" @keyup.enter="$event.target.blur()">
          <button type="button" @click="bumpScore('student_score', 0.1)">＋</button>
          <button type="button" class="btn btn-sm btn-primary" style="margin-left:6px" @click="confirmScore('student_score')">确定</button>
        </div>
      </div>
      <div class="tiny muted">范围 9.0 ~ 10.0（每档 0.1），默认 9.5；用加减或直接输入，调好后点「确定」。
      课堂纪律 6 项 + 评分 2 项，共 8 个「确定」全部按下后才能提交。</div>
    </div>

    <div class="card mt12">
      <div class="field mb0">
        <label class="label">检查备注</label>
        <textarea class="textarea textarea-xs" v-model="form.remark" maxlength="200" placeholder="如：教师临时更换"></textarea>
      </div>
      <div class="field mt12 mb0" v-if="isEdit">
        <label class="label">申请原因<i class="req">*</i></label>
        <input class="input" v-model="form.correction_note" maxlength="60" placeholder="例如：实到人数点错了（审核通过后生效）">
      </div>
    </div>

    <div class="mask mask-center" v-if="confirmShow">
      <div class="sheet sheet-center">
        <h3>确认提交</h3>
        <div class="sub">请确认已经完成所有填写</div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doSubmit">确认提交</button>
        <button class="btn btn-block mt8" @click="confirmShow = false">再检查一下</button>
      </div>
    </div>

    <div class="actionbar">
      <div class="center tiny" v-if="!photos.length" style="color:var(--bad);margin-bottom:6px">课检员考勤需要，请先上传现场照片</div>
      <div class="center tiny" v-else-if="!allConfirmed" style="color:var(--bad);margin-bottom:6px">还有未点「确定」的项目（课堂纪律 6 项 + 评分 2 项）</div>
      <div class="inner">
        <button class="btn btn-primary btn-block btn-lg" :disabled="busy || !canSubmit" @click="submit">
          {{ busy ? '提交中…' : (isEdit ? '提交修改申请' : '提交查课结果') }}
        </button>
      </div>
    </div>
  </div>`,

  data() {
    return {
      U, tags: TAGS,
      TEACHER_OPTS: [
        '老师备课充分，授课条理清楚，学生积极互动。',
        '老师讲解细致，节奏适中，课堂秩序良好。',
        '老师讲课认真、热情，学生积极配合老师回答问题。',
        '老师讲课认真，时常关注学生听课状态，与学生互动并解答问题。',
        '老师备课充分，板书详细，授课条理清楚，循循善诱，学生积极互动。',
        '老师讲课认真，条理清晰，关注学生状态，积极与学生互动。',
        '老师上课重点突出，大部分学生上课积极融入课堂。',
      ],
      isEdit: false, isExtra: false, busy: false, err: '', photos: [],
      plan: null, recordId: '', courseEdit: false,
      confirmed: { phone_count: false, sleep_count: false, phone_10: false, sleep_10: false, phone_30: false, sleep_30: false, teacher_score: false, student_score: false },
      form: {
        check_date: '', period_from: 1, period_to: 2, arrive_before: '',
        course_name: '', class_name: '', room: '', teacher: '', counselor: '',
        classes: [], other_expected: 0, other_actual: 0,
        expected_count: 0, actual_count: 0, absent_count: 0, leave_count: 0,
        phone_count: 0, sleep_count: 0, teacher_status: '',
        teacher_score: 9.5, student_score: 9.5,
        phone_10: 0, sleep_10: 0, phone_30: 0, sleep_30: 0,
        absent_students: [], leave_students: [],
        discipline_tags: [], course_content: '', remark: '', correction_note: '',
      },
      confirmShow: false,
    }
  },
  computed: {
    periods() { return U.PERIODS },
    sem() { return Store.store.semester },
    minDate() { return this.sem ? this.sem.start_monday : '' },
    maxDate() { return this.sem ? U.addDays(this.sem.start_monday, this.sem.total_weeks * 7 - 1) : '' },
    memberName() {
      const me = Store.store.me
      return (me && me.name) || (this.plan && this.plan.owner_name) || '—'
    },
    counselorText() {
      const hints = this.isExtra
        ? U.recordClassHints({ classes: [], class_name: this.form.class_name })
        : U.recordClassHints({ classes: this.form.classes.map((c) => ({ code: c.code })), class_name: '' })
      return U.matchCounselors(Store.store.counselorMap, hints) || this.form.counselor || '—'
    },
    weekText() {
      if (!this.form.check_date) return '—'
      if (!this.sem) return U.md(this.form.check_date)
      return '第' + U.weekNo(this.sem.start_monday, this.form.check_date) + '周 ' + U.weekdayCN(this.form.check_date)
    },
    otherExpected() { return Number(this.isExtra ? 0 : this.form.other_expected) || 0 },
    planMode() { return !this.isExtra && (this.form.classes || []).length > 0 },
    expectedTotal() {
      if (!this.planMode) return Number(this.form.expected_count) || 0
      const sum = (this.form.classes || []).reduce((s, c) => s + (Number(c.expected) || 0), 0)
      return sum + this.otherExpected
    },
    actualCount() {
      if (!this.planMode) {
        return this.expectedTotal
          - (Number(this.form.absent_count) || 0)
          - (Number(this.form.leave_count) || 0)
      }
      const sum = (this.form.classes || []).reduce((s, c) => s + (Number(c.actual) || 0), 0)
      return sum + (Number(this.form.other_actual) || 0)
    },
    allConfirmed() {
      const need = ['phone_count', 'sleep_count', 'phone_10', 'sleep_10', 'phone_30', 'sleep_30', 'teacher_score', 'student_score']
      return need.every((k) => !!this.confirmed[k])
    },
    canSubmit() {
      if (!this.form.check_date) return false
      if (!this.form.course_name.trim() || !this.form.class_name.trim()) return false
      if (this.actualCount < 0) return false
      if (this.planMode && this.form.classes.some((c) => (Number(c.actual) || 0) > (Number(c.expected) || 0))) return false
      if (!this.photos.length) return false
      if (!this.form.teacher_status) return false
      if (!this.form.course_content.trim()) return false
      // 课堂纪律 6 项 + 评分 2 项，共 8 个「确定」都按下才能提交
      const need = ['phone_count', 'sleep_count', 'phone_10', 'sleep_10', 'phone_30', 'sleep_30', 'teacher_score', 'student_score']
      if (need.some((k) => !this.confirmed[k])) return false
      if (this.isEdit && !this.form.correction_note.trim()) return false
      return true
    },
  },
  watch: {
    'form.absent_count'(v) { this.syncStudents('absent', v) },
    'form.leave_count'(v) { this.syncStudents('leave', v) },
  },
  mounted() {
    const p = this.$root.route.params
    if (p.recordId) { this.isEdit = true; this.recordId = p.recordId; this.loadRecord() }
    else if (p.planId) this.loadPlan(p.planId)
    else { this.isExtra = true; this.form.check_date = U.today() }
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    setPeriod(p) { this.form.period_from = p[0]; this.form.period_to = p[1] },
    toggleTag(t) {
      const i = this.form.discipline_tags.indexOf(t)
      if (i >= 0) this.form.discipline_tags.splice(i, 1)
      else this.form.discipline_tags.push(t)
    },
    tagsForPayload() {
      const list = this.form.discipline_tags.slice()
      if (Number(this.form.phone_count) > 0 && list.indexOf('玩手机') < 0) list.push('玩手机')
      if (Number(this.form.sleep_count) > 0 && list.indexOf('睡觉') < 0) list.push('睡觉')
      return list
    },
    fillFrom(row) {
      this.form.check_date = row.check_date
      this.form.period_from = row.period_from
      this.form.period_to = row.period_to
      this.form.course_name = row.course_name
      this.form.class_name = row.class_name
      this.form.room = row.room || ''
      this.form.teacher = row.teacher || ''
      this.form.counselor = row.counselor || ''
      this.form.arrive_before = row.arrive_before || ''
      this.form.teacher_score = row.teacher_score == null || row.teacher_score === '' ? 9.5 : Number(row.teacher_score)
      this.form.student_score = row.student_score == null || row.student_score === '' ? 9.5 : Number(row.student_score)
    },
    async loadPlan(id) {
      try {
        const row = await Store.rpc('plan_get', { p_id: Number(id) })
        if (row.status === 'submitted') { U.toast('这节已经填过了'); return Store.nav('/') }
        if (row.status === 'void') { U.toast('这节计划已作废'); return Store.nav('/') }
        this.plan = row
        this.fillFrom(row)
        const cls = Array.isArray(row.classes) ? row.classes : []
        this.form.classes = cls.map((c) => {
          const exp = Number(c.expected) || 0
          return { code: c.code || '', expected: exp, actual: exp }
        })
        this.form.other_expected = Number(row.other_expected) || 0
        this.form.other_actual = this.form.other_expected
        const sum = this.form.classes.reduce((s, c) => s + c.expected, 0) + this.form.other_expected
        if (sum > 0) this.form.expected_count = sum
      } catch (e) { U.toast(U.errText(e), 'bad'); Store.nav('/') }
    },
    async loadRecord() {
      try {
        const d = await Store.rpc('record_get', { p_id: Number(this.recordId) })
        const row = d.record
        this.plan = row
        this.isExtra = !!row.is_extra
        this.fillFrom(row)
        this.loadPhotos()
        const raw = Array.isArray(row.classes) ? row.classes : []
        const base = raw.map((c) => ({ code: c.code || '', expected: Number(c.expected) || 0 }))
        const legacy = raw.some((c) => c.actual === null || c.actual === undefined)
        if (legacy) {
          this.form.classes = spreadActual(base, Number(row.actual_count) || 0)
        } else {
          this.form.classes = base.map((c, i) => {
            const act = Number(raw[i].actual) || 0
            return { ...c, actual: Math.min(c.expected, Math.max(0, act)) }
          })
        }
        this.form.other_expected = Number(row.other_expected) || 0
        if (legacy) {
          const used = this.form.classes.reduce((s, c) => s + c.actual, 0)
          this.form.other_actual = Math.min(this.form.other_expected,
            Math.max(0, (Number(row.actual_count) || 0) - used))
        } else {
          this.form.other_actual = Number(row.other_actual) || 0
        }
        this.form.expected_count = row.expected_count || 0
        this.form.absent_count = row.absent_count || 0
        this.form.leave_count = row.leave_count || 0
        this.form.phone_count = row.phone_count || 0
        this.form.sleep_count = row.sleep_count || 0
        this.form.teacher_status = row.teacher_status || ''
        this.form.phone_10 = row.phone_10 || 0
        this.form.sleep_10 = row.sleep_10 || 0
        this.form.phone_30 = row.phone_30 || 0
        this.form.sleep_30 = row.sleep_30 || 0
        this.form.absent_students = Array.isArray(row.absent_students) ? row.absent_students.map((x) => ({ cls: x.cls || '', name: x.name || '' })) : []
        this.form.leave_students = Array.isArray(row.leave_students) ? row.leave_students.map((x) => ({ cls: x.cls || '', name: x.name || '' })) : []
        this.form.discipline_tags = Array.isArray(row.discipline_tags) ? row.discipline_tags.slice() : []
        this.form.course_content = row.discipline_note || ''
        this.form.remark = row.remark || ''
      } catch (e) { U.toast(U.errText(e), 'bad'); Store.nav('/') }
    },
    payload() {
      const body = {
        check_date: this.form.check_date,
        period_from: Number(this.form.period_from),
        period_to: Number(this.form.period_to),
        arrive_before: this.form.arrive_before || '',
        course_name: this.form.course_name.trim(),
        class_name: this.form.class_name.trim(),
        room: this.form.room.trim(),
        teacher: this.form.teacher.trim(),
        counselor: this.form.counselor.trim(),
        expected_count: this.expectedTotal,
        actual_count: this.actualCount,
        absent_count: Number(this.form.absent_count) || 0,
        leave_count: Number(this.form.leave_count) || 0,
        phone_count: Number(this.form.phone_count) || 0,
        sleep_count: Number(this.form.sleep_count) || 0,
        teacher_status: this.form.teacher_status.trim(),
        teacher_score: Math.min(10, Math.max(9, Math.round((Number(this.form.teacher_score) || 9.5) * 10) / 10)),
        student_score: Math.min(10, Math.max(9, Math.round((Number(this.form.student_score) || 9.5) * 10) / 10)),
        phone_10: Number(this.form.phone_10) || 0,
        sleep_10: Number(this.form.sleep_10) || 0,
        phone_30: Number(this.form.phone_30) || 0,
        sleep_30: Number(this.form.sleep_30) || 0,
        absent_students: this.form.absent_students.filter((x) => x.name || x.cls),
        leave_students: this.form.leave_students.filter((x) => x.name || x.cls),
        discipline_tags: this.tagsForPayload(),
        discipline_note: this.form.course_content.trim(),
        remark: this.form.remark.trim(),
      }
      if (this.planMode) {
        body.classes = this.form.classes.map((c) => ({
          code: c.code,
          expected: Number(c.expected) || 0,
          actual: Number(c.actual) || 0,
        }))
        body.other_expected = this.otherExpected
        body.other_actual = Number(this.form.other_actual) || 0
      }
      return body
    },
    syncStudents(kind, n) {
      const key = kind === 'absent' ? 'absent_students' : 'leave_students'
      const arr = this.form[key]
      const target = Math.max(0, Math.min(Number(n) || 0, 100))
      while (arr.length < target) arr.push({ cls: '', name: '' })
      while (arr.length > target) arr.pop()
    },
    bumpActual(i, d) {
      const c = this.form.classes[i]
      if (!c) return
      c.actual = Math.min(c.expected, Math.max(0, (Number(c.actual) || 0) + d))
    },
    clampActual(i) {
      const c = this.form.classes[i]
      if (!c) return
      c.actual = Math.min(c.expected, Math.max(0, Math.floor(Number(c.actual) || 0)))
    },
    bumpOther(d) {
      this.form.other_actual = Math.min(this.otherExpected, Math.max(0, (Number(this.form.other_actual) || 0) + d))
    },
    clampOther() {
      this.form.other_actual = Math.min(this.otherExpected, Math.max(0, Math.floor(Number(this.form.other_actual) || 0)))
    },
    submit() {
      this.err = ''
      if (!Store.store.semester) { this.err = '尚未设置学期，请联系管理员'; return }
      this.form.classes.forEach((c, i) => this.clampActual(i))
      this.clampOther()
      if (!this.canSubmit) return
      if (this.isEdit) { this.doSubmit(); return }
      this.confirmShow = true
    },
    async doSubmit() {
      this.confirmShow = false
      this.busy = true
      try {
        const body = this.payload()
        let recId = Number(this.recordId) || 0
        let courseReq = false
        if (this.isEdit) {
          // 修改记录一律送管理员审核，通过后才生效
          await Store.rpc('record_edit_request', {
            p_record_id: recId,
            p_payload: body,
            p_reason: this.form.correction_note.trim(),
            p_kind: 'record_edit',
          })
        } else {
          // 填写结果时更改到岗/应到 → 先按计划原值保存，更改内容送审
          const diff = this.plan ? this.courseDiff(body) : {}
          if (this.plan && Object.keys(diff).length) {
            body.arrive_before = String(this.plan.arrive_before || '')
            body.other_expected = Number(this.plan.other_expected) || 0
            body.classes = (body.classes || []).map((c) => {
              const pc = (this.plan.classes || []).find((x) => x.code === c.code)
              return {
                code: c.code,
                expected: pc ? (Number(pc.expected) || 0) : (Number(c.expected) || 0),
                actual: Number(c.actual) || 0,
              }
            })
            body.expected_count = body.classes.reduce((s, c) => s + (Number(c.expected) || 0), 0)
              + (Number(body.other_expected) || 0)
          }
          body.plan_id = this.plan ? this.plan.id : null
          body.is_extra = !this.plan
          body.client_uuid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ''
          const rec = await Store.rpc('record_submit', { p_payload: body })
          recId = rec.id
          if (this.plan && Object.keys(diff).length) {
            await Store.rpc('record_edit_request', {
              p_record_id: recId,
              p_payload: diff,
              p_reason: '填写结果时更改预计到岗/应到人数',
              p_kind: 'course_info',
            })
            courseReq = true
          }
        }
        const fail = await this.uploadPhotos(recId)
        let done
        if (this.isEdit) done = '修改申请已提交，管理员审核通过后生效'
        else if (courseReq) done = '查课已提交；到岗/应到更改已送审，通过后生效'
        else done = '查课成功'
        if (fail) U.toast(done + '，但有 ' + fail + ' 张照片未上传', 'bad')
        else U.toast(done)
        Store.nav(this.isEdit ? '/record/' + recId : '/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
    courseDiff(body) {
      const p = this.plan || {}
      const d = {}
      if (String(body.arrive_before || '') !== String(p.arrive_before || '')) d.arrive_before = String(body.arrive_before || '')
      const planCls = Array.isArray(p.classes) ? p.classes : []
      const bodyCls = Array.isArray(body.classes) ? body.classes : []
      if (planCls.length && bodyCls.length) {
        const changed = bodyCls.some((c) => {
          const pc = planCls.find((x) => x.code === c.code)
          return !pc || Number(pc.expected) !== Number(c.expected)
        })
        if (changed) {
          d.classes = bodyCls.map((c) => ({ code: c.code, expected: Number(c.expected) || 0, actual: Number(c.actual) || 0 }))
        }
      }
      if ((Number(body.other_expected) || 0) !== (Number(p.other_expected) || 0)) {
        d.other_expected = Number(body.other_expected) || 0
      }
      return d
    },
    clampExpected(i) {
      const c = this.form.classes[i]
      if (!c) return
      c.expected = Math.max(0, Math.floor(Number(c.expected) || 0))
    },
    clampOtherExpected() {
      this.form.other_expected = Math.max(0, Math.floor(Number(this.form.other_expected) || 0))
    },
    bumpScore(key, d) {
      const v = Math.round(((Number(this.form[key]) || 9.5) + d) * 10) / 10
      this.form[key] = Math.min(10, Math.max(9, v))
      this.confirmed[key] = false
    },
    clampScore(key) {
      let v = Number(this.form[key])
      if (!Number.isFinite(v)) v = 9.5
      this.form[key] = Math.min(10, Math.max(9, Math.round(v * 10) / 10))
    },
    confirmScore(key) {
      this.clampScore(key)
      this.confirmed[key] = true
    },
    async uploadPhotos(recId) {
      let fail = 0
      for (const ph of this.photos) {
        if (ph.saved) continue
        try {
          const params = { p_record_id: recId, p_data: ph.dataUrl, p_mime: 'image/jpeg', p_thumb: ph.thumbDataUrl || '' }
          if (ph.takenAt) params.p_taken_at = ph.takenAt
          const r = await Store.rpc('photo_add', params)
          ph.saved = true
          if (r && r.id) {
            ph.id = r.id
            if (window.PhotoCache) PhotoCache.put(r.id, { thumb: ph.thumbDataUrl, data: ph.dataUrl })
          }
        } catch (e) {
          fail += 1
        }
      }
      return fail
    },
    async onPick(e) {
      const files = Array.from(e.target.files || [])
      e.target.value = ''
      for (const f of files) {
        if (this.photos.length >= 3) { U.toast('最多 3 张照片', 'bad'); break }
        if (!f.type || f.type.indexOf('image/') !== 0) continue
        try {
          const out = await IMG.compress(f, { maxKB: 500, maxEdge: 1800 })
          const dataUrl = await blobToDataUrl(out.blob)
          const th = await IMG.compress(f, { maxKB: 25, maxEdge: 320 })
          const thumbDataUrl = await blobToDataUrl(th.blob)
          this.photos.push({
            key: 'n' + Date.now() + Math.random(), preview: out.preview,
            dataUrl: dataUrl, thumbDataUrl: thumbDataUrl, kb: out.kb, saved: false,
            takenAt: f.lastModified ? new Date(f.lastModified).toISOString() : '',
          })
        } catch (err) {
          U.toast(err.message || '照片处理失败', 'bad')
        }
      }
    },
    async removePhoto(i) {
      const ph = this.photos[i]
      if (!ph) return
      if (ph.saved && ph.id) {
        try { await Store.rpc('photo_delete', { p_id: ph.id }) }
        catch (e) { U.toast(U.errText(e), 'bad'); return }
      }
      this.photos.splice(i, 1)
    },
    async loadPhotos() {
      if (!this.recordId) return
      try {
        const list = await Store.rpc('photo_list', { p_record_id: Number(this.recordId) }) || []
        const out = []
        for (const p of list) {
          const hit = window.PhotoCache ? await PhotoCache.get(p.id) : null
          out.push({ key: 's' + p.id, id: p.id, preview: (hit && hit.thumb) || p.thumb || '', saved: true })
        }
        this.photos = out
      } catch (e) { /* 忽略 */ }
    },
  },
}

window.Views.RecordView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>查课记录</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12" v-if="loading"><div class="empty">加载中…</div></div>

    <template v-else-if="rec">
      <div class="card mt12">
        <div class="hd">
          <h2>课程信息</h2>
          <span class="badge" :class="rec.is_extra ? 'badge-warn' : 'badge-pri'">{{ rec.is_extra ? '计划外' : '计划内' }}</span>
        </div>

        <div class="kvrow"><span class="k">课程名称</span><span class="v strong">{{ rec.course_name }}</span></div>
        <div class="kvrow"><span class="k">任课老师</span><span class="v">{{ rec.teacher || '—' }}</span></div>
        <div class="kvrow"><span class="k">教室</span><span class="v strong">{{ rec.room || '—' }}</span></div>
        <div class="kvrow"><span class="k">课检时间</span><span class="v">第{{ rec.week_no }}周 {{ U.weekdayCN(rec.check_date) }} {{ U.periodText(rec.period_from, rec.period_to) }}</span></div>
        <div class="kvrow" v-if="rec.arrive_before"><span class="k">预计到岗</span><span class="v">{{ U.arriveText(rec.arrive_before) }}</span></div>
        <div class="kvrow"><span class="k">课程主要内容</span><span class="v">{{ rec.discipline_note || '—' }}</span></div>

        <div class="cstat-hd" v-if="classList.length">
          <span class="label" style="margin:0">课检班级</span>
          <span class="tiny muted">实到 / 应到</span>
        </div>
        <div class="cstat" v-for="c in classList" :key="c.code">
          <div class="cstat-code">{{ c.code }}</div>
          <div class="cstat-exp"><b class="num">{{ actualOf(c) }}</b> / {{ c.expected }}</div>
        </div>
        <div class="cstat" v-if="Number(rec.other_expected) > 0">
          <div class="cstat-code">其他</div>
          <div class="cstat-exp"><b class="num">{{ Number(rec.other_actual) || 0 }}</b> / {{ rec.other_expected }}</div>
        </div>
        <div class="kvrow" v-if="!classList.length"><span class="k">课检班级</span><span class="v">{{ rec.class_name }}</span></div>

        <div class="kvrow"><span class="k">应到人数</span><span class="v strong num">{{ rec.expected_count }}</span></div>
        <div class="kvrow"><span class="k">辅导员</span><span class="v">{{ counselorText }}</span></div>
        <div class="kvrow"><span class="k">课检员</span><span class="v">{{ rec.owner_name }}</span></div>
      </div>

      <div class="card">
        <div class="hd"><h2>出勤</h2><span class="tiny muted">出勤率 {{ U.rate(rec.actual_count, rec.expected_count) || '—' }}</span></div>
        <div class="stat-grid">
          <div class="stat"><div class="n">{{ rec.expected_count }}</div><div class="t">应到</div></div>
          <div class="stat ok"><div class="n">{{ rec.actual_count }}</div><div class="t">实到</div></div>
          <div class="stat warn"><div class="n">{{ rec.absent_count }}</div><div class="t">旷课</div></div>
        </div>
        <div class="row between tiny muted mt12">
          <span>请假 {{ rec.leave_count }}</span>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h2>课堂纪律</h2></div>
        <div class="row between sm" v-if="rec.teacher_status"><span class="muted">教师上课情况</span><span>{{ rec.teacher_status }}</span></div>
        <div class="stat-grid mt8">
          <div class="stat" :class="rec.phone_count ? 'warn' : ''"><div class="n">{{ rec.phone_count || 0 }}</div><div class="t">玩手机</div></div>
          <div class="stat" :class="rec.sleep_count ? 'warn' : ''"><div class="n">{{ rec.sleep_count || 0 }}</div><div class="t">睡觉</div></div>
          <div class="stat"><div class="n">{{ (rec.phone_10 || 0) + (rec.sleep_10 || 0) }}</div><div class="t">10分钟</div></div>
        </div>
        <div class="tiny muted mt8">
          开课 10 分钟：玩手机 {{ rec.phone_10 || 0 }} · 睡觉 {{ rec.sleep_10 || 0 }}
        </div>
        <div class="tiny muted mt8">
          开课 30 分钟：玩手机 {{ rec.phone_30 || 0 }} · 睡觉 {{ rec.sleep_30 || 0 }}
        </div>
        <div class="tagcloud mt12" v-if="rec.discipline_tags && rec.discipline_tags.length">
          <span class="tagpill on" v-for="t in rec.discipline_tags" :key="t">{{ t }}</span>
        </div>
      </div>

      <div class="card" v-if="rec.remark">
        <div class="hd"><h2>检查备注</h2></div>
        <div class="sm">{{ rec.remark }}</div>
      </div>

      <div class="card" v-if="rec">
        <div class="hd">
          <h2>现场照片</h2>
          <button class="btn btn-sm" v-if="!photosLoaded" :disabled="photoLoading" @click="loadPhotos(rec.id)">
            {{ photoLoading ? '加载中…' : '查看照片' }}
          </button>
          <span class="tiny muted" v-else>{{ photos.length }} 张</span>
        </div>
        <div class="photo-grid" v-if="photosLoaded && photos.length">
          <div class="photo-item" v-for="(ph, i) in photos" :key="ph.id" @click="openPhoto(i)">
            <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
            <div v-else class="photo-ph">原图</div>
          </div>
        </div>
        <div class="tiny muted mt8" v-if="photosLoaded && photos.length">点击缩略图查看原图 · 上传于 {{ U.dayTime(photos[0].created_at) }}</div>
        <div class="muted sm" v-if="photosLoaded && !photos.length">这条记录没有照片</div>
      </div>

      <div class="mask mask-center" v-if="fullPhoto" @click.self="fullPhoto = null">
        <div class="sheet sheet-center" style="padding:10px">
          <img :src="fullPhoto.data || fullPhoto.thumb" style="width:100%;border-radius:10px;display:block" alt="原图">
          <button class="btn btn-block mt8" @click="fullPhoto = null">关闭</button>
        </div>
      </div>

      <div class="card">
        <div class="row between tiny muted">
          <span>提交于 {{ U.dayTime(rec.submitted_at) }}</span>
          <span v-if="rec.corrected_count">已修改 {{ rec.corrected_count }} 次</span>
        </div>
      </div>

      <div class="actionbar" v-if="isMine">
        <div class="inner">
          <button v-if="pendingReq" class="btn btn-block btn-lg" disabled>修改申请审核中…</button>
          <button v-else class="btn btn-primary btn-block btn-lg" @click="goEdit">申请修改（需管理员审核）</button>
        </div>
      </div>
      <div class="center tiny muted mt12" v-if="isMine && !pendingReq">
        修改需管理员审核，通过后才生效
      </div>
    </template>
  </div>`,

  data() { return { U, rec: null, canEdit: false, loading: true, photos: [], photosLoaded: false, photoLoading: false, fullPhoto: null } },
  computed: {
    isMine() {
      const me = Store.store.me
      return !!(this.rec && me && Number(this.rec.owner_id) === Number(me.id))
    },
    pendingReq() { return !!(this.rec && this.rec.pending_request) },
    counselorText() {
      if (!this.rec) return '—'
      return U.matchCounselors(Store.store.counselorMap, U.recordClassHints(this.rec)) || this.rec.counselor || '—'
    },
    classList() {
      if (!this.rec || !Array.isArray(this.rec.classes)) return []
      return this.rec.classes.map((c) => ({
        code: c.code || '',
        expected: Number(c.expected) || 0,
        actual: c.actual === null || c.actual === undefined ? null : Number(c.actual),
      }))
    },
  },
  mounted() { this.load() },
  methods: {
    actualOf(c) { return c.actual === null ? '—' : c.actual },
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    async loadPhotos(id) {
      if (!id || this.photoLoading) return
      this.photoLoading = true
      try {
        const list = await Store.rpc('photo_list', { p_record_id: Number(id) }) || []
        const out = []
        for (const p of list) {
          const hit = window.PhotoCache ? await PhotoCache.get(p.id) : null
          out.push({
            id: p.id,
            created_at: p.created_at,
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
    goEdit() { Store.nav('/fill/edit/' + this.rec.id) },
    async load() {
      const id = this.$root.route.params.id
      try {
        const d = await Store.rpc('record_get', { p_id: Number(id) })
        this.rec = d.record
        this.canEdit = !!d.can_edit
        if (this.isMine) {
          try {
            const list = await Store.rpc('my_records', {}) || []
            const m = list.find((x) => Number(x.id) === Number(id))
            if (m) this.rec.pending_request = !!m.pending_request
          } catch (e) { /* 忽略 */ }
        }
      } catch (e) {
        U.toast(U.errText(e), 'bad')
        Store.nav('/')
      } finally {
        this.loading = false
      }
    },
  },
}

window.Views.MyRecordsView = {
  template: `
  <div class="shell">
    <div class="topbar">
      <div class="side"><button class="iconbtn back" @click="back">‹</button></div>
      <h1>我的历史记录</h1>
      <div class="side right"></div>
    </div>

    <div class="card mt12">
      <div class="hd">
        <h2>本学期记录</h2>
        <span class="tiny muted" v-if="!loading">{{ list.length }} 条</span>
      </div>
      <div class="list" v-if="list.length">
        <div class="litem" v-for="r in list" :key="r.id" @click="go('/record/' + r.id)">
          <div class="row between">
            <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
            <span class="badge" :class="r.pending_request ? 'badge-warn' : 'badge-pri'">
              {{ r.pending_request ? '审核中' : '可申请修改' }}
            </span>
          </div>
          <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · 出勤 {{ r.actual_count }}/{{ r.expected_count }}</div>
        </div>
      </div>
      <div class="muted sm" v-else-if="!loading">还没有查课记录</div>
      <div class="muted sm" v-else>加载中…</div>
      <div class="tiny muted mt8">本学期全部记录；所有修改需管理员审核，通过后生效。</div>
    </div>
  </div>`,

  data() { return { U, list: [], loading: true } },
  mounted() { this.load() },
  methods: {
    go(p) { Store.nav(p) },
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    async load() {
      if (window.RecordCache) {
        try {
          const cached = await RecordCache.all()
          if (cached && cached.length) {
            this.list = cached.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
            this.loading = false
          }
        } catch (e) { /* 忽略 */ }
      }
      try {
        const rows = await Store.rpc('my_records', {}) || []
        rows.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
        this.list = rows
        if (window.RecordCache) RecordCache.putAll(rows)
      } catch (e) {
        if (this.loading) U.toast(U.errText(e), 'bad')
      } finally {
        this.loading = false
      }
    },
  },
}

window.Views.MeView = {
  template: `
  <div class="shell">
    <div class="topbar"><div class="side"></div><h1>我的</h1><div class="side right"></div></div>

    <div class="card mt12">
      <div class="row between">
        <div>
          <div style="font-size:19px;font-weight:700">{{ me && me.name }}</div>
          <div class="tiny muted mt8">学号 {{ me && me.student_no }}<span v-if="me && me.title"> · {{ me.title }}</span></div>
        </div>
        <span class="badge" :class="isAdmin ? 'badge-pri' : ''">{{ isAdmin ? '管理员' : '组员' }}</span>
      </div>
      <div class="divider"></div>
      <div class="me-week">
        <span class="me-week-n">第 {{ week }} 周</span>
        <span class="tiny muted">{{ semName }}</span>
      </div>
    </div>

    <div class="card" v-if="isAdmin">
      <div class="hd"><h2>管理</h2></div>
      <div class="list">
        <div class="litem" @click="openNotice">
          <div class="t1">发通知</div>
          <div class="t2">向全体成员发布通知，可看历史通知</div>
        </div>
        <div class="litem" @click="go('/admin/members')">
          <div class="t1">成员管理</div>
          <div class="t2">停用、设为管理员</div>
        </div>
        <div class="litem" @click="go('/admin/resets')">
          <div class="row between">
            <div class="t1">审核</div>
            <span class="badge badge-bad" v-if="pendingTotal">{{ pendingTotal }} 条待处理</span>
          </div>
          <div class="t2">忘记密码重置、记录修改申请</div>
        </div>
        <div class="litem" @click="go('/class-stats')">
          <div class="t1">班级查课次数</div>
          <div class="t2">按成员负责班级统计查课次数，可导出 Excel</div>
        </div>
        <div class="litem" @click="go('/admin/export')">
          <div class="t1">导出 Excel 台账</div>
          <div class="t2">明细 + 周汇总 + 成员汇总</div>
        </div>
        <div class="litem" @click="go('/admin/semesters')">
          <div class="t1">学期设置</div>
          <div class="t2">第 1 周周一与总周数</div>
        </div>
      </div>
    </div>

    <div class="card mt12" v-if="!isAdmin">
      <div class="hd">
        <h2>我的历史记录</h2>
        <span class="tiny muted" v-if="!histLoading">{{ history.length }} 条</span>
      </div>
      <div class="list" v-if="history.length">
        <div class="litem" v-for="r in history" :key="r.id" @click="go('/record/' + r.id)">
          <div class="row between">
            <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
            <span class="badge" :class="r.pending_request ? 'badge-warn' : 'badge-pri'">
              {{ r.pending_request ? '审核中' : '可申请修改' }}
            </span>
          </div>
          <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }} · 出勤 {{ r.actual_count }}/{{ r.expected_count }}</div>
        </div>
      </div>
      <div class="muted sm" v-else-if="!histLoading">还没有查课记录</div>
      <div class="muted sm" v-else>加载中…</div>
      <div class="tiny muted mt8">本学期全部记录；所有修改需管理员审核，通过后生效。</div>
    </div>

    <div class="card">
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

    <div class="card">
      <div class="hd"><h2>账号</h2></div>
      <div class="list">
        <div class="litem" @click="go('/change')"><div class="t1">修改密码</div><div class="t2">修改后下次用新密码登录</div></div>
      </div>
    </div>

    <div class="mt12">
      <button class="btn btn-danger btn-block" @click="logout">退出登录</button>
    </div>

    <div class="mask" v-if="showNotice" @click.self="showNotice = false">
      <div class="sheet">
        <h3>发通知</h3>
        <textarea class="textarea" v-model="noticeDraft" maxlength="500" placeholder="输入要通知全体成员的内容，例如：本周三下午抽查 3-4 节，请提前选好课"></textarea>
        <div class="tiny muted mt8">{{ noticeDraft.length }}/500</div>
        <button class="btn btn-primary btn-block mt8" :disabled="noticeBusy" @click="postNotice">{{ noticeBusy ? '发布中…' : '发布通知' }}</button>
        <div class="divider"></div>
        <div class="strong sm">历史通知</div>
        <div class="mt8" v-if="notices.length">
          <div class="hm-notice-item" v-for="n in notices" :key="n.id">
            <div class="hm-notice-c">{{ n.content }}</div>
            <div class="tiny muted">{{ n.author }} · {{ U.dayTime(n.created_at) }}</div>
          </div>
        </div>
        <div class="muted sm" v-else>暂无</div>
        <button class="btn btn-block mt12" @click="showNotice = false">关闭</button>
      </div>
    </div>
  </div>`,

  data() { return { U, history: [], histLoading: true, pendingEdits: 0, showNotice: false, noticeDraft: '', notices: [], noticeBusy: false } },
  computed: {
    me() { return Store.store.me },
    isAdmin() { return Store.store.isAdmin },
    pendingResets() { return Store.store.pendingResets },
    pendingTotal() { return (Number(this.pendingResets) || 0) + (Number(this.pendingEdits) || 0) },
    week() { return Store.weekNow() },
    dark() { return Store.store.theme === 'dark' },
    semName() {
      const s = Store.store.semester
      return s ? s.name : '未设置学期'
    },
  },
  mounted() {
    Store.refresh().catch(() => {})
    this.loadHistory()
    this.loadReqCount()
  },
  methods: {
    go(p) { Store.nav(p) },
    toggleTheme() { Store.toggleTheme() },
    openNotice() { this.showNotice = true; this.loadNotices() },
    async loadNotices() {
      try { this.notices = await Store.rpc('notice_list', {}) || [] }
      catch (e) { /* 忽略 */ }
    },
    async postNotice() {
      const c = (this.noticeDraft || '').trim()
      if (!c) { U.toast('通知内容不能为空', 'bad'); return }
      this.noticeBusy = true
      try {
        await Store.rpc('notice_post', { p_content: c })
        this.noticeDraft = ''
        U.toast('已发布')
        await this.loadNotices()
      } catch (e) { U.toast(U.errText(e), 'bad') }
      finally { this.noticeBusy = false }
    },
    async loadReqCount() {
      if (!Store.store.isAdmin) return
      try {
        const list = await Store.rpc('edit_requests_list', {}) || []
        this.pendingEdits = list.filter((q) => q.status === 'pending').length
      } catch (e) { /* 忽略 */ }
    },
    async loadHistory() {
      if (Store.store.isAdmin) { this.histLoading = false; return }
      if (window.RecordCache) {
        try {
          const cached = await RecordCache.all()
          if (cached && cached.length) {
            this.history = cached.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
            this.histLoading = false
          }
        } catch (e) { /* 忽略 */ }
      }
      try {
        const list = await Store.rpc('my_records', {}) || []
        list.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
        this.history = list
        if (window.RecordCache) RecordCache.putAll(list)
      } catch (e) {
        if (this.histLoading) U.toast(U.errText(e), 'bad')
      } finally {
        this.histLoading = false
      }
    },
    logout() { Store.logout() },
  },
}
