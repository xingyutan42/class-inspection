// 通用工具：日期 / 周次 / 节次 / 提示
(function () {
  const TZ = 'Asia/Shanghai'
  const WD = ['日', '一', '二', '三', '四', '五', '六']
  const PERIODS = [
    [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12],
  ]

  function today() {
    // 统一按 Asia/Shanghai 取本地日期，避免晚上被算成前一天
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
  }

  function parse(s) {
    const p = String(s).slice(0, 10).split('-').map(Number)
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]))
  }

  function iso(d) {
    return d.toISOString().slice(0, 10)
  }

  function addDays(s, n) {
    const d = parse(s)
    d.setUTCDate(d.getUTCDate() + n)
    return iso(d)
  }

  function diffDays(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000)
  }

  function weekdayCN(s) {
    return '周' + WD[parse(s).getUTCDay()]
  }

  function isWeekend(s) {
    const d = parse(s).getUTCDay()
    return d === 0 || d === 6
  }

  function mondayOf(s) {
    const d = parse(s)
    const off = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - off)
    return iso(d)
  }

  function weekNo(startMonday, date) {
    return Math.floor(diffDays(startMonday, date) / 7) + 1
  }

  function weekStartOf(startMonday, no) {
    return addDays(startMonday, (no - 1) * 7)
  }

  function md(s) {
    return s ? s.slice(5, 10).replace('-', '/') : ''
  }

  function periodText(f, t) {
    if (!f) return '—'
    return f === t ? `第${f}节` : `第${f}-${t}节`
  }

  // 预计到岗：p1 第一节课前，p2 第二节课前
  function arriveText(v) {
    if (v === 'p1') return '第一节课前'
    if (v === 'p2') return '第二节课前'
    return ''
  }

  // 按班级匹配辅导员。map 形如 { '13002601': '黎亮' }；codes 可为班级码或自由文本（如请假名单班级）
  function matchCounselors(map, codes) {
    const out = []
    const seen = {}
    const add = (n) => { const c = String(n || '').replace(/"/g, '').trim(); if (c && !seen[c]) { seen[c] = 1; out.push(c) } }
    const m = map || {}
    const list = Array.isArray(codes) ? codes : []
    for (const raw of list) {
      const s = String(raw || '').trim()
      if (!s) continue
      if (m[s]) { m[s].split('、').forEach(add); continue }
      for (const code in m) {
        if (s.indexOf(code) >= 0) m[code].split('、').forEach(add)
      }
    }
    return out.join('、')
  }

  // 从一条查课记录中提取所有应匹配辅导员的班级线索
  function recordClassHints(r) {
    const hints = []
    if (Array.isArray(r.classes)) r.classes.forEach((c) => hints.push(c.code))
    String(r.class_name || '').split(/[、,，+\s]+/).forEach((x) => { if (x && x !== '其他') hints.push(x) })
    ;(Array.isArray(r.absent_students) ? r.absent_students : []).forEach((s) => hints.push(s.cls))
    ;(Array.isArray(r.leave_students) ? r.leave_students : []).forEach((s) => hints.push(s.cls))
    return hints
  }

  function rate(actual, expected) {
    if (!expected) return ''
    return ((actual / expected) * 100).toFixed(1) + '%'
  }

  function pctNum(actual, expected) {
    if (!expected) return null
    return Math.round((actual / expected) * 1000) / 10
  }

  function tagsText(tags) {
    return Array.isArray(tags) ? tags.join('、') : ''
  }

  // 姓名按拼音首字母排序（zh-Hans 中文排序规则，未收录字退化为 localeCompare）
  const _collator = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator('zh-Hans-CN') : null
  function nameCompare(a, b) {
    const sa = String(a || ''), sb = String(b || '')
    if (_collator) return _collator.compare(sa, sb)
    return sa.localeCompare(sb)
  }

  // 完整日期时间，精确到分钟（如 2026-11-03 21:20）
  function shortTime(ts) {
    if (!ts) return ''
    const d = new Date(ts).toLocaleString('sv-SE', { timeZone: TZ })
    return d.slice(0, 16)
  }

  function dayTime(ts) {
    if (!ts) return ''
    const d = new Date(ts).toLocaleString('sv-SE', { timeZone: TZ })
    return d.slice(5, 16)
  }

  // 轻提示
  let toastTimer = null
  function toast(msg, type) {
    let el = document.getElementById('toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'toast'
      document.body.appendChild(el)
    }
    el.className = 'toast show' + (type ? ' ' + type : '')
    el.textContent = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { el.className = 'toast' }, 2400)
  }

  function errText(e) {
    if (!e) return '操作失败，请重试'
    const code = e.code || e.kind
    const msg = String(e.message || e.error_description || '')
    if (/permission denied/i.test(msg)) return '没有权限执行此操作'
    if (/row-level security|violates row-level/i.test(msg)) return '这条数据不属于你，或已被锁定'
    if (/登录已失效/.test(msg)) return '登录已失效，请重新登录'
    if (/JWT|access token|refresh token|Bearer|unauthori[sz]ed|not signed in/i.test(msg)) return '登录已失效，请重新登录'
    if (/Could not find the function/i.test(msg)) return '接口暂时不可用，请刷新页面后重试'
    if (code === '23505') return '这条记录已经存在了'
    if (code === '23502') return '保存失败：必填项缺失或编号没生成，请联系管理员'
    if (code === '23503') return '关联的数据不存在，请刷新后重试'
    if (code === '42P01') return '数据表缺失，请刷新后重试'
    if (code === '23514') return '数据不符合要求，请检查填写内容'
    if (code === '42501') return '没有权限执行此操作'
    if (code === 'P0001') return e.message || '操作失败'
    if (code === 'network') return '网络不稳定，请稍后重试'
    if (code === 'unauthenticated' || code === 'invalid_grant') return '登录已失效，请重新登录'
    // 网络与服务类：把技术错误翻译成人话
    if (/Failed to fetch|NetworkError|Load failed|ERR_NETWORK|net::ERR/i.test(msg)) return '网络连接不上，请检查网络后重试'
    if (/timeout|timed out|ETIMEDOUT|AbortError|aborted/i.test(msg)) return '请求超时了，请稍后重试'
    if (/Unexpected token|is not valid JSON|JSON at position|Unexpected end of JSON/i.test(msg)) return '服务返回异常，请刷新页面重试'
    if (/status of 429|too many requests|rate limit/i.test(msg)) return '操作太频繁，请稍等一会儿再试'
    if (/status of 50\d|HTTP 50\d|500 Internal|502 Bad|503 Service|504 Gateway/i.test(msg)) return '服务暂时不可用，请稍后再试'
    if (/status of 401|HTTP 401/i.test(msg)) return '登录已过期，请重新登录'
    if (/status of 403|HTTP 403/i.test(msg)) return '没有权限执行此操作'
    if (/status of 4\d\d|HTTP 4\d\d/i.test(msg)) return '提交失败，请检查填写内容后重试'
    // 兜底：纯英文的技术信息不给用户看
    if (msg && !/[\u4e00-\u9fa5]/.test(msg)) return '操作失败，请重试'
    return msg || '操作失败，请重试'
  }

  // 班级号排序：按第 7、8 位（班号尾数）升序，相同再按完整班级号
  function classCompare(a, b) {
    const sa = String(a || ''), sb = String(b || '')
    const ka = Number(sa.slice(6, 8)) || 0
    const kb = Number(sb.slice(6, 8)) || 0
    if (ka !== kb) return ka - kb
    return sa.localeCompare(sb)
  }

  // 同年级判定（T2）：8 位班级号的第 5-6 位是年级段，如 04012401 → "24"。
  // 与 excel.gradeOfCode()、class_stats_week 的 substr(code,5,2) 同一口径；
  // 只比第 6 位会在跨十年时误判（2024 级与 2034 级第 6 位都是 4）。
  function gradeKeyOf(code) {
    const c = String(code || '').trim()
    return c.length === 8 ? c.slice(4, 6) : ''
  }
  // 返回出现的年级段列表（去重、保序）；长度 > 1 即「年级不同」
  function gradeKeysOf(codes) {
    const seen = []
    ;(codes || []).forEach((c) => {
      const k = gradeKeyOf(c)
      if (k && seen.indexOf(k) < 0) seen.push(k)
    })
    return seen
  }
  // 从任意文本里抽出所有 8 位数字班级号（计划外查课可填多个，顿号/空格分隔）
  function codesInText(text) {
    return String(text || '').match(/\d{8}/g) || []
  }

  // ---------- 3.7 同一节课身份判定 ----------
  // 口径见 docs/PRD-3.7-上课记录判定增加老师与班级维度.md
  // L0 plan_id 强关联 > L1 成员+日期+起止节次+课程名 > L2 任课老师 > L3 班级集合
  function normCourse(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()
  }
  // 老师：折叠空白、英文小写；多人授课切分后排序组成集合，不做别名归约
  function normTeacher(v) {
    const s = String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (!s) return ''
    return s.split(/[、,，/;；+]+/).map((x) => x.trim()).filter(Boolean).sort().join('|')
  }
  // 班级：classes[].code 优先（8 位数字），为空时回退解析 class_name；「其他」不参与身份
  function normClasses(obj) {
    const o = obj || {}, out = []
    const arr = Array.isArray(o.classes) ? o.classes : null
    if (arr && arr.length) {
      arr.forEach((c) => {
        const code = String((c && c.code) || '').trim()
        if (/^\d{8}$/.test(code) && out.indexOf(code) < 0) out.push(code)
      })
    }
    if (!out.length) codesInText(o.class_name).forEach((c) => {
      if (out.indexOf(c) < 0) out.push(c)
    })
    return out.sort()
  }
  function sessionParts(obj) {
    const o = obj || {}
    const teacher = normTeacher(o.teacher), classes = normClasses(o)
    return {
      base: [o.owner_id == null ? '' : String(o.owner_id), String(o.check_date || ''),
        String(o.period_from || ''), String(o.period_to || ''), normCourse(o.course_name)].join('|'),
      teacher: teacher,
      classes: classes,
      incomplete: !teacher || !classes.length,
    }
  }
  // 分组键：完整身份键（老师与班级都参与），供合并/去重/草稿定位使用
  function sessionKey(obj) {
    const p = sessionParts(obj)
    return [p.base, p.teacher, p.classes.join(',')].join('|')
  }
  // 分层比较：返回 { same, level, overlap, incomplete }
  // 信息不全（老师或班级缺失）时退回 L1，不因空值把同一节课拆开
  function sessionCompare(a, b) {
    const pa = sessionParts(a), pb = sessionParts(b)
    const aid = String((a || {}).plan_id == null ? '' : (a || {}).plan_id)
    const bid = String((b || {}).plan_id == null ? '' : (b || {}).plan_id)
    if (aid && aid === bid) return { same: true, level: 'l0', overlap: false, incomplete: false }
    if (pa.base !== pb.base) return { same: false, level: 'l1', overlap: false, incomplete: false }
    if (pa.teacher && pb.teacher && pa.teacher !== pb.teacher)
      return { same: false, level: 'l2', overlap: false, incomplete: false }
    const ca = pa.classes, cb = pb.classes
    if (ca.length && cb.length && ca.join(',') !== cb.join(',')) {
      const overlap = ca.some((c) => cb.indexOf(c) >= 0)
      return { same: false, level: 'l3', overlap: overlap, incomplete: false }
    }
    return { same: true, level: 'l1', overlap: false,
      incomplete: pa.incomplete || pb.incomplete }
  }
  // 软提示文案（不阻断提交）
  function sessionHint(a, b) {
    const c = sessionCompare(a, b)
    if (c.same) return ''
    if (c.level === 'l2') return '同节次已有同名课程，任课老师不同，已按两节课处理'
    if (c.level === 'l3') return c.overlap
      ? '与已有课程的班级有重叠，请确认是否重复查课'
      : '同节次已有同名课程，班级不同，已按两节课处理'
    return ''
  }

  window.U = {
    TZ, PERIODS, TODAYS: WD,
    gradeKeyOf, gradeKeysOf, codesInText,
    normCourse, normTeacher, normClasses, sessionParts, sessionKey, sessionCompare, sessionHint,
    today, parse, iso, addDays, diffDays, weekdayCN, isWeekend,
    mondayOf, weekNo, weekStartOf, md, periodText, arriveText, matchCounselors, recordClassHints, rate, pctNum,
    tagsText, shortTime, nameCompare, classCompare, dayTime, toast, errText,
  }
})()
