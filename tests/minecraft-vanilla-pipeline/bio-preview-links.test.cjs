const test = require("node:test");
const assert = require("node:assert/strict");
const { rewriteBIOForPreview } = require("../../BIO相關模組/MC解析器模塊/bio/bio_preview");

function fixture() {
    const members = Array.from({ length: 12 }, (_, index) => "minecraft:wood_" + index);
    const targets = new Map(), names = new Map();
    const root = "MC-自動化BIO/preview/piston/batch";
    for (let index = 0; index < members.length; index++) {
        const name = "木材" + index, target = root + "/" + name + ".preview";
        targets.set(members[index], { target, label: name });
        for (const alias of [name, "MC/" + name, target, members[index]]) names.set(alias, members[index]);
    }
    const tagId = "minecraft:planks", target = root + "/任意木材.preview";
    targets.set("tag:" + tagId, { target, label: "任意木材" });
    for (const alias of ["任意木材", "MC/任意木材", target]) names.set(alias, "tag:" + tagId);
    const tagMembers = new Map([[tagId, members]]);
    const options = { targets, tagMembers, resolveName: value => names.get(value) || value };
    const metadata = overrides => ({ kind: "tag", id: tagId, defaultName: "木材0",
        choices: members.map((id, index) => ({ name: "木材" + index, label: "木材" + index, type: "item", qty: 1 })), ...overrides });
    const comment = value => "\t<!-- obsf:choices " + JSON.stringify(value) + " -->\n";
    const start = "### 合成配方\n##### Minecraft 原版\n- (Machine:: [[工作台]])\n";
    const row = "\t- [item:: [[木材0|任意木材]]] (qty:: 3)\n";
    return { members, targets, names, tagId, target, options, metadata, comment, start, row };
}

test("full twelve-member native Tag choices collapse only into the matching next material row", () => {
    const f = fixture(), input = f.start + f.comment(f.metadata()) + f.row + "\t- [output:: 1]\n";
    const result = rewriteBIOForPreview(input, f.options);
    assert.deepEqual(result.diagnostics, []);
    assert.doesNotMatch(result.text, /obsf:choices/);
    assert.ok(result.text.includes("\t- [item:: [[" + f.target + "|任意木材]]] (qty:: 3)"));
    assert.match(result.text, /\[output:: 1\]/);
    assert.equal(rewriteBIOForPreview(result.text, f.options).text, result.text);
});

test("existing direct collection links and plain Tag references rebind without requiring inline metadata", () => {
    const f = fixture();
    for (const row of ["- [item:: [[MC/任意木材|原名稱]]] (qty:: 8)\n", "- [item:: #minecraft:planks] (qty:: 8)\n"]) {
        const result = rewriteBIOForPreview(f.start + row, f.options);
        assert.ok(result.text.includes(f.target));
        assert.match(result.text, /\(qty:: 8\)/);
        if (row.includes("原名稱")) assert.ok(result.text.includes("|原名稱]]"));
    }
});

test("partial member sets and non-unit choice quantities remain precise inline choices", () => {
    const f = fixture();
    for (const value of [f.metadata({ choices: f.metadata().choices.slice(1) }),
        f.metadata({ choices: f.metadata().choices.map(choice => ({ ...choice, qty: 2 })) }),
        f.metadata({ kind: "alternatives" })]) {
        const result = rewriteBIOForPreview(f.start + f.comment(value) + f.row, f.options);
        const metadata = JSON.parse(result.text.match(/<!-- obsf:choices (.+) -->/)[1]);
        assert.equal(metadata.choices.length, value.choices.length);
        assert.equal(metadata.choices[0].qty, value.choices[0].qty);
        assert.equal(metadata.defaultName, f.targets.get(f.members[0]).target);
        assert.equal(metadata.choices[0].name, f.targets.get(f.options.resolveName(value.choices[0].name)).target);
        assert.ok(result.text.includes("[[" + f.targets.get(f.members[0]).target + "|任意木材]]"));
        assert.match(result.text, /\(qty:: 3\)/);
        assert.equal(rewriteBIOForPreview(result.text, f.options).text, result.text);
    }
});

test("equivalent native or derived sets use a unique actual target and never guess by label", () => {
    const f = fixture(), source = "minecraft:wooden_tool_materials";
    f.options.tagMembers.set(source, [...f.members]);
    const input = f.start + f.comment(f.metadata({ id: source })) + f.row;
    const result = rewriteBIOForPreview(input, f.options);
    assert.doesNotMatch(result.text, /obsf:choices/);
    assert.ok(result.text.includes(f.target));
    f.targets.delete("tag:" + f.tagId);
    f.options.tagMembers.set("group:obsf:color_family/wood", [...f.members]);
    f.targets.set("group:obsf:color_family/wood", { target: f.target });
    assert.doesNotMatch(rewriteBIOForPreview(input, f.options).text, /obsf:choices/);
    f.options.tagMembers.set("minecraft:other_woods", [...f.members]);
    f.targets.set("tag:minecraft:other_woods", { target: "other-batch/任意木材.preview" });
    const ambiguous = rewriteBIOForPreview(input, f.options);
    assert.match(ambiguous.text, /obsf:choices/);
    assert.ok(ambiguous.diagnostics.some(value => value.code === "AMBIGUOUS_PREVIEW_COLLECTION"));
});

test("YAML, images, manual links, fenced examples and ordinary HTML metadata remain intact", () => {
    const f = fixture();
    const prefix = "---\ncustom: '[[木材0]]'\n---\n![[木材0.png]]\n手寫 [[木材0]]\n" +
        "````md\n```\n- [item:: [[木材0]]] (qty:: 1)\n````\n" +
        "<!-- manual\n- [item:: [[木材0]]] (qty:: 1)\n-->\n";
    const result = rewriteBIOForPreview(prefix + f.start + "- [drop:: [[木材0]]] (qty:: 2)\n", f.options);
    assert.ok(result.text.startsWith(prefix));
    assert.ok(result.text.includes("- [drop:: [[" + f.targets.get(f.members[0]).target + "|木材0]]] (qty:: 2)"));
});

test("pending choices never collapse across heading, Machine, output, NOTE, comment or code boundaries", () => {
    const f = fixture();
    for (const boundary of ["### 其他\n", "- (Machine:: [[高爐]])\n", "- [output:: 1]\n", "- [note:: 手動備註]\n",
        "<!-- preferred -->\n", "```text\nexample\n```\n"]) {
        const result = rewriteBIOForPreview(f.start + f.comment(f.metadata()) + boundary + f.row, f.options);
        assert.match(result.text, /obsf:choices/);
        assert.ok(result.text.includes("[[" + f.targets.get(f.members[0]).target + "|任意木材]]"));
    }
    const noRoute = rewriteBIOForPreview(f.comment(f.metadata()) + f.row, f.options);
    assert.match(noRoute.text, /obsf:choices/);
    const wrongRow = f.start + f.comment(f.metadata()) + "- [item:: [[minecraft:unrelated]]] (qty:: 1)\n" + f.row;
    assert.match(rewriteBIOForPreview(wrongRow, f.options).text, /obsf:choices/);
});

test("malformed managed choices remain verbatim with a diagnostic and never consume another route", () => {
    const f = fixture(), malformed = "\t<!-- obsf:choices {broken JSON} -->\n";
    const result = rewriteBIOForPreview(f.start + malformed + f.row, f.options);
    assert.ok(result.text.includes(malformed));
    assert.equal(result.diagnostics[0].code, "INVALID_PREVIEW_CHOICES");
    const crlf = rewriteBIOForPreview((f.start + f.comment(f.metadata()) + f.row).replaceAll("\n", "\r\n"), f.options);
    assert.equal(crlf.text.replaceAll("\r\n", "").includes("\n"), false);
});
