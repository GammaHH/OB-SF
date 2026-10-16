// ============================================================
// Minecraft Route-aware Base Dependency Planner
// Pure Node.js. Does not alter the Normalized Recipe V1 schema.
// ============================================================

function createBaseDependencyPlan(dependencyResult, options = {}) {

    const graph = dependencyResult?.graph;

    if (!(graph instanceof Map)) {
        throw new TypeError("Base Dependency Planner 需要 resolver graph Map");
    }

    const explicitBaseItems = new Set(options.baseItemIds ?? []);

    const analysisCache = new Map();

    function cyclePath(itemId, activePath) {
        const start = activePath.indexOf(itemId);
        return [
            ...activePath.slice(start === -1 ? 0 : start),
            itemId
        ];
    }

    function analyzeIngredient(ingredient, activePath) {

        if (ingredient?.kind === "item") {
            const item = analyzeItem(ingredient.id, activePath);
            return {
                kind: "item",
                itemId: ingredient.id,
                qty: ingredient.qty,
                safe: item.safe,
                cycles: item.cycles
            };
        }

        if (ingredient?.kind === "tag") {
            const choices = (ingredient.candidates ?? []).map(candidate => {
                const item = analyzeItem(candidate.id, activePath);
                return {
                    itemId: candidate.id,
                    safe: item.safe,
                    cycles: item.cycles
                };
            });
            return {
                kind: "tag-choice",
                tagId: ingredient.id,
                qty: ingredient.qty,
                selectionMode: "one",
                safe: choices.some(choice => choice.safe),
                choices
            };
        }

        if (ingredient?.kind === "alternatives") {
            const choices = (ingredient.choices ?? []).map(choice =>
                analyzeIngredient(choice.ingredient, activePath)
            );
            return {
                kind: "alternative-choice",
                qty: ingredient.qty,
                selectionMode: "one",
                safe: choices.some(choice => choice.safe),
                choices
            };
        }

        return {
            kind: "unknown",
            safe: false,
            raw: ingredient ?? null
        };
    }

    function analyzeRecipe(recipe, activePath) {
        const dependencies = (recipe.ingredients ?? []).map(ingredient =>
            analyzeIngredient(ingredient, activePath)
        );
        return {
            safe: dependencies.every(dependency => dependency.safe),
            dependencies
        };
    }

    function analyzeItem(itemId, activePath = []) {

        if (activePath.includes(itemId)) {
            return {
                safe: false,
                terminal: false,
                cycles: [cyclePath(itemId, activePath)]
            };
        }

        const cacheKey = `${itemId}\u0000${activePath.join("\u0000")}`;
        if (analysisCache.has(cacheKey)) return analysisCache.get(cacheKey);

        const node = graph.get(itemId);
        if (
            explicitBaseItems.has(itemId) ||
            !node ||
            node.leaf ||
            node.specialBoundary
        ) {
            const result = {
                safe: true,
                terminal: true,
                cycles: []
            };
            analysisCache.set(cacheKey, result);
            return result;
        }

        const nextPath = [...activePath, itemId];
        const routes = (node.recipes ?? []).map(recipe => {
            const analysis = analyzeRecipe(recipe, nextPath);
            return { recipe, ...analysis };
        });
        const cycles = routes.flatMap(route =>
            route.dependencies.flatMap(dependency => collectCycles(dependency))
        );
        const result = {
            safe: routes.some(route => route.safe),
            terminal: false,
            cycles,
            routes
        };
        analysisCache.set(cacheKey, result);
        return result;
    }

    function collectCycles(dependency) {
        if (!dependency || typeof dependency !== "object") return [];
        const own = dependency.cycles ?? [];
        const nested = (dependency.choices ?? []).flatMap(collectCycles);
        return [...own, ...nested];
    }

    const baseDependencyMap = new Map();

    for (const [itemId, node] of graph) {
        const rootAnalysis = analyzeItem(itemId);
        const candidateRoutes = (node.recipes ?? []).map(recipe => {
            const analysis = analyzeRecipe(recipe, [itemId]);
            return {
                branchId: recipe.branchId,
                recipeIndex: recipe.recipeIndex,
                sourceType: recipe.sourceType,
                output: recipe.output,
                status: analysis.safe ? "ACYCLIC" : "BLOCKED",
                dependencies: analysis.dependencies,
                cycles: analysis.dependencies.flatMap(collectCycles)
            };
        });
        const acyclicRoutes = candidateRoutes.filter(route =>
            route.status === "ACYCLIC"
        );
        const terminalKind = explicitBaseItems.has(itemId)
            ? "EXPLICIT_BASE"
            : node.specialBoundary
            ? "SPECIAL_BOUNDARY"
            : node.leaf
                ? "LEAF"
                : null;

        baseDependencyMap.set(itemId, {
            kind: "base-dependency-item",
            itemId,
            status: terminalKind ??
                (acyclicRoutes.length > 0 ? "ROUTES_AVAILABLE" : "BLOCKED"),
            safe: terminalKind != null || rootAnalysis.safe,
            terminalKind,
            candidateRoutes,
            acyclicRouteIds: acyclicRoutes.map(route => route.branchId),
            blockedRouteIds: candidateRoutes
                .filter(route => route.status === "BLOCKED")
                .map(route => route.branchId)
        });
    }

    const routeAwareBlockedItems = [...baseDependencyMap.values()]
        .filter(entry => !entry.safe)
        .map(entry => entry.itemId);
    const legacyBlocked = options.legacyBlockedByCycle ?? [];
    const blockedSet = new Set(routeAwareBlockedItems);
    const resolvedFromLegacyCycles = legacyBlocked.filter(itemId =>
        graph.has(itemId) && !blockedSet.has(itemId)
    );

    const selectionPolicy = options.selectionPolicy ?? "none";
    if (!["none", "first-acyclic"].includes(selectionPolicy)) {
        throw new TypeError(`未知 base route selection policy：${selectionPolicy}`);
    }

    const generationOrder = [];
    const generated = new Set();
    const unresolvedChoices = [];
    const planningCycles = [];

    function choose(values, context) {
        if (values.length === 0) return null;
        if (values.length === 1 || selectionPolicy === "first-acyclic") {
            return values[0];
        }
        unresolvedChoices.push({ ...context, candidates: values });
        return null;
    }

    function planIngredient(ingredient, activePath) {
        if (ingredient?.kind === "item") {
            return planItem(ingredient.id, activePath);
        }
        if (ingredient?.kind === "tag") {
            const viable = (ingredient.candidates ?? [])
                .filter(candidate => analyzeItem(candidate.id, activePath).safe);
            const selected = choose(viable, {
                kind: "tag-choice",
                tagId: ingredient.id
            });
            return selected ? planItem(selected.id, activePath) : false;
        }
        if (ingredient?.kind === "alternatives") {
            const viable = (ingredient.choices ?? [])
                .filter(choice => analyzeIngredient(choice.ingredient, activePath).safe);
            const selected = choose(viable, { kind: "alternative-choice" });
            return selected
                ? planIngredient(selected.ingredient, activePath)
                : false;
        }
        return false;
    }

    function planItem(itemId, activePath = []) {
        if (generated.has(itemId)) return true;
        if (activePath.includes(itemId)) {
            planningCycles.push(cyclePath(itemId, activePath));
            return false;
        }
        const node = graph.get(itemId);
        if (
            explicitBaseItems.has(itemId) ||
            !node ||
            node.leaf ||
            node.specialBoundary
        ) {
            generated.add(itemId);
            generationOrder.push(itemId);
            return true;
        }
        const nextPath = [...activePath, itemId];
        const viable = (node.recipes ?? []).filter(recipe =>
            analyzeRecipe(recipe, nextPath).safe
        );
        const selected = choose(viable, {
            kind: "recipe-choice",
            itemId,
            candidates: viable.map(recipe => recipe.branchId)
        });
        if (!selected) return false;
        for (const ingredient of selected.ingredients ?? []) {
            if (!planIngredient(ingredient, nextPath)) return false;
        }
        generated.add(itemId);
        generationOrder.push(itemId);
        return true;
    }

    const plannedTargets = (dependencyResult.targets ?? []).filter(itemId =>
        planItem(itemId)
    );

    return {
        target: dependencyResult.target,
        targets: dependencyResult.targets,
        baseDependencyMap,
        routeAwareBlockedItems,
        resolvedFromLegacyCycles,
        explicitBaseItems: [...explicitBaseItems],
        selectionPolicy,
        generationOrder,
        plannedTargets,
        unresolvedChoices,
        planningCycles,
        canPlanTargets:
            plannedTargets.length === (dependencyResult.targets ?? []).length
    };
}

module.exports = {
    createBaseDependencyPlan
};
