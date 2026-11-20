---
created: 2026-11-12
updated: 2026-11-20 23:09:13
---

# BIO 搜尋介面 V4

選擇目標後，可在遞歸樹切換取得路線與 Tag／擇一材料。外部取得會顯示 BIO 的來源說明。

```dataviewjs
// ============================================================
// Slimefun / Minecraft BIO 遞歸搜索引擎 - V4
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
// 9. 複製 Mermaid、Checklist 與製作教程，並由 Templater 輸出檔案
// ============================================================


// ============================================================
// 0. 基本設定
// ============================================================

const readerModule = { exports: {} };
const readerSource = await app.vault.adapter.read("BIO相關模組/搜尋介面模塊/bio_reader_v4.js");
new Function("module", readerSource)(readerModule);
const bioReaderV4 = readerModule.exports;
const reportModule = { exports: {} };
const reportSource = await app.vault.adapter.read("BIO相關模組/搜尋介面模塊/bio_report_v4.js");
new Function("module", reportSource)(reportModule);
const bioReportsV4 = reportModule.exports;
let analysisBudget = bioReportsV4.createBudget();
let equipmentSteps = [];
let latestReport = null;
let exportBusy = false;

const analysisWarnings = new Map();

const STORAGE_KEY =
    "slimefun-recursive-v4-scope:" + app.vault.getName();

const MAX_SEARCH_RESULTS = 50;
const RECIPE_STORAGE_KEY =
    "slimefun-recursive-v4-recipes:" + app.vault.getName();
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

    if (type === "mc-tag") {
        return "tag";
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

        for (const section of recipeSections) selectedRecipeSections.add(section);
    }

} catch {

    for (const section of recipeSections) selectedRecipeSections.add(section);
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

const limitDetails = document.createElement("details");
const limitSummary = document.createElement("summary");
limitSummary.textContent = "分析保護（可調整）";
limitDetails.appendChild(limitSummary);
const limitInputs = {};
for (const setting of [
    ["maxDepth", "遞歸深度", 200, 1, 500],
    ["maxNodes", "總展開節點（含設備）", 1000, 10, 2000],
    ["maxMilliseconds", "分析時間上限（秒）", 30, 1, 60],
    ["maxMermaidNodes", "Mermaid 顯示節點", 200, 10, 1000]
]) {
    const [key, title, value, minimum, maximum] = setting;
    const label = document.createElement("label");
    label.style.cssText = "display:inline-flex;gap:6px;align-items:center;margin:5px";
    label.appendChild(document.createTextNode(title));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(minimum);
    input.max = String(maximum);
    input.value = String(value);
    input.style.width = "95px";
    input.addEventListener("change", async () => {
        await recalculateCurrentAnalysis();
    });
    label.appendChild(input);
    limitDetails.appendChild(label);
    limitInputs[key] = { input, minimum, maximum, scale: key === "maxMilliseconds" ? 1000 : 1 };
}
root.appendChild(limitDetails);

function currentLimits() {
    const limits = {};
    for (const [key, setting] of Object.entries(limitInputs)) {
        const value = Number(setting.input.value);
        const normalized = Math.min(setting.maximum, Math.max(setting.minimum,
            Number.isFinite(value) ? Math.floor(value) : bioReportsV4.DEFAULT_LIMITS[key] / setting.scale));
        setting.input.value = String(normalized);
        limits[key] = normalized * setting.scale;
    }
    return limits;
}


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

            parseCache.clear(); resolvedParseCache.clear();

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

        parseCache.clear(); resolvedParseCache.clear();

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

        parseCache.clear(); resolvedParseCache.clear();

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

        parseCache.clear(); resolvedParseCache.clear();

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
    const collections = new Map();


    for (let page of scopedPages) {
        if (page.tag_identity === "obsf:derived_ingredient_group" && page.derived_group) {
            const members = collections.get(page.derived_group) || [];
            members.push(page); collections.set(page.derived_group, members);
        }

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
        byPath,
        collections
    };
}

function resolveExceptSelfCollection(groupId, owner, index) {
    const candidates = index.collections.get(groupId) || [];
    const folder = owner.file.path.replace(/\/[^/]+$/, "");
    const sameFolder = candidates.filter(page => page.file.path.replace(/\/[^/]+$/, "") === folder);
    if (sameFolder.length) return sameFolder.length === 1 ? sameFolder[0] : null;
    const formal = candidates.filter(page => !/(?:^|\/)preview\//i.test(page.file.path) &&
        !/\.preview\.md$/i.test(page.file.path));
    return formal.length === 1 ? formal[0] : null;
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
    // 明確指定其他預覽批次的 path 若不在目前範圍，回報缺少 BIO。
    if (name.includes("/")) return null;

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

const parseCache = new Map();
const resolvedParseCache = new Map();
const recipeChoices = new Map();
const ingredientChoices = new Map();

function getAllowedRecipes(parsed) {
    return bioReaderV4.allowedRecipes(parsed, selectedRecipeSections,
        recipe => bioReaderV4.providerAllowed(recipe.provider, selectedFolders));
}

function isCollectionPath(path, index) {
    const target = resolveBio(path, index);
    return bioReaderV4.isTagBIO(target);
}

function dependencyWouldCycle(target, stack, index) {
    return bioReaderV4.dependencyWouldCycle(target.file.path, stack, path => isCollectionPath(path, index));
}

function chooseRecipe(page, parsed, index = null, stack = []) {
    const path = [...stack, page.file.path];
    const selected = bioReaderV4.chooseRecipe(
        page.file.path, getAllowedRecipes(parsed), recipeChoices, ingredientChoices,
        { isChoiceAllowed: choice => {
            if (!index) return true;
            const target = resolveBio(choice.name, index);
            return !target || !dependencyWouldCycle(target, path, index);
        } }
    );
    for (const ingredient of selected?.ingredients || []) if (ingredient.cycleFallback) {
        analysisWarnings.set('tag-cycle-fallback:' + JSON.stringify([path, ingredient.selectionKey]),
            'Tag 代表材料遇到循環，改用另一個合法成員：' + ingredient.cycleFallback.from + ' → ' + ingredient.cycleFallback.to);
    }
    return selected;
}

async function parseBio(page) {
    if (parseCache.has(page.file.path)) return parseCache.get(page.file.path);
    const file = app.vault.getAbstractFileByPath(page.file.path);
    if (!file) throw new Error("找不到 BIO：" + page.file.path);
    const text = await app.vault.read(file);
    if (text.length > 500000) {
        const reason = "BIO 內容超過 500000 字元：" + page.file.path;
        analysisBudget.stop(reason);
        const blocked = { defaultOutput: 1, recipes: [], diagnostics: [], blockedByLimit: reason };
        parseCache.set(page.file.path, blocked);
        return blocked;
    }
    const parsed = bioReaderV4.parseBIO(text, page);
    parseCache.set(page.file.path, parsed);
    for (const diagnostic of parsed.diagnostics) {
        analysisWarnings.set(
            page.file.path + ":" + diagnostic.code,
            page.file.path + " — " + diagnostic.code + " — " + diagnostic.message
        );
    }
    return parsed;
}

async function parseResolvedBio(page, index) {
    if (resolvedParseCache.has(page.file.path)) return resolvedParseCache.get(page.file.path);
    const raw = await parseBio(page);
    if (raw.blockedByLimit) return raw;
    const parsed = await bioReaderV4.resolveRecipeExclusions(raw, {
        owner: page, resolvePage: name => resolveBio(name, index), parsePage: parseBio,
        resolveCollection: groupId => resolveExceptSelfCollection(groupId, page, index)
    });
    resolvedParseCache.set(page.file.path, parsed);
    for (const diagnostic of parsed.diagnostics) analysisWarnings.set(
        page.file.path + ":" + diagnostic.code,
        page.file.path + " — " + diagnostic.code + " — " + diagnostic.message
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

let pendingRecalculation =
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

function treeNode(page, required, properties = {}) {
    return {
        name: page?.file?.name || properties.name || "未展開材料",
        page: page || null, type: page ? getBioType(page.type) : "",
        required, output: 1, batches: 0, machine: "", section: "",
        recipeCount: 0, recipeOptions: [], selectedRecipeKey: "",
        ingredientOptions: [], acquisition: "", children: [],
        leaf: false, cycle: false, ...properties
    };
}

function truncatedNode(page, required, reason, placeholder = false) {
    analysisWarnings.set("limit:" + (page?.file?.path || reason), reason);
    placeholder ||= !Number.isFinite(required);
    return treeNode(page, Number.isFinite(required) ? required : 0, {
        name: placeholder ? "尚有材料未展開" : page?.file?.name,
        leaf: true, truncated: true, reason, placeholder
    });
}

async function admitExpansion(depth, quantity) {
    if (quantity != null && (!Number.isFinite(quantity) || quantity < 0)) {
        analysisBudget.stop("材料需求數量超出可計算範圍");
    }
    const permit = analysisBudget.enter(depth);
    if (permit.allowed && analysisBudget.nodes % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return permit;
}

function equipmentMaterials(recipe, batches, index) {
    return recipe.ingredients.map(ingredient => {
        let page = resolveBio(ingredient.name, index);
        const seen = new Set();
        while (page && !seen.has(page.file.path)) {
            seen.add(page.file.path);
            const parsed = resolvedParseCache.get(page.file.path) || parseCache.get(page.file.path);
            const representative = parsed && chooseRecipe(page, parsed);
            if (!representative?.tagRepresentative) break;
            page = resolveBio(representative.ingredients[0].name, index);
        }
        return {
            name: page?.file?.name || ingredient.label || ingredient.name,
            type: page ? getBioType(page.type) : ingredient.type,
            qty: ingredient.qty * batches
        };
    });
}

function recordEquipmentStep(page, recipe, required, batches, index, complete, depth = 0, parent = "") {
    if (recipe.tagRepresentative) return;
    equipmentSteps.push({
        name: page.file.name, path: page.file.path, routeKey: recipe.key,
        machine: recipe.machine || "無/手動", output: recipe.output,
        notes: recipe.notes || [],
        depth, parents: parent ? [parent] : [],
        batches, required, materials: equipmentMaterials(recipe, batches, index),
        incomplete: !complete
    });
}

function reportSnapshot(page, requestedQty, tree) {
    return bioReportsV4.createSnapshot({
        page, requestedQty, tree, leafTotals, machineList, machineLeafTotals,
        equipmentSteps, warnings: [...analysisWarnings.values()],
        budget: analysisBudget.snapshot()
    });
}

function publishReport(snapshot) {
    globalThis.__obsfV4LatestReports ||= Object.create(null);
    const key = app.vault.adapter.basePath || app.vault.getName();
    globalThis.__obsfV4LatestReports[key] = snapshot;
}

async function runReportExport(button, tree = currentTree) {
    if (exportBusy) return;
    if (currentAnalysisBusy || !latestReport || currentTree !== tree) {
        new Notice("請等待目前分析完成，再匯出報告。");
        return;
    }
    const plugin = app.plugins?.getPlugin?.("templater-obsidian") ||
        app.plugins?.plugins?.["templater-obsidian"];
    const engine = plugin?.templater;
    const template = app.vault.getAbstractFileByPath("模板放置處/V4-輸出製作報告.md");
    const target = app.vault.getAbstractFileByPath("黏液科技DB 搜尋介面V4.md");
    if (!engine?.create_running_config || !engine?.read_and_parse_template || !template || !target) {
        new Notice("請啟用 Templater，確認輸出模板存在，腳本資料夾設為 BIO engine。");
        return;
    }
    exportBusy = true;
    button.disabled = true;
    try {
        publishReport(latestReport);
        // Parse this output-only template without inserting text into an editor.
        const config = engine.create_running_config(template, target, 1);
        await engine.read_and_parse_template(config);
    } catch (error) {
        new Notice("匯出失敗：" + error.message, 10000);
    } finally {
        exportBusy = false;
        button.disabled = false;
    }
}

function showExportPrompt(parent) {
    const prompt = document.createElement("div");
    prompt.style.cssText = "padding:10px;margin:8px 0;border:1px solid var(--text-warning)";
    const message = document.createElement("div");
    message.textContent = "分析已達保護限制或報告較大。可輸出 JSON、PDF 或材料／設備 CSV；截斷資料會明確標記為未完成。";
    prompt.appendChild(message);
    const open = makeButton("📤 匯出其他格式");
    open.addEventListener("click", () => runReportExport(open));
    prompt.appendChild(open);
    parent.appendChild(prompt);
}

async function expandBio(page, requiredQty, index, stack = []) {
    const permit = await admitExpansion(stack.length, requiredQty);
    if (!permit.allowed) return truncatedNode(page, requiredQty, permit.reason);
    const parsed = await parseResolvedBio(page, index);
    if (parsed.blockedByLimit) return truncatedNode(page, requiredQty, parsed.blockedByLimit);
    const selected = chooseRecipe(page, parsed, index, stack);
    const allowed = getAllowedRecipes(parsed);
    const node = treeNode(page, requiredQty, {
        output: selected?.output || parsed.defaultOutput,
        tagRepresentative: selected?.tagRepresentative === true,
        acquisition: selected?.sourceText || "",
        notes: selected?.notes || [],
        ingredientOptions: selected?.ingredients || [],
        recipeCount: allowed.length, recipeOptions: allowed,
        selectedRecipeKey: selected?.key || ""
    });
    if (!selected || selected.external) {
        node.leaf = true;
        node.section = selected?.section || "";
        if (!selected && (parsed.recipes.length || parsed.exclusionFailures)) {
            node.unavailable = true;
            node.notes = [parsed.exclusionFailures
                ? "材料排除條件未確認或排除自身後沒有合法材料；需求量已保留，未設為 Base。"
                : "目前科技／取得方式範圍沒有可用配方；需求量已保留，未設為 Base。"];
        }
        addLeaf(page.file.path, page.file.name, getBioType(page.type), requiredQty, page,
            selected?.sourceText || (node.unavailable ? "未允許取得方式：目前範圍沒有可用配方" : "無配方 / 未允許取得方式"));
        return node;
    }
    node.machine = selected.machine;
    node.section = selected.section;
    node.output = selected.output;
    if (selected.machine) await registerMachine(selected.machine, index, stack.length + 1);
    node.batches = selected.tagRepresentative ? requiredQty : Math.ceil(requiredQty / selected.output);
    const nextStack = [...stack, page.file.path];
    for (const ingredient of selected.ingredients) {
        const next = analysisBudget.check(nextStack.length);
        if (!next.allowed) {
            node.children.push(truncatedNode(null, 0, next.reason, true));
            break;
        }
        const quantity = ingredient.qty * node.batches;
        const target = resolveBio(ingredient.name, index);
        if (!target || dependencyWouldCycle(target, nextStack, index)) {
            const childPermit = await admitExpansion(nextStack.length, quantity);
            if (!childPermit.allowed) {
                node.children.push(truncatedNode(target, quantity, childPermit.reason));
                break;
            }
            if (!target) {
                addLeaf("unresolved:" + normalize(ingredient.name),
                    ingredient.name, ingredient.type, quantity, null, "未建立 / 範圍外");
            }
            node.children.push(treeNode(target, quantity, {
                name: target?.file?.name || ingredient.name,
                type: target ? getBioType(target.type) : ingredient.type,
                leaf: true, unresolved: !target, cycle: Boolean(target)
            }));
            continue;
        }
        node.children.push(await expandBio(target, quantity, index, nextStack));
    }
    return node;
}

function renderRecipeControls(node, parent) {
    if (!node.page || node.cycle || node.truncated) return;
    function addSelect(label, values, selectedValue, onChange) {
        const row = document.createElement("div");
        row.style.cssText = "margin-left:22px;padding:5px 0;display:flex;flex-wrap:wrap;gap:7px;align-items:center";
        const caption = document.createElement("span");
        caption.textContent = label;
        const select = document.createElement("select");
        select.style.cssText = "max-width:90%;padding:4px;background:var(--background-primary);color:var(--text-normal)";
        function populateOptions(query = "") {
            select.replaceChildren();
            const matches = values.filter(value => (String(value.label) + " " + (value.group || "")).toLowerCase().includes(query.toLowerCase()));
            const visible = matches.slice(0, 200);
            const selected = values.find(value => value.value === selectedValue);
            if (selected && !visible.some(value => value.value === selectedValue)) visible.unshift(selected);
            const groups = new Map();
            for (const value of visible) {
                const option = document.createElement("option");
                option.value = value.value;
                option.textContent = value.label;
                if (value.title) option.title = value.title;
                let destination = select;
                if (value.group) {
                    if (!groups.has(value.group)) {
                        const group = document.createElement("optgroup");
                        group.label = value.group;
                        groups.set(value.group, group);
                        select.appendChild(group);
                    }
                    destination = groups.get(value.group);
                }
                destination.appendChild(option);
            }
            select.value = selectedValue;
        }
        populateOptions();
        if (values.length > 200) {
            const filter = document.createElement("input");
            filter.placeholder = "選項較多，輸入名稱篩選";
            filter.addEventListener("input", () => populateOptions(filter.value));
            row.appendChild(filter);
        }
        select.addEventListener("click", event => event.stopPropagation());
        select.addEventListener("change", async event => {
            event.stopPropagation();
            onChange(select.value);
            await recalculateCurrentAnalysis();
        });
        row.append(caption, select);
        parent.appendChild(row);
    }
    if (node.recipeOptions?.length > 1) {
        addSelect(
            "取得路線",
            bioReaderV4.recipeMenuOptions(node.recipeOptions),
            node.selectedRecipeKey,
            value => recipeChoices.set(node.page.file.path, value)
        );
    }
    for (const ingredient of node.ingredientOptions || []) {
        if (!ingredient.selectionKey || ingredient.choices?.length < 2) continue;
        const label = node.tagRepresentative
            ? node.name.replace(/\.preview$/i, "")
            : ingredient.label || ingredient.choiceId || "擇一材料";
        addSelect(
            label,
            ingredient.choices.map(choice => ({ value: choice.name, label: choice.label })),
            ingredient.name,
            value => ingredientChoices.set(ingredient.selectionKey, value)
        );
    }
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
                node.placeholder ? "" : ` × ${formatNumber(node.required)}`
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


        if (node.truncated) {
            const warning = document.createElement("span");
            warning.textContent = " ⚠ 未展開：" + node.reason;
            warning.style.color = "var(--text-warning)";
            row.appendChild(warning);
        }
        if (node.acquisition) {
            const source = document.createElement("span");
            source.textContent = " ｜ " + node.acquisition;
            row.appendChild(source);
        }
        if (node.unavailable) {
            const warning = document.createElement("span");
            warning.textContent = " ⚠ " + node.notes.join("；");
            warning.style.color = "#e69532";
            row.appendChild(warning);
        }
        renderRecipeControls(node, row);

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
        node.tagRepresentative
            ? "← Tag 代表材料"
            : `← ${node.machine}` +
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
    renderRecipeControls(node, details);

    if (node.notes?.length) {
        const note = document.createElement("div");
        note.style.cssText = "margin-left:22px;padding:4px 0;color:var(--text-muted)";
        note.textContent = "備註：" + node.notes.join("；");
        details.appendChild(note);
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



function buildPlainTextReport(page, requestedQty, tree) {
    return bioReportsV4.buildMarkdown(reportSnapshot(page, requestedQty, tree));
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

    const reportMessages = latestReport ? bioReportsV4.reportWarnings(latestReport) : [];
    const visibleWarnings = [...new Set([...reportMessages, ...analysisWarnings.values()])];
    if (visibleWarnings.length) {
        const warnings = document.createElement("div");
        warnings.style.color = "var(--text-warning)";
        for (const message of visibleWarnings) {
            const row = document.createElement("div");
            row.textContent = "⚠ " + message;
            warnings.appendChild(row);
        }
        view.appendChild(warnings);
    }

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
        makeButton("📋 複製 Markdown＋製作教程");

    copyButton.addEventListener(
        "click",
        async () => {

            try {
                if (currentAnalysisBusy || !latestReport || currentTree !== tree) {
                    new Notice("請等待目前分析完成，再複製報告。");
                    return;
                }
                const snapshot = reportSnapshot(page, requestedQty, tree);
                if (bioReportsV4.needsFileExport(snapshot)) {
                    showExportPrompt(view);
                    return;
                }
                const report = bioReportsV4.buildMarkdown(snapshot);
                await navigator.clipboard.writeText(
                    report
                );

                new Notice(
                    "📋 已複製 Mermaid、Checklist 與製作教程"
                );

            } catch (error) {

                new Notice(
                    `❌ 複製失敗：${error.message}`
                );
            }
        }
    );

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    actions.appendChild(copyButton);
    const exportButton = makeButton("📤 匯出其他格式");
    exportButton.addEventListener("click", () => runReportExport(exportButton, tree));
    actions.appendChild(exportButton);
    headingRow.appendChild(actions);

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

    if (latestReport && bioReportsV4.needsFileExport(latestReport)) showExportPrompt(view);

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
        !currentAnalysisPage
    ) {
        return;
    }
    if (currentAnalysisBusy) {
        pendingRecalculation = true;
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
        parseCache.clear(); resolvedParseCache.clear();
        analysisWarnings.clear();
        analysisBudget = bioReportsV4.createBudget(currentLimits());
        equipmentSteps = [];
        latestReport = null;
        publishReport(null);

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
        latestReport = reportSnapshot(currentAnalysisPage, currentAnalysisQty, tree);
        publishReport(latestReport);


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
        if (pendingRecalculation) {
            pendingRecalculation = false;
            await rebuildAnalysis(false);
        }
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
    ingredientChoices.clear();

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

async function registerMachine(machineName, index, depth = 0, tutorialDepth = 0, parent = "") {
    if (!machineName || ["無/手動", "手動/無", "外部取得"].includes(String(machineName).trim())) return true;
    const page = resolveBio(machineName, index);
    if (page && processedMachines.has(page.file.path)) {
        for (const step of equipmentSteps) {
            if (step.path !== page.file.path) continue;
            step.depth = Math.min(step.depth ?? tutorialDepth, tutorialDepth);
            if (parent) step.parents = [...new Set([...(step.parents || []), parent])];
        }
        return true;
    }
    if (page && processingMachines.has(page.file.path)) {
        analysisWarnings.set("machine-cycle:" + page.file.path, "設備建造遇到循環：" + page.file.path);
        return false;
    }
    const permit = await admitExpansion(depth);
    const key = page?.file?.path || "unresolved-machine:" + normalize(machineName);
    if (!permit.allowed) {
        machineList.set(key, { name: page?.file?.name || machineName, page, status: "未分析：" + permit.reason });
        analysisWarnings.set("limit:" + key, permit.reason);
        return false;
    }
    if (!page) {
        machineList.set(key, { name: machineName, page: null, status: "未建立 / 範圍外" });
        return false;
    }
    processingMachines.add(key);
    const entry = { name: page.file.name, page, status: "需建造" };
    machineList.set(key, entry);
    try {
        const parsed = await parseResolvedBio(page, index);
        if (parsed.blockedByLimit) { entry.status = "未分析：" + parsed.blockedByLimit; return false; }
        const recipe = chooseRecipe(page, parsed);
        if (!recipe) { entry.status = parsed.exclusionFailures ? "材料排除條件未確認" : "配方未確認"; return false; }
        if (recipe.external) { entry.status = recipe.sourceText; return true; }
        let complete = true;
        const batches = Math.ceil(1 / recipe.output);
        if (recipe.machine) complete = await registerMachine(recipe.machine, index, depth + 1, tutorialDepth + 1, page.file.name);
        for (const ingredient of recipe.ingredients) {
            const next = analysisBudget.check(depth + 1);
            if (!next.allowed) {
                analysisWarnings.set("limit:" + key, next.reason);
                complete = false;
                break;
            }
            const required = ingredient.qty * batches;
            const material = resolveBio(ingredient.name, index);
            if (!material) {
                const leafPermit = await admitExpansion(depth + 1, required);
                if (!leafPermit.allowed) { complete = false; break; }
                addLeafTo(machineLeafTotals, "unresolved:" + normalize(ingredient.name),
                    ingredient.name, ingredient.type, required, null, "未建立 / 範圍外");
                complete = false;
            } else if (!await expandMachineMaterial(material, required, index, [], depth + 1, tutorialDepth + 1, page.file.name)) complete = false;
        }
        recordEquipmentStep(page, recipe, 1, batches, index, complete, tutorialDepth, parent);
        if (!complete) entry.status = "需先確認設備材料";
        return complete;
    } finally {
        processingMachines.delete(key);
        processedMachines.add(key);
    }
}

async function expandMachineMaterial(page, requiredQty, index, stack = [], depth = stack.length, tutorialDepth = 0, parent = "") {
    const permit = await admitExpansion(depth, requiredQty);
    if (!permit.allowed) {
        analysisWarnings.set("limit:" + page.file.path, permit.reason);
        return false;
    }
    const parsed = await parseResolvedBio(page, index);
    if (parsed.blockedByLimit) return false;
    const recipe = chooseRecipe(page, parsed, index, stack);
    if (!recipe || recipe.external) {
        addLeafTo(machineLeafTotals, page.file.path, page.file.name, getBioType(page.type),
            requiredQty, page, recipe?.sourceText || "無配方 / 未允許取得方式");
        return !parsed.exclusionFailures;
    }
    let complete = true;
    if (recipe.machine) complete = await registerMachine(recipe.machine, index, depth + 1, tutorialDepth + 1, page.file.name);
    const batches = recipe.tagRepresentative ? requiredQty : Math.ceil(requiredQty / recipe.output);
    const nextStack = [...stack, page.file.path];
    for (const ingredient of recipe.ingredients) {
        const next = analysisBudget.check(depth + 1);
        if (!next.allowed) {
            analysisWarnings.set("limit:" + page.file.path, next.reason);
            complete = false;
            break;
        }
        const required = ingredient.qty * batches;
        const target = resolveBio(ingredient.name, index);
        if (!target) {
            const leafPermit = await admitExpansion(depth + 1, required);
            if (!leafPermit.allowed) { complete = false; break; }
            addLeafTo(machineLeafTotals, "unresolved:" + normalize(ingredient.name),
                ingredient.name, ingredient.type, required, null, "未建立 / 範圍外");
            complete = false;
        } else if (dependencyWouldCycle(target, nextStack, index)) {
            analysisWarnings.set("machine-material-cycle:" + target.file.path,
                "設備材料遇到循環：" + [...nextStack, target.file.path].join(" → "));
            complete = false;
        } else if (!await expandMachineMaterial(target, required, index, nextStack, depth + 1, tutorialDepth + 1, parent)) complete = false;
    }
    recordEquipmentStep(page, recipe, requiredQty, batches, index, complete, tutorialDepth, parent);
    return complete;
}

```

