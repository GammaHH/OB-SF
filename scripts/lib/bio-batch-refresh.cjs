const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { publicationPath, previewSemanticHash, selectPublicationManifest, identity } = require('./bio-publication.cjs');
const { parseFrontmatter } = require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');

const slash = value => value.replaceAll('\\', '/');

function openBatchRefresh(root, manifestOption, requested) {
    const relative = selectPublicationManifest(root, manifestOption,
        { command: 'refresh-batch', useActive: false, includeStandalone: false });
    const manifestPath = publicationPath(root, relative, 'MC-自動化BIO/preview');
    const batch = slash(path.relative(root, path.dirname(manifestPath)));
    const manifestText = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    if (manifest.kind !== 'obsf-bio-publication' || manifest.schemaVersion !== 1 ||
        manifest.batchDirectory !== batch || !Array.isArray(manifest.entries) || !manifest.entries.length)
        throw new Error('不是完整的既有 BIO 發布批次：' + relative);
    const filenames = new Map();
    const occupiedTargets = new Set();
    const byIdentity = new Map();
    for (const entry of manifest.entries) {
        if (!entry.identity || byIdentity.has(entry.identity) || occupiedTargets.has(entry.targetPath.toLowerCase()))
            throw new Error('發布清單有重複的 BIO 身分或目的地');
        byIdentity.set(entry.identity, entry);
        occupiedTargets.add(entry.targetPath.toLowerCase());
        for (const filename of new Set([entry.previewFilename, ...(entry.linkFilenames || [])])) {
            const checked = publicationPath(root, batch + '/' + filename, batch);
            const local = slash(path.relative(path.dirname(manifestPath), checked));
            if (filename !== local || filenames.has(local.toLowerCase())) throw new Error('發布清單的預覽檔名不一致：' + filename);
            filenames.set(local.toLowerCase(), { filename: local, entry });
        }
    }
    const requestedNames = new Set(requested.map(value => {
        const name = slash(value.trim());
        return name.toLowerCase().endsWith('.md') ? name.toLowerCase() : name.toLowerCase() + '.md';
    }));
    const selected = new Map();
    const invalid = [];
    for (const name of requestedNames) {
        const matches = filenames.has(name) ? [filenames.get(name)] : [...filenames.values()].filter(file =>
            path.posix.basename(file.filename).toLowerCase() === name);
        if (matches.length !== 1 || matches[0].entry.kind !== 'item') { invalid.push(name); continue; }
        const file = matches[0];
        if (selected.has(file.filename)) continue;
        const absolute = publicationPath(root, batch + '/' + file.filename, batch);
        const text = fs.readFileSync(absolute, 'utf8');
        if (identity(parseFrontmatter(text)) !== file.entry.identity) throw new Error('Preview 身分與批次不符：' + file.filename);
        selected.set(file.filename, { ...file, text });
    }
    if (invalid.length) throw new Error('清單裡找不到唯一的物品預覽：' + invalid.join('、'));
    return { root, relative, batch, manifestPath, manifestText, manifest, filenames, occupiedTargets, byIdentity, selected: [...selected.values()] };
}

function finishBatchRefresh(context, updates, additions, write = false) {
    const { root, relative, batch, manifestPath, manifestText, manifest, filenames, occupiedTargets, byIdentity } = context;
    const changes = [];
    for (const { filename, entry, text, refreshed } of updates) {
        if (text === refreshed) continue;
        changes.push({ relative: batch + '/' + filename, original: text, content: refreshed });
        if (entry.previewFilename !== filename) continue;
        entry.baselineSemantic = previewSemanticHash(refreshed);
        entry.baselineWithoutPreferred = previewSemanticHash(refreshed, { ignorePreferred: true });
        if (entry.baselineWithoutPreferredAndLevel)
            entry.baselineWithoutPreferredAndLevel = previewSemanticHash(refreshed, { ignorePreferred: true, ignoreLevel: true });
        if (entry.sourcePath) { entry.status = 'REVIEW'; entry.approved = false; }
    }
    const updated = changes.map(change => slash(path.relative(path.dirname(manifestPath), path.join(root, change.relative))));
    for (const { record, content } of additions) {
        const relative = batch + '/' + record.previewFilename;
        const target = publicationPath(root, record.targetPath, 'MC-物品資料庫');
        if (byIdentity.has(record.identity) || occupiedTargets.has(record.targetPath.toLowerCase()) ||
            filenames.has(record.previewFilename.toLowerCase()) || fs.existsSync(target))
            throw new Error('新集合的身分、目標或預覽檔名重複：' + record.identity);
        byIdentity.set(record.identity, record);
        occupiedTargets.add(record.targetPath.toLowerCase());
        filenames.set(record.previewFilename.toLowerCase(), { filename: record.previewFilename, entry: record });
        manifest.entries.push(record);
        changes.push({ relative, original: null, content });
    }
    const result = { batch: relative, dryRun: !write, selected: updates.length, updated,
        added: additions.map(value => value.record.previewFilename) };
    if (!changes.length) return result;
    const manifestAfter = JSON.stringify(manifest, null, 2);
    if (JSON.stringify(JSON.parse(manifestText)) !== JSON.stringify(manifest))
        changes.push({ relative, original: manifestText, content: manifestAfter });
    if (!write) return result;

    const backup = 'review/bio-batch-refresh/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const backupPath = publicationPath(root, backup, 'review');
    const lockPath = manifestPath + '.publishing.lock';
    const lock = fs.openSync(lockPath, 'wx');
    const applied = [];
    const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const put = (file, content, fresh) => {
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporary, content, { flag: 'wx' });
            if (fresh) fs.linkSync(temporary, file);
            else fs.renameSync(temporary, file);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    };
    try {
        if (read(manifestPath) !== manifestText) throw new Error('發布清單在規劃期間已變更，請重跑');
        for (const change of changes) {
            change.absolute = publicationPath(root, change.relative, batch);
            if (read(change.absolute) !== change.original) throw new Error('檔案在規劃期間已變更：' + change.relative);
        }
        for (const change of [{ relative, original: manifestText }, ...changes.filter(change => change.relative !== relative)]) {
            if (change.original === null) continue;
            const file = path.join(backupPath, path.relative(path.dirname(manifestPath), path.join(root, change.relative)));
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, change.original, { flag: 'wx' });
        }
        for (const change of changes) {
            if (read(change.absolute) !== change.original) throw new Error('檔案在寫入前已變更：' + change.relative);
            put(change.absolute, change.content, change.original === null);
            applied.push(change);
        }
    } catch (error) {
        const manual = [];
        for (const change of applied.reverse()) {
            try {
                if (read(change.absolute) !== change.content) { manual.push(change.relative); continue; }
                if (change.original === null) fs.unlinkSync(change.absolute);
                else put(change.absolute, change.original, false);
            } catch { manual.push(change.relative); }
        }
        if (applied.length || fs.existsSync(backupPath)) error.message += '｜備份：' + backup;
        if (manual.length) error.message += '｜須核對：' + manual.join('、');
        throw error;
    } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockPath);
    }
    return { ...result, backup };
}

module.exports = { openBatchRefresh, finishBatchRefresh };
