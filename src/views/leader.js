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
      <div class="side right">
        <button class="iconbtn" @click="hardRefresh" title="刷新数据" :disabled="loading">↻</button>
        <button class="iconbtn" @click="go('/admin/trash')" title="选课回收站">♻</button>
        <button class="iconbtn" @click="go('/admin/export')" title="导出">⤓</button>
      </div>
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

    <div class="kpi-grid mt12" v-if="!loadError">
      <button type="button" class="kpi kpi-warn" :class="{ on: courseStatus === 'pending' && groupBy === 'date' && !onlySelfEdited }" :aria-pressed="courseStatus === 'pending' ? 'true' : 'false'" @click="focusPending">
        <span class="kpi-n">{{ kpiPending }}</span>
        <span class="kpi-t">待查课程</span>
        <span class="kpi-h">{{ kpiPending ? '点开未查列表' : '本周已查完' }}</span>
      </button>
      <button type="button" class="kpi" :class="{ on: groupBy === 'member' && !onlySelfEdited }" :aria-pressed="groupBy === 'member' ? 'true' : 'false'" @click="focusMembers">
        <span class="kpi-n">{{ kpiMembers }}</span>
        <span class="kpi-t">未完成成员</span>
        <span class="kpi-h">{{ kpiMembers ? '点开成员列表' : '没有待查的成员' }}</span>
      </button>
      <button type="button" class="kpi" :class="{ on: onlySelfEdited }" :aria-pressed="onlySelfEdited ? 'true' : 'false'" @click="focusAttention">
        <span class="kpi-n">{{ kpiAttention }}</span>
        <span class="kpi-t">需关注记录</span>
        <span class="kpi-h">{{ kpiAttention ? '成员自行修改过' : '本周暂无' }}</span>
      </button>
    </div>

    <div class="card mt12" v-if="loading && !loaded">
      <div class="row" style="gap:10px"><span class="spin" aria-hidden="true"></span><span class="muted sm">正在加载本周课检数据…</span></div>
    </div>

    <div class="card mt12" v-else-if="loadError">
      <div class="strong" style="color:var(--bad)">本周数据没有加载成功</div>
      <div class="tiny muted mt8">可能是网络中断或服务暂不可用，<b>这不代表本周没有待办</b>。请重试或稍后再进。</div>
      <div class="row mt12" style="gap:8px">
        <button class="btn btn-sm btn-primary" @click="hardRefresh" :disabled="loading">{{ loading ? '重试中…' : '重新加载' }}</button>
      </div>
    </div>

    <div class="course-list" v-if="!loadError && !(loading && !loaded)">
    <div class="mt12 row between">
      <h2 style="font-size:15px;margin:0">{{ listTitle }} <span class="muted" style="font-weight:500">{{ statusCourses.length }} 节</span></h2>
      <div class="row" style="gap:6px">
        <div class="chip chip-sm" :class="{ on: groupBy === 'date' }" @click="groupBy = 'date'">按日期</div>
        <div class="chip chip-sm" :class="{ on: groupBy === 'member' }" @click="groupBy = 'member'">按成员</div>
      </div>
    </div>

    <!-- 一级操作：状态切换 + 筛选入口（年级/星期/成员收进面板） -->
    <div class="statusbar mt8">
      <div class="chips" style="flex:1 1 auto">
        <div class="chip" :class="{ on: courseStatus === 'pending' }" @click="courseStatus = 'pending'">待查 {{ dayStats.pending }}</div>
        <div class="chip" :class="{ on: courseStatus === 'all' }" @click="courseStatus = 'all'">全部 {{ dayCourses.length }}</div>
        <div class="chip" :class="{ on: courseStatus === 'done' }" @click="courseStatus = 'done'">已完成 {{ dayStats.done }}</div>
      </div>
      <button type="button" class="btn btn-sm filter-open" :class="{ on: filterCount > 0 }" @click="openFilters">
        筛选<span class="filter-n" v-if="filterCount">{{ filterCount }}</span>
      </button>
    </div>

    <!-- 已应用条件：逐项移除 / 一键清空 -->
    <div class="filterbar mt8" v-if="filterChips.length">
      <span class="filterbar-t tiny muted">已筛选</span>
      <span class="fchip" v-for="f in filterChips" :key="f.k">{{ f.t }}<button type="button" class="fx" :aria-label="'取消筛选 ' + f.t" @click.stop="clearOne(f.k)">✕</button></span>
      <button type="button" class="btn btn-sm" @click="clearFilters">清空</button>
    </div>

    <div v-if="groupBy === 'date'">
    <div class="mt12" v-for="g in courseGroups" :key="g.key">
      <div class="row between">
        <h3 style="font-size:14px;margin:0">{{ g.title }}</h3>
        <span class="tiny muted">{{ g.rows.length }} 节 · 已查 {{ g.done }} · 未查 {{ g.pending }}</span>
      </div>
      <div class="list mt8 course-grid">
        <div class="litem" v-for="r in g.rows" :key="r._key" style="cursor:pointer" @click="openCourse(r)">
          <div class="row between">
            <div class="t1">{{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-muted" v-if="r.teacher">{{ r.teacher }}</span><span class="ibox ibox-muted">{{ r.owner_name }}</span><span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span><span class="ibox ibox-warn">预计到岗 {{ U.arriveText(r.arrive_before) || '—' }}</span></div>
            <div class="row" style="gap:6px">
              
              <span class="badge badge-warn" v-if="r._kind === 'pending'">待填报</span> <span class="badge badge-warn" v-if="r._kind === 'done' && Number(r.self_edit_count) > 0">本人改过</span> <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查课' : '未查课' }}</span>
            </div>
          </div>
          <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-mine' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" style="cursor:pointer" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].count ? (' ' + photoMap[r.id].count) : '' }}{{ photoMap[r.id] && photoMap[r.id].open ? ' 收起' : ' 查看' }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].taken">拍摄 {{ photoMap[r.id].taken }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].created">上传 {{ photoMap[r.id].created }}</span></div>
          <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="photoMap[r.id].loading">加载中…</div><div class="tiny muted mt8" v-else-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
          <div class="row mt8" style="gap:8px">
            <button class="btn btn-sm" @click.stop="openCourse(r)">{{ r._kind === 'done' ? '查看 / 修正' : '查看 / 编辑' }}</button>
            <button class="btn btn-sm btn-danger" @click.stop="deleteCourse(r)">删除</button>
          </div>
        </div>
      </div>
    </div>
    </div>
    <div v-else>
      <div class="alpha-index" ref="alphaBox" @touchstart.prevent="onAlphaMove" @touchmove.prevent="onAlphaMove">
        <span v-for="l in letters" :key="l" class="alpha-item" :class="{ off: !letterMap[l] }" @click="jumpLetter(l)">{{ l }}</span>
      </div>

      <div class="tablewrap mt8 adm-wide-only mem-tb-compact">
        <table class="tb">
          <thead>
            <tr><th style="width:110px">姓名</th><th style="width:140px">学号</th><th class="num" style="width:76px">应查</th><th class="num" style="width:76px">已查</th><th class="num" style="width:76px">未查</th><th class="num" style="width:76px" title="本周有效查课次数：按本人负责班级累计，与统计页、我的页口径一致">有效</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="(m, mi) in tableUsers" :key="m.id">
              <tr class="grp" v-if="newGroup(mi)"><td colspan="7">{{ letterOf(m.name) }}</td></tr>
              <tr class="clickable" :data-letter="letterOf(m.name)" :data-mid="m.id" @click="toggle(m.id)">
                <td class="strong">{{ m.name }}</td>
                <td class="num">{{ m.student_no }}</td>
                <td class="num">{{ m.planned }}</td>
                <td class="num">{{ m.done }}</td>
                <td class="num" :style="pendingCount(m) ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'">{{ pendingCount(m) }}</td>
                <td class="num" :style="validOf(m) ? 'color:var(--pri);font-weight:650' : 'color:var(--muted)'">{{ validOf(m) }}</td>
                <td class="tiny muted">
                  <div class="row" style="gap:8px;align-items:center;justify-content:flex-end">
                    <button class="btn btn-sm" v-if="canLoginAs(m)" @click.stop="loginAs(m)">登录他</button>
                    <button class="btn btn-sm" v-if="canLoginAs(m)" @click.stop="resetSelfEdit(m)">重置次数{{ selfEditedOf(m) ? ' ' + selfEditedOf(m) : '' }}</button>
                    <span class="tiny expand-hint">{{ open === m.id ? '收起 ▲' : '展开 ▼' }}</span>
                  </div>
                </td>
              </tr>
              <tr v-if="open === m.id" class="expand-tr">
                <td colspan="7">
                  <div class="expand-hd">
                    <span class="strong">{{ m.name }} · 本周课程</span>
                    <span class="tiny muted">共 {{ memberCourses(m).length }} 节 · 已查 {{ recordsOf(m).length }} · 未查 {{ pendingCount(m) }} · 有效 {{ validText(m) }}</span>
                  </div>
                  <div class="list" v-if="memberCourses(m).length">
          <div class="litem" v-for="r in memberCourses(m)" :key="r._key" style="cursor:pointer" @click="openCourse(r)">
            <div class="row between">
              <div class="t1">{{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-muted" v-if="r.teacher">{{ r.teacher }}</span><span class="ibox ibox-muted">{{ r.owner_name }}</span><span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span><span class="ibox ibox-warn">预计到岗 {{ U.arriveText(r.arrive_before) || '—' }}</span></div>
              <div class="row" style="gap:6px">
                
                <span class="badge badge-warn" v-if="r._kind === 'pending'">待填报</span> <span class="badge badge-warn" v-if="r._kind === 'done' && Number(r.self_edit_count) > 0">本人改过</span> <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查课' : '未查课' }}</span>
              </div>
            </div>
            <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-mine' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" style="cursor:pointer" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].count ? (' ' + photoMap[r.id].count) : '' }}{{ photoMap[r.id] && photoMap[r.id].open ? ' 收起' : ' 查看' }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].taken">拍摄 {{ photoMap[r.id].taken }}</span><span class="ibox" v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].created">上传 {{ photoMap[r.id].created }}</span></div>
            <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="photoMap[r.id].loading">加载中…</div><div class="tiny muted mt8" v-else-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
            <div class="row mt8" style="gap:8px">
              <button class="btn btn-sm" @click.stop="openCourse(r)">{{ r._kind === 'done' ? '查看 / 修正' : '查看 / 编辑' }}</button>
              <button class="btn btn-sm btn-danger" @click.stop="deleteCourse(r)">删除</button>
            </div>
          </div>
                  </div>
                  <div class="muted sm" v-else>本周没有课程安排</div>
                  <div class="expand-next" v-if="nextPending(m)">
                    <span class="tiny muted">下一位未查</span>
                    <button class="btn btn-sm" @click.stop="toggle(nextPending(m).id)">{{ nextPending(m).name }} ›</button>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!tableUsers.length"><td colspan="7" class="center muted" style="padding:24px">没有匹配的成员</td></tr>
          </tbody>
        </table>
      </div>

      <div class="adm-narrow-only mt8">
        <template v-for="(m, mi) in tableUsers" :key="m.id">
          <div class="mem-group-t" v-if="newGroup(mi)">{{ letterOf(m.name) }}</div>
          <div class="mrow" :data-letter="letterOf(m.name)" :data-mid="m.id" @click="toggle(m.id)">
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
              <span>有效<b :class="m.stats_excluded ? 'tiny' : 'ok'" :style="m.stats_excluded ? 'font-weight:600;color:var(--muted)' : ''">{{ validText(m) }}</b></span>
            </div>
            <div class="tiny mt8 row between" style="align-items:center">
              <button class="btn btn-sm" v-if="canLoginAs(m)" @click.stop="loginAs(m)">登录他</button>
              <button class="btn btn-sm" v-if="canLoginAs(m)" @click.stop="resetSelfEdit(m)">重置次数{{ selfEditedOf(m) ? ' ' + selfEditedOf(m) : '' }}</button>
              <span class="tiny expand-hint" style="margin-left:auto">{{ open === m.id ? '收起 ▲' : '展开课程 ▼' }}</span>
            </div>
          </div>
          <div v-if="open === m.id" class="card mem-expand" style="margin:-6px 0 12px;border-top-left-radius:0;border-top-right-radius:0">
            <div class="row between">
              <span class="strong sm">{{ m.name }} · 本周课程</span>
              <span class="tiny muted">共 {{ memberCourses(m).length }} 节 · 已查 {{ recordsOf(m).length }}</span>
            </div>
            <div class="list mt8" v-if="memberCourses(m).length">
              <div class="litem" v-for="r in memberCourses(m)" :key="'mx' + r._key" style="cursor:pointer" @click="openCourse(r)">
                <div class="row between">
                  <div class="t1">{{ U.periodText(r.period_from, r.period_to) }} · {{ r.course_name }}<span class="ibox ibox-pri" v-if="r.room">教室 {{ r.room }}</span></div>
                  <span class="badge" :class="r._kind === 'done' ? 'badge-ok' : 'badge-bad'">{{ r._kind === 'done' ? '已查' : '未查' }}</span>
                </div>
                <div class="t2"><span v-for="(c, ci) in classParts(r, r.owner_id)" :key="c.code + ci" class="ibox" :class="c.on ? 'ibox-mine' : ''">{{ c.code }}</span><span class="ibox ibox-ok" v-if="r._kind === 'done'">出勤 {{ r.actual_count }}/{{ r.expected_count }}</span><span class="ibox" v-if="r._kind === 'done'" @click.stop="toggleCoursePhotos(r)">图片{{ photoMap[r.id] && photoMap[r.id].count ? (' ' + photoMap[r.id].count) : '' }}{{ photoMap[r.id] && photoMap[r.id].open ? ' 收起' : ' 查看' }}</span></div>
                <div v-if="r._kind === 'done' && photoMap[r.id] && photoMap[r.id].open" class="mt8"><div class="row" style="gap:8px" v-if="photoMap[r.id].list.length"><img v-for="ph in photoMap[r.id].list" :key="ph.id" :src="ph.thumb" class="admin-thumb" @click.stop="openFullPhoto(ph)"></div><div class="tiny muted mt8" v-if="photoMap[r.id].loading">加载中…</div><div class="tiny muted mt8" v-else-if="!photoMap[r.id].list.length">这条记录没有照片</div></div>
                <div class="row mt8" style="gap:8px">
                  <button class="btn btn-sm" @click.stop="openCourse(r)">{{ r._kind === 'done' ? '查看 / 修正' : '查看 / 编辑' }}</button>
                </div>
              </div>
            </div>
            <div class="muted sm mt8" v-else>本周没有课程安排</div>
            <div class="expand-next" v-if="nextPending(m)">
              <span class="tiny muted">下一位未查</span>
              <button class="btn btn-sm" @click.stop="toggle(nextPending(m).id)">{{ nextPending(m).name }} ›</button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <div class="card mt12" v-if="!statusCourses.length">
      <div class="muted sm">{{ emptyText }}</div>
      <div class="row mt8" v-if="filterChips.length"><button class="btn btn-sm" @click="clearFilters">清除筛选，回到待查课程</button></div>
    </div>
    </div>

    <!-- 筛选面板：年级 / 星期 / 成员集中在这里，状态与分组仍留在列表上方 -->
    <div class="mask" v-if="filterOpen" @click.self="closeFilters">
      <div class="sheet sheet-filter">
        <div class="row between filter-hd">
          <h3>筛选</h3>
          <button type="button" class="iconbtn" aria-label="关闭筛选" @click="closeFilters">✕</button>
        </div>

        <div class="filter-sec">
          <div class="label">年级</div>
          <div class="chips">
            <div class="chip" :class="{ on: !fGrade }" @click="fGrade = ''">全部年级</div>
            <div class="chip" v-for="g in GRADES" :key="g" :class="{ on: fGrade === g }" @click="fGrade = fGrade === g ? '' : g">{{ g }}</div>
          </div>
        </div>

        <div class="filter-sec">
          <div class="label">星期<span class="tiny muted f-hint">未查数标在角标上</span></div>
          <div class="chips chips-scroll">
            <div class="chip" :class="{ on: !fDay }" @click="fDay = 0">全部</div>
            <div class="chip" v-for="(d, i) in DAY_LABELS" :key="'fd' + d" :class="{ on: fDay === i + 1 }" @click="fDay = fDay === i + 1 ? 0 : i + 1">{{ d }}<span class="chip-n" v-if="dayCounts[i + 1]">{{ dayCounts[i + 1] }}</span></div>
          </div>
        </div>

        <div class="filter-sec">
          <div class="label">成员<span class="tiny muted f-hint">只看某位成员本周的课</span></div>
          <input class="input" v-model="fMemberQuery" placeholder="搜索姓名或学号" autocomplete="off">
          <div class="member-pick">
            <div class="pick-item" :class="{ on: !fMember }" @click="fMember = 0">全部成员</div>
            <template v-for="g in memberGroups" :key="'g' + g.letter">
              <div class="pick-letter">{{ g.letter }}</div>
              <div class="pick-item" v-for="m in g.rows" :key="'m' + m.id"
                :class="{ on: Number(fMember) === Number(m.id) }"
                @click="fMember = Number(fMember) === Number(m.id) ? 0 : Number(m.id)">
                <span class="pick-name">{{ m.name }}</span>
                <span class="tiny muted">{{ m.student_no }}</span>
                <span class="badge" :class="m.pending ? 'badge-bad' : (m.planned ? 'badge-ok' : '')">{{ m.pending ? '未查 ' + m.pending : (m.planned ? '已完成' : '未选课') }}</span>
              </div>
            </template>
            <div class="tiny muted pick-empty" v-if="!memberGroups.length">没有匹配的成员</div>
          </div>
        </div>

        <div class="filter-foot">
          <button type="button" class="btn" @click="resetDraftFilters">重置</button>
          <button type="button" class="btn btn-primary grow" @click="applyFilters">应用</button>
        </div>
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
    return { U, week: 0, users: [], records: [], assigned: {}, validCounts: {}, photoMap: {}, stats: { plans: 0, done: 0, expected: 0, actual: 0, overdue: 0 }, open: '', loading: true, loaded: false, loadError: false, memberFilter: 0, groupBy: 'date', courseStatus: 'pending', courseDay: 0, courseGrade: '', DAY_LABELS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], mergeBusy: false, photoLoading: false, fullPhoto: null, onlySelfEdited: false,
      // 筛选面板：f* 是面板内的草稿值，点「应用」才写回真正的筛选
      filterOpen: false, fGrade: '', fDay: 0, fMember: 0, fMemberQuery: '',
      GRADES: ['大一', '大二', '大三'] }
  },
  computed: {
    pageTitle() { return '课检' },
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
          const key = U.sessionKey(Object.assign({}, p, { owner_id: u.id }))
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
    // 每天还有几节没查（星期 chip 上的角标）
    dayCounts() {
      const m = {}
      const base = this.gradeCourses || []
      for (let d = 1; d <= 7; d++) {
        m[d] = base.filter((r) => ((U.parse(r.check_date).getUTCDay() + 6) % 7) + 1 === d && r._kind === 'pending').length
      }
      return m
    },
    letters() { return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
    tableUsers() {
      let list = this.users.slice()
      if (this.memberFilter) list = list.filter((u) => Number(u.id) === Number(this.memberFilter))
      return list.sort((a, b) => {
        const la = this.letterOf(a.name), lb = this.letterOf(b.name)
        if (la !== lb) return la < lb ? -1 : 1
        return U.nameCompare(a.name, b.name)
      })
    },
    letterMap() {
      const m = {}
      this.tableUsers.forEach((u) => { const l = this.letterOf(u.name); m[l] = (m[l] || 0) + 1 })
      return m
    },
    // 本周被成员「自行修改过一次」的记录（self_edit_count>0）
    selfEdited() { return (this.records || []).filter((r) => Number(r.self_edit_count) > 0) },
    // 摘要卡与列表共用同一范围：先按成员收窄（成员筛选来自「从记录详情返回」时的还原）
    weekScoped() {
      if (!this.memberFilter) return this.weekCourses
      return this.weekCourses.filter((r) => Number(r.owner_id) === Number(this.memberFilter))
    },
    // 待查课程：当前周（含成员范围）未完成的计划数
    kpiPending() { return this.weekScoped.filter((r) => r._kind === 'pending').length },
    // 未完成成员：本周至少还有一节待查课程的活跃成员。
    // 没有被分配课程的成员 planned=0、pending=0，因此不会被计入，避免 0/0 被误标未完成。
    kpiMembers() {
      const list = this.memberFilter ? (this.users || []).filter((u) => Number(u.id) === Number(this.memberFilter)) : (this.users || [])
      return list.filter((u) => {
        if (u && u.status && u.status !== 'active') return false
        return this.pendingCount(u) > 0
      }).length
    },
    // 需关注记录：成员自行修改过、仍需管理员复核的记录（self_edit_count>0）。
    // 不涉及任何打回/退回数据。
    kpiAttention() {
      return (this.records || []).filter((r) => Number(r.self_edit_count) > 0
        && (!this.memberFilter || Number(r.owner_id) === Number(this.memberFilter))).length
    },
    listTitle() {
      if (this.courseStatus === 'done') return '已完成课程'
      if (this.courseStatus === 'all') return '全部课程'
      return '待查课程'
    },
    // 已应用的筛选条件（状态切换与分组切换各有自己的可见控件，不重复进标签）
    filterChips() {
      const out = []
      if (this.memberFilter) {
        const m = (this.users || []).find((u) => Number(u.id) === Number(this.memberFilter))
        out.push({ k: 'member', t: '成员：' + (m ? m.name : this.memberFilter) })
      }
      if (this.courseGrade) out.push({ k: 'grade', t: '年级：' + this.courseGrade })
      // 默认视图本身就带「今天」的星期筛选，不必当成额外条件提示
      if (this.courseDay && this.courseDay !== this.defaultDay()) out.push({ k: 'day', t: this.DAY_LABELS[this.courseDay - 1] || '' })
      if (this.onlySelfEdited) out.push({ k: 'attention', t: '仅看需关注记录' })
      return out.filter((f) => f.t)
    },
    // 筛选入口上的角标：面板内实际生效的条件个数（默认的「今天」不算，避免常驻红点）
    filterCount() {
      let n = 0
      if (this.courseGrade) n += 1
      if (this.courseDay && this.courseDay !== this.defaultDay()) n += 1
      if (this.memberFilter) n += 1
      if (this.onlySelfEdited) n += 1
      return n
    },
    // 面板里的成员候选：按搜索词过滤，带本周未查数，便于直接挑人
    memberRows() {
      const q = String(this.fMemberQuery || '').trim().toLowerCase()
      return (this.users || [])
        .filter((u) => {
          if (!q) return true
          const name = String(u.name || '').toLowerCase()
          const no = String(u.student_no || '').toLowerCase()
          return name.indexOf(q) >= 0 || no.indexOf(q) >= 0
        })
        .map((u) => ({ id: u.id, name: u.name, student_no: u.student_no, pending: this.pendingCount(u), planned: Number(u.planned) || 0 }))
        .sort((a, b) => {
          const la = this.letterOf(a.name), lb = this.letterOf(b.name)
          if (la !== lb) return la < lb ? -1 : 1
          return U.nameCompare(a.name, b.name)
        })
    },
    // 按拼音首字母分组，长名单里更好扫
    memberGroups() {
      const out = []
      let cur = null
      this.memberRows.forEach((m) => {
        const letter = this.letterOf(m.name)
        if (!cur || cur.letter !== letter) { cur = { letter, rows: [] }; out.push(cur) }
        cur.rows.push(m)
      })
      return out
    },
    gradeCourses() {
      let list = this.weekScoped
      if (this.onlySelfEdited) list = list.filter((r) => Number(r.self_edit_count) > 0)
      if (!this.courseGrade) return list
      return list.filter((r) => this.courseGrades(r).indexOf(this.courseGrade) >= 0)
    },
    dayStats() {
      const s = { done: 0, pending: 0 }
      this.dayCourses.forEach((r) => {
        if (r._kind === 'done') s.done += 1
        else {
          s.pending += 1
        }
      })
      return s
    },
    statusCourses() {
      if (this.courseStatus === 'done') return this.dayCourses.filter((r) => r._kind === 'done')
      if (this.courseStatus === 'pending') return this.dayCourses.filter((r) => r._kind === 'pending')
      return this.dayCourses
    },
    emptyText() {
      const parts = []
      if (this.courseDay) parts.push(this.DAY_LABELS[this.courseDay - 1] || '')
      if (this.courseGrade) parts.push(this.courseGrade)
      const scope = parts.filter(Boolean).join(' · ') || '本周'
      if (this.onlySelfEdited) return scope + '没有需要关注的记录'
      if (this.courseStatus === 'done') return scope + '没有已完成课程'
      if (this.courseStatus === 'pending') return scope + '没有待查课程'
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
  },
  mounted() {
    // 先设默认值，再由 restoreViewState() 覆盖为代登录 / 详情页返回前保存的状态
    this.week = Store.weekNow()
    this.groupBy = 'date'
    // 默认先看待查课程（方案 4.2.4）；全部/已完成仍可一键切换
    this.courseStatus = 'pending'
    this.courseGrade = ''
    this.memberFilter = 0
    const jsDay = new Date().getDay() // 0=周日
    this.courseDay = jsDay === 0 ? 7 : jsDay
    this.restoreViewState()
    this.load().then(() => {
      this.$nextTick(() => {
        const el = document.querySelector('.chips-scroll > .chip.on')
        if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest' })
      })
      if (!this._restoreScroll) return
      const y = this._restoreScroll
      this._restoreScroll = 0
      this.$nextTick(() => { window.scrollTo(0, y) })
    })
  },
  methods: {
    // 拼音分组：当前行与上一行首字母不同即为新的一组（组标题条，与成员管理一致）
    newGroup(i) {
      if (!i) return true
      const list = this.tableUsers
      return this.letterOf(list[i].name) !== this.letterOf(list[i - 1].name)
    },
    // 管理员登录成员账号（仅组员、且账号可用时提供）
    canLoginAs(m) { return !!(m && m.role !== 'admin' && m.status === 'active') },
    async loginAs(m) {
      const ok = window.confirm(`以「${m.name}」的身份登录？\n\n你会看到他的全部页面，可以正常填写和提交。\n提交后的记录会标注「管理员登陆」，方便事后追溯。\n\n点「退出」即可回到管理端。`)
      if (!ok) return
      try {
        // 代登录前先存看板状态（周次/分组/筛选/滚动），退出时原样还原
        this.saveViewState()
        await Store.impersonate(m.id)
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    // 管理员重置成员本周「自行修改一次」的机会（按钮放在「登录他」旁）
    selfEditedOf(m) {
      return (this.records || []).filter((r) => r.owner_id === m.id && Number(r.self_edit_count) > 0).length
    },
    async resetSelfEdit(m) {
      const n = this.selfEditedOf(m)
      if (!n) { U.toast(m.name + ' 本周没有自行修改过的记录', 'bad'); return }
      const ok = window.confirm(`重置「${m.name}」本周 ${n} 条记录的自行修改次数？\n\n重置后这些记录可由本人再修改一次，操作会写入修改留痕。`)
      if (!ok) return
      try {
        const d = await Store.rpc('admin_reset_self_edit', { p_user_id: m.id })
        U.toast('已重置 ' + (Number(d.reset) || 0) + ' 条，可再自行修改一次')
        Store.clearRpcCache()
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    // 手动刷新：清掉读缓存后重新拉取（默认走缓存以减少请求）
    hardRefresh() {
      Store.clearRpcCache()
      this.photoMap = {}
      this.load()
    },
    // ---------- 摘要卡 ⇄ 筛选 ----------
    // 默认视图：本周待查 + 按日期 + 今天（与初次进入一致）
    defaultDay() {
      const jsDay = new Date().getDay() // 0=周日
      return jsDay === 0 ? 7 : jsDay
    },
    clearFilters() {
      this.courseStatus = 'pending'
      this.groupBy = 'date'
      this.courseGrade = ''
      this.courseDay = this.defaultDay()
      this.memberFilter = 0
      this.onlySelfEdited = false
      // 面板内的草稿也一起复位，避免下次打开还停在上次的选择
      this.fGrade = ''
      this.fDay = this.defaultDay()
      this.fMember = 0
      this.fMemberQuery = ''
      this.filterOpen = false
    },
    // 点「待查课程」：已在该视图时再点一次 → 回到默认待查视图
    focusPending() {
      if (this.courseStatus === 'pending' && this.groupBy === 'date' && !this.onlySelfEdited && !this.memberFilter) {
        this.clearFilters()
        return
      }
      this.courseStatus = 'pending'
      this.groupBy = 'date'
      this.onlySelfEdited = false
    },
    // 点「未完成成员」：切到按成员查看（成员表本身已按未查数标注）
    focusMembers() {
      if (this.groupBy === 'member' && !this.onlySelfEdited) {
        this.clearFilters()
        return
      }
      this.groupBy = 'member'
      this.courseStatus = 'pending'
      this.onlySelfEdited = false
      this.courseDay = 0
    },
    // 点「需关注记录」：只看成员自行修改过的记录（含已查/未查，便于逐条复核）
    focusAttention() {
      if (this.onlySelfEdited) {
        this.clearFilters()
        return
      }
      this.onlySelfEdited = true
      this.groupBy = 'date'
      this.courseStatus = 'all'
      this.courseDay = 0
    },
    clearOne(k) {
      if (k === 'member') this.memberFilter = 0
      else if (k === 'grade') this.courseGrade = ''
      else if (k === 'day') this.courseDay = 0
      else if (k === 'attention') this.onlySelfEdited = false
      else if (k === 'group') this.groupBy = 'date'
      else if (k === 'status') this.courseStatus = 'pending'
    },
    // ---------- 筛选面板 ----------
    openFilters() {
      // 打开时把已应用的筛选回填成草稿，取消关闭不会误改列表
      this.fGrade = this.courseGrade
      this.fDay = this.courseDay
      this.fMember = this.memberFilter
      this.fMemberQuery = ''
      this.filterOpen = true
    },
    closeFilters() { this.filterOpen = false },
    applyFilters() {
      this.courseGrade = this.fGrade || ''
      this.courseDay = Number(this.fDay) || 0
      this.memberFilter = Number(this.fMember) || 0
      this.filterOpen = false
    },
    // 重置面板：清掉面板里的选择并立即生效，方便看清「回到不加筛选」的样子；
    // 面板保持打开，需要时再点「应用」关闭。
    resetDraftFilters() {
      this.fGrade = ''
      this.fDay = this.defaultDay()
      this.fMember = 0
      this.fMemberQuery = ''
      this.courseGrade = ''
      this.courseDay = this.defaultDay()
      this.memberFilter = 0
    },
    go(p) {
      if (p.indexOf('/admin/records/') === 0 || p.indexOf('/admin/plans/') === 0 || p === '/admin/trash') this.saveViewState()
      Store.nav(p)
    },
    saveViewState() {
      try {
        sessionStorage.setItem('xfc_admin_view_' + this.mode, JSON.stringify({
          week: this.week,
          scroll: window.scrollY || 0,
          open: this.open || '',
          courseDay: this.courseDay,
          courseStatus: this.courseStatus,
          groupBy: this.groupBy,
          memberFilter: this.memberFilter,
          courseGrade: this.courseGrade,
          onlySelfEdited: this.onlySelfEdited,
        }))
      } catch (e) { /* 隐私模式忽略 */ }
    },
    restoreViewState() {
      try {
        const raw = sessionStorage.getItem('xfc_admin_view_' + this.mode)
        if (!raw) return
        const v = JSON.parse(raw)
        // 周次也要还原：以前只存筛选状态，退出代登录后会被打回当前周
        if (typeof v.week === 'number' && v.week >= 1 && v.week <= this.maxWeek) this.week = v.week
        this.open = v.open || ''
        if (typeof v.courseDay === 'number') this.courseDay = v.courseDay
        if (v.courseStatus) this.courseStatus = v.courseStatus
        if (v.groupBy) this.groupBy = v.groupBy
        if (typeof v.memberFilter === 'number') this.memberFilter = v.memberFilter
        if (typeof v.courseGrade === 'string') this.courseGrade = v.courseGrade
        if (typeof v.onlySelfEdited === 'boolean') this.onlySelfEdited = v.onlySelfEdited
        this._restoreScroll = Number(v.scroll) || 0
        // 一次性消费：避免下次正常进看板被旧状态污染
        sessionStorage.removeItem('xfc_admin_view_' + this.mode)
      } catch (e) { /* 隐私模式忽略 */ }
    },
    shift(d) {
      const w = this.week + d
      if (w < 1 || w > this.maxWeek) return
      this.week = w
      this.open = ''
      this.courseDay = 0
      // 换周必须重新按新周计算：清掉「仅看需关注」和失败态，避免把上周的筛选/错误带进来
      this.onlySelfEdited = false
      this.loadError = false
      this.load()
    },
    // 点整行展开/收起。同一时刻只展开一个（手风琴）——点另一个会自动收起上一个。
    toggle(id) {
      const before = this.rowTop(id)
      this.open = this.open === id ? '' : id
      // 展开/收起会改变上方行的高度，被点的那一行会跟着跳走。
      // 这里补偿滚动位置，让它停在原处：点哪行，哪行就不动。
      if (before == null) return
      this.$nextTick(() => {
        const after = this.rowTop(id)
        if (after == null) return
        const delta = after - before
        if (Math.abs(delta) > 2) window.scrollBy(0, delta)
      })
    },
    // 取某个成员行当前在视口里的纵坐标（桌面表格和手机卡片都打了 data-mid，只取可见的那个）
    rowTop(id) {
      const list = document.querySelectorAll('[data-mid="' + id + '"]')
      for (let i = 0; i < list.length; i++) {
        if (list[i].getClientRects().length) return list[i].getBoundingClientRect().top
      }
      return null
    },
    // 从当前成员往后找下一个「还有未查」的人，走到结尾就绕回开头。
    // 用途：展开区底部的「下一位未查」入口，把「同时对比两个人」变成「顺着往下巡检」。
    nextPending(m) {
      const list = Array.isArray(this.tableUsers) ? this.tableUsers : []
      const i = list.findIndex((x) => x.id === m.id)
      if (i < 0) return null
      for (let k = 1; k < list.length; k++) {
        const x = list[(i + k) % list.length]
        if (x.id !== m.id && this.pendingCount(x) > 0) return x
      }
      return null
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
        const key = U.sessionKey(Object.assign({}, p, { owner_id: m.id }))
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
        Store.clearRpcCache()
        this.go('/admin/plans/' + base.id)
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        this.mergeBusy = false
      }
    },
    recordsOf(m) { return this.records.filter((r) => r.owner_id === m.id) },
    // 本周有效查课次数：week_counts 已按「本人负责班级」逐条命中累计，这里只按人求和
    // T3：被排除的账号（stats_excluded）不参与统计，返回 null 以便界面改显示文案而非 0
    validOf(m) { return (m && m.stats_excluded) ? null : (this.validCounts[String(m.id)] || 0) },
    validText(m) { return (m && m.stats_excluded) ? '大三人员由管理员确认' : String(this.validOf(m)) },
    memberCourses(m) {
      const done = this.recordsOf(m)
        .filter((r) => !this.onlySelfEdited || Number(r.self_edit_count) > 0)
        .map((r) => Object.assign({}, r, { _kind: 'done', _key: 'd' + r.id }))
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
    letterOf(name) { return (typeof pyInitial === 'function' ? pyInitial(name) : '#') || '#' },
    // A-Z 索引：点击/滑动跳到对应字母的成员（表格与移动卡片择可见者）
    jumpLetter(l) {
      const els = document.querySelectorAll('[data-letter="' + l + '"]')
      for (let i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) { els[i].scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
      }
    },
    onAlphaMove(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
      if (!t || !this.$refs.alphaBox) return
      const rect = this.$refs.alphaBox.getBoundingClientRect()
      const ratio = Math.min(0.9999, Math.max(0, (t.clientY - rect.top) / rect.height))
      const l = this.letters[Math.floor(ratio * this.letters.length)]
      if (l && l !== this._lastAlpha) { this._lastAlpha = l; this.jumpLetter(l) }
    },
    openCourse(r) {
      if (r._kind === 'done') this.go('/admin/records/' + r.id)
      else this.editMerged(r)
    },
    deleteCourse(r) {
      if (r._kind === 'done') this.removeRecord(r)
      else this.removePlan(r)
    },
    async removePlan(p) {
      const ids = (p._ids && p._ids.length) ? p._ids : [p.id]
      const more = ids.length > 1 ? `（合并的 ${ids.length} 个选课）` : ''
      if (!window.confirm(`删除 ${p.owner_name || ''} 的「${p.course_name}」${more}？\n\n删除后可从「选课回收站」恢复。`)) return
      try {
        for (const id of ids) await Store.rpc('plan_delete', { p_id: id })
        U.toast('已删除')
        Store.clearRpcCache()
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async loadRecordPhotos() {
      if (!this.records.length || this.photoLoading) return
      this.photoLoading = true
      try {
        // 只取照片 id 与时间（不含缩略图，省流量）；点开某条时才拉图
        const map = await Store.rpcCached('admin_week_photos', { p_week: this.week }, 600000) || {}
        const out = {}
        this.records.forEach((r) => {
          const arr = map[String(r.id)] || []
          const old = this.photoMap[r.id]
          out[r.id] = {
            count: arr.length,
            taken: arr.map((p) => U.dayTime(p.taken_at)).filter(Boolean).join(' / '),
            created: arr.map((p) => U.dayTime(p.created_at)).filter(Boolean).join(' / '),
            open: (old && old.open) || false,
            list: (old && old.list) || [],
            loading: false,
          }
        })
        this.photoMap = out
      } catch (e) { /* 照片不是必需，失败不影响主流程 */ } finally {
        this.photoLoading = false
      }
    },
    async toggleCoursePhotos(r) {
      const cur = this.photoMap[r.id]
      if (cur && cur.open) { cur.open = false; return }
      if (!cur) this.photoMap[r.id] = { count: 0, taken: '', created: '', open: true, list: [], loading: false }
      const box = this.photoMap[r.id]
      box.open = true
      if (box.list && box.list.length) return
      box.loading = true
      try {
        const list = await Store.rpcCached('photo_list', { p_record_id: r.id }, 300000) || []
        const out = []
        for (const p of list) {
          let thumb = p.thumb || ''
          let full = p.data || ''
          if (p.thumb_path || p.storage_path) {
            // 缩略图优先取 thumb_path 的签名 URL（迁移后 thumb 为空）
            const tu = await Store.thumbUrl(p, 600)
            if (tu) thumb = tu
          }
          if (p.storage_path) {
            // 原图在文件存储，取签名 URL 用于放大查看
            const url = await Store.photoUrl(p, 600)
            if (url) { thumb = thumb || url; full = url }
          } else {
            if (p.thumb_path) {
              out.push({ id: p.id, thumb: thumb, data: full, taken_at: p.taken_at, created_at: p.created_at })
              return
            }
            const hit = window.PhotoCache ? await PhotoCache.get(p.id) : null
            if (hit && hit.thumb) {
              thumb = hit.thumb
            } else if (thumb && window.PhotoCache) {
              PhotoCache.put(p.id, { thumb: thumb, data: '', takenAt: p.taken_at || '' })
            }
          }
          out.push({ id: p.id, thumb: thumb, data: full, taken_at: p.taken_at, created_at: p.created_at })
        }
        box.list = out
      } catch (e) {
        U.toast(U.errText(e), 'bad')
      } finally {
        box.loading = false
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
    async removeRecord(r) {
      if (!window.confirm(`彻底删除 ${r.owner_name} 的「${r.course_name} · ${r.class_name}」？\n\n记录、照片、修改留痕完全删除，不可恢复。\n若来自选课计划，该计划也会一并删除。`)) return
      try {
        await Store.rpc('record_delete_hard', { p_id: r.id })
        U.toast('已彻底删除')
        Store.clearRpcCache()
        this.load()
      } catch (e) { U.toast(U.errText(e), 'bad') }
    },
    async load() {
      if (!Store.store.semester) { this.loading = false; this.loaded = true; return }
      this.loading = true
      this.loadError = false
      try {
        // 一次请求拿回本周课检/备注/成员班级（原为多个请求）；同时并行取本周有效查课数
        const [dashRaw, wc] = await Promise.all([
          Store.rpcCached('admin_dashboard', { p_week: this.week }, 180000),
          Store.rpcCached('week_counts', { p_week_from: this.week, p_week_to: this.week }, 60000).catch(() => null),
        ])
        const dash = dashRaw || {}
        const d = dash.week || {}
        const notes = dash.notes || []
        const classes = dash.classes || null
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
        this.records = (d.records || []).filter((r) => !isTestAccount(r))
        // 按成员汇总本周有效查课数（口径与统计页/我的页一致）
        const vc = {}
        ;((wc && wc.rows) || []).forEach((r) => {
          const k = String(r.owner_id)
          vc[k] = (vc[k] || 0) + (Number(r.count) || 0)
        })
        this.validCounts = vc
        this.stats = d.stats || this.stats
        this.loaded = true
        this.loadRecordPhotos()
      } catch (e) {
        // 接口失败不能呈现成「没有待办」：置失败态，列表与摘要卡都不渲染，只给重试入口
        this.loadError = true
        this.users = []
        this.records = []
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
