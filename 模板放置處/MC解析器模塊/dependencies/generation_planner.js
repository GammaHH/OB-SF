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


    return {
        target:
            dependencyResult.target,
        targets:
            dependencyResult.targets,
        dependencyIds,
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
