const { createHash } = require('node:crypto');
const { reviewFormBlock } = require('../../BIO engine/normalized_review_form');
const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalizedSource(input) {
    if (input?.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('不支援的 Normalized schemaVersion');
    if (!['OB-SF Normalized Recipe V1','OB-SF Minecraft Normalized Recipe V1'].includes(input?.schema) || !Array.isArray(input.items))
        throw new Error('不支援的 Normalized Recipe schema');
    const provider = input.provider_id || (input.schema === 'OB-SF Minecraft Normalized Recipe V1' ? 'minecraft' : null);
    if (!/^[a-z][a-z0-9_-]*$/.test(provider || '')) throw new Error('缺少有效 provider_id');
    const ids = new Set();
    function ingredientValid(ingredient, depth = 0) {
        if (depth > 30 || !ingredient || !['item','tag','alternatives'].includes(ingredient.kind) || !Number.isSafeInteger(ingredient.qty) || ingredient.qty <= 0) throw new Error('材料數量／型態或深度無效');
        const validId = id => /^[a-z][a-z0-9_.-]*:[A-Za-z0-9_./-]+$/.test(id || '');
        if (ingredient.kind === 'item' && !validId(ingredient.id)) throw new Error('材料 ID 無效');
        if (ingredient.kind === 'tag' && (!validId(ingredient.id) || (ingredient.values && (!Array.isArray(ingredient.values) || ingredient.values.some(id=>!validId(id)))))) throw new Error('Tag ID／成員無效');
        if (ingredient.kind === 'alternatives') {
            if (!Array.isArray(ingredient.alternatives) || !ingredient.alternatives.length) throw new Error('擇一材料缺少候選');
            for (const choice of ingredient.alternatives) ingredientValid(choice, depth+1);
        }
    }
    for (const item of input.items) {
        if (!/^[a-z][a-z0-9_.-]*:[A-Za-z0-9_./-]+$/.test(item.id || '') || ids.has(item.id) || !Array.isArray(item.recipes)) throw new Error('Normalized Item ID 重複或無效：' + item.id);
        ids.add(item.id);
        const recipes = new Set();
        for (const recipe of item.recipes) {
            if (!recipe.recipeId) recipe.recipeId = 'recipe-' + digest({ item: item.id, recipe }).slice(7,31);
            if (!/^[A-Za-z0-9_-]+$/.test(recipe.recipeId)) throw new Error('Recipe ID 格式無效');
            if (recipes.has(recipe.recipeId)) throw new Error('Recipe ID 重複：' + recipe.recipeId);
            recipes.add(recipe.recipeId);
            if (!Number.isSafeInteger(recipe.output) || recipe.output <= 0 || !Array.isArray(recipe.ingredients)) throw new Error('配方產量／材料未確認：' + recipe.recipeId);
            for (const ingredient of recipe.ingredients) ingredientValid(ingredient);
        }
    }
    return { ...input, provider_id: provider, fingerprint: digest({ provider, source: input.source || null, items: input.items }) };
}
const token = id => Buffer.from(id).toString('base64url');
function renderNormalizedReview(registry, existing = {}) {
    const lines = ['---','type: bio-recipe-review','source_adapter: normalized', 'sourceFingerprint: ' + registry.fingerprint,'---','',
        '# BIO Recipe Review','', '逐項填入名稱與正式資料夾，並選一條路線。勾選配方表示已閱讀來源、layout 與 warnings；不會把未知配方自動當作 Base。', ''];
    if (registry.items.length === 1) lines.push(...reviewFormBlock(registry.provider_id), '');
    for (const item of registry.items) {
        const prior = existing[item.id]?.fingerprint === registry.fingerprint ? existing[item.id] : {};
        lines.push('<!-- obsf:normalized-item ' + token(item.id) + ' -->', '## ' + item.id,
            '- 中文名稱：' + (prior.name || item.localizedName || ''), '- 正式資料夾：' + (prior.folder || ''),
            '- 外部取得說明：' + (prior.obtainment || ''),
            '- [' + (prior.external ? 'x' : ' ') + '] 改採人工確認的外部取得 <!-- obsf:normalized-external -->');
        for (const recipe of item.recipes) {
            lines.push('- [' + (prior.recipeId === recipe.recipeId && !prior.external ? 'x' : ' ') + '] `' + recipe.recipeId + '` ' +
                recipe.sourceType + ' → ' + recipe.output + ' <!-- obsf:normalized-recipe ' + recipe.recipeId + ' -->',
                '  - 狀態：' + (recipe.status || 'OK') + '；layout：' + (recipe.layout || '來源未提供'),
                ...(recipe.machineName ? ['  - 設備：' + recipe.machineName + '（' + recipe.machineId + '）'] : []),
                '  - 材料：' + recipe.ingredients.map(value =>
                    (value.name ? value.name + '（' + value.id + '）' : value.id) + ' ×' + value.qty).join('、'),
                '  - 來源：' + (recipe.source?.file || recipe.meta?.sourceFile || '') + ':' + (recipe.source?.line || ''),
                '  - 提醒：' + (recipe.warnings || []).join('；'));
        }
        lines.push('<!-- obsf:normalized-item-end -->', '');
    }
    return lines.join('\n') + '\n';
}
function parseNormalizedReview(text, registry, roots) {
    if (!text.includes('sourceFingerprint: ' + registry.fingerprint)) throw new Error('Review 來源已變更，請重新 scan');
    const decisions = {}, pending = [];
    for (const item of registry.items) {
        const start = '<!-- obsf:normalized-item ' + token(item.id) + ' -->';
        const index = text.indexOf(start);
        if (index < 0 || text.indexOf(start,index+start.length) >= 0) throw new Error('Review 物品區塊缺失或重複：' + item.id);
        const end = text.indexOf('<!-- obsf:normalized-item-end -->',index);
        if (end < 0) throw new Error('Review 物品區塊未結束');
        const body = text.slice(index,end);
        const field = label => body.match(new RegExp('^- ' + label + '：[ \\t]*(.*)$','m'))?.[1]?.trim() || '';
        const name = field('中文名稱'), folder = field('正式資料夾'), obtainment = field('外部取得說明');
        const chosen = [...body.matchAll(/^- \[[xX]\].*<!-- obsf:normalized-recipe ([a-zA-Z0-9_-]+) -->/gm)].map(match => match[1]);
        const external = /^- \[[xX]\].*<!-- obsf:normalized-external -->/m.test(body);
        const recipe = item.recipes.find(value => value.recipeId === chosen[0]);
        let reason = '';
        if (!name || /[\\/:*?"<>|\[\]#\r\n]/.test(name) || /[. ]$/.test(name)) reason = '缺少有效中文名稱';
        else if (!roots.some(root => root.folder === folder || (root.recursive && folder.startsWith(root.folder + '/'))) || folder.split('/').some(part => !part || part.startsWith('.'))) reason = '正式資料夾不在白名單';
        else if ((external ? 1 : 0) + chosen.length !== 1) reason = '須選擇恰好一條配方或外部取得';
        else if (external && !obtainment) reason = '外部取得缺少說明';
        else if (!external && (!recipe || ['SPECIAL','UNSUPPORTED','ERROR'].includes(recipe.status) || recipe.recipeKind === 'external')) reason = '此路線須以 Mini Parser 或外部取得補完';
        if (reason) { pending.push({ id: item.id, reason }); continue; }
        decisions[item.id] = { fingerprint: registry.fingerprint, provider_id: registry.provider_id, name, folder, external,
            obtainment, recipeId: external ? null : recipe.recipeId, reviewed: true };
    }
    return { decisions, pending };
}
module.exports = { normalizedSource, renderNormalizedReview, parseNormalizedReview };
