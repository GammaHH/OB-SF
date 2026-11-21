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
const RECIPE_LOCKED_START = "<!-- obsf:recipe-review-locked:start -->";
const RECIPE_LOCKED_END = "<!-- obsf:recipe-review-locked:end -->";
const GROUP_TYPES = new Set(["recipe", "tag", "alternative"]);
const EXTERNAL_BASE_PREFIX = "external-base:";
const MINECRAFT_COLOR_PREFIXES = [
    "black", "blue", "brown", "cyan", "gray", "green", "light_blue",
    "light_gray", "lime", "magenta", "orange", "pink", "purple", "red",
    "white", "yellow"
];

function minecraftColorFamily(itemId) {
    const match = String(itemId ?? "").match(/^minecraft:([a-z0-9_]+)$/);
    if (!match) return null;
    for (const color of MINECRAFT_COLOR_PREFIXES) {
        const prefix = `${color}_`;
        if (match[1].startsWith(prefix) && match[1].length > prefix.length) {
            return match[1].slice(prefix.length);
        }
    }
    return null;
}

function alternativePreferenceKey(group) {
    if (group?.type !== "alternative" || group.candidates?.length < 2) return null;
    const ownerFamily = minecraftColorFamily(group.ownerItemId);
    if (ownerFamily) {
        const candidateFamilies = group.candidates.map(candidate =>
            candidate.ingredient?.kind === "item"
                ? minecraftColorFamily(candidate.ingredient.id)
                : null
        );
        if (candidateFamilies.every(family => family === ownerFamily)) {
            return `minecraft-color-family:${ownerFamily}`;
        }
    }
    const candidateSet = group.candidates
        .map(candidate => normalizedIngredient(candidate.ingredient))
        .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))
        );
    return hashId("alternative-set", candidateSet);
}

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
    const stewEffects = recipe.meta?.resultComponents?.[
        "minecraft:suspicious_stew_effects"
    ];
    const effects = Array.isArray(stewEffects) && stewEffects.length > 0
        ? ` / effects ${stewEffects.map(effect =>
            `${effect.id ?? "unknown"} (duration ${effect.duration ?? "unknown"})`
        ).join(", ")}`
        : "";
    const sourceFile = recipe.meta?.sourceFile
        ? ` / ${recipe.meta.sourceFile}`
        : "";
    return `${recipe.sourceType ?? "unknown"} / ` +
        `${recipe.machine ?? recipe.section ?? "unknown"} / ` +
        `output ${recipe.output ?? 1} / ${ingredients}${effects}${sourceFile}`;
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
    const locked = managedSlice(markdown, RECIPE_LOCKED_START, RECIPE_LOCKED_END);
    if (!active) diagnostics.push({
        code: "MISSING_ACTIVE_SECTION",
        severity: "WARNING",
        message: "找不到 Recipe Review active managed section；視為尚未產生 selection"
    });

    const groupPattern = /<!-- obsf:ambiguity:start ([^\s>]+) (recipe|tag|alternative) -->([\s\S]*?)<!-- obsf:ambiguity:end \1 -->/g;
    const activeContent = active?.content ?? "";
    const declaredGroups = activeContent.match(/<!-- obsf:ambiguity:start /g)?.length ?? 0;
    let recognizedGroups = 0;
    for (const match of activeContent.matchAll(groupPattern)) {
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
        const subject = body.match(/^- Subject: `([^`]+)`$/m)?.[1] ?? null;
        groups.set(groupId, {
            groupId,
            type,
            candidates,
            checkedCandidateIds: checked.map(candidate => candidate.candidateId),
            tagId: type === "tag" ? subject?.replace(/^#/, "") ?? null : null,
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

    const lockedPattern = /<!-- obsf:locked-ambiguity:start ([^\s>]+) (recipe|tag|alternative) ([^\s>]+) -->([\s\S]*?)<!-- obsf:locked-ambiguity:end \1 -->/g;
    for (const match of (locked?.content ?? "").matchAll(lockedPattern)) {
        const groupId = match[1];
        const type = match[2];
        const candidateId = match[3];
        const body = match[4];
        if (groups.has(groupId)) {
            diagnostics.push({
                code: "DUPLICATE_GROUP",
                severity: "ERROR",
                message: `Ambiguity group 同時出現在 active 與 locked：${groupId}`,
                groupId
            });
            continue;
        }
        const label = body.match(/^- Selected: `[^`]+` — (.*)$/m)?.[1] ?? "";
        const subject = body.match(/^- Subject: `([^`]+)`$/m)?.[1] ?? null;
        const notes = body.match(/<!-- obsf:notes:start -->([\s\S]*?)<!-- obsf:notes:end -->/);
        groups.set(groupId, {
            groupId,
            type,
            locked: true,
            candidates: [{ candidateId, checked: true, label }],
            checkedCandidateIds: [candidateId],
            tagId: type === "tag" ? subject?.replace(/^#/, "") ?? null : null,
            notes: notes?.[1]?.replace(/\r?\n[ \t]*$/, "\n") ??
                "\n<!-- 在此輸入人工備註 -->\n"
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
    const registeredGroups = new Map();
    const activeGroupIds = new Set();
    const unresolvedGroupIds = [];
    const invalidGroupIds = new Set();
    const activeBlockedItems = new Set();
    const planningCycles = [];
    const generationOrder = [];
    const generationDependencies = new Map();
    const generated = new Set();
    const tagMappings = options.tagMappings instanceof Map
        ? options.tagMappings
        : new Map(Object.entries(options.tagMappings ?? {}));
    const globalAmbiguitySelections = options.globalAmbiguitySelections instanceof Map
        ? options.globalAmbiguitySelections
        : new Map(Object.entries(options.globalAmbiguitySelections ?? {}));
    const globalAlternativePreferences = options.globalAlternativePreferences instanceof Map
        ? options.globalAlternativePreferences
        : new Map(Object.entries(options.globalAlternativePreferences ?? {}));
    const requestedExternalBaseItemIds = new Set();
    const requestedTagMappings = new Map();
    const appliedTagMappings = new Map();
    const appliedGlobalAmbiguityDecisions = new Map();
    const appliedGlobalAlternativePreferences = new Map();
    diagnostics.push(...(options.tagMappingDiagnostics ?? []));
    diagnostics.push(...(options.globalDecisionDiagnostics ?? []));

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
        if (registeredGroups.has(group.groupId)) {
            return registeredGroups.get(group.groupId).selectedCandidateId;
        }
        activeGroupIds.add(group.groupId);
        const state = parsedReview.groups?.get(group.groupId) ?? null;
        const exactGlobalDecision = globalAmbiguitySelections.get(group.groupId) ?? null;
        const familyPreference = !exactGlobalDecision && group.preferenceKey
            ? globalAlternativePreferences.get(group.preferenceKey) ?? null
            : null;
        let globalDecision = exactGlobalDecision ?? familyPreference;
        const globalSelectionSource = exactGlobalDecision
            ? "GLOBAL_DECISION_REGISTRY"
            : familyPreference
                ? "GLOBAL_ALTERNATIVE_PREFERENCE"
                : null;
        const currentIds = new Set(group.candidates.map(candidate => candidate.candidateId));
        let checked = [...(state?.checkedCandidateIds ?? [])];
        let globalConflict = false;
        group.selectedCandidateId = null;
        group.status = "UNRESOLVED";

        if (familyPreference && !currentIds.has(familyPreference.candidateId)) {
            diagnostics.push({
                code: "GLOBAL_ALTERNATIVE_PREFERENCE_UNAVAILABLE",
                severity: "INFO",
                message: `Global alternative preference ${group.preferenceKey} 的候選目前不可用，保留人工選擇`,
                groupId: group.groupId,
                preferenceKey: group.preferenceKey
            });
            globalDecision = null;
        }
        if (globalDecision) {
            if (globalDecision.type !== group.type) {
                diagnostics.push({
                    code: "GLOBAL_AMBIGUITY_TYPE_CONFLICT",
                    severity: "ERROR",
                    message: `Global decision type 不相容：${group.groupId}`,
                    groupId: group.groupId
                });
                globalConflict = true;
            } else if (checked.length === 1 &&
                checked[0] !== globalDecision.candidateId) {
                diagnostics.push({
                    code: "GLOBAL_AMBIGUITY_SELECTION_CONFLICT",
                    severity: "ERROR",
                    message: `目前 selection ${checked[0]} 與既有 global locked decision ${globalDecision.candidateId} 衝突`,
                    groupId: group.groupId
                });
                globalConflict = true;
            } else if (checked.length === 0) {
                checked = [globalDecision.candidateId];
            }
            group.selectionSource = globalSelectionSource;
        }

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
        if (checked.length > 1 || globalConflict) {
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
            if (globalDecision) {
                appliedGlobalAmbiguityDecisions.set(
                    group.groupId,
                    globalDecision.candidateId
                );
                if (familyPreference) {
                    appliedGlobalAlternativePreferences.set(
                        group.preferenceKey,
                        globalDecision.candidateId
                    );
                }
            }
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
        registeredGroups.set(group.groupId, group);
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
            const globalMapping = tagMappings.get(ingredient.id);
            if (globalMapping?.representativeItemId) {
                const mapped = viable.find(candidate =>
                    candidate.id === globalMapping.representativeItemId
                );
                if (mapped) {
                    appliedTagMappings.set(ingredient.id, mapped.id);
                    return walkItem(mapped.id, activePath);
                }
                diagnostics.push({
                    code: "TAG_REPRESENTATIVE_NO_LONGER_EXISTS",
                    severity: "WARNING",
                    message: `全域 Tag representative 已不在目前 values：#${ingredient.id} → ${globalMapping.representativeItemId}`,
                    tagId: ingredient.id
                });
            }
            if (viable.length > 1) {
                const groupId = hashId("tag-global", { tagId: ingredient.id });
                const group = {
                    groupId,
                    type: "tag",
                    ownerItemId: context.ownerItemId,
                    recipeId: context.recipeId,
                    ingredientId: context.ingredientId,
                    tagId: ingredient.id,
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
                requestedTagMappings.set(ingredient.id, selectedId);
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
                group.preferenceKey = alternativePreferenceKey(group);
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
        // Capture only dependencies reached through the selected recipe and
        // ingredient choices. Record shared edges before the generated cache.
        if (!generationDependencies.has(itemId)) generationDependencies.set(itemId, new Set());
        const parent = activePath.at(-1);
        if (parent) {
            if (!generationDependencies.has(parent)) generationDependencies.set(parent, new Set());
            generationDependencies.get(parent).add(itemId);
        }
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
            const candidates = [{
                candidateId: `${EXTERNAL_BASE_PREFIX}${itemId}`,
                label: "External acquisition：採掘／掉落／loot → 設為 Base",
                itemId,
                externalBase: true
            }, ...viable.map(recipe => ({
                candidateId: recipeIdentity(itemId, recipe),
                label: recipeLabel(recipe),
                recipe
            }))];
            const groupId = hashId("recipe-group", { itemId });
            const selectedId = registerGroup({
                groupId,
                type: "recipe",
                ownerItemId: itemId,
                title: itemId,
                candidates
            });
            if (!selectedId) return false;
            const selectedCandidate = candidates.find(candidate =>
                candidate.candidateId === selectedId
            );
            if (selectedCandidate.externalBase) {
                requestedExternalBaseItemIds.add(itemId);
                generated.add(itemId);
                generationOrder.push(itemId);
                return true;
            }
            selected = selectedCandidate.recipe;
        }
        const nextPath = [...activePath, itemId];
        if (!walkRecipe(itemId, selected, nextPath)) return false;
        generated.add(itemId);
        generationOrder.push(itemId);
        return true;
    }

    const targetComplete = target ? walkItem(target) : false;
    if (requestedExternalBaseItemIds.size > 0) {
        diagnostics.push({
            code: "EXTERNAL_BASE_TRANSFER_REQUIRED",
            severity: "INFO",
            message: "External acquisition 已選擇；請由統一 workflow 轉入 Locked Base Decisions 後重算"
        });
    }
    if (requestedTagMappings.size > 0) {
        diagnostics.push({
            code: "GLOBAL_TAG_TRANSFER_REQUIRED",
            severity: "INFO",
            message: "Tag representative 已選擇；請由統一 workflow 寫入全域 Tag mapping 後重算"
        });
    }
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
            planningCycles.length === 0 &&
            requestedExternalBaseItemIds.size === 0 &&
            requestedTagMappings.size === 0,
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
        generationDependencies: [...generationDependencies].map(([itemId, dependencies]) =>
            ({ itemId, dependencies: [...dependencies] })),
        requestedExternalBaseItemIds: [...requestedExternalBaseItemIds].sort(),
        requestedTagMappings: [...requestedTagMappings.entries()]
            .map(([tagId, representativeItemId]) => ({ tagId, representativeItemId }))
            .sort((left, right) => left.tagId.localeCompare(right.tagId)),
        appliedTagMappings: [...appliedTagMappings.entries()]
            .map(([tagId, representativeItemId]) => ({ tagId, representativeItemId }))
            .sort((left, right) => left.tagId.localeCompare(right.tagId)),
        appliedGlobalAmbiguityDecisions: [...appliedGlobalAmbiguityDecisions.entries()]
            .map(([groupId, candidateId]) => ({ groupId, candidateId }))
            .sort((left, right) => left.groupId.localeCompare(right.groupId)),
        appliedGlobalAlternativePreferences: [...appliedGlobalAlternativePreferences.entries()]
            .map(([preferenceKey, candidateId]) => ({ preferenceKey, candidateId }))
            .sort((left, right) => left.preferenceKey.localeCompare(right.preferenceKey)),
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
        ...(group.tagId ? [`- Subject: \`#${group.tagId}\``] : []),
        ...(group.preferenceKey ? [`- Preference Key: \`${group.preferenceKey}\``] : []),
        ""
    ];
    if (group.type === "recipe") {
        lines.push(
            "> 此處只選擇 BIO bottom-up generation planning 使用的 Base Route。",
            "> 所有合法 recipes 與 External acquisition 仍保留於 Normalized Registry，未來 BIO 會列出全部取得方式。",
            ""
        );
    }
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
        `### \`${groupId}\` — inactive / historical`,
        "",
        "> 此 group 已不在目前 active route；僅保留決策歷史，不會套用。",
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

function renderLockedGroup(group, state) {
    const selected = group.candidates.find(candidate =>
        candidate.candidateId === group.selectedCandidateId
    );
    const notes = state?.notes ?? "\n<!-- 在此輸入人工備註 -->\n";
    return [
        `<!-- obsf:locked-ambiguity:start ${group.groupId} ${group.type} ${group.selectedCandidateId} -->`,
        `### ${group.title}`,
        "",
        `- Group ID: \`${group.groupId}\``,
        `- Type: \`${group.type}\``,
        ...(group.tagId ? [`- Subject: \`#${group.tagId}\``] : []),
        ...(group.preferenceKey ? [`- Preference Key: \`${group.preferenceKey}\``] : []),
        `- Selected: \`${group.selectedCandidateId}\` — ${selected?.label ?? ""}`,
        ...(group.type === "recipe" ? [
            "- Scope: `GENERATION_PLANNING_ONLY`",
            "- Other Routes: `PRESERVED_IN_NORMALIZED_REGISTRY`"
        ] : []),
        ...(group.selectionSource ? [
            `- Selection Source: \`${group.selectionSource}\``
        ] : []),
        "- Status: `LOCKED`（不提供 Checkbox，避免誤改）",
        "",
        "<!-- obsf:notes:start -->" + notes + "<!-- obsf:notes:end -->",
        `<!-- obsf:locked-ambiguity:end ${group.groupId} -->`
    ].join("\n");
}

function collectRecipeDecisionTransfers(markdown) {
    const parsed = parseRecipeReviewMarkdown(markdown);
    const externalBaseItemIds = [];
    const tagMappings = [];
    for (const group of parsed.groups.values()) {
        if (group.checkedCandidateIds.length !== 1) continue;
        const selected = group.checkedCandidateIds[0];
        if (group.type === "recipe" && selected.startsWith(EXTERNAL_BASE_PREFIX)) {
            externalBaseItemIds.push(selected.slice(EXTERNAL_BASE_PREFIX.length));
        }
        if (group.type === "tag" && group.tagId) {
            tagMappings.push({
                tagId: group.tagId,
                representativeItemId: selected
            });
        }
    }
    return {
        externalBaseItemIds: [...new Set(externalBaseItemIds)].sort(),
        tagMappings: tagMappings.sort((left, right) => left.tagId.localeCompare(right.tagId)),
        diagnostics: parsed.diagnostics
    };
}

function renderRecipeReview(analysis, existingMarkdown = "") {
    const existingStates = extractAllExistingGroupStates(existingMarkdown);
    const activeByType = new Map([
        ["recipe", []],
        ["tag", []],
        ["alternative", []]
    ]);
    for (const group of analysis.groups) {
        if (group.status !== "RESOLVED") activeByType.get(group.type).push(group);
    }
    const lockedGroups = analysis.groups
        .filter(group => group.status === "RESOLVED")
        .sort((left, right) => left.groupId.localeCompare(right.groupId));
    const headings = {
        recipe: "Base Route for Generation Planning",
        tag: "Tag Selection",
        alternative: "Ingredient Alternative Selection"
    };
    const lines = [
        REVIEW_START,
        "# BIO Recipe Review",
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
    lines.push(ACTIVE_END, "", "## Locked Decisions", "", RECIPE_LOCKED_START);
    if (lockedGroups.length === 0) lines.push("- 無");
    for (const group of lockedGroups) {
        lines.push(renderLockedGroup(group, existingStates.get(group.groupId)), "");
    }
    lines.push(RECIPE_LOCKED_END, "", "## Readiness", "", "```json", JSON.stringify(analysis.readiness, null, 2), "```");
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
        lines.push("", "## Inactive / Historical Ambiguities（僅保留紀錄，不會套用）", "");
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

function reopenRecipeDecision(markdown, groupId) {
    const escaped = String(groupId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
        `<!-- obsf:locked-ambiguity:start ${escaped} (?:recipe|tag|alternative) [^\\s>]+ -->[\\s\\S]*?<!-- obsf:locked-ambiguity:end ${escaped} -->\\n?`,
        "g"
    );
    const source = String(markdown ?? "");
    if (!pattern.test(source)) return { markdown: source, reopened: false };
    return { markdown: source.replace(pattern, ""), reopened: true };
}

module.exports = {
    SCHEMA_VERSION,
    REVIEW_START,
    REVIEW_END,
    ACTIVE_START,
    ACTIVE_END,
    RECIPE_LOCKED_START,
    RECIPE_LOCKED_END,
    GROUP_TYPES,
    EXTERNAL_BASE_PREFIX,
    recipeIdentity,
    ingredientIdentity,
    recipeLabel,
    baseSelectionFingerprint,
    parseRecipeReviewMarkdown,
    createRecipeAmbiguityAnalysis,
    renderRecipeReview,
    reopenRecipeDecision,
    collectRecipeDecisionTransfers
};
