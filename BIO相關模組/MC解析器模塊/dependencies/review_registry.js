// ============================================================
// Minecraft Review Decision Registry
// Stores complete per-target Review snapshots behind one root Markdown file.
// ============================================================

const SCHEMA_VERSION = 1;
const DATA_START = "<!-- obsf:review-decision-registry:start -->";
const DATA_END = "<!-- obsf:review-decision-registry:end -->";
const ITEM_ID_PATTERN = /^minecraft:[a-z0-9_./-]+$/;
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

function inferAlternativePreferenceKey(target, selectedItemId) {
    const targetFamily = minecraftColorFamily(target);
    const selectedFamily = minecraftColorFamily(selectedItemId);
    return targetFamily && targetFamily === selectedFamily
        ? `minecraft-color-family:${targetFamily}`
        : null;
}

function emptyReviewDecisionRegistry() {
    return { schemaVersion: SCHEMA_VERSION, revocations: [], targets: {} };
}

function activeRevocation(registry, kind, key) {
    return (registry?.revocations ?? []).find(entry =>
        entry.status === "ACTIVE" && entry.kind === kind && entry.key === key
    ) ?? null;
}

function addReviewDecisionRevocation(registry, entry) {
    if (!registry.revocations) registry.revocations = [];
    const existing = activeRevocation(registry, entry.kind, entry.key);
    if (existing) return existing;
    const revocation = {
        kind: entry.kind,
        key: entry.key,
        target: entry.target ?? null,
        previousValue: entry.previousValue ?? null,
        status: "ACTIVE",
        revokedAt: entry.revokedAt ?? new Date().toISOString()
    };
    registry.revocations.push(revocation);
    registry.revocations.sort((left, right) =>
        `${left.kind}:${left.key}:${left.revokedAt}`.localeCompare(
            `${right.kind}:${right.key}:${right.revokedAt}`
        )
    );
    return revocation;
}

function resolveReviewDecisionRevocation(
    registry,
    kind,
    key,
    target = null,
    resolvedAt = new Date().toISOString()
) {
    let changed = false;
    for (const entry of registry?.revocations ?? []) {
        if (entry.status !== "ACTIVE" || entry.kind !== kind || entry.key !== key) continue;
        if (target && entry.target && entry.target !== target) continue;
        entry.status = "SUPERSEDED";
        entry.resolvedAt = resolvedAt;
        changed = true;
    }
    return changed;
}

function extractLockedBaseDecisions(baseReview) {
    const cycleMembers = new Map();
    const cyclePattern = /^### `([^`]+)`\s*\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm;
    for (const match of String(baseReview ?? "").matchAll(cyclePattern)) {
        const candidateLine = match[2].match(/^- 候選：(.*)$/m)?.[1] ?? "";
        cycleMembers.set(
            match[1],
            [...candidateLine.matchAll(/`(minecraft:[^`]+)`/g)]
                .map(candidate => candidate[1])
        );
    }
    const decisions = [];
    const basePattern = /<!-- obsf:locked-base:start ([^\s>]+) (candidate|external) -->/g;
    for (const match of String(baseReview ?? "").matchAll(basePattern)) {
        const decision = {
            itemId: match[1],
            kind: match[2]
        };
        if (match[2] === "candidate") {
            decision.cycleIds = [...cycleMembers.entries()]
                .filter(([, members]) => members.includes(match[1]))
                .map(([cycleId]) => cycleId)
                .sort();
        }
        decisions.push(decision);
    }
    return decisions.sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function validateReviewDecisionRegistry(parsed) {
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !parsed.targets ||
        typeof parsed.targets !== "object" || Array.isArray(parsed.targets)) {
        throw new Error("Minecraft Review Decisions registry schema 不相容");
    }
    if (parsed.revocations === undefined) parsed.revocations = [];
    if (!Array.isArray(parsed.revocations)) {
        throw new Error("Minecraft Review Decisions revocations 格式無效");
    }
    if (parsed.normalizedTargets !== undefined && (!parsed.normalizedTargets || typeof parsed.normalizedTargets !== 'object' || Array.isArray(parsed.normalizedTargets))) {
        throw new Error('BIO normalizedTargets 格式無效');
    }
    for (const [target, snapshot] of Object.entries(parsed.targets)) {
        if (!ITEM_ID_PATTERN.test(target)) {
            throw new Error(`Decision Registry target ID 無效：${target}`);
        }
        if (typeof snapshot?.baseReview !== "string" ||
            typeof snapshot?.recipeReview !== "string") {
            throw new Error(`Decision Registry snapshot 無效：${target}`);
        }
        if (!Array.isArray(snapshot.lockedBaseDecisions) ||
            !Array.isArray(snapshot.lockedAmbiguityDecisions)) {
            throw new Error(`Decision Registry structured decisions 無效：${target}`);
        }
    }
    return parsed;
}

function parseReviewDecisionRegistryJSON(json) {
    return validateReviewDecisionRegistry(JSON.parse(String(json ?? "")));
}

function parseReviewDecisionRegistry(markdown) {
    const source = String(markdown ?? "");
    const start = source.indexOf(DATA_START);
    const end = source.indexOf(DATA_END, start + DATA_START.length);
    if (start === -1 || end === -1) return emptyReviewDecisionRegistry();
    const body = source.slice(start + DATA_START.length, end).trim();
    const fenced = body.match(/^```json\s*([\s\S]*?)\s*```$/);
    if (!fenced) throw new Error("Minecraft Review Decisions registry JSON block 格式無效");
    return parseReviewDecisionRegistryJSON(fenced[1]);
}

function extractLockedAmbiguityDecisions(recipeReview, target) {
    const decisions = [];
    const ambiguityPattern = /<!-- obsf:locked-ambiguity:start ([^\s>]+) (recipe|tag|alternative) ([^\s>]+) -->([\s\S]*?)<!-- obsf:locked-ambiguity:end \1 -->/g;
    for (const match of String(recipeReview ?? "").matchAll(ambiguityPattern)) {
        const subject = match[4].match(/^- Subject: `([^`]+)`$/m)?.[1] ?? null;
        const selectedItemId = match[4].match(
            /^- Selected: `[^`]+`\s+—\s+(minecraft:[a-z0-9_./-]+)(?:\s|$)/m
        )?.[1] ?? null;
        const explicitPreferenceKey = match[4].match(
            /^- Preference Key: `([^`]+)`$/m
        )?.[1] ?? null;
        const preferenceKey = match[2] === "alternative"
            ? explicitPreferenceKey ?? inferAlternativePreferenceKey(target, selectedItemId)
            : null;
        decisions.push({
            groupId: match[1],
            type: match[2],
            candidateId: match[3],
            subject,
            ...(preferenceKey ? { preferenceKey } : {})
        });
    }
    return decisions.sort((left, right) => left.groupId.localeCompare(right.groupId));
}

function setReviewDecisionSnapshot(registry, target, snapshot) {
    if (!ITEM_ID_PATTERN.test(String(target ?? ""))) {
        throw new Error(`Decision Registry target ID 無效：${target}`);
    }
    if (typeof snapshot?.baseReview !== "string" ||
        typeof snapshot?.recipeReview !== "string") {
        throw new Error(`Decision Registry snapshot 無效：${target}`);
    }
    const lockedBaseDecisions = extractLockedBaseDecisions(snapshot.baseReview);
    const lockedAmbiguityDecisions = extractLockedAmbiguityDecisions(
        snapshot.recipeReview,
        target
    );
    for (const decision of lockedBaseDecisions) {
        if (decision.kind === "external") {
            resolveReviewDecisionRevocation(registry, "base-item", decision.itemId, target);
        }
        for (const cycleId of decision.cycleIds ?? []) {
            resolveReviewDecisionRevocation(registry, "base-cycle", cycleId, target);
        }
    }
    for (const decision of lockedAmbiguityDecisions) {
        resolveReviewDecisionRevocation(registry, "ambiguity-group", decision.groupId, target);
        if (decision.preferenceKey) {
            resolveReviewDecisionRevocation(
                registry,
                "alternative-preference",
                decision.preferenceKey,
                target
            );
        }
    }
    registry.targets[target] = {
        sourceFingerprint: snapshot.sourceFingerprint ?? null,
        lockedBaseDecisions,
        lockedAmbiguityDecisions,
        baseReview: snapshot.baseReview,
        recipeReview: snapshot.recipeReview
    };
    return registry.targets[target];
}

function getReviewDecisionSnapshot(registry, target) {
    return registry?.targets?.[target] ?? null;
}

function stripRevokedDecisionsFromSnapshot(registry, target, snapshot) {
    let baseReview = String(snapshot?.baseReview ?? "");
    let recipeReview = String(snapshot?.recipeReview ?? "");
    for (const decision of extractLockedBaseDecisions(baseReview)) {
        const revoked = decision.kind === "external"
            ? activeRevocation(registry, "base-item", decision.itemId)
            : (decision.cycleIds ?? []).some(cycleId =>
                activeRevocation(registry, "base-cycle", cycleId)
            );
        if (!revoked) continue;
        const escaped = decision.itemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        baseReview = baseReview.replace(
            new RegExp(
                `<!-- obsf:locked-base:start ${escaped} (?:candidate|external) -->[\\s\\S]*?<!-- obsf:locked-base:end ${escaped} -->\\n?`,
                "g"
            ),
            ""
        );
    }
    for (const decision of extractLockedAmbiguityDecisions(recipeReview, target)) {
        const tagId = decision.subject?.replace(/^#/, "") ?? null;
        const revoked = activeRevocation(registry, "ambiguity-group", decision.groupId) ||
            (decision.preferenceKey && activeRevocation(
                registry,
                "alternative-preference",
                decision.preferenceKey
            )) ||
            (tagId && activeRevocation(registry, "tag", tagId));
        if (!revoked) continue;
        const escaped = decision.groupId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        recipeReview = recipeReview.replace(
            new RegExp(
                `<!-- obsf:locked-ambiguity:start ${escaped} (?:recipe|tag|alternative) [^\\s>]+ -->[\\s\\S]*?<!-- obsf:locked-ambiguity:end ${escaped} -->\\n?`,
                "g"
            ),
            ""
        );
    }
    return {
        ...snapshot,
        baseReview,
        recipeReview,
        lockedBaseDecisions: extractLockedBaseDecisions(baseReview),
        lockedAmbiguityDecisions: extractLockedAmbiguityDecisions(
            recipeReview,
            target
        )
    };
}

function createGlobalAmbiguityDecisionIndex(registry) {
    const selections = new Map();
    const alternativePreferences = new Map();
    const diagnostics = [];
    for (const [target, snapshot] of Object.entries(registry?.targets ?? {})) {
        const extracted = extractLockedAmbiguityDecisions(snapshot.recipeReview, target);
        const extractedByGroup = new Map(extracted.map(decision => [decision.groupId, decision]));
        for (const original of snapshot.lockedAmbiguityDecisions ?? []) {
            const decision = {
                ...original,
                ...extractedByGroup.get(original.groupId)
            };
            if (activeRevocation(registry, "ambiguity-group", decision.groupId)) {
                continue;
            }
            const existing = selections.get(decision.groupId);
            if (existing && (
                existing.type !== decision.type ||
                existing.candidateId !== decision.candidateId
            )) {
                diagnostics.push({
                    code: "GLOBAL_AMBIGUITY_DECISION_CONFLICT",
                    severity: "ERROR",
                    message: `Group ${decision.groupId} 在 ${existing.targets.join(", ")} 與 ${target} 有不同 locked candidate`,
                    groupId: decision.groupId
                });
                continue;
            }
            if (existing) {
                existing.targets.push(target);
                existing.targets.sort();
            } else {
                selections.set(decision.groupId, {
                    groupId: decision.groupId,
                    type: decision.type,
                    candidateId: decision.candidateId,
                    subject: decision.subject ?? null,
                    targets: [target]
                });
            }
            if (decision.type === "alternative" && decision.preferenceKey) {
                if (activeRevocation(
                    registry,
                    "alternative-preference",
                    decision.preferenceKey
                )) continue;
                const preference = alternativePreferences.get(decision.preferenceKey);
                if (preference && preference.candidateId !== decision.candidateId) {
                    diagnostics.push({
                        code: "GLOBAL_ALTERNATIVE_PREFERENCE_CONFLICT",
                        severity: "ERROR",
                        message: `Preference ${decision.preferenceKey} 在 ${preference.targets.join(", ")} 與 ${target} 選擇不同 candidate`,
                        preferenceKey: decision.preferenceKey
                    });
                } else if (preference) {
                    preference.targets.push(target);
                    preference.targets.sort();
                } else {
                    alternativePreferences.set(decision.preferenceKey, {
                        preferenceKey: decision.preferenceKey,
                        type: "alternative",
                        candidateId: decision.candidateId,
                        targets: [target]
                    });
                }
            }
        }
    }
    return { selections, alternativePreferences, diagnostics };
}

function createGlobalBaseDecisionIndex(registry) {
    const candidateByCycle = new Map();
    const externalItemIds = new Map();
    const diagnostics = [];
    for (const [target, snapshot] of Object.entries(registry?.targets ?? {})) {
        const decisions = (snapshot.lockedBaseDecisions ?? []).map(decision =>
            decision.cycleIds ? decision :
                extractLockedBaseDecisions(snapshot.baseReview)
                    .find(candidate =>
                        candidate.itemId === decision.itemId &&
                        candidate.kind === decision.kind
                    ) ?? decision
        );
        for (const decision of decisions) {
            if (decision.kind === "external") {
                if (activeRevocation(registry, "base-item", decision.itemId)) continue;
                if (!externalItemIds.has(decision.itemId)) {
                    externalItemIds.set(decision.itemId, {
                        itemId: decision.itemId,
                        kind: "external",
                        targets: []
                    });
                }
                externalItemIds.get(decision.itemId).targets.push(target);
                externalItemIds.get(decision.itemId).targets.sort();
                continue;
            }
            for (const cycleId of decision.cycleIds ?? []) {
                if (activeRevocation(registry, "base-cycle", cycleId)) continue;
                const existing = candidateByCycle.get(cycleId);
                if (existing && existing.itemId !== decision.itemId) {
                    diagnostics.push({
                        code: "GLOBAL_BASE_DECISION_CONFLICT",
                        severity: "ERROR",
                        message: `Cycle ${cycleId} 在 ${existing.targets.join(", ")} 與 ${target} 選擇不同 Base item`,
                        cycleId
                    });
                    continue;
                }
                if (existing) {
                    existing.targets.push(target);
                    existing.targets.sort();
                } else {
                    candidateByCycle.set(cycleId, {
                        cycleId,
                        itemId: decision.itemId,
                        kind: "candidate",
                        targets: [target]
                    });
                }
            }
        }
    }
    return { candidateByCycle, externalItemIds, diagnostics };
}

function renderReviewDecisionRegistry(registry) {
    const orderedTargets = Object.fromEntries(
        Object.entries(registry?.targets ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
    );
    const globalIndex = createGlobalAmbiguityDecisionIndex({
        ...registry,
        targets: orderedTargets
    });
    const globalBaseIndex = createGlobalBaseDecisionIndex({
        ...registry,
        targets: orderedTargets
    });
    const data = {
        schemaVersion: SCHEMA_VERSION,
        revocations: [...(registry.revocations ?? [])],
        globalBaseDecisions: [
            ...globalBaseIndex.candidateByCycle.values(),
            ...globalBaseIndex.externalItemIds.values()
        ],
        globalAlternativePreferences: [...globalIndex.alternativePreferences.values()],
        globalAmbiguityDecisions: [...globalIndex.selections.values()],
        targets: orderedTargets,
        ...(registry.normalizedTargets ? { normalizedTargets: registry.normalizedTargets } : {})
    };
    const lines = [
        "---",
        "type: minecraft-review-decision-registry",
        `schemaVersion: ${SCHEMA_VERSION}`,
        "---",
        "",
        "# Minecraft Review Decisions",
        "",
        "> 本檔保存各 target 的完整 Base／Recipe Review snapshot。日常操作只使用根目錄兩份 Review；請勿直接編輯下方 JSON。",
        "",
        "## Saved Targets",
        ""
    ];
    const targetIds = Object.keys(orderedTargets);
    if (targetIds.length === 0) lines.push("- 無");
    else for (const target of targetIds) lines.push(`- \`${target}\``);
    lines.push(
        "",
        DATA_START,
        "```json",
        JSON.stringify(data, null, 2),
        "```",
        DATA_END,
        ""
    );
    return lines.join("\n");
}

function serializeReviewDecisionRegistryJSON(registry) {
    const orderedTargets = Object.fromEntries(
        Object.entries(registry?.targets ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
    );
    return `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        revocations: [...(registry.revocations ?? [])],
        targets: orderedTargets,
        ...(registry.normalizedTargets ? { normalizedTargets: registry.normalizedTargets } : {})
    }, null, 2)}\n`;
}

function renderReviewDecisionSummary(registry, { jsonFilename = 'BIO Review Decisions.json' } = {}) {
    const targetIds = Object.keys(registry?.targets ?? {}).sort();
    const activeRevocations = (registry?.revocations ?? [])
        .filter(entry => entry.status === "ACTIVE").length;
    return [
        "---",
        "type: minecraft-review-decision-summary",
        `schemaVersion: ${SCHEMA_VERSION}`,
        "---",
        "",
        "# BIO Review Decisions",
        "",
        "> Machine source-of-truth：`" + jsonFilename + "`。本檔僅供 Obsidian 查看摘要，請勿作為 Registry 輸入。",
        "",
        `- Saved Targets: ${targetIds.length}`,
        `- Normalized Source Targets: ${Object.keys(registry.normalizedTargets || {}).length}`,
        `- Active Revocations: ${activeRevocations}`,
        "",
        "## Saved Targets",
        "",
        ...(targetIds.length === 0 ? ["- 無"] : targetIds.map(target => `- \`${target}\``)),
        ""
    ].join("\n");
}

module.exports = {
    REVIEW_DECISION_REGISTRY_SCHEMA_VERSION: SCHEMA_VERSION,
    REVIEW_DECISION_REGISTRY_DATA_START: DATA_START,
    REVIEW_DECISION_REGISTRY_DATA_END: DATA_END,
    emptyReviewDecisionRegistry,
    parseReviewDecisionRegistry,
    parseReviewDecisionRegistryJSON,
    setReviewDecisionSnapshot,
    getReviewDecisionSnapshot,
    activeRevocation,
    addReviewDecisionRevocation,
    resolveReviewDecisionRevocation,
    stripRevokedDecisionsFromSnapshot,
    extractLockedBaseDecisions,
    extractLockedAmbiguityDecisions,
    createGlobalBaseDecisionIndex,
    createGlobalAmbiguityDecisionIndex,
    renderReviewDecisionRegistry,
    serializeReviewDecisionRegistryJSON,
    renderReviewDecisionSummary
};
