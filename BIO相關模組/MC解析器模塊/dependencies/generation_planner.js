// ============================================================
// Minecraft Dependency Generation Planner
// All branches are included as a union of reachable BIO nodes.
// Quantities and mutually-exclusive branches are never summed.
// ============================================================

function collectIngredientItemIds(ingredient) {

    if (!ingredient) {
        return [];
    }

    if (ingredient.kind === "item") {
        return ingredient.id
            ? [ingredient.id]
            : [];
    }

    if (ingredient.kind === "tag") {
        return (ingredient.candidates ?? [])
            .map(candidate => candidate.id)
            .filter(Boolean);
    }

    if (ingredient.kind === "alternatives") {
        return (ingredient.choices ?? [])
            .flatMap(choice =>
                collectIngredientItemIds(
                    choice.ingredient
                )
            );
    }

    return [];
}


function createGenerationPlan(
    dependencyResult,
    options = {}
) {

    const graph =
        dependencyResult?.graph;

    if (!(graph instanceof Map)) {
        throw new TypeError("Generation Planner 需要 resolver graph Map");
    }


    function buildIngredientPlan(ingredient) {

        if (ingredient?.kind === "item") {
            return {
                kind: "item-dependency",
                qty: ingredient.qty,
                itemId: ingredient.id
            };
        }

        if (ingredient?.kind === "tag") {
            return {
                kind: "tag-choice",
                selectionMode: "one",
                tagId: ingredient.id,
                qty: ingredient.qty,
                choices: (ingredient.candidates ?? []).map(candidate =>
                    ({
                        kind: "item-reference",
                        itemId: candidate.id
                    })
                )
            };
        }

        if (ingredient?.kind === "alternatives") {
            return {
                kind: "alternative-choice",
                selectionMode: "one",
                qty: ingredient.qty,
                choices: (ingredient.choices ?? []).map(choice =>
                    buildIngredientPlan(choice.ingredient)
                )
            };
        }

        return {
            kind: "unknown-dependency",
            ingredient
        };
    }


    function buildItemPlan(itemId) {

        const node = graph.get(itemId);

        if (!node) {
            return {
                kind: "leaf",
                itemId
            };
        }

        return {
            kind: "item-plan",
            itemId,
            leaf: node.leaf === true,
            specialBoundary: node.specialBoundary === true,
            specialRecipes: node.specialRecipes ?? [],
            recipeChoices: (node.recipes ?? []).map(recipe => ({
                kind: "recipe-choice",
                dependencyMode: "all",
                branchId: recipe.branchId,
                sourceType: recipe.sourceType,
                output: recipe.output,
                dependencies: (recipe.ingredients ?? []).map(ingredient =>
                    buildIngredientPlan(ingredient)
                )
            }))
        };
    }


    function planHasChoices(plan) {

        if (!plan || typeof plan !== "object") return false;

        if (
            plan.kind === "tag-choice" ||
            plan.kind === "alternative-choice"
        ) {
            return true;
        }

        if (
            plan.kind === "item-plan" &&
            plan.recipeChoices.length > 1
        ) {
            return true;
        }

        return Object.values(plan).some(value =>
            Array.isArray(value)
                ? value.some(planHasChoices)
                : planHasChoices(value)
        );
    }


    const dependencyIds = new Map();
    const dependents = new Map();


    for (const itemId of graph.keys()) {
        dependencyIds.set(itemId, new Set());
        dependents.set(itemId, new Set());
    }


    for (const [itemId, node] of graph) {

        const dependencies =
            dependencyIds.get(itemId);


        for (const recipe of node.recipes ?? []) {
            for (const ingredient of recipe.ingredients ?? []) {
                for (
                    const dependencyId
                    of collectIngredientItemIds(ingredient)
                ) {
                    if (
                        graph.has(dependencyId)
                    ) {
                        dependencies.add(dependencyId);
                    }
                }
            }
        }


        for (const dependencyId of dependencies) {
            dependents.get(dependencyId).add(itemId);
        }
    }


    const remainingDependencyCount =
        new Map(
            [...dependencyIds].map(
                ([itemId, dependencies]) => [
                    itemId,
                    dependencies.size
                ]
            )
        );

    const queue =
        [...graph.keys()].filter(itemId =>
            remainingDependencyCount.get(itemId) === 0
        );

    const generationOrder = [];


    for (
        let queueIndex = 0;
        queueIndex < queue.length;
        queueIndex++
    ) {

        const itemId =
            queue[queueIndex];

        generationOrder.push(itemId);


        for (const dependentId of dependents.get(itemId)) {

            const remaining =
                remainingDependencyCount.get(dependentId) - 1;

            remainingDependencyCount.set(
                dependentId,
                remaining
            );

            if (remaining === 0) {
                queue.push(dependentId);
            }
        }
    }


    const generatedSet =
        new Set(generationOrder);

    const blockedByCycle =
        [...graph.keys()].filter(itemId =>
            !generatedSet.has(itemId)
        );

    const bioRegistry =
        options.bioRegistry ?? null;

    const existingBIO = [];
    const missingBIO = [];


    for (const itemId of graph.keys()) {

        const bio =
            bioRegistry?.get?.(itemId) ?? null;

        if (bio) {
            existingBIO.push({
                id: itemId,
                path: bio.path,
                legacyId: bio.legacyId,
                name: bio.name
            });
        } else {
            missingBIO.push(itemId);
        }
    }


    const existingSet =
        new Set(existingBIO.map(entry => entry.id));

    const branchPlanGraph =
        new Map(
            [...graph.keys()].map(itemId => [
                itemId,
                buildItemPlan(itemId)
            ])
        );

    const branchPlans =
        dependencyResult.targets.map(itemId =>
            branchPlanGraph.get(itemId) ?? buildItemPlan(itemId)
        );


    return {
        target:
            dependencyResult.target,
        targets:
            dependencyResult.targets,
        dependencyIds,
        branchPlanGraph,
        branchPlans,
        hasChoices:
            [...branchPlanGraph.values()].some(planHasChoices),
        orderMode: "all-branches-coverage",
        generationOrder,
        missingGenerationOrder:
            generationOrder.filter(itemId =>
                !existingSet.has(itemId)
            ),
        existingBIO,
        missingBIO,
        blockedByCycle,
        cycles:
            dependencyResult.cycles ?? [],
        warnings: [
            ...(dependencyResult.warnings ?? []),
            ...(blockedByCycle.length > 0
                ? [
                    `Generation order 被 cycle 阻擋：${blockedByCycle.join(", ")}`
                ]
                : [])
        ],
        canGenerateInOrder:
            blockedByCycle.length === 0
    };
}


module.exports = {
    collectIngredientItemIds,
    createGenerationPlan
};
