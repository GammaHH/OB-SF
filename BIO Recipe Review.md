---
type: bio-recipe-review
source_adapter: normalized
sourceFingerprint: sha256:e75b4aeff9f95479e15776d473280e6f42b45542fb255c09155263c750f222ef
---

# BIO Recipe Review

逐項填入名稱與正式資料夾，並選一條路線。勾選配方表示已閱讀來源、layout 與 warnings；不會把未知配方自動當作 Base。

```dataviewjs
const helper = { exports: {} };
new Function('module', await app.vault.adapter.read('BIO engine/normalized_review_form.js'))(helper);
await helper.exports.renderReviewForm(app, dv, "slimefun4");
```

<!-- obsf:normalized-item c2xpbWVmdW46Q0FSQk9O -->
## slimefun:CARBON
- 中文名稱：
- 正式資料夾：
- 外部取得說明：
- [ ] 改採人工確認的外部取得 <!-- obsf:normalized-external -->
- [ ] `recipe-5cdca9f50fd45402b0d98688` COMPRESSOR → 1 <!-- obsf:normalized-recipe recipe-5cdca9f50fd45402b0d98688 -->
  - 狀態：REVIEW；layout：unknown
  - 材料：minecraft:coal ×8
  - 來源：io/github/thebusybiscuit/slimefun4/implementation/setup/SlimefunItemSetup.java:624
  - 提醒：配方 layout 語意待人工確認；保留原始 slots
<!-- obsf:normalized-item-end -->

