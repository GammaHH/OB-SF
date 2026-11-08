// ============================================================
// Minecraft Route-aware Base Dependency Planner
// Pure Node.js. Does not alter the Normalized Recipe V1 schema.
//
// Route safety is solved as a monotone fixed point instead of caching every
// active DFS path. This keeps densely connected alternative families (for
// example the 16 recolorable wool variants) bounded.
// ============================================================

function createBaseDependencyPlan(dependencyResult, options = {}) {
    const graph = dependencyResult?.graph;
    if (!(graph instanceof Map)) {
        throw new TypeError("Base Dependency Planner 需要 resolver graph Map");
    }

    const explicitBaseItems = new Set(options.baseItemIds ?? []);
    const selectionPolicy = options.selectionPolicy ?? "none";
    if (!["none", "first-acyclic"].includes(selectionPolicy)) {
        throw new TypeError(`未知 base route selection policy：${selectionPolicy}`);
    }

    function isTerminal(itemId) {
        const node = graph.get(itemId);
        return explicitBaseItems.has(itemId) || !node || node.leaf || node.specialBoundary;
    }

    function ingredientItemIds(ingredient) {
        if (ingredient?.kind === "item") return [ingredient.id];
        if (ingredient?.kind === "tag") {
            return (ingredient.candidates ?? []).map(candidate => candidate.id);
        }
        if (ingredient?.kind === "alternatives") {
            return (ingredient.choices ?? []).flatMap(choice =>
                ingredientItemIds(choice.ingredient)
            );
        }
        return [];
    }

    // --------------------------------------------------------
    // Least fixed point: rank 0 is a terminal/base. Every later
    // rank has at least one recipe whose dependencies already have ranks.
    // --------------------------------------------------------

    function ingredientRankWith(ingredient, ranks) {
        if (ingredient?.kind === "item") {
            return ranks.get(ingredient.id) ?? Infinity;
        }
        if (ingredient?.kind === "tag") {
            const candidateRanks = (ingredient.candidates ?? [])
                .map(candidate => ranks.get(candidate.id) ?? Infinity);
            return candidateRanks.length > 0 ? Math.min(...candidateRanks) : Infinity;
        }
        if (ingredient?.kind === "alternatives") {
            const choiceRanks = (ingredient.choices ?? [])
                .map(choice => ingredientRankWith(choice.ingredient, ranks));
            return choiceRanks.length > 0 ? Math.min(...choiceRanks) : Infinity;
        }
        return Infinity;
    }

    function recipeDependencyRankWith(recipe, ranks) {
        const dependencyRanks = (recipe.ingredients ?? []).map(ingredient =>
            ingredientRankWith(ingredient, ranks)
        );
        if (dependencyRanks.some(rank => !Number.isFinite(rank))) return Infinity;
        return dependencyRanks.length > 0 ? Math.max(...dependencyRanks) : 0;
    }

    function computeRanks(forbiddenItems = new Set()) {
        const ranks = new Map();
        for (const itemId of graph.keys()) {
            if (!forbiddenItems.has(itemId) && isTerminal(itemId)) ranks.set(itemId, 0);
        }
        for (let pass = 0; pass <= graph.size; pass++) {
            let changed = false;
            for (const [itemId, node] of graph) {
                if (forbiddenItems.has(itemId) || ranks.has(itemId)) continue;
                let best = Infinity;
                for (const recipe of node.recipes ?? []) {
                    const dependencyRank = recipeDependencyRankWith(recipe, ranks);
                    if (Number.isFinite(dependencyRank)) {
                        best = Math.min(best, dependencyRank + 1);
                    }
                }
                if (Number.isFinite(best)) {
                    ranks.set(itemId, best);
                    changed = true;
                }
            }
            if (!changed) break;
        }
        return ranks;
    }

    const safeRanks = computeRanks();

    function itemSafe(itemId) {
        return isTerminal(itemId) || safeRanks.has(itemId);
    }

    // --------------------------------------------------------
    // Bounded representative cycles for unsafe SCCs.
    // --------------------------------------------------------

    const unsafeItems = new Set(
        [...graph.keys()].filter(itemId => !itemSafe(itemId))
    );
    const adjacency = new Map();
    for (const itemId of unsafeItems) {
        const node = graph.get(itemId);
        adjacency.set(itemId, [...new Set(
            (node?.recipes ?? []).flatMap(recipe =>
                (recipe.ingredients ?? []).flatMap(ingredientItemIds)
            ).filter(dependencyId => unsafeItems.has(dependencyId))
        )].sort());
    }

    const indexByItem = new Map();
    const lowLink = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    let nextIndex = 0;

    function strongConnect(itemId) {
        indexByItem.set(itemId, nextIndex);
        lowLink.set(itemId, nextIndex);
        nextIndex++;
        stack.push(itemId);
        onStack.add(itemId);

        for (const dependencyId of adjacency.get(itemId) ?? []) {
            if (!indexByItem.has(dependencyId)) {
                strongConnect(dependencyId);
                lowLink.set(itemId, Math.min(
                    lowLink.get(itemId),
                    lowLink.get(dependencyId)
                ));
            } else if (onStack.has(dependencyId)) {
                lowLink.set(itemId, Math.min(
                    lowLink.get(itemId),
                    indexByItem.get(dependencyId)
                ));
            }
        }

        if (lowLink.get(itemId) !== indexByItem.get(itemId)) return;
        const component = [];
        while (stack.length > 0) {
            const value = stack.pop();
            onStack.delete(value);
            component.push(value);
            if (value === itemId) break;
        }
        components.push(component.sort());
    }

    for (const itemId of [...unsafeItems].sort()) {
        if (!indexByItem.has(itemId)) strongConnect(itemId);
    }

    const cyclesByItem = new Map();

    function findCycleThrough(start, members) {
        const allowed = new Set(members);
        const path = [start];
        const visiting = new Set([start]);

        function visit(itemId) {
            for (const dependencyId of adjacency.get(itemId) ?? []) {
                if (!allowed.has(dependencyId)) continue;
                if (dependencyId === start) return [...path, start];
                if (visiting.has(dependencyId)) continue;
                visiting.add(dependencyId);
                path.push(dependencyId);
                const found = visit(dependencyId);
                if (found) return found;
                path.pop();
                visiting.delete(dependencyId);
            }
            return null;
        }

        return visit(start);
    }

    for (const component of components) {
        const cyclic = component.length > 1 ||
            (adjacency.get(component[0]) ?? []).includes(component[0]);
        if (!cyclic) continue;
        for (const itemId of component) {
            const cycle = findCycleThrough(itemId, component);
            if (cycle) cyclesByItem.set(itemId, [cycle]);
        }
    }

    const blockingCycleCache = new Map();

    function uniqueCycles(cycles, limit = 32) {
        const seen = new Set();
        const result = [];
        for (const cycle of cycles) {
            const key = cycle.join("\u0000");
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(cycle);
            if (result.length >= limit) break;
        }
        return result;
    }

    function blockingCyclesForItem(itemId, visiting = new Set()) {
        if (itemSafe(itemId)) return [];
        if (blockingCycleCache.has(itemId)) return blockingCycleCache.get(itemId);
        if (visiting.has(itemId)) return cyclesByItem.get(itemId) ?? [];
        const direct = cyclesByItem.get(itemId);
        if (direct?.length) {
            blockingCycleCache.set(itemId, direct);
            return direct;
        }
        const nextVisiting = new Set(visiting).add(itemId);
        const nested = (adjacency.get(itemId) ?? []).flatMap(dependencyId =>
            blockingCyclesForItem(dependencyId, nextVisiting)
        );
        const result = uniqueCycles(nested);
        blockingCycleCache.set(itemId, result);
        return result;
    }

    function collectCycles(dependency) {
        if (!dependency || typeof dependency !== "object") return [];
        return uniqueCycles([
            ...(dependency.cycles ?? []),
            ...(dependency.choices ?? []).flatMap(collectCycles)
        ]);
    }

    function describeIngredient(ingredient, ranks) {
        if (ingredient?.kind === "item") {
            const safe = ranks.has(ingredient.id);
            const cycles = safe ? [] : blockingCyclesForItem(ingredient.id);
            return {
                kind: "item",
                itemId: ingredient.id,
                qty: ingredient.qty,
                safe,
                cycles,
                blockingCycles: cycles
            };
        }
        if (ingredient?.kind === "tag") {
            const choices = (ingredient.candidates ?? []).map(candidate => ({
                itemId: candidate.id,
                safe: ranks.has(candidate.id),
                cycles: ranks.has(candidate.id) ? [] : blockingCyclesForItem(candidate.id)
            }));
            const safe = choices.some(choice => choice.safe);
            return {
                kind: "tag-choice",
                tagId: ingredient.id,
                qty: ingredient.qty,
                selectionMode: "one",
                safe,
                choices,
                blockingCycles: safe ? [] : uniqueCycles(
                    choices.flatMap(choice => choice.cycles)
                )
            };
        }
        if (ingredient?.kind === "alternatives") {
            const choices = (ingredient.choices ?? []).map(choice =>
                describeIngredient(choice.ingredient, ranks)
            );
            const safe = choices.some(choice => choice.safe);
            return {
                kind: "alternative-choice",
                qty: ingredient.qty,
                selectionMode: "one",
                safe,
                choices,
                blockingCycles: safe ? [] : uniqueCycles(
                    choices.flatMap(collectCycles)
                )
            };
        }
        return { kind: "unknown", safe: false, blockingCycles: [], raw: ingredient ?? null };
    }

    function describeRecipe(recipe, ranks) {
        const dependencies = (recipe.ingredients ?? []).map(ingredient =>
            describeIngredient(ingredient, ranks)
        );
        const safe = dependencies.every(dependency => dependency.safe);
        return {
            safe,
            dependencies,
            blockingCycles: safe ? [] : uniqueCycles(
                dependencies
                    .filter(dependency => !dependency.safe)
                    .flatMap(dependency => dependency.blockingCycles ?? [])
            )
        };
    }

    const baseDependencyMap = new Map();
    for (const [itemId, node] of graph) {
        const ranksWithoutItem = computeRanks(new Set([itemId]));
        const candidateRoutes = (node.recipes ?? []).map(recipe => {
            const analysis = describeRecipe(recipe, ranksWithoutItem);
            return {
                branchId: recipe.branchId,
                recipeIndex: recipe.recipeIndex,
                sourceType: recipe.sourceType,
                output: recipe.output,
                status: analysis.safe ? "ACYCLIC" : "BLOCKED",
                dependencies: analysis.dependencies,
                cycles: analysis.dependencies.flatMap(collectCycles),
                blockingCycles: analysis.blockingCycles
            };
        });
        const acyclicRoutes = candidateRoutes.filter(route => route.status === "ACYCLIC");
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
            status: terminalKind ?? (acyclicRoutes.length > 0 ? "ROUTES_AVAILABLE" : "BLOCKED"),
            safe: terminalKind != null || acyclicRoutes.length > 0,
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

    // --------------------------------------------------------
    // Deterministic preview. Rank always decreases, so preview
    // cannot re-enter a recoloring/conversion SCC.
    // --------------------------------------------------------

    const generationOrder = [];
    const generated = new Set();
    const unresolvedChoices = [];
    const planningCycles = [];

    function choose(values, context, rankOf) {
        if (values.length === 0) return null;
        if (values.length === 1) return values[0];
        if (selectionPolicy === "first-acyclic") {
            return values
                .map((value, index) => ({ value, index, rank: rankOf(value) }))
                .sort((left, right) => left.rank - right.rank || left.index - right.index)[0]
                .value;
        }
        unresolvedChoices.push({ ...context, candidates: values });
        return null;
    }

    function planIngredient(ingredient, activePath, availableRanks) {
        if (ingredient?.kind === "item") return planItem(ingredient.id, activePath);
        if (ingredient?.kind === "tag") {
            const viable = (ingredient.candidates ?? []).filter(candidate =>
                availableRanks.has(candidate.id)
            );
            const selected = choose(
                viable,
                { kind: "tag-choice", tagId: ingredient.id },
                candidate => availableRanks.get(candidate.id) ?? 0
            );
            return selected ? planItem(selected.id, activePath) : false;
        }
        if (ingredient?.kind === "alternatives") {
            const viable = (ingredient.choices ?? []).filter(choice =>
                Number.isFinite(ingredientRankWith(choice.ingredient, availableRanks))
            );
            const selected = choose(
                viable,
                { kind: "alternative-choice" },
                choice => ingredientRankWith(choice.ingredient, availableRanks)
            );
            return selected
                ? planIngredient(selected.ingredient, activePath, availableRanks)
                : false;
        }
        return false;
    }

    function planItem(itemId, activePath = []) {
        if (generated.has(itemId)) return true;
        if (activePath.includes(itemId)) {
            const start = activePath.indexOf(itemId);
            planningCycles.push([...activePath.slice(start), itemId]);
            return false;
        }
        const node = graph.get(itemId);
        if (isTerminal(itemId)) {
            generated.add(itemId);
            generationOrder.push(itemId);
            return true;
        }
        const forbidden = new Set([...activePath, itemId]);
        const availableRanks = computeRanks(forbidden);
        const viable = (node?.recipes ?? []).filter(recipe =>
            Number.isFinite(recipeDependencyRankWith(recipe, availableRanks))
        );
        const selected = choose(
            viable,
            {
                kind: "recipe-choice",
                itemId,
                candidates: viable.map(recipe => recipe.branchId)
            },
            recipe => recipeDependencyRankWith(recipe, availableRanks)
        );
        if (!selected) return false;
        const nextPath = [...activePath, itemId];
        for (const ingredient of selected.ingredients ?? []) {
            if (!planIngredient(ingredient, nextPath, availableRanks)) return false;
        }
        generated.add(itemId);
        generationOrder.push(itemId);
        return true;
    }

    const plannedTargets = (dependencyResult.targets ?? []).filter(itemId => planItem(itemId));

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
        canPlanTargets: plannedTargets.length === (dependencyResult.targets ?? []).length
    };
}

module.exports = { createBaseDependencyPlan };
