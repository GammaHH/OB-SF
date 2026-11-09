const assert = require("node:assert/strict");
const test = require("node:test");

const {
    writeFileWithRetrySync,
    readFileWithRetrySync,
    replaceFileWithRetrySync,
    isFrontmatterOnlyPlaceholder
} = require("../../scripts/lib/file-write-retry.cjs");

test("file writer retries transient Windows locks and preserves the requested content", () => {
    let writes = 0;
    const waits = [];
    const fileSystem = {
        mkdirSync() {},
        writeFileSync(path, content, encoding) {
            writes++;
            assert.equal(path, "C:\\vault\\review.md");
            assert.equal(content, "review content");
            assert.equal(encoding, "utf8");
            if (writes < 3) {
                const error = new Error("temporarily locked");
                error.code = "UNKNOWN";
                throw error;
            }
        }
    };
    const result = writeFileWithRetrySync(
        "C:\\vault\\review.md",
        "review content",
        {
            fileSystem,
            waitFunction: milliseconds => waits.push(milliseconds)
        }
    );
    assert.equal(result.attempts, 3);
    assert.deepEqual(waits, [25, 50]);
});

test("file writer does not retry non-transient errors", () => {
    let writes = 0;
    const fileSystem = {
        mkdirSync() {},
        writeFileSync() {
            writes++;
            const error = new Error("invalid path");
            error.code = "EINVAL";
            throw error;
        }
    };
    assert.throws(() => writeFileWithRetrySync(
        "C:\\vault\\review.md",
        "review content",
        { fileSystem, waitFunction() {} }
    ), /invalid path/);
    assert.equal(writes, 1);
});

test("file reader retries transient incomplete Obsidian content", () => {
    let reads = 0;
    const waits = [];
    const fileSystem = {
        readFileSync(path, encoding) {
            reads++;
            assert.equal(path, "C:\\vault\\review.md");
            assert.equal(encoding, "utf8");
            return reads < 3
                ? ""
                : "<!-- managed:start -->complete<!-- managed:end -->";
        }
    };
    const result = readFileWithRetrySync("C:\\vault\\review.md", {
        fileSystem,
        waitFunction: milliseconds => waits.push(milliseconds),
        validate: content =>
            content.includes("<!-- managed:start -->") &&
            content.includes("<!-- managed:end -->")
    });
    assert.equal(result.attempts, 3);
    assert.match(result.content, /complete/);
    assert.deepEqual(waits, [25, 50]);
    assert.equal(isFrontmatterOnlyPlaceholder([
        "---",
        "created: 2026-11-04 14:56",
        "updated: 2026-11-09 14:07",
        "---"
    ].join("\n")), true);
    assert.equal(isFrontmatterOnlyPlaceholder([
        "---",
        "type: minecraft-recipe-review",
        "target: minecraft:netherite_hoe",
        "---"
    ].join("\n")), false);
    assert.equal(isFrontmatterOnlyPlaceholder([
        "---",
        "created: 2026-11-04 14:56",
        "---",
        "partial body"
    ].join("\n")), false);
});

test("file reader does not retry non-transient errors", () => {
    let reads = 0;
    const fileSystem = {
        readFileSync() {
            reads++;
            const error = new Error("invalid path");
            error.code = "EINVAL";
            throw error;
        }
    };
    assert.throws(() => readFileWithRetrySync(
        "C:\\vault\\review.md",
        { fileSystem, waitFunction() {} }
    ), /invalid path/);
    assert.equal(reads, 1);
});

test("atomic file replacement retries transient Windows locks", () => {
    let renames = 0;
    const waits = [];
    const fileSystem = {
        renameSync(source, destination) {
            renames++;
            assert.equal(source, "C:\\vault\\registry.json.tmp");
            assert.equal(destination, "C:\\vault\\registry.json");
            if (renames < 3) {
                const error = new Error("temporarily locked");
                error.code = "EPERM";
                throw error;
            }
        }
    };
    const result = replaceFileWithRetrySync(
        "C:\\vault\\registry.json.tmp",
        "C:\\vault\\registry.json",
        {
            fileSystem,
            waitFunction: milliseconds => waits.push(milliseconds)
        }
    );
    assert.equal(result.attempts, 3);
    assert.deepEqual(waits, [25, 50]);
});
