const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { publicationPath, insidePreview, isStandaloneManifest, selectPublicationManifest } = require('./bio-publication.cjs');
const { rootForPreview, previewRoot: defaultPreviewRoot } = require('./bio-preview-paths.cjs');

const slash = value => value.replaceAll('\\', '/');
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function archivePublication(root, manifestOption, write = false) {
    root = path.resolve(root);
    const manifestRelative = selectPublicationManifest(root, manifestOption,
        { command: 'archive-publication', includeSavedStandalone: true });
    const manifestPath = insidePreview(root, manifestRelative);
    const batch = path.posix.dirname(manifestRelative);
    if (batch === rootForPreview(batch)) throw new Error('請指定 Preview 根目錄下的批次資料夾');
    const batchPath = path.dirname(manifestPath);
    const lock = manifestPath + '.publishing.lock';
    const receipts = publicationPath(root, 'review/bio-publications', 'review');
    if (!fs.existsSync(receipts)) throw new Error('找不到這批的發布收據');
    const receiptName = fs.readdirSync(receipts, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name).sort().reverse()
        .find(name => JSON.parse(fs.readFileSync(path.join(receipts, name), 'utf8')).manifestPath === manifestRelative);
    if (!receiptName) throw new Error('找不到這批的發布收據');
    const receiptPath = publicationPath(root, 'review/bio-publications/' + receiptName, 'review');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.status !== 'COMPLETE' || receipt.skipped?.length || !Array.isArray(receipt.files) ||
        receipt.files.some(file => file.written !== true)) throw new Error('發布收據未確認整批完成');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.batchDirectory !== batch || !Array.isArray(manifest.entries) ||
        (!manifest.entries.length && (!isStandaloneManifest(manifestRelative) || !receipt.files.length)))
        throw new Error('發布清單與批次不一致');
    const byTarget = new Map(manifest.entries.map(entry => [entry.targetPath, entry]));
    const reviewed = [...receipt.files, ...(receipt.unchanged || [])];
    const verifiedTargets = new Set();
    const checks = [[manifestPath, receipt.manifestSHA256]];
    const drafts = [];
    for (const file of reviewed) {
        const entry = byTarget.get(file.path);
        if (verifiedTargets.has(file.path) || (file.draftPath ? entry : !entry))
            throw new Error('收據與發布清單不一致：' + file.path);
        verifiedTargets.add(file.path);
        const draftPath = file.draftPath || batch + '/' + entry.previewFilename;
        const draftRoot = rootForPreview(draftPath);
        if (file.draftPath && (!draftRoot || !/^\/(mini|plugin|material-base)\/.+\.preview\.md$/.test(draftPath.slice(draftRoot.length))))
            throw new Error('獨立 Preview 路徑無效：' + draftPath);
        const preview = file.draftPath ? insidePreview(root, draftPath) : publicationPath(root, draftPath, batch);
        if (file.draftPath) drafts.push(draftPath);
        checks.push([preview, file.previewSHA256], [publicationPath(root, file.path), file.candidateSHA256]);
    }
    if (manifest.entries.some(entry => !verifiedTargets.has(entry.targetPath)))
        throw new Error('發布收據缺少部分批次成員的驗證紀錄');

    const archive = 'review/bio-published-previews/' + receiptName.slice(0, -5) + '.zip';
    const archivePath = publicationPath(root, archive, 'review');
    const report = batch + ' - 材料審核.md';
    const paths = [...drafts, ...(fs.existsSync(insidePreview(root, report)) ? [report] : []), batch];
    const moves = paths.map(relative => ({ relative, from: insidePreview(root, relative) }));
    const verifyChecks = resolve => {
        for (const [original, expected] of checks) {
            const file = resolve(original);
            if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile() || sha256(file) !== expected)
                throw new Error('檔案缺少或在發布後已變更：' + slash(path.relative(root, original)));
        }
    };
    const verify = () => {
        if (fs.existsSync(archivePath)) throw new Error('封存 ZIP 已存在：' + archive);
        verifyChecks(file => file);
    };
    const result = { dryRun: !write, batch, standalonePreviews: drafts.length, archive };
    if (!write) {
        if (fs.existsSync(lock)) throw new Error('這批正在發布或封存');
        verify();
        return result;
    }
    fs.closeSync(fs.openSync(lock, 'wx'));
    const applied = [];
    let staging, temporaryZip, restoreFailed = false;
    const cleanupWarnings = [];
    try {
        verify();
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        staging = fs.mkdtempSync(publicationPath(root, 'review/.bio-preview-zip-', 'review'));
        temporaryZip = archivePath + '.' + randomUUID() + '.tmp';
        for (const move of moves) {
            move.to = path.join(staging, move.relative);
            fs.mkdirSync(path.dirname(move.to), { recursive: true });
            fs.renameSync(move.from, move.to);
            applied.push(move);
        }
        verifyChecks(file => {
            const move = applied.find(value => file === value.from || file.startsWith(value.from + path.sep));
            return move ? path.join(move.to, path.relative(move.from, file)) : file;
        });
        const compression = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
            ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'bio-preview-zip.ps1'),
                '-SourceFolder', staging, '-ArchiveFile', temporaryZip,
                '-ExcludedEntry', batch + '/' + path.basename(lock)],
            { cwd: root, encoding: 'utf8', windowsHide: true });
        if (compression.error || compression.status !== 0)
            throw new Error('ZIP 建立或內容校驗失敗：' + (compression.error?.message || compression.stderr?.trim() || compression.status));
        fs.linkSync(temporaryZip, archivePath);
    } catch (error) {
        const failed = [];
        for (const move of applied.reverse()) {
            try {
                if (fs.existsSync(move.from)) throw new Error('原位置已有人寫入');
                fs.renameSync(move.to, move.from);
            } catch {
                failed.push(slash(path.relative(root, move.to)));
            }
        }
        if (failed.length) {
            restoreFailed = true;
            error.message += '；以下封存項目需人工復原：' + failed.join('、');
        }
        throw error;
    } finally {
        const movedBatch = moves.find(move => move.from === batchPath);
        for (const file of [lock, movedBatch.to && path.join(movedBatch.to, path.basename(lock)), temporaryZip]) {
            try { if (file && fs.existsSync(file)) fs.unlinkSync(file); }
            catch (error) { cleanupWarnings.push(slash(path.relative(root, file)) + '：' + error.message); }
        }
        if (staging && !restoreFailed) {
            try {
                const checked = publicationPath(root, slash(path.relative(root, staging)), 'review');
                fs.rmSync(checked, { recursive: true });
            } catch (error) { cleanupWarnings.push(slash(path.relative(root, staging)) + '：' + error.message); }
        }
    }
    const removedEmptyFolders = [];
    for (const move of moves) {
        const folderName = rootForPreview(move.relative);
        const previewRoot = insidePreview(root, folderName);
        for (let folder = path.dirname(move.from); folder === previewRoot || folder.startsWith(previewRoot + path.sep); folder = path.dirname(folder)) {
            if (folder === previewRoot && folderName === defaultPreviewRoot) break;
            const relative = slash(path.relative(root, folder));
            try {
                insidePreview(root, relative);
                if (fs.readdirSync(folder).length) break;
                fs.rmdirSync(folder);
                removedEmptyFolders.push(relative);
            } catch (error) {
                if (error.code === 'ENOENT') continue;
                if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') cleanupWarnings.push(relative + '：' + error.message);
                break;
            }
        }
    }
    result.removedEmptyFolders = removedEmptyFolders;
    if (cleanupWarnings.length) result.cleanupWarnings = cleanupWarnings;
    return result;
}

module.exports = { archivePublication };
