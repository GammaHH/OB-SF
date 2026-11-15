// Additive update proposals only. No filesystem writes or Obsidian dependencies.
const reader = require("../../搜尋介面模塊/bio_reader_v4");
const { parseFrontmatter } = require("./bio_scanner");
const { isManagedBIOtag, normalizeTag, parseTagList, rebuildManagedBIOtags } = require("./bio_tags");
const { normalizeMachineRecipeSections } = require("./machine_recipe_mapping");
const { normalizeBIOOutput } = require("./bio_output");
const BIO_UPDATE_MERGE_VERSION = 5;

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
                preferred: pending != null, external };
            pending = null;
        }
        if (block) block.lines.push(line);
        offset += raw.length;
    }
    finish();
    return result;
}

const ADDABLE_METADATA = new Set(["id", "type", "minecraft_id", "base_material", "generated_by", "generator_schema", "aliases", "level"]);

function metadataIsAdditive(before, after, options = {}) {
    if (!before || !after) return false;
    for (const [key, value] of Object.entries(before)) {
        if (key === "output" && !(key in after) && options.allowOutputRemoval) continue;
        if (key === "tags") {
            const custom = parseTagList(value).filter(tag => !isManagedBIOtag(tag)).map(normalizeTag);
            const retained = parseTagList(after.tags).map(normalizeTag);
            if (!custom.every(tag => retained.includes(tag)) || retained.some(isManagedBIOtag)) return false;
        } else if (key === "aliases" && Array.isArray(value) && Array.isArray(after.aliases)) {
            if (!value.every(alias => after.aliases.includes(alias))) return false;
        } else if (JSON.stringify(value) !== JSON.stringify(after[key])) return false;
    }
    return Object.keys(after).every(key => key in before || ADDABLE_METADATA.has(key));
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
                const matched = index >= 0 && newKeys.some(key => key.exact === oldKeys[index].exact);
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
    const oldRoutes = existing.recipes.filter(route => !route.external && !route.tagRepresentative);
    const newRoutes = incoming.recipes.filter(route => !route.external && !route.tagRepresentative);
    const machineRows = original.match(/\(Machine\s*::/gi) || [];
    if (machineRows.length !== oldRoutes.length) diagnostics.push({
        code: "EXISTING_ROUTE_UNPARSED", message: "原 BIO 部分設備配方未完整解析；保留原文" });
    const oldKeys = oldRoutes.map(route => routeKeys(route, options.resolveName));
    const newKeys = newRoutes.map(route => routeKeys(route, options.resolveName));
    const describe = route => ({ machine: route.machine, ingredients: route.ingredients,
        output: route.output, components: route.components, notes: route.notes || [] });
    for (let index = 0; index < oldKeys.length; index++) {
        if (newKeys.some(key => key.exact === oldKeys[index].exact)) continue;
        const source = options.classifyExistingRoute?.(oldRoutes[index]) ||
            (/^(?:Slimefun 原版|SF-)/.test(oldRoutes[index].provider || "") ? { provider: oldRoutes[index].provider } : null);
        if (source) {
            preservedRoutes.push({ code: "OTHER_SOURCE_PRESERVED", provider: source.provider,
                evidence: source.evidence, existing: describe(oldRoutes[index]),
                message: "其他科技提供的路線已保留，不要求出現在 Vanilla JSON 中" });
            continue;
        }
        diagnostics.push({
            code: "EXISTING_ROUTE_NOT_IN_SOURCE", route: index + 1,
            existing: describe(oldRoutes[index]),
            message: "舊路線未出現在本次來源資料，可能是人工／插件配方；保留並請人工審核" });
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
    let retained = options.groupExistingRoutes ? groupExisting(original, oldRoutes, oldKeys, newKeys, options, newline, diagnostics) : original;
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
            retained = retained.slice(0, existingBlock.end) + newline + noteText + newline + retained.slice(existingBlock.end);
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
        candidate: retained, additions: additions.map(block => ({ section: block.section, provider: block.provider })), diagnostics, preservedRoutes };
}

module.exports = { planBIOUpdate, metadataIsAdditive, BIO_UPDATE_MERGE_VERSION };
