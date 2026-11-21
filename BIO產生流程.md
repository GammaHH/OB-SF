---
updated: 2026-11-21 14:56:26
created: 2026-11-16 02:21:06
---
# 解析插件原始碼

- 目前有兩種方式
1. [[!模板-Mini Parser]]
2. 執行 BIO GENERATOR

# 決定偏好路徑 (走2)

- 透過 OB-CLI
	1. Base Material Review
	2. BIO Group Mapping Draft / Tag BIO Mapping Draft
	3. Recipe Review
	4. Review Decisions
	5. Review Queue (狀態顯示)
	6. Recipe Mapping Draft
- 建立該 BATCH 的 METADATA 與 `<!-- preferred -->` 路徑

# 產生 .Preview


# 掃描 .Preview 是否有潛在衝突

node 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF\scripts\minecraft-bio-generator.cjs' scan-publication

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

    dv.paragraph("✅ 沒有異常 BIO");

} else {

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

node 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF\scripts\minecraft-bio-generator.cjs' publish
-  --write 正式寫入資料庫

封存

node 'C:\Users\Owner\.codex\worktrees\cee9\OB-SF\scripts\minecraft-bio-generator.cjs' archive-publication --write
