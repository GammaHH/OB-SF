// ============================================================
// minecraft:crafting_shapeless
// ============================================================

module.exports = {

    type:
        "minecraft:crafting_shapeless",


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
        // Ingredients
        // ====================================================

        if (
            !Array.isArray(
                json.ingredients
            )
        ) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "ingredients 不是陣列"
                ]
            };
        }


        if (
            json.ingredients.length === 0
        ) {

            return {
                success: false,
                status: "ERROR",

                warnings: [
                    "ingredients 為空"
                ]
            };
        }


        // ====================================================
        // Normalized Ingredients
        // ====================================================

        const rawIngredients = [];


        for (
            let i = 0;
            i < json.ingredients.length;
            i++
        ) {

            const rawIngredient =
                json.ingredients[i];


            const ingredient =
                normalizeSingleIngredient(
                    rawIngredient
                );


            ingredient.qty = 1;


            warnings.push(
                ...collectIngredientWarnings(
                    ingredient,
                    `ingredient[${i}]`
                )
            );


            rawIngredients.push(
                ingredient
            );
        }


        // ====================================================
        // 合併完全相同的普通 Item / Tag
        //
        // 例如：
        //
        // [
        //   "minecraft:string",
        //   "minecraft:string"
        // ]
        //
        // →
        //
        // minecraft:string ×2
        //
        // alternatives 暫時不合併，避免誤判。
        // ====================================================

        const ingredientMap =
            new Map();

        const specialIngredients =
            [];


        for (
            const ingredient
            of rawIngredients
        ) {

            if (
                ingredient.kind === "item" ||
                ingredient.kind === "tag"
            ) {

                const key =
                    `${ingredient.kind}:${ingredient.id}`;


                if (
                    ingredientMap.has(key)
                ) {

                    ingredientMap.get(key).qty +=
                        ingredient.qty;

                } else {

                    ingredientMap.set(
                        key,
                        {
                            ...ingredient
                        }
                    );
                }


                continue;
            }


            // alternatives / unknown
            specialIngredients.push(
                ingredient
            );
        }


        const ingredients = [
            ...ingredientMap.values(),
            ...specialIngredients
        ];


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