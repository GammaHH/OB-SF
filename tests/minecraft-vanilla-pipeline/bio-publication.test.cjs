const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { publicationManifest, publishBIOBatch, preparePublication, scanPublication, selectPublicationManifest, standaloneManifest, formalizePreview, previewSemanticHash, identity, allowPreferredEdits, allowLevelEdits, parseBIOLevel } = require('../../scripts/lib/bio-publication.cjs');
const { openBatchRefresh, finishBatchRefresh, renameBatchTemplates } = require('../../scripts/lib/bio-batch-refresh.cjs');
const { archivePublication } = require('../../scripts/lib/bio-publication-archive.cjs');
const { refreshVanillaRecipeBlocks } = require('../../BIO相關模組/MC解析器模塊/bio/bio_update');

const batch = 'MC-自動化BIO/preview/batch/test';

test('publication selection prefers explicit then active, refuses ambiguous batches and keeps standalone fallback', t => {
    const f = fixture(t);
    centralMapping(f);
    draft(f, 'HM_TEST', 'minecraft:stick');
    assert.equal(selectPublicationManifest(f.root), standaloneManifest);
    f.add('stick', '木棒', item('stick')); f.save();
    assert.equal(selectPublicationManifest(f.root), f.manifestPath);
    const second = 'MC-自動化BIO/preview/batch/second/BIO Publication.json';
    fs.mkdirSync(path.dirname(path.join(f.root, second)), { recursive: true });
    fs.copyFileSync(path.join(f.root, f.manifestPath), path.join(f.root, second));
    assert.throws(() => selectPublicationManifest(f.root), error => error.message.includes(f.manifestPath) && error.message.includes(second));
    const mapping = path.join(f.root, 'Recipe Mapping Draft.md');
    fs.writeFileSync(mapping, '---\nactive_preview_manifest: "' + f.manifestPath + '"\n---\n' + fs.readFileSync(mapping, 'utf8'));
    assert.equal(selectPublicationManifest(f.root), f.manifestPath);
    assert.equal(selectPublicationManifest(f.root, second), second);
    fs.unlinkSync(path.join(f.root, f.manifestPath));
    assert.throws(() => selectPublicationManifest(f.root), /找不到發布清單/);
});

function centralMapping(f) {
    // Central validation now verifies equipment as well as materials.
    fs.writeFileSync(path.join(f.root, 'MC-物品資料庫/工作台.md'),
        item('crafting_table', '### 外部取得\n<!-- preferred -->\n- 採集：測試用已取得設備。\n'));
    fs.writeFileSync(path.join(f.root, 'Recipe Mapping Draft.md'),
        '<!-- obsf:formal-bio-roots:start -->\n| MC-物品資料庫 | true | true |\n| SF-海曼科技院 | true | true |\n<!-- obsf:formal-bio-roots:end -->\n' +
        '<!-- obsf:provider-headings:start -->\n| SF-海曼科技院 | hayman | 海曼科技院 | true |\n<!-- obsf:provider-headings:end -->\n');
}

test('refresh appends only missing collections and changes only the selected recipe files', t => {
    const f = fixture(t);
    const original = item('stick', '### 舊分類\n##### Minecraft 原版\n<!-- preferred -->\n- (Machine:: 工作台)\n' +
        '- [item:: OAK_PLANKS] (qty:: 1)\n- [output:: 1]\n- [note:: 人工提示]\n\n' +
        '##### 其他\n- (Machine:: 私人設備)\n- [item:: PRIVATE] (qty:: 1)\n\n# 用途\n![[圖.png]]\n');
    const updated = item('stick', '### 合成配方\n##### Minecraft 原版\n- (Machine:: 工作台)\n' +
        '- [item:: [[任意木材]]] (qty:: 1)\n- [output:: 4]\n');
    const entry = f.add('stick', '木棒', original);
    const other = f.add('piston', '活塞', item('piston'));
    f.save();
    const collection = '---\ntype: mc-tag\nid: PLANKS\nminecraft_tag: minecraft:planks\n---\n' +
        '### Tag 代表材料\n<!-- preferred -->\n- [item:: OAK_PLANKS]\n';
    const added = { content: collection, record: { identity: 'tag:minecraft:planks', kind: 'tag',
        targetPath: 'MC-物品資料庫/任意木材.md', previewFilename: '任意木材.preview.md', linkFilenames: ['任意木材.preview.md'],
        values: ['minecraft:oak_planks'], status: 'NEW', approved: false, baselineSemantic: previewSemanticHash(collection) } };
    const previewPath = path.join(f.root, batch, entry.previewFilename);
    const plan = write => {
        const context = openBatchRefresh(f.root, f.manifestPath, ['木棒.preview']);
        const updates = context.selected.map(file => ({ ...file, refreshed: refreshVanillaRecipeBlocks(file.text, updated) }));
        return finishBatchRefresh(context, updates, [added], write);
    };
    assert.equal(plan(false).dryRun, true);
    assert.equal(fs.readFileSync(previewPath, 'utf8'), original);
    const written = plan(true);
    assert.deepEqual(written.updated, [entry.previewFilename]);
    assert.deepEqual(written.added, ['任意木材.preview.md']);
    const text = fs.readFileSync(previewPath, 'utf8');
    assert.match(text, /### 舊分類\n##### Minecraft 原版\n<!-- preferred -->\n- \(Machine:: 工作台\)/);
    assert.match(text, /OAK_PLANKS[\s\S]*\[output:: 1\]\n- \[note:: 人工提示\]/);
    assert.match(text, /### 合成配方\n\n##### Minecraft 原版[\s\S]*\[output:: 4\]/);
    assert.match(text, /##### 其他\n- \(Machine:: 私人設備\)/);
    assert.match(text, /# 用途\n!\[\[圖\.png\]\]/);
    assert.doesNotMatch(text, /#未人工檢查/);
    assert.equal(refreshVanillaRecipeBlocks(text, updated), text);
    assert.equal(fs.readFileSync(path.join(f.root, batch, other.previewFilename), 'utf8'), item('piston'));
    assert.equal(fs.readFileSync(path.join(f.root, written.backup, entry.previewFilename), 'utf8'), original);
    assert.equal(fs.existsSync(path.join(f.root, added.record.targetPath)), false);
    assert.equal(openBatchRefresh(f.root, f.manifestPath, []).byIdentity.has('tag:minecraft:planks'), true);
});

test('batch template rename keeps distinct identities, rewrites exact links and preserves manual content', t => {
    const f = fixture(t);
    const coast = 'coast_armor_trim_smithing_template', bolt = 'bolt_armor_trim_smithing_template';
    const input = name => '### 合成配方\n- (Machine:: 工作台)\n- [item:: [[' +
        batch + '/' + name + '.preview|鍛造模板]]] (qty:: 1)\n- [output:: 2]\n\n# 用途\n![[圖片.png]]\n';
    const coastName = '鍛造模板--COAST', boltName = '鍛造模板';
    const source = item(coast, input(coastName));
    f.add(coast, coastName, source);
    f.add(bolt, boltName, item(bolt, input(boltName)));
    const armor = f.add('iron_chestplate', '鐵製胸甲', item('iron_chestplate', input(coastName)));
    f.save();
    const names = new Map([['minecraft:' + coast, '海岸盔甲紋樣'], ['minecraft:' + bolt, '鑲鉚盔甲紋樣']]);
    const rename = write => renameBatchTemplates(openBatchRefresh(f.root, f.manifestPath, []), names, write);
    assert.equal(rename(false).renamed.length, 2);
    assert.equal(fs.readFileSync(path.join(f.root, batch, coastName + '.preview.md'), 'utf8'), source);
    const result = rename(true);
    assert.equal(result.renamed.length, 2);
    assert.equal(fs.existsSync(path.join(f.root, batch, coastName + '.preview.md')), false);
    assert.equal(fs.readFileSync(path.join(f.root, result.backup, coastName + '.preview.md'), 'utf8'), source);
    const refreshed = openBatchRefresh(f.root, f.manifestPath, []);
    for (const [id, name] of names) {
        const entry = refreshed.byIdentity.get(id);
        const text = fs.readFileSync(path.join(f.root, batch, entry.previewFilename), 'utf8');
        assert.ok(text.includes('minecraft_id: ' + id + '\n'));
        assert.equal(entry.targetPath, 'MC-物品資料庫/' + name + '.md');
        assert.ok(text.includes('[[' + batch + '/' + name + '.preview|' + name + ']]'));
        assert.ok(text.includes('![[圖片.png]]'));
        assert.equal(entry.baselineSemantic, previewSemanticHash(text));
    }
    assert.equal(result.updated.includes(armor.previewFilename), true);
    assert.equal(rename(false).renamed.length, 0);
});

test('material report is outside the batch and only checked, verified Vanilla materials create Base previews', t => {
    const f = fixture(t);
    centralMapping(f);
    const language = path.join(f.root, '參考資料/Minecraft/zh_tw.json');
    fs.mkdirSync(path.dirname(language), { recursive: true });
    fs.writeFileSync(language, JSON.stringify({
        'block.minecraft.iron_ore': '鐵礦', 'block.minecraft.deepslate_iron_ore': '深板岩鐵礦',
        'item.minecraft.iron_dust': '鐵粉'
    }));
    const source = item('stick', '### 合成配方\n##### Minecraft 原版\n<!-- preferred -->\n- (Machine:: 工作台)\n' +
        '- [item:: 鐵礦] (qty:: 1)\n- [item:: 深板岩鐵礦] (qty:: 1)\n##### 海曼科技院\n' +
        '- (Machine:: 冶煉爐)\n- [item:: 鐵粉] (qty:: 1)\n');
    f.add('stick', '木棒', source); f.save();
    const options = { lookupVanilla: () => ({ verified: true, hasRecipes: false }) };
    const first = scanPublication(f.root, f.manifestPath, options);
    assert.equal(first.materialReport, 'MC-自動化BIO/preview/batch/test - 材料審核.md');
    const report = path.join(f.root, first.materialReport);
    const text = fs.readFileSync(report, 'utf8');
    assert.equal(text.split('\n')[0],
        '**' + ['READY', 'REVIEW', 'BLOCKED'].map(key => first.counts[key] + ' ' + key).join('、') + '**');
    assert.match(text, /- \[ \] 鐵礦 /);
    assert.match(text, /- \[ \] 深板岩鐵礦 /);
    assert.match(text, /- \[ \] 鐵粉 · 需人工處理/);
    fs.writeFileSync(report, text.replace('- [ ] 鐵礦 ', '- [x] 鐵礦 ').replace('- [ ] 鐵粉 ', '- [x] 鐵粉 '));
    const waiting = scanPublication(f.root, f.manifestPath, options);
    assert.deepEqual(waiting.basePreviews, []);
    const waitingText = fs.readFileSync(report, 'utf8');
    assert.match(waitingText, /- \[x\] 鐵礦 .*\n  - \n  - 待填取得方式/);
    fs.writeFileSync(report, waitingText.replace(
        /<!-- obsf:material-base minecraft:iron_ore -->\n  - /,
        '<!-- obsf:material-base minecraft:iron_ore -->\n  - 使用絲綢之觸挖掘鐵礦方塊。\n  - 從舊地圖採集。'));
    const second = scanPublication(f.root, f.manifestPath, options);
    assert.deepEqual(second.basePreviews, ['MC-自動化BIO/preview/material-base/鐵礦.preview.md']);
    const draftText = fs.readFileSync(path.join(f.root, second.basePreviews[0]), 'utf8');
    assert.match(draftText, /^minecraft_id: minecraft:iron_ore$/m);
    assert.match(draftText, /^publish_target: "MC-物品資料庫\/鐵礦\.md"$/m);
    assert.match(draftText, /^base_material: true$/m);
    assert.match(draftText, /^generated_by: minecraft-bio-publication-scan$/m);
    assert.doesNotMatch(draftText, /^#待補充$/m);
    assert.match(draftText, /^#需攻略補充$/m);
    assert.match(draftText, /\n\n# 用途\n\n- \n\n# 產物\n\n- \n$/);
    assert.match(draftText, /^- 外部取得：使用絲綢之觸挖掘鐵礦方塊。$/m);
    assert.match(draftText, /<!-- preferred -->\n- 外部取得：使用絲綢之觸挖掘鐵礦方塊。\n- 外部取得：從舊地圖採集。/);
    assert.equal([...draftText.matchAll(/^<!-- preferred -->$/gm)].length, 1);
    assert.doesNotMatch(draftText, /待填取得方式|工作台|MC-物品資料庫\/活塞\.md/);
    assert.ok(second.diagnostics.some(issue => issue.message === '深板岩鐵礦'));
    assert.ok(second.diagnostics.some(issue => issue.message === '鐵粉'));
    assert.match(fs.readFileSync(report, 'utf8'), /- \[x\] 鐵粉 · 需人工處理/);
    const preview = path.join(f.root, second.basePreviews[0]);
    fs.writeFileSync(preview, draftText.replace('generated_by: minecraft-bio-publication-scan\n', '').replace('#需攻略補充\n', '')
        .replace('# 用途\n\n- \n\n# 產物\n\n- \n', '# 用途\n\n- 人工補充\n'));
    const repaired = scanPublication(f.root, f.manifestPath, options);
    const repairedText = fs.readFileSync(preview, 'utf8');
    assert.match(repairedText, /^generated_by: minecraft-bio-publication-scan$/m);
    assert.doesNotMatch(repairedText, /^#(?:待補充|需攻略補充)$/m);
    assert.match(repairedText, /# 用途\n\n- 人工補充\n\n# 產物\n\n- \n$/);
    assert.equal(repaired.fingerprint, scanPublication(f.root, f.manifestPath, options).fingerprint);
    assert.equal(fs.readFileSync(preview, 'utf8'), repairedText);
    assert.equal(fs.existsSync(path.join(f.root, 'MC-物品資料庫/鐵礦.md')), false);
});

function draft(f, id, material, root = 'MC-自動化BIO/preview') {
    const name = root + '/mini/' + id + '.preview.md';
    const file = path.join(f.root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '---\ntype: sf-item\nid: ' + id +
        '\npreview_source: mini\npreview_mode: manual\npreview_evidence: manual\nprovider_id: hayman\nrecipe_provider: SF-海曼科技院\npublish_target: SF-海曼科技院/' + id + '.md\n---\n' +
        '# 合成/取得\n### 常規\n##### 海曼科技院\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: ' + material + '] (qty:: 1)\n- [output:: 1]\n');
    return file;
}

test('central scan validates Vanilla and Mini together, derives only Vanilla Base, and refuses edited reviewed candidates', t => {
    const f = fixture(t);
    centralMapping(f);
    f.add('stick', '木棒', item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n'));
    f.save();
    const mini = draft(f, 'HM_TEST', 'minecraft:stick');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /scan-publication/);
    const result = scanPublication(f.root, f.manifestPath);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.candidateCount, 2);
    assert.deepEqual(result.counts, { READY: 2, REVIEW: 0, BLOCKED: 0 });
    assert.equal(result.previousValidation, 'NONE');
    assert.match(fs.readFileSync(mini, 'utf8'), /^generated_by: obsf-mini-parser$/m);
    assert.equal(scanPublication(f.root, f.manifestPath).previousValidation, 'UNCHANGED');
    assert.equal(fs.existsSync(path.join(f.root, 'MC-物品資料庫/木棒.md')), false);
    const entries = preparePublication(f.root, f.manifestPath, { central: true }).entries;
    assert.match(entries[0].text, /^base_material: true$/m);
    assert.doesNotMatch(entries[1].text, /^base_material:/m);
    fs.appendFileSync(mini, '\n人工補充\n');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    assert.equal(fs.existsSync(path.join(f.root, 'SF-海曼科技院/HM_TEST.md')), false);
    const rescanned = scanPublication(f.root, f.manifestPath);
    assert.equal(rescanned.status, 'READY');
    assert.equal(rescanned.previousValidation, 'CHANGED');
    const published = publishBIOBatch(f.root, f.manifestPath, { central: true, write: true });
    assert.match(published.checkpoint, /^refs\/obsf\/bio-checkpoints\//);
    const official = fs.readFileSync(path.join(f.root, 'SF-海曼科技院/HM_TEST.md'), 'utf8');
    assert.match(official, /人工補充/);
    assert.match(official, /^generated_by: obsf-mini-parser$/m);
    assert.doesNotMatch(official, /^(?:base_material|preview_source|preview_mode|preview_evidence|publish_target):/m);
});

test('custom mc-tag uses the shared scan and publisher and requires resolvable members', t => {
    const f = fixture(t);
    centralMapping(f);
    f.add('stick', '木棒', item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n'));
    f.save();
    const draftPath = draft(f, 'ANY_STICK', 'minecraft:stick');
    const tag = [
        '---', 'type: mc-tag', 'id: ANY_STICK', 'preview_source: mini',
        'preview_mode: manual', 'preview_evidence: manual',
        'publish_target: SF-海曼科技院/ANY_STICK.md', '---', '',
        '# 合成/取得', '### Tag 代表材料', '<!-- preferred -->',
        '- [item:: WOODEN_MEMBER]', ''
    ].join('\n');
    fs.writeFileSync(draftPath, tag);
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'REVIEW');
    fs.writeFileSync(draftPath, tag.replace('WOODEN_MEMBER', 'minecraft:stick'));
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
    publishBIOBatch(f.root, f.manifestPath, { central: true, write: true });
    const official = fs.readFileSync(path.join(f.root, 'SF-海曼科技院/ANY_STICK.md'), 'utf8');
    assert.match(official, /^type: mc-tag$/m);
    assert.match(official, /<!-- preferred -->\n- \[item:: minecraft:stick\]/);
});

test('a confirmed missing raw ID survives publication and requires a fresh scan', t => {
    const f = fixture(t);
    centralMapping(f);
    f.save();
    const preview = draft(f, 'HM_TEST', 'IRON_DUST');
    const first = scanPublication(f.root, f.manifestPath);
    assert.equal(first.status, 'REVIEW');
    assert.deepEqual(first.counts, { READY: 0, REVIEW: 1, BLOCKED: 0 });
    assert.equal(first.diagnostics[0].code, 'RAW_ID_REVIEW');
    const report = path.join(f.root, first.materialReport);
    const initial = fs.readFileSync(report, 'utf8');
    assert.match(initial, /保留原始 ID `IRON_DUST`/);
    fs.writeFileSync(report, initial.replace('- [ ] [RAW_ID_REVIEW]', '- [x] [RAW_ID_REVIEW]'));
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
    fs.appendFileSync(preview, '\n人工補充\n');
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'REVIEW');
    fs.writeFileSync(report, fs.readFileSync(report, 'utf8').replace('- [ ] [RAW_ID_REVIEW]', '- [x] [RAW_ID_REVIEW]'));
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
    publishBIOBatch(f.root, f.manifestPath, { central: true, write: true });
    assert.match(fs.readFileSync(path.join(f.root, 'SF-海曼科技院/HM_TEST.md'), 'utf8'), /\[item:: IRON_DUST\]/);
});

test('ambiguous material references list candidates and cannot be approved as raw IDs', t => {
    const f = fixture(t);
    centralMapping(f);
    f.save();
    draft(f, 'HM_TEST', 'IRON_DUST');
    for (const [id, name] of [['first_supply', '第一材料'], ['second_supply', '第二材料']]) {
        const text = item(id, '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n');
        fs.writeFileSync(path.join(f.root, 'MC-物品資料庫', name + '.md'), text.replace('minecraft_id:', 'aliases: ["IRON_DUST"]\nminecraft_id:'));
    }
    const result = scanPublication(f.root, f.manifestPath);
    assert.equal(result.status, 'BLOCKED');
    const ambiguous = result.diagnostics.find(issue => issue.code === 'AMBIGUOUS_MATERIAL');
    assert.equal(ambiguous.matches.length, 2);
    const report = fs.readFileSync(path.join(f.root, result.materialReport), 'utf8');
    assert.match(report, /候選 BIO.*第一材料\.md/);
    assert.match(report, /候選 BIO.*第二材料\.md/);
    assert.doesNotMatch(report, /obsf:accept-raw-id/);
});

test('any active review tag blocks publication and SCAN never restores removed tags', t => {
    const f = fixture(t);
    centralMapping(f);
    const route = '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n';
    const approved = item('stick', route).replace('id: STICK\n', 'id: STICK\ntags: [需攻略補充]\n')
        + '\n# 用途\n`#待補充` 是範例。\n';
    const entry = f.add('stick', '木棒', approved, item('stick', route) + '\n#待補充\n');
    f.save();
    const preview = path.join(f.root, batch, entry.previewFilename);
    for (const marker of [
        { tag: '#待補充', text: approved + '\n#待補充 <!-- 審查中 -->\n' },
        { tag: '#未人工檢查', text: approved.replace('tags: [需攻略補充]', 'tags: [需攻略補充, 未人工檢查]') },
        { tag: '#更新需人工解析', text: approved.replace('tags: [需攻略補充]', 'tags:\n  - 需攻略補充\n  - 更新需人工解析') }
    ]) {
        fs.writeFileSync(preview, marker.text);
        const scan = scanPublication(f.root, f.manifestPath);
        assert.equal(scan.status, 'BLOCKED');
        const issue = scan.diagnostics.find(issue => issue.code === 'PUBLICATION_TAG_BLOCKED');
        assert.deepEqual(issue.tags, [marker.tag]);
        assert.equal(issue.approvalKey, undefined);
        const report = path.join(f.root, scan.materialReport);
        const markdown = fs.readFileSync(report, 'utf8');
        assert.match(markdown, /^- \[ \] \[PUBLICATION_TAG_BLOCKED\].*obsf:tag-progress /m);
        assert.ok(markdown.includes('[[' + batch + '/木棒.preview|木棒.preview.md]]'));
        fs.writeFileSync(report, markdown.replace('- [ ] [PUBLICATION_TAG_BLOCKED]', '- [x] [PUBLICATION_TAG_BLOCKED]'));
        const rescanned = scanPublication(f.root, f.manifestPath);
        assert.equal(rescanned.status, 'BLOCKED');
        assert.equal(rescanned.previousValidation, 'UNCHANGED');
        assert.match(fs.readFileSync(report, 'utf8'), /^- \[x\] \[PUBLICATION_TAG_BLOCKED\]/m);
        assert.equal(fs.readFileSync(preview, 'utf8'), marker.text);
        assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    }
    fs.writeFileSync(preview, approved);
    const finalScan = scanPublication(f.root, f.manifestPath);
    assert.equal(finalScan.status, 'READY', JSON.stringify(finalScan, null, 2));
    assert.doesNotMatch(fs.readFileSync(path.join(f.root, finalScan.materialReport), 'utf8'), /\[PUBLICATION_TAG_BLOCKED\]/);
    publishBIOBatch(f.root, f.manifestPath, { central: true, write: true });
    const official = fs.readFileSync(path.join(f.root, entry.targetPath), 'utf8');
    assert.match(official, /^tags: \[需攻略補充\]$/m);
    assert.doesNotMatch(official, /^#(?:待補充|未人工檢查|更新需人工解析)$/m);
});

test('SCAN stops discovering problems at the issue limit before reading later candidates', t => {
    const f = fixture(t);
    centralMapping(f);
    const route = '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n';
    f.add('stick', '木棒', item('stick', route) + '\n#待補充\n');
    f.add('piston', '活塞', item('piston', route) + '\n#未人工檢查\n');
    const later = f.add('redstone', '紅石', item('redstone', route));
    f.save();
    const laterPreview = path.join(f.root, batch, later.previewFilename);
    fs.writeFileSync(laterPreview, 'invalid preview');
    const limited = scanPublication(f.root, f.manifestPath, { issueLimit: 2 });
    assert.equal(limited.status, 'BLOCKED');
    assert.equal(limited.issueLimitReached, 2);
    assert.deepEqual(limited.diagnostics.map(issue => issue.code), ['PUBLICATION_TAG_BLOCKED', 'PUBLICATION_TAG_BLOCKED']);
    assert.match(fs.readFileSync(path.join(f.root, limited.materialReport), 'utf8'), /掃描提前停止/);
    assert.equal(scanPublication(f.root, f.manifestPath, { issueLimit: 3 }).preflightBlocked, true);
    fs.writeFileSync(laterPreview, item('redstone', route));
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
});

test('SCAN continues past approved raw IDs to discover the next issues', t => {
    const f = fixture(t);
    centralMapping(f);
    f.save();
    const preview = draft(f, 'HM_TEST', 'FIRST_RAW');
    const text = fs.readFileSync(preview, 'utf8').replace('preview_source:', 'generated_by: obsf-mini-parser\npreview_source:')
        .replace('- [output:: 1]', '- [item:: SECOND_RAW] (qty:: 1)\n- [item:: THIRD_RAW] (qty:: 1)\n- [output:: 1]');
    fs.writeFileSync(preview, text);
    const limited = scanPublication(f.root, f.manifestPath, { issueLimit: 2 });
    assert.equal(limited.issueLimitReached, 2);
    assert.deepEqual(limited.diagnostics.map(issue => issue.message), ['FIRST_RAW', 'SECOND_RAW']);
    const report = path.join(f.root, limited.materialReport);
    const mark = () => fs.writeFileSync(report, fs.readFileSync(report, 'utf8').replaceAll('- [ ] [RAW_ID_REVIEW]', '- [x] [RAW_ID_REVIEW]'));
    mark();
    const next = scanPublication(f.root, f.manifestPath, { issueLimit: 2 });
    assert.equal(next.status, 'REVIEW');
    assert.deepEqual(next.diagnostics.map(issue => issue.message), ['THIRD_RAW']);
    assert.equal(next.approvedIssues.length, 2);
    mark();
    assert.equal(scanPublication(f.root, f.manifestPath, { issueLimit: 2 }).status, 'READY');
});

test('central scan compares updated official files with the edited preview without altering either or the manifest', t => {
    const f = fixture(t);
    centralMapping(f);
    const old = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n').replace('id: STICK\n', 'id: STICK\nlevel: -1\n');
    const edited = old.replace('level: -1', 'level: 0');
    const entry = f.add('stick', '木棒', edited, old);
    f.save();
    const formal = path.join(f.root, entry.targetPath);
    const preview = path.join(f.root, batch, entry.previewFilename);
    const manifest = path.join(f.root, f.manifestPath);
    const manifestBefore = fs.readFileSync(manifest, 'utf8');
    fs.writeFileSync(formal, edited);
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
    assert.equal(fs.readFileSync(preview, 'utf8'), edited);
    assert.equal(fs.readFileSync(formal, 'utf8'), edited);
    assert.equal(fs.readFileSync(manifest, 'utf8'), manifestBefore);

    fs.appendFileSync(formal, '\n');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    assert.equal(scanPublication(f.root, f.manifestPath).previousValidation, 'CHANGED');

    fs.appendFileSync(formal, '正式檔新增備註\n');
    const blocked = scanPublication(f.root, f.manifestPath);
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.diagnostics[0].code, 'PREVIEW_CONTENT_MISSING');
    assert.equal(blocked.diagnostics[0].sourceLine, fs.readFileSync(formal, 'utf8').split('\n').indexOf('正式檔新增備註') + 1);
    assert.ok(blocked.diagnostics[0].nearLine > 0);
    assert.equal(fs.readFileSync(preview, 'utf8'), edited);
    fs.appendFileSync(preview, '\n正式檔新增備註\n');
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
});

test('accepted Preview differences disappear from the checklist and expire when the Preview changes', t => {
    const f = fixture(t);
    centralMapping(f);
    const draftText = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n\n# 用途\n');
    const original = draftText + '人工說明甲\n人工說明乙\n';
    const entry = f.add('stick', '木棒', draftText, original, { status: 'REVIEW' });
    f.save();
    const first = scanPublication(f.root, f.manifestPath);
    const missing = first.diagnostics.filter(issue => issue.code === 'PREVIEW_CONTENT_MISSING');
    assert.equal(missing.length, 2);
    assert.ok(missing.every(issue => issue.approvalKey));
    const report = path.join(f.root, first.materialReport);
    const markdown = fs.readFileSync(report, 'utf8');
    assert.ok(markdown.includes('[[' + batch + '/木棒.preview|' + entry.previewFilename + ']]'));
    assert.ok(markdown.includes('[[MC-物品資料庫/木棒|木棒.md]]:' + missing[0].sourceLine));
    const mark = only => {
        const text = fs.readFileSync(report, 'utf8').replace(/^(- )\[ \]( .*obsf:accept-preview .*)$/gm,
            (line, prefix, remainder) => !only || remainder.includes(only) ? prefix + '[x]' + remainder : line);
        fs.writeFileSync(report, text);
    };
    mark('人工說明甲');
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'BLOCKED');
    const partial = fs.readFileSync(report, 'utf8');
    assert.doesNotMatch(partial, /\[PREVIEW_CONTENT_MISSING\].*人工說明甲/);
    assert.match(partial, /\[PREVIEW_CONTENT_MISSING\].*人工說明乙/);
    mark('PREVIEW_CONTENT_MISSING');
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'REVIEW');
    const pendingOverwrite = fs.readFileSync(report, 'utf8');
    assert.doesNotMatch(pendingOverwrite, /\[PREVIEW_CONTENT_MISSING\]/);
    assert.match(pendingOverwrite, /^- \[ \] \[REVIEW_REQUIRED\]/m);
    assert.equal([...pendingOverwrite.matchAll(/<!-- obsf:approved-missing-content /g)].length, 2);
    mark('REVIEW_REQUIRED');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    const accepted = scanPublication(f.root, f.manifestPath);
    assert.equal(accepted.status, 'READY');
    assert.equal(accepted.approvedIssues.length, 3);
    assert.equal(scanPublication(f.root, f.manifestPath).previousValidation, 'UNCHANGED');
    assert.equal(fs.readFileSync(path.join(f.root, entry.targetPath), 'utf8'), original);
    fs.appendFileSync(path.join(f.root, batch, entry.previewFilename), '新預覽內容\n');
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'BLOCKED');
    assert.match(fs.readFileSync(report, 'utf8'), /^- \[ \] \[PREVIEW_CONTENT_MISSING\]/m);
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
});

test('central scan inherits official timestamps and still locates other YAML conflicts in both files', t => {
    const f = fixture(t);
    centralMapping(f);
    const old = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n')
        .replace('id: STICK\n', 'id: STICK\nupdated: 2026-11-18 12:00\ncreated: "2026-11-17 12:00"\nsource_note: 手動\n');
    const entry = f.add('stick', '木棒', old, old);
    const piston = item('piston', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n');
    f.add('piston', '活塞', piston.replace('id: PISTON\n', 'id: PISTON\ncreated: 2026-11-21 12:00\n'), piston);
    f.save();
    const formal = path.join(f.root, entry.targetPath);
    const preview = path.join(f.root, batch, entry.previewFilename);
    const latest = old.replace('updated: 2026-11-18', 'updated: 2026-11-20');
    fs.writeFileSync(formal, latest);
    for (const edited of [old.replace('2026-11-17', '2026-11-16'), old.replace(/^created:.*\n/m, '')]) {
        fs.writeFileSync(preview, edited);
        const result = scanPublication(f.root, f.manifestPath);
        assert.equal(result.status, 'READY', JSON.stringify(result.diagnostics, null, 2));
        const entries = preparePublication(f.root, f.manifestPath, { central: true }).entries;
        assert.match(entries[0].text, /^updated: 2026-11-20 12:00$/m);
        assert.match(entries[0].text, /^created: "2026-11-17 12:00"$/m);
        assert.match(entries[1].text, /^created: 2026-11-21 12:00$/m);
        assert.equal(fs.readFileSync(preview, 'utf8'), edited);
        assert.equal(fs.readFileSync(formal, 'utf8'), latest);
    }
    fs.writeFileSync(preview, old.replace('source_note: 手動', 'source_note: 自動'));
    const report = scanPublication(f.root, f.manifestPath);
    assert.equal(report.status, 'BLOCKED');
    const issue = report.diagnostics.find(value => value.code === 'YAML_DIFF');
    assert.equal(issue.field, 'source_note');
    assert.equal(issue.path, batch + '/' + entry.previewFilename);
    assert.equal(issue.line, 6);
    assert.equal(issue.sourcePath, entry.targetPath);
    assert.equal(issue.sourceLine, 6);
});

test('central scan blocks equipment cycles with full paths and publisher refuses them', t => {
    const f = fixture(t);
    centralMapping(f);
    const target = f.add('end_crystal', '終界水晶', item('end_crystal',
        '### 合成配方\n<!-- preferred -->\n- (Machine:: [[工作台]])\n- [item:: [[原木]]] (qty:: 1)\n'));
    const formal = (name, text) => fs.writeFileSync(path.join(f.root, 'MC-物品資料庫', name + '.md'), text);
    formal('工作台', item('crafting_table', '### 合成配方\n<!-- preferred -->\n- (Machine:: 無/從背包合成)\n- [item:: [[任意木材]]] (qty:: 4)\n'));
    formal('任意木材', '---\ntype: mc-tag\nid: PLANKS\nminecraft_tag: minecraft:planks\n---\n### Tag 代表材料\n<!-- preferred -->\n- [item:: [[橡木材]]]\n');
    const planks = item('oak_planks', '### 合成配方\n<!-- preferred -->\n- (Machine:: [[工作台]])\n- [item:: [[原木]]] (qty:: 1)\n- [output:: 4]\n');
    formal('橡木材', planks);
    formal('原木', item('oak_log', '### 外部取得\n<!-- preferred -->\n- 採集：森林。\n'));
    f.save();
    const first = scanPublication(f.root, f.manifestPath);
    assert.equal(first.status, 'BLOCKED');
    const issue = first.diagnostics.find(issue => issue.code === 'EQUIPMENT_DEPENDENCY_CYCLE');
    assert.equal(issue.path, target.targetPath);
    assert.deepEqual(issue.cycle, ['MC-物品資料庫/工作台.md', 'MC-物品資料庫/任意木材.md', 'MC-物品資料庫/橡木材.md', 'MC-物品資料庫/工作台.md']);
    assert.match(fs.readFileSync(path.join(f.root, first.materialReport), 'utf8'), /EQUIPMENT_DEPENDENCY_CYCLE.*橡木材/);
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
    assert.equal(fs.existsSync(path.join(f.root, target.targetPath)), false);
    formal('橡木材', planks.replace('(Machine:: [[工作台]])', '(Machine:: 無/手動)'));
    assert.equal(scanPublication(f.root, f.manifestPath).status, 'READY');
    assert.equal(publishBIOBatch(f.root, f.manifestPath, { central: true }).dryRun, true);
    // Changing equipment after a READY scan invalidates the publication snapshot.
    formal('橡木材', planks);
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { central: true, write: true }), /重新執行 scan-publication/);
});

test('central scan blocks missing, ambiguous and route-less equipment', t => {
    const f = fixture(t);
    centralMapping(f);
    f.add('stick', '木棒', item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: [[未知設備]])\n- [item:: [[原木]]] (qty:: 1)\n'));
    fs.writeFileSync(path.join(f.root, 'MC-物品資料庫/原木.md'), item('oak_log', '### 外部取得\n<!-- preferred -->\n- 採集：森林。\n'));
    f.save();
    assert.ok(scanPublication(f.root, f.manifestPath).diagnostics.some(issue => issue.code === 'UNRESOLVED_MACHINE'));
    const machine = path.join(f.root, 'MC-物品資料庫/設備甲.md');
    fs.writeFileSync(machine, item('stone').replace('id: STONE\n', 'id: STONE\naliases:\n  - 未知設備\n'));
    assert.ok(scanPublication(f.root, f.manifestPath).diagnostics.some(issue => issue.code === 'INVALID_MACHINE_RECIPE'));
    fs.writeFileSync(path.join(f.root, 'MC-物品資料庫/設備乙.md'), item('dirt').replace('id: DIRT\n', 'id: DIRT\naliases:\n  - 未知設備\n'));
    assert.ok(scanPublication(f.root, f.manifestPath).diagnostics.some(issue => issue.code === 'AMBIGUOUS_MACHINE'));
});

test('central scan reports duplicate identity, multi-preferred and cycles without writing official BIOs', t => {
    const f = fixture(t);
    centralMapping(f);
    const vanilla = f.add('stick', '木棒', item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: HM_TEST] (qty:: 1)\n'));
    f.save();
    const mini = draft(f, 'HM_TEST', 'minecraft:stick');
    let result = scanPublication(f.root, f.manifestPath);
    assert.equal(result.status, 'BLOCKED');
    const dependency = result.diagnostics.find(issue => issue.code === 'DEPENDENCY_BLOCKED' && issue.path === vanilla.targetPath);
    assert.equal(dependency?.previewPath, batch + '/' + vanilla.previewFilename);
    fs.appendFileSync(mini, '\n<!-- preferred -->\n');
    result = scanPublication(f.root, f.manifestPath);
    assert.ok(result.diagnostics.some(item => item.code === 'PREFERRED_REQUIRED'));
    fs.writeFileSync(mini.replace('HM_TEST.preview.md', 'duplicate.preview.md'), fs.readFileSync(mini, 'utf8').replace('HM_TEST.md', 'duplicate.md'));
    result = scanPublication(f.root, f.manifestPath);
    assert.ok(result.diagnostics.some(item => item.code === 'PREFLIGHT_BLOCKED' && /重複/.test(item.message)));
    assert.equal(fs.existsSync(path.join(f.root, vanilla.targetPath)), false);
});
const item = (id, body = '') => `---\ntype: mc-item\nid: ${id.toUpperCase()}\nminecraft_id: minecraft:${id}\n---\n\n# 合成/取得\n${body}`;
function git(root, ...args) {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.error?.message || run.stderr);
    return run.stdout.trim();
}
function fixture(t, batchDirectory = batch) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obsf-bio-publication-test-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('obsf-bio-publication-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'MC-物品資料庫'));
    fs.mkdirSync(path.join(root, batchDirectory), { recursive: true });
    git(root, 'init', '-b', 'codex/test');
    git(root, 'config', 'user.name', 'BIO test'); git(root, 'config', 'user.email', 'bio@example.invalid');
    git(root, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(root, 'sentinel.txt'), 'HEAD');
    git(root, 'add', 'sentinel.txt'); git(root, 'commit', '-m', 'fixture');
    const records = [];
    const add = (id, filename, text, original = null, extra = {}) => {
        const previewFilename = filename + '.preview.md', targetPath = 'MC-物品資料庫/' + filename + '.md';
        fs.writeFileSync(path.join(root, batchDirectory, previewFilename), text);
        if (original !== null) fs.writeFileSync(path.join(root, targetPath), original);
        const record = { identity: 'minecraft:' + id, kind: 'item', targetPath, sourcePath: original !== null ? targetPath : null,
            previewFilename, linkFilenames: [previewFilename], baselineSemantic: previewSemanticHash(text),
            baselineWithoutPreferred: previewSemanticHash(text, { ignorePreferred: true }),
            status: original !== null ? 'ADDITIVE_UPDATE' : 'NEW', approved: false, ...extra };
        records.push(record); return record;
    };
    const manifestPath = batchDirectory + '/BIO Publication.json';
    const save = () => fs.writeFileSync(path.join(root, manifestPath), JSON.stringify(publicationManifest(root, path.join(root, batchDirectory), records)));
    return { root, records, add, save, manifestPath };
}

test('publication identity accepts scanner entries and frontmatter with canonical identity priority', () => {
    assert.equal(identity({ minecraft_id: 'minecraft:oak_planks', id: 'OLD_PLANKS' }), 'minecraft:oak_planks');
    assert.equal(identity({ normalizedId: 'minecraft:oak_planks', legacyId: 'OLD_PLANKS' }), 'minecraft:oak_planks');
    assert.equal(identity({ id: 'STICK' }), 'minecraft:stick');
    assert.equal(identity({ legacyId: 'STICK' }), 'minecraft:stick');
    assert.equal(identity({ normalizedId: null, legacyId: 'PLANKS', tag_identity: 'minecraft:item_tag', minecraft_tag: 'minecraft:planks' }), 'tag:minecraft:planks');
    assert.equal(identity({ normalizedId: null, legacyId: 'ANY_WOOL', tag_identity: 'obsf:derived_ingredient_group', derived_group: 'obsf:color_family/wool' }), 'group:obsf:color_family/wool');
});

test('formalization rewrites links and choices but preserves images and code examples', () => {
    const source = `- [item:: [[${batch}/a.preview|A]]] (qty:: 2)\n` +
        `<!-- obsf:choices {"defaultName":"${batch}/a.preview","choices":[{"name":"${batch}/a.preview"}]} -->\n` +
        `![[${batch}/image.png]]\n\`\`\`md\n[[${batch}/a.preview]]\n\`\`\`\n`;
    const output = formalizePreview(source, new Map([[batch + '/a.preview', 'MC-物品資料庫/A']]));
    assert.match(output, /\[\[MC-物品資料庫\/A\|A\]\]/);
    assert.match(output, /"defaultName":"MC-物品資料庫\/A"/);
    assert.match(output, /!\[\[MC-自動化BIO\/preview\/batch\/test\/image.png\]\]/);
    assert.ok(output.includes('```md\n[[' + batch + '/a.preview]]'));
});

test('batch dry-run permits editable drop type and formatting without writing any BIO', t => {
    const f = fixture(t), text = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：測試。\n');
    const record = f.add('stick', '木棒', text); f.save();
    fs.writeFileSync(path.join(f.root, batch, record.previewFilename), text.replace('mc-item', 'mc-drop').replace('### 外部取得', '\n### 外部取得\n'));
    const result = publishBIOBatch(f.root, f.manifestPath);
    assert.equal(result.dryRun, true); assert.equal(result.changed, 1);
    assert.equal(fs.existsSync(path.join(f.root, record.targetPath)), false);
    assert.equal(git(f.root, 'for-each-ref', '--format=%(refname)', 'refs/obsf'), '');
});

test('publication creates linked item, drop and Tag, with a verified checkpoint and unchanged real index', t => {
    const f = fixture(t);
    const stick = f.add('stick', '木棒', item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n'));
    const tagText = `---\ntype: mc-tag\nid: ANY_STICK\nminecraft_tag: minecraft:test_sticks\ntag_identity: minecraft:item_tag\n---\n\n### Tag 代表材料\n<!-- preferred -->\n- [item:: [[${batch}/木棒.preview|木棒]]]\n`;
    f.add('test_sticks', '任意木棒', tagText, null, { identity: 'tag:minecraft:test_sticks', kind: 'tag', values: ['minecraft:stick'] });
    f.add('piston', '活塞', item('piston', `### 合成配方\n<!-- preferred -->\n- (Machine:: [[工作台]])\n\t- [item:: [[${batch}/木棒.preview|木棒]]] (qty:: 2)\n\t- [output:: 1]\n`));
    f.save();
    fs.writeFileSync(path.join(f.root, batch, stick.previewFilename), fs.readFileSync(path.join(f.root, batch, stick.previewFilename), 'utf8').replace('mc-item', 'mc-drop'));
    fs.writeFileSync(path.join(f.root, 'sentinel.txt'), 'staged unrelated'); git(f.root, 'add', 'sentinel.txt');
    const staged = git(f.root, 'write-tree'), head = git(f.root, 'rev-parse', 'HEAD');
    const result = publishBIOBatch(f.root, f.manifestPath, { write: true });
    assert.equal(result.changed, 3); assert.equal(result.dryRun, false);
    assert.equal(git(f.root, 'write-tree'), staged); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
    assert.match(result.checkpoint, /^refs\/obsf\/bio-checkpoints\//);
    const actual = fs.readFileSync(path.join(f.root, 'MC-物品資料庫/活塞.md'), 'utf8');
    assert.match(actual, /\[drop:: \[\[MC-物品資料庫\/木棒\|木棒\]\]\]/);
    assert.doesNotMatch(actual, /\.preview/);
    assert.match(actual, /^created: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\nupdated: \1$/m);
    const previewText = fs.readFileSync(path.join(f.root, batch, stick.previewFilename), 'utf8');
    assert.doesNotMatch(previewText, /^(?:created|updated):/m);
    const receipt = JSON.parse(fs.readFileSync(path.join(f.root, result.receipt), 'utf8'));
    assert.equal(receipt.status, 'COMPLETE'); assert.ok(receipt.files.every(file => file.created && file.written));
    for (const file of receipt.files) {
        const bytes = fs.readFileSync(path.join(f.root, file.path));
        assert.equal(file.candidateSHA256, createHash('sha256').update(bytes).digest('hex'));
        assert.notEqual(file.reviewedCandidateSHA256, file.candidateSHA256);
    }
});

test('archive compresses the verified batch and published drafts from the Chinese Preview folder', t => {
    const root = '@自動化BIO Preview';
    const f = fixture(t, root + '/batch/test');
    centralMapping(f);
    f.add('stick', '木棒', item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n'));
    f.save();
    const publishedDraft = draft(f, 'HM_PUBLISHED', 'minecraft:stick', root);
    assert.equal(selectPublicationManifest(f.root), f.manifestPath);
    const scan = scanPublication(f.root, f.manifestPath);
    assert.equal(scan.status, 'READY');
    const publication = publishBIOBatch(f.root, f.manifestPath, { central: true, write: true });
    const unpublished = draft(f, 'HM_UNPUBLISHED', 'minecraft:stick', root);
    const original = fs.readFileSync(publishedDraft);
    const plan = archivePublication(f.root, f.manifestPath);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.standalonePreviews, 1);
    assert.equal(fs.existsSync(path.join(f.root, plan.archive)), false);
    fs.appendFileSync(publishedDraft, '\n發布後新增\n');
    assert.throws(() => archivePublication(f.root, f.manifestPath, true), /在發布後已變更/);
    fs.writeFileSync(publishedDraft, original);
    const result = archivePublication(f.root, f.manifestPath, true);
    assert.equal(result.dryRun, false);
    assert.match(result.archive, /^review\/bio-published-previews\/[^/]+\.zip$/);
    const zip = fs.readFileSync(path.join(f.root, result.archive));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    for (const file of [f.manifestPath, scan.materialReport, path.relative(f.root, publishedDraft),
        root + '/batch/test/木棒.preview.md']) {
        assert.equal(fs.existsSync(path.join(f.root, file)), false);
        assert.ok(zip.includes(Buffer.from(file.split(path.sep).join('/'), 'utf8')));
    }
    assert.ok(fs.existsSync(unpublished));
    assert.ok(result.removedEmptyFolders.includes(root + '/batch'));
    assert.equal(fs.existsSync(path.join(f.root, root, 'batch')), false);
    assert.ok(fs.existsSync(path.join(f.root, root)));
    assert.ok(fs.existsSync(path.join(f.root, publication.receipt)));
    assert.ok(fs.existsSync(path.join(f.root, 'MC-物品資料庫/木棒.md')));
});

test('updating an existing uncommitted BIO preserves pictures and notes in both target and checkpoint', t => {
    const f = fixture(t);
    const original = item('iron_ingot', '### 外部取得\n<!-- preferred -->\n- 採集：測試。\n\n![[image.png]]\n人工筆記\n')
        .replace('id: IRON_INGOT\n', 'id: IRON_INGOT\ncreated: "2026-08-08 11:22:33"\nupdated: 2026-08-08 12:00:00\n');
    f.add('iron_ingot', '鐵錠', original + '\n附加說明\n', original); f.save();
    const result = publishBIOBatch(f.root, f.manifestPath, { write: true });
    assert.equal(git(f.root, 'show', result.checkpoint + ':MC-物品資料庫/鐵錠.md'), original.trim());
    const actual = fs.readFileSync(path.join(f.root, 'MC-物品資料庫/鐵錠.md'), 'utf8');
    assert.ok(actual.includes('![[image.png]]\n人工筆記'));
    assert.match(actual, /^created: "2026-08-08 11:22:33"$/m);
    assert.match(actual, /^updated: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/m);
    assert.doesNotMatch(actual, /^updated: 2026-08-08 12:00:00$/m);
    assert.doesNotMatch(actual, /^#更新需人工解析$/m);
});

test('stale sources and edited recipe quantities fail whole-batch preflight before any write', t => {
    const f = fixture(t), original = item('stick', '### 外部取得\n- 採集：拾取。\n');
    f.add('stick', '木棒', original, original);
    const piston = f.add('piston', '活塞', item('piston', '### 合成配方\n- (Machine:: 工作台)\n- [item:: 木棒] (qty:: 2)\n- [output:: 1]\n'));
    f.save(); fs.appendFileSync(path.join(f.root, 'MC-物品資料庫/木棒.md'), 'external edit');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { write: true }), /正式 BIO 已變更/);
    fs.writeFileSync(path.join(f.root, 'MC-物品資料庫/木棒.md'), original);
    const filename = path.join(f.root, batch, piston.previewFilename);
    fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('qty:: 2', 'qty:: 3'));
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { write: true }), /配方語意已變更/);
    assert.equal(fs.existsSync(path.join(f.root, piston.targetPath)), false);
    assert.equal(git(f.root, 'for-each-ref', '--format=%(refname)', 'refs/obsf'), '');
});

test('REVIEW is explicit, and skip-review cannot leave a published route pointing to an absent new BIO', t => {
    const f = fixture(t);
    f.add('stick', '木棒', item('stick'), null, { status: 'REVIEW' });
    f.add('piston', '活塞', item('piston', `### 合成配方\n- (Machine:: 工作台)\n- [item:: [[${batch}/木棒.preview]]] (qty:: 1)\n`));
    f.save();
    assert.throws(() => preparePublication(f.root, f.manifestPath), /REVIEW 尚未確認/);
    assert.throws(() => preparePublication(f.root, f.manifestPath, { skipReview: true }), /被略過/);
});

test('new-file collisions, source-data changes and main-branch writes are blocked', t => {
    const f = fixture(t), record = f.add('stick', '木棒', item('stick')); f.save();
    fs.writeFileSync(path.join(f.root, record.targetPath), 'someone else');
    assert.throws(() => preparePublication(f.root, f.manifestPath), /新 BIO 已存在/);
    fs.unlinkSync(path.join(f.root, record.targetPath));
    fs.writeFileSync(path.join(f.root, 'Minecraft Review Decisions.json'), '{}');
    assert.throws(() => preparePublication(f.root, f.manifestPath), /來源／決策／Mapping 已變更/);
    fs.unlinkSync(path.join(f.root, 'Minecraft Review Decisions.json'));
    git(f.root, 'branch', '-m', 'main');
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { write: true }), /禁止在 main/);
    assert.equal(fs.existsSync(path.join(f.root, record.targetPath)), false);
});

test('renamed Recipe Mapping Draft changes invalidate a prepared publication', t => {
    const f = fixture(t);
    f.add('stick', '木棒', item('stick')); f.save();
    fs.writeFileSync(path.join(f.root, 'Recipe Mapping Draft.md'), '| provider | machine | section | enabled |\n| --- | --- | --- | --- |\n| | 工作台 | 常規 | true |\n');
    assert.throws(() => preparePublication(f.root, f.manifestPath), /來源／決策／Mapping 已變更/);
});

test('a corrupt last preview and deleted manual image prevent every earlier eligible write', t => {
    const f = fixture(t);
    f.add('stick', '木棒', item('stick'));
    const original = item('iron_ingot', '### 外部取得\n- 採集：測試。\n![[important.png]]\n手寫內容\n');
    f.add('iron_ingot', '鐵錠', original.replace('![[important.png]]\n', ''), original); f.save();
    assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { write: true }), /更新預覽未保留目前正式 BIO/);
    assert.equal(fs.existsSync(path.join(f.root, 'MC-物品資料庫/木棒.md')), false);
    assert.equal(fs.readFileSync(path.join(f.root, 'MC-物品資料庫/鐵錠.md'), 'utf8'), original);
});

test('a write failure records the partial batch and leaves the old file and checkpoint recoverable', t => {
    const f = fixture(t);
    f.add('stick', '木棒', item('stick'));
    const original = item('iron_ingot', '### 外部取得\n- 採集：測試。\n');
    f.add('iron_ingot', '鐵錠', original + '\n人工追加\n', original); f.save();
    const target = path.join(f.root, 'MC-物品資料庫/鐵錠.md'), rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (to === target) throw new Error('simulated locked file'); return rename(from, to); };
    try { assert.throws(() => publishBIOBatch(f.root, f.manifestPath, { write: true }), /simulated locked file.*還原點/); }
    finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.existsSync(path.join(f.root, 'MC-物品資料庫/木棒.md')), true);
    const directory = path.join(f.root, 'review/bio-publications');
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'));
    assert.equal(receipt.status, 'FAILED');
    assert.deepEqual(receipt.files.map(file => file.written), [true, false]);
    assert.equal(git(f.root, 'show', receipt.ref + ':MC-物品資料庫/鐵錠.md'), original.trim());
});

test('changing id while retaining minecraft_id is not treated as a type-only edit', t => {
    const f = fixture(t), record = f.add('stick', '木棒', item('stick')); f.save();
    const preview = path.join(f.root, batch, record.previewFilename);
    fs.writeFileSync(preview, fs.readFileSync(preview, 'utf8').replace('id: STICK', 'id: SOME_OTHER_ITEM'));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /配方語意已變更/);
});

test('an existing editable preview can merge recipe headings, remove empty categories and restyle yield without regeneration', t => {
    const f = fixture(t);
    const first = '### 合成配方\n\n##### Minecraft 原版\n\n<!-- preferred -->\n' +
        '- **生產設備**：(Machine:: [[工作台]])\n\t**合成所需**：\n\t- [item:: 任意木材] (qty:: 2)\n\t**批產量**：[output:: 4]\n';
    const empty = '\n### 液體\n\n### 無限附加\n\n### 煉金術自傳-煉金術\n\n';
    const second = '### 合成配方\n\n##### Minecraft 原版\n\n' +
        '- **生產設備**：(Machine:: [[工作台]])\n\t**合成所需**：\n\t- [item:: 竹子] (qty:: 2)\n\t- [output:: 1]\n';
    const manual = '\n# 用途\n\n![[木棒.png]]\n人工用途說明\n';
    const original = item('stick', first + empty + second + manual);
    const entry = f.add('stick', '木棒', original, original); f.save();
    const editedBody = first.replace('**批產量**：', '- ') + second.replace('### 合成配方\n\n##### Minecraft 原版\n\n', '') + manual;
    const edited = item('stick', editedBody);
    assert.equal(previewSemanticHash(original), previewSemanticHash(edited));
    fs.writeFileSync(path.join(f.root, batch, entry.previewFilename), edited);
    const plan = preparePublication(f.root, f.manifestPath);
    const candidate = plan.entries[0].text;
    assert.equal((candidate.match(/^### 合成配方$/gm) || []).length, 1);
    assert.equal((candidate.match(/^##### Minecraft 原版$/gm) || []).length, 1);
    assert.doesNotMatch(candidate, /### 液體|### 無限附加|### 煉金術自傳|批產量/);
    assert.ok(candidate.includes('\t- [output:: 4]\n- **生產設備**'));
    assert.ok(candidate.endsWith(manual));
});

test('layout relaxation still refuses deleted manual prose and changed original route yield', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n- (Machine:: 工作台)\n- [item:: 竹子] (qty:: 2)\n- [output:: 1]\n\n人工備註不得遺失\n');
    const entry = f.add('stick', '木棒', original.replace('人工備註不得遺失\n', ''), original); f.save();
    assert.throws(() => preparePublication(f.root, f.manifestPath), /更新預覽未保留目前正式 BIO/);
    fs.writeFileSync(path.join(f.root, batch, entry.previewFilename), original.replace('[output:: 1]', '[output:: 9]'));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /配方語意已變更/);
});

test('preferred markers can be moved, added or removed without changing route values or rewriting edited layout', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: 木材] (qty:: 2)\n- [output:: 4]\n' +
        '- (Machine:: 高爐)\n- [item:: 竹子] (qty:: 2)\n- [output:: 1]\n\n![[圖.png]]\n人工備註\n');
    const record = f.add('stick', '木棒', original, original); f.save();
    const plain = original.replace('<!-- preferred -->\n', '');
    const variants = [plain, plain.replace('- (Machine:: 高爐)', '<!-- preferred -->\n- (Machine:: 高爐)'),
        original.replace('- (Machine:: 高爐)', '<!-- preferred -->\n- (Machine:: 高爐)')];
    for (const edited of variants) {
        fs.writeFileSync(path.join(f.root, batch, record.previewFilename), edited);
        const candidate = preparePublication(f.root, f.manifestPath).entries[0].text;
        assert.equal((candidate.match(/<!-- preferred -->/g) || []).length, (edited.match(/<!-- preferred -->/g) || []).length);
        assert.ok(candidate.endsWith(edited.slice(edited.indexOf('# 合成/取得'))));
    }
    fs.writeFileSync(path.join(f.root, batch, record.previewFilename), variants[1].replace('qty:: 2', 'qty:: 9'));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /配方語意已變更/);
});

test('Tag representative preferred edits retain exact membership rather than freezing the old representative name', () => {
    const header = '---\ntype: mc-item\nid: WOOL\nminecraft_tag: minecraft:wool\ntag_identity: minecraft:item_tag\n---\n';
    const first = header + '### Tag 代表材料\n<!-- preferred -->\n- [item:: 白色羊毛]\n- [item:: 黑色羊毛]\n';
    const second = header + '### Tag 代表材料\n- [item:: 白色羊毛]\n<!-- preferred -->\n- [item:: 黑色羊毛]\n';
    assert.notEqual(previewSemanticHash(first), previewSemanticHash(second));
    assert.equal(previewSemanticHash(first, { ignorePreferred: true }), previewSemanticHash(second, { ignorePreferred: true }));
    assert.notEqual(previewSemanticHash(first, { ignorePreferred: true }), previewSemanticHash(second.replace('黑色羊毛', '紅色羊毛'), { ignorePreferred: true }));
});

test('legacy batch preference upgrade backs up only its manifest, preserves edits and needs no regenerated preview', t => {
    const f = fixture(t);
    const original = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n- 交易：交換。\n');
    const record = f.add('stick', '木棒', original, null, { baselineWithoutPreferred: undefined }); f.save();
    const preview = path.join(f.root, batch, record.previewFilename);
    const edited = original.replace('type: mc-item', 'type: mc-drop').replace('### 外部取得', '\n### 外部取得\n');
    fs.writeFileSync(preview, edited);
    const result = allowPreferredEdits(f.root, f.manifestPath);
    assert.equal(result.upgraded, 1); assert.equal(result.formalBIOsWritten, 0);
    assert.equal(fs.readFileSync(preview, 'utf8'), edited);
    const backup = JSON.parse(fs.readFileSync(path.join(f.root, result.backup), 'utf8'));
    assert.equal(backup.entries[0].baselineWithoutPreferred, undefined);
    const moved = edited.replace('<!-- preferred -->\n', '').replace('- 交易：', '<!-- preferred -->\n- 交易：');
    fs.writeFileSync(preview, moved);
    assert.ok(preparePublication(f.root, f.manifestPath).entries[0].text.includes('<!-- preferred -->\n- 交易：'));
    assert.equal(allowPreferredEdits(f.root, f.manifestPath).alreadyEnabled, true);
    assert.equal(fs.existsSync(path.join(f.root, record.targetPath)), false);
});

test('legacy upgrade refuses to bless previously changed route values or preferences from a hash-only baseline', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: 木材] (qty:: 2)\n- [output:: 4]\n');
    const record = f.add('stick', '木棒', original, null, { baselineWithoutPreferred: undefined }); f.save();
    const preview = path.join(f.root, batch, record.previewFilename);
    fs.writeFileSync(preview, original.replace('<!-- preferred -->\n', ''));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /allow-preferred/);
    assert.throws(() => allowPreferredEdits(f.root, f.manifestPath), /先保留原 preferred/);
    fs.writeFileSync(preview, original.replace('qty:: 2', 'qty:: 9'));
    assert.throws(() => allowPreferredEdits(f.root, f.manifestPath), /先保留原 preferred/);
    assert.equal(fs.readdirSync(path.join(f.root, batch)).some(name => name.includes('.before-preferred-')), false);
});

test('LEVEL accepts blank and missing as zero, and rejects non-integer or unsafe values', () => {
    for (const metadata of [{}, { level: '' }, { level: '  ' }, { level: '0' }, { level: 0 }]) assert.equal(parseBIOLevel(metadata), 0);
    assert.equal(parseBIOLevel({ level: '0007' }), 7);
    assert.equal(parseBIOLevel({ level: '9007199254740991' }), Number.MAX_SAFE_INTEGER);
    for (const level of ['-1', '1.5', '1e3', 'NaN', 'Infinity', 'true', '9007199254740992', [], {}]) {
        assert.throws(() => parseBIOLevel({ level }), /LEVEL/);
    }
});

test('a new level-editable baseline preserves literal LEVEL and preferred edits but still locks quantity', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: 木材] (qty:: 2)\n- [output:: 4]\n')
        .replace('id: STICK\n', 'id: STICK\nlevel:\n');
    const record = f.add('stick', '木棒', original, null, { baselineWithoutPreferredAndLevel: previewSemanticHash(original, { ignorePreferred: true, ignoreLevel: true }) });
    f.save();
    const filename = path.join(f.root, batch, record.previewFilename);
    const changed = original.replace('level:\n', 'level: 0007\n').replace('<!-- preferred -->\n', '');
    fs.writeFileSync(filename, changed);
    const candidate = preparePublication(f.root, f.manifestPath).entries[0].text;
    assert.match(candidate, /^level: 0007$/m);
    assert.doesNotMatch(candidate, /<!-- preferred -->/);
    fs.writeFileSync(filename, changed.replace('qty:: 2', 'qty:: 3'));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /配方語意已變更/);
    fs.writeFileSync(filename, changed.replace('level: 0007', 'level: -1'));
    assert.throws(() => preparePublication(f.root, f.manifestPath), /LEVEL/);
    fs.writeFileSync(filename, changed.replace('level: 0007\n', ''));
    assert.doesNotMatch(preparePublication(f.root, f.manifestPath).entries[0].text, /^level:/m);
});

test('legacy level upgrade proves blank, zero and missing old values without replacing edited previews', t => {
    for (const oldLevel of [null, '', '0']) {
        const f = fixture(t);
        let original = item('stick', '### 外部取得\n<!-- preferred -->\n- 採集：拾取。\n');
        if (oldLevel !== null) original = original.replace('id: STICK\n', 'id: STICK\nlevel:' + (oldLevel ? ' ' + oldLevel : '') + '\n');
        const record = f.add('stick', '木棒', original); f.save();
        const filename = path.join(f.root, batch, record.previewFilename);
        const changed = (oldLevel === null ? original.replace('id: STICK\n', 'id: STICK\nlevel: 8\n')
            : original.replace(/^level:.*$/m, 'level: 8')).replace('type: mc-item', 'type: mc-drop');
        fs.writeFileSync(filename, changed);
        const result = allowLevelEdits(f.root, f.manifestPath);
        assert.equal(result.upgraded, 1); assert.equal(result.formalBIOsWritten, 0);
        assert.equal(fs.readFileSync(filename, 'utf8'), changed);
        const backup = JSON.parse(fs.readFileSync(path.join(f.root, result.backup), 'utf8'));
        assert.equal(backup.entries[0].baselineWithoutPreferredAndLevel, undefined);
        assert.match(preparePublication(f.root, f.manifestPath).entries[0].text, /^level: 8$/m);
        assert.equal(allowLevelEdits(f.root, f.manifestPath).alreadyEnabled, true);
        assert.equal(allowPreferredEdits(f.root, f.manifestPath).alreadyEnabled, true);
        assert.equal(fs.existsSync(path.join(f.root, record.targetPath)), false);
    }
});

test('source LEVEL is a bounded legacy proof candidate and the checkpoint retains its original value', t => {
    const f = fixture(t);
    const original = item('iron_ingot', '### 外部取得\n<!-- preferred -->\n- 採集：測試。\n![[原圖.png]]\n人工備註\n')
        .replace('id: IRON_INGOT\n', 'id: IRON_INGOT\nlevel: 5\n');
    const record = f.add('iron_ingot', '鐵錠', original, original); f.save();
    const filename = path.join(f.root, batch, record.previewFilename);
    fs.writeFileSync(filename, original.replace('level: 5', 'level: 007').replace('<!-- preferred -->\n', ''));
    assert.equal(allowLevelEdits(f.root, f.manifestPath).upgraded, 1);
    const result = publishBIOBatch(f.root, f.manifestPath, { write: true });
    assert.match(fs.readFileSync(path.join(f.root, record.targetPath), 'utf8'), /^level: 007$/m);
    assert.match(git(f.root, 'show', result.checkpoint + ':' + record.targetPath), /^level: 5$/m);
});

test('legacy level upgrade never re-signs changed ingredients, identity or Base decisions', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: 木材] (qty:: 2)\n- [output:: 4]\n')
        .replace('id: STICK\n', 'id: STICK\nlevel:\n');
    const record = f.add('stick', '木棒', original); f.save();
    const filename = path.join(f.root, batch, record.previewFilename);
    for (const changed of [original.replace('qty:: 2', 'qty:: 9'), original.replace('id: STICK\n', 'id: OTHER\n'),
        original.replace('level:\n', 'level:\nbase_material: true\n')]) {
        fs.writeFileSync(filename, changed.replace('level:\n', 'level: 7\n'));
        assert.throws(() => allowLevelEdits(f.root, f.manifestPath), /無法證明只有 LEVEL 修改/);
    }
    assert.equal(fs.readdirSync(path.join(f.root, batch)).some(name => name.includes('.before-level-')), false);
});

test('a strict legacy baseline cannot authorize preferred changes during level upgrade', t => {
    const f = fixture(t);
    const original = item('stick', '### 合成配方\n<!-- preferred -->\n- (Machine:: 工作台)\n- [item:: 木材] (qty:: 2)\n- [output:: 4]\n')
        .replace('id: STICK\n', 'id: STICK\nlevel:\n');
    const record = f.add('stick', '木棒', original, null, { baselineWithoutPreferred: undefined }); f.save();
    const filename = path.join(f.root, batch, record.previewFilename);
    fs.writeFileSync(filename, original.replace('level:\n', 'level: 1\n').replace('<!-- preferred -->\n', ''));
    assert.throws(() => allowLevelEdits(f.root, f.manifestPath), /須保留原 preferred/);
    fs.writeFileSync(filename, original.replace('level:\n', 'level: 1\n'));
    assert.equal(allowLevelEdits(f.root, f.manifestPath).upgraded, 1);
    fs.writeFileSync(filename, original.replace('level:\n', 'level: 2\n').replace('<!-- preferred -->\n', ''));
    assert.match(preparePublication(f.root, f.manifestPath).entries[0].text, /^level: 2$/m);
});
