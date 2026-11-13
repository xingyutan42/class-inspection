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
  <div class="shell fill-steps">
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

    <div class="fill-summary mt12">
      <div class="fs-top">
        <div class="fs-main">
          <div class="fs-title">{{ form.course_name || (isExtra ? '计划外查课' : '查课') }}</div>
          <div class="fs-meta">{{ summaryMeta }}</div>
        </div>
        <span class="badge" :class="isExtra ? 'badge-warn' : 'badge-pri'">{{ isExtra ? '计划外' : '计划内' }}</span>
      </div>
      <div class="fs-tags" v-if="form.teacher || form.room || form.arrive_before">
        <span class="ibox ibox-muted" v-if="form.teacher">{{ form.teacher }}</span>
        <span class="ibox ibox-pri" v-if="form.room">教室 {{ form.room }}</span>
        <span class="ibox ibox-warn" v-if="form.arrive_before">预计到岗 {{ U.arriveText(form.arrive_before) }}</span>
      </div>
    </div>

    <div class="stepnav" role="tablist" aria-label="填报步骤">
      <button type="button" role="tab" class="step" v-for="s in STEPS" :key="s.n"
        :class="{ on: step === s.n, ok: stepOk(s.n) }"
        :aria-selected="step === s.n ? 'true' : 'false'" @click="goStep(s.n)">
        <span class="step-i" aria-hidden="true">{{ stepOk(s.n) ? '✓' : s.n }}</span>
        <span class="step-t">{{ s.short }}</span>
      </button>
    </div>
    <div class="step-hint tiny" v-if="stepHint">{{ stepHint }}</div>

    <div class="card mt8 draft-tip" v-if="draftTip">
      <div class="strong" style="color:var(--warn)">发现未提交的草稿（{{ draftTip.time }}）</div>
      <div class="tiny muted mt8">{{ draftTip.text || '本机保存的填写内容' }}</div>
      <div class="row mt8" style="gap:8px">
        <button class="btn btn-sm btn-primary" @click="restoreDraft">恢复草稿</button>
        <button class="btn btn-sm" @click="dropDraft">丢弃</button>
      </div>
    </div>

    <div class="tiny muted mt8" v-if="draftSavedAt && !draftTip">草稿已保存在本机 · {{ draftSavedText }}</div>

    <!-- ========== 步骤 1：照片与课程信息 ========== -->
    <div class="fill-step" v-show="step === 1">
    <div class="card mt8">
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
      <div class="tiny mt8" style="color:var(--ink-2)" v-if="!editMode">课检员考勤需要，至少上传 1 张现场照片后才能提交。</div>
      <div class="tiny muted mt8">最多 2 张，自动压缩到 500KB 以内。建议拍教室全景或黑板，避免人脸特写。</div>
    </div>

    <div class="card mt8" v-if="selfEdit">
      <div class="strong">本周记录可以自己改一次</div>
      <div class="tiny muted mt8">改完点保存立即生效，管理员能看到这次改动；同一条记录只允许自行修改一次。</div>
    </div>

    <!-- 计划外才需要自己填课程信息；计划内的课程/老师/教室/时间已在顶部摘要，不再重复 -->
    <div class="card mt8" v-if="isExtra">
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
      <div class="field mb0">
        <label class="label">被查班级<i class="req">*</i></label>
        <input class="input" v-model="form.class_name" maxlength="40" placeholder="如：13002605">
        <div class="hint bad" v-if="classNameGradeMixed">当前填写班级的年级不同！同一节课请填写同年级的班级（仍可提交，请确认无误）</div>
      </div>
    </div>

    <div class="card mt8">
      <div class="hd"><h2>课程主要内容</h2><span class="tiny muted">台账必填</span></div>
      <div class="field mb0">
        <label class="label">本节课程主要内容<i class="req">*</i></label>
        <textarea class="textarea textarea-xs" v-model="form.course_content" maxlength="200" placeholder="如：第三章 极限的计算"></textarea>
      </div>
    </div>
    </div>

    <!-- ========== 步骤 2：出勤与名单 ========== -->
    <div class="fill-step" v-show="step === 2">
    <div class="card mt8">
      <div class="hd">
        <h2>出勤情况</h2>
        <span class="tiny muted" v-if="planMode">实到 {{ actualCount }} / 应到 {{ expectedTotal }}</span>
        <span class="tiny muted" v-else>实到自动计算</span>
      </div>

      <template v-if="form.classes.length">
        <div class="cstat-hd">
          <span class="label" style="margin:0">逐班实到</span>
          <span class="tiny muted">点 +/− 或直接填</span>
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
      <div class="kvrow" v-else><span class="k">课检班级</span><span class="v">{{ form.class_name || '—' }}</span></div>

      <num-field v-if="!form.classes.length" label="应到人数" v-model="form.expected_count" hint="点名册人数"></num-field>

      <datalist id="cls-suggest">
        <option v-for="c in classOptions" :key="c" :value="c"></option>
      </datalist>

      <div class="grid2">
        <div class="count-col">
          <num-field label="旷课" v-model="form.absent_count"></num-field>
          <div class="stu-wrap" v-if="form.absent_count > 0">
            <div class="row between mb8">
              <span class="tiny muted">旷课名单<span class="req" style="margin-left:4px">*</span></span>
              <button class="btn btn-sm" type="button" @click="pasteStudents('absent')">批量粘贴</button>
            </div>
            <div class="stu-row" v-for="(s2, i) in form.absent_students" :key="'a' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" list="cls-suggest" :style="String(s2.cls || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
              <input class="input" :style="String(s2.name || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
            </div>
            <div class="tiny mt8" style="color:var(--bad)" v-if="!absentOk">请补全每位旷课同学的班级和姓名后才能提交</div>
          </div>
        </div>
        <div class="count-col">
          <num-field label="请假" v-model="form.leave_count"></num-field>
          <div class="stu-wrap" v-if="form.leave_count > 0">
            <div class="row between mb8">
              <span class="tiny muted">请假名单<span class="req" style="margin-left:4px">*</span></span>
              <button class="btn btn-sm" type="button" @click="pasteStudents('leave')">批量粘贴</button>
            </div>
            <div class="stu-row" v-for="(s2, i) in form.leave_students" :key="'l' + i">
              <div class="stu-idx">第 {{ i + 1 }} 个</div>
              <input class="input" list="cls-suggest" :style="String(s2.cls || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.cls" maxlength="20" placeholder="班级（必填）">
              <input class="input" :style="String(s2.name || '').trim() ? '' : 'border-color:var(--bad)'" v-model="s2.name" maxlength="20" placeholder="姓名（必填）">
            </div>
            <div class="tiny mt8" style="color:var(--bad)" v-if="!leaveOk">{{ leaveErr }}</div>
          </div>
        </div>
      </div>

      <div class="row between kv mt8" v-if="!planMode">
        <span class="muted">实到人数</span>
        <span class="strong num" :style="actualCount < 0 ? 'color:var(--bad)' : ''">{{ actualCount < 0 ? '人数超出' : actualCount }}</span>
      </div>
      <div class="tiny muted" v-if="!planMode">实到 = 应到 − 旷课 − 请假</div>
      <div class="tiny mt8" v-else :style="shortageOk ? 'color:var(--ok)' : 'color:var(--bad)'">
        缺勤 {{ shortageCount }} 人（应到 {{ expectedTotal }} − 实到 {{ actualCount }}）= 旷课 {{ Number(form.absent_count) || 0 }} + 请假 {{ Number(form.leave_count) || 0 }}{{ shortageOk ? ' ✓' : '，还差 ' + shortageDiff + ' 人未标记' }}
      </div>
      <div class="tiny mt8" :style="sumOk ? 'color:var(--muted)' : 'color:var(--bad);font-weight:700'">
        合计校验：实到 {{ actualCount }} + 请假 {{ Number(form.leave_count) || 0 }} + 旷课 {{ Number(form.absent_count) || 0 }} = {{ (Number(actualCount) || 0) + (Number(form.leave_count) || 0) + (Number(form.absent_count) || 0) }} / 应到 {{ expectedTotal }}{{ sumOk ? '' : '（不一致，请核对）' }}
      </div>

      <div class="kvrow mt12"><span class="k">应到人数</span><span class="v strong num">{{ expectedTotal }}</span></div>
      <div class="kvrow"><span class="k">辅导员</span><span class="v">{{ counselorText }}</span></div>
      <div class="kvrow"><span class="k">课检员</span><span class="v">{{ memberName }}</span></div>
    </div>


    </div>

    <!-- ========== 步骤 3：纪律与评分 ========== -->
    <div class="fill-step" v-show="step === 3">
    <div class="card mt8">
      <div class="hd"><h2>课堂纪律</h2><span class="tiny muted">6 项均需点确定</span></div>

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

    <div class="card mt8">
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
    </div>

    <!-- ========== 步骤 4：备注及提交 ========== -->
    <div class="fill-step" v-show="step === 4">
    <div class="card mt8">
      <div class="hd">
        <h2>检查备注</h2>
        <button type="button" class="btn btn-sm" @click="remarkOpen = !remarkOpen">{{ remarkOpen ? '收起' : (form.remark ? '查看 / 修改' : '添加备注') }}</button>
      </div>
      <div class="tiny muted" v-if="!remarkOpen && !form.remark">选填，默认收起；有需要说明的情况再展开。</div>
      <div class="field mb0" v-show="remarkOpen">
        <label class="label">备注内容</label>
        <textarea class="textarea textarea-xs" v-model="form.remark" maxlength="200" placeholder="如：教师临时更换"></textarea>
      </div>
    </div>

    <div class="card mt8">
      <div class="hd"><h2>提交前检查</h2><span class="tiny muted">{{ checksDone }} / {{ checks.length }} 项已满足</span></div>
      <ul class="checklist">
        <li v-for="c in checks" :key="c.k" :class="c.ok ? 'ok' : 'bad'">
          <span class="ci" aria-hidden="true">{{ c.ok ? '✓' : '!' }}</span>
          <span class="ct">{{ c.t }}</span>
        </li>
      </ul>
      <div class="tiny muted mt8">提交后仍按原有规则校验；有问题可回到前面步骤修改，填写内容不会丢。</div>
    </div>
    </div>

    <div class="mask mask-center" v-if="confirmShow">
      <div class="sheet sheet-center">
        <h3>{{ selfEdit ? '确认保存修改' : '确认提交' }}</h3>
        <div class="sub">{{ selfEdit ? '照片沿用原记录，保存后管理员能看到这次改动，本条记录不能再自行修改。' : '请确认已经完成所有填写' }}</div>
        <button class="btn btn-primary btn-block" :disabled="busy" @click="doSubmit">{{ selfEdit ? '确认保存修改' : '确认提交' }}</button>
        <button class="btn btn-block mt8" @click="confirmShow = false">再检查一下</button>
      </div>
    </div>

    <div class="actionbar">
      <div class="ab-tip center tiny muted" v-if="isTest">测试账号：不受提交限制（照片、名单、合计、确定项都可跳过）</div>
      <div class="ab-tip center tiny muted" v-else-if="isAdminProxy">管理员模式：不受提交限制（照片、名单、合计、确定项都可跳过）</div>
      <div class="ab-tip center tiny" v-else-if="step === STEPS.length && !canSubmit" style="color:var(--bad)">{{ submitBlockText }}</div>
      <div class="ab-tip center tiny muted" v-else-if="editMode && step === STEPS.length">照片沿用原记录，只改需要变动的内容即可</div>
      <div class="inner">
        <button class="btn ab-draft" @click="saveDraft(false)">存草稿</button>
        <button class="btn btn-primary btn-lg grow" v-if="step < STEPS.length" @click="nextStep">下一步：{{ STEPS[step].short }}</button>
        <button class="btn btn-primary btn-lg grow" v-else :disabled="busy || !canSubmit" @click="submit">
          {{ busy ? '提交中…' : (selfEdit ? '保存修改' : '提交查课结果') }}
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
      // 分步：1 照片与课程信息 / 2 出勤与名单 / 3 纪律与评分 / 4 备注及提交
      step: 1, remarkOpen: false,
      STEPS: [
        { n: 1, short: '照片', t: '照片与课程信息' },
        { n: 2, short: '出勤', t: '出勤与名单' },
        { n: 3, short: '纪律评分', t: '纪律与评分' },
        { n: 4, short: '备注提交', t: '备注及提交' },
      ],
      // 草稿基线：载入完成后记录一次，只有偏离基线（真的动过）才存草稿
      draftReady: false, draftBaseline: '',
      // 本人当周自改一次：selfEditId 来自 /fill/:planId?edit=:recordId
      selfEdit: false, selfEditId: 0,
      plan: null,
      // 自改时：editRec 为原记录，照片沿用不重传
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
    // 顶栏下的课程摘要：课程 / 日期节次 / 教室 / 计划内外，避免后续重复展示同一信息
    summaryMeta() {
      const out = []
      if (this.form.check_date) out.push(this.weekText)
      out.push(U.periodText(this.form.period_from, this.form.period_to))
      return out.filter(Boolean).join(' · ')
    },
    // 计划外必填项（与提交校验口径一致：时间 / 课程名 / 老师 / 班级）
    extraInfoOk() {
      return !!(String(this.form.check_date || '').trim() && String(this.form.course_name || '').trim()
        && String(this.form.teacher || '').trim() && String(this.form.class_name || '').trim())
    },
    // 提交前检查清单：每项标注所属步骤，供步骤条与底栏提示复用；口径与 canSubmit 保持一致
    checks() {
      const bypass = this.isTest || this.isAdminProxy
      const out = []
      out.push({ k: 'photo', step: 1, t: this.editMode ? '照片沿用原记录' : '现场照片至少 1 张', ok: this.editMode || bypass || this.photos.length > 0 })
      if (this.isExtra && !this.editMode) out.push({ k: 'info', step: 1, t: '计划外课程名称 / 老师 / 班级 / 课检时间已填', ok: bypass || this.extraInfoOk })
      out.push({ k: 'content', step: 1, t: '已填写本节课程主要内容', ok: this.editMode ? true : (bypass || !!String(this.form.course_content || '').trim()) })
      out.push({ k: 'sum', step: 2, t: '人数合计一致：实到 + 请假 + 旷课 = 应到', ok: bypass || this.sumOk })
      out.push({ k: 'students', step: 2, t: '旷课 / 请假名单的班级和姓名填写完整', ok: bypass || this.studentsOk })
      if (!this.editMode) {
        out.push({ k: 'teacher', step: 3, t: '已选择教师上课情况', ok: bypass || !!String(this.form.teacher_status || '').trim() })
        out.push({ k: 'confirm', step: 3, t: '课堂纪律 6 项 + 评分 2 项已点确定', ok: bypass || this.allConfirmed })
      }
      return out
    },
    checksDone() { return this.checks.filter((c) => c.ok).length },
    // 当前步骤未完成项提示（不阻断浏览，只说明缺什么）
    stepHint() {
      if (this.isTest || this.isAdminProxy) return ''
      const bad = this.checks.filter((c) => !c.ok && c.step === this.step)
      if (!bad.length) return ''
      return '本步还有 ' + bad.length + ' 项待完成：' + bad[0].t
    },
    // 底栏在最后一步才提示阻塞原因，避免把错误提示堆在每一步上方
    submitBlockText() {
      const bad = this.checks.filter((c) => !c.ok)
      if (!bad.length) return '还有未满足的提交条件，请回到前面步骤核对'
      return '还不能提交：' + bad[0].t + (bad.length > 1 ? '（共 ' + bad.length + ' 项未满足）' : '')
    },
    otherExpected() { return Number(this.isExtra ? 0 : this.form.other_expected) || 0 },
    planMode() { return !this.isExtra && (this.form.classes || []).length > 0 },
    // T2 软限制：计划外查课的班级号可填多个（顿号/逗号分隔），跨年级只提示不阻断
    classNameGradeMixed() {
      return U.gradeKeysOf(U.codesInText(this.form.class_name)).length > 1
    },
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
    // 请假名单只要求班级 + 姓名（请假原因已全系统下线，不再采集/校验）
    leaveOk() {
      return (this.form.leave_students || []).every((s) => String(s.cls || '').trim() && String(s.name || '').trim())
    },
    leaveErr() {
      return '请补全每位请假同学的班级和姓名后才能提交'
    },
    studentsOk() { return this.absentOk && this.leaveOk },
    // 缺勤联动：应到 − 实到 应等于 旷课 + 请假
    shortageCount() { return Math.max(0, (Number(this.expectedTotal) || 0) - (Number(this.actualCount) || 0)) },
    markedCount() { return (Number(this.form.absent_count) || 0) + (Number(this.form.leave_count) || 0) },
    shortageOk() { return this.markedCount === this.shortageCount },
    shortageDiff() { return Math.abs(this.shortageCount - this.markedCount) },
    sumOk() {
      const sum = (Number(this.actualCount) || 0) + (Number(this.form.absent_count) || 0) + (Number(this.form.leave_count) || 0)
      return sum === (Number(this.expectedTotal) || 0)
    },
    // 自改原记录（照片沿用，不重传）
    editMode() { return !!this.editRec },
    // 测试账号（学号 TEST 开头 / 姓名「测试」开头）：不受任何提交限制，方便反复测试
    isTest() {
      const me = Store.store.me || {}
      return /^TEST/i.test(String(me.student_no || '')) || /^测试/.test(String(me.name || ''))
    },
    // 管理员「登录他」代成员操作：同样不受提交限制（补录/演示时不必凑照片和确定项）
    isAdminProxy() {
      const imp = Store.store.impersonation
      return !!(imp && imp.active)
    },
    canSubmit() {
      if (this.isTest || this.isAdminProxy) return true
      // 自改原记录：只校验人数合计与名单，照片/确定项/教师情况不强制
      if (this.editMode) {
        if (!this.form.check_date) return false
        if (this.planMode && this.form.classes.some((c) => (Number(c.actual) || 0) > (Number(c.expected) || 0))) return false
        if (!this.sumOk) return false
        if (!this.studentsOk) return false
        return true
      }
      if (!this.form.check_date) return false
      if (!this.form.course_name.trim() || !this.form.class_name.trim()) return false
      if (!String(this.form.teacher || '').trim()) return false
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
    // 班级候选：本节课班级 + 本人负责班级 + 本人班级
    classOptions() {
      const set = []
      const add = (v) => {
        String(v || '').split(/[、,，+\s]+/).forEach((x) => {
          const t = x.trim()
          if (t && t !== '其他' && set.indexOf(t) < 0) set.push(t)
        })
      }
      ;(this.form.classes || []).forEach((c) => add(c.code))
      const me = Store.store.me || {}
      add(me.duty_classes)
      add(me.own_class)
      return set.sort((a, b) => U.classCompare(a, b))
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
      const cls = U.normClasses(f).join('、')
      return [U.md(f.check_date), U.periodText(f.period_from, f.period_to), f.course_name, f.teacher, cls].filter(Boolean).join(' · ')
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
    // 兜底检查：正常情况下不会走到这里——根组件（app.js）在 store.me 为空时
    // 会直接渲染登录页，压根不会挂载本组件。保留是为了防止将来路由守卫被改动。
    if (!(Store.store && Store.store.token)) {
      // 先跳转，再提示：即使 toast 因页面正在切换而失败，也不能挡住跳转
      Store.nav('/login')
      try { U.toast('登录已失效，请重新登录', 'bad') } catch (e) { /* 忽略 */ }
      return
    }
    window.__xfcSaveDraftBeforeRefresh = async () => {
      if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null }
      return await this.saveDraft(true)
    }
    const p = this.$root.route.params
    const q = this.$root.route.query || {}
    if (q.edit) this.selfEditId = Number(q.edit) || 0
    if (p.planId) this.loadPlan(p.planId)
    else { this.isExtra = true; this.form.check_date = U.today(); this.markDraftBaseline(); this.checkDraft() }
  },
  beforeUnmount() {
    if (this._draftTimer) clearTimeout(this._draftTimer)
    if (window.__xfcSaveDraftBeforeRefresh) delete window.__xfcSaveDraftBeforeRefresh
  },
  methods: {
    back() { history.length > 1 ? history.back() : Store.nav('/') },
    // ---------- 分步导航：允许来回浏览，最终提交仍由 canSubmit 全量校验 ----------
    stepOk(n) {
      if (this.isTest || this.isAdminProxy) return true
      if (n === 1) {
        const photoOk = this.editMode || this.photos.length > 0
        const contentOk = this.editMode || !!String(this.form.course_content || '').trim()
        const infoOk = !this.isExtra || this.editMode || this.extraInfoOk
        return photoOk && contentOk && infoOk
      }
      if (n === 2) return this.sumOk && this.studentsOk
      if (n === 3) return this.editMode ? true : (!!String(this.form.teacher_status || '').trim() && this.allConfirmed)
      return this.canSubmit
    },
    goStep(n) {
      this.step = Math.min(this.STEPS.length, Math.max(1, Number(n) || 1))
      this.scrollToTop()
    },
    nextStep() {
      if (this.step < this.STEPS.length) { this.step += 1; this.scrollToTop() }
    },
    scrollToTop() {
      this.$nextTick(() => { try { window.scrollTo(0, 0) } catch (e) { /* 忽略 */ } })
    },
    // ---------- 草稿：本机自动保存，不请求云端 ----------
    autoSaveDraft() {
      if (this._draftTimer) clearTimeout(this._draftTimer)
      this._draftTimer = setTimeout(() => { this.saveDraft(true) }, 1500)
    },
    // 表单快照：键名排序后序列化，只用于比较内容是否变化
    formSig(f) {
      if (!f) return ''
      const o = {}
      Object.keys(f).sort().forEach((k) => { o[k] = f[k] })
      try { return JSON.stringify(o) } catch (e) { return '' }
    },
    // 载入完成：把当前内容记为基线，此后只有偏离基线才算「填过」
    markDraftBaseline() {
      this.draftBaseline = this.formSig(this.form)
      this.draftReady = true
    },
    isDirty() {
      if (!this.draftReady || !this.draftBaseline) return false
      if ((this.photos || []).some((p) => p.dataUrl)) return true
      return this.formSig(this.form) !== this.draftBaseline
    },
    async saveDraft(silent) {
      if (!window.Draft) return false
      if (!this.draftReady) return false   // 计划还在载入，别把程序填的默认值当成用户输入
      const key = this.draftKey
      if (!key) return false
      // 内容与刚进入页面时一模一样 → 没有可存的东西。
      // 注意：这里只跳过保存，绝不能删已有草稿——那份可能是上次没填完留下的，
      // 用户还没点「恢复」或「丢弃」，删掉就等于把人家的工作弄没了。
      if (!this.isDirty()) {
        if (silent === false) U.toast('还没有填写内容')
        return true
      }
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
        return true
      } else {
        if (silent === false) U.toast('草稿保存失败（浏览器存储不可用）', 'bad')
        return false
      }
    },
    async checkDraft() {
      if (!window.Draft) return
      const key = this.draftKey
      const d = await Draft.get(key)
      if (!d) { this.draftTip = null; return }
      // 旧版本会把「刚载入、还没动」的表单也存成草稿：内容与基线一致且无照片 → 视为空草稿，直接清掉
      const noPhoto = !Array.isArray(d.photos) || d.photos.length === 0
      if (noPhoto && d.form && this.formSig(d.form) === this.formSig(this.form)) {
        await Draft.del(key)
        this.draftTip = null
        this.draftSavedAt = 0
        return
      }
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
        const pid = Number(id)
        // 自改所需数据从 plan_get 与 record_get 分别取得
        const row = await Store.rpcCached('plan_get', { p_id: pid })
        if (row.status === 'submitted' && !this.isTest && !this.selfEditId) { U.toast('这节已经填过了'); return Store.nav('/') }
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
        // 本人当周自改：带出上次提交的内容，照片沿用
        if (this.selfEditId) {
          const d = await Store.rpcCached('record_get', { p_id: this.selfEditId })
          if (!d || !d.can_edit) { U.toast('这条记录已经不能自行修改了'); return Store.nav('/') }
          this.selfEdit = true
          this.applyReturnedRecord(d.record, Number(d.photo_count) || 0)
        }
        this.markDraftBaseline()
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
      // 请假原因已下线：历史记录里的 reason/note 不再读入表单，只保留班级与姓名
      this.form.leave_students = (rec.leave_students || []).map((s) => ({
        cls: s.cls || '', name: s.name || '',
      }))
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
          const out = await IMG.compress(f, { maxKB: 120, maxEdge: 640 })  // 640px：够看清人数/教室
          const dataUrl = await blobToDataUrl(out.blob)
          const th = await IMG.compress(f, { maxKB: 20, maxEdge: 320 })
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
    // 批量粘贴：每行「班级 姓名」（空格 / 逗号 / Tab 分隔均可）
    pasteStudents(kind) {
      const label = kind === 'absent' ? '旷课' : '请假'
      const text = window.prompt(
        `粘贴${label}名单，每行一个同学\n格式：班级 姓名（空格或逗号分隔）\n例如：\n13002608 张三\n13002609 李四,王五`,
        ''
      )
      if (!text) return
      const rows = []
      text.split(/\r?\n/).forEach((line) => {
        const t = line.trim()
        if (!t) return
        const parts = t.split(/[\s,，\t]+/).filter(Boolean)
        if (!parts.length) return
        if (parts.length === 1) rows.push({ cls: parts[0], name: '' })
        else rows.push({ cls: parts[0], name: parts.slice(1).join('') })
      })
      if (!rows.length) { U.toast('没识别到内容', 'bad'); return }
      const key = kind === 'absent' ? 'absent_students' : 'leave_students'
      const cntKey = kind === 'absent' ? 'absent_count' : 'leave_count'
      this.form[key] = rows
      this.form[cntKey] = rows.length
      U.toast(`已导入 ${rows.length} 条${label}名单`)
    },
    syncStudents(kind, n) {
      const key = kind === 'absent' ? 'absent_students' : 'leave_students'
      const cntKey = kind === 'absent' ? 'absent_count' : 'leave_count'
      const arr = this.form[key]
      const target = Math.max(0, Math.min(Number(n) || 0, 100))
      if (arr.length > target) {
        const dropped = arr.slice(target)
        const hasData = dropped.some((x) => String(x.cls || '').trim() || String(x.name || '').trim())
        if (hasData && !window.confirm(`人数减少，将删除最后 ${dropped.length} 条已填名单，确定？`)) {
          this.form[cntKey] = arr.length
          return
        }
      }
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
        // 请假名单只提交班级与姓名：原因字段已全系统下线，新数据不再携带 reason/note
        leave_students: this.form.leave_students.filter((x) => x.name || x.cls).map((x) => ({
          cls: x.cls, name: x.name,
        })),
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
    // 3.7：计划外查课（无 plan_id）的重复/冲突只软提示，不阻断提交
    async extraConflictHint() {
      if (this.plan) return
      try {
        const rows = await Store.rpc('my_records', {})
        const me = Store.store.me || {}
        const cur = Object.assign({}, this.form, { owner_id: me.id, classes: [] })
        let hint = ''
        ;(rows || []).forEach((r) => {
          if (!hint) {
            const c = U.sessionCompare(r, cur)
            if (c.same) hint = '这节课已有查课记录，请确认是否重复填报'
            else {
              const t = U.sessionHint(r, cur)
              if (t) hint = t
            }
          }
        })
        if (hint) U.toast(hint)
      } catch (e) { /* 提示失败不影响提交 */ }
    },
    async submit() {
      this.err = ''
      if (!Store.store.semester) { this.err = '尚未设置学期，请联系管理员'; return }
      // T2 软限制：计划外查课填了多个不同年级的班级，只提示，不拦提交
      if (this.classNameGradeMixed) U.toast('当前填写班级的年级不同！', 'bad')
      if (!this.isTest && !this.isAdminProxy) {
        this.form.classes.forEach((c, i) => this.clampActual(i))
        this.clampOther()
      }
      // 台账必需列：自改走的是 editMode 分支，canSubmit 不校验这一项，这里补上
      if (!this.isTest && !this.isAdminProxy && !String(this.form.teacher_status || '').trim()) {
        this.err = '请选择「教师上课情况」——台账这一列不能空'
        return
      }
      if (!this.canSubmit) return
      await this.extraConflictHint()
      this.confirmShow = true
    },
    async doSubmit() {
      this.confirmShow = false
      this.busy = true
      try {
        // 提交前先把当前内容强制落盘（含照片）。
        // 目的：万一提交时才发现登录过期（服务端返回「登录已失效」并跳登录页），
        // 用户填的内容和照片不会白填一遍——重新登录后进同一节还能恢复。
        await this.saveDraft(true)
        const body = this.payload()
        if (this.editMode) {
          // 成员当周自行修改一次：只更新原记录，照片沿用
          const okText = '已保存修改，管理员能看到这次改动'
          const rec2 = await Store.rpc('record_self_update', { p_id: this.editRec.id, p_payload: body })
          if (this.photos.length) {
            const fail2 = await this.uploadPhotos(rec2.id)
            if (fail2) U.toast(okText + '，但有 ' + fail2 + ' 张新照片未上传', 'bad')
            else U.toast(okText)
          } else {
            U.toast(okText)
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
        const msg = U.errText(e)
        this.err = msg
        // 登录失效：Store 内部已经清 token 并跳登录页，这里再兜一次草稿保存，
        // 保证「填了半小时、点提交才发现要重新登录」不会白干。
        if (/登录已失效/.test(msg)) {
          try { await this.saveDraft(true) } catch (e2) { /* 组件可能已销毁，忽略 */ }
          U.toast('登录已过期，填写内容已存到本机；重新登录后进同一节会提示恢复', 'bad')
        }
      } finally {
        this.busy = false
      }
    },
    async uploadPhotos(recId) {
      let fail = 0
      let errShown = false
      // 只取一次 SDK 身份；'' 表示无 SDK 身份（10 个老账号 / SDK 未就绪）。
      // 严禁用 Store.store.me.id（业务小整数）拼路径（C-05）。
      const uid = await Store.currentUid()
      for (let i = 0; i < this.photos.length; i++) {
        const ph = this.photos[i]
        if (ph.saved) continue
        try {
          if (!uid) {
            // ---- 兜底通道：完全沿用 3.8.5 base64 参数契约，绝不触发 cloud.storage.* ----
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
            continue
          }
          // ---- 新链路：shared/<SDK uid>/checks/<recId>/... ----
          const stamp = Date.now()
          const key = String(ph.key || ('p' + i)).replace(/[^\w-]/g, '') || ('p' + i)
          const base = 'shared/' + uid + '/checks/' + recId
          const fullPath = base + '/' + stamp + '-' + key + '-full.jpg'
          await this.uploadBlob(fullPath, ph.dataUrl)   // 内部已判 {data,error}，失败即抛，绝不登记
          let thumbPath = ''
          if (ph.thumbDataUrl) {
            const tp = base + '/' + stamp + '-' + key + '-thumb.jpg'
            // Q-03/R-17：缩略图失败降级置空，不阻断主流程、不计入 fail；
            // 读端 Store.thumbUrl 会自动回落到 storage_path 原图签名，不产生破图。
            try { await this.uploadBlob(tp, ph.thumbDataUrl); thumbPath = tp } catch (e) { thumbPath = '' }
          }
          const params = {
            p_record_id: recId, p_storage_path: fullPath, p_thumb_path: thumbPath,
            p_bytes: Math.round((ph.kb || 0) * 1024), p_mime: 'image/jpeg',
          }
          if (ph.takenAt) params.p_taken_at = ph.takenAt
          // 注意：p_token 由 Store.rpc 自动注入（代登录时为被代理人 token）
          const r = await Store.rpc('photo_add_storage', params)
          ph.saved = true
          if (r && r.id) {
            ph.id = r.id
            if (window.PhotoCache) PhotoCache.put(r.id, { thumb: ph.thumbDataUrl, data: ph.dataUrl, takenAt: ph.takenAt || '' })
          }
        } catch (e) {
          fail += 1
          // R-05 / AC-12：错误文案透出，不再静默吞错；仅首张失败弹一次，避免刷屏。
          // fail 仍按实际失败张数累加；doSubmit 的汇总 toast 文案不改（无 UI 变化）。
          if (!errShown) {
            errShown = true
            U.toast('第 ' + (i + 1) + ' 张照片未上传：' + (U.errText(e) || '未知错误'), 'bad')
          }
        }
      }
      return fail
    },
    async uploadBlob(path, dataUrl) {
      const st = window.cloud && window.cloud.storage
      if (!st || !st.upload) throw new Error('文件存储未就绪，请刷新页面重试')
      const blob = await (await fetch(dataUrl)).blob()
      const res = await st.upload(path, new Blob([blob], { type: 'image/jpeg' }), { contentType: 'image/jpeg' })
      // C-09 / AC-02：必须判 error；有 error 立即抛，绝不登记路径、绝不写 ph.saved。
      if (!res) throw new Error('文件存储无响应，请重试')
      if (res.error) {
        const er = res.error
        throw (er instanceof Error ? er : new Error(String((er && er.message) || er)))
      }
      return res.data
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

    <div class="card mt12" v-if="rec && canEdit && rec.plan_id">
      <div class="strong">本周记录可以自己改一次</div>
      <div class="tiny muted mt8">只能改查课结果（人数、名单、纪律、评分）；课程与班级要改请联系管理员。改完管理员能看到这次改动。</div>
      <button class="btn btn-primary btn-block mt8" @click="editRecord">修改这条记录</button>
    </div>

    <div class="card mt12" v-if="loading"><div class="empty">加载中…</div></div>

    <template v-else-if="rec">
      <div class="card mt12">
        <div class="hd">
          <h2>课程信息</h2>
          <span class="badge" :class="rec.is_extra ? 'badge-warn' : 'badge-pri'">{{ rec.is_extra ? '计划外' : '计划内' }}</span>
        </div>

        <div class="kvrow"><span class="k">课程名称</span><span class="v strong">{{ rec.course_name }}</span></div>
        <div class="kvrow" v-if="rec.admin_note"><span class="k">操作留痕</span><span class="v" style="color:var(--warn);font-weight:650">{{ rec.admin_note }}</span></div>
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

  data() { return { U, rec: null, loading: true, photos: [], photosLoaded: false, photoLoading: false, fullPhoto: null, photoTimes: null, canEdit: false, photoCount: 0 } },
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
        this.canEdit = !!d.can_edit
        this.photoCount = Number(d.photo_count) || 0
        this.loadLocalPhotoTimes(Number(id)).catch(() => {})
      } catch (e) {
        U.toast(U.errText(e), 'bad')
        Store.nav('/')
      } finally {
        this.loading = false
      }
    },
    // 当周自改入口：带上记录 id，填报页据此走 record_self_update
    editRecord() {
      if (!this.rec || !this.rec.plan_id) return
      Store.nav('/fill/' + this.rec.plan_id + '?edit=' + this.rec.id)
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
            <div class="t1">{{ r.course_name }} <span class="muted sm">· {{ r.class_name }}</span></div>
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
        <div class="litem" @click="go('/admin/coverage')">
          <div class="t1">班级查课覆盖</div>
          <div class="t2">按周看大一各班查了几次，找出漏查的班</div>
        </div>
        <div class="litem" @click="go('/admin/export')">
          <div class="t1">导出 Excel 台账</div>
          <div class="t2">明细 + 周汇总 + 成员汇总</div>
        </div>
        <div class="litem" @click="go('/admin/semesters')">
          <div class="t1">学期设置</div>
          <div class="t2">第 1 周周一与总周数</div>
        </div>
        <div class="litem" @click="go('/admin/photos')">
          <div class="t1">照片迁移</div>
          <div class="t2">把历史照片搬到对象存储，释放数据库空间</div>
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
