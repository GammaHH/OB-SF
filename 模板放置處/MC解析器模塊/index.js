// ============================================================
// OB-SF Minecraft Recipe Parser Registry
// ============================================================

const shared =
    require("./shared");
const tags =
    require("./tags/tag_registry");
const parsers = [
    require("./recipes/crafting_shaped"),
    require("./recipes/crafting_shapeless"),
    require("./recipes/stonecutting"),
    require("./recipes/smelting")
];


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

    if (
        parserRegistry.has(
            parser.type
        )
    ) {
        console.warn(
            `[Minecraft Parser] Recipe Type 重複註冊：${parser.type}`
        );
    }

    parserRegistry.set(
        parser.type,
        parser
    );
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

        return {
            success: false,

            status: "REVIEW",

            unsupported: true,

            warnings: [
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


// ============================================================
// Export
// ============================================================

module.exports = {
    parseRecipe,
    hasParser,
    getSupportedTypes,
    shared,
    tags
};