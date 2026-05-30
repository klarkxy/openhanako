import { useCallback, useEffect, useState } from 'react';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { SettingsRow } from '../components/SettingsRow';
import { Toggle } from '../widgets/Toggle';
import { useSettingsStore } from '../store';

export function WorkflowTab() {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const showToast = useSettingsStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/preferences/workflow');
      const body = await res.json();
      setEnabled(body?.settings?.enabled === true);
    } catch (err) {
      console.warn('[workflow] load failed:', err);
      setEnabled(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await hanaFetch('/api/preferences/workflow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { enabled: next } }),
      });
      const body = await res.json();
      setEnabled(body?.settings?.enabled === true);
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsRow
      label={t('settings.workflow.enabled')}
      hint={t('settings.workflow.enabledHint')}
      control={<Toggle on={enabled} onChange={(next) => save(next)} disabled={saving} />}
    />
  );
}
