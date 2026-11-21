#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PINNED_COMMIT, normalizeSlimefunAST, renderManifest } = require('../BIO相關模組/Slimefun解析器模塊/slimefun_parser');
const root = path.resolve(__dirname, '..');
const option = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
function git(sourceRoot, args) {
    const run = spawnSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', windowsHide: true });
    if (run.error || run.signal || run.status !== 0) throw new Error(run.error?.message || run.stderr || 'Git 未完成');
    return run.stdout.trim();
}
function main() {
    const sourceRoot = path.resolve(option('source-root') || '');
    if (!option('source-root')) throw new Error('請提供 --source-root=<Slimefun4 Git checkout>');
    if (git(sourceRoot, ['rev-parse','HEAD']) !== PINNED_COMMIT) throw new Error('來源不是鎖定 commit：' + PINNED_COMMIT);
    if (git(sourceRoot, ['status','--porcelain','--untracked-files=normal'])) throw new Error('來源 checkout 有修改／未追蹤檔案，請使用乾淨的鎖定來源');
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const output = path.resolve(root, option('output') || 'review/parser-runs/slimefun-' + stamp);
    const relative = path.relative(root, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('輸出必須位於專案內的全新資料夾');
    if (fs.existsSync(output)) throw new Error('輸出已存在，拒絕覆寫：' + output);
    fs.mkdirSync(output, { recursive: true });
    const astPath = path.join(output, 'Java AST.json');
    const run = spawnSync(option('java') || 'java', ['-Dfile.encoding=UTF-8', path.join(root,'scripts/java/SlimefunAst.java'),
        path.join(sourceRoot,'src/main/java'), astPath], { stdio: 'inherit', windowsHide: true });
    if (run.error || run.signal || ![0,2].includes(run.status) || !fs.existsSync(astPath)) throw new Error(run.error?.message || 'Java AST 未完成或未產生 artifact');
    const ast = JSON.parse(fs.readFileSync(astPath,'utf8'));
    const registry = normalizeSlimefunAST(ast, { repository: 'Slimefun/Slimefun4', commit: PINNED_COMMIT,
        sourcePrefix: 'src/main/java', branch: 'experimental' });
    const json = path.join(output,'Normalized Recipes.json'), manifest = path.join(output,'Slimefun Recipe Manifest.md');
    fs.writeFileSync(json, JSON.stringify(registry,null,2) + '\n', { flag: 'wx' });
    fs.writeFileSync(manifest, renderManifest(registry), { flag: 'wx' });
    const fresh = JSON.parse(fs.readFileSync(json,'utf8'));
    if (fresh.registryFingerprint !== registry.registryFingerprint || !fs.statSync(manifest).size) throw new Error('Parser artifact 校驗失敗');
    console.log(JSON.stringify({ ...registry.stats, normalized: path.relative(root,json), manifest: path.relative(root,manifest),
        sourceCommit: PINNED_COMMIT, sourceRecipesReviewed: false },null,2));
    if (run.status === 2 || registry.diagnostics.some(value => value.status === 'ERROR')) process.exitCode = 2;
}
try { main(); } catch(error) { console.error('ERROR: ' + error.message); process.exitCode=1; }
