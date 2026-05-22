---
name: friends
description: "Maintain the host's built-in contact book. Suitable for adding, modifying, deleting, organizing, and querying contacts, as well as resolving platform accounts (QQ, WeChat, Feishu, Telegram, etc.) into a four-tier relationship policy: self, family, friend, and stranger."
---

# Contact Book

The contact book is now a built-in contact management and relationship policy capability of the host, no longer dependent on standalone plugins.

It handles two things:

- Maintaining a four-tier contact system: **self / family / friend / stranger**.
- Resolving platform accounts into relationship tiers and policy snapshots for bridge permission routing.

Available tools:

- `friends_list_contacts`
- `friends_upsert_contact`
- `friends_resolve_contact`
- `friends_remove_contact`

Recommended use cases:

- The user wants to add, organize, or modify contacts.
- The user wants to map QQ / Feishu / WeChat / Telegram accounts to the same person.
- Need to determine whether a platform account belongs to self, family, friend, or stranger.

Relationship meanings:

- `self`: The user themselves — full permissions.
- `family`: Family member — same permissions as self, but tone and address should reflect family relation.
- `friend`: May be given limited work summaries, but workspace operations are not allowed.
- `stranger`: Small talk only; no internal information disclosed.

Usage tips:

- When adding a contact, prefer to fill in `accounts` first, since bridge permission routing primarily relies on platform account matching.
- The same person can have multiple `accounts`, e.g., QQ private chat ID, WeChat group chatId, Telegram userId.
- When the user asks "what's in the contact book", start with `friends_list_contacts`.
- When the user provides new identity information, use `friends_upsert_contact` to update rather than delete-then-create.
- When the user asks "who does this account belong to" or "which tier is this QQ number in", use `friends_resolve_contact`.
- Only call `friends_remove_contact` when the user explicitly asks to delete a contact.

Host UI entry point:

- A dedicated "Contacts" tab already exists in the settings page, where the same data can be managed directly.