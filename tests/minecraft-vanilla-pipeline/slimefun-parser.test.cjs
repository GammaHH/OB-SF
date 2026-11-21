const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PINNED_COMMIT, normalizeSlimefunAST, renderManifest } = require('../../BIO相關模組/Slimefun解析器模塊/slimefun_parser');
const root = path.resolve(__dirname,'../..');

test('JDK AST parses real Java syntax without Bukkit dependencies and preserves IDs, slots, quantities and diagnostics', t => {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'obsf-slimefun-test-'));
    t.after(()=>{ assert.equal(path.dirname(temp),path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith('obsf-slimefun-test-')); fs.rmSync(temp,{recursive:true,force:true}); });
    const output=path.join(temp,'ast.json');
    const result=spawnSync(process.env.OBSF_JAVA || 'java',['-Dfile.encoding=UTF-8',path.join(root,'scripts/java/SlimefunAst.java'),path.join(root,'tests/fixtures/slimefun-v1'),output],
        {encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(result.status,0,result.error?.message || result.stderr);
    assert.ok(fs.statSync(output).size>0);
    const ast=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(ast.diagnostics.length,0);
    assert.equal(ast.registrations.length,18);
    const source={repository:'Slimefun/Slimefun4',commit:PINNED_COMMIT};
    const registry=normalizeSlimefunAST(ast,source);
    const can=registry.items.find(value=>value.id==='slimefun:CAN');
    assert.ok(can);
    assert.equal(can.javaConstant,'TIN_CAN');
    assert.equal(registry.items.some(value=>value.id==='slimefun:TIN_CAN'),false);
    assert.equal(can.recipes[0].slots.length,9);
    assert.equal(can.recipes[0].slots[1],null);
    assert.deepEqual(can.recipes[0].ingredients,[{kind:'item',id:'minecraft:iron_ingot',qty:4},{kind:'item',id:'slimefun:IRON_DUST',qty:1}]);
    assert.equal(can.recipes.length,2);
    assert.equal(can.recipes[0].status,'REVIEW');
    assert.equal(can.recipes[0].layout,'unknown');
    assert.equal(can.recipes[0].provenance.output.basis,'PROVEN_DEFAULT');
    const chain=registry.items.find(value=>value.id==='slimefun:CHAIN').recipes[0];
    assert.equal(chain.output,8);
    assert.equal(chain.provenance.output.basis,'EXPLICIT');
    const alloy=registry.items.find(value=>value.id==='slimefun:ALLOY').recipes[0];
    assert.equal(alloy.resolvedFrom,'inherited-constructor');
    assert.equal(alloy.ingredients[0].qty,2);
    assert.ok(registry.diagnostics.some(value=>value.stage==='SUBCLASS_BEHAVIOR' &&
        value.itemId==='slimefun:ALLOY' && value.status==='REVIEW'));
    assert.ok(registry.diagnostics.some(value=>/IF/.test(value.message)));
    const potion=registry.items.find(value=>value.id==='slimefun:POTION');
    assert.equal(potion.name,can.name);
    assert.equal(potion.recipes.length,1);
    assert.equal(potion.recipes[0].additionalSources.length,1);
    assert.equal(potion.recipes[0].ingredients[0].qty,2);
    assert.equal(potion.recipes[0].provenance.constructors.length,5);
    assert.ok(potion.recipes[0].provenance.identity.source.line>0);
    assert.ok(registry.diagnostics.some(value=>value.stage==='CONSTRUCTOR' && /委派循環/.test(value.message)));
    assert.ok(registry.diagnostics.some(value=>value.stage==='CONSTRUCTOR' && /overload.*AmbiguousItem/.test(value.message)));
    const legacy=registry.items.find(value=>value.id==='slimefun:LEGACY_ID').recipes[0];
    assert.equal(legacy.output,3);
    assert.equal(legacy.provenance.identity.basis,'constructor-id-argument');
    assert.ok(registry.diagnostics.some(value=>value.itemId==='slimefun:UNKNOWN_AMOUNT' &&
        value.stage==='OUTPUT' && value.outputEvidence.basis==='UNRESOLVED'));
    assert.equal(registry.items.some(value=>value.id==='slimefun:UNKNOWN_AMOUNT'),false);
    assert.equal(registry.items.find(value=>value.id==='slimefun:DIRECT_ID').recipes[0].status,'SPECIAL');
    assert.ok(registry.diagnostics.some(value=>value.itemId==='slimefun:PLASTIC_SHEET' &&
        value.stage==='MACHINE_SEMANTICS' && value.recipeType==='HEATED_PRESSURE_CHAMBER'));
    assert.equal(registry.items.some(value=>value.id==='slimefun:PLASTIC_SHEET'),false);
    const portable=registry.items.find(value=>value.id==='slimefun:PORTABLE').recipes[0];
    assert.equal(portable.status,'REVIEW');
    assert.equal(portable.output,1);
    assert.equal(portable.ingredients[0].qty,2);
    assert.ok(portable.provenance.handlerHooks[0].hook.line>0);
    assert.ok(portable.provenance.handlerHooks[0].callback.line>0);
    assert.ok(registry.diagnostics.some(value=>value.itemId==='slimefun:EAGER' &&
        value.stage==='SUBCLASS_BEHAVIOR'));
    assert.equal(registry.items.some(value=>value.id==='slimefun:EAGER'),false);
    for (const id of ['PLACEMENT', 'BOW_FIXTURE']) {
        const recipe=registry.items.find(value=>value.id==='slimefun:'+id).recipes[0];
        assert.equal(recipe.status,'REVIEW');
        assert.equal(recipe.provenance.handlerHooks.length,1);
    }
    assert.ok(can.recipes[0].source.line>0);
    assert.equal(normalizeSlimefunAST(ast,source).registryFingerprint,registry.registryFingerprint);
    assert.match(renderManifest(registry),/TIN_CAN|CAN/);
    assert.match(renderManifest(registry),new RegExp(PINNED_COMMIT));
    assert.throws(()=>normalizeSlimefunAST(ast,{...source,commit:'other'}),/commit/);
    assert.equal(fs.existsSync(path.join(temp,'CAN.md')),false);
});
