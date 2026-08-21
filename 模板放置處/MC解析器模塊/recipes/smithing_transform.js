// ============================================================
// minecraft:smithing_transform
// ============================================================

module.exports = {

    type: "minecraft:smithing_transform",


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


        const slots = [
            ["template", json.template],
            ["base", json.base],
            ["addition", json.addition]
        ];

        const missingSlots =
            slots
                .filter(([, raw]) => raw == null)
                .map(([slot]) => slot);

        if (missingSlots.length > 0) {
            return {
                success: false,
                status: "ERROR",
                warnings: [
                    `smithing_transform 缺少：${missingSlots.join(", ")}`
                ]
            };
        }


        const warnings = [];
        const ingredients =
            slots.map(([slot, raw]) => {

                const ingredient =
                    normalizeSingleIngredient(raw);

                ingredient.qty = 1;

                warnings.push(
                    ...collectIngredientWarnings(
                        ingredient,
                        slot
                    )
                );

                return ingredient;
            });

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
                    ingredientRoles:
                        slots.map(([slot]) => slot),
                    sourceFile
                }
            },
            warnings
        };
    }
};
