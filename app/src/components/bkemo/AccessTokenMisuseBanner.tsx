import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/trpc';
import { ACCESS_TOKEN_PLATFORM_LABELS, type AccessTokenPlatform } from '@shared/lib/accessTokenPlatform';
import { eventBus } from '@/lib/event';

type Incident = {
  id: string;
  accessTokenId: number;
  tokenName: string;
  expectedPlatform: string;
  observedPlatform: string;
  requestCount: number;
};

function label(platform: string) {
  return ACCESS_TOKEN_PLATFORM_LABELS[platform as AccessTokenPlatform] ?? platform;
}

/** Full misuse controls — web + macOS only. */
export const AccessTokenMisuseBanner = observer(function AccessTokenMisuseBanner() {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const load = useCallback(async () => {
    try {
      setIncidents(await api.accessTokens.misuseIncidents.query() as Incident[]);
    } catch {
      /* ignore when logged out */
    }
  }, []);

  useEffect(() => {
    void load();
    const onSecurity = () => { void load(); };
    eventBus.on('security:token-misuse', onSecurity);
    return () => { eventBus.off('security:token-misuse', onSecurity); };
  }, [load]);

  if (incidents.length === 0) return null;

  return (
    <div style={{
      borderBottom: '1px solid color-mix(in srgb, var(--urgent, #E0696B) 40%, transparent)',
      background: 'color-mix(in srgb, var(--urgent, #E0696B) 12%, var(--bg))',
      padding: '10px 16px',
    }}>
      {incidents.map((incident) => (
        <div key={incident.id} className="h-stack" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
          <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.45 }}>
            Access token “{incident.tokenName}” is bound to {label(incident.expectedPlatform)} but was used from {label(incident.observedPlatform)}
            {incident.requestCount > 1 ? ` (${incident.requestCount} times)` : ''}.
            {' '}Review in Settings → Security.
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`Revoke “${incident.tokenName}”?`)) return;
              await api.accessTokens.revoke.mutate({ id: incident.accessTokenId });
              await load();
            }}
            style={{ background: 'transparent', border: '1px solid #5C2A2A', color: '#E0696B', padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11.5, cursor: 'pointer' }}
          >Revoke</button>
          <button
            type="button"
            onClick={async () => {
              await api.accessTokens.dismissMisuse.mutate({ id: incident.id });
              await load();
            }}
            style={{ background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--fg-2)', padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 11.5, cursor: 'pointer' }}
          >Dismiss</button>
        </div>
      ))}
    </div>
  );
});
