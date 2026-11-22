/* =========================================================
   MAKE MUSE - 用語まとめのページ内検索
   本文は glossary.html に直接書いてあり、ここでは表示/非表示だけを切り替える。
   ========================================================= */
(function () {
  "use strict";

  // 全角/半角・大文字小文字・カタカナ/ひらがな・空白の違いを吸収（app.js と同じ考え方）
  function norm(s) {
    return String(s || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/^#+/, "")
      .replace(/[\s・、,]+/g, "");
  }

  const input = document.getElementById("gl-q");
  const count = document.getElementById("gl-count");
  const empty = document.getElementById("gl-empty");
  const terms = [...document.querySelectorAll(".term")];
  const cats = [...document.querySelectorAll(".gl-cat")];
  if (!input || !terms.length) return;

  // 検索対象：用語名・読み・中国語・韓国語（data-search）
  const index = terms.map((t) => norm(t.dataset.search || ""));

  function apply() {
    const words = input.value.split(/[\s　]+/).map(norm).filter(Boolean);
    let shown = 0;
    terms.forEach((t, i) => {
      const hit = words.every((w) => index[i].includes(w));
      t.hidden = !hit;
      if (hit) shown++;
    });
    cats.forEach((c) => { c.hidden = !c.querySelector(".term:not([hidden])"); });
    empty.hidden = shown > 0;
    count.textContent = words.length ? `${shown}語が見つかりました` : `${terms.length}語`;
  }

  input.addEventListener("input", apply);

  // ページ内リンク（関連語・分類）で飛ぶときは、絞り込みを解除してから移動する
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !input.value) return;
    input.value = "";
    apply();
  });
})();
