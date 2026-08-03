import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/trpc';
import { loadPrefs } from '@/lib/bkemoSettings';

export default function OAuthAuthorizePage() {
  const prefs = loadPrefs();
  const [consent, setConsent] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const params = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    return {
      clientId: query.get('client_id') || '',
      redirectUri: query.get('redirect_uri') || '',
      responseType: query.get('response_type') || '',
      codeChallenge: query.get('code_challenge') || '',
      codeChallengeMethod: query.get('code_challenge_method') || '',
      scope: query.get('scope') || undefined,
      resource: query.get('resource') || '',
      state: query.get('state') || undefined,
    };
  }, []);

  useEffect(() => {
    api.oauth.prepare.query(params as any).then(setConsent).catch((reason) => setError(reason?.message || 'Invalid authorization request.'));
  }, [params]);

  const approve = async () => {
    setSubmitting(true);
    setError('');
    try {
      const result = await api.oauth.approve.mutate(params as any);
      window.location.assign(result.redirectTo);
    } catch (reason: any) {
      setError(reason?.message || 'Authorization failed.');
      setSubmitting(false);
    }
  };

  const deny = () => {
    if (!consent) return;
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    if (params.state) redirect.searchParams.set('state', params.state);
    window.location.assign(redirect.toString());
  };

  const preset = prefs.theme === 'light' ? 'light' : prefs.accent?.toLowerCase() === '#5e6ad2' ? 'developer' : prefs.accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk';
  return (
    <main
      className="bkemo"
      data-theme={prefs.theme}
      data-density={prefs.density}
      data-preset={preset}
      style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', display: 'grid', placeItems: 'center', padding: 20, ...({ '--accent': prefs.accent } as any) }}
    >
      <section style={{ width: 'min(520px, 100%)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)', padding: 24 }}>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>MCP authorization</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Connect {consent?.clientName || 'application'}</h1>
        <p style={{ color: 'var(--fg-2)', fontSize: 13, lineHeight: 1.6 }}>
          This application is requesting access to your bkemo account. You can revoke it later in Security & API.
        </p>
        {error ? (
          <div style={{ border: '1px solid color-mix(in srgb, var(--urgent) 45%, transparent)', color: 'var(--urgent)', padding: 12, borderRadius: 'var(--radius)', fontSize: 12 }}>{error}</div>
        ) : !consent ? (
          <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Loading request...</div>
        ) : (
          <>
            <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '14px 0', margin: '18px 0' }}>
              {(consent.scopes as string[]).map((scope) => (
                <div key={scope} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--accent)' }}>✓</span>
                  <code>{scope}</code>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="bk-native-button is-secondary" onClick={deny} disabled={submitting}>Deny</button>
              <button className="bk-native-button is-primary" onClick={approve} disabled={submitting}>{submitting ? 'Connecting...' : 'Allow access'}</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
