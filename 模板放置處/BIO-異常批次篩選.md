<%*
// ============================================================
// OB-SF | BIO Batch Review Tag Cleaner V2
// 通用資料夾選擇 / DRY RUN（預設）/ 正式修改 / DataviewJS 清單
// ============================================================

const CONFIG = {
    // 空字串：可選擇 Vault 中所有資料夾
    folderRoot: "",
    reportPath: "BIO 批次審核標籤清理報告.md",
    addMissingTag: true
};

// ============================================================
// Regex：沿用原本的判定規則
// ============================================================

const allowedComments = new Set(["preferred", "except self"]);
const COMMENT_REGEX = /<!--([\s\S]*?)-->/g;
const RAW_TAG_REGEX = /\[(?:item|drop)::\s*\\?#[a-z0-9_.-]+:[a-z0-9_./-]+/i;
const REVIEW_TAG_REGEX = /^[ \t]*#未人工檢查[ \t]*(?:\r?\n|$)/gm;
const HAS_REVIEW_TAG_REGEX = /^[ \t]*#未人工檢查[ \t]*$/m;

function normalizePath(p) {
    return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
}

function insertReviewTag(text) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const frontmatter = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
    const pos = frontmatter ? frontmatter[0].length : 0;
    return text.slice(0, pos) + "#未人工檢查" + eol + text.slice(pos);
}

function reviewBio(content) {
    const invalidComments = [...content.matchAll(COMMENT_REGEX)]
        .map(m => m[1].trim().replace(/\s+/g, " ").toLowerCase())
        .filter(name => !allowedComments.has(name));

    const hasRawTag = RAW_TAG_REGEX.test(content);
    const qualified = invalidComments.length === 0 && !hasRawTag;
    const hasReviewTag = HAS_REVIEW_TAG_REGEX.test(content);
    const reasons = [];
    if (invalidComments.length) reasons.push("含其他 HTML 註解");
    if (hasRawTag) reasons.push("含未解析 Minecraft Tag");

    let updated = content;
    let action = "不需修改";

    if (qualified && hasReviewTag) {
        updated = content.replace(REVIEW_TAG_REGEX, "");
        action = "移除 #未人工檢查";
    } else if (!qualified && !hasReviewTag && CONFIG.addMissingTag) {
        updated = insertReviewTag(content);
        action = "補上 #未人工檢查";
    } else if (!qualified) {
        action = "保留 #未人工檢查";
    }

    return {
        qualified,
        reasons,
        action,
        changed: updated !== content,
        updated
    };
}

// ============================================================
// 1. 選擇資料夾（通用；可搜尋）
// ============================================================

const root = normalizePath(CONFIG.folderRoot);
const folders = app.vault.getAllLoadedFiles()
    .filter(f => Array.isArray(f.children))
    .map(f => normalizePath(f.path))
    .filter(p => p && p !== "/" && (!root || p === root || p.startsWith(root + "/")))
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));

if (!folders.length) {
    new Notice("找不到可選擇的資料夾");
    return;
}

const folder = await tp.system.suggester(
    p => `📁 ${p}`,
    folders,
    false,
    "📂 選擇要掃描的資料夾"
);

if (folder == null) {
    new Notice("已取消資料夾選擇");
    return;
}

// ============================================================
// 2. 掃描與計算預計變更（尚未寫檔）
// ============================================================

const reportPath = normalizePath(CONFIG.reportPath);
const files = app.vault.getMarkdownFiles()
    .filter(f => f.path.startsWith(folder + "/") && f.path !== reportPath);

const scanned = [];
const skipped = [];
let qualifiedCount = 0;
let reviewCount = 0;

for (const file of files) {
    const path = file.path;
    let content;
    try {
        content = await app.vault.read(file);
    } catch (err) {
        if (err?.code !== "ENOENT") throw err;
        skipped.push({
            path,
            name: file.basename,
            group: "需重新掃描",
            status: "路徑已不存在",
            reasons: "檔案可能已在 Obsidian 外改名或移動"
        });
        continue;
    }
    const result = reviewBio(content);

    if (result.qualified) qualifiedCount++;
    else reviewCount++;

    // 已不合格（即使本次不需改），或本次會修改的都列出
    if (!result.qualified || result.changed) {
        scanned.push({
            file,
            path,
            name: file.basename,
            ...result,
            originalContent: content
        });
    }
}

const plannedChanges = scanned.filter(x => x.changed).length;

// ============================================================
// 3. 操作模式：DRY RUN 排第一個（預設）
// ============================================================

const mode = await tp.system.suggester(
    [
        `🧪 DRY RUN｜只檢查、不修改（預計改動 ${plannedChanges} 份）`,
        `✅ 直接修改｜更新 ${plannedChanges} 份檔案`
    ],
    ["dry", "apply"],
    false,
    "選擇 BIO 標籤審核模式"
);

if (mode == null) {
    new Notice("已取消 BIO 標籤審核");
    return;
}

// ============================================================
// 4. 正式修改（僅 apply）＋保留本次掃描快照
// ============================================================

let successfulChanges = 0;
let failedChanges = 0;
const reportRows = [...skipped];

for (const entry of scanned) {
    let status;

    if (mode === "dry") {
        status = entry.changed ? `預計${entry.action}` : entry.action;
    } else if (!entry.changed) {
        status = entry.action;
    } else {
        try {
            // 避免使用者在選單期間修改檔案後被舊掃描覆蓋
            const currentFile = app.vault.getAbstractFileByPath(entry.path);
            const latest = currentFile === entry.file ? await app.vault.read(currentFile) : null;
            if (latest !== entry.originalContent || currentFile?.path !== entry.path) {
                status = "⚠ 檔案內容已變動，跳過";
                failedChanges++;
            } else {
                await app.vault.modify(entry.file, entry.updated);
                successfulChanges++;
                status = `已${entry.action}`;
            }
        } catch (err) {
            failedChanges++;
            status = `修改失敗：${err.message}`;
            console.error("[BIO Tag Cleaner]", entry.path, err);
        }
    }

    reportRows.push({
        path: entry.path,
        name: entry.name,
        group: entry.qualified ? "標籤清理" : "待人工確認",
        status,
        reasons: entry.reasons.join("；")
    });
}

// ============================================================
// 5. 每次產生 DataviewJS 快照（直接列出可點擊檔案）
// ============================================================

const code = [
    "```dataviewjs",
    `const rows = ${JSON.stringify(reportRows)};`,
    "for (const group of ['待人工確認', '標籤清理', '需重新掃描']) {",
    "  const selected = rows.filter(x => x.group === group);",
    "  dv.header(3, `${group}（${selected.length}）`);",
    "  if (!selected.length) { dv.paragraph('無'); continue; }",
    "  dv.list(selected.map(x => x.group === '需重新掃描' ? `${x.path}｜${x.reasons}` : dv.fileLink(x.path, false, `${x.name}｜${x.status}${x.reasons ? '｜' + x.reasons : ''}`)));",
    "}",
    "```"
].join("\n");

const report = [
    "# BIO 批次審核標籤清理報告",
    "",
    `> 執行時間：${new Date().toLocaleString()}`,
    `> 模式：${mode === "dry" ? "DRY RUN" : "正式修改"}`,
    `> 資料夾：\`${folder}\``,
    "",
    `- 成功掃描：${qualifiedCount + reviewCount}`,
    `- 路徑失效，需重新掃描：${skipped.length}`,
    `- 通過 Regex 初篩：${qualifiedCount}`,
    `- 待人工確認：${reviewCount}`,
    `- 偵測清單：${reportRows.length}`,
    `- 預計修改：${plannedChanges}`,
    `- 實際修改：${successfulChanges}`,
    `- 修改失敗或跳過：${failedChanges}`,
    "",
    "> ⚠ 通過 Regex 初篩不等同於配方內容已人工驗證。",
    "",
    "## 本次偵測檔案",
    "",
    code,
    ""
].join("\n");

let reportFile = app.vault.getAbstractFileByPath(reportPath);
if (reportFile) {
    await app.vault.modify(reportFile, report);
} else {
    reportFile = await app.vault.create(reportPath, report);
}

await app.workspace.getLeaf(true).openFile(reportFile);
new Notice(
    `BIO 標籤初篩完成 (${mode.toUpperCase()})\n` +
    `掃描 ${qualifiedCount + reviewCount}｜待確認 ${reviewCount}｜路徑失效 ${skipped.length}\n` +
    `預計修改 ${plannedChanges}｜實際修改 ${successfulChanges}`,
    10000
);
%>
