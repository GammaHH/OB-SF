// ============================================================
// Route-aware Recipe / Tag / Alternative Ambiguity Review
// Pure Node.js. Does not alter Normalized Recipe Schema V1.
// ============================================================

const crypto = require("node:crypto");
const {
    parseFrontmatter,
    replaceFrontmatter,
    managedSlice
} = require("./base_material_review");

const SCHEMA_VERSION = 1;
const REVIEW_START = "<!-- obsf:recipe-review:start -->";
const REVIEW_END = "<!-- obsf:recipe-review:end -->";
const ACTIVE_START = "<!-- obsf:recipe-review-active:start -->";
const ACTIVE_END = "<!-- obsf:recipe-review-active:end -->";
const GROUP_TYPES = new Set(["recipe", "tag", "alternative"]);

function hashId(prefix, value) {
    const hash = crypto.createHash("sha256")
        .update(typeof value === "string" ? value : JSON.stringify(value))
        .digest("hex")
        .slice(0, 16);
    return `${prefix}-${hash}`;
}

function normalizedIngredient(ingredient) {
    if (ingredient?.kind === "item") {
        return { kind: "item", id: ingredient.id, qty: ingredient.qty };
    }
    if (ingredient?.kind === "tag") {
        return {
            kind: "tag",
            id: ingredient.id,
            qty: ingredient.qty,
            candidates: (ingredient.candidates ?? []).map(candidate => candidate.id)
        };
    }
    if (ingredient?.kind === "alternatives") {
        return {
            kind: "alternatives",
            qty: ingredient.qty,
            choices: (ingredient.choices ?? []).map(choice =>
                normalizedIngredient(choice.ingredient)
            )
        };
    }
    return { kind: ingredient?.kind ?? "unknown" };
}

function identityIngredientSkeleton(ingredient) {
    if (ingredient?.kind === "item") {
        return { kind: "item", id: ingredient.id, qty: ingredient.qty };
    }
    if (ingredient?.kind === "tag") {
        return { kind: "tag", id: ingredient.id, qty: ingredient.qty };
    }
    if (ingredient?.kind === "alternatives") {
        return { kind: "alternatives", qty: ingredient.qty };
    }
    return { kind: ingredient?.kind ?? "unknown" };
}

function recipeIdentity(itemId, recipe) {
    const sourceFile = recipe.meta?.sourceFile ?? null;
    const stableSourceFile =
        sourceFile && !sourceFile.startsWith("<memory:")
            ? sourceFile
            : null;
    return hashId("recipe", {
        itemId,
        stableSourceFile,
        sourceType: recipe.sourceType,
        section: recipe.section,
        machine: recipe.machine,
        output: recipe.output,
        ingredients: stableSourceFile
            ? undefined
            : (recipe.ingredients ?? []).map(identityIngredientSkeleton)
    });
}

function ingredientIdentity(ownerItemId, recipeId, ingredient, duplicateOrdinal) {
    return hashId("ingredient", {
        ownerItemId,
        recipeId,
        ingredient: identityIngredientSkeleton(ingredient),
        duplicateOrdinal
    });
}

function ingredientLabel(ingredient) {
    if (ingredient?.kind === "item") return ingredient.id;
    if (ingredient?.kind === "tag") return `#${ingredient.id}`;
    if (ingredient?.kind === "alternatives") {
        return (ingredient.choices ?? [])
            .map(choice => ingredientLabel(choice.ingredient))
            .join(" OR ");
    }
    return "unknown ingredient";
}

function recipeLabel(recipe) {
    const ingredients = (recipe.ingredients ?? []).map(ingredient => {
        const qty = ingredient.qty ?? 1;
        return `${ingredientLabel(ingredient)} ×${qty}`;
    }).join(" + ") || "no fixed ingredients";
    const sourceFile = recipe.meta?.sourceFile
        ? ` / ${recipe.meta.sourceFile}`
        : "";
    return `${recipe.sourceType ?? "unknown"} / ` +
        `${recipe.machine ?? recipe.section ?? "unknown"} / ` +
        `output ${recipe.output ?? 1} / ${ingredients}${sourceFile}`;
}

function baseSelectionFingerprint(baseItemIds) {
    return `sha256:${crypto.createHash("sha256")
        .update(JSON.stringify([...(baseItemIds ?? [])].sort()))
        .digest("hex")}`;
}

function parseRecipeReviewMarkdown(markdown) {
    const diagnostics = [];
    const groups = new Map();
    const frontmatter = parseFrontmatter(markdown).values;
    const active = managedSlice(markdown, ACTIVE_START, ACTIVE_END);
    if (!active) {
        return {
            frontmatter,
            groups,
            diagnostics: [{
                code: "MISSING_ACTIVE_SECTION",
                severity: "WARNING",
                message: "找不到 Recipe Review active managed section；視為尚未產生 selection"
            }]
        };
    }

    const groupPattern = /<!-- obsf:ambiguity:start ([^\s>]+) (recipe|tag|alternative) -->([\s\S]*?)<!-- obsf:ambiguity:end \1 -->/g;
    const declaredGroups = active.content.match(/<!-- obsf:ambiguity:start /g)?.length ?? 0;
    let recognizedGroups = 0;
    for (const match of active.content.matchAll(groupPattern)) {
        recognizedGroups++;
        const groupId = match[1];
        const type = match[2];
        const body = match[3];
        if (groups.has(groupId)) {
            diagnostics.push({
                code: "DUPLICATE_GROUP",
                severity: "ERROR",
                message: `Ambiguity group 重複：${groupId}`,
                groupId
            });
            continue;
        }
        const candidates = [];
        const seen = new Set();
        const allCheckboxes = body.match(/^- \[[ xX]\].*$/gm) ?? [];
        const choicePattern = /^- \[([ xX])\] `([^`]+)` <!-- obsf:choice-id:([^\s>]+) -->[^\r\n]*$/gm;
        let recognized = 0;
        for (const choice of body.matchAll(choicePattern)) {
            recognized++;
            const candidateId = choice[3];
            if (choice[2] !== candidateId) {
                diagnostics.push({
                    code: "CANDIDATE_ID_MISMATCH",
                    severity: "ERROR",
                    message: `顯示 candidate ${choice[2]} 與穩定 ID ${candidateId} 不一致`,
                    groupId,
                    candidateId
                });
            }
            if (seen.has(candidateId)) {
                diagnostics.push({
                    code: "DUPLICATE_CANDIDATE",
                    severity: "ERROR",
                    message: `Ambiguity candidate 重複：${candidateId}`,
                    groupId,
                    candidateId
                });
            }
            seen.add(candidateId);
            candidates.push({
                candidateId,
                checked: choice[1].toLowerCase() === "x",
                label: choice[0].split(" -->")[1]?.replace(/^\s*[—-]\s*/, "") ?? ""
            });
        }
        if (recognized !== allCheckboxes.length) {
            diagnostics.push({
                code: "INVALID_SELECTION",
                severity: "ERROR",
                message: `Group ${groupId} 有 ${allCheckboxes.length - recognized} 個格式不合法的 Checkbox`,
                groupId
            });
        }
        const checked = candidates.filter(candidate => candidate.checked);
        if (checked.length > 1) {
            diagnostics.push({
                code: "MULTIPLE_SELECTED",
                severity: "ERROR",
                message: `Group ${groupId} 必須 exactly one，但勾選了 ${checked.length} 個`,
                groupId
            });
        }
        const notes = body.match(/<!-- obsf:notes:start -->([\s\S]*?)<!-- obsf:notes:end -->/);
        groups.set(groupId, {
            groupId,
            type,
            candidates,
            checkedCandidateIds: checked.map(candidate => candidate.candidateId),
            notes: notes?.[1]?.replace(/\r?\n[ \t]*$/, "\n") ??
                "\n<!-- 在此輸入人工備註 -->\n"
        });
    }
    if (recognizedGroups !== declaredGroups) {
        diagnostics.push({
            code: "INVALID_SELECTION",
            severity: "ERROR",
            message: `有 ${declaredGroups - recognizedGroups} 個 malformed ambiguity group markers`
        });
    }
    return { frontmatter, groups, diagnostics };
}

function extractAllExistingGroupStates(markdown) {
    const result = new Map(parseRecipeReviewMarkdown(markdown).groups);
    const review = managedSlice(markdown, REVIEW_START, REVIEW_END);
    if (!review) return result;
    const inactivePattern = /<!-- obsf:inactive-ambiguity:start ([^\s>]+) (recipe|tag|alternative) -->([\s\S]*?)<!-- obsf:inactive-ambiguity:end \1 -->/g;
    for (const match of review.content.matchAll(inactivePattern)) {
        if (result.has(match[1])) continue;
        const candidates = [];
        const choicePattern = /^> - \[([ xX])\] `([^`]+)` <!-- obsf:inactive-choice-id:([^\s>]+) -->[^\r\n]*$/gm;
        for (const choice of match[3].matchAll(choicePattern)) {
            candidates.push({
                candidateId: choice[3],
                checked: choice[1].toLowerCase() === "x",
                label: choice[0].split(" -->")[1]?.replace(/^\s*[—-]\s*/, "") ?? ""
            });
        }
        const notes = match[3].match(/<!-- obsf:notes:start -->([\s\S]*?)<!-- obsf:notes:end -->/);
        result.set(match[1], {
            groupId: match[1],
            type: match[2],
            inactive: true,
            candidates,
            checkedCandidateIds: candidates
                .filter(candidate => candidate.checked)
                .map(candidate => candidate.candidateId),
            notes: notes?.[1]?.replace(/\r?\n[ \t]*$/, "\n") ??
                "\n<!-- 在此輸入人工備註 -->\n"
        });
    }
    return result;
}

function createRecipeAmbiguityAnalysis(
    dependencyResult,
    basePlan,
    parsedReview = { groups: new Map(), diagnostics: [], frontmatter: {} },
    options = {}
) {
    const graph = dependencyResult?.graph;
    if (!(graph instanceof Map)) {
        throw new TypeError("Recipe Review 需要 resolver graph Map");
    }
    if (!(basePlan?.baseDependencyMap instanceof Map)) {
        throw new TypeError("Recipe Review 需要 Base Dependency Map");
    }

    const target = dependencyResult.target ?? dependencyResult.targets?.[0] ?? null;
    const sourceFingerprint = options.sourceFingerprint ?? null;
    const selectedBaseItemIds = [...(options.baseItemIds ?? [])];
    const diagnostics = [...(parsedReview.diagnostics ?? [])];
    const groups = [];
    const activeGroupIds = new Set();
    const unresolvedGroupIds = [];
    const invalidGroupIds = new Set();
    const activeBlockedItems = new Set();
    const planningCycles = [];
    const generationOrder = [];
    const generated = new Set();

    if (
        parsedReview.frontmatter?.sourceFingerprint &&
        sourceFingerprint &&
        parsedReview.frontmatter.sourceFingerprint !== sourceFingerprint
    ) {
        diagnostics.push({
            code: "STALE_FINGERPRINT",
            severity: "WARNING",
            message: "Normalized Registry fingerprint 已變更；所有 active selections 已重新驗證"
        });
    }
    const currentBaseSelectionFingerprint =
        baseSelectionFingerprint(selectedBaseItemIds);
    if (
        parsedReview.frontmatter?.baseSelectionFingerprint &&
        parsedReview.frontmatter.baseSelectionFingerprint !==
            currentBaseSelectionFingerprint
    ) {
        diagnostics.push({
            code: "BASE_SELECTION_FINGERPRINT_CHANGED",
            severity: "WARNING",
            message: "Base Material selections 已變更；active route 與 ambiguities 已重新計算"
        });
    }

    function entrySafe(itemId) {
        return basePlan.baseDependencyMap.get(itemId)?.safe ?? true;
    }

    function ingredientCanResolve(ingredient) {
        if (ingredient?.kind === "item") return entrySafe(ingredient.id);
        if (ingredient?.kind === "tag") {
            return (ingredient.candidates ?? []).some(candidate => entrySafe(candidate.id));
        }
        if (ingredient?.kind === "alternatives") {
            return (ingredient.choices ?? []).some(choice =>
                ingredientCanResolve(choice.ingredient)
            );
        }
        return false;
    }

    function registerGroup(group) {
        activeGroupIds.add(group.groupId);
        const state = parsedReview.groups?.get(group.groupId) ?? null;
        const currentIds = new Set(group.candidates.map(candidate => candidate.candidateId));
        const checked = state?.checkedCandidateIds ?? [];
        group.selectedCandidateId = null;
        group.status = "UNRESOLVED";

        if (state) {
            for (const candidate of state.candidates ?? []) {
                if (!currentIds.has(candidate.candidateId)) {
                    diagnostics.push({
                        code: "STALE_CANDIDATE",
                        severity: "WARNING",
                        message: `Candidate 已不存在或不再合法：${candidate.candidateId}`,
                        groupId: group.groupId,
                        candidateId: candidate.candidateId
                    });
                }
            }
        }
        if (checked.length > 1) {
            group.status = "INVALID";
            invalidGroupIds.add(group.groupId);
        } else if (checked.length === 1 && !currentIds.has(checked[0])) {
            diagnostics.push({
                code: group.type === "recipe"
                    ? "RECIPE_NO_LONGER_EXISTS"
                    : group.type === "tag"
                        ? "TAG_VALUE_NO_LONGER_EXISTS"
                        : "ALTERNATIVE_NO_LONGER_EXISTS",
                severity: "ERROR",
                message: `已選 candidate 不再存在：${checked[0]}`,
                groupId: group.groupId,
                candidateId: checked[0]
            });
            group.status = "INVALID";
            invalidGroupIds.add(group.groupId);
        } else if (checked.length === 1) {
            group.selectedCandidateId = checked[0];
            group.status = "RESOLVED";
        } else {
            diagnostics.push({
                code: "MISSING_SELECTION",
                severity: "INFO",
                message: `Ambiguity group 尚未選擇：${group.groupId}`,
                groupId: group.groupId
            });
            unresolvedGroupIds.push(group.groupId);
        }
        groups.push(group);
        return group.selectedCandidateId;
    }

    function viableRecipes(itemId, node) {
        const routeByBranch = new Map(
            (basePlan.baseDependencyMap.get(itemId)?.candidateRoutes ?? [])
                .map(route => [route.branchId, route])
        );
        return (node.recipes ?? []).filter(recipe =>
            routeByBranch.get(recipe.branchId)?.status === "ACYCLIC"
        );
    }

    function walkIngredient(ingredient, context, activePath) {
        if (ingredient?.kind === "item") {
            return walkItem(ingredient.id, activePath);
        }
        if (ingredient?.kind === "tag") {
            const viable = (ingredient.candidates ?? [])
                .filter(candidate => entrySafe(candidate.id));
            if (viable.length === 0) {
                activeBlockedItems.add(context.ownerItemId);
                return false;
            }
            let selected = viable[0];
            if (viable.length > 1) {
                const groupId = hashId("tag", {
                    ownerItemId: context.ownerItemId,
                    recipeId: context.recipeId,
                    ingredientId: context.ingredientId,
                    tagId: ingredient.id
                });
                const group = {
                    groupId,
                    type: "tag",
                    ownerItemId: context.ownerItemId,
                    recipeId: context.recipeId,
                    ingredientId: context.ingredientId,
                    title: `#${ingredient.id} ×${ingredient.qty ?? 1}`,
                    candidates: viable.map(candidate => ({
                        candidateId: candidate.id,
                        label: candidate.id,
                        itemId: candidate.id
                    }))
                };
                const selectedId = registerGroup(group);
                if (!selectedId) return false;
                selected = viable.find(candidate => candidate.id === selectedId);
            }
            return walkItem(selected.id, activePath);
        }
        if (ingredient?.kind === "alternatives") {
            const viable = [];
            const occurrences = new Map();
            for (const choice of ingredient.choices ?? []) {
                if (!ingredientCanResolve(choice.ingredient)) continue;
                const normalized = JSON.stringify(normalizedIngredient(choice.ingredient));
                const ordinal = occurrences.get(normalized) ?? 0;
                occurrences.set(normalized, ordinal + 1);
                viable.push({
                    choice,
                    candidateId: hashId("alternative", {
                        ingredient: normalizedIngredient(choice.ingredient),
                        duplicateOrdinal: ordinal
                    })
                });
            }
            if (viable.length === 0) {
                activeBlockedItems.add(context.ownerItemId);
                return false;
            }
            let selected = viable[0];
            if (viable.length > 1) {
                const groupId = hashId("alternative", {
                    ownerItemId: context.ownerItemId,
                    recipeId: context.recipeId,
                    ingredientId: context.ingredientId
                });
                const group = {
                    groupId,
                    type: "alternative",
                    ownerItemId: context.ownerItemId,
                    recipeId: context.recipeId,
                    ingredientId: context.ingredientId,
                    title: "Ingredient Alternative",
                    candidates: viable.map(candidate => ({
                        candidateId: candidate.candidateId,
                        label: ingredientLabel(candidate.choice.ingredient),
                        ingredient: candidate.choice.ingredient
                    }))
                };
                const selectedId = registerGroup(group);
                if (!selectedId) return false;
                selected = viable.find(candidate => candidate.candidateId === selectedId);
            }
            return walkIngredient(
                selected.choice.ingredient,
                {
                    ...context,
                    ingredientId: `${context.ingredientId}/${selected.candidateId}`
                },
                activePath
            );
        }
        activeBlockedItems.add(context.ownerItemId);
        return false;
    }

    function walkRecipe(itemId, recipe, activePath) {
        const recipeId = recipeIdentity(itemId, recipe);
        const occurrences = new Map();
        let complete = true;
        for (const ingredient of recipe.ingredients ?? []) {
            const normalized = JSON.stringify(normalizedIngredient(ingredient));
            const ordinal = occurrences.get(normalized) ?? 0;
            occurrences.set(normalized, ordinal + 1);
            const identity = ingredientIdentity(itemId, recipeId, ingredient, ordinal);
            if (!walkIngredient(
                ingredient,
                { ownerItemId: itemId, recipeId, ingredientId: identity },
                activePath
            )) complete = false;
        }
        return complete;
    }

    function walkItem(itemId, activePath = []) {
        if (generated.has(itemId)) return true;
        if (activePath.includes(itemId)) {
            const start = activePath.indexOf(itemId);
            const cycle = [...activePath.slice(start), itemId];
            if (!planningCycles.some(existing => existing.join("\u0000") === cycle.join("\u0000"))) {
                planningCycles.push(cycle);
            }
            activeBlockedItems.add(itemId);
            return false;
        }
        const node = graph.get(itemId);
        const entry = basePlan.baseDependencyMap.get(itemId);
        if (!node || entry?.terminalKind || node.leaf || node.specialBoundary) {
            generated.add(itemId);
            generationOrder.push(itemId);
            return true;
        }
        const viable = viableRecipes(itemId, node);
        if (viable.length === 0) {
            activeBlockedItems.add(itemId);
            return false;
        }
        let selected = viable[0];
        if (viable.length > 1) {
            const candidates = viable.map(recipe => ({
                candidateId: recipeIdentity(itemId, recipe),
                label: recipeLabel(recipe),
                recipe
            }));
            const groupId = hashId("recipe-group", { itemId });
            const selectedId = registerGroup({
                groupId,
                type: "recipe",
                ownerItemId: itemId,
                title: itemId,
                candidates
            });
            if (!selectedId) return false;
            selected = candidates.find(candidate => candidate.candidateId === selectedId).recipe;
        }
        const nextPath = [...activePath, itemId];
        if (!walkRecipe(itemId, selected, nextPath)) return false;
        generated.add(itemId);
        generationOrder.push(itemId);
        return true;
    }

    const targetComplete = target ? walkItem(target) : false;
    for (const [groupId] of parsedReview.groups ?? []) {
        if (activeGroupIds.has(groupId)) continue;
        diagnostics.push({
            code: "CANDIDATE_NO_LONGER_ON_ACTIVE_ROUTE",
            severity: "WARNING",
            message: `Ambiguity group 已不在目前 active route：${groupId}`,
            groupId
        });
    }

    const invalidSelections = diagnostics.filter(entry =>
        entry.severity === "ERROR"
    ).length;
    const readiness = {
        readyForBioGeneration:
            targetComplete &&
            activeBlockedItems.size === 0 &&
            unresolvedGroupIds.length === 0 &&
            invalidSelections === 0 &&
            planningCycles.length === 0,
        blocked: activeBlockedItems.size,
        unresolvedAmbiguities: unresolvedGroupIds.length,
        invalidSelections,
        planningCycles: planningCycles.length
    };

    return {
        schemaVersion: SCHEMA_VERSION,
        target,
        sourceFingerprint,
        baseSelectionFingerprint: currentBaseSelectionFingerprint,
        baseItemIds: selectedBaseItemIds,
        groups,
        activeGroupIds,
        inactiveGroupIds: [...(parsedReview.groups?.keys?.() ?? [])]
            .filter(groupId => !activeGroupIds.has(groupId)),
        unresolvedGroupIds,
        invalidGroupIds: [...invalidGroupIds],
        activeBlockedItems: [...activeBlockedItems],
        planningCycles,
        generationOrder,
        diagnostics,
        readiness
    };
}

function renderGroup(group, state) {
    const existing = new Map(
        (state?.candidates ?? []).map(candidate => [candidate.candidateId, candidate])
    );
    const reusableExisting = state?.inactive ? new Map() : existing;
    const current = new Map(group.candidates.map(candidate => [candidate.candidateId, candidate]));
    const ordered = [];
    for (const candidate of state?.inactive ? [] : state?.candidates ?? []) {
        if (current.has(candidate.candidateId)) ordered.push(current.get(candidate.candidateId));
    }
    for (const candidate of group.candidates) {
        if (!ordered.some(value => value.candidateId === candidate.candidateId)) ordered.push(candidate);
    }
    const stale = state?.inactive
        ? [...existing.values()]
        : [...existing.values()].filter(candidate => !current.has(candidate.candidateId));
    const lines = [
        `<!-- obsf:ambiguity:start ${group.groupId} ${group.type} -->`,
        `### ${group.title}`,
        "",
        `- Group ID: \`${group.groupId}\``,
        `- Type: \`${group.type}\``,
        ""
    ];
    for (const candidate of ordered) {
        const checked = reusableExisting.get(candidate.candidateId)?.checked ? "x" : " ";
        lines.push(
            `- [${checked}] \`${candidate.candidateId}\` <!-- obsf:choice-id:${candidate.candidateId} --> — ${candidate.label}`
        );
    }
    if (stale.length > 0) {
        lines.push("", "#### 過期 choices（不會套用）", "");
        for (const candidate of stale) {
            lines.push(
                `> - [${candidate.checked ? "x" : " "}] \`${candidate.candidateId}\` <!-- obsf:stale-choice-id:${candidate.candidateId} --> — ${candidate.label}`
            );
        }
    }
    const notes = state?.notes ?? "\n<!-- 在此輸入人工備註 -->\n";
    lines.push(
        "",
        "<!-- obsf:notes:start -->" + notes + "<!-- obsf:notes:end -->",
        `<!-- obsf:ambiguity:end ${group.groupId} -->`
    );
    return lines.join("\n");
}

function renderInactiveGroup(groupId, state) {
    const lines = [
        `<!-- obsf:inactive-ambiguity:start ${groupId} ${state.type} -->`,
        `### \`${groupId}\` — inactive / stale`,
        "",
        "> 此 group 已不在目前 active route，selection 不會套用。",
        ""
    ];
    for (const candidate of state.candidates ?? []) {
        lines.push(
            `> - [${candidate.checked ? "x" : " "}] \`${candidate.candidateId}\` <!-- obsf:inactive-choice-id:${candidate.candidateId} --> — ${candidate.label}`
        );
    }
    lines.push(
        "<!-- obsf:notes:start -->" + (state.notes ?? "\n") + "<!-- obsf:notes:end -->",
        `<!-- obsf:inactive-ambiguity:end ${groupId} -->`
    );
    return lines.join("\n");
}

function renderRecipeReview(analysis, existingMarkdown = "") {
    const existingStates = extractAllExistingGroupStates(existingMarkdown);
    const activeByType = new Map([
        ["recipe", []],
        ["tag", []],
        ["alternative", []]
    ]);
    for (const group of analysis.groups) activeByType.get(group.type).push(group);
    const headings = {
        recipe: "Multiple Recipe Selection",
        tag: "Tag Selection",
        alternative: "Ingredient Alternative Selection"
    };
    const lines = [
        REVIEW_START,
        "# Minecraft Recipe Review",
        "",
        `- Target: \`${analysis.target}\``,
        `- Source Fingerprint: \`${analysis.sourceFingerprint}\``,
        `- Base Selection Fingerprint: \`${analysis.baseSelectionFingerprint}\``,
        "",
        ACTIVE_START
    ];
    for (const type of ["recipe", "tag", "alternative"]) {
        lines.push("", `## ${headings[type]}`, "");
        const groups = activeByType.get(type);
        if (groups.length === 0) lines.push("- 無 active ambiguity");
        for (const group of groups) {
            lines.push(renderGroup(group, existingStates.get(group.groupId)), "");
        }
    }
    lines.push(ACTIVE_END, "", "## Readiness", "", "```json", JSON.stringify(analysis.readiness, null, 2), "```");
    lines.push("", "## Diagnostics", "");
    if (analysis.diagnostics.length === 0) lines.push("- 無");
    else for (const diagnostic of analysis.diagnostics) {
        lines.push(
            `- **${diagnostic.severity} ${diagnostic.code}** — ${diagnostic.message}`
        );
    }
    lines.push("", "## Route-aware BLOCKED", "");
    if (analysis.activeBlockedItems.length === 0) lines.push("- 無");
    else for (const itemId of analysis.activeBlockedItems) lines.push(`- \`${itemId}\``);
    lines.push("", "## Planning Cycles", "");
    if (analysis.planningCycles.length === 0) lines.push("- 無");
    else for (const cycle of analysis.planningCycles) {
        lines.push(`- ${cycle.map(id => `\`${id}\``).join(" → ")}`);
    }

    const inactive = [...existingStates.entries()]
        .filter(([groupId]) => !analysis.activeGroupIds.has(groupId))
        .sort(([left], [right]) => left.localeCompare(right));
    if (inactive.length > 0) {
        lines.push("", "## Inactive / Stale Ambiguities（需重新審核）", "");
        for (const [groupId, state] of inactive) {
            lines.push(renderInactiveGroup(groupId, state), "");
        }
    }
    lines.push(REVIEW_END);
    const managed = lines.join("\n");
    const old = managedSlice(existingMarkdown, REVIEW_START, REVIEW_END);
    let merged;
    if (old) {
        merged = String(existingMarkdown).slice(0, old.start) + managed +
            String(existingMarkdown).slice(old.end);
    } else {
        const suffix = existingMarkdown && !String(existingMarkdown).endsWith("\n") ? "\n" : "";
        merged = `${existingMarkdown ?? ""}${suffix}${existingMarkdown ? "\n" : ""}${managed}\n`;
    }
    return replaceFrontmatter(merged, {
        type: "minecraft-recipe-review",
        schemaVersion: analysis.schemaVersion,
        target: analysis.target,
        sourceFingerprint: analysis.sourceFingerprint,
        baseSelectionFingerprint: analysis.baseSelectionFingerprint
    });
}

module.exports = {
    SCHEMA_VERSION,
    REVIEW_START,
    REVIEW_END,
    ACTIVE_START,
    ACTIVE_END,
    GROUP_TYPES,
    recipeIdentity,
    ingredientIdentity,
    recipeLabel,
    baseSelectionFingerprint,
    parseRecipeReviewMarkdown,
    createRecipeAmbiguityAnalysis,
    renderRecipeReview
};
