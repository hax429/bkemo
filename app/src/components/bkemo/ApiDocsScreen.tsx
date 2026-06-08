import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' };

const METHOD_TONE: Record<string, string> = {
  GET: '#5BD0A6', POST: '#E2A96B', PUT: '#5BB6D0', PATCH: '#A45EE0', DELETE: '#E0696B',
};

type Op = { path: string; method: string; summary?: string; description?: string; tags: string[]; raw: any };

/** Resolve a `$ref` (one level) against the spec's component schemas. */
function resolveSchema(spec: any, schema: any): any {
  if (!schema) return null;
  if (schema.$ref) {
    const name = String(schema.$ref).split('/').pop();
    return spec?.components?.schemas?.[name] ?? null;
  }
  return schema;
}

/** A placeholder value for a JSON sample, by JSON-schema type. */
function sampleValue(prop: any): any {
  if (!prop) return null;
  if (prop.example !== undefined) return prop.example;
  if (Array.isArray(prop.enum) && prop.enum.length) return prop.enum[0];
  switch (prop.type) {
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    default: return '';
  }
}

function requestSchema(spec: any, op: any): any {
  const s = op?.requestBody?.content?.['application/json']?.schema;
  return resolveSchema(spec, s);
}

function buildCurl(base: string, op: Op, spec: any): string {
  const url = `${base}${op.path}`;
  if (op.method === 'GET') {
    return `curl "${url}" \\\n  -H "Authorization: Bearer <TOKEN>"`;
  }
  const schema = requestSchema(spec, op.raw);
  let body = '';
  if (schema?.properties) {
    const obj: Record<string, any> = {};
    Object.entries(schema.properties).forEach(([k, v]) => { obj[k] = sampleValue(v); });
    body = ` \\\n  -d '${JSON.stringify(obj)}'`;
  }
  return `curl -X ${op.method} "${url}" \\\n  -H "Authorization: Bearer <TOKEN>" \\\n  -H "Content-Type: application/json"${body}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
      style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', color: 'var(--fg-2)', borderRadius: 'var(--radius)', padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', flexShrink: 0 }}
    >{copied ? '✓' : 'copy'}</button>
  );
}

function MethodBadge({ method }: { method: string }) {
  const tone = METHOD_TONE[method] ?? 'var(--fg-2)';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: tone, border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`, background: `color-mix(in srgb, ${tone} 14%, transparent)`, borderRadius: 4, padding: '1px 6px', minWidth: 46, textAlign: 'center', flexShrink: 0 }}>{method}</span>
  );
}

const OperationRow = observer(function OperationRow({ op, base, spec }: { op: Op; base: string; spec: any }) {
  const [open, setOpen] = useState(false);
  const schema = open ? requestSchema(spec, op.raw) : null;
  const required: string[] = schema?.required ?? [];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', overflow: 'hidden' }}>
      <div onClick={() => setOpen((v) => !v)} className="h-stack" style={{ gap: 10, padding: '9px 12px', cursor: 'pointer', alignItems: 'center' }}>
        <MethodBadge method={op.method} />
        <code style={{ fontSize: 12, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{op.path}</code>
        <span style={{ color: 'var(--fg-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{op.summary}</span>
        <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 12px 14px', borderTop: '1px solid var(--border)' }}>
          {op.description && <div style={{ fontSize: 12, color: 'var(--fg-2)', margin: '10px 0', lineHeight: 1.5 }}>{op.description}</div>}
          {schema?.properties && (
            <>
              <div style={{ ...mono, margin: '10px 0 6px' }}>Body</div>
              <div className="v-stack" style={{ gap: 4 }}>
                {Object.entries<any>(schema.properties).map(([k, v]) => (
                  <div key={k} className="h-stack" style={{ gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                    <code style={{ color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{k}</code>
                    <span style={{ ...mono, color: 'var(--accent)' }}>{v.type ?? (v.$ref ? 'object' : 'any')}{Array.isArray(v.enum) ? ` (${v.enum.join('|')})` : ''}</span>
                    {required.includes(k) && <span style={{ ...mono, color: 'var(--urgent, #E0696B)' }}>required</span>}
                    {v.description && <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>— {v.description}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ ...mono, margin: '14px 0 6px' }}>Example</div>
          <div className="h-stack" style={{ gap: 8, alignItems: 'flex-start' }}>
            <pre style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 11.5, color: 'var(--fg-2)', overflow: 'auto', margin: 0, lineHeight: 1.6 }}>{buildCurl(base, op, spec)}</pre>
            <CopyButton text={buildCurl(base, op, spec)} />
          </div>
        </div>
      )}
    </div>
  );
});

export const ApiDocsScreen = observer(function ApiDocsScreen() {
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const base = getBlinkoEndpoint('/api');
  const referenceUrl = getBlinkoEndpoint('/docs');
  const docsUrl = getBlinkoEndpoint('/api-doc');

  useEffect(() => {
    let cancelled = false;
    fetch(getBlinkoEndpoint('/api/openapi.json'))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setSpec(d); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load API spec.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => {
    if (!spec) return [] as { tag: string; ops: Op[] }[];
    const all: Op[] = [];
    for (const [path, methods] of Object.entries<any>(spec.paths ?? {})) {
      for (const [method, raw] of Object.entries<any>(methods)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        all.push({ path, method: method.toUpperCase(), summary: raw.summary, description: raw.description, tags: raw.tags ?? ['Other'], raw });
      }
    }
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((o) => `${o.path} ${o.summary ?? ''} ${o.tags.join(' ')}`.toLowerCase().includes(q)) : all;
    const byTag = new Map<string, Op[]>();
    filtered.forEach((o) => {
      const tag = o.tags[0] ?? 'Other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(o);
    });
    return [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, ops]) => ({ tag, ops }));
  }, [spec, query]);

  const total = useMemo(() => groups.reduce((n, g) => n + g.ops.length, 0), [groups]);

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', margin: 0 }}>API Docs</h2>
      <div style={{ color: 'var(--fg-2)', fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        The bkemo REST API, generated live from the server’s OpenAPI spec. Authenticate with a token from{' '}
        <span style={{ color: 'var(--accent)' }}>Security &amp; API</span> using a <code style={{ fontFamily: 'var(--font-mono)' }}>Authorization: Bearer &lt;token&gt;</code> header.
      </div>

      <div className="h-stack" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <code style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 12, color: 'var(--fg)' }}>{base}</code>
        <a href={referenceUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--accent)', alignSelf: 'center' }}>API reference ↗</a>
        <a href={docsUrl} target="_blank" rel="noreferrer" style={{ ...mono, color: 'var(--fg-3)', alignSelf: 'center' }}>Swagger UI ↗</a>
        <span className="spacer" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter endpoints…"
          style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 12.5, outline: 'none', minWidth: 200 }}
        />
      </div>

      {loading ? (
        <div style={{ ...mono, padding: 16 }}>Loading API spec…</div>
      ) : error ? (
        <div style={{ ...mono, padding: 16, color: 'var(--urgent, #E0696B)' }}>Couldn’t load the spec ({error}). Open the <a href={docsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Swagger UI</a> instead.</div>
      ) : total === 0 ? (
        <div style={{ ...mono, padding: 16 }}>No endpoints match “{query}”.</div>
      ) : (
        <div className="v-stack" style={{ gap: 26 }}>
          {groups.map((g) => (
            <div key={g.tag}>
              <div className="h-stack" style={{ gap: 8, marginBottom: 10, alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{g.tag}</span>
                <span style={mono}>{g.ops.length}</span>
              </div>
              <div className="v-stack" style={{ gap: 6 }}>
                {g.ops.map((op) => <OperationRow key={`${op.method} ${op.path}`} op={op} base={base} spec={spec} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
