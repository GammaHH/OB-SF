// ============================================================
// minecraft:smelting
// ============================================================

module.exports = {

    type:
        "minecraft:smelting",

    types: [
        "minecraft:smelting",
        "minecraft:blasting",
        "minecraft:smoking",
        "minecraft:campfire_cooking"
    ],


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
                json.type
            );


        // ====================================================
        // Output
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
                    json.type,

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
