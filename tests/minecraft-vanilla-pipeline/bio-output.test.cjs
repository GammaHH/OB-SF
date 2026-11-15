const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBIOOutput } = require("../../BIO相關模組/MC解析器模塊/bio/bio_output");
const reader = require("../../BIO相關模組/搜尋介面模塊/bio_reader_v4");

const machine = (name, output = "") => "- **生產設備**：(Machine:: [[" + name + "]])\n" +
    "\t**合成所需**：\n\t- [item:: [[鐵粉]]] (qty:: 1)\n" + (output ? "\t- [output:: " + output + "]\n" : "");
const bio = body => "---\ntype: mc-item\noutput: 7\ncustom: 保留\n---\n\n# 合成/取得\n### 常規\n\n" + body;

test("legacy YAML output is deleted without migrating its value into machine recipes", () => {
    const original = bio(machine("冶煉爐") + "\n" + machine("高爐", 9) + "\n# 用途\n![[圖片.png]]\n手寫文字\n");
    const result = normalizeBIOOutput(original);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.text, original.replace("output: 7\n", ""));
    assert.doesNotMatch(result.text, /\[output:: 7\]/);
    assert.deepEqual(reader.parseBIO(result.text).recipes.map(route => route.output), [1, 9]);
    assert.equal(normalizeBIOOutput(result.text).text, result.text);
});

test("YAML output values including invalid and duplicate values are simply removed", () => {
    for (const output of ["output: unknown\n", "output: 0\noutput: 4\n", "output: null\n"]) {
        const input = bio(machine("工作台")).replace("output: 7\n", output);
        const result = normalizeBIOOutput(input);
        assert.deepEqual(result.diagnostics, []);
        assert.doesNotMatch(result.text, /^output:/m);
        assert.equal(result.text, input.replace(output, ""));
    }
});

test("body output examples, external acquisition, Tag rows and custom YAML are preserved", () => {
    const body = "### 外部取得\n- 採集：砍樹\n### Tag 代表材料\n- [item:: [[橡木原木]]]\n" +
        "```yaml\noutput: 8\n```\n<!-- output: 9 -->\n- [note:: output: 6]\n";
    const input = bio(body).replace("custom: 保留", "custom: 保留\nother_output: 3\nmetadata:\n  output: 4");
    const result = normalizeBIOOutput(input);
    assert.ok(result.text.endsWith(body));
    assert.match(result.text, /other_output: 3\nmetadata:\n  output: 4/);
    assert.doesNotMatch(result.text, /\[output::/);
});

test("CRLF and a final YAML output field remain structurally intact", () => {
    const input = ("---\ntype: mc-item\noutput: 7\n---\n\n### 常規\n" + machine("工作台")).replaceAll("\n", "\r\n");
    const result = normalizeBIOOutput(input);
    assert.doesNotMatch(result.text, /^output:/m);
    assert.match(result.text, /^---\r\ntype: mc-item\r\n(?:\r\n)?---\r\n/);
    assert.equal(result.text.replaceAll("\r\n", "").includes("\n"), false);
    assert.equal(normalizeBIOOutput(result.text).text, result.text);
});

test("documents without root YAML output remain unchanged", () => {
    for (const input of [bio(machine("工作台")).replace("output: 7\n", ""), "```yaml\noutput: 7\n```\n", "---\noutput: 7\n"]) {
        assert.deepEqual(normalizeBIOOutput(input), { text: input, diagnostics: [] });
    }
});
