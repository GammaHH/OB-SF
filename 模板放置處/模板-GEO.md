<%*
// ====================================
// 1. 基本資料輸入
// ====================================
let rawInput = await tp.system.prompt(
    "請輸入新物品名稱 (若有別名請用空格隔開)："
);

let itemId = await tp.system.prompt(
    "請輸入物品 ID (例如: HAIMAN_STAR_DUST / NETHER_ICE)："
);

// 防呆
if (!rawInput || !itemId) return;

itemId = itemId.trim();

let nameParts = rawInput.trim().split(/\s+/);
let itemName = nameParts[0];
let itemAliases = nameParts.slice(1);


// ====================================
// 2. 基本變數
// ====================================
let itemSource = "";
let sourceType = "";
let levelCost = "";

let machine = "";
let maxDeviation = "";

// YAML GEO
let supplies = {};

// Java + JSON GEO
let biomeSupplies = [];
let javaEnvironment = "";
let geoJsonFile = "";

const referenceFolder = "參考資料";
const dv = "::";


// ====================================
// 3. 搜尋原始資料 + 解鎖等級
//    支援 YAML 與 Java GEO
// ====================================
try {

    const list = await app.vault.adapter.list(referenceFolder);


    // ------------------------------------
    // A. 找解鎖等級
    // ------------------------------------
    for (let filePath of list.files) {

        if (
            filePath.endsWith(".yml") ||
            filePath.endsWith(".yaml") ||
            filePath.endsWith(".java") ||
            filePath.endsWith(".txt") ||
            filePath.endsWith(".md")
        ) {

            let sourceContent =
                await app.vault.adapter.read(filePath);


            // ------------------------------
            // A-1. 舊 YAML levelCost
            // ------------------------------
            if (!levelCost) {

                let blocks =
                    sourceContent.split(/\n(?=[a-zA-Z0-9_]+:)/);

                for (let block of blocks) {

                    let idRegex =
                        new RegExp(
                            "-\\s*" + itemId + "\\b"
                        );

                    if (idRegex.test(block)) {

                        let levelMatch =
                            block.match(
                                /levelCost:\s*(\d+)/
                            );

                        if (levelMatch) {
                            levelCost =
                                levelMatch[1];
                            break;
                        }
                    }
                }
            }


            // ------------------------------
            // A-2. Slimefun Java research
            //
            // register(
            //   "...", 13, "...", 5,
            //   SlimefunItems.ITEM_ID
            // );
            //
            // 第四個參數 = levelCost
            // ------------------------------
            if (!levelCost) {

                let researchBlocks =
                    sourceContent.match(
                        /register\([\s\S]*?\);/g
                    ) || [];

                let targetResearchRegex =
                    new RegExp(
                        "SlimefunItems\\." +
                        itemId +
                        "\\b"
                    );

                for (let block of researchBlocks) {

                    if (
                        !targetResearchRegex.test(block)
                    ) {
                        continue;
                    }

                    let levelMatch =
                        block.match(
                            /register\(\s*"[^"]*"\s*,\s*\d+\s*,\s*"[^"]*"\s*,\s*(\d+)/
                        );

                    if (levelMatch) {
                        levelCost =
                            levelMatch[1];
                        break;
                    }
                }
            }
        }
    }


    // ------------------------------------
    // B. 先找 YAML GEO 區塊
    // ------------------------------------
    for (let filePath of list.files) {

        if (itemSource) break;

        if (
            filePath.endsWith(".yml") ||
            filePath.endsWith(".yaml") ||
            filePath.endsWith(".txt") ||
            filePath.endsWith(".md")
        ) {

            let sourceContent =
                await app.vault.adapter.read(filePath);

            let blockRegex =
                new RegExp(
                    "^" +
                    itemId +
                    ":[\\s\\S]*?(?=^\\S[^:\\r\\n]|$(?![\\s\\S]))",
                    "gm"
                );

            let blockMatch =
                sourceContent.match(blockRegex);

            if (blockMatch) {

                let block =
                    blockMatch[0];

                // 確認是 GEO 類型資料
                if (
                    /recipe_type:\s*GEO_MINER/.test(block) ||
                    /obtain_from_geo_miner:\s*true/.test(block) ||
                    /^[ \t]*supply:\s*$/m.test(block)
                ) {
                    itemSource = block;
                    sourceType = "yml";
                    break;
                }
            }
        }
    }


    // ------------------------------------
    // C. YAML 沒找到才找 Java GEO Resource
    // ------------------------------------
    if (!itemSource) {

        for (let filePath of list.files) {

            if (
                filePath.endsWith(".java") ||
                filePath.endsWith(".txt") ||
                filePath.endsWith(".md")
            ) {

                let sourceContent =
                    await app.vault.adapter.read(filePath);

                let idRegex =
                    new RegExp(
                        "SlimefunItems\\." +
                        itemId +
                        "\\.item\\(\\)"
                    );

                if (
                    idRegex.test(sourceContent) &&
                    (
                        /getBiomeMap\s*\(/.test(sourceContent) ||
                        /extends\s+AbstractResource/.test(sourceContent)
                    )
                ) {
                    itemSource =
                        sourceContent;

                    sourceType =
                        "java";

                    break;
                }
            }
        }
    }

} catch (error) {

    new Notice(
        `⚠️ 搜尋參考資料時發生錯誤：${error.message}`
    );

    return;
}


// 完全找不到原始碼
if (!itemSource) {

    new Notice(
        `❌ 找不到 ${itemId} 的 GEO 原始資料`
    );

    return;
}


// ====================================
// 4. YAML GEO 解析
// ====================================
if (
    itemSource &&
    sourceType === "yml"
) {

    // ------------------------------------
    // A. YAML 名稱 → aliases
    // ------------------------------------
    let nameMatch =
        itemSource.match(
            /name:\s*['"]?([^'"\n]+)['"]?/
        );

    if (nameMatch) {

        let yamlName =
            nameMatch[1]
                .replace(
                    /&[0-9a-fk-orlmn]/ig,
                    ""
                )
                .trim();

        if (
            yamlName !== itemName &&
            !itemAliases.includes(yamlName)
        ) {
            itemAliases.push(yamlName);
        }
    }


    // ------------------------------------
    // B. 生產設備
    // ------------------------------------
    const machineDict = {
        "ENHANCED_CRAFTING_TABLE": "強化工作台",
        "MAGIC_WORKBENCH": "魔法工作台",
        "ARMOR_FORGE": "護甲鍛造台",
        "SMELTERY": "冶煉爐",
        "ORE_CRUSHER": "碎礦機",
        "COMPRESSOR": "壓縮機",
        "JUICER": "榨汁機",
        "ANCIENT_ALTAR": "遠古祭壇",
        "HEATED_PRESSURE_CHAMBER": "加熱壓力艙",

        // GEO
        "GEO_MINER": "地理資源礦機"
    };

    let machineMatch =
        itemSource.match(
            /recipe_type:\s*([A-Za-z0-9_]+)/
        );

    let machineRaw =
        machineMatch
            ? machineMatch[1]
            : "";

    machine =
        machineDict[machineRaw] ||
        machineRaw;


    // ------------------------------------
    // C. 最大偏差 max_deviation
    // ------------------------------------
    let deviationMatch =
        itemSource.match(
            /^[ \t]*max_deviation:\s*([\d.]+)/m
        );

    if (deviationMatch) {
        maxDeviation =
            deviationMatch[1];
    }


    // ------------------------------------
    // D. supply 各世界供應量
    // ------------------------------------
    let supplyBlockMatch =
        itemSource.match(
            /^[ \t]*supply:\s*\r?\n((?:^[ \t]+[A-Za-z0-9_-]+:\s*[\d.]+\s*(?:\r?\n|$))+)/m
        );

    if (supplyBlockMatch) {

        let supplyBlock =
            supplyBlockMatch[1];

        const supplyRegex =
            /^[ \t]+([A-Za-z0-9_-]+):\s*([\d.]+)/gm;

        let match;

        while (
            (match = supplyRegex.exec(supplyBlock)) !== null
        ) {

            let environment =
                match[1];

            let amount =
                Number(match[2]);

            supplies[environment] =
                amount;
        }
    }
}


// ====================================
// 5. Java GEO + biome JSON 解析
// ====================================
if (
    itemSource &&
    sourceType === "java"
) {

    // Java 原版 GEO Resource
    machine =
        "地理資源礦機";


    // ------------------------------------
    // A. Java 顯示名稱 → aliases
    //
    // super(
    //   "nether_ice",
    //   "Nether Ice",
    //   SlimefunItems.NETHER_ICE.item(),
    //   ...
    // );
    // ------------------------------------
    let javaNameRegex =
        new RegExp(
            'super\\(\\s*"[^"]*"\\s*,\\s*"([^"]+)"\\s*,\\s*SlimefunItems\\.' +
            itemId +
            '\\.item\\(\\)'
        );

    let javaNameMatch =
        itemSource.match(javaNameRegex);

    if (javaNameMatch) {

        let javaName =
            javaNameMatch[1].trim();

        if (
            javaName !== itemName &&
            !itemAliases.includes(javaName)
        ) {
            itemAliases.push(javaName);
        }
    }


    // ------------------------------------
    // B. 嘗試抓 Java 世界限制
    //
    // environment != Environment.NETHER
    // ------------------------------------
    let environmentMatch =
        itemSource.match(
            /environment\s*!=\s*Environment\.([A-Z_]+)/
        );

    if (environmentMatch) {

        javaEnvironment =
            environmentMatch[1]
                .toLowerCase();
    }


    // ------------------------------------
    // C. 找 biome JSON 檔名
    //
    // getBiomeMap(
    //     this,
    //     "/biome-maps/nether_ice_v1.16.json"
    // )
    // ------------------------------------
    let jsonMatch =
        itemSource.match(
            /getBiomeMap\(\s*this\s*,\s*"\/biome-maps\/([^"]+\.json)"\s*\)/
        );

    if (jsonMatch) {

        geoJsonFile =
            jsonMatch[1];


        // 支援：
        // 參考資料/nether_ice_v1.16.json
        // 參考資料/biome-maps/nether_ice_v1.16.json
        let jsonPath1 =
            referenceFolder +
            "/" +
            geoJsonFile;

        let jsonPath2 =
            referenceFolder +
            "/biome-maps/" +
            geoJsonFile;

        let jsonPath = "";


        if (
            await app.vault.adapter.exists(
                jsonPath1
            )
        ) {
            jsonPath =
                jsonPath1;
        }

        else if (
            await app.vault.adapter.exists(
                jsonPath2
            )
        ) {
            jsonPath =
                jsonPath2;
        }


        if (jsonPath) {

            try {

                let jsonText =
                    await app.vault.adapter.read(
                        jsonPath
                    );

                let jsonData =
                    JSON.parse(jsonText);


                for (let group of jsonData) {

                    let amount =
                        Number(group.value);

                    if (
                        !Array.isArray(group.biomes)
                    ) {
                        continue;
                    }

                    for (
                        let biome of group.biomes
                    ) {

                        biomeSupplies.push({
                            biome: biome,
                            amount: amount
                        });
                    }
                }

            } catch (error) {

                new Notice(
                    `⚠️ JSON 解析失敗：${geoJsonFile}`
                );
            }

        } else {

            new Notice(
                `⚠️ 找到 Java GEO，但找不到 ${geoJsonFile}`
            );
        }

    } else {

        new Notice(
            `⚠️ ${itemId} 沒有找到 getBiomeMap JSON`
        );
    }
}


// ====================================
// 6. 世界翻譯
// ====================================
const environmentDict = {
    "normal": "主世界",
    "nether": "地獄",
    "the_end": "終界",
    "end": "終界"
};


// ====================================
// 7. Biome 翻譯 + 所屬世界
// ====================================
const biomeDict = {

    // ----------------------------------
    // 主世界
    // ----------------------------------
    "minecraft:plains": {
        name: "平原",
        environment: "normal"
    },

    "minecraft:sunflower_plains": {
        name: "向日葵平原",
        environment: "normal"
    },

    "minecraft:snowy_plains": {
        name: "雪原",
        environment: "normal"
    },

    "minecraft:ice_spikes": {
        name: "冰刺平原",
        environment: "normal"
    },

    "minecraft:desert": {
        name: "沙漠",
        environment: "normal"
    },

    "minecraft:swamp": {
        name: "沼澤",
        environment: "normal"
    },

    "minecraft:forest": {
        name: "森林",
        environment: "normal"
    },

    "minecraft:flower_forest": {
        name: "繁花森林",
        environment: "normal"
    },

    "minecraft:birch_forest": {
        name: "樺木森林",
        environment: "normal"
    },

    "minecraft:dark_forest": {
        name: "黑森林",
        environment: "normal"
    },

    "minecraft:old_growth_birch_forest": {
        name: "原始樺木森林",
        environment: "normal"
    },

    "minecraft:old_growth_pine_taiga": {
        name: "原始松木針葉林",
        environment: "normal"
    },

    "minecraft:old_growth_spruce_taiga": {
        name: "原始杉木針葉林",
        environment: "normal"
    },

    "minecraft:taiga": {
        name: "針葉林",
        environment: "normal"
    },

    "minecraft:snowy_taiga": {
        name: "雪地針葉林",
        environment: "normal"
    },

    "minecraft:savanna": {
        name: "莽原",
        environment: "normal"
    },

    "minecraft:savanna_plateau": {
        name: "莽原高地",
        environment: "normal"
    },

    "minecraft:windswept_hills": {
        name: "風襲丘陵",
        environment: "normal"
    },

    "minecraft:windswept_gravelly_hills": {
        name: "風襲礫質丘陵",
        environment: "normal"
    },

    "minecraft:windswept_forest": {
        name: "風襲森林",
        environment: "normal"
    },

    "minecraft:windswept_savanna": {
        name: "風襲莽原",
        environment: "normal"
    },

    "minecraft:jungle": {
        name: "叢林",
        environment: "normal"
    },

    "minecraft:sparse_jungle": {
        name: "稀疏叢林",
        environment: "normal"
    },

    "minecraft:bamboo_jungle": {
        name: "竹林",
        environment: "normal"
    },

    "minecraft:badlands": {
        name: "惡地",
        environment: "normal"
    },

    "minecraft:eroded_badlands": {
        name: "侵蝕惡地",
        environment: "normal"
    },

    "minecraft:wooded_badlands": {
        name: "樹林惡地",
        environment: "normal"
    },

    "minecraft:meadow": {
        name: "草甸",
        environment: "normal"
    },

    "minecraft:grove": {
        name: "雪林",
        environment: "normal"
    },

    "minecraft:snowy_slopes": {
        name: "積雪山坡",
        environment: "normal"
    },

    "minecraft:frozen_peaks": {
        name: "冰封山峰",
        environment: "normal"
    },

    "minecraft:jagged_peaks": {
        name: "尖峭山峰",
        environment: "normal"
    },

    "minecraft:stony_peaks": {
        name: "石峰",
        environment: "normal"
    },

    "minecraft:river": {
        name: "河流",
        environment: "normal"
    },

    "minecraft:frozen_river": {
        name: "凍河",
        environment: "normal"
    },

    "minecraft:beach": {
        name: "海灘",
        environment: "normal"
    },

    "minecraft:snowy_beach": {
        name: "積雪沙灘",
        environment: "normal"
    },

    "minecraft:stony_shore": {
        name: "石岸",
        environment: "normal"
    },

    "minecraft:ocean": {
        name: "海洋",
        environment: "normal"
    },

    "minecraft:deep_ocean": {
        name: "深海",
        environment: "normal"
    },

    "minecraft:warm_ocean": {
        name: "溫暖海洋",
        environment: "normal"
    },

    "minecraft:lukewarm_ocean": {
        name: "溫海",
        environment: "normal"
    },

    "minecraft:deep_lukewarm_ocean": {
        name: "溫暖深海",
        environment: "normal"
    },

    "minecraft:cold_ocean": {
        name: "冷海",
        environment: "normal"
    },

    "minecraft:deep_cold_ocean": {
        name: "冷水深海",
        environment: "normal"
    },

    "minecraft:frozen_ocean": {
        name: "凍洋",
        environment: "normal"
    },

    "minecraft:deep_frozen_ocean": {
        name: "冰凍深海",
        environment: "normal"
    },

    "minecraft:mushroom_fields": {
        name: "蘑菇原野",
        environment: "normal"
    },

    "minecraft:dripstone_caves": {
        name: "鐘乳石洞窟",
        environment: "normal"
    },

    "minecraft:lush_caves": {
        name: "蒼鬱洞窟",
        environment: "normal"
    },


    // ----------------------------------
    // 地獄
    // ----------------------------------
    "minecraft:nether_wastes": {
        name: "地獄荒地",
        environment: "nether"
    },

    "minecraft:soul_sand_valley": {
        name: "靈魂砂谷",
        environment: "nether"
    },

    "minecraft:crimson_forest": {
        name: "緋紅森林",
        environment: "nether"
    },

    "minecraft:warped_forest": {
        name: "扭曲森林",
        environment: "nether"
    },

    "minecraft:basalt_deltas": {
        name: "玄武岩三角洲",
        environment: "nether"
    },


    // ----------------------------------
    // 終界
    // ----------------------------------
    "minecraft:the_end": {
        name: "終界",
        environment: "the_end"
    },

    "minecraft:end_highlands": {
        name: "終界高地",
        environment: "the_end"
    },

    "minecraft:end_midlands": {
        name: "終界中地",
        environment: "the_end"
    },

    "minecraft:small_end_islands": {
        name: "終界小島",
        environment: "the_end"
    },

    "minecraft:end_barrens": {
        name: "終界荒地",
        environment: "the_end"
    }
};


// ====================================
// 8. 建立取得方式輸出
// ====================================
let recipeOutput = "";

if (machine) {

    recipeOutput +=
        `- **生產設備**：(Machine${dv} [[${machine}]])\n`;
}


// ------------------------------------
// A. Java + JSON GEO
// biome > supply > deviation
// ------------------------------------
if (
    sourceType === "java" &&
    biomeSupplies.length > 0
) {

    recipeOutput +=
        `\t**每區塊產出**：\n`;

    for (let data of biomeSupplies) {

        let biomeInfo =
            biomeDict[data.biome];

        let biomeName =
            biomeInfo
                ? biomeInfo.name
                : data.biome.replace(
                    "minecraft:",
                    ""
                );

        let environment =
            biomeInfo
                ? biomeInfo.environment
                : javaEnvironment;

        let environmentName =
            environmentDict[environment] ||
            environment ||
            "未知世界";


        recipeOutput +=
            `\t- **${environmentName}**：` +
            `[biome${dv} ${biomeName}] ` +
            `[supply${dv} ${data.amount}]`;


        // 沒有 deviation 就完全不輸出
        if (maxDeviation !== "") {

            recipeOutput +=
                ` ± [deviation${dv} ${maxDeviation}]`;
        }


        recipeOutput += "\n";
    }
}


// ------------------------------------
// B. 舊 YAML GEO
//
// 沒有 biome 資料，所以不輸出 biome。
// supply > deviation
// ------------------------------------
else if (
    sourceType === "yml" &&
    Object.keys(supplies).length > 0
) {

    recipeOutput +=
        `\t**每區塊基礎儲量**：\n`;

    for (let environment in supplies) {

        let amount =
            supplies[environment];

        let environmentName =
            environmentDict[
                environment.toLowerCase()
            ] ||
            environment;


        recipeOutput +=
            `\t- **${environmentName}**：` +
            `[supply${dv} ${amount}]`;


        // 沒有 deviation 就完全不輸出
        if (maxDeviation !== "") {

            recipeOutput +=
                ` ± [deviation${dv} ${maxDeviation}]`;
        }


        recipeOutput += "\n";
    }
}


// ------------------------------------
// C. 都沒解析到
// ------------------------------------
else {

    recipeOutput +=
        `\t- **每區塊基礎儲量**：擷取失敗\n`;
}


// ====================================
// 9. ID / 來源 → 預設資料夾
// ====================================
const folderDict = {
    "HM": "SF-海曼科技院",
    "SF": "SF-黏液科技",
    "SC": "SF-科技院",
    "GN": "SF-基因科技"
};


// ====================================
// 10. 決定建立資料夾
// ====================================
let folders =
    app.vault
        .getAllLoadedFiles()
        .filter(
            f =>
                f instanceof tp.obsidian.TFolder &&
                f.path !== "/"
        );

let folderPaths =
    folders.map(
        f => f.path
    );

let selectedPath = "";


// Slimefun4 原版 Java GEO
// → 直接放 SF-黏液科技
if (sourceType === "java") {

    selectedPath =
        "SF-黏液科技";
}


// Addon YAML
// → 依 ID 前綴判定
else {

    let idPrefix =
        itemId.split("_")[0];

    selectedPath =
        folderDict[idPrefix];
}


// 沒命中，或目標資料夾不存在
// → 手動選
let targetFolder =
    selectedPath
        ? folders.find(
            f => f.path === selectedPath
        )
        : null;


if (!targetFolder) {

    selectedPath =
        await tp.system.suggester(
            folderPaths,
            folderPaths,
            false,
            "請選擇要將此物品創建在哪個資料夾..."
        );

    if (!selectedPath) return;

    targetFolder =
        folders.find(
            f => f.path === selectedPath
        );
}


if (!targetFolder) {

    new Notice(
        `❌ 找不到資料夾：${selectedPath}`
    );

    return;
}


// ====================================
// 11. 建立 GEO BIO
// ====================================
let content = `---
type: sf-GEO
id: ${itemId}
level: ${levelCost}
aliases: ${JSON.stringify([...itemAliases, itemId])}
---

#待補充

# 合成/取得

### 常規
- [[biome ID-中文|生態域對應表]]
${recipeOutput}

> [!note] GEO 供應量
> supply 為每個區塊的基礎供應值；deviation 為相對該值的最大偏差。最大偏差僅供參考

# 用途

- \u200B

# 評價

> [!tip] 使用心得
> **重要度**：
> **是否值得大量開採**：
>
> **簡評**：

# 備註

- \u200B
`;


// ====================================
// 12. 建立檔案
// ====================================
await tp.file.create_new(
    content,
    itemName,
    true,
    targetFolder
);

_%>