import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { hanaFetch } from '../api';
import { useSettingsStore } from '../store';
import { SettingsSection } from '../components/SettingsSection';
import { type KnownUser } from './bridge/BridgeWidgets';
import styles from '../Settings.module.css';

type Relation = 'family' | 'friend' | 'stranger';
type Platform = 'telegram' | 'feishu' | 'qq' | 'wechat' | 'whatsapp' | 'unknown';

interface ContactAccount {
  platform: Platform;
  userId?: string | null;
  chatId?: string | null;
  label?: string | null;
}

interface ContactPolicy {
  hostPermissionMode?: string;
  infoDisclosure?: string;
  toneProfile?: string;
  audiencePrompt?: string | null;
}

interface Contact {
  id: string;
  displayName: string;
  relation: Relation;
  notes?: string;
  aliases?: string[];
  tags?: string[];
  accounts: ContactAccount[];
  policy?: ContactPolicy;
}

interface BridgeStatus {
  knownUsers?: Partial<Record<Platform, KnownUser[]>>;
  owner?: Partial<Record<Platform, string>>;
}

interface ContactsSettings {
  audiencePrompts?: Partial<Record<Relation, string>>;
}

interface ContactsResponse {
  contacts?: Contact[];
  settings?: ContactsSettings;
}

const EDITABLE_RELATIONS: Relation[] = ['family', 'friend', 'stranger'];
const PLATFORM_ORDER: Platform[] = ['telegram', 'feishu', 'qq', 'wechat', 'whatsapp', 'unknown'];

function createEmptyForm() {
  return {
    displayName: '',
    relation: 'stranger' as Relation,
    aliasesText: '',
    tagsText: '',
    accountsText: '',
    notes: '',
  };
}

function createEmptyAudiencePrompts() {
  return {
    family: '',
    friend: '',
    stranger: '',
  } as Record<Relation, string>;
}

function normalizePromptText(value?: string | null) {
  return String(value || '').trim();
}

function normalizeAudiencePrompts(raw?: Partial<Record<Relation, string>> | null) {
  return {
    family: normalizePromptText(raw?.family),
    friend: normalizePromptText(raw?.friend),
    stranger: normalizePromptText(raw?.stranger),
  };
}

function parseCommaList(text: string) {
  return [...new Set(
    text
      .split(/[，,]/)
      .map(item => item.trim())
      .filter(Boolean),
  )];
}

function serializeCommaList(values: string[] = []) {
  return values.join(', ');
}

function parseAccountsText(text: string): ContactAccount[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/[，,\t]/).map(part => part.trim());
      const [platformRaw, userIdRaw = '', chatIdRaw = '', labelRaw = ''] = parts;
      const platform = (platformRaw || 'unknown').toLowerCase() as Platform;
      const userId = userIdRaw || null;
      const chatId = chatIdRaw || null;
      const label = labelRaw || null;
      if (!platform || (!userId && !chatId)) return [];
      const fingerprint = [platform, userId || '', chatId || ''].join(':');
      if (seen.has(fingerprint)) return [];
      seen.add(fingerprint);
      return [{ platform, userId, chatId, label } as ContactAccount];
    });
}

function serializeAccounts(accounts: ContactAccount[] = []) {
  return accounts
    .map(account => [account.platform || 'unknown', account.userId || '', account.chatId || '', account.label || ''].join(', '))
    .join('\n');
}

function relationTone(relation: Relation | 'self') {
  if (relation === 'self') return { bg: 'rgba(67, 133, 88, 0.14)', fg: 'rgb(53, 94, 67)' };
  if (relation === 'family') return { bg: 'rgba(219, 146, 68, 0.16)', fg: 'rgb(126, 81, 23)' };
  if (relation === 'friend') return { bg: 'rgba(69, 111, 183, 0.14)', fg: 'rgb(43, 74, 126)' };
  return { bg: 'rgba(138, 122, 107, 0.16)', fg: 'rgb(111, 95, 79)' };
}

function platformLabel(platform: Platform, isZh: boolean) {
  const zh: Record<Platform, string> = {
    telegram: 'Telegram',
    feishu: '飞书',
    qq: 'QQ',
    wechat: '微信',
    whatsapp: 'WhatsApp',
    unknown: '未知平台',
  };
  const en: Record<Platform, string> = {
    telegram: 'Telegram',
    feishu: 'Feishu',
    qq: 'QQ',
    wechat: 'WeChat',
    whatsapp: 'WhatsApp',
    unknown: 'Unknown',
  };
  return (isZh ? zh : en)[platform] || platform;
}

function accountLine(platform: Platform, user: KnownUser) {
  return [platform, user.userId || '', '', user.name || ''].join(', ');
}

function candidateName(user: KnownUser) {
  return user.name || user.userId;
}

function candidateKey(platform: Platform, user: KnownUser) {
  return `${platform}:${user.userId}`;
}

export function ContactsTab() {
  const currentAgentId = useSettingsStore(s => s.currentAgentId);
  const showToast = useSettingsStore(s => s.showToast);
  const locale = window.i18n?.locale || 'zh-CN';
  const isZh = locale.startsWith('zh');
  const copy = useMemo(() => ({
    tabTitle: isZh ? '通讯录' : 'Contacts',
    intro: isZh
      ? '这是一份共享通讯录，所有助手共用同一套联系人。先从当前桥接状态里选候选，再决定是家人、朋友还是陌生人。'
      : 'This is a shared address book. All agents use the same contacts. Pick a known bridge user first, then decide whether they are family, a friend, or a stranger.',
    sharedNote: isZh
      ? 'owner 仍然在“社交平台”里配置，这里只维护联系人和关系级对外意识。'
      : 'Owner accounts are still configured in Social. This tab only manages contacts and relation-specific outward awareness.',
    candidateTitle: isZh ? '候选接入' : 'Known Users',
    candidateHint: isZh
      ? '从当前桥接状态里的已知用户里直接点选，系统会自动把账号映射塞进联系人表单。'
      : 'Select a known user from the current bridge status and their account mapping will be filled into the form automatically.',
    candidateEmpty: isZh ? '当前没有可选候选。先让外部平台接入后再回来选。' : 'No known users yet. Connect an external platform first, then come back to pick one.',
    candidateAdd: isZh ? '加入通讯录' : 'Add to contacts',
    ownerLabel: isZh ? 'owner' : 'owner',
    ownerNote: isZh ? '这些账号是当前 owner，不会加入通讯录。' : 'These accounts belong to the current owner and are not added to the address book.',
    formTitleNew: isZh ? '新增联系人' : 'New contact',
    formTitleEdit: isZh ? '编辑联系人' : 'Edit contact',
    listTitle: isZh ? '联系人列表' : 'Contacts',
    nameLabel: isZh ? '联系人名称' : 'Display name',
    relationLabel: isZh ? '关系等级' : 'Relationship',
    aliasesLabel: isZh ? '别名' : 'Aliases',
    tagsLabel: isZh ? '标签' : 'Tags',
    accountsLabel: isZh ? '账号映射' : 'Account mappings',
    accountsHint: isZh
      ? '每行一个映射，格式：platform, userId, chatId, label。至少填 userId 或 chatId。点击候选会自动填好。'
      : 'One mapping per line: platform, userId, chatId, label. Fill at least userId or chatId. Clicking a known user fills this automatically.',
    notesLabel: isZh ? '备注' : 'Notes',
    refresh: isZh ? '刷新' : 'Refresh',
    create: isZh ? '创建联系人' : 'Create contact',
    save: isZh ? '保存修改' : 'Save changes',
    cancelEdit: isZh ? '取消编辑' : 'Cancel edit',
    edit: isZh ? '编辑' : 'Edit',
    remove: isZh ? '删除' : 'Delete',
    empty: isZh ? '还没有联系人。先从候选里加一个，或者手动创建。' : 'No contacts yet. Add one from the known-user picker or create one manually.',
    loading: isZh ? '正在加载通讯录...' : 'Loading contacts...',
    noAgent: isZh ? '当前没有可用助手。' : 'No agent is available right now.',
    nameRequired: isZh ? '请先填写联系人名称' : 'Display name is required',
    accountRequired: isZh ? '至少要提供一条账号映射' : 'At least one account mapping is required',
    saveOkCreate: isZh ? '联系人已创建' : 'Contact created',
    saveOkUpdate: isZh ? '联系人已更新' : 'Contact updated',
    saveFailed: isZh ? '保存通讯录失败' : 'Failed to save contact',
    loadFailed: isZh ? '读取通讯录失败' : 'Failed to load contacts',
    removeConfirm: isZh ? '确定删除这个联系人吗？' : 'Delete this contact?',
    removeOk: isZh ? '联系人已删除' : 'Contact deleted',
    removeFailed: isZh ? '删除联系人失败' : 'Failed to delete contact',
    filterTitle: isZh ? '筛选' : 'Filters',
    filterRelationLabel: isZh ? '按关系筛选' : 'Filter by relation',
    filterQueryLabel: isZh ? '搜索联系人' : 'Search contacts',
    filterQueryPlaceholder: isZh ? '名字、别名、标签、账号' : 'Name, alias, tag, or account',
    countSuffix: isZh ? '条' : 'items',
    policyModeLabel: isZh ? '会话模式' : 'Session mode',
    policyDisclosureLabel: isZh ? '信息披露' : 'Disclosure',
    policyToneLabel: isZh ? '口气' : 'Tone',
    audienceTitle: isZh ? '对外意识' : 'Outward awareness',
    audienceHint: isZh
      ? '这三段文本对所有助手共享，分别用于家人、朋友、陌生人。它们会和系统的关系策略一起拼进 bridge prompt。'
      : 'These three prompts are shared across all agents and are used for family, friends, and strangers. They are combined with the built-in relation policy in the bridge prompt.',
    audienceSave: isZh ? '保存对外意识' : 'Save awareness',
    audienceReset: isZh ? '重置为空' : 'Clear prompts',
    audienceFamilyLabel: isZh ? '家人' : 'Family',
    audienceFriendLabel: isZh ? '朋友' : 'Friend',
    audienceStrangerLabel: isZh ? '陌生人' : 'Stranger',
    audienceFamilyPlaceholder: isZh ? '例如：更亲近一些，允许日常寒暄，但不要泄露敏感信息。' : 'For example: warmer tone, allow everyday small talk, but do not reveal sensitive information.',
    audienceFriendPlaceholder: isZh ? '例如：可以概括近况和公开信息，但避免内部细节。' : 'For example: you may share summaries and public information, but avoid internal details.',
    audienceStrangerPlaceholder: isZh ? '例如：保持礼貌简短，必要时直接拒绝。' : 'For example: keep it polite and brief, and refuse when needed.',
    relationLabels: {
      self: isZh ? '自己' : 'Self',
      family: isZh ? '家人' : 'Family',
      friend: isZh ? '朋友' : 'Friend',
      stranger: isZh ? '陌生人' : 'Stranger',
    } as Record<'self' | Relation, string>,
    platformLabels: {
      telegram: platformLabel('telegram', isZh),
      feishu: platformLabel('feishu', isZh),
      qq: platformLabel('qq', isZh),
      wechat: platformLabel('wechat', isZh),
      whatsapp: platformLabel('whatsapp', isZh),
      unknown: platformLabel('unknown', isZh),
    } as Record<Platform, string>,
  }), [isZh]);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [audiencePrompts, setAudiencePrompts] = useState<Record<Relation, string>>(createEmptyAudiencePrompts());
  const [loading, setLoading] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(createEmptyForm());
  const [filters, setFilters] = useState<{ relation: '' | Relation; query: string }>({ relation: '', query: '' });

  const loadData = useCallback(async () => {
    if (!currentAgentId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('agentId', currentAgentId);
      if (filters.relation) params.set('relation', filters.relation);
      if (filters.query.trim()) params.set('query', filters.query.trim());

      const [contactsRes, settingsRes, statusRes] = await Promise.all([
        hanaFetch(`/api/bridge/contacts?${params.toString()}`),
        hanaFetch(`/api/bridge/contacts/settings?agentId=${encodeURIComponent(currentAgentId)}`),
        hanaFetch(`/api/bridge/status?agentId=${encodeURIComponent(currentAgentId)}`),
      ]);
      const [contactsData, settingsData, statusData] = await Promise.all([
        contactsRes.json() as Promise<ContactsResponse>,
        settingsRes.json() as Promise<{ settings?: ContactsSettings }>,
        statusRes.json() as Promise<BridgeStatus>,
      ]);

      setContacts(Array.isArray(contactsData.contacts) ? contactsData.contacts : []);
      const nextSettings = settingsData?.settings || contactsData?.settings || {};
      setAudiencePrompts(normalizeAudiencePrompts(nextSettings.audiencePrompts));
      setBridgeStatus(statusData && typeof statusData === 'object' ? statusData : null);
    } catch (err) {
      showToast(`${copy.loadFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed, currentAgentId, filters.query, filters.relation, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(createEmptyForm());
  }, []);

  const startEdit = useCallback((contact: Contact) => {
    setEditingId(contact.id);
    setForm({
      displayName: contact.displayName || '',
      relation: contact.relation === 'family' || contact.relation === 'friend' ? contact.relation : 'stranger',
      aliasesText: serializeCommaList(contact.aliases || []),
      tagsText: serializeCommaList(contact.tags || []),
      accountsText: serializeAccounts(contact.accounts),
      notes: contact.notes || '',
    });
  }, []);

  const startCandidateDraft = useCallback((platform: Platform, user: KnownUser) => {
    setEditingId(null);
    setForm({
      displayName: candidateName(user),
      relation: 'stranger',
      aliasesText: '',
      tagsText: '',
      accountsText: accountLine(platform, user),
      notes: '',
    });
  }, []);

  const submit = useCallback(async () => {
    if (!currentAgentId) return;
    const displayName = form.displayName.trim();
    if (!displayName) {
      showToast(copy.nameRequired, 'error');
      return;
    }
    const accounts = parseAccountsText(form.accountsText);
    if (accounts.length === 0) {
      showToast(copy.accountRequired, 'error');
      return;
    }

    setSavingContact(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const suffix = editingId ? `/${encodeURIComponent(editingId)}` : '';
      await hanaFetch(`/api/bridge/contacts${suffix}?agentId=${encodeURIComponent(currentAgentId)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          relation: form.relation,
          aliases: parseCommaList(form.aliasesText),
          tags: parseCommaList(form.tagsText),
          notes: form.notes.trim(),
          accounts,
        }),
      });
      showToast(editingId ? copy.saveOkUpdate : copy.saveOkCreate, 'success');
      resetForm();
      await loadData();
    } catch (err) {
      showToast(`${copy.saveFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSavingContact(false);
    }
  }, [copy.accountRequired, copy.nameRequired, copy.saveFailed, copy.saveOkCreate, copy.saveOkUpdate, currentAgentId, editingId, form, loadData, resetForm, showToast]);

  const saveAudiencePrompts = useCallback(async () => {
    if (!currentAgentId) return;
    setSavingSettings(true);
    try {
      await hanaFetch(`/api/bridge/contacts/settings?agentId=${encodeURIComponent(currentAgentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audiencePrompts }),
      });
      showToast(copy.audienceSave, 'success');
      await loadData();
    } catch (err) {
      showToast(`${copy.saveFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSavingSettings(false);
    }
  }, [audiencePrompts, copy.audienceSave, copy.saveFailed, currentAgentId, loadData, showToast]);

  const remove = useCallback(async (contact: Contact) => {
    if (!currentAgentId) return;
    if (!window.confirm(copy.removeConfirm)) return;
    try {
      await hanaFetch(`/api/bridge/contacts/${encodeURIComponent(contact.id)}?agentId=${encodeURIComponent(currentAgentId)}`, {
        method: 'DELETE',
      });
      showToast(copy.removeOk, 'success');
      if (editingId === contact.id) resetForm();
      await loadData();
    } catch (err) {
      showToast(`${copy.removeFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [copy.removeConfirm, copy.removeFailed, copy.removeOk, currentAgentId, editingId, loadData, resetForm, showToast]);

  const ownerSummary = useMemo(() => {
    const entries = Object.entries(bridgeStatus?.owner || {})
      .filter(([, userId]) => !!userId)
      .map(([platform, userId]) => `${copy.platformLabels[platform as Platform] || platform}: ${userId}`);
    if (entries.length === 0) return '';
    return `${copy.ownerLabel} ${entries.join(' · ')}`;
  }, [bridgeStatus?.owner, copy.ownerLabel, copy.platformLabels]);

  const knownUserGroups = useMemo(() => PLATFORM_ORDER
    .map((platform) => ({
      platform,
      users: bridgeStatus?.knownUsers?.[platform] || [],
    }))
    .filter(group => group.users.length > 0), [bridgeStatus?.knownUsers]);

  if (!currentAgentId) {
    return (
      <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="contacts">
        <SettingsSection title={copy.tabTitle}>
          <SettingsSection.Note>{copy.noAgent}</SettingsSection.Note>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="contacts">
      <SettingsSection title={copy.tabTitle}>
        <SettingsSection.Note>{copy.intro}</SettingsSection.Note>
        <SettingsSection.Note>{copy.sharedNote}</SettingsSection.Note>
      </SettingsSection>

      <SettingsSection title={copy.candidateTitle} collapsible defaultCollapsed>
        <SettingsSection.Note>{copy.candidateHint}</SettingsSection.Note>
        {ownerSummary ? <SettingsSection.Note>{ownerSummary}</SettingsSection.Note> : null}
        {knownUserGroups.length === 0 ? (
          <SettingsSection.Note>{copy.candidateEmpty}</SettingsSection.Note>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
            {knownUserGroups.map(({ platform, users }) => (
              <div
                key={platform}
                style={{
                  display: 'grid',
                  gap: '0.75rem',
                  padding: 'var(--space-md)',
                  borderRadius: '16px',
                  border: '1px solid var(--settings-divider)',
                  background: 'var(--surface-elevated, rgba(255,255,255,0.7))',
                }}
              >
                <strong>{copy.platformLabels[platform] || platform}</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {users.map((user) => (
                    <button
                      key={candidateKey(platform, user)}
                      type="button"
                      className={styles['settings-btn-secondary']}
                      onClick={() => startCandidateDraft(platform, user)}
                      style={{
                        borderRadius: '999px',
                        border: '1px solid var(--settings-divider)',
                        background: 'var(--surface-elevated, rgba(255,255,255,0.75))',
                        padding: '0.35rem 0.7rem',
                      }}
                    >
                      {candidateName(user)}
                      <span style={{ marginLeft: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {copy.candidateAdd}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={editingId ? copy.formTitleEdit : copy.formTitleNew}>
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.nameLabel}</span>
            <input
              aria-label={copy.nameLabel}
              className={styles['settings-input']}
              value={form.displayName}
              onChange={(event) => setForm(prev => ({ ...prev, displayName: event.target.value }))}
              placeholder={isZh ? '比如：妈妈 / 小林 / 工作群管理员' : 'For example: Mom / Alice / Group admin'}
            />
          </label>

          <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span>{copy.relationLabel}</span>
              <select
                aria-label={copy.relationLabel}
                className={styles['settings-input']}
                value={form.relation}
                onChange={(event) => setForm(prev => ({ ...prev, relation: event.target.value as Relation }))}
              >
                {EDITABLE_RELATIONS.map(relation => (
                  <option key={relation} value={relation}>{copy.relationLabels[relation]}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span>{copy.aliasesLabel}</span>
              <input
                aria-label={copy.aliasesLabel}
                className={styles['settings-input']}
                value={form.aliasesText}
                onChange={(event) => setForm(prev => ({ ...prev, aliasesText: event.target.value }))}
                placeholder={isZh ? '逗号分隔，例如：姐, 大姐' : 'Comma separated, for example: sis, big sis'}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span>{copy.tagsLabel}</span>
              <input
                aria-label={copy.tagsLabel}
                className={styles['settings-input']}
                value={form.tagsText}
                onChange={(event) => setForm(prev => ({ ...prev, tagsText: event.target.value }))}
                placeholder={isZh ? '逗号分隔，例如：家庭, 紧急联系人' : 'Comma separated, for example: family, priority'}
              />
            </label>
          </div>

          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.accountsLabel}</span>
            <textarea
              aria-label={copy.accountsLabel}
              className={styles['settings-textarea']}
              rows={5}
              value={form.accountsText}
              onChange={(event) => setForm(prev => ({ ...prev, accountsText: event.target.value }))}
              placeholder={isZh ? 'telegram, alice_id\nwechat, , wx_chat_123, 家庭群' : 'telegram, alice_id\nwechat, , wx_chat_123, family group'}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.6 }}>{copy.accountsHint}</span>
          </label>

          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.notesLabel}</span>
            <textarea
              aria-label={copy.notesLabel}
              className={styles['settings-textarea']}
              rows={3}
              value={form.notes}
              onChange={(event) => setForm(prev => ({ ...prev, notes: event.target.value }))}
              placeholder={isZh ? '可选备注，比如“只在晚上回复”' : 'Optional note, for example “reply only at night”'}
            />
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className={styles['settings-btn-primary']} onClick={() => void submit()} disabled={savingContact}>
              {editingId ? copy.save : copy.create}
            </button>
            {editingId ? (
              <button type="button" className={styles['settings-btn-secondary']} onClick={resetForm} disabled={savingContact}>
                {copy.cancelEdit}
              </button>
            ) : null}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={copy.audienceTitle} collapsible defaultCollapsed>
        <SettingsSection.Note>{copy.audienceHint}</SettingsSection.Note>
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.audienceFamilyLabel}</span>
            <textarea
              className={styles['settings-textarea']}
              rows={4}
              value={audiencePrompts.family}
              onChange={(event) => setAudiencePrompts(prev => ({ ...prev, family: event.target.value }))}
              placeholder={copy.audienceFamilyPlaceholder}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.audienceFriendLabel}</span>
            <textarea
              className={styles['settings-textarea']}
              rows={4}
              value={audiencePrompts.friend}
              onChange={(event) => setAudiencePrompts(prev => ({ ...prev, friend: event.target.value }))}
              placeholder={copy.audienceFriendPlaceholder}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.45rem' }}>
            <span>{copy.audienceStrangerLabel}</span>
            <textarea
              className={styles['settings-textarea']}
              rows={4}
              value={audiencePrompts.stranger}
              onChange={(event) => setAudiencePrompts(prev => ({ ...prev, stranger: event.target.value }))}
              placeholder={copy.audienceStrangerPlaceholder}
            />
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className={styles['settings-btn-primary']} onClick={() => void saveAudiencePrompts()} disabled={savingSettings}>
              {copy.audienceSave}
            </button>
            <button
              type="button"
              className={styles['settings-btn-secondary']}
              onClick={() => setAudiencePrompts(createEmptyAudiencePrompts())}
              disabled={savingSettings}
            >
              {copy.audienceReset}
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={copy.listTitle}
        collapsible
        context={(
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{contacts.length} {copy.countSuffix}</span>
            <button type="button" className={styles['settings-btn-secondary']} onClick={() => void loadData()} disabled={loading}>
              {copy.refresh}
            </button>
          </div>
        )}
      >
        <div style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          <strong>{copy.filterTitle}</strong>
          <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span>{copy.filterRelationLabel}</span>
              <select
                aria-label={copy.filterRelationLabel}
                className={styles['settings-input']}
                value={filters.relation}
                onChange={(event) => setFilters(prev => ({ ...prev, relation: event.target.value as '' | Relation }))}
              >
                <option value="">{isZh ? '全部' : 'All'}</option>
                {EDITABLE_RELATIONS.map(relation => (
                  <option key={relation} value={relation}>{copy.relationLabels[relation]}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.45rem' }}>
              <span>{copy.filterQueryLabel}</span>
              <input
                aria-label={copy.filterQueryLabel}
                className={styles['settings-input']}
                value={filters.query}
                onChange={(event) => setFilters(prev => ({ ...prev, query: event.target.value }))}
                placeholder={copy.filterQueryPlaceholder}
              />
            </label>
          </div>
        </div>

        {loading ? (
          <SettingsSection.Note>{copy.loading}</SettingsSection.Note>
        ) : contacts.length === 0 ? (
          <SettingsSection.Note>{copy.empty}</SettingsSection.Note>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
            {contacts.map((contact) => {
              const tone = relationTone(contact.relation);
              return (
                <div
                  key={contact.id}
                  style={{
                    display: 'grid',
                    gap: '0.8rem',
                    padding: 'var(--space-md)',
                    borderRadius: '18px',
                    border: '1px solid var(--settings-divider)',
                    background: 'var(--surface-elevated, rgba(255,255,255,0.7))',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                      <strong>{contact.displayName}</strong>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.2rem 0.65rem',
                          borderRadius: '999px',
                          background: tone.bg,
                          color: tone.fg,
                          fontSize: '0.78rem',
                          fontWeight: 600,
                        }}
                      >
                        {copy.relationLabels[contact.relation] || contact.relation}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <button type="button" className={styles['settings-btn-secondary']} onClick={() => startEdit(contact)}>
                        {copy.edit}
                      </button>
                      <button type="button" className={styles['settings-btn-secondary']} onClick={() => void remove(contact)}>
                        {copy.remove}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                      <div style={{ padding: '0.7rem 0.85rem', borderRadius: '14px', background: 'var(--surface-elevated, rgba(255,255,255,0.65))' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{copy.policyModeLabel}</div>
                        <strong>{contact.policy?.hostPermissionMode || 'unknown'}</strong>
                      </div>
                      <div style={{ padding: '0.7rem 0.85rem', borderRadius: '14px', background: 'var(--surface-elevated, rgba(255,255,255,0.65))' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{copy.policyDisclosureLabel}</div>
                        <strong>{contact.policy?.infoDisclosure || 'unknown'}</strong>
                      </div>
                      <div style={{ padding: '0.7rem 0.85rem', borderRadius: '14px', background: 'var(--surface-elevated, rgba(255,255,255,0.65))' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{copy.policyToneLabel}</div>
                        <strong>{contact.policy?.toneProfile || contact.relation}</strong>
                      </div>
                    </div>

                    {contact.accounts.map((account, index) => (
                      <div key={`${contact.id}-${index}`} style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {copy.platformLabels[account.platform] || account.platform}
                        {account.userId ? ` · userId=${account.userId}` : ''}
                        {account.chatId ? ` · chatId=${account.chatId}` : ''}
                        {account.label ? ` · ${account.label}` : ''}
                      </div>
                    ))}
                  </div>

                  {contact.aliases?.length ? (
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      <strong>{copy.aliasesLabel}</strong>
                      {' · '}
                      {contact.aliases.join(' / ')}
                    </div>
                  ) : null}

                  {contact.tags?.length ? (
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      <strong>{copy.tagsLabel}</strong>
                      {' · '}
                      {contact.tags.join(' / ')}
                    </div>
                  ) : null}

                  {contact.notes ? (
                    <div style={{ color: 'var(--text-muted)', lineHeight: 1.7 }}>{contact.notes}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}