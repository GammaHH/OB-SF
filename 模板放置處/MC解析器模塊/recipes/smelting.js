// ============================================================
// minecraft:smelting
// ============================================================

module.exports = {

    type:
        "minecraft:smelting",


    parse(json, context) {

        const {
            sourceFile,
            shared
        } = context;


        const {
            normalizeResult,
            normalizeSingleIngredient,
            collectIngredientWarnings,
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

        if (
            json.ingredient == null
        ) {

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
                ingredient
            )
        );


        // ====================================================
        // Recipe Info
        // ====================================================

        const info =
            getRecipeTypeInfo(
                module.exports.type
            );


        // ====================================================
        // Output
        // ====================================================

        return {

            success: true,

            status:
                warnings.length > 0
                    ? "REVIEW"
                    : "OK",

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

                    category:
                        json.category ??
                        null,

                    cookingTime:
                        json.cookingtime ??
                        null,

                    experience:
                        json.experience ??
                        null,

                    sourceFile
                }
            },

            warnings
        };
    }
};