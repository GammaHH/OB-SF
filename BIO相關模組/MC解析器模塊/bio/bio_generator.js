// ============================================================
// Minecraft Vanilla BIO Generator V1 preview model + renderer
// Pure module: no filesystem access and no Obsidian API dependency.
// ============================================================

const GENERATOR_SCHEMA_VERSION = 2;
const { recipeIdentity } = require("../dependencies/recipe_review");
const { derivedAlternativeGroupId, MINECRAFT_COLORS } = require("./bio_group_mapping");
const { managedTagsFor } = require("./bio_tags");
const { classifyMachineRecipe } = require("./machine_recipe_mapping");
const BIO_RECIPE_TYPE_DICT = Object.freeze({
    "minecraft:crafting_shaped": { section: "合成配方", machine: "工作台" },
    "minecraft:crafting_shapeless": { section: "合成配方", machine: "工作台" },
    "minecraft:crafting_transmute": { section: "合成配方", machine: "工作台" },
    "minecraft:smelting": { section: "熔煉配方", machine: "熔爐" },
    "minecraft:blasting": { section: "熔煉配方", machine: "高爐" },
    "minecraft:smoking": { section: "煙燻配方", machine: "煙燻爐" },
    "minecraft:campfire_cooking": { section: "營火料理", machine: "營火" },
    "minecraft:stonecutting": { section: "切石", machine: "切石機" },
    "minecraft:smithing_transform": { section: "鍛造配方", machine: "鍛造台" }
});

function canonicalItemId(rawId) {
    const value = String(rawId ?? "").trim().toLowerCase();
    if (/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) return value;
    if (/^[a-z0-9_./-]+$/.test(value)) return `minecraft:${value}`;
    return null;
}

function itemPath(itemId) {
    const canonical = canonicalItemId(itemId);
    return canonical ? canonical.slice(canonical.indexOf(":") + 1) : null;
}

function bioIdForItem(itemId) {
    const value = itemPath(itemId);
    return value ? value.toUpperCase() : null;
}

function aliasesForItem(itemId) {
    const canonical = canonicalItemId(itemId);
    const bioId = bioIdForItem(canonical);
    return [...new Set([bioId, canonical].filter(Boolean))];
}

function smithingTemplateName(itemId, translations = {}) {
    const canonical = canonicalItemId(itemId);
    if (!/^minecraft:(?:[a-z0-9_]+_armor_trim|netherite_upgrade)_smithing_template$/.test(canonical ?? "")) return null;
    return translations[`item.${canonical.replace(":", ".")}.new`]?.trim() || null;
}

function resolveTranslatedName(itemId, translations = {}) {
    const canonical = canonicalItemId(itemId);
    if (!canonical) return null;
    const [namespace, value] = canonical.split(":", 2);
    return smithingTemplateName(canonical, translations) ??
        translations[`item.${namespace}.${value}`] ??
        translations[`block.${namespace}.${value}`] ??
        null;
}

function fallbackName(itemId) {
    return itemPath(itemId)?.replaceAll("_", " ") ?? "unknown";
}

function safeFilename(name, fallback) {
    const sanitized = String(name ?? "")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim();
    return sanitized || fallback;
}

function normalizedMappings(value) {
    if (value instanceof Map) return value;
    return new Map(Object.entries(value ?? {}));
}

function sortRecipes(recipes = []) {
    return [...recipes].sort((left, right) => {
        const leftKey = `${left?.meta?.sourceFile ?? ""}\u0000${left?.sourceType ?? ""}`;
        const rightKey = `${right?.meta?.sourceFile ?? ""}\u0000${right?.sourceType ?? ""}`;
        return leftKey.localeCompare(rightKey);
    });
}

function bioRecipeTypeInfo(recipe = {}) {
    return BIO_RECIPE_TYPE_DICT[recipe.sourceType] ?? {
        section: recipe.section ? `${recipe.section}配方` : "其他配方",
        machine: recipe.machine ?? "無/手動"
    };
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createBIOGenerationModel(itemId, options = {}) {
    const canonical = canonicalItemId(itemId);
    if (!canonical) throw new TypeError(`無效 Minecraft item ID：${itemId}`);
    const registryItem = options.itemRegistry?.get?.(canonical) ?? null;
    const existingBIO = options.bioRegistry?.get?.(canonical) ?? null;
    const requestedLevel = options.level !== undefined ? options.level : existingBIO?.level;
    const level = requestedLevel == null ? "" : requestedLevel;
    const translatedName = resolveTranslatedName(canonical, options.translations);
    const name = existingBIO?.name ?? translatedName ?? fallbackName(canonical);
    const bioId = bioIdForItem(canonical);
    const sortedRecipes = sortRecipes(registryItem?.recipes ?? []);
    const naturalLog = options.naturalLog === true && sortedRecipes.length === 0;
    const externalBase = options.externalBase === true;
    const preferredRecipeId = options.preferredRecipeId ??
        (sortedRecipes.length ? recipeIdentity(canonical, sortedRecipes[0]) : null);
    const alternativeSelections = options.alternativeSelections instanceof Map
        ? options.alternativeSelections
        : new Map(Object.entries(options.alternativeSelections ?? {}));
    const recipes = sortedRecipes.map((recipe, index) => {
        const display = bioRecipeTypeInfo(recipe);
        const routeId = recipeIdentity(canonical, recipe);
        const selectedAlternatives = alternativeSelections.get(routeId) ?? [];
        let alternativeIndex = 0;
        const ingredients = clone(recipe.ingredients ?? []).map(ingredient => {
            if (ingredient?.kind !== "alternatives") return ingredient;
            const selected = selectedAlternatives[alternativeIndex++] ?? null;
            return selected ? { ...ingredient, selectedRepresentative: clone(selected) } : ingredient;
        });
        return {
            routeIndex: index,
            routeId,
            preferred:
                !externalBase && routeId === preferredRecipeId,
            sourceType: recipe.sourceType ?? null,
            section: display.section,
            normalizedSection: recipe.section ?? null,
            machine: recipe.machine ?? display.machine,
            output: Number(recipe.output ?? 1),
            ingredients,
            meta: clone(recipe.meta ?? {})
        };
    });
    const diagnostics = [];
    const levelText = String(level).trim();
    if (levelText && (!/^\d+$/.test(levelText) || !Number.isSafeInteger(Number(levelText)))) diagnostics.push({
        code: "BIO_LEVEL_REQUIRES_REVIEW", severity: "WARNING",
        message: `${canonical} 的既有 LEVEL 不是空白或非負整數；保留原值待人工確認`
    });
    const type = existingBIO?.type === "mc-drop" ? "mc-drop" : "mc-item";
    if (!existingBIO && recipes.length === 0) {
        diagnostics.push({
            code: "TYPE_REVIEW_REQUIRED",
            severity: "WARNING",
            message: `${canonical} 沒有 recipe；External Base 不足以判定 mc-item 或 mc-drop`
        });
    }
    return {
        schemaVersion: GENERATOR_SCHEMA_VERSION,
        itemId: canonical,
        bioId,
        aliases: aliasesForItem(canonical),
        name,
        filename: `${safeFilename(name, bioId)}.preview.md`,
        type,
        level,
        existingBIO,
        recipes,
        externalBase,
        naturalLog,
        isLeaf: recipes.length === 0,
        diagnostics
    };
}

function createTagBIOGenerationModel(tagId, options = {}) {
    const canonical = String(tagId ?? "").trim().replace(/^#/, "");
    if (!/^minecraft:[a-z0-9_./-]+$/.test(canonical)) {
        throw new TypeError(`無效 Minecraft item tag ID：${tagId}`);
    }
    const mapping = normalizedMappings(options.tagMappings).get(canonical) ?? {};
    const resolved = options.resolveTag(canonical, options.tagRegistry, "item");
    const values = [...new Set(resolved.values ?? [])].sort();
    const representativeItemId = mapping.representativeItemId || values[0] || "";
    const bioId = String(mapping.bioId || itemPath(canonical)?.toUpperCase() || "TAG");
    const name = String(mapping.zhName || "").trim();
    const filenameBase = String(mapping.filename || name || bioId).replace(/\.md$/i, "");
    const diagnostics = [];
    if (!name) diagnostics.push({
        code: "TAG_BIO_NAME_REQUIRED",
        severity: mapping.generate === true ? "ERROR" : "WARNING",
        message: `#${canonical} 尚未填寫中文名稱`
    });
    if (!representativeItemId || !values.includes(representativeItemId)) {
        diagnostics.push({
            code: "TAG_BIO_REPRESENTATIVE_REQUIRED",
            severity: "ERROR",
            message: `#${canonical} 的 representative item 無效或不在 Tag values`
        });
    }
    for (const warning of resolved.warnings ?? []) diagnostics.push({
        code: "TAG_RESOLUTION_WARNING",
        severity: "WARNING",
        message: warning
    });
    return {
        schemaVersion: GENERATOR_SCHEMA_VERSION,
        kind: "minecraft:item_tag",
        tagId: canonical,
        bioId,
        aliases: [...new Set([bioId, `#${canonical}`])],
        name: name || bioId,
        filename: `${safeFilename(filenameBase, bioId)}.preview.md`,
        representativeItemId,
        values,
        generate: mapping.generate === true,
        diagnostics
    };
}

function createDerivedGroupBIOGenerationModel(groupId, values, options = {}) {
    const canonical = String(groupId ?? "").trim();
    if (!/^obsf:[a-z0-9_./-]+$/.test(canonical)) {
        throw new TypeError(`無效 OB-SF derived group ID：${groupId}`);
    }
    const mapping = normalizedMappings(options.groupMappings).get(canonical) ?? {};
    const normalizedValues = [...new Set((values ?? [])
        .map(value => canonicalItemId(value))
        .filter(Boolean))].sort();
    const representativeItemId = mapping.representativeItemId || normalizedValues[0] || "";
    const bioId = String(mapping.bioId || canonical.split("/").at(-1)?.toUpperCase() || "GROUP");
    const name = String(mapping.zhName || "").trim();
    const filenameBase = String(mapping.filename || name || bioId).replace(/\.md$/i, "");
    const diagnostics = [];
    if (!name) diagnostics.push({
        code: "DERIVED_GROUP_NAME_REQUIRED",
        severity: mapping.generate === true ? "ERROR" : "WARNING",
        message: `${canonical} 尚未填寫中文名稱`
    });
    if (!representativeItemId || !normalizedValues.includes(representativeItemId)) {
        diagnostics.push({
            code: "DERIVED_GROUP_REPRESENTATIVE_REQUIRED",
            severity: "ERROR",
            message: `${canonical} 的 representative item 無效或不在 alternatives`
        });
    }
    return {
        schemaVersion: GENERATOR_SCHEMA_VERSION,
        kind: "obsf:derived_ingredient_group",
        groupId: canonical,
        bioId,
        aliases: [...new Set([bioId, canonical])],
        name: name || bioId,
        filename: `${safeFilename(filenameBase, bioId)}.preview.md`,
        representativeItemId,
        values: normalizedValues,
        generate: mapping.generate === true,
        diagnostics
    };
}

function itemLink(itemId, context) {
    const canonical = canonicalItemId(itemId);
    const existing = context.bioRegistry?.get?.(canonical);
    const name = existing?.name ??
        resolveTranslatedName(canonical, context.translations) ??
        fallbackName(canonical);
    const previewTarget = context.itemPreviewTargets?.get(canonical);
    return previewTarget ? `[[${previewTarget}|${name}]]` : `[[${name}]]`;
}

function aliasedItemLink(itemId, alias, context) {
    const link = itemLink(itemId, context);
    const target = link.slice(2, -2).split("|", 1)[0];
    return alias ? `[[${target}|${alias}]]` : link;
}

function sharedCollectionTagTarget(ingredient, context) {
    if (!Array.isArray(ingredient.values) || !ingredient.values.length) return null;
    const expected = new Set(ingredient.values.map(canonicalItemId));
    if (expected.has(null) || expected.size !== ingredient.values.length) return null;
    const matches = new Map();
    let unresolved = false;
    const collect = (identity, values, available, previewTargets, kind) => {
        if (!available?.has(identity) || !Array.isArray(values)) return;
        const actual = new Set(values.map(canonicalItemId));
        if (actual.has(null) || actual.size !== values.length || actual.size !== expected.size ||
            [...actual].some(id => !expected.has(id))) return;
        let target = previewTargets?.get(identity);
        if (!target) {
            const formal = (context.bioRegistry?.entries ?? []).filter(entry =>
                (kind === "native" ? entry.tag_identity === "minecraft:item_tag" &&
                    String(entry.minecraft_tag ?? "").replace(/^#/, "") === identity
                    : entry.tag_identity === "obsf:derived_ingredient_group" && entry.derived_group === identity) &&
                typeof entry.path === "string" && /\.md$/i.test(entry.path));
            target = formal.length === 1 ? formal[0].path.replace(/\.md$/i, "") : null;
        }
        if (!target) { unresolved = true; return; }
        matches.set(target.replaceAll("\\", "/").replace(/\.md$/i, ""), target);
    };
    for (const [tagId, values] of normalizedMappings(context.nativeTagValues)) {
        collect(tagId, values, context.availableNativeTags, context.tagPreviewTargets, "native");
    }
    for (const [groupId, values] of normalizedMappings(context.alternativeGroupValues)) {
        collect(groupId, values, context.availableAlternativeGroups, context.groupPreviewTargets, "derived");
    }
    return !unresolved && matches.size === 1 ? [...matches.values()][0] : null;
}

function tagBIOTarget(ingredient, context) {
    const tagPreviewTarget = context.tagPreviewTargets?.get(ingredient.id);
    if (tagPreviewTarget) return tagPreviewTarget;
    // A mapping is a generation plan, not proof that its BIO already exists.
    // Resolve formal Tag links by explicit identity, including renamed files.
    const matches = (context.bioRegistry?.entries ?? []).filter(entry =>
        entry.tag_identity === "minecraft:item_tag" &&
        String(entry.minecraft_tag ?? "").replace(/^#/, "") === ingredient.id &&
        typeof entry.path === "string" && /\.md$/i.test(entry.path)
    );
    if (matches.length === 1 && (!context.availableNativeTags || context.availableNativeTags.has(ingredient.id))) {
        return matches[0].path.replace(/\.md$/i, "");
    }
    return sharedCollectionTagTarget(ingredient, context);
}

function tagLabel(ingredient, context) {
    const mapping = normalizedMappings(context.tagMappings).get(ingredient.id);
    const target = tagBIOTarget(ingredient, context);
    if (target) {
        const label = mapping?.zhName || (context.tagPreviewTargets?.has(ingredient.id)
            ? "#" + ingredient.id : target.split("/").at(-1));
        return `[[${target}|${label}]]`;
    }
    const representative = mapping?.representativeItemId;
    if (representative && (
        !Array.isArray(ingredient.values) || ingredient.values.includes(representative)
    )) {
        return aliasedItemLink(representative, mapping.zhName || `#${ingredient.id}`, context);
    }
    return `#${ingredient.id ?? "minecraft:unknown"}`;
}

function exceptSelfChoiceQuantity(ingredient, groupId, context) {
    if (!groupId || !context.ownerItemId || !context.availableAlternativeGroups?.has(groupId)) return null;
    const fullValues = normalizedMappings(context.alternativeGroupValues).get(groupId);
    if (!Array.isArray(fullValues) || !fullValues.length) return null;
    const owner = canonicalItemId(context.ownerItemId);
    const complete = new Set(fullValues.map(canonicalItemId).filter(Boolean));
    if (complete.size !== fullValues.length || !complete.has(owner)) return null;
    const choices = ingredient.alternatives ?? [];
    if (!choices.length || choices.some(choice => choice.kind !== "item")) return null;
    const allowed = new Set(choices.map(choice => canonicalItemId(choice.id)));
    if (allowed.has(null) || allowed.has(owner) || allowed.size !== choices.length || complete.size !== allowed.size + 1 ||
        [...allowed].some(id => !complete.has(id))) return null;
    const factor = Number(choices[0].qty ?? 1), outer = Number(ingredient.qty ?? 1);
    if (!Number.isSafeInteger(factor) || factor <= 0 || !Number.isSafeInteger(outer) || outer <= 0 ||
        choices.some(choice => Number(choice.qty ?? 1) !== factor) || !Number.isSafeInteger(factor * outer)) return null;
    return factor * outer;
}

function fieldForBIOType(type) {
    const suffix = String(type ?? "").split("-").pop().toLowerCase();
    if (suffix === "drop") return "drop";
    if (suffix === "geo") return "GEO";
    return "item";
}

function ingredientField(ingredient, context) {
    if (ingredient?.kind !== "item") return "item";
    const canonical = canonicalItemId(ingredient.id);
    const generatedType = context.itemTypes instanceof Map
        ? context.itemTypes.get(canonical)
        : context.itemTypes?.[canonical];
    const existingType = context.bioRegistry?.get?.(canonical)?.type;
    return fieldForBIOType(existingType ?? generatedType);
}

function renderMaterialChoices(ingredient, qty, selectedId, context, indent) {
    const choices = new Map();
    function collect(value, multiplier) {
        const quantity = multiplier * Number(value.qty ?? 1);
        if (value.kind === "alternatives") {
            for (const child of value.alternatives ?? []) collect(child, quantity);
            return;
        }
        const ids = value.kind === "tag" ? value.values ?? [] : value.kind === "item" ? [value.id] : [];
        for (const rawId of ids) {
            const id = canonicalItemId(rawId);
            if (id && Number.isSafeInteger(quantity * qty) && quantity * qty > 0) {
                choices.set(JSON.stringify([id, quantity]), { kind: "item", id, qty: quantity });
            }
        }
    }
    collect({ ...ingredient, qty: 1 }, 1);
    const values = [...choices.values()];
    if (!values.length) return [];
    const selected = values.find(choice => choice.id === canonicalItemId(selectedId));
    const ordered = selected ? [selected, ...values.filter(choice => choice !== selected)] : values;
    if (ordered.length === 1) return renderIngredient({ ...ordered[0], qty: qty * ordered[0].qty }, context, indent);
    return [`${indent}- **擇一材料** (qty:: ${qty})`, ...ordered.map(choice =>
        `${indent}\t- [${ingredientField(choice, context)}:: ${itemLink(choice.id, context)}]` +
        (choice.qty === 1 ? "" : ` (qty:: ${choice.qty})`))];
}

function renderIngredient(ingredient, context, indent = "\t") {
    const qty = Number(ingredient?.qty ?? 1);
    if (ingredient?.kind === "item") {
        const field = ingredientField(ingredient, context);
        return [`${indent}- [${field}:: ${itemLink(ingredient.id, context)}] (qty:: ${qty})`];
    }
    if (ingredient?.kind === "tag") {
        if (!tagBIOTarget(ingredient, context)) {
            const representative = normalizedMappings(context.tagMappings).get(ingredient.id)?.representativeItemId;
            const fallback = renderMaterialChoices(ingredient, qty, representative, context, indent);
            if (fallback.length) return fallback;
        }
        return [`${indent}- [item:: ${tagLabel(ingredient, context)}] (qty:: ${qty})`];
    }
    if (ingredient?.kind === "alternatives") {
        const groupId = derivedAlternativeGroupId(ingredient);
        const groupMapping = normalizedMappings(context.alternativeGroupMappings).get(groupId);
        const compactQty = groupMapping && exceptSelfChoiceQuantity(ingredient, groupId, context);
        if (compactQty) {
            const choices = ingredient.alternatives;
            const representative = ingredient.selectedRepresentative ?? choices.find(choice =>
                choice.id === groupMapping.representativeItemId
            ) ?? choices[0];
            return [
                `${indent}<!-- except self -->`,
                `${indent}- [${ingredientField(representative, context)}:: ${aliasedItemLink(representative.id, groupMapping.zhName, context)}] (qty:: ${compactQty})`
            ];
        }
        const fallback = renderMaterialChoices(ingredient, qty,
            ingredient.selectedRepresentative?.id ?? groupMapping?.representativeItemId, context, indent);
        if (fallback.length) return fallback;
    }
    return [`${indent}- 未知材料 (qty:: ${qty})`];
}

// Display supplemental normalized metadata without changing dependency fields.
// Unknown metadata stays visible under its original key instead of being discarded.
function renderRecipeNotes(meta = {}, context = {}, recipe = {}) {
    const lines = [];
    const text = value => (typeof value === "string" ? value : JSON.stringify(value))
        .replace(/[\r\n]+/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const add = value => lines.push(`\t- [note:: ${text(value)}]`);
    const labels = {
        ingredientRoles: "材料角色", copiesInputComponents: "繼承輸入物品 Components"
    };
    const owner = canonicalItemId(context.ownerItemId);
    const container = ["bundle", "shulker_box"].find(base => owner === `minecraft:${base}` ||
        MINECRAFT_COLORS.some(color => owner === `minecraft:${color}_${base}`));
    const containerTransmute = container && recipe.sourceType === "minecraft:crafting_transmute" &&
        meta.copiesInputComponents === true && Array.isArray(meta.ingredientRoles) &&
        JSON.stringify(meta.ingredientRoles) === '["input","material"]' &&
        recipe.ingredients?.[0]?.kind === "tag" && recipe.ingredients[0].id ===
            (container === "bundle" ? "minecraft:bundles" : "minecraft:shulker_boxes");
    if (containerTransmute) add("可以存入物品");
    for (const [key, value] of Object.entries(meta)) {
        if (value == null || ["sourceFile", "category", "group", "resultComponents"].includes(key)) continue;
        if (containerTransmute && ["ingredientRoles", "copiesInputComponents"].includes(key)) continue;
        if (key === "cookingTime") { add(`處理時間 ${text(value)} ticks`); continue; }
        if (key === "experience") { add(`經驗值 ${text(value)}`); continue; }
        add(`${labels[key] ?? `補充資訊（${key}）`}：${text(value)}`);
    }
    for (const [key, value] of Object.entries(meta.resultComponents ?? {})) {
        if (key === "minecraft:suspicious_stew_effects" && Array.isArray(value)) {
            for (const effect of value) {
                if (!effect || typeof effect !== "object") { add(`成品資訊（${key}）：${text(effect)}`); continue; }
                const id = String(effect.id ?? "unknown");
                const translationKey = "effect." + id.replace(":", ".");
                const name = context.translations?.[translationKey] ?? id;
                add(`效果：${name}；持續時間 ${effect.duration ?? "未知"} ticks`);
                const other = Object.fromEntries(Object.entries(effect).filter(([field]) => !["id", "duration"].includes(field)));
                if (Object.keys(other).length) add(`效果補充資訊：${text(other)}`);
            }
        } else add(`成品資訊（${key}）：${text(value)}`);
    }
    return lines;
}

function renderRoute(recipe, context) {
    const lines = [
        `- **生產設備**：(Machine:: [[${recipe.machine}]])`,
        "\t**合成所需**："
    ];
    if (recipe.ingredients.length === 0) {
        lines.push("\t- 無固定材料／特殊配方");
    } else {
        for (const ingredient of recipe.ingredients) {
            lines.push(...renderIngredient(ingredient, context));
        }
    }
    lines.push(`\t- [output:: ${recipe.output}]`);
    lines.push(...renderRecipeNotes(recipe.meta, context, recipe));
    return lines;
}

const EXPLICIT_MATERIAL_ROUTE_TAGS = Object.freeze({
    "minecraft:soul_fire_base_blocks": ["minecraft:soul_sand", "minecraft:soul_soil"],
    "minecraft:stone_tool_materials": ["minecraft:cobblestone", "minecraft:blackstone", "minecraft:cobbled_deepslate"]
});

function expandExplicitMaterialRoutes(recipe, context) {
    const indices = recipe.ingredients.flatMap((ingredient, index) =>
        ingredient.kind === "tag" && Object.hasOwn(EXPLICIT_MATERIAL_ROUTE_TAGS, ingredient.id) ? [index] : []);
    if (indices.length !== 1) return [recipe];
    const index = indices[0], ingredient = recipe.ingredients[index];
    const tagId = ingredient.id, expected = EXPLICIT_MATERIAL_ROUTE_TAGS[tagId];
    if (!Array.isArray(ingredient.values)) return [recipe];
    const values = ingredient.values.map(canonicalItemId);
    if (values.length !== expected.length || new Set(values).size !== expected.length ||
        expected.some(id => !values.includes(id))) return [recipe];
    const mapped = canonicalItemId(normalizedMappings(context.tagMappings).get(tagId)?.representativeItemId);
    const selected = values.includes(mapped) ? mapped : values[0];
    return [selected, ...values.filter(id => id !== selected)].map(id => ({
        ...recipe, preferred: recipe.preferred && id === selected,
        ingredients: recipe.ingredients.map((value, position) => position === index
            ? { kind: "item", id, qty: ingredient.qty ?? 1 } : value)
    }));
}

function renderBIOPreview(model, options = {}) {
    const context = {
        translations: options.translations ?? {},
        bioRegistry: options.bioRegistry ?? null,
        tagMappings: options.tagMappings ?? new Map(),
        alternativeGroupMappings: options.alternativeGroupMappings ?? new Map(),
        alternativeGroupValues: options.alternativeGroupValues ?? new Map(),
        availableAlternativeGroups: options.availableAlternativeGroups ?? new Set(),
        nativeTagValues: options.nativeTagValues ?? new Map(),
        availableNativeTags: options.availableNativeTags,
        groupPreviewTargets: options.groupPreviewTargets,
        ownerItemId: model.itemId,
        itemTypes: options.itemTypes ?? new Map(),
        itemPreviewTargets: options.itemPreviewTargets,
        tagPreviewTargets: options.tagPreviewTargets
    };
    const lines = [
        "---",
        `type: ${model.type}`,
        `id: ${model.bioId}`,
        `minecraft_id: ${model.itemId}`,
        `level:${model.level == null || model.level === "" ? "" : " " + model.level}`,
        "aliases:",
        ...model.aliases.map(alias => `  - ${alias}`),
        ...(model.externalBase ? ["base_material: true"] : []),
        "generated_by: minecraft-vanilla-bio-generator-v1",
        `generator_schema: ${GENERATOR_SCHEMA_VERSION}`,
        "---",
        "",
        ...managedTagsFor({ baseMaterial: model.externalBase, hasRecipe: model.recipes.length > 0 }), "",
        "# 合成/取得",
        ""
    ];
    if (model.externalBase || model.recipes.length === 0) {
        lines.push(
            "### 外部取得",
            "",
            "<!-- preferred -->",
            model.naturalLog
                ? `- 採集：砍伐天然生成的${model.name}。`
                : "- 外部取得：具體來源待人工確認。",
            ""
        );
    }
    if (model.recipes.length > 0) {
        const sections = new Map();
        const orderedRecipes = model.recipes.flatMap(recipe => expandExplicitMaterialRoutes(recipe, context)).sort(
            (left, right) => Number(right.preferred) - Number(left.preferred)
        );
        for (const recipe of orderedRecipes) {
            const classified = options.machineMappings ? classifyMachineRecipe({
                machine: recipe.machine, sourceType: recipe.sourceType,
                provider: "Minecraft 原版", section: recipe.section
            }, options.machineMappings) : { section: recipe.section, diagnostics: [] };
            for (const diagnostic of classified.diagnostics) {
                options.machineMappingDiagnostics?.push({ itemId: model.itemId, ...diagnostic });
            }
            if (!sections.has(classified.section)) sections.set(classified.section, []);
            sections.get(classified.section).push(recipe);
        }
        for (const [section, recipes] of sections) {
            lines.push(`### ${section}`, "", "##### Minecraft 原版", "");
            for (const recipe of recipes) {
                if (recipe.preferred) lines.push("<!-- preferred -->");
                lines.push(...renderRoute(recipe, context));
            }
            lines.push("");
        }
    }
    lines.push("# 用途", "", "- ", "", "# 產物", "", "- ", "");
    return lines.join("\n");
}

function renderTagBIOPreview(model, options = {}) {
    const context = {
        translations: options.translations ?? {},
        bioRegistry: options.bioRegistry ?? null,
        itemTypes: options.itemTypes ?? new Map(),
        itemPreviewTargets: options.itemPreviewTargets
    };
    const lines = [
        "---",
        "type: mc-tag",
        `id: ${model.bioId}`,
        ...(model.kind === "minecraft:item_tag"
            ? [`minecraft_tag: ${model.tagId}`, "tag_identity: minecraft:item_tag"]
            : [`derived_group: ${model.groupId}`, "tag_identity: obsf:derived_ingredient_group"]),
        "level:",
        "aliases:",
        ...model.aliases.map(alias => `  - ${alias}`),
        "generated_by: minecraft-vanilla-bio-generator-v1",
        `generator_schema: ${GENERATOR_SCHEMA_VERSION}`,
        "---",
        "",
        ...managedTagsFor({ hasRecipe: false }), "",
        "### Tag 代表材料",
        "",
    ];
    const members = [
        model.representativeItemId,
        ...model.values.filter(itemId => itemId !== model.representativeItemId)
    ];
    for (const itemId of members) {
        if (itemId === model.representativeItemId) lines.push("<!-- preferred -->");
        const ingredient = { kind: "item", id: itemId };
        lines.push(`- [${ingredientField(ingredient, context)}:: ${itemLink(itemId, context)}]`);
    }
    lines.push(
        "",
        "# 用途",
        "",
        "- ",
        "",
        "# 產物",
        "",
        "- ",
        ""
    );
    return lines.join("\n");
}

module.exports = {
    BIO_GENERATOR_SCHEMA_VERSION: GENERATOR_SCHEMA_VERSION,
    BIO_RECIPE_TYPE_DICT,
    canonicalItemId,
    bioIdForItem,
    aliasesForItem,
    smithingTemplateName,
    resolveTranslatedName,
    safeFilename,
    bioRecipeTypeInfo,
    fieldForBIOType,
    createBIOGenerationModel,
    createTagBIOGenerationModel,
    createDerivedGroupBIOGenerationModel,
    renderBIOPreview,
    renderTagBIOPreview
};
