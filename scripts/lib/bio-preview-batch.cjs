// Pure merge of already analysed READY targets. Does not load data or write BIOs.
function describeDependencies(dependencies) {
    return JSON.stringify(dependencies.slice(0, 10)) + (dependencies.length > 10 ? `（共 ${dependencies.length} 項）` : "");
}

function normalizedDependencies(records) {
    if (!Array.isArray(records)) throw new Error("BATCH_GENERATION_DEPENDENCIES_REQUIRED：缺少選定配方的 generationDependencies 清單；請使用新版分析結果");
    const result = new Map();
    for (const record of records) {
        if (!record || typeof record.itemId !== "string" || !record.itemId.trim() || !Array.isArray(record.dependencies) ||
            record.dependencies.some(id => typeof id !== "string" || !id.trim())) {
            throw new Error(`BATCH_INVALID_GENERATION_DEPENDENCIES：${record?.itemId ?? "missing itemId"} 的依賴記錄格式不完整`);
        }
        const dependencies = [...new Set(record.dependencies)].sort();
        const previous = result.get(record.itemId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(dependencies)) {
            throw new Error(`BATCH_DEPENDENCY_SELECTION_CONFLICT：${record.itemId}；${describeDependencies(previous)} 與 ${describeDependencies(dependencies)}`);
        }
        result.set(record.itemId, dependencies);
    }
    return result;
}

function validateOrder(order) {
    if (!Array.isArray(order) || order.some(id => typeof id !== "string" || !id.trim()) || new Set(order).size !== order.length) {
        throw new Error("BATCH_INVALID_GENERATION_ORDER：生成序列含重複／無效項目或不是清單");
    }
}

function mergeGenerationOrders(orders, dependencyRecords = []) {
    if (!Array.isArray(orders)) throw new Error("BATCH_INVALID_GENERATION_ORDER：缺少生成序列清單");
    const rank = new Map(), edges = new Map(), incoming = new Map();
    for (const order of orders) {
        validateOrder(order);
        for (const id of order) {
            if (!rank.has(id)) { rank.set(id, rank.size); edges.set(id, new Set()); incoming.set(id, 0); }
        }
    }
    // A target's traversal order is a tie-breaker, not a dependency edge.
    // Only the selected walk's explicit dependencies constrain this batch.
    for (const [itemId, dependencies] of normalizedDependencies(dependencyRecords)) {
        if (!rank.has(itemId)) throw new Error(`BATCH_DEPENDENCY_ENDPOINT_MISSING：依賴擁有者 ${itemId} 不在生成清單`);
        for (const dependency of dependencies) {
            if (!rank.has(dependency)) throw new Error(`BATCH_DEPENDENCY_ENDPOINT_MISSING：${dependency} → ${itemId} 的材料端點不在生成清單`);
            if (!edges.get(dependency).has(itemId)) {
                edges.get(dependency).add(itemId); incoming.set(itemId, incoming.get(itemId) + 1);
            }
        }
    }
    const ready = [...rank.keys()].filter(id => incoming.get(id) === 0);
    const merged = [];
    while (ready.length) {
        ready.sort((left, right) => rank.get(left) - rank.get(right));
        const id = ready.shift(); merged.push(id);
        for (const after of edges.get(id)) {
            incoming.set(after, incoming.get(after) - 1);
            if (incoming.get(after) === 0) ready.push(after);
        }
    }
    if (merged.length !== rank.size) {
        const remaining = [...rank.keys()].filter(id => incoming.get(id) > 0);
        throw new Error(`BATCH_DEPENDENCY_CYCLE：選定配方依賴存在循環；未排序項目 ${remaining.slice(0, 10).join("、")}${remaining.length > 10 ? `（共 ${remaining.length} 項）` : ""}`);
    }
    return merged;
}

function mergeBIOPreviewContexts(contexts) {
    if (!Array.isArray(contexts) || !contexts.length) throw new Error("BATCH_TARGETS_REQUIRED：至少需要一個 target");
    for (const context of contexts) if (!context.analysis?.readiness?.readyForBioGeneration) {
        const readiness = context.analysis?.readiness || {};
        const counts = ["unresolvedAmbiguities", "blocked", "invalidSelections", "planningCycles"]
            .map(key => `${key}=${readiness[key] ?? "unknown"}`).join(", ");
        const unresolved = new Set(context.analysis?.unresolvedGroupIds || []);
        const groups = (context.analysis?.groups || []).filter(group => unresolved.has(group.groupId) || group.status !== "RESOLVED")
            .map(group => `${group.type} ${group.tagId || group.title || group.subject || group.label || group.ownerItemId || group.groupId}（${group.groupId}）`).slice(0, 10);
        const diagnostics = (context.analysis?.diagnostics || []).filter(value => value.severity === "ERROR").map(value => value.code).slice(0, 10);
        throw new Error(`BATCH_TARGET_NOT_READY：${context.target}；${counts}` +
            (groups.length ? `；未決策：${groups.join("、")}` : "") + (diagnostics.length ? `；診斷：${diagnostics.join("、")}` : ""));
    }
    const first = contexts[0], groups = new Map(), preferred = new Map();
    const graph = new Map(), baseDependencyMap = new Map(), baseState = new Map(), baseItemIds = new Set();
    const selectedDependencies = new Map();
    for (const context of contexts) {
        if (!first.fingerprint || context.fingerprint !== first.fingerprint) throw new Error("BATCH_SOURCE_FINGERPRINT_MISMATCH：來源 snapshot 不一致");
        if (context.machineMappingSHA256 !== first.machineMappingSHA256) throw new Error("BATCH_MACHINE_MAPPING_MISMATCH：Machine Mapping snapshot 不一致");
        validateOrder(context.analysis.generationOrder);
        const orderIds = new Set(context.analysis.generationOrder);
        const localDependencies = normalizedDependencies(context.analysis.generationDependencies);
        for (const id of orderIds) if (!localDependencies.has(id)) {
            throw new Error(`BATCH_GENERATION_DEPENDENCIES_INCOMPLETE：${context.target} 的 ${id} 缺少選定依賴記錄`);
        }
        for (const [itemId, dependencies] of localDependencies) {
            if (!orderIds.has(itemId)) throw new Error(`BATCH_DEPENDENCY_ENDPOINT_MISSING：${context.target} 的依賴擁有者 ${itemId} 不在該 target 生成清單`);
            for (const dependency of dependencies) if (!orderIds.has(dependency)) {
                throw new Error(`BATCH_DEPENDENCY_ENDPOINT_MISSING：${context.target} 的 ${dependency} → ${itemId} 缺少材料端點`);
            }
            const previous = selectedDependencies.get(itemId);
            if (previous && JSON.stringify(previous) !== JSON.stringify(dependencies)) {
                throw new Error(`BATCH_DEPENDENCY_SELECTION_CONFLICT：${itemId}；${describeDependencies(previous)} 與 ${describeDependencies(dependencies)}`);
            }
            selectedDependencies.set(itemId, dependencies);
        }
        for (const id of context.baseItemIds ?? []) baseItemIds.add(id);
        for (const id of context.analysis.generationOrder ?? []) {
            const base = (context.baseItemIds ?? []).includes(id);
            if (baseState.has(id) && baseState.get(id) !== base) throw new Error(`BATCH_BASE_DECISION_CONFLICT：${id}`);
            baseState.set(id, base);
        }
        for (const group of context.analysis.groups ?? []) {
            const identity = `${group.type}:${group.groupId}`;
            const previous = groups.get(identity);
            if (previous && previous.selectedCandidateId !== group.selectedCandidateId) throw new Error(`BATCH_DECISION_CONFLICT：${identity}`);
            if (!previous) groups.set(identity, group);
        }
        for (const [id, route] of context.preferredRecipeByItem ?? []) {
            if (preferred.has(id) && preferred.get(id) !== route) throw new Error(`BATCH_PREFERRED_ROUTE_CONFLICT：${id}`);
            preferred.set(id, route);
        }
        for (const [id, entry] of context.dependency?.graph ?? []) if (!graph.has(id)) graph.set(id, entry);
        for (const [id, entry] of context.basePlan?.baseDependencyMap ?? []) if (!baseDependencyMap.has(id)) baseDependencyMap.set(id, entry);
    }
    const generationDependencies = [...selectedDependencies].map(([itemId, dependencies]) => ({ itemId, dependencies }));
    const generationOrder = mergeGenerationOrders(contexts.map(context => context.analysis.generationOrder), generationDependencies);
    return {
        ...first,
        targets: [...new Set(contexts.map(context => context.target))],
        baseItemIds: [...baseItemIds], preferredRecipeByItem: preferred,
        dependency: { ...first.dependency, graph },
        basePlan: { ...first.basePlan, baseDependencyMap },
        analysis: { ...first.analysis, groups: [...groups.values()], generationOrder,
            generationDependencies: generationOrder.map(itemId => ({ itemId, dependencies: [...selectedDependencies.get(itemId)] })) }
    };
}

module.exports = { mergeGenerationOrders, mergeBIOPreviewContexts };
