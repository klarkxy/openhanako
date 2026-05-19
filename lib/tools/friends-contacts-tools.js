import { Type, StringEnum } from "../pi-sdk/index.js";
import {
  listBridgeContacts,
  removeBridgeContact,
  resolveBridgeAudience,
  upsertBridgeContact,
} from "../bridge/contacts/store.js";
import { BRIDGE_RELATIONS } from "../bridge/contacts/policy.js";
import { toolError, toolOk } from "./tool-result.js";

function summarizePolicy(policy = {}) {
  return [
    `mode=${policy.hostPermissionMode || "unknown"}`,
    `workspace=${policy.workspaceAccess || "unknown"}`,
    `disclosure=${policy.infoDisclosure || "unknown"}`,
    `tone=${policy.toneProfile || "unknown"}`,
  ].join(" ");
}

function normalizeLimit(value) {
  const limit = Number.isFinite(value) ? Math.trunc(value) : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(limit)) return 20;
  return Math.min(Math.max(limit, 1), 100);
}

function formatAccountSummary(contact) {
  return contact.accounts
    .map((account) => `${account.platform}:${account.userId || account.chatId || ""}`)
    .filter(Boolean)
    .join(", ");
}

export function createFriendsContactsTools({ agent }) {
  if (!agent?.agentDir) throw new Error("createFriendsContactsTools requires an agent with agentDir");

  const accountSchema = Type.Object({
    platform: Type.String({ description: "Platform name such as qq, wechat, telegram, or feishu." }),
    userId: Type.Optional(Type.String({ description: "Platform user identifier when available." })),
    chatId: Type.Optional(Type.String({ description: "Platform chat identifier when available." })),
    label: Type.Optional(Type.String({ description: "Optional human-readable account label." })),
  });

  return [
    {
      name: "friends_list_contacts",
      description: "List bridge contacts from the built-in address book.",
      parameters: Type.Object({
        relation: Type.Optional(StringEnum(BRIDGE_RELATIONS, {
          description: "Optional relationship filter.",
        })),
        query: Type.Optional(Type.String({
          description: "Optional fuzzy search across display name, aliases, tags, notes, and mapped accounts.",
        })),
        platform: Type.Optional(Type.String({
          description: "Optional platform filter such as qq, wechat, telegram, or feishu.",
        })),
        limit: Type.Optional(Type.Number({
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of contacts to return.",
        })),
      }),
      execute: async (_toolCallId, params = {}) => {
        try {
          const contacts = listBridgeContacts(agent, params || {});
          const sliced = contacts.slice(0, normalizeLimit(params.limit));
          if (sliced.length === 0) {
            return toolOk("No contacts matched the current filter.", {
              contacts: [],
              total: contacts.length,
            });
          }

          const lines = sliced.map((contact) => {
            const accountSummary = formatAccountSummary(contact);
            return `- ${contact.displayName} [${contact.relation}] ${summarizePolicy(contact.policy)} accounts=${accountSummary || "none"}`;
          });

          return toolOk(lines.join("\n"), {
            contacts: sliced,
            total: contacts.length,
          });
        } catch (err) {
          return toolError(err?.message || String(err), {
            errorCode: "BRIDGE_CONTACT_LIST_FAILED",
          });
        }
      },
    },
    {
      name: "friends_upsert_contact",
      description: "Create or update one built-in address-book contact for self, family, friends, or strangers.",
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: "Existing contact id when updating." })),
        displayName: Type.String({ description: "Display name for the contact." }),
        relation: StringEnum(BRIDGE_RELATIONS, { description: "Relationship level for the contact." }),
        aliases: Type.Optional(Type.Array(Type.String(), {
          description: "Optional aliases for matching or search.",
        })),
        tags: Type.Optional(Type.Array(Type.String(), {
          description: "Optional tags for organization and search.",
        })),
        notes: Type.Optional(Type.String({ description: "Free-form notes about the contact." })),
        accounts: Type.Optional(Type.Array(accountSchema, {
          description: "Mapped platform accounts for this contact.",
        })),
      }),
      execute: async (_toolCallId, params = {}) => {
        try {
          const contact = upsertBridgeContact(agent, params || {});
          return toolOk(`Saved ${contact.displayName} as ${contact.relation}.`, { contact });
        } catch (err) {
          return toolError(err?.message || String(err), {
            errorCode: "BRIDGE_CONTACT_UPSERT_FAILED",
          });
        }
      },
    },
    {
      name: "friends_resolve_contact",
      description: "Resolve one platform account into a relationship level and effective policy snapshot.",
      parameters: Type.Object({
        platform: Type.String({ description: "Platform name such as qq, wechat, telegram, or feishu." }),
        userId: Type.Optional(Type.String({ description: "Platform user identifier." })),
        chatId: Type.Optional(Type.String({ description: "Platform chat identifier." })),
        name: Type.Optional(Type.String({ description: "Optional display name hint from the platform." })),
      }),
      execute: async (_toolCallId, params = {}) => {
        try {
          const result = resolveBridgeAudience(agent, params || {});
          const text = result.matched && result.contact
            ? `${result.contact.displayName} resolved as ${result.relation}.`
            : "No contact matched this account. Falling back to stranger.";
          return toolOk(text, result);
        } catch (err) {
          return toolError(err?.message || String(err), {
            errorCode: "BRIDGE_CONTACT_RESOLVE_FAILED",
          });
        }
      },
    },
    {
      name: "friends_remove_contact",
      description: "Delete one contact from the built-in address book by id.",
      parameters: Type.Object({
        id: Type.String({ description: "Contact id to remove." }),
      }),
      execute: async (_toolCallId, params = {}) => {
        try {
          const removed = removeBridgeContact(agent, params.id);
          return toolOk(removed ? `Removed ${params.id}.` : `No contact found for ${params.id}.`, {
            removed,
          });
        } catch (err) {
          return toolError(err?.message || String(err), {
            errorCode: "BRIDGE_CONTACT_REMOVE_FAILED",
          });
        }
      },
    },
  ];
}