// Excel 台账导出（xlsx-js-style 懒加载：支持字体颜色/底色，避免首屏变重）
(function () {
  let loading = null

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX)
    if (loading) return loading
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'vendor/xlsx.style.min.js'
      s.onload = () => resolve(window.XLSX)
      s.onerror = () => reject(new Error('表格组件加载失败，请检查网络后重试'))
      document.head.appendChild(s)
    })
    return loading
  }

  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  function weekday(dateStr) {
    if (!dateStr) return ''
    const p = dateStr.slice(0, 10).split('-').map(Number)
    return WD[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]
  }

  function fitCols(rows, min) {
    const width = []
    rows.forEach((row) => {
      row.forEach((cell, i) => {
        const text = cell === null || cell === undefined ? '' : String(cell)
        let len = 0
        for (const ch of text) len += ch.charCodeAt(0) > 127 ? 2 : 1
        width[i] = Math.max(width[i] || (min && min[i]) || 6, Math.min(len + 2, 55))
      })
    })
    return width.map((w) => ({ wch: w }))
  }

  function sheetOf(rows) {
    const ws = window.XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = fitCols(rows)
    if (rows.length > 1) ws['!autofilter'] = { ref: `A1:${window.XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}` }
    return ws
  }

  // ================= 台账（三工作表：大一/大二/大三，按课检模板） =================

  const GRADES = ['大一', '大二', '大三']
  const FONT = { name: '宋体' }
  const BORDER = {
    top: { style: 'thin', color: { rgb: 'FF000000' } },
    bottom: { style: 'thin', color: { rgb: 'FF000000' } },
    left: { style: 'thin', color: { rgb: 'FF000000' } },
    right: { style: 'thin', color: { rgb: 'FF000000' } },
  }
  const RED = { rgb: 'FFFF0000' }
  const WRAP = { vertical: 'center', wrapText: true }
  const NOTES = '注意事项：1、样表不得修改， 课检信息录入到下一栏\n         2、注意录入信息的格式，需与样表完全一致！ \n         3、课检班级栏：分子为班级实到人数，分母为该班级的应到人数\n         4、课检课程一般为必修课\n         5、旷到率最高、评分最低在备注中体现，统一标为淡黄色'

  const HEAD = ['组号', '课程名', '课程主要内容及标题', '任课老师', '教室及课检时间', '', '课检班级', '应到人数', '实到人数',
    '旷到人数、比率及详情', '', '', '请假人数及详情', '', '玩手机人数', '睡觉人数', '教师上课情况', '学生上课情况',
    '辅导员', '课检员', '学委是否履职', '老师评分', '学生评分', '备注']

  // 列宽按模板
  const COLW = [5.9, 29.9, 29.6, 36, 16.5, 26.3, 30.6, 7.3, 7.3, 10.5, 10.5, 31.3, 13, 27, 10, 10, 35, 42.5, 12.9, 12.7, 11.9, 11.9, 11.9, 14.3]

  function cnNum(n) {
    const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
    n = Number(n) || 0
    if (n <= 10) return d[n]
    if (n < 20) return '十' + (n % 10 ? d[n % 10] : '')
    return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '')
  }

  function gradeOfCode(code) {
    const c = String(code || '')
    if (c.length >= 6) {
      const y = c.slice(4, 6)
      if (y === '26') return '大一'
      if (y === '25') return '大二'
      if (y === '24') return '大三'
    }
    return ''
  }

  // 年级自动匹配：班级号第 5-6 位（入学年份 26/25/24 → 大一/大二/大三）
  function gradesOf(r) {
    const set = {}
    ;(Array.isArray(r.classes) ? r.classes : []).forEach((c) => {
      const g = gradeOfCode(c && c.code)
      if (g) set[g] = 1
    })
    if (!Object.keys(set).length) {
      const codes = String(r.class_name || '').match(/\d{8}/g) || []
      ;(r.absent_students || []).forEach((s) => { if (s && s.cls) codes.push(s.cls) })
      ;(r.leave_students || []).forEach((s) => { if (s && s.cls) codes.push(s.cls) })
      codes.forEach((code) => {
        const g = gradeOfCode(code)
        if (g) set[g] = 1
      })
    }
    if (!Object.keys(set).length) set['大一'] = 1
    return GRADES.filter((g) => set[g])
  }

  // 课检班级按学校样表格式：前缀||班号（班号去前导零），如 13002609 → 130026||9
  function classCodeText(code) {
    const s = String(code || '').trim()
    if (!/^[A-Za-z0-9]{8}$/.test(s)) return s
    return s.slice(0, 6) + '||' + String(Number(s.slice(6)) || 0)
  }

  function classLines(r) {
    const parts = []
    const cls = Array.isArray(r.classes) ? r.classes : []
    cls.forEach((c) => {
      parts.push(`${classCodeText((c && c.code) || '')}（${(c && Number(c.actual)) || 0}/${(c && Number(c.expected)) || 0}）`)
    })
    const oe = Number(r.other_expected) || 0
    const oa = Number(r.other_actual) || 0
    if (!parts.length) parts.push(`${r.class_name || ''}（${Number(r.actual_count) || 0}/${Number(r.expected_count) || 0}）`)
    parts.push(`其他（${oa}/${oe}）`)
    return parts.join('\n')
  }

  function studentList(students) {
    const arr = Array.isArray(students) ? students : []
    const items = arr.filter((s) => s && (s.name || s.cls)).map((s, i) => `${i + 1}.${s.cls || ''}班${s.name || ''}`)
    return items.length ? items.join('\n') : '无'
  }

  // 学生上课情况：按模板格式自动生成（第三条固定为“无其他情况发生”）
  function studentText(r) {
    const n = (v) => (Number(v) > 0 ? `${Number(v)}人` : '无人')
    return [
      `1、开课10分钟${n(r.phone_10)}玩手机，上课30分钟${n(r.phone_30)}玩手机；`,
      `2、开课10分钟${n(r.sleep_10)}睡觉，上课30分钟${n(r.sleep_30)}睡觉；`,
      '3、无其他情况发生。',
    ].join('\n')
  }

  function timeText(r) {
    const wd = weekday(r.check_date)
    return `第${cnNum(r.week_no)}周${wd}第${r.period_from}-${r.period_to}节`
  }

  function counselorText(r) {
    const cmap = (window.Store && window.Store.store && window.Store.store.counselorMap) || {}
    const t = (window.U && window.U.matchCounselors(cmap, window.U.recordClassHints(r))) || r.counselor || ''
    return String(t).replace(/"/g, '').split('、').filter(Boolean).map((x) => x.trim()).filter(Boolean).join('\n')
  }

  function buildRow(r) {
    const int = (v) => Math.max(0, Math.round(Number(v) || 0))
    const exp = int(r.expected_count)
    const act = int(r.actual_count)
    const absent = int(r.absent_count)
    const leave = int(r.leave_count)
    const ratio = exp > 0 ? absent / exp : ''
    const score = (v) => (v === null || v === undefined || v === '' ? '' : Math.min(10, Math.max(9, Math.round(Number(v) * 10) / 10)))
    return [
      '1',                             // A 组号（默认 1）
      r.course_name || '',             // B 课程名
      r.discipline_note || '',         // C 课程主要内容及标题
      r.teacher || '',                 // D 任课老师
      r.room || '',                    // E 教室
      timeText(r),                     // F 课检时间
      classLines(r),                   // G 课检班级（实到/应到）
      exp,                             // H 应到人数（整数）
      act,                             // I 实到人数（整数）
      absent,                          // J 旷到人数（整数）
      ratio,                           // K 旷到比率
      studentList(r.absent_students),  // L 旷到详情
      leave,                           // M 请假人数（整数）
      studentList(r.leave_students),   // N 请假详情
      int(r.phone_count),              // O 玩手机人数（整数）
      int(r.sleep_count),              // P 睡觉人数（整数）
      r.teacher_status || '',          // Q 教师上课情况
      studentText(r),                  // R 学生上课情况
      counselorText(r),                // S 辅导员（自动匹配）
      r.owner_name || '',              // T 课检员
      '是',                            // U 学委是否履职（默认 是）
      score(r.teacher_score),          // V 老师评分
      score(r.student_score),          // W 学生评分
      r.remark || '',                  // X 备注
    ]
  }

  function ledgerSheet(list) {
    const rows = [[NOTES].concat(Array(23).fill('')), HEAD.slice()]
    list.forEach((r) => rows.push(buildRow(r)))
    const ws = window.XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = COLW.map((w) => ({ wch: w }))
    // 行高按模板：说明行 135、表头 60、数据行 150
    ws['!rows'] = rows.map((_, i) => (i === 0 ? { hpt: 135 } : (i === 1 ? { hpt: 60 } : { hpt: 150 })))
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } },   // A1:Z1 注意事项（同模板）
      { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },    // E2:F2 教室及课检时间
      { s: { r: 1, c: 9 }, e: { r: 1, c: 11 } },   // J2:L2 旷到人数、比率及详情
      { s: { r: 1, c: 12 }, e: { r: 1, c: 13 } },  // M2:N2 请假人数及详情
    ]

    const base = { font: Object.assign({ sz: 16 }, FONT), alignment: WRAP, border: BORDER }
    const red = { font: Object.assign({ sz: 16, color: RED }, FONT), alignment: WRAP, border: BORDER }
    const remark = {
      font: Object.assign({ sz: 16 }, FONT), alignment: WRAP, border: BORDER,
      fill: { patternType: 'solid', fgColor: { rgb: 'FFFFF2CC' } },
    }

    // 第 1 行：注意事项（红色加粗 18）
    ws.A1.s = { font: Object.assign({ sz: 18, bold: true, color: RED }, FONT), alignment: WRAP }

    // 第 2 行：表头（加粗 16，居中）
    for (let c = 0; c < 24; c++) {
      const addr = window.XLSX.utils.encode_cell({ r: 1, c })
      if (ws[addr]) {
        ws[addr].s = {
          font: Object.assign({ sz: 16, bold: true }, FONT),
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: BORDER,
        }
      }
    }

    // 数据行：基础样式 + 问题项标红 + 备注淡黄
    for (let i = 2; i < rows.length; i++) {
      const v = rows[i]
      for (let c = 0; c < 24; c++) {
        const addr = window.XLSX.utils.encode_cell({ r: i, c })
        if (!ws[addr]) continue
        ws[addr].s = base
        if (c === 10 && ws[addr].v !== '' && ws[addr].v !== undefined) ws[addr].z = '0.0%'
        const isRed =
          (c === 9 && Number(v[9]) > 0) ||          // 旷到人数
          (c === 11 && v[11] && v[11] !== '无') ||  // 旷到详情
          (c === 12 && Number(v[12]) > 0) ||        // 请假人数
          (c === 13 && v[13] && v[13] !== '无') ||  // 请假详情
          (c === 14 && Number(v[14]) > 0) ||        // 玩手机人数
          (c === 15 && Number(v[15]) > 0)           // 睡觉人数
        if (isRed) ws[addr].s = red
        if (c === 23 && v[23]) ws[addr].s = remark  // 备注淡黄
      }
    }
    return ws
  }

  async function exportLedger(opts) {
    const XLSX = await loadXLSX()
    const { records, semester, weekFrom, weekTo } = opts
    const sorted = records.slice().sort((a, b) => {
      const da = String(a.check_date || ''), db = String(b.check_date || '')
      if (da !== db) return da < db ? -1 : 1
      const pa = Number(a.period_from) || 0, pb = Number(b.period_from) || 0
      if (pa !== pb) return pa - pb
      return Number(a.id) - Number(b.id)
    })

    const wb = XLSX.utils.book_new()
    GRADES.forEach((g) => {
      const list = sorted.filter((r) => gradesOf(r).indexOf(g) >= 0)
      XLSX.utils.book_append_sheet(wb, ledgerSheet(list), g)
    })

    const d = new Date().toLocaleDateString('sv-SE').replace(/-/g, '')
    const wk = weekFrom === weekTo ? `第${weekFrom}周` : `第${weekFrom}-${weekTo}周`
    const name = `课检台账_${(semester && semester.name) || ''}_${wk}_${d}.xlsx`
      .replace(/[\\/:*?"<>|]/g, '')
    XLSX.writeFile(wb, name)
    return { name, count: records.length }
  }

  // ================= 班级查课次数导出（统计页用） =================

  async function exportClassStats(opts) {
    const XLSX = await loadXLSX()
    const list = (opts && opts.members) || []
    const semester = (opts && opts.semester) || ''
    const weekLabel = (opts && opts.weekLabel) || '全学期'

    const head = ['统计周次', '成员', '学号', '负责年级', '分配班级', '班级年级', '查课次数', '最近查课日期']
    const rows = [head]
    list.forEach((m) => {
      const cls = Array.isArray(m.classes) ? m.classes : []
      if (!cls.length) {
        rows.push([weekLabel, m.name || '', m.student_no || '', m.duty_grade || '', '未分配', '', 0, ''])
        return
      }
      cls.forEach((c) => {
        rows.push([
          weekLabel,
          m.name || '',
          m.student_no || '',
          m.duty_grade || '',
          c.code || '',
          c.grade || '',
          Number(c.count) || 0,
          c.last_date || '',
        ])
      })
    })

    const sumHead = ['统计周次', '成员', '学号', '分配班级数', '已覆盖班级', '未覆盖班级', '查课记录数', '班级次数合计']
    const sumRows = [sumHead]
    list.forEach((m) => {
      const total = Array.isArray(m.classes) ? m.classes.length : 0
      const covered = Number(m.covered) || 0
      sumRows.push([
        weekLabel,
        m.name || '',
        m.student_no || '',
        total,
        covered,
        Math.max(0, total - covered),
        Number(m.records) || 0,
        Number(m.total) || 0,
      ])
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheetOf(rows), '班级查课次数')
    XLSX.utils.book_append_sheet(wb, sheetOf(sumRows), '成员汇总')

    const d = new Date().toLocaleDateString('sv-SE').replace(/-/g, '')
    const name = `班级查课次数_${semester}_${weekLabel}_${d}.xlsx`.replace(/[\\/:*?"<>|]/g, '')
    XLSX.writeFile(wb, name)
    return { name, count: list.length }
  }

  window.XLS = { exportLedger, exportClassStats, loadXLSX, gradeOfCode, gradesOf }
})()
