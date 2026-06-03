#!/usr/bin/env bun
// INIT_SCRIPT_DO_NOT_REPLACE

import { $ } from "bun";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const OLD_NAME = "modern-web-starter";
const OLD_ORG_REPO = "fgbyte/modern-web-starter";
const MARKER = "INIT_SCRIPT_DO_NOT_REPLACE";
const SCRIPT_FILENAME = "init.ts";

const SKIP_DIRS = new Set<string>([
  "node_modules",
  ".git",
  ".turbo",
  ".alchemy",
  "dist",
  "build",
  ".tanstack",
  ".cache",
  "coverage",
  ".claude",
  ".opencode",
  ".agents",
]);

const SKIP_FILES = new Set<string>([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "routeTree.gen.ts",
]);

const NO_EXT_BASENAMES = new Set<string>([
  ".env",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "LICENSE",
  "LICENSE.md",
]);

const PROCESS_EXTS = new Set<string>([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".toml",
  ".yaml",
  ".yml",
  ".env",
  ".txt",
  ".svg",
  ".xml",
]);

interface ParsedName {
  rootName: string;
  scope: string;
}

interface Replacement {
  from: string;
  to: string;
}

interface ReplacementMap {
  github: Replacement | null;
  scope: Replacement;
  name: Replacement;
}

interface GitRemote {
  org: string;
  repo: string;
}

function parseProjectName(input: string): ParsedName {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Project name cannot be empty");
  }
  if (trimmed.length > 214) {
    throw new Error("Project name must be 214 characters or less");
  }
  if (/\s/.test(trimmed)) {
    throw new Error("Project name cannot contain whitespace");
  }

  if (trimmed.startsWith("@")) {
    if (!trimmed.includes("/")) {
      throw new Error("Scoped name must be in the format @scope/name");
    }
    const parts = trimmed.slice(1).split("/");
    if (parts.length !== 2) {
      throw new Error(
        "Scoped name must be in the format @scope/name (exactly one slash)",
      );
    }
    const [scope, name] = parts;
    if (!scope || !name) {
      throw new Error("Scope and name cannot be empty");
    }
    validateNameSegment(scope, "scope");
    validateNameSegment(name, "package name");
    return { rootName: trimmed, scope: `@${scope}` };
  }

  if (trimmed.includes("/")) {
    throw new Error(
      "Non-scoped names cannot contain '/'. Use @scope/name format for scoped packages.",
    );
  }

  validateNameSegment(trimmed, "project name");
  return { rootName: trimmed, scope: `@${trimmed}` };
}

function validateNameSegment(name: string, label: string): void {
  if (!/^[a-z0-9]/.test(name)) {
    throw new Error(`${label} must start with a lowercase letter or digit`);
  }
  if (!/^[a-z0-9\-_.]+$/.test(name)) {
    throw new Error(
      `${label} can only contain lowercase letters, digits, hyphens, underscores, and dots`,
    );
  }
}

function parseGitHubUrl(url: string): GitRemote | null {
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return { org: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = url.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return { org: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

async function detectGitRemote(): Promise<GitRemote | null> {
  try {
    const result = await $`git remote get-url origin`.quiet().nothrow();
    if (result.exitCode !== 0) return null;
    const url = result.stdout.toString().trim();
    if (!url) return null;
    return parseGitHubUrl(url);
  } catch {
    return null;
  }
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    } else if (entry.isSymbolicLink()) {
      try {
        const s = await stat(fullPath);
        if (s.isFile()) {
          yield fullPath;
        } else if (s.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          yield* walkFiles(fullPath);
        }
      } catch {
        // Skip broken or inaccessible symlinks
      }
    }
  }
}

function shouldProcessFile(filePath: string): boolean {
  const basename = filePath.split(sep).pop() ?? filePath;
  if (SKIP_FILES.has(basename)) return false;
  if (NO_EXT_BASENAMES.has(basename)) return true;
  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0) {
    return true;
  }
  const ext = basename.slice(lastDot).toLowerCase();
  return PROCESS_EXTS.has(ext);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacements(
  content: string,
  map: ReplacementMap,
): { content: string; count: number } {
  let result = content;
  let count = 0;

  const replacements: Replacement[] = [];
  if (map.github) replacements.push(map.github);
  replacements.push(map.scope);
  replacements.push(map.name);

  for (const r of replacements) {
    if (r.from === r.to) continue;
    const re = new RegExp(escapeRegExp(r.from), "g");
    const matches = result.match(re);
    if (matches) {
      count += matches.length;
      result = result.replace(re, r.to);
    }
  }

  return { content: result, count };
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const scriptPath = join(cwd, "scripts", SCRIPT_FILENAME);

  process.on("SIGINT", () => {
    process.stdout.write("\nAborted.\n");
    process.exit(130);
  });

  console.log("Template initialization\n");

  const nameInput = prompt(
    "New project name (e.g., 'my-app' or '@scope/name'):",
  );
  if (nameInput === null) {
    process.stdout.write("\nAborted.\n");
    process.exit(130);
  }
  if (!nameInput.trim()) {
    console.error("Error: Project name is required.");
    process.exit(1);
  }

  let parsed: ParsedName;
  try {
    parsed = parseProjectName(nameInput);
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }

  process.stdout.write("Detecting git remote...\n");
  const remote = await detectGitRemote();

  process.stdout.write("\nConfiguration:\n");
  process.stdout.write(`  Project name:  ${parsed.rootName}\n`);
  process.stdout.write(`  Scope:         ${parsed.scope}\n`);
  if (remote) {
    process.stdout.write(`  GitHub URL:    ${remote.org}/${remote.repo}\n`);
  } else {
    process.stdout.write(
      "  GitHub URL:    (not detected - GitHub URLs will not be updated)\n",
    );
  }

  const map: ReplacementMap = {
    github: remote
      ? { from: OLD_ORG_REPO, to: `${remote.org}/${remote.repo}` }
      : null,
    scope: { from: `@${OLD_NAME}`, to: parsed.scope },
    name: { from: OLD_NAME, to: parsed.rootName },
  };

  process.stdout.write("\nProcessing files...\n\n");

  let modified = 0;
  let skipped = 0;
  let totalChanges = 0;

  for await (const filePath of walkFiles(cwd)) {
    if (!shouldProcessFile(filePath)) {
      skipped++;
      continue;
    }

    // Skip the init script itself by exact path match
    if (filePath === scriptPath) {
      skipped++;
      continue;
    }

    let original: string;
    try {
      original = await readFile(filePath, "utf-8");
    } catch {
      skipped++;
      continue;
    }

    // Safety net: skip any file containing the marker (catches the init script
    // and any other file that opts out by including the marker comment).
    if (original.includes(MARKER)) {
      skipped++;
      continue;
    }

    const { content, count } = applyReplacements(original, map);
    if (count > 0) {
      await writeFile(filePath, content, "utf-8");
      const rel = relative(cwd, filePath);
      process.stdout.write(`Processing: ${rel} (${count} changes)\n`);
      modified++;
      totalChanges += count;
    }
  }

  process.stdout.write(
    `\nModified ${modified} files (${totalChanges} total changes). Skipped ${skipped} files.\n`,
  );

  process.stdout.write("\nRunning 'bun install' to regenerate lockfile...\n\n");
  try {
    await $`bun install`.quiet();
    process.stdout.write("Lockfile regenerated.\n\n");
  } catch (e) {
    process.stdout.write(
      "Warning: 'bun install' failed. You may need to run it manually.\n",
    );
    process.stdout.write(`${(e as Error).message}\n\n`);
  }

  process.stdout.write("Done!\n\n");
  process.stdout.write("Next steps:\n");
  process.stdout.write(
    "  1. Review the changes with 'git diff' to verify everything looks correct\n",
  );
  process.stdout.write(
    "  2. Update your .env files with environment-specific values\n",
  );
  process.stdout.write(
    "  3. Run 'bun run check-types' to verify TypeScript compiles\n",
  );
  process.stdout.write(
    "  4. (Optional) Update the 'author' field in package.json\n",
  );
  process.stdout.write(
    "  5. Commit: 'git add -A && git commit -m \"Initialize from template\"'\n",
  );
}

main().catch((e: unknown) => {
  console.error("Error:", e);
  process.exit(1);
});
