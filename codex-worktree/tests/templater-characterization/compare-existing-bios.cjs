const fs = require("node:fs");
const path = require("node:path");

const {
  compareSignatures,
  createTemplaterHarness,
  parserOwnedSignature,
} = require("./templater-harness.cjs");

const vaultRoot = path.resolve(__dirname, "..", "..");
const referenceRoot = path.join(vaultRoot, "參考資料");
const harness = createTemplaterHarness(vaultRoot);

const JAVA_TEMPLATE = "模板放置處/!模板-解析常規插件物品.md";
const YAML_TEMPLATE = "模板放置處/!模板-描述機器or工具.md";
const MAX_FAILURES = readMaxFailures(process.argv.slice(2));

function readMaxFailures(argumentsList) {
  const argument = argumentsList.find((value) => value.startsWith("--max-failures="));
  if (!argument) return 30;
  const parsed = Number(argument.slice("--max-failures=".length));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 30;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function directReferenceSources() {
  return fs
    .readdirSync(referenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      content: fs.readFileSync(path.join(referenceRoot, entry.name), "utf8"),
    }));
}

function chooseTemplate(itemId, sources) {
  const escaped = escapeRegExp(itemId);
  const javaRegistration = new RegExp(
    "\\bnew\\s+[A-Za-z0-9_]+\\s*\\(" +
      "\\s*itemGroups\\.[A-Za-z0-9_]+\\s*," +
      "\\s*SlimefunItems\\." +
      escaped +
      "\\b",
  );
  const yamlBlock = new RegExp(`^${escaped}:`, "m");

  if (
    sources.some(
      (source) => /\.(?:java|txt|md)$/i.test(source.name) && javaRegistration.test(source.content),
    )
  ) {
    return JAVA_TEMPLATE;
  }
  if (
    sources.some(
      (source) => /\.(?:ya?ml|txt|md)$/i.test(source.name) && yamlBlock.test(source.content),
    )
  ) {
    return YAML_TEMPLATE;
  }
  return null;
}

function promptName(file, frontmatter) {
  const aliases = Array.isArray(frontmatter.aliases)
    ? frontmatter.aliases
    : frontmatter.aliases
      ? [frontmatter.aliases]
      : [];
  const additionalAliases = aliases
    .map(String)
    .filter((alias) => alias !== frontmatter.id && alias !== file.basename && !/\s/.test(alias));
  return [file.basename, ...additionalAliases].join(" ");
}

function compactDifference(difference) {
  if (difference.key !== "significantLines") return difference;
  return {
    key: difference.key,
    existing: difference.existing,
    generated: difference.generated,
  };
}

async function main() {
  const sources = directReferenceSources();
  const existingItems = harness.snapshot.markdownFiles
    .map((file) => ({
      file,
      frontmatter: harness.snapshot.frontmatterByPath.get(file.path) || {},
      content: harness.snapshot.contentByPath.get(file.path),
    }))
    .filter((entry) => entry.frontmatter.type === "sf-item" && entry.frontmatter.id)
    .sort((left, right) => left.frontmatter.id.localeCompare(right.frontmatter.id));

  const results = {
    totalExistingSfItems: existingItems.length,
    compared: 0,
    matched: 0,
    different: 0,
    noDirectSource: 0,
    executionErrors: 0,
    templatesCompared: { "java-regex": 0, "yaml-regex": 0 },
    differenceKeys: {},
  };
  const failures = [];

  for (const existing of existingItems) {
    const itemId = String(existing.frontmatter.id);
    const templatePath = chooseTemplate(itemId, sources);
    if (!templatePath) {
      results.noDirectSource += 1;
      failures.push({ id: itemId, kind: "no-direct-source", bio: existing.file.path });
      continue;
    }

    try {
      const execution = await harness.runTemplate({
        templatePath,
        name: promptName(existing.file, existing.frontmatter),
        itemId,
        suggestedPath: path.posix.dirname(existing.file.path),
      });
      if (execution.createdFiles.length !== 1) {
        throw new Error(`Expected one generated BIO, got ${execution.createdFiles.length}`);
      }

      results.compared += 1;
      const templateName = templatePath === JAVA_TEMPLATE ? "java-regex" : "yaml-regex";
      results.templatesCompared[templateName] += 1;
      const differences = compareSignatures(
        parserOwnedSignature(existing.content),
        parserOwnedSignature(execution.createdFiles[0].content),
      );
      if (differences.length === 0) {
        results.matched += 1;
      } else {
        results.different += 1;
        for (const difference of differences) {
          results.differenceKeys[difference.key] =
            (results.differenceKeys[difference.key] || 0) + 1;
        }
        failures.push({
          id: itemId,
          kind: "output-difference",
          bio: existing.file.path,
          template: templateName,
          differences: differences.map(compactDifference),
        });
      }
    } catch (error) {
      results.executionErrors += 1;
      failures.push({
        id: itemId,
        kind: "execution-error",
        bio: existing.file.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const shownFailures = failures.slice(0, MAX_FAILURES);
  process.stdout.write(
    `${JSON.stringify(
      {
        summary: results,
        failuresShown: shownFailures.length,
        failuresOmitted: Math.max(0, failures.length - shownFailures.length),
        failures: shownFailures,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
