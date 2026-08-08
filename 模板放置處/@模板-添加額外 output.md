<%*
// ============================================================
// BIO 配方批產量補全工具
//
// 功能：
// 1. 掃描目前 BIO
// 2. 找出每個 (Machine:: ...) 配方區塊
// 3. 已有 [output:: ?] → 跳過
// 4. 沒有 output → 詢問批產量
// 5. 預設值使用 frontmatter output
// 6. 插入在該配方最後一個材料之後
// ============================================================


// ======================================
// 1. 取得目前檔案
// ======================================

const file =
    tp.file.find_tfile(
        tp.file.title
    );

if (!file) {
    new Notice("❌ 找不到目前檔案");
    return;
}


// ======================================
// 2. 讀取全文
// ======================================

let content =
    await app.vault.read(file);

const DV = "::";


// ======================================
// 3. 取得 Frontmatter 預設 output
// ======================================

const frontmatter =
    app.metadataCache
        .getFileCache(file)
        ?.frontmatter || {};

let defaultOutput =
    Number(frontmatter.output);

if (
    !Number.isFinite(defaultOutput) ||
    defaultOutput <= 0
) {
    defaultOutput = 1;
}


// ======================================
// 4. 切成逐行處理
// ======================================

let lines =
    content.split(/\r?\n/);


// ======================================
// 5. Machine / 材料辨識 Regex
// ======================================

const machineRegex =
    /\(Machine\s*::\s*(?:\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|([^)]+))\)/i;


// 支援：
// [item:: ...] (qty:: 1)
// [drop:: ...] (qty:: 1)
// [GEO:: ...] (qty:: 1)

const ingredientRegex =
    /^\s*-\s*\[(item|drop|GEO)\s*::/i;


// 已存在 recipe output
const outputRegex =
    /\[output\s*::\s*([0-9.]+)\]/i;


// ======================================
// 6. 找出所有 Machine 區塊
// ======================================

let recipeBlocks = [];

let currentRecipe = null;


for (let i = 0; i < lines.length; i++) {

    let line =
        lines[i];


    // ----------------------------------
    // 新 Machine
    // ----------------------------------

    let machineMatch =
        line.match(machineRegex);

    if (machineMatch) {

        // 前一個 recipe 結束
        if (currentRecipe) {

            currentRecipe.end =
                i - 1;

            recipeBlocks.push(
                currentRecipe
            );
        }


        let machineName =
            (
                machineMatch[1] ||
                machineMatch[2] ||
                "未知設備"
            ).trim();


        currentRecipe = {

            machine:
                machineName,

            start:
                i,

            end:
                lines.length - 1,

            lastIngredient:
                -1,

            hasOutput:
                false
        };


        continue;
    }


    if (!currentRecipe) {
        continue;
    }


    // ----------------------------------
    // 遇到下一個 H3
    // → 目前 recipe 結束
    // ----------------------------------

    if (
        /^###\s+/.test(line)
    ) {

        currentRecipe.end =
            i - 1;

        recipeBlocks.push(
            currentRecipe
        );

        currentRecipe =
            null;

        continue;
    }


    // ----------------------------------
    // 已有 output
    // ----------------------------------

    if (
        outputRegex.test(line)
    ) {

        currentRecipe.hasOutput =
            true;
    }


    // ----------------------------------
    // 記住最後一個材料的位置
    // ----------------------------------

    if (
        ingredientRegex.test(line)
    ) {

        currentRecipe.lastIngredient =
            i;
    }
}


// 最後一個 recipe
if (currentRecipe) {

    currentRecipe.end =
        lines.length - 1;

    recipeBlocks.push(
        currentRecipe
    );
}


// ======================================
// 7. 篩掉已經有 output 的配方
// ======================================

let missingRecipes =
    recipeBlocks.filter(
        recipe =>
            !recipe.hasOutput &&
            recipe.lastIngredient >= 0
    );


if (
    missingRecipes.length === 0
) {

    new Notice(
        "✅ 所有配方都已經有批產量 output"
    );

    return;
}


// ======================================
// 8. 逐條詢問 output
//
// 倒序處理，避免插入新行之後
// 前面的 line index 被改變
// ======================================

for (
    let i = missingRecipes.length - 1;
    i >= 0;
    i--
) {

    let recipe =
        missingRecipes[i];


    let outputStr =
        await tp.system.prompt(
            `「${recipe.machine}」這條配方每批產出多少？`,
            String(defaultOutput)
        );


    // ESC → 不修改這條
    if (outputStr === null) {
        continue;
    }


    let outputQty =
        Number(outputStr);


    if (
        !Number.isFinite(outputQty) ||
        outputQty <= 0
    ) {

        new Notice(
            `⚠️ ${recipe.machine} 的 output 無效，已跳過`
        );

        continue;
    }


    // ==================================
    // 判斷材料行的縮排
    // ==================================

    let ingredientLine =
        lines[
            recipe.lastIngredient
        ];

    let indentMatch =
        ingredientLine.match(
            /^(\s*)/
        );

    let indent =
        indentMatch
            ? indentMatch[1]
            : "";


    // output 與材料保持相同層級
    let outputLine =
        `${indent}**批產量**：[output${DV} ${outputQty}]`;


    // 插在最後一個材料後面
    lines.splice(
        recipe.lastIngredient + 1,
        0,
        outputLine
    );
}


// ======================================
// 9. 寫回檔案
// ======================================

let newContent =
    lines.join("\n");

await app.vault.modify(
    file,
    newContent
);


new Notice(
    `✅ 批產量補全完成，共偵測 ${missingRecipes.length} 條缺少 output 的配方`
);

%>