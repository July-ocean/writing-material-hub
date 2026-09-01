// 预约页行为断言测试：node + vm 注入 DOM 桩，跑 docs/booking/index.html 的内联脚本
// 用法：node tools/test-booking.js   （在 writing-material-hub 目录下）
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "docs", "booking", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: 找不到内联脚本"); process.exit(1); }
const code = m[1];

/* ---------- DOM 桩 ---------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    onclick: null,
    _innerHTML: "",
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      let found = null;
      (function walk(node) {
        for (const c of node.children) {
          if (found) return;
          if (String(c.className || "").split(/\s+/).includes(cls)) { found = c; return; }
          walk(c);
        }
      })(el);
      return found || makeEl("div");
    },
    focus() {},
    select() {},
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = String(v); if (v === "") el.children = []; },
  });
  return el;
}

const byId = {};
const documentStub = {
  hidden: false,
  body: makeEl("body"),
  getElementById(id) { if (!byId[id]) byId[id] = makeEl("div"); return byId[id]; },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
  execCommand() { return true; },
};

const storage = {};
const localStorageStub = {
  getItem(k) { return k in storage ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; },
};

const sandbox = {
  console,
  document: documentStub,
  location: { search: "?demo=1", origin: "http://localhost", pathname: "/booking/", href: "http://localhost/booking/?demo=1" },
  navigator: {},
  localStorage: localStorageStub,
  window: {
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    innerWidth: 1200,
  },
  setTimeout(fn) { fn(); return 0; },   // 同步执行，否则 Promise 永远 pending
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  fetch() { throw new Error("测试里不应发起真实 fetch"); },
  URLSearchParams,
  Promise,
  Date,
  Math,
  JSON,
  RegExp,
  Array,
  Object,
  String,
  Number,
  parseInt,
  parseFloat,
  isNaN,
};
sandbox.window.matchMedia = sandbox.window.matchMedia.bind(sandbox.window);
vm.createContext(sandbox);

/* ---------- 断言工具 ---------- */
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name); }
}
function eq(a, b, name) { ok(a === b, name + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）"); }

function ymdLocal(d) {
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

(async function main() {
  // 1) 语法检查
  new vm.Script(code, { filename: "booking-inline.js" });
  console.log("语法检查通过");

  // 2) 在 demo 模式运行整段脚本（含 boot）
  vm.runInContext(code, sandbox, { filename: "booking-inline.js" });
  await new Promise((r) => setImmediate(r));

  const ctx = sandbox;
  ok(ctx.DEMO === true, "DEMO 模式已开启");
  ok(ctx.session && ctx.session.username === "liming", "演示账号已自动登录");
  ok(ctx.dbReady === true, "dbReady = true");

  // 找 N 个「当前周、prep、空闲、未来」的时段
  function freeFutureSlots(n, device) {
    const out = [];
    const ws = ctx.weekStart;
    for (let off = 0; off < 7 && out.length < n; off++) {
      const day = ymdLocal(new Date(ws.getTime() + off * 86400000));
      for (let h = 8; h <= 21 && out.length < n; h++) {
        const id = day + "#" + (h < 10 ? "0" + h : h) + "#" + device;
        if (ctx.demoData[id]) continue;
        const end = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
        end.setHours(h + 1, 0, 0, 0);
        if (end.getTime() <= Date.now()) continue;
        out.push({ day, hour: h, id });
      }
    }
    return out;
  }

  /* ---------- demoRpc book_slots 语义 ---------- */
  console.log("\n[demoRpc book_slots]");
  const slots3 = freeFutureSlots(3, "prep");
  ok(slots3.length === 3, "找到 3 个空闲未来时段用于测试");

  let r = await ctx.demoRpc("book_slots", { p_session: "bad-token", p_device: "prep", p_hours: [], p_note: "", p_aqueous: "" });
  eq(r.code, "NO_AUTH", "坏 token → NO_AUTH");

  r = await ctx.demoRpc("book_slots", { p_session: ctx.session.token, p_device: "hplc", p_hours: [{ day: slots3[0].day, hour: slots3[0].hour }], p_note: "", p_aqueous: "" });
  eq(r.code, "BAD_DEVICE", "非法设备 → BAD_DEVICE");

  r = await ctx.demoRpc("book_slots", { p_session: ctx.session.token, p_device: "prep", p_hours: [], p_note: "", p_aqueous: "" });
  eq(r.code, "EMPTY", "空数组 → EMPTY");

  r = await ctx.demoRpc("book_slots", { p_session: ctx.session.token, p_device: "prep", p_hours: new Array(9).fill({ day: slots3[0].day, hour: slots3[0].hour }), p_note: "", p_aqueous: "" });
  eq(r.code, "TOO_MANY", "9 段 → TOO_MANY");

  // 冲突混合：过期 + 时段无效 + 正常
  const yesterday = ymdLocal(new Date(Date.now() - 86400000));
  r = await ctx.demoRpc("book_slots", {
    p_session: ctx.session.token, p_device: "prep",
    p_hours: [
      { day: yesterday, hour: 10 },
      { day: slots3[0].day, hour: 7 },
      { day: slots3[0].day, hour: slots3[0].hour },
    ],
    p_note: "", p_aqueous: "",
  });
  eq(r.code, "CONFLICT", "过期+无效时段 → CONFLICT");
  eq(r.list.length, 2, "冲突清单 2 条");
  ok(/已过期/.test(r.list[0]), "冲突文案含「已过期」");
  ok(/时段无效/.test(r.list[1]), "冲突文案含「时段无效」");
  ok(!ctx.demoData[slots3[0].id], "CONFLICT 时正常时段也不写入（原子性）");

  // 全成功
  r = await ctx.demoRpc("book_slots", {
    p_session: ctx.session.token, p_device: "prep",
    p_hours: slots3.map((s) => ({ day: s.day, hour: s.hour })),
    p_note: "连续测试", p_aqueous: "0.1%甲酸",
  });
  eq(r.code, "OK", "3 段全空闲 → OK");
  eq(r.count, 3, "count = 3");
  ok(slots3.every((s) => ctx.demoData[s.id] && ctx.demoData[s.id].user_id === "u-1"), "3 段全部写入且归属本人");
  eq(ctx.demoData[slots3[0].id].aqueous, "0.1%甲酸", "水相已写入");

  // 重复约 → CONFLICT 已被约
  r = await ctx.demoRpc("book_slots", {
    p_session: ctx.session.token, p_device: "prep",
    p_hours: [{ day: slots3[0].day, hour: slots3[0].hour }],
    p_note: "", p_aqueous: "",
  });
  eq(r.code, "CONFLICT", "重复预约 → CONFLICT");
  ok(/已被约/.test(r.list[0]), "冲突文案含「已被约」");

  // 另一台设备同一时段不受干扰
  r = await ctx.demoRpc("book_slots", {
    p_session: ctx.session.token, p_device: "semi",
    p_hours: [{ day: slots3[0].day, hour: slots3[0].hour }],
    p_note: "", p_aqueous: "",
  });
  eq(r.code, "OK", "同时段另一台设备仍可约（设备隔离）");

  /* ---------- 多选交互 ---------- */
  console.log("\n[多选交互 onCellClick / renderSelBar]");
  const pick = freeFutureSlots(10, "prep");
  ok(pick.length >= 9, "找到至少 9 个空闲未来时段做上限测试");

  const toastEl = documentStub.getElementById("toast");
  const selNumEl = documentStub.getElementById("selNum");
  const selBarEl = documentStub.getElementById("selBar");

  ctx.onCellClick(pick[0].day, pick[0].hour);
  eq(Object.keys(ctx.selected).length, 1, "点空格 → 选中 1 段");
  eq(selNumEl.textContent, 1, "底部计数 = 1");
  ok(/on/.test(selBarEl.className), "底部确认条出现");

  ctx.onCellClick(pick[0].day, pick[0].hour);
  eq(Object.keys(ctx.selected).length, 0, "再点一次 → 取消选中");
  ok(!/on/.test(selBarEl.className.trim()), "清空后确认条隐藏");

  for (let i = 0; i < 8; i++) ctx.onCellClick(pick[i].day, pick[i].hour);
  eq(Object.keys(ctx.selected).length, 8, "连点 8 段 → 选中 8 段");
  ctx.onCellClick(pick[8].day, pick[8].hour);
  eq(Object.keys(ctx.selected).length, 8, "第 9 段被拒绝（上限 8）");
  ok(/最多/.test(toastEl.textContent), "上限提示 toast");

  // 已约/过去时段点不动
  ctx.onCellClick(slots3[0].day, slots3[0].hour); // 刚被自己约走
  eq(Object.keys(ctx.selected).length, 8, "点已约格子不进入选中");
  ctx.onCellClick(yesterday, 10);
  ok(/不能预约|已开始/.test(toastEl.textContent), "点过去时段有提示");

  // render 清理：手动塞一条别人的预约覆盖一个选中格
  const victim = Object.keys(ctx.selected)[0];
  ctx.bookings[victim] = { name: "别人", note: "", aqueous: "", user_id: "u-9" };
  ctx.render();
  ok(!ctx.selected[victim], "render 自动清掉被抢的选中");
  eq(Object.keys(ctx.selected).length, 7, "剩余 7 段");
  delete ctx.bookings[victim];

  // 翻周清空选中
  documentStub.getElementById("prevWeek").onclick();
  eq(Object.keys(ctx.selected).length, 0, "翻上一周 → 选中清空");
  documentStub.getElementById("thisWeek").onclick();

  // 切设备清空选中
  ctx.onCellClick(pick[1].day, pick[1].hour);
  eq(Object.keys(ctx.selected).length, 1, "重新选 1 段");
  const devTabs = documentStub.getElementById("devTabs");
  devTabs.children[1].onclick(); // 切到半制备
  eq(ctx.currentDevice, "semi", "已切到半制备");
  eq(Object.keys(ctx.selected).length, 0, "切设备 → 选中清空");
  documentStub.getElementById("devTabs").children[0].onclick(); // 切回制备
  eq(ctx.currentDevice, "prep", "切回制备");

  // 清空按钮
  ctx.onCellClick(pick[2].day, pick[2].hour);
  documentStub.getElementById("selClear").onclick();
  eq(Object.keys(ctx.selected).length, 0, "「清空」按钮生效");

  // 回归：点真实格子的 onclick（曾踩 var 闭包坑——hr 提升到 render() 作用域，
  // 循环结束后恒为 22，导致点任何格子都选中 22:00）
  const gridEl = documentStub.getElementById("grid");
  const freeCells = gridEl.children.filter((c) =>
    c.dataset && c.dataset.id && /(^|\s)free(\s|$)/.test(c.className));
  ok(freeCells.length > 0, "网格里找到空闲格子（共 " + freeCells.length + " 个）");
  const futureCell = freeCells.find((c) => {
    const parts = c.dataset.id.split("#");
    const end = new Date(+parts[0].slice(0, 4), +parts[0].slice(5, 7) - 1, +parts[0].slice(8, 10));
    end.setHours(parseInt(parts[1], 10) + 1, 0, 0, 0);
    return end.getTime() > Date.now() && !ctx.demoData[c.dataset.id];
  });
  ok(!!futureCell, "找到未来空闲格子做真实点击");
  futureCell.onclick();
  eq(Object.keys(ctx.selected)[0], futureCell.dataset.id,
     "真实点击格子 → 选中的就是格子自己的时段（" + futureCell.dataset.id + "）");
  ctx.selected = {};
  ctx.render();

  /* ---------- 批量预约端到端（showBatch → mOk） ---------- */
  console.log("\n[showBatch 端到端]");
  const final2 = freeFutureSlots(2, "prep");
  ctx.onCellClick(final2[0].day, final2[0].hour);
  ctx.onCellClick(final2[1].day, final2[1].hour);
  eq(Object.keys(ctx.selected).length, 2, "选中 2 段待批量预约");

  ctx.showBatch();
  const mOk = documentStub.getElementById("mOk");
  ok(typeof mOk.onclick === "function", "批量弹窗已打开且确认按钮就绪");
  await mOk.onclick.call(mOk);
  await new Promise((r2) => setImmediate(r2));

  ok(/成功预约 2/.test(toastEl.textContent), "批量预约成功 toast（" + toastEl.textContent + "）");
  eq(Object.keys(ctx.selected).length, 0, "成功后选中已清空");
  ok(ctx.demoData[final2[0].id] && ctx.demoData[final2[1].id], "两段都写入 demoData");
  eq(ctx.demoData[final2[0].id].user_id, "u-1", "归属本人");

  /* ---------- 预约时间上限（最多约到下周） ---------- */
  console.log("\n[预约上限：只能约到下周]");
  const nowMon = ctx.mondayOf(new Date());
  const farDay = ctx.ymd(ctx.addDays(nowMon, 15));         // 下下周周二，必超上限
  const nextMon = ctx.ymd(ctx.addDays(nowMon, 7));         // 下周周一（允许）

  ok(ctx.isFar(farDay) === true, "下下周 isFar = true");
  ok(ctx.isFar(nextMon) === false, "下周周一仍可约");
  ok(ctx.isFar(ctx.ymd(ctx.addDays(nowMon, 13))) === false, "下周日（最后可约日）仍可约");
  ok(ctx.isFar(ctx.ymd(ctx.addDays(nowMon, 14))) === true, "下下周一（第一个不可约日）isFar = true");

  // 点超限格子：拒绝 + 提示
  ctx.onCellClick(farDay, 10);
  eq(Object.keys(ctx.selected).length, 0, "点下下周格子不进入选中");
  ok(/只能约到|还没开放/.test(toastEl.textContent), "超限提示 toast（" + toastEl.textContent + "）");

  // demoRpc book_slot / book_slots 复刻数据库拦截
  r = await ctx.demoRpc("book_slot", {
    p_session: ctx.session.token, p_device: "prep",
    p_day: farDay, p_hour: 10, p_note: "", p_aqueous: "",
  });
  eq(r, "TOO_FAR", "book_slot 下下周 → TOO_FAR");

  r = await ctx.demoRpc("book_slots", {
    p_session: ctx.session.token, p_device: "prep",
    p_hours: [{ day: farDay, hour: 10 }, { day: final2[0].day, hour: final2[0].hour }],
    p_note: "", p_aqueous: "",
  });
  eq(r.code, "CONFLICT", "批量含下下周 → CONFLICT");
  ok(/尚未开放/.test(r.list.join("")), "冲突文案含「尚未开放」");

  // 周导航：翻到下周后「下一周」禁用；回到本周恢复
  ctx.selected = {};
  ctx.weekStart = ctx.maxWeekStart();
  ctx.render();
  ok(documentStub.getElementById("nextWeek").disabled === true, "翻到下周后「下一周」禁用");
  ctx.weekStart = nowMon;
  ctx.render();
  ok(documentStub.getElementById("nextWeek").disabled === false, "本周时「下一周」可用");

  // ?week= 参数超限时自动钳制到下周
  const oldSearch = ctx.location.search;
  ctx.location.search = "?demo=1&week=2027-01-04";
  ctx.initWeek();
  eq(ctx.ymd(ctx.weekStart), ctx.ymd(ctx.maxWeekStart()), "?week= 超限自动钳制到下周");
  ctx.location.search = oldSearch;
  ctx.initWeek();
  ctx.load();

  /* ---------- 汇总 ---------- */
  console.log("\n=================================");
  console.log("通过 " + passed + " 项，失败 " + failed + " 项");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("测试运行异常：", e); process.exit(1); });
