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

  // ---- 富文本支持（仅导出时懒加载）----
  // 表格库只能写纯文本：样表里「班级号（实到/应到）」是黑+红两段富文本，
  // 库写出来只有一整段黑色，所以导出后要在 zip 层把 G 列改写成 inlineStr 富文本。
  let zipLoading = null
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip)
    if (zipLoading) return zipLoading
    zipLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'vendor/jszip.min.js'
      s.onload = () => resolve(window.JSZip)
      s.onerror = () => reject(new Error('打包组件加载失败，请检查网络后重试'))
      document.head.appendChild(s)
    })
    return zipLoading
  }

  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // 「130026||01（12/12）」→ 黑色班级号 + 红色括号
  function richClassRuns(text) {
    const out = []
    String(text).split('\n').forEach((line, i) => {
      if (i) out.push('<r><rPr><color rgb="FF000000"/></rPr><t xml:space="preserve">\n</t></r>')
      const at = line.indexOf('（')
      if (at > 0) {
        out.push('<r><rPr><color rgb="FF000000"/></rPr><t>' + xmlEsc(line.slice(0, at)) + '</t></r>')
        out.push('<r><rPr><color rgb="FFFF0000"/></rPr><t>' + xmlEsc(line.slice(at)) + '</t></r>')
      } else {
        out.push('<r><rPr><color rgb="FF000000"/></rPr><t>' + xmlEsc(line) + '</t></r>')
      }
    })
    return out.join('')
  }

  async function patchClassColumn(buf, sheetCount) {
    const JSZip = await loadJSZip()
    const zip = await JSZip.loadAsync(buf)
    for (let i = 1; i <= sheetCount; i++) {
      const path = 'xl/worksheets/sheet' + i + '.xml'
      const f = zip.file(path)
      if (!f) continue
      let xml = await f.async('string')
      xml = xml.replace(/<c r="(G\d+)"([^>]*)>([\s\S]*?)<\/c>/g, (m, addr, attrs, inner) => {
        let text = ''
        const v = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        if (v) text = v[1]
        else if (t) text = t[1]
        if (!text || text.indexOf('（') < 0) return m
        const a = attrs.replace(/\s+t="[^"]*"/, '')
        return '<c r="' + addr + '"' + a + ' t="inlineStr"><is>' + richClassRuns(text) + '</is></c>'
      })

      zip.file(path, xml)
    }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }

  function saveBlob(blob, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
  }

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
  // 列宽：逐列对齐学院样表（单位字符宽度，取自《第八周课检.xlsx》）
  const COLW = [5.45, 29.45, 29.18, 35.64, 16, 25.82, 32.82, 8.09, 8.09, 4.73, 8.36, 30.18, 5.09, 26.45, 11.36, 8.09, 31.73, 41.45, 11.36, 12.27, 11.45, 11.45, 11.45, 13.82]

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

  // 课检班级按学校样表格式：前缀||班号（班号两位，如 130026||09）
  function classCodeText(code) {
    const s = String(code || '').trim()
    if (!/^[A-Za-z0-9]{8}$/.test(s)) return s
    return s.slice(0, 6) + '||' + String(Number(s.slice(6)) || 0).padStart(2, '0')
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

  // 台账「旷到详情 / 请假详情」通用：
  //   格式 = 「序号.班级号 姓名」，不再带「班」字（2026-11-07 T1）
  //   请假原因已全系统下线（2026-11-11）：名单只输出班级与姓名，不再追加原因括号。
  function studentList(students) {
    const arr = Array.isArray(students) ? students : []
    const items = arr.filter((s) => s && (s.name || s.cls)).map((s, i) => {
      const who = [String(s.cls || '').trim(), String(s.name || '').trim()].filter(Boolean).join(' ')
      return `${i + 1}.${who}`
    })
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
      studentList(r.absent_students),          // L 旷到详情
      leave,                           // M 请假人数（整数）
      studentList(r.leave_students),          // N 请假详情（仅班级+姓名，不再带原因）
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
    // 文本列：与样表一致（样表这些列全部是文本格式 @），人数/详情等按字符串写入
    const TEXT_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 18, 19, 20, 23]
    const rows = [[NOTES].concat(Array(23).fill('')), HEAD.slice()]
    list.forEach((r) => {
      const row = buildRow(r)
      TEXT_COLS.forEach((c) => {
        if (row[c] !== null && row[c] !== undefined && row[c] !== '') row[c] = String(row[c])
      })
      rows.push(row)
    })
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

    // 注意：样式对象必须逐单元格新建。早期所有单元格共用同一个 base 对象，
    // 给 K 列设 z='0.0%' 时改的是这个共享对象，导致其后 L~X 列全被套成百分比
    //（人数 2 显示 200.0%、评分 9.5 显示 950.0%）。
    const baseFont = Object.assign({ sz: 16 }, FONT)
    const mk = (extra) => Object.assign(
      { font: Object.assign({}, baseFont), alignment: Object.assign({}, WRAP), border: BORDER },
      extra || {}
    )
    const red = mk({ font: Object.assign({}, baseFont, { color: RED }) })
    // 与样表逐列对齐：K 旷到率 0.0%；V/W 评分 0.0_ ；A 组号与 R 学生上课情况为常规；其余文本
    const fmtOf = (c) => (c === 10 ? '0.0%' : (c === 21 || c === 22) ? '0.0_ ' : ((c === 0 || c === 17) ? 'General' : '@'))

    // 样表规则：旷到率最高、评分最低的行，备注标淡黄（不是"有备注就标"）
    const flagRows = {}
    let maxRate = -1
    let minScore = Infinity
    rows.slice(2).forEach((v) => {
      const rate = Number(v[10]) || 0
      if (rate > maxRate) maxRate = rate
      const sc = Number(v[22])
      if (!isNaN(sc) && sc < minScore) minScore = sc
    })
    rows.slice(2).forEach((v, k) => {
      const hitRate = maxRate > 0 && Math.abs((Number(v[10]) || 0) - maxRate) < 1e-9
      const hitScore = isFinite(minScore) && Number(v[22]) === minScore
      if (hitRate || hitScore) flagRows[k + 2] = 1
    })

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

    // 数据行：基础样式 + 问题项标红 + 极值行备注淡黄
    for (let i = 2; i < rows.length; i++) {
      const v = rows[i]
      for (let c = 0; c < 24; c++) {
        const addr = window.XLSX.utils.encode_cell({ r: i, c })
        if (!ws[addr]) continue
        ws[addr].s = mk()
        ws[addr].z = fmtOf(c)
        // 样表：K 旷到率 / L 旷到详情 / M 请假人数 / N 请假详情 / O 玩手机 / P 睡觉 整列红字，
        // J 旷到人数保持黑色。原来按"值>0"判断，导致 K 漏标、J 误标。
        if (c >= 10 && c <= 15) ws[addr].s = red
        if (c === 23 && flagRows[i]) ws[addr].s = mk({ fill: { patternType: 'solid', fgColor: { rgb: 'FFFFF2CC' } } })
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
    // 先由表格库生成裸文件，再把 G 列改写成「班级号黑 + 括号红」的富文本
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    let blob
    try {
      blob = await patchClassColumn(buf, wb.SheetNames.length)
    } catch (e) {
      // 富文本处理失败不能拖垮导出：退回原始文件（保留日志便于排查）
      console.warn('[xls] 富文本改写失败，已回退纯文本：', e && e.message)
      blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    }
    saveBlob(blob, name)
    return { name, count: records.length }
  }

  // ================= 班级查课次数导出（统计页用） =================

  // 查课次数导出：严格按学院样表《标准查课次数单次.xlsx》复刻
  // 规格：单 Sheet「查课次数」+ 单行表头三列（姓名 / 有效次数 / 查课次数）
  //       无边框、无底色、无加粗、全表水平+垂直居中、常规数字格式、无自动筛选、无冻结
  //       列宽 62/82/70 px，表头行高 22px，数据行默认行高
  // 口径：有效次数 = members[].total（按负责班级逐班累计，与统计页/看板同源）
  //       查课次数 = members[].records（记录条数）
  // 排序：非排除成员按有效次数降序（同数按姓名），排除成员（stats_excluded）固定排末尾且数值留空
  async function exportClassStats(opts) {
    const XLSX = await loadXLSX()
    const list = (opts && opts.members) || []
    const semester = (opts && opts.semester) || ''
    const weekLabel = (opts && opts.weekLabel) || '全学期'

    const sorted = list.slice().sort((a, b) => {
      const ea = a.stats_excluded ? 1 : 0
      const eb = b.stats_excluded ? 1 : 0
      if (ea !== eb) return ea - eb
      return (Number(b.total) || 0) - (Number(a.total) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh')
    })

    const rows = [['姓名', '有效次数', '查课次数']]
    sorted.forEach((m) => {
      // 被排除的三名大三成员（stats_excluded）：保留姓名，数值留空（业务方要求不写数据）
      if (m.stats_excluded) { rows.push([m.name || '', null, null]); return }
      rows.push([m.name || '', Number(m.total) || 0, Number(m.records) || 0])
    })

    const ws = XLSX.utils.aoa_to_sheet(rows)
    // 列宽与样表一致（像素）
    ws['!cols'] = [{ wpx: 62 }, { wpx: 82 }, { wpx: 70 }]
    // 表头行高 22px = 16.5pt（样表以此区分表头，不加粗、不填色）
    ws['!rows'] = [{ hpt: 16.5 }]

    const center = { horizontal: 'center', vertical: 'center' }
    const HEAD_FONT = { name: '微软雅黑', sz: 11 }
    const BODY_FONT = { sz: 10 }
    rows.forEach((row, r) => {
      row.forEach((_, c) => {
        const addr = XLSX.utils.encode_cell({ r: r, c: c })
        if (!ws[addr]) return
        ws[addr].s = r === 0
          ? { font: Object.assign({}, HEAD_FONT), alignment: Object.assign({}, center) }
          : { font: Object.assign({}, BODY_FONT), alignment: Object.assign({}, center) }
      })
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '查课次数')

    const d = new Date().toLocaleDateString('sv-SE').replace(/-/g, '')
    const name = `查课次数_${semester}_${weekLabel}_${d}.xlsx`.replace(/[\\/:*?"<>|]/g, '')
    XLSX.writeFile(wb, name)
    return { name, count: list.length }
  }

  window.XLS = { exportLedger, exportClassStats, loadXLSX, gradeOfCode, gradesOf, studentList }
})()
