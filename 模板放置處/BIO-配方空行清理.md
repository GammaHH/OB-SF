<%*
// ============================================================
// OB-SF BIO Recipe Blank Line Cleaner V2
//
// Dry-run / Apply Selection
// DataviewJS Report
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CONFIG = {

    folder:
        "選擇資料夾",

    reportPath:
        "BIO 配方空行清理報告.md"

};


// ============================================================
// Recipe Line Detection
// ============================================================

function isMachine(line) {

    return /^[ \t]*-[ \t]+\*\*生產設備\*\*/.test(line);

}


function isComment(line) {

    return /^[ \t]*<!--.*-->[ \t]*$/.test(line);

}


function isRecipeLine(line) {

    return (
        isMachine(line) ||

        /^[ \t]*\*\*合成所需\*\*/.test(line) ||

        /^[ \t]*-[ \t]+\[(?:item|drop|output|note)::/i.test(line) ||

        isComment(line)
    );

}


function isPreferred(line) {

    return /^[ \t]*<!--\s*preferred\s*-->[ \t]*$/.test(line);

}


// ============================================================
// Clean Recipe Blank Lines
// ============================================================

function cleanRecipeBlankLines(content) {

    const eol =
        content.includes("\r\n")
            ? "\r\n"
            : "\n";

    const lines =
        content.split(/\r?\n/);

    const output = [];

    let insideRecipe = false;
    let removed = 0;


    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];


        // ----------------------------------------------------
        // 標題結束配方區塊
        // ----------------------------------------------------

        if (/^[ \t]{0,3}#{1,6}[ \t]+/.test(line)) {

            insideRecipe = false;

        }


        // ----------------------------------------------------
        // 偵測新配方
        // ----------------------------------------------------

        if (isMachine(line)) {

            insideRecipe = true;

        }


        // ----------------------------------------------------
        // 只處理空白行
        // ----------------------------------------------------

        if (!line.trim()) {

            let prevIndex = i - 1;
            let nextIndex = i + 1;


            while (
                prevIndex >= 0 &&
                !lines[prevIndex].trim()
            ) {

                prevIndex--;

            }


            while (
                nextIndex < lines.length &&
                !lines[nextIndex].trim()
            ) {

                nextIndex++;

            }


            const prev =
                lines[prevIndex] ?? "";

            const next =
                lines[nextIndex] ?? "";


            // preferred 與第一條配方之間
            const preferredToMachine =
                isPreferred(prev) &&
                isMachine(next);


            // 配方列點之間
            const recipeToRecipe =
                insideRecipe &&
                isRecipeLine(prev) &&
                isRecipeLine(next);


            if (
                preferredToMachine ||
                recipeToRecipe
            ) {

                removed++;

                continue;

            }

        }


        // ----------------------------------------------------
        // 遇到非配方內容
        // ----------------------------------------------------

        if (
            line.trim() &&
            insideRecipe &&
            !isRecipeLine(line)
        ) {

            insideRecipe = false;

        }


        output.push(line);

    }


    return {

        content:
            output.join(eol),

        removed

    };

}


// ============================================================
// Folder Selection（通用版）
// ============================================================

// 空字串 = 整個 Obsidian Vault
// 指定路徑 = 只列出該資料夾及其子資料夾
const FOLDER_ROOT = "";

const folders = app.vault
    .getAllLoadedFiles()
    .filter(file =>
        Array.isArray(file.children)
    )
    .map(folder => folder.path)
    .filter(path =>
        path !== "/" &&
        (
            FOLDER_ROOT === "" ||
            path === FOLDER_ROOT ||
            path.startsWith(FOLDER_ROOT + "/")
        )
    )
    .sort((a, b) => {

        // 預設資料夾優先
        if (a === CONFIG.folder) return -1;
        if (b === CONFIG.folder) return 1;

        return a.localeCompare(b, "zh-Hant");
    });

// ============================================================
// Folder Picker
// ============================================================

const folder = await tp.system.suggester(

    folder =>
        folder === CONFIG.folder
            ? `⭐ ${folder}（預設）`
            : `📁 ${folder}`,

    folders,

    false,

    "📂 選擇要掃描的 BIO 資料夾",

    30,

    folders.includes(CONFIG.folder)
        ? CONFIG.folder
        : undefined

);


// 取消選擇
if (folder == null) {

    new Notice("已取消資料夾選擇");

    return;
}


// ============================================================
// Scan Files
// ============================================================

const files = app.vault
    .getMarkdownFiles()
    .filter(file =>

        // 只掃描選擇的資料夾及子資料夾
        file.path.startsWith(folder + "/") &&

        // 避免掃描自己的報告
        file.path !== CONFIG.reportPath

    );
// ============================================================
// Detected Files
// ============================================================

const detected = [];
console.log(
    `[BIO Cleaner] Selected folder: ${folder}`
);

console.log(
    `[BIO Cleaner] Files: ${files.length}`
);


// ============================================================
// Mode Selection
// ============================================================

const mode =
    await tp.system.suggester(

        [
            `🧪 DRY RUN｜只檢查，不修改（偵測 ${detected.length} 份）`,

            `✅ 直接修改｜清理 ${detected.length} 份 BIO`
        ],

        [
            "dry",
            "apply"
        ],

        false,

        "選擇 BIO 空行清理模式",

        undefined,

        "dry"

    );


// 取消選單 → 不執行
if (mode === null) {

    new Notice("已取消 BIO 空行清理");
    return;

}


// ============================================================
// Execute
// ============================================================

let modifiedCount = 0;

let removedCount = 0;

const reportRows = [];


for (const entry of detected) {

    let status =
        mode === "dry"
            ? "預計修改"
            : "已修改";


    if (mode === "apply") {

        try {

            await app.vault.modify(
                entry.file,
                entry.updated
            );

            modifiedCount++;

        } catch (err) {

            status = "修改失敗";

            console.error(
                `[BIO Cleaner] ${entry.path}`,
                err
            );

        }

    }


    if (status !== "修改失敗") {

        removedCount +=
            entry.removed;

    }


    reportRows.push({

        path:
            entry.path,

        name:
            entry.name,

        removed:
            entry.removed,

        status

    });

}


// ============================================================
// Generate DataviewJS Report
// ============================================================

const report = [

    "# BIO 配方空行清理報告",

    "",

    `> 執行時間：${new Date().toLocaleString()}`,

    `> 模式：${mode === "dry" ? "DRY RUN" : "正式修改"}`,
    `> 掃描資料夾：\`${folder}\``,
    "",

    `- 掃描檔案：${files.length}`,

    `- 偵測異常：${detected.length}`,

    `- ${mode === "dry" ? "預計修改" : "成功修改"}：${mode === "dry" ? detected.length : modifiedCount}`,

    `- ${mode === "dry" ? "預計移除" : "成功移除"}空行：${removedCount}`,

    "",

    "## 偵測到的 BIO",

    "",

    "以下為本次執行時偵測到的檔案。正式修改後仍會保留清單，方便回頭驗證。",

    "",

    "```dataviewjs",

    `const files = ${JSON.stringify(reportRows, null, 2)};`,

    "",

    "if (files.length === 0) {",

    '    dv.paragraph("✅ 沒有偵測到需要清理的 BIO");',

    "} else {",

    "    dv.list(",

    "        files.map(f => {",

    '            const label = `${f.name}（${f.status}，${f.removed} 行）`;',

    "            return dv.fileLink(",

    "                f.path,",

    "                false,",

    "                label",

    "            );",

    "        })",

    "    );",

    "}",

    "```",

    ""

].join("\n");


// ============================================================
// Write Report
// ============================================================

const reportPath =
    CONFIG.reportPath.replace(/\\/g, "/");


const existing =
    app.vault.getAbstractFileByPath(
        reportPath
    );


let reportFile;


if (existing) {

    await app.vault.modify(
        existing,
        report
    );

    reportFile = existing;

} else {

    reportFile =
        await app.vault.create(
            reportPath,
            report
        );

}


// ============================================================
// Open Report
// ============================================================

await app.workspace
    .getLeaf(true)
    .openFile(reportFile);


// ============================================================
// Notice
// ============================================================

new Notice(

    `BIO 空行檢查完成\n` +

    `模式：${mode.toUpperCase()}\n` +

    `掃描：${files.length}\n` +

    `偵測：${detected.length}\n` +

    `${mode === "dry" ? "預計修改" : "成功修改"}：${
        mode === "dry"
            ? detected.length
            : modifiedCount
    }\n` +

    `空行：${removedCount}`,

    10000

);

%>