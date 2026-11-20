// Publish an inspected, editable preview batch. Never copy the preview tree.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseFrontmatter, scanMinecraftBIOs } = require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');
const { preservesBIOContent } = require('./bio-apply.cjs');
const { metadataIsAdditive, extractLegacyRecipeReviews } = require('../../BIO相關模組/MC解析器模塊/bio/bio_update');
const { formalRoots, isFormalPath, readStandalonePreviews, vanillaBase, reviewCandidates } = require('./bio-review.cjs');
const { RECIPE_MAPPING_FILE, parseMachineRecipeMappings } = require('../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping');
const { publicationBlockingTags, stripManagedBIOtags } = require('../../BIO相關模組/MC解析器模塊/bio/bio_tags');
const reader = require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');
const { colorFamily } = require('../../BIO相關模組/MC解析器模塊/bio/bio_group_mapping');
const { resolveTranslatedName } = require('../../BIO相關模組/MC解析器模塊/bio/bio_generator');
const hash = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const withoutMD = value => value.replace(/\.md$/i, '');
const standaloneManifest = 'MC-自動化BIO/preview/standalone/BIO Publication.json';
const PUBLICATION_ISSUE_LIMIT = 2000;
const standaloneGenerators = new Map([
    ['mini', 'obsf-mini-parser'],
    ['material-base', 'minecraft-bio-publication-scan']
]);

function selectPublicationManifest(root, explicit, { command = 'scan-publication', useActive = true, includeStandalone = true } = {}) {
    root = path.resolve(root);
    const select = relative => {
        const file = inside(root, relative, 'MC-自動化BIO/preview');
        if (path.basename(file) !== 'BIO Publication.json') throw new Error('請指定 BIO Publication.json');
        if (!includeStandalone && slash(path.relative(root, file)) === standaloneManifest)
            throw new Error('請指定既有 Vanilla 批次的 BIO Publication.json');
        if (slash(path.relative(root, file)) !== standaloneManifest && !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
            throw new Error('找不到發布清單：' + relative);
        return slash(path.relative(root, file));
    };
    if (explicit !== undefined && explicit !== null) return select(explicit);
    const mappingFile = path.join(root, RECIPE_MAPPING_FILE);
    const active = fs.existsSync(mappingFile) ? parseFrontmatter(fs.readFileSync(mappingFile, 'utf8'))?.active_preview_manifest : null;
    if (useActive && active) return select(active);

    const previewRoot = inside(root, 'MC-自動化BIO/preview', 'MC-自動化BIO');
    const candidates = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) visit(file);
            else if (entry.isFile() && entry.name === 'BIO Publication.json') {
                const relative = slash(path.relative(root, file));
                if (relative !== standaloneManifest) candidates.push(relative);
            }
        }
    }
    if (fs.existsSync(previewRoot)) visit(previewRoot);
    candidates.sort();
    if (candidates.length === 1) return select(candidates[0]);
    if (candidates.length > 1) {
        const commands = candidates.map(relative => '  node scripts/minecraft-bio-generator.cjs ' + command + ' --manifest=' + JSON.stringify(relative));
        const advice = useActive ? '請選擇一條指令，或設定 active_preview_manifest' : '請用 --manifest 指定';
        throw new Error('找到多個 Preview 批次，' + advice + '：\n' + commands.join('\n'));
    }
    if (includeStandalone && readStandalonePreviews(root).length) return select(standaloneManifest);
    throw new Error('找不到可掃描的 Preview 批次');
}

function inside(root, relative, prefix) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('發布路徑必須是 Vault 相對路徑');
    const absolute = path.resolve(root, relative), local = slash(path.relative(root, absolute));
    if (!local || local.startsWith('../') || local === '..' || (prefix && !local.startsWith(prefix + '/'))) throw new Error('發布路徑超出允許範圍：' + relative);
    let cursor = absolute;
    while (cursor !== root) {
        if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('發布不支援連結路徑：' + relative);
        cursor = path.dirname(cursor);
    }
    return absolute;
}

function identity(metadata) {
    const explicitTag = metadata?.type === 'mc-tag';
    if ((explicitTag || metadata?.tag_identity === 'minecraft:item_tag') && metadata.minecraft_tag) return 'tag:' + String(metadata.minecraft_tag).replace(/^#/, '');
    if ((explicitTag || metadata?.tag_identity === 'obsf:derived_ingredient_group') && metadata.derived_group) return 'group:' + metadata.derived_group;
    if (explicitTag) {
        const id = metadata.id || metadata.legacyId;
        return /^[A-Za-z0-9_.:-]+$/.test(id || '') ? 'tag:custom:' + id.toLowerCase() : null;
    }
    // Frontmatter exposes minecraft_id/id; scanner entries expose
    // normalizedId/legacyId. Keep canonical identity ahead of legacy aliases.
    const id = String(metadata?.minecraft_id || metadata?.normalizedId || metadata?.id || metadata?.legacyId || '').toLowerCase();
    return id ? (id.includes(':') ? id : 'minecraft:' + id) : null;
}

function inputFingerprint(root) {
    const names = ['Minecraft Review Decisions.json', 'Minecraft Tag BIO Mapping Draft.md',
        'Minecraft BIO Group Mapping Draft.md', RECIPE_MAPPING_FILE];
    function visit(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) throw new Error('來源不支援符號連結：' + full);
            if (entry.isDirectory()) visit(full);
            else if (entry.isFile() && /\.json$/i.test(entry.name)) names.push(slash(path.relative(root, full)));
        }
    }
    visit(path.join(root, '參考資料', 'Minecraft'));
    return hash(JSON.stringify(names.sort().map(name => [name, fs.existsSync(path.join(root, name)) ? hash(fs.readFileSync(path.join(root, name))) : null])));
}

function publicationManifest(root, batchDirectory, records) {
    const targets = new Set(), identities = new Set();
    for (const record of records) {
        inside(root, record.targetPath, 'MC-物品資料庫');
        if (!record.targetPath.endsWith('.md')) throw new Error('發布目的必須是 Markdown BIO');
        if (targets.has(record.targetPath.toLowerCase()) || identities.has(record.identity)) throw new Error('發布身份／目的檔名重複：' + record.identity);
        targets.add(record.targetPath.toLowerCase()); identities.add(record.identity);
        const source = path.join(root, record.targetPath);
        if (record.sourcePath) {
            if (record.sourcePath !== record.targetPath) throw new Error('既有 BIO 發布路徑不可搬移');
            record.sourceSHA256 = hash(fs.readFileSync(inside(root, record.sourcePath, 'MC-物品資料庫')));
        } else if (fs.existsSync(source)) throw new Error('新 BIO 檔名已被其他資料占用：' + record.targetPath);
    }
    return { schemaVersion: 1, kind: 'obsf-bio-publication', batchDirectory: slash(path.relative(root, batchDirectory)),
        inputFingerprint: inputFingerprint(root), entries: records };
}

function parseBIOLevel(metadata) {
    const value = metadata?.level;
    if (value == null || (typeof value === 'string' && !value.trim())) return 0;
    const raw = typeof value === 'number' ? String(value) : value;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) throw new Error('LEVEL 必須為空白或非負安全整數');
    const level = Number(raw.trim());
    if (!Number.isSafeInteger(level) || level < 0) throw new Error('LEVEL 必須為空白或非負安全整數');
    return level;
}

function previewSemanticPayload(text, { ignorePreferred = false, ignoreLevel = false, ignoreBase = false } = {}) {
    const metadata = parseFrontmatter(text);
    const parsed = reader.parseBIO(text, { ...metadata, base_material: !ignoreBase && metadata?.base_material === 'true' });
    const ingredient = (value, representative = false) => ({ name: representative ? undefined : value.name, qty: value.qty, excludeSelf: Boolean(value.excludeSelf),
        defaultName: representative ? undefined : value.defaultName, choiceId: value.choiceId, choiceKind: value.choiceKind,
        choices: value.choices?.map(choice => ingredient(choice)) });
    const fields = Object.fromEntries(Object.entries(metadata || {}).filter(([key]) => key !== 'type' && (!ignoreLevel || key !== 'level') && (!ignoreBase || key !== 'base_material')).sort(([a], [b]) => a.localeCompare(b)));
    return { metadata: fields, recipes: parsed.recipes.filter(route => !ignoreBase || !route.external).map(route => ({ section: route.section, provider: route.provider,
        machine: route.machine, preferred: ignorePreferred ? undefined : route.preferred, external: route.external, sourceText: route.sourceText,
        tagRepresentative: route.tagRepresentative, output: route.output, notes: route.notes,
        ingredients: route.ingredients.map(value => ingredient(value, ignorePreferred && route.tagRepresentative)) })) };
}

function previewSemanticHash(text, options = {}) {
    return hash(JSON.stringify(previewSemanticPayload(text, options)));
}

function allowPreferredEdits(root, manifestRelative) {
    root = path.resolve(root);
    const manifestPath = inside(root, manifestRelative, 'MC-自動化BIO/preview');
    const bytes = fs.readFileSync(manifestPath), manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.kind !== 'obsf-bio-publication' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('不是完整的 BIO Publication.json');
    const batchDirectory = inside(root, manifest.batchDirectory, 'MC-自動化BIO/preview');
    if (path.dirname(manifestPath) !== batchDirectory) throw new Error('發布清單與批次不一致');
    if (manifest.inputFingerprint !== inputFingerprint(root)) throw new Error('來源／決策／Mapping 已變更，請重新產生預覽');
    let upgraded = 0;
    for (const entry of manifest.entries) {
        const preview = inside(root, slash(path.relative(root, path.resolve(batchDirectory, entry.previewFilename))), manifest.batchDirectory);
        const text = fs.readFileSync(preview, 'utf8');
        parseBIOLevel(parseFrontmatter(text));
        if (entry.baselineWithoutPreferredAndLevel) {
            if (previewSemanticHash(text, { ignorePreferred: true, ignoreLevel: true }) !== entry.baselineWithoutPreferredAndLevel) throw new Error('預覽配方或身份已變更：' + entry.identity);
            continue;
        }
        const signature = previewSemanticHash(text, { ignorePreferred: true });
        if (entry.baselineWithoutPreferred) {
            if (signature !== entry.baselineWithoutPreferred) throw new Error('預覽配方或身份已變更：' + entry.identity);
            continue;
        }
        // An old hash cannot prove which recipe fields changed. Establish the
        // relaxed baseline only while the old strict baseline still matches.
        if (identity(parseFrontmatter(text)) !== entry.identity || previewSemanticHash(text) !== entry.baselineSemantic) {
            throw new Error('舊批次須先保留原 preferred 與配方再升級：' + entry.identity + '；type／等價排版可保留');
        }
        entry.baselineWithoutPreferred = signature; upgraded++;
    }
    if (!upgraded) return { upgraded: 0, alreadyEnabled: true };
    const suffix = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const backup = manifestPath + '.before-preferred-' + suffix + '.json';
    fs.writeFileSync(backup, bytes, { flag: 'wx' });
    const temporary = manifestPath + '.' + suffix + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' });
        if (hash(fs.readFileSync(manifestPath)) !== hash(bytes)) throw new Error('升級期間清單已變更');
        fs.renameSync(temporary, manifestPath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { upgraded, backup: slash(path.relative(root, backup)), formalBIOsWritten: 0 };
}

// Upgrade only the level editing policy. A finite level substitution must match
// a previously signed payload; a new hash of arbitrary current content is never
// accepted as proof. Preferred edits are permitted only if already signed so.
function allowLevelEdits(root, manifestRelative) {
    root = path.resolve(root);
    const manifestPath = inside(root, manifestRelative, 'MC-自動化BIO/preview');
    const bytes = fs.readFileSync(manifestPath), manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.kind !== 'obsf-bio-publication' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('不是完整的 BIO Publication.json');
    const batchDirectory = inside(root, manifest.batchDirectory, 'MC-自動化BIO/preview');
    if (path.dirname(manifestPath) !== batchDirectory) throw new Error('發布清單與批次不一致');
    if (manifest.inputFingerprint !== inputFingerprint(root)) throw new Error('來源／決策／Mapping 已變更，請重新產生預覽');
    const absent = Symbol('absent-level');
    let upgraded = 0;
    for (const entry of manifest.entries) {
        const preview = inside(root, slash(path.relative(root, path.resolve(batchDirectory, entry.previewFilename))), manifest.batchDirectory);
        const text = fs.readFileSync(preview, 'utf8'), metadata = parseFrontmatter(text);
        parseBIOLevel(metadata);
        if (identity(metadata) !== entry.identity) throw new Error('預覽身份被修改：' + entry.identity);
        const signature = previewSemanticHash(text, { ignorePreferred: true, ignoreLevel: true });
        if (entry.baselineWithoutPreferredAndLevel) {
            if (!/^[a-f0-9]{64}$/.test(entry.baselineWithoutPreferredAndLevel) || signature !== entry.baselineWithoutPreferredAndLevel) throw new Error('預覽配方或身份已變更：' + entry.identity);
            continue;
        }
        const ignorePreferred = Boolean(entry.baselineWithoutPreferred);
        const expected = entry.baselineWithoutPreferred || entry.baselineSemantic;
        if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('舊批次缺少有效的已簽語意基準：' + entry.identity);
        const candidates = [absent, '', '0'];
        if (entry.sourcePath) {
            if (entry.sourcePath !== entry.targetPath) throw new Error('既有 BIO 發布路徑不可搬移');
            const source = fs.readFileSync(inside(root, entry.sourcePath, 'MC-物品資料庫'));
            if (hash(source) !== entry.sourceSHA256) throw new Error('原 BIO 已變更：' + entry.identity);
            const sourceMetadata = parseFrontmatter(source.toString('utf8'));
            if (identity(sourceMetadata) !== entry.identity) throw new Error('原 BIO 身份不符：' + entry.identity);
            if (Object.hasOwn(sourceMetadata || {}, 'level')) candidates.push(sourceMetadata.level);
        }
        const payload = previewSemanticPayload(text, { ignorePreferred });
        // Unchanged arbitrary levels remain provable without inventing candidates.
        let proved = hash(JSON.stringify(payload)) === expected;
        for (const oldLevel of candidates) {
            if (proved) break;
            const fields = { ...payload.metadata };
            if (oldLevel === absent) delete fields.level;
            else fields.level = oldLevel;
            const previous = { ...payload, metadata: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))) };
            proved = hash(JSON.stringify(previous)) === expected;
        }
        if (!proved) throw new Error('無法證明只有 LEVEL 修改：' + entry.identity + '；請保留原配方／身份，舊嚴格基準也須保留原 preferred');
        entry.baselineWithoutPreferredAndLevel = signature; upgraded++;
    }
    if (!upgraded) return { upgraded: 0, alreadyEnabled: true, formalBIOsWritten: 0 };
    const suffix = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const backup = manifestPath + '.before-level-' + suffix + '.json';
    fs.writeFileSync(backup, bytes, { flag: 'wx' });
    const temporary = manifestPath + '.' + suffix + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' });
        if (hash(fs.readFileSync(manifestPath)) !== hash(bytes)) throw new Error('升級期間清單已變更');
        fs.renameSync(temporary, manifestPath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { upgraded, backup: slash(path.relative(root, backup)), formalBIOsWritten: 0 };
}

// Only rewrite actual wikilink targets and the names in choices metadata.
// Pictures, URLs, prose, aliases and code blocks are retained verbatim.
function mapBodyLines(text, transform) {
    let fence = null, comment = false, frontmatter = /^\uFEFF?---\r?\n/.test(text), first = true;
    return (String(text).match(/[^\n]*\n|[^\n]+$/g) || []).map((line, index) => {
        if (frontmatter) {
            if (!first && /^---\r?\n?$/.test(line)) frontmatter = false;
            first = false; return line;
        }
        if (comment) { comment = !line.includes('-->'); return line; }
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = null; return line; }
        if (fence) return line;
        if (line.includes('<!--') && line.trim() !== '<!-- preferred -->' && !/<!--\s*obsf:choices\s/.test(line)) { comment = !line.includes('-->'); return line; }
        return transform(line, index);
    }).join('');
}

function formalizePreview(text, bindings) {
    const resolve = name => bindings.get(withoutMD(slash(String(name)))) ?? name;
    return mapBodyLines(text, line => {
        if (/<!--\s*obsf:choices\s/.test(line)) {
            return line.replace(/(<!--\s*obsf:choices\s+)([\s\S]*?)(\s*-->)/g, (_, start, json, end) => {
                const data = JSON.parse(json);
                if (data.defaultName) data.defaultName = resolve(data.defaultName);
                for (const choice of data.choices || []) choice.name = resolve(choice.name);
                return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
            });
        }
        return line.replace(/(?<!!)\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_, name, alias = '') => '[[' + resolve(name) + alias + ']]');
    });
}

function applyTypeFields(text, types) {
    return mapBodyLines(text, line => line.replace(/\[(item|drop)(\s*::\s*)\[\[([^\]|]+)(\|[^\]]+)?\]\]\]/g,
        (whole, field, separator, name, alias = '') => {
            if (!types.has(withoutMD(name))) return whole;
            const next = types.get(withoutMD(name)) === 'mc-drop' ? 'drop' : 'item';
            return next === field ? whole : '[' + next + separator + '[[' + name + alias + ']]]';
        })
        .replace(/(<!--\s*obsf:choices\s+)([^\n]*?)(\s*-->)/g, (_, start, json, end) => {
            const data = JSON.parse(json);
            for (const choice of data.choices || []) if (types.has(withoutMD(choice.name))) choice.type = types.get(withoutMD(choice.name)) === 'mc-drop' ? 'drop' : 'item';
            return start + JSON.stringify(data).replaceAll('<', '\\u003c') + end;
        }));
}

function frontmatterLine(text, key) {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.replace(/^\uFEFF/, '') !== '---') return null;
    for (let index = 1; index < lines.length && lines[index] !== '---'; index++) {
        if (lines[index].startsWith(key + ':')) return index + 1;
    }
    return null;
}

function preserveUpdatedField(original, candidate) {
    const sourceLine = frontmatterLine(original, 'updated'), candidateLine = frontmatterLine(candidate, 'updated');
    if (!sourceLine && !candidateLine) return candidate;
    const newline = candidate.includes('\r\n') ? '\r\n' : '\n';
    const lines = candidate.split(/\r?\n/);
    const updated = sourceLine ? original.split(/\r?\n/)[sourceLine - 1] : null;
    if (candidateLine) lines.splice(candidateLine - 1, 1, ...(updated ? [updated] : []));
    else if (updated) lines.splice(lines.indexOf('---', 1), 0, updated);
    return lines.join(newline);
}

function retainsContent(original, candidate, rules, resolveName = () => null, options = {}) {
    // Item/drop is a presentation classification, not a new identity. Permit
    // this explicit edit and equivalent recipe layout, preserving other data.
    const before = parseFrontmatter(original), after = parseFrontmatter(candidate);
    try { parseBIOLevel(after); } catch { return false; }
    if (['mc-item', 'mc-drop'].includes(before?.type) && ['mc-item', 'mc-drop'].includes(after?.type)) before.type = after.type;
    if (before?.type === 'mc-item' && after?.type === 'mc-tag' && reader.isTagBIO(before) &&
        identity(before) === identity(after)) before.type = after.type;
    // Level is an explicitly editable display/research field. Do not rewrite its
    // literal formatting or relax preservation of any other frontmatter value.
    if (before) delete before.level;
    if (after) delete after.level;
    if (options.ignoreUpdated) {
        if (before) delete before.updated;
        if (after) delete after.updated;
    }
    if (options.vanillaBase && before && after) {
        delete before.base_material;
        delete after.base_material;
    }
    const metadataOptions = { allowOutputRemoval: true, allowManagedTags: true };
    const metadataRetained = metadataIsAdditive(before, after, metadataOptions);
    if (!metadataRetained) {
        if (!options.onDifference || !before || !after) return false;
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
            const oldValue = Object.hasOwn(before, field) ? { [field]: before[field] } : {};
            const newValue = Object.hasOwn(after, field) ? { [field]: after[field] } : {};
            if (!metadataIsAdditive(oldValue, newValue, metadataOptions)) options.onDifference({
                code: 'YAML_DIFF', field, line: frontmatterLine(options.previewText ?? candidate, field),
                sourceLine: frontmatterLine(original, field), message: 'YAML 欄位有歧異：' + field
            });
        }
    }
    const fullSource = original;
    const saved = extractLegacyRecipeReviews(original);
    const added = extractLegacyRecipeReviews(candidate).filter(record => !saved.some(previous =>
        original.slice(previous.envelopeStart, previous.envelopeEnd) === candidate.slice(record.envelopeStart, record.envelopeEnd)));
    let limit = original.length;
    for (const record of added.sort((a, b) => b.start - a.start)) {
        if (record.end > limit || original.slice(record.start, record.end) !== record.source || record.itemId !== identity(before)) return false;
        if (!/^\s*(?:<!-- preferred -->\s*)?-.*\(Machine\s*::/i.test(record.source)) return false;
        original = original.slice(0, record.start) + original.slice(record.end);
        limit = record.start;
    }
    const stripFM = value => value.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    const recipeHeadings = new Set();
    for (const text of [original, candidate]) for (const route of reader.parseBIO(text, parseFrontmatter(text) || {}).recipes) {
        if (route.section) recipeHeadings.add(route.section);
        if (route.provider) recipeHeadings.add(route.provider);
    }
    const recipeLayout = value => {
        const rows = value.match(/[^\n]*\n|[^\n]+$/g) || [];
        return mapBodyLines(value, (line, index) => {
            if (line.trim() === '<!-- preferred -->') return '';
            const heading = line.trim().match(/^(?:###|#####)\s+(.+)$/);
            if (heading) {
                let next = index + 1;
                while (next < rows.length && !rows[next].trim()) next++;
                // Empty legacy categories and repeated recipe/provider headings
                // are layout. Recipe classification/order is independently locked
                // by baselineSemantic; prose and nonempty manual headings remain.
                if (recipeHeadings.has(heading[1]) || next === rows.length || /^#{1,6}\s/.test(rows[next].trim())) return '';
            }
            if (/^\s*\*\*(?:合成所需|所需)\*\*\s*[:：]\s*$/.test(line)) return '';
            const output = line.match(/^\s*(?:-\s*)?(?:\*\*批產量\*\*\s*[:：]\s*)?\[output\s*::\s*([0-9.]+)\]\s*$/i);
            if (output) return '- [output:: ' + Number(output[1]) + ']\n';
            const machine = line.match(/^\s*-\s*(?:\*\*(?:生產設備|設備)\*\*\s*[:：]\s*)?(\(Machine\s*::\s*(?:\[\[.*?\]\]|[^)]+)\))\s*$/i);
            if (machine) return '- ' + machine[1] + '\n';
            return line;
        });
    };
    const canonicalLinks = value => mapBodyLines(value, line => line
        .replace(/\[(item|drop|GEO)::\s*(\[\[[^\n]*?\]\]|[^\]\n]+)\]/g, (whole, field, link) => {
            const name = link.startsWith('[[') ? link.slice(2, -2).split('|')[0] : link.trim();
            const id = resolveName(name);
            return id ? '[' + field + ':: ' + id + ']' : whole;
        }).replace(/(?<!!)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (whole, name) => {
            const id = resolveName(name); return id ? '[[' + id + ']]' : whole;
        }));
    const compact = value => recipeLayout(canonicalLinks(value)).split(/\r?\n/).map(line => line.trim().replace(/[ \t]+/g, ' ')
        .replace(/\[(?:item|drop)::/gi, '[item::')).filter(Boolean).join('\n');
    // Dropping a terminal review tag can leave a blank line after compaction.
    const comparableBody = text => compact(stripManagedBIOtags(stripFM(text)));
    const bodyRetained = preservesBIOContent(comparableBody(original), comparableBody(candidate), rules, (oldBody, newBody) => {
        if (!options.onDifference) return;
        const normalize = line => compact(line).trim();
        const mapLines = text => text.split(/\r?\n/).map((line, index) => ({ value: normalize(line), line: index + 1 }));
        const sourceRows = mapLines(fullSource), previewRows = mapLines(options.previewText ?? candidate);
        const newLines = newBody.split(/\r?\n/);
        let cursor = 0, sourceCursor = 0, previewCursor = 0, lastPreviewLine = null;
        for (const line of oldBody.split(/\r?\n/)) {
            if (!line) continue;
            const sourceIndex = sourceRows.findIndex((row, index) => index >= sourceCursor && row.value === line);
            if (sourceIndex >= 0) sourceCursor = sourceIndex + 1;
            const next = newLines.indexOf(line, cursor);
            if (next >= 0) {
                cursor = next + 1;
                const previewIndex = previewRows.findIndex((row, index) => index >= previewCursor && row.value === line);
                if (previewIndex >= 0) { previewCursor = previewIndex + 1; lastPreviewLine = previewRows[previewIndex].line; }
                continue;
            }
            options.onDifference({ code: 'PREVIEW_CONTENT_MISSING', sourceLine: sourceRows[sourceIndex]?.line ?? null,
                nearLine: lastPreviewLine, message: '更新預覽缺少或改動了正式內容：' + line.slice(0, 180) });
        }
    });
    return metadataRetained && bodyRetained;
}

function preparePublication(root, manifestRelative, options = {}) {
    root = path.resolve(root);
    const manifestPath = inside(root, manifestRelative, 'MC-自動化BIO/preview');
    const manifestBytes = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.kind !== 'obsf-bio-publication' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || (!manifest.entries.length && !options.central)) throw new Error('不是完整的 BIO Publication.json');
    const batchDirectory = inside(root, manifest.batchDirectory, 'MC-自動化BIO/preview');
    if (path.dirname(manifestPath) !== batchDirectory) throw new Error('發布清單與批次路徑不一致');
    const currentInput = inputFingerprint(root);
    if (manifest.inputFingerprint !== currentInput && !options.central) throw new Error('來源／決策／Mapping 已變更，請重新產生整批預覽');
    const mappingPath = path.join(root, RECIPE_MAPPING_FILE);
    const mapping = fs.existsSync(mappingPath) ? fs.readFileSync(mappingPath, 'utf8') : '';
    const roots = formalRoots(mapping);
    const mappings = parseMachineRecipeMappings(mapping);
    if (mappings.diagnostics.some(value => value.severity === 'ERROR')) throw new Error('Machine Mapping 格式錯誤');
    const registry = scanMinecraftBIOs(path.join(root, 'MC-物品資料庫'), { vaultRoot: root });
    if (registry.collisions.length) throw new Error('正式 BIO 含重複身份，停止發布');
    const bindings = new Map(), types = new Map(), targetPaths = new Set(), identityKeys = new Set(), prepared = [], skipped = [];
    const preservationIssues = [];
    function recordPreservationIssue(issue, entry) {
        preservationIssues.push(issue);
        options.onIssue?.(issue, entry, currentInput);
    }
    const standalone = options.central ? readStandalonePreviews(root).map(draft => ({
        identity: draft.metadata.type?.startsWith('sf-') ? 'sf:' + draft.metadata.id : identity(draft.metadata),
        kind: draft.metadata.type === 'mc-tag' ? 'tag' : 'item', targetPath: draft.metadata.publish_target, status: 'NEW', draftSource: draft.source,
        draftPath: draft.relative, draftMetadata: draft.metadata, baselineSemantic: previewSemanticHash(draft.text), linkFilenames: []
    })) : [];
    const records = [...manifest.entries, ...standalone];
    if (!records.length) throw new Error('找不到待審核的 Preview');
    for (const entry of records) {
        if (!['item', 'tag', 'group'].includes(entry.kind) || !/^[a-f0-9]{64}$/.test(entry.baselineSemantic || '')) throw new Error('發布項目格式不完整');
        if (options.central && !isFormalPath(entry.targetPath, roots)) throw new Error('正式目的地不在白名單：' + entry.targetPath);
        const target = inside(root, entry.targetPath, entry.draftSource ? undefined : 'MC-物品資料庫');
        if (!/\.md$/i.test(entry.targetPath)) throw new Error('正式目的必須是 Markdown BIO');
        if (targetPaths.has(target.toLowerCase()) || identityKeys.has(entry.identity)) throw new Error('發布身份或目的路徑重複');
        targetPaths.add(target.toLowerCase()); identityKeys.add(entry.identity);
        if (!Array.isArray(entry.linkFilenames) || (!entry.draftSource && !entry.linkFilenames.length)) throw new Error('缺少預覽連結對照');
        for (const name of entry.linkFilenames) {
            const absolute = inside(root, slash(path.relative(root, path.resolve(batchDirectory, name))), manifest.batchDirectory);
            bindings.set(withoutMD(slash(path.relative(root, absolute))), withoutMD(entry.targetPath));
        }
        if (!['NEW', 'ADDITIVE_UPDATE', 'REVIEW', 'UNCHANGED'].includes(entry.status)) throw new Error('未知的發布狀態');
        let source = null, sourceSHA256 = entry.sourceSHA256;
        if (entry.sourcePath) {
            if (entry.sourcePath !== entry.targetPath || !fs.statSync(target, { throwIfNoEntry: false })?.isFile())
                throw new Error('找不到原正式 BIO：' + entry.targetPath);
            source = fs.readFileSync(target);
            sourceSHA256 = hash(source);
            if (!options.central && sourceSHA256 !== entry.sourceSHA256) throw new Error('正式 BIO 已變更，請重產：' + entry.targetPath);
            if (identity(parseFrontmatter(source.toString('utf8'))) !== entry.identity)
                throw new Error('正式 BIO 身份已變更：' + entry.targetPath);
        } else if (fs.existsSync(target)) throw new Error('新 BIO 已存在，請重產：' + entry.targetPath);
        const registered = registry.entries.filter(value => identity(value) === entry.identity);
        if ((entry.sourcePath && (registered.length !== 1 || registered[0].path !== entry.sourcePath)) || (!entry.sourcePath && registered.length)) throw new Error('正式身份位置已變更：' + entry.identity);
        if (entry.status === 'REVIEW' && entry.approved !== true) {
            if (options.skipReview) { skipped.push(entry); continue; }
            if (!options.central) throw new Error('REVIEW 尚未確認：' + entry.identity + '；請驗收後設 approved=true，或使用 --skip-review');
        }
        const preview = entry.draftSource ? inside(root, entry.draftPath, 'MC-自動化BIO/preview/' + entry.draftSource)
            : inside(root, slash(path.relative(root, path.resolve(batchDirectory, entry.previewFilename))), manifest.batchDirectory);
        const text = fs.readFileSync(preview, 'utf8'), metadata = parseFrontmatter(text);
        const previewId = entry.draftSource && metadata?.type?.startsWith('sf-') ? 'sf:' + metadata.id : identity(metadata);
        const allowedTypes = entry.kind === 'item'
            ? ['mc-item', 'mc-drop', ...(entry.draftSource ? ['sf-item', 'sf-drop', 'sf-GEO'] : [])]
            : ['mc-item', 'mc-tag'];
        if (!previewId || previewId !== entry.identity || !allowedTypes.includes(metadata?.type)) throw new Error('預覽身份被修改：' + entry.identity);
        if (entry.kind !== 'item' && !reader.isTagBIO(metadata)) throw new Error('集合身份被修改：' + entry.identity);
        if (entry.draftSource && entry.kind === 'tag' && (entry.draftSource !== 'mini' || !previewId.startsWith('tag:custom:') ||
            metadata.minecraft_tag || metadata.derived_group || metadata.tag_identity || metadata.minecraft_id))
            throw new Error('Mini Tag 預覽須使用獨立的自訂集合 ID：' + entry.identity);
        const previewPath = slash(path.relative(root, preview));
        const reportDifference = issue => recordPreservationIssue({ path: previewPath, sourcePath: entry.sourcePath,
            affectedPaths: [entry.targetPath], ...issue }, entry);
        const tags = publicationBlockingTags(text);
        if (tags.length) {
            const message = 'Preview 仍有待審查標籤：' + tags.join('、');
            if (!options.central) throw new Error(message + '｜' + previewPath);
            reportDifference({ code: 'PUBLICATION_TAG_BLOCKED', message, tags });
        }
        try { parseBIOLevel(metadata); }
        catch (error) {
            if (!options.central) throw error;
            reportDifference({ code: 'YAML_INVALID', field: 'level', line: frontmatterLine(text, 'level'), message: error.message });
        }
        let levelIssue;
        if (options.central && source && sourceSHA256 !== entry.sourceSHA256) {
            const latestLevel = parseFrontmatter(source.toString('utf8')).level;
            const levelKey = value => value == null || !String(value).trim() ? '0' : String(value).trim();
            if (levelKey(latestLevel) !== levelKey(metadata.level)) levelIssue = {
                code: 'YAML_DIFF', field: 'level', line: frontmatterLine(text, 'level'),
                sourceLine: frontmatterLine(source.toString('utf8'), 'level'), message: '正式 BIO 與更新預覽的 LEVEL 不一致'
            };
        }
        const ignoreLevel = Boolean(entry.baselineWithoutPreferredAndLevel);
        if (ignoreLevel && !/^[a-f0-9]{64}$/.test(entry.baselineWithoutPreferredAndLevel)) throw new Error('LEVEL 編輯基準格式不完整');
        const ignorePreferred = ignoreLevel || Boolean(entry.baselineWithoutPreferred);
        if (!ignoreLevel && ignorePreferred && !/^[a-f0-9]{64}$/.test(entry.baselineWithoutPreferred)) throw new Error('preferred 編輯基準格式不完整');
        if (!options.central && previewSemanticHash(text, { ignorePreferred, ignoreLevel }) !== (entry.baselineWithoutPreferredAndLevel || entry.baselineWithoutPreferred || entry.baselineSemantic)) {
            throw new Error('預覽配方語意已變更（允許 type／排版' + (ignorePreferred ? '／preferred' : '；舊批次改 preferred 前請執行 allow-preferred') + (ignoreLevel ? '／LEVEL' : '；改 LEVEL 前請執行 allow-level') + '）：' + entry.identity);
        }
        if (entry.kind === 'item') types.set(withoutMD(entry.targetPath), metadata.type);
        prepared.push({ ...entry, path: target, text, source, sourceSHA256, previewPath: preview, previewSHA256: hash(text), levelIssue });
    }
    const names = new Map();
    const registerName = (name, id) => {
        if (!name || !id) return;
        const ids = names.get(withoutMD(slash(name))) || new Set(); ids.add(id); names.set(withoutMD(slash(name)), ids);
    };
    for (const value of registry.entries) for (const name of [value.name, value.path, ...(value.aliases || [])]) registerName(name, identity(value));
    for (const value of records) for (const name of [value.targetPath, path.basename(value.targetPath)]) registerName(name, value.identity);
    const languagePath = path.join(root, '參考資料', 'Minecraft', 'zh_tw.json');
    const language = fs.existsSync(languagePath) ? JSON.parse(fs.readFileSync(languagePath, 'utf8')) : {};
    for (const value of manifest.entries.filter(value => value.kind !== 'item')) for (const id of value.values || []) {
        registerName(id, id); registerName(resolveTranslatedName(id, language), id);
    }
    for (const entry of prepared) {
        let text = applyTypeFields(formalizePreview(entry.text, bindings), types);
        if (entry.draftSource) text = text.replace(/^(\uFEFF?---\r?\n)([\s\S]*?)(^---(?:\r?\n|$))/m,
            (_, start, body, end) => start + body.replace(/^(?:preview_source|preview_mode|preview_evidence|publish_target):[^\r\n]*(?:\r?\n|$)/gm, '') + end);
        const deriveBase = options.central && !entry.draftSource && entry.kind === 'item';
        if (deriveBase) text = vanillaBase(text);
        let metadata = parseFrontmatter(text);
        if ('output' in metadata) throw new Error('預覽仍含 YAML output：' + entry.identity);
        const parsed = reader.parseBIO(text, { ...metadata, base_material: metadata.base_material === 'true' });
        if (parsed.diagnostics.length) throw new Error('預覽配方未完整解析：' + entry.identity + ' ' + JSON.stringify(parsed.diagnostics));
        if (entry.kind !== 'item') {
            const route = parsed.recipes.length === 1 && parsed.recipes[0].tagRepresentative ? parsed.recipes[0] : null;
            const members = route?.ingredients[0]?.choices || [];
            const actual = members.map(value => { const ids = names.get(withoutMD(slash(value.name))); return ids?.size === 1 ? [...ids][0] : null; });
            const expected = new Set(entry.values || []);
            if (!members?.length || (!entry.draftSource && (!expected.size || actual.includes(null) ||
                actual.length !== new Set(actual).size || expected.size !== actual.length || actual.some(id => !expected.has(id)))))
                throw new Error('正式集合成員不完整或身份不明：' + entry.identity);
        }
        for (const recipe of parsed.recipes) for (const ingredient of recipe.ingredients) {
            if (ingredient.excludeSelf) {
                const groupId = 'group:obsf:color_family/' + colorFamily(entry.identity);
                if (skipped.some(value => value.identity === groupId)) throw new Error('except self 所需集合尚未驗收：' + groupId);
            }
            for (const choice of [ingredient, ...(ingredient.choices || [])]) {
                const name = slash(String(choice.name || ''));
                if (/(?:^|\/)preview\/|\.preview(?:\.md)?$/i.test(name)) throw new Error('未轉換的預覽連結：' + name);
                const known = names.get(withoutMD(name));
                const resolved = known?.size === 1 ? [...known][0] : null;
                if (skipped.some(value => (!value.sourcePath || value.kind !== 'item') &&
                    (withoutMD(value.targetPath) === withoutMD(name) || value.identity === resolved))) throw new Error('引用了被略過且未確認的 BIO／集合：' + name);
            }
        }
        if (entry.sourcePath) {
            const original = entry.source.toString('utf8');
            if (options.central) text = preserveUpdatedField(original, text);
            entry.candidateSHA256 = hash(text);
            const resolveName = name => { const ids = names.get(withoutMD(slash(name))); return ids?.size === 1 ? [...ids][0] : null; };
            const start = preservationIssues.length, previewPath = slash(path.relative(root, entry.previewPath));
            const onDifference = issue => recordPreservationIssue({ path: previewPath, sourcePath: entry.sourcePath,
                affectedPaths: [entry.targetPath], ...issue }, entry);
            if (entry.levelIssue) onDifference(entry.levelIssue);
            if (!retainsContent(original, text, mappings.rules, resolveName, {
                vanillaBase: deriveBase, ignoreUpdated: options.central, previewText: entry.text,
                onDifference: options.central ? onDifference : undefined
            })) {
                const message = '更新預覽未保留目前正式 BIO 的圖片、人工內容或 YAML';
                if (!options.central) throw new Error(message + '：' + entry.targetPath);
                if (start === preservationIssues.length && !preservationIssues.some(issue => issue.path === previewPath))
                    onDifference({ code: 'PREVIEW_RETENTION_CONFLICT', message });
            }
        }
        entry.text = text; entry.candidateSHA256 ??= hash(text);
        entry.changed = !entry.sourcePath || entry.sourceSHA256 !== entry.candidateSHA256;
    }
    return { root, manifestPath, manifestSHA256: hash(manifestBytes), entries: prepared, skipped, mapping, currentInput, preservationIssues };
}

function materialReportPath(root, manifestPath) {
    const batch = path.dirname(manifestPath);
    return inside(root, slash(path.relative(root, path.join(path.dirname(batch),
        path.basename(batch) + ' - 材料審核.md'))), 'MC-自動化BIO/preview');
}

function readPreviewApprovals(markdown) {
    return new Set([...markdown.matchAll(/^- \[[xX]\] [^\r\n]*<!-- obsf:accept-(?:preview|raw-id) ([a-f0-9]{64}) -->[ \t]*$/gm)]
        .map(match => match[1]));
}

const editableIssues = new Set(['PREVIEW_CONTENT_MISSING', 'YAML_DIFF', 'REVIEW_REQUIRED']);
const identityFields = new Set(['id', 'minecraft_id', 'minecraft_tag', 'tag_identity', 'derived_group']);

function setIssueApprovalKey(issue, entry, currentInput) {
    if (!issue.approvalKey && entry?.sourcePath && editableIssues.has(issue.code) && !identityFields.has(issue.field)) {
        issue.approvalKey = hash(JSON.stringify([currentInput, entry.targetPath, entry.sourceSHA256,
            entry.previewSHA256, entry.candidateSHA256, issue]));
    }
}

function reviewSnapshot(plan, checked, onIssue) {
    if (!checked) {
        const reportPath = materialReportPath(plan.root, plan.manifestPath);
        checked = readPreviewApprovals(fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '');
    }
    const byTarget = new Map(plan.entries.map(entry => [entry.targetPath, entry]));
    const { diagnostics, formal } = reviewCandidates(plan, plan.mapping, onIssue);
    const awaitingReview = plan.entries.filter(entry => entry.status === 'REVIEW' && entry.approved !== true);
    for (const entry of awaitingReview) {
        const issue = { path: slash(path.relative(plan.root, entry.previewPath)), affectedPaths: [entry.targetPath],
            sourcePath: entry.sourcePath, code: 'REVIEW_REQUIRED', message: '確認這筆更新採用目前的 Preview' };
        diagnostics.push(issue);
        onIssue?.(issue, entry, plan.currentInput);
    }
    const issues = [], approvedIssues = [];
    for (const issue of [...plan.preservationIssues, ...diagnostics]) {
        const entry = issue.affectedPaths?.length === 1 && byTarget.get(issue.affectedPaths[0]);
        setIssueApprovalKey(issue, entry, plan.currentInput);
        if (issue.approvalKey && checked.has(issue.approvalKey)) approvedIssues.push(issue);
        else issues.push(issue);
    }
    const requiresReview = issue => issue.code === 'REVIEW_REQUIRED' || issue.code === 'RAW_ID_REVIEW';
    const blockedPaths = new Set(issues.filter(issue => !requiresReview(issue)).flatMap(issue => issue.affectedPaths || [issue.path]));
    const awaitingPaths = new Set(issues.filter(requiresReview).flatMap(issue => issue.affectedPaths || [issue.path]));
    const counts = { READY: 0, REVIEW: 0, BLOCKED: 0 };
    for (const entry of plan.entries) counts[blockedPaths.has(entry.targetPath) ? 'BLOCKED' : awaitingPaths.has(entry.targetPath) ? 'REVIEW' : 'READY']++;
    return { schemaVersion: 1, status: issues.some(issue => !requiresReview(issue)) ? 'BLOCKED' : issues.length ? 'REVIEW' : 'READY',
        diagnostics: issues, approvedIssues, counts,
        fingerprint: hash(JSON.stringify({ manifest: plan.manifestSHA256, inputs: plan.currentInput, formal,
            approvedIssues: approvedIssues.map(issue => issue.approvalKey),
            candidates: plan.entries.map(entry => [entry.identity, entry.targetPath, entry.sourceSHA256, entry.previewSHA256, entry.candidateSHA256]) })),
        candidateCount: plan.entries.length };
}

function scanPublicationCandidates(root, manifest, checked, issueLimit) {
    const limitReached = Symbol('publication issue limit');
    const diagnostics = [], approvedIssues = [];
    const onIssue = (issue, entry, currentInput) => {
        setIssueApprovalKey(issue, entry, currentInput);
        if (issue.approvalKey && checked.has(issue.approvalKey)) approvedIssues.push(issue);
        else {
            diagnostics.push(issue);
            if (diagnostics.length >= issueLimit) throw limitReached;
        }
    };
    let plan;
    try {
        plan = preparePublication(root, manifest, { central: true, onIssue });
        return { plan, result: reviewSnapshot(plan, checked, onIssue) };
    } catch (error) {
        if (error !== limitReached) throw error;
        return { plan, result: { schemaVersion: 1, status: 'BLOCKED', diagnostics, approvedIssues, issueLimitReached: issueLimit,
            candidateCount: plan?.entries.length ?? 0, counts: { READY: 0, REVIEW: 0, BLOCKED: 0 } } };
    }
}

function materialReviewRows(root, diagnostics, lookupVanilla) {
    const unresolved = diagnostics.filter(issue => issue.code === 'UNRESOLVED_MATERIAL' || issue.code === 'RAW_ID_REVIEW');
    if (!unresolved.length) return [];
    const labels = new Map(), names = new Map(), rows = new Map();
    const translationPath = path.join(root, '參考資料', 'Minecraft', 'zh_tw.json');
    const translations = fs.existsSync(translationPath) ? JSON.parse(fs.readFileSync(translationPath, 'utf8')) : {};
    for (const [key, label] of Object.entries(translations)) {
        const match = key.match(/^(?:block|item)\.minecraft\.([a-z0-9_]+)$/);
        if (!match || typeof label !== 'string') continue;
        const id = 'minecraft:' + match[1];
        const ids = names.get(label) || new Set();
        ids.add(id); names.set(label, ids); labels.set(id, label);
    }
    for (const issue of unresolved) {
        const name = issue.message;
        const fromVanilla = issue.provider === 'Minecraft 原版' || labels.has(name);
        const vanillaId = issue.code === 'RAW_ID_REVIEW' && !name.includes(':') ? 'minecraft:' + name.toLowerCase() : name;
        const matches = labels.has(vanillaId) ? [vanillaId] : [...(names.get(name) || [])];
        const id = fromVanilla && matches.length === 1 ? matches[0] : null;
        const entry = id && lookupVanilla?.(id);
        const label = id ? labels.get(id) : name;
        const safeName = label && !/[<>:"/\\|?*\[\]#\r\n]/.test(label) && !/[. ]$/.test(label);
        const selectable = Boolean(entry?.verified && !entry.hasRecipes && safeName);
        const rowKey = selectable ? id : JSON.stringify([name, issue.provider]);
        if (!rows.has(rowKey)) rows.set(rowKey, { id, label, selectable, manualKey: selectable ? null : hash(rowKey), references: new Set() });
        rows.get(rowKey).references.add(issue.path + (issue.machine ? ' · ' + issue.machine : ''));
    }
    return [...rows.values()];
}

function readMaterialDecisions(markdown) {
    const decisions = new Map();
    const lines = markdown.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const checkbox = lines[i].match(/^- \[([ xX])\] .*<!-- obsf:material-base (minecraft:[a-z0-9_]+) -->\s*$/);
        if (!checkbox) continue;
        const acquisitions = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j].trim()) continue;
            const bullet = lines[j].match(/^ {2}-(?:[ \t]+(.*))?$/);
            if (!bullet) break;
            const value = (bullet[1] || '').trim();
            if (/^(?:引用[：:]|[^\[\]]+\.md(?: · |$))/.test(value)) break;
            if (value === '待填取得方式') continue;
            const description = value.replace(/^取得方式[：:][ \t]*/, '');
            if (description) acquisitions.push(description);
        }
        if (decisions.has(checkbox[2])) throw new Error('材料審核表有重複的 Base 勾選項目：' + checkbox[2]);
        decisions.set(checkbox[2], { checked: checkbox[1] !== ' ', acquisitions });
    }
    return decisions;
}

function createSelectedMaterialBases(root, rows, decisions, plan) {
    const draftFolder = 'MC-自動化BIO/preview/material-base';
    const entries = [];
    const selected = rows.filter(row => {
        const decision = decisions.get(row.id);
        return row.selectable && decision?.checked && decision.acquisitions.length;
    });
    if (!selected.length) return [];
    const existing = scanMinecraftBIOs(path.join(root, 'MC-物品資料庫'), { vaultRoot: root });
    const selectedTargets = new Set();
    for (const row of selected) {
        const target = 'MC-物品資料庫/' + row.label + '.md';
        const file = inside(root, draftFolder + '/' + row.id.slice('minecraft:'.length) + '.preview.md', 'MC-自動化BIO/preview');
        const formalPath = inside(root, target, 'MC-物品資料庫');
        if (fs.existsSync(formalPath) || existing.has(row.id) || selectedTargets.has(target.toLowerCase()) ||
            plan.entries.some(entry => entry.targetPath.toLowerCase() === target.toLowerCase() || entry.identity === row.id))
            throw new Error('已存在同名或同 ID 的 BIO，請改用既有項目：' + row.id);
        selectedTargets.add(target.toLowerCase());
        if (fs.existsSync(file)) throw new Error('Base Preview 已存在，請核對既有預覽：' + row.id);
        const id = row.id.slice('minecraft:'.length).toUpperCase();
        const text = [
            '---', 'type: mc-item', 'id: ' + id, 'minecraft_id: ' + row.id,
            'aliases: ' + JSON.stringify([row.label, row.id]), 'base_material: true',
            'generated_by: ' + standaloneGenerators.get('material-base'),
            'preview_source: material-base', 'publish_target: ' + JSON.stringify(target), '---', '',
            '#需攻略補充', '', '# 合成/取得', '', '### 外部取得', '', '<!-- preferred -->',
            ...decisions.get(row.id).acquisitions.map(description => '- 外部取得：' + description),
            '', '# 用途', '', '- ', '', '# 產物', '', '- ', ''
        ].join('\n');
        entries.push({ file, text });
    }
    for (const { file, text } of entries) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, { flag: 'wx' });
    }
    return entries.map(({ file }) => slash(path.relative(root, file)));
}

function completeStandalonePreviews(plan) {
    const completed = [];
    for (const entry of plan.entries) {
        const generator = standaloneGenerators.get(entry.draftSource);
        if (!generator) continue;
        const original = fs.readFileSync(entry.previewPath, 'utf8');
        if (hash(original) !== entry.previewSHA256) throw new Error('預覽在掃描期間已變更，請重新掃描：' + entry.draftPath);
        const newline = original.includes('\r\n') ? '\r\n' : '\n';
        let text = original;
        if (!Object.hasOwn(entry.draftMetadata, 'generated_by')) {
            text = text.replace(/^(\uFEFF?---\r?\n[\s\S]*?\r?\n)(---\r?\n)/,
                (_, frontmatter, end) => frontmatter + 'generated_by: ' + generator + newline + end);
        }
        if (entry.draftSource === 'material-base') {
            const lines = original.split(/\r?\n/).map(line => line.trimEnd());
            for (const heading of ['# 用途', '# 產物']) {
                if (lines.includes(heading)) continue;
                if (!text.endsWith(newline)) text += newline;
                if (!text.endsWith(newline + newline)) text += newline;
                text += [heading, '', '- ', ''].join(newline);
            }
        }
        if (text === original) continue;
        const temporary = entry.previewPath + '.' + randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporary, text, { flag: 'wx' });
            if (fs.readFileSync(entry.previewPath, 'utf8') !== original)
                throw new Error('預覽在掃描期間已變更，請重新掃描：' + entry.draftPath);
            fs.renameSync(temporary, entry.previewPath);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        completed.push(entry.draftPath);
    }
    return completed;
}

function scanPublication(root, manifestRelative, { lookupVanilla, issueLimit = PUBLICATION_ISSUE_LIMIT } = {}) {
    root = path.resolve(root);
    const manifest = inside(root, manifestRelative, 'MC-自動化BIO/preview');
    const report = inside(root, slash(path.relative(root, manifest)) + '.review.json', 'MC-自動化BIO/preview');
    const materialReport = materialReportPath(root, manifest);
    const oldMaterialReport = fs.existsSync(materialReport) ? fs.readFileSync(materialReport, 'utf8') : '';
    const decisions = readMaterialDecisions(oldMaterialReport);
    const previewApprovals = readPreviewApprovals(oldMaterialReport);
    const markedProgress = new Set([...oldMaterialReport.matchAll(/^- \[[xX]\] [^\r\n]*<!-- obsf:(?:material-manual|tag-progress) ([a-f0-9]{64}) -->[ \t]*$/gm)]
        .map(match => match[1]));
    let previous;
    try { previous = JSON.parse(fs.readFileSync(report, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    let result, materialRows = [], basePreviews = [], completedPreviews = [];
    try {
        let plan;
        ({ plan, result } = scanPublicationCandidates(root, manifestRelative, previewApprovals, issueLimit));
        materialRows = materialReviewRows(root, result.diagnostics, lookupVanilla);
        if (plan) basePreviews = createSelectedMaterialBases(root, materialRows, decisions, plan);
        if (!result.issueLimitReached) completedPreviews = completeStandalonePreviews(plan);
        if (!result.issueLimitReached && (basePreviews.length || completedPreviews.length)) {
            ({ result } = scanPublicationCandidates(root, manifestRelative, previewApprovals, issueLimit));
            materialRows = materialReviewRows(root, result.diagnostics, lookupVanilla);
        }
    }
    catch (error) {
        result = { schemaVersion: 1, status: 'BLOCKED', diagnostics: [{ code: 'PREFLIGHT_BLOCKED', message: error.message }],
            candidateCount: 0, counts: { READY: 0, REVIEW: 0, BLOCKED: 0 }, preflightBlocked: true };
    }
    result.previousValidation = !previous?.fingerprint ? 'NONE'
        : previous.fingerprint === result.fingerprint ? 'UNCHANGED' : 'CHANGED';
    if (!result.preflightBlocked) {
        const display = value => String(value).replace(/[<>\r\n]/g, ' ');
        const noteLink = (file, line) => {
            const label = display(file) + (line ? ':' + line : '');
            if (!/\.md$/i.test(file) || /[\[\]#|\r\n]/.test(file) || !fs.existsSync(path.join(root, file))) return label;
            return '[[' + slash(file) + '|' + display(path.basename(file)) + ']]' + (line ? ':' + line : '');
        };
        const lines = ['# 材料審核', '', '勾選可確認為外部取得的原版材料，在勾選框下、「引用」上方每行填一種取得方式。重跑 SCAN 建立 Base 預覽，第一條為首選。', '',
            '「需人工處理」的勾選框只記錄處理進度。SCAN 每次都會核對材料 Preview 或正式 BIO。', ''];
        if (result.issueLimitReached)
            lines.push('> 已找到 ' + result.issueLimitReached + ' 項待處理問題，掃描提前停止。處理後重掃，完成整批驗證後才能發布。', '');
        for (const row of materialRows) {
            if (row.selectable) {
                const decision = decisions.get(row.id);
                const acquisitions = decision?.acquisitions.length ? decision.acquisitions : [''];
                lines.push('- [' + (decision?.checked ? 'x' : ' ') + '] ' + display(row.label) + ' · `' + row.id + '` <!-- obsf:material-base ' + row.id + ' -->',
                    ...acquisitions.map(description => '  - ' + description));
                if (decision?.checked && !decision.acquisitions.length) lines.push('  - 待填取得方式');
            } else {
                const checked = markedProgress.has(row.manualKey) ? 'x' : ' ';
                lines.push('- [' + checked + '] ' + display(row.label) + (row.id ? ' · `' + row.id + '`' : '') +
                    ' · 需人工處理 <!-- obsf:material-manual ' + row.manualKey + ' -->');
            }
            lines.push('  - 引用：', ...[...row.references].map(reference => '    - ' + display(reference)));
        }
        if (!materialRows.length) lines.push('- 無待處理材料');
        if (basePreviews.length) lines.push('', ...basePreviews.map(file => '- 已建立 `' + file + '`'));
        if (completedPreviews.length) lines.push('', ...completedPreviews.map(file => '- 已補欄位 ' + noteLink(file)));
        const allIssues = [...result.diagnostics, ...result.approvedIssues];
        const rawReviews = new Map(allIssues.filter(issue => issue.code === 'RAW_ID_REVIEW').map(issue => [issue.approvalKey, issue]));
        if (rawReviews.size) {
            lines.push('', '## 保留原始材料 ID', '', '目前找不到對應 BIO。勾選後重跑 SCAN，即可確認按原始 ID 發布。', '');
            for (const [approvalKey, issue] of rawReviews) {
                const checked = previewApprovals.has(approvalKey) ? 'x' : ' ';
                lines.push('- [' + checked + '] [RAW_ID_REVIEW] ' + noteLink(issue.previewPath) +
                    ' · 保留原始 ID `' + issue.message + '` <!-- obsf:accept-raw-id ' + approvalKey + ' -->');
            }
        }
        const otherIssues = allIssues.filter(issue => !['UNRESOLVED_MATERIAL', 'RAW_ID_REVIEW'].includes(issue.code));
        if (otherIssues.length) {
            lines.push('', '## 其他審核問題', '',
                '一般審核項目勾選後採用目前的 Preview。待審查標籤的勾選框只記錄進度，須在 Preview 移除標籤並重跑 SCAN。', '');
            for (const issue of otherIssues) {
                const progressKey = issue.code === 'PUBLICATION_TAG_BLOCKED'
                    ? hash(JSON.stringify(['publication-tag', issue.path, issue.tags])) : null;
                const checkKey = issue.approvalKey || progressKey;
                const checked = progressKey ? markedProgress.has(progressKey) : previewApprovals.has(checkKey);
                const checkbox = checkKey ? (checked ? '[x] ' : '[ ] ') : '';
                const marker = checkKey ? ' <!-- obsf:' + (progressKey ? 'tag-progress' : 'accept-preview') + ' ' + checkKey + ' -->' : '';
                const source = issue.sourcePath ? '（正式檔 ' + noteLink(issue.sourcePath, issue.sourceLine) + '）' : '';
                lines.push('- ' + checkbox + '[' + issue.code + '] ' + noteLink(issue.path || '', issue.line) +
                    ' · ' + display(issue.message) + source + marker);
                if (issue.code === 'AMBIGUOUS_MATERIAL')
                    lines.push(...issue.matches.map(file => '  - 候選 BIO · ' + noteLink(file)));
            }
        }
        const temporaryMaterial = materialReport + '.' + randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporaryMaterial, lines.join('\n') + '\n', { flag: 'wx' });
            fs.renameSync(temporaryMaterial, materialReport);
        } finally { if (fs.existsSync(temporaryMaterial)) fs.unlinkSync(temporaryMaterial); }
        result.materialReport = slash(path.relative(root, materialReport));
    }
    result.basePreviews = basePreviews;
    const temporary = report + '.' + randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(result, null, 2), { flag: 'wx' });
        fs.renameSync(temporary, report);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return { ...result, report: slash(path.relative(root, report)) };
}

function assertReview(plan) {
    const report = plan.manifestPath + '.review.json';
    if (!fs.existsSync(report)) throw new Error('請先執行 scan-publication');
    const approved = JSON.parse(fs.readFileSync(report, 'utf8'));
    if (approved.status !== 'READY' || approved.issueLimitReached)
        throw new Error('審核有阻斷問題或掃描尚未完成，請重新執行 scan-publication');
    const fresh = reviewSnapshot(plan);
    if (fresh.status !== 'READY' || approved.fingerprint !== fresh.fingerprint)
        throw new Error('審核有阻斷問題或內容已變更，請重新執行 scan-publication');
}

function git(root, args, input, env = {}) {
    const run = spawnSync('git', args, { cwd: root, env: { ...process.env, ...env }, input, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw new Error('Git 還原點失敗：' + (run.error?.message || run.stderr?.toString()));
    return run.stdout;
}

function checkpointPublication(root, entries) {
    if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString().trim()) !== fs.realpathSync(root)) throw new Error('Vault 必須是 Git 根目錄');
    const branch = git(root, ['branch', '--show-current']).toString().trim();
    if (!branch || ['main', 'master'].includes(branch)) throw new Error('禁止在 main/master 或 detached HEAD 發布');
    const head = git(root, ['rev-parse', 'HEAD']).toString().trim();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'obsf-bio-publish-'));
    const index = path.join(temporary, 'index'), env = { GIT_INDEX_FILE: index };
    const ref = 'refs/obsf/bio-checkpoints/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    try {
        git(root, ['read-tree', head], null, env);
        for (const entry of entries) {
            if (entry.sourcePath) {
                const current = fs.readFileSync(entry.path);
                if (hash(current) !== entry.sourceSHA256) throw new Error('建立還原點時原檔已變更：' + entry.targetPath);
                const blob = git(root, ['hash-object', '-w', '--stdin'], current).toString().trim();
                git(root, ['update-index', '--add', '--cacheinfo', '100644', blob, entry.targetPath], null, env);
            } else git(root, ['update-index', '--force-remove', '--', entry.targetPath], null, env);
        }
        const tree = git(root, ['write-tree'], null, env).toString().trim();
        const commit = git(root, ['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', head, '-m', 'BIO batch pre-publication checkpoint']).toString().trim();
        git(root, ['update-ref', ref, commit, '0'.repeat(head.length)]);
        for (const entry of entries.filter(value => value.sourcePath)) if (hash(git(root, ['show', ref + ':' + entry.targetPath])) !== entry.sourceSHA256) throw new Error('還原點內容驗證失敗');
        return { ref, commit, branch };
    } finally {
        for (const name of ['index', 'index.lock']) if (fs.existsSync(path.join(temporary, name))) fs.unlinkSync(path.join(temporary, name));
        fs.rmdirSync(temporary);
    }
}

function publishBIOBatch(root, manifestRelative, options = {}) {
    const plan = preparePublication(root, manifestRelative, options), changed = plan.entries.filter(entry => entry.changed);
    if (options.central) assertReview(plan);
    if (!options.write) return { dryRun: true, changed: changed.length, unchanged: plan.entries.length - changed.length, skipped: plan.skipped.map(value => value.identity) };
    const lockPath = plan.manifestPath + '.publishing.lock';
    const lock = fs.openSync(lockPath, 'wx');
    let receiptPath, receipt;
    try {
        const point = checkpointPublication(plan.root, changed);
        const receiptDirectory = path.join(plan.root, 'review', 'bio-publications');
        fs.mkdirSync(receiptDirectory, { recursive: true });
        receiptPath = path.join(receiptDirectory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json');
        receipt = { ...point, manifestPath: manifestRelative, manifestSHA256: plan.manifestSHA256, status: 'WRITING',
            skipped: plan.skipped.map(value => value.identity), files: changed.map(entry => ({ path: entry.targetPath, created: !entry.sourcePath,
                sourceSHA256: entry.sourceSHA256 || null, candidateSHA256: entry.candidateSHA256, written: false,
                draftPath: entry.draftPath, previewSHA256: entry.previewSHA256 })) };
        fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
        // Revalidate the whole snapshot after the checkpoint and before the first write.
        const fresh = preparePublication(root, manifestRelative, options);
        if (options.central) assertReview(fresh);
        if (fresh.manifestSHA256 !== plan.manifestSHA256 || fresh.entries.length !== plan.entries.length || fresh.entries.some((entry, index) =>
            entry.sourceSHA256 !== plan.entries[index]?.sourceSHA256 || entry.previewSHA256 !== plan.entries[index]?.previewSHA256 ||
            entry.candidateSHA256 !== plan.entries[index]?.candidateSHA256)) throw new Error('建立還原點期間正式 BIO 或預覽已變更');
        for (let index = 0; index < changed.length; index++) {
            const entry = changed[index];
            inside(plan.root, entry.targetPath, entry.draftSource ? undefined : 'MC-物品資料庫');
            if (entry.sourcePath && hash(fs.readFileSync(entry.path)) !== entry.sourceSHA256) throw new Error('原 BIO 已變更：' + entry.targetPath);
            if (!entry.sourcePath && fs.existsSync(entry.path)) throw new Error('新 BIO 已被建立：' + entry.targetPath);
            fs.mkdirSync(path.dirname(entry.path), { recursive: true });
            const temporaryPath = path.join(path.dirname(entry.path), '.bio-publish-' + randomUUID() + '.tmp');
            try {
                const descriptor = fs.openSync(temporaryPath, 'wx');
                try { fs.writeFileSync(descriptor, entry.text); fs.fsyncSync(descriptor); }
                finally { fs.closeSync(descriptor); }
                if (entry.sourcePath) {
                    if (hash(fs.readFileSync(entry.path)) !== entry.sourceSHA256) throw new Error('替換前原 BIO 已變更：' + entry.targetPath);
                    fs.renameSync(temporaryPath, entry.path);
                } else fs.linkSync(temporaryPath, entry.path); // exclusive creation, never clobber a new arrival
            } finally { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); }
            if (hash(fs.readFileSync(entry.path)) !== entry.candidateSHA256) throw new Error('寫回驗證失敗：' + entry.targetPath);
            receipt.files[index].written = true;
            fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
        }
        receipt.status = 'COMPLETE'; fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
        return { dryRun: false, changed: changed.length, skipped: receipt.skipped, checkpoint: point.ref, receipt: slash(path.relative(plan.root, receiptPath)) };
    } catch (error) {
        if (receipt) {
            receipt.status = 'FAILED'; receipt.error = error.message;
            try { fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2)); }
            catch (receiptError) { error.message += '；紀錄寫入失敗：' + receiptError.message; }
            error.message += '；還原點：' + receipt.ref + '；發布紀錄：' + receiptPath;
        }
        throw error;
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

module.exports = { publicationManifest, preparePublication, publishBIOBatch, scanPublication, selectPublicationManifest, standaloneManifest, formalizePreview, inputFingerprint, identity, retainsContent, previewSemanticHash, allowPreferredEdits, allowLevelEdits, parseBIOLevel, publicationPath: inside };
