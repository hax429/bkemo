import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { helper } from '@/lib/helper';
import dayjs from '@/lib/dayjs';
import { downloadFromLink } from '@/lib/tauriHelper';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { ToastPlugin } from '@/store/module/Toast/Toast';
import { ARCHIVE_BLINKO_TASK_NAME, DBBAK_TASK_NAME, WEEKLY_KNOWLEDGE_TASK_NAME } from '@shared/lib/sharedConstant';
import { loadPrefs } from '@/lib/bkemoSettings';
import { _ } from '@/lib/lodash';

type ScheduleTimezone = 'UTC' | 'America/New_York';
type TaskRow = {
  name: string;
  schedule: string;
  timezone?: string;
  lastRun?: Date | string | null;
  isRunning: boolean;
  output?: any;
  hasPassphrase?: boolean;
  hasApiKey?: boolean;
  knowledgeBaseId?: string;
};

const ARCHIVE_CADENCE = [
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
];

const TIMEZONES: { label: string; value: ScheduleTimezone }[] = [
  { label: 'UTC', value: 'UTC' },
  { label: 'New York', value: 'America/New_York' },
];

const UpdateDaysDebounced = _.debounce((value: string) => {
  return PromiseCall(api.config.update.mutate({ key: 'autoArchivedDays', value: Number(value) }));
}, 500);

function presetLabel(cron: string) {
  return helper.cron.human(cron) || cron;
}

function Field({ label, hint, children, end }: { label: string; hint?: string; children: React.ReactNode; end?: React.ReactNode }) {
  return (
    <label className="bk-native-field">
      <span>{label}</span>
      <div className="bk-native-input-wrap">
        {children}
        {end ? <span className="bk-native-field-end" style={{ color: 'var(--fg-3)', fontSize: 12 }}>{end}</span> : null}
      </div>
      {hint ? <em style={{ color: 'var(--fg-3)', fontStyle: 'normal', fontSize: 11 }}>{hint}</em> : null}
    </label>
  );
}

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--border-2)',
        background: on ? 'var(--accent)' : 'var(--bg-3)',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background .14s ease',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 18,
          height: 18,
          borderRadius: 999,
          background: '#fff',
          transform: on ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform .14s ease',
        }}
      />
    </button>
  );
}

function JobCard({
  kicker,
  title,
  description,
  enabled,
  busy,
  onToggle,
  children,
  actions,
}: {
  kicker: string;
  title: string;
  description: string;
  enabled: boolean;
  busy?: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-2)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="bk-ai-setup-kicker" style={{ marginBottom: 6 }}>{kicker}</div>
          <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)', marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>{description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: enabled ? 'var(--accent)' : 'var(--fg-3)' }}>
            {enabled ? 'On' : 'Off'}
          </span>
          <Toggle on={enabled} disabled={busy} onChange={onToggle} />
        </div>
      </div>
      <div className="v-stack" style={{ gap: 12 }}>{children}</div>
      {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>{actions}</div> : null}
    </section>
  );
}

function MetaLine({ task }: { task?: TaskRow | null }) {
  if (!task) return null;
  const output = task.output as { filePath?: string; filename?: string; error?: string; storage?: string; completedAt?: string } | undefined;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase' }}>
      <span>Last · {task.lastRun ? dayjs(task.lastRun).fromNow() : 'never'}</span>
      <span>Cadence · {presetLabel(task.schedule)}</span>
      <span>TZ · {task.timezone || 'UTC'}</span>
      {output?.storage ? <span>Store · {output.storage}</span> : null}
      {output?.error ? <span style={{ color: 'var(--urgent)' }}>Error · {output.error}</span> : null}
    </div>
  );
}

export const TaskSetting = observer(function TaskSetting() {
  const blinko = RootStore.Get(BlinkoStore);
  const prefs = loadPrefs();
  const preset = prefs.theme === 'light'
    ? 'light'
    : prefs.accent?.toLowerCase() === '#5e6ad2'
      ? 'developer'
      : prefs.accent?.toLowerCase() === '#e2a96b'
        ? 'coffee'
        : 'dusk';

  const archiveTask = blinko.ArchiveTask as TaskRow | undefined;
  const backupTask = blinko.DBTask as TaskRow | undefined;
  const weeklyTask = blinko.WeeklyKnowledgeTask as TaskRow | undefined;

  const [autoArchivedDays, setAutoArchivedDays] = useState('90');
  const [archiveCron, setArchiveCron] = useState('0 0 * * *');
  const [archiveTz, setArchiveTz] = useState<ScheduleTimezone>('UTC');
  const [backupCron, setBackupCron] = useState('0 0 * * *');
  const [backupTz, setBackupTz] = useState<ScheduleTimezone>('UTC');
  const [backupCustom, setBackupCustom] = useState(false);
  const [customCron, setCustomCron] = useState('0 0 * * *');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [weeklyApiKey, setWeeklyApiKey] = useState('');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    blinko.task.call();
  }, []);

  useEffect(() => {
    if (blinko.config.value?.autoArchivedDays) {
      setAutoArchivedDays(String(blinko.config.value.autoArchivedDays));
    }
  }, [blinko.config.value?.autoArchivedDays]);

  useEffect(() => {
    if (archiveTask?.schedule) setArchiveCron(archiveTask.schedule);
    if (archiveTask?.timezone === 'America/New_York' || archiveTask?.timezone === 'UTC') {
      setArchiveTz(archiveTask.timezone);
    }
  }, [archiveTask?.schedule, archiveTask?.timezone]);

  useEffect(() => {
    if (!backupTask?.schedule) return;
    const known = helper.cron.cornTimeList.some((item) => item.value === backupTask.schedule);
    setBackupCron(backupTask.schedule);
    setBackupCustom(!known);
    setCustomCron(backupTask.schedule);
    if (backupTask.timezone === 'America/New_York' || backupTask.timezone === 'UTC') {
      setBackupTz(backupTask.timezone);
    }
  }, [backupTask?.schedule, backupTask?.timezone]);

  useEffect(() => {
    if (weeklyTask?.knowledgeBaseId) setKnowledgeBaseId(weeklyTask.knowledgeBaseId);
  }, [weeklyTask?.knowledgeBaseId]);

  const refresh = async () => {
    await blinko.task.call();
  };

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (error: any) {
      RootStore.Get(ToastPlugin).error(error?.message ?? 'Task update failed');
    } finally {
      setBusy(null);
    }
  };

  const effectiveBackupCron = backupCustom ? customCron.trim() : backupCron;

  const saveWeeklySettings = async () => {
    const id = knowledgeBaseId.trim();
    if (!id) throw new Error('Enter a knowledge base ID');
    if (!weeklyTask?.hasApiKey && !weeklyApiKey.trim()) throw new Error('Enter a BigModel API key');
    await api.task.saveWeeklyKnowledgeSettings.mutate({
      knowledgeBaseId: id,
      apiKey: weeklyApiKey.trim() || undefined,
    });
    setWeeklyApiKey('');
  };

  return (
    <div
      className="bkemo v-stack"
      data-theme={prefs.theme}
      data-density={prefs.density}
      data-preset={preset}
      style={{
        gap: 18,
        ...(prefs.accent ? { ['--accent' as any]: prefs.accent } : {}),
      }}
    >
      <div>
        <div className="bk-ai-setup-kicker" style={{ marginBottom: 8 }}>System</div>
        <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--fg)', marginBottom: 4 }}>Schedule Task</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5, maxWidth: 560 }}>
          Pinned site jobs for archive, encrypted .bk backups, and a private weekly Markdown export to BigModel knowledge.
        </div>
      </div>

      <JobCard
        kicker="Archive"
        title="Auto-archive blinko notes"
        description="Archive plain blinko notes older than the retention window on a fixed cadence."
        enabled={Boolean(archiveTask?.isRunning)}
        busy={busy === 'archive-toggle'}
        onToggle={(next) => withBusy('archive-toggle', async () => {
          await api.task.upsertTask.mutate({
            type: next ? 'start' : 'stop',
            task: ARCHIVE_BLINKO_TASK_NAME,
            time: archiveCron,
            timezone: archiveTz,
          });
        })}
        actions={
          <>
            <button
              type="button"
              className="bk-native-button is-secondary is-small"
              disabled={busy !== null}
              onClick={() => withBusy('archive-run', async () => {
                await api.task.upsertTask.mutate({ type: 'runNow', task: ARCHIVE_BLINKO_TASK_NAME });
                RootStore.Get(ToastPlugin).success('Archive job queued');
              })}
            >
              Run now
            </button>
            {archiveTask?.isRunning ? (
              <button
                type="button"
                className="bk-native-button is-ghost is-small"
                disabled={busy !== null}
                onClick={() => withBusy('archive-update', async () => {
                  await api.task.upsertTask.mutate({
                    type: 'update',
                    task: ARCHIVE_BLINKO_TASK_NAME,
                    time: archiveCron,
                    timezone: archiveTz,
                  });
                  RootStore.Get(ToastPlugin).success('Archive schedule updated');
                })}
              >
                Save schedule
              </button>
            ) : null}
          </>
        }
      >
        <div className="bk-ai-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <Field label="Retention" end="days">
            <input
              type="number"
              min={1}
              value={autoArchivedDays}
              onChange={(event) => {
                setAutoArchivedDays(event.target.value);
                UpdateDaysDebounced(event.target.value);
              }}
            />
          </Field>
          <Field label="Cadence">
            <select
              value={ARCHIVE_CADENCE.some((item) => item.value === archiveCron) ? archiveCron : '0 0 * * *'}
              onChange={(event) => setArchiveCron(event.target.value)}
            >
              {ARCHIVE_CADENCE.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Timezone">
            <select value={archiveTz} onChange={(event) => setArchiveTz(event.target.value as ScheduleTimezone)}>
              {TIMEZONES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <MetaLine task={archiveTask} />
      </JobCard>

      <JobCard
        kicker="Backup"
        title="Scheduled .bk backup"
        description="Full-site encrypted portable archive. Uses the same double-encryption as Data Transfer. Restore from Settings → Data Transfer."
        enabled={Boolean(backupTask?.isRunning)}
        busy={busy === 'backup-toggle'}
        onToggle={(next) => withBusy('backup-toggle', async () => {
          if (next) {
            if (!backupTask?.hasPassphrase) {
              if (passphrase.length < 8 || passphrase !== confirm) {
                throw new Error('Enter matching passphrases with at least 8 characters before enabling');
              }
            }
            await api.task.upsertTask.mutate({
              type: 'start',
              task: DBBAK_TASK_NAME,
              time: effectiveBackupCron,
              timezone: backupTz,
              passphrase: passphrase || undefined,
            });
            setPassphrase('');
            setConfirm('');
          } else {
            await api.task.upsertTask.mutate({ type: 'stop', task: DBBAK_TASK_NAME });
          }
        })}
        actions={
          <>
            <button
              type="button"
              className="bk-native-button is-secondary is-small"
              disabled={busy !== null || (!backupTask?.hasPassphrase && passphrase.length < 8)}
              onClick={() => withBusy('backup-run', async () => {
                if (passphrase) {
                  if (passphrase.length < 8 || passphrase !== confirm) {
                    throw new Error('Enter matching passphrases with at least 8 characters');
                  }
                  await api.task.upsertTask.mutate({ type: 'update', task: DBBAK_TASK_NAME, passphrase });
                  setPassphrase('');
                  setConfirm('');
                }
                await api.task.upsertTask.mutate({ type: 'runNow', task: DBBAK_TASK_NAME });
                RootStore.Get(ToastPlugin).success('Backup queued');
              })}
            >
              Run now
            </button>
            <button
              type="button"
              className="bk-native-button is-ghost is-small"
              disabled={busy !== null}
              onClick={() => withBusy('backup-update', async () => {
                if (passphrase) {
                  if (passphrase.length < 8 || passphrase !== confirm) {
                    throw new Error('Enter matching passphrases with at least 8 characters');
                  }
                }
                if (backupTask?.isRunning) {
                  await api.task.upsertTask.mutate({
                    type: 'update',
                    task: DBBAK_TASK_NAME,
                    time: effectiveBackupCron,
                    timezone: backupTz,
                    passphrase: passphrase || undefined,
                  });
                } else if (passphrase) {
                  await api.task.upsertTask.mutate({
                    type: 'update',
                    task: DBBAK_TASK_NAME,
                    passphrase,
                  });
                }
                setPassphrase('');
                setConfirm('');
                RootStore.Get(ToastPlugin).success('Backup settings saved');
              })}
            >
              Save settings
            </button>
            {backupTask?.output?.filePath ? (
              <button
                type="button"
                className="bk-native-button is-primary is-small"
                onClick={() => downloadFromLink(getBlinkoEndpoint(backupTask.output.filePath), backupTask.output.filename || 'bkemo-backup.bk')}
              >
                Download latest
              </button>
            ) : null}
          </>
        }
      >
        <div className="bk-ai-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Cadence">
            <select
              value={backupCustom ? 'custom' : backupCron}
              onChange={(event) => {
                if (event.target.value === 'custom') {
                  setBackupCustom(true);
                  return;
                }
                setBackupCustom(false);
                setBackupCron(event.target.value);
              }}
            >
              {helper.cron.cornTimeList.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
              <option value="custom">Custom cron</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select value={backupTz} onChange={(event) => setBackupTz(event.target.value as ScheduleTimezone)}>
              {TIMEZONES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          {backupCustom ? (
            <Field label="Custom cron" hint="Five-field cron, e.g. 0 3 * * 1">
              <input value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="0 0 * * *" />
            </Field>
          ) : null}
        </div>

        <div className="bk-ai-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Passphrase" hint={backupTask?.hasPassphrase ? 'Passphrase is set. Enter a new one to replace it.' : 'Required to enable or run scheduled .bk backups.'}>
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder={backupTask?.hasPassphrase ? '••••••••' : 'At least 8 characters'}
            />
          </Field>
          <Field label="Confirm">
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repeat passphrase"
            />
          </Field>
        </div>

        <MetaLine task={backupTask} />
        {backupTask?.output?.filename ? (
          <div style={{ color: 'var(--fg-2)', fontSize: 12 }}>
            Latest file: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{backupTask.output.filename}</code>
            {typeof backupTask.output.retained === 'number' ? ` · keeping ${backupTask.output.retained} of ${7}` : null}
          </div>
        ) : null}
      </JobCard>

      <JobCard
        kicker="Knowledge"
        title="Weekly knowledge export"
        description="Combines the configured superadmin's notes from the previous completed New York week into one metadata-rich Markdown file, then uploads it to BigModel. Notes tagged exclude_from_ai are skipped."
        enabled={Boolean(weeklyTask?.isRunning)}
        busy={busy === 'weekly-toggle'}
        onToggle={(next) => withBusy('weekly-toggle', async () => {
          if (next) await saveWeeklySettings();
          await api.task.upsertTask.mutate({
            type: next ? 'start' : 'stop',
            task: WEEKLY_KNOWLEDGE_TASK_NAME,
            time: '0 3 * * 1',
            timezone: 'America/New_York',
          });
          RootStore.Get(ToastPlugin).success(next ? 'Weekly export enabled' : 'Weekly export disabled');
        })}
        actions={
          <>
            <button
              type="button"
              className="bk-native-button is-secondary is-small"
              disabled={busy !== null}
              onClick={() => withBusy('weekly-save', async () => {
                await saveWeeklySettings();
                RootStore.Get(ToastPlugin).success('BigModel settings saved');
              })}
            >
              Save settings
            </button>
            <button
              type="button"
              className="bk-native-button is-ghost is-small"
              disabled={busy !== null}
              onClick={() => withBusy('weekly-test', async () => {
                await saveWeeklySettings();
                const result = await api.task.testWeeklyKnowledgeConnection.mutate();
                RootStore.Get(ToastPlugin).success(`Connected · ${result.documentCount} documents`);
              })}
            >
              Test connection
            </button>
            <button
              type="button"
              className="bk-native-button is-primary is-small"
              disabled={busy !== null}
              onClick={() => withBusy('weekly-run', async () => {
                await saveWeeklySettings();
                await api.task.upsertTask.mutate({ type: 'runNow', task: WEEKLY_KNOWLEDGE_TASK_NAME });
                RootStore.Get(ToastPlugin).success('Weekly export uploaded');
              })}
            >
              Run now
            </button>
            {weeklyTask?.output?.documentId ? (
              <button
                type="button"
                className="bk-native-button is-ghost is-small"
                disabled={busy !== null}
                onClick={() => withBusy('weekly-status', async () => {
                  const result = await api.task.checkWeeklyKnowledgeStatus.mutate();
                  RootStore.Get(ToastPlugin).success(`Status checked · ${result.embeddingStat ?? 'processing'}`);
                })}
              >
                Check status
              </button>
            ) : null}
            {weeklyTask?.output?.filePath ? (
              <button
                type="button"
                className="bk-native-button is-ghost is-small"
                disabled={busy !== null}
                onClick={() => downloadFromLink(
                  getBlinkoEndpoint(weeklyTask.output.filePath),
                  weeklyTask.output.filename || 'bkemo_week.md',
                )}
              >
                Download latest
              </button>
            ) : null}
          </>
        }
      >
        <div className="bk-ai-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          <Field label="Knowledge base ID" hint="The numeric BigModel knowledge base identifier.">
            <input
              value={knowledgeBaseId}
              onChange={(event) => setKnowledgeBaseId(event.target.value.replace(/\D/g, ''))}
              placeholder="Knowledge base ID"
              inputMode="numeric"
              spellCheck={false}
            />
          </Field>
          <Field label="BigModel API key" hint={weeklyTask?.hasApiKey ? 'Saved securely. Leave blank to keep it.' : 'Required before testing or running.'}>
            <input
              type="password"
              autoComplete="new-password"
              value={weeklyApiKey}
              onChange={(event) => setWeeklyApiKey(event.target.value)}
              placeholder={weeklyTask?.hasApiKey ? '••••••••' : 'Enter API key'}
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="bk-ai-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Cadence">
            <input value="Monday at 03:00" readOnly />
          </Field>
          <Field label="Timezone">
            <input value="America/New_York" readOnly />
          </Field>
          <Field label="Privacy tag">
            <input value="exclude_from_ai" readOnly />
          </Field>
        </div>

        <MetaLine task={weeklyTask} />
        {weeklyTask?.output ? (
          <div style={{ color: 'var(--fg-2)', fontSize: 12, lineHeight: 1.55 }}>
            <div>
              Latest · {weeklyTask.output.noteCount ?? 0} notes
              {weeklyTask.output.filename ? <> · <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{weeklyTask.output.filename}</code></> : null}
            </div>
            {weeklyTask.output.documentId ? (
              <div>Document · <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{weeklyTask.output.documentId}</code> · vector status {weeklyTask.output.embeddingStat ?? 'processing'}</div>
            ) : null}
            {weeklyTask.output.embeddingFailure?.message ? <div style={{ color: 'var(--urgent)' }}>Vectorization · {weeklyTask.output.embeddingFailure.message}</div> : null}
            {weeklyTask.output.warning ? <div style={{ color: 'var(--important)' }}>Warning · {weeklyTask.output.warning}</div> : null}
          </div>
        ) : null}
      </JobCard>

      <section
        style={{
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
          background: 'transparent',
        }}
      >
        <div className="bk-ai-setup-kicker" style={{ marginBottom: 8 }}>Automations</div>
        <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--fg)', marginBottom: 4 }}>Coming soon</div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.5 }}>
          AI scheduled tasks and custom scripts will live here. Create one-off .bk exports anytime from Data Transfer.
        </div>
      </section>
    </div>
  );
});
