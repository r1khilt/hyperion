import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { AgentToolCall, AgentToolDefinition } from "./types";

const DEFAULT_IGNORED_DIRECTORIES = [".git", "node_modules"];
const MAX_FILE_BYTES = 1_000_000;
const MAX_READ_LINES = 500;
const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_RESULTS = 100;
const MAX_COMMAND_OUTPUT = 30_000;

export const codingTools: AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and folders under a workspace-relative path. Use this before reading unfamiliar parts of a project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative directory path. Use . for the workspace root." },
          recursive: { type: "boolean", description: "Whether to descend into subdirectories. Defaults to false." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace with line numbers. Use offset and limit to keep large files focused.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          offset: { type: "number", description: "1-based starting line. Defaults to 1." },
          limit: { type: "number", description: "Maximum number of lines to return. Defaults to 500 and is capped at 500." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search workspace text files for a literal string and return matching lines. This is case-insensitive.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text to find." },
          path: { type: "string", description: "Workspace-relative directory to search. Defaults to ." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a workspace file. Read an existing file before replacing it unless the user asked to create it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Complete new file contents." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description: "Make a precise literal replacement in an existing workspace file. Supply the expected number of matches to prevent unintended edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          search: { type: "string", description: "Exact existing text to replace." },
          replace: { type: "string", description: "Replacement text." },
          expectedReplacements: { type: "number", description: "Expected occurrence count. Defaults to 1." },
        },
        required: ["path", "search", "replace"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command from the workspace root, for example a targeted test, formatter, or build command. Avoid destructive commands unless the user explicitly requested them.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
          timeoutSeconds: { type: "number", description: "Optional timeout from 1 to 300 seconds. Defaults to 120." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
];

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export class WorkspaceToolExecutor {
  private readonly root: string;
  private readonly rootRealPathPromise: Promise<string>;

  public constructor(
    private readonly requestApproval: (title: string, detail: string) => Promise<boolean>,
    private readonly reportActivity: (message: string) => void,
  ) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) {
      throw new Error("Open a folder or workspace before using Hyperion's coding agent.");
    }
    this.root = path.resolve(workspace);
    this.rootRealPathPromise = fs.realpath(this.root).catch(() => this.root);
  }

  public async execute(call: AgentToolCall, signal: AbortSignal): Promise<ToolExecutionResult> {
    try {
      switch (call.name) {
        case "list_files":
          return await this.listFiles(call.input);
        case "read_file":
          return await this.readFile(call.input);
        case "search_files":
          return await this.searchFiles(call.input, signal);
        case "write_file":
          return await this.writeFile(call.input);
        case "replace_in_file":
          return await this.replaceInFile(call.input);
        case "run_command":
          return await this.runCommand(call.input, signal);
        default:
          return { content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  private async listFiles(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const requestedPath = optionalString(input.path) ?? ".";
    const recursive = input.recursive === true;
    const target = await this.resolvePath(requestedPath, "read");
    if (!(await this.approve("List files", `${displayPath(requestedPath)}${recursive ? " recursively" : ""}`))) {
      return denied();
    }
    const entries = await this.walk(target, recursive, MAX_LIST_ENTRIES);
    const relativeBase = relativeToRoot(this.root, target);
    const formatted = entries.map((entry) => {
      const relative = relativeToRoot(target, entry.path);
      return `${entry.kind === "directory" ? "dir " : "file"} ${relative}${entry.kind === "directory" ? "/" : ""}`;
    });
    const suffix = entries.length === MAX_LIST_ENTRIES ? "\nResults capped at 300 entries." : "";
    return { content: `Files under ${relativeBase || "."}:\n${formatted.join("\n") || "(empty)"}${suffix}` };
  }

  private async readFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const requestedPath = requiredString(input.path, "path");
    const target = await this.resolvePath(requestedPath, "read");
    const offset = positiveInteger(input.offset, 1, "offset");
    const limit = Math.min(positiveInteger(input.limit, MAX_READ_LINES, "limit"), MAX_READ_LINES);
    if (!(await this.approve("Read file", `${displayPath(requestedPath)} (lines ${offset}-${offset + limit - 1})`))) {
      return denied();
    }
    const stats = await fs.stat(target);
    if (!stats.isFile()) {
      throw new Error(`${displayPath(requestedPath)} is not a file.`);
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(`${displayPath(requestedPath)} is larger than 1 MB and will not be read.`);
    }
    const content = await fs.readFile(target, "utf8");
    if (content.includes("\0")) {
      throw new Error(`${displayPath(requestedPath)} appears to be binary and will not be read.`);
    }
    const lines = content.split(/\r?\n/);
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = selected.map((line, index) => `${String(offset + index).padStart(5, " ")} | ${line}`);
    const next = offset - 1 + limit < lines.length ? `\nMore available; read again with offset ${offset + limit}.` : "";
    return { content: `${displayPath(requestedPath)} (${lines.length} lines):\n${numbered.join("\n")}${next}` };
  }

  private async searchFiles(input: Record<string, unknown>, signal: AbortSignal): Promise<ToolExecutionResult> {
    const query = requiredString(input.query, "query");
    const requestedPath = optionalString(input.path) ?? ".";
    const target = await this.resolvePath(requestedPath, "read");
    if (!(await this.approve("Search files", `Find ${JSON.stringify(query)} under ${displayPath(requestedPath)}`))) {
      return denied();
    }
    this.reportActivity(`Searching ${displayPath(requestedPath)}…`);
    const files = await this.walk(target, true, MAX_LIST_ENTRIES * 4);
    const needle = query.toLocaleLowerCase();
    const results: string[] = [];
    for (const entry of files) {
      if (signal.aborted) {
        throw abortError();
      }
      if (entry.kind !== "file" || results.length >= MAX_SEARCH_RESULTS) {
        continue;
      }
      try {
        const stats = await fs.stat(entry.path);
        if (stats.size > MAX_FILE_BYTES) {
          continue;
        }
        const content = await fs.readFile(entry.path, "utf8");
        if (content.includes("\0")) {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < MAX_SEARCH_RESULTS; index += 1) {
          if (lines[index].toLocaleLowerCase().includes(needle)) {
            results.push(`${relativeToRoot(this.root, entry.path)}:${index + 1}: ${lines[index].slice(0, 500)}`);
          }
        }
      } catch {
        // A transient unreadable file should not fail a codebase search.
      }
    }
    const suffix = results.length === MAX_SEARCH_RESULTS ? "\nResults capped at 100 matches." : "";
    return { content: results.length ? `${results.join("\n")}${suffix}` : `No matches for ${JSON.stringify(query)}.` };
  }

  private async writeFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const requestedPath = requiredString(input.path, "path");
    const content = requiredString(input.content, "content");
    const target = await this.resolvePath(requestedPath, "write");
    const exists = await fileExists(target);
    if (!(await this.approve(exists ? "Replace file" : "Create file", `${displayPath(requestedPath)} (${content.length.toLocaleString()} characters)`))) {
      return denied();
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return { content: `${exists ? "Replaced" : "Created"} ${displayPath(requestedPath)}.` };
  }

  private async replaceInFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const requestedPath = requiredString(input.path, "path");
    const search = requiredString(input.search, "search");
    const replacement = requiredString(input.replace, "replace");
    const expected = positiveInteger(input.expectedReplacements, 1, "expectedReplacements");
    const target = await this.resolvePath(requestedPath, "write");
    const existing = await fs.readFile(target, "utf8");
    const count = countOccurrences(existing, search);
    if (count !== expected) {
      throw new Error(`Expected ${expected} occurrence${expected === 1 ? "" : "s"} in ${displayPath(requestedPath)}, found ${count}. Re-read the file and use a more precise search string.`);
    }
    if (!(await this.approve("Edit file", `${displayPath(requestedPath)}: replace ${count} exact occurrence${count === 1 ? "" : "s"}`))) {
      return denied();
    }
    await fs.writeFile(target, existing.replaceAll(search, replacement), "utf8");
    return { content: `Updated ${displayPath(requestedPath)} (${count} replacement${count === 1 ? "" : "s"}).` };
  }

  private async runCommand(input: Record<string, unknown>, signal: AbortSignal): Promise<ToolExecutionResult> {
    const command = requiredString(input.command, "command");
    const timeoutSeconds = Math.min(positiveInteger(input.timeoutSeconds, 120, "timeoutSeconds"), 300);
    if (!(await this.approve("Run command", command))) {
      return denied();
    }
    this.reportActivity(`Running ${command.slice(0, 80)}…`);
    const result = await runShell(command, this.root, timeoutSeconds * 1000, signal);
    const output = truncate(`${result.stdout}${result.stderr ? `${result.stdout ? "\n" : ""}${result.stderr}` : ""}`, MAX_COMMAND_OUTPUT);
    return {
      content: `Exit code: ${result.exitCode}\n${output || "(no output)"}`,
      isError: result.exitCode !== 0,
    };
  }

  private async approve(title: string, detail: string): Promise<boolean> {
    this.reportActivity(`${title}: ${detail}`);
    return this.requestApproval(title, detail);
  }

  private async resolvePath(requestedPath: string, access: "read" | "write"): Promise<string> {
    const normalized = requestedPath.trim();
    if (!normalized) {
      throw new Error("A workspace-relative path is required.");
    }
    const candidate = path.resolve(this.root, normalized);
    if (!isWithin(this.root, candidate)) {
      throw new Error("Paths outside the current workspace are not allowed.");
    }
    const relative = relativeToRoot(this.root, candidate);
    if (this.isIgnored(relative)) {
      throw new Error(`${displayPath(requestedPath)} is blocked by .hyperionignore.`);
    }
    const rootRealPath = await this.rootRealPathPromise;
    if (access === "read" || (await fileExists(candidate))) {
      const real = await fs.realpath(candidate);
      if (!isWithin(rootRealPath, real)) {
        throw new Error(`${displayPath(requestedPath)} resolves outside the workspace and is blocked.`);
      }
    } else {
      const parent = await nearestExistingParent(candidate);
      const parentReal = await fs.realpath(parent);
      if (!isWithin(rootRealPath, parentReal)) {
        throw new Error(`${displayPath(requestedPath)} would be created outside the workspace and is blocked.`);
      }
    }
    return candidate;
  }

  private async walk(directory: string, recursive: boolean, limit: number): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
    const entries: Array<{ path: string; kind: "file" | "directory" }> = [];
    const visit = async (current: string, descend: boolean): Promise<void> => {
      if (entries.length >= limit) {
        return;
      }
      const children = await fs.readdir(current, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (entries.length >= limit) {
          return;
        }
        const fullPath = path.join(current, child.name);
        const relative = relativeToRoot(this.root, fullPath);
        if (this.isIgnored(relative, child.isDirectory())) {
          continue;
        }
        if (child.isSymbolicLink()) {
          continue;
        }
        if (child.isDirectory()) {
          entries.push({ path: fullPath, kind: "directory" });
          if (descend) {
            await visit(fullPath, true);
          }
        } else if (child.isFile()) {
          entries.push({ path: fullPath, kind: "file" });
        }
      }
    };
    await visit(directory, recursive);
    return entries;
  }

  private isIgnored(relativePath: string, isDirectory = false): boolean {
    const normalized = relativePath.split(path.sep).join("/");
    if (!normalized || normalized === ".") {
      return false;
    }
    const patterns = this.ignorePatterns;
    let ignored = false;
    for (const rawPattern of patterns) {
      const negated = rawPattern.startsWith("!");
      const pattern = (negated ? rawPattern.slice(1) : rawPattern).trim();
      if (pattern && globMatches(normalized, pattern, isDirectory)) {
        ignored = !negated;
      }
    }
    return ignored;
  }

  private get ignorePatterns(): string[] {
    // This getter is intentionally synchronous from the cached settings file below.
    return this.cachedIgnorePatterns;
  }

  private cachedIgnorePatterns = [
    ...DEFAULT_IGNORED_DIRECTORIES.map((directory) => `${directory}/`),
    ".hyperionignore",
  ];

  public async initialize(): Promise<void> {
    const ignorePath = path.join(this.root, ".hyperionignore");
    try {
      const content = await fs.readFile(ignorePath, "utf8");
      this.cachedIgnorePatterns = [
        ...DEFAULT_IGNORED_DIRECTORIES.map((directory) => `${directory}/`),
        ".hyperionignore",
        ...content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      ];
    } catch {
      // An ignore file is optional. The conservative built-in exclusions remain active.
    }
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool parameter ${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Tool parameter ${name} must be a positive integer.`);
  }
  return value;
}

function denied(): ToolExecutionResult {
  return { content: "The user denied this action.", isError: true };
}

function displayPath(value: string): string {
  return value === "." ? "workspace root" : value;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function relativeToRoot(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

async function nearestExistingParent(target: string): Promise<string> {
  let current = target;
  while (!(await fileExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not resolve a parent directory for the requested path.");
    }
    current = parent;
  }
  const stats = await fs.stat(current);
  return stats.isDirectory() ? current : path.dirname(current);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function countOccurrences(content: string, search: string): number {
  if (!search) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = content.indexOf(search, index)) !== -1) {
    count += 1;
    index += search.length;
  }
  return count;
}

function globMatches(relativePath: string, pattern: string, isDirectory: boolean): boolean {
  const normalizedPattern = pattern.replace(/^\//, "");
  const directoryPattern = normalizedPattern.endsWith("/");
  const candidatePattern = directoryPattern ? normalizedPattern.slice(0, -1) : normalizedPattern;
  if (directoryPattern && !(isDirectory || relativePath.startsWith(`${candidatePattern}/`))) {
    return false;
  }
  const hasSlash = candidatePattern.includes("/");
  const source = globToRegExpSource(candidatePattern);
  const expression = hasSlash
    ? new RegExp(`^${source}${directoryPattern ? "(?:/.*)?" : ""}$`)
    : new RegExp(`(?:^|/)${source}${directoryPattern ? "(?:/.*)?" : "(?:$|/)"}`);
  return expression.test(relativePath);
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        while (pattern[index + 1] === "*") {
          index += 1;
        }
        source += ".*";
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return source;
}

async function runShell(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    const child = childProcess.spawn(shell, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    const stop = () => child.kill("SIGTERM");
    signal.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncate(`${stdout}${chunk.toString()}`, MAX_COMMAND_OUTPUT);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncate(`${stderr}${chunk.toString()}`, MAX_COMMAND_OUTPUT);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n… output truncated …` : value;
}

function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}
