const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseFrontmatter } = require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');
const reader = require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');
const { previewRoots } = require('./bio-preview-paths.cjs');
const { checkDependencies } = require('./bio-dependency-check.cjs');
const stableHash = value => createHash('sha256').update(value).digest('hex');
const key = value => String(value).replace(/\\/g, '/').replace(/\.md$/i, '').normalize('NFC').toLowerCase();

const { formalRoots, isFormalPath, providerRecords } = require('../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping');

function walkMarkdown(root, folder, visit, recursive = true) {
    const directory = path.join(root, folder);
    const info = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink() ||
        path.relative(fs.realpathSync(root), fs.realpathSync(directory)) !== path.normalize(folder)) throw new Error('無效 BIO 資料夾：' + folder);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = folder + '/' + entry.name;
        if (entry.isDirectory() && recursive) walkMarkdown(root, relative, visit);
        if (entry.isFile() && /\.md$/i.test(entry.name)) visit(relative, fs.readFileSync(path.join(root, relative), 'utf8'));
    }
}

function readStandalonePreviews(root) {
    const drafts = [];
    const published = new Set();
    const receipts = path.join(root, 'review', 'bio-publications');
    if (fs.existsSync(receipts)) for (const name of fs.readdirSync(receipts)) {
        if (!name.endsWith('.json')) continue;
        const receipt = JSON.parse(fs.readFileSync(path.join(receipts, name), 'utf8'));
        if (receipt.status !== 'COMPLETE') continue;
        for (const file of receipt.files || []) if (file.written && file.draftPath) published.add(file.draftPath + '\0' + file.previewSHA256);
    }
    for (const folder of previewRoots) for (const source of ['mini', 'plugin', 'material-base']) walkMarkdown(root, folder + '/' + source, (relative, text) => {
        if (!relative.endsWith('.preview.md')) return;
        if (published.has(relative + '\0' + stableHash(text))) return;
        const metadata = parseFrontmatter(text);
        if (metadata?.preview_source !== source || !metadata.publish_target) throw new Error('Preview 來源或正式目的地未確認：' + relative);
        drafts.push({ relative, text, metadata, source });
    });
    return drafts;
}

function explicitRoutes(text, metadata) {
    return reader.parseBIO(text, { ...metadata, base_material: false });
}

function activeMarkdown(text) {
    let fence = null;
    return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n/).filter(line => {
        const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
            return false;
        }
        return !fence;
    });
}

function vanillaBase(text) {
    const routes = explicitRoutes(text, parseFrontmatter(text)).recipes;
    const preferred = routes.filter(route => route.preferred);
    const base = preferred.length === 1 && preferred[0].external === true;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return text.replace(/^(\uFEFF?---\r?\n)([\s\S]*?)(^---(?:\r?\n|$))/m, (_, start, body, end) =>
        start + body.replace(/^base_material:[^\r\n]*(?:\r?\n|$)/gm, '') + (base ? 'base_material: true' + newline : '') + end);
}

function reviewCandidates(plan, mapping, onIssue) {
    const roots = formalRoots(mapping), providers = providerRecords(mapping);
    const nodes = new Map(), aliases = new Map(), ids = new Map(), diagnostics = [], formal = new Map(), sources = new Map();
    const sourceTexts = new Map(), normalizedSources = new Map();
    const issue = (entry, code, message, affectedPaths, details) => {
        const diagnostic = { path: entry, code, message, affectedPaths, ...details };
        diagnostics.push(diagnostic);
        onIssue?.(diagnostic);
    };
    function index(index, name, file) {
        if (!name) return;
        const list = index.get(key(name)) || new Set();
        list.add(file); index.set(key(name), list);
    }
    function add(file, text, candidate) {
        const metadata = parseFrontmatter(text);
        if (!metadata?.id || !/^(mc-item|mc-drop|mc-tag|sf-item|sf-drop|sf-GEO)$/.test(metadata.type)) return;
        const id = metadata.minecraft_tag ? '#' + metadata.minecraft_tag : metadata.derived_group ||
            (metadata.type === 'mc-tag' ? 'tag:custom:' + metadata.id :
                metadata.type.startsWith('mc-') ? 'minecraft:' + String(metadata.minecraft_id || metadata.id).replace(/^minecraft:/i, '') : 'sf:' + metadata.id);
        index(ids, id, file);
        for (const name of [file, path.posix.basename(file), metadata.id, metadata.minecraft_id, id, ...[].concat(metadata.aliases || [])]) index(aliases, name, file);
        if (!candidate) formal.set(file, stableHash(text));
        nodes.set(file, { metadata, text, candidate });
    }
    const staged = new Set(plan.entries.map(entry => key(entry.targetPath)));
    for (const root of roots) walkMarkdown(plan.root, root.folder, (file, text) => {
        if (!staged.has(key(file)) && isFormalPath(file, roots)) add(file, text, false);
    }, root.recursive);
    for (const entry of plan.entries) add(entry.targetPath, entry.text, entry);
    const byPath = new Map([...nodes.keys()].map(file => [key(file), file]));
    const resolve = name => {
        const direct = byPath.get(key(name));
        if (direct) return direct;
        const matches = aliases.get(key(name));
        return matches?.size === 1 ? [...matches][0] : null;
    };
    for (const [id, paths] of ids) if (paths.size > 1 && [...paths].some(file => staged.has(key(file)))) issue([...paths].join(' / '), 'DUPLICATE_ID', id, [...paths]);
    const pending = [...plan.entries.map(entry => entry.targetPath)];
    const visited = new Set(), dependencies = new Map(), equipmentEdges = new Set();
    const requiredMachines = new Set(), parsedNodes = new Map();
    for (let i = 0; i < pending.length; i++) {
        const file = pending[i];
        if (visited.has(file)) continue;
        visited.add(file);
        const node = nodes.get(file);
        if (!node) { issue(file, 'INVALID_IDENTITY', '缺少有效 BIO type 或 ID'); continue; }
        const { metadata, text, candidate } = node;
        const parsed = candidate ? explicitRoutes(text, metadata) : reader.parseBIO(text, { ...metadata, base_material: metadata.base_material === 'true' });
        parsedNodes.set(file, parsed);
        const preferred = parsed.recipes.filter(route => route.preferred);
        const collection = reader.isTagBIO(metadata);
        if (candidate) {
            if (!/^[A-Za-z0-9_.:-]+$/.test(metadata.id)) issue(file, 'INVALID_IDENTITY', 'YAML id 格式無效');
            const body = activeMarkdown(text);
            const markerCount = body.filter(line => line.trim() === '<!-- preferred -->').length;
            for (const diagnostic of parsed.diagnostics) issue(file, diagnostic.code, diagnostic.message);
            const validMarker = collection ? parsed.recipes[0]?.ingredients[0]?.choices?.filter(choice => choice.preferred).length === 1 : preferred.length === 1;
            const singleUnmarkedUpdate = Boolean(candidate.sourcePath && !collection &&
                parsed.recipes.length === 1 && !preferred.length && !markerCount);
            if (!singleUnmarkedUpdate && (!parsed.recipes.length || preferred.length > 1 || markerCount !== 1 || !validMarker))
                issue(file, 'PREFERRED_REQUIRED', '須恰好一條有效 Preferred 路線', undefined,
                    { previewPath: path.relative(plan.root, candidate.previewPath).split(path.sep).join('/') });
            if (!collection) {
                const machineRows = body.filter(line => /^\s*-.*\(Machine\s*::/i.test(line));
                const machineRecipes = parsed.recipes.filter(route => !route.external && !route.tagRepresentative);
                if (machineRows.length !== machineRecipes.length) issue(file, 'UNPARSED_MACHINE_ROUTE', '設備配方缺少可解析的設備或材料');
                let recipeRoot = false, section = false;
                for (const line of body) {
                    if (/^#\s/.test(line)) { recipeRoot = /^# 合成\/取得\s*$/.test(line); section = false; }
                    if (/^###\s/.test(line)) section = recipeRoot;
                    if ((/^#####\s/.test(line) || /^\s*-.*\(Machine\s*::/i.test(line)) && !section)
                        issue(file, 'INVALID_HEADING_SCOPE', '設備／五級標題須在合成/取得的三級生產體系內');
                }
                if (!body.some(line => /^# 合成\/取得\s*$/.test(line))) issue(file, 'MISSING_RECIPE_ROOT', '缺少 # 合成/取得');
            }
            if (candidate.draftSource === 'material-base') {
                if (!metadata.type.startsWith('mc-') || preferred.length !== 1 || !preferred[0].external || metadata.base_material !== 'true')
                    issue(file, 'INVALID_MATERIAL_BASE', '材料 Base 預覽須有有效原版身份及外部取得首選');
            } else if (candidate.draftSource === 'mini' && collection) {
                if (candidate.draftMetadata.preview_mode !== 'manual' || candidate.draftMetadata.preview_evidence !== 'manual')
                    issue(file, 'INVALID_PROVIDER_SOURCE', '自訂 Tag 須標明手動建立');
            } else if (candidate.draftSource) {
                const normalizedDraft = candidate.draftSource === 'plugin' && Boolean(candidate.draftMetadata.preview_registry_sha256);
                const provider = providers.get(normalizedDraft
                    ? candidate.draftMetadata.preview_recipe_provider || candidate.draftMetadata.recipe_provider
                    : candidate.draftMetadata.recipe_provider);
                const evidence = candidate.draftMetadata.preview_evidence;
                const sourcePath = typeof evidence === 'string' && /^參考資料\/[^\\:]+$/.test(evidence) &&
                    evidence.split('/').every(part => part && !part.startsWith('.')) ? path.join(plan.root, evidence) : null;
                const validSource = sourcePath && fs.lstatSync(sourcePath, { throwIfNoEntry: false })?.isFile() &&
                    path.relative(fs.realpathSync(plan.root), fs.realpathSync(sourcePath)) === path.normalize(evidence);
                if (validSource && !sourceTexts.has(evidence)) sourceTexts.set(evidence,fs.readFileSync(sourcePath,'utf8'));
                const source = validSource ? sourceTexts.get(evidence) : '';
                if (validSource && !sources.has(evidence)) sources.set(evidence, stableHash(source));
                let normalizedCited = false;
                if (normalizedDraft) {
                    try {
                        if (!normalizedSources.has(evidence)) normalizedSources.set(evidence,require('./normalized-source.cjs').normalizedSource(JSON.parse(source)));
                        const registry = normalizedSources.get(evidence);
                        const itemId = metadata.type.startsWith('sf-') ? 'slimefun:' + metadata.id : metadata.minecraft_id;
                        if (!validSource || sources.get(evidence) !== candidate.draftMetadata.preview_registry_sha256 ||
                            registry.provider_id !== provider?.id || !registry.items.some(value => value.id === itemId)) throw new Error('Normalized source hash／provider／物品身分不一致');
                        normalizedCited = true;
                    } catch (error) { issue(file, 'INVALID_NORMALIZED_SOURCE', error.message); }
                }
                const escapedId = String(metadata.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const mode = candidate.draftMetadata.preview_mode;
                const cited = normalizedDraft ? normalizedCited : mode === 'manual' ? evidence === 'manual' : validSource &&
                    ['java', 'yaml', 'plugin'].includes(mode) && new RegExp('(?:^|[^\\w])' + escapedId + '(?![\\w])', 'm').test(source);
                if (!provider || (!normalizedDraft && metadata.provider_id !== provider.id) || !cited) {
                    issue(file, 'INVALID_PROVIDER_SOURCE', '來源插件或佐證未確認');
                }
                const priorRoutes = new Map();
                if (normalizedDraft && candidate.source) {
                    const original = candidate.source.toString('utf8');
                    const prior = explicitRoutes(original, parseFrontmatter(original));
                    for (const route of prior.recipes) priorRoutes.set(route.key, (priorRoutes.get(route.key) || 0) + 1);
                }
                if (parsed.recipes.some(route => {
                    const remaining = priorRoutes.get(route.key) || 0;
                    if (remaining) { priorRoutes.set(route.key, remaining - 1); return false; }
                    return !route.external && route.provider !== provider?.heading;
                }))
                    issue(file, 'INVALID_PROVIDER_HEADING', '五級標題須符合來源插件');
            }
        }
        const selected = preferred[0] || parsed.recipes[0];
        const selectedGroups = [];
        if (selected && !selected.external && !selected.tagRepresentative && !reader.isManualMachine(selected.machine)) {
            const machine = resolve(selected.machine);
            if (!machine) {
                const matches = [...(aliases.get(key(selected.machine)) || [])].sort();
                issue(file, matches.length > 1 ? 'AMBIGUOUS_MACHINE' : 'UNRESOLVED_MACHINE',
                    '生產設備無法唯一解析：' + selected.machine, undefined,
                    { machine: selected.machine, matches });
                selectedGroups.push([]);
            } else {
                selectedGroups.push([machine]);
                equipmentEdges.add(JSON.stringify([file, machine]));
                requiredMachines.add(machine);
                pending.push(machine);
            }
        }
        for (const route of (candidate ? parsed.recipes : [selected].filter(Boolean))) {
            if (candidate && (!route.section || (!route.external && !route.tagRepresentative && !route.machine))) issue(file, 'INVALID_RECIPE_SECTION', '配方須位於有效三級生產體系');
            for (const ingredient of route.ingredients) {
                let alternatives = ingredient.choices?.length ? ingredient.choices : [ingredient];
                if (ingredient.excludeSelf) {
                    const group = reader.inferExceptSelfGroupId(metadata);
                    const collectionFile = group && resolve(group);
                    const collectionNode = nodes.get(collectionFile);
                    const members = collectionNode && explicitRoutes(collectionNode.text, collectionNode.metadata).recipes
                        .find(value => value.tagRepresentative)?.ingredients[0]?.choices;
                    alternatives = (members || []).filter(choice => resolve(choice.name) !== file);
                    if (!alternatives.length) issue(file, 'INVALID_EXCEPT_SELF', '集合不明或沒有合法成員');
                }
                const matches = [];
                let hasRawId = false;
                for (const choice of alternatives) {
                    const target = resolve(choice.name);
                    if (!target) {
                        const candidates = [...(aliases.get(key(choice.name)) || [])].sort();
                        const details = { provider: route.provider, machine: route.machine };
                        if (candidates.length > 1) {
                            issue(file, 'AMBIGUOUS_MATERIAL', choice.name, undefined, { ...details, matches: candidates });
                        } else if (choice.rawId) {
                            const approvalKey = stableHash(JSON.stringify(['raw-id', plan.currentInput, plan.manifestSHA256,
                                file, candidate?.previewSHA256 || formal.get(file), choice.name, choice.type]));
                            const previewPath = candidate ? path.relative(plan.root, candidate.previewPath).split(path.sep).join('/') : file;
                            issue(file, 'RAW_ID_REVIEW', choice.name, undefined, { ...details, previewPath, approvalKey });
                            hasRawId = true;
                        } else {
                            issue(file, 'UNRESOLVED_MATERIAL', choice.name, undefined, details);
                        }
                        continue;
                    }
                    matches.push(target);
                    if (route === selected) pending.push(target);
                }
                if (candidate && route.tagRepresentative && new Set(matches).size !== matches.length)
                    issue(file, 'DUPLICATE_TAG_MEMBER', '多個 Tag 成員指向同一份 BIO');
                if (route === selected && !hasRawId) selectedGroups.push(matches);
            }
        }
        dependencies.set(file, selectedGroups);
    }
    for (const machine of requiredMachines) {
        if (!parsedNodes.get(machine)?.recipes.length || reader.isTagBIO(nodes.get(machine)?.metadata)) {
            dependencies.set(machine, [[]]);
            issue(machine, 'INVALID_MACHINE_RECIPE', '生產設備缺少取得路線或誤指向材料集合');
        }
    }
    const { resolved, cycleFrom } = checkDependencies(dependencies, equipmentEdges);
    for (const entry of plan.entries) if (!resolved.has(entry.targetPath)) {
        const witness = cycleFrom(entry.targetPath);
        if (witness?.equipment) issue(entry.targetPath, 'EQUIPMENT_DEPENDENCY_CYCLE',
            '設備建造依賴循環：' + witness.cycle.join(' → '), undefined,
            { cycle: witness.cycle, previewPath: path.relative(plan.root, entry.previewPath).split(path.sep).join('/') });
        issue(entry.targetPath, 'DEPENDENCY_BLOCKED', 'Preferred 依賴有循環或無有效材料／設備' +
            (witness ? '：' + witness.cycle.join(' → ') : ''), undefined,
            { previewPath: path.relative(plan.root, entry.previewPath).split(path.sep).join('/') });
    }
    return { diagnostics, formal: [...formal, ...sources].sort(([a], [b]) => a.localeCompare(b)) };
}

module.exports = { formalRoots, isFormalPath, providerRecords, readStandalonePreviews, vanillaBase, reviewCandidates, stableHash };
