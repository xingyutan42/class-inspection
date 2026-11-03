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

// 本机缓存里可能混有其他账号的记录，成员只能看到自己的
function mineOnly(list) {
  const me = Store.store.me || {}
  return (list || []).filter((r) => r && String(r.owner_id) === String(me.id))
}

// 本机保存的照片 id（提交成功时记录），成员查看时只读本地，不走云端
function localPhotoIds(recId) {
  try { return JSON.parse(localStorage.getItem('xfc_photo_ids_' + recId) || '[]') || [] } catch (e) { return [] }
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
      <h1>{{ editMode ? '修改查课结果' : '填写查课结果' }}</h1>
      <div class="side right"><button class="btn btn-sm" @click="saveDraft(false)">存草稿</button></div>
    </div>

    <div class="mask mask-center" v-if="err" @click.self="err = ''">
      <div class="sheet sheet-center">
        <h3>提交失败</h3>
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
      <div class="hd">
        <h2>现场照片 <span class="badge badge-bad" v-if="!editMode">必填</span><span class="badge badge-pri" v-else>沿用原照片</span></h2>
        <span class="tiny muted" v-if="!editMode">{{ photos.length }} / 2</span>
        <span class="tiny muted" v-else>已保留 {{ editPhotoCount }} 张</span>
      </div>
      <div class="tiny muted mb8" v-if="editMode">上次提交的照片已保留，<b>不用重新上传</b>；如需补充可再添加。</div>
      <div class="photo-grid">
        <div class="photo-item" v-for="(ph, i) in photos" :key="ph.key">
          <img v-if="ph.preview || ph.thumbDataUrl" :src="ph.preview || ph.thumbDataUrl" alt="现场照片">
          <div v-else class="photo-ph">照片</div>
          <button type="button" class="photo-x" @click="removePhoto(i)">✕</button>
        </div>
        <label class="photo-add" v-if="photos.length < 2">
          <input type="file" accept="image/*" @change="onPick" hidden>
          <span class="photo-add-ic">＋</span>
          <span class="photo-add-t">拍照 / 从相册选择</span>
        </label>
      </div>
      <div class="tiny mt8" style="color:var(--bad)" v-if="!editMode">课检员考勤需要，至少上传 1 张现场照片后才能提交。</div>
      <div class="tiny muted mt8">最多 2 张，自动压缩到 500KB 以内。建议拍教室全景或黑板，避免人脸特写。</div>
    </div>

    <div class="card mt12" v-if="plan && plan.note" style="background:var(--bad-soft);border:1px solid rgba(217,45,32,.35)">
      <div class="strong" style="color:var(--bad)">{{ editMode ? '这条记录被打回，可直接修改下方内容' : '这节课程被打回，请重新填写' }}</div>
      <div class="sm mt8">打回原因：{{ plan.note }}</div>
      <div class="sm mt8 muted" v-if="editMode">下方已带出上次提交的内容，改完直接提交即可（照片沿用）。</div>
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
      <div class="hd">
        <h2>课程信息</h2>
        <span class="badge badge-pri">计划内</span>
      </div>

      <div class="kvrow"><span class="k">课程名称</span><span class="v strong">{{ form.course_name }}</span></div>
      <div class="kvrow"><span class="k">任课老师</span><span class="v">{{ form.teacher || '—' }}</span></div>
      <div class="kvrow"><span class="k">教室</span><span class="v strong">{{ form.room || '—' }}</span></div>
      <div class="kvrow"><span class="k">课检时间</span><span class="v">{{ weekText }} {{ U.periodText(form.period_from, form.period_to) }}</span></div>
      <div class="kvrow" v-if="form.arrive_before"><span class="k">预计到岗</span><span class="v">{{ U.arriveText(form.arrive_before) }}</span></div>

      <div class="kvrow" v-if="!form.classes.length"><span class="k">课检班级</span><span class="v">{{ form.class_name }}</span></div>

      <template v-if="form.classes.length">
        <div class="cstat-hd">
          <span class="label" style="margin:0">课检班级</span>
          <span class="tiny muted">逐班填实到</span>
        </div>
        <div class="cstat" v-for="(c, i) in form.classes" :key="c.code + i">
          <div class="cstat-code">{{ c.code }}</div>
          <div class="cstat-exp">应到 {{ c.expected }}</div>
          <div class="stepper mini">
            <button type="button" @click="bumpActual(i, -1)">−</button>
            <input class="val num" type="number" inputmode="numeric" v-model.number="c.actual" @blur="clampActual(i)">
            <button type="button" @click="bumpActual(i, 1)">＋</button>
          </div>
        </div>
        <div class="cstat" v-if="otherExpected > 0">
          <div class="cstat-code">其他</div>
          <div class="cstat-exp">应到 {{ otherExpected }}</div>
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
            <div class="tiny muted mb8">旷课名单<span class="req" style="margin-left:4px">*</span></div>
            <div class="stu-row" v-for="(s2, i) in form.absent_students" :key="'a' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" :style="String(s2.cls || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
              <input class="input" :style="String(s2.name || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
            </div>
            <div class="tiny mt8" style="color:var(--bad)" v-if="!absentOk">请补全每位旷课同学的班级和姓名后才能提交</div>
          </div>
        </div>
        <div class="count-col">
          <num-field label="请假" v-model="form.leave_count"></num-field>
          <div class="stu-wrap" v-if="form.leave_count > 0">
            <div class="tiny muted mb8">请假名单<span class="req" style="margin-left:4px">*</span></div>
            <div class="stu-row" v-for="(s2, i) in form.leave_students" :key="'l' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" :style="String(s2.cls || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
              <input class="input" :style="String(s2.name || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
            </div>
            <div class="tiny mt8" style="color:var(--bad)" v-if="!leaveOk">请补全每位请假同学的班级和姓名后才能提交</div>
          </div>
        </div>
      </div>

      <div class="row between kv mt8" v-if="!planMode">
        <span class="muted">实到人数</span>
        <span class="strong num" :style="actualCount < 0 ? 'color:var(--bad)' : ''">{{ actualCount < 0 ? '人数超出' : actualCount }}</span>
      </div>
      <div class="tiny muted" v-if="!planMode">实到 = 应到 − 旷课 − 请假</div>
      <div class="tiny muted" v-else>实到按上方班级明细汇总；旷课、请假只用于记录名单。</div>
      <div class="tiny mt8" :style="sumOk ? 'color:var(--muted)' : 'color:var(--bad);font-weight:700'">
        合计校验：实到 {{ actualCount }} + 请假 {{ Number(form.leave_count) || 0 }} + 旷课 {{ Number(form.absent_count) || 0 }} = {{ (Number(actualCount) || 0) + (Number(form.leave_count) || 0) + (Number(form.absent_count) || 0) }} / 应到 {{ expectedTotal }}{{ sumOk ? '' : '（不一致，请核对）' }}
      </div>

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
    </div>

    <div class="mask mask-center" v-if="confirmShow">
      <div class="sheet sheet-center">
        <h3>{{ editMode ? '确认重新提交' : '确认提交' }}</h3>
        <div class="sub">{{ editMode ? '照片沿用原记录，提交后该记录恢复为正常状态并重新计入统计。' : '请确认已经完成所有填写' }}</div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doSubmit">{{ editMode ? '确认重新提交' : '确认提交' }}</button>
        <button class="btn btn-block mt8" @click="confirmShow = false">再检查一下</button>
      </div>
    </div>

    <div class="actionbar">
      <div class="center tiny muted" v-if="isTest" style="margin-bottom:6px">测试账号：不受提交限制（照片、名单、合计、确定项都可跳过）</div>
      <template v-else-if="editMode">
        <div class="center tiny" v-if="!studentsOk" style="color:var(--bad);margin-bottom:6px">旷课 / 请假名单未填完整：每位同学的班级和姓名都必填</div>
        <div class="center tiny" v-else-if="!sumOk" style="color:var(--bad);margin-bottom:6px">人数合计不一致：各班实到 + 其他实到 + 请假 + 旷课 必须等于应到人数</div>
        <div class="center tiny muted" v-else style="margin-bottom:6px">照片沿用原记录，只改需要变动的内容即可</div>
      </template>
      <template v-else>
        <div class="center tiny" v-if="!photos.length" style="color:var(--bad);margin-bottom:6px">课检员考勤需要，请先上传现场照片</div>
        <div class="center tiny" v-else-if="!allConfirmed" style="color:var(--bad);margin-bottom:6px">还有未点「确定」的项目（课堂纪律 6 项 + 评分 2 项）</div>
        <div class="center tiny" v-else-if="!studentsOk" style="color:var(--bad);margin-bottom:6px">旷课 / 请假名单未填完整：每位同学的班级和姓名都必填</div>
        <div class="center tiny" v-else-if="!sumOk" style="color:var(--bad);margin-bottom:6px">人数合计不一致：各班实到 + 其他实到 + 请假 + 旷课 必须等于应到人数</div>
      </template>
      <div class="inner">
        <button class="btn btn-primary btn-block btn-lg" :disabled="busy || !canSubmit" @click="submit">
          {{ busy ? '提交中…' : (editMode ? '保存修改并重新提交' : '提交查课结果') }}
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
      isExtra: false, busy: false, err: '', photos: [], draftTip: null, draftSavedAt: 0,
      plan: null,
      // 被打回后重新编辑：editRec 为原记录，照片沿用不重传
      editRec: null, editPhotoCount: 0,
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
        discipline_tags: [], course_content: '', remark: '',
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
    absentOk() {
      return (this.form.absent_students || []).every((s) => String(s.cls || '').trim() && String(s.name || '').trim())
    },
    leaveOk() {
      return (this.form.leave_students || []).every((s) => String(s.cls || '').trim() && String(s.name || '').trim())
    },
    studentsOk() { return this.absentOk && this.leaveOk },
    sumOk() {
      const sum = (Number(this.actualCount) || 0) + (Number(this.form.absent_count) || 0) + (Number(this.form.leave_count) || 0)
      return sum === (Number(this.expectedTotal) || 0)
    },
    // 被打回后重新编辑原记录（照片沿用，不重传）
    editMode() { return !!this.editRec },
    // 测试账号（学号 TEST 开头 / 姓名「测试」开头）：不受任何提交限制，方便反复测试
    isTest() {
      const me = Store.store.me || {}
      return /^TEST/i.test(String(me.student_no || '')) || /^测试/.test(String(me.name || ''))
    },
    canSubmit() {
      if (this.isTest) return true
      // 被打回后修改原记录：只校验人数合计与名单，照片/确定项/教师情况不强制
      if (this.editMode) {
        if (!this.form.check_date) return false
        if (this.planMode && this.form.classes.some((c) => (Number(c.actual) || 0) > (Number(c.expected) || 0))) return false
        if (!this.sumOk) return false
        if (!this.studentsOk) return false
        return true
      }
      if (!this.form.check_date) return false
      if (!this.form.course_name.trim() || !this.form.class_name.trim()) return false
      if (this.actualCount < 0) return false
      if (this.planMode && this.form.classes.some((c) => (Number(c.actual) || 0) > (Number(c.expected) || 0))) return false
      if (!this.photos.length) return false
      if (!this.sumOk) return false
      if (!this.studentsOk) return false
      if (!this.form.teacher_status) return false
      if (!this.form.course_content.trim()) return false
      // 课堂纪律 6 项 + 评分 2 项，共 8 个「确定」都按下才能提交
      const need = ['phone_count', 'sleep_count', 'phone_10', 'sleep_10', 'phone_30', 'sleep_30', 'teacher_score', 'student_score']
      if (need.some((k) => !this.confirmed[k])) return false
      return true
    },
    // ---------- 草稿定位与展示 ----------
    draftKey() {
      const uid = (Store.store.me && Store.store.me.id) || 0
      const pid = this.plan && this.plan.id ? this.plan.id : 0
      const extra = [this.form.check_date, this.form.period_from, this.form.period_to, this.form.course_name].join('|')
      return window.Draft ? Draft.keyOf(uid, pid, extra) : ''
    },
    draftText() {
      const f = this.form
      return [U.md(f.check_date), U.periodText(f.period_from, f.period_to), f.course_name].filter(Boolean).join(' · ')
    },
    draftSavedText() {
      return this.draftSavedAt ? U.shortTime(new Date(this.draftSavedAt).toISOString()) : ''
    },
  },
  watch: {
    'form.absent_count'(v) { this.syncStudents('absent', v) },
    'form.leave_count'(v) { this.syncStudents('leave', v) },
    form: { deep: true, handler() { this.autoSaveDraft() } },
  },
  mounted() {
    const p = this.$root.route.params
    if (p.planId) this.loadPlan(p.planId)
    else { this.isExtra = true; this.form.check_date = U.today(); this.checkDraft() }
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    // ---------- 草稿：本机自动保存，不请求云端 ----------
    autoSaveDraft() {
      if (this._draftTimer) clearTimeout(this._draftTimer)
      this._draftTimer = setTimeout(() => { this.saveDraft(true) }, 1500)
    },
    async saveDraft(silent) {
      if (!window.Draft) return
      const key = this.draftKey
      if (!key) return
      const photos = (this.photos || []).filter((p) => !p.saved && p.dataUrl).map((p) => ({
        key: p.key, dataUrl: p.dataUrl, thumbDataUrl: p.thumbDataUrl || '', kb: p.kb, takenAt: p.takenAt || '',
      }))
      const ok = await Draft.save(key, {
        userId: (Store.store.me && Store.store.me.id) || 0,
        planId: (this.plan && this.plan.id) || 0,
        form: JSON.parse(JSON.stringify(this.form)),
        photos: photos,
        meta: { text: this.draftText },
      })
      if (ok) {
        this.draftSavedAt = Date.now()
        if (silent === false) U.toast('草稿已保存在本机')
      } else if (silent === false) {
        U.toast('草稿保存失败（浏览器存储不可用）', 'bad')
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
      if (Array.isArray(d.photos)) {
        this.photos = d.photos.map((p, i) => ({
          key: p.key || ('d' + Date.now() + i), preview: '', dataUrl: p.dataUrl || '',
          thumbDataUrl: p.thumbDataUrl || '', kb: p.kb || 0, saved: false, takenAt: p.takenAt || '',
        }))
      }
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
        const row = await Store.rpcCached('plan_get', { p_id: Number(id) })
        if (row.status === 'submitted' && !this.isTest) { U.toast('这节已经填过了'); return Store.nav('/') }
        if (row.status === 'void') { U.toast('这节计划已作废'); return Store.nav('/') }
        this.plan = row
        this.fillFrom(row)
        const cls = Array.isArray(row.classes) ? row.classes : []
        this.form.classes = cls.slice().sort((a, b) => U.classCompare(a.code, b.code)).map((c) => {
          const exp = Number(c.expected) || 0
          return { code: c.code || '', expected: exp, actual: exp }
        })
        this.form.other_expected = Number(row.other_expected) || 0
        this.form.other_actual = this.form.other_expected
        const sum = this.form.classes.reduce((s, c) => s + c.expected, 0) + this.form.other_expected
        if (sum > 0) this.form.expected_count = sum
        // 若这节课有被打回的记录，直接载入原数据供修改（照片沿用，不重传）
        try {
          const redo = await Store.rpcCached('record_of_plan', { p_plan_id: row.id })
          if (redo && redo.record) this.applyReturnedRecord(redo.record, Number(redo.photo_count) || 0)
        } catch (e2) { /* 查询失败按新填处理 */ }
        await this.checkDraft()
      } catch (e) { U.toast(U.errText(e), 'bad'); Store.nav('/') }
    },
    applyReturnedRecord(rec, photoCount) {
      this.editRec = rec
      this.editPhotoCount = photoCount || 0
      this.fillFrom(rec)
      this.form.course_name = rec.course_name || this.form.course_name
      this.form.class_name = rec.class_name || this.form.class_name
      this.form.absent_count = Number(rec.absent_count) || 0
      this.form.leave_count = Number(rec.leave_count) || 0
      this.form.absent_students = (rec.absent_students || []).map((s) => ({ cls: s.cls || '', name: s.name || '' }))
      this.form.leave_students = (rec.leave_students || []).map((s) => ({ cls: s.cls || '', name: s.name || '' }))
      this.form.phone_count = Number(rec.phone_count) || 0
      this.form.sleep_count = Number(rec.sleep_count) || 0
      this.form.phone_10 = Number(rec.phone_10) || 0
      this.form.sleep_10 = Number(rec.sleep_10) || 0
      this.form.phone_30 = Number(rec.phone_30) || 0
      this.form.sleep_30 = Number(rec.sleep_30) || 0
      this.form.teacher_status = rec.teacher_status || ''
      this.form.teacher_score = rec.teacher_score == null ? 9.5 : Number(rec.teacher_score)
      this.form.student_score = rec.student_score == null ? 9.5 : Number(rec.student_score)
      this.form.course_content = rec.discipline_note || ''
      this.form.remark = rec.remark || ''
      this.form.discipline_tags = Array.isArray(rec.discipline_tags) ? rec.discipline_tags.slice() : []
      const cls = Array.isArray(rec.classes) ? rec.classes : []
      if (cls.length) {
        this.form.classes = cls.slice().sort((a, b) => U.classCompare(a.code, b.code)).map((c) => ({
          code: c.code || '', expected: Number(c.expected) || 0, actual: Number(c.actual) || 0,
        }))
      }
      this.form.other_expected = Number(rec.other_expected) || 0
      this.form.other_actual = Number(rec.other_actual) || 0
      this.form.expected_count = Number(rec.expected_count) || 0
      this.form.actual_count = Number(rec.actual_count) || 0
      // 原有数值视为已确认，不必重新逐个点「确定」
      Object.keys(this.confirmed).forEach((k) => { this.confirmed[k] = true })
    },
    async onPick(e) {
      const files = Array.from(e.target.files || [])
      e.target.value = ''
      for (const f of files) {
        if (this.photos.length >= 2) { U.toast('最多 2 张照片', 'bad'); break }
        const name = String(f.name || '').toLowerCase()
        if (f.type && f.type.indexOf('image/') !== 0 && !/\.(heic|heif|jpg|jpeg|png|webp|gif)$/.test(name)) continue
        try {
          const out = await IMG.compress(f, { maxKB: 300, maxEdge: 1500 })
          const dataUrl = await blobToDataUrl(out.blob)
          const th = await IMG.compress(f, { maxKB: 25, maxEdge: 320 })
          const thumbDataUrl = await blobToDataUrl(th.blob)
          // 水印：时间（精确到分钟）+ 检课人，烧进像素，事后无法用旧图替换
          let finalUrl = dataUrl
          let finalThumb = thumbDataUrl
          try {
            const me = (Store.store.me && Store.store.me.name) || ''
            const stamp = U.shortTime(new Date().toISOString()) + (me ? ' · ' + me : '')
            const wm = await IMG.watermark(dataUrl, stamp)
            if (wm && wm.dataUrl) { finalUrl = wm.dataUrl; finalThumb = wm.thumbDataUrl || thumbDataUrl }
          } catch (e3) { /* 水印失败按原图提交，不影响主流程 */ }
          this.photos.push({
            key: 'n' + Date.now() + Math.random(), preview: finalUrl || out.preview,
            dataUrl: finalUrl, thumbDataUrl: finalThumb, kb: out.kb, saved: false,
            takenAt: f.lastModified ? new Date(f.lastModified).toISOString() : '',
          })
        } catch (err) {
          const heic = f.type === 'image/heic' || f.type === 'image/heif' || /\.(heic|heif)$/.test(name)
          U.toast(heic ? '这张是 HEIC 格式，浏览器无法读取，请用截图或转成 JPG 后再上传' : (err.message || '照片处理失败'), 'bad')
        }
      }
    },
    async removePhoto(i) {
      const ph = this.photos[i]
      if (!ph) return
      if (ph.saved && ph.id) {
        try {
          const d = await Store.rpc('photo_delete', { p_id: ph.id })
          // 同步删除文件存储里的原图，避免残留占空间
          const sp = (d && d.storage_path) || ''
          if (sp && window.cloud && window.cloud.storage && window.cloud.storage.remove) {
            try { await window.cloud.storage.remove([sp]) } catch (e6) { /* 残留不影响使用 */ }
          }
          Store.clearRpcCache('photo_times')
        }
        catch (e) { U.toast(U.errText(e), 'bad'); return }
      }
      this.photos.splice(i, 1)
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
      c.actual = Math.min(Number(c.expected) || 0, Math.max(0, (Number(c.actual) || 0) + d))
    },
    clampActual(i) {
      const c = this.form.classes[i]
      if (!c) return
      c.actual = Math.min(Number(c.expected) || 0, Math.max(0, Math.floor(Number(c.actual) || 0)))
    },
    bumpOther(d) {
      this.form.other_actual = Math.min(this.otherExpected, Math.max(0, (Number(this.form.other_actual) || 0) + d))
    },
    clampOther() {
      this.form.other_actual = Math.min(this.otherExpected, Math.max(0, Math.floor(Number(this.form.other_actual) || 0)))
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
    submit() {
      this.err = ''
      if (!Store.store.semester) { this.err = '尚未设置学期，请联系管理员'; return }
      if (!this.isTest) {
        this.form.classes.forEach((c, i) => this.clampActual(i))
        this.clampOther()
      }
      if (!this.canSubmit) return
      this.confirmShow = true
    },
    async doSubmit() {
      this.confirmShow = false
      this.busy = true
      try {
        const body = this.payload()
        if (this.editMode) {
          // 修改被打回的原记录：照片沿用，只上传新追加的
          const rec2 = await Store.rpc('record_resubmit', { p_id: this.editRec.id, p_payload: body })
          if (this.photos.length) {
            const fail2 = await this.uploadPhotos(rec2.id)
            if (fail2) U.toast('已重新提交，但有 ' + fail2 + ' 张新照片未上传', 'bad')
            else U.toast('已修改并重新提交')
          } else {
            U.toast('已修改并重新提交')
          }
          if (window.Draft) Draft.del(this.draftKey)
          Store.clearRpcCache()
          Store.nav('/')
          return
        }
        body.plan_id = this.plan ? this.plan.id : null
        body.is_extra = !this.plan
        body.client_uuid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ''
        const rec = await Store.rpc('record_submit', { p_payload: body })
        const fail = await this.uploadPhotos(rec.id)
        if (fail) U.toast('查课成功，但有 ' + fail + ' 张照片未上传', 'bad')
        else U.toast('查课成功')
        if (window.Draft) Draft.del(this.draftKey)
        Store.clearRpcCache()
        Store.nav('/')
      } catch (e) {
        this.err = U.errText(e)
      } finally {
        this.busy = false
      }
    },
    async uploadPhotos(recId) {
      let fail = 0
      for (const ph of this.photos) {
        if (ph.saved) continue
        try {
          // 照片以 base64 存库（文件存储需 SDK 登录态，当前自建账号体系不可用，已实测）
          const params = {
            p_record_id: recId, p_mime: 'image/jpeg', p_thumb: ph.thumbDataUrl || '',
            p_data: ph.dataUrl, p_bytes: Math.round((ph.kb || 0) * 1024),
          }
          if (ph.takenAt) params.p_taken_at = ph.takenAt
          const r = await Store.rpc('photo_add', params)
          ph.saved = true
          if (r && r.id) {
            ph.id = r.id
            if (window.PhotoCache) PhotoCache.put(r.id, { thumb: ph.thumbDataUrl, data: ph.dataUrl, takenAt: ph.takenAt || '' })
          }
        } catch (e) {
          fail += 1
        }
      }
      return fail
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

    <div class="card mt12" v-if="rec && rec.returned" style="background:var(--bad-soft);border:1px solid rgba(217,45,32,.35)">
      <div class="strong" style="color:var(--bad)">这条记录已被管理员打回</div>
      <div class="sm mt8">记录保留仅作查看，不再计入统计与导出。请按原计划重新填报。</div>
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
        <div class="row between sm mt12" v-if="rec.teacher_status"><span class="muted">教师上课情况</span><span>{{ rec.teacher_status }}</span></div>

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
        <div class="tiny muted mt8">拍摄 {{ photoTakeText() }} · 提交 {{ U.dayTime(rec.submitted_at) || '—' }}</div>
        <div class="photo-grid" v-if="photosLoaded && photos.length">
          <div class="photo-item" v-for="(ph, i) in photos" :key="ph.id" @click="openPhoto(i)">
            <img v-if="ph.thumb" :src="ph.thumb" alt="现场照片">
            <div v-else class="photo-ph">原图</div>
          </div>
        </div>
        <div class="tiny muted mt8" v-if="photosLoaded && photos.length">点击缩略图查看原图（只读取本机缓存，不走云端）</div>
        <div class="muted sm" v-if="photosLoaded && !photos.length">本机没有这条记录的照片缓存（照片只保存在提交时的设备）</div>
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

    </template>
  </div>`,

  data() { return { U, rec: null, loading: true, photos: [], photosLoaded: false, photoLoading: false, fullPhoto: null, photoTimes: null } },
  computed: {
    counselorText() {
      if (!this.rec) return '—'
      return U.matchCounselors(Store.store.counselorMap, U.recordClassHints(this.rec)) || this.rec.counselor || '—'
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
  },
  mounted() { this.load() },
  methods: {
    actualOf(c) { return c.actual === null ? '—' : c.actual },
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    // 拍摄/上传时间只从本机缓存读，不请求云端（成员端照片本就只存本机）
    async loadLocalPhotoTimes(id) {
      const ids = localPhotoIds(id)
      if (!ids.length) { this.photoTimes = null; return }
      const taken = []
      const created = []
      for (const pid of ids) {
        const hit = window.PhotoCache ? await PhotoCache.get(pid) : null
        if (!hit) continue
        if (hit.takenAt) taken.push(hit.takenAt)
        if (hit.at) created.push(new Date(hit.at).toISOString())
      }
      this.photoTimes = { taken_at: taken[0] || '', created_at: created[0] || '' }
    },
    async loadPhotos(id) {
      if (!id || this.photoLoading) return
      this.photoLoading = true
      try {
        const out = []
        for (const pid of localPhotoIds(id)) {
          const hit = window.PhotoCache ? await PhotoCache.get(pid) : null
          if (hit) out.push({ id: pid, thumb: hit.thumb || '', data: hit.data || '' })
        }
        this.photos = out
        this.photosLoaded = true
      } finally { this.photoLoading = false }
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
      U.toast('本机没有这张照片的原图缓存', 'bad')
    },
    async load() {
      const id = this.$root.route.params.id
      try {
        const d = await Store.rpcCached('record_get', { p_id: Number(id) })
        this.rec = d.record
        this.loadLocalPhotoTimes(Number(id))
      } catch (e) {
        U.toast(U.errText(e), 'bad')
        Store.nav('/')
      } finally {
        this.loading = false
      }
    },
    photoTakeText() {
      const t = this.photoTimes && (this.photoTimes.taken_at || this.photoTimes.created_at)
      return t ? U.dayTime(t) : '—'
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
            <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span><span class="badge badge-warn" v-if="r.returned" style="margin-left:6px">已打回</span></div>
          </div>
          <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
          <div class="mt8"><span class="ibox" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span><span class="ibox ibox-ok">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span></div>
        </div>
      </div>
      <div class="muted sm" v-else-if="!loading">还没有查课记录</div>
      <div class="muted sm" v-else>加载中…</div>
      <div class="tiny muted mt8">本学期全部记录。</div>
    </div>
  </div>`,

  data() { return { U, list: [], loading: true } },
  mounted() { this.load() },
  methods: {
    go(p) { Store.nav(p) },
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    classParts(r) { return String(r.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter(Boolean) },
    async load() {
      if (window.RecordCache) {
        try {
          const cached = mineOnly(await RecordCache.all())
          if (cached.length) {
            this.list = cached.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
            this.loading = false
          }
        } catch (e) { /* 忽略 */ }
      }
      try {
        const rows = mineOnly(await Store.rpcCached('my_records', {}))
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
        <div class="litem" @click="go('/admin/members')">
          <div class="t1">成员管理</div>
          <div class="t2">停用、设为管理员</div>
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
            <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span><span class="badge badge-warn" v-if="r.returned" style="margin-left:6px">已打回</span></div>
          </div>
          <div class="t2">{{ U.md(r.check_date) }} {{ U.weekdayCN(r.check_date) }} {{ U.periodText(r.period_from, r.period_to) }}</div>
          <div class="mt8"><span class="ibox" v-for="(c, ci) in classParts(r)" :key="c + ci">{{ c }}</span><span class="ibox ibox-ok">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span></div>
        </div>
      </div>
      <div class="muted sm" v-else-if="!histLoading">还没有查课记录</div>
      <div class="muted sm" v-else>加载中…</div>
      <div class="tiny muted mt8">本学期全部记录。</div>
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
  </div>`,

  data() { return { U, history: [], histLoading: true } },
  computed: {
    me() { return Store.store.me },
    isAdmin() { return Store.store.isAdmin },
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
  },
  methods: {
    go(p) { Store.nav(p) },
    classParts(r) { return String(r.class_name || '').split(/[、,，+ ]+/).map((s) => s.trim()).filter(Boolean) },
    toggleTheme() { Store.toggleTheme() },
    async loadHistory() {
      if (Store.store.isAdmin) { this.histLoading = false; return }
      if (window.RecordCache) {
        try {
          const cached = mineOnly(await RecordCache.all())
          if (cached.length) {
            this.history = cached.sort((a, b) => (a.check_date < b.check_date ? 1 : -1))
            this.histLoading = false
          }
        } catch (e) { /* 忽略 */ }
      }
      try {
        const list = mineOnly(await Store.rpcCached('my_records', {}))
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
