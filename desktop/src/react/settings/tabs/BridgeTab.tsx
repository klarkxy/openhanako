import React from 'react';
import { t } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { PlatformSection } from './bridge/PlatformSection';
import { WechatSection } from './bridge/WechatSection';
import { useBridgeState } from './bridge/useBridgeState';
import { BridgeAgentRow } from './bridge/BridgeAgentRow';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import styles from '../Settings.module.css';

export function BridgeTab() {
  const b = useBridgeState();
  // 注意：不能用 `|| {}` 兜底——空对象会让 Toggle 的 `!!status?.enabled` 显示成"假关"。
  // 传 undefined 让 Toggle 走加载态。
  const tgInfo = b.status?.telegram;
  const fsInfo = b.status?.feishu;
  const qqInfo = b.status?.qq;
  const wxInfo = b.status?.wechat;
  const obInfo = b.status?.onebot;
  const readOnly = b.status ? b.status.readOnly === true : undefined;
  const receiptEnabled = b.status ? b.status.receiptEnabled !== false : undefined;
  const globalSettingsPending = !b.status || b.globalSettingsSaving;

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="bridge">
      <SettingsSection title={t('settings.bridge.globalSettings')}>
        <SettingsRow
          label={t('settings.bridge.receiptEnabled')}
          hint={t('settings.bridge.receiptEnabledDesc')}
          control={
            <Toggle
              on={receiptEnabled}
              onChange={(on) => b.saveGlobalSettings({ receiptEnabled: on })}
              disabled={globalSettingsPending}
            />
          }
        />
        <SettingsRow
          label={t('settings.bridge.readOnly')}
          hint={t('settings.bridge.readOnlyDesc')}
          control={
            <Toggle
              on={readOnly}
              onChange={(on) => b.saveGlobalSettings({ readOnly: on })}
              disabled={globalSettingsPending}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t('settings.bridge.agentSettings')} variant="flush">
        {/* BridgeAgentRow：tab 级 context，水平平铺头像+名字
         * 未超宽时居中显示，超宽时横向滚动；selected 高亮对齐 AgentCardStack */}
        <BridgeAgentRow
          value={b.selectedAgentId}
          onChange={b.setSelectedAgentId}
        />
      </SettingsSection>

      <div className="bridge-help-link-row">
        <span className="bridge-help-link" onClick={() => window.dispatchEvent(new Event('hana-show-bridge-tutorial'))}>
          {t('settings.bridge.howTo')}
        </span>
      </div>

      {/* Telegram */}
      <PlatformSection
        platform="telegram"
        title={t('settings.bridge.telegram')}
        status={tgInfo}
        collapsible
        defaultCollapsed={!tgInfo?.enabled}
        credentialFields={[
          { key: 'token', label: t('settings.bridge.telegramToken'), type: 'secret', value: b.tgToken, onChange: b.setTgToken },
        ]}
        onToggle={async (on) => {
          if (on && !b.tgToken.trim()) { b.showToast(t('settings.bridge.noToken'), 'error'); return; }
          await b.saveBridgeConfig('telegram', b.tgToken.trim() ? { token: b.tgToken.trim() } : null, on);
        }}
        onTest={() => {
          if (!b.tgToken.trim()) { b.showToast(t('settings.bridge.noToken'), 'error'); return; }
          b.testPlatform('telegram', { token: b.tgToken.trim() });
        }}
        onCredentialBlur={async () => {
          if (b.tgToken.trim()) await b.saveBridgeConfig('telegram', { token: b.tgToken.trim() }, undefined);
        }}
        testing={b.testingPlatform === 'telegram'}
        hint={t('settings.bridge.telegramHint')}
        ownerUsers={b.status?.knownUsers?.telegram || []}
        currentOwner={b.status?.owner?.telegram}
        onOwnerChange={(userId) => b.setOwner('telegram', userId)}
      />

      {/* 飞书 */}
      <PlatformSection
        platform="feishu"
        title={t('settings.bridge.feishu')}
        status={fsInfo}
        collapsible
        defaultCollapsed={!fsInfo?.enabled}
        credentialFields={[
          { key: 'appId', label: t('settings.bridge.feishuAppId'), type: 'text', value: b.fsAppId, onChange: b.setFsAppId },
          { key: 'appSecret', label: t('settings.bridge.feishuAppSecret'), type: 'secret', value: b.fsAppSecret, onChange: b.setFsAppSecret },
        ]}
        onToggle={async (on) => {
          if (on && (!b.fsAppId.trim() || !b.fsAppSecret.trim())) { b.showToast(t('settings.bridge.noCredentials'), 'error'); return; }
          await b.saveBridgeConfig('feishu', { appId: b.fsAppId.trim(), appSecret: b.fsAppSecret.trim() }, on);
        }}
        onTest={() => {
          if (!b.fsAppId.trim() || !b.fsAppSecret.trim()) { b.showToast(t('settings.bridge.noCredentials'), 'error'); return; }
          b.testPlatform('feishu', { appId: b.fsAppId.trim(), appSecret: b.fsAppSecret.trim() });
        }}
        onCredentialBlur={async () => {
          if (b.fsAppId.trim() && b.fsAppSecret.trim())
            await b.saveBridgeConfig('feishu', { appId: b.fsAppId.trim(), appSecret: b.fsAppSecret.trim() }, undefined);
        }}
        testing={b.testingPlatform === 'feishu'}
        hint={t('settings.bridge.feishuHint')}
        ownerUsers={b.status?.knownUsers?.feishu || []}
        currentOwner={b.status?.owner?.feishu}
        onOwnerChange={(userId) => b.setOwner('feishu', userId)}
      />

      {/* QQ */}
      <PlatformSection
        platform="qq"
        title="QQ"
        status={qqInfo}
        collapsible
        defaultCollapsed={!qqInfo?.enabled}
        credentialFields={[
          { key: 'appID', label: t('settings.bridge.qqAppId'), type: 'text', value: b.qqAppId, onChange: b.setQqAppId },
          { key: 'appSecret', label: t('settings.bridge.qqAppSecret'), type: 'secret', value: b.qqAppSecret, onChange: b.setQqAppSecret },
        ]}
        onToggle={async (on) => {
          if (on && (!b.qqAppId.trim() || !b.qqAppSecret.trim())) { b.showToast(t('settings.bridge.noCredentials'), 'error'); return; }
          await b.saveBridgeConfig('qq', { appID: b.qqAppId.trim(), appSecret: b.qqAppSecret.trim() }, on);
        }}
        onTest={() => {
          if (!b.qqAppId.trim() || !b.qqAppSecret.trim()) { b.showToast(t('settings.bridge.noCredentials'), 'error'); return; }
          b.testPlatform('qq', { appID: b.qqAppId.trim(), appSecret: b.qqAppSecret.trim() });
        }}
        onCredentialBlur={async () => {
          if (b.qqAppId.trim() && b.qqAppSecret.trim())
            await b.saveBridgeConfig('qq', { appID: b.qqAppId.trim(), appSecret: b.qqAppSecret.trim() }, undefined);
        }}
        testing={b.testingPlatform === 'qq'}
        hint={t('settings.bridge.qqHint')}
        ownerUsers={b.status?.knownUsers?.qq || []}
        currentOwner={b.status?.owner?.qq}
        onOwnerChange={(userId) => b.setOwner('qq', userId)}
      />

      {/* 微信 */}
      <WechatSection
        status={wxInfo}
        showToast={b.showToast}
        onSaveConfig={(creds, enabled) => b.saveBridgeConfig('wechat', creds, enabled)}
        onReload={b.loadStatus}
        agentId={b.selectedAgentId}
        collapsible
        defaultCollapsed={!wxInfo?.enabled}
      />

      {/* OneBot */}
      <PlatformSection
        platform="onebot"
        title={t('settings.bridge.onebot')}
        status={obInfo}
        collapsible
        defaultCollapsed={!obInfo?.enabled}
        credentialFields={[
          { key: 'apiBase', label: t('settings.bridge.onebotApiBase'), type: 'text', value: b.onebotApiBase, onChange: b.setOnebotApiBase },
          { key: 'accessToken', label: t('settings.bridge.onebotAccessToken'), type: 'secret', value: b.onebotAccessToken, onChange: b.setOnebotAccessToken },
          { key: 'secret', label: t('settings.bridge.onebotSecret'), type: 'secret', value: b.onebotSecret, onChange: b.setOnebotSecret },
          { key: 'selfId', label: t('settings.bridge.onebotSelfId'), type: 'text', value: b.onebotSelfId, onChange: b.setOnebotSelfId },
        ]}
        onToggle={async (on) => {
          if (on && !b.onebotApiBase.trim()) { b.showToast(t('settings.bridge.onebotNoApiBase'), 'error'); return; }
          await b.saveBridgeConfig('onebot', {
            apiBase: b.onebotApiBase.trim(),
            accessToken: b.onebotAccessToken.trim(),
            secret: b.onebotSecret.trim(),
            selfId: b.onebotSelfId.trim(),
          }, on);
        }}
        onTest={() => {
          if (!b.onebotApiBase.trim()) { b.showToast(t('settings.bridge.onebotNoApiBase'), 'error'); return; }
          b.testPlatform('onebot', {
            apiBase: b.onebotApiBase.trim(),
            accessToken: b.onebotAccessToken.trim(),
            secret: b.onebotSecret.trim(),
            selfId: b.onebotSelfId.trim(),
          });
        }}
        onCredentialBlur={async () => {
          if (b.onebotApiBase.trim()) {
            await b.saveBridgeConfig('onebot', {
              apiBase: b.onebotApiBase.trim(),
              accessToken: b.onebotAccessToken.trim(),
              secret: b.onebotSecret.trim(),
              selfId: b.onebotSelfId.trim(),
            }, undefined);
          }
        }}
        testing={b.testingPlatform === 'onebot'}
        hint={t('settings.bridge.onebotHint')}
        ownerUsers={b.status?.knownUsers?.onebot || []}
        currentOwner={b.status?.owner?.onebot}
        onOwnerChange={(userId) => b.setOwner('onebot', userId)}
      />
    </div>
  );
}
