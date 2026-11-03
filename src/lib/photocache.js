// 照片本地缓存（IndexedDB）
// 上传照片时和看过原图后都留一份在本机，看历史记录照片时优先读缓存，不走云端流量。
(function () {
  const DB_NAME = 'qc-photo-cache'
  const STORE = 'photos'
  const KEEP = 500 // 最多保留 500 张（超出后删除最早的）

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
    try {
      const r = await run('readonly', (st) => st.get(Number(id)))
      return r || null
    } catch (e) { return null }
  }

  async function put(id, entry) {
    const key = Number(id)
    if (!key) return
    try {
      await run('readwrite', (st) => st.put({
        id: key,
        thumb: (entry && entry.thumb) || '',
        data: (entry && entry.data) || '',
        takenAt: (entry && entry.takenAt) || '',
        at: Date.now(),
      }))
      trim()
    } catch (e) { /* 缓存失败不影响主流程 */ }
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

  window.PhotoCache = { get: get, put: put }
})()
