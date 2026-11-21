# Git 歷史與 BIO 發布復原

此頁只讀取 Git 歷史與發布收據；按鈕只複製指令，由你在 PowerShell 7 前景執行。

BIO 發布還原點包含該批發布前的實際內容，與一般 commit 歷史分開列出。復原只處理收據內的檔案：先備份目前內容，再還原既有 BIO；該批新增的 BIO 移到備份區。分支與 Git 暫存區維持原狀。

選擇要撤回的發布批次；若發布後還做過人工修改，這些內容也會先備份。失敗收據可能只寫入部分檔案，復原指令會涵蓋該次原訂寫入範圍。執行後仍需檢查 BIO、重新掃描及 V4 RELOAD。

```dataviewjs
const root = app.vault.adapter.basePath;
const { spawnSync } = require('node:child_process');
const helper = { exports: {} };
new Function('module', await app.vault.adapter.read('BIO相關模組/搜尋介面模塊/bio_recovery_v4.js'))(helper);
const container = dv.el('div', '');
const refresh = document.createElement('button');
refresh.textContent = '🔄 重讀 Git 歷史與發布收據';
container.appendChild(refresh);
const results = document.createElement('div');
container.appendChild(results);
function git(args) {
    let exitCode = null;
    let completed = false;
    const run = spawnSync('git', ['-C', root, ...args], {
        encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024
    });
    completed = !run.error && run.signal == null && run.status != null;
    if (completed) exitCode = run.status;
    if (!completed || exitCode !== 0) throw new Error(run.error?.message || run.stderr || 'Git 讀取失敗');
    return run.stdout.trim();
}
function copyButton(command, caption = '📋 複製復原指令') {
    const button = document.createElement('button');
    button.textContent = caption;
    button.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(command); new Notice('已複製，請在 PowerShell 7 執行'); }
        catch (error) { new Notice('複製失敗：' + error.message); }
    });
    return button;
}
function table(headers, rows) {
    const table = document.createElement('table');
    const heading = document.createElement('tr');
    for (const value of headers) { const cell = document.createElement('th'); cell.textContent = value; heading.appendChild(cell); }
    table.appendChild(heading);
    for (const row of rows) {
        const tr = document.createElement('tr');
        for (const value of row) {
            const cell = document.createElement('td');
            if (typeof value === 'string') cell.textContent = value;
            else cell.appendChild(value);
            tr.appendChild(cell);
        }
        table.appendChild(tr);
    }
    results.appendChild(table);
}
async function render() {
    refresh.disabled = true;
    results.replaceChildren();
    try {
        const title = document.createElement('h2'); title.textContent = 'BIO 發布還原點'; results.appendChild(title);
        const rows = [];
        let listing;
        try { listing = await app.vault.adapter.list('review/bio-publications'); }
        catch (error) {
            if (await app.vault.adapter.exists('review/bio-publications')) throw error;
            listing = { files: [] };
        }
        for (const file of listing.files.filter(file => file.endsWith('.json')).sort().reverse().slice(0, 100)) {
            try {
                const receipt = JSON.parse(await app.vault.adapter.read(file));
                if (!/^[a-f0-9]{40,64}$/.test(receipt.commit || '') || !receipt.ref?.startsWith('refs/obsf/bio-checkpoints/')) throw new Error('缺少有效發布還原點');
                const commit = git(['rev-parse', '--verify', receipt.ref + '^{commit}']);
                if (commit !== receipt.commit) throw new Error('還原點與收據 commit 不一致');
                rows.push([file.split('/').pop(), receipt.status || '未知', receipt.manifestPath || '',
                    String(receipt.files?.length || 0), copyButton(helper.exports.recoveryCommand(root, receipt))]);
            } catch (error) { rows.push([file.split('/').pop(), '無法產生指令', error.message, '', '']); }
        }
        table(['發布收據', '狀態', '批次', '檔案數', '操作'], rows);
        const historyTitle = document.createElement('h2'); historyTitle.textContent = '目前分支最近 50 筆 Git 歷史'; results.appendChild(historyTitle);
        const history = git(['log', '-50', '--date=iso-strict', '--format=%H%x09%aI%x09%s']);
        const commits = history ? history.split('\n').map(line => {
            const [commit, date, ...subject] = line.split('\t');
            const command = helper.exports.inspectCommand(root, commit);
            return [date, commit.slice(0, 12), subject.join('\t'), copyButton(command, '📋 複製查看變更指令')];
        }) : [];
        table(['時間', 'Commit', '說明', '操作'], commits);
    } catch (error) {
        const message = document.createElement('p'); message.textContent = '讀取失敗：' + error.message; results.appendChild(message);
    } finally { refresh.disabled = false; }
}
refresh.addEventListener('click', render);
await render();
```
