#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { createMinecraftVanillaRuntime } = require("./lib/minecraft-vanilla-runtime.cjs");
const { readReviewDecisionStore } = require("./lib/review-decision-store.cjs");
const { writeFileWithRetrySync } = require("./lib/file-write-retry.cjs");
const vanilla = require("../BIO相關模組/MC解析器模塊");
const { parseMachineRecipeMappings } = require("../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping");
const { mergeBIOPreviewContexts } = require("./lib/bio-preview-batch.cjs");
const bioReader = require("../BIO相關模組/搜尋介面模塊/bio_reader_v4");
const { rewriteBIOForPreview } = require("../BIO相關模組/MC解析器模塊/bio/bio_preview");

const vaultRoot = path.resolve(__dirname, "..");

function option(name, fallback = null) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function safeVaultPath(requested) {
    const absolutePath = path.resolve(vaultRoot, requested);
    const relative = path.relative(vaultRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Output path 必須位於 OB-SF worktree：${requested}`);
    }
    return absolutePath;
}

function vaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath).split(path.sep).join("/");
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function targetFolder(target) {
    return target.replace(/[^a-z0-9._-]+/gi, "__");
}

function loadJSON(absolutePath) {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function createLinkedSourceClassifier(rootDirectory, sfFolders) {
    const root = path.resolve(rootDirectory);
    const realRoot = fs.realpathSync(root);
    const inside = (base, filename) => {
        const relative = path.relative(base, filename);
        return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
    };
    return linkTarget => {
        const target = String(linkTarget || "").trim().replaceAll("\\", "/").split("#", 1)[0].replace(/\.md$/i, "");
        if (!target || path.isAbsolute(target) || path.win32.isAbsolute(target) || target.includes(":")) return null;
        const candidates = target.includes("/") ? [path.resolve(root, target + ".md")]
            : sfFolders.map(folder => path.resolve(root, folder, target + ".md"));
        const matches = candidates.filter(filename => {
            if (!inside(root, filename)) return false;
            const relative = path.relative(root, filename).split(path.sep);
            if (!sfFolders.includes(relative[0])) return false;
            try { return fs.statSync(filename).isFile() && inside(realRoot, fs.realpathSync(filename)); }
            catch { return false; }
        });
        if (matches.length !== 1) return null;
        const evidence = path.relative(root, matches[0]).split(path.sep).join("/");
        return { provider: evidence.split("/")[0], evidence };
    };
}

function loadSharedPlanningContext() {
    const runtime = createMinecraftVanillaRuntime(vaultRoot);
    if (runtime.loadErrors.length > 0) {
        throw new Error(
            `Raw JSON 載入失敗 (${runtime.loadErrors.length})：${runtime.loadErrors[0].path}`
        );
    }
    const blocking = runtime.pipeline.diagnostics.filter(entry =>
        ["ERROR", "UNSUPPORTED", "REVIEW"].includes(entry.status)
    );
    if (blocking.length > 0) {
        throw new Error(`Pipeline 有 ${blocking.length} 個阻斷 diagnostics`);
    }
    const fingerprint = vanilla.dependencies.computeNormalizedRegistryFingerprint(
        runtime.pipeline.itemRegistry
    );
    const decisionRegistry = readReviewDecisionStore({
        jsonPath: path.join(vaultRoot, "Minecraft Review Decisions.json"),
        legacyMarkdownPath: path.join(vaultRoot, "Minecraft Review Decisions.md")
    }).registry;
    const globalBaseIndex = vanilla.dependencies.createGlobalBaseDecisionIndex(
        decisionRegistry
    );
    const globalDecisionIndex =
        vanilla.dependencies.createGlobalAmbiguityDecisionIndex(decisionRegistry);
    const tagMappingPath = path.join(vaultRoot, "Minecraft Tag BIO Mapping Draft.md");
    const tagMapping = fs.existsSync(tagMappingPath)
        ? vanilla.bio.parseTagBIOMappingMarkdown(
            fs.readFileSync(tagMappingPath, "utf8")
        )
        : { mappings: new Map(), diagnostics: [] };
    const groupMappingPath = path.join(vaultRoot, "Minecraft BIO Group Mapping Draft.md");
    const groupMapping = fs.existsSync(groupMappingPath)
        ? vanilla.bio.parseBIOGroupMappingMarkdown(
            fs.readFileSync(groupMappingPath, "utf8")
        )
        : { mappings: new Map(), diagnostics: [] };
    const machineMappingPath = path.join(vaultRoot, "Minecraft Machine Recipe Mapping Draft.md");
    const machineMappingBytes = fs.existsSync(machineMappingPath) ? fs.readFileSync(machineMappingPath) : null;
    const machineMapping = machineMappingBytes ? parseMachineRecipeMappings(machineMappingBytes.toString("utf8"))
        : { rules: [], diagnostics: [{ code: "MACHINE_MAPPING_FILE_MISSING", severity: "WARNING",
            message: "找不到 Minecraft Machine Recipe Mapping Draft.md；保留原分類" }] };
    const globalErrors = [
        ...globalBaseIndex.diagnostics,
        ...globalDecisionIndex.diagnostics,
        ...tagMapping.diagnostics,
        ...groupMapping.diagnostics
    ].filter(entry => entry.severity === "ERROR");
    if (globalErrors.length > 0) {
        throw new Error(`Global Decision／Tag Mapping 無效：${globalErrors[0].message}`);
    }
    return { runtime, fingerprint, globalBaseIndex, globalDecisionIndex, tagMapping, groupMapping,
        machineMapping, machineMappingSHA256: machineMappingBytes ? createHash("sha256").update(machineMappingBytes).digest("hex") : null };
}

function loadPlanningContext(target, shared) {
    const { runtime, fingerprint, globalBaseIndex, globalDecisionIndex, tagMapping, groupMapping,
        machineMapping, machineMappingSHA256 } = shared;
    const dependency = runtime.pipeline.resolveDependencies(target);
    const baselinePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        selectionPolicy: "none"
    });
    const baselineReview = vanilla.dependencies.createBaseMaterialReview(
        dependency,
        baselinePlan,
        { sourceFingerprint: fingerprint, globalBaseDecisionIndex: globalBaseIndex }
    );
    const baseItemIds = baselineReview.globalBaseDecisions.map(decision =>
        decision.itemId
    );
    const basePlan = runtime.pipeline.createBaseDependencyPlan(dependency, {
        baseItemIds,
        selectionPolicy: "none"
    });
    const analysis = vanilla.dependencies.createRecipeAmbiguityAnalysis(
        dependency,
        basePlan,
        { groups: new Map(), diagnostics: [], frontmatter: {} },
        {
            sourceFingerprint: fingerprint,
            baseItemIds,
            tagMappings: tagMapping.mappings,
            tagMappingDiagnostics: tagMapping.diagnostics,
            globalAmbiguitySelections: globalDecisionIndex.selections,
            globalAlternativePreferences: globalDecisionIndex.alternativePreferences,
            globalDecisionDiagnostics: globalDecisionIndex.diagnostics
        }
    );
    return {
        runtime,
        fingerprint,
        tagMappings: tagMapping.mappings,
        groupMappings: groupMapping.mappings,
        machineMappings: machineMapping.rules,
        machineMappingDiagnostics: machineMapping.diagnostics,
        machineMappingSHA256,
        baseItemIds,
        basePlan,
        dependency,
        analysis
    };
}

function verifyFormalAlternativeGroups(groupModels, bioRegistry, translations, kind = "derived") {
    const available = new Set(), diagnostics = [], itemNames = new Map();
    const register = (name, id) => {
        if (!name || !id) return;
        const matches = itemNames.get(name) ?? new Set();
        matches.add(id); itemNames.set(name, matches);
    };
    for (const entry of bioRegistry.entries ?? []) {
        if (!entry.normalizedId || !/^minecraft:/.test(entry.normalizedId)) continue;
        for (const name of [entry.name, entry.path?.replace(/\.md$/i, ""), ...(entry.aliases ?? [])]) register(name, entry.normalizedId);
    }
    for (const model of groupModels) for (const id of model.values) {
        register(id, id);
        register(vanilla.bio.resolveTranslatedName(id, translations), id);
    }
    for (const model of groupModels) {
        const identity = kind === "native" ? model.tagId : model.groupId;
        const matches = (bioRegistry.entries ?? []).filter(entry =>
            kind === "native" ? entry.tag_identity === "minecraft:item_tag" &&
                String(entry.minecraft_tag ?? "").replace(/^#/, "") === identity
                : entry.tag_identity === "obsf:derived_ingredient_group" && entry.derived_group === identity);
        if (!matches.length) continue;
        let confirmed = false;
        try {
            if (matches.length !== 1 || !matches[0].path) throw new Error("集合身分不唯一");
            const filename = safeVaultPath(matches[0].path);
            const realRelative = path.relative(fs.realpathSync(vaultRoot), fs.realpathSync(filename));
            if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) throw new Error("集合路徑不在 Vault");
            const parsed = bioReader.parseBIO(fs.readFileSync(filename, "utf8"), matches[0]);
            if (parsed.diagnostics.length || parsed.recipes.length !== 1 || !parsed.recipes[0].tagRepresentative) throw new Error("集合成員未完整解析");
            const ingredient = parsed.recipes[0].ingredients[0];
            const members = ingredient?.choices ?? (ingredient ? [ingredient] : []);
            const ids = members.map(member => {
                if (member.excludeSelf || Number(member.qty ?? 1) !== 1) return null;
                const known = itemNames.get(member.name);
                return known?.size === 1 ? [...known][0] : null;
            });
            const expected = new Set(model.values), actual = new Set(ids);
            confirmed = !actual.has(null) && ids.length === actual.size && actual.size === expected.size &&
                [...actual].every(id => expected.has(id));
        } catch { /* Preserve exact inline alternatives when formal membership cannot be proved. */ }
        if (confirmed) available.add(identity);
        else diagnostics.push({ [kind === "native" ? "tagId" : "groupId"]: identity,
            code: kind === "native" ? "FORMAL_TAG_MEMBERSHIP_UNCONFIRMED" : "FORMAL_GROUP_MEMBERSHIP_UNCONFIRMED", severity: "WARNING",
            message: "正式集合 BIO 的實際成員無法確認與來源完整集合一致；更新候選保留精確擇一清單" });
    }
    return { available, diagnostics };
}

function verifyFormalNativeTags(tagModels, bioRegistry, translations) {
    return verifyFormalAlternativeGroups(tagModels, bioRegistry, translations, "native");
}

function preferredPlanningRecipes(planning) {
    const preferred = new Map(planning.analysis.groups
        .filter(group => group.type === "recipe" && group.status === "RESOLVED" && group.selectedCandidateId?.startsWith("recipe-"))
        .map(group => [group.ownerItemId, group.selectedCandidateId]));
    for (const itemId of planning.analysis.generationOrder) {
        if (preferred.has(itemId)) continue;
        const routes = planning.basePlan.baseDependencyMap.get(itemId)?.candidateRoutes
            .filter(route => route.status === "ACYCLIC") ?? [];
        if (routes.length !== 1) continue;
        const selected = planning.dependency.graph.get(itemId)?.recipes.find(recipe => recipe.branchId === routes[0].branchId);
        if (selected) preferred.set(itemId, vanilla.dependencies.recipeIdentity(itemId, selected));
    }
    return preferred;
}

function uniquePreviewFilename(model, usedNames) {
    const original = model.filename;
    const key = original.toLowerCase();
    if (!usedNames.has(key)) {
        usedNames.add(key);
        return original;
    }
    const extension = path.extname(original);
    const base = original.slice(0, -extension.length);
    const fallback = `${base}--${model.bioId}${extension}`;
    usedNames.add(fallback.toLowerCase());
    return fallback;
}

function collectUsedTagIds(models) {
    const result = new Set();
    function visit(ingredient) {
        if (ingredient?.kind === "tag" && ingredient.id) result.add(ingredient.id);
        if (ingredient?.kind === "alternatives") {
            for (const choice of ingredient.alternatives ?? []) visit(choice);
        }
    }
    for (const model of models) {
        for (const recipe of model.recipes ?? []) {
            for (const ingredient of recipe.ingredients ?? []) visit(ingredient);
        }
    }
    return [...result].sort();
}

function collectPreviewTagModels(models, tagRegistry, tagMappings, bioRegistry) {
    const makeModel = tagId => vanilla.bio.createTagBIOGenerationModel(tagId, {
        tagRegistry, resolveTag: vanilla.tags.resolveTag, tagMappings
    });
    const result = collectUsedTagIds(models).map(makeModel);
    const known = new Set(result.map(model => model.tagId));
    const setKey = values => JSON.stringify([...new Set(values)].sort());
    const usedSets = new Set(result.filter(model => model.values.length).map(model => setKey(model.values)));
    const candidates = new Set([...tagMappings].filter(([, mapping]) => mapping.generate === true).map(([tagId]) => tagId));
    for (const entry of bioRegistry.entries ?? []) if (entry.tag_identity === "minecraft:item_tag") {
        const tagId = String(entry.minecraft_tag ?? "").replace(/^#/, "");
        if (/^minecraft:[a-z0-9_./-]+$/.test(tagId)) candidates.add(tagId);
    }
    for (const tagId of [...candidates].sort()) {
        if (known.has(tagId)) continue;
        const model = makeModel(tagId);
        if (model.values.length && usedSets.has(setKey(model.values))) { result.push(model); known.add(tagId); }
    }
    return result;
}

function renderTagNameReview(tagModels) {
    const lines = [
        "---",
        "type: minecraft-tag-bio-name-review",
        "schemaVersion: 1",
        "---",
        "",
        "# Minecraft Tag BIO Name Review",
        "",
        "> 請在根目錄 `Minecraft Tag BIO Mapping Draft.md` 修改名稱與 generate；本檔是當次 preview 使用到的摘要。",
        "",
        "| Tag ID | BIO ID | 中文名稱 | filename | generate | Representative Item ID | values |",
        "|---|---|---|---|---|---|---|"
    ];
    for (const model of tagModels) {
        lines.push(
            `| #${model.tagId} | ${model.bioId} | ${model.name === model.bioId ? "" : model.name} ` +
            `| ${model.filename.replace(/\.preview\.md$/i, ".md")} | ${model.generate} ` +
            `| ${model.representativeItemId} | ${model.values.length} |`
        );
    }
    lines.push("");
    return lines.join("\n");
}

function renderGroupNameReview(groupModels) {
    const lines = [
        "---",
        "type: minecraft-derived-bio-group-name-review",
        "schemaVersion: 1",
        "---",
        "",
        "# Derived Ingredient Group BIO Name Review",
        "",
        "> 請在根目錄 `Minecraft BIO Group Mapping Draft.md` 修改名稱與 generate。",
        "",
        "| Group ID | BIO ID | 中文名稱 | filename | generate | Representative Item ID | values |",
        "|---|---|---|---|---|---|---|"
    ];
    for (const model of groupModels) {
        lines.push(
            `| ${model.groupId} | ${model.bioId} | ${model.name === model.bioId ? "" : model.name} ` +
            `| ${model.filename.replace(/\.preview\.md$/i, ".md")} | ${model.generate} ` +
            `| ${model.representativeItemId} | ${model.values.length} |`
        );
    }
    lines.push("");
    return lines.join("\n");
}

function renderManifest(context) {
    const lines = [
        "---",
        "type: minecraft-bio-preview-manifest",
        "schemaVersion: 1",
        `target: ${context.target}`,
        `sourceFingerprint: ${context.fingerprint}`,
        "---",
        "",
        "# Minecraft BIO Preview Manifest",
        "",
        `- Target: \`${context.target}\``,
        `- Targets: ${(context.targets ?? [context.target]).map(target => "`" + target + "`").join("、")}`,
        `- Ready For BIO Generation: **${context.ready}**`,
        `- Planned Items: **${context.models.length}**`,
        `- Existing BIO: **${context.existingCount}**`,
        `- Missing BIO: **${context.models.length - context.existingCount}**`,
        `- Used Item Tags: **${context.tagModels.length}**`,
        `- Generated Tag BIO Previews: **${context.generatedTagModels.length}**`,
        `- Derived Ingredient Groups: **${context.groupModels.length}**`,
        `- Generated Derived BIO Previews: **${context.generatedGroupModels.length}**`,
        `- Warnings: **${context.warningCount}**`,
        `- Machine Mapping SHA256: \`${context.machineMappingSHA256 ?? "missing"}\``
    ];
    lines.push("", "## Tag BIO Previews", "");
    if (context.tagEntries.length === 0) lines.push("- 無（請先在 mapping table 填寫名稱並設為 `generate=true`）");
    else for (const entry of context.tagEntries) {
        lines.push(`- \`#${entry.tagId}\` → [[${entry.filename.replace(/\.md$/i, "")}]]`);
    }
    lines.push("", "## Derived Ingredient Group BIO Previews", "");
    if (context.groupEntries.length === 0) lines.push("- 無");
    else for (const entry of context.groupEntries) {
        lines.push(`- \`${entry.groupId}\` → [[${entry.filename.replace(/\.md$/i, "")}]]`);
    }
    lines.push("", "## Warnings", "");
    const warnings = [
        ...context.models.map(model => ({ identity: model.itemId, model })),
        ...context.tagModels.map(model => ({ identity: `#${model.tagId}`, model })),
        ...context.groupModels.map(model => ({ identity: model.groupId, model }))
    ].flatMap(entry => entry.model.diagnostics.map(diagnostic => ({
        identity: entry.identity,
        ...diagnostic
    }))).concat((context.machineMappingDiagnostics ?? []).map(diagnostic => ({
        identity: diagnostic.itemId || "Machine Mapping", ...diagnostic
    })));
    if (warnings.length === 0) lines.push("- 無");
    else for (const warning of warnings) {
        lines.push(`- ${warning.severity} ${warning.code}：${warning.identity} — ${warning.message}`);
    }
    lines.push("");
    return lines.join("\n");
}

function preview(rawTargets) {
    const targets = [...new Set((Array.isArray(rawTargets) ? rawTargets : [rawTargets]).map(rawTarget => {
        const target = vanilla.bio.canonicalMinecraftId(rawTarget);
        if (!target) throw new Error(`無效 target：${rawTarget}`);
        return target;
    }))];
    const target = targets[0];
    const shared = loadSharedPlanningContext();
    const contexts = targets.map(target => {
        const context = loadPlanningContext(target, shared);
        return { ...context, target, preferredRecipeByItem: preferredPlanningRecipes(context) };
    });
    const planning = mergeBIOPreviewContexts(contexts);
    const machineMappingDiagnostics = [...planning.machineMappingDiagnostics];
    const translations = loadJSON(
        path.join(vaultRoot, "參考資料", "Minecraft", "zh_tw.json")
    );
    const bioRegistry = vanilla.bio.scanMinecraftBIOs(
        path.join(vaultRoot, "MC-物品資料庫"),
        { vaultRoot }
    );
    const preferredRecipeByItem = planning.preferredRecipeByItem;
    const alternativeSelectionsByRecipe = new Map();
    for (const group of planning.analysis.groups) {
        if (group.type !== "alternative" || group.status !== "RESOLVED") continue;
        const selected = group.candidates.find(candidate =>
            candidate.candidateId === group.selectedCandidateId
        )?.ingredient;
        if (!selected) continue;
        if (!alternativeSelectionsByRecipe.has(group.recipeId)) {
            alternativeSelectionsByRecipe.set(group.recipeId, []);
        }
        alternativeSelectionsByRecipe.get(group.recipeId).push(selected);
    }
    const naturalLogIds = new Set(
        vanilla.tags.resolveTag(
            "minecraft:logs",
            planning.runtime.pipeline.tagRegistry,
            "item"
        ).values.filter(itemId => /^minecraft:(?!stripped_)[a-z0-9_]+_(?:log|stem)$/.test(itemId))
    );
    const models = planning.analysis.generationOrder.map(itemId =>
        vanilla.bio.createBIOGenerationModel(itemId, {
            itemRegistry: planning.runtime.pipeline.itemRegistry,
            translations,
            bioRegistry,
            externalBase: planning.baseItemIds.includes(itemId),
            naturalLog: naturalLogIds.has(itemId),
            preferredRecipeId: preferredRecipeByItem.get(itemId) ?? null,
            alternativeSelections: alternativeSelectionsByRecipe
        })
    );
    const itemTypes = new Map(models.map(model => [model.itemId, model.type]));
    const usedNames = new Set();
    const entries = models.map(model => ({
        itemId: model.itemId,
        filename: uniquePreviewFilename(model, usedNames),
        existingBIO: Boolean(model.existingBIO)
    }));
    const tagModels = collectPreviewTagModels(models, planning.runtime.pipeline.tagRegistry, planning.tagMappings, bioRegistry);
    const nativeTagValues = new Map(tagModels.map(model => [model.tagId, model.values]));
    const formalTags = verifyFormalNativeTags(tagModels, bioRegistry, translations);
    for (const diagnostic of formalTags.diagnostics) tagModels.find(model => model.tagId === diagnostic.tagId)?.diagnostics.push(diagnostic);
    const generatedTagModels = tagModels.filter(model =>
        model.generate &&
        !model.diagnostics.some(diagnostic => diagnostic.severity === "ERROR")
    );
    const tagEntries = generatedTagModels.map(model => ({
        tagId: model.tagId,
        filename: uniquePreviewFilename(model, usedNames)
    }));
    const previewAvailableNativeTags = new Set([...formalTags.available, ...generatedTagModels.map(model => model.tagId)]);
    const groupModels = vanilla.bio.collectDerivedAlternativeGroups(models, planning.runtime.pipeline.itemRegistry).map(group =>
        vanilla.bio.createDerivedGroupBIOGenerationModel(group.groupId, group.values, {
            groupMappings: planning.groupMappings
        })
    );
    const alternativeGroupValues = new Map(groupModels.map(model => [model.groupId, model.values]));
    const formalGroups = verifyFormalAlternativeGroups(groupModels, bioRegistry, translations);
    for (const diagnostic of formalGroups.diagnostics) {
        groupModels.find(model => model.groupId === diagnostic.groupId)?.diagnostics.push(diagnostic);
    }
    const generatedGroupModels = groupModels.filter(model =>
        model.generate &&
        !model.diagnostics.some(diagnostic => diagnostic.severity === "ERROR")
    );
    const groupEntries = generatedGroupModels.map(model => ({
        groupId: model.groupId,
        filename: uniquePreviewFilename(model, usedNames)
    }));
    const previewAvailableAlternativeGroups = new Set([...formalGroups.available, ...generatedGroupModels.map(model => model.groupId)]);
    const mappingErrors = [...tagModels, ...groupModels]
        .filter(model => model.generate)
        .flatMap(model => model.diagnostics
            .filter(diagnostic => diagnostic.severity === "ERROR")
            .map(diagnostic => diagnostic.message));
    if (mappingErrors.length) {
        throw new Error(`已啟用的 BIO mapping 尚未完整（${mappingErrors.length}）：${mappingErrors.join("；")}`);
    }
    const outputRoot = safeVaultPath(option("output-root", "MC-自動化BIO"));
    const runDirectory = path.join(
        outputRoot,
        "preview",
        targets.length > 1 ? "batch" : targetFolder(target),
        timestamp()
    );
    const previewTarget = filename =>
        vaultPath(path.join(runDirectory, filename)).replace(/\.md$/i, "");
    const itemPreviewTargets = new Map(entries.map(entry =>
        [entry.itemId, previewTarget(entry.filename)]
    ));
    const tagPreviewTargets = new Map(tagEntries.map(entry =>
        [entry.tagId, previewTarget(entry.filename)]
    ));
    const groupPreviewTargets = new Map(groupEntries.map(entry =>
        [entry.groupId, previewTarget(entry.filename)]
    ));
    const previewReferenceTargets = new Map();
    for (const model of models) previewReferenceTargets.set(model.itemId, {
        target: itemPreviewTargets.get(model.itemId), label: model.name
    });
    for (const model of generatedTagModels) previewReferenceTargets.set("tag:" + model.tagId, {
        target: tagPreviewTargets.get(model.tagId), label: model.name
    });
    for (const model of generatedGroupModels) previewReferenceTargets.set("group:" + model.groupId, {
        target: groupPreviewTargets.get(model.groupId), label: model.name
    });
    const previewTagMembers = new Map([...nativeTagValues,
        ...[...alternativeGroupValues].map(([groupId, values]) => ["group:" + groupId, values])]);
    const previewRenderOptions = {
        translations, bioRegistry, tagMappings: planning.tagMappings,
        alternativeGroupMappings: planning.groupMappings, alternativeGroupValues, nativeTagValues,
        availableNativeTags: previewAvailableNativeTags,
        availableAlternativeGroups: previewAvailableAlternativeGroups,
        itemPreviewTargets, tagPreviewTargets, groupPreviewTargets, itemTypes,
        machineMappings: planning.machineMappings, machineMappingDiagnostics
    };
    const renderedPreviews = models.map(model => vanilla.bio.renderBIOPreview(model, previewRenderOptions));
    const updatePlans = [];
    if (hasFlag("update-existing")) {
        const names = new Map();
        const actualNames = new Map();
        const previewNames = new Map();
        const addName = (index, name, identity) => {
            if (!name || !identity) return;
            const values = index.get(name) || new Set();
            values.add(identity); index.set(name, values);
        };
        const register = (name, identity) => {
            addName(names, name, identity);
        };
        for (const entry of bioRegistry.entries) {
            const identity = entry.tag_identity === "minecraft:item_tag" && entry.minecraft_tag
                ? "tag:" + String(entry.minecraft_tag).replace(/^#/, "")
                : entry.tag_identity === "obsf:derived_ingredient_group" && entry.derived_group
                    ? "group:" + entry.derived_group : entry.normalizedId;
            for (const name of [entry.name, entry.path.replace(/\.md$/i, ""), ...entry.aliases]) register(name, identity);
            for (const name of [entry.name, entry.path.replace(/\.md$/i, "")]) addName(actualNames, name, identity);
        }
        for (const [name, identities] of actualNames) previewNames.set(name, new Set(identities));
        for (const model of models) {
            register(model.name, model.itemId);
            register(model.itemId, model.itemId);
        }
        for (const [tagId, mapping] of planning.tagMappings) {
            register(mapping.zhName, "tag:" + tagId);
            register(String(mapping.filename || "").replace(/\.md$/i, ""), "tag:" + tagId);
        }
        for (const [groupId, mapping] of planning.groupMappings) {
            register(mapping.zhName, "group:" + groupId);
            register(String(mapping.filename || "").replace(/\.md$/i, ""), "group:" + groupId);
        }
        for (const ids of previewTagMembers.values()) for (const id of ids) {
            register(id, id);
            register(vanilla.bio.resolveTranslatedName(id, translations), id);
        }
        for (const [identity, reference] of previewReferenceTargets) {
            addName(previewNames, identity, identity);
            addName(previewNames, reference.target, identity);
            addName(previewNames, reference.target + ".md", identity);
            addName(previewNames, reference.target.split("/").at(-1), identity);
            addName(previewNames, reference.label, identity);
        }
        const resolveWith = (index, name) => {
            const actual = index.get(name);
            if (actual) return actual.size === 1 ? [...actual][0] : name;
            const values = names.get(name);
            return values?.size === 1 ? [...values][0] : name;
        };
        const resolveName = name => resolveWith(actualNames, name);
        const resolvePreviewName = name => resolveWith(previewNames, name);
        const sfFolders = fs.readdirSync(vaultRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith("SF-")).map(entry => entry.name);
        const classifyLinkedSource = createLinkedSourceClassifier(vaultRoot, sfFolders);
        const classifyExistingRoute = route => {
            if (!route.machine || /[\\/]/.test(route.machine)) return null;
            const matches = sfFolders.map(folder => path.join(vaultRoot, folder, route.machine + ".md"))
                .filter(filename => fs.existsSync(filename) && fs.statSync(filename).isFile());
            if (matches.length !== 1) return null;
            const metadata = vanilla.bio.readFrontmatterPrefix(matches[0]);
            if (!String(metadata?.type || "").startsWith("sf-")) return null;
            return { provider: /\(原版\)$/.test(path.basename(path.dirname(matches[0])))
                ? "Slimefun 原版" : path.basename(path.dirname(matches[0])), evidence: vaultPath(matches[0]) };
        };
        for (let index = 0; index < models.length; index++) {
            const model = models[index];
            if (!model.existingBIO) {
                updatePlans.push({ itemId: model.itemId, status: "NEW", diagnostics: [] });
                continue;
            }
            const duplicates = bioRegistry.collisions.filter(entry => entry.normalizedId === model.itemId);
            if (duplicates.length) {
                updatePlans.push({ itemId: model.itemId, status: "REVIEW", diagnostics: duplicates.map(entry => ({
                    code: "DUPLICATE_BIO_ID", message: entry.first + " ／ " + entry.duplicate
                })) });
                continue;
            }
            const sourcePath = model.existingBIO.path;
            const original = fs.readFileSync(safeVaultPath(sourcePath), "utf8");
            // Update candidates must use formal names, never timestamped preview links.
            const generated = vanilla.bio.renderBIOPreview(model, {
                translations, bioRegistry, tagMappings: planning.tagMappings,
                alternativeGroupMappings: planning.groupMappings, alternativeGroupValues, nativeTagValues,
                availableNativeTags: formalTags.available,
                availableAlternativeGroups: formalGroups.available, itemTypes,
                machineMappings: planning.machineMappings, machineMappingDiagnostics
            });
            const plan = vanilla.bio.planBIOUpdate(original, generated, { resolveName, classifyExistingRoute, classifyLinkedSource,
                groupExistingRoutes: true, machineMappings: planning.machineMappings });
            const visualPlan = vanilla.bio.planBIOUpdate(original, renderedPreviews[index], {
                resolveName: resolvePreviewName, classifyExistingRoute, classifyLinkedSource,
                groupExistingRoutes: true, machineMappings: planning.machineMappings, allowPreviewLinks: true
            });
            const rewritten = rewriteBIOForPreview(visualPlan.candidate, {
                resolveName: resolvePreviewName, targets: previewReferenceTargets, tagMembers: previewTagMembers
            });
            const previewDiagnostics = [...new Map([...(visualPlan.diagnostics ?? []), ...(rewritten.diagnostics ?? [])]
                .map(diagnostic => [JSON.stringify(diagnostic), diagnostic])).values()];
            updatePlans.push({ itemId: model.itemId, sourcePath,
                sourceSHA256: createHash("sha256").update(original).digest("hex"),
                ...plan, candidateSHA256: createHash("sha256").update(plan.candidate).digest("hex"), candidateFilename: plan.candidate !== original
                    ? "formal-candidates/" + entries[index].filename.replace(/(?:\.preview)?\.md$/i, ".formal-candidate.md") : null,
                previewMarkdown: rewritten.text,
                previewFilename: "updates/" + entries[index].filename.replace(/(?:\.preview)?\.md$/i, ".update-preview.md"),
                previewSHA256: createHash("sha256").update(rewritten.text).digest("hex"), previewStatus: visualPlan.status,
                previewDiagnostics });
        }
    }
    const uniqueMachineDiagnostics = [...new Map(machineMappingDiagnostics.map(diagnostic =>
        [JSON.stringify(diagnostic), diagnostic])).values()];
    const dryRun = hasFlag("dry-run");
    if (!dryRun) {
        if (fs.existsSync(runDirectory)) {
            throw new Error(`Fresh preview directory 已存在：${vaultPath(runDirectory)}`);
        }
        fs.mkdirSync(runDirectory, { recursive: true });
        if (hasFlag("update-existing")) {
            fs.mkdirSync(path.join(runDirectory, "updates"));
            fs.mkdirSync(path.join(runDirectory, "formal-candidates"));
            for (const plan of updatePlans) {
                if (plan.candidateFilename) writeFileWithRetrySync(path.join(runDirectory, plan.candidateFilename), plan.candidate);
                if (plan.previewFilename) writeFileWithRetrySync(path.join(runDirectory, plan.previewFilename), plan.previewMarkdown);
            }
            writeFileWithRetrySync(path.join(runDirectory, "BIO Update Review.json"),
                JSON.stringify({ schemaVersion: 1, mergeVersion: vanilla.bio.BIO_UPDATE_MERGE_VERSION, target, targets, sourceFingerprint: planning.fingerprint,
                    machineMappingSHA256: planning.machineMappingSHA256,
                    plans: updatePlans.map(({ candidate, previewMarkdown, ...plan }) => plan) }, null, 2));
            const lines = ["# BIO 更新審核", "", "> updates 是保留原內容並連結本批 BIO 的測試預覽；正式套用只讀取 formal-candidates。不寫回正式 BIO。REVIEW 項目需人工確認。", ""];
            for (const plan of updatePlans) {
                lines.push("- " + plan.status + "：" + plan.itemId + (plan.sourcePath ? "（" + plan.sourcePath + "）" : ""));
                if (plan.previewFilename) lines.push("  - 測試預覽：[[" + previewTarget(plan.previewFilename) + "|開啟 update-preview]]");
                if (plan.candidateFilename) lines.push("  - 正式套用候選：[[" + previewTarget(plan.candidateFilename) + "|開啟 formal-candidate]]");
                else if (plan.sourcePath) lines.push("  - 正式套用候選：未產生（本次沒有可寫回的內容差異）");
                for (const diagnostic of plan.diagnostics) {
                    lines.push("  - " + diagnostic.code + (diagnostic.field ? "（" + diagnostic.field + "）" : "") + "：" + (diagnostic.message || "請人工確認"));
                    if (diagnostic.existing) lines.push("    - 原內容：`" + JSON.stringify(diagnostic.existing).replaceAll("`", "\\u0060") + "`");
                    if (diagnostic.incoming) lines.push("    - 新來源：`" + JSON.stringify(diagnostic.incoming).replaceAll("`", "\\u0060") + "`");
                }
                for (const preserved of plan.preservedRoutes || []) lines.push(
                    "  - " + preserved.code + "（" + preserved.provider + "）：" + preserved.message +
                    (preserved.evidence ? "；設備 BIO：" + preserved.evidence : ""));
                for (const diagnostic of plan.previewDiagnostics || []) lines.push(
                    "  - 預覽 " + diagnostic.code + "：" + (diagnostic.message || "請檢查測試預覽"));
            }
            writeFileWithRetrySync(path.join(runDirectory, "BIO Update Review.md"), lines.join("\n") + "\n");
        }
        for (let index = 0; index < models.length; index++) {
            writeFileWithRetrySync(
                path.join(runDirectory, entries[index].filename),
                renderedPreviews[index]
            );
        }
        for (let index = 0; index < generatedTagModels.length; index++) {
            const markdown = vanilla.bio.renderTagBIOPreview(generatedTagModels[index], {
                translations,
                bioRegistry,
                itemPreviewTargets,
                itemTypes
            });
            writeFileWithRetrySync(
                path.join(runDirectory, tagEntries[index].filename),
                markdown
            );
        }
        for (let index = 0; index < generatedGroupModels.length; index++) {
            const markdown = vanilla.bio.renderTagBIOPreview(generatedGroupModels[index], {
                translations,
                bioRegistry,
                itemPreviewTargets,
                itemTypes
            });
            writeFileWithRetrySync(
                path.join(runDirectory, groupEntries[index].filename),
                markdown
            );
        }
        writeFileWithRetrySync(
            path.join(runDirectory, "Tag BIO Name Review.md"),
            renderTagNameReview(tagModels)
        );
        writeFileWithRetrySync(
            path.join(runDirectory, "Derived BIO Group Name Review.md"),
            renderGroupNameReview(groupModels)
        );
        writeFileWithRetrySync(
            path.join(runDirectory, "BIO Preview Manifest.md"),
            renderManifest({
                target,
                targets,
                fingerprint: planning.fingerprint,
                ready: true,
                models,
                entries,
                tagModels,
                generatedTagModels,
                tagEntries,
                groupModels,
                generatedGroupModels,
                groupEntries,
                machineMappingSHA256: planning.machineMappingSHA256,
                machineMappingDiagnostics: uniqueMachineDiagnostics,
                existingCount: models.filter(model => model.existingBIO).length,
                warningCount: [...models, ...tagModels, ...groupModels].reduce(
                    (sum, model) => sum + model.diagnostics.length,
                    uniqueMachineDiagnostics.length
                )
            })
        );
    }
    process.stdout.write("Minecraft BIO Generator Preview:\n");
    process.stdout.write(`- target: ${target}\n`);
    process.stdout.write(`- targets: ${targets.join(", ")}\n`);
    process.stdout.write(`- sourceFingerprint: ${planning.fingerprint}\n`);
    process.stdout.write(`- readyForBioGeneration: true\n`);
    process.stdout.write(`- generationOrder: ${models.length}\n`);
    process.stdout.write(`- existingBIO: ${models.filter(model => model.existingBIO).length}\n`);
    process.stdout.write(`- missingBIO: ${models.filter(model => !model.existingBIO).length}\n`);
    process.stdout.write(`- usedItemTags: ${tagModels.length}\n`);
    process.stdout.write(`- generatedTagBIOs: ${generatedTagModels.length}\n`);
    process.stdout.write(`- derivedGroups: ${groupModels.length}\n`);
    process.stdout.write(`- generatedDerivedBIOs: ${generatedGroupModels.length}\n`);
    process.stdout.write(`- warnings: ${[...models, ...tagModels, ...groupModels].reduce((sum, model) => sum + model.diagnostics.length, uniqueMachineDiagnostics.length)}\n`);
    process.stdout.write(`- machineMappingDiagnostics: ${uniqueMachineDiagnostics.length}\n`);
    for (const diagnostic of uniqueMachineDiagnostics) {
        process.stdout.write(`  - ${diagnostic.severity || "WARNING"} ${diagnostic.code}：${diagnostic.itemId || "Machine Mapping"} — ${diagnostic.message || "保留原分類，請檢查 mapping"}\n`);
    }
    if (hasFlag("update-existing")) {
        process.stdout.write(`- updatePreviews: ${updatePlans.filter(plan => plan.previewFilename).length}\n`);
        process.stdout.write(`- formalCandidates: ${updatePlans.filter(plan => plan.candidateFilename).length}\n`);
        process.stdout.write(`- updatePreviewDiagnostics: ${updatePlans.reduce((sum, plan) => sum + (plan.previewDiagnostics?.length || 0), 0)}\n`);
        for (const status of ["NEW", "UNCHANGED", "ADDITIVE_UPDATE", "REVIEW"]) {
            process.stdout.write(`- update${status}: ${updatePlans.filter(plan => plan.status === status).length}\n`);
        }
    }
    process.stdout.write(`- output: ${dryRun ? "no (dry-run)" : vaultPath(runDirectory)}\n`);
}

function usage() {
    process.stderr.write(
        "Usage:\n" +
        "  node scripts/minecraft-bio-generator.cjs preview minecraft:piston\n" +
        "  node scripts/minecraft-bio-generator.cjs preview minecraft:piston --dry-run\n"
        + "  node scripts/minecraft-bio-generator.cjs preview minecraft:piston --update-existing\n"
        + "  node scripts/minecraft-bio-generator.cjs preview minecraft:stick minecraft:soul_campfire --update-existing\n"
    );
}

try {
    const command = process.argv[2];
    const targets = process.argv.slice(3).filter(argument => !argument.startsWith("--"));
    if (command !== "preview" || targets.length === 0) {
        usage();
        process.exitCode = 1;
    } else {
        preview(targets);
    }
} catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
}
