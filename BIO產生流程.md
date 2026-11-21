---
updated: 2026-11-21 17:55:06
created: 2026-11-16 02:21:06
---
# 解析來源

- 目前有兩種方式
1. [[!模板-Mini Parser]]，單條手動輸入與解析
2. [[OB-SF Slimefun Parser V1]]：鎖定 Slimefun4 Java 原始碼，產生標準化資料與 Manifest。
3. Minecraft 沿用 [[OB-SF Vanilla Parser V1.3]]，或由既有 MC CLI 直接在記憶體內解析／正規化。

操作入口統一使用 [[OB-CLI]] 模板；只複製完整 PowerShell 前景指令，保留每次獨立的 stdout／stderr 日誌。完整說明見 [[OB-CLI 操作手冊]]，Slimefun 規格見 [[OB-SF Slimefun4 Java Parser MASTER NOTE]]。

# 標準化

- Parser 產生 Normalized Recipe Registry；Generator 讀標準化資料，不重複解析 Java／YAML。
- Slimefun V1 使用 `OB-SF Normalized Recipe V1`，材料沿用 `kind / id / qty`；保留來源 commit、檔案／行號、slots、output 與解析狀態。
- 未解析的註冊與動態配方列於 Manifest，不能自動視為 Base；已解析目標的 Queue READY 不等於完整來源解析完成。

# 決定偏好路徑 (走2)

- 透過 OB-CLI
	1. [[BIO Base Material Review]]
	2. [[BIO Collection Mapping Draft]]：Tag／Group 合併設定入口，保留不同身分
	3. [[BIO Recipe Review]]
	4. [[BIO Review Decisions]]，活躍及歷史人工決策目前共用 `BIO Review Decisions.json`。生命週期見 [[OB-SF Decision Registry 生命週期與 BIO 更新架構]]。
	5. [[BIO Review Queue]]（狀態顯示）
	6. [[Recipe Mapping Draft]]（Provider／Machine／分類／正式目錄）
- 建立該 BATCH 的 METADATA 與 `<!-- preferred -->` 路徑
- CD 導到正確資料夾路徑後
	- SCAN 建立／更新 Queue；NEXT 啟用下一個目標。
	- 人工編輯 Review → RECALCULATE → 未完成則繼續修正，READY 後 NEXT。
- Minecraft 使用 source adapter；標準化 JSON 使用 normalized adapter，共用文件與決策庫，但不把 Vanilla 的自動 Base 判定套用到 Slimefun。

# BIO Preview 產生

- 在 [[OB-CLI]] 選擇「Normalized JSON → BIO Preview」，先預演，再寫入 Preview。預設只產生當前來源中已完成 Review 的目標。
- Mini Parser：`@自動化BIO Preview/mini`；Normalized Generator：`@自動化BIO Preview/plugin`，共用根目錄。
- 既有 BIO 的原配方、Preferred、圖文保留，新來源路線附加供人工比較，不直接寫回正式檔。
- Normalized Generator 的 `--from-formal`、Vanilla 的 `--update-existing` 與 `refresh-batch` 都採追加方式，保留舊路線與 Preferred。Vanilla 的兩個入口共用同一套比對。候選新增第二條有效路線時，若仍沒有 Preferred，由人工指定。
- **Review Queue READY → Preview Generator。Publication SCAN READY → PUBLISH。** 中間必須完成 Preview、Preferred Audit 與人工審核。
- 記錄本批 `BIO Publication.json`；後續 SCAN／PUBLISH／ARCHIVE 明確選擇同一 manifest。

# Preview 人工審核與集中掃描

- 在 [[OB-CLI]] 選擇集中 SCAN。它會寫審核表，也可能依勾選建立材料 Base Preview／補完獨立 Preview，不是純唯讀。
- 修正材料、產量、Machine、Preferred、外部取得說明與管理標籤後重掃，直到 READY。
- 設備與材料一起檢查；循環會列完整依賴路徑及相關 BIO，不能直接發布。

- 可以在審核一定量 BIO 之後使用模板 [[BIO-異常批次篩選]]，或是使用以下量表快速定位異常 BIO
- 外部 BIO 使用本地 AI 或是自行查詢取得方式

```dataviewjs
// ========================================
// OB-SF | Long Metadata Scanner V3
// 唯讀掃描｜實際檔案｜異常 Metadata
// ========================================

const CONFIG = {
    folder: "@自動化BIO Preview",
    maxLength: 20,
    onlyPreview: true
};

// 專門偵測 obsf:choices Metadata
const META_REGEX = /<!--\s*obsf:choices\b[\s\S]*?-->/gi;
let scanReadFailures = 0;


// ========================================
// 1. 從磁碟取得目前存在的 BIO
// ========================================

const files = [];
const folders = [CONFIG.folder];

while (folders.length) {

    const folder = folders.pop();

    let entries;

    try {
        entries = await app.vault.adapter.list(folder);
    } catch (error) {
        scanReadFailures++;
        console.warn("[BIO Scanner] 無法列出資料夾：", folder, error);
        continue;
    }

    folders.push(...entries.folders);

    for (const path of entries.files) {

        if (!path.toLowerCase().endsWith(".md")) {
            continue;
        }

        if (
            CONFIG.onlyPreview &&
            !/\.(?:update-)?preview\.md$/i.test(path)
        ) {
            continue;
        }

        const name = path.split("/").pop();

        files.push({
            path,
            name,
            basename: name.replace(/\.md$/i, "")
        });
    }
}


// ========================================
// 2. 掃描 Metadata
// ========================================

const results = [];
let scannedCount = 0;

for (const file of files) {

    let content;

    try {
        content = await app.vault.adapter.read(file.path);
    } catch (error) {
        scanReadFailures++;
        // 掃描期間檔案可能被外部程式移動
        // 不列入結果，也不影響其他檔案
        console.warn(
            "[BIO Scanner] 略過讀取失敗：",
            file.path,
            error
        );
        continue;
    }

    scannedCount++;

    const abnormal = [...content.matchAll(META_REGEX)]
        .filter(m => m[0].length > CONFIG.maxLength)
        .map(m => ({
            length: m[0].length,
            line: content.slice(0, m.index)
                .split(/\r?\n/).length
        }));

    if (!abnormal.length) {
        continue;
    }

    results.push({
        name: file.basename,
        path: file.path,
        count: abnormal.length,
        max: Math.max(...abnormal.map(x => x.length)),
        lines: abnormal.map(x => x.line)
    });
}


// ========================================
// 3. 按 Metadata 長度排序
// ========================================

results.sort((a, b) => b.max - a.max);


// ========================================
// 4. 建立複製清單
// ========================================

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


// ========================================
// 5. 剪貼簿功能
// ========================================

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


// ========================================
// 6. 顯示掃描結果
// ========================================

dv.header(2, "🔍 BIO 過長 Metadata 清單");

dv.paragraph(
    `掃描 ${scannedCount} 份 BIO ｜` +
    `異常 ${results.length} 份 ｜` +
    `門檻 > ${CONFIG.maxLength} 字元`
);


// ========================================
// 7. 顯示異常 BIO
// ========================================

if (!results.length) {

    dv.paragraph(scanReadFailures
        ? `⚠ 掃描不完整：${scanReadFailures} 次列舉／讀取失敗；目前已讀取的 BIO 沒有命中長 Metadata。`
        : "✅ 目前已讀取的 BIO 沒有命中長 Metadata；配方合法性仍以集中 SCAN 為準。");

} else {

    if (scanReadFailures) dv.paragraph(`⚠ 掃描不完整：${scanReadFailures} 次列舉／讀取失敗。`);

    // 複製 BIO 名稱
    const btn1 = dv.el(
        "button",
        "📋 複製 BIO 名稱"
    );

    btn1.onclick = () => copyText(nameList, btn1);


    // 複製完整路徑
    const btn2 = dv.el(
        "button",
        "📂 複製完整路徑"
    );

    btn2.style.marginLeft = "10px";

    btn2.onclick = () => copyText(pathList, btn2);


    // 異常清單
    dv.table(
        [
            "BIO",
            "META 筆數",
            "最長字元",
            "行號"
        ],
        results.map(x => [
            dv.fileLink(x.path, false, x.name),
            x.count,
            x.max,
            x.lines.join(", ")
        ])
    );
}
```

# 發布與封存

- [[OB-CLI]]：SCAN → PUBLISH 預演 → PUBLISH 正式寫入 → 驗收收據與 V4 → ARCHIVE 預演 → 正式封存。
- `--write` 才會正式寫入／封存；Parser 與 Generator 不寫正式 BIO。來源、Preview 或正式依賴變更後須重掃。
- [[BIO盤點]] 同時輸出正式身分盤點與 Preferred 稽核。OB-CLI 的 `audit-preferred` 可額外掃描 Preview，僅產出報告。[[BIO套用更新]] 從既有候選批次複製 SCAN／發布指令，另有舊版單筆套用入口。
- RELOAD 與完整循環路徑診斷已由使用者回報驗收；本輪 Slimefun／通用化變更仍待測試與實測。

- Preferred 稽核指令，或是執行模板 BIO盤點
	node scripts/ob-cli.cjs audit-preferred --scope=all

封存依 COMPLETE 收據與 SHA256 校驗。復原入口為 [[一鍵復原 git 歷史紀錄]]，按鈕只複製使用者前景執行的指令。

# 相關指令

全量測試
node scripts/ob-cli.cjs test