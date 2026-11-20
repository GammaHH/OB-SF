---
created: 2026-08-21 14:04
updated: 2026-08-21 14:05
---
# Templater Parser Characterization Tests

這組測試直接執行現有 Templater 模板中的 JavaScript，不複製或重寫正式 Regex parser。

Node harness 只模擬 Obsidian／Templater 邊界：

- `tp.system.prompt`、`tp.system.suggester`
- `app.vault.adapter.list/read/exists`
- `app.vault.getMarkdownFiles()` 與 `metadataCache`
- `TFolder` 與 `tp.file.create_new`

Fixtures 全部來自目前 Vault：`參考資料`內的 Java/YAML source，以及已提交的 BIO Markdown。測試比較 parser 管理的欄位和 Dataview inline fields；人工圖片、時間戳、說明文字不列入比較。

執行：

```powershell
node --test tests/templater-characterization/slimefun-parsers.test.cjs
```

批次比較目前所有能在「參考資料」頂層 source 找到的 `sf-item` BIO：

```powershell
node tests/templater-characterization/compare-existing-bios.cjs
```

批次程式只輸出統計摘要與失敗／差異案例；預設最多顯示 30 筆，可用 `--max-failures=10` 調整。`no-direct-source` 表示現行模板的頂層掃描範圍內找不到該 ID，不會猜測其他來源。

測試不會寫入 Vault，也不依賴 Obsidian 正在執行。
