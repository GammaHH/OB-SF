// Additive update proposals only. No filesystem writes or Obsidian dependencies.
const reader = require("../../搜尋介面模塊/bio_reader_v4");
const { parseFrontmatter } = require("./bio_scanner");
const { isManagedBIOtag, normalizeTag, parseTagList, rebuildManagedBIOtags } = require("./bio_tags");
const { normalizeMachineRecipeSections } = require("./machine_recipe_mapping");
const { normalizeBIOOutput } = require("./bio_output");
const BIO_UPDATE_MERGE_VERSION = 6;

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stable(value[key])])
    );
    return value;
}

function routeKeys(route, resolveName) {
    const name = value => resolveName?.(value) || value;
    const materials = route.ingredients.map(ingredient => ({
        name: name(ingredient.name), type: ingredient.type, qty: ingredient.qty,
        ...(ingredient.excludeSelf ? { excludeSelf: true } : {}),
        choices: ingredient.choices?.map(choice => ({ name: name(choice.name), type: choice.type, qty: choice.qty }))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const base = { machine: name(route.machine), materials: materials.map(({ qty, ...rest }) => rest) };
    const variants = (route.notes || []).filter(note => /^(?:效果：|成品資訊（)/.test(note));
    return {
        base: JSON.stringify(stable(base)),
        exact: JSON.stringify(stable({ machine: base.machine, materials, output: route.output,
            components: route.components, ...(variants.length ? { variantNotes: variants } : {}) })),
        notes: JSON.stringify(stable(route.notes || []))
    };
}

// Prove that an old concrete route is a legal instantiation of the incoming
// Tag/alternative route. A display name such as 任意木材 is never evidence by
// itself; callers must supply a verified member list for linked collections.
function routeIsLegalSpecialization(existing, incoming, options = {}) {
    const name = value => options.resolveName?.(value) || value;
    if (name(existing.machine) !== name(incoming.machine) || Number(existing.output) !== Number(incoming.output) ||
        existing.ingredients.length !== incoming.ingredients.length) return false;
    const variants = route => JSON.stringify(stable({ components: route.components,
        notes: (route.notes || []).filter(note => /^(?:效果：|成品資訊（)/.test(note)) }));
    if (variants(existing) !== variants(incoming)) return false;
    const members = ingredient => {
        if (ingredient.excludeSelf) return null; // requires owner-scoped proof, not a global set
        const choices = ingredient.choices || options.resolveIngredientChoices?.(ingredient);
        const values = choices?.length ? choices : [{ name: ingredient.name, qty: 1 }];
        const result = new Set();
        for (const value of values) {
            const qty = Number(ingredient.qty ?? 1) * Number(value.qty ?? 1);
            if (!value.name || !Number.isFinite(qty) || qty <= 0 || value.excludeSelf) return null;
            result.add(JSON.stringify([name(value.name), qty]));
        }
        return result;
    };
    const oldMembers = existing.ingredients.map(members), newMembers = incoming.ingredients.map(members);
    if ([...oldMembers, ...newMembers].some(value => !value)) return false;
    const candidates = oldMembers.map(values => newMembers.map((allowed, index) =>
        [...values].every(value => allowed.has(value)) ? index : -1).filter(index => index >= 0));
    const assigned = new Map();
    function match(index, seen) {
        for (const next of candidates[index]) {
            if (seen.has(next)) continue;
            seen.add(next);
            if (!assigned.has(next) || match(assigned.get(next), seen)) { assigned.set(next, index); return true; }
        }
        return false;
    }
    return candidates.every((_, index) => match(index, new Set()));
}

// Split generated machine routes without copying its frontmatter or unrelated sections.
function generatedRoutes(markdown) {
    const lines = String(markdown).match(/[^\n]*\n|[^\n]+$/g) || [];
    const result = [];
    let section = "";
    let provider = "";
    let block = null;
    let fence = null;
    let offset = 0, pending = null;
    const finish = () => {
        if (block) result.push({ ...block, text: block.lines.join("\n").trimEnd(), end: offset });
        block = null;
    };
    for (const raw of lines) {
        const line = raw.replace(/\r?\n$/, "");
        const code = line.match(/^\s*(`{3,}|~{3,})/);
        if (code) fence = fence === code[1][0] ? null : fence || code[1][0];
        if (!fence && /^#{1,6}\s/.test(line)) {
            finish();
            if (/^#####\s/.test(line)) provider = line.replace(/^#####\s+/, "");
            else { section = line.match(/^###\s+(.+)$/)?.[1] || ""; provider = ""; }
            pending = null;
        }
        if (!fence && line.trim() === "<!-- preferred -->") {
            finish(); pending = offset; offset += raw.length; continue;
        }
        const external = !fence && section === "外部取得" && /^\s*-\s+/.test(line);
        if (!fence && (/^\s*-.*\(Machine\s*::/i.test(line) || external)) {
            finish();
            block = { section, provider, lines: [], start: pending ?? offset, contentStart: offset,
                recipeEnd: offset, unsafeSpan: false, afterRecipe: false,
                preferred: pending != null, external };
            pending = null;
        }
        if (block) {
            block.lines.push(line);
            const recipeRow = /^\s*(?:-.*\(Machine\s*::|\*\*(?:合成所需|所需|批產量)\*\*|[-*]\s*\[(?:item|drop|GEO|output|note)\s*::|<!--\s*(?:obsf:choices|except self)|-\s*\*\*擇一材料)/i.test(line);
            if (recipeRow || block.external && /^\s*-\s+/.test(line)) {
                if (block.afterRecipe) block.unsafeSpan = true;
                block.recipeEnd = offset + raw.length;
            } else if (line.trim()) block.afterRecipe = true;
        }
        offset += raw.length;
    }
    finish();
    return result;
}

const LEGACY_REVIEW_START = "<!-- obsf:legacy-recipe-review:start ";
const LEGACY_REVIEW_END = "<!-- obsf:legacy-recipe-review:end -->";

function legacyReviewEnvelope(record, newline) {
    const fenceLength = Math.max(3, ...[...record.source.matchAll(/`+/g)].map(match => match[0].length + 1));
    const fence = "`".repeat(fenceLength);
    const metadata = JSON.stringify(record).replaceAll("<", "\\u003c");
    return LEGACY_REVIEW_START + metadata + " -->" + newline + fence + "markdown" + newline +
        record.source + (/\r?\n$/.test(record.source) ? "" : newline) + fence + newline + LEGACY_REVIEW_END + newline;
}

// The metadata stores the exact original range. Publication guards must verify
// source === original.slice(start,end), not merely trust a fenced code block.
function extractLegacyRecipeReviews(text) {
    const result = [], source = String(text);
    const pattern = /^<!-- obsf:legacy-recipe-review:start (.+) -->\r?\n/gm;
    for (const match of source.matchAll(pattern)) {
        const record = JSON.parse(match[1]);
        if (record.schemaVersion !== 1 || typeof record.itemId !== "string" || typeof record.source !== "string" ||
            !Number.isInteger(record.start) || !Number.isInteger(record.end) || record.start < 0 || record.end <= record.start ||
            typeof record.reason !== "string" || !record.reason || typeof record.evidence !== "string" || !record.evidence) {
            throw new Error("舊配方審核記錄格式無效");
        }
        const newline = match[0].endsWith("\r\n") ? "\r\n" : "\n";
        const expected = legacyReviewEnvelope(record, newline);
        if (source.slice(match.index, match.index + expected.length) !== expected) throw new Error("舊配方審核原文與記錄不一致");
        result.push({ ...record, envelopeStart: match.index, envelopeEnd: match.index + expected.length });
    }
    if ((source.match(/<!-- obsf:legacy-recipe-review:start /g) || []).length !== result.length ||
        (source.match(/<!-- obsf:legacy-recipe-review:end -->/g) || []).length !== result.length) throw new Error("舊配方審核 marker 不完整");
    return result;
}

function quarantineLegacyRoutes(original, records, newline) {
    let text = original;
    for (const record of [...records].sort((a, b) => b.start - a.start)) {
        if (original.slice(record.start, record.end) !== record.source) throw new Error("舊配方隔離範圍不一致");
        text = text.slice(0, record.start) + text.slice(record.end);
    }
    const list = headings(text);
    const root = list.find(heading => heading.level === 1 && heading.title === "合成/取得");
    const at = root ? list.find(heading => heading.level === 1 && heading.start > root.start)?.start ?? text.length : text.length;
    const review = newline + "# 舊配方審核（不參與規劃）" + newline + newline + records.map(record => legacyReviewEnvelope(record, newline)).join(newline) + newline;
    return text.slice(0, at) + review + text.slice(at);
}

const ADDABLE_METADATA = new Set(["id", "type", "minecraft_id", "base_material", "generated_by", "generator_schema", "aliases", "level"]);

function metadataIsAdditive(before, after, options = {}) {
    if (!before || !after) return false;
    for (const [key, value] of Object.entries(before)) {
        if (key === "output" && !(key in after) && options.allowOutputRemoval) continue;
        if (key === "tags") {
            const custom = parseTagList(value).filter(tag => !isManagedBIOtag(tag)).map(normalizeTag);
            const retained = parseTagList(after.tags).map(normalizeTag);
            if (!custom.every(tag => retained.includes(tag)) || (!options.allowManagedTags && retained.some(isManagedBIOtag))) return false;
        } else if (key === "aliases" && Array.isArray(value) && Array.isArray(after.aliases)) {
            if (!value.every(alias => after.aliases.includes(alias))) return false;
        } else if (JSON.stringify(value) !== JSON.stringify(after[key])) return false;
    }
    return Object.keys(after).every(key => key in before || ADDABLE_METADATA.has(key) ||
        (key === "tags" && options.allowManagedTags && parseTagList(after.tags).every(isManagedBIOtag)));
}

function mergeMetadata(original, generated, before, after, diagnostics, newline) {
    let result = original;
    const newFields = [];
    for (const [key, value] of Object.entries(after)) {
        if (key === "aliases") continue;
        if (!(key in before)) {
            if (!ADDABLE_METADATA.has(key)) continue;
            const field = String(generated).match(new RegExp("^" + key + ":.*$", "m"));
            if (field) newFields.push(field[0].replace(/\r$/, ""));
        } else if (value !== "" && String(before[key]) !== String(value)) diagnostics.push({
            code: key === "base_material" ? "BASE_DECISION_DIFFERS" : "METADATA_VALUE_DIFFERS",
            field: key, existing: before[key], incoming: value,
            message: "既有 YAML 欄位與 Preview 不同，保留原值，請人工確認" });
    }
    const incomingAliases = Array.isArray(after.aliases) ? after.aliases : [];
    const existingAliases = Array.isArray(before.aliases) ? before.aliases : [];
    const missing = incomingAliases.filter(alias => !existingAliases.includes(alias));
    if (missing.length) {
        const rows = missing.map(alias => "  - " + JSON.stringify(alias)).join(newline) + newline;
        const fm = result.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        const aliasBlock = fm?.[1].match(/^aliases:\s*\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m);
        if (!("aliases" in before)) newFields.push("aliases:" + newline + rows.trimEnd());
        else if (Array.isArray(before.aliases) && aliasBlock) {
            const at = fm[0].indexOf(aliasBlock[0]) + aliasBlock[0].length;
            result = result.slice(0, at) + (result[at - 1] === "\n" ? "" : newline) + rows + result.slice(at);
        } else diagnostics.push({ code: "ALIASES_MERGE_REQUIRES_REVIEW", message: "aliases 不是標準逐行清單，保留並請人工合併" });
    }
    if (newFields.length) {
        const fm = result.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?=---(?:\r?\n|$))/);
        if (fm) result = result.slice(0, fm[0].length) + newFields.join(newline) + newline + result.slice(fm[0].length);
    }
    return result;
}

function headings(text) {
    const result = [];
    let offset = 0, fence = null;
    for (const raw of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
        const line = raw.replace(/\r?\n$/, "");
        const code = line.match(/^\s*(`{3,}|~{3,})/);
        if (code) fence = fence === code[1][0] ? null : fence || code[1][0];
        const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (heading) result.push({ level: heading[1].length, title: heading[2], start: offset, body: offset + raw.length });
        offset += raw.length;
    }
    return result;
}

function insertRoute(original, block, newline, providerFallback) {
    let text = original;
    let list = headings(text);
    let root = list.find(heading => heading.level === 1 && heading.title === "合成/取得");
    if (!root) {
        text += newline + "# 合成/取得" + newline;
        list = headings(text); root = list.find(heading => heading.level === 1 && heading.title === "合成/取得");
    }
    const rootEnd = list.find(heading => heading.level === 1 && heading.start > root.start)?.start ?? text.length;
    const section = list.find(heading => heading.level === 3 && heading.title === block.section && heading.start > root.start && heading.start < rootEnd);
    const sectionEnd = section ? list.find(heading => heading.start > section.start && heading.level <= 3)?.start ?? text.length : rootEnd;
    const provider = block.provider || providerFallback;
    const group = section && provider ? list.find(heading => heading.level === 5 && heading.title === provider && heading.start > section.start && heading.start < sectionEnd) : null;
    let at = group ? list.find(heading => heading.start > group.start && heading.level <= 5)?.start ?? text.length : sectionEnd;
    if (block.preferred && !/<!-- preferred -->/.test(text) && !group) at = section?.body ?? root.body;
    const fragment = newline + (!section ? "### " + block.section + newline + newline : "") +
        (provider && !group ? "##### " + provider + newline + newline : "") +
        (block.preferred ? "<!-- preferred -->" + newline : "") + block.text.replace(/\r?\n/g, newline) + newline + newline;
    return text.slice(0, at) + fragment + text.slice(at);
}

function groupExisting(original, routes, oldKeys, newKeys, options, newline, diagnostics) {
    const insertions = [];
    const used = new Set();
    let offset = 0, section = "", explicit = "", active = "", pending = null, fence = null, comment = false, scope = false;
    for (const lineWithEnd of original.match(/[^\n]*\n|[^\n]+$/g) || []) {
        const line = lineWithEnd.replace(/\r?\n$/, "");
        const code = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (!comment && code) {
            if (!fence) fence = code[1];
            else if (code[1][0] === fence[0] && code[1].length >= fence.length && !code[2].trim()) fence = null;
            offset += lineWithEnd.length; continue;
        }
        if (!fence && line.trim() !== "<!-- preferred -->" && (comment || line.includes("<!--"))) {
            comment = !line.includes("-->");
            offset += lineWithEnd.length; continue;
        }
        if (!fence && !comment) {
            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                if (heading[1].length === 1) scope = /^合成\s*\/\s*取得$/.test(heading[2].trim());
                if (heading[1].length === 5) { explicit = heading[2]; active = explicit; }
                else { section = heading[1].length === 3 ? heading[2] : ""; explicit = ""; active = ""; }
                pending = null;
            }
            if (line.trim() === "<!-- preferred -->" && pending == null) pending = offset;
            const visibleLine = line.replace(/(`+).*?\1/g, "");
            const machine = visibleLine.match(/\(Machine\s*::\s*(\[\[.*?\]\]|[^)]+)\)/i);
            if (scope && section && machine && !/^\s*-\s*\[note\s*::/i.test(line)) {
                const name = reader.readLink(machine[1]).name;
                const index = routes.findIndex((route, i) => !used.has(i) && route.machine === name);
                if (index >= 0) used.add(index);
                const matched = index >= 0 && (newKeys.some(key => key.exact === oldKeys[index].exact) ||
                    (options.incomingRoutes || []).some(route => routeIsLegalSpecialization(routes[index], route, options)));
                const source = options.classifyExistingRoute?.(index >= 0 ? routes[index] : { machine: name });
                const evidenceFolder = source?.evidence?.replaceAll("\\", "/").split("/")[0];
                const provider = matched ? "Minecraft 原版" : evidenceFolder || source?.provider || "其他";
                if (!explicit && provider !== active) {
                    insertions.push({ offset: pending ?? offset, text: "##### " + provider.replace(/[\r\n]/g, " ") + newline + newline });
                    active = provider;
                }
                pending = null;
            } else if (scope && section && !["外部取得", "Tag 代表材料"].includes(section) &&
                typeof options.classifyLinkedSource === "function") {
                // Only stand-alone top-level link rows identify another source BIO.
                // Ingredient/NOTE rows, embeds, prose and indented links are not routes.
                const bareLink = line.match(/^[-*]\s+(\[\[[^\]\r\n]+\]\])\s*$/);
                if (bareLink) {
                    if (!explicit) {
                        const target = reader.readLink(bareLink[1]).name;
                        const source = options.classifyLinkedSource(target);
                        const provider = source?.provider || "其他";
                        if (!source?.provider) diagnostics.push({ code: "LINKED_SOURCE_UNRESOLVED", linkTarget: target,
                            message: "裸引用來源無法唯一確認；保留原文並歸入其他，請人工確認" });
                        if (provider !== active) {
                            const at = pending ?? offset;
                            const separator = at > 0 && !/\r?\n[ \t]*\r?\n$/.test(original.slice(0, at)) ? newline : "";
                            insertions.push({ offset: at,
                                text: separator + "##### " + provider.replace(/[\r\n]/g, " ") + newline + newline });
                            active = provider;
                        }
                    }
                    pending = null;
                } else if (line.trim() && line.trim() !== "<!-- preferred -->" && !heading) pending = null;
            }
        }
        offset += lineWithEnd.length;
    }
    let result = original;
    for (const insertion of insertions.reverse()) result = result.slice(0, insertion.offset) + insertion.text + result.slice(insertion.offset);
    return result;
}

function planBIOUpdate(existingText, generatedText, options = {}) {
    const original = String(existingText);
    const diagnostics = [];
    const preservedRoutes = [];
    const oldMetadata = parseFrontmatter(original);
    const newMetadata = parseFrontmatter(String(generatedText));
    const canonical = value => {
        const raw = String(value || "").trim().toLowerCase();
        const id = raw.includes(":") ? raw : "minecraft:" + raw;
        return /^minecraft:[a-z0-9_./-]+$/.test(id) ? id : null;
    };
    const oldId = canonical(oldMetadata?.minecraft_id || oldMetadata?.id);
    const newId = canonical(newMetadata?.minecraft_id || newMetadata?.id);
    if (!oldMetadata || !newMetadata || !oldId || !newId || oldId !== newId) {
        return { status: "REVIEW", candidate: original, additions: [], diagnostics: [{ code: "BIO_IDENTITY_MISMATCH" }] };
    }
    if (oldMetadata.minecraft_tag || oldMetadata.derived_group || newMetadata.minecraft_tag || newMetadata.derived_group) {
        return { status: "REVIEW", candidate: original, additions: [], diagnostics: [{ code: "TAG_UPDATE_REQUIRES_REVIEW" }] };
    }
    const existing = reader.parseBIO(original, { ...oldMetadata, base_material: oldMetadata.base_material === "true" });
    const incoming = reader.parseBIO(generatedText, { ...newMetadata, base_material: newMetadata.base_material === "true" });
    for (const [side, parsed] of [["existing", existing], ["generated", incoming]]) {
        diagnostics.push(...parsed.diagnostics.map(entry => ({ ...entry, side })));
    }
    let oldRoutes = existing.recipes.filter(route => !route.external && !route.tagRepresentative);
    const newRoutes = incoming.recipes.filter(route => !route.external && !route.tagRepresentative);
    const machineRows = generatedRoutes(original).filter(block => !block.external);
    if (machineRows.length !== oldRoutes.length) diagnostics.push({
        code: "EXISTING_ROUTE_UNPARSED", message: "原 BIO 部分設備配方未完整解析；保留原文" });
    let oldKeys = oldRoutes.map(route => routeKeys(route, options.resolveName));
    const newKeys = newRoutes.map(route => routeKeys(route, options.resolveName));
    const describe = route => ({ machine: route.machine, ingredients: route.ingredients,
        output: route.output, components: route.components, notes: route.notes || [] });
    const quarantined = [], quarantinedIndexes = new Set();
    const isolate = (index, asserted, code, message) => {
        const block = machineRows[index];
        if (!asserted || typeof asserted.reason !== "string" || !asserted.reason || typeof asserted.evidence !== "string" || !asserted.evidence ||
            machineRows.length !== oldRoutes.length || !block || block.unsafeSpan || block.recipeEnd <= block.contentStart) return false;
        const record = { schemaVersion: 1, kind: code === "LEGACY_ROUTE_REPRESENTATION_SUPERSEDED" ? "representation" : "invalid",
            itemId: oldId, reason: asserted.reason, evidence: asserted.evidence,
            start: block.start, end: block.recipeEnd, source: original.slice(block.start, block.recipeEnd) };
        quarantined.push(record); quarantinedIndexes.add(index);
        diagnostics.push({ code, route: index + 1, reason: record.reason, evidence: record.evidence,
            existing: describe(oldRoutes[index]), source: record.source, message });
        return true;
    };
    for (let index = 0; index < oldKeys.length; index++) {
        if (newKeys.some(key => key.exact === oldKeys[index].exact)) continue;
        const source = options.classifyExistingRoute?.(oldRoutes[index]) ||
            (oldRoutes[index].provider && !["Minecraft 原版", "其他"].includes(oldRoutes[index].provider)
                ? { provider: oldRoutes[index].provider, evidence: "existing-provider:" + oldRoutes[index].provider } : null);
        const covering = newRoutes.find(route => routeIsLegalSpecialization(oldRoutes[index], route, options));
        if (covering) {
            const hasCollection = covering.ingredients.some(ingredient =>
                (ingredient.choices || options.resolveIngredientChoices?.(ingredient))?.length > 1);
            if (options.canonicalizeLegacyCollections && hasCollection && (!source || source.provider === "Minecraft 原版")) {
                const saved = isolate(index, { reason: "合法舊具體材料路線已由來源的完整集合路線涵蓋", evidence: "verified-incoming-collection-membership" },
                    "LEGACY_ROUTE_REPRESENTATION_SUPERSEDED", "舊路線合法，已改用完整集合呈現；原表示保留於 fenced 審核區，並非錯誤配方");
                if (!saved) diagnostics.push({ code: "LEGACY_COLLECTION_REPRESENTATION_UNSAFE", route: index + 1,
                    message: "合法舊路線與人工內容交錯，無法安全收斂表示；保留原路線供人工審核" });
            }
            continue;
        }
        if (source && source.provider !== "Minecraft 原版") {
            preservedRoutes.push({ code: "OTHER_SOURCE_PRESERVED", provider: source.provider,
                evidence: source.evidence, existing: describe(oldRoutes[index]),
                message: "其他科技提供的路線已保留，不要求出現在 Vanilla JSON 中" });
            continue;
        }
        const explicitVanilla = oldRoutes[index].provider === "Minecraft 原版" || source?.provider === "Minecraft 原版";
        const asserted = explicitVanilla
            ? { reason: "明確標為 Minecraft 原版的舊路線與本次合法配方不符", evidence: "existing-provider:Minecraft 原版" }
            : options.quarantineLegacyRoute?.(oldRoutes[index], { itemId: oldId, routeIndex: index + 1 });
        if (isolate(index, asserted, "LEGACY_VANILLA_ROUTE_QUARANTINED", "不合法舊路線原文已隔離於 fenced 審核區，不再參與 V4 規劃；須人工驗收")) continue;
        if (asserted) diagnostics.push({ code: "LEGACY_VANILLA_ROUTE_QUARANTINE_UNSAFE", route: index + 1,
            message: "舊路線與人工內容交錯，無法安全隔離；保留原文，須先人工修復" });
        diagnostics.push({
            code: "EXISTING_ROUTE_NOT_IN_SOURCE", route: index + 1,
            existing: describe(oldRoutes[index]),
            message: "舊路線未出現在本次來源資料，可能是人工／插件配方；保留並請人工審核" });
    }
    if (quarantinedIndexes.size) {
        oldRoutes = oldRoutes.filter((_, index) => !quarantinedIndexes.has(index));
        oldKeys = oldKeys.filter((_, index) => !quarantinedIndexes.has(index));
    }
    const allBlocks = generatedRoutes(generatedText);
    const blocks = allBlocks.filter(block => !block.external);
    if (blocks.length !== newRoutes.length || incoming.diagnostics.length) {
        diagnostics.push({ code: "GENERATED_ROUTE_UNPARSED", message: "生成配方解析不完整，停止追加" });
        return { status: "REVIEW", candidate: original, additions: [], diagnostics };
    }
    const additions = [];
    const enrichments = [];
    const seen = new Set();
    for (let index = 0; index < newKeys.length; index++) {
        const key = newKeys[index];
        if (seen.has(key.exact)) continue;
        seen.add(key.exact);
        const exact = oldKeys.find(old => old.exact === key.exact);
        if (exact) {
            const oldRoute = oldRoutes[oldKeys.indexOf(exact)];
            const notes = [];
            for (const note of newRoutes[index].notes || []) {
                if ((oldRoute.notes || []).includes(note)) continue;
                const prefix = reader.recipeNoteKey(note);
                if ((oldRoute.notes || []).some(old => reader.recipeNoteKey(old) === prefix)) {
                    diagnostics.push({ code: "SUPPLEMENTAL_DATA_DIFFERS", route: index + 1,
                        existing: describe(oldRoute), incoming: describe(newRoutes[index]),
                        message: "相同 NOTE 欄位的值不同；保留人工內容，不自動取代" });
                } else notes.push(note);
            }
            enrichments.push({ key: key.exact, notes, preferred: blocks[index].preferred });
            continue;
        }
        const similar = oldKeys.find(old => old.base === key.base);
        if (similar) {
            diagnostics.push({ code: "RECIPE_VALUES_DIFFER", route: index + 1,
                existing: describe(oldRoutes[oldKeys.indexOf(similar)]), incoming: describe(newRoutes[index]),
                message: "相同設備與材料的數量、產量或 Components 不同，不自動追加衝突配方" });
            continue;
        }
        if (!options.allowPreviewLinks && (/\.preview(?:\||\]\])/i.test(blocks[index].text) || /\[\[[^\]]*\/preview\//i.test(blocks[index].text))) {
            diagnostics.push({ code: "PREVIEW_LINK_IN_UPDATE", route: index + 1, message: "更新稿不可連到暫存 preview" });
            continue;
        }
        additions.push(blocks[index]);
    }
    const newline = original.includes("\r\n") ? "\r\n" : "\n";
    let retained = quarantined.length ? quarantineLegacyRoutes(original, quarantined, newline) : original;
    if (options.groupExistingRoutes) retained = groupExisting(retained, oldRoutes, oldKeys, newKeys,
        { ...options, incomingRoutes: newRoutes }, newline, diagnostics);
    retained = mergeMetadata(retained, generatedText, oldMetadata, newMetadata, diagnostics, newline);
    for (const enrichment of enrichments) {
        const existingBlock = generatedRoutes(retained).find(block => {
            if (block.external) return false;
            const parsed = reader.parseBIO("### " + block.section + "\n" + block.text);
            return parsed.recipes[0] && routeKeys(parsed.recipes[0], options.resolveName).exact === enrichment.key;
        });
        if (!existingBlock) continue;
        if (enrichment.notes.length) {
            const noteText = enrichment.notes.map(note => "\t- [note:: " + note + "]").join(newline);
            const at = existingBlock.recipeEnd || existingBlock.end;
            const left = retained.slice(0, at), right = retained.slice(at);
            retained = left + (/\r?\n$/.test(left) ? "" : newline) + noteText + newline + right;
        }
        if (enrichment.preferred && !/<!-- preferred -->/.test(retained)) {
            retained = retained.slice(0, existingBlock.contentStart) + "<!-- preferred -->" + newline + retained.slice(existingBlock.contentStart);
        }
    }
    const explicitExternal = reader.parseBIO(original, { ...oldMetadata, base_material: false }).recipes.filter(route => route.external);
    for (const block of allBlocks.filter(block => block.external)) {
        const route = reader.parseBIO("### 外部取得\n" + block.text).recipes.find(route => route.external);
        if (!route) continue;
        const matching = explicitExternal.find(old => old.sourceText === route.sourceText);
        if (block.preferred && !/<!-- preferred -->/.test(retained) &&
            (matching || explicitExternal.length && /待人工確認|待補充/.test(route.sourceText))) {
            const existingBlock = generatedRoutes(retained).find(candidate => candidate.external &&
                (!matching || reader.parseBIO("### 外部取得\n" + candidate.text).recipes[0]?.sourceText === matching.sourceText));
            if (existingBlock) retained = retained.slice(0, existingBlock.contentStart) + "<!-- preferred -->" + newline + retained.slice(existingBlock.contentStart);
        }
        if (matching) continue;
        if (explicitExternal.length && /待人工確認|待補充/.test(route.sourceText)) {
            diagnostics.push({ code: "EXTERNAL_DESCRIPTION_PRESERVED", message: "已有人工外部取得說明；保留，不追加通用佔位說明" });
            continue;
        }
        additions.push(block);
        explicitExternal.push(route);
    }
    for (const block of additions) retained = insertRoute(retained, block, newline,
        options.groupExistingRoutes && !block.external ? "Minecraft 原版" : "");
    const previewTags = [...String(generatedText).matchAll(/^#([^#\s]+)\s*$/gm)]
        .map(match => match[0].trim()).filter(tag => !isManagedBIOtag(tag));
    const missingTags = previewTags.filter(tag => !retained.split(/\r?\n/).some(line => line.trim() === tag));
    if (missingTags.length) {
        const fm = retained.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
        const at = fm?.[0].length || 0;
        retained = retained.slice(0, at) + newline + missingTags.join(newline) + newline + retained.slice(at);
    }
    if (options.groupExistingRoutes) {
        const migrated = normalizeBIOOutput(retained);
        if (migrated.diagnostics.some(entry => entry.severity === "ERROR")) {
            return { status: "REVIEW", candidate: original, additions: [],
                diagnostics: [...diagnostics, ...migrated.diagnostics], preservedRoutes };
        }
        retained = migrated.text;
        const classified = normalizeMachineRecipeSections(retained, { rules: options.machineMappings ?? [] });
        retained = classified.text;
        if (options.machineMappings) diagnostics.push(...classified.diagnostics);
        const metadata = parseFrontmatter(retained);
        const baseMaterial = metadata?.base_material === "true";
        const parsed = reader.parseBIO(retained, { ...metadata, base_material: baseMaterial });
        retained = rebuildManagedBIOtags(retained, { baseMaterial, updated: true,
            hasRecipe: parsed.recipes.some(route => !route.external && !route.tagRepresentative) });
    }
    return { status: diagnostics.length ? "REVIEW" : retained !== original ? "ADDITIVE_UPDATE" : "UNCHANGED",
        candidate: retained, additions: additions.map(block => ({ section: block.section, provider: block.provider })), diagnostics, preservedRoutes,
        quarantinedRoutes: quarantined };
}

function planVanillaIncrementalUpdate(original, generated, { resolveName, migrateOutput = false } = {}) {
    const metadata = parseFrontmatter(original);
    const incomingMetadata = parseFrontmatter(generated);
    const id = value => String(value?.minecraft_id || value?.id || '').toLowerCase().replace(/^minecraft:/, '');
    const diagnostics = [];
    const report = (code, message, details = {}) => diagnostics.push({ code, message, ...details });
    const blocked = () => ({ status: 'REVIEW', candidate: original, additions: [], diagnostics });
    if (!id(metadata) || id(metadata) !== id(incomingMetadata) ||
        reader.isTagBIO(metadata) || reader.isTagBIO(incomingMetadata)) {
        report('BIO_IDENTITY_MISMATCH', '正式 BIO 與來源的物品身分不一致');
        return blocked();
    }
    const prior = reader.parseBIO(original, { ...metadata, base_material: false });
    const incoming = reader.parseBIO(generated, { ...incomingMetadata, base_material: false });
    if (prior.diagnostics.length || incoming.diagnostics.length || !incoming.recipes.length) {
        diagnostics.push(...prior.diagnostics, ...incoming.diagnostics);
        report('BIO_ROUTE_UNPARSED', '原有路線或新來源未完整解析，請檢查配方');
        return blocked();
    }
    const key = route => JSON.stringify([route.provider, route.external ? route.sourceText : routeKeys(route, resolveName).exact]);
    const current = new Set(prior.recipes.map(key));
    const seen = new Set(current);
    const parsedBlocks = generatedRoutes(generated).map(block => ({
        block, parsed: reader.parseBIO('### ' + block.section + '\n' +
            (block.provider ? '##### ' + block.provider + '\n' : '') + block.text)
    }));
    if (parsedBlocks.length !== incoming.recipes.length || parsedBlocks.some(({ parsed }) =>
        parsed.diagnostics.length || parsed.recipes.length !== 1) ||
        parsedBlocks.some(({ parsed }, index) => key(parsed.recipes[0]) !== key(incoming.recipes[index]))) {
        report('BIO_ROUTE_BLOCK_MISMATCH', '無法確認新來源的配方區塊，保留原稿');
        return blocked();
    }
    const additions = [];
    const incomingKeys = new Set(incoming.recipes.map(key));
    for (const route of prior.recipes) {
        if (route.provider !== 'Minecraft 原版' || incomingKeys.has(key(route))) continue;
        report('EXISTING_ROUTE_NOT_IN_SOURCE', '新版來源缺少相同的原版路線。原有路線保留，供人工確認是否變更或退役。',
            { existing: route });
    }
    for (const { block, parsed } of parsedBlocks) {
        const route = parsed.recipes[0];
        const routeKey = key(route);
        if (seen.has(routeKey)) continue;
        if (route.external && prior.recipes.some(candidate => candidate.external) && /待人工確認|待補充/.test(route.sourceText)) continue;
        if (!route.external && prior.recipes.some(candidate => !candidate.external && !candidate.provider &&
            routeKeys(candidate, resolveName).exact === routeKeys(route, resolveName).exact)) {
            report('EXISTING_ROUTE_PROVIDER_UNCONFIRMED', '有配方語意相同的既有路線，但未標示 Provider。請人工確認來源。',
                { incoming: route });
            continue;
        }
        seen.add(routeKey);
        additions.push(block);
    }
    let candidate = original;
    if (additions.length) {
        const newline = original.includes('\r\n') ? '\r\n' : '\n';
        const titles = headings(original);
        const root = titles.find(heading => heading.level === 1 && heading.title === '合成/取得');
        const at = root ? titles.find(heading => heading.level === 1 && heading.start > root.start)?.start ?? original.length : original.length;
        const appended = additions.map(block => ['### ' + block.section,
            ...(block.provider ? ['##### ' + block.provider] : []), block.text].join('\n\n')).join('\n\n');
        candidate = original.slice(0, at) + newline + newline + (!root ? '# 合成/取得' + newline + newline : '') +
            appended.replace(/\r?\n/g, newline) + newline + newline + original.slice(at);
        if (migrateOutput) candidate = normalizeBIOOutput(candidate).text;
        const result = reader.parseBIO(candidate, { ...metadata, base_material: false });
        const baseline = prior.recipes.map(route => [key(route), route.preferred]);
        const retained = result.recipes.slice(0, baseline.length).map(route => [key(route), route.preferred]);
        if (result.diagnostics.length || JSON.stringify(retained) !== JSON.stringify(baseline) ||
            result.recipes.length !== baseline.length + additions.length ||
            result.preferredMarkers !== prior.preferredMarkers) {
            report('EXISTING_DEFAULT_AT_RISK', '追加後無法確認原路線順序與 Preferred，保留原稿');
            return blocked();
        }
        if (!result.explicitPreferred && result.recipes.length > 1)
            report('PREFERRED_SELECTION_REQUIRED', '更新候選有多條路線，請人工指定 Preferred');
    }
    if (prior.preferredMarkers > 1 || prior.preferredMarkers > prior.explicitPreferred)
        report('EXISTING_PREFERRED_REQUIRES_REVIEW', '既有 Preferred 重複或未對應有效路線，請人工確認');
    return { status: diagnostics.length || additions.length ? 'REVIEW' : 'UNCHANGED',
        candidate, diagnostics, additions: additions.map(({ section, provider }) => ({ section, provider })) };
}

function refreshVanillaRecipeBlocks(original, generated, options) {
    return planVanillaIncrementalUpdate(original, generated, options).candidate;
}

module.exports = { planBIOUpdate, planVanillaIncrementalUpdate, metadataIsAdditive, BIO_UPDATE_MERGE_VERSION, routeKeys,
    routeIsLegalSpecialization, extractLegacyRecipeReviews, refreshVanillaRecipeBlocks };
