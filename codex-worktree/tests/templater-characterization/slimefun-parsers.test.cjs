const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  compareSignatures,
  createTemplaterHarness,
  findMarkdownById,
  parserOwnedSignature,
} = require("./templater-harness.cjs");

const vaultRoot = path.resolve(__dirname, "..", "..");
const harness = createTemplaterHarness(vaultRoot);

const JAVA_TEMPLATE = "模板放置處/!模板-解析常規插件物品.md";
const YAML_TEMPLATE = "模板放置處/!模板-描述機器or工具.md";

async function characterize(options) {
  const result = await harness.runTemplate(options);
  assert.equal(result.createdFiles.length, 1, `Expected one BIO for ${options.itemId}`);
  return { ...result, created: result.createdFiles[0] };
}

test("Java Regex parser characterizes BATTERY against the checked-in BIO", async () => {
  const result = await characterize({
    templatePath: JAVA_TEMPLATE,
    name: "電池",
    itemId: "BATTERY",
  });

  assert.equal(result.created.targetFolder, "SF-科技元件(原版)");
  assert.match(result.created.content, /^---\ntype: sf-item\nid: BATTERY\nlevel: 10\noutput: 1\n/m);
  assert.match(result.created.content, /\(Machine:: \[\[強化工作台\]\]\)/);
  assert.match(result.created.content, /\[item:: ZINC_INGOT\] \(qty:: 2\)/);
  assert.match(result.created.content, /\[item:: SULFATE\] \(qty:: 2\)/);
  assert.match(result.created.content, /\[item:: COPPER_INGOT\] \(qty:: 2\)/);
  assert.match(result.created.content, /\[item:: \[\[紅石\]\]\] \(qty:: 1\)/);
  assert.ok(result.notices.some((notice) => notice.includes("預設為 1")));

  const existing = findMarkdownById(harness.snapshot, "BATTERY");
  assert.ok(existing, "Expected the existing BATTERY BIO fixture");
  assert.deepEqual(
    compareSignatures(
      parserOwnedSignature(existing.content),
      parserOwnedSignature(result.created.content),
    ),
    [],
  );
});

test("Java Regex parser characterizes GOLD_PAN against the checked-in BIO", async () => {
  const result = await characterize({
    templatePath: JAVA_TEMPLATE,
    name: "淘金盤",
    itemId: "GOLD_PAN",
  });

  assert.equal(result.created.targetFolder, "SF-工具(原版)");
  assert.match(result.created.content, /^level: 5$/m);
  assert.match(result.created.content, /^output: 1$/m);
  assert.match(result.created.content, /\[item:: \[\[石頭\]\]\] \(qty:: 5\)/);
  assert.match(result.created.content, /\[item:: \[\[碗\]\]\] \(qty:: 1\)/);

  const existing = findMarkdownById(harness.snapshot, "GOLD_PAN");
  assert.ok(existing, "Expected the existing GOLD_PAN BIO fixture");
  const differences = compareSignatures(
    parserOwnedSignature(existing.content),
    parserOwnedSignature(result.created.content),
  );
  assert.deepEqual(differences, [
    {
      key: "significantLines",
      existing: [
        "- **生產設備**：(Machine:: [[強化工作台]])",
        "- [item:: [[石頭]]] (qty:: 5)",
        "- [item:: BOWL] (qty:: 1)",
      ],
      generated: [
        "- **生產設備**：(Machine:: [[強化工作台]])",
        "- [item:: [[石頭]]] (qty:: 5)",
        "- [item:: [[碗]]] (qty:: 1)",
      ],
    },
  ]);
});

test("Java Regex parser preserves an explicit SlimefunItemStack output quantity", async () => {
  const result = await characterize({
    templatePath: JAVA_TEMPLATE,
    name: "銅線",
    itemId: "COPPER_WIRE",
  });

  assert.equal(result.created.targetFolder, "SF-科技元件(原版)");
  assert.match(result.created.content, /^output: 8$/m);
  assert.match(result.created.content, /\(Machine:: \[\[強化工作台\]\]\)/);
  assert.match(result.created.content, /\[item:: COPPER_INGOT\] \(qty:: 3\)/);
  assert.ok(!result.notices.some((notice) => notice.includes("預設為 1")));
});

test("YAML Regex parser characterizes HAIMAN_AMETHYST_DUST against the checked-in BIO", async () => {
  const result = await characterize({
    templatePath: YAML_TEMPLATE,
    name: "紫水晶粉",
    itemId: "HAIMAN_AMETHYST_DUST",
    suggestedPath: "SF-海曼科技院/科技材料",
  });

  assert.equal(result.created.targetFolder, "SF-海曼科技院/科技材料");
  assert.match(result.created.content, /^level: 16$/m);
  assert.match(result.created.content, /^output: 1$/m);
  assert.match(result.created.content, /\(Machine:: \[\[冶煉爐\]\]\)/);
  assert.match(result.created.content, /\[item:: AMETHYST_SHARD\] \(qty:: 1\)/);
  assert.ok(result.notices.some((notice) => notice === "✅ 找到 recipe:"));

  const existing = findMarkdownById(harness.snapshot, "HAIMAN_AMETHYST_DUST");
  assert.ok(existing, "Expected the existing HAIMAN_AMETHYST_DUST BIO fixture");
  assert.deepEqual(
    compareSignatures(
      parserOwnedSignature(existing.content),
      parserOwnedSignature(result.created.content),
    ),
    [],
  );
});
