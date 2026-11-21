const test = require('node:test');
const assert = require('node:assert/strict');
const { recoveryCommand } = require('../../BIO相關模組/搜尋介面模塊/bio_recovery_v4');

test('receipt recovery generates scoped foreground commands with backup and content validation', () => {
    const script = recoveryCommand("C:\\Vault's folder", { commit: 'a'.repeat(40), files: [
        { path: 'MC-物品資料庫/木材.md', created: false, sourceSHA256: 'b'.repeat(64) },
        { path: 'SF-測試/新設備.md', created: true }
    ] });
    assert.ok(script.includes("$VaultRoot = 'C:\\Vault''s folder'"));
    assert.ok(script.includes("$Existing = @('MC-物品資料庫/木材.md')"));
    assert.ok(script.includes("$Created = @('SF-測試/新設備.md')"));
    assert.match(script, /Get-FileHash/);
    assert.match(script, /--literal-pathspecs/);
    assert.match(script, /--worktree/);
    assert.match(script, /Move-Item -LiteralPath/);
    assert.match(script, /-Wait -PassThru -NoNewWindow/);
    assert.doesNotMatch(script, /reset --hard|git clean|Remove-Item|--staged/);
    assert.ok(script.indexOf('Copy-Item') < script.indexOf('Start-Process'));
    assert.ok(script.indexOf('發布前 SHA256 校驗') < script.indexOf('Move-Item'));
});

test('recovery rejects unsafe paths, duplicate paths and incomplete receipts', () => {
    const run = files => recoveryCommand('C:\\Vault', { commit: 'a'.repeat(40), files });
    for (const file of ['../x.md', 'MC-物品資料庫/../x.md', 'MC-物品資料庫/.git/x.md', 'C:\\x.md', 'MC-物品資料庫/x.md\nOops']) {
        assert.throws(() => run([{ path: file, created: true }]), /無效/);
    }
    assert.throws(() => run([{ path: 'MC-物品資料庫/x.md', created: false }]), /SHA256/);
    assert.throws(() => run([{ path: 'MC-物品資料庫/x.md', created: true }, { path: 'MC-物品資料庫/x.md', created: true }]), /重複/);
    assert.throws(() => run([]), /沒有發布檔案/);
    assert.throws(() => recoveryCommand('C:\\Vault', { commit: 'main', files: [] }), /commit/);
});
