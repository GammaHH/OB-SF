// ============================================================
// Minecraft Branch-preserving Recursive Dependency Resolver
// Pure Node.js: no filesystem, Obsidian, or BIO dependencies.
// ============================================================

function uniqueStrings(values) {
    return [...new Set(
        (values ?? []).filter(value =>
            typeof value === "string" && value.length > 0
        )
    )];
}


function resolveDependencyGraph(
    registry,
    targetItemIds,
    options = {}
) {

    if (
        !registry ||
        typeof registry.get !== "function"
    ) {
        throw new TypeError("Dependency Resolver 需要 NormalizedItemRegistry");
    }


    const targets = uniqueStrings(
        Array.isArray(targetItemIds)
            ? targetItemIds
            : [targetItemIds]
    );

    if (targets.length === 0) {
        throw new TypeError("Dependency Resolver 至少需要一個 target item id");
    }


    const maxDepth =
        Number.isFinite(options.maxDepth)
            ? options.maxDepth
            : Infinity;

    const maxNodes =
        Number.isFinite(options.maxNodes)
            ? options.maxNodes
            : Infinity;


    const graph = new Map();
    const state = new Map();
    const activePath = [];
    const leafSet = new Set();
    const cycles = [];
    const warnings = [];
    const recipeBranches = [];
    const tagBranches = [];
    const alternativeBranches = [];


    function addWarning(message) {
        if (!warnings.includes(message)) {
            warnings.push(message);
        }
    }


    function recordCycle(itemId) {

        const start =
            activePath.indexOf(itemId);

        const cycle = [
            ...activePath.slice(start === -1 ? 0 : start),
            itemId
        ];

        const key =
            cycle.join("\u0000");

        if (!cycles.some(existing =>
            existing.join("\u0000") === key
        )) {
            cycles.push(cycle);
            addWarning(`Recipe dependency cycle：${cycle.join(" → ")}`);
        }
    }


    function ensureNode(itemId) {

        if (!graph.has(itemId)) {
            graph.set(itemId, {
                kind: "item",
                id: itemId,
                name: null,
                leaf: false,
                recipes: [],
                warnings: []
            });
        }

        return graph.get(itemId);
    }


    function visitItem(
        itemId,
        depth
    ) {

        const currentState =
            state.get(itemId);

        if (currentState === "visiting") {
            recordCycle(itemId);
            return ensureNode(itemId);
        }

        if (currentState === "done") {
            return graph.get(itemId);
        }

        const node =
            ensureNode(itemId);

        if (graph.size > maxNodes) {
            node.leaf = true;
            leafSet.add(itemId);
            addWarning(`超過 maxNodes=${maxNodes}，停止展開 ${itemId}`);
            state.set(itemId, "done");
            return node;
        }

        if (depth > maxDepth) {
            node.leaf = true;
            leafSet.add(itemId);
            addWarning(`超過 maxDepth=${maxDepth}，停止展開 ${itemId}`);
            state.set(itemId, "done");
            return node;
        }


        state.set(itemId, "visiting");
        activePath.push(itemId);

        const normalizedItem =
            registry.get(itemId);

        node.name =
            normalizedItem?.name ?? null;

        node.warnings =
            [...(normalizedItem?.warnings ?? [])];


        if (
            !normalizedItem ||
            !Array.isArray(normalizedItem.recipes) ||
            normalizedItem.recipes.length === 0
        ) {

            node.leaf = true;
            leafSet.add(itemId);

        } else {

            for (
                let recipeIndex = 0;
                recipeIndex < normalizedItem.recipes.length;
                recipeIndex++
            ) {

                const recipe =
                    normalizedItem.recipes[recipeIndex];

                const recipeBranch = {
                    kind: "recipe",
                    branchId: `${itemId}::recipe:${recipeIndex}`,
                    itemId,
                    recipeIndex,
                    sourceType:
                        recipe.sourceType ?? null,
                    section:
                        recipe.section ?? null,
                    machine:
                        recipe.machine ?? null,
                    output:
                        Number(recipe.output ?? 1),
                    ingredients: [],
                    meta:
                        recipe.meta ?? {}
                };


                recipeBranches.push(recipeBranch);
                node.recipes.push(recipeBranch);


                const ingredients =
                    Array.isArray(recipe.ingredients)
                        ? recipe.ingredients
                        : [];


                for (
                    let ingredientIndex = 0;
                    ingredientIndex < ingredients.length;
                    ingredientIndex++
                ) {
                    recipeBranch.ingredients.push(
                        expandIngredient(
                            ingredients[ingredientIndex],
                            {
                                ownerItemId: itemId,
                                recipeIndex,
                                ingredientIndex,
                                depth: depth + 1
                            }
                        )
                    );
                }
            }
        }


        activePath.pop();
        state.set(itemId, "done");
        return node;
    }


    function expandIngredient(
        ingredient,
        context,
        quantityOverride = null
    ) {

        const quantity =
            Number(
                quantityOverride ??
                ingredient?.qty ??
                1
            );


        if (
            ingredient?.kind === "item" &&
            ingredient.id
        ) {

            visitItem(
                ingredient.id,
                context.depth
            );

            return {
                kind: "item",
                id: ingredient.id,
                qty: quantity
            };
        }


        if (ingredient?.kind === "tag") {

            const values =
                uniqueStrings(ingredient.values);

            const branch = {
                kind: "tag",
                branchId:
                    `${context.ownerItemId}::recipe:${context.recipeIndex}` +
                    `::ingredient:${context.ingredientIndex}::tag:${ingredient.id}`,
                id: ingredient.id ?? null,
                qty: quantity,
                resolved:
                    ingredient.resolved === true,
                candidates:
                    values.map(id => ({
                        kind: "item",
                        id
                    }))
            };


            tagBranches.push(branch);


            if (values.length === 0) {
                addWarning(
                    `${context.ownerItemId} recipe[${context.recipeIndex}] ` +
                    `tag #${ingredient.id ?? "?"} 沒有可用 values`
                );
            }


            for (const itemId of values) {
                visitItem(itemId, context.depth);
            }


            return branch;
        }


        if (
            ingredient?.kind === "alternatives" &&
            Array.isArray(ingredient.alternatives)
        ) {

            const branch = {
                kind: "alternatives",
                branchId:
                    `${context.ownerItemId}::recipe:${context.recipeIndex}` +
                    `::ingredient:${context.ingredientIndex}::alternatives`,
                qty: quantity,
                choices: []
            };


            alternativeBranches.push(branch);


            for (
                let choiceIndex = 0;
                choiceIndex < ingredient.alternatives.length;
                choiceIndex++
            ) {

                const alternative =
                    ingredient.alternatives[choiceIndex];

                const alternativeQty =
                    quantity * Number(alternative?.qty ?? 1);

                branch.choices.push({
                    choiceIndex,
                    ingredient:
                        expandIngredient(
                            alternative,
                            context,
                            alternativeQty
                        )
                });
            }


            if (branch.choices.length === 0) {
                addWarning(
                    `${context.ownerItemId} recipe[${context.recipeIndex}] ` +
                    `alternatives 沒有 choices`
                );
            }


            return branch;
        }


        addWarning(
            `${context.ownerItemId} recipe[${context.recipeIndex}] ` +
            `ingredient[${context.ingredientIndex}] 無法解析`
        );

        return {
            kind: "unknown",
            qty: quantity,
            raw: ingredient ?? null
        };
    }


    for (const target of targets) {
        visitItem(target, 0);
    }


    return {
        target:
            targets.length === 1
                ? targets[0]
                : null,
        targets,
        dependencyTree: {
            kind: "dependency-root",
            targets: targets.map(id => ({
                kind: "item",
                id
            }))
        },
        graph,
        leafMaterials:
            Array.from(leafSet),
        recipeBranches,
        tagBranches,
        alternativeBranches,
        cycles,
        warnings
    };
}


module.exports = {
    resolveDependencyGraph,

    // Public name used by pipeline callers. This resolver never chooses a
    // recipe, tag candidate, or alternative automatically.
    resolveDependencies:
        resolveDependencyGraph
};
