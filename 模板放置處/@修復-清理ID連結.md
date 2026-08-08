<%*
// ======================================
// 1. 取得目前檔案
// ======================================
const file = tp.file.find_tfile(tp.file.title);

if (!file) {
    new Notice("找不到當前檔案！");
    return;
}


// ======================================
// 2. 讀取全文
// ======================================
let content = await app.vault.read(file);

const DV = "::";


// ======================================
// 3. TYPE 判斷
//
// 只看最後一段：
// sf-item  → item
// mc-item  → item
// sf-drop  → drop
// mc-drop  → drop
// sf-GEO   → GEO
// ======================================
function getOutputType(fileType) {

    if (!fileType) return "";

    let suffix =
        String(fileType)
            .split("-")
            .pop();

    if (suffix === "item") {
        return "item";
    }

    if (suffix === "drop") {
        return "drop";
    }

    if (suffix.toLowerCase() === "geo") {
        return "GEO";
    }

    return "";
}


// ======================================
// 4. 建立「檔名 → TYPE」字典
// ======================================
const files = app.vault.getMarkdownFiles();
const fileTypeDict = {};

for (let f of files) {

    const frontmatter =
        app.metadataCache
            .getFileCache(f)
            ?.frontmatter || {};

    let fileType =
        frontmatter.type || "";

    let outputType =
        getOutputType(fileType);

    if (outputType) {
        fileTypeDict[f.basename] =
            outputType;
    }
}


// ======================================
// 5. 清理具有 TYPE 的材料連結
//
// 例如：
// [item:: [[海曼星塵|JIGSAW]]]
// → [GEO:: [[海曼星塵]]]
// ======================================
const typedLinkRegex =
    /\[(item|GEO|drop)::\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\]/g;

content = content.replace(
    typedLinkRegex,
    function(match, oldType, linkName) {

        let cleanName = linkName.trim();

        // 如果連結包含資料夾路徑，只取檔名判斷 type
        let baseName =
            cleanName.split("/").pop();

        let newType =
            fileTypeDict[baseName] || oldType;

        return `[${newType}${DV} [[${cleanName}]]]`;
    }
);


// ======================================
// 6. 清理其他普通 alias 連結
//
// [[主檔名|別名]]
// → [[主檔名]]
// ======================================
const normalLinkRegex =
    /\[\[([^\]|]+)\|[^\]]+\]\]/g;

content = content.replace(
    normalLinkRegex,
    "[[$1]]"
);


// ======================================
// 7. 寫回檔案
// ======================================
await app.vault.modify(
    file,
    content
);

new Notice(
    "🧹 清理完成！已移除別名，並依 BIO type 修正 item / GEO / drop！"
);
%>