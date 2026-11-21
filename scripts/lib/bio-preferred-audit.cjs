const reader = require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');

function isPreviewPath(file) {
    return file.startsWith('@自動化BIO Preview/') || file.startsWith('MC-自動化BIO/preview/') ||
        /\.(?:(?:update-)?preview(?:--[^/]+)?|formal-candidate)\.md$/i.test(file);
}

function inspectPreferred(document) {
    const { path, frontmatter: metadata, text } = document;
    if (document.cacheReady === false) return {
        path, id: null, providers: [], validRecipes: null, preferred: null,
        statuses: ['READ_ERROR'], needsReview: true, detail: document.readError || ''
    };
    if (!/^(?:mc-(?:item|drop|geo|tag)|sf-(?:item|drop|geo))$/i.test(metadata?.type || '')) return null;
    const collection = reader.isTagBIO(metadata);
    const parsed = reader.parseBIO(text, { ...metadata, base_material: metadata.base_material === true || metadata.base_material === 'true' });
    const collectionRoute = parsed.recipes.find(route => route.tagRepresentative);
    const validRecipes = parsed.recipes.length;
    const choiceCount = collectionRoute?.ingredients[0]?.choices?.length || 0;
    const options = collection ? choiceCount : validRecipes;
    const preferred = parsed.explicitPreferred;
    const statuses = [];
    if (!validRecipes) statuses.push('NO_VALID_RECIPE');
    if (preferred > 1 || parsed.preferredMarkers > 1) statuses.push('MULTIPLE_PREFERRED');
    if (parsed.preferredMarkers > preferred) statuses.push('INVALID_PREFERRED');
    if (options > 1 && !parsed.preferredMarkers) statuses.push('MISSING_PREFERRED');
    if (parsed.diagnostics.length) statuses.push('PARSE_DIAGNOSTIC');
    const needsReview = statuses.length > 0;
    if (!needsReview) statuses.push(options === 1 && !preferred ? 'SINGLE_ROUTE' : 'VALID');
    return { path, id: metadata.minecraft_tag || metadata.derived_group || metadata.minecraft_id || metadata.id || null,
        providers: [...new Set([metadata.provider_id, ...parsed.recipes.map(route => route.provider)].filter(Boolean))],
        validRecipes, choices: collection ? choiceCount : null, preferred, markers: parsed.preferredMarkers,
        statuses, needsReview, diagnostics: parsed.diagnostics };
}

function auditPreferred(documents) {
    const rows = [];
    for (const document of [...documents].sort((a, b) => a.path.localeCompare(b.path))) {
        const row = inspectPreferred(document);
        if (row) rows.push({ ...row, scope: document.scope || (isPreviewPath(document.path) ? 'preview' : 'formal') });
    }
    const counts = Object.fromEntries(['VALID', 'SINGLE_ROUTE', 'MISSING_PREFERRED', 'MULTIPLE_PREFERRED',
        'INVALID_PREFERRED', 'NO_VALID_RECIPE', 'PARSE_DIAGNOSTIC', 'READ_ERROR'].map(status => [status, 0]));
    for (const row of rows) for (const status of row.statuses) counts[status]++;
    return { formal: rows.filter(row => row.scope === 'formal' && !row.statuses.includes('READ_ERROR')).length,
        preview: rows.filter(row => row.scope === 'preview' && !row.statuses.includes('READ_ERROR')).length,
        complete: !counts.READ_ERROR, counts, rows };
}

function renderPreferredAudit(audit) {
    const cell = value => String(value ?? '—').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    const pathCell = value => /[\[\]|#]/.test(value) ? cell(value) : '[[' + value + ']]';
    const missing = audit.rows.filter(row => row.preferred === 0);
    return ['# BIO Preferred Audit', '', '- 正式 BIO 已讀取：' + audit.formal, '- Preview 已讀取：' + audit.preview,
        '- 掃描完整：' + (audit.complete ? '是' : '否'), '', '狀態可同時出現。Tag 以代表材料選項判定。Preferred 欄只計有效且明寫的標記。',
        '', ...Object.entries(audit.counts).map(([status, count]) => '- ' + status + '：' + count), '',
        '## 沒有有效 Preferred 的 BIO（' + missing.length + '）', '',
        '明細只列有效 Preferred 數為 0 的 BIO。單一路線可接受，讀取失敗與其他狀況見摘要。', '',
        ...(missing.length ? [
        '| BIO 路徑 | ID | Provider | 有效路線 | Tag 選項 | Preferred | 狀態 | 人工處理 | 診斷 |',
        '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |',
        ...missing.map(row => '| ' + [pathCell(row.path), cell(row.id), cell(row.providers.join('、') || null),
            cell(row.validRecipes), cell(row.choices), cell(row.preferred), row.statuses.join('、'), row.needsReview ? '需要' : '無',
            cell(row.detail || row.diagnostics?.map(value => value.code).join('、') || null)].join(' | ') + ' |')
        ] : ['無。']), ''].join('\n');
}

module.exports = { isPreviewPath, inspectPreferred, auditPreferred, renderPreferredAudit };
