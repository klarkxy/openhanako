import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HanaEngine } from "../core/engine.ts";
import { SessionManifestResolver } from "../core/session-manifest/resolver.ts";
import { LEGACY_SESSION_MANIFEST_MIGRATION_KEY } from "../core/session-manifest/startup-migration.ts";
import { SessionManifestStore } from "../core/session-manifest/store.ts";
import { SessionFileRegistry } from "../lib/session-files/session-file-registry.ts";

describe("HanaEngine session manifest facade", () => {
  let tmpDir;
  let store;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-session-manifest-engine-"));
    store = new SessionManifestStore({
      dbPath: path.join(tmpDir, "session-manifest.db"),
      idGenerator: () => "sess_engine_0001",
      now: () => "2026-06-18T05:00:00.000Z",
    });
    engine = Object.create(HanaEngine.prototype);
    engine._sessionManifestStore = store;
    engine._sessionManifestResolver = new SessionManifestResolver({ store });
    engine._sessionFiles = new SessionFileRegistry({ now: () => 1234 });
  });

  afterEach(() => {
    store?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves session refs without exposing the store implementation", () => {
    const sessionPath = path.join(tmpDir, "agents", "hana", "sessions", "alpha.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "");
    const manifest = store.createForPath({ sessionPath, ownerAgentId: "hana" });

    expect(engine.resolveSessionRef({ sessionPath }).sessionId).toBe(manifest.sessionId);
    expect(engine.getSessionManifest(manifest.sessionId)?.currentLocator.path).toBe(fs.realpathSync.native(sessionPath));
    expect(engine.getSessionIdForPath(sessionPath)).toBe(manifest.sessionId);
  });

  it("adds sessionId to session file registrations when callers still pass only sessionPath", () => {
    const sessionPath = path.join(tmpDir, "agents", "hana", "sessions", "alpha.jsonl");
    const filePath = path.join(tmpDir, "report.md");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "");
    fs.writeFileSync(filePath, "# report\n");
    const manifest = store.createForPath({ sessionPath, ownerAgentId: "hana" });

    const file = engine.registerSessionFile({
      sessionPath,
      filePath,
      origin: "stage_files",
    });

    expect(file.sessionId).toBe(manifest.sessionId);
  });

  it("resolves session files by sessionId through the manifest current locator", () => {
    const sessionPath = path.join(tmpDir, "agents", "hana", "sessions", "alpha.jsonl");
    const filePath = path.join(tmpDir, "report.md");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "");
    fs.writeFileSync(filePath, "# report\n");
    const manifest = store.createForPath({ sessionPath, ownerAgentId: "hana" });
    const file = engine.registerSessionFile({
      sessionPath,
      filePath,
      origin: "stage_files",
    });
    engine._sessionFiles = new SessionFileRegistry({ now: () => 5678 });

    const restored = engine.getSessionFile(file.fileId || file.id, { sessionId: manifest.sessionId });

    expect(restored).toMatchObject({
      id: file.id,
      sessionId: manifest.sessionId,
      sessionPath,
      filePath,
    });
  });
});

describe("HanaEngine session manifest startup migration", () => {
  let tmpDir;
  let engine;

  afterEach(() => {
    engine?._sessionManifestStore?.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrates legacy session files during engine construction", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-session-manifest-engine-startup-"));
    const sessionPath = path.join(tmpDir, "agents", "hana", "sessions", "alpha.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, `${JSON.stringify({
      type: "session",
      id: "alpha",
      timestamp: "2026-06-18T06:10:00.000Z",
    })}\n`);

    engine = new HanaEngine({
      hanakoHome: tmpDir,
      productDir: tmpDir,
      agentId: "hana",
      appVersion: "9.9.9",
    } as any);

    const sessionId = engine.getSessionIdForPath(sessionPath);
    const migrationState = engine._sessionManifestStore.getState(LEGACY_SESSION_MANIFEST_MIGRATION_KEY);

    expect(sessionId).toMatch(/^sess_/);
    expect(engine._sessionManifestMigration.status).toBe("completed");
    expect(migrationState).toMatchObject({
      completedAt: expect.any(String),
      result: { scanned: 1, created: 1, existing: 0, skipped: 0 },
    });
    expect(fs.existsSync(path.join(migrationState.checkpointDirectory, "checkpoint.json"))).toBe(true);
  });
});
