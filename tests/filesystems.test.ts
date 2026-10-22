import { describe, expect, it } from "vitest";
import { AjentifyError, createClient } from "../src/index.js";
import { normalizeFsPath } from "../src/resources/filesystems.js";
import { mockFetch, type MockCall } from "./helpers.js";

const fsRow = { filesystem_id: "fs1", org_id: "o1", name: "Thunderhead", description: "memory", created_at: 1, updated_at: 2 };

function sdk(handler: (call: MockCall) => { status?: number; body?: unknown }) {
  const { fetch, calls } = mockFetch(handler);
  return { ...createClient({ apiKey: "k", baseUrl: "https://api.test", fetch }), calls };
}

describe("normalizeFsPath", () => {
  it("strips the tool-path prefix, adds a leading slash, drops trailing slashes", () => {
    expect(normalizeFsPath("/fs1/companies/acme", "fs1")).toBe("/companies/acme");
    expect(normalizeFsPath("/fs1", "fs1")).toBe("/");
    expect(normalizeFsPath("/fs1/", "fs1")).toBe("/");
    expect(normalizeFsPath("companies/acme/", "fs1")).toBe("/companies/acme");
    expect(normalizeFsPath("//companies//acme", "fs1")).toBe("/companies/acme");
    expect(normalizeFsPath("/", "fs1")).toBe("/");
    expect(normalizeFsPath("", "fs1")).toBe("/");
    // A folder that merely *starts* with the id is not the prefix.
    expect(normalizeFsPath("/fs12/x", "fs1")).toBe("/fs12/x");
  });
});

describe("Filesystem", () => {
  it("creates, gets, lists and getOrCreates", async () => {
    const { Filesystem, calls } = sdk((call) => {
      if (call.path === "/filesystems") return { body: { filesystems: [fsRow] } };
      return { body: fsRow };
    });
    const fs = await Filesystem.create("Thunderhead", { description: "memory", orgId: "o1" });
    expect(calls[0]!.body).toEqual({ name: "Thunderhead", description: "memory", org_id: "o1" });
    expect(fs.id).toBe("fs1");
    expect(fs.toolPath("/companies/acme")).toBe("/fs1/companies/acme");
    expect(fs.toolPath("/")).toBe("/fs1");

    const same = await Filesystem.getOrCreate("Thunderhead");
    expect(same.id).toBe("fs1");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

    const got = await Filesystem.get("fs1");
    expect(got.name).toBe("Thunderhead");
  });

  it("creates folders and files with internal paths (prefix stripped) and create_parents on by default", async () => {
    const { Filesystem, calls } = sdk((call) => {
      if (call.path === "/filesystem/fs1") return { body: fsRow };
      if (call.path === "/filesystem/fs1/folder") {
        return { body: { type: "folder", path: call.body ? (call.body as { path: string }).path : "/", name: "acme", parent_path: "/companies", description: "d" } };
      }
      if (call.path === "/filesystem/fs1/file") {
        return { body: { type: "file", path: "/companies/acme/notes.md", name: "notes.md", parent_path: "/companies/acme", size_bytes: 5, updated_at: 7 } };
      }
      throw new Error(call.path);
    });
    const fs = await Filesystem.get("fs1");
    const folder = await fs.createFolder("/fs1/companies/acme", { description: "d" });
    expect(folder.type).toBe("folder");
    expect(calls[1]!.body).toEqual({ path: "/companies/acme", create_parents: true, description: "d" });

    const file = await fs.createFile("companies/acme/notes.md", "hello");
    expect(file.sizeBytes).toBe(5);
    expect(calls[2]!.method).toBe("POST");
    expect(calls[2]!.body).toEqual({ path: "/companies/acme/notes.md", content: "hello", create_parents: true });

    await fs.writeFile("/companies/acme/notes.md", "v2", { expectedUpdatedAt: 7 });
    expect(calls[3]!.method).toBe("PUT");
    expect(calls[3]!.body).toEqual({ path: "/companies/acme/notes.md", content: "v2", expected_updated_at: 7 });

    await fs.describeFolder("/companies/acme", "Acme Corp");
    expect(calls[4]!.method).toBe("PUT");
    expect(calls[4]!.path).toBe("/filesystem/fs1/folder");
  });

  it("writeFile falls back to create when the file does not exist", async () => {
    const { Filesystem, calls } = sdk((call) => {
      if (call.path === "/filesystem/fs1") return { body: fsRow };
      if (call.method === "PUT") return { status: 404, body: { error: "not found", code: "not_found" } };
      return { body: { type: "file", path: "/a.md", name: "a.md", parent_path: "/" } };
    });
    const fs = await Filesystem.get("fs1");
    const file = await fs.writeFile("/a.md", "x");
    expect(file.path).toBe("/a.md");
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "POST"]);
  });

  it("ensureFolder tolerates already_exists", async () => {
    const { Filesystem } = sdk((call) => {
      if (call.path === "/filesystem/fs1") return { body: fsRow };
      if (call.method === "POST") return { status: 409, body: { error: "exists", code: "already_exists" } };
      return { body: { type: "folder", path: "/companies", name: "companies", parent_path: "/", children: [] } };
    });
    const fs = await Filesystem.get("fs1");
    const folder = await fs.ensureFolder("/companies");
    expect(folder.path).toBe("/companies");
  });

  it("reads nodes, checks existence, moves, removes and searches", async () => {
    const { Filesystem, calls } = sdk((call) => {
      if (call.path === "/filesystem/fs1") return { body: fsRow };
      if (call.path === "/filesystem/fs1/node" && call.method === "GET") {
        if (call.query.get("path") === "/missing") return { status: 404, body: { error: "nope", code: "not_found" } };
        if (call.query.get("path") === "/notes.md") return { body: { type: "file", path: "/notes.md", name: "notes.md", parent_path: "/", content: "hi" } };
        return { body: { type: "folder", path: "/", name: "", parent_path: "", children: [{ name: "notes.md", path: "/notes.md", type: "file", size_bytes: 2 }] } };
      }
      if (call.path === "/filesystem/fs1/node" && call.method === "DELETE") {
        return { body: { path: "/old", type: "folder", deleted: { folders: 1, files: 3 } } };
      }
      if (call.path === "/filesystem/fs1/move") return { body: { source_path: "/a", destination_path: "/b", type: "folder" } };
      if (call.path === "/filesystem/fs1/search") return { body: { query: "x", path: "/", matches: [{ path: "/notes.md", type: "file", matched_on: "content", snippet: "x" }], truncated: false } };
      throw new Error(call.path);
    });
    const fs = await Filesystem.get("fs1");
    expect(await fs.readFile("/notes.md")).toBe("hi");
    const root = await fs.get("/");
    expect(root.type === "folder" && root.children[0]!.name).toBe("notes.md");
    await expect(fs.readFile("/")).rejects.toBeInstanceOf(AjentifyError);
    expect(await fs.exists("/missing")).toBe(false);
    expect(await fs.exists("/notes.md")).toBe(true);

    const moved = await fs.move("/a", "/b");
    expect(moved.destinationPath).toBe("/b");
    const removed = await fs.remove("/old", { recursive: true });
    expect(removed.deleted.files).toBe(3);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.query.get("recursive")).toBe("true");

    const found = await fs.search("x", { scope: "content", limit: 5 });
    expect(found.matches[0]!.matchedOn).toBe("content");
    const search = calls.find((c) => c.path === "/filesystem/fs1/search")!;
    expect(search.query.get("scope")).toBe("content");
    expect(search.query.get("limit")).toBe("5");
  });
});
