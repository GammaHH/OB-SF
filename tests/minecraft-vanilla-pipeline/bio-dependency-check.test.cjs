const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDependencies } = require('../../scripts/lib/bio-dependency-check.cjs');
const reader = require('../../BIO相關模組/搜尋介面模塊/bio_reader_v4');

test('equipment and intermediate materials appear in the cycle witness', () => {
    const graph = new Map([
        ['crystal', [['table'], ['sand']]], ['sand', []],
        ['table', [['planks-tag']]], ['planks-tag', [['planks']]],
        ['planks', [['table'], ['log']]], ['log', []]
    ]);
    const result = checkDependencies(graph, new Set([JSON.stringify(['crystal', 'table']), JSON.stringify(['planks', 'table'])]));
    assert.equal(result.resolved.has('crystal'), false);
    assert.deepEqual(result.cycleFrom('crystal'), { cycle: ['table', 'planks-tag', 'planks', 'table'], equipment: true });
    graph.set('planks', [['log']]);
    assert.equal(checkDependencies(graph).resolved.has('crystal'), true);
});

test('a productive alternative avoids false cycles but cannot replace a required machine', () => {
    const graph = new Map([['item', [['tag']]], ['tag', [['item', 'log']]], ['log', []]]);
    assert.equal(checkDependencies(graph).resolved.has('item'), true);
    graph.get('item').push(['machine']);
    graph.set('machine', [['item']]);
    assert.equal(checkDependencies(graph).resolved.has('item'), false);
});

test('missing dependencies block without inventing a cycle', () => {
    const result = checkDependencies(new Map([['item', [[]]]]));
    assert.equal(result.resolved.has('item'), false);
    assert.equal(result.cycleFrom('item'), null);
});

test('direct equipment cycles and ordinary material cycles are distinguished', () => {
    const graph = new Map([['table', [['table']]]]);
    assert.equal(checkDependencies(graph, new Set([JSON.stringify(['table', 'table'])])).cycleFrom('table').equipment, true);
    assert.equal(checkDependencies(graph).cycleFrom('table').equipment, false);
});

test('publication and V4 recognize both current and legacy manual machine spellings', () => {
    for (const name of ['', '無/手動', '無/從背包合成', '手動/無', '外部取得']) assert.equal(reader.isManualMachine(name), true);
    assert.equal(reader.isManualMachine('工作台'), false);
});
