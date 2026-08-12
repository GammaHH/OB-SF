// ============================================================
// OB-SF Minecraft Parser
// Shared Utilities
// ============================================================


// ------------------------------------------------------------
// Recipe Type → OB-SF 基本資訊
// ------------------------------------------------------------

const RECIPE_TYPE_INFO = {
    "minecraft:crafting_shaped": {
        section: "常規",
        machine: "工作台"
    },

    "minecraft:crafting_shapeless": {
        section: "常規",
        machine: "工作台"
    },

    "minecraft:smelting": {
        section: "熔煉",
        machine: "熔爐"
    },

    "minecraft:blasting": {
        section: "高爐",
        machine: "高爐"
    },

    "minecraft:smoking": {
        section: "煙燻",
        machine: "煙燻爐"
    },

    "minecraft:campfire_cooking": {
        section: "營火",
        machine: "營火"
    },

    "minecraft:stonecutting": {
        section: "切石",
        machine: "切石機"
    }
};


// ============================================================
// Ingredient Normalizer
// ============================================================

function normalizeSingleIngredient(raw) {

    if (raw == null) {
        return {
            kind: "unknown",
            id: null
        };
    }


    // --------------------------------------------------------
    // String
    //
    // minecraft:iron_ingot
    // #minecraft:planks
    // --------------------------------------------------------

    if (typeof raw === "string") {

        if (raw.startsWith("#")) {
            return {
                kind: "tag",
                id: raw.slice(1)
            };
        }

        return {
            kind: "item",
            id: raw
        };
    }


    // --------------------------------------------------------
    // Array = alternatives
    // --------------------------------------------------------

    if (Array.isArray(raw)) {

        return {
            kind: "alternatives",

            alternatives:
                raw.map(
                    normalizeSingleIngredient
                )
        };
    }


    // --------------------------------------------------------
    // Object
    // --------------------------------------------------------

    if (typeof raw === "object") {

        if (raw.item) {
            return {
                kind: "item",
                id: raw.item
            };
        }


        if (raw.tag) {
            return {
                kind: "tag",
                id: raw.tag
            };
        }


        // 某些格式可能直接使用 id
        if (raw.id) {
            return normalizeSingleIngredient(
                raw.id
            );
        }
    }


    return {
        kind: "unknown",
        id: null,
        raw
    };
}


// ============================================================
// Result Normalizer
// ============================================================

function normalizeResult(rawResult) {

    if (!rawResult) {
        return {
            id: null,
            count: 1
        };
    }


    // --------------------------------------------------------
    // 舊式：
    //
    // "minecraft:iron_ingot"
    // --------------------------------------------------------

    if (typeof rawResult === "string") {
        return {
            id: rawResult,
            count: 1
        };
    }


    // --------------------------------------------------------
    // 新式：
    //
    // {
    //     "id": "minecraft:xxx",
    //     "count": 4
    // }
    // --------------------------------------------------------

    if (typeof rawResult === "object") {

        return {
            id:
                rawResult.id ??
                rawResult.item ??
                null,

            count:
                Number(
                    rawResult.count ?? 1
                )
        };
    }


    return {
        id: null,
        count: 1
    };
}


// ============================================================
// Ingredient → Debug / Manifest Text
// ============================================================

function ingredientToText(ingredient) {

    if (!ingredient) {
        return "?";
    }


    if (ingredient.kind === "item") {

        return (
            `${ingredient.id}` +
            ` ×${ingredient.qty ?? 1}`
        );
    }


    if (ingredient.kind === "tag") {

        return (
            `#${ingredient.id}` +
            ` ×${ingredient.qty ?? 1}`
        );
    }


    if (
        ingredient.kind ===
        "alternatives"
    ) {

        const names =
            ingredient.alternatives
                .map(item => {

                    if (item.kind === "tag") {
                        return `#${item.id}`;
                    }

                    if (item.kind === "item") {
                        return item.id;
                    }

                    return "?";
                })
                .join(" / ");


        return (
            `[${names}]` +
            ` ×${ingredient.qty ?? 1}`
        );
    }


    return (
        `? ×${ingredient.qty ?? 1}`
    );
}


// ============================================================
// Ingredient Warning Helper
// ============================================================

function collectIngredientWarnings(
    ingredient,
    label = "ingredient"
) {

    const warnings = [];


    if (
        ingredient.kind ===
        "alternatives"
    ) {

        warnings.push(
            `${label} 含替代材料，需要人工確認`
        );
    }


    if (
        ingredient.kind ===
        "unknown"
    ) {

        warnings.push(
            `${label} 無法解析`
        );
    }


    return warnings;
}


// ============================================================
// Recipe Info
// ============================================================

function getRecipeTypeInfo(type) {

    return (
        RECIPE_TYPE_INFO[type] ??
        null
    );
}


// ============================================================
// Export
// ============================================================

module.exports = {
    RECIPE_TYPE_INFO,

    normalizeSingleIngredient,
    normalizeResult,

    ingredientToText,
    collectIngredientWarnings,

    getRecipeTypeInfo
};