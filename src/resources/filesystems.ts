import type { AjentifyClient } from "../client.js";
import { AjentifyError } from "../errors.js";
import type { GetClient } from "../internal.js";
import type {
  ApiFileNode,
  ApiFilesystem,
  ApiFilesystemDeleteResult,
  ApiFilesystemMoveResult,
  ApiFilesystemNode,
  ApiFilesystemSearchResult,
  ApiFilesystemTree,
  ApiFolderNode,
  GetFilesystemsResponse,
} from "../types.js";

/**
 * A filesystem is an org-scoped tree of folders and files that agents read and
 * write through the built-in filesystem tools (`list_folder`, `open_file`,
 * `create_file`, …). Agents address nodes by *tool paths* whose first segment is
 * the filesystem id — `/<filesystem_id>/companies/acme/notes.md` — while this
 * resource accepts paths with or without that prefix. Use `fs.toolPath(path)`
 * when you need to hand a path to an agent (e.g. in `promptArgs`).
 */
export interface FilesystemCreateOptions {
  /** Description of the root folder, shown to agents when they list `/`. */
  description?: string;
  /** Pin to a specific organization (defaults to the API key's first org). */
  orgId?: string;
}

export interface FilesystemUpdateOptions {
  name?: string;
  description?: string;
}

export interface FilesystemTreeNode {
  path: string;
  type: "folder" | "file";
  name: string;
  parentPath: string;
  description: string | null;
  sizeBytes: number | null;
  updatedAt: number | null;
}

export interface FolderChild {
  name: string;
  path: string;
  type: "folder" | "file";
  description: string | null;
  sizeBytes: number | null;
}

export interface FolderNode {
  type: "folder";
  path: string;
  name: string;
  parentPath: string;
  description: string | null;
  children: FolderChild[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface FileNode {
  type: "file";
  path: string;
  name: string;
  parentPath: string;
  /** Present when the node was read with `fs.get` / `fs.readFile`. */
  content: string | null;
  sizeBytes: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export type FilesystemNode = FolderNode | FileNode;

export interface CreateFolderOptions {
  description?: string;
  /** Create missing parent folders. Defaults to true. */
  createParents?: boolean;
}

export interface CreateFileOptions {
  /** Create missing parent folders. Defaults to true. */
  createParents?: boolean;
}

export interface WriteFileOptions {
  /**
   * Optimistic lock: only write if the file's `updatedAt` still equals this
   * value (409 `conflict` otherwise).
   */
  expectedUpdatedAt?: number;
}

export interface MoveOptions {
  /** Create missing parent folders at the destination. Defaults to true. */
  createParents?: boolean;
}

export interface RemoveOptions {
  /** Delete a folder and everything under it. Defaults to false (409 `folder_not_empty`). */
  recursive?: boolean;
}

export interface SearchOptions {
  /** Restrict to a subtree. Defaults to `/`. */
  path?: string;
  scope?: "names" | "content" | "all";
  caseSensitive?: boolean;
  limit?: number;
}

export interface SearchMatch {
  path: string;
  type: "folder" | "file";
  matchedOn: string;
  snippet: string | null;
}

export interface SearchResult {
  query: string;
  path: string;
  matches: SearchMatch[];
  truncated: boolean;
}

export interface DeleteResult {
  path: string;
  type: "folder" | "file";
  deleted: { folders: number; files: number };
}

export interface MoveResult {
  sourcePath: string;
  destinationPath: string;
  type: "folder" | "file";
}

/** A filesystem, with camelCase fields and node helpers. */
export class Filesystem {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;

  /** @internal */
  constructor(
    private readonly client: AjentifyClient,
    data: ApiFilesystem,
  ) {
    this.id = data.filesystem_id;
    this.orgId = data.org_id;
    this.name = data.name;
    this.description = data.description ?? null;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * The path agents use for a node in this filesystem: `/<filesystem_id>` +
   * the internal path. Accepts internal or tool paths.
   */
  toolPath(path: string): string {
    const internal = this.normalize(path);
    return internal === "/" ? `/${this.id}` : `/${this.id}${internal}`;
  }

  /** Rename / re-describe the filesystem. */
  async update(options: FilesystemUpdateOptions): Promise<Filesystem> {
    const body: Record<string, unknown> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.description !== undefined) body.description = options.description;
    const updated = await this.client.put<ApiFilesystem>(`/filesystem/${this.id}`, body);
    return new Filesystem(this.client, updated);
  }

  /** Delete the filesystem and every node in it. */
  async delete(): Promise<void> {
    await this.client.delete(`/filesystem/${this.id}`);
  }

  /** Every node in the filesystem, flattened (no file contents). */
  async tree(): Promise<FilesystemTreeNode[]> {
    const res = await this.client.get<ApiFilesystemTree>(`/filesystem/${this.id}/tree`);
    return res.nodes.map((n) => ({
      path: n.path,
      type: n.type,
      name: n.name,
      parentPath: n.parent_path,
      description: n.description ?? null,
      sizeBytes: n.size_bytes ?? null,
      updatedAt: n.updated_at ?? null,
    }));
  }

  /** Read a node: a folder (with children) or a file (with content). `/` is the root. */
  async get(path: string): Promise<FilesystemNode> {
    const node = await this.client.get<ApiFilesystemNode>(`/filesystem/${this.id}/node`, {
      query: { path: this.normalize(path) },
    });
    return mapNode(node);
  }

  /** True if a node exists at the path. */
  async exists(path: string): Promise<boolean> {
    try {
      await this.get(path);
      return true;
    } catch (err) {
      if ((err as { status?: number }).status === 404) return false;
      throw err;
    }
  }

  /** Create a folder (and, by default, any missing parents). */
  async createFolder(path: string, options: CreateFolderOptions = {}): Promise<FolderNode> {
    const body: Record<string, unknown> = {
      path: this.normalize(path),
      create_parents: options.createParents ?? true,
    };
    if (options.description !== undefined) body.description = options.description;
    const node = await this.client.post<ApiFolderNode>(`/filesystem/${this.id}/folder`, body);
    return mapFolder(node);
  }

  /** Create a folder unless it already exists. */
  async ensureFolder(path: string, options: CreateFolderOptions = {}): Promise<FolderNode> {
    try {
      return await this.createFolder(path, options);
    } catch (err) {
      if ((err as { status?: number }).status !== 409) throw err;
      const existing = await this.get(path);
      if (existing.type !== "folder") throw err;
      return existing;
    }
  }

  /** Set a folder's description (what agents see when they list its parent). `/` edits the root. */
  async describeFolder(path: string, description: string): Promise<FolderNode> {
    const node = await this.client.put<ApiFolderNode>(`/filesystem/${this.id}/folder`, {
      path: this.normalize(path),
      description,
    });
    return mapFolder(node);
  }

  /** Create a new file. Fails with 409 `already_exists` if the path is taken — use `writeFile` to replace. */
  async createFile(path: string, content = "", options: CreateFileOptions = {}): Promise<FileNode> {
    const node = await this.client.post<ApiFileNode>(`/filesystem/${this.id}/file`, {
      path: this.normalize(path),
      content,
      create_parents: options.createParents ?? true,
    });
    return mapFile(node);
  }

  /** Replace a file's content (create it if missing). */
  async writeFile(path: string, content: string, options: WriteFileOptions = {}): Promise<FileNode> {
    const internal = this.normalize(path);
    try {
      const body: Record<string, unknown> = { path: internal, content };
      if (options.expectedUpdatedAt !== undefined) body.expected_updated_at = options.expectedUpdatedAt;
      const node = await this.client.put<ApiFileNode>(`/filesystem/${this.id}/file`, body);
      return mapFile(node);
    } catch (err) {
      if ((err as { status?: number }).status !== 404 || options.expectedUpdatedAt !== undefined) throw err;
      return this.createFile(internal, content);
    }
  }

  /** Read a file's content. */
  async readFile(path: string): Promise<string> {
    const node = await this.get(path);
    if (node.type !== "file") {
      throw new AjentifyError(`${node.path} is a folder, not a file`, { code: "not_a_file" });
    }
    return node.content ?? "";
  }

  /** Move or rename a node. */
  async move(sourcePath: string, destinationPath: string, options: MoveOptions = {}): Promise<MoveResult> {
    const res = await this.client.post<ApiFilesystemMoveResult>(`/filesystem/${this.id}/move`, {
      source_path: this.normalize(sourcePath),
      destination_path: this.normalize(destinationPath),
      create_parents: options.createParents ?? true,
    });
    return { sourcePath: res.source_path, destinationPath: res.destination_path, type: res.type };
  }

  /** Delete a file, or a folder (recursively with `recursive: true`). */
  async remove(path: string, options: RemoveOptions = {}): Promise<DeleteResult> {
    const res = await this.client.delete<ApiFilesystemDeleteResult>(`/filesystem/${this.id}/node`, {
      query: { path: this.normalize(path), recursive: options.recursive ?? false },
    });
    return { path: res.path, type: res.type, deleted: res.deleted };
  }

  /** Search names and/or content under a path. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const res = await this.client.get<ApiFilesystemSearchResult>(`/filesystem/${this.id}/search`, {
      query: {
        q: query,
        path: options.path !== undefined ? this.normalize(options.path) : undefined,
        scope: options.scope,
        case_sensitive: options.caseSensitive,
        limit: options.limit,
      },
    });
    return {
      query: res.query,
      path: res.path,
      truncated: res.truncated,
      matches: res.matches.map((m) => ({
        path: m.path,
        type: m.type,
        matchedOn: m.matched_on,
        snippet: m.snippet ?? null,
      })),
    };
  }

  /**
   * Normalize to the internal form the REST API expects: leading slash, no
   * trailing slash, and without the `/<filesystem_id>` tool-path prefix.
   */
  normalize(path: string): string {
    return normalizeFsPath(path, this.id);
  }
}

export function normalizeFsPath(path: string, filesystemId: string): string {
  let p = (path ?? "").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  const prefix = `/${filesystemId}`;
  if (p === prefix) p = "/";
  else if (p.startsWith(`${prefix}/`)) p = p.slice(prefix.length);
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

function mapFolder(n: ApiFolderNode): FolderNode {
  return {
    type: "folder",
    path: n.path,
    name: n.name,
    parentPath: n.parent_path,
    description: n.description ?? null,
    children: (n.children ?? []).map((c) => ({
      name: c.name,
      path: c.path,
      type: c.type,
      description: c.description ?? null,
      sizeBytes: c.size_bytes ?? null,
    })),
    createdAt: n.created_at ?? null,
    updatedAt: n.updated_at ?? null,
  };
}

function mapFile(n: ApiFileNode): FileNode {
  return {
    type: "file",
    path: n.path,
    name: n.name,
    parentPath: n.parent_path,
    content: n.content ?? null,
    sizeBytes: n.size_bytes ?? null,
    createdAt: n.created_at ?? null,
    updatedAt: n.updated_at ?? null,
  };
}

function mapNode(n: ApiFilesystemNode): FilesystemNode {
  return n.type === "folder" ? mapFolder(n) : mapFile(n);
}

export interface FilesystemApi {
  /** Create a filesystem. */
  create(name: string, options?: FilesystemCreateOptions): Promise<Filesystem>;
  /** Fetch a filesystem by id. */
  get(filesystemId: string): Promise<Filesystem>;
  /** Find a filesystem by name, or create it. */
  getOrCreate(name: string, options?: FilesystemCreateOptions): Promise<Filesystem>;
  /** List the org's filesystems. */
  list(orgId?: string): Promise<Filesystem[]>;
}

export function createFilesystemApi(getClient: GetClient): FilesystemApi {
  const api: FilesystemApi = {
    async create(name, options = {}) {
      const client = getClient();
      const body: Record<string, unknown> = { name };
      if (options.description !== undefined) body.description = options.description;
      if (options.orgId !== undefined) body.org_id = options.orgId;
      const created = await client.post<ApiFilesystem>("/filesystem", body);
      return new Filesystem(client, created);
    },

    async get(filesystemId) {
      const client = getClient();
      const fs = await client.get<ApiFilesystem>(`/filesystem/${filesystemId}`);
      return new Filesystem(client, fs);
    },

    async getOrCreate(name, options = {}) {
      const existing = (await api.list(options.orgId)).find((f) => f.name === name);
      return existing ?? api.create(name, options);
    },

    async list(orgId) {
      const client = getClient();
      const res = await client.get<GetFilesystemsResponse>("/filesystems", {
        query: orgId ? { org_id: orgId } : undefined,
      });
      return res.filesystems.map((f) => new Filesystem(client, f));
    },
  };
  return api;
}
