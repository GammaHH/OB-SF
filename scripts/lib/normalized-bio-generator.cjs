const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { formalBIOIndex } = require('./formal-bio-index.cjs');
const { inputFingerprint } = require('./bio-publication.cjs');
const { providerRecords, parseMachineDictionary, parseMachineRecipeMappings, classifyMachineRecipe } = require('../../BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping');
const { parseFrontmatter } = require('../../BIO相關模組/MC解析器模塊/bio/bio_scanner');
const reader = require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');
const { routeKeys } = require('../../BIO相關模組/MC解析器模塊/bio/bio_update');
const { normalizedSource } = require('./normalized-source.cjs');
const sha = text => createHash('sha256').update(text).digest('hex');
const scalar = value => JSON.stringify(String(value));
function generateNormalizedBatch(root, input, decisions, { write = false, targets = null, fromFormal = false, stamp = new Date().toISOString().replace(/[:.]/g,'-') } = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(stamp)) throw new Error('批次時間戳無效');
    if (fromFormal && !targets?.length) throw new Error('--from-formal 須明確指定 --target');
    const registry = normalizedSource(structuredClone(input));
    const eligible = registry.items.filter(item => targets ? targets.includes(item.id) :
        decisions[item.id]?.reviewed && decisions[item.id].fingerprint === registry.fingerprint);
    if (!eligible.length || (targets && new Set(eligible.map(item=>item.id)).size !== new Set(targets).size)) throw new Error('沒有可產生的已審核目標，或指定 ID 不存在');
    const mapping = fs.readFileSync(path.join(root,'Recipe Mapping Draft.md'),'utf8');
    const { inventory, documents, roots } = formalBIOIndex(root,mapping);
    if (inventory.conflicts.length || inventory.diagnostics.length) throw new Error('正式 BIO 身分有衝突或無法確認，請先盤點修正');
    const providers = [...providerRecords(mapping).entries()].filter(([,value]) => value.id === registry.provider_id);
    if (!providers.length || new Set(providers.map(([,value])=>value.heading)).size !== 1) throw new Error('Provider Mapping 缺少或有歧義');
    const provider = providers[0][1];
    const machineDictionary = parseMachineDictionary(mapping), machineRules = parseMachineRecipeMappings(mapping);
    if (machineDictionary.diagnostics.length || machineRules.diagnostics.some(value=>value.severity==='ERROR')) throw new Error('Machine Mapping 無效');
    const batch = '@自動化BIO Preview/batch/normalized-' + stamp;
    const manifestPath = batch + '/BIO Publication.json';
    const evidence = '參考資料/OB-SF Normalized/' + stamp + '.json';
    const evidenceText = JSON.stringify(registry,null,2) + '\n';
    const artifacts = [], destinationPaths = new Set(), currentDocs = new Map(documents.map(value=>[value.path,value]));
    const unchanged = [], routeDifferences = [];
    const aliases = new Map();
    const normalize = value => String(value).normalize('NFC').replace(/\.md$/i, '').toLowerCase();
    for (const entry of inventory.entries) {
        const metadata = currentDocs.get(entry.path)?.frontmatter;
        for (const name of [entry.path, entry.name, entry.id, entry.bioId, ...[].concat(metadata?.aliases || [])]) {
            if (!name) continue;
            const key = normalize(name);
            const identities = aliases.get(key) || new Set();
            identities.add(entry.key);
            aliases.set(key, identities);
        }
    }
    const resolveName = value => {
        if (value && reader.isManualMachine(value)) return 'manual';
        const matches = aliases.get(normalize(value));
        return matches?.size === 1 ? [...matches][0] : value;
    };
    const routeKey = route => route.external ? JSON.stringify([route.provider, 'external', route.sourceText]) :
        JSON.stringify([route.provider, routeKeys(route, resolveName).exact]);
    function reference(id) {
        const match = inventory.get('item', id);
        if (match.presence === 'CONFLICT') throw new Error('材料 BIO 身分有歧義：' + id);
        if (match.presence === 'PRESENT') return { text: '[[' + match.matches[0].path.replace(/\.md$/i,'') + '|' + match.matches[0].name + ']]',
            field: match.matches[0].type.endsWith('drop') ? 'drop' : match.matches[0].type === 'sf-GEO' ? 'GEO' : 'item' };
        return { text: id.startsWith('slimefun:') ? id.slice(9) : id, field: 'item' };
    }
    function material(ingredient, indent='\t') {
        if (ingredient.kind === 'item') {
            const link = reference(ingredient.id);
            return [indent + '- [' + link.field + ':: ' + link.text + '] (qty:: ' + ingredient.qty + ')'];
        }
        if (ingredient.kind === 'tag') {
            const collection = inventory.get('tag',ingredient.id);
            if (collection.presence === 'CONFLICT') throw new Error('Tag BIO 身分有歧義：'+ingredient.id);
            if (collection.presence === 'PRESENT') return [indent+'- [item:: [['+collection.matches[0].path.replace(/\.md$/i,'')+'|'+collection.matches[0].name+']]] (qty:: '+ingredient.qty+')'];
        }
        const choices = ingredient.kind === 'tag' ? (ingredient.values || []).map(id=>({kind:'item',id,qty:1})) : ingredient.alternatives;
        if (!choices?.length || choices.some(value=>value.kind!=='item' || !Number.isSafeInteger(value.qty) || value.qty<=0)) throw new Error('集合／擇一材料尚未完整標準化');
        return [indent + '- **擇一材料** (qty:: ' + ingredient.qty + ')', ...choices.map(value => {
            const link = reference(value.id);
            return indent + '\t- [' + link.field + ':: ' + link.text + ']' + (value.qty===1?'':' (qty:: '+value.qty+')');
        })];
    }
    for (const item of eligible) {
        if (!item.id.startsWith('slimefun:') && !item.id.startsWith('minecraft:')) throw new Error('此 namespace 尚未定義 BIO 身分 adapter：'+item.id);
        const existing = inventory.get('item', item.id);
        if (fromFormal && existing.presence !== 'PRESENT') throw new Error('--from-formal 需要唯一正式 BIO：' + item.id);
        const decision = fromFormal ? { name: existing.matches[0].name, folder: path.posix.dirname(existing.matches[0].path) } : decisions[item.id];
        if (!fromFormal && (!decision?.reviewed || decision.fingerprint !== registry.fingerprint)) throw new Error('目標尚未完成目前來源的 Review：' + item.id);
        if (!roots.some(value=>value.folder===decision.folder || (value.recursive && decision.folder.startsWith(value.folder+'/'))) ||
            /[\\:*?"<>|\[\]#\r\n]/.test(decision.name) || !decision.name || /[. ]$/.test(decision.name) ||
            decision.folder.split('/').some(part=>!part || part.startsWith('.'))) throw new Error('正式名稱／資料夾無效');
        const target = decision.folder + '/' + decision.name + '.md';
        const providerFolder = providers.find(([folder]) => folder === decision.folder || decision.folder.startsWith(folder + '/'))?.[0];
        if (!providerFolder && existing.presence !== 'PRESENT') throw new Error('正式目的地的 Provider 與來源不符');
        if (destinationPaths.has(target.toLowerCase())) throw new Error('同批正式目的地重複');
        destinationPaths.add(target.toLowerCase());
        if (existing.presence === 'PRESENT' && existing.matches[0].path !== target) throw new Error('既有 BIO 不可在生成時改名或搬移：' + item.id);
        if (currentDocs.has(target) && existing.presence !== 'PRESENT') throw new Error('正式目的地已被其他身分占用');
        const original = currentDocs.get(target)?.text;
        const originalMetadata = original ? parseFrontmatter(original) : null;
        const originalParsed = original ? reader.parseBIO(original, parseFrontmatter(original)) : null;
        if (originalParsed && (originalParsed.diagnostics.length || originalParsed.recipes.filter(value=>value.preferred).length!==1)) throw new Error('既有 BIO 須先確認唯一 Preferred：' + target);
        const lines = [];
        const seen = new Set(originalParsed?.recipes.map(routeKey));
        function addRoute(block, recipeId) {
            const parsed = reader.parseBIO(block.join('\n'));
            if (parsed.diagnostics.length || parsed.recipes.length !== 1) throw new Error('候選取得路線無法唯一解析：' + item.id);
            const route = parsed.recipes[0];
            const key = routeKey(route);
            if (seen.has(key)) return;
            seen.add(key);
            // An unmatched route is a candidate. Without a stable upstream route key
            // we cannot infer which old recipe, if any, it replaces.
            if (original) routeDifferences.push({ itemId: item.id, provider: registry.provider_id,
                recipeId: recipeId ?? null, status: 'CANDIDATE_ADDITION', existingRoutesRetained: true });
            lines.push(...block);
        }
        if (decision.external) {
            if (!decision.obtainment?.trim() || /[\r\n<>]/.test(decision.obtainment)) throw new Error('外部取得說明無效');
            addRoute(['### 外部取得', '', '##### ' + provider.heading, '',
                ...(!original ? ['<!-- preferred -->'] : []), '- 外部取得：' + decision.obtainment, '']);
        } else {
            if (!fromFormal && !item.recipes.some(value=>value.recipeId===decision.recipeId)) throw new Error('已選配方不存在');
            for (const recipe of item.recipes) {
                if (['SPECIAL','UNSUPPORTED','ERROR'].includes(recipe.status) || recipe.recipeKind==='external') {
                    if (fromFormal) {
                        routeDifferences.push({ itemId: item.id, recipeId: recipe.recipeId, status: 'MANUAL_REVIEW_REQUIRED' });
                        continue;
                    }
                    throw new Error('尚有特殊／動態配方，須先人工補完：'+item.id);
                }
                if (!recipe.ingredients.length) throw new Error('非外部取得路線缺少材料，不能推定為 Base：'+item.id);
                const machineId = recipe.sourceType?.replace(/^RecipeType\./,'');
                const machine = reader.isManualMachine(recipe.machine) && recipe.machine ? recipe.machine :
                    machineDictionary.machines.get(machineId) || (recipe.machineId ? reference(recipe.machineId).text : recipe.machine);
                if (!machine || machine===recipe.machineId || /^[a-z]+:/.test(machine)) throw new Error('生產設備無法從共用 Mapping 確認：' + recipe.sourceType);
                const classified = classifyMachineRecipe({ machine, sourceType: recipe.sourceType, provider: provider.heading,
                    section: recipe.section || '常規' }, machineRules.rules);
                if (classified.diagnostics.length) throw new Error('配方分類待確認：' + item.id);
                addRoute(['### ' + classified.section,'','##### ' + provider.heading,'',
                    ...(!original && recipe.recipeId===decision.recipeId?['<!-- preferred -->']:[]),
                    '- **生產設備**：(Machine:: ' + (machine.startsWith('[[') || reader.isManualMachine(machine) ? machine : '[['+machine+']]') + ')',
                    ...recipe.ingredients.flatMap(value=>material(value)), '\t- [output:: ' + recipe.output + ']',
                    '<!-- obsf:source-recipe ' + recipe.recipeId + ' -->',
                    '<!-- obsf:source ' + JSON.stringify({ ...registry.source, ...recipe.source,
                        file:recipe.source?.file || recipe.meta?.sourceFile || null, line:recipe.source?.line || null })
                        .replaceAll('<','\\u003c').replaceAll('>','\\u003e') + ' -->',''], recipe.recipeId);
            }
        }
        if (!lines.length) { unchanged.push(item.id); continue; }
        const preview = '@自動化BIO Preview/plugin/' + decision.name + '--' + stamp + '-' + sha(item.id).slice(0, 12) + '.preview.md';
        const metadata = { preview_source:'plugin', preview_mode:'plugin', preview_evidence:evidence,
            preview_recipe_provider: providerFolder || providers[0][0],
            preview_registry_sha256:sha(evidenceText), preview_manifest:manifestPath, publish_target:target };
        let text;
        if (original) {
            // Append a new source block, preserving every original route and Preferred.
            const rootHeading = original.match(/^# 合成\/取得\s*$/m);
            if (!rootHeading) throw new Error('既有 BIO 缺少合成/取得根標題');
            const rest = original.slice(rootHeading.index + rootHeading[0].length);
            const next = rest.search(/^#\s/m);
            const at = next < 0 ? original.length : rootHeading.index + rootHeading[0].length + next;
            text = original.slice(0,at) + '\n' + lines.join('\n') + '\n' + original.slice(at);
            text = text.replace(/^(\uFEFF?---\r?\n[\s\S]*?)(\r?\n---)/, (_,body,end)=>body.replace(/^output:[^\r\n]*(?:\r?\n|$)/m, '')+'\n'+Object.entries(metadata).map(([key,value])=>key+': '+scalar(value)).join('\n')+end);
            text = text.replace(/\r?\n---(?:\r?\n|$)/, match=>match+'\n#未人工檢查\n#更新需人工解析\n');
        } else {
            const sf = item.id.startsWith('slimefun:');
            const fields = { type: sf?'sf-item':'mc-item', id: sf?item.id.slice(9):item.id.slice(10).toUpperCase(),
                ...(sf?{}:{minecraft_id:item.id}), provider_id:registry.provider_id, generated_by:'obsf-normalized-generator', ...metadata };
            text = '---\n'+Object.entries(fields).map(([key,value])=>key+': '+scalar(value)).join('\n')+'\n---\n\n#未人工檢查\n#需攻略補充\n\n# 合成/取得\n\n'+lines.join('\n')+'\n# 用途\n\n- \n\n# 產物\n\n- \n';
        }
        if (reader.parseBIO(text,parseFrontmatter(text)).diagnostics.length) throw new Error('產生的 BIO 未通過配方解析');
        artifacts.push({ path: preview, text, target });
    }
    const manifest = { schemaVersion:1, kind:'obsf-bio-publication', batchDirectory:batch, inputFingerprint:inputFingerprint(root),
        normalizedSourceSHA256:sha(evidenceText), normalizedFingerprint:registry.fingerprint, entries:[] };
    const outputs = artifacts.length ? [{path:evidence,text:evidenceText}, ...artifacts,
        {path:manifestPath,text:JSON.stringify(manifest,null,2)+'\n'}] : [];
    for (const output of outputs) if (fs.existsSync(path.join(root,output.path))) throw new Error('輸出已存在：'+output.path);
    if (write) for (const output of outputs) { fs.mkdirSync(path.dirname(path.join(root,output.path)),{recursive:true}); fs.writeFileSync(path.join(root,output.path),output.text,{flag:'wx'}); }
    return { dryRun:!write, manifest:artifacts.length ? manifestPath : null, fingerprint:registry.fingerprint, previews:artifacts.map(value=>value.path),
        unchanged, routeDifferences,
        notSelected:registry.items.length-eligible.length, formalBIOsWritten:0 };
}
module.exports = { generateNormalizedBatch };
