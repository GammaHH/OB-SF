<%*
const root = app.vault.adapter.basePath;
const Notice = tp.obsidian.Notice;
const source = await tp.system.prompt('Slimefun4 乾淨 Git checkout 的完整路徑（需 commit 5374034c8713248909e60e6855c6f745fd7ca676）：');
if (!source?.trim()) return;
const helper = { exports: {} };
new Function('module', await app.vault.adapter.read('BIO相關模組/搜尋介面模塊/foreground_command.js'))(helper);
const command = helper.exports.foregroundCommand(root,
    ['scripts/ob-cli.cjs','parse','--source=slimefun','--source-root=' + source.trim()], 'slimefun-parser');
await navigator.clipboard.writeText(command);
new Notice('已複製 PowerShell 前景指令。請手動執行並回傳日誌；此模板不啟動解析、不修改正式 BIO。', 12000);
%>
