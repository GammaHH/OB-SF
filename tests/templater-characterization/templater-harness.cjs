const fs = require("node:fs");
const path = require("node:path");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "node_modules",
]);

function toVaultPath(value) {
  return value.split(path.sep).join("/");
}

function fromVaultPath(vaultRoot, value) {
  return path.join(vaultRoot, ...value.split("/"));
}

function walkFiles(root, options = {}) {
  const ignored = options.ignoredDirectories || DEFAULT_IGNORED_DIRECTORIES;
  const result = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      if (entry.isFile()) result.push(absolutePath);
    }
  }

  visit(root);
  return result;
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return {};

  const frontmatter = {};
  const lines = match[1].split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const keyValue = lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyValue) continue;

    const [, key, rawValue = ""] = keyValue;
    const value = rawValue.trim();

    if (key === "aliases" && value === "") {
      const aliases = [];
      while (index + 1 < lines.length) {
        const aliasMatch = lines[index + 1].match(/^\s+-\s*(.*)$/);
        if (!aliasMatch) break;
        aliases.push(unquote(aliasMatch[1].trim()));
        index += 1;
      }
      frontmatter.aliases = aliases;
      continue;
    }

    if (key === "aliases" && value.startsWith("[") && value.endsWith("]")) {
      try {
        frontmatter.aliases = JSON.parse(value);
        continue;
      } catch {
        // Keep the raw value. Obsidian also tolerates several non-JSON YAML forms.
      }
    }

    frontmatter[key] = coerceScalar(unquote(value));
  }

  return frontmatter;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceScalar(value) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  return value;
}

function extractTemplaterProgram(templateText) {
  const match = templateText.match(/^\s*<%\*([\s\S]*?)_?%>\s*$/);
  if (!match) throw new Error("Template does not contain one <%* ... %> program block");
  return match[1];
}

function createVaultSnapshot(vaultRoot) {
  const allFiles = walkFiles(vaultRoot);
  const markdownFiles = [];
  const frontmatterByPath = new Map();
  const contentByPath = new Map();
  const directoryPaths = new Set();

  for (const absolutePath of allFiles) {
    const relativePath = toVaultPath(path.relative(vaultRoot, absolutePath));
    let currentDirectory = path.posix.dirname(relativePath);
    while (currentDirectory && currentDirectory !== ".") {
      directoryPaths.add(currentDirectory);
      currentDirectory = path.posix.dirname(currentDirectory);
    }

    if (path.extname(absolutePath).toLowerCase() !== ".md") continue;

    const content = fs.readFileSync(absolutePath, "utf8");
    const file = {
      path: relativePath,
      basename: path.basename(absolutePath, path.extname(absolutePath)),
      extension: "md",
    };
    markdownFiles.push(file);
    contentByPath.set(relativePath, content);
    frontmatterByPath.set(relativePath, parseFrontmatter(content));
  }

  return {
    allFiles,
    contentByPath,
    directoryPaths: [...directoryPaths].sort(),
    frontmatterByPath,
    markdownFiles,
  };
}

function createTemplaterHarness(vaultRoot) {
  const resolvedRoot = path.resolve(vaultRoot);
  const snapshot = createVaultSnapshot(resolvedRoot);
  const readCache = new Map();

  class TFolder {
    constructor(folderPath) {
      this.path = folderPath;
      this.name = path.posix.basename(folderPath);
    }
  }

  const folders = snapshot.directoryPaths.map((folderPath) => new TFolder(folderPath));

  async function readVaultFile(vaultPath) {
    if (readCache.has(vaultPath)) return readCache.get(vaultPath);
    const content = fs.readFileSync(fromVaultPath(resolvedRoot, vaultPath), "utf8");
    readCache.set(vaultPath, content);
    return content;
  }

  async function runTemplate(options) {
    const promptValues = [options.name, options.itemId];
    const notices = [];
    const createdFiles = [];
    const templateText = fs.readFileSync(
      fromVaultPath(resolvedRoot, options.templatePath),
      "utf8",
    );
    const program = extractTemplaterProgram(templateText);

    function Notice(message) {
      notices.push(String(message));
    }

    const app = {
      metadataCache: {
        getFileCache(file) {
          return { frontmatter: snapshot.frontmatterByPath.get(file.path) || {} };
        },
      },
      vault: {
        adapter: {
          async exists(vaultPath) {
            return fs.existsSync(fromVaultPath(resolvedRoot, vaultPath));
          },
          async list(folderPath) {
            const absoluteFolder = fromVaultPath(resolvedRoot, folderPath);
            const entries = fs.readdirSync(absoluteFolder, { withFileTypes: true });
            return {
              files: entries
                .filter((entry) => entry.isFile())
                .map((entry) => path.posix.join(folderPath, entry.name))
                .sort(),
              folders: entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => path.posix.join(folderPath, entry.name))
                .sort(),
            };
          },
          read: readVaultFile,
        },
        getAbstractFileByPath(vaultPath) {
          const absolutePath = fromVaultPath(resolvedRoot, vaultPath);
          if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
          return {
            path: vaultPath,
            basename: path.posix.basename(vaultPath, path.posix.extname(vaultPath)),
            extension: path.posix.extname(vaultPath).slice(1),
          };
        },
        getAllLoadedFiles() {
          return folders;
        },
        getMarkdownFiles() {
          return snapshot.markdownFiles;
        },
        async read(file) {
          if (snapshot.contentByPath.has(file.path)) {
            return snapshot.contentByPath.get(file.path);
          }
          return readVaultFile(file.path);
        },
      },
    };

    const tp = {
      file: {
        async create_new(content, name, openNew, targetFolder) {
          createdFiles.push({ content, name, openNew, targetFolder: targetFolder?.path || null });
        },
      },
      obsidian: { TFolder },
      system: {
        async prompt() {
          return promptValues.shift();
        },
        async suggester(_displayItems, actualItems) {
          if (options.suggestedPath) return options.suggestedPath;
          return actualItems[0];
        },
      },
    };

    const execute = new AsyncFunction("tp", "app", "Notice", "tR", program);
    await execute(tp, app, Notice, "");

    return { createdFiles, notices };
  }

  return { runTemplate, snapshot };
}

function findMarkdownById(snapshot, itemId) {
  for (const file of snapshot.markdownFiles) {
    const frontmatter = snapshot.frontmatterByPath.get(file.path) || {};
    if (frontmatter.id === itemId) {
      return {
        content: snapshot.contentByPath.get(file.path),
        file,
        frontmatter,
      };
    }
  }
  return null;
}

function parserOwnedSignature(markdown) {
  const frontmatter = parseFrontmatter(markdown);
  const normalized = markdown.replace(/\r\n/g, "\n");
  const allLines = normalized.split("\n");
  const regularHeading = allLines.findIndex((line) => line.trim() === "### 常規");
  let ownedLines = allLines;
  if (regularHeading !== -1) {
    let sectionEnd = allLines.length;
    for (let index = regularHeading + 1; index < allLines.length; index += 1) {
      if (/^###\s+/.test(allLines[index])) {
        sectionEnd = index;
        break;
      }
    }
    ownedLines = allLines.slice(regularHeading + 1, sectionEnd);
  }

  const significantLines = ownedLines
    .map((line) => line.trim())
    .filter((line) =>
      /(?:Machine|item|GEO|drop|qty|energy|interval|tickRate|capacity|entity|chance|environment|supply|deviation)::/.test(
        line,
      ),
    );

  return {
    type: frontmatter.type ?? "",
    id: frontmatter.id ?? "",
    level: frontmatter.level ?? "",
    output: frontmatter.output ?? "",
    aliases: Array.isArray(frontmatter.aliases)
      ? [...frontmatter.aliases].map(String).sort()
      : frontmatter.aliases
        ? [String(frontmatter.aliases)]
        : [],
    significantLines,
  };
}

function compareSignatures(existing, generated) {
  const keys = ["type", "id", "level", "output", "aliases", "significantLines"];
  const differences = [];
  for (const key of keys) {
    if (JSON.stringify(existing[key]) !== JSON.stringify(generated[key])) {
      differences.push({ key, existing: existing[key], generated: generated[key] });
    }
  }
  return differences;
}

module.exports = {
  compareSignatures,
  createTemplaterHarness,
  findMarkdownById,
  parseFrontmatter,
  parserOwnedSignature,
};
