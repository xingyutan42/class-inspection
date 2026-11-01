// 记录本地缓存（IndexedDB）
// 历史查课记录存一份在本机，查看历史列表时优先本地渲染，不走云端；提交/审批后同步更新。
(function () {
  const DB_NAME = 'qc-record-cache'
  const STORE = 'records'
  const KEEP = 300

  let dbp = null

  function open() {
    if (dbp) return dbp
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
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
      t.onabort = () => reject(t.error || new Error('缓存事务中断'))
    }))
  }

  async function get(id) {
    try { return (await run('readonly', (st) => st.get(Number(id)))) || null }
    catch (e) { return null }
  }

  async function put(id, rec) {
    const key = Number(id)
    if (!key || !rec) return
    try {
      const entry = Object.assign({}, rec, { id: key, cached_at: Date.now() })
      await run('readwrite', (st) => st.put(entry))
      trim()
    } catch (e) { /* 忽略 */ }
  }

  async function putAll(list) {
    if (!Array.isArray(list)) return
    for (const r of list) {
      if (r && r.id) await put(r.id, r)
    }
  }

  async function all() {
    try { return (await run('readonly', (st) => st.getAll())) || [] }
    catch (e) { return [] }
  }

  async function trim() {
    try {
      const total = await run('readonly', (st) => st.count())
      let del = (total || 0) - KEEP
      if (del <= 0) return
      await run('readwrite', (st) => {
        const cur = st.openCursor()
        cur.onsuccess = () => {
          const c = cur.result
          if (!c || del <= 0) return
          del -= 1
          c.delete()
          c.continue()
        }
      })
    } catch (e) { /* 忽略 */ }
  }

  window.RecordCache = { get: get, put: put, putAll: putAll, all: all }
})()
