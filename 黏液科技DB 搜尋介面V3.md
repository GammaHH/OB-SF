---
created: 2026-08-08 17:24
updated: 2026-08-12 18:48
---
- 碎礦
- 無限


```dataviewjs
// ============================================================
// Slimefun BIO 遞歸搜索引擎 - V3
//
// 功能：
// 1. 搜尋 BIO：檔名 / id / aliases
// 2. 使用 Checkbox 選擇要納入的科技資料夾
// 3. 選擇 BIO 後，沿 Machine + 配方一路向下遞歸
// 4. 沒有配方時視為最終基礎材料
// 5. 每條配方可擁有獨立 output；未指定時使用 Frontmatter output
// 6. 多配方可直接在遞歸樹中切換，切換後自動重新計算
// 7. 自動合併最終材料數量
// 8. 防止循環配方
// 9. 支援將整份分析結果複製為純文字
// ============================================================


// ============================================================
// 0. 基本設定
// ============================================================

const STORAGE_KEY =
    "slimefun-recursive-scope:" + app.vault.getName();

const MAX_SEARCH_RESULTS = 50;
const RECIPE_STORAGE_KEY =
    "slimefun-recursive-recipes:" + app.vault.getName();
// ============================================================
// 1. 小工具函式
// ============================================================

function normalize(value) {

    return String(value ?? "")
        .trim()
        .toLowerCase();
}


function toArray(value) {

    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (
        value &&
        typeof value.array === "function"
    ) {
        return value.array();
    }

    return [value];
}


function getTopFolder(folder) {

    if (!folder) {
        return "";
    }

    return folder.split("/")[0];
}


function getBioType(type) {

    if (!type) {
        return "";
    }

    let suffix =
        String(type)
            .split("-")
            .pop()
            .toLowerCase();

    if (suffix === "item") {
        return "item";
    }

    if (suffix === "drop") {
        return "drop";
    }

    if (suffix === "geo") {
        return "GEO";
    }

    return "";
}


function isBio(page) {

    return getBioType(page.type) !== "";
}


function formatNumber(value) {

    if (
        Number.isInteger(value)
    ) {
        return String(value);
    }

    return Number(value.toFixed(4)).toString();
}


function makeButton(text) {

    let button =
        document.createElement("button");

    button.textContent = text;

    button.style.cssText = `
        padding: 5px 10px;
        border-radius: 6px;
        cursor: pointer;
    `;

    return button;
}


function makeFileLink(page, text) {

    let link =
        document.createElement("a");

    link.href = "#";

    link.textContent =
        text || page.file.name;

    link.style.cssText = `
        color: var(--text-accent);
        text-decoration: none;
        font-weight: 600;
        cursor: pointer;
    `;


    link.addEventListener(
        "click",
        async event => {

            event.preventDefault();
            event.stopPropagation();

            let file =
                app.vault.getAbstractFileByPath(
                    page.file.path
                );

            if (!file) {
                new Notice(
                    `❌ 找不到檔案：${page.file.path}`
                );
                return;
            }


            // 建立新的 Obsidian 分頁
            let leaf =
                app.workspace.getLeaf("tab");

            await leaf.openFile(file);
        }
    );


    return link;
}


// ============================================================
// 2. 讀取所有 BIO
// ============================================================

const allPages =
    dv.pages().array();

const bioPages =
    allPages.filter(
        page => isBio(page)
    );
// ============================================================
// 動態取得所有「### 取得方式」
// ============================================================

const recipeSectionSet =
    new Set();

for (let page of bioPages) {

    let file =
        app.vault.getAbstractFileByPath(
            page.file.path
        );

    if (!file) continue;

    let cache =
        app.metadataCache.getFileCache(file);

    let headings =
        cache?.headings || [];


    for (let heading of headings) {

        // 目前 BIO 的取得方式都是 H3
        if (heading.level === 3) {

            let name =
                String(heading.heading)
                    .trim();

            if (name) {
                recipeSectionSet.add(name);
            }
        }
    }
}


const recipeSections =
    [...recipeSectionSet]
        .sort(
            (a, b) => {

                // 常規永遠放第一個
                if (a === "常規") return -1;
                if (b === "常規") return 1;

                return a.localeCompare(
                    b,
                    "zh-Hant"
                );
            }
        );

// ============================================================
// 3. 取得可選資料夾
// ============================================================

const uniqueFolders =
    [
        ...new Set(
            bioPages
                .map(
                    page =>
                        getTopFolder(
                            page.file.folder
                        )
                )
                .filter(Boolean)
        )
    ]
    .sort(
        (a, b) =>
            a.localeCompare(
                b,
                "zh-Hant"
            )
    );


// ============================================================
// 4. 載入上次勾選範圍
// ============================================================

let selectedFolders =
    new Set();

try {

    let saved =
        JSON.parse(
            localStorage.getItem(
                STORAGE_KEY
            ) || "null"
        );

    if (Array.isArray(saved)) {

        for (let folder of saved) {

            if (
                uniqueFolders.includes(folder)
            ) {
                selectedFolders.add(folder);
            }
        }

    } else {

        // 第一次使用 → 預設全部勾選
        for (let folder of uniqueFolders) {
            selectedFolders.add(folder);
        }
    }

} catch {

    for (let folder of uniqueFolders) {
        selectedFolders.add(folder);
    }
}


function saveFolderSelection() {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
            [...selectedFolders]
        )
    );
}
// ============================================================
// 載入遞歸取得方式
// ============================================================

let selectedRecipeSections =
    new Set();

try {

    let saved =
        JSON.parse(
            localStorage.getItem(
                RECIPE_STORAGE_KEY
            ) || "null"
        );


    if (Array.isArray(saved)) {

        for (let section of saved) {

            if (
                recipeSections.includes(
                    section
                )
            ) {
                selectedRecipeSections.add(
                    section
                );
            }
        }

    } else {

        // 第一次使用：
        // 預設只允許「常規」
        if (
            recipeSections.includes(
                "常規"
            )
        ) {
            selectedRecipeSections.add(
                "常規"
            );
        }
    }

} catch {

    if (
        recipeSections.includes(
            "常規"
        )
    ) {
        selectedRecipeSections.add(
            "常規"
        );
    }
}


function saveRecipeSelection() {

    localStorage.setItem(
        RECIPE_STORAGE_KEY,
        JSON.stringify(
            [...selectedRecipeSections]
        )
    );
}

// ============================================================
// 5. 建立 UI 主容器
// ============================================================

let root =
    dv.el("div", "");

root.style.cssText = `
    width: 100%;
    max-width: 1100px;
`;


// ============================================================
// 6. 搜尋列
// ============================================================

let searchRow =
    document.createElement("div");

searchRow.style.cssText = `
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 12px;
`;

root.appendChild(searchRow);


let input =
    document.createElement("input");

input.type = "text";

input.placeholder =
    "🔍 搜尋 BIO 名稱、ID、Alias...";

input.style.cssText = `
    flex: 1;
    padding: 9px 12px;
    font-size: 16px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 7px;
    background: var(--background-primary);
    color: var(--text-normal);
`;

searchRow.appendChild(input);


// ============================================================
// 7. 製作數量
// ============================================================

let qtyLabel =
    document.createElement("span");

qtyLabel.textContent =
    "製作數量";

qtyLabel.style.whiteSpace =
    "nowrap";

searchRow.appendChild(qtyLabel);


let targetQtyInput =
    document.createElement("input");

targetQtyInput.type = "number";
targetQtyInput.min = "1";
targetQtyInput.step = "1";
targetQtyInput.value = "1";

targetQtyInput.style.cssText = `
    width: 80px;
    padding: 8px;
`;

searchRow.appendChild(
    targetQtyInput
);


// ============================================================
// 8. 搜尋範圍標題
// ============================================================

let scopeHeader =
    document.createElement("div");

scopeHeader.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
`;

root.appendChild(scopeHeader);


let scopeTitle =
    document.createElement("strong");

scopeTitle.textContent =
    "📂 伺服器科技範圍";

scopeHeader.appendChild(
    scopeTitle
);


let selectedCount =
    document.createElement("span");

selectedCount.style.cssText = `
    color: var(--text-muted);
    font-size: 13px;
`;

scopeHeader.appendChild(
    selectedCount
);


let selectAllButton =
    makeButton("全選");

scopeHeader.appendChild(
    selectAllButton
);


let clearAllButton =
    makeButton("清除");

scopeHeader.appendChild(
    clearAllButton
);


// ============================================================
// 9. Checkbox 科技範圍
// ============================================================

let folderContainer =
    document.createElement("div");

folderContainer.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 10px;
    margin-bottom: 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 7px;
    background: var(--background-secondary);
`;

root.appendChild(
    folderContainer
);


const checkboxMap =
    new Map();


for (let folder of uniqueFolders) {

    let label =
        document.createElement("label");

    label.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        user-select: none;
    `;


    let checkbox =
        document.createElement("input");

    checkbox.type =
        "checkbox";

    checkbox.checked =
        selectedFolders.has(folder);


    checkbox.addEventListener(
        "change",
        () => {

            if (checkbox.checked) {

                selectedFolders.add(
                    folder
                );

            } else {

                selectedFolders.delete(
                    folder
                );
            }

            saveFolderSelection();

            updateSelectedCount();

            performSearch();

            analysisContainer.innerHTML = "";
        }
    );


    checkboxMap.set(
        folder,
        checkbox
    );


    let text =
        document.createElement("span");

    text.textContent =
        folder;


    label.appendChild(
        checkbox
    );

    label.appendChild(
        text
    );

    folderContainer.appendChild(
        label
    );
}


function updateSelectedCount() {

    selectedCount.textContent =
        `已選 ${selectedFolders.size}/${uniqueFolders.length}`;
}


updateSelectedCount();
// ============================================================
// 遞歸取得方式 UI
// ============================================================

let recipeDetails =
    document.createElement("details");

recipeDetails.style.cssText = `
    margin-bottom: 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 7px;
    background: var(--background-secondary);
`;


let recipeSummary =
    document.createElement("summary");

recipeSummary.style.cssText = `
    cursor: pointer;
    padding: 9px 12px;
    font-weight: 600;
`;

recipeDetails.appendChild(
    recipeSummary
);


let recipeControls =
    document.createElement("div");

recipeControls.style.cssText = `
    display: flex;
    gap: 8px;
    padding: 0 10px 8px 10px;
`;

recipeDetails.appendChild(
    recipeControls
);


let regularOnlyButton =
    makeButton("只選常規");

let recipeAllButton =
    makeButton("全選");

let recipeClearButton =
    makeButton("清除");

recipeControls.appendChild(
    regularOnlyButton
);

recipeControls.appendChild(
    recipeAllButton
);

recipeControls.appendChild(
    recipeClearButton
);


let recipeContainer =
    document.createElement("div");

recipeContainer.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 0 10px 10px 10px;
`;

recipeDetails.appendChild(
    recipeContainer
);


// 插在科技範圍後面
root.appendChild(
    recipeDetails
);


const recipeCheckboxMap =
    new Map();


function updateRecipeSummary() {

    let selected =
        [...selectedRecipeSections];

    if (
        selected.length === 1 &&
        selected[0] === "常規"
    ) {

        recipeSummary.textContent =
            "⚙️ 遞歸取得方式：常規";

    } else {

        recipeSummary.textContent =
            `⚙️ 遞歸取得方式：已選 ${selected.length}/${recipeSections.length}`;
    }
}


for (let section of recipeSections) {

    let label =
        document.createElement("label");

    label.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        user-select: none;
    `;


    let checkbox =
        document.createElement("input");

    checkbox.type =
        "checkbox";

    checkbox.checked =
        selectedRecipeSections.has(
            section
        );


    checkbox.addEventListener(
        "change",
        () => {

            if (checkbox.checked) {

                selectedRecipeSections.add(
                    section
                );

            } else {

                selectedRecipeSections.delete(
                    section
                );
            }


            saveRecipeSelection();

            updateRecipeSummary();

            parseCache.clear();

            if (currentAnalysisPage) {
                recalculateCurrentAnalysis();
            }
        }
    );


    recipeCheckboxMap.set(
        section,
        checkbox
    );


    let text =
        document.createElement("span");

    text.textContent =
        section;


    label.appendChild(
        checkbox
    );

    label.appendChild(
        text
    );

    recipeContainer.appendChild(
        label
    );
}


updateRecipeSummary();

// ============================================================
// 取得方式快捷選擇
// ============================================================

regularOnlyButton.addEventListener(
    "click",
    () => {

        selectedRecipeSections.clear();

        if (
            recipeSections.includes(
                "常規"
            )
        ) {
            selectedRecipeSections.add(
                "常規"
            );
        }


        for (
            let [section, checkbox]
            of recipeCheckboxMap
        ) {

            checkbox.checked =
                section === "常規";
        }


        saveRecipeSelection();
        updateRecipeSummary();

        parseCache.clear();

        if (currentAnalysisPage) {
            recalculateCurrentAnalysis();
        }
    }
);


recipeAllButton.addEventListener(
    "click",
    () => {

        selectedRecipeSections.clear();

        for (let section of recipeSections) {

            selectedRecipeSections.add(
                section
            );

            recipeCheckboxMap
                .get(section)
                .checked = true;
        }


        saveRecipeSelection();
        updateRecipeSummary();

        parseCache.clear();

        if (currentAnalysisPage) {
            recalculateCurrentAnalysis();
        }
    }
);


recipeClearButton.addEventListener(
    "click",
    () => {

        selectedRecipeSections.clear();

        for (
            let checkbox
            of recipeCheckboxMap.values()
        ) {
            checkbox.checked = false;
        }


        saveRecipeSelection();
        updateRecipeSummary();

        parseCache.clear();

        if (currentAnalysisPage) {
            recalculateCurrentAnalysis();
        }
    }
);

// ============================================================
// 10. 全選 / 清除
// ============================================================

selectAllButton.addEventListener(
    "click",
    () => {

        selectedFolders.clear();

        for (let folder of uniqueFolders) {

            selectedFolders.add(
                folder
            );

            checkboxMap.get(
                folder
            ).checked = true;
        }

        saveFolderSelection();

        updateSelectedCount();

        performSearch();

        analysisContainer.innerHTML = "";
    }
);


clearAllButton.addEventListener(
    "click",
    () => {

        selectedFolders.clear();

        for (
            let checkbox
            of checkboxMap.values()
        ) {
            checkbox.checked = false;
        }

        saveFolderSelection();

        updateSelectedCount();

        performSearch();

        analysisContainer.innerHTML = "";
    }
);


// ============================================================
// 11. 搜尋結果區
// ============================================================

let resultsContainer =
    document.createElement("div");

root.appendChild(
    resultsContainer
);


// ============================================================
// 12. 分析結果區
// ============================================================

let analysisContainer =
    document.createElement("div");

analysisContainer.style.cssText = `
    margin-top: 18px;
`;

root.appendChild(
    analysisContainer
);


// ============================================================
// 13. 取得目前勾選範圍內 BIO
// ============================================================

function getScopedPages() {

    return bioPages.filter(
        page =>
            selectedFolders.has(
                getTopFolder(
                    page.file.folder
                )
            )
    );
}


// ============================================================
// 14. 搜尋 BIO
// ============================================================

function pageMatches(
    page,
    query
) {

    let fields = [
        page.file.name,
        page.id,
        ...toArray(page.aliases)
    ];

    return fields.some(
        field =>
            normalize(field)
                .includes(query)
    );
}


function performSearch() {

    let query =
        normalize(input.value);

    resultsContainer.innerHTML =
        "";

    if (!query) {
        return;
    }


    let scopedPages =
        getScopedPages();


    let matches =
        scopedPages
            .filter(
                page =>
                    pageMatches(
                        page,
                        query
                    )
            )
            .slice(
                0,
                MAX_SEARCH_RESULTS
            );


    let countText =
        document.createElement("div");

    countText.style.cssText = `
        color: var(--text-muted);
        margin-bottom: 6px;
    `;

    countText.textContent =
        `找到 ${matches.length} 筆結果`;

    resultsContainer.appendChild(
        countText
    );


    for (let page of matches) {

        let item =
            document.createElement("div");

        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            margin-bottom: 5px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            background: var(--background-secondary);
        `;


        let info =
            document.createElement("div");


        let title =
            document.createElement("div");

        title.style.fontWeight =
            "600";

        title.textContent =
            page.file.name;

        info.appendChild(
            title
        );


        let meta =
            document.createElement("div");

        meta.style.cssText = `
            font-size: 12px;
            color: var(--text-muted);
        `;

        meta.textContent =
            [
                getBioType(page.type),
                page.id || "",
                getTopFolder(
                    page.file.folder
                )
            ]
            .filter(Boolean)
            .join(" · ");

        info.appendChild(
            meta
        );


        let buttons =
            document.createElement("div");

        buttons.style.cssText = `
            display: flex;
            gap: 5px;
        `;


        let analyzeButton =
            makeButton("遞歸分析");

        analyzeButton.addEventListener(
            "click",
            () => {

                analyzePage(page);
            }
        );


        let openButton =
            makeButton("開啟");

        openButton.addEventListener(
            "click",
            async () => {

                await app.workspace.openLinkText(
                    page.file.path,
                    "",
                    false
                );
            }
        );


        buttons.appendChild(
            analyzeButton
        );

        buttons.appendChild(
            openButton
        );


        item.appendChild(
            info
        );

        item.appendChild(
            buttons
        );

        resultsContainer.appendChild(
            item
        );
    }
}


input.addEventListener(
    "input",
    performSearch
);


// ============================================================
// 15. 建立 BIO 索引
//
// 支援：
// 檔名
// id
// aliases
// ============================================================

function buildBioIndex(
    scopedPages
) {

    const byName =
        new Map();

    const byId =
        new Map();

    const byAlias =
        new Map();

    const byPath =
        new Map();


    for (let page of scopedPages) {

        let fileName =
            normalize(
                page.file.name
            );

        if (fileName) {

            byName.set(
                fileName,
                page
            );
        }


        let path =
            normalize(
                page.file.path
                    .replace(
                        /\.md$/i,
                        ""
                    )
            );

        if (path) {

            byPath.set(
                path,
                page
            );
        }


        let id =
            normalize(
                page.id
            );

        if (id) {

            byId.set(
                id,
                page
            );
        }


        for (
            let alias
            of toArray(page.aliases)
        ) {

            let key =
                normalize(alias);

            if (key) {

                byAlias.set(
                    key,
                    page
                );
            }
        }
    }


    return {
        byName,
        byId,
        byAlias,
        byPath
    };
}


// ============================================================
// 16. 將配方中的名稱解析到 BIO
// ============================================================

function resolveBio(
    rawName,
    index
) {

    let name =
        String(rawName ?? "")
            .trim()
            .replace(
                /\.md$/i,
                ""
            );


    let normalized =
        normalize(name);


    // 1. 完整 path
    if (
        index.byPath.has(
            normalized
        )
    ) {

        return index.byPath.get(
            normalized
        );
    }


    // 2. 檔名
    let baseName =
        normalize(
            name
                .split("/")
                .pop()
        );

    if (
        index.byName.has(
            baseName
        )
    ) {

        return index.byName.get(
            baseName
        );
    }


    // 3. ID
    if (
        index.byId.has(
            normalized
        )
    ) {

        return index.byId.get(
            normalized
        );
    }


    if (
        index.byId.has(
            baseName
        )
    ) {

        return index.byId.get(
            baseName
        );
    }


    // 4. Alias
    if (
        index.byAlias.has(
            normalized
        )
    ) {

        return index.byAlias.get(
            normalized
        );
    }


    if (
        index.byAlias.has(
            baseName
        )
    ) {

        return index.byAlias.get(
            baseName
        );
    }


    return null;
}


// ============================================================
// 17. BIO 配方解析器 + 配方路線選擇
// ============================================================

const parseCache =
    new Map();

// 本次分析的配方選擇：
// key   = BIO file.path
// value = recipe.key
//
// 不寫入 localStorage，重新選擇另一個目標物品時會清空。
const recipeChoices =
    new Map();


function getAllowedRecipes(parsed) {

    return (parsed.recipes || [])
        .filter(
            recipe =>
                selectedRecipeSections.has(
                    recipe.section
                )
        );
}


function chooseRecipe(page, parsed) {

    let allowedRecipes =
        getAllowedRecipes(parsed);

    if (allowedRecipes.length === 0) {
        return null;
    }


    let savedKey =
        recipeChoices.get(
            page.file.path
        );


    if (savedKey) {

        let savedRecipe =
            allowedRecipes.find(
                recipe =>
                    recipe.key === savedKey
            );

        if (savedRecipe) {
            return savedRecipe;
        }
    }


    // 第一次遇到多配方時先提供一條可計算的預設路線：
    // 常規優先，否則使用目前允許範圍內第一條。
    // 使用者可直接在遞歸樹中切換，切換後整份結果會重新計算。
    let selectedRecipe =
        allowedRecipes.find(
            recipe =>
                recipe.section === "常規"
        ) || allowedRecipes[0];


    recipeChoices.set(
        page.file.path,
        selectedRecipe.key
    );


    return selectedRecipe;
}


async function parseBio(page) {

    if (
        parseCache.has(
            page.file.path
        )
    ) {

        return parseCache.get(
            page.file.path
        );
    }


    let file =
        app.vault.getAbstractFileByPath(
            page.file.path
        );


    if (!file) {

        let empty = {
            defaultOutput: 1,
            recipes: []
        };

        parseCache.set(
            page.file.path,
            empty
        );

        return empty;
    }


    let text =
        await app.vault.read(file);


    // Frontmatter output 是「配方沒有個別指定 output」時的 fallback。
    let defaultOutput =
        Number(
            page.output
        );


    if (
        !Number.isFinite(defaultOutput) ||
        defaultOutput <= 0
    ) {
        defaultOutput = 1;
    }


    let recipes = [];

    let currentSection =
        "";

    let currentRecipe =
        null;


    const machineRegex =
        /\(Machine\s*::\s*(?:\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|([^)]+))\)/i;


    const ingredientRegex =
        /^\s+-\s*\[(item|drop|GEO)\s*::\s*(?:\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|([^\]]+))\]\s*\(qty\s*::\s*([0-9.]+)\s*\)/i;


    // 支援：
    // [output:: 2]
    // **產出數量**：[output:: 2]
    const recipeOutputRegex =
        /\[output\s*::\s*([0-9.]+)\]/i;


    let lines =
        text.split(/\r?\n/);


    for (let line of lines) {

        // ----------------------------------
        // 記住目前 ### 區段
        // ----------------------------------

        let headingMatch =
            line.match(
                /^###\s+(.+)/
            );

        if (headingMatch) {

            currentSection =
                headingMatch[1]
                    .trim();

            currentRecipe =
                null;

            continue;
        }


        // ----------------------------------
        // Machine = 一條新配方的起點
        // ----------------------------------

        let machineMatch =
            line.match(
                machineRegex
            );

        if (machineMatch) {

            let machine =
                (
                    machineMatch[1] ||
                    machineMatch[2] ||
                    ""
                )
                .trim();


            let recipeIndex =
                recipes.length;


            currentRecipe = {
                key:
                    `${currentSection}::${machine}::${recipeIndex}`,

                index:
                    recipeIndex,

                section:
                    currentSection,

                machine:
                    machine,

                // null 代表尚未在這條配方中指定，之後 fallback 到 defaultOutput
                output:
                    null,

                ingredients:
                    []
            };


            recipes.push(
                currentRecipe
            );

            continue;
        }


        // ----------------------------------
        // Machine 底下的 output / 材料
        // ----------------------------------

        if (currentRecipe) {

            let outputMatch =
                line.match(
                    recipeOutputRegex
                );


            if (outputMatch) {

                let recipeOutput =
                    Number(
                        outputMatch[1]
                    );

                if (
                    Number.isFinite(recipeOutput) &&
                    recipeOutput > 0
                ) {
                    currentRecipe.output =
                        recipeOutput;
                }
            }


            let ingredientMatch =
                line.match(
                    ingredientRegex
                );


            if (ingredientMatch) {

                let ingredientType =
                    ingredientMatch[1];


                if (
                    ingredientType
                        .toLowerCase() ===
                    "geo"
                ) {
                    ingredientType =
                        "GEO";
                }


                let ingredientName =
                    (
                        ingredientMatch[2] ||
                        ingredientMatch[3] ||
                        ""
                    )
                    .trim();


                let qty =
                    Number(
                        ingredientMatch[4]
                    );


                if (
                    ingredientName &&
                    Number.isFinite(qty) &&
                    qty > 0
                ) {

                    currentRecipe
                        .ingredients
                        .push({
                            type:
                                ingredientType,

                            name:
                                ingredientName,

                            qty:
                                qty
                        });
                }
            }
        }
    }


    // 只保留真正有材料的 Machine 配方
    let validRecipes =
        recipes
            .filter(
                recipe =>
                    recipe.machine &&
                    recipe.ingredients.length > 0
            )
            .map(
                recipe => ({
                    ...recipe,
                    output:
                        (
                            Number.isFinite(recipe.output) &&
                            recipe.output > 0
                        )
                            ? recipe.output
                            : defaultOutput
                })
            );


    let parsed = {
        defaultOutput:
            defaultOutput,

        recipes:
            validRecipes
    };


    parseCache.set(
        page.file.path,
        parsed
    );


    return parsed;
}


// ============================================================
// 18. 最終材料統計
// ============================================================

const leafTotals =
    new Map();

// ============================================================
// 機器建造系統
// ============================================================

// 所有實際需要建造的機器
const machineList =
    new Map();

// 建造這些機器最終所需的基礎材料
const machineLeafTotals =
    new Map();

// 防止同一台機器重複計算
const processedMachines =
    new Set();

// 防止機器互相循環
const processingMachines =
    new Set();


// ============================================================
// V3：目前分析狀態
// ============================================================

let currentAnalysisPage =
    null;

let currentAnalysisQty =
    1;

let currentTree =
    null;

let currentAnalysisBusy =
    false;

function addLeafTo(
    targetMap,
    key,
    name,
    type,
    qty,
    page,
    status
) {

    let normalizedKey =
        key || (
            normalize(type) +
            ":" +
            normalize(name)
        );


    if (!targetMap.has(normalizedKey)) {

        targetMap.set(
            normalizedKey,
            {
                name: name,
                type: type,
                qty: 0,
                page: page || null,
                status: status || "基礎材料"
            }
        );
    }


    targetMap.get(
        normalizedKey
    ).qty += qty;
}

// ============================================================
// 舊版 addLeaf 相容函式
//
// 原本產品遞歸使用 addLeaf(...)
// 自動轉送到 leafTotals
// ============================================================

function addLeaf(
    key,
    name,
    type,
    qty,
    page,
    status
) {

    addLeafTo(
        leafTotals,
        key,
        name,
        type,
        qty,
        page,
        status
    );
}
// ============================================================
// 19. 遞歸核心
// ============================================================

async function expandBio(
    page,
    requiredQty,
    index,
    stack = []
) {

    let parsed =
        await parseBio(page);

    let allowedRecipes =
        getAllowedRecipes(parsed);

    let selectedRecipe =
        chooseRecipe(
            page,
            parsed
        );


    let node = {

        name:
            page.file.name,

        page:
            page,

        type:
            getBioType(
                page.type
            ),

        required:
            requiredQty,

        output:
            selectedRecipe
                ? selectedRecipe.output
                : parsed.defaultOutput,

        batches:
            0,

        machine:
            "",

        section:
            "",

        recipeCount:
            allowedRecipes.length,

        recipeOptions:
            allowedRecipes,

        selectedRecipeKey:
            selectedRecipe
                ? selectedRecipe.key
                : "",

        children:
            [],

        leaf:
            false,

        cycle:
            false
    };


    // ----------------------------------
    // 沒有目前允許的配方
    // → 遞歸終點
    // ----------------------------------

    if (!selectedRecipe) {

        node.leaf =
            true;


        addLeaf(
            page.file.path,
            page.file.name,
            getBioType(page.type),
            requiredQty,
            page,
            "無配方 / 未允許取得方式"
        );


        return node;
    }


    // ----------------------------------
    // 有配方
    // ----------------------------------

    node.machine =
        selectedRecipe.machine;

    node.section =
        selectedRecipe.section;

    node.output =
        selectedRecipe.output;


    // ======================================
    // 登記並解析這個配方所需的生產設備
    // ======================================

    if (selectedRecipe.machine) {

        await registerMachine(
            selectedRecipe.machine,
            index
        );
    }


    node.batches =
        Math.ceil(
            requiredQty /
            selectedRecipe.output
        );


    let nextStack =
        [
            ...stack,
            page.file.path
        ];


    for (
        let ingredient
        of selectedRecipe.ingredients
    ) {

        let childRequired =
            ingredient.qty *
            node.batches;


        let targetPage =
            resolveBio(
                ingredient.name,
                index
            );


        // ----------------------------------
        // 找不到 BIO
        // ----------------------------------

        if (!targetPage) {

            addLeaf(
                "unresolved:" +
                normalize(
                    ingredient.name
                ),

                ingredient.name,

                ingredient.type,

                childRequired,

                null,

                "未建立 / 範圍外"
            );


            node.children.push({

                name:
                    ingredient.name,

                page:
                    null,

                type:
                    ingredient.type,

                required:
                    childRequired,

                output:
                    1,

                batches:
                    0,

                machine:
                    "",

                section:
                    "",

                recipeCount:
                    0,

                recipeOptions:
                    [],

                selectedRecipeKey:
                    "",

                children:
                    [],

                leaf:
                    true,

                unresolved:
                    true,

                cycle:
                    false
            });


            continue;
        }


        // ----------------------------------
        // 循環偵測
        // ----------------------------------

        if (
            nextStack.includes(
                targetPage.file.path
            )
        ) {

            node.children.push({

                name:
                    targetPage.file.name,

                page:
                    targetPage,

                type:
                    getBioType(
                        targetPage.type
                    ),

                required:
                    childRequired,

                output:
                    1,

                batches:
                    0,

                machine:
                    "",

                section:
                    "",

                recipeCount:
                    0,

                recipeOptions:
                    [],

                selectedRecipeKey:
                    "",

                children:
                    [],

                leaf:
                    true,

                unresolved:
                    false,

                cycle:
                    true
            });


            continue;
        }


        // ----------------------------------
        // 繼續向下遞歸
        // ----------------------------------

        let child =
            await expandBio(
                targetPage,
                childRequired,
                index,
                nextStack
            );


        node.children.push(
            child
        );
    }


    return node;
}


// ============================================================
// 20. 配方樹 UI
// ============================================================

function getRecipeLabel(recipe) {

    return (
        `${recipe.section || "未分類"}` +
        ` ｜ ${recipe.machine || "無/手動"}` +
        ` ｜ output ${formatNumber(recipe.output)}/批`
    );
}


function renderTreeNode(
    node,
    parent,
    depth = 0
) {

    // ----------------------------------
    // Leaf
    // ----------------------------------

    if (
        node.leaf ||
        node.children.length === 0
    ) {

        let row =
            document.createElement("div");

        row.style.cssText = `
            margin-left: ${depth * 18}px;
            padding: 4px 0;
        `;


        let prefix =
            "└─ ";


        let typeText =
            node.type
                ? `[${node.type}] `
                : "";


        row.appendChild(
            document.createTextNode(
                prefix +
                typeText
            )
        );


        if (node.page) {

            row.appendChild(
                makeFileLink(
                    node.page,
                    node.name
                )
            );

        } else {

            let name =
                document.createElement("span");

            name.textContent =
                node.name;

            row.appendChild(
                name
            );
        }


        row.appendChild(
            document.createTextNode(
                ` × ${formatNumber(node.required)}`
            )
        );


        if (node.unresolved) {

            let warning =
                document.createElement("span");

            warning.textContent =
                "  ⚠ 未建立 / 未納入範圍";

            warning.style.color =
                "var(--text-warning)";

            row.appendChild(
                warning
            );
        }


        if (node.cycle) {

            let warning =
                document.createElement("span");

            warning.textContent =
                "  ⚠ 偵測到循環配方";

            warning.style.color =
                "var(--text-error)";

            row.appendChild(
                warning
            );
        }


        parent.appendChild(
            row
        );

        return;
    }


    // ----------------------------------
    // Recipe Node
    // ----------------------------------

    let details =
        document.createElement("details");

    details.open =
        depth < 2;

    details.style.marginLeft =
        `${depth * 18}px`;


    let summary =
        document.createElement("summary");

    summary.style.cssText = `
        cursor: pointer;
        padding: 4px 0;
    `;


    if (node.page) {

        summary.appendChild(
            makeFileLink(
                node.page,
                node.name
            )
        );

    } else {

        summary.appendChild(
            document.createTextNode(
                node.name
            )
        );
    }


    summary.appendChild(
        document.createTextNode(
            ` × ${formatNumber(node.required)}`
        )
    );


    let info =
        document.createElement("span");

    info.style.cssText = `
        color: var(--text-muted);
        margin-left: 8px;
        font-size: 0.9em;
    `;


    let produced =
        node.batches *
        node.output;


    info.textContent =
        `← ${node.machine}` +
        ` ｜ output ${formatNumber(node.output)}/批` +
        ` ｜ ${node.batches} 批` +
        ` ｜ 實得 ${formatNumber(produced)}`;


    summary.appendChild(
        info
    );


    details.appendChild(
        summary
    );


    // ----------------------------------
    // V3：同一 BIO 有多條允許配方時
    // 直接在遞歸樹內切換路線
    // ----------------------------------

    if (
        node.page &&
        node.recipeOptions &&
        node.recipeOptions.length > 1
    ) {

        let routeRow =
            document.createElement("div");

        routeRow.style.cssText = `
            margin-left: 22px;
            padding: 5px 0 7px 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 7px;
        `;


        let routeLabel =
            document.createElement("span");

        routeLabel.textContent =
            "配方路線：";

        routeLabel.style.cssText = `
            color: var(--text-muted);
            font-size: 0.9em;
        `;

        routeRow.appendChild(
            routeLabel
        );


        let select =
            document.createElement("select");

        select.style.cssText = `
            max-width: 520px;
            padding: 4px 7px;
            border-radius: 5px;
            background: var(--background-primary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
        `;


        for (
            let recipe
            of node.recipeOptions
        ) {

            let option =
                document.createElement("option");

            option.value =
                recipe.key;

            option.textContent =
                getRecipeLabel(recipe);

            select.appendChild(
                option
            );
        }


        select.value =
            node.selectedRecipeKey;


        // 避免操作下拉時觸發 details 展開/收合
        select.addEventListener(
            "click",
            event =>
                event.stopPropagation()
        );


        select.addEventListener(
            "change",
            async event => {

                event.stopPropagation();

                recipeChoices.set(
                    node.page.file.path,
                    select.value
                );

                await recalculateCurrentAnalysis();
            }
        );


        routeRow.appendChild(
            select
        );


        let hint =
            document.createElement("span");

        hint.textContent =
            `共 ${node.recipeOptions.length} 條；切換後會重新計算全部材料`;

        hint.style.cssText = `
            color: var(--text-muted);
            font-size: 0.8em;
        `;

        routeRow.appendChild(
            hint
        );


        details.appendChild(
            routeRow
        );
    }


    for (let child of node.children) {

        renderTreeNode(
            child,
            details,
            depth + 1
        );
    }


    parent.appendChild(
        details
    );
}


// ============================================================
// 21. 最終材料表
// ============================================================

function renderLeafTable(
    parent
) {

    let title =
        document.createElement("h3");

    title.textContent =
        "最終基礎材料";

    parent.appendChild(
        title
    );


    let items =
        [...leafTotals.values()]
            .sort(
                (a, b) => {

                    let typeCompare =
                        String(a.type)
                            .localeCompare(
                                String(b.type)
                            );

                    if (
                        typeCompare !== 0
                    ) {
                        return typeCompare;
                    }

                    return a.name.localeCompare(
                        b.name,
                        "zh-Hant"
                    );
                }
            );


    if (
        items.length === 0
    ) {

        let empty =
            document.createElement("div");

        empty.textContent =
            "沒有最終材料資料。";

        parent.appendChild(
            empty
        );

        return;
    }


    let table =
        document.createElement("table");

    table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
    `;


    let thead =
        document.createElement("thead");

    thead.innerHTML = `
        <tr>
            <th>類型</th>
            <th>材料</th>
            <th>總需求</th>
            <th>狀態</th>
        </tr>
    `;

    table.appendChild(
        thead
    );


    let tbody =
        document.createElement("tbody");


    for (let item of items) {

        let row =
            document.createElement("tr");


        let typeCell =
            document.createElement("td");

        typeCell.textContent =
            item.type || "";


        let nameCell =
            document.createElement("td");


        if (item.page) {

            nameCell.appendChild(
                makeFileLink(
                    item.page,
                    item.name
                )
            );

        } else {

            nameCell.textContent =
                item.name;
        }


        let qtyCell =
            document.createElement("td");

        qtyCell.textContent =
            formatNumber(
                item.qty
            );


        let statusCell =
            document.createElement("td");

        statusCell.textContent =
            item.status;


        row.appendChild(
            typeCell
        );

        row.appendChild(
            nameCell
        );

        row.appendChild(
            qtyCell
        );

        row.appendChild(
            statusCell
        );


        tbody.appendChild(
            row
        );
    }


    table.appendChild(
        tbody
    );

    parent.appendChild(
        table
    );
}


// ============================================================
// 22. 純文字報告
// ============================================================

function buildTreePlainText(
    node,
    depth = 0,
    lines = []
) {

    let indent =
        "  ".repeat(depth);

    let prefix =
        depth === 0
            ? ""
            : "└─ ";

    let line =
        `${indent}${prefix}${node.name} ×${formatNumber(node.required)}`;


    if (
        !node.leaf &&
        node.machine
    ) {

        let produced =
            node.batches *
            node.output;

        line +=
            ` ← ${node.machine}` +
            ` | ${node.section || "未分類"}` +
            ` | output ${formatNumber(node.output)}/批` +
            ` | ${node.batches}批` +
            ` | 實得${formatNumber(produced)}`;
    }


    if (node.unresolved) {
        line +=
            " ⚠ 未建立 / 未納入範圍";
    }

    if (node.cycle) {
        line +=
            " ⚠ 偵測到循環配方";
    }


    lines.push(line);


    for (let child of node.children || []) {

        buildTreePlainText(
            child,
            depth + 1,
            lines
        );
    }


    return lines;
}


function appendMaterialPlainText(
    lines,
    title,
    sourceMap
) {

    lines.push("");
    lines.push(`【${title}】`);
    lines.push("");


    let items =
        [...sourceMap.values()]
            .sort(
                (a, b) =>
                    String(a.name)
                        .localeCompare(
                            String(b.name),
                            "zh-Hant"
                        )
            );


    if (items.length === 0) {
        lines.push("（無）");
        return;
    }


    for (let item of items) {

        let type =
            item.type
                ? `[${item.type}] `
                : "";

        let status =
            item.status &&
            item.status !== "無配方"
                ? ` ｜ ${item.status}`
                : "";

        lines.push(
            `${type}${item.name} ×${formatNumber(item.qty)}${status}`
        );
    }
}


function buildPlainTextReport(
    page,
    requestedQty,
    tree
) {

    let lines = [];


    lines.push(
        `${page.file.name} ×${formatNumber(requestedQty)}`
    );

    lines.push("");
    lines.push("【配方遞歸樹】");
    lines.push("");


    buildTreePlainText(
        tree,
        0,
        lines
    );


    appendMaterialPlainText(
        lines,
        "最終基礎材料",
        leafTotals
    );


    lines.push("");
    lines.push("【生產設備需求】");
    lines.push("");


    let machines =
        [...machineList.values()]
            .sort(
                (a, b) =>
                    String(a.name)
                        .localeCompare(
                            String(b.name),
                            "zh-Hant"
                        )
            );


    if (machines.length === 0) {

        lines.push("（無）");

    } else {

        for (let machine of machines) {

            lines.push(
                `${machine.name} ×1 ｜ ${machine.status}`
            );
        }
    }


    appendMaterialPlainText(
        lines,
        "設備建造所需基礎材料",
        machineLeafTotals
    );


    return lines.join("\n");
}


// ============================================================
// 23. 結果畫面建立
// ============================================================

function buildAnalysisView(
    page,
    requestedQty,
    tree
) {

    let view =
        document.createElement("div");


    // ----------------------------------
    // 標題 + 複製按鈕
    // ----------------------------------

    let headingRow =
        document.createElement("div");

    headingRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    `;


    let heading =
        document.createElement("h2");

    heading.textContent =
        `${page.file.name} × ${requestedQty}`;

    heading.style.marginBottom =
        "6px";

    headingRow.appendChild(
        heading
    );


    let copyButton =
        makeButton("📋 複製純文字");

    copyButton.addEventListener(
        "click",
        async () => {

            let report =
                buildPlainTextReport(
                    page,
                    requestedQty,
                    tree
                );

            try {

                await navigator.clipboard.writeText(
                    report
                );

                new Notice(
                    "📋 已複製完整分析結果"
                );

            } catch (error) {

                new Notice(
                    `❌ 複製失敗：${error.message}`
                );
            }
        }
    );

    headingRow.appendChild(
        copyButton
    );

    view.appendChild(
        headingRow
    );


    // ----------------------------------
    // 配方樹
    // ----------------------------------

    let treeTitle =
        document.createElement("h3");

    treeTitle.textContent =
        "配方遞歸樹";

    view.appendChild(
        treeTitle
    );


    let treeContainer =
        document.createElement("div");

    treeContainer.style.cssText = `
        padding: 10px;
        border-left: 2px solid var(--background-modifier-border);
    `;

    view.appendChild(
        treeContainer
    );


    renderTreeNode(
        tree,
        treeContainer,
        0
    );


    // ----------------------------------
    // 統計表
    // ----------------------------------

    renderLeafTable(
        view
    );


    renderMachineTable(
        view
    );


    renderMaterialTable(
        view,
        "設備建造所需基礎材料",
        machineLeafTotals
    );


    return view;
}


// ============================================================
// 24. 執行 / 重新計算分析
// ============================================================

async function rebuildAnalysis(
    showLoading = false
) {

    if (
        !currentAnalysisPage ||
        currentAnalysisBusy
    ) {
        return;
    }


    currentAnalysisBusy =
        true;


    if (showLoading) {

        analysisContainer.innerHTML =
            "";

        let loading =
            document.createElement("div");

        loading.textContent =
            "⏳ 正在建立配方依賴樹...";

        analysisContainer.appendChild(
            loading
        );
    }


    try {

        // 每次都完整重算。
        // 配方切換時先在記憶體中算完，再一次替換畫面，避免結果暫時消失。
        parseCache.clear();

        leafTotals.clear();

        machineList.clear();
        machineLeafTotals.clear();

        processedMachines.clear();
        processingMachines.clear();


        let scopedPages =
            getScopedPages();


        let index =
            buildBioIndex(
                scopedPages
            );


        let tree =
            await expandBio(
                currentAnalysisPage,
                currentAnalysisQty,
                index
            );


        currentTree =
            tree;


        // 先在離線容器完成整個畫面。
        let nextView =
            buildAnalysisView(
                currentAnalysisPage,
                currentAnalysisQty,
                tree
            );


        // 全部完成後再一次替換，因此切換配方不會先清空舊結果。
        analysisContainer.replaceChildren(
            nextView
        );

    } catch (error) {

        new Notice(
            `❌ 遞歸分析失敗：${error.message}`
        );

        console.error(error);

    } finally {

        currentAnalysisBusy =
            false;
    }
}


async function recalculateCurrentAnalysis() {

    await rebuildAnalysis(
        false
    );
}


async function analyzePage(page) {

    let requestedQty =
        parseInt(
            targetQtyInput.value
        );


    if (
        !Number.isFinite(requestedQty) ||
        requestedQty < 1
    ) {

        requestedQty = 1;

        targetQtyInput.value =
            "1";
    }


    // 新目標 → 清空上一個目標的局部配方選擇。
    recipeChoices.clear();

    currentAnalysisPage =
        page;

    currentAnalysisQty =
        requestedQty;


    await rebuildAnalysis(
        true
    );
}


// ============================================================
// 生產設備需求表
// ============================================================

function renderMachineTable(parent) {

    let title =
        document.createElement("h3");

    title.textContent =
        "生產設備需求";

    parent.appendChild(title);


    let machines =
        [...machineList.values()];


    if (machines.length === 0) {

        let empty =
            document.createElement("div");

        empty.textContent =
            "沒有需要另外建造的生產設備。";

        parent.appendChild(empty);

        return;
    }


    let table =
        document.createElement("table");

    table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
    `;


    let thead =
        document.createElement("thead");

    thead.innerHTML = `
        <tr>
            <th>設備</th>
            <th>數量</th>
            <th>狀態</th>
        </tr>
    `;

    table.appendChild(thead);


    let tbody =
        document.createElement("tbody");


    for (let machine of machines) {

        let row =
            document.createElement("tr");


        let nameCell =
            document.createElement("td");

        if (machine.page) {

            nameCell.appendChild(
                makeFileLink(
                    machine.page,
                    machine.name
                )
            );

        } else {

            nameCell.textContent =
                machine.name;
        }


        let qtyCell =
            document.createElement("td");

        // 同一種機器目前只建一台
        qtyCell.textContent =
            "1";


        let statusCell =
            document.createElement("td");

        statusCell.textContent =
            machine.status;


        row.appendChild(nameCell);
        row.appendChild(qtyCell);
        row.appendChild(statusCell);

        tbody.appendChild(row);
    }


    table.appendChild(tbody);

    parent.appendChild(table);
}


// ============================================================
// 通用材料表
// ============================================================

function renderMaterialTable(
    parent,
    titleText,
    sourceMap
) {

    let title =
        document.createElement("h3");

    title.textContent =
        titleText;

    parent.appendChild(title);


    let items =
        [...sourceMap.values()];


    if (items.length === 0) {

        let empty =
            document.createElement("div");

        empty.textContent =
            "沒有材料資料。";

        parent.appendChild(empty);

        return;
    }


    items.sort(
        (a, b) => {

            let typeCompare =
                String(a.type)
                    .localeCompare(
                        String(b.type)
                    );

            if (typeCompare !== 0) {
                return typeCompare;
            }

            return a.name.localeCompare(
                b.name,
                "zh-Hant"
            );
        }
    );


    let table =
        document.createElement("table");

    table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
    `;


    let thead =
        document.createElement("thead");

    thead.innerHTML = `
        <tr>
            <th>類型</th>
            <th>材料</th>
            <th>總需求</th>
            <th>狀態</th>
        </tr>
    `;

    table.appendChild(thead);


    let tbody =
        document.createElement("tbody");


    for (let item of items) {

        let row =
            document.createElement("tr");


        let typeCell =
            document.createElement("td");

        typeCell.textContent =
            item.type || "";


        let nameCell =
            document.createElement("td");

        if (item.page) {

            nameCell.appendChild(
                makeFileLink(
                    item.page,
                    item.name
                )
            );

        } else {

            nameCell.textContent =
                item.name;
        }


        let qtyCell =
            document.createElement("td");

        qtyCell.textContent =
            formatNumber(
                item.qty
            );


        let statusCell =
            document.createElement("td");

        statusCell.textContent =
            item.status;


        row.appendChild(typeCell);
        row.appendChild(nameCell);
        row.appendChild(qtyCell);
        row.appendChild(statusCell);

        tbody.appendChild(row);
    }


    table.appendChild(tbody);

    parent.appendChild(table);
}
// ============================================================
// 解析機器建造成本
// ============================================================

async function registerMachine(
    machineName,
    index
) {

    if (!machineName) {
        return;
    }


    let machinePage =
        resolveBio(
            machineName,
            index
        );


    // 找不到 BIO
    if (!machinePage) {

        let key =
            "unresolved-machine:" +
            normalize(machineName);

        if (!machineList.has(key)) {

            machineList.set(
                key,
                {
                    name: machineName,
                    page: null,
                    status: "未建立 / 範圍外"
                }
            );
        }

        return;
    }


    let path =
        machinePage.file.path;


    // 同一種設備只建一次
    if (
        processedMachines.has(path)
    ) {
        return;
    }


    // 循環防護
    if (
        processingMachines.has(path)
    ) {
        return;
    }


    processingMachines.add(path);


    machineList.set(
        path,
        {
            name:
                machinePage.file.name,

            page:
                machinePage,

            status:
                "需建造"
        }
    );


    let parsed =
        await parseBio(
            machinePage
        );

    let selectedRecipe =
        chooseRecipe(
            machinePage,
            parsed
        );


    // 沒有目前允許的配方
    if (!selectedRecipe) {

        processingMachines.delete(
            path
        );

        processedMachines.add(
            path
        );

        return;
    }


    let batches =
        Math.ceil(
            1 /
            selectedRecipe.output
        );


    // 這台機器本身需要另一台機器
    if (selectedRecipe.machine) {

        await registerMachine(
            selectedRecipe.machine,
            index
        );
    }


    // 展開建造機器的材料
    for (
        let ingredient
        of selectedRecipe.ingredients
    ) {

        let required =
            ingredient.qty *
            batches;


        let ingredientPage =
            resolveBio(
                ingredient.name,
                index
            );


        if (!ingredientPage) {

            addLeafTo(
                machineLeafTotals,

                "unresolved:" +
                    normalize(
                        ingredient.name
                    ),

                ingredient.name,

                ingredient.type,

                required,

                null,

                "未建立 / 範圍外"
            );

            continue;
        }


        await expandMachineMaterial(
            ingredientPage,
            required,
            index,
            []
        );
    }


    processingMachines.delete(
        path
    );

    processedMachines.add(
        path
    );
}


async function expandMachineMaterial(
    page,
    requiredQty,
    index,
    stack = []
) {

    let parsed =
        await parseBio(page);

    let selectedRecipe =
        chooseRecipe(
            page,
            parsed
        );


    // 沒有目前允許的配方
    // → 機器建造的基礎材料
    if (!selectedRecipe) {

        addLeafTo(
            machineLeafTotals,

            page.file.path,

            page.file.name,

            getBioType(
                page.type
            ),

            requiredQty,

            page,

            "無配方 / 未允許取得方式"
        );

        return;
    }


    if (selectedRecipe.machine) {

        await registerMachine(
            selectedRecipe.machine,
            index
        );
    }


    let batches =
        Math.ceil(
            requiredQty /
            selectedRecipe.output
        );


    let nextStack =
        [
            ...stack,
            page.file.path
        ];


    for (
        let ingredient
        of selectedRecipe.ingredients
    ) {

        let childRequired =
            ingredient.qty *
            batches;


        let targetPage =
            resolveBio(
                ingredient.name,
                index
            );


        if (!targetPage) {

            addLeafTo(
                machineLeafTotals,

                "unresolved:" +
                    normalize(
                        ingredient.name
                    ),

                ingredient.name,

                ingredient.type,

                childRequired,

                null,

                "未建立 / 範圍外"
            );

            continue;
        }


        if (
            nextStack.includes(
                targetPage.file.path
            )
        ) {
            continue;
        }


        await expandMachineMaterial(
            targetPage,
            childRequired,
            index,
            nextStack
        );
    }
}

```

