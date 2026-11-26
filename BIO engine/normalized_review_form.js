const fieldLabels = { name: '中文名稱', folder: '正式資料夾', obtainment: '外部取得說明' };
const recipeLine = /^- \[([ xX])\] (.+) <!-- obsf:normalized-recipe ([A-Za-z0-9_-]+) -->[ \t]*$/;
const externalLine = /^- \[([ xX])\] .*<!-- obsf:normalized-external -->[ \t]*$/;
const externalRoute = ':external';

function reviewFormBlock(providerId) {
    return [
        '```dataviewjs',
        'const helper = { exports: {} };',
        "new Function('module', await app.vault.adapter.read('BIO engine/normalized_review_form.js'))(helper);",
        'await helper.exports.renderReviewForm(app, dv, ' + JSON.stringify(providerId) + ');',
        '```'
    ];
}

function readDraft(text) {
    const fingerprint = text.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)^---\r?$/m)?.[1]
        .match(/^sourceFingerprint: (sha256:[a-f0-9]+)\r?$/m)?.[1];
    const starts = [...text.matchAll(/^<!-- obsf:normalized-item ([A-Za-z0-9_-]+) -->\r?$/gm)];
    const start = starts[0];
    const end = text.indexOf('<!-- obsf:normalized-item-end -->', start?.index);
    if (!fingerprint || starts.length !== 1 || end < start.index) throw new Error('找不到目前的單筆 Normalized Review');
    const block = text.slice(start.index, end);
    const lines = block.split(/\r?\n/);
    const fields = {};
    for (const [key, label] of Object.entries(fieldLabels)) {
        const prefix = '- ' + label + '：';
        const rows = lines.filter(line => line.startsWith(prefix));
        if (rows.length !== 1) throw new Error('審核欄位缺失或重複：' + label);
        fields[key] = rows[0].slice(prefix.length).trim();
    }
    const recipes = lines.map(line => line.match(recipeLine)).filter(Boolean)
        .map(([, checked, label, id]) => ({ id, label: label.replaceAll('`', ''), checked: checked !== ' ' }));
    const externalRows = lines.map(line => line.match(externalLine)).filter(Boolean);
    if (externalRows.length !== 1 || new Set(recipes.map(recipe => recipe.id)).size !== recipes.length)
        throw new Error('審核路線標記缺失或重複');
    const chosen = recipes.filter(recipe => recipe.checked).map(recipe => recipe.id);
    if (externalRows[0][1] !== ' ') chosen.push(externalRoute);
    return { fingerprint, start: start.index, end, block, fields, recipes, route: chosen.length === 1 ? chosen[0] : '' };
}

function saveDraft(text, opened, values, roots) {
    const draft = readDraft(text);
    if (draft.fingerprint !== opened.fingerprint || draft.block !== opened.block)
        throw new Error('審核內容已變更，請重新開啟頁面後再儲存');
    const fields = Object.fromEntries(Object.keys(fieldLabels).map(key => [key, values[key].trim()]));
    if (Object.values(values).some(value => /[\r\n]/.test(value))) throw new Error('欄位請使用單行文字');
    if (fields.name && (/[\\/:*?"<>|\[\]#]/.test(fields.name) || fields.name.endsWith('.')))
        throw new Error('中文名稱含有無效字元');
    if (/[<>]/.test(fields.obtainment)) throw new Error('外部取得說明含有無效字元');
    if (fields.folder && (/[\\:*?"<>|]/.test(fields.folder) || !roots.some(root => root.folder === fields.folder ||
        (root.recursive && fields.folder.startsWith(root.folder + '/'))) ||
        fields.folder.split('/').some(part => !part || part.startsWith('.'))))
        throw new Error('正式資料夾不在白名單');
    if (values.route && values.route !== externalRoute && !draft.recipes.some(recipe => recipe.id === values.route))
        throw new Error('找不到選定的配方');

    const block = draft.block.replace(/^[^\r\n]+/gm, line => {
        for (const [key, label] of Object.entries(fieldLabels)) {
            const prefix = '- ' + label + '：';
            if (line.startsWith(prefix)) return prefix + fields[key];
        }
        const recipe = line.match(recipeLine);
        if (recipe || externalLine.test(line)) {
            const id = recipe ? recipe[3] : externalRoute;
            return line.replace(/^- \[[ xX]\]/, values.route === id ? '- [x]' : '- [ ]');
        }
        return line;
    });
    return text.slice(0, draft.start) + block + text.slice(draft.end);
}

async function renderReviewForm(app, dv, providerId) {
    const panel = dv.el('div', '', { cls: 'normalized-review-form' });
    const message = panel.createEl('p', { attr: { role: 'status' } });
    try {
        const file = app.vault.getAbstractFileByPath(dv.current().file.path);
        if (!file || typeof app.vault.process !== 'function') throw new Error('此介面需要 Obsidian 的 Vault.process');
        let opened = readDraft(await app.vault.read(file));
        const mappingModule = { exports: {} };
        const mappingCode = await app.vault.adapter.read('BIO相關模組/MC解析器模塊/bio/machine_recipe_mapping.js');
        new Function('module', mappingCode)(mappingModule);
        const mapping = await app.vault.adapter.read(mappingModule.exports.RECIPE_MAPPING_FILE);
        const roots = mappingModule.exports.formalRoots(mapping);
        const providers = mappingModule.exports.providerRecords(mapping);
        const belongs = folder => [...providers].some(([path, provider]) =>
            provider.id === providerId && (folder === path || folder.startsWith(path + '/')));
        const choices = roots.map(root => root.folder);
        choices.sort((a, b) => Number(belongs(b)) - Number(belongs(a)) || a.localeCompare(b, 'zh-TW'));

        const labeled = (label, kind, attr) => {
            const row = panel.createEl('p');
            const control = row.createEl('label', { text: label + ' ' });
            return control.createEl(kind, { attr });
        };
        const name = labeled(fieldLabels.name, 'input', { type: 'text' });
        const listId = 'normalized-folders-' + Math.random().toString(36).slice(2);
        const folder = labeled(fieldLabels.folder, 'input', { type: 'text', list: listId });
        folder.placeholder = '選擇或輸入正式資料夾';
        const list = panel.createEl('datalist', { attr: { id: listId } });
        for (const choice of choices) list.createEl('option', { attr: { value: choice } });
        const route = labeled('採用路線', 'select');
        const options = [{ id: '', label: '請先核對並選擇路線' }, ...opened.recipes,
            { id: externalRoute, label: '人工確認的外部取得' }];
        for (const option of options) route.createEl('option', { text: option.label, attr: { value: option.id } });
        const obtainment = labeled(fieldLabels.obtainment, 'input', { type: 'text' });
        const showExternal = () => { obtainment.disabled = route.value !== externalRoute; };
        name.value = opened.fields.name;
        folder.value = opened.fields.folder;
        route.value = opened.route;
        obtainment.value = opened.fields.obtainment;
        route.addEventListener('change', showExternal);
        showExternal();
        const button = panel.createEl('button', { text: '儲存審核草稿', attr: { type: 'button' } });
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const values = { name: name.value, folder: folder.value, route: route.value, obtainment: obtainment.value };
                const saved = await app.vault.process(file, text => saveDraft(text, opened, values, roots));
                opened = readDraft(saved);
                message.textContent = '草稿已儲存。執行 review recalculate 完成審核。';
            } catch (error) {
                message.textContent = error.message;
            } finally {
                button.disabled = false;
            }
        });
    } catch (error) {
        message.textContent = '無法載入審核表單：' + error.message;
    }
}

module.exports = { reviewFormBlock, readDraft, saveDraft, renderReviewForm };
