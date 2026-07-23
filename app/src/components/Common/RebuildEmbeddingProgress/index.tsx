import i18n from '@/lib/i18n';
import { api } from '@/lib/trpc';
import { type ProgressResult } from '@shared/lib/types';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Common/Iconify/icons';
import { DialogStore } from '@/store/module/Dialog';
import { loadPrefs } from '@/lib/bkemoSettings';

function dialogThemeAttrs() {
  const prefs = loadPrefs();
  const preset = prefs.theme === 'light'
    ? 'light'
    : (prefs.accent?.toLowerCase() === '#5e6ad2'
      ? 'developer'
      : (prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));
  const style: CSSProperties = prefs.accent ? { ['--accent' as any]: prefs.accent } : {};
  return { theme: prefs.theme, density: prefs.density, preset, style };
}

function statusLabel(status: string, t: (key: string) => string) {
  if (status === 'running') return t('processing');
  if (status === 'success') return t('completed');
  if (status === 'error') return t('error');
  return '';
}

export const ImportProgress = observer(({ force }: { force: boolean }) => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const theme = dialogThemeAttrs();
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState<ProgressResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const percent = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
  const isSuccess = status === 'success';
  const isError = status === 'error';
  const isRunning = status === 'running';

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const mergeMessages = (incoming: ProgressResult[]) => {
      setMessage((prev) => {
        if (prev.length === 0) return [...incoming].reverse();
        const existing = new Set(prev.map((item) => `${item.type}:${item.content}`));
        const unique = incoming.filter((item) => !existing.has(`${item.type}:${item.content}`));
        return unique.length ? [...unique.reverse(), ...prev] : prev;
      });
    };

    const fetchProgress = async () => {
      try {
        const result = await api.ai.rebuildEmbeddingProgress.query();
        if (cancelled || !result) return;
        setProgress(result.current || 0);
        setTotal(result.total || 0);
        if (!result.isRunning && (result.current || 0) > 0) {
          setStatus('success');
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        } else if (result.isRunning) {
          setStatus('running');
        }
        if (result.results?.length) {
          mergeMessages(result.results.map((item: any) => ({
            type: item.type,
            content: item.content,
            error: item.error,
          })));
        }
        blinko.updateTicker++;
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to fetch progress');
      }
    };

    const start = async () => {
      try {
        await api.ai.rebuildEmbeddingStart.mutate({ force });
        if (cancelled) return;
        setStatus('running');
        setMessage([{ type: 'info', content: t('rebuild-started') }]);
        await fetchProgress();
        timer = setInterval(fetchProgress, 2000);
        blinko.updateTicker++;
      } catch (err: any) {
        if (!cancelled) {
          setStatus('error');
          setError(err?.message || 'Failed to start rebuild task');
        }
      }
    };

    // If a rebuild is already running, only poll; otherwise start one.
    api.ai.rebuildEmbeddingProgress.query()
      .then(async (result) => {
        if (cancelled) return;
        if (result?.isRunning) {
          setStatus('running');
          await fetchProgress();
          timer = setInterval(fetchProgress, 2000);
        } else {
          await start();
        }
      })
      .catch(async () => {
        if (!cancelled) await start();
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force]);

  const stopTask = async () => {
    try {
      await api.ai.rebuildEmbeddingStop.mutate();
      const result = await api.ai.rebuildEmbeddingProgress.query();
      if (result) {
        setProgress(result.current || 0);
        setTotal(result.total || 0);
      }
      setStatus('success');
      setMessage((prev) => [{ type: 'info', content: t('rebuild-stopped-by-user') }, ...prev]);
      blinko.updateTicker++;
      RootStore.Get(DialogStore).close();
    } catch (err: any) {
      setError(err?.message || 'Failed to stop rebuild task');
    }
  };

  return (
    <div
      className="bkemo bk-ai-dialog bk-ai-rebuild-dialog"
      data-theme={theme.theme}
      data-density={theme.density}
      data-preset={theme.preset}
      style={theme.style}
    >
      <button
        type="button"
        className="bk-ai-dialog-close"
        onClick={() => RootStore.Get(DialogStore).close()}
        aria-label="Close"
      >
        <Icon icon="hugeicons:cancel-01" width="18" height="18" />
      </button>

      <div className="bk-ai-dialog-hero">
        <div>
          <div className="bk-ai-dialog-kicker">Embeddings</div>
          <h2>{t('rebuilding-embedding-progress')}</h2>
          <p>Note text only. Images and file attachments are skipped.</p>
        </div>
        <span className={`bk-ai-rebuild-status is-${status || 'idle'}`}>
          {statusLabel(status, t) || '…'}
        </span>
      </div>

      <div className="bk-ai-dialog-body">
        <div className="bk-ai-rebuild-meter">
          <div className="h-stack bk-ai-rebuild-meter-meta">
            <span>
              <strong>{progress}</strong> / {total} notes
            </span>
            <span>{percent}%</span>
          </div>
          <div className="bk-ai-rebuild-track" aria-hidden>
            <div className="bk-ai-rebuild-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {error ? (
          <div className="bk-ai-runtime-notice is-danger">
            <div>{t('error')}</div>
            <p>{error}</p>
          </div>
        ) : null}

        <div className="bk-scroll bk-ai-rebuild-log">
          {message.length === 0 ? (
            <div className="bk-ai-pick-empty is-soft">
              <Icon icon="line-md:loading-twotone-loop" width="18" height="18" className="animate-spin" />
              <span>{t('loading')}…</span>
            </div>
          ) : message.map((item, index) => (
            <article
              key={`${item.type}-${item.content}-${index}`}
              className={`bk-ai-rebuild-row is-${item.type || 'info'}`}
            >
              <span className="bk-ai-rebuild-row-icon">
                {item.type === 'success' ? '✓' : item.type === 'error' ? '✕' : item.type === 'skip' ? '–' : 'i'}
              </span>
              <div className="bk-ai-rebuild-row-copy">
                <div className="bk-ai-rebuild-row-title">{item?.content}</div>
                {item.error ? (
                  <div className="bk-ai-rebuild-row-error">
                    {String(item.error as unknown as string)}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="bk-ai-dialog-footer">
        {isRunning ? (
          <button type="button" className="bk-native-button is-secondary" onClick={stopTask}>
            <Icon icon="mingcute:stop-circle-fill" width="16" height="16" />
            {t('stop-task')}
          </button>
        ) : (
          <span className="bk-ai-rebuild-footer-note">
            {isSuccess ? t('completed') : isError ? t('error') : ''}
          </span>
        )}
        <div className="bk-ai-dialog-footer-actions">
          <button
            type="button"
            className="bk-native-button is-primary"
            onClick={() => RootStore.Get(DialogStore).close()}
          >
            {isRunning ? 'Hide' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
});

export const ShowRebuildEmbeddingProgressDialog = async (force = false) => {
  RootStore.Get(DialogStore).setData({
    isOpen: true,
    size: '2xl',
    noPadding: true,
    onlyContent: true,
    className: 'bk-ai-modal',
    content: <ImportProgress force={force} />,
  });
};
