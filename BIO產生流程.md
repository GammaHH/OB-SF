# BIO 產生流程

Parser 標準化 → 循環與路線決策 → Machine 驗證／分類 → BIO 預覽 → 人工驗收 → 正式寫入。

## 1. 來源與標準化

原版來源為 `參考資料/Minecraft` 的 recipes、tags 與 `zh_tw.json`。目前 Review／BIO CLI 會在記憶體中載入並標準化來源，不必先產生一份中間 JSON 才能預覽。

如需獨立檢查 Parser 輸出，可在專案根目錄執行 `node scripts/run-vanilla-parser-v1.3.cjs`；會產生 `MC-自動化實作` 中的 Normalized Recipes、Tag Registry 與 Manifest，這些是檢查用產物，不是目前 BIO CLI 的輸入。

## 2. 決策與驗證

來源有變更時執行 `node scripts/minecraft-review.cjs scan`，再執行 `node scripts/minecraft-review.cjs next` 開啟待決策項目。修改根目錄 Base／Recipe Review 的勾選後執行 `node scripts/minecraft-review.cjs recalculate`，再繼續 next，直到沒有 pending target。

保留 `Minecraft Review Decisions.json` 與 `review/minecraft-review-queue.json`。根目錄兩份 Review 是暫存工作頁，Decisions.md／Queue.md 是摘要；已完成後可成對封存 Review，之後命令仍可能重新建立這些 Markdown。

`Minecraft Machine Recipe Mapping Draft.md` 對應 Machine 與三級配方分類；它不是通用的機器身份決策系統。未來接入其他 Parser 時，缺少設備、身份衝突、分類不明或資料不完整仍須進人工審核，不能靠分類表猜設備。

Tag／衍生集合名稱與代表材料分別由 `Minecraft Tag BIO Mapping Draft.md`、`Minecraft BIO Group Mapping Draft.md` 管理。generate=false 不會刪除原配方中的合法材料。

## 3. 批次產生測試預覽

```powershell
Set-Location -LiteralPath 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF'
$Targets = @(
    'minecraft:stick'
    'minecraft:soul_campfire'
    'minecraft:suspicious_stew'
    'minecraft:red_wool'
    'minecraft:painting'
    'minecraft:iron_ingot'
    'minecraft:piston'
    'minecraft:wooden_pickaxe'
    'minecraft:stone_pickaxe'
)
$PreviewExit = $null
$PreviewCompleted = $false
& node scripts/minecraft-bio-generator.cjs preview @Targets --update-existing
$PreviewCompleted = $true
$PreviewExit = $LASTEXITCODE
Write-Output "PREVIEW_COMPLETED=$PreviewCompleted PREVIEW_EXIT=$PreviewExit"
if ($PreviewExit -ne 0) { throw "批次預覽失敗：$PreviewExit" }
```

不用先刪舊測試。多目標會建立新的 `MC-自動化BIO/preview/batch/<時間戳>`，同批 BIO 共用身份並相互連結。

- `*.preview.md`：新格式預覽。
- `updates/*.update-preview.md`：保留既有內容，連到同批預覽的測試視圖。
- `formal-candidates/*.formal-candidate.md`：使用正式引用的更新候選。
- `BIO Update Review.json`：更新審核資料；不是 BIO 盤點報告。

## 4. 正式更新的目前邊界

既有 Item／Drop：驗收正式候選及 REVIEW 診斷後，以 Templater 執行 `MC-BIO套用更新`，選擇該批次的更新審核 JSON。入口逐檔驗證，寫入前建立 Git 還原點，保留圖片與人工內容。

目前尚無整批 NEW Item／Tag／衍生集合正式發布入口，不能直接把 preview 資料夾複製成正式 BIO，否則會保留測試時間戳連結。正式新增仍需補發布流程後再批次執行。

## 後續 Parser 接入原則

各 Parser 應提供統一的物品身份、配方、材料／集合、產量、設備、來源科技與 NOTE；先驗證資料，再處理循環和決策，最後交給共用 BIO Generator。原始合法路線保留，preferred 只決定預設規劃路線。標準化資料與實際 BIO 可讀性皆需驗證，檔案存在不等於內容已驗收。
