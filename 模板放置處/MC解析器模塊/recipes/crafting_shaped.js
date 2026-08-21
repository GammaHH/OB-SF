// ============================================================
// minecraft:crafting_shaped
// ============================================================

module.exports = {

    type:
        "minecraft:crafting_shaped",


    parse(json, context) {

        const {
            sourceFile,
            shared
        } = context;


        const {
            normalizeResult,
            normalizeSingleIngredient,
            collectIngredientWarnings,
            getNormalizedStatus,
            getRecipeTypeInfo
        } = shared;


        const warnings = [];


        // ====================================================
        // Result
        // ====================================================

        const result =
            normalizeResult(
                json.result
            );


        if (!result.id) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "找不到 result.id"
                ]
            };
        }


        // ====================================================
        // Pattern
        // ====================================================

        if (
            !Array.isArray(
                json.pattern
            )
        ) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "pattern 不是陣列"
                ]
            };
        }


        // ====================================================
        // Key
        // ====================================================

        if (
            !json.key ||
            typeof json.key !== "object"
        ) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "找不到 key"
                ]
            };
        }


        // ====================================================
        // 統計 Pattern 中各符號出現次數
        //
        // 例如：
        //
        // "# #"
        // "###"
        //
        // → # = 5
        // ====================================================

        const symbolCount = {};


        for (const row of json.pattern) {

            if (typeof row !== "string") {

                warnings.push(
                    "pattern 中存在非字串資料"
                );

                continue;
            }


            for (const symbol of row) {

                // 空格不代表材料
                if (symbol === " ") {
                    continue;
                }


                symbolCount[symbol] =
                    (
                        symbolCount[symbol] ??
                        0
                    ) + 1;
            }
        }


        // ====================================================
        // Symbol → Ingredient
        // ====================================================

        const ingredients = [];


        for (
            const [symbol, qty]
            of Object.entries(symbolCount)
        ) {

            const rawIngredient =
                json.key[symbol];


            // ------------------------------------------------
            // Pattern 有使用符號，但 Key 沒定義
            // ------------------------------------------------

            if (rawIngredient == null) {

                warnings.push(
                    `pattern 使用符號 "${symbol}"，但 key 中不存在`
                );


                ingredients.push({
                    kind: "unknown",
                    id: null,
                    qty,
                    symbol
                });


                continue;
            }


            // ------------------------------------------------
            // 正規化 Ingredient
            // ------------------------------------------------

            const ingredient =
                normalizeSingleIngredient(
                    rawIngredient
                );


            ingredient.qty = qty;

            // 保留 symbol 方便 Debug
            ingredient.symbol = symbol;


            // ------------------------------------------------
            // Ingredient Warning
            // ------------------------------------------------

            warnings.push(
                ...collectIngredientWarnings(
                    ingredient,
                    `符號 "${symbol}"`
                )
            );


            ingredients.push(
                ingredient
            );
        }


        // ====================================================
        // 檢查 Key 中是否有完全沒被 Pattern 使用的符號
        // ====================================================

        for (
            const symbol
            of Object.keys(json.key)
        ) {

            if (
                symbolCount[symbol] == null
            ) {

                warnings.push(
                    `key 定義符號 "${symbol}"，但 pattern 未使用`
                );
            }
        }


        // ====================================================
        // Recipe Type Info
        // ====================================================

        const info =
            getRecipeTypeInfo(
                module.exports.type
            );


        if (!info) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    `shared.js 找不到 Recipe Type 設定：${module.exports.type}`
                ]
            };
        }


        // ====================================================
        // Normalized Recipe Object
        // ====================================================

        return {

            success: true,

            status:
                getNormalizedStatus(
                    ingredients,
                    warnings
                ),

            resultId:
                result.id,


            recipe: {

                sourceType:
                    module.exports.type,

                section:
                    info.section,

                machine:
                    info.machine,

                output:
                    result.count,

                ingredients,


                meta: {

                    category:
                        json.category ??
                        null,

                    group:
                        json.group ??
                        null,

                    sourceFile
                }
            },

            warnings
        };
    }
};
