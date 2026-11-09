const fs = require("node:fs");
const path = require("node:path");

const RETRYABLE_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM", "EACCES"]);
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function wait(milliseconds) {
    Atomics.wait(WAIT_BUFFER, 0, 0, milliseconds);
}

function writeFileWithRetrySync(
    absolutePath,
    content,
    {
        maxAttempts = 20,
        baseDelayMs = 25,
        fileSystem = fs,
        waitFunction = wait
    } = {}
) {
    fileSystem.mkdirSync(path.dirname(absolutePath), { recursive: true });
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            fileSystem.writeFileSync(absolutePath, content, "utf8");
            return { attempts: attempt };
        } catch (error) {
            lastError = error;
            if (!RETRYABLE_CODES.has(error?.code) || attempt === maxAttempts) {
                throw error;
            }
            waitFunction(Math.min(baseDelayMs * attempt, 100));
        }
    }
    throw lastError;
}

function readFileWithRetrySync(
    absolutePath,
    {
        maxAttempts = 20,
        baseDelayMs = 25,
        fileSystem = fs,
        waitFunction = wait,
        validate = () => true
    } = {}
) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const content = fileSystem.readFileSync(absolutePath, "utf8");
            if (validate(content)) return { content, attempts: attempt };
            const error = new Error(`檔案內容尚未完整：${absolutePath}`);
            error.code = "EINCOMPLETE";
            throw error;
        } catch (error) {
            lastError = error;
            const retryable = RETRYABLE_CODES.has(error?.code) ||
                error?.code === "EINCOMPLETE";
            if (!retryable || attempt === maxAttempts) throw error;
            waitFunction(Math.min(baseDelayMs * attempt, 100));
        }
    }
    throw lastError;
}

function replaceFileWithRetrySync(
    sourcePath,
    destinationPath,
    {
        maxAttempts = 20,
        baseDelayMs = 25,
        fileSystem = fs,
        waitFunction = wait
    } = {}
) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            fileSystem.renameSync(sourcePath, destinationPath);
            return { attempts: attempt };
        } catch (error) {
            lastError = error;
            if (!RETRYABLE_CODES.has(error?.code) || attempt === maxAttempts) {
                throw error;
            }
            waitFunction(Math.min(baseDelayMs * attempt, 100));
        }
    }
    throw lastError;
}

function isFrontmatterOnlyPlaceholder(content, forbiddenFields = ["type", "target"]) {
    const source = String(content ?? "");
    if (source.trim() === "") return true;
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return false;
    const fields = new Set(
        frontmatter[1]
            .split(/\r?\n/)
            .map(line => line.match(/^([A-Za-z][A-Za-z0-9_-]*):/)?.[1])
            .filter(Boolean)
    );
    if (forbiddenFields.some(field => fields.has(field))) return false;
    return source.slice(frontmatter[0].length).trim() === "";
}

module.exports = {
    writeFileWithRetrySync,
    readFileWithRetrySync,
    replaceFileWithRetrySync,
    isFrontmatterOnlyPlaceholder
};
