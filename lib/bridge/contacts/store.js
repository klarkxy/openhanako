import crypto from "crypto";
import fs from "fs";
import path from "path";
import { KNOWN_PLATFORMS } from "../session-key.js";
import {
  getEffectiveBridgeRelationPolicy,
  normalizeBridgeRelation,
} from "./policy.js";

export const BRIDGE_CONTACT_STORE_VERSION = 2;

const CONTACTS_FILE = "bridge-contacts.json";
const SUPPORTED_PLATFORMS = new Set([...KNOWN_PLATFORMS, "unknown"]);
const AUDIENCE_PROMPT_RELATIONS = ["family", "friend", "stranger"];
const DEFAULT_AUDIENCE_PROMPTS = Object.freeze({
  family: "",
  friend: "",
  stranger: "",
});

export function getBridgeContactsPath(agent) {
  const baseDir = agent?.userDir || agent?.agentDir;
  if (!baseDir) throw new Error("bridge contacts require agent.userDir or agent.agentDir");
  return path.join(baseDir, CONTACTS_FILE);
}

function getLegacyBridgeContactsPath(agent) {
  if (!agent?.agentDir) throw new Error("bridge contacts require agent.agentDir");
  return path.join(agent.agentDir, CONTACTS_FILE);
}

export function ensureBridgeContactStore(agent) {
  const storePath = getBridgeContactsPath(agent);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) {
    const migrated = migrateLegacyBridgeContactStore(agent);
    if (migrated) {
      writeBridgeContactStore(agent, migrated);
      return migrated;
    }
    const store = createEmptyStore();
    writeBridgeContactStore(agent, store);
    return store;
  }
  return readBridgeContactStore(agent);
}

export function readBridgeContactStore(agent) {
  const storePath = getBridgeContactsPath(agent);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) {
    return createEmptyStore();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    return normalizeStore(raw);
  } catch {
    // Corrupted file — return empty store so callers are not poisoned.
    return createEmptyStore();
  }
}

export function writeBridgeContactStore(agent, store) {
  const normalized = normalizeStore(store);
  normalized.updatedAt = nowIso();
  const storePath = getBridgeContactsPath(agent);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}

export function getBridgeContactSettings(agent) {
  return ensureBridgeContactStore(agent).settings;
}

export function updateBridgeContactSettings(agent, input = {}) {
  const store = ensureBridgeContactStore(agent);
  store.settings = normalizeStoreSettings(input, store.settings);
  const normalized = writeBridgeContactStore(agent, store);
  return normalized.settings;
}

export function listBridgeContacts(agent, filters = {}) {
  const store = ensureBridgeContactStore(agent);
  const relation = normalizeOptionalText(filters.relation).toLowerCase();
  const query = normalizeOptionalText(filters.query).toLowerCase();
  const platform = normalizeOptionalText(filters.platform).toLowerCase();

  return store.contacts
    .filter((contact) => {
      if (relation && contact.relation !== relation) return false;
      if (platform && !contact.accounts.some((account) => account.platform === platform)) return false;
      if (!query) return true;

      const haystack = [
        contact.displayName,
        ...contact.aliases,
        ...contact.tags,
        contact.notes,
        ...contact.accounts.flatMap((account) => [account.platform, account.userId, account.chatId, account.label]),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-Hans-CN"))
    .map((contact) => hydrateContact(contact, store.settings));
}

export function getBridgeContactById(agent, id) {
  const targetId = normalizeOptionalText(id);
  if (!targetId) return null;
  const store = ensureBridgeContactStore(agent);
  const contact = store.contacts.find((item) => item.id === targetId);
  return contact ? hydrateContact(contact, store.settings) : null;
}

export function upsertBridgeContact(agent, input) {
  const store = ensureBridgeContactStore(agent);
  const targetId = normalizeOptionalText(input?.id);
  const index = targetId ? store.contacts.findIndex((item) => item.id === targetId) : -1;
  const existing = index >= 0 ? store.contacts[index] : null;
  const next = normalizeContact(input, existing, { preserveTimestamps: false });

  if (index >= 0) {
    store.contacts[index] = next;
  } else {
    store.contacts.push(next);
  }

  writeBridgeContactStore(agent, store);
  return hydrateContact(next, store.settings);
}

export function removeBridgeContact(agent, id) {
  const targetId = normalizeOptionalText(id);
  if (!targetId) return false;

  const store = ensureBridgeContactStore(agent);
  const nextContacts = store.contacts.filter((contact) => contact.id !== targetId);
  if (nextContacts.length === store.contacts.length) {
    return false;
  }

  store.contacts = nextContacts;
  writeBridgeContactStore(agent, store);
  return true;
}

export function resolveBridgeAudience(agent, matchInput = {}) {
  const candidate = normalizeIncomingAccount(matchInput);
  const store = ensureBridgeContactStore(agent);
  if (matchInput?.isOwner === true) {
    return {
      matched: true,
      relation: "self",
      policy: hydrateAudiencePolicy(getEffectiveBridgeRelationPolicy("self"), store.settings, "self"),
      candidate,
      source: "owner_policy",
    };
  }

  const matched = store.contacts.find((contact) => matchesAccount(contact, candidate));
  if (!matched) {
    return {
      matched: false,
      relation: "stranger",
      policy: hydrateAudiencePolicy(getEffectiveBridgeRelationPolicy("stranger"), store.settings, "stranger"),
      candidate,
      source: "default",
      reason: "no_account_match",
    };
  }

  const contact = hydrateContact(matched, store.settings);
  return {
    matched: true,
    relation: contact.relation,
    contact,
    policy: contact.policy,
    candidate,
    source: "address_book",
    reason: "account_match",
  };
}

function createEmptyStore() {
  return {
    version: BRIDGE_CONTACT_STORE_VERSION,
    contacts: [],
    settings: {
      audiencePrompts: { ...DEFAULT_AUDIENCE_PROMPTS },
    },
    updatedAt: nowIso(),
  };
}

function normalizeStore(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const contacts = [];
  for (const value of Array.isArray(source.contacts) ? source.contacts : []) {
    try {
      contacts.push(normalizeContact(value, null, { preserveTimestamps: true }));
    } catch {
      // Ignore malformed records so a single bad row does not poison the address book.
    }
  }

  return {
    version: BRIDGE_CONTACT_STORE_VERSION,
    contacts,
    settings: normalizeStoreSettings(source.settings || source, source.settings || null),
    updatedAt: normalizeOptionalText(source.updatedAt) || nowIso(),
  };
}

function normalizeStoreSettings(raw, fallback = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : null;
  const promptSource = source.audiencePrompts || source.relationPrompts || source.prompts || null;
  const fallbackPrompts = fallbackSource?.audiencePrompts || fallbackSource || null;
  return {
    audiencePrompts: normalizeAudiencePrompts(promptSource, fallbackPrompts),
  };
}

function normalizeAudiencePrompts(raw, fallback = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_AUDIENCE_PROMPTS;
  const prompts = {};
  for (const relation of AUDIENCE_PROMPT_RELATIONS) {
    prompts[relation] = normalizeOptionalText(source[relation] ?? base[relation]);
  }
  return prompts;
}

function hydrateContact(contact, settings = null) {
  return {
    ...contact,
    policy: hydrateAudiencePolicy(getEffectiveBridgeRelationPolicy(contact.relation, contact.policyOverrides), settings, contact.relation),
  };
}

function hydrateAudiencePolicy(policy, settings, relation) {
  const explicitPrompt = normalizeOptionalText(policy?.audiencePrompt);
  const settingPrompt = normalizeOptionalText(settings?.audiencePrompts?.[relation]);
  const audiencePrompt = explicitPrompt || settingPrompt;
  return audiencePrompt ? { ...policy, audiencePrompt } : { ...policy };
}

function normalizeContact(raw, existing = null, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const displayName = normalizeOptionalText(source.displayName ?? existing?.displayName);
  if (!displayName) throw new Error("displayName is required");

  const preserveTimestamps = options.preserveTimestamps === true;
  const createdAt = preserveTimestamps
    ? normalizeOptionalText(source.createdAt ?? existing?.createdAt) || nowIso()
    : normalizeOptionalText(existing?.createdAt) || nowIso();
  const updatedAt = preserveTimestamps
    ? normalizeOptionalText(source.updatedAt ?? existing?.updatedAt) || createdAt
    : nowIso();

  return {
    id: normalizeOptionalText(source.id ?? existing?.id) || `bridge_contact_${crypto.randomUUID()}`,
    displayName,
    relation: normalizeBridgeRelation(source.relation ?? existing?.relation),
    aliases: normalizeStringList(source.aliases ?? existing?.aliases ?? []),
    tags: normalizeStringList(source.tags ?? existing?.tags ?? []),
    notes: normalizeOptionalText(source.notes ?? existing?.notes),
    accounts: normalizeAccounts(source.accounts ?? existing?.accounts ?? []),
    policyOverrides: normalizePolicyOverrides(source.policyOverrides ?? existing?.policyOverrides ?? null),
    createdAt,
    updatedAt,
  };
}

function normalizePolicyOverrides(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of [
    "hostPermissionMode",
    "workspaceAccess",
    "infoDisclosure",
    "toneProfile",
    "promptSource",
    "audiencePrompt",
  ]) {
    const value = normalizeOptionalText(raw[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function migrateLegacyBridgeContactStore(agent) {
  const sources = collectLegacyBridgeContactStores(agent);
  if (sources.length === 0) return null;

  const merged = createEmptyStore();
  const seen = new Set();

  for (const raw of sources) {
    const store = normalizeStore(raw);
    merged.settings = normalizeStoreSettings(store.settings, merged.settings);
    for (const contact of store.contacts) {
      const key = contactMergeKey(contact);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.contacts.push(contact);
    }
  }

  merged.updatedAt = nowIso();
  return merged;
}

function collectLegacyBridgeContactStores(agent) {
  const stores = [];
  const legacyPath = getLegacyBridgeContactsPath(agent);
  const readStore = (filePath) => {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      stores.push(raw);
    } catch {
      // Ignore malformed legacy files and keep migrating the rest.
    }
  };

  if (fs.existsSync(legacyPath)) {
    readStore(legacyPath);
  }

  if (agent?.agentsDir && fs.existsSync(agent.agentsDir)) {
    const currentAgentDir = agent.agentDir ? path.resolve(agent.agentDir) : null;
    for (const entry of fs.readdirSync(agent.agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidatePath = path.join(agent.agentsDir, entry.name, CONTACTS_FILE);
      if (!fs.existsSync(candidatePath)) continue;
      if (currentAgentDir && path.resolve(path.dirname(candidatePath)) === currentAgentDir && path.resolve(candidatePath) === path.resolve(legacyPath)) {
        continue;
      }
      if (path.resolve(candidatePath) === path.resolve(legacyPath)) continue;
      readStore(candidatePath);
    }
  }

  return stores;
}

function contactMergeKey(contact) {
  const accountKey = (contact.accounts || [])
    .map(accountFingerprint)
    .sort()
    .join("|");
  if (accountKey) return `accounts:${accountKey}`;
  const textKey = [
    contact.displayName,
    contact.relation,
    ...(contact.aliases || []),
    ...(contact.tags || []),
    contact.notes,
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return textKey ? `text:${textKey}` : `id:${contact.id}`;
}

function normalizeAccounts(rawAccounts) {
  if (!Array.isArray(rawAccounts)) return [];

  const seen = new Set();
  const accounts = [];
  for (const raw of rawAccounts) {
    const account = normalizeStoredAccount(raw);
    if (!account) continue;
    const fingerprint = accountFingerprint(account);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    accounts.push(account);
  }
  return accounts;
}

function normalizeStoredAccount(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const platform = normalizePlatform(source.platform);
  const userId = normalizeOptionalText(source.userId) || null;
  const chatId = normalizeOptionalText(source.chatId) || null;
  if (!userId && !chatId) return null;
  return {
    platform,
    userId,
    chatId,
    label: normalizeOptionalText(source.label) || null,
  };
}

function normalizeIncomingAccount(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    platform: normalizePlatform(source.platform),
    userId: normalizeOptionalText(source.userId) || null,
    chatId: normalizeOptionalText(source.chatId) || null,
    name: normalizeOptionalText(source.name) || null,
  };
}

function matchesAccount(contact, candidate) {
  if (!candidate.platform) return false;
  return contact.accounts.some((account) => {
    if (account.platform !== candidate.platform) return false;
    if (candidate.userId && account.userId === candidate.userId) return true;
    if (candidate.chatId && account.chatId === candidate.chatId) return true;
    return false;
  });
}

function accountFingerprint(account) {
  return [account.platform, account.userId || "", account.chatId || ""].join(":");
}

function normalizePlatform(value) {
  const platform = normalizeOptionalText(value).toLowerCase();
  if (!platform) return "unknown";
  return SUPPORTED_PLATFORMS.has(platform) ? platform : platform;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeOptionalText(item)).filter(Boolean))];
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function nowIso() {
  return new Date().toISOString();
}