// 表单草稿（IndexedDB，纯本机，不上云）
// 用途：查课填报 / 选课填写中途被打断时，自动把已填内容存到本机，下次进入可恢复。
// 规则：提交成功后立即清除；保留 7 天；最多 12 份，超出删最早的。
(function () {
  const DB_NAME = 'qc-drafts'
  const STORE = 'drafts'
  const KEEP_DAYS = 7
  const KEEP_MAX = 12

  let dbp = null

  function open() {
    if (dbp) return dbp
    dbp = new Promise((resolve, reject) => {
      let req
      try { req = indexedDB.open(DB_NAME, 1) } catch (e) { reject(e); return }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbp
  }

  function run(mode, handler) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const st = t.objectStore(STORE)
      let out
      try { out = handler(st) } catch (e) { reject(e); return }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error || new Error('草稿事务中断'))
    }))
  }

  // key 规则：u{用户id}:p{计划id}（计划内） 或 u{用户id}:e{日期|节次|课程}（计划外）
  function keyOf(userId, planId, extra) {
    const u = 'u' + (Number(userId) || 0)
    if (planId) return u + ':p' + Number(planId)
    return u + ':e' + String(extra || '')
  }

  async function save(key, data) {
    if (!key) return false
    try {
      await run('readwrite', (st) => st.put(Object.assign({}, data, { key: key, savedAt: Date.now() })))
      cleanup()
      return true
    } catch (e) {
      return false
    }
  }

  async function get(key) {
    if (!key) return null
    try {
      const r = await run('readonly', (st) => st.get(key))
      return r || null
    } catch (e) { return null }
  }

  async function del(key) {
    if (!key) return
    try { await run('readwrite', (st) => st.delete(key)) } catch (e) { /* 忽略 */ }
  }

  async function all() {
    try { return (await run('readonly', (st) => st.getAll())) || [] } catch (e) { return [] }
  }

  // 清理：超期 + 超量
  async function cleanup() {
    try {
      const list = await all()
      const now = Date.now()
      const expired = list.filter((d) => now - (Number(d.savedAt) || 0) > KEEP_DAYS * 86400000)
      for (const d of expired) await del(d.key)
      const rest = list.filter((d) => expired.indexOf(d) < 0)
      if (rest.length >= KEEP_MAX) {
        rest.sort((a, b) => (Number(a.savedAt) || 0) - (Number(b.savedAt) || 0))
        for (const d of rest.slice(0, rest.length - KEEP_MAX + 1)) await del(d.key)
      }
    } catch (e) { /* 清理失败不影响主流程 */ }
  }

  window.Draft = { keyOf, save, get, del, all, cleanup }
})()
