#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const AsyncFunction =
    Object.getPrototypeOf(async function () {}).constructor;

const vaultRoot =
    path.resolve(__dirname, "..");

const templatePath =
    path.join(
        vaultRoot,
        "模板放置處",
        "OB-SF Vanilla Parser V1.1.md"
    );

const generatedPaths = new Set([
    "MC-自動化實作/Minecraft Normalized Recipes.json",
    "MC-自動化實作/Minecraft Tag Registry.json",
    "MC-自動化實作/Minecraft Recipe Manifest.md"
]);


function toVaultPath(absolutePath) {
    return path.relative(vaultRoot, absolutePath)
        .split(path.sep)
        .join("/");
}


function fromVaultPath(vaultPath) {
    const absolutePath = path.resolve(
        vaultRoot,
        ...vaultPath.split("/")
    );

    const relative = path.relative(vaultRoot, absolutePath);
    if (
        relative.startsWith("..") ||
        path.isAbsolute(relative)
    ) {
        throw new Error(`Vault path 超出 workspace：${vaultPath}`);
    }

    return absolutePath;
}


function fileObject(absolutePath) {
    return {
        path: toVaultPath(absolutePath),
        basename: path.basename(
            absolutePath,
            path.extname(absolutePath)
        ),
        extension:
            path.extname(absolutePath).slice(1)
    };
}


function walkFiles(root) {
    const files = [];

    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolutePath);
            if (entry.isFile()) files.push(fileObject(absolutePath));
        }
    }

    visit(root);
    return files;
}


function assertGeneratedTarget(vaultPath) {
    if (!generatedPaths.has(vaultPath)) {
        throw new Error(`V1.1 harness 拒絕寫入非 generated target：${vaultPath}`);
    }
}


function extractProgram(template) {
    const match = template.match(/^\s*<%\*([\s\S]*?)_?%>\s*$/);
    if (!match) {
        throw new Error("找不到 V1.1 Templater program block");
    }
    return match[1];
}


async function main() {
    const minecraftRoot =
        path.join(vaultRoot, "參考資料", "Minecraft");

    const sourceFiles =
        walkFiles(minecraftRoot);

    const notices = [];

    function Notice(message) {
        notices.push(String(message));
    }

    const app = {
        vault: {
            adapter: {
                basePath: vaultRoot
            },
            getFiles() {
                return sourceFiles;
            },
            getAbstractFileByPath(vaultPath) {
                const absolutePath = fromVaultPath(vaultPath);
                if (!fs.existsSync(absolutePath)) return null;
                const stat = fs.statSync(absolutePath);
                return stat.isFile()
                    ? fileObject(absolutePath)
                    : { path: vaultPath, name: path.basename(absolutePath) };
            },
            async read(file) {
                return fs.readFileSync(
                    fromVaultPath(file.path),
                    "utf8"
                );
            },
            async createFolder(vaultPath) {
                fs.mkdirSync(
                    fromVaultPath(vaultPath),
                    { recursive: true }
                );
            },
            async modify(file, content) {
                assertGeneratedTarget(file.path);
                fs.writeFileSync(
                    fromVaultPath(file.path),
                    content,
                    "utf8"
                );
            },
            async create(vaultPath, content) {
                assertGeneratedTarget(vaultPath);
                fs.writeFileSync(
                    fromVaultPath(vaultPath),
                    content,
                    "utf8"
                );
            }
        }
    };

    const template =
        fs.readFileSync(templatePath, "utf8");

    const execute =
        new AsyncFunction(
            "app",
            "Notice",
            "tp",
            "require",
            extractProgram(template)
        );

    await execute(app, Notice, {}, require);

    process.stdout.write(`${JSON.stringify({
        generated: [...generatedPaths],
        notices
    }, null, 2)}\n`);
}


main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
