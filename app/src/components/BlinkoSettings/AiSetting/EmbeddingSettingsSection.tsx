import { observer } from 'mobx-react-lite';
import { CollapsibleCard } from '../../Common/CollapsibleCard';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { showTipsDialog } from '@/components/Common/TipsDialog';
import { ShowRebuildEmbeddingProgressDialog } from '@/components/Common/RebuildEmbeddingProgress';
import { AiSettingStore } from '@/store/aiSettingStore';

export const EmbeddingSettingsSection = observer(function EmbeddingSettingsSection() {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore);
  const aiStore = RootStore.Get(AiSettingStore);
  const hasLoadedModels = !!aiStore.allModels.value;
  const selectedEmbeddingModel = aiStore.embeddingModels.find((model) => model.id === blinko.config.value?.embeddingModelId);
  const embeddingReady = !hasLoadedModels || !!selectedEmbeddingModel;
  const tags = blinko.tagList.value?.falttenTags || [];

  const [localState, setLocalState] = useState({
    embeddingTopK: blinko.config.value?.embeddingTopK ?? 5,
    embeddingScore: blinko.config.value?.embeddingScore ?? 0.6,
    excludeEmbeddingTagId: blinko.config.value?.excludeEmbeddingTagId as number | null | undefined,
  });

  const [rebuildProgress, setRebuildProgress] = useState<{ percentage: number; isRunning: boolean } | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRebuildProgress = async () => {
    try {
      const data = await api.ai.rebuildEmbeddingProgress.query();
      if (!data) return;
      setRebuildProgress({
        percentage: data.percentage,
        isRunning: data.isRunning,
      });
      if (data.isRunning && !pollingIntervalRef.current) startPolling();
      else if (!data.isRunning && pollingIntervalRef.current) stopPolling();
    } catch (error) {
      console.error('Error fetching rebuild progress:', error);
    }
  };

  const startPolling = () => {
    if (pollingIntervalRef.current) return;
    pollingIntervalRef.current = setInterval(fetchRebuildProgress, 2000);
  };

  const stopPolling = () => {
    if (!pollingIntervalRef.current) return;
    clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
  };

  useEffect(() => {
    blinko.config.call();
    aiStore.allModels.call();
    blinko.tagList.call();
    fetchRebuildProgress();
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!blinko.config.value) return;
    setLocalState({
      embeddingTopK: blinko.config.value.embeddingTopK ?? 5,
      embeddingScore: blinko.config.value.embeddingScore ?? 0.6,
      excludeEmbeddingTagId: blinko.config.value.excludeEmbeddingTagId,
    });
  }, [
    blinko.config.value?.embeddingTopK,
    blinko.config.value?.embeddingScore,
    blinko.config.value?.excludeEmbeddingTagId,
  ]);

  const persist = (key: string, value: number | null) => {
    PromiseCall(api.config.update.mutate({ key, value }), { autoAlert: false });
  };

  const handleRebuildClick = async () => {
    try {
      if (!embeddingReady) {
        showTipsDialog({
          title: 'Embedding model required',
          content: 'Choose an embedding-capable model before rebuilding the index.',
        });
        return;
      }

      const latestProgress = await api.ai.rebuildEmbeddingProgress.query();
      if (latestProgress?.isRunning) {
        setRebuildProgress({ percentage: latestProgress.percentage, isRunning: true });
        ShowRebuildEmbeddingProgressDialog(true);
        startPolling();
        return;
      }

      showTipsDialog({
        title: t('force-rebuild-embedding-index'),
        content: t('if-you-have-a-lot-of-notes-you-may-consume-a-certain-number-of-tokens'),
        onConfirm: async () => {
          ShowRebuildEmbeddingProgressDialog(true);
          setRebuildProgress({ percentage: 0, isRunning: true });
          startPolling();
        },
      });
    } catch (error) {
      console.error('Failed to check rebuild status:', error);
    }
  };

  return (
    <CollapsibleCard icon="mingcute:vector-line" title="Embedding Management" className="bk-ai-card bk-ai-compact-card">
      <div className="v-stack bk-ai-settings-block">
        {!embeddingReady ? (
          <div className="bk-ai-section-warning">
            Embedding is not configured. Choose an embedding-capable model under Default Models, then rebuild the index. AI stays blocked until this is ready.
            For SiliconFlow, <code>BAAI/bge-m3</code> is a strong default; <code>Qwen/Qwen3-Embedding-4B</code> is a higher-quality alternative.
          </div>
        ) : null}

        <div className="bk-ai-form-grid">
          <label className="bk-native-field">
            <span>Top K · {localState.embeddingTopK}</span>
            <div className="bk-ai-range-wrap">
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={localState.embeddingTopK}
                onChange={(event) => {
                  const embeddingTopK = Number(event.currentTarget.value);
                  setLocalState((prev) => ({ ...prev, embeddingTopK }));
                }}
                onMouseUp={() => persist('embeddingTopK', localState.embeddingTopK)}
                onTouchEnd={() => persist('embeddingTopK', localState.embeddingTopK)}
                onBlur={() => persist('embeddingTopK', localState.embeddingTopK)}
              />
            </div>
            <em className="bk-ai-field-help">How many notes to retrieve for each question.</em>
          </label>

          <label className="bk-native-field">
            <span>Score · {localState.embeddingScore.toFixed(2)}</span>
            <div className="bk-ai-range-wrap">
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.01}
                value={localState.embeddingScore}
                onChange={(event) => {
                  const embeddingScore = Number(event.currentTarget.value);
                  setLocalState((prev) => ({ ...prev, embeddingScore }));
                }}
                onMouseUp={() => persist('embeddingScore', localState.embeddingScore)}
                onTouchEnd={() => persist('embeddingScore', localState.embeddingScore)}
                onBlur={() => persist('embeddingScore', localState.embeddingScore)}
              />
            </div>
            <em className="bk-ai-field-help">Minimum similarity for retrieved notes.</em>
          </label>
        </div>

        <label className="bk-native-field">
          <span>Exclude tagged content</span>
          <div className="bk-native-input-wrap">
            <select
              value={localState.excludeEmbeddingTagId ? String(localState.excludeEmbeddingTagId) : ''}
              onChange={(event) => {
                const next = event.currentTarget.value ? Number(event.currentTarget.value) : null;
                setLocalState((prev) => ({ ...prev, excludeEmbeddingTagId: next }));
                persist('excludeEmbeddingTagId', next);
              }}
            >
              <option value="">No excluded tag</option>
              {tags.map((tag: any) => (
                <option key={tag.id} value={tag.id}>
                  #{tag.name}
                </option>
              ))}
            </select>
          </div>
          <em className="bk-ai-field-help">Notes with this tag stay out of the embedding index.</em>
        </label>

        <div className="h-stack bk-ai-rebuild-row-settings">
          <div className="v-stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
            <div className="bk-ai-dialog-kicker">Rebuild index</div>
            <p className="bk-ai-settings-copy">
              Rebuilds note text only. Images and file attachments are skipped.
            </p>
          </div>
          <button
            type="button"
            className="bk-native-button is-secondary"
            onClick={handleRebuildClick}
            disabled={!embeddingReady}
          >
            {rebuildProgress?.isRunning
              ? `${t('rebuild-in-progress')} ${rebuildProgress.percentage || 0}%`
              : t('force-rebuild')}
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
});
