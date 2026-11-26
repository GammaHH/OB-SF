---
updated: 2026-11-21 17:59:47
created: 2026-11-21 16:31:36
---
> **注意：** OB-CLI 模板會產生附有獨立日誌的 PowerShell 指令。以下是方便手動操作的精簡版本，並未實際執行。標示 `<...>` 的部分需要替換為真實路徑或 ID。

# 一、OB-SF CLI 完整指令速查表

首先，在 PowerShell 切換至專案根目錄：

```powershell
Set-Location -LiteralPath 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF'
```

之後所有指令都可以使用相對路徑。

## 1. 基本操作與測試

| 功能 | 指令 | 說明 |
|---|---|---|
| 完整回歸測試 | `node scripts/ob-cli.cjs test` | 執行 OB-SF 全套測試 |
| 準備 Slimefun 原始碼 | `node scripts/ob-cli.cjs prepare-source` | 準備鎖定 Commit 的原始碼 |
| 讀取 Collection 設定 | `node scripts/ob-cli.cjs collections` | 檢查 Tag／Group 設定 |
| BIO 盤點 | `node scripts/ob-cli.cjs inventory` | 執行盤點 |
| BIO 盤點並寫報告 | `node scripts/ob-cli.cjs inventory --write` | 將盤點結果寫入報告 |

### 完整回歸測試

```powershell
node scripts/ob-cli.cjs test
```

這是你之前執行的完整測試入口。

### BIO 盤點

```powershell
node scripts/ob-cli.cjs inventory --write
```

用途是掃描正式 BIO 的身分與相關盤點資訊，不會將 Preview 發布成正式 BIO。

---

# 二、Slimefun Java Parser

## 2. 準備原始碼

```powershell
node scripts/ob-cli.cjs prepare-source
```

依照你的操作手冊，這個入口會準備：

```text
參考資料/Slimefun4-source
```

版本固定為：

```text
5374034c8713248909e60e6855c6f745fd7ca676
```

既有來源資料夾不會直接被覆寫。

## 3. 執行 Slimefun Parser

**指令格式：**

```powershell
node scripts/ob-cli.cjs parse --source=slimefun --source-root="<Slimefun 原始碼完整路徑>"
```

**實際範例：**

```powershell
node scripts/ob-cli.cjs parse --source=slimefun --source-root="C:\Users\Owner\.codex\worktrees\cee9\OB-SF\參考資料\Slimefun4-source"
```

執行後會建立 Parser Run，包含：

```text
review/
└── parser-runs/
    └── slimefun-<timestamp>/
        ├── Slimefun Recipe Manifest.md
        ├── AST JSON
        └── Normalized Recipes JSON
```

其中 AST 與 Normalized JSON 的實際檔名，以執行結果為準。

**注意：Parser 成功退出不等於所有 Java 配方都解析成功。** 仍需要查看 Manifest 中的 REVIEW、SPECIAL、UNSUPPORTED 等診斷。

---

# 三、Decision Review

這部分分成 Minecraft Review 與 Normalized JSON Review。

## 4. Minecraft Review

| 功能 | 指令 |
|---|---|
| 建立 Review Queue | `review scan --source=minecraft` |
| 啟用下一筆 | `review next --source=minecraft` |
| 重新計算 | `review recalculate --source=minecraft` |

### SCAN

```powershell
node scripts/ob-cli.cjs review scan --source=minecraft
```

### NEXT

```powershell
node scripts/ob-cli.cjs review next --source=minecraft
```

### RECALCULATE

```powershell
node scripts/ob-cli.cjs review recalculate --source=minecraft
```

一般使用順序：

```text
SCAN
  ↓
NEXT
  ↓
人工編輯 Review
  ↓
RECALCULATE
  ↓
READY
  ↓
NEXT
```

不是每次都必須重新 SCAN。

## 5. Normalized JSON Review

適用於 Slimefun Parser 或其他已完成標準化的資料。

**通用格式：**

```powershell
node scripts/ob-cli.cjs review <scan|start|next|recalculate|revoke> --normalized="<JSON 相對路徑>"
```

### SCAN

```powershell
node scripts/ob-cli.cjs review scan --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>"
```

### NEXT

```powershell
node scripts/ob-cli.cjs review next --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>"
```

### START

指定一筆目標時可直接 START，先用 `--dry-run` 查看切換結果。

```powershell
$Json = 'review/parser-runs/slimefun-preview-pilot-20261121-190853-110/Normalized Recipes.json'
node scripts/ob-cli.cjs review start --normalized="$Json" --target=slimefun:CARBON --dry-run
```

目前審核含待保存內容、已有手動編輯，或來自另一份來源時，START 會擋下切換。請先在 Obsidian 儲存編輯，再明確用 `--backup-current` 備份現有 Review 文件和狀態。CLI 能檢查已儲存在磁碟的內容。備份位置會顯示在輸出，位於 `review/normalized-start-backups/`。重開同一來源和目標會沿用目前審核。

```powershell
node scripts/ob-cli.cjs review start --normalized="$Json" --target=slimefun:CARBON --backup-current
```

START 保留既有 Decision Registry。針對同一份來源，上一筆已 RECALCULATE 為 READY 且頁面與保存的決策一致時，可直接 START 下一筆。

在 Obsidian 的閱讀模式開啟 `BIO Recipe Review.md`，即可用 DataviewJS 表單填寫中文名稱、正式資料夾並選擇採用路線。請先在 Dataview 設定啟用 JavaScript queries。按「儲存審核草稿」會更新同頁的 Markdown 欄位，再執行 RECALCULATE 寫入決策。配方來源與警告可在表單下方核對。

### RECALCULATE

```powershell
node scripts/ob-cli.cjs review recalculate --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>"
```

各審核操作應持續指定**同一份 Normalized JSON**。

Review Queue 的 `READY` 代表：

**配方決策完成，可以進入 Preview Generator，但還不能正式發布。**

Parser 的 `REVIEW` 仍記錄材料、設備或產量的來源不確定性。人工決策供 Preview 使用，原始 Normalized JSON 的狀態照原樣保留。

---

# 四、BIO Preview Generator

這是整套系統中最值得區分的部分。

現在主要有兩種情況：

1. 新物品：從 Normalized JSON 產生 Preview。
2. 已存在的正式 BIO：從 Formal BIO 增量產生 Update Preview。

## 6. Normalized JSON → BIO Preview

### A. 預演，不產生 Preview

**格式：**

```powershell
node scripts/ob-cli.cjs preview --normalized="<JSON 相對路徑>"
```

**範例：**

```powershell
node scripts/ob-cli.cjs preview --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>"
```

預設處理目前來源中已完成 Review 的目標。

### B. 正式產生 Preview

```powershell
node scripts/ob-cli.cjs preview --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>" --write
```

這裡的 `--write` 是**寫入 Preview**，不是發布正式 BIO。

### C. 指定單一物品

例如 Slimefun 的 Tin Can：

```powershell
node scripts/ob-cli.cjs preview --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>" --target=slimefun:CAN --write
```

適合單筆驗證，避免第一次就生成大量候選。

---

## 7. 更新已存在的正式 BIO

這個功能是後來新增的 `--from-formal`。

**指令格式：**

```powershell
node scripts/ob-cli.cjs preview --normalized="<JSON 相對路徑>" --from-formal --target=<物品ID>
```

### A. 預演

```powershell
node scripts/ob-cli.cjs preview --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>" --from-formal --target=slimefun:CAN
```

### B. 產生 Update Preview

```powershell
node scripts/ob-cli.cjs preview --normalized="review/parser-runs/<批次資料夾>/<Normalized JSON 檔名>" --from-formal --target=slimefun:CAN --write
```

主要行為：

- 保留正式 BIO 原有配方。
- 保留 Preferred。
- 保留人工圖文與備註。
- 依 Provider 與配方語意比對。
- 避免加入相同 Provider 的重複配方。
- 新的取得方式作為候選加入 Preview。

如果原本只有一條有效配方，新增後變成多條但沒有 Preferred，應交由人工決定。

**不要直接在正式 BIO 上執行未經審核的合併。**

---

# 五、BIO Preferred 全量稽核

這部分目前已經支援三種範圍。

## 8. Audit Preferred

| 掃描範圍 | 指令 |
|---|---|
| 正式 BIO | `audit-preferred --scope=formal` |
| Preview | `audit-preferred --scope=preview` |
| 全部 | `audit-preferred --scope=all` |

### A. 只掃描正式 BIO

```powershell
node scripts/ob-cli.cjs audit-preferred --scope=formal
```

也可以使用預設模式：

```powershell
node scripts/ob-cli.cjs audit-preferred
```

### B. 只掃描 Preview

```powershell
node scripts/ob-cli.cjs audit-preferred --scope=preview
```

### C. 同時掃描正式 BIO 與 Preview

```powershell
node scripts/ob-cli.cjs audit-preferred --scope=all
```

報告輸出格式：

```text
review/BIO Preferred Audit-<scope>-<timestamp>.md
```

目前 Markdown 明細只列出**沒有有效 Preferred 的 BIO**，摘要則保留完整統計。

注意：此稽核只讀取 BIO、寫入報告，不修改正式 BIO。

退出碼 `2` 代表掃描時存在讀取不完整的情況。

---

# 六、Publication：掃描、發布、封存

這個階段需要：

```text
BIO Publication.json
```

**非常重要：以下三個作業必須使用同一個 Publication Manifest。**

為避免每次複製很長的路徑，可以先在 PowerShell 設定：

```powershell
$Manifest = '@自動化BIO Preview/plugin/<批次資料夾>/BIO Publication.json'
```

其中 `<批次資料夾>` 要替換成 Generator 實際輸出的路徑。

## 9. Publication SCAN

**格式：**

```powershell
node scripts/ob-cli.cjs scan-publication --manifest="<BIO Publication.json 路徑>"
```

**範例：**

```powershell
node scripts/ob-cli.cjs scan-publication --manifest="$Manifest"
```

檢查項目包含：

- Preview 配方。
- Preferred。
- 材料引用。
- 正式 BIO 差異。
- Source Fingerprint。
- 依賴關係。
- 設備循環。
- 發布條件。

此指令沒有 `--write` 模式。

不過它也不是完全唯讀：依你的操作手冊，集中 SCAN 可能建立報告、材料 Base Preview 或補完特定欄位。

### READY 的意義

Publication SCAN `READY` 表示：

**候選已通過發布審核，可以進入 PUBLISH。**

與 Review Queue READY 不同。

---

## 10. PUBLISH 預演

```powershell
node scripts/ob-cli.cjs publish --manifest="$Manifest"
```

不加 `--write`，代表預演。

建議每次正式發布前執行一次。

## 11. 正式 PUBLISH

```powershell
node scripts/ob-cli.cjs publish --manifest="$Manifest" --write
```

這才會正式寫入 BIO 資料庫。

成功後需要確認：

```text
Publication Receipt
Status: COMPLETE
```

並在 V4 RELOAD 後確認配方。

---

## 12. ARCHIVE 預演

```powershell
node scripts/ob-cli.cjs archive-publication --manifest="$Manifest"
```

此階段會檢查封存條件。

包括是否具有完整發布收據，以及已發布檔案是否發生變更。

## 13. 正式 ARCHIVE

```powershell
node scripts/ob-cli.cjs archive-publication --manifest="$Manifest" --write
```

正式封存已完成發布的 Preview Batch。

依目前流程，封存資料會放在：

```text
review/bio-published-previews/
```

標準化來源快照仍留在參考資料中。

---

# 七、Vanilla 傳統 CLI

這是仍保留的舊版入口。

與上面的 `scripts/ob-cli.cjs` 不同，以下直接使用：

```text
scripts/minecraft-bio-generator.cjs
```

## 14. Vanilla 單筆 Preview

```powershell
node scripts/minecraft-bio-generator.cjs preview minecraft:piston
```

## 15. Vanilla 單筆 Preview 預演

```powershell
node scripts/minecraft-bio-generator.cjs preview minecraft:piston --dry-run
```

## 16. Vanilla 全量 Preview

```powershell
node scripts/minecraft-bio-generator.cjs preview --all
```

⚠️ `--all` 處理範圍較大，建議先確認輸出目錄、待處理的目標與是否會產生大量候選。

## 17. 更新已存在的 Vanilla BIO

```powershell
node scripts/minecraft-bio-generator.cjs preview minecraft:piston --update-existing
```

也可以一次指定多個：

```powershell
node scripts/minecraft-bio-generator.cjs preview minecraft:piston minecraft:stick --update-existing
```

根據你最新的測試結果，Vanilla 更新已經朝向與 Normalized Generator 一致的追加規則。

但這個指令仍屬於 Vanilla 傳統入口。

## 18. 更新既有 Preview Batch

**格式：**

```powershell
node scripts/minecraft-bio-generator.cjs refresh-batch --manifest="<Manifest 路徑>" <Preview檔名> --write
```

**範例：**

```powershell
node scripts/minecraft-bio-generator.cjs refresh-batch --manifest="$Manifest" "Piston.update-preview.md" --write
```

這裡的檔名只是示意，必須改成 Manifest 中實際存在的 Preview 檔名。

如果要更新 Collection：

```powershell
node scripts/minecraft-bio-generator.cjs refresh-batch --manifest="$Manifest" --collections --write
```

不帶 `--write` 則是預演。

---

# 八、舊版 Minecraft Review 指令

如果需要直接操作傳統 Review CLI，入口為：

```text
scripts/minecraft-review.cjs
```

| 功能 | 指令 |
|---|---|
| 掃描缺少 BIO 的目標 | `node scripts/minecraft-review.cjs scan` |
| 掃描所有目標 | `node scripts/minecraft-review.cjs scan --all` |
| 下一筆審核 | `node scripts/minecraft-review.cjs next` |
| 重新計算 | `node scripts/minecraft-review.cjs recalculate` |
| 指定目標開始審核 | `node scripts/minecraft-review.cjs start minecraft:piston` |
| 撤銷決策 | `node scripts/minecraft-review.cjs revoke <decision-id>` |
| 重新開啟決策 | `node scripts/minecraft-review.cjs reopen <decision-id> --target=minecraft:piston` |

這些是先前 `minecraft-review.cjs` 的既有指令。

目前你已經有通用 OB-CLI，所以**日常操作優先使用 `scripts/ob-cli.cjs`，避免混用不同 Review 工作區與來源設定**。

---

# 九、最常用的完整工作流程

如果要把這些指令串起來，我會建議你記住三套流程。

## A. Slimefun 新物品批量產生

```text
prepare-source
       ↓
parse --source=slimefun
       ↓
review scan --normalized=...
       ↓
review next --normalized=...
       ↓
人工填寫 Review
       ↓
review recalculate --normalized=...
       ↓
Review Queue READY
       ↓
preview --normalized=... --write
       ↓
人工檢查 Preview
       ↓
scan-publication --manifest=...
       ↓
Publication READY
       ↓
publish --manifest=...
       ↓
publish --manifest=... --write
       ↓
archive-publication --manifest=...
       ↓
archive-publication --manifest=... --write
```

## B. 既有 BIO 新增取得方式

```text
New Normalized Recipes
           +
Existing Formal BIO
           ↓
preview --normalized=... --from-formal --target=...
           ↓
preview --normalized=... --from-formal --target=... --write
           ↓
Update Preview
           ↓
人工確認新增路線
           ↓
audit-preferred --scope=preview
           ↓
scan-publication
           ↓
publish
           ↓
archive-publication
```

## C. 定期檢查整個 BIO 資料庫

```powershell
# 盤點正式 BIO
node scripts/ob-cli.cjs inventory --write

# 稽核正式 BIO 的 Preferred
node scripts/ob-cli.cjs audit-preferred --scope=formal

# 稽核所有正式與候選 BIO
node scripts/ob-cli.cjs audit-preferred --scope=all

# 完整回歸測試
node scripts/ob-cli.cjs test
```

---

# 十、`--write` 到底代表什麼？

這是整套系統最容易搞混的參數。

| 指令 | 不加 `--write` | 加上 `--write` |
|---|---|---|
| `inventory` | 盤點 | 寫入盤點報告 |
| `preview --normalized` | 預演 | **建立 Preview** |
| `preview --from-formal` | 預演 | **建立 Update Preview** |
| `refresh-batch` | 預演 | 更新 Preview Batch |
| `publish` | 預演 | **正式發布 BIO** |
| `archive-publication` | 預演 | **正式封存** |
| `audit-preferred` | 掃描並寫報告 | 不使用此參數 |
| `scan-publication` | 掃描並更新必要的審核產物 | 不使用此參數 |

因此不能單純認為 `--write` 都代表正式發布。

**真正會寫入正式 BIO 的是 `publish --write`。**

---

## 我的建議：OB-CLI 可以再簡化成三大區域

你目前功能已經很多了，我認為日後選單可以按照工作階段區分：

| 區域 | 包含功能 |
|---|---|
| **SOURCE & REVIEW** | Prepare、Parse、Review、Collection |
| **PREVIEW & AUDIT** | Preview、From Formal、Inventory、Preferred Audit |
| **PUBLICATION** | Scan、Publish、Archive |

另外保留 Test 作為獨立入口。

這樣操作時不需要記住全部指令，只需要知道自己目前處於哪個階段。

**最重要的是記住兩個 READY：Review READY 才能產生 Preview；Publication READY 才能發布正式 BIO。**
