const fs = require("node:fs");
const path = require("node:path");

const vanilla = require("../../模板放置處/MC解析器模塊");
const {
    readFileWithRetrySync,
    writeFileWithRetrySync,
    replaceFileWithRetrySync
} = require("./file-write-retry.cjs");

function completeLegacyMarkdown(content) {
    return content.includes("<!-- obsf:review-decision-registry:start -->") &&
        content.includes("<!-- obsf:review-decision-registry:end -->");
}

function validRegistryJSON(content) {
    try {
        vanilla.dependencies.parseReviewDecisionRegistryJSON(content);
        return true;
    } catch {
        return false;
    }
}

function readReviewDecisionStore({ jsonPath, legacyMarkdownPath }) {
    if (fs.existsSync(jsonPath)) {
        const content = readFileWithRetrySync(jsonPath, {
            validate: validRegistryJSON
        }).content;
        return {
            registry: vanilla.dependencies.parseReviewDecisionRegistryJSON(content),
            source: "json"
        };
    }
    if (fs.existsSync(legacyMarkdownPath)) {
        const content = readFileWithRetrySync(legacyMarkdownPath, {
            validate: completeLegacyMarkdown
        }).content;
        return {
            registry: vanilla.dependencies.parseReviewDecisionRegistry(content),
            source: "legacy-markdown"
        };
    }
    return {
        registry: vanilla.dependencies.emptyReviewDecisionRegistry(),
        source: "empty"
    };
}

function writeAtomicJSON(absolutePath, content) {
    const temporaryPath = `${absolutePath}.tmp`;
    const previousPath = `${absolutePath}.previous`;
    writeFileWithRetrySync(temporaryPath, content);
    const verified = fs.readFileSync(temporaryPath, "utf8");
    if (!validRegistryJSON(verified)) {
        throw new Error(`Decision Registry temporary JSON 驗證失敗：${temporaryPath}`);
    }
    if (fs.existsSync(absolutePath)) {
        fs.copyFileSync(absolutePath, previousPath);
    }
    replaceFileWithRetrySync(temporaryPath, absolutePath);
    return { previousPath: fs.existsSync(previousPath) ? previousPath : null };
}

function writeReviewDecisionStore(
    registry,
    { jsonPath, summaryMarkdownPath }
) {
    const json = vanilla.dependencies.serializeReviewDecisionRegistryJSON(registry);
    const roundTrip = vanilla.dependencies.parseReviewDecisionRegistryJSON(json);
    if (Object.keys(roundTrip.targets).length !==
        Object.keys(registry.targets ?? {}).length) {
        throw new Error("Decision Registry JSON round-trip target count 不一致");
    }
    const result = writeAtomicJSON(jsonPath, json);
    writeFileWithRetrySync(
        summaryMarkdownPath,
        vanilla.dependencies.renderReviewDecisionSummary(roundTrip)
    );
    return result;
}

function backupLegacyMarkdown(legacyMarkdownPath, backupRoot) {
    if (!fs.existsSync(legacyMarkdownPath)) return null;
    const content = fs.readFileSync(legacyMarkdownPath, "utf8");
    if (!completeLegacyMarkdown(content)) {
        throw new Error("Legacy Decision Registry Markdown 不完整，拒絕備份／遷移");
    }
    fs.mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
        backupRoot,
        `Minecraft Review Decisions legacy ${stamp}.md`
    );
    fs.copyFileSync(legacyMarkdownPath, backupPath);
    return backupPath;
}

module.exports = {
    completeLegacyMarkdown,
    validRegistryJSON,
    readReviewDecisionStore,
    writeReviewDecisionStore,
    backupLegacyMarkdown
};
