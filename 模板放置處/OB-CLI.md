<%*
const Notice = tp.obsidian.Notice;
const root = app.vault.adapter.basePath;
const action = await tp.system.suggester(
    ['準備鎖定版本的 Slimefun 原始碼', 'Slimefun Java Parser V1', 'Minecraft Review', 'Normalized JSON Review', 'Normalized JSON → BIO Preview', 'BIO 盤點', 'BIO Preferred 稽核', '集中 SCAN／PUBLISH／ARCHIVE', '完整回歸測試'],
    ['prepare-source','parse','minecraft-review','normalized-review','preview','inventory','audit-preferred','publication','test'], false, 'OB-CLI：只複製具日誌的 PowerShell 前景指令');
if (!action) return;
let args = ['scripts/ob-cli.cjs'];
if (action === 'prepare-source') args.push('prepare-source');
else if (action === 'parse') {
    const source = await tp.system.prompt('Slimefun4 Git checkout 完整路徑（需鎖定 5374034c8713248909e60e6855c6f745fd7ca676）：');
    if (!source?.trim()) return;
    args.push('parse','--source=slimefun','--source-root='+source.trim());
} else if (action === 'test') args.push('test');
else if (action === 'inventory') args.push('inventory','--write');
else if (action === 'audit-preferred') {
    const scope = await tp.system.suggester(['正式 BIO', 'Preview', '全部'], ['formal','preview','all'], false, '選擇 Preferred 稽核範圍');
    if (!scope) return;
    args.push('audit-preferred','--scope='+scope);
}
else if (action === 'publication') {
    const manifests = app.vault.getFiles().filter(file=>file.name==='BIO Publication.json' &&
        (file.path.startsWith('@自動化BIO Preview/') || file.path.startsWith('MC-自動化BIO/preview/'))).sort((a,b)=>b.path.localeCompare(a.path));
    if (!manifests.length) { new Notice('尚未產生 Publication Manifest'); return; }
    const manifest = await tp.system.suggester(manifests.map(file=>file.path),manifests,false,'選擇批次');
    if (!manifest) return;
    const operation = await tp.system.suggester(['SCAN','PUBLISH 預演','PUBLISH 正式寫入','ARCHIVE 預演','ARCHIVE 正式封存'],
        ['scan-publication','publish','publish-write','archive-publication','archive-write'],false,'選擇作業');
    if (!operation) return;
    args.push(operation==='publish-write'?'publish':operation==='archive-write'?'archive-publication':operation,'--manifest='+manifest.path);
    if (operation.endsWith('-write')) args.push('--write');
} else if (action === 'minecraft-review') {
    const operation = await tp.system.suggester(['SCAN','NEXT','RECALCULATE'],['scan','next','recalculate'],false,'Minecraft source adapter');
    if (!operation) return;
    args.push('review',operation,'--source=minecraft');
} else {
    const files = app.vault.getFiles().filter(file=>file.name==='Normalized Recipes.json' || file.name==='Minecraft Normalized Recipes.json').sort((a,b)=>b.path.localeCompare(a.path));
    if (!files.length) { new Notice('請先執行 Parser 產生標準化 JSON'); return; }
    const normalized = await tp.system.suggester(files.map(file=>file.path),files,false,'選擇標準化資料來源');
    if (!normalized) return;
    if (action === 'preview') {
        const write = await tp.system.suggester(['預演，列出將產生的檔案','寫入 Preview，正式 BIO 不變'],[false,true],false,'產生目前來源中已完成 Review 的目標');
        if (write == null) return;
        args.push('preview','--normalized='+normalized.path);
        if (write) args.push('--write');
    } else {
        const operation = await tp.system.suggester(['SCAN','NEXT','RECALCULATE'],['scan','next','recalculate'],false,'Normalized source adapter');
        if (!operation) return;
        args.push('review',operation,'--normalized='+normalized.path);
    }
}
const helper = { exports: {} };
new Function('module', await app.vault.adapter.read('BIO相關模組/搜尋介面模塊/foreground_command.js'))(helper);
await navigator.clipboard.writeText(helper.exports.foregroundCommand(root,args,action));
new Notice('已複製完整 PowerShell 前景指令；請手動執行，完成後查看 stdout／stderr 與相關報告。',12000);
%>
