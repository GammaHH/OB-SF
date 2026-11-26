#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { names, workspaceName, collectionTexts } = require('./lib/bio-workspace.cjs');
const { normalizedSource, renderNormalizedReview, parseNormalizedReview } = require('./lib/normalized-source.cjs');
const { formalBIOIndex } = require('./lib/formal-bio-index.cjs');
const { readReviewDecisionStore, writeReviewDecisionStore } = require('./lib/review-decision-store.cjs');
const { generateNormalizedBatch } = require('./lib/normalized-bio-generator.cjs');
const root = path.resolve(__dirname,'..');
const args = process.argv.slice(2), command=args[0];
const option = name => args.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
const flag = name => args.includes('--'+name);
function inside(relative) {
    if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) throw new Error('請使用 Vault 相對路徑');
    const result=path.resolve(root,relative), local=path.relative(root,result);
    if (!local || local.startsWith('..') || path.isAbsolute(local) || local.split(path.sep).some(part=>part.startsWith('.'))) throw new Error('路徑超出 Vault 或位於隱藏目錄');
    return result;
}
function write(relative,text) { const file=inside(relative); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,text); }
function child(script,childArgs) {
    const run=spawnSync(process.execPath,[path.join(root,'scripts',script),...childArgs],{stdio:'inherit',windowsHide:true});
    if(run.error || run.signal || run.status===null) throw new Error(run.error?.message || '子程序未完成');
    process.exitCode=run.status;
}
function store() {
    const paths={jsonPath:path.join(root,workspaceName(root,'decisions')),summaryMarkdownPath:path.join(root,workspaceName(root,'decisionSummary'))};
    const registry=readReviewDecisionStore({...paths,legacyMarkdownPath:paths.summaryMarkdownPath}).registry;
    return {registry,paths};
}
function context() {
    const statePath='review/bio-normalized-review.json';
    const state=fs.existsSync(inside(statePath))?JSON.parse(fs.readFileSync(inside(statePath),'utf8')):{};
    const relative=option('normalized') || state.normalized;
    if(!relative) throw new Error('請指定 --normalized=<Normalized Recipes.json 相對路徑>');
    const source=normalizedSource(JSON.parse(fs.readFileSync(inside(relative),'utf8')));
    const mapping=fs.readFileSync(path.join(root,'Recipe Mapping Draft.md'),'utf8');
    const index=formalBIOIndex(root,mapping);
    return {statePath,state,relative,source,index,...store()};
}
function reviewRows(ctx) {
    const saved=ctx.registry.normalizedTargets || {};
    return ctx.source.items.map(item=>({id:item.id,status:saved[item.id]?.fingerprint===ctx.source.fingerprint && saved[item.id]?.reviewed?'READY':'PENDING'}));
}
function renderQueue(ctx, rows) {
    return ['---','type: bio-review-queue','source_adapter: normalized','sourceFingerprint: '+ctx.source.fingerprint,'---','',
        '# BIO Review Queue','', '- Normalized source: `'+ctx.relative+'`', '- Provider: '+ctx.source.provider_id,
        '- Parser 診斷：'+(ctx.source.diagnostics || []).length+'（完整來源仍須查看 Parser Manifest，不代表全部來源已解析）','',
        '| Target | Status |','|---|---|',...rows.map(value=>'| '+value.id+' | '+(value.id===ctx.state.current&&value.status!=='READY'?'IN_REVIEW':value.status)+' |'),''].join('\n');
}
function queue(ctx) {
    const rows=reviewRows(ctx);
    write(names.queue,renderQueue(ctx,rows));
    write(ctx.statePath,JSON.stringify({...ctx.state,normalized:ctx.relative,fingerprint:ctx.source.fingerprint},null,2)+'\n');
    return rows;
}
function renderActiveReviews(ctx,item) {
    const id=item.id;
    const current=ctx.registry.normalizedTargets || {};
    const match=ctx.index.inventory.get('item',id);
    const defaults={...current};
    if(!current[id] && match.presence==='PRESENT') defaults[id]={fingerprint:ctx.source.fingerprint,name:match.matches[0].name,folder:path.posix.dirname(match.matches[0].path)};
    return {
        [names.recipeReview]:renderNormalizedReview({...ctx.source,items:[item]},defaults),
        [names.baseReview]:'---\ntype: bio-base-material-review\nsource_adapter: normalized\n---\n\n# BIO Base Material Review\n\n目前目標：`'+id+'`。\n\n此來源不套用 Vanilla 自動 Base 規則。請在 [[BIO Recipe Review]] 明確選擇配方，或勾選外部取得並填寫說明。未解析的 Java 結構保留在 Parser Manifest，不會自動變成 Base。\n'
    };
}
function activate(ctx,id) {
    const item=ctx.source.items.find(value=>value.id===id);
    if(!item) throw new Error('Review target 不存在：'+id);
    for(const [file,content] of Object.entries(renderActiveReviews(ctx,item))) write(file,content);
    ctx.state.current=id;
    queue(ctx);
    console.log('IN_REVIEW: '+id+' → '+names.recipeReview);
}
function readReviewFile(file) {
    try { return fs.readFileSync(inside(file)); }
    catch(error) { if(error.code==='ENOENT') return null; throw error; }
}
function startNormalizedReview(ctx) {
    const target=option('target') ?? args.slice(2).find(value=>!value.startsWith('--'));
    if(!target) throw new Error('review start 需要 --target=<ID>');
    if(!ctx.source.items.some(item=>item.id===target)) throw new Error('Review target 不存在：'+target);
    const dryRun=flag('dry-run'), backupCurrent=flag('backup-current');
    const files=[names.recipeReview,names.baseReview,names.queue,ctx.statePath];
    const snapshot=new Map(files.map(file=>[file,readReviewFile(file)]));
    const recipeText=snapshot.get(names.recipeReview)?.toString('utf8') || '';
    const rows=reviewRows(ctx);
    const current=ctx.state.fingerprint===ctx.source.fingerprint ?
        ctx.source.items.find(item=>item.id===ctx.state.current) : null;
    const marker='<!-- obsf:normalized-item '+Buffer.from(target).toString('base64url')+' -->';
    if(current?.id===target && recipeText.includes('sourceFingerprint: '+ctx.source.fingerprint) && recipeText.includes(marker)) {
        console.log((dryRun?'DRY-RUN: ':'')+'目前已啟用 '+target+'，保留審核內容');
        return;
    }
    const currentReady=rows.some(row=>row.id===current?.id && row.status==='READY');
    const hasCurrentFiles=[...snapshot.values()].some(content=>content!==null);
    const comparable=text=>text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    const savedDocs=currentReady ? {...renderActiveReviews(ctx,current),[names.queue]:renderQueue(ctx,rows)} : {};
    const needsBackup=hasCurrentFiles && (!currentReady || Object.entries(savedDocs).some(([file,expected])=>{
        const content=snapshot.get(file);
        return content!==null && comparable(content.toString('utf8'))!==expected;
    }));
    if(needsBackup && !backupCurrent) {
        const message='目前 Review 可能含未保存決策或屬於其他來源。請先儲存編輯，再用 --backup-current 備份並切換至 '+target;
        if(dryRun) { console.log('DRY-RUN BLOCKED: '+message); process.exitCode=3; return; }
        throw new Error(message);
    }
    if(dryRun) {
        console.log('DRY-RUN: 啟用 '+target+(needsBackup?'，先備份現有 Review':''));
        return;
    }
    if(needsBackup) {
        const parent=inside('review/normalized-start-backups');
        fs.mkdirSync(parent,{recursive:true});
        const backup=fs.mkdtempSync(path.join(parent,'draft-'));
        for(const [file,content] of snapshot) {
            if(content!==null) fs.writeFileSync(path.join(backup,path.basename(file)),content,{flag:'wx'});
        }
        console.log('Review 備份：'+path.relative(root,backup));
    }
    for(const [file,original] of snapshot) {
        const latest=readReviewFile(file);
        if(original===null ? latest!==null : !latest?.equals(original))
            throw new Error('Review 已變更，請確認最新內容後重試：'+file);
    }
    activate(ctx,target);
}
function review() {
    const action=args[1] || 'scan';
    const source=option('source');
    if(source==='minecraft' || (!option('normalized') && !fs.existsSync(path.join(root,'review/bio-normalized-review.json')))) {
        return child('minecraft-review.cjs',args.slice(1).filter(value=>!value.startsWith('--source=')));
    }
    const ctx=context();
    if(action==='start') {
        startNormalizedReview(ctx);
    } else if(action==='scan') {
        const rows=queue(ctx);
        const current=rows.find(value=>value.id===ctx.state.current && value.status==='PENDING');
        const target=current || rows.find(value=>value.status==='PENDING');
        // A rescan of the same source must not erase the current unsaved choices.
        const reviewPath=path.join(root,names.recipeReview);
        if(current && fs.existsSync(reviewPath) && fs.readFileSync(reviewPath,'utf8').includes('sourceFingerprint: '+ctx.source.fingerprint))
            console.log('保留目前未完成的 Review：'+current.id);
        else if(target) activate(ctx,target.id);
        console.log(JSON.stringify({targets:rows.length,ready:rows.filter(value=>value.status==='READY').length,provider:ctx.source.provider_id}));
    } else if(action==='recalculate') {
        const item=ctx.source.items.find(value=>value.id===ctx.state.current);
        if(!item) throw new Error('請先 scan / next 啟用目標');
        const result=parseNormalizedReview(fs.readFileSync(path.join(root,names.recipeReview),'utf8'),{...ctx.source,items:[item]},ctx.index.roots);
        if(result.pending.length) { console.log(JSON.stringify(result.pending,null,2)); process.exitCode=3; return; }
        ctx.registry.normalizedTargets={...(ctx.registry.normalizedTargets || {}),...result.decisions};
        writeReviewDecisionStore(ctx.registry,ctx.paths);
        queue(ctx);
        console.log('READY: '+item.id);
    } else if(action==='next') {
        const rows=queue(ctx);
        if(rows.some(value=>value.id===ctx.state.current && value.status==='PENDING')) throw new Error('目前目標尚未 READY，請先修改 Review 後 recalculate');
        const next=rows.find(value=>value.status==='PENDING');
        if(next) activate(ctx,next.id); else console.log('已解析目標 Review Queue: READY；來源另有 '+(ctx.source.diagnostics || []).length+' 項 Parser 診斷，請查看 Manifest');
    } else if(action==='revoke') {
        const id=args[2];
        if(!ctx.registry.normalizedTargets?.[id]) throw new Error('沒有此 Normalized 決策');
        delete ctx.registry.normalizedTargets[id];
        writeReviewDecisionStore(ctx.registry,ctx.paths); queue(ctx);
        console.log('Revoked: '+id);
    } else throw new Error('Normalized review 支援 scan / start / next / recalculate / revoke');
}
function main() {
    if(command==='prepare-source') {
        const destination=inside(option('destination') || '參考資料/Slimefun4-source');
        if(fs.existsSync(destination)) throw new Error('來源目的地已存在，拒絕覆寫：'+destination);
        const commit=require('../BIO相關模組/Slimefun解析器模塊/slimefun_parser').PINNED_COMMIT;
        const operations=[['clone','--no-checkout','--filter=blob:none','--single-branch','--branch','experimental','https://github.com/Slimefun/Slimefun4.git',destination],
            ['-C',destination,'fetch','--depth=1','origin',commit],['-C',destination,'checkout','--detach',commit]];
        for(const operation of operations) {
            const run=spawnSync('git',operation,{stdio:'inherit',windowsHide:true});
            if(run.error || run.signal || run.status!==0) throw new Error(run.error?.message || '來源準備未完成；已保留現有下載內容，未自動重試');
        }
        console.log('Slimefun pinned source: '+destination+' @ '+commit); return;
    }
    if(command==='test') {
        const testRoot=path.join(root,'tests/minecraft-vanilla-pipeline');
        const files=fs.readdirSync(testRoot).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>path.join(testRoot,name));
        const run=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});
        if(run.error || run.signal || run.status===null) throw new Error(run.error?.message || '測試程序未完成');
        process.exitCode=run.status; return;
    }
    if(command==='parse') {
        if(option('source')!=='slimefun') throw new Error('parse 目前支援 --source=slimefun；Vanilla 沿用既有 Parser 模板');
        return child('slimefun-parser.cjs',args.slice(1).filter(value=>!value.startsWith('--source=')));
    }
    if(command==='review') return review();
    if(command==='preview') {
        if(!option('normalized')) return child('minecraft-bio-generator.cjs',args);
        if(flag('from-formal')) {
            const source = JSON.parse(fs.readFileSync(inside(option('normalized')), 'utf8'));
            const result = generateNormalizedBatch(root, source, {}, {
                write: flag('write'), targets: option('target')?.split(',') || null, fromFormal: true
            });
            console.log(JSON.stringify(result,null,2));
            return;
        }
        const ctx=context();
        const result=generateNormalizedBatch(root,ctx.source,ctx.registry.normalizedTargets || {},{write:flag('write'),targets:option('target')?.split(',') || null});
        console.log(JSON.stringify(result,null,2));
        return;
    }
    if(['scan-publication','publish','archive-publication','refresh-batch','apply-update'].includes(command)) {
        return child('minecraft-bio-generator.cjs',[command==='apply-update'?'publish':command,...args.slice(1)]);
    }
    if(command==='audit-preferred') {
        const { auditPreferred, renderPreferredAudit } = require('./lib/bio-preferred-audit.cjs');
        const { previewRoots } = require('./lib/bio-preview-paths.cjs');
        const { parseFrontmatter } = require('../BIO相關模組/MC解析器模塊/bio/bio_scanner');
        const scope = option('scope') || 'formal';
        if (!['formal','preview','all'].includes(scope)) throw new Error('--scope 須為 formal、preview 或 all');
        const documents = [];
        if (scope !== 'preview') {
            const mapping = fs.readFileSync(path.join(root,'Recipe Mapping Draft.md'),'utf8');
            documents.push(...formalBIOIndex(root,mapping,{ reportReadErrors: true }).documents.map(document => ({ ...document, scope: 'formal' })));
        }
        function scanPreview(relative) {
            const absolute = path.join(root, relative);
            try {
                const info = fs.lstatSync(absolute, { throwIfNoEntry: false });
                if (!info) return;
                if (info.isSymbolicLink()) throw new Error('略過符號連結');
                if (info.isDirectory()) {
                    for (const name of fs.readdirSync(absolute)) scanPreview(relative + '/' + name);
                } else if (info.isFile() && /\.md$/i.test(relative)) {
                    const text = fs.readFileSync(absolute, 'utf8');
                    documents.push({ path: relative, text, frontmatter: parseFrontmatter(text), scope: 'preview' });
                }
            } catch (error) { documents.push({ path: relative, cacheReady: false, readError: error.message, scope: 'preview' }); }
        }
        if (scope !== 'formal') for (const relative of previewRoots) scanPreview(relative);
        const audit = auditPreferred(documents);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const output = 'review/BIO Preferred Audit-' + scope + '-' + stamp + '.md';
        const file = inside(output);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, renderPreferredAudit(audit), { flag: 'wx' });
        console.log(JSON.stringify({ formal: audit.formal, preview: audit.preview, complete: audit.complete, counts: audit.counts, report: output }, null, 2));
        if (!audit.complete) process.exitCode = 2;
        return;
    }
    if(command==='inventory') {
        const mapping=fs.readFileSync(path.join(root,'Recipe Mapping Draft.md'),'utf8');
        const inventory=formalBIOIndex(root,mapping).inventory;
        if(flag('write')) {
            const stamp=new Date().toISOString().replace(/[:.]/g,'-');
            const output='BIO-輸出報告/BIO Inventory-'+stamp+'.json';
            if(fs.existsSync(inside(output))) throw new Error('盤點輸出已存在');
            write(output,JSON.stringify(inventory,null,2)+'\n'); console.log('Inventory: '+output);
        }
        console.log(JSON.stringify(inventory.stats,null,2));
        if(inventory.conflicts.length || inventory.diagnostics.length) process.exitCode=2;
        return;
    }
    if(command==='collections') {
        const texts=collectionTexts(root);
        const bio=require('../BIO相關模組/MC解析器模塊').bio;
        console.log(JSON.stringify({file:texts.files,tags:bio.parseTagBIOMappingMarkdown(texts.tags).mappings.size,
            groups:bio.parseBIOGroupMappingMarkdown(texts.groups).mappings.size},null,2)); return;
    }
    console.log('OB-CLI: parse --source=slimefun --source-root=<checkout> | review scan/next/recalculate --normalized=<json> | review start --normalized=<json> --target=<ID> [--dry-run] [--backup-current] | review <action> --source=minecraft | preview --normalized=<json> [--write] | collections | inventory [--write] | audit-preferred [--scope=formal|preview|all] | scan-publication/publish/archive-publication --manifest=<path> [--write]');
    process.exitCode=1;
}
try { main(); } catch(error) { console.error('ERROR: '+error.message); process.exitCode=1; }
