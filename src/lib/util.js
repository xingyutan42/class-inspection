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

  // 按班级匹配辅导员。map 形如 { '13002601': '张老师' }；codes 可为班级码或自由文本（如请假名单班级）
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
    if (code === '23514') return '数据不符合要求，请检查填写内容'
    if (code === '42501') return '没有权限执行此操作'
    if (code === 'P0001') return e.message || '操作失败'
    if (code === 'network') return '网络不稳定，请稍后重试'
    if (code === 'unauthenticated' || code === 'invalid_grant') return '登录已失效，请重新登录'
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

  window.U = {
    TZ, PERIODS, TODAYS: WD,
    today, parse, iso, addDays, diffDays, weekdayCN, isWeekend,
    mondayOf, weekNo, weekStartOf, md, periodText, arriveText, matchCounselors, recordClassHints, rate, pctNum,
    tagsText, shortTime, nameCompare, classCompare, dayTime, toast, errText,
  }
})()
