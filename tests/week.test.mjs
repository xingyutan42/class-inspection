import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import vm from 'node:vm'

const code = fs.readFileSync(new URL('../src/lib/util.js', import.meta.url), 'utf8')
const sandbox = {
  window: {},
  document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
  setTimeout, clearTimeout, console, Date, Math,
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)
const U = sandbox.window.U

test('第 1 周的第一天与最后一天都算第 1 周', () => {
  assert.equal(U.weekNo('2026-08-31', '2026-08-31'), 1) // 周一
  assert.equal(U.weekNo('2026-08-31', '2026-09-06'), 1) // 周日
})

test('跨周正好是第 2 周', () => {
  assert.equal(U.weekNo('2026-08-31', '2026-09-07'), 2)
})

test('跨年不串周', () => {
  assert.equal(U.weekNo('2026-12-28', '2026-12-31'), 1)
  assert.equal(U.weekNo('2026-12-28', '2027-01-04'), 2)
})

test('闰年 2 月 29 日不跳周', () => {
  assert.equal(U.weekNo('2028-02-28', '2028-02-29'), 1)
  assert.equal(U.weekNo('2028-02-28', '2028-03-06'), 2)
})

test('日期加减跨月跨年', () => {
  assert.equal(U.addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(U.addDays('2026-03-01', -1), '2026-02-28')
})

test('周一计算', () => {
  assert.equal(U.mondayOf('2026-10-30'), '2026-10-26') // 周五
  assert.equal(U.mondayOf('2026-10-26'), '2026-10-26') // 周一
  assert.equal(U.mondayOf('2026-11-01'), '2026-10-26') // 周日
})

test('星期中文', () => {
  assert.equal(U.weekdayCN('2026-10-30'), '周五')
  assert.equal(U.weekdayCN('2026-11-01'), '周日')
})

test('节次与出勤率展示', () => {
  assert.equal(U.periodText(3, 4), '第3-4节')
  assert.equal(U.periodText(3, 3), '第3节')
  assert.equal(U.rate(28, 30), '93.3%')
  assert.equal(U.rate(28, 0), '')
})

test('周末判定', () => {
  assert.equal(U.isWeekend('2026-10-31'), true) // 周六
  assert.equal(U.isWeekend('2026-11-01'), true) // 周日
  assert.equal(U.isWeekend('2026-10-30'), false) // 周五
})
