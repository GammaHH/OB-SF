---
title: OB-SF Slimefun4 Java Parser MASTER NOTE｜整合更新版
project: OB-SF
source_adapter: slimefun-java-v1
source_commit: 5374034c8713248909e60e6855c6f745fd7ca676
updated: 2026-11-21 20:28:58
status: pilot-review-in-progress
created: 2026-11-21 16:26:44
---

> **這是以四份既有技術文件為基礎，結合 2026-11-21 後續實測與對話進度重新整理的工作主檔。**「已測」和「已實作、待測」嚴格分開。本文件不修改 Parser、正式 BIO、Decision Registry 或 Publication；僅整合文件。

## 0. 專案現在在哪裡（2026-11-21）

| 項目 | 可確認狀態 | 補充 |
|---|---|---|
| 固定來源 | Slimefun4 experimental commit `5374034c8713248909e60e6855c6f745fd7ca676` | Parser 拒絕未核對的 checkout |
| JDK AST | 665 個 Java files、547 個 `.register(...)` 語法呼叫、0 syntax errors | `.register` 包含內部 API 呼叫，不等於 547 種可製作物品 |
| V1.1 身分解析 | 修正**前** 412／547 個原始呼叫可辨識物品 ID，V1 為 126／547 | 75.3% 是 **ID 識別率**，不是完整配方成功率 |
| Hook 過度阻擋 | 已定位 35 條真正回歸，程式已修正 | **35 條恢復數尚未在使用者提供的輸出中確認** |
| Hook 修正後測試 | **341／341 pass，0 fail、0 skip、0 cancelled** | 此為 Hook 修正後測試，不等於後續 START 功能的完整測試已通過 |
| Hook 修正後 Parser | 已有 `slimefun-preview-pilot-20261121-190853-110` 的新 Normalized JSON | 已貼出三個樣本；**尚無完整統計與 35 條恢復計數** |
| 樣本解析 | `CARBON`、`STEEL_INGOT`、`BATTERY` 的來源類型、材料總數與產量符合 Java 核對基準 | 三個樣本仍為 Parser `REVIEW`；BATTERY 的九格 `slots` 仍需核對 |
| Normalized Review START | 已新增 `review start --normalized=... --target=...`、`--dry-run`、`--backup-current` | Codex 回報已實作及補測；**尚未提供新 START 測試結果** |
| CARBON Preview | 目前執行時回報「目標尚未完成目前來源的 Review」 | **Review Queue 尚未 READY，不能直接 Preview** |
| 正式發布 | 未見這一輪 Slimefun 的 Publication SCAN／PUBLISH／ARCHIVE 完成證據 | 不可把已解析、Review READY 或 Preview 等同正式發布 |

### 目前最近一次 Preview 錯誤

```powershell
node scripts/ob-cli.cjs preview --normalized="$Json" --target=slimefun:CARBON
# ERROR: 目標尚未完成目前來源的 Review：slimefun:CARBON
```

**診斷：**這是 **Normalized Decision Review／READY gate**，不是找不到物品或 Parser 沒有 `CARBON`。`CARBON` 已存在於新 Normalized JSON 中，但尚未在**同一來源 fingerprint** 下完成 `recalculate` 所需的人工決策。`--dry-run` 僅預演 START，不啟用目標、不使 Queue READY。

## 1. 架構總覽與唯一真實資料來源

```text
Slimefun4 pinned Java sources
      └─ JDK JavacTask.parse() / AST (不 analyze、不執行插件)
           └─ Parser / Constructor & Identity Resolver
                ├─ Java AST.json
                ├─ Normalized Recipes.json (schemaVersion 1)
                └─ Slimefun Recipe Manifest.md (REVIEW / UNSUPPORTED / SPECIAL)
                     ↓ 可靜態證明的候選 + 原始證據
Normalized Review（共用 Decision Registry；各來源 fingerprint）
    └─ START / SCAN / RECALCULATE / NEXT
         └─ Review Queue READY（**只保證此目標決策完成**）
              └─ Preview dry-run → Preview --write
                   └─ 人工核對 / Preferred Audit
                        └─ Publication SCAN READY
                             └─ PUBLISH（預演 → --write）
                                  └─ 收據 COMPLETE → ARCHIVE
                                       └─ 正式 BIO → V4 Reader
```

- `Parser REVIEW`：原始 Java 語意需要核對；**不等於** `Review Queue READY`。人工決策可以使 Queue READY，但不能倒寫 Parser 的不確定性。
- `Review Queue READY`：僅允許進入 Preview；**不等於** `Publication SCAN READY`。
- `Publication SCAN READY`：只對某個驗證批次與其輸入 fingerprint 有效；修改 Review Registry、Mapping 或正式依賴後應重新 SCAN。
- 原始碼、Normalized Recipe、Decision Registry、正式 BIO、Provider Mapping 互相不同；不可從 `ItemGroup` 猜 Provider，或把設備當成物品類別。

## 2. 固定來源、AST 與 Parser V1 → V1.1

### 2.1 來源與程式

- 官方 repo：`Slimefun/Slimefun4`，鎖定 experimental commit `5374034c8713248909e60e6855c6f745fd7ca676`。
- Checkout：`參考資料/Slimefun4-source`。`scripts/slimefun-parser.cjs` 應先檢查 commit 與工作樹乾淨。
- AST helper：`scripts/java/SlimefunAst.java`；透過 `JavacTask.parse()` 只解析語法樹，記錄 class、field、constructor、expression、registration、source file／line、control-flow context。
- Parser：`BIO相關模組/Slimefun解析器模塊/slimefun_parser.js`（以使用者本機實際路徑／版本為準）。
- 主要 CLI：`scripts/ob-cli.cjs`。

### 2.2 V1 的安全設計

- Canonical Item ID 以原始碼能證明的 ID 為準，不等於 `SlimefunItems` 常數名稱（例：`TIN_CAN` → `CAN`）。
- Ingredients 沿用 `{kind, id, qty}`；recipe 保留 `sourceType`、`output`、`slots`、`status`、`warnings`、`source`、`resolvedFrom`、`itemGroup` 等 provenance。
- `getRecipeOutput()` 可能使用 `recipeOutput`，也可能 fallback 到 `itemStackTemplate`。未知 amount 不得硬填 1。
- 原始 `ItemStack[]` slots 含 null；不可未經執行端證明就當成一般九宮格 shaped、全部消耗或一定產生一個結果。
- `RecipeType`、machine、`ItemGroup`、Provider 是不同概念；特殊取得、隨機結果、副產物不得假裝成單條確定合成配方。
- `recipeId` 按身分、RecipeType、材料、數量與 slots 內容產生；改材料／產量可能改 ID，**不是跨版本永久 route key**。

### 2.3 Phase 0：V1 原有 430 個「Constructor」診斷的真相

| 首個阻擋原因 | 診斷數 | 註冊呼叫數 | 說明 |
|---|---:|---:|---|
| 子類別額外行為 | 201 | 201 | Constructor／preRegister／其他子類別語意 |
| 其他 `.register` 接收者／匿名類別 | 88 | 88 | 可能是 API 內部呼叫，不可全視為物品 |
| 同參數數量 overload | 66 | 66 | 如 `SlimefunItem/5` 第三參數型別不同 |
| `this(...)` 委派 | 47 | 47 | 需匹配簽名並沿委派鏈解析 |
| `SlimefunItemStack` overload／數量 | 27 | 4 | 其餘 23 是物品定義診斷 |
| 自訂 RecipeType | 1 | 1 | 需獨立語意解析 |
| **合計** | **430** | — | **430 是舊訊息關鍵字統計，不是 430 個不同 Constructor** |

V1 共 547 個 `.register` 原始語法呼叫，421 個未能取得 ID；145 REVIEW = 122 已輸出配方 + 23 定義診斷。這些數字屬 V1 統計口徑，不可與 V1.1 改寫後的 `unresolvedConstructors` 直接相減。

### 2.4 V1.1 實作與限制

- 以可靜態辨識的參數型別選擇唯一 overload；追蹤 `this(...)`／`super(...)`；保存 constructor signature、來源證據與循環、深度（16 層）診斷。
- 由已證明的明確 ID 參數或靜態欄位參照解析 Canonical ID；同物品 ID 的不同配方可保留，多來源登記可用 `additionalSources` 記錄。
- 物品 ID 可解但 RecipeType、layout、amount、運行時行為未解者，保留 **REVIEW 診斷**，不得直接輸出可發布的配方。
- `EXPLICIT`／`PROVEN_DEFAULT` 等產量證據不可與不明確 fallback 混用。
- 尚不完整：chain/factory、local variable receiver、匿名覆寫、條件及迴圈、特殊設備加工、隨機 pool／副產物。
- `Normalized schemaVersion` 仍為 1；真正新來源的 fingerprint 改變會使舊審核不再自動適用。

### 2.5 可比較的 V1 與 V1.1 **Hook 修正前**數據

| Metric | V1 | V1.1（Hook 修正前） | 解讀 |
|---|---:|---:|---|
| parsedJavaFiles | 665 | 665 | 相同 |
| registrations | 547 | 547 | 原始 `.register` 呼叫相同 |
| resolvedItemIds | 126 | 412 | +286；75.3% 為識別率，不是配方完成率 |
| missingItemIds | 421 | 135 | −286 |
| items / recipes | 122 / 122 | 92 / 92 | 淨少 30 需看逐筆差異 |
| REVIEW | 145 | 423 | 單位含註冊與 Stack 定義診斷 |
| UNSUPPORTED | 425 | 124 | 分類提升，不等於已可發布 |
| SPECIAL | 0 | 11 | 已確認的一批內部 `.register` 呼叫 |
| ERROR / syntax errors | 0 / 0 | 0 / 0 | 解析正常 |

`missingRecipeTypes`、`unresolvedConstructors`、`unresolvedIngredients` 在 V1.1 改為不同統計口徑，**不能直接用數值差比較改善幅度**。

## 3. 回歸分析：原有 122 條配方去哪裡？

原始比較基準：

- V1：`review/parser-runs/slimefun-2026-11-21T10-02-20-889Z/`
- V1.1（Hook 修正前）：`review/parser-runs/slimefun-v11-20261121-182933-318/`

| V1 的 122 條 | 數量 | 具體解讀 |
|---|---:|---|
| 原樣保留 | 74 | ID、recipeId、材料順序與數量、slots、output、狀態等一致 |
| 進入設備語意診斷 | 13 | **8 隨機產物、1 副產物、4 可從設備程式確認的確定路線** |
| 受過寬 `preRegister` hook 檢查而遺失 | **35** | 真正 Parser Regression；需驗證修正後恢復數 |
| 無法配對 | 0 | 48 條退出均已追溯原始碼與 diagnostics |
| V1.1 新增配方 | 18 | 如 `CLOTH` 產 8、`HARDENED_GLASS` 產 16 等 |

因此 **122 − (13 + 35) + 18 = 92**。原先的「淨少 30」不代表只遺失 30 條；實際退出 48、新增 18。

### 3.1 Hook 回歸的根因與安全修正

- `SimpleSlimefunItem` 的 `preRegister` 只註冊使用／放置事件 handler；`SlimefunBow` 只掛射擊事件等延後 handler，原本構造配方不應被抹掉。
- Parser 原先把這些 handler 視為立即改變材料／產量的風險，造成 35 條配方退出。
- 已針對能證明延後執行的 handler 收窄判定並補正反例 fixture；**不能寬鬆地放行立即設定產量或改動配方的 handler factory**。
- 修正後 Hook 回歸測試已通過 **341／341**；新固定來源 Parser Run 已建立，但**仍缺明確的「恢復 X／35」輸出**，因此不要宣稱 35 條全恢復。

### 3.2 設備側真實配方（待獨立 Resolver）

| 代號 | 設備行為 | 正確保留方式 |
|---|---|---|
| M1 | Ore Washer 使用 SIFTED_ORE 產生隨機粉末池（7 類） | 隨機取得，不拆成 7 條必得路線 |
| M2 | Gold Pan 的 SIFTED_ORE 具有權重隨機結果 | 保留權重來源、機率證據 |
| M3 | Ore Washer 在同批篩礦中另產 STONE_CHUNK | **副產物**；不應建另一條獨立耗材路線 |
| M4 | Ore Washer 2 沙 → SALT | 確定設備加工路線；勿混淆電動版 |
| M5 | Ore Washer 1 PULVERIZED_ORE → PURE_ORE_CLUSTER | 確定路線 |
| M6 | Refinery 1 BUCKET_OF_OIL → BUCKET_OF_FUEL | 確定路線 |
| M7 | Heated Pressure Chamber 鎂粉＋鹽 → MAGNESIUM_SALT | 確定路線；同設備塑膠片實際產 8，不能以物品模板推測產量 |

### 3.3 423 個 REVIEW 的第一個阻擋原因（**Hook 修正前**）

| 首個原因 | REVIEW | 註冊呼叫 | Canonical ID | 正規化配方 |
|---|---:|---:|---:|---:|
| RecipeType／Slot 待確認 | 92 | 92 | 92 | 92 |
| 子類別／繼承行為待確認 | 269 | 269 | 269 | 0 |
| 設備加工／特殊取得 | 36 | 36 | 36 | 0 |
| Stack 材料失敗 | 10 | 10 | 10 | 0 |
| 產量未確認 | 3 | 3 | 3 | 0 |
| 自訂 RecipeType 未解析 | 2 | 2 | 2 | 0 |
| Stack 定義疑慮 | 11 | 0 | 11 | 0 |
| **合計（ID 去重）** | **423** | **412** | **412** | **92** |

前述屬「第一個」阻擋原因；消除它後可能暴露新的問題。`11` 個 Stack 定義 ID 已包含在其他 Registration，不能重複當成 423 個不同物品。

## 4. 三個 Pilot 樣本與實際狀態

三個樣本使用者已於最新 Normalized JSON 輸出材料清單：

`review/parser-runs/slimefun-preview-pilot-20261121-190853-110/Normalized Recipes.json`

| Item | RecipeType | Inputs | Output | Parser 狀態 | 驗收用途 |
|---|---|---|---:|---|---|
| `slimefun:CARBON` | `COMPRESSOR` | `minecraft:coal ×8` | 1 | `REVIEW` | 最簡單的單一路線、消耗量驗證 |
| `slimefun:STEEL_INGOT` | `SMELTERY` | `slimefun:IRON_DUST ×1`、`slimefun:CARBON ×1`、`minecraft:iron_ingot ×1` | 1 | `REVIEW` | Vanilla + Slimefun 混合材料 |
| `slimefun:BATTERY` | `ENHANCED_CRAFTING_TABLE` | `minecraft:redstone ×1`、`slimefun:ZINC_INGOT ×2`、`slimefun:SULFATE ×2`、`slimefun:COPPER_INGOT ×2` | 1 | `REVIEW` | 九宮格 slots + 已有正式 BIO 的增量更新 |

BATTERY 的來源九格基準：

```text
[空白] [紅石] [空白]
[鋅錠] [硫酸鹽] [銅錠]
[鋅錠] [硫酸鹽] [銅錠]
```

**重要：**上述只證明這三個樣本的已展示欄位符合 Java 來源核對，不等於全部設備語意都完成、也不等於 Preview 已成功生成。

## 5. Review／DEC／Preview：實際操作與安全閘門

### 5.1 目前 Vanilla 狀態的釐清

使用者提供的舊 Review Queue 快照記載：Vanilla 掃描 982、`Automatic Ready 982`、`Pending Review 0`、`Current Review 無`；但同批 `BIO Recipe Review.md` 仍保留 `minecraft:cooked_porkchop` 的歷史鎖定決策。**頁面留有最後一個目標，不代表仍有 Vanilla 待審。**

現階段「找不到碳」很可能是因為 `CARBON` **只存在於 Normalized JSON，尚未被 START 啟用到共用 `BIO Recipe Review.md`，也未必已有正式的 `碳.md`**。Obsidian 用中文檔名搜尋不到，不能據此判定 Parser 沒有碳。應先依 Canonical ID 啟用。

### 5.2 START：指定一筆、不必逐筆 NEXT

**以下是 Codex 回報已新增的最新版 Normalized CLI 介面，尚待實際 START 驗收：**

```powershell
Set-Location -LiteralPath 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF'
$Json = 'review/parser-runs/slimefun-preview-pilot-20261121-190853-110/Normalized Recipes.json'

# 只檢查，不啟用；也不會讓 Review READY
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:CARBON --dry-run

# 確認 Obsidian 已儲存當前編輯後：實際啟用，先備份共用 Review 文件與狀態
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:CARBON --backup-current
```

啟用成功後，在 Obsidian 打開**共用入口** `BIO Recipe Review.md`（不是正式 `碳.md`），檢查 `Target: slimefun:CARBON`、配方與材料、產量、Machine、名稱與目的地並完成勾選。若 `START` 阻擋切換，**先看錯誤與備份策略，不要手動刪除 Review 或 Registry**。

完成人工內容後：

```powershell
node scripts/ob-cli.cjs review recalculate "--normalized=$Json"
# 上述若 READY，先 Preview 預演（不寫正式 BIO）
node scripts/ob-cli.cjs preview "--normalized=$Json" --target=slimefun:CARBON
# 確認計畫安全後，才生成 Preview；仍不發布正式 BIO
node scripts/ob-cli.cjs preview "--normalized=$Json" --target=slimefun:CARBON --write
```

若 `recalculate` 不 READY：檢查它列出的**未完成欄位／Mapping／fingerprint**，不要直接跳過 Review gate。若已人工完成但仍報「來源 Review 未完成」，檢查 `normalizedTargets` 中 CARBON 是否為 **同一來源 fingerprint** 的已核准決策。`review scan` 會從現有狀態或第一筆 PENDING 進入，**不支援直接用 `--target` 指定**，故 pilot 優先使用 START。

### 5.3 誰可進入 Preview？

| 狀況 | 正確操作 |
|---|---|
| 正規化 JSON 存在，但尚無已審核決策 | `review start` → 編輯 `BIO Recipe Review.md` → `recalculate` |
| `review start --dry-run` 成功 | 僅預演切換，仍需實際 START |
| `Review Queue READY` | `preview`（先無 `--write`） |
| Preview 計畫安全且 Mapping 唯一 | `preview --write`，只生成候選 |
| Preview 完成 | 人工審核 → Publication SCAN；**不可直接 PUBLISH** |

### 5.4 BATTERY：Preferred 規則矛盾，需獨立驗收

- 正式電池 BIO 已存在，只有一條路線、沒有 `<!-- preferred -->`。既有 V4 Reader 與 Preferred Audit 容許單一路線無 Preferred。
- 舊 Normalized `--from-formal` Generator 要求正式檔有唯一 Preferred，因而擋住這種 Update Preview。
- **建議修正（尚未實作）**：原一條有效路線、無 Preferred → 單一路線更新可預演；若新增有效路線造成選擇歧義，仍需人工指定 Preferred。任何修正都不能覆寫原有路線、手改文字與已發布狀態。

## 6. Decision Registry 生命周期與發布安全

### 6.1 保留 Registry，而不是刪掉它

- `BIO Review Decisions.json` 現階段保留，因 Vanilla Review、共用 Base／Tag 選擇、尚未發布的 Normalized Review、撤銷與重開均可能使用。`normalizedTargets` 是標準化來源額外使用的欄位。
- 正式 BIO 供 V4 使用，V4 Reader **不需要讀 Decision Registry**；但不代表 Review／Generator／Publisher 可以廢除該庫。
- 舊文件盤點快照：約 **3,036,022 bytes**、626 個 Minecraft target 快照、511 個 locked Base、887 個歧義選擇與 3 個撤銷（其中 1 個仍有效）。這是**歷史盤點，不能假定為目前最新數字**。
- 原先上傳的 Registry JSON 快照只有 `schemaVersion`、`revocations`、`targets`；當時尚無 `normalizedTargets`。START／RECALCULATE 後是否出現該欄，應以最新本機檔案為準。
- Publisher 目前對 `BIO Review Decisions.json` **原始 bytes** 做整批指紋。即使修改無關決策，也可能使 Publication SCAN 失效；Review 作業應盡量安排在發布 SCAN 前完成。

### 6.2 既有 BIO 是更新基準，舊內容不可被靜默覆蓋

- `--from-formal` 讀正式 BIO、保留既有 provider routes／Preferred／手工正文／圖文，將新來源配方作**增量候選**。
- 來源消失／改配方時，不能自動刪除既有路線；須人工判斷退役／替換。相同來源的重跑應避免重複新增等價路線。
- 以 material/qty/output 等內容 hash 產生的 recipeId 不可當穩定上游永久鍵；長期可考慮 `provider_id + upstream route key` 與內容指紋分離。
- 未發布人工決策、跨目標 Locked、撤銷／重開、排除理由與指紋，都不等於正式 BIO 的既有文字，需保存。

### 6.3 長期生命周期

**現階段：完整保留 → 後續：活躍決策精簡 + 按批歷史封存。**

必要條件：先備份來源／Registry／工作頁與 SHA；確保沒有遺失自由文字備註；驗證 round-trip／reopen／revoke；只在有 `COMPLETE` 收據、正式檔 hash 驗證與 ARCHIVE 完成後，依明確批次關係移走歷史。**現在不淘汰 Registry。**

## 7. 設備語意與 V1.2 範圍（此輪先不做大規模擴充）

- Enhanced Crafting Table：九格比對；需保留 slots、特殊背包事件與實際扣料。
- Magic Workbench／Armor Forge：繼承 AbstractCraftingTable，需查明格位／扣料語意。
- Smeltery：在庫存中比對並按 Stack 量扣料；未必是 shaped 3×3。
- Ancient Altar：RecipeType callback 建立祭壇配方並由執行端扣料。
- Compressor、Ore Crusher、Grind Stone：`registerDefaultRecipes` 可提供額外路線，不能只解析物品註冊。
- Ore Washer／Gold Pan：有機率、權重及副產物，不能一律轉確定配方。
- Heated Pressure Chamber／Refinery：必須讀設備端加工 registry；已知特定確定路線可由後續 Resolver 恢復。

後續可排程：P0 確認 35 條 Hook 修正恢復數；P1 三個 pilot 的 Review START → Preview 驗收；P2 補 BATTERY 九格及 Preferred 規則；P3 設備自帶配方與動態路線 Resolver。若任一門檻失敗，回到該階段修正，不為了增加 OK 而猜測。

## 8. 命令速查與資料隔離

```powershell
# Parser（固定來源，前景執行；新批次另立 output）
node scripts/ob-cli.cjs parse --source=slimefun --source-root='參考資料/Slimefun4-source'

# 指定物品審核：先預演，實際啟用時備份現有 Review
$Json = 'review/parser-runs/slimefun-preview-pilot-20261121-190853-110/Normalized Recipes.json'
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:CARBON --dry-run
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:CARBON --backup-current
node scripts/ob-cli.cjs review recalculate "--normalized=$Json"

# READY 後，先預演 → 寫 Preview（不能直接發布）
node scripts/ob-cli.cjs preview "--normalized=$Json" --target=slimefun:CARBON
node scripts/ob-cli.cjs preview "--normalized=$Json" --target=slimefun:CARBON --write

# 下一個 pilot：每次仍先確認 Review／草稿保護
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:STEEL_INGOT --dry-run
node scripts/ob-cli.cjs review start "--normalized=$Json" --target=slimefun:BATTERY --dry-run

# 測試
node scripts/ob-cli.cjs test
```

**安全註記：**`--backup-current` 前先在 Obsidian 儲存檔案。`review` 與 `preview` 的 `--normalized` 必須指向同一份 JSON；Registry 決策附來源 fingerprint，不要換來源後沿用舊 READY。正式發布仍使用同一個 Publication Manifest，且須 SCAN READY 和使用者明確執行 PUBLISH。

## 9. 來源文件與版本區別

本頁由以下四份文件整合，原文提供完整逐筆紀錄與歷史上下文：

1. [[OB-SF Slimefun4 Java Parser MASTER NOTE]]：V1 架構、AST、安全邊界與原始設計；其「尚未跑真實來源」敘述已被後續實測取代。
2. [[OB-SF Slimefun Java Parser V1.1]]：Phase 0、Constructor、設備端來源證據與 V1.1 **Hook 修正前**覆蓋率。
3. [[OB-SF Slimefun V1 to V1.1 Recipe Regression]]：48 條退出逐筆來源、35 條 hook 回歸、13 條設備語意、18 條新增與 REVIEW 原因分布。
4. [[OB-SF Decision Registry 生命週期與 BIO 更新架構]]：Registry 保留理由、`--from-formal`、Source fingerprint、PUBLISH／ARCHIVE 與長期精簡方案。

**資訊先後原則：**本輪使用者提供的實際測試與 Parser 輸出 > 2026-11-21 工程報告中尚待測的敘述 > 最初的 V1 設計假設。沒有原始 log 支持的完成狀態均保持待驗證。

---

## 附錄 A｜V1 → V1.1（Hook 修正前）48 條退出配方逐筆表

以下原封保留原始回歸報告的逐筆資料。**注意：這些是修正前的對照，不能代表最新 Parser 還缺少哪些配方。**

每列的 ID 預設 `slimefun:`，來源行號皆位於 [SlimefunItemSetup.java](<參考資料/Slimefun4-source/src/main/java/io/github/thebusybiscuit/slimefun4/implementation/setup/SlimefunItemSetup.java>)。材料欄按 V1 的合計材料顯示，無前綴為 Minecraft 物品，`sf:` 為 Slimefun Canonical ID。這是舊版所記錄的數量，設備實際如何扣料見下方證據。V1 產量欄全為 1，V1.1 對應項目是 REVIEW 診斷且無正規化產量。完整格位和空格位置仍可在兩份 AST 與原始 JSON 查閱。

| ID | V1 Recipe ID | 行 | 設備 | V1 材料 | 判定／證據 |
|---|---|---:|---|---|---|
| `PORTABLE_CRAFTER` | `recipe-fe532a05cd7235372813c7b4` | 250 | ENHANCED_CRAFTING_TABLE | book ×1、crafting_table ×1 | 回歸 H1 / `PortableCrafter` |
| `FORTUNE_COOKIE` | `recipe-4ab1ec621565edbea1ab6e57` | 254 | ENHANCED_CRAFTING_TABLE | cookie ×1、paper ×1 | 回歸 H1 / `FortuneCookie` |
| `DIET_COOKIE` | `recipe-7e89072bfc2acaa5378ed949` | 258 | MAGIC_WORKBENCH | cookie ×1、sf:ELYTRA_SCALE ×1 | 回歸 H1 / `DietCookie` |
| `PORTABLE_DUSTBIN` | `recipe-2903b6f6a76150c7b2e2a37f` | 268 | ENHANCED_CRAFTING_TABLE | iron_ingot ×8 | 回歸 H1 / `PortableDustbin` |
| `ENDER_BACKPACK` | `recipe-bc16a22ca56b51c5fccca4e0` | 335 | MAGIC_WORKBENCH | sf:ENDER_LUMP_2 ×4、leather ×4、chest ×1 | 回歸 H1 / `EnderBackpack` |
| `MAGIC_EYE_OF_ENDER` | `recipe-2aa1892fea3ed96e77d994e4` | 355 | MAGIC_WORKBENCH | sf:ENDER_LUMP_2 ×4、ender_pearl ×4、ender_eye ×1 | 回歸 H1 / `MagicEyeOfEnder` |
| `MAGIC_SUGAR` | `recipe-ae00cf657078d1abe2a2d429` | 359 | ENHANCED_CRAFTING_TABLE | sugar ×1、redstone ×1、glowstone_dust ×1 | 回歸 H1 / `MagicSugar` |
| `MONSTER_JERKY` | `recipe-715756d6eca2a60d299df67c` | 363 | ENHANCED_CRAFTING_TABLE | sf:SALT ×1、rotten_flesh ×1 | 回歸 H1 / `MonsterJerky` |
| `MAGICAL_GLASS` | `recipe-f1c4ce84e5f6af75feb74f00` | 394 | MAGIC_WORKBENCH | sf:MAGIC_LUMP_2 ×4、sf:GOLD_DUST ×1、sf:FILLED_FLASK_OF_KNOWLEDGE ×3、glass_pane ×1 | 回歸 H1 / `UnplaceableBlock` |
| `ADVANCED_CIRCUIT_BOARD` | `recipe-d33e10082a4e95700ee47e54` | 402 | ENHANCED_CRAFTING_TABLE | lapis_block ×6、redstone_block ×2、sf:BASIC_CIRCUIT_BOARD ×1 | 回歸 H1 / `UnplaceableBlock` |
| `SIFTED_ORE` | `recipe-fd3be21e9e72ce1aa496a7ca` | 414 | GOLD_PAN | gravel ×1 | 安全排除 M2 |
| `BATTERY` | `recipe-36320591a894f500a233e8ff` | 427 | ENHANCED_CRAFTING_TABLE | redstone ×1、sf:ZINC_INGOT ×2、sf:SULFATE ×2、sf:COPPER_INGOT ×2 | 回歸 H1 / `UnplaceableBlock` |
| `COPPER_DUST` | `recipe-929443115c722b80ae84a1d6` | 564 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `TIN_DUST` | `recipe-190deb57a6828e5dfb72ab03` | 568 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `SILVER_DUST` | `recipe-10a548270fac430ea7268fc6` | 572 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `LEAD_DUST` | `recipe-a9f0ca8e50773cbf1c3b6744` | 576 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `ALUMINUM_DUST` | `recipe-644129141bed7b2904eaee9b` | 580 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `ZINC_DUST` | `recipe-bfb95b3930557bfa7fc7e8a0` | 584 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `MAGNESIUM_DUST` | `recipe-6bc93115133f1ef3a36f95f4` | 588 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M1 |
| `CARBON` | `recipe-5cdca9f50fd45402b0d98688` | 624 | COMPRESSOR | coal ×8 | 回歸 H1 / `UnplaceableBlock` |
| `COMPRESSED_CARBON` | `recipe-6a528aaa37c08ccbb2d4887b` | 636 | COMPRESSOR | sf:CARBON ×4 | 回歸 H1 / `UnplaceableBlock` |
| `CARBON_CHUNK` | `recipe-e36c8938779dc7844817b77e` | 640 | ENHANCED_CRAFTING_TABLE | sf:COMPRESSED_CARBON ×8、flint ×1 | 回歸 H1 / `UnplaceableBlock` |
| `STAFF_ELEMENTAL_WATER` | `recipe-600291449240961f514e29f2` | 724 | MAGIC_WORKBENCH | lily_pad ×2、sf:MAGIC_LUMP_2 ×1、sf:STAFF_ELEMENTAL ×2 | 回歸 H1 / `WaterStaff` |
| `STONE_CHUNK` | `recipe-6dba10058da3b57da3fb4c14` | 816 | ORE_WASHER | sf:SIFTED_ORE ×1 | 安全排除 M3 |
| `SOLAR_PANEL` | `recipe-dc7f23ffcf9cb519bde08928` | 824 | ENHANCED_CRAFTING_TABLE | glass ×3、sf:SILICON ×3、sf:FERROSILICON ×3 | 回歸 H1 / `UnplaceableBlock` |
| `SMELTERS_PICKAXE` | `recipe-4d1878bda0f18ff14d2efddf` | 855 | ENHANCED_CRAFTING_TABLE | sf:LAVA_CRYSTAL ×3、sf:FERROSILICON ×2 | 回歸 H1 / `SmeltersPickaxe` |
| `SALT` | `recipe-c794b0ff9b04d2b2fa9dd150` | 959 | ORE_WASHER | sand ×2 | 安全排除 M4 |
| `PURE_ORE_CLUSTER` | `recipe-043bc10a7337fbb7a9754ebf` | 1010 | ORE_WASHER | sf:PULVERIZED_ORE ×1 | 安全排除 M5 |
| `PICKAXE_OF_CONTAINMENT` | `recipe-fc15940a2b09f62be6a385f2` | 1072 | MAGIC_WORKBENCH | sf:FERROSILICON ×3、sf:GILDED_IRON ×2 | 回歸 H1 / `PickaxeOfContainment` |
| `MAGNET` | `recipe-5c1e65a912244c5aa47e2916` | 1164 | SMELTERY | sf:NICKEL_INGOT ×1、sf:ALUMINUM_DUST ×1、sf:IRON_DUST ×1、sf:COBALT_INGOT ×1 | 回歸 H1 / `UnplaceableBlock` |
| `NECROTIC_SKULL` | `recipe-0350396f41fcaf75ea7a2ea6` | 1176 | MAGIC_WORKBENCH | sf:MAGIC_LUMP_3 ×4、wither_skeleton_skull ×1 | 回歸 H1 / `UnplaceableBlock` |
| `SEISMIC_AXE` | `recipe-9954be1e1b7c507823892cd7` | 1233 | MAGIC_WORKBENCH | sf:HARDENED_METAL_INGOT ×3、sf:STAFF_ELEMENTAL ×2 | 回歸 H1 / `SeismicAxe` |
| `ELECTRO_MAGNET` | `recipe-23f2cbfac55c60a89738c365` | 1379 | ENHANCED_CRAFTING_TABLE | sf:NICKEL_INGOT ×1、sf:MAGNET ×1、sf:COBALT_INGOT ×1、sf:BATTERY ×1 | 回歸 H1 / `UnplaceableBlock` |
| `ELECTRIC_MOTOR` | `recipe-f29152428b752e7c81af975b` | 1383 | ENHANCED_CRAFTING_TABLE | sf:COPPER_WIRE ×6、sf:ELECTRO_MAGNET ×1 | 回歸 H1 / `UnplaceableBlock` |
| `HEATING_COIL` | `recipe-fa7b85793d41f2f71fc00db2` | 1387 | ENHANCED_CRAFTING_TABLE | sf:COPPER_WIRE ×8、sf:ELECTRIC_MOTOR ×1 | 回歸 H1 / `UnplaceableBlock` |
| `ICY_BOW` | `recipe-28edcfedb61175e8be3e6775` | 1408 | MAGIC_WORKBENCH | stick ×2、ice ×2、sf:STAFF_ELEMENTAL_WATER ×1、packed_ice ×1 | 回歸 H2 / `IcyBow` |
| `TOME_OF_KNOWLEDGE_SHARING` | `recipe-6df17bd157f93d8c3dcabc7e` | 1412 | MAGIC_WORKBENCH | feather ×1、ink_sac ×1、sf:MAGICAL_BOOK_COVER ×1、glass_bottle ×1、writable_book ×1 | 回歸 H1 / `KnowledgeTome` |
| `COOLING_UNIT` | `recipe-39b95629f5fafe0f244c88a7` | 1537 | ENHANCED_CRAFTING_TABLE | ice ×6、sf:ALUMINUM_INGOT ×2、sf:ELECTRIC_MOTOR ×1 | 回歸 H1 / `UnplaceableBlock` |
| `MAGNESIUM_SALT` | `recipe-4288c903d2e1f863d56be80a` | 1813 | HEATED_PRESSURE_CHAMBER | sf:MAGNESIUM_DUST ×1、sf:SALT ×1 | 安全排除 M7 |
| `MULTIMETER` | `recipe-a6453378f4eda3057986dca9` | 1872 | ENHANCED_CRAFTING_TABLE | sf:COPPER_INGOT ×2、sf:REDSTONE_ALLOY ×1、sf:GOLD_6K ×1 | 回歸 H1 / `Multimeter` |
| `ANDROID_MEMORY_CORE` | `recipe-e20e37e3c93b83b97c38d71c` | 1881 | ENHANCED_CRAFTING_TABLE | sf:BRASS_INGOT ×4、orange_stained_glass ×2、sf:POWER_CRYSTAL ×2、sf:TIN_DUST ×1 | 回歸 H1 / `UnplaceableBlock` |
| `GPS_CONTROL_PANEL` | `recipe-2554dae4e6d40efacded6213` | 1945 | ENHANCED_CRAFTING_TABLE | sf:ELECTRO_MAGNET ×1、sf:COBALT_INGOT ×2、sf:ADVANCED_CIRCUIT_BOARD ×1、sf:ALUMINUM_BRASS_INGOT ×3 | 回歸 H1 / `GPSControlPanel` |
| `GPS_MARKER_TOOL` | `recipe-0d6da5e4641bf79ea5a9553e` | 1949 | ENHANCED_CRAFTING_TABLE | sf:ELECTRO_MAGNET ×1、lapis_lazuli ×2、sf:BASIC_CIRCUIT_BOARD ×1、redstone ×2、sf:REDSTONE_ALLOY ×1 | 回歸 H1 / `GPSMarkerTool` |
| `GPS_GEO_SCANNER` | `recipe-6a6c8147cc9c289a47b80523` | 2223 | ENHANCED_CRAFTING_TABLE | sf:ELECTRO_MAGNET ×3、sf:STEEL_INGOT ×2、sf:ELECTRIC_MOTOR ×1 | 回歸 H1 / `GEOScanner` |
| `PORTABLE_GEO_SCANNER` | `recipe-8f15f60d2ae961751320a47e` | 2227 | ENHANCED_CRAFTING_TABLE | sf:ELECTRO_MAGNET ×2、compass ×1、sf:STEEL_INGOT ×2、sf:GPS_MARKER_TOOL ×1、sf:SOLDER_INGOT ×2、sf:ELECTRIC_MOTOR ×1 | 回歸 H1 / `PortableGEOScanner` |
| `BUCKET_OF_FUEL` | `recipe-f6b65ed371abd5745159cdbd` | 2249 | REFINERY | sf:BUCKET_OF_OIL ×1 | 安全排除 M6 |
| `GPS_TELEPORTATION_MATRIX` | `recipe-f456bcaab559a51409f402a6` | 2287 | ENHANCED_CRAFTING_TABLE | sf:GPS_TELEPORTER_PYLON ×4、sf:REINFORCED_ALLOY_INGOT ×2、sf:ELECTRO_MAGNET ×2、sf:GPS_CONTROL_PANEL ×1 | 回歸 H1 / `Teleporter` |
| `TAPE_MEASURE` | `recipe-038fedd290f5b682e48d4e50` | 2636 | ENHANCED_CRAFTING_TABLE | sf:SILICON ×3、yellow_dye ×4、string ×1、sf:GILDED_IRON ×1 | 回歸 H1 / `TapeMeasure` |


## 附錄 B｜V1.1（Hook 修正前）18 條新增配方

同樣僅作歷史差異基準；不是最新 batch 的統計。

均為 REVIEW，尚未全面驗證設備扣料與執行時條件。來源檔案同上。

| ID | Recipe ID | 行 | 設備 | 登記產量 |
|---|---|---:|---|---:|
| `KELP_COOKIE` | `recipe-0a48a05ab8491a072851a402` | 296 | ENHANCED_CRAFTING_TABLE | 2 |
| `MAGIC_LUMP_1` | `recipe-b152b13c1843ce98a3ae00f1` | 309 | GRIND_STONE | 2 |
| `ENDER_LUMP_1` | `recipe-2b9a2fb0675f20c9efa3e0b0` | 322 | GRIND_STONE | 2 |
| `REINFORCED_CLOTH` | `recipe-8bacba51b803c91d0dc0d2ab` | 980 | ENHANCED_CRAFTING_TABLE | 2 |
| `CLOTH` | `recipe-3ed309043bdf8b2a82f0112b` | 1034 | ENHANCED_CRAFTING_TABLE | 8 |
| `CHRISTMAS_COOKIE` | `recipe-3c73c09446e3f60b12ee039b` | 1449 | ENHANCED_CRAFTING_TABLE | 16 |
| `CHRISTMAS_FRUIT_CAKE` | `recipe-3fe9569c9b23a9ab6f5256fa` | 1454 | ENHANCED_CRAFTING_TABLE | 4 |
| `CHRISTMAS_APPLE_PIE` | `recipe-7c3da46614ef306db35da5b4` | 1459 | ENHANCED_CRAFTING_TABLE | 2 |
| `CHRISTMAS_CAKE` | `recipe-b29007b4057115f3a216395b` | 1468 | ENHANCED_CRAFTING_TABLE | 4 |
| `CHRISTMAS_CARAMEL` | `recipe-f00f68258885daa796421c9d` | 1473 | SMELTERY | 4 |
| `CHRISTMAS_CARAMEL_APPLE` | `recipe-2986c30fa279c54cf2dd3bfa` | 1478 | ENHANCED_CRAFTING_TABLE | 2 |
| `CHRISTMAS_CHOCOLATE_APPLE` | `recipe-8a8df0b22ed50c9718320520` | 1483 | ENHANCED_CRAFTING_TABLE | 2 |
| `CARROT_PIE` | `recipe-ce341a01ad04e9b1b355bade` | 1504 | ENHANCED_CRAFTING_TABLE | 2 |
| `EASTER_APPLE_PIE` | `recipe-b7650f53f94571f7c14a958a` | 1509 | ENHANCED_CRAFTING_TABLE | 2 |
| `HARDENED_GLASS` | `recipe-0cbaec6fbacee7a1f9fbdf6e` | 1532 | ENHANCED_CRAFTING_TABLE | 16 |
| `WITHER_PROOF_OBSIDIAN` | `recipe-a8e0bb605b0e6afe2c4c1f9f` | 1545 | ENHANCED_CRAFTING_TABLE | 4 |
| `DUCT_TAPE` | `recipe-aef617d207c4aead1ac0b447` | 1568 | ENHANCED_CRAFTING_TABLE | 2 |
| `WITHER_PROOF_GLASS` | `recipe-2eea1ccd03026130c1a92d47` | 2218 | ENHANCED_CRAFTING_TABLE | 4 |
