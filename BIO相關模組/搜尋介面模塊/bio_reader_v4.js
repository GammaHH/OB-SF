// Shared by the Obsidian V4 view and Node characterization tests.
// All inputs are BIO text/metadata. No vault, filesystem, or DOM access.

function readLink(value) {
    const match = String(value ?? "").trim().match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    return match
        ? { name: match[1].replaceAll("\\|", "|"), label: match[2] || match[1].split("/").pop() }
        : { name: String(value ?? "").trim(), label: String(value ?? "").trim() };
}

function positive(value, fallback = 1) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function hash(value) {
    let result = 2166136261;
    for (const character of value) {
        result ^= character.charCodeAt(0);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
}

function formatRecipeNote(value) {
    return String(value).trim()
        .replace(/^烹調時間（原始 ticks）：\s*(.+)$/, "處理時間 $1 ticks")
        .replace(/^烹調時間\s+/, "處理時間 ")
        .replace(/持續時間（原始 ticks）：\s*(.+)$/, "持續時間 $1 ticks")
        .replace(/^經驗值：\s*(.+)$/, "經驗值 $1");
}

function recipeNoteKey(value) {
    const note = formatRecipeNote(value);
    if (/^處理時間\s/.test(note)) return "處理時間";
    if (/^經驗值\s/.test(note)) return "經驗值";
    return note.split("：", 1)[0];
}

function parseBIO(text, metadata = {}) {
    // Yield belongs to the selected route. Legacy document-level output is ignored.
    const defaultOutput = 1;
    const recipes = [];
    const diagnostics = [];
    const tagMembers = [];
    const tagRows = [];
    const isTag = Boolean(metadata.tag_identity || metadata.minecraft_tag || metadata.derived_group);
    const body = String(text ?? "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    const lines = body.split(/\r?\n/);
    let section = "";
    let provider = "";
    let current = null;
    let preferred = false;
    let pendingChoices = null;
    let alternative = null;
    let codeFence = null;
    let codeLines = [];
    let pendingExceptSelf = false;
    let htmlComment = false;

    function warning(code, message) {
        diagnostics.push({ code, message });
    }

    function discardExclusion() {
        if (!pendingExceptSelf) return;
        warning("EXCEPT_SELF_DANGLING", "except self 必須緊接同一配方的材料行");
        if (current) current.invalid = true;
        pendingExceptSelf = false;
    }

    function route(properties) {
        const value = {
            section, provider, machine: "", output: defaultOutput, ingredients: [],
            preferred, external: false, tagRepresentative: false, ...properties
        };
        preferred = false;
        recipes.push(value);
        return value;
    }

    function choicesFrom(value) {
        if (!value || !Array.isArray(value.choices) || value.choices.length === 0) {
            throw new Error("choices 必須是非空陣列");
        }
        const seen = new Set();
        return value.choices.map(choice => {
            if (!choice || typeof choice.name !== "string" || !choice.name.trim()) {
                throw new Error("choice 缺少 BIO 連結或名稱");
            }
            const type = String(choice.type || "item").toLowerCase();
            if (!["item", "drop", "geo"].includes(type)) throw new Error("choice type 無效");
            if (choice.qty != null && (!Number.isFinite(Number(choice.qty)) || Number(choice.qty) <= 0)) {
                throw new Error("choice qty 必須大於 0");
            }
            const name = choice.name.trim();
            if (seen.has(name)) throw new Error("choice 重複：" + name);
            seen.add(name);
            return { name, label: choice.label || name.split("/").pop(), type: type === "geo" ? "GEO" : type, qty: positive(choice.qty) };
        });
    }

    for (const line of lines) {
        if (htmlComment) { if (line.includes("-->")) htmlComment = false; continue; }
        const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (fence) {
            discardExclusion();
            if (!codeFence) {
                codeFence = fence[1][0];
                codeLines = [];
            } else if (fence[1][0] === codeFence) {
                if (current && codeLines.length) {
                    try {
                        const components = JSON.parse(codeLines.join("\n"));
                        if (components && typeof components === "object") current.components = components;
                    } catch {
                        // Ordinary explanatory code blocks are not route metadata.
                    }
                }
                codeFence = null;
            }
            continue;
        }
        if (codeFence) { codeLines.push(line); continue; }
        if (line.trim() === "<!-- except self -->") {
            discardExclusion(); pendingExceptSelf = true; continue;
        }
        if (line.includes("<!--") && !/^\s*<!-- (?:preferred|obsf:choices\s)/.test(line)) {
            discardExclusion(); htmlComment = !line.includes("-->"); continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            discardExclusion();
            if (heading[1].length === 5) provider = heading[2].trim();
            else {
                section = heading[1].length === 3 ? heading[2].trim() : "";
                provider = "";
            }
            current = null;
            alternative = null;
            preferred = false;
            pendingChoices = null;
            continue;
        }
        if (line.trim() === "<!-- preferred -->") { preferred = true; continue; }
        const choiceComment = line.match(/^\s*<!-- obsf:choices (.+) -->\s*$/);
        if (choiceComment) {
            try {
                const value = JSON.parse(choiceComment[1]);
                pendingChoices = { ...value, choices: choicesFrom(value) };
            } catch (error) {
                pendingChoices = { invalid: true };
                warning("INVALID_CHOICES", error.message);
            }
            continue;
        }
        const member = isTag && line.match(/^\|\s*`(minecraft:[^`]+)`\s*\|\s*(\[\[.*\]\])\s*\|$/);
        if (member) {
            tagMembers.push({ ...readLink(member[2].replaceAll("\\|", "|")), type: "item", qty: 1 });
            continue;
        }
        const note = line.match(/^\s*-\s*\[note\s*::\s*(.*)\]\s*$/i);
        if (note && section !== "外部取得") {
            discardExclusion();
            if (current && note[1].trim()) (current.notes ||= []).push(formatRecipeNote(note[1]));
            continue;
        }
        const machine = note ? null : line.match(/\(Machine\s*::\s*(\[\[.*?\]\]|[^)]+)\)/i);
        if (machine) {
            discardExclusion();
            current = route({ machine: readLink(machine[1]).name });
            alternative = null;
            continue;
        }
        const row = line.match(/^\s*-\s*\[(item|drop|GEO)\s*::\s*(\[\[.*?\]\]|[^\]]+)\](?:\s*\(qty\s*::\s*([0-9.]+)\s*\))?/i);
        if (isTag && section === "Tag 代表材料" && row && !row[3] && !current) {
            discardExclusion();
            const type = row[1].toLowerCase();
            tagRows.push({
                ...readLink(row[2]), type: type === "geo" ? "GEO" : type,
                qty: 1, preferred
            });
            preferred = false;
            continue;
        }
        if (section === "外部取得" && /^\s*-\s+/.test(line) && !machine) {
            const sourceText = (note ? note[1] : line.replace(/^\s*-\s+/, "")).replace(/\*\*/g, "").trim();
            if (sourceText && !row && !/^\[output\s*::/i.test(sourceText)) {
                const separator = sourceText.indexOf("：");
                route({
                    external: true, output: 1,
                    category: separator > 0 ? sourceText.slice(0, separator).trim() : "外部取得",
                    description: separator > 0 ? sourceText.slice(separator + 1).trim() : sourceText,
                    sourceText
                });
                current = null;
            }
            continue;
        }
        if (!current) { if (line.trim()) discardExclusion(); continue; }
        const alternativesHeader = line.match(/^\s*-\s*\*\*擇一材料\*\*\s*\(qty\s*::\s*([0-9.]+)\s*\)/);
        if (alternativesHeader) {
            if (pendingChoices?.invalid) current.invalid = true;
            alternative = {
                name: pendingChoices?.defaultName || "", label: "擇一材料",
                type: "item", qty: positive(alternativesHeader[1]),
                choices: pendingChoices?.choices || [],
                defaultName: pendingChoices?.defaultName,
                metadataChoices: Boolean(pendingChoices?.choices)
            };
            pendingChoices = null;
            current.ingredients.push(alternative);
            continue;
        }
        if (row) {
            if (pendingExceptSelf && !row[3]) discardExclusion();
            if (line.includes("(qty") && (!row[3] || !Number.isFinite(Number(row[3])) || Number(row[3]) <= 0)) {
                current.invalid = true;
                warning("INVALID_QUANTITY", "材料數量必須大於 0");
                pendingExceptSelf = false;
                continue;
            }
            const type = row[1].toLowerCase();
            const ingredient = { ...readLink(row[2]), type: type === "geo" ? "GEO" : type, qty: positive(row[3]) };
            if (pendingExceptSelf) { ingredient.excludeSelf = true; pendingExceptSelf = false; }
            if (alternative && !row[3]) {
                if (!alternative.metadataChoices) alternative.choices.push(ingredient);
                if (!alternative.name) alternative.name = ingredient.name;
            } else if (row[3]) {
                if (pendingChoices?.invalid) current.invalid = true;
                if (pendingChoices?.choices) {
                    ingredient.choices = pendingChoices.choices;
                    ingredient.choiceKind = pendingChoices.kind;
                    ingredient.choiceId = pendingChoices.id;
                    ingredient.defaultName = pendingChoices.defaultName;
                }
                current.ingredients.push(ingredient);
                pendingChoices = null;
                alternative = null;
            }
        }
        const output = line.match(/\[output\s*::\s*([0-9.]+)\]/i);
        if (output) {
            discardExclusion();
            if (Number(output[1]) > 0) current.output = Number(output[1]);
            else { current.invalid = true; warning("INVALID_OUTPUT", "配方產量必須大於 0"); }
        }
        if (!row && !alternativesHeader && line.trim()) discardExclusion();
    }
    discardExclusion();
    if (codeFence) warning("UNCLOSED_CODE_FENCE", "BIO 的程式碼區塊尚未結束");
    if (tagRows.length) {
        const representative = tagRows.find(member => member.preferred) || tagRows[0];
        const choices = tagRows.length > 1 ? tagRows : tagMembers.length ? tagMembers : tagRows;
        const names = new Set(choices.map(member => member.name));
        if (names.size !== choices.length) warning("DUPLICATE_TAG_MEMBER", "Tag BIO 有重複成員");
        route({
            section: "Tag 代表材料", tagRepresentative: true, preferred: true, output: 1,
            ingredients: [{ ...representative, choices: choices.filter((member, index) =>
                choices.findIndex(other => other.name === member.name) === index
            ) }]
        });
    }
    for (const recipe of recipes) {
        for (const ingredient of recipe.ingredients) {
            if (ingredient.choices?.length === 0) {
                recipe.invalid = true;
                warning("EMPTY_ALTERNATIVES", "擇一材料缺少候選");
            }
        }
    }
    const valid = recipes.filter(recipe =>
        !recipe.invalid && (recipe.external || recipe.ingredients.length > 0)
    );
    if (metadata.base_material === true && !valid.some(recipe => recipe.external)) {
        valid.unshift({
            section: "外部取得", machine: "", output: 1, ingredients: [],
            external: true, preferred: !valid.some(recipe => recipe.preferred),
            sourceText: "外部取得：來源待補充", category: "外部取得", description: "來源待補充"
        });
    } else if (metadata.base_material === true && !valid.some(recipe => recipe.preferred)) {
        const external = valid.find(recipe => recipe.external);
        if (external) external.preferred = true;
    }
    const duplicates = new Map();
    for (const recipe of valid) {
        const identity = hash(JSON.stringify({
            section: recipe.section, machine: recipe.machine, output: recipe.output,
            ingredients: recipe.ingredients, sourceText: recipe.sourceText, components: recipe.components,
            notes: recipe.notes ?? [],
            ...(recipe.provider ? { provider: recipe.provider } : {})
        }));
        const ordinal = duplicates.get(identity) || 0;
        duplicates.set(identity, ordinal + 1);
        recipe.key = identity + "-" + ordinal;
    }
    return { defaultOutput, recipes: valid, diagnostics };
}

function exclusionItemIdentity(page) {
    if (!page || page.minecraft_tag || page.derived_group || page.tag_identity) return null;
    const raw = String(page.minecraft_id || page.id || "").trim().toLowerCase();
    const id = raw.includes(":") ? raw : "minecraft:" + raw;
    return /^minecraft:[a-z0-9_./-]+$/.test(id) ? id : null;
}

function inferExceptSelfGroupId(owner) {
    const identity = exclusionItemIdentity(owner);
    if (!identity) return null;
    const colors = ["black", "blue", "brown", "cyan", "gray", "green", "light_blue", "light_gray",
        "lime", "magenta", "orange", "pink", "purple", "red", "white", "yellow"];
    for (const color of colors) {
        const prefix = "minecraft:" + color + "_";
        if (identity.startsWith(prefix) && identity.length > prefix.length) return "obsf:color_family/" + identity.slice(prefix.length);
    }
    return null;
}

async function resolveRecipeExclusions(parsed, { owner, resolvePage, parsePage, resolveCollection } = {}) {
    const result = { ...parsed, recipes: [], diagnostics: [...(parsed.diagnostics ?? [])],
        exclusionFailures: Boolean(parsed.exclusionFailures || parsed.diagnostics?.some(value => value.code.startsWith("EXCEPT_SELF_"))) };
    const safely = async (fn, value) => { try { return await fn?.(value); } catch { return null; } };
    for (const source of parsed.recipes ?? []) {
        const recipe = { ...source, ingredients: source.ingredients.map(value => ({ ...value,
            ...(value.choices ? { choices: value.choices.map(choice => ({ ...choice })) } : {}) })) };
        let invalid = false;
        for (let index = 0; index < recipe.ingredients.length; index++) {
            const ingredient = recipe.ingredients[index];
            if (!ingredient.excludeSelf) continue;
            const fail = (code, message) => { invalid = true; result.exclusionFailures = true;
                result.diagnostics.push({ code, message, route: source.key, ingredient: index + 1 }); };
            const ownerId = exclusionItemIdentity(owner);
            if (!ownerId) { fail("EXCEPT_SELF_OWNER_IDENTITY_MISSING", "無法確認成品身份，停止此路線的自身排除"); continue; }
            let candidates = ingredient.choices;
            const groupId = inferExceptSelfGroupId(owner);
            let groupPreferred = ingredient.defaultName;
            if (!candidates?.length) {
                const group = await safely(resolveCollection, groupId);
                if (!group || !groupId || group.derived_group !== groupId ||
                    group.tag_identity !== "obsf:derived_ingredient_group") {
                    fail("EXCEPT_SELF_COLLECTION_MISSING", "找不到目前批次或唯一正式集合 BIO：" + (groupId || ownerId)); continue;
                }
                const collection = await safely(parsePage, group);
                const members = (collection?.recipes ?? []).filter(route => route.tagRepresentative);
                if (!collection || members.length !== 1 || collection.diagnostics?.length) {
                    fail("EXCEPT_SELF_COLLECTION_INVALID", "集合 BIO 成員未完整解析：" + groupId); continue;
                }
                const member = members[0].ingredients[0];
                candidates = member?.choices?.length ? member.choices : member ? [member] : [];
                groupPreferred = member?.defaultName || member?.name;
            }
            const representative = await safely(resolvePage, ingredient.name);
            const representativePath = representative?.file?.path;
            const allowed = [];
            for (const candidate of candidates ?? []) {
                const page = await safely(resolvePage, candidate.name);
                const memberId = exclusionItemIdentity(page);
                if (memberId === ownerId ||
                    page?.file?.path && page.file.path === owner?.file?.path) continue;
                if (memberId && groupId && inferExceptSelfGroupId(page) !== groupId) {
                    fail("EXCEPT_SELF_MEMBER_FAMILY_MISMATCH", "集合成員不屬於成品的顏色家族：" + candidate.name); break;
                }
                // Missing BIOs remain ordinary unresolved material choices; do
                // not manufacture an identity from their translated labels.
                const name = page?.file?.path?.replace(/\.md$/i, "") || candidate.name;
                allowed.push({ ...candidate, name,
                    preferred: Boolean(representativePath && representativePath === page?.file?.path) ||
                        candidate.name === ingredient.name,
                    groupPreferred: candidate.preferred === true || candidate.name === groupPreferred });
            }
            if (invalid) continue;
            if (!allowed.length) { fail("EXCEPT_SELF_EMPTY", "排除成品自身後沒有合法材料"); continue; }
            const preferred = allowed.find(choice => choice.preferred) || allowed.find(choice => choice.groupPreferred) || allowed[0];
            ingredient.choices = allowed.map(choice => ({ ...choice, preferred: choice === preferred }));
            ingredient.defaultName = preferred.name;
        }
        if (!invalid) result.recipes.push(recipe);
    }
    return result;
}

function allowedRecipes(parsed, sections, isRouteAllowed = () => true) {
    return parsed.recipes.filter(recipe =>
        isRouteAllowed(recipe) && (recipe.tagRepresentative || sections.has(recipe.section))
    );
}

function providerAllowed(provider, folders) {
    if (!provider) return true; // Legacy BIOs have no provider metadata.
    if (provider === "Minecraft 原版") return [...folders].some(folder => /^MC(?:-|$)/.test(folder));
    if (provider === "Slimefun 原版") return [...folders].some(folder => /^SF-.*\(原版\)$/.test(folder));
    return folders.has(provider);
}

function ingredientKey(pagePath, recipeKey, index) {
    return JSON.stringify([pagePath, recipeKey, index]);
}

function chooseRecipe(pagePath, recipes, routeChoices, ingredientChoices) {
    const recipe = recipes.find(value => value.key === routeChoices.get(pagePath)) ||
        recipes.find(value => value.preferred) ||
        recipes[0];
    if (!recipe) return null;
    const ingredients = recipe.ingredients.map((ingredient, index) => {
        if (!ingredient.choices?.length) return ingredient;
        const key = ingredientKey(pagePath, recipe.key, index);
        const selected = ingredient.choices.find(choice => choice.name === ingredientChoices.get(key)) ||
            ingredient.choices.find(choice => choice.preferred) ||
            ingredient.choices.find(choice => choice.name === (ingredient.defaultName || ingredient.name)) ||
            ingredient.choices[0];
        return {
            ...ingredient, name: selected.name, type: selected.type,
            qty: ingredient.qty * selected.qty, selectionKey: key
        };
    });
    return { ...recipe, ingredients };
}

function recipeLabel(recipe, options = {}) {
    if (recipe.external) return recipe.sourceText;
    if (recipe.tagRepresentative) return "Tag 代表材料";
    const effects = recipe.components?.["minecraft:suspicious_stew_effects"];
    const noteLabels = !recipe.components
        ? (recipe.notes ?? []).filter(note => /^(?:效果[:：]|成品資訊[（(:：])/.test(note)) : [];
    const effectLabel = Array.isArray(effects)
        ? " ｜ " + effects.map(effect => effect.id + " " + effect.duration + " ticks").join(", ")
        : noteLabels.length ? " ｜ " + noteLabels.join("；") : "";
    const materials = recipe.ingredients.map(ingredient =>
        (ingredient.label || ingredient.name.split("/").pop()) + " ×" + ingredient.qty
    ).join(" + ");
    if (options.compact) return (recipe.machine || "無/手動") + " ｜ " + materials + effectLabel;
    return (recipe.provider ? recipe.provider + " ｜ " : "") + (recipe.section || "未分類") + " ｜ " + (recipe.machine || "無/手動") +
        " ｜ " + materials + " ｜ output " + recipe.output + "/批" + effectLabel;
}

function recipeMenuOptions(recipes) {
    const options = recipes.map(recipe => ({ value: recipe.key,
        group: recipe.provider || (recipe.external ? "外部取得" : recipe.tagRepresentative ? "Tag 材料" : "其他"),
        label: recipeLabel(recipe, { compact: true }), title: recipeLabel(recipe), recipe }));
    const counts = new Map();
    for (const option of options) {
        const key = JSON.stringify([option.group, option.label]);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const seen = new Map();
    for (const option of options) {
        const key = JSON.stringify([option.group, option.label]);
        if (counts.get(key) > 1 && !option.recipe.external) option.label += " ｜ 產量 " + option.recipe.output + "/批";
        const unique = JSON.stringify([option.group, option.label]);
        const ordinal = (seen.get(unique) || 0) + 1;
        seen.set(unique, ordinal);
        if (ordinal > 1) option.label += "（路線 " + ordinal + "）";
    }
    return options.map(({ recipe, ...option }) => option);
}

module.exports = { parseBIO, inferExceptSelfGroupId, resolveRecipeExclusions, allowedRecipes, providerAllowed, chooseRecipe, ingredientKey, recipeLabel, recipeMenuOptions, formatRecipeNote, recipeNoteKey, readLink };
