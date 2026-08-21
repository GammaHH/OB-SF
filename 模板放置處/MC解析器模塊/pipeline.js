// ============================================================
// Minecraft Vanilla in-memory Pipeline
// ============================================================

const {
    NormalizedItemRegistry
} = require("./normalized/item_registry");

const {
    resolveDependencies
} = require("./dependencies/dependency_resolver");

const {
    createGenerationPlan
} = require("./dependencies/generation_planner");


function createPipelineTools({
    parseRecipe,
    tags
}) {

    if (typeof parseRecipe !== "function") {
        throw new TypeError("Pipeline 需要 parseRecipe function");
    }


    function normalizeRecipeEntries(
        recipeEntries = [],
        options = {}
    ) {

        const registry =
            options.registry ??
            new NormalizedItemRegistry({
                nameResolver:
                    options.nameResolver
            });

        const tagRegistry =
            options.tagRegistry ??
            tags.createRegistry();

        const diagnostics = [];
        const recipeStatusesByItem = new Map();

        const statusKeys = [
            "OK",
            "OK_BRANCH",
            "UNSUPPORTED",
            "SPECIAL",
            "REVIEW",
            "ERROR"
        ];

        const stats = {
            inputRecipes:
                recipeEntries.length,
            normalizedRecipes: 0,
            normalizedItems: 0,
            ok: 0,
            review: 0,
            errors: 0,
            unsupported: 0,
            special: 0,
            statusCounts:
                Object.fromEntries(
                    statusKeys.map(status => [status, 0])
                ),
            itemStatusCounts:
                Object.fromEntries(
                    statusKeys.map(status => [status, 0])
                )
        };


        for (
            let index = 0;
            index < recipeEntries.length;
            index++
        ) {

            const entry =
                recipeEntries[index];

            const wrapped =
                entry &&
                typeof entry === "object" &&
                Object.hasOwn(entry, "json");

            const json =
                wrapped
                    ? entry.json
                    : entry;

            const sourceFile =
                wrapped
                    ? entry.sourceFile
                    : `<memory:recipe:${index}>`;


            const parsed =
                parseRecipe(
                    json,
                    sourceFile
                );


            if (!parsed.success) {

                if (stats.statusCounts[parsed.status] != null) {
                    stats.statusCounts[parsed.status]++;
                }

                stats.errors +=
                    parsed.status === "ERROR"
                        ? 1
                        : 0;

                stats.review +=
                    parsed.status === "REVIEW"
                        ? 1
                        : 0;

                stats.unsupported +=
                    parsed.unsupported
                        ? 1
                        : 0;

                stats.special +=
                    parsed.special
                        ? 1
                        : 0;

                diagnostics.push({
                    sourceFile,
                    status: parsed.status,
                    unsupported:
                        parsed.unsupported === true,
                    special:
                        parsed.special === true,
                    warnings:
                        parsed.warnings ?? []
                });

                continue;
            }


            const tagResolution =
                tags.resolveIngredients(
                    parsed.recipe.ingredients,
                    tagRegistry,
                    "item"
                );

            const warnings = [
                ...(parsed.warnings ?? []),
                ...tagResolution.warnings
            ];

            const status =
                warnings.length > 0
                    ? "REVIEW"
                    : parsed.status;

            const recipe = {
                ...parsed.recipe,
                ingredients:
                    tagResolution.ingredients
            };


            registry.addRecipe(
                parsed.resultId,
                recipe,
                warnings
            );

            if (!recipeStatusesByItem.has(parsed.resultId)) {
                recipeStatusesByItem.set(parsed.resultId, []);
            }

            recipeStatusesByItem.get(parsed.resultId).push(status);


            stats.normalizedRecipes++;
            stats.ok += status === "OK" ? 1 : 0;
            stats.review += status === "REVIEW" ? 1 : 0;

            if (stats.statusCounts[status] != null) {
                stats.statusCounts[status]++;
            }


            if (warnings.length > 0) {
                diagnostics.push({
                    sourceFile,
                    resultId:
                        parsed.resultId,
                    status,
                    warnings
                });
            }
        }


        stats.normalizedItems =
            registry.size;


        const itemStatuses = new Map();

        for (const [itemId, item] of registry.entries()) {

            const recipeStatuses =
                recipeStatusesByItem.get(itemId) ?? [];

            const itemStatus =
                item.warnings.length > 0 ||
                recipeStatuses.includes("REVIEW")
                    ? "REVIEW"
                    : item.recipes.length > 1 ||
                        recipeStatuses.includes("OK_BRANCH")
                        ? "OK_BRANCH"
                        : "OK";

            itemStatuses.set(itemId, itemStatus);
            stats.itemStatusCounts[itemStatus]++;
        }


        return {
            registry,
            itemStatuses,
            diagnostics,
            stats
        };
    }


    function createVanillaPipeline(options = {}) {

        const tagRegistry =
            options.tagRegistry ??
            tags.buildRegistryFromEntries(
                options.tagEntries ?? []
            );

        const normalized =
            normalizeRecipeEntries(
                options.recipeEntries ?? [],
                {
                    tagRegistry,
                    nameResolver:
                        options.nameResolver
                }
            );


        return {
            tagRegistry,
            itemRegistry:
                normalized.registry,
            itemStatuses:
                normalized.itemStatuses,
            diagnostics: [
                ...tagRegistry.errors,
                ...tagRegistry.warnings,
                ...normalized.diagnostics
            ],
            stats: {
                tags:
                    tagRegistry.stats,
                recipes:
                    normalized.stats
            },
            resolveDependencies(
                rootItemIds,
                resolverOptions = {}
            ) {
                return resolveDependencies(
                    normalized.registry,
                    rootItemIds,
                    resolverOptions
                );
            },
            createGenerationPlan(
                dependencyResult,
                plannerOptions = {}
            ) {
                return createGenerationPlan(
                    dependencyResult,
                    plannerOptions
                );
            },
            planGeneration(
                rootItemIds,
                options = {}
            ) {

                const dependencyResult =
                    resolveDependencies(
                        normalized.registry,
                        rootItemIds,
                        options.resolverOptions ?? {}
                    );


                return {
                    dependencyResult,
                    generationPlan:
                        createGenerationPlan(
                            dependencyResult,
                            {
                                bioRegistry:
                                    options.bioRegistry ?? null
                            }
                        )
                };
            }
        };
    }


    return {
        normalizeRecipeEntries,
        createVanillaPipeline
    };
}


module.exports = {
    createPipelineTools
};
