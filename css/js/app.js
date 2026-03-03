/* js/app.js */
/* BUILD: 20260303-final */
/* dry-ice-course-manager : 完成版 app.js（分割貼り合わせ方式） */

"use strict";

// =====================
// Safe DOM helpers
// =====================
const $ = (id) => document.getElementById(id);
const on = (el, evt, fn) => { if (el) el.addEventListener(evt, fn); };
const clampInt = (v, fallback = 0) => {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const pad2 = (n) => String(n).padStart(2, "0");

// =====================
// Constants / Rules
// =====================
const APP_KEY = "dryIceCourseManager_v2";
const WEEK_KEY = `${APP_KEY}_weekId`;
const MONTH_KEY = `${APP_KEY}_monthKey`;

const VALID_BASES = new Set([25, 30]);
const CUT_MAX = (base) => (base === 25 ? 24 : 29);

// 蓄冷ロジック（course×bin単位でカウント）
function coolPacksPerCourse(course) {
  if (course >= 501 && course <= 510) return 60;
  if (course >= 601 && course <= 619) return 50;
  if (course >= 621 && course <= 648) return 40;
  return 0; // 指定外は存在しない/作業しない
}

// 20枚＝1ケース（切り上げ禁止）
function toCasesAndRemainder(total, base) {
  const cases = Math.floor(total / base);
  const rem = total % base;
  return { cases, rem };
}

// =====================
// State
// =====================
const state = {
  // mode
  currentBin: 1,          // 1 or 2
  baseFromCSV: null,      // 25/30 or null
  baseOverride: null,     // 25/30 or null
  override: false,

  // UI
  currentRange: "501-510", // default tab
  searchKeyword: "",
  view: "cards",           // cards / paper / data

  // data (both bins kept in one array; filtered by currentBin for UI)
  rows: [],                // {id, course, bin, shime, cut, group, deleted, selected, note, checkedPaper}
  groups: ["A","B","C","D","E"],

  // paper view
  paperChecklistEnabled: false,
};

function uuid() {
  return "r_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
}

// =====================
// Date / Week / Month
// =====================
function mondayOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day); // Monday start
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}

function weekId(d) {
  const m = mondayOfWeek(d);
  return `${m.getFullYear()}-${pad2(m.getMonth()+1)}-${pad2(m.getDate())}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}

// 月〜金保存キー（週内だけ保持）。週IDが変わったら全削除。
function todayKey(d) {
  const day = d.getDay(); // Mon=1..Fri=5, Sat=6, Sun=0
  if (day === 6) { // Sat -> Fri
    const x = new Date(d); x.setDate(x.getDate()-1);
    return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
  }
  if (day === 0) { // Sun -> Fri
    const x = new Date(d); x.setDate(x.getDate()-2);
    return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

// =====================
// Storage
// =====================
function loadBucket() {
  try {
    const raw = localStorage.getItem(APP_KEY);
    return raw ? JSON.parse(raw) : { days: {} };
  } catch {
    return { days: {} };
  }
}

function saveBucket(bucket) {
  localStorage.setItem(APP_KEY, JSON.stringify(bucket));
}

function resetAllDataHard() {
  localStorage.removeItem(APP_KEY);
  localStorage.removeItem(WEEK_KEY);
  localStorage.removeItem(MONTH_KEY);

  state.rows = [];
  state.baseFromCSV = null;
  state.baseOverride = null;
  state.override = false;
  state.searchKeyword = "";
  state.currentRange = "501-510";
  state.view = "cards";
  state.currentBin = 1;
  state.paperChecklistEnabled = false;
}

function ensureWeekAndMaybeReset() {
  const now = new Date();
  const currentWeek = weekId(now);
  const savedWeek = localStorage.getItem(WEEK_KEY);

  if (savedWeek !== currentWeek) {
    // 週が変わった → 全削除（履歴保持しない）
    resetAllDataHard();
    localStorage.setItem(WEEK_KEY, currentWeek);
  }
}

function persistToday() {
  const bucket = loadBucket();
  const dKey = todayKey(new Date());
  bucket.days[dKey] = {
    meta: {
      baseFromCSV: state.baseFromCSV,
      baseOverride: state.baseOverride,
      override: state.override,
      groups: state.groups,
      paperChecklistEnabled: state.paperChecklistEnabled,
    },
    rows: state.rows,
  };
  saveBucket(bucket);
}

function loadTodayIfExists() {
  const bucket = loadBucket();
  const dKey = todayKey(new Date());
  const data = bucket.days?.[dKey];
  if (!data) return;

  const meta = data.meta || {};
  state.baseFromCSV = meta.baseFromCSV ?? null;
  state.baseOverride = meta.baseOverride ?? null;
  state.override = meta.override ?? false;
  state.groups = Array.isArray(meta.groups) && meta.groups.length ? meta.groups : ["A","B","C","D","E"];
  state.paperChecklistEnabled = !!meta.paperChecklistEnabled;

  state.rows = Array.isArray(data.rows) ? data.rows : [];
}

// =====================
// Base mode
// =====================
function getEffectiveBase() {
  const b = state.override ? state.baseOverride : state.baseFromCSV;
  return VALID_BASES.has(b) ? b : null;
}

function setBaseFromCSV(base) {
  if (!VALID_BASES.has(base)) return;
  state.baseFromCSV = base;
  if (!state.override) state.baseOverride = null;
}

function setOverrideBase(base) {
  if (!VALID_BASES.has(base)) return;
  state.baseOverride = base;
  state.override = true;
}

function askBaseMode(force = false) {
  const current = getEffectiveBase();
  if (!force && current) return;

  const ans = prompt("〆基準を入力してください（25 または 30）", current ? String(current) : "25");
  if (ans === null) return;
  const base = clampInt(ans, NaN);
  if (!VALID_BASES.has(base)) {
    alert("25 または 30 のどちらかを入力してください");
    return askBaseMode(force);
  }
  setOverrideBase(base);
  persistToday();
}

// =====================
// CSV Parsing
// =====================
function parseCSV(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error("CSV行が足りません");

  const header = lines[0].split(",").map(s => s.trim());
  if (header[0] !== "shime_size") throw new Error("1行目は shime_size,25 または shime_size,30 です");
  const base = clampInt(header[1], NaN);
  if (!VALID_BASES.has(base)) throw new Error("shime_size は 25 または 30 です");

  const col = lines[1].split(",").map(s => s.trim());
  const okCol = col.length >= 4 && col[0] === "course" && col[1] === "bin" && col[2] === "shime" && col[3] === "cut";
  if (!okCol) throw new Error("2行目は course,bin,shime,cut です");

  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].split(",").map(s => s.trim());
    if (parts.length < 4) continue;

    const course = clampInt(parts[0], NaN);
    const bin = clampInt(parts[1], NaN);
    const shime = clampInt(parts[2], 0);
    const cut = clampInt(parts[3], 0);

    if (!Number.isFinite(course)) continue;
    if (bin !== 1 && bin !== 2) continue;

    rows.push({
      id: uuid(),
      course,
      bin,
      shime: Math.max(0, shime),
      cut: Math.max(0, cut),
      group: "未振り分け",
      deleted: false,
      selected: false,
      note: "",
      checkedPaper: false,
    });
  }

  return { base, rows };
}

// ===== PART 1 END =====
// =====================
// Derived / Filters
// =====================
function currentBinRows() {
  return state.rows.filter(r => r.bin === state.currentBin);
}

function inRange(course, rangeKey) {
  const [a,b] = String(rangeKey).split("-").map(x => clampInt(x, NaN));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  return course >= lo && course <= hi;
}

function visibleRows() {
  const kw = state.searchKeyword.trim();
  return currentBinRows()
    .filter(r => !r.deleted)
    .filter(r => inRange(r.course, state.currentRange))
    .filter(r => {
      if (!kw) return true;
      const c = String(r.course);
      const b = String(r.bin);
      return c.startsWith(kw) || c.includes(kw) || (`${c}/${b}`).includes(kw);
    })
    .sort((x,y)=>x.course - y.course || x.bin - y.bin);
}

// =====================
// Calculations
// =====================
function sumDry(rows) {
  const base = getEffectiveBase();
  if (!base) return { base:null,totalShime:0,totalCut:0,totalPieces:0,cases:0,rem:0 };

  const totalShime = rows.reduce((a,r)=>a+(r.shime||0),0);
  const totalCut = rows.reduce((a,r)=>a+(r.cut||0),0);
  const totalPieces = (totalShime*base)+totalCut;
  const {cases,rem} = toCasesAndRemainder(totalPieces, base);

  return { base,totalShime,totalCut,totalPieces,cases,rem };
}

function sumCool(rows) {
  const seen = new Set();
  let totalPacks = 0;

  for(const r of rows){
    const key = `${r.course}_${r.bin}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const n = coolPacksPerCourse(r.course);
    if(n>0) totalPacks += n;
  }

  const {cases,rem} = toCasesAndRemainder(totalPacks,20);
  return { totalPacks,cases,rem };
}

function findDuplicates(rows){
  const map = new Map();
  const dup = new Set();
  for(const r of rows){
    const key = `${r.course}_${r.bin}`;
    if(map.has(key)) dup.add(key);
    else map.set(key,true);
  }
  return dup;
}

// =====================
// UI Rendering helpers
// =====================
const els = {};
function cacheEls(){
  [
    "monthPill","modePill","overridePill",
    "csvInput","applyCSV","clearCSV",
    "bin1Btn","bin2Btn","mode25Btn","mode30Btn",
    "tab501","tab601","tab621",
    "courseSearch","clearSearch",
    "viewCards","viewPaper","viewData",
    "dryCases","dryBara","coolCases","coolBara",
    "unassignedCount","groupACount","groupBCount","groupCCount","groupDCount","groupECount",
    "paperGrid","paperChecklistToggle",
    "dataMode","dataBin","dataCode",
    "buildLabel",
    "addGroupBtn","addCourseBtn",
    "btnSelectAllVisible","btnSelectNone","btnRangeSelect","btnDeleteSelected","btnMoveUnassigned",
    "contentRoot",
  ].forEach(k=>els[k]=$(k));

  if(!els.contentRoot){
    els.contentRoot = document.querySelector(".content") || document.body;
  }
}

function setActive(btn,flag){
  if(!btn) return;
  btn.classList.toggle("active",!!flag);
}

function renderPills(){
  const now = new Date();
  if(els.monthPill) els.monthPill.textContent = `MONTH: ${monthKey(now)}`;

  const base = getEffectiveBase();
  if(els.modePill) els.modePill.textContent = base?`MODE: ${base}`:"MODE: ?";

  if(els.overridePill){
    els.overridePill.textContent = state.override?"OVERRIDE":"";
    els.overridePill.style.display = state.override?"":"none";
  }

  if(els.buildLabel){
    els.buildLabel.textContent = `BIN ${state.currentBin} / VIEW ${state.view}`;
  }
}

function renderSummary(){
  const rows = currentBinRows().filter(r=>!r.deleted);
  const dry = sumDry(rows);
  const cool = sumCool(rows);

  if(!dry.base){
    if(els.dryCases) els.dryCases.textContent="-";
    if(els.dryBara) els.dryBara.textContent="-";
  }else{
    if(els.dryCases) els.dryCases.textContent=String(dry.cases);
    if(els.dryBara) els.dryBara.textContent=String(dry.rem);
  }

  if(els.coolCases) els.coolCases.textContent=String(cool.cases);
  if(els.coolBara) els.coolBara.textContent=String(cool.rem);

  const count=(g)=>rows.filter(r=>r.group===g).length;
  if(els.unassignedCount) els.unassignedCount.textContent=String(count("未振り分け"));
  if(els.groupACount) els.groupACount.textContent=String(count("A"));
  if(els.groupBCount) els.groupBCount.textContent=String(count("B"));
  if(els.groupCCount) els.groupCCount.textContent=String(count("C"));
  if(els.groupDCount) els.groupDCount.textContent=String(count("D"));
  if(els.groupECount) els.groupECount.textContent=String(count("E"));
}

function renderTabsAndButtons(){
  setActive(els.bin1Btn,state.currentBin===1);
  setActive(els.bin2Btn,state.currentBin===2);

  const base=getEffectiveBase();
  setActive(els.mode25Btn,base===25);
  setActive(els.mode30Btn,base===30);

  setActive(els.tab501,state.currentRange==="501-510");
  setActive(els.tab601,state.currentRange==="601-619");
  setActive(els.tab621,state.currentRange==="621-648");

  setActive(els.viewCards,state.view==="cards");
  setActive(els.viewPaper,state.view==="paper");
  setActive(els.viewData,state.view==="data");
}

// ===== PART 2 END =====
// =====================
// Month rule (every 1st)
// =====================
function ensureMonthAndMaybeAskMode() {
  const now = new Date();
  const mk = monthKey(now);
  const saved = localStorage.getItem(MONTH_KEY);

  if (saved !== mk) {
    // month changed (1st 기준)
    localStorage.setItem(MONTH_KEY, mk);
    state.baseOverride = null;
    state.override = false;
    askBaseMode(true);
  } else {
    if (!getEffectiveBase()) askBaseMode(false);
  }
}

// =====================
// Actions (CRUD / CSV / Batch)
// =====================
function setBin(bin) {
  if (bin !== 1 && bin !== 2) return;
  state.currentBin = bin;
  clearSelectedAll();
  persistToday();
  renderAll();
}

function setRange(rangeKey) {
  state.currentRange = rangeKey;
  persistToday();
  renderAll();
}

function setView(v) {
  state.view = v;
  persistToday();
  renderAll();
}

function setSearchKeyword(v) {
  state.searchKeyword = String(v ?? "");
  persistToday();
  renderAll();
}

function clearCSVBox() {
  if (els.csvInput) els.csvInput.value = "";
}

function applyCSV() {
  const text = els.csvInput ? els.csvInput.value : "";
  if (!String(text).trim()) return alert("CSVを貼り付けてください");

  let parsed;
  try {
    parsed = parseCSV(text);
  } catch (e) {
    return alert("CSVエラー：" + e.message);
  }

  // CSV基準最優先
  setBaseFromCSV(parsed.base);
  if (!state.override) state.baseOverride = null;

  // 便は絶対に合算しない：今見てる便だけ置換
  const bin = state.currentBin;
  const keep = state.rows.filter(r => r.bin !== bin);
  const incoming = parsed.rows.filter(r => r.bin === bin);
  state.rows = keep.concat(incoming);

  // warnings
  const base = getEffectiveBase() || parsed.base;
  const maxCut = CUT_MAX(base);
  const over = incoming.filter(r => r.cut > maxCut);
  if (over.length) {
    alert(`⚠ cut上限超えがあります（基準${base}：最大${maxCut}）\n例：${over[0].course} 便${over[0].bin} cut=${over[0].cut}`);
  }
  const dup = findDuplicates(incoming);
  if (dup.size) {
    alert(`⚠ 重複警告（同一 course×bin）があります\n例：${Array.from(dup)[0]}`);
  }

  persistToday();
  renderAll();
}

function toggleSelected(id) {
  const r = state.rows.find(x => x.id === id);
  if (!r || r.deleted) return;
  if (r.bin !== state.currentBin) return;
  r.selected = !r.selected;
  persistToday();
  renderAll();
}

function clearSelectedAll() {
  for (const r of state.rows) {
    if (r.bin === state.currentBin) r.selected = false;
  }
  // persist+render will be called by caller (some cases), but safe:
  persistToday();
}

function selectAllVisible() {
  for (const r of visibleRows()) r.selected = true;
  persistToday();
  renderAll();
}

function rangeSelectPrompt() {
  const s = prompt("範囲選択：開始 course（例 501）", "");
  if (s === null) return;
  const e = prompt("範囲選択：終了 course（例 510）", "");
  if (e === null) return;

  const a = clampInt(s, NaN);
  const b = clampInt(e, NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return alert("数字で入力してください");

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const r of state.rows) {
    if (r.deleted) continue;
    if (r.bin !== state.currentBin) continue;
    if (r.course >= lo && r.course <= hi) r.selected = true;
  }
  persistToday();
  renderAll();
}

function moveSelectedTo(group) {
  const sel = state.rows.filter(r => r.bin === state.currentBin && r.selected && !r.deleted);
  if (!sel.length) return alert("選択がありません");
  for (const r of sel) {
    r.group = group;
    r.selected = false;
  }
  persistToday();
  renderAll();
}

function deleteSelected() {
  const sel = state.rows.filter(r => r.bin === state.currentBin && r.selected && !r.deleted);
  if (!sel.length) return alert("選択がありません");
  const ok = confirm(`選択 ${sel.length} 件を削除棚へ移動します（復活可）。`);
  if (!ok) return;
  for (const r of sel) {
    r.deleted = true;
    r.selected = false;
  }
  persistToday();
  renderAll();
}

function moveOneTo(id, group) {
  const r = state.rows.find(x => x.id === id);
  if (!r || r.deleted) return;
  if (r.bin !== state.currentBin) return;
  r.group = group;
  r.selected = false;
  persistToday();
  renderAll();
}

function deleteOne(id) {
  const r = state.rows.find(x => x.id === id);
  if (!r) return;
  if (r.bin !== state.currentBin) return;
  r.deleted = true;
  r.selected = false;
  persistToday();
  renderAll();
}

function restoreOne(id) {
  const r = state.rows.find(x => x.id === id);
  if (!r) return;
  if (r.bin !== state.currentBin) return;
  r.deleted = false;
  r.group = "未振り分け";
  r.selected = false;
  persistToday();
  renderAll();
}

function editRow(id) {
  const r = state.rows.find(x => x.id === id);
  if (!r) return;
  if (r.bin !== state.currentBin) return;

  const base = getEffectiveBase();
  const max = CUT_MAX(base || 25);

  const s = prompt(`〆を入力（現在 ${r.shime}）`, String(r.shime));
  if (s === null) return;
  const c = prompt(`cutを入力（現在 ${r.cut} / 最大 ${max}）`, String(r.cut));
  if (c === null) return;

  const sh = clampInt(s, NaN);
  const cu = clampInt(c, NaN);
  if (!Number.isFinite(sh) || sh < 0) return alert("〆は0以上の数字です");
  if (!Number.isFinite(cu) || cu < 0) return alert("cutは0以上の数字です");

  r.shime = sh;
  r.cut = cu;

  if (base && r.cut > CUT_MAX(base)) {
    alert(`⚠ cut上限超え（基準${base}：最大${CUT_MAX(base)}）`);
  }

  persistToday();
  renderAll();
}

function addGroup() {
  const name = prompt("追加するグループ名（例：F）", "");
  if (name === null) return;
  const g = String(name).trim();
  if (!g) return;
  if (g === "未振り分け") return alert("その名前は使えません");
  if (state.groups.includes(g)) return alert("同名グループがあります");
  state.groups.push(g);
  persistToday();
  renderAll();
}

function addCourseManual() {
  const c = prompt("追加するcourse番号（例 501）", "");
  if (c === null) return;
  const course = clampInt(c, NaN);
  if (!Number.isFinite(course)) return alert("数字で入力してください");

  const s = prompt("〆（例 1）", "0");
  if (s === null) return;
  const cut = prompt("cut（例 8）", "0");
  if (cut === null) return;

  const sh = clampInt(s, NaN);
  const cu = clampInt(cut, NaN);
  if (!Number.isFinite(sh) || sh < 0) return alert("〆は0以上の数字です");
  if (!Number.isFinite(cu) || cu < 0) return alert("cutは0以上の数字です");

  const r = {
    id: uuid(),
    course,
    bin: state.currentBin,
    shime: sh,
    cut: cu,
    group: "未振り分け",
    deleted: false,
    selected: false,
    note: "",
    checkedPaper: false,
  };

  const dupKey = `${course}_${state.currentBin}`;
  const exists = state.rows.some(x => !x.deleted && `${x.course}_${x.bin}` === dupKey);
  if (exists) alert("⚠ 重複警告：同一 course×bin が既に存在します");

  const base = getEffectiveBase();
  if (base && r.cut > CUT_MAX(base)) alert(`⚠ cut上限超え（基準${base}：最大${CUT_MAX(base)}）`);

  state.rows.push(r);
  persistToday();
  renderAll();
}

// =====================
// UI: dynamic rendering area
// =====================
function clearContent() {
  const zone = els.contentRoot;
  if (!zone) return;
  zone.querySelectorAll("[data-dyn='1']").forEach(n => n.remove());
}

function mk(tag, cls, txt) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt !== undefined) el.textContent = txt;
  return el;
}

function renderCardItem(r, base, dupSet) {
  const div = mk("div", "item" + (r.selected ? " selected" : ""));
  div.dataset.id = r.id;

  const head = mk("div", "itemHead");
  const title = mk("div", "itemTitle", String(r.course));
  const badges = mk("div", "badges");
  badges.appendChild(mk("span", "badgeMini", `便${r.bin}`));

  const dupKey = `${r.course}_${r.bin}`;
  if (dupSet.has(dupKey)) badges.appendChild(mk("span", "badgeMini warn", "DUP"));

  const cool = coolPacksPerCourse(r.course);
  if (cool > 0) badges.appendChild(mk("span", "badgeMini", `蓄冷${cool}`));
  head.appendChild(title);
  head.appendChild(badges);

  const body = mk("div", "itemBody");
  body.appendChild(mk("div", "kv", `〆: ${r.shime}`));
  body.appendChild(mk("div", "kv", `cut: ${r.cut}`));
  if (base) body.appendChild(mk("div", "kv", `個数: ${(r.shime * base) + r.cut}`));
  else body.appendChild(mk("div", "kv", "個数: -"));

  const foot = mk("div", "itemFoot");
  foot.appendChild(mk("div", "kv", `所属: ${r.group}`));
  const btns = mk("div", "itemBtns");

  const editBtn = mk("button", "btn ghost", "編集"); editBtn.dataset.act = "edit";
  const backBtn = mk("button", "btn ghost", "未振分へ"); backBtn.dataset.act = "unassign";
  const delBtn  = mk("button", "btn ghost", "削除"); delBtn.dataset.act = "delete";
  btns.appendChild(editBtn); btns.appendChild(backBtn); btns.appendChild(delBtn);
  foot.appendChild(btns);

  div.appendChild(head);
  div.appendChild(body);
  div.appendChild(foot);

  div.addEventListener("click", (ev) => {
    const act = ev.target && ev.target.dataset ? ev.target.dataset.act : null;
    if (!act) {
      toggleSelected(r.id);
      return;
    }
    ev.preventDefault(); ev.stopPropagation();
    if (act === "edit") return editRow(r.id);
    if (act === "unassign") return moveOneTo(r.id, "未振り分け");
    if (act === "delete") return deleteOne(r.id);
  });

  return div;
}

function renderDeletedCard(r) {
  const div = mk("div", "item");
  div.dataset.id = r.id;

  const head = mk("div", "itemHead");
  head.appendChild(mk("div", "itemTitle", String(r.course)));
  const badges = mk("div", "badges");
  badges.appendChild(mk("span", "badgeMini", `便${r.bin}`));
  head.appendChild(badges);

  const body = mk("div", "itemBody");
  body.appendChild(mk("div", "kv", `〆: ${r.shime}`));
  body.appendChild(mk("div", "kv", `cut: ${r.cut}`));

  const foot = mk("div", "itemFoot");
  foot.appendChild(mk("div", "kv", "削除済み"));
  const btns = mk("div", "itemBtns");
  const restore = mk("button", "btn primary", "復活");
  restore.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); restoreOne(r.id); });
  btns.appendChild(restore);
  foot.appendChild(btns);

  div.appendChild(head);
  div.appendChild(body);
  div.appendChild(foot);
  return div;
}

function renderCards() {
  clearContent();
  const zone = els.contentRoot;
  const dyn = mk("div", "", "");
  dyn.dataset.dyn = "1";

  const base = getEffectiveBase();
  if (!base) dyn.appendChild(mk("div", "toast warn", "⚠ 〆基準（25/30）が未設定です。上の 25 / 30 を選んでください。"));

  const rows = visibleRows();
  const dupSet = findDuplicates(currentBinRows().filter(r => !r.deleted));

  const groups = ["未振り分け"].concat(state.groups);

  for (const g of groups) {
    const sec = mk("section", "section");
    sec.dataset.dyn = "1";
    sec.appendChild(mk("div", "sectionTitle", g === "未振り分け" ? "未振り分け" : `グループ ${g}`));

    const grid = mk("div", "grid");
    const list = rows.filter(r => r.group === g);

    if (!list.length) {
      const ph = mk("div", "card placeholder");
      ph.appendChild(mk("div", "phTitle", "なし"));
      ph.appendChild(mk("div", "phText", "ここにカードが表示されます"));
      grid.appendChild(ph);
    } else {
      for (const r of list) grid.appendChild(renderCardItem(r, base, dupSet));
    }

    sec.appendChild(grid);
    dyn.appendChild(sec);
  }

  const deleted = currentBinRows().filter(r => r.deleted).sort((a,b)=>a.course-b.course);
  const delSec = mk("section", "section");
  delSec.dataset.dyn = "1";
  delSec.appendChild(mk("div", "sectionTitle", `削除済み棚（復活可）: ${deleted.length}件`));
  const delGrid = mk("div", "grid");
  if (!deleted.length) {
    const ph = mk("div", "card placeholder");
    ph.appendChild(mk("div", "phTitle", "空"));
    ph.appendChild(mk("div", "phText", "削除したカードがここに入ります"));
    delGrid.appendChild(ph);
  } else {
    for (const r of deleted) delGrid.appendChild(renderDeletedCard(r));
  }
  delSec.appendChild(delGrid);
  dyn.appendChild(delSec);

  zone.appendChild(dyn);
}

function renderPaper() {
  clearContent();
  const zone = els.contentRoot;
  const dyn = mk("div", "", "");
  dyn.dataset.dyn = "1";

  const base = getEffectiveBase();
  if (!base) dyn.appendChild(mk("div", "toast warn", "⚠ 〆基準（25/30）が未設定です。上の 25 / 30 を選んでください。"));

  dyn.appendChild(mk("div", "sectionTitle", "紙ビュー（照合）"));
  dyn.appendChild(mk("div", "muted", "コース順・便別。チェックは端末内に保存。"));

  // Spec: 同一コース内で1便/2便を並べる
  const all = state.rows.filter(r => !r.deleted).slice().sort((a,b)=>a.course-b.course || a.bin-b.bin);

  const map = new Map(); // course -> {1:row,2:row} (first only)
  for (const r of all) {
    if (!map.has(r.course)) map.set(r.course, {1:null,2:null});
    const obj = map.get(r.course);
    if (!obj[r.bin]) obj[r.bin] = r;
  }

  const tbl = mk("div", "paperTable");
  const header = mk("div", "paperRow header");
  header.appendChild(mk("div", "c", "コース"));
  header.appendChild(mk("div", "c", "1便 〆/cut"));
  header.appendChild(mk("div", "c", "2便 〆/cut"));
  header.appendChild(mk("div", "c", "チェック"));
  tbl.appendChild(header);

  const kw = state.searchKeyword.trim();
  const courses = Array.from(map.keys()).sort((a,b)=>a-b);
  for (const c of courses) {
    if (!inRange(c, state.currentRange)) continue;
    if (kw && !String(c).includes(kw) && !String(c).startsWith(kw)) continue;

    const obj = map.get(c);
    const r1 = obj[1];
    const r2 = obj[2];

    const row = mk("div", "paperRow");
    row.appendChild(mk("div", "c", String(c)));
    row.appendChild(mk("div", "c", r1 ? `${r1.shime}/${r1.cut}` : "-"));
    row.appendChild(mk("div", "c", r2 ? `${r2.shime}/${r2.cut}` : "-"));

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!(r1?.checkedPaper || r2?.checkedPaper);
    chk.addEventListener("change", () => {
      if (r1) r1.checkedPaper = chk.checked;
      if (r2) r2.checkedPaper = chk.checked;
      persistToday();
    });

    const chkCell = mk("div", "c");
    chkCell.appendChild(chk);
    row.appendChild(chkCell);

    tbl.appendChild(row);
  }

  dyn.appendChild(tbl);
  zone.appendChild(dyn);
}

function renderDataView() {
  clearContent();
  const zone = els.contentRoot;
  const dyn = mk("div", "", "");
  dyn.dataset.dyn = "1";

  const base = getEffectiveBase();
  const rows = currentBinRows().filter(r => !r.deleted).slice().sort((a,b)=>a.course-b.course || a.bin-b.bin);

  const dry = sumDry(rows);
  const cool = sumCool(rows);

  const stream = {
    META: {
      project: "dry-ice-course-manager",
      weekId: localStorage.getItem(WEEK_KEY) || "",
      dayKey: todayKey(new Date()),
      bin: state.currentBin,
      base: base,
      override: state.override,
      range: state.currentRange,
      search: state.searchKeyword,
      rows: rows.length,
    },
    DRY_ICE: {
      total_shime: dry.totalShime,
      total_cut: dry.totalCut,
      total_pieces: dry.totalPieces,
      cases: dry.cases,
      bara: dry.rem,
      base: dry.base,
    },
    COOL_PACKS: {
      total_packs: cool.totalPacks,
      cases: cool.cases,
      bara: cool.rem,
      per_case: 20,
    },
    DATA: rows.map(r => ({
      course: r.course,
      bin: r.bin,
      shime: r.shime,
      cut: r.cut,
      group: r.group,
    })),
  };

  const pre = mk("pre", "codeView");
  pre.textContent = "DATA STREAM\n" + JSON.stringify(stream, null, 2);
  dyn.appendChild(pre);
  zone.appendChild(dyn);
}

// =====================
// Top render
// =====================
function renderAll() {
  renderPills();
  renderTabsAndButtons();
  renderSummary();

  if (state.view === "cards") renderCards();
  else if (state.view === "paper") renderPaper();
  else renderDataView();
}

// =====================
// Events
// =====================
function bindEvents() {
  // CSV
  on(els.applyCSV, "click", applyCSV);
  on(els.clearCSV, "click", clearCSVBox);

  // BIN
  on(els.bin1Btn, "click", () => setBin(1));
  on(els.bin2Btn, "click", () => setBin(2));

  // MODE (manual override)
  on(els.mode25Btn, "click", () => { setOverrideBase(25); persistToday(); renderAll(); });
  on(els.mode30Btn, "click", () => { setOverrideBase(30); persistToday(); renderAll(); });

  // RANGE tabs
  on(els.tab501, "click", () => setRange("501-510"));
  on(els.tab601, "click", () => setRange("601-619"));
  on(els.tab621, "click", () => setRange("621-648"));

  // SEARCH
  on(els.courseSearch, "input", (e) => setSearchKeyword(e.target.value));
  on(els.clearSearch, "click", () => {
    if (els.courseSearch) els.courseSearch.value = "";
    setSearchKeyword("");
  });

  // VIEW
  on(els.viewCards, "click", () => setView("cards"));
  on(els.viewPaper, "click", () => setView("paper"));
  on(els.viewData, "click", () => setView("data"));

  // Paper toggle
  on(els.paperChecklistToggle, "click", () => {
    state.paperChecklistEnabled = !state.paperChecklistEnabled;
    persistToday();
    if (state.view === "paper") renderAll();
  });

  // Add
  on(els.addGroupBtn, "click", addGroup);
  on(els.addCourseBtn, "click", addCourseManual);

  // ===== SELECTION TOOLBAR =====
  on(els.btnSelectAllVisible, "click", selectAllVisible);
  on(els.btnSelectNone, "click", () => { clearSelectedAll(); renderAll(); });
  on(els.btnRangeSelect, "click", rangeSelectPrompt);
  on(els.btnDeleteSelected, "click", deleteSelected);
  on(els.btnMoveUnassigned, "click", () => moveSelectedTo("未振り分け"));

  // A〜E move buttons (data-move="A" etc)
  // iPhone事故回避：forEach/=> を使わない
  var moveBtns = document.querySelectorAll("button[data-move]");
  for (var i = 0; i < moveBtns.length; i++) {
    moveBtns[i].addEventListener("click", function () {
      moveSelectedTo(this.dataset.move);
    });
  }
}

// =====================
// Boot
// =====================
function init() {
  cacheEls();

  ensureWeekAndMaybeReset();
  loadTodayIfExists();
  ensureMonthAndMaybeAskMode();

  if (els.courseSearch) els.courseSearch.value = state.searchKeyword;

  bindEvents();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);

// ===== PART 3 END / FILE END =====
