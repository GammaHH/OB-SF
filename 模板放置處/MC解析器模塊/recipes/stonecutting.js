// ============================================================
// minecraft:stonecutting
// ============================================================

module.exports = {

    type:
        "minecraft:stonecutting",


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
        // Ingredient
        // ====================================================

        if (json.ingredient == null) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "找不到 ingredient"
                ]
            };
        }


        const ingredient =
            normalizeSingleIngredient(
                json.ingredient
            );


        ingredient.qty = 1;


        warnings.push(
            ...collectIngredientWarnings(
                ingredient,
                "ingredient"
            )
        );


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
                    [ingredient],
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

                ingredients: [
                    ingredient
                ],


                meta: {

                    sourceFile
                }
            },

            warnings
        };
    }
};
