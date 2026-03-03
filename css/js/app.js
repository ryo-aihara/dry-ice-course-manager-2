/* js/app.js */
/* BUILD: 20260303a */
/* dry-ice-course-manager (FINAL CORE) */
/* OCR禁止 / 便合算禁止 / CSV基準最優先 / 週ID(月曜)で全削除 / 1週保持のみ / 切り上げ禁止 */

(() => {
  "use strict";

  const BUILD_ID = "20260303a";

  // ===== 固定仕様 =====
  const CUT_LIMIT = { 25: 24, 30: 29 };
  const ICE_CASE_SIZE = 20;
  const ICE_RULES = [
    { from: 501, to: 510, packs: 60 },
    { from: 601, to: 619, packs: 50 },
    { from: 621, to: 648, packs: 40 },
  ];

  // ===== localStorage keys =====
  const LS = {
    WEEK_ID: "dicm.weekId",
    MONTH: "dicm.month",
    MONTH_MODE: "dicm.monthMode",      // 月のデフォ基準（25/30）
    OVERRIDE: "dicm.override",         // 0/1
    DAYDATA: "dicm.daydata",           // 週内データまとめ
  };

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const els = {};

  function cacheEls() {
    [
      "monthPill","modePill","overridePill","csvLoadedPill",
      "csvInput","applyCSV","clearCSV","csvError",
      "bin1Btn","bin2Btn","mode25Btn","mode30Btn",
      "tab501","tab601","tab621",
      "courseSearch","clearSearch",
      "viewCards","viewPaper","viewData",
      "dryCases","dryBara","coolCases","coolBara",
      "unassignedCount","groupACount","groupBCount","groupCCount","groupDCount","groupECount","deletedCount",
      "groupUnassigned","groupA","groupB","groupC","groupD","groupE","groupDeleted",
      "addGroupBtn","addCourseBtn",
      "paperGrid","paperChecklistToggle",
      "dataMode","dataBin","dataCode",
      "buildLabel",
    ].forEach(k => els[k] = $(k));
  }

  // ===== State =====
  const state = {
    today: "",     // YYYY-MM-DD
    month: "",     // YYYY-MM
    weekId: "",    // Monday YYYY-MM-DD
    currentBin: 1, // 1/2
    rangeKey: "501-510",
    search: "",
    view: "cards", // cards/paper/data

    monthMode: null, // 25/30 (毎月1日に確認)
    baseMode: null,  // 25/30 (CSV優先。なければ monthMode)
    override: false,

    groups: ["未振り分け","A","B","C","D","E"],

    // rows: {id, course, bin, shime, cut, group, deleted, checked}
    rows: [],
    csvLoaded: false,
  };

  // ===== Utils =====
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const isoMonth = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;

  function mondayOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay(); // 0 Sun
    const diff = (day === 0 ? -6 : 1 - day); // back to Monday
    x.setDate(x.getDate() + diff);
    return x;
  }

  function clampInt(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : def;
  }

  function uuid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function courseIcePacks(course) {
    for (const r of ICE_RULES) {
      if (course >= r.from && course <= r.to) return r.packs;
    }
    return 0; // 指定外は存在しない扱い（＝作業しない）
  }

  function cutLimit(mode) {
    return CUT_LIMIT[mode] ?? 24;
  }

  function showError(msg) {
    els.csvError.textContent = msg;
    els.csvError.classList.remove("hidden");
  }
  function clearError() {
    els.csvError.textContent = "";
    els.csvError.classList.add("hidden");
  }

  // ===== Storage helpers (週内のみ保持) =====
  function loadAll() {
    try {
      const raw = localStorage.getItem(LS.DAYDATA);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }
  function saveAll(obj) {
    localStorage.setItem(LS.DAYDATA, JSON.stringify(obj));
  }

  function getBucket(all, weekId, dayStr) {
    if (!all[weekId]) all[weekId] = {};
    if (!all[weekId][dayStr]) all[weekId][dayStr] = { "1": null, "2": null };
    return all[weekId][dayStr];
  }

  function persistCurrentBin() {
    const all = loadAll();
    const bucket = getBucket(all, state.weekId, state.today);

    bucket[String(state.currentBin)] = {
      meta: {
        build: BUILD_ID,
        csvLoaded: state.csvLoaded,
        baseMode: state.baseMode,
        monthMode: state.monthMode,
        override: state.override,
        groups: state.groups,
      },
      rows: state.rows,
    };

    saveAll(all);
  }

  function loadCurrentBin() {
    const all = loadAll();
    const week = all[state.weekId];
    if (!week) return;
    const day = week[state.today];
    if (!day) return;

    const snap = day[String(state.currentBin)];
    if (!snap) return;

    const meta = snap.meta || {};
    state.rows = Array.isArray(snap.rows) ? snap.rows : [];
    state.csvLoaded = !!meta.csvLoaded;

    // groupsは棚消滅事故を防ぐため復元
    if (Array.isArray(meta.groups) && meta.groups.length >= 1) {
      state.groups = meta.groups;
    }

    // baseMode復元（CSV基準の最後）
    if (meta.baseMode === 25 || meta.baseMode === 30) {
      state.baseMode = meta.baseMode;
    }
  }

  // ===== Weekly reset =====
  function ensureWeekReset() {
    const savedWeek = localStorage.getItem(LS.WEEK_ID);
    if (savedWeek !== state.weekId) {
      // 週が変わった → 全削除（履歴保持しない）
      localStorage.setItem(LS.WEEK_ID, state.weekId);
      localStorage.removeItem(LS.DAYDATA);
    }
  }

  // ===== Month mode gate (毎月1日切替) =====
  function ensureMonthMode() {
    const savedMonth = localStorage.getItem(LS.MONTH);
    const savedMode = localStorage.getItem(LS.MONTH_MODE);

    if (savedMonth !== state.month || !savedMode) {
      const ok25 = confirm("新しい月です。\n25期ならOK、30期ならキャンセルを押してください。");
      const mode = ok25 ? 25 : 30;
      localStorage.setItem(LS.MONTH, state.month);
      localStorage.setItem(LS.MONTH_MODE, String(mode));
      localStorage.setItem(LS.OVERRIDE, "0");
      state.override = false;
      return mode;
    }

    return clampInt(savedMode, null);
  }

  // ===== CSV parse =====
  function parseCSV(text) {
    const lines = text.split("\n").map(s => s.trim()).filter(s => s.length > 0);
    if (lines.length < 2) throw new Error("CSVが短すぎます");

    const first = lines[0].split(",").map(s => s.trim());
    if (first[0] !== "shime_size") throw new Error("1行目は shime_size,25 または shime_size,30 が必要");
    const mode = clampInt(first[1], 0);
    if (mode !== 25 && mode !== 30) throw new Error("shime_size は 25 または 30 のみ");

    const header = lines[1].split(",").map(s => s.trim()).join(",");
    if (header !== "course,bin,shime,cut") {
      throw new Error("2行目は course,bin,shime,cut 固定（順番も固定）");
    }

    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      const p = lines[i].split(",").map(s => s.trim());
      if (p.length !== 4) continue;

      const course = clampInt(p[0], NaN);
      const bin = clampInt(p[1], NaN);
      const shime = clampInt(p[2], 0);
      const cut = clampInt(p[3], 0);

      if (!Number.isFinite(course)) continue;
      if (bin !== 1 && bin !== 2) throw new Error(`binは1か2だけです（course ${course}）`);
      if (shime < 0 || cut < 0) throw new Error(`負の値は不可（${course},${bin}）`);

      rows.push({ course, bin, shime, cut });
    }

    return { mode, rows };
  }

  // ===== Totals (切り上げ禁止) =====
  function computeTotalsForCurrentBin() {
    const mode = state.baseMode ?? state.monthMode ?? 25;

    // 現在便 & 未削除だけ
    const active = state.rows.filter(r => r.bin === state.currentBin && !r.deleted);

    let totalShime = 0;
    let totalCut = 0;
    let totalIce = 0;

    for (const r of active) {
      totalShime += r.shime;
      totalCut += r.cut;
      totalIce += courseIcePacks(r.course);
    }

    const totalPieces = (totalShime * mode) + totalCut;
    const dryCase = Math.floor(totalPieces / mode);
    const dryBara = totalPieces % mode;

    const iceCase = Math.floor(totalIce / ICE_CASE_SIZE);
    const iceBara = totalIce % ICE_CASE_SIZE;

    return { mode, totalShime, totalCut, totalPieces, dryCase, dryBara, totalIce, iceCase, iceBara };
  }

  // ===== Filters =====
  function visibleRows() {
    let rows = state.rows.filter(r => r.bin === state.currentBin && !r.deleted);

    // range
    const [a, b] = state.rangeKey.split("-").map(x => clampInt(x, 0));
    rows = rows.filter(r => r.course >= a && r.course <= b);

    // search prefix
    const s = state.search.trim();
    if (s) rows = rows.filter(r => String(r.course).startsWith(s));

    rows.sort((x, y) => x.course - y.course);
    return rows;
  }

  // ===== UI helpers =====
  function setActive(el, on) { el.classList.toggle("active", !!on); }
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function updatePills() {
    els.monthPill.textContent = `MONTH: ${state.month}`;
    els.modePill.textContent = `MODE: ${state.baseMode ?? "--"}`;

    if (state.override) show(els.overridePill); else hide(els.overridePill);
    if (state.csvLoaded) show(els.csvLoadedPill); else hide(els.csvLoadedPill);

    els.buildLabel.textContent = `BUILD: ${BUILD_ID}`;
    els.dataMode.textContent = `${state.baseMode ?? "--"} MODE`;
    els.dataBin.textContent = `BIN ${state.currentBin}`;
  }

  function updateToggles() {
    setActive(els.bin1Btn, state.currentBin === 1);
    setActive(els.bin2Btn, state.currentBin === 2);

    setActive(els.mode25Btn, state.baseMode === 25);
    setActive(els.mode30Btn, state.baseMode === 30);

    setActive(els.tab501, state.rangeKey === "501-510");
    setActive(els.tab601, state.rangeKey === "601-619");
    setActive(els.tab621, state.rangeKey === "621-648");

    setActive(els.viewCards, state.view === "cards");
    setActive(els.viewPaper, state.view === "paper");
    setActive(els.viewData, state.view === "data");
  }

  function updateSummary() {
    const t = computeTotalsForCurrentBin();
    els.dryCases.textContent = `${t.dryCase} ケース`;
    els.dryBara.textContent = `バラ ${t.dryBara}`;
    els.coolCases.textContent = `${t.iceCase} ケース`;
    els.coolBara.textContent = `バラ ${t.iceBara} 枚`;
  }

  // ===== Duplicate check (course×bin) =====
  function isDuplicate(r) {
    return state.rows.some(x => x.id !== r.id && !x.deleted && x.course === r.course && x.bin === r.bin);
  }

  // ===== Render Cards =====
  function renderCardItem(r) {
    const mode = state.baseMode ?? state.monthMode ?? 25;
    const limit = cutLimit(mode);

    const dup = isDuplicate(r);
    const cutWarn = r.cut > limit;

    const div = document.createElement("div");
    div.className = "item";
    div.dataset.id = r.id;

    div.innerHTML = `
      <div class="top">
        <div class="course">${r.course}</div>
        <div class="bin">BIN ${r.bin}</div>
      </div>
      <div class="nums">
        <span class="badgeMini">〆 ${r.shime}</span>
        <span class="badgeMini ${cutWarn ? "warn" : ""}">cut ${r.cut}/${limit}</span>
        ${dup ? `<span class="badgeMini warn">重複</span>` : ``}
      </div>
      <div class="nums" style="margin-top:10px;opacity:.85;">
        <span class="badgeMini">蓄冷 ${courseIcePacks(r.course)}枚</span>
        <span class="badgeMini">G:${r.group}</span>
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" data-act="edit" type="button">編集</button>
        <button class="btn ghost" data-act="back" type="button">未振分へ</button>
        <button class="btn ghost" data-act="del" type="button">削除</button>
      </div>
      <div class="hint" style="margin-top:8px;">
        タップ移動は後で追加（いまはボタン操作で事故防止）
      </div>
    `;

    div.addEventListener("click", (ev) => {
      const act = ev.target?.dataset?.act;
      if (!act) return;

      if (act === "edit") openEdit(r.id);
      if (act === "back") moveToGroup(r.id, "未振り分け");
      if (act === "del") deleteOne(r.id);
    });

    return div;
  }

  function renderCards() {
    const rows = visibleRows();
    const groups = ["未振り分け","A","B","C","D","E"];

    const buckets = new Map(groups.map(g => [g, []]));
    for (const r of rows) {
      const g = buckets.has(r.group) ? r.group : "未振り分け";
      buckets.get(g).push(r);
    }

    // counts
    els.unassignedCount.textContent = `${buckets.get("未振り分け").length} 件`;
    els.groupACount.textContent = `${buckets.get("A").length} 件`;
    els.groupBCount.textContent = `${buckets.get("B").length} 件`;
    els.groupCCount.textContent = `${buckets.get("C").length} 件`;
    els.groupDCount.textContent = `${buckets.get("D").length} 件`;
    els.groupECount.textContent = `${buckets.get("E").length} 件`;

    // clear stacks
    els.groupUnassigned.innerHTML = "";
    els.groupA.innerHTML = "";
    els.groupB.innerHTML = "";
    els.groupC.innerHTML = "";
    els.groupD.innerHTML = "";
    els.groupE.innerHTML = "";

    for (const r of buckets.get("未振り分け")) els.groupUnassigned.appendChild(renderCardItem(r));
    for (const r of buckets.get("A")) els.groupA.appendChild(renderCardItem(r));
    for (const r of buckets.get("B")) els.groupB.appendChild(renderCardItem(r));
    for (const r of buckets.get("C")) els.groupC.appendChild(renderCardItem(r));
    for (const r of buckets.get("D")) els.groupD.appendChild(renderCardItem(r));
    for (const r of buckets.get("E")) els.groupE.appendChild(renderCardItem(r));
  }

  // ===== Render Deleted shelf =====
  function renderDeleted() {
    const deleted = state.rows
      .filter(r => r.bin === state.currentBin && r.deleted)
      .sort((a,b) => a.course - b.course);

    els.deletedCount.textContent = `${deleted.length} 件`;
    els.groupDeleted.innerHTML = "";

    if (deleted.length === 0) {
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "（削除なし）";
      els.groupDeleted.appendChild(p);
      return;
    }

    for (const r of deleted) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="top">
          <div class="course">${r.course}</div>
          <div class="bin">BIN ${r.bin}</div>
        </div>
        <div class="nums">
          <span class="badgeMini">〆 ${r.shime}</span>
          <span class="badgeMini">cut ${r.cut}</span>
          <span class="badgeMini">G:${r.group}</span>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn primary" data-act="restore" type="button">復活</button>
        </div>
      `;
      div.addEventListener("click", (ev) => {
        const act = ev.target?.dataset?.act;
        if (act === "restore") restoreOne(r.id);
      });
      els.groupDeleted.appendChild(div);
    }
  }

  // ===== Paper view =====
  function renderPaper() {
    const rows = visibleRows();
    const showCheck = !!els.paperChecklistToggle.checked;

    els.paperGrid.innerHTML = "";
    if (rows.length === 0) {
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "（表示対象なし）";
      els.paperGrid.appendChild(p);
      return;
    }

    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="top">
          <div class="course">${r.course}（BIN ${r.bin}）</div>
          <div class="bin">${r.group}</div>
        </div>
        <div class="nums">
          <span class="badgeMini">〆 ${r.shime}</span>
          <span class="badgeMini">cut ${r.cut}</span>
          <span class="badgeMini">蓄冷 ${courseIcePacks(r.course)}枚</span>
        </div>
        ${showCheck ? `
          <div class="row" style="margin-top:10px;">
            <label class="checkRow" style="color:#cbd5e1;">
              <input type="checkbox" data-check="${r.id}" ${r.checked ? "checked" : ""}/>
              <span>照合OK</span>
            </label>
          </div>
        ` : ``}
      `;
      els.paperGrid.appendChild(div);
    }

    if (showCheck) {
      els.paperGrid.addEventListener("change", (ev) => {
        const id = ev.target?.dataset?.check;
        if (!id) return;
        const rr = state.rows.find(x => x.id === id);
        if (!rr) return;
        rr.checked = !!ev.target.checked;
        persistCurrentBin();
        renderAll();
      }, { once: true });
    }
  }

  // ===== Data view =====
  function renderData() {
    const t = computeTotalsForCurrentBin();
    const payload = {
      build: BUILD_ID,
      today: state.today,
      weekId: state.weekId,
      month: state.month,
      bin: state.currentBin,
      mode: t.mode,
      override: state.override,
      range: state.rangeKey,
      search: state.search,
      csvLoaded: state.csvLoaded,
      totals: t,
      rows: state.rows,
    };
    els.dataCode.textContent = JSON.stringify(payload, null, 2);
  }

  // ===== View switching =====
  function setView(v) {
    state.view = v;
    // views
    $("cardsView").classList.toggle("active", v === "cards");
    $("paperView").classList.toggle("active", v === "paper");
    $("dataView").classList.toggle("active", v === "data");
    renderAll();
  }

  // ===== Actions =====
  function moveToGroup(id, group) {
    const r = state.rows.find(x => x.id === id);
    if (!r || r.deleted) return;
    r.group = group;
    persistCurrentBin();
    renderAll();
  }

  function deleteOne(id) {
    const r = state.rows.find(x => x.id === id);
    if (!r || r.deleted) return;
    const ok = confirm(`コース ${r.course}（BIN ${r.bin}）を削除棚へ移動します（復活可）。`);
    if (!ok) return;
    r.deleted = true;
    persistCurrentBin();
    renderAll();
  }

  function restoreOne(id) {
    const r = state.rows.find(x => x.id === id);
    if (!r) return;
    r.deleted = false;
    persistCurrentBin();
    renderAll();
  }

  function openEdit(id) {
    const r = state.rows.find(x => x.id === id);
    if (!r || r.deleted) return;

    const mode = state.baseMode ?? state.monthMode ?? 25;
    const limit = cutLimit(mode);

    const s = prompt(`編集：${r.course}（BIN ${r.bin}）\n〆 を入力（現在 ${r.shime}）`, String(r.shime));
    if (s === null) return;
    const c = prompt(`編集：${r.course}（BIN ${r.bin}）\ncut を入力（現在 ${r.cut} / 上限 ${limit}）`, String(r.cut));
    if (c === null) return;

    const ns = clampInt(s, NaN);
    const nc = clampInt(c, NaN);
    if (!Number.isFinite(ns) || !Number.isFinite(nc) || ns < 0 || nc < 0) {
      alert("数字（0以上）で入力してください");
      return;
    }

    r.shime = ns;
    r.cut = nc;
    persistCurrentBin();
    renderAll();
  }

  // ===== CSV apply =====
  function applyCSV() {
    clearError();
    const text = (els.csvInput.value || "").trim();
    if (!text) return showError("CSVが空です");

    let parsed;
    try {
      parsed = parseCSV(text);
    } catch (e) {
      return showError(e.message || "CSV解析エラー");
    }

    // CSVの基準が最優先
    state.baseMode = parsed.mode;
    state.override = false;
    localStorage.setItem(LS.OVERRIDE, "0");

    // 完成版思想：継ぎ足さない → 現在便に該当する行だけ置き換える、ではなく全体を置き換える
    // ただし便分離は維持：rowsにはbin1/bin2両方入る（合算しない）
    state.rows = parsed.rows.map(x => ({
      id: uuid(),
      course: x.course,
      bin: x.bin,
      shime: x.shime,
      cut: x.cut,
      group: "未振り分け",
      deleted: false,
      checked: false,
    }));

    state.csvLoaded = true;
    persistCurrentBin(); // 現在便のスナップ保存（週内）
    renderAll();
  }

  function clearCSV() {
    els.csvInput.value = "";
    clearError();
  }

  // ===== Navigation: bin/mode/range/search =====
  function setBin(bin) {
    state.currentBin = bin;
    // 保存を読み戻して表示（便分離）
    loadCurrentBin();
    renderAll();
  }

  function setModeManual(mode) {
    const ok = confirm(`期を ${mode} に変更します。\nCSV基準がある場合はCSVが最優先です。\n（手動変更＝OVERRIDE）`);
    if (!ok) return;

    state.baseMode = mode;
    state.override = true;
    localStorage.setItem(LS.MONTH_MODE, String(mode));
    localStorage.setItem(LS.OVERRIDE, "1");
    persistCurrentBin();
    renderAll();
  }

  function setRange(key) {
    state.rangeKey = key;
    // 範囲変更時は検索クリア（仕様）
    state.search = "";
    els.courseSearch.value = "";
    renderAll();
  }

  function setSearch(v) {
    const cleaned = String(v || "").replace(/[^\d]/g, "");
    state.search = cleaned;
    els.courseSearch.value = cleaned;
    renderAll();
  }

  // ===== Render all =====
  function renderAll() {
    updatePills();
    updateToggles();
    updateSummary();

    if (state.view === "cards") {
      renderCards();
      renderDeleted();
    } else if (state.view === "paper") {
      renderPaper();
    } else {
      renderData();
    }
  }

  // ===== Wire events =====
  function bindEvents() {
    // CSV
    els.applyCSV.addEventListener("click", applyCSV);
    els.clearCSV.addEventListener("click", clearCSV);

    // BIN
    els.bin1Btn.addEventListener("click", () => setBin(1));
    els.bin2Btn.addEventListener("click", () => setBin(2));

    // MODE
    els.mode25Btn.addEventListener("click", () => setModeManual(25));
    els.mode30Btn.addEventListener("click", () => setModeManual(30));

    // RANGE
    els.tab501.addEventListener("click", () => setRange("501-510"));
    els.tab601.addEventListener("click", () => setRange("601-619"));
    els.tab621.addEventListener("click", () => setRange("621-648"));

    // SEARCH
    els.courseSearch.addEventListener("input", () => setSearch(els.courseSearch.value));
    els.clearSearch.addEventListener("click", () => setSearch(""));

    // VIEW
    els.viewCards.addEventListener("click", () => setView("cards"));
    els.viewPaper.addEventListener("click", () => setView("paper"));
    els.viewData.addEventListener("click", () => setView("data"));

    // Paper checklist toggle redraw
    els.paperChecklistToggle.addEventListener("change", () => {
      if (state.view === "paper") renderAll();
    });

    // Add group (簡易：A〜E固定のまま。追加は後で拡張)
    els.addGroupBtn.addEventListener("click", () => {
      alert("グループ追加は次の版で入れる（今はA〜E固定で安定優先）");
    });

    // Add course (簡易：未振分に追加)
    els.addCourseBtn.addEventListener("click", () => {
      const c = prompt("追加するcourse番号（例 501）");
      if (c === null) return;
      const course = clampInt(c, NaN);
      if (!Number.isFinite(course)) return alert("数字で入力してください");

      const s = prompt("〆（例 1）", "0");
      if (s === null) return;
      const cut = prompt("cut（例 8）", "0");
      if (cut === null) return;

      const shimeN = clampInt(s, NaN);
      const cutN = clampInt(cut, NaN);
      if (!Number.isFinite(shimeN) || !Number.isFinite(cutN) || shimeN < 0 || cutN < 0) {
        return alert("数字（0以上）で入力してください");
      }

      state.rows.push({
        id: uuid(),
        course,
        bin: state.currentBin,
        shime: shimeN,
        cut: cutN,
        group: "未振り分け",
        deleted: false,
        checked: false,
      });

      state.csvLoaded = true;
      persistCurrentBin();
      renderAll();
    });
  }

  // ===== Init =====
  function init() {
    cacheEls();

    const now = new Date();
    state.today = isoDate(now);
    state.month = isoMonth(now);
    state.weekId = isoDate(mondayOfWeek(now));

    // weekly reset first
    ensureWeekReset();

    // month mode gate
    state.monthMode = ensureMonthMode();
    state.override = localStorage.getItem(LS.OVERRIDE) === "1";
    state.baseMode = state.monthMode;

    // default
    state.currentBin = 1;
    state.view = "cards";
    state.search = "";
    state.rangeKey = "501-510";

    // load saved bin state
    loadCurrentBin();

    bindEvents();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
