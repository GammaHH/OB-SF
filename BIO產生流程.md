---
updated: 2026-11-21 03:05:58
created: 2026-11-16 02:21:06
---
# BIO 產生流程

## 目前的共用發布入口

Vanilla 批次與 Mini Parser 新稿使用同一個集中 SCAN 和 Publisher。Mini Parser 的 Java／YAML／手動三種模式產生 `.preview.md` 到 `MC-自動化BIO/preview/mini`。可以指定物品名、ID、type、材料、設備、NOTE、配方產量與生產體系。三級標題預設「常規」，五級標題來自實際插件。正式資料夾白名單、插件 ID 與目的地路由都在 `Recipe Mapping Draft.md`。材料未正式發布時仍保留 ID。

在專案根目錄執行一行即可掃描目前的 Preview。Vanilla 批次會連同待發布的 Mini／Plugin Preview 檢查。沒有 Vanilla 批次時，可直接掃描 Mini／Plugin 新稿。

```powershell
node scripts/minecraft-bio-generator.cjs scan-publication
```

完整報告位於 `BIO Publication.json.review.json`。集中 SCAN 會把當前更新預覽與目前正式 BIO 比對。若預覽保留正式檔的內容，同批可重新驗證。若正式檔新增了人工資料而預覽缺少，先在更新預覽補上這些內容。SCAN 記錄本次核對的正式檔版本，正式檔或候選修改後須重新掃描才可發布。

`updated` 的差異不列為 YAML 衝突，發布候選沿用正式檔的值。其他保留檢查會列出有歧異的欄位及正式檔／預覽檔行號。正文可新增內容，若有刪減或改動，報告會列出正式檔原行與預覽中可定位的鄰近行。完全缺少的行以正式檔位置為準。

「其他審核問題」的勾選框表示同意該項差異採用當前 Preview。存檔後重跑 SCAN 才會進入該批審核結果。正式檔或預覽再變動時，該項核准失效。身份、引用、循環等問題仍需修正。Mini Parser 的 `preview_mode` 和 `preview_evidence` 供 SCAN 查核，正式發布時會移除。

材料審核表為批次資料夾旁的 `<批次> - 材料審核.md`。已核對原版 ID、確定原版 Registry 無生產配方的缺少材料可勾選外部取得。請在勾選框下、「引用」上方每行填一種取得方式。重跑 SCAN 會把每行帶入 Base 預覽，第一條為首選。這些經人工確認的材料 Base 預覽不加 `#待補充`，保留 `#需攻略補充`。未勾選或尚未填寫取得方式的項目維持待處理。已有材料 BIO 時先修正引用。缺少 Slimefun BIO 或需要補配方，可用 Mini Parser 建立預覽再一起掃描。

「需人工處理」的勾選框只記錄處理進度。每次 SCAN 都會核對有無可用的材料 Preview 或正式 BIO，引用能解析後便移出待處理清單。

材料以純 ID 填寫且目前找不到 BIO 時，審核表會列出「保留原始材料 ID」。勾選後重跑 SCAN，可按原 ID 發布。若同一引用有多個對應，SCAN 會列出候選並阻擋發布，須把材料引用改成明確的 BIO 連結。建立 Base 與確認保留原始 ID 使用各自的勾選框。

集中 SCAN 會一起檢查選定批次與待發布的 Mini Parser、插件及材料 Base 預覽。材料 Base 預覽若缺少 `# 用途` 或 `# 產物`，SCAN 會補齊並用補齊後的版本驗證。正式 BIO 由 PUBLISH 寫入。

管理標籤只在產生 Preview 時加入。Preview 的正文或 YAML `tags` 仍有 `#待補充`、`#未人工檢查`、`#更新需人工解析` 任一項，發布即會被擋下。審查完成後直接移除標籤並重掃。SCAN 和 PUBLISH 都會保留移除結果。`#需攻略補充` 可保留到發布後再補攻略。

審核表的 `PUBLICATION_TAG_BLOCKED` 勾選框只記錄人工處理進度。同一份 Preview 若仍有相同標籤，重掃會保留勾選狀態。條目會在阻擋標籤全部移除後消失。

SCAN 找到 2,000 項尚待處理的問題時會停止搜尋，並在終端與審核表標示掃描未完成。請處理目前列出的問題後重掃，直到整批驗證為 READY。已確認的審核項目不占用問題額度。

Mini Parser 預覽以 `generated_by: obsf-mini-parser` 記錄產生工具，材料 Base 預覽則記為 `minecraft-bio-publication-scan`。SCAN 會補上待發布預覽缺少的來源標記，PUBLISH 會保留該欄位。

使用 `refresh-batch --manifest=<BIO Publication.json> --collections` 把已啟用且批次和正式庫都缺少的集合加到既有 Vanilla 批次。附上 Preview 檔名，可同次更新指定稿件的 Minecraft 原版配方。檔名可省略 `.md`，`.preview` 和 `.update-preview` 可分開指定。多批次時 CLI 會列出選項。預設試跑，確認後加 `--write`，寫入前會備份批次清單和受影響檔案。寫入後照常走 SCAN → PUBLISH。

在 Mini Parser 選「自訂建立 Tag BIO」，輸入集合名稱、ID 與各個成員，第一則成員預設標為 `<!-- preferred -->`；一般配方同樣以第一則為首選，可編輯標記調整。預覽使用 `type: mc-tag`，成員逐行列在「Tag 代表材料」，數量由引用它的配方決定。V4 會沿所選成員展開實際取得路線。SCAN 確認成員可解析、首選有效且有可完成的依賴路徑後，才能發布。

集中審核的批次須恰有一個有效 `<!-- preferred -->`。Vanilla 物品若以「外部取得」為 Preferred，發布候選會寫入 `base_material: true` 並保留其合成配方。Mini／Plugin 來源保留自己的 Base 判定。已標記 REVIEW 的更新仍須逐項確認 `approved`。

如已設定 `Recipe Mapping Draft.md` 的 `active_preview_manifest`，CLI 會採用該批。設定留空時，唯一批次會自動採用，多批次會列出可直接複製的選擇指令。進階使用者也可用 `--manifest="…/BIO Publication.json"` 覆蓋本次選擇。終端機顯示 READY／REVIEW／BLOCKED 數量、與上次驗證的比較，以及前 25 個問題，完整清單在報告內。日常 SCAN 可直接執行，開發回歸測試另行執行。

確認同批報告為 READY 後，`node scripts/minecraft-bio-generator.cjs publish --write` 會依相同規則選批次，重驗候選與報告，並在寫入前建立 Git 還原點。如果掃描時使用 `--manifest`，發布也使用相同參數。未經處理的 REVIEW 或 BLOCKED 會擋住該批。Mini Parser 目前只建立新稿，既有配方追加功能待 Update Preview 接入。

Parser 標準化 → 循環與路線決策 → Machine 驗證／分類 → BIO 預覽 → 人工驗收 → 正式寫入。

## 1. 來源與標準化

原版來源為 `參考資料/Minecraft` 的 recipes、tags 與 `zh_tw.json`。目前 Review／BIO CLI 會在記憶體中載入並標準化來源，不必先產生一份中間 JSON 才能預覽。

如需獨立檢查 Parser 輸出，可在專案根目錄執行 `node scripts/run-vanilla-parser-v1.3.cjs`；會產生 `MC-自動化實作` 中的 Normalized Recipes、Tag Registry 與 Manifest，這些是檢查用產物，不是目前 BIO CLI 的輸入。

## 2. 決策與驗證

來源有變更時執行 `node scripts/minecraft-review.cjs scan`，再執行 `node scripts/minecraft-review.cjs next` 開啟待決策項目。修改根目錄 Base／Recipe Review 的勾選後執行 `node scripts/minecraft-review.cjs recalculate`，再繼續 next，直到沒有 pending target。

首次全物品發布前須改用 `node scripts/minecraft-review.cjs scan --all`，涵蓋既有 BIO；一般 scan 的範圍只是「缺少 BIO＋目前 Review」，所以它顯示 pending=0 並不代表全部 Normalized Targets 都完成決策。全量掃描會重新開啟本次仍未 READY 的舊 READY 項目，保留正在進行的 Review；不能用舊佇列狀態繞過最新檢查。這一步只更新決策佇列與摘要，不寫正式 BIO。

保留 `Minecraft Review Decisions.json` 與 `review/minecraft-review-queue.json`。根目錄兩份 Review 是暫存工作頁，Decisions.md／Queue.md 是摘要；已完成後可成對封存 Review，之後命令仍可能重新建立這些 Markdown。

`Recipe Mapping Draft.md` 的 Machine 表對應 Machine 與三級配方分類；它不是通用的機器身份決策系統。Mini Parser 的 Machine Dictionary 僅轉換設備名稱，Provider Headings 僅提供插件五級標題；Mini Parser 仍維持 `### 常規`，不自動套用 Machine 分類搬動配方。未來接入其他 Parser 時，缺少設備、身份衝突、分類不明或資料不完整仍須進人工審核，不能靠分類表猜設備。

Tag／衍生集合名稱與代表材料分別由 `Minecraft Tag BIO Mapping Draft.md`、`Minecraft BIO Group Mapping Draft.md` 管理。generate=false 不會刪除原配方中的合法材料。

## 3. 批次產生測試預覽

不用先刪舊測試。多目標會建立新的 `MC-自動化BIO/preview/batch/<時間戳>`，同批 BIO 共用身份並相互連結。

- `*.preview.md`：新格式預覽。
- `updates/*.update-preview.md`：保留既有內容，連到同批預覽的測試視圖。
- `formal-candidates/*.formal-candidate.md`：使用正式引用的更新候選。
- `BIO Update Review.json`：更新審核資料；不是 BIO 盤點報告。

## 4. 全物品預覽與正式發布

以下入口為 11/16 新增，尚待使用者執行回歸測試與實際驗證。助理不直接執行產生、測試或正式發布。

先測試發布引擎（臨時 Git fixture，不寫正式 BIO）：

人工驗收及修改：

- NEW 物品／新集合：修改一般 `*.preview.md`。
- 已有 Item／Drop：修改 `updates/*.update-preview.md`，這份包含原圖片與人工內容；發布清單的 `previewFilename` 是實際採用的檔案。
- 掉落物改 `type: mc-drop`，物品改 `type: mc-item`；保留 `id`／`minecraft_id`。允許等價排版，以及新增、移動或刪除 `<!-- preferred -->`；可有多個標記，V4 預設依文件順序選第一條合法 preferred 路線，科技／取得方式過濾與手動選擇優先規則不變。材料、數量、產量、配方順序等變動仍會要求重建預覽。
- 發布採用驗收後的預覽正文，不重新渲染配方。可合併重複三級／五級配方標題、刪空分類、調整空行縮排，以及把 `**批產量**：[output:: 4]` 改成 `- [output:: 4]`；等價格式只在保留檢查時正規化，寫入仍用你的排版。這項排版放寬相容已產生的發布清單，不需為此重產全批。圖片、人工備註及自訂 YAML 仍檢查保留，配方材料／數量／產量／順序仍按原預覽語意驗證。Tag BIO 也可移動代表材料的 preferred，成員集合仍須完整一致；不會將正文的偏好修改自動寫回 Decision Registry。
- REVIEW 項目驗收後，僅將該筆 `BIO Publication.json` 的 `approved` 改為 `true`；這不會豁免身份、來源雜湊、舊內容保留及集合完整性檢查。既有 Tag／集合也必須審核，不能直接拿新模板蓋掉人工資料。

舊批次清單只有含 preferred 的語意雜湊。先在尚未移動 preferred 時執行一次清單升級，再開始改標記；type／等價排版可保留，不必重產全批。新批次自動啟用，無須這一步。升級只備份並更新發布 JSON，不寫預覽或正式 BIO，也不核准 REVIEW。

目的地為 `MC-物品資料庫`：新 BIO 建立新檔，既有 BIO 原路徑更新；自動把本批次預覽連結轉成正式路徑，並同步材料 item／drop 欄位。不整棵複製 preview 目錄，不發布審核報告。正式發布前建立批次 Git 還原點，保留 HEAD、原暫存區及其他工作區修改。僅允許非 main/master 的分支。

來源、Mapping、決策或原 BIO 於預覽後變動，會要求重產。預設任一未核准 REVIEW 都停止；可明確加 `--skip-review` 略過，但若其他項目引用被略過的新 BIO／未確認集合，仍會停止，不能留下失效導航。舊內容保留檢查失敗時應先處理審核，不能用 approved 強制刪除圖片或人工內容。

發布不是整批原子交易。個別檔案以完整暫存檔替換，途中失敗即停止；`review/bio-publications/<時間戳>-<唯一值>.json` 記錄哪些已寫入、哪些是新建及 Git 還原點。舊檔可從該 ref 恢復，新建檔須依清單另行處理。不要在失敗後直接重跑寫入；先檢查紀錄並重新產生預覽。

原 Templater `MC-BIO套用更新` 仍保留，限既有單一 Item／Drop，使用 `BIO Update Review.json` 及雜湊鎖定的 `formal-candidates`；它與上述可編輯預覽批次發布入口不同。

## 後續 Parser 接入原則

各 Parser 應提供統一的物品身份、配方、材料／集合、產量、設備、來源科技與 NOTE；先驗證資料，再處理循環和決策，最後交給共用 BIO Generator。原始合法路線保留，preferred 只決定預設規劃路線。標準化資料與實際 BIO 可讀性皆需驗證，檔案存在不等於內容已驗收。

# 指令操作

node 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF\scripts\minecraft-bio-generator.cjs' scan-publication

node 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF\scripts\minecraft-bio-generator.cjs' publish
-  --write 正式寫入資料庫

```dataviewjs
// ==========================================
// OB-SF | Long Metadata Scanner + Copy LIST
// 唯讀掃描，不修改任何 BIO
// ==========================================

const CONFIG = {
    folder: "MC-自動化BIO/preview",
    maxLength: 20,
    onlyPreview: true
};

// 1. 掃描檔案
const files = app.vault.getMarkdownFiles().filter(f => {
    const inFolder = !CONFIG.folder ||
        f.path.startsWith(CONFIG.folder + "/");

    const isPreview =
        /\.(?:update-)?preview\.md$/i.test(f.name);

    return inFolder &&
        (!CONFIG.onlyPreview || isPreview);
});

const results = [];

for (const file of files) {
    const content = await app.vault.read(file);
    const regex = /<!--\s*obsf:choices\b[\s\S]*?-->/g;

    const abnormal = [...content.matchAll(regex)]
        .filter(m => m[0].length > CONFIG.maxLength)
        .map(m => ({
            length: m[0].length,
            line: content.slice(0, m.index)
                .split(/\r?\n/).length
        }));

    if (!abnormal.length) continue;

    results.push({
        name: file.basename,
        path: file.path,
        count: abnormal.length,
        max: Math.max(...abnormal.map(x => x.length)),
        lines: abnormal.map(x => x.line)
    });
}

results.sort((a, b) => b.max - a.max);

// 2. 建立可複製 LIST
const nameList = results
    .map(x => x.name)
    .join("\n");

const pathList = results
    .map(x =>
        `${x.path} | META ${x.count} 筆` +
        ` | 最長 ${x.max} 字元` +
        ` | 行號 ${x.lines.join(", ")}`
    )
    .join("\n");

// 3. 複製按鈕
async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        const old = button.textContent;
        button.textContent = "✅ 已複製！";

        setTimeout(() => {
            button.textContent = old;
        }, 2000);
    } catch (error) {
        new Notice("複製失敗，請檢查剪貼簿權限");
        console.error(error);
    }
}

dv.header(2, "🔍 BIO 過長 Metadata 清單");

dv.paragraph(
    `掃描 ${files.length} 份 BIO ｜` +
    `異常 ${results.length} 份 ｜` +
    `門檻 > ${CONFIG.maxLength} 字元`
);

if (!results.length) {
    dv.paragraph("✅ 沒有異常 BIO");
} else {

    // 複製名稱
    const btn1 = dv.el("button", "📋 複製 BIO 名稱");
    btn1.onclick = () => copyText(nameList, btn1);

    // 複製完整路徑
    const btn2 = dv.el("button", "📂 複製完整路徑");
    btn2.style.marginLeft = "10px";
    btn2.onclick = () => copyText(pathList, btn2);

    // 可點擊的 BIO 清單
    dv.table(
        ["BIO", "META 筆數", "最長字元", "行號"],
        results.map(x => [
            dv.fileLink(x.path, false, x.name),
            x.count,
            x.max,
            x.lines.join(", ")
        ])
    );
}
```
