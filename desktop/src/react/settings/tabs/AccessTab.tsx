import React from 'react';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import styles from '../Settings.module.css';

export function AccessTab() {
  return (
    <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="access">
      <SettingsSection title="多设备访问">
        <SettingsRow
          label="状态"
          hint="已为安全原因关闭所有多设备能力，包括 LAN/远程接入、访问密钥、移动 Web 登录与设备管理。"
          control={<strong>已禁用</strong>}
        />
      </SettingsSection>
    </div>
  );
}
