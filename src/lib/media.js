// 照片存储：上传 / 签名访问
window.Media = {
  async upload(path, blob) {
    const res = await window.cloud.storage.upload(path, blob, { contentType: 'image/jpeg' })
    if (res.error) throw res.error
    return res.data
  },
  async sign(paths) {
    const list = (paths || []).filter(Boolean)
    if (!list.length) return {}
    const res = await window.cloud.storage.createSignedUrls(list, 3600)
    if (res.error) throw res.error
    const map = {}
    ;(res.data || []).forEach((it) => {
      const key = it.path || it.name
      if (key) map[key] = it.signedUrl || ''
    })
    return map
  },
  async remove(paths) {
    const list = (paths || []).filter(Boolean)
    if (!list.length) return
    try { await window.cloud.storage.remove(list) } catch (e) { /* 忽略清理失败 */ }
  },
  newPath(uid, tag) {
    const uid2 = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)
    return `shared/${uid}/checks/${tag}/${uid2}.jpg`
  },
}
