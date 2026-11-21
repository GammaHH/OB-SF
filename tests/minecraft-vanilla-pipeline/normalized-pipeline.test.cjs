const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const vm=require('node:vm');
const {normalizedSource,renderNormalizedReview,parseNormalizedReview}=require('../../scripts/lib/normalized-source.cjs');
const {readDraft,saveDraft}=require('../../BIO engine/normalized_review_form');
const {generateNormalizedBatch}=require('../../scripts/lib/normalized-bio-generator.cjs');
const {scanPublication,publishBIOBatch}=require('../../scripts/lib/bio-publication.cjs');
const {archivePublication}=require('../../scripts/lib/bio-publication-archive.cjs');
const {parseFrontmatter}=require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');
const reader=require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');
const {workspaceName,collectionTexts}=require('../../scripts/lib/bio-workspace.cjs');
const {serializeReviewDecisionRegistryJSON,parseReviewDecisionRegistryJSON}=require('../../BIO相關模組/MC解析器模塊').dependencies;
const input=()=>({schema:'OB-SF Normalized Recipe V1',provider_id:'slimefun4',source:{repository:'Slimefun/Slimefun4',commit:'5374034c8713248909e60e6855c6f745fd7ca676'},items:[{
    id:'slimefun:CAN',name:'Tin Can',recipes:[{recipeId:'recipe-can',sourceType:'TEST',section:'常規',machine:'無/手動',output:8,
        ingredients:[{kind:'item',id:'minecraft:iron_ingot',qty:4}],status:'REVIEW',warnings:['確認來源'],source:{file:'Setup.java',line:2}}]
}]});
const mapping='<!-- obsf:formal-bio-roots:start -->\n| MC-物品資料庫 | true | true |\n| SF-Test | true | true |\n<!-- obsf:formal-bio-roots:end -->\n'+
    '<!-- obsf:provider-headings:start -->\n| SF-Test | slimefun4 | Slimefun4 | true |\n<!-- obsf:provider-headings:end -->\n'+
    '<!-- obsf:machine-dictionary:start -->\n| machine_id | machine | enabled |\n| --- | --- | --- |\n| TEST | 無/手動 | true |\n<!-- obsf:machine-dictionary:end -->\n'+
    '| provider | machine | section | enabled |\n| --- | --- | --- | --- |\n| Slimefun4 | 無/手動 | 常規 | true |\n';
const roots=[{folder:'SF-Test',recursive:true}];
function fixture(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'obsf-normalized-test-'));
    t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('obsf-normalized-test-'));fs.rmSync(root,{recursive:true,force:true});});
    const write=(relative,text)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
    const git=(...args)=>{const run=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);return run.stdout.trim();};
    git('init','-b','codex/test');git('config','user.name','BIO test');git('config','user.email','bio@example.invalid');git('config','core.autocrlf','false');
    write('sentinel.txt','unchanged');git('add','sentinel.txt');git('commit','-m','fixture');
    write('Recipe Mapping Draft.md',mapping);
    write('MC-物品資料庫/鐵錠.md','---\ntype: mc-item\nid: IRON_INGOT\nminecraft_id: minecraft:iron_ingot\n---\n# 合成/取得\n### 外部取得\n<!-- preferred -->\n- 採集：測試。\n');
    return {root,write,git};
}
function decision(registry){return {'slimefun:CAN':{fingerprint:registry.fingerprint,name:'罐頭',folder:'SF-Test',recipeId:'recipe-can',reviewed:true}};}

test('normalized START targets one item, preserves drafts and keeps saved decisions',t=>{
    const f=fixture(t);
    const data=input();
    data.items.push({
        ...data.items[0],id:'slimefun:CARBON',
        recipes:[{...data.items[0].recipes[0],recipeId:'recipe-carbon'}]
    });
    const source='review/pilot.json';
    f.write(source,JSON.stringify(data));
    const decisionsFile='BIO Review Decisions.json';
    const initialDecisions=serializeReviewDecisionRegistryJSON({
        schemaVersion:1,targets:{},revocations:[],normalizedTargets:decision(normalizedSource(data))
    });
    f.write(decisionsFile,initialDecisions);
    const script=path.resolve(__dirname,'../../scripts/ob-cli.cjs');
    const code=fs.readFileSync(script,'utf8');
    function cli(action,...args){
        const proc={argv:[process.execPath,script,'review',action,'--normalized='+source,...args]};
        const out=[];
        vm.runInNewContext(code,{__dirname:path.join(f.root,'scripts'),require:createRequire(script),
            Buffer,process:proc,console:{log:msg=>out.push(msg),error:msg=>out.push(msg)}},{filename:script});
        return {status:proc.exitCode ?? 0,output:out.join('\n')};
    }
    const start=(...args)=>cli('start',...args);
    const read=file=>fs.readFileSync(path.join(f.root,file),'utf8');
    const exists=file=>fs.existsSync(path.join(f.root,file));
    const recipeReview='BIO Recipe Review.md', queue='BIO Review Queue.md';
    const state='review/bio-normalized-review.json', backups='review/normalized-start-backups';
    const carbon='--target=slimefun:CARBON';
    assert.match(start('--target=slimefun:MISSING','--dry-run').output,/不存在.*MISSING/);
    assert.equal(start(carbon,'--dry-run').status,0);
    assert.equal(exists(recipeReview),false);
    assert.equal(exists(state),false);

    const vanillaDraft='---\ntype: minecraft-recipe-review\n---\n人工備註\n';
    f.write(recipeReview,vanillaDraft);
    assert.equal(start(carbon,'--dry-run').status,3);
    assert.equal(start(carbon).status,1);
    assert.equal(read(recipeReview),vanillaDraft);
    assert.equal(start(carbon,'--backup-current','--dry-run').status,0);
    assert.equal(exists(backups),false);
    assert.equal(exists(queue),false);
    assert.equal(start(carbon,'--backup-current').status,0);
    const [saved]=fs.readdirSync(path.join(f.root,backups));
    assert.equal(read(path.join(backups,saved,recipeReview)),vanillaDraft);
    assert.match(read(recipeReview),/## slimefun:CARBON/);
    assert.doesNotMatch(read(recipeReview),/## slimefun:CAN\b/);
    assert.match(read(recipeReview),/狀態：REVIEW/);
    assert.match(read(queue),/slimefun:CARBON \| IN_REVIEW/);
    assert.match(read(queue),/slimefun:CAN \| READY/);
    assert.equal(read(decisionsFile),initialDecisions);

    const draft=read(recipeReview);
    f.write(recipeReview,draft+'\n未保存備註\n');
    assert.equal(start(carbon).status,0);
    assert.match(read(recipeReview),/未保存備註/);
    const blockedSwitch=start('slimefun:CAN');
    assert.equal(blockedSwitch.status,1,blockedSwitch.output);
    assert.match(blockedSwitch.output,/--backup-current/);
    f.write(recipeReview,draft.replace('- 中文名稱：','- 中文名稱：碳')
        .replace('- 正式資料夾：','- 正式資料夾：SF-Test').replace('- [ ] `recipe-carbon`','- [x] `recipe-carbon`'));
    assert.equal(cli('recalculate').status,0);
    const afterSave=read(decisionsFile);
    const savedSwitch=start('slimefun:CAN');
    assert.equal(savedSwitch.status,0,savedSwitch.output);
    assert.match(read(recipeReview),/## slimefun:CAN\b/);
    assert.match(read(queue),/slimefun:CARBON \| READY/);
    assert.equal(read(decisionsFile),afterSave);
    const savedDecisions=parseReviewDecisionRegistryJSON(afterSave).normalizedTargets;
    assert.deepEqual(Object.keys(savedDecisions).sort(),
        ['slimefun:CAN','slimefun:CARBON']);
    const preview=generateNormalizedBatch(f.root,data,savedDecisions,{targets:['slimefun:CARBON']});
    assert.equal(preview.dryRun,true);
    assert.equal(preview.previews.length,1);
    assert.equal(exists('@自動化BIO Preview'),false);
    assert.equal(read(source),JSON.stringify(data));
});

test('shared review requires explicit choice/name/folder and invalidates decisions on source changes',()=>{
    const registry=normalizedSource(input());
    let text=renderNormalizedReview(registry);
    assert.equal(parseNormalizedReview(text,registry,roots).pending.length,1);
    text=text.replace('- 中文名稱：','- 中文名稱：罐頭').replace('- 正式資料夾：','- 正式資料夾：SF-Test').replace('- [ ] `recipe-can`','- [x] `recipe-can`');
    const result=parseNormalizedReview(text,registry,roots);
    assert.equal(result.pending.length,0);assert.equal(result.decisions['slimefun:CAN'].reviewed,true);
    const changed=input();changed.items[0].recipes[0].output=9;
    assert.throws(()=>parseNormalizedReview(text,normalizedSource(changed),roots),/來源已變更/);
    const special=input();special.items[0].recipes[0].status='SPECIAL';
    const specialRegistry=normalizedSource(special);
    const marked=renderNormalizedReview(specialRegistry).replace('- 中文名稱：','- 中文名稱：罐頭').replace('- 正式資料夾：','- 正式資料夾：SF-Test').replace('- [ ] `recipe-can`','- [x] `recipe-can`');
    assert.match(parseNormalizedReview(marked,specialRegistry,roots).pending[0].reason,/Mini Parser/);
});

test('DataviewJS form saves only the active draft and passes the same CLI review validation',()=>{
    const registry=normalizedSource(input());
    const original=renderNormalizedReview(registry).replaceAll('\n','\r\n');
    assert.match(original,/```dataviewjs\r?\n/);
    const opened=readDraft(original);
    assert.equal(opened.route,'');
    const values={name:'罐頭',folder:'SF-Test',route:'recipe-can',obtainment:''};
    const notes=original+'\r\n## 人工備註\r\n保留這段\r\n';
    const saved=saveDraft(notes,opened,values,roots);
    assert.ok(saved.endsWith('## 人工備註\r\n保留這段\r\n'));
    assert.match(saved,/狀態：REVIEW/);
    assert.equal(readDraft(saved).route,'recipe-can');
    assert.equal(parseNormalizedReview(saved,registry,roots).decisions['slimefun:CAN'].name,'罐頭');
    assert.throws(()=>saveDraft(saved,opened,values,roots),/審核內容已變更/);
    assert.throws(()=>saveDraft(original,opened,{...values,folder:'Preview'},roots),/白名單/);
    const external=saveDraft(saved,readDraft(saved),{...values,route:':external',obtainment:'自然取得'},roots);
    assert.equal(parseNormalizedReview(external,registry,roots).decisions['slimefun:CAN'].external,true);
    assert.match(external,/- \[ \] `recipe-can`/);
});

test('normalized Preview enters the existing scanner/publisher/archive with source hashes and no YAML output',t=>{
    const f=fixture(t),registry=normalizedSource(input()),decisions=decision(registry);
    const plan=generateNormalizedBatch(f.root,registry,decisions,{stamp:'dry'});
    assert.equal(plan.dryRun,true);assert.equal(fs.existsSync(path.join(f.root,'@自動化BIO Preview')),false);
    const result=generateNormalizedBatch(f.root,registry,decisions,{write:true,stamp:'test'});
    const file=path.join(f.root,result.previews[0]);
    let text=fs.readFileSync(file,'utf8');
    assert.equal(parseFrontmatter(text).id,'CAN');assert.doesNotMatch(text,/^output:/m);
    assert.equal(reader.parseBIO(text).recipes[0].output,8);
    assert.match(text,/\[\[MC-物品資料庫\/鐵錠\|鐵錠\]\]/);
    assert.equal(scanPublication(f.root,result.manifest).status,'BLOCKED');
    text=text.replace(/^#未人工檢查\r?\n/m,'');fs.writeFileSync(file,text);
    let scan=scanPublication(f.root,result.manifest);
    assert.equal(scan.status,'READY',JSON.stringify(scan.diagnostics));
    const sourceFile=path.join(f.root,parseFrontmatter(text).preview_evidence),sourceBytes=fs.readFileSync(sourceFile);
    fs.appendFileSync(sourceFile,' ');
    assert.throws(()=>publishBIOBatch(f.root,result.manifest,{central:true,write:true}),/重新執行 scan-publication/);
    fs.writeFileSync(sourceFile,sourceBytes);scan=scanPublication(f.root,result.manifest);
    assert.equal(scan.status,'READY',JSON.stringify(scan.diagnostics));
    const published=publishBIOBatch(f.root,result.manifest,{central:true,write:true});
    const formal=fs.readFileSync(path.join(f.root,'SF-Test/罐頭.md'),'utf8');
    assert.match(formal,/output:: 8/);assert.doesNotMatch(formal,/^preview_[a-z0-9_]+:/m);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,published.receipt),'utf8')).status,'COMPLETE');
    assert.equal(archivePublication(f.root,result.manifest,true).dryRun,false);
    assert.equal(fs.existsSync(path.join(f.root,'SF-Test/罐頭.md')),true);
    assert.equal(fs.readFileSync(path.join(f.root,'sentinel.txt'),'utf8'),'unchanged');
});

test('existing Slimefun updates preserve manual prose, old routes and Preferred',t=>{
    const f=fixture(t),registry=normalizedSource(input());
    const original='---\ntype: sf-item\nid: CAN\n---\n# 合成/取得\n### 外部取得\n<!-- preferred -->\n- 採集：原本的人工來源。\n\n# 用途\n\n人工圖片 ![[保留.png]]\n';
    f.write('SF-Test/罐頭.md',original);
    const result=generateNormalizedBatch(f.root,registry,decision(registry),{write:true,stamp:'existing'});
    const preview=fs.readFileSync(path.join(f.root,result.previews[0]),'utf8');
    assert.match(preview,/原本的人工來源/);assert.match(preview,/保留.png/);
    const parsed=reader.parseBIO(preview);
    assert.equal(parsed.recipes.filter(value=>value.preferred).length,1);
    assert.equal(parsed.recipes.find(value=>value.preferred).external,true);
    assert.equal(fs.readFileSync(path.join(f.root,'SF-Test/罐頭.md'),'utf8'),original);
});

test('generic decisions survive the legacy Minecraft serializer and canonical workspace paths win',t=>{
    const f=fixture(t);
    const registry={schemaVersion:1,targets:{},revocations:[],normalizedTargets:decision(normalizedSource(input()))};
    assert.deepEqual(parseReviewDecisionRegistryJSON(serializeReviewDecisionRegistryJSON(registry)).normalizedTargets,registry.normalizedTargets);
    f.write('BIO Review Decisions.json','{}');f.write('Minecraft Review Decisions.json','historical');
    assert.equal(workspaceName(f.root,'decisions'),'BIO Review Decisions.json');
    f.write('BIO Collection Mapping Draft.md','merged');
    assert.equal(collectionTexts(f.root).tags,'merged');assert.equal(collectionTexts(f.root).groups,'merged');
});

test('formal update works without decision JSON and keeps other providers, alternatives and Preferred', t => {
    const f = fixture(t);
    const addonMapping = mapping.replace('| SF-Test | true | true |', '| SF-Test | true | true |\n| SF-Addon | true | true |')
        .replace('| SF-Test | slimefun4 | Slimefun4 | true |', '| SF-Test | slimefun4 | Slimefun4 | true |\n| SF-Addon | addon | Addon | true |')
        .replace('| Slimefun4 | 無/手動 | 常規 | true |', '| Slimefun4 | 無/手動 | 常規 | true |\n| Addon | 無/手動 | 常規 | true |');
    f.write('Recipe Mapping Draft.md', addonMapping);
    const target = 'SF-Test/罐頭.md';
    const original = [
        '---', 'type: sf-item', 'id: CAN', 'provider_id: slimefun4', '---', '# 合成/取得',
        '### 外部取得', '- 採集：舊來源。', '### 常規', '##### Slimefun4', '<!-- preferred -->',
        '- (Machine:: 無/手動)', '- **擇一材料** (qty:: 2)',
        '\t- [item:: [[MC-物品資料庫/鐵錠]]]', '- [output:: 1]',
        '##### InfinityExpansion', '- (Machine:: 無/手動)', '- [item:: [[MC-物品資料庫/鐵錠|鐵錠]]] (qty:: 4)', '- [output:: 8]',
        '# 用途', '手工筆記', ''
    ].join('\n');
    f.write(target, original);
    const source = { ...input(), provider_id: 'addon', source: { repository: 'example/addon' } };
    const options = { fromFormal: true, targets: ['slimefun:CAN'], write: true };
    const first = generateNormalizedBatch(f.root, source, {}, { ...options, stamp: 'addon' });
    assert.equal(first.routeDifferences[0].status, 'CANDIDATE_ADDITION');
    assert.equal(fs.existsSync(path.join(f.root, 'BIO Review Decisions.json')), false);
    const previewPath = path.join(f.root, first.previews[0]);
    const preview = fs.readFileSync(previewPath, 'utf8');
    const parsed = reader.parseBIO(preview);
    assert.equal(parsed.recipes.length, 4);
    assert.equal(parsed.recipes.find(route => route.preferred).provider, 'Slimefun4');
    assert.equal(parsed.recipes.find(route => route.preferred).ingredients[0].choices.length, 1);
    assert.equal(parsed.recipes.find(route => route.provider === 'Addon').output, 8);
    assert.deepEqual(parsed.recipes.find(route => route.provider === 'InfinityExpansion'),
        reader.parseBIO(original).recipes.find(route => route.provider === 'InfinityExpansion'));
    assert.match(preview, /舊來源.*\n[\s\S]*手工筆記/);
    assert.equal(fs.readFileSync(path.join(f.root, target), 'utf8'), original);
    assert.throws(() => generateNormalizedBatch(f.root, source, {}, { ...options, stamp: 'addon' }), /輸出已存在/);
    const clean = preview.replace(/^#(?:未人工檢查|更新需人工解析)\r?\n/gm, '');
    fs.writeFileSync(previewPath, clean);
    const scan = scanPublication(f.root, first.manifest);
    assert.equal(scan.status, 'REVIEW', JSON.stringify(scan.diagnostics));
    assert.deepEqual(scan.diagnostics.map(issue => issue.code), ['REVIEW_REQUIRED']);
    f.write(target, clean.replace(/^preview_[a-z0-9_]+:.*\n|^publish_target:.*\n/gm, ''));
    const repeat = generateNormalizedBatch(f.root, source, {}, { ...options, stamp: 'repeat' });
    assert.deepEqual(repeat.unchanged, ['slimefun:CAN']);
    assert.equal(repeat.manifest, null);
    const incomplete = structuredClone(source);
    incomplete.items[0].recipes[0].status = 'UNSUPPORTED';
    const partial = generateNormalizedBatch(f.root, incomplete, {}, { ...options, stamp: 'partial' });
    assert.equal(partial.manifest, null);
    assert.equal(partial.routeDifferences[0].status, 'MANUAL_REVIEW_REQUIRED');
});

test('an explicitly reviewed external route is appended without changing the formal BIO or its Preferred', t => {
    const f = fixture(t);
    const registry = normalizedSource(input());
    const target = 'SF-Test/罐頭.md';
    const original = '---\ntype: sf-item\nid: CAN\n---\n# 合成/取得\n### 外部取得\n<!-- preferred -->\n- 採集：舊來源\n';
    f.write(target, original);
    const decisions = decision(registry);
    Object.assign(decisions['slimefun:CAN'], { external: true, obtainment: '商人交易' });
    const result = generateNormalizedBatch(f.root, registry, decisions, { write: true, stamp: 'external' });
    const preview = fs.readFileSync(path.join(f.root, result.previews[0]), 'utf8');
    const routes = reader.parseBIO(preview).recipes;
    assert.equal(routes.find(route => route.preferred).sourceText, '採集：舊來源');
    assert.ok(routes.some(route => route.sourceText === '外部取得：商人交易'));
    assert.equal(fs.readFileSync(path.join(f.root, target), 'utf8'), original);
});
