// 照片压缩：长边限制 + 质量控制，避免手机原图直传失败
(function () {
  async function decode(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch (e) { /* 回退 */ }
    }
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('照片读取失败'))
      img.src = URL.createObjectURL(file)
    })
  }

  function draw(src, edge) {
    const w0 = src.width || src.naturalWidth
    const h0 = src.height || src.naturalHeight
    const scale = Math.min(1, edge / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(src, 0, 0, w, h)
    return { canvas, w, h }
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  }

  /**
   * @returns {Promise<{blob: Blob, preview: string, width: number, height: number, kb: number}>}
   */
  async function compress(file, opts) {
    const maxKB = (opts && opts.maxKB) || 400
    let edge = (opts && opts.maxEdge) || 1600
    let quality = 0.78

    const src = await decode(file)
    let out = draw(src, edge)
    let blob = await toBlob(out.canvas, quality)

    let guard = 0
    while (blob && blob.size > maxKB * 1024 && guard < 6) {
      guard += 1
      if (quality > 0.55) {
        quality -= 0.1
      } else {
        edge = Math.round(edge * 0.8)
        out = draw(src, edge)
      }
      blob = await toBlob(out.canvas, quality)
    }
    if (src.close) src.close()
    if (!blob) throw new Error('照片处理失败，请重新选择')
    if (blob.size > maxKB * 1024 * 2.2) throw new Error('这张照片太大，请换一张或先裁切')

    return {
      blob,
      preview: URL.createObjectURL(blob),
      width: out.w,
      height: out.h,
      kb: Math.round(blob.size / 1024),
    }
  }

  window.IMG = { compress }
})()
