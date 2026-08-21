// ============================================================
// OB-SF Minecraft Recipe Parser Registry
// ============================================================

const shared =
    require("./shared");
const tags =
    require("./tags/tag_registry");
const {
    NormalizedItemRegistry
} = require("./normalized/item_registry");
const dependencies = {
    ...require("./dependencies/dependency_resolver"),
    ...require("./dependencies/generation_planner")
};
const bio =
    require("./bio/bio_scanner");
const parsers = [
    require("./recipes/crafting_shaped"),
    require("./recipes/crafting_shapeless"),
    require("./recipes/stonecutting"),
    require("./recipes/smelting"),
    require("./recipes/smithing_transform"),
    require("./recipes/crafting_transmute")
];

const SPECIAL_RECIPE_TYPES = {
    "minecraft:smithing_trim":
        "輸出取決於 base item 與 trim components，沒有固定 result item",
    "minecraft:crafting_dye":
        "輸出會保留並修改 target item components",
    "minecraft:crafting_decorated_pot":
        "輸出 components 由四個陶片位置動態決定",
    "minecraft:crafting_imbue":
        "輸出會複製 source potion components"
};


function getSpecialRecipeReason(type) {

    if (SPECIAL_RECIPE_TYPES[type]) {
        return SPECIAL_RECIPE_TYPES[type];
    }

    if (
        typeof type === "string" &&
        type.startsWith("minecraft:crafting_special_")
    ) {
        return "Minecraft dynamic/special crafting recipe，不適合表示為固定 dependency recipe";
    }

    return null;
}


// ============================================================
// Parser Registry
// ============================================================

const parserRegistry =
    new Map();

for (const parser of parsers) {

    if (
        !parser ||
        !parser.type ||
        typeof parser.parse !== "function"
    ) {
        console.warn(
            "[Minecraft Parser] 無效 Parser：",
            parser
        );

        continue;
    }

    const parserTypes =
        Array.isArray(parser.types)
            ? parser.types
            : [parser.type];


    for (const type of parserTypes) {

        if (parserRegistry.has(type)) {
            console.warn(
                `[Minecraft Parser] Recipe Type 重複註冊：${type}`
            );
        }

        parserRegistry.set(type, parser);
    }
}


// ============================================================
// Main Interface
// ============================================================

function parseRecipe(
    json,
    sourceFile
) {

    const type =
        json?.type ??
        null;

    if (!type) {
        return {
            success: false,
            status: "ERROR",

            warnings: [
                "Recipe 缺少 type"
            ]
        };
    }


    const parser =
        parserRegistry.get(
            type
        );


    // --------------------------------------------------------
    // 尚未支援
    // --------------------------------------------------------

    if (!parser) {

        const specialReason =
            getSpecialRecipeReason(type);

        return {
            success: false,

            status:
                specialReason
                    ? "SPECIAL"
                    : "UNSUPPORTED",

            unsupported:
                specialReason == null,

            special:
                specialReason != null,

            warnings: [
                specialReason ??
                `尚未支援 Recipe Type：${type}`
            ]
        };
    }


    // --------------------------------------------------------
    // Parse
    // --------------------------------------------------------

    try {

        return parser.parse(
            json,
            {
                sourceFile,
                shared
            }
        );

    } catch (err) {

        return {
            success: false,

            status: "ERROR",

            warnings: [
                `Parser Exception：${err.message}`
            ]
        };
    }
}


// ============================================================
// Registry Utilities
// ============================================================

function hasParser(type) {

    return parserRegistry.has(
        type
    );
}


function getSupportedTypes() {

    return Array.from(
        parserRegistry.keys()
    );
}


const pipeline =
    require("./pipeline")
        .createPipelineTools({
            parseRecipe,
            tags
        });


// ============================================================
// Export
// ============================================================

module.exports = {
    parseRecipe,
    hasParser,
    getSupportedTypes,
    getSpecialRecipeReason,
    SPECIAL_RECIPE_TYPES,
    shared,
    tags,
    bio,
    NormalizedItemRegistry,
    dependencies,
    ...pipeline
};
