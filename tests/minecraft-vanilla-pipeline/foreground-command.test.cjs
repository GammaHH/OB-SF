const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {foregroundCommand}=require('../../BIO相關模組/搜尋介面模塊/foreground_command');

test('copied foreground command preserves literal argv and separate fresh logs on Windows', {skip:process.platform!=='win32'}, t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'obsf-argv-test-'));
    t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('obsf-argv-test-'));fs.rmSync(root,{recursive:true,force:true});});
    const echo=path.join(root,'argument echo.cjs');
    fs.writeFileSync(echo,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const values=["--source-root=C:\\Vault's $(Get-Location)\\",'漢字 空格','literal "quoted" text'];
    const script=foregroundCommand(root,[echo,...values],'argv');
    const run=spawnSync('pwsh',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
        {encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(run.status,0,run.error?.message || run.stderr);
    const logRoot=path.join(root,'logs'),runs=fs.readdirSync(logRoot);
    assert.equal(runs.length,1);
    const stdout=path.join(logRoot,runs[0],'stdout.log'),stderr=path.join(logRoot,runs[0],'stderr.log');
    assert.deepEqual(JSON.parse(fs.readFileSync(stdout,'utf8')),values);
    assert.equal(fs.readFileSync(stderr,'utf8'),'');
});
