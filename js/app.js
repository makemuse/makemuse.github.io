/* =========================================================
   MAKE MUSE - 静的メイクピン キュレーション
   サーバー不要。data/pins.json と data/synonyms.json を読むだけ。
   ========================================================= */
(function () {
  "use strict";

  // ---------- 設定 ----------
  const CONFIG = {
    perPage: 12,              // 1ページの件数
    inFeedAdEvery: 6,         // 何件ごとにインフィード広告枠を挟むか（0で無効）
    showAdPlaceholders: true, // 広告枠の点線プレースホルダーを表示（本番では false 推奨）
    tagCollapseCount: 14,     // これを超えるタグ数なら「もっと見る」で折りたたむ
    embedTimeoutMs: 7000,     // この時間で埋め込みが出なければ代替表示
    pinWidth: "medium",       // small / medium / large
  };

  // ---------- 状態 ----------
  const state = {
    pins: [],
    groups: [],        // 言い換えグループ（正規化済み）
    tagCounts: new Map(),
    query: "",
    selected: new Set(),
    page: 1,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $("search-input"),
    clear: $("search-clear"),
    hint: $("search-hint"),
    tagList: $("tag-list"),
    tagsReset: $("tags-reset"),
    tagsMore: $("tags-more"),
    count: $("result-count"),
    grid: $("pin-grid"),
    empty: $("empty"),
    pager: $("pager"),
  };

  // ---------- ユーティリティ ----------
  // 全角/半角・大文字小文字・カタカナ/ひらがな・先頭#を吸収して比較用文字列にする
  function norm(s) {
    return String(s || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || "")) ? u : "";
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- 言い換え ----------
  // synonyms.json: { "一重": ["奥二重", "ひとえ"], ... }
  // キーと値はすべて同じグループとして扱う（双方向）。
  function buildGroups(syn) {
    return Object.entries(syn || {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [...new Set([k, ...(Array.isArray(v) ? v : [])].map(norm).filter(Boolean))]);
  }

  // 1つの検索語 → 一緒に検索すべき語の集合（正規化済み）
  function expandTerm(term) {
    const t = norm(term);
    const words = new Set([t]);
    if (!t) return words;
    // 辞書に完全一致する語があればそのグループだけを使う（「韓国眉」で #韓国メイク まで広がらないように）
    const exact = state.groups.filter((g) => g.includes(t));
    const hit = exact.length ? exact : state.groups.filter((g) =>
      g.some((w) => w.includes(t) || (w.length >= 2 && t.includes(w))));
    hit.forEach((g) => g.forEach((w) => words.add(w)));
    return words;
  }

  function tagMatchesWords(tagNorm, words) {
    for (const w of words) {
      if (tagNorm.includes(w) || (tagNorm.length >= 2 && w.includes(tagNorm))) return true;
    }
    return false;
  }

  function parseTerms(q) {
    return String(q || "").split(/[\s　,、]+/).map((s) => s.trim()).filter(Boolean);
  }

  // ---------- 絞り込み ----------
  function filterPins() {
    const terms = parseTerms(state.query).map((t) => ({ raw: t, n: norm(t), words: expandTerm(t) }));
    const sel = [...state.selected];

    return state.pins.filter((p) => {
      if (!sel.every((t) => p.tags.includes(t))) return false; // タグAND
      return terms.every((term) =>                                 // 検索語もAND
        p._tagsNorm.some((tn) => tagMatchesWords(tn, term.words)) ||
        (term.n && p._cosmeNorm.includes(term.n))
      );
    });
  }

  // 検索語が言い換えで拡張されたタグ（ヒント表示用）
  function expandedTagsFor(term) {
    const words = expandTerm(term);
    const n = norm(term);
    return [...state.tagCounts.keys()].filter((tag) => {
      const tn = norm(tag);
      return tagMatchesWords(tn, words) && tn !== n;
    });
  }

  // 0件のときの関連タグ提案
  function suggestTags() {
    const scores = new Map();
    const add = (tag, s) => {
      if (state.selected.has(tag)) return;
      scores.set(tag, (scores.get(tag) || 0) + s);
    };

    // 1) 検索語の言い換え先・部分一致タグ
    for (const term of parseTerms(state.query)) {
      const words = expandTerm(term);
      for (const tag of state.tagCounts.keys()) {
        if (tagMatchesWords(norm(tag), words)) add(tag, 10);
      }
    }
    // 2) 選択中タグと一緒に付いていることが多いタグ
    for (const p of state.pins) {
      const hit = [...state.selected].filter((t) => p.tags.includes(t)).length;
      if (hit) p.tags.forEach((t) => add(t, hit));
    }
    // 3) 足りなければ人気タグ
    if (scores.size < 4) {
      [...state.tagCounts.entries()].sort((a, b) => b[1] - a[1])
        .slice(0, 8).forEach(([t]) => add(t, 0.1));
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || (state.tagCounts.get(b[0]) || 0) - (state.tagCounts.get(a[0]) || 0))
      .slice(0, 8)
      .map(([t]) => t);
  }

  // ---------- URL状態（共有・戻るボタン対応） ----------
  function readURL() {
    const sp = new URLSearchParams(location.search);
    state.query = sp.get("q") || "";
    state.selected = new Set(sp.getAll("tag").filter((t) => state.tagCounts.has(t)));
    state.page = Math.max(1, parseInt(sp.get("page"), 10) || 1);
    el.input.value = state.query;
  }

  function writeURL(push) {
    const sp = new URLSearchParams();
    if (state.query) sp.set("q", state.query);
    state.selected.forEach((t) => sp.append("tag", t));
    if (state.page > 1) sp.set("page", state.page);
    const qs = sp.toString();
    const url = location.pathname + (qs ? "?" + qs : "");
    history[push ? "pushState" : "replaceState"](null, "", url);
  }

  // ---------- 描画 ----------
  function renderHint() {
    const terms = parseTerms(state.query);
    el.clear.hidden = !state.query;
    if (!terms.length) { el.hint.textContent = ""; return; }
    const parts = terms.map((t) => {
      const ex = expandedTagsFor(t);
      return ex.length
        ? `「${esc(t)}」→ <b>${ex.slice(0, 5).map((x) => "#" + esc(x)).join(" ")}</b>`
        : null;
    }).filter(Boolean);
    el.hint.innerHTML = parts.length ? parts.join("　") + " も含めて検索中" : "";
  }

  let tagsExpanded = false;
  function renderTags(available) {
    // 選択中 → 今の結果で押せるタグ → 押せないタグ の順。各グループ内は件数順
    const rank = (t) => (state.selected.has(t) ? 0 : available.get(t) ? 1 : 2);
    const tags = [...state.tagCounts.entries()].sort((a, b) =>
      rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
    el.tagList.innerHTML = tags.map(([tag, c]) => {
      const on = state.selected.has(tag);
      const n = available.get(tag) || 0;
      const dis = !on && n === 0;
      return `<button type="button" class="tag-chip" data-tag="${esc(tag)}" aria-pressed="${on}"${dis ? " disabled" : ""}>#${esc(tag)}<span class="count">${on ? c : n}</span></button>`;
    }).join("");
    el.tagsReset.hidden = state.selected.size === 0;

    const collapsible = tags.length > CONFIG.tagCollapseCount;
    el.tagsMore.hidden = !collapsible;
    el.tagList.classList.toggle("is-collapsed", collapsible && !tagsExpanded);
    el.tagsMore.textContent = tagsExpanded ? "閉じる" : "もっと見る";
  }

  function cardHTML(p) {
    const url = safeUrl(p.url);
    const tags = p.tags.map((t) =>
      `<li><button type="button" class="card-tag${state.selected.has(t) ? " is-active" : ""}" data-tag="${esc(t)}">#${esc(t)}</button></li>`
    ).join("");

    let cosme = "";
    if (p.cosme) {
      const aff = safeUrl(p.cosmeUrl);
      cosme = `<p class="cosme"><span class="label">使用コスメ</span><span class="cosme-name">${esc(p.cosme)}</span>${
        aff ? `<a class="affiliate-btn" href="${esc(aff)}" target="_blank" rel="sponsored noopener">このコスメをチェック<span class="pr">PR</span></a>` : ""
      }</p>`;
    }

    return `<article class="card">
      <div class="pin-wrap" data-url="${esc(url)}">
        <a data-pin-do="embedPin" data-pin-width="${CONFIG.pinWidth}" data-pin-lang="ja" href="${esc(url)}"></a>
      </div>
      <div class="card-body">
        <ul class="card-tags">${tags}</ul>
        ${p.comment ? `<p class="comment"><span class="label">監修</span>${esc(p.comment)}</p>` : ""}
        ${cosme}
        <!-- アフィリエイト枠（カード単位）: 必要ならここに楽天/Amazonリンク等 -->
      </div>
    </article>`;
  }

  function adHTML(name) {
    // AdSenseを貼るときはこの中に <ins class="adsbygoogle" ...> を入れる
    return `<aside class="ad-slot ad-slot--infeed" data-ad="${name}" aria-label="広告"></aside>`;
  }

  function renderPager(total, pages) {
    if (pages <= 1) { el.pager.innerHTML = ""; return; }
    const cur = state.page;
    const nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - cur) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== "…") nums.push("…");
    }
    el.pager.innerHTML =
      `<button type="button" data-page="${cur - 1}" ${cur === 1 ? "disabled" : ""} aria-label="前のページ">‹</button>` +
      nums.map((n) => n === "…"
        ? `<span class="gap">…</span>`
        : `<button type="button" data-page="${n}"${n === cur ? ' aria-current="page"' : ""}>${n}</button>`
      ).join("") +
      `<button type="button" data-page="${cur + 1}" ${cur === pages ? "disabled" : ""} aria-label="次のページ">›</button>`;
  }

  function renderEmpty() {
    const sugg = suggestTags();
    el.empty.innerHTML = `
      <p class="empty-title">該当するメイクが見つかりませんでした</p>
      <p class="empty-sub">こちらのタグはいかがですか？</p>
      <div class="suggest-list">${sugg.map((t) =>
        `<button type="button" class="tag-chip" data-suggest="${esc(t)}">#${esc(t)}<span class="count">${state.tagCounts.get(t) || 0}</span></button>`
      ).join("")}</div>`;
  }

  function render() {
    const results = filterPins();
    const pages = Math.max(1, Math.ceil(results.length / CONFIG.perPage));
    if (state.page > pages) state.page = pages;

    // 現在の結果内でのタグ件数（押しても0件になるタグはグレーアウト）
    const available = new Map();
    results.forEach((p) => p.tags.forEach((t) => available.set(t, (available.get(t) || 0) + 1)));

    renderHint();
    renderTags(available);

    if (!results.length) {
      el.count.textContent = "0件";
      el.grid.innerHTML = "";
      el.pager.innerHTML = "";
      renderEmpty();
      el.empty.hidden = false;
      return;
    }

    el.empty.hidden = true;
    const start = (state.page - 1) * CONFIG.perPage;
    const slice = results.slice(start, start + CONFIG.perPage);
    el.count.textContent = `${results.length}件のメイク` + (pages > 1 ? `（${state.page} / ${pages}ページ）` : "");

    let html = "";
    slice.forEach((p, i) => {
      html += cardHTML(p);
      if (CONFIG.inFeedAdEvery && (i + 1) % CONFIG.inFeedAdEvery === 0 && i + 1 < slice.length) {
        html += adHTML("in-feed");
      }
    });
    el.grid.innerHTML = html;
    renderPager(results.length, pages);
    buildPins();
  }

  // ---------- Pinterest埋め込み ----------
  let fallbackTimer;
  function buildPins() {
    if (typeof window.parsePins === "function") window.parsePins(el.grid);
    else if (window.PinUtils && typeof window.PinUtils.build === "function") window.PinUtils.build();
    // pinit.js がまだ読み込まれていなければ、読み込み時に自動で描画される

    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(applyFallbacks, CONFIG.embedTimeoutMs);
  }

  // 埋め込みが表示されなかったピン（削除済み・非公開・ダミーURL・広告ブロック等）に代替表示
  function applyFallbacks() {
    el.grid.querySelectorAll(".pin-wrap").forEach((w) => {
      if (w.querySelector(".pin-fallback")) return;
      const rendered = w.querySelector("span[data-pin-id], span[class*='_embed_'], iframe, span[data-pin-log]");
      if (rendered && w.offsetHeight > 140) return;
      const url = w.dataset.url;
      w.innerHTML = `<div class="pin-fallback">
        <span class="fb-title">MAKE MUSE</span>
        <span>ピン画像を読み込めませんでした</span>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Pinterestで見る</a>` : ""}
      </div>`;
    });
  }

  // ---------- イベント ----------
  function setPage(n, push) {
    state.page = n;
    writeURL(push);
    render();
  }

  function toggleTag(tag) {
    state.selected.has(tag) ? state.selected.delete(tag) : state.selected.add(tag);
    setPage(1, true);
  }

  function bindEvents() {
    el.input.addEventListener("input", debounce(() => {
      state.query = el.input.value.trim();
      setPage(1, false);
    }, 200));
    el.input.addEventListener("keydown", (e) => { if (e.key === "Enter") el.input.blur(); });

    el.clear.addEventListener("click", () => {
      el.input.value = ""; state.query = "";
      setPage(1, true);
      el.input.focus();
    });

    el.tagList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tag]");
      if (b && !b.disabled) toggleTag(b.dataset.tag);
    });
    el.tagsReset.addEventListener("click", () => { state.selected.clear(); setPage(1, true); });
    el.tagsMore.addEventListener("click", () => {
      tagsExpanded = !tagsExpanded;
      el.tagList.classList.toggle("is-collapsed", !tagsExpanded);
      el.tagsMore.textContent = tagsExpanded ? "閉じる" : "もっと見る";
    });

    // カード内のタグ → そのタグを追加/解除
    el.grid.addEventListener("click", (e) => {
      const b = e.target.closest(".card-tag");
      if (b) { toggleTag(b.dataset.tag); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });

    // 0件時の提案タグ → そのタグだけで検索し直す
    el.empty.addEventListener("click", (e) => {
      const b = e.target.closest("[data-suggest]");
      if (!b) return;
      state.query = ""; el.input.value = "";
      state.selected = new Set([b.dataset.suggest]);
      setPage(1, true);
    });

    el.pager.addEventListener("click", (e) => {
      const b = e.target.closest("[data-page]");
      if (!b || b.disabled) return;
      setPage(parseInt(b.dataset.page, 10), true);
      document.querySelector(".results").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    window.addEventListener("popstate", () => { readURL(); render(); });
  }

  // ---------- 起動 ----------
  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function init() {
    if (CONFIG.showAdPlaceholders) document.body.classList.add("show-ad-ph");
    try {
      const [pins, syn] = await Promise.all([
        loadJSON("data/pins.json"),
        loadJSON("data/synonyms.json").catch(() => ({})),
      ]);
      state.pins = (Array.isArray(pins) ? pins : []).filter((p) => p && p.url).map((p) => {
        const tags = [...new Set((p.tags || []).map((t) => String(t).replace(/^#+/, "").trim()).filter(Boolean))];
        return { ...p, tags, _tagsNorm: tags.map(norm), _cosmeNorm: norm(p.cosme) };
      });
      state.groups = buildGroups(syn);
      state.pins.forEach((p) => p.tags.forEach((t) => state.tagCounts.set(t, (state.tagCounts.get(t) || 0) + 1)));
    } catch (err) {
      console.error(err);
      el.count.textContent = "データを読み込めませんでした。（ローカルで開く場合は README の「ローカル確認」を参照）";
      return;
    }
    bindEvents();
    readURL();
    render();
  }

  init();
})();
