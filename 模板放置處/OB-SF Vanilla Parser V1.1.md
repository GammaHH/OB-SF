<%*
const CONFIG = {

    recipeRoot:
        "參考資料/Minecraft/recipe",

    langPath:
        "參考資料/Minecraft/zh_tw.json",

    itemTagRoot:
        "參考資料/Minecraft/tags/item",

    blockTagRoot:
        "參考資料/Minecraft/tags/block",


    outputFolder:
        "MC-自動化實作",

    normalizedFile:
        "Minecraft Normalized Recipes.json",

    tagRegistryFile:
        "Minecraft Tag Registry.json",

    manifestFile:
        "Minecraft Recipe Manifest.md"
};

// ============================================================
// Minecraft Parser Module
// ============================================================

const path = require("path");

const minecraftParserPath =
    path.join(
        app.vault.adapter.basePath,
        "模板放置處",
        "MC解析器模塊"
    );

const minecraftParserResolved =
    require.resolve(minecraftParserPath);

// 開發期間避免載入舊的 CommonJS cache
delete require.cache[minecraftParserResolved];

const minecraftParser =
    require(minecraftParserResolved);


// ============================================================
// 1. 基本工具
// ============================================================

function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}


async function ensureFolder(path) {
    const parts = normalizePath(path).split("/");
    let current = "";

    for (const part of parts) {
        current = current ? `${current}/${part}` : part;

        if (!app.vault.getAbstractFileByPath(current)) {
            await app.vault.createFolder(current);
        }
    }
}


async function writeOrReplace(path, content) {
    const existing = app.vault.getAbstractFileByPath(path);

    if (existing) {
        await app.vault.modify(existing, content);
    } else {
        await app.vault.create(path, content);
    }
}


function escapeMarkdownTable(text) {
    if (text == null) return "";

    return String(text)
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ");
}


function getStatusIcon(status) {
    switch (status) {
        case "OK":
            return "✅ OK";

        case "REVIEW":
            return "⚠ REVIEW";

        case "ERROR":
            return "❌ ERROR";

        default:
            return status;
    }
}


// ============================================================
// 2. Translation Resolver
// ============================================================

async function loadLanguageFile() {
    const file =
        app.vault.getAbstractFileByPath(
            normalizePath(CONFIG.langPath)
        );

    if (!file) {
        console.warn(
            `[Vanilla Parser] 找不到語言檔：${CONFIG.langPath}`
        );

        return {};
    }

    try {
        const text = await app.vault.read(file);
        return JSON.parse(text);

    } catch (err) {
        console.error(
            "[Vanilla Parser] zh_tw.json 解析失敗",
            err
        );

        return {};
    }
}


function resolveMinecraftName(id, lang) {
    if (!id) return null;

    const cleanId =
        id.startsWith("minecraft:")
            ? id.slice("minecraft:".length)
            : id;

    const itemKey =
        `item.minecraft.${cleanId}`;

    const blockKey =
        `block.minecraft.${cleanId}`;

    return (
        lang[itemKey] ??
        lang[blockKey] ??
        null
    );
}





// ============================================================
// 9. 找出所有 recipe JSON
// ============================================================

const recipeRoot =
    normalizePath(CONFIG.recipeRoot);

const recipeFiles =
    app.vault
        .getFiles()
        .filter(file => {

            const path =
                normalizePath(file.path);

            return (
                path.startsWith(
                    recipeRoot + "/"
                ) &&
                file.extension.toLowerCase() ===
                    "json"
            );
        });


if (recipeFiles.length === 0) {
    new Notice(
        `找不到 Recipe JSON：${recipeRoot}`
    );

    return;
}


// ============================================================
// 10. 載入翻譯
// ============================================================

const lang =
    await loadLanguageFile();
// ============================================================
// Minecraft Tag Registry
// ============================================================

const tagRegistry =
    await minecraftParser
        .tags
        .buildRegistry(
            app,
            {
                itemRoot:
                    CONFIG.itemTagRoot,

                blockRoot:
                    CONFIG.blockTagRoot,

                namespace:
                    "minecraft"
            }
        );


console.log(
    "[Minecraft Tag Registry]",
    tagRegistry.stats
);

// ============================================================
// 11. 建立 Normalized Item Registry
//
// Map:
//
// minecraft:item_id
// ↓
// {
//     id,
//     name,
//     recipes: [],
//     warnings: []
// }
//
// ============================================================

const itemMap =
    new Map();

const manifestRows =
    [];


// ============================================================
// 12. Parse 全部 JSON
// ============================================================

for (const file of recipeFiles) {

    let json;


    // --------------------------------------------------------
    // JSON parse
    // --------------------------------------------------------

    try {
        const text =
            await app.vault.read(file);

        json =
            JSON.parse(text);

    } catch (err) {

        manifestRows.push({
            status: "ERROR",
            name: "",
            id: "",
            type: "JSON ERROR",
            output: "",
            ingredients: "",
            sourceFile: file.path,
            warnings:
                `JSON 解析失敗：${err.message}`
        });

        continue;
    }


    // --------------------------------------------------------
    // Recipe parse
    // --------------------------------------------------------

    let parsed;

    try {
        parsed =
    minecraftParser.parseRecipe(
        json,
        file.path
    );

    } catch (err) {

        manifestRows.push({
            status: "ERROR",
            name: "",
            id: "",
            type:
                json.type ?? "",

            output: "",
            ingredients: "",
            sourceFile:
                file.path,

            warnings:
                `Parser Exception：${err.message}`
        });

        continue;
    }


    // --------------------------------------------------------
    // Unsupported / Error
    // --------------------------------------------------------

    if (!parsed.success) {

        const rawResult =
    minecraftParser
        .shared
        .normalizeResult(
            json.result
        );
        const resultId =
            rawResult.id ?? "";

        manifestRows.push({
            status:
                parsed.status,

            name:
                resolveMinecraftName(
                    resultId,
                    lang
                ) ?? "",

            id:
                resultId,

            type:
                json.type ?? "",

            output:
                rawResult.count ?? "",

            ingredients:
                "",

            sourceFile:
                file.path,

            warnings:
                parsed.warnings.join("; ")
        });

        continue;
    }

// ============================================================
// Resolve Recipe Tags
// ============================================================

const tagResolution =
    minecraftParser
        .tags
        .resolveIngredients(
            parsed.recipe.ingredients,
            tagRegistry,
            "item"
        );


parsed.recipe.ingredients =
    tagResolution.ingredients;


if (
    tagResolution.warnings.length > 0
) {

    parsed.warnings.push(
        ...tagResolution.warnings
    );


    if (
        parsed.status === "OK"
    ) {

        parsed.status =
            "REVIEW";
    }
}
    // --------------------------------------------------------
    // 合併同一個 Result ID 的多條 recipe
    // --------------------------------------------------------

    const id =
        parsed.resultId;

    const name =
        resolveMinecraftName(
            id,
            lang
        );


    if (!itemMap.has(id)) {

        itemMap.set(id, {
            id,
            name,
            recipes: [],
            warnings: []
        });
    }


    const item =
        itemMap.get(id);


    item.recipes.push(
        parsed.recipe
    );


    if (!name) {
        item.warnings.push(
            "找不到 zh_tw 翻譯"
        );
    }


    for (const warning of parsed.warnings) {
        item.warnings.push(warning);
    }


    // --------------------------------------------------------
    // Manifest 每條 recipe 各列一行
    // --------------------------------------------------------

    manifestRows.push({
        status:
            (
                parsed.status === "OK" &&
                !name
            )
                ? "REVIEW"
                : parsed.status,

        name:
            name ?? "",

        id,

        type:
            parsed.recipe.sourceType,

        section:
            parsed.recipe.section,

        machine:
            parsed.recipe.machine,

        output:
            parsed.recipe.output,

        ingredients:
    parsed.recipe.ingredients
        .map(
            minecraftParser
                .shared
                .ingredientToText
        )
        .join("<br>"),

        sourceFile:
            file.path,

        warnings:
            [
                ...(
                    !name
                        ? ["找不到 zh_tw 翻譯"]
                        : []
                ),

                ...parsed.warnings
            ].join("; ")
    });
}


// ============================================================
// 13. Normalized Recipe Object
// ============================================================

const normalizedItems =
    Array.from(
        itemMap.values()
    )
    .sort(
        (a, b) =>
            a.id.localeCompare(b.id)
    );


// 去除重複 warning
for (const item of normalizedItems) {

    item.warnings =
        [...new Set(item.warnings)];
}


const normalizedOutput = {
    schema:
        "OB-SF Minecraft Normalized Recipe V1",

    generatedAt:
        new Date().toISOString(),

    recipeRoot:
        CONFIG.recipeRoot,

    supportedRecipeTypes:
    minecraftParser
        .getSupportedTypes(),

    itemCount:
        normalizedItems.length,

    recipeCount:
        normalizedItems.reduce(
            (sum, item) =>
                sum + item.recipes.length,
            0
        ),

    items:
        normalizedItems
};


// ============================================================
// 14. Manifest 統計
// ============================================================

const statusCount = {
    OK: 0,
    REVIEW: 0,
    ERROR: 0
};


for (const row of manifestRows) {

    if (
        statusCount[row.status] != null
    ) {
        statusCount[row.status]++;
    }
}

// ============================================================
// REVIEW 分類統計
// ============================================================

const reviewTypeCount =
    new Map();

const reviewReasonCount =
    new Map();


for (const row of manifestRows) {

    if (row.status !== "REVIEW") {
        continue;
    }


    // --------------------------------------------------------
    // 依 Recipe Type 統計
    // --------------------------------------------------------

    const type =
        row.type ||
        "UNKNOWN";


    reviewTypeCount.set(
        type,
        (reviewTypeCount.get(type) ?? 0) + 1
    );


    // --------------------------------------------------------
    // 依 Warning 原因統計
    // --------------------------------------------------------

    const reasons =
        String(row.warnings ?? "")
            .split(";")
            .map(x => x.trim())
            .filter(Boolean);


    if (reasons.length === 0) {

        reviewReasonCount.set(
            "未提供原因",
            (reviewReasonCount.get("未提供原因") ?? 0) + 1
        );

        continue;
    }


    for (const reason of reasons) {

        reviewReasonCount.set(
            reason,
            (reviewReasonCount.get(reason) ?? 0) + 1
        );
    }
}
// ============================================================
// 15. 建立 Markdown Manifest
// ============================================================

let manifest = "";

manifest +=
    "# Minecraft Recipe Manifest\n\n";

manifest +=
    `> Generated: ${new Date().toLocaleString()}\n\n`;

manifest +=
    `- JSON files：${recipeFiles.length}\n`;

manifest +=
    `- Normalized items：${normalizedItems.length}\n`;

manifest +=
    `- Parsed recipes：${normalizedOutput.recipeCount}\n`;

manifest +=
    `- ✅ OK：${statusCount.OK}\n`;

manifest +=
    `- ⚠ REVIEW：${statusCount.REVIEW}\n`;

manifest +=
    `- ❌ ERROR：${statusCount.ERROR}\n\n`;

// ============================================================
// REVIEW Summary
// ============================================================

manifest +=
    "## REVIEW Summary\n\n";


manifest +=
    "### By Recipe Type\n\n";

manifest +=
    "| Recipe Type | Count |\n";

manifest +=
    "| --- | ---: |\n";


const sortedReviewTypes =
    Array.from(
        reviewTypeCount.entries()
    )
    .sort(
        (a, b) =>
            b[1] - a[1]
    );


for (
    const [type, count]
    of sortedReviewTypes
) {

    manifest +=
        `| \`${escapeMarkdownTable(type)}\` | ${count} |\n`;
}


manifest +=
    "\n### By Reason\n\n";

manifest +=
    "| Reason | Count |\n";

manifest +=
    "| --- | ---: |\n";


const sortedReviewReasons =
    Array.from(
        reviewReasonCount.entries()
    )
    .sort(
        (a, b) =>
            b[1] - a[1]
    );


for (
    const [reason, count]
    of sortedReviewReasons
) {

    manifest +=
        `| ${escapeMarkdownTable(reason)} | ${count} |\n`;
}


manifest += "\n";
manifest +=
    "## Requires Review\n\n";


manifest +=
    "| 狀態 | 中文 | Minecraft ID | Type | Section | Machine | Output | Ingredients | Warning | Source |\n";

manifest +=
    "| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |\n";


for (const row of manifestRows) {

    // ✅ 正常資料不寫入巨大 Markdown 表格
    if (row.status === "OK") continue;

    manifest +=
        `| ${escapeMarkdownTable(getStatusIcon(row.status))}` +
        ` | ${escapeMarkdownTable(row.name)}` +
        ` | \`${escapeMarkdownTable(row.id)}\`` +
        ` | \`${escapeMarkdownTable(row.type)}\`` +
        ` | ${escapeMarkdownTable(row.section ?? "")}` +
        ` | ${escapeMarkdownTable(row.machine ?? "")}` +
        ` | ${escapeMarkdownTable(row.output)}` +
        ` | ${escapeMarkdownTable(row.ingredients)}` +
        ` | ${escapeMarkdownTable(row.warnings)}` +
        ` | \`${escapeMarkdownTable(row.sourceFile)}\`` +
        " |\n";
}


// ============================================================
// 16. Multi-recipe 檢查表
// ============================================================

const multiRecipeItems =
    normalizedItems.filter(
        item =>
            item.recipes.length > 1
    );


manifest +=
    "\n## Multiple Recipes\n\n";


if (multiRecipeItems.length === 0) {

    manifest +=
        "目前沒有偵測到多配方物品。\n";

} else {

    manifest +=
        "| 中文 | Minecraft ID | Recipe Count | Types |\n";

    manifest +=
        "| --- | --- | ---: | --- |\n";


    for (const item of multiRecipeItems) {

        const types =
            item.recipes
                .map(x => x.sourceType)
                .join("<br>");


        manifest +=
            `| ${escapeMarkdownTable(item.name ?? "")}` +
            ` | \`${escapeMarkdownTable(item.id)}\`` +
            ` | ${item.recipes.length}` +
            ` | ${escapeMarkdownTable(types)}` +
            " |\n";
    }
}


// ============================================================
// 17. Missing Translation
// ============================================================

const missingTranslation =
    normalizedItems.filter(
        item => !item.name
    );


manifest +=
    "\n## Missing Translation\n\n";


if (missingTranslation.length === 0) {

    manifest +=
        "沒有缺少翻譯的物品。\n";

} else {

    manifest +=
        "| Minecraft ID |\n";

    manifest +=
        "| --- |\n";


    for (const item of missingTranslation) {

        manifest +=
            `| \`${escapeMarkdownTable(item.id)}\` |\n`;
    }
}


// ============================================================
// 18. 寫出檔案
// ============================================================

await ensureFolder(
    CONFIG.outputFolder
);
const tagRegistryPath =
    normalizePath(
        `${CONFIG.outputFolder}/${CONFIG.tagRegistryFile}`
    );

const normalizedPath =
    normalizePath(
        `${CONFIG.outputFolder}/${CONFIG.normalizedFile}`
    );

await writeOrReplace(
    tagRegistryPath,
    JSON.stringify(
        {
            schema:
                "OB-SF Minecraft Tag Registry V1",

            generatedAt:
                new Date()
                    .toISOString(),

            stats:
                tagRegistry.stats,

            item:
                tagRegistry.item,

            block:
                tagRegistry.block,

            errors:
                tagRegistry.errors
        },
        null,
        2
    )
);
const manifestPath =
    normalizePath(
        `${CONFIG.outputFolder}/${CONFIG.manifestFile}`
    );


await writeOrReplace(
    normalizedPath,
    JSON.stringify(
        normalizedOutput,
        null,
        2
    )
);


await writeOrReplace(
    manifestPath,
    manifest
);


// ============================================================
// 19. 完成通知
// ============================================================

new Notice(
    `Minecraft Recipe Parser 完成\n` +
    `Items: ${normalizedItems.length}\n` +
    `Recipes: ${normalizedOutput.recipeCount}\n` +
    `Review: ${statusCount.REVIEW}\n` +
    `Error: ${statusCount.ERROR}`
);

const processedFileCount = manifestRows.length;

if (processedFileCount !== recipeFiles.length) {
    console.warn(
        `[Vanilla Parser] 檔案數不一致：掃描 ${recipeFiles.length}，Manifest ${processedFileCount}`
    );
}
%>