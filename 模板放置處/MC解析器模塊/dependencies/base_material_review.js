// ============================================================
// Minecraft Base Material Review Markdown
// Pure Node.js. Only the managed review section is parsed/updated.
// ============================================================

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const REVIEW_START = "<!-- obsf:base-material-review:start -->";
const REVIEW_END = "<!-- obsf:base-material-review:end -->";
const SELECTION_START = "<!-- obsf:base-material-selection:start -->";
const SELECTION_END = "<!-- obsf:base-material-selection:end -->";
const EXTERNAL_START = "<!-- obsf:external-base-materials:start -->";
const EXTERNAL_END = "<!-- obsf:external-base-materials:end -->";
const ITEM_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, stableValue(value[key])])
        );
    }
    return value;
}

function fingerprintIngredient(ingredient) {
    if (ingredient?.kind === "item") {
        return { kind: "item", id: ingredient.id, qty: ingredient.qty };
    }
    if (ingredient?.kind === "tag") {
        return {
            kind: "tag",
            id: ingredient.id,
            qty: ingredient.qty,
            candidates: ingredient.candidates
                ? ingredient.candidates.map(candidate => candidate.id)
                : [...(ingredient.values ?? [])]
        };
    }
    if (ingredient?.kind === "alternatives") {
        return {
            kind: "alternatives",
            qty: ingredient.qty,
            choices: (ingredient.choices ?? []).map(choice =>
                fingerprintIngredient(choice.ingredient)
            )
        };
    }
    return { kind: ingredient?.kind ?? "unknown" };
}

function computeDependencySourceFingerprint(dependencyResult) {
    const graph = dependencyResult?.graph;
    if (!(graph instanceof Map)) {
        throw new TypeError("sourceFingerprint 需要 resolver graph Map");
    }
    const payload = [...graph.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemId, node]) => ({
            itemId,
            leaf: node.leaf === true,
            specialBoundary: node.specialBoundary === true,
            recipes: (node.recipes ?? []).map(recipe => ({
                branchId: recipe.branchId,
                sourceType: recipe.sourceType,
                output: recipe.output,
                ingredients: (recipe.ingredients ?? []).map(fingerprintIngredient)
            }))
        }));
    const json = JSON.stringify(stableValue({
        targets: dependencyResult.targets ?? [],
        graph: payload
    }));
    return `sha256:${crypto.createHash("sha256").update(json).digest("hex")}`;
}

function computeNormalizedRegistryFingerprint(registry) {
    if (!registry || typeof registry.entries !== "function") {
        throw new TypeError("sourceFingerprint 需要 NormalizedItemRegistry");
    }
    const payload = [...registry.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemId, item]) => ({
            itemId,
            recipes: (item.recipes ?? []).map(recipe => ({
                sourceType: recipe.sourceType,
                section: recipe.section,
                machine: recipe.machine,
                output: recipe.output,
                ingredients: (recipe.ingredients ?? []).map(fingerprintIngredient),
                meta: stableValue(recipe.meta ?? {})
            }))
        }));
    const json = JSON.stringify(stableValue(payload));
    return `sha256:${crypto.createHash("sha256").update(json).digest("hex")}`;
}

function canonicalCyclePath(path) {
    const values = [...(path ?? [])];
    if (values.length > 1 && values[0] === values.at(-1)) values.pop();
    if (values.length === 0) return [];
    const rotations = values.map((_, index) => [
        ...values.slice(index),
        ...values.slice(0, index)
    ]);
    rotations.sort((left, right) =>
        left.join("\u0000").localeCompare(right.join("\u0000"))
    );
    return [...rotations[0], rotations[0][0]];
}

function cycleGroupId(members) {
    return `cycle-${crypto.createHash("sha256")
        .update(members.join("\u0000"))
        .digest("hex")
        .slice(0, 12)}`;
}

function createBaseMaterialReview(dependencyResult, basePlan, options = {}) {
    if (!(basePlan?.baseDependencyMap instanceof Map)) {
        throw new TypeError("Base Material Review 需要 baseDependencyMap");
    }

    const grouped = new Map();
    for (const entry of basePlan.baseDependencyMap.values()) {
        if (entry.safe) continue;
        for (const route of entry.candidateRoutes ?? []) {
            if (route.status !== "BLOCKED") continue;
            for (const rawPath of route.blockingCycles ?? route.cycles ?? []) {
                const path = canonicalCyclePath(rawPath);
                const members = [...new Set(path.slice(0, -1))].sort();
                if (members.length === 0) continue;
                const key = members.join("\u0000");
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        cycleId: cycleGroupId(members),
                        members,
                        paths: new Map()
                    });
                }
                grouped.get(key).paths.set(path.join(" → "), path);
            }
        }
    }

    const cycleGroups = [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, group]) => ({
            cycleId: group.cycleId,
            members: group.members,
            paths: [...group.paths.values()].sort((left, right) =>
                left.join("\u0000").localeCompare(right.join("\u0000"))
            )
        }));
    const seen = new Set();
    const candidates = [];
    for (const group of cycleGroups) {
        for (const itemId of group.members) {
            if (seen.has(itemId)) continue;
            seen.add(itemId);
            candidates.push({
                candidateId: itemId,
                itemId,
                cycleIds: cycleGroups
                    .filter(candidateGroup => candidateGroup.members.includes(itemId))
                    .map(candidateGroup => candidateGroup.cycleId)
            });
        }
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        target: dependencyResult.target ?? dependencyResult.targets?.[0] ?? null,
        sourceFingerprint:
            options.sourceFingerprint ??
            computeDependencySourceFingerprint(dependencyResult),
        cycleGroups,
        candidates,
        graphItemIds: [...dependencyResult.graph.keys()].sort(),
        unresolvedItemIds: [...(basePlan.routeAwareBlockedItems ?? [])].sort()
    };
}

function parseFrontmatter(markdown) {
    const match = String(markdown ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const values = {};
    if (!match) return { values, range: null, rawLines: [] };
    const rawLines = match[1].split(/\r?\n/);
    for (const line of rawLines) {
        const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        if (field) values[field[1]] = field[2].trim();
    }
    return { values, range: [match.index, match[0].length], rawLines };
}

function replaceFrontmatter(markdown, fields) {
    const current = parseFrontmatter(markdown);
    const managedKeys = new Set(Object.keys(fields));
    const preserved = current.rawLines.filter(line => {
        const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
        return !match || !managedKeys.has(match[1]);
    });
    const managed = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
    const block = `---\n${[...managed, ...preserved].join("\n")}\n---\n`;
    if (!current.range) return `${block}\n${markdown ?? ""}`;
    return String(markdown).slice(0, current.range[0]) + block +
        String(markdown).slice(current.range[0] + current.range[1]);
}

function managedSlice(markdown, startMarker, endMarker) {
    const source = String(markdown ?? "");
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start === -1 || end === -1) return null;
    return {
        start,
        end: end + endMarker.length,
        content: source.slice(start + startMarker.length, end)
    };
}

function extractExistingCandidateState(markdown) {
    const states = new Map();
    const review = managedSlice(markdown, REVIEW_START, REVIEW_END);
    if (!review) return states;
    const pattern = /<!-- obsf:candidate:start ([^\s>]+) -->([\s\S]*?)<!-- obsf:candidate:end \1 -->/g;
    for (const match of review.content.matchAll(pattern)) {
        const itemId = match[1];
        const checkbox = match[2].match(/^- \[([ xX])\] `([^`]+)` <!-- obsf:candidate-id:([^\s>]+) -->/m);
        const notes = match[2].match(/<!-- obsf:notes:start -->([\s\S]*?)<!-- obsf:notes:end -->/);
        states.set(itemId, {
            checked: checkbox ? checkbox[1].toLowerCase() === "x" : false,
            displayItemId: checkbox?.[2] ?? itemId,
            markerItemId: checkbox?.[3] ?? itemId,
            notes: notes?.[1]?.replace(/\r?\n[ \t]*$/, "\n") ??
                "\n<!-- 在此輸入人工備註 -->\n"
        });
    }
    return states;
}

function extractExistingExternalBaseState(markdown) {
    const states = new Map();
    const review = managedSlice(markdown, REVIEW_START, REVIEW_END);
    if (!review) return states;
    const pattern = /<!-- obsf:external-base:start ([^\s>]+) -->([\s\S]*?)<!-- obsf:external-base:end \1 -->/g;
    for (const match of review.content.matchAll(pattern)) {
        const itemId = match[1];
        const checkbox = match[2].match(/^- \[([ xX])\] `([^`]+)` <!-- obsf:external-base-id:([^\s>]+) -->/m);
        const notes = match[2].match(/<!-- obsf:notes:start -->([\s\S]*?)<!-- obsf:notes:end -->/);
        states.set(itemId, {
            checked: checkbox ? checkbox[1].toLowerCase() === "x" : false,
            displayItemId: checkbox?.[2] ?? itemId,
            markerItemId: checkbox?.[3] ?? itemId,
            notes: notes?.[1]?.replace(/\r?\n[ \t]*$/, "\n") ??
                "\n<!-- 在此輸入人工備註，例如：挖掘掉落 -->\n"
        });
    }
    const section = managedSlice(markdown, EXTERNAL_START, EXTERNAL_END);
    if (section) {
        const loosePattern = /^- \[([ xX])\] `([^`]+)`\s*$/gm;
        for (const match of section.content.matchAll(loosePattern)) {
            const itemId = match[2];
            if (states.has(itemId)) continue;
            states.set(itemId, {
                checked: match[1].toLowerCase() === "x",
                displayItemId: itemId,
                markerItemId: itemId,
                notes: "\n<!-- 在此輸入人工備註，例如：挖掘掉落 -->\n"
            });
        }
    }
    return states;
}

function renderCandidate(candidate, state, stale = false) {
    const checked = state?.checked ? "x" : " ";
    const notes = state?.notes ?? "\n<!-- 在此輸入人工備註 -->\n";
    const cycleText = candidate.cycleIds?.length
        ? `循環：${candidate.cycleIds.map(id => `\`${id}\``).join(", ")}`
        : "循環來源已變更";
    return [
        `<!-- obsf:candidate:start ${candidate.itemId} -->`,
        `- [${checked}] \`${candidate.itemId}\` <!-- obsf:candidate-id:${candidate.itemId} -->`,
        `  - ${stale ? "⚠ 過期候選，需重新審核；不會套用" : cycleText}`,
        "  <!-- obsf:notes:start -->" + notes + "  <!-- obsf:notes:end -->",
        `<!-- obsf:candidate:end ${candidate.itemId} -->`
    ].join("\n");
}

function renderExternalBase(itemId, state, stale = false) {
    const checked = state?.checked ? "x" : " ";
    const notes = state?.notes ??
        "\n<!-- 在此輸入人工備註，例如：挖掘掉落 -->\n";
    return [
        `<!-- obsf:external-base:start ${itemId} -->`,
        `- [${checked}] \`${itemId}\` <!-- obsf:external-base-id:${itemId} -->`,
        stale ? "> ⚠ 已不在目前 target dependency graph；不會套用。" :
            "> External acquisition boundary；不會刪除 Registry 中的 recipes。",
        "<!-- obsf:notes:start -->" + notes + "<!-- obsf:notes:end -->",
        `<!-- obsf:external-base:end ${itemId} -->`
    ].join("\n");
}

function renderManagedReview(review, existingStates, externalStates) {
    const currentIds = new Set(review.candidates.map(candidate => candidate.itemId));
    const candidatesById = new Map(
        review.candidates.map(candidate => [candidate.itemId, candidate])
    );
    const orderedCandidates = [];
    const orderedIds = new Set();
    for (const itemId of existingStates.keys()) {
        if (!currentIds.has(itemId)) continue;
        orderedCandidates.push(candidatesById.get(itemId));
        orderedIds.add(itemId);
    }
    for (const candidate of review.candidates) {
        if (orderedIds.has(candidate.itemId)) continue;
        orderedCandidates.push(candidate);
        orderedIds.add(candidate.itemId);
    }
    const stale = [...existingStates.entries()]
        .filter(([itemId]) => !currentIds.has(itemId))
        .sort(([left], [right]) => left.localeCompare(right));
    const lines = [
        REVIEW_START,
        "# Minecraft Base Material Review",
        "",
        `- Target Item ID: \`${review.target}\``,
        `- Schema Version: \`${review.schemaVersion}\``,
        `- Source Fingerprint: \`${review.sourceFingerprint}\``,
        "",
        "## 循環群組",
        ""
    ];
    if (review.cycleGroups.length === 0) lines.push("- 無", "");
    for (const group of review.cycleGroups) {
        lines.push(`### \`${group.cycleId}\``, "");
        lines.push(`- 候選：${group.members.map(id => `\`${id}\``).join(", ")}`);
        for (const path of group.paths) {
            lines.push(`- 路徑：${path.map(id => `\`${id}\``).join(" → ")}`);
        }
        lines.push("");
    }
    lines.push(
        "## Base Material Selection",
        "",
        "> 只解析下列 marker 內的 Checkbox。請自行勾選外部取得來源；系統不會自動全選。",
        "",
        SELECTION_START
    );
    if (orderedCandidates.length === 0) lines.push("- 無候選");
    for (const candidate of orderedCandidates) {
        lines.push(renderCandidate(candidate, existingStates.get(candidate.itemId)));
    }
    lines.push(
        SELECTION_END,
        "",
        "## Additional External Base Materials",
        "",
        "> 用於採掘、掉落、loot table 等 Recipe JSON 無法表達的外部來源。",
        "> 只有下列 markers 內的 Checkbox 會被解析；可直接新增一行，不必手寫內部 block markers。",
        "",
        EXTERNAL_START
    );
    const graphIds = new Set(review.graphItemIds ?? []);
    const activeExternal = [...externalStates.entries()]
        .filter(([itemId]) => graphIds.has(itemId))
        .sort(([left], [right]) => left.localeCompare(right));
    if (activeExternal.length === 0) {
        lines.push(
            "> 尚無項目。請複製下一行、移除開頭的 `>`，再填入實際 ID：",
            "> - [ ] `minecraft:item_id`"
        );
    }
    for (const [itemId, state] of activeExternal) {
        lines.push(renderExternalBase(itemId, state));
    }
    lines.push(EXTERNAL_END, "", "## 未解決的循環", "");
    if (review.unresolvedItemIds.length === 0) lines.push("- 無");
    else for (const itemId of review.unresolvedItemIds) lines.push(`- \`${itemId}\``);
    if (stale.length > 0) {
        lines.push("", "## 過期候選（需重新審核）", "");
        for (const [itemId, state] of stale) {
            lines.push(renderCandidate({ itemId, cycleIds: [] }, state, true));
        }
    }
    const staleExternal = [...externalStates.entries()]
        .filter(([itemId]) => !graphIds.has(itemId))
        .sort(([left], [right]) => left.localeCompare(right));
    if (staleExternal.length > 0) {
        lines.push("", "## 過期外部基礎材料（需重新審核）", "");
        for (const [itemId, state] of staleExternal) {
            lines.push(renderExternalBase(itemId, state, true));
        }
    }
    lines.push(REVIEW_END);
    return lines.join("\n");
}

function renderBaseMaterialReview(review, existingMarkdown = "") {
    const existingStates = extractExistingCandidateState(existingMarkdown);
    const externalStates = extractExistingExternalBaseState(existingMarkdown);
    const managed = renderManagedReview(review, existingStates, externalStates);
    const oldManaged = managedSlice(existingMarkdown, REVIEW_START, REVIEW_END);
    let merged;
    if (oldManaged) {
        merged = String(existingMarkdown).slice(0, oldManaged.start) + managed +
            String(existingMarkdown).slice(oldManaged.end);
    } else {
        const suffix = existingMarkdown && !String(existingMarkdown).endsWith("\n") ? "\n" : "";
        merged = `${existingMarkdown ?? ""}${suffix}${existingMarkdown ? "\n" : ""}${managed}\n`;
    }
    return replaceFrontmatter(merged, {
        type: "minecraft-base-material-review",
        schemaVersion: review.schemaVersion,
        target: review.target,
        sourceFingerprint: review.sourceFingerprint
    });
}

function parseBaseMaterialReview(markdown, currentReview) {
    const diagnostics = [];
    const frontmatter = parseFrontmatter(markdown).values;
    const selection = managedSlice(markdown, SELECTION_START, SELECTION_END);
    const externalSelection = managedSlice(markdown, EXTERNAL_START, EXTERNAL_END);
    const candidateIds = new Set(currentReview.candidates.map(candidate => candidate.itemId));
    const entries = [];
    const externalEntries = [];
    const seen = new Set();
    const externalSeen = new Set();

    function diagnostic(code, severity, message, itemId = null) {
        diagnostics.push({ code, severity, message, itemId });
    }

    if (externalSelection) {
        const graphItemIds = new Set(currentReview.graphItemIds ?? []);
        const externalPattern = /<!-- obsf:external-base:start ([^\s>]+) -->([\s\S]*?)<!-- obsf:external-base:end \1 -->/g;
        for (const block of externalSelection.content.matchAll(externalPattern)) {
            const blockItemId = block[1];
            const checkbox = block[2].match(/^- \[([ xX])\] `([^`]+)` <!-- obsf:external-base-id:([^\s>]+) -->/m);
            if (!checkbox) {
                diagnostic("INVALID_EXTERNAL_BASE", "ERROR", `External base block 格式不合法：${blockItemId}`, blockItemId);
                continue;
            }
            const itemId = checkbox[3];
            const checked = checkbox[1].toLowerCase() === "x";
            if (blockItemId !== itemId || checkbox[2] !== itemId) {
                diagnostic("EXTERNAL_BASE_ID_MISMATCH", "ERROR", `External base 穩定 ID 不一致：${itemId}`, itemId);
            }
            if (!ITEM_ID_PATTERN.test(itemId)) {
                diagnostic("INVALID_ITEM_ID", "ERROR", `無效 Minecraft Item ID：${itemId}`, itemId);
            }
            if (externalSeen.has(itemId) || seen.has(itemId)) {
                diagnostic("DUPLICATE_BASE_ITEM", "ERROR", `Base Material 重複設定：${itemId}`, itemId);
            }
            externalSeen.add(itemId);
            if (!graphItemIds.has(itemId)) {
                diagnostic("UNKNOWN_OR_STALE_EXTERNAL_BASE", "ERROR", `External base 不在目前 target graph：${itemId}`, itemId);
            }
            externalEntries.push({ itemId, checked });
        }
        const loosePattern = /^- \[([ xX])\] `([^`]+)`\s*$/gm;
        for (const loose of externalSelection.content.matchAll(loosePattern)) {
            const itemId = loose[2];
            const checked = loose[1].toLowerCase() === "x";
            if (!ITEM_ID_PATTERN.test(itemId)) {
                diagnostic("INVALID_ITEM_ID", "ERROR", `無效 Minecraft Item ID：${itemId}`, itemId);
            }
            if (externalSeen.has(itemId) || seen.has(itemId)) {
                diagnostic("DUPLICATE_BASE_ITEM", "ERROR", `Base Material 重複設定：${itemId}`, itemId);
            }
            externalSeen.add(itemId);
            if (!graphItemIds.has(itemId)) {
                diagnostic("UNKNOWN_OR_STALE_EXTERNAL_BASE", "ERROR", `External base 不在目前 target graph：${itemId}`, itemId);
            }
            externalEntries.push({ itemId, checked });
        }
    }

    if (!selection) {
        diagnostic("MISSING_SELECTION_SECTION", "ERROR", "找不到 Base Material Selection managed section");
    } else {
        const checkboxPattern = /^- \[([ xX])\] `([^`]+)` <!-- obsf:candidate-id:([^\s>]+) -->/gm;
        const allCheckboxLines = selection.content.match(/^- \[[ xX]\].*$/gm) ?? [];
        let recognizedCheckboxes = 0;
        for (const match of selection.content.matchAll(checkboxPattern)) {
            recognizedCheckboxes++;
            const itemId = match[3];
            const checked = match[1].toLowerCase() === "x";
            if (match[2] !== itemId) {
                diagnostic("CANDIDATE_ID_MISMATCH", "ERROR", `顯示 ID ${match[2]} 與穩定 ID ${itemId} 不一致`, itemId);
            }
            if (!ITEM_ID_PATTERN.test(itemId)) {
                diagnostic("INVALID_ITEM_ID", "ERROR", `無效 Minecraft Item ID：${itemId}`, itemId);
            }
            if (seen.has(itemId)) {
                diagnostic("DUPLICATE_CANDIDATE", "ERROR", `Base Material 候選重複：${itemId}`, itemId);
            }
            seen.add(itemId);
            if (!candidateIds.has(itemId)) {
                diagnostic("UNKNOWN_OR_STALE_CANDIDATE", "ERROR", `未知或過期 Base Material 候選：${itemId}`, itemId);
            }
            entries.push({ itemId, checked });
        }
        if (recognizedCheckboxes !== allCheckboxLines.length) {
            diagnostic(
                "MALFORMED_CANDIDATE",
                "ERROR",
                `Base Material Selection 內有 ${allCheckboxLines.length - recognizedCheckboxes} 個格式不合法的 Checkbox`
            );
        }
        for (const itemId of candidateIds) {
            if (!seen.has(itemId)) {
                diagnostic("MISSING_CANDIDATE", "ERROR", `缺少目前 Base Material 候選：${itemId}`, itemId);
            }
        }
    }

    for (const itemId of externalSeen) {
        if (seen.has(itemId)) {
            diagnostic(
                "DUPLICATE_BASE_ITEM",
                "ERROR",
                `同一 Base Material 同時出現在循環候選與外部來源：${itemId}`,
                itemId
            );
        }
    }

    if (String(frontmatter.schemaVersion) !== String(currentReview.schemaVersion)) {
        diagnostic("SCHEMA_VERSION_MISMATCH", "ERROR", `Review schemaVersion 不相容：${frontmatter.schemaVersion ?? "missing"}`);
    }
    if (frontmatter.target !== currentReview.target) {
        diagnostic("TARGET_MISMATCH", "ERROR", `Review target ${frontmatter.target ?? "missing"} 與目前 target ${currentReview.target} 不一致`);
    }
    if (frontmatter.sourceFingerprint !== currentReview.sourceFingerprint) {
        diagnostic("SOURCE_FINGERPRINT_MISMATCH", "WARNING", "Recipe Registry 或 dependency graph 已變更；已重新驗證所有候選，請人工確認警告");
    }

    const hasErrors = diagnostics.some(entry => entry.severity === "ERROR");
    const order = new Map(currentReview.candidates.map((candidate, index) => [candidate.itemId, index]));
    const selectedCandidateIds = entries
        .filter(entry => entry.checked && candidateIds.has(entry.itemId) && ITEM_ID_PATTERN.test(entry.itemId))
        .map(entry => entry.itemId)
        .filter((itemId, index, values) => values.indexOf(itemId) === index)
        .sort((left, right) => order.get(left) - order.get(right));
    const selectedExternalIds = externalEntries
        .filter(entry => entry.checked && ITEM_ID_PATTERN.test(entry.itemId))
        .map(entry => entry.itemId)
        .filter((itemId, index, values) => values.indexOf(itemId) === index)
        .sort();
    const selectedBaseItemIds = [...selectedCandidateIds, ...selectedExternalIds];

    return {
        schemaVersion: currentReview.schemaVersion,
        target: currentReview.target,
        sourceFingerprint: frontmatter.sourceFingerprint ?? null,
        currentSourceFingerprint: currentReview.sourceFingerprint,
        entries,
        externalEntries,
        selectedBaseItemIds: hasErrors ? [] : selectedBaseItemIds,
        diagnostics,
        canApply: !hasErrors
    };
}

module.exports = {
    SCHEMA_VERSION,
    REVIEW_START,
    REVIEW_END,
    SELECTION_START,
    SELECTION_END,
    EXTERNAL_START,
    EXTERNAL_END,
    ITEM_ID_PATTERN,
    parseFrontmatter,
    replaceFrontmatter,
    managedSlice,
    computeDependencySourceFingerprint,
    computeNormalizedRegistryFingerprint,
    createBaseMaterialReview,
    renderBaseMaterialReview,
    parseBaseMaterialReview
};
