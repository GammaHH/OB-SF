// ============================================================
// minecraft:crafting_transmute
// A normal dependency recipe whose input components are copied to result.
// ============================================================

module.exports = {

    type: "minecraft:crafting_transmute",


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

        const result =
            normalizeResult(json.result);

        if (!result.id) {
            return {
                success: false,
                status: "ERROR",
                warnings: ["找不到 result.id"]
            };
        }


        if (
            json.input == null ||
            json.material == null
        ) {
            return {
                success: false,
                status: "ERROR",
                warnings: [
                    "crafting_transmute 缺少 input 或 material"
                ]
            };
        }


        const warnings = [];
        const ingredients = [
            normalizeSingleIngredient(json.input),
            normalizeSingleIngredient(json.material)
        ];

        for (
            let index = 0;
            index < ingredients.length;
            index++
        ) {
            ingredients[index].qty = 1;
            warnings.push(
                ...collectIngredientWarnings(
                    ingredients[index],
                    index === 0
                        ? "input"
                        : "material"
                )
            );
        }


        const info =
            getRecipeTypeInfo(module.exports.type);


        return {
            success: true,
            status:
                getNormalizedStatus(
                    ingredients,
                    warnings
                ),
            resultId: result.id,
            recipe: {
                sourceType: module.exports.type,
                section: info.section,
                machine: info.machine,
                output: result.count,
                ingredients,
                meta: {
                    category: json.category ?? null,
                    group: json.group ?? null,
                    ingredientRoles: ["input", "material"],
                    copiesInputComponents: true,
                    sourceFile
                }
            },
            warnings
        };
    }
};
