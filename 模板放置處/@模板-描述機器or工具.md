<%*
// 1. 彈出視窗詢問
let rawInput = await tp.system.prompt("請輸入新物品名稱 (若有別名請用空格隔開)：");
let outputQty = await tp.system.prompt("請輸入該物品一個配方能做出的數量", "1");
let itemId = await tp.system.prompt("請輸入物品 ID (例如: HM_QKJCY)：");

// 防呆機制
if (!rawInput || !outputQty || !itemId) return; 

let nameParts = rawInput.trim().split(/\s+/);
let itemName = nameParts[0]; 
let itemAliases = nameParts.slice(1); 

// ==========================================
// 2 & 3. 跨檔案自動抓取：解鎖等級 (levelCost) 與 配方源碼 (recipe)
// ==========================================
let levelCost = "";
let itemSource = "";
const referenceFolder = "參考資料"; // 確保你的 .yml 檔案都放在這個資料夾下

try {
    // 使用 adapter 繞過 Obsidian 索引，直接讀取硬碟檔案
    const list = await app.vault.adapter.list(referenceFolder);
    
    for (let filePath of list.files) {
        if (filePath.endsWith(".yml") || filePath.endsWith(".txt") || filePath.endsWith(".md")) {
            let content = await app.vault.adapter.read(filePath);
            
            // 任務 A: 找解鎖等級 (levelCost)
            if (!levelCost) {
                let blocks = content.split(/\n(?=[a-zA-Z0-9_]+:)/);
                for (let block of blocks) {
                    let idRegex = new RegExp(`-\\s*${itemId}\\b`);
                    if (idRegex.test(block)) {
                        let levelMatch = block.match(/levelCost:\s*(\d+)/);
                        if (levelMatch) levelCost = levelMatch[1];
                        break;
                    }
                }
            }
            
            // 任務 B: 找配方源碼 (直接定位該 ID 的整個區塊)
if (!itemSource) {
    let blockRegex = new RegExp(
        `^${itemId}:[\\s\\S]*?(?=^\\S[^:\\r\\n]|$(?![\\s\\S]))`,
        "gm"
    );

    let blockMatch = content.match(blockRegex);

    if (blockMatch) {
        itemSource = blockMatch[0];
    }
}
            
            // 如果等級跟配方都找到了，就提早結束搜尋，節省效能
            if (levelCost && itemSource) break;
        }
    }
} catch (error) {
    new Notice("⚠️ 找不到參考資料，請確認資料夾名稱或路徑是否正確！");
}

// ==========================================
// 4. 解析取得的配方源碼
// ==========================================
let machine = "無/手動";
let materials = {};

if (itemSource) {

    // ======================================
    // A. YAML 名稱
    // ======================================
    let nameMatch = itemSource.match(
        /name:\s*['"]?([^'"\n]+)['"]?/
    );

    if (nameMatch) {

        let yamlName = nameMatch[1]
            .replace(/&[0-9a-fk-orlmn]/ig, '')
            .trim();

        if (
            yamlName !== itemName &&
            !itemAliases.includes(yamlName)
        ) {
            itemAliases.push(yamlName);
        }
    }


    // ======================================
    // B. 生產設備
    // ======================================
    const machineDict = {
        "ENHANCED_CRAFTING_TABLE": "強化工作台",
        "MAGIC_WORKBENCH": "魔法工作台",
        "ARMOR_FORGE": "護甲鍛造台",
        "SMELTERY": "冶煉爐",
        "ORE_CRUSHER": "碎礦機",
        "COMPRESSOR": "壓縮機",
        "JUICER": "榨汁機",
        "ANCIENT_ALTAR": "遠古祭壇",
        "HEATED_PRESSURE_CHAMBER": "加熱壓力艙"
    };

    let machineRaw =
        itemSource.match(
            /(?<=recipe_type:\s)[A-Za-z0-9_]+/
        )?.[0] || "無/手動";

    machine =
        machineDict[machineRaw] ||
        machineRaw;


    // ======================================
    // C. 配方材料
    // ======================================
    let recipeMatch = itemSource.match(/^[ \t]*recipe:\s*$/m);

    if (recipeMatch) {

        let recipeSource =
            itemSource.slice(
                recipeMatch.index +
                recipeMatch[0].length
            );

        const ingredientRegex =
            /^[ \t]+material:\s*([A-Za-z0-9_:-]+)\s*\r?\n[ \t]+amount:\s*(\d+)/gm;

        for (
            let match of
            recipeSource.matchAll(ingredientRegex)
        ) {

            let material = match[1];
            let amount = Number(match[2]);

            if (!materials[material]) {
                materials[material] = 0;
            }

            materials[material] += amount;
        }
    }
}

new Notice(`itemSource 長度：${itemSource.length}`);

let debugRecipeMatch = itemSource.match(/^[ \t]*recipe:\s*$/m);
new Notice(
    debugRecipeMatch
        ? "✅ 找到 recipe:"
        : "❌ itemSource 裡沒有找到 recipe:"
);

// ========================================
// 5. 建立「材料 ID → 現有檔案名稱」翻譯字典
// ========================================
const files = app.vault.getMarkdownFiles();
const aliasToName = {};

for (let f of files) {
    const base = f.basename;

    let aliases =
        app.metadataCache.getFileCache(f)?.frontmatter?.aliases || [];

    // aliases 可能只有單一字串
    if (!Array.isArray(aliases)) {
        aliases = [aliases];
    }

    // 檔名本身也可以被辨識
    aliasToName[base] = base;

    // aliases → 實際檔名
    for (let alias of aliases) {
        if (alias) {
            aliasToName[String(alias).trim()] = base;
        }
    }
}


// ========================================
// 6. 組合配方清單
// ========================================
let recipeOutput = "";

if (Object.keys(materials).length > 0) {

    recipeOutput += `- **生產設備**：(Machine:: [[${machine}]])\n`;
    recipeOutput += `\t**合成所需**：\n`;

    for (let matId in materials) {

        const qty = materials[matId];

        // 用材料 ID 尋找 aliases 相同的檔案
        const realName = aliasToName[matId];

        if (realName) {
            // 找得到 → 顯示現有筆記名稱
            recipeOutput += `\t- [item:: [[${realName}]]] (qty:: ${qty})\n`;
        } else {
            // 找不到 → 保留原始 ID
            recipeOutput += `\t- [item:: ${matId}] (qty:: ${qty})\n`;
        }
    }

} else {

    recipeOutput += `擷取失敗`;
}


// 7. 抓取所有資料夾並選擇創建位置
const folderDict = {
    "HM": "SF-海曼科技院",
    "SF": "SF-黏液科技",
    "SC": "SF-科技院",
    "GN": "SF-基因科技"
};
let folders = app.vault.getAllLoadedFiles().filter(
    f => f instanceof tp.obsidian.TFolder && f.path !== "/"
);

let folderPaths = folders.map(f => f.path);

// 取 ID 的前綴，例如 HM_WJXXJCY → HM
let idPrefix = itemId.split("_")[0];

// 先查字典
let selectedPath = folderDict[idPrefix];

// 如果字典沒找到，才讓你手動選
if (!selectedPath) {
    selectedPath = await tp.system.suggester(
        folderPaths,
        folderPaths,
        false,
        "請選擇要將此物品創建在哪個資料夾..."
    );

    if (!selectedPath) return;
}

let targetFolder = folders.find(
    f => f.path === selectedPath
);

// 8. 準備檔案的初始內容
let content = `---
type: sf-item
id: ${itemId}
level: ${levelCost}
output: ${Number(outputQty)}
aliases: ${JSON.stringify([...itemAliases, itemId])}
---
#待補充

# 合成/取得
### 常規
${recipeOutput}
### 液體

### 無限附加

### 煉金術自傳-煉金術

# 用途
- 

# 產物
- 
`;

// 9. 【直接創建】
await tp.file.create_new(content, itemName, true, targetFolder);
_%>