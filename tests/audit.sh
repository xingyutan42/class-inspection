#!/usr/bin/env bash
# 上线前自检：语法 + 模板编译 + 事件处理器审计
# 用法: bash tests/audit.sh
set -e
cd "$(dirname "$0")/.."

echo "== 1. 语法检查 =="
fail=0
for f in src/*.js src/lib/*.js src/views/*.js; do
  [ -f "$f" ] || continue
  node --check "$f" 2>/dev/null || { echo "❌ 语法错误: $f"; fail=1; }
done
if [ $fail -ne 0 ]; then echo "❌ 语法检查未通过"; exit 1; fi
echo "✅ 语法全部通过"

echo "== 2. 模板编译 =="
node - <<'EOF'
const fs=require('fs'), vm=require('vm')
const doc={createElement(){ const el={_h:'', set innerHTML(v){this._h=v.replace(/^<div foo="|">$/g,'')}, get textContent(){return this._h}, get innerHTML(){return this._h}}; el.children=[{getAttribute:()=>el._h}]; return el }}
const ctx={console, document:doc, navigator:{userAgent:'node'}}
ctx.globalThis=ctx
vm.createContext(ctx)
vm.runInContext(fs.readFileSync('vendor/vue.global.prod.js','utf8'),ctx)
let n=0,bad=0
for(const f of ['auth','member','fill','leader','leader2','stats']){
  const s=fs.readFileSync('src/views/'+f+'.js','utf8')
  const re=/window\.Views\.(\w+)\s*=\s*\{/g; let m
  while((m=re.exec(s))){
    const i=s.indexOf('template: `',m.index); if(i<0) continue
    const j=i+'template: `'.length; const k=s.indexOf('`',j); if(k<0) continue
    try{ ctx.Vue.compile(s.slice(j,k)); n++ }catch(e){ bad++; console.log('❌',m[1],e.message.slice(0,60)) }
  }
}
console.log('模板', n, '个，失败', bad)
if (bad > 0) process.exit(1)
EOF

echo "== 3. 事件处理器审计 =="
node - <<'EOF'
const fs=require('fs'), re0=/@[\w.]+="([^"]+)"/g
let bad=0
for(const f of ['member','fill','leader','leader2','stats','auth']){
  const src=fs.readFileSync('src/views/'+f+'.js','utf8')
  const re=/window\.Views\.(\w+)\s*=\s*\{/g; let m
  while((m=re.exec(src))){
    const nxt=src.indexOf('window.Views.', m.index + m[0].length)
    const b = src.slice(m.index, nxt > 0 ? nxt : src.length)
    const ti=b.indexOf('template: `'); if(ti<0) continue
    const tpl=b.slice(ti, b.indexOf('`', ti+11))
    const hs=new Set()
    let mm
    while((mm=re0.exec(tpl))){ (mm[1].match(/\b([a-zA-Z_$][\w$]*)\s*\(/g)||[]).forEach(x=>{ const n=x.replace(/\s*\($/,'').trim(); if(!['$event','Number','String','Math','U','Store','Draft'].includes(n)) hs.add(n) }) }
    const defs=new Set()
    let d
    const dre=/(?:^|\n)\s{2,6}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/g
    while((d=dre.exec(b))) defs.add(d[1])
    const missing=[...hs].filter(h=>!defs.has(h)&&!['blur','emit'].includes(h))
    if(missing.length){ console.log('❌', m[1], '缺少:', missing.join(',')); bad+=missing.length }
  }
}
console.log('缺失处理器:', bad)
if (bad > 0) process.exit(1)
EOF

echo "✅ 自检全部通过"
