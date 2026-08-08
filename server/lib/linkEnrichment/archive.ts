import { getWithProxy, postWithProxy } from '../proxy';

const SPN_SAVE = 'https://web.archive.org/save';
const SPN_STATUS = 'https://web.archive.org/save/status';

export type ArchiveSubmitResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: string };

export type ArchiveStatusResult =
  | { ok: true; status: 'pending' | 'success' | 'error'; archiveUrl?: string; message?: string }
  | { ok: false; reason: string };

function iaCredentials(): { access: string; secret: string } | null {
  const access = process.env.IA_S3_ACCESS_KEY?.trim();
  const secret = process.env.IA_S3_SECRET_KEY?.trim();
  if (!access || !secret) return null;
  return { access, secret };
}

function authHeader(access: string, secret: string): string {
  return `LOW ${access}:${secret}`;
}

/** Submit a Save Page Now 2 capture. Requires IA_S3_ACCESS_KEY / IA_S3_SECRET_KEY. */
export async function submitSavePageNow(url: string): Promise<ArchiveSubmitResult> {
  const creds = iaCredentials();
  if (!creds) return { ok: false, reason: 'Internet Archive credentials are not configured' };

  const res: any = await postWithProxy(
    SPN_SAVE,
    new URLSearchParams({ url }).toString(),
    {
      useAdmin: true,
      config: {
        headers: {
          Authorization: authHeader(creds.access, creds.secret),
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        timeout: 30_000,
      },
    },
  );

  if (res?.error) return { ok: false, reason: res.message || 'Save Page Now request failed' };
  const jobId = res?.data?.job_id ?? res?.data?.jobId;
  if (!jobId || typeof jobId !== 'string') {
    return { ok: false, reason: 'Save Page Now did not return a job id' };
  }
  return { ok: true, jobId };
}

export async function pollSavePageNow(jobId: string): Promise<ArchiveStatusResult> {
  const creds = iaCredentials();
  if (!creds) return { ok: false, reason: 'Internet Archive credentials are not configured' };

  const res: any = await getWithProxy(`${SPN_STATUS}/${encodeURIComponent(jobId)}`, {
    useAdmin: true,
    config: {
      headers: {
        Authorization: authHeader(creds.access, creds.secret),
        Accept: 'application/json',
      },
      timeout: 20_000,
    },
  });

  if (res?.error) return { ok: false, reason: res.message || 'Save Page Now status failed' };
  const data = res?.data ?? {};
  const status = String(data.status || data.status_ext || '').toLowerCase();

  if (status === 'success') {
    const timestamp = data.timestamp || data.capture_ts;
    const original = data.original_url || data.url;
    const archiveUrl =
      data.archive_url ||
      (timestamp && original ? `https://web.archive.org/web/${timestamp}/${original}` : undefined);
    if (!archiveUrl) return { ok: false, reason: 'Archive succeeded without a URL' };
    return { ok: true, status: 'success', archiveUrl };
  }

  if (status === 'error' || status === 'failed') {
    return { ok: true, status: 'error', message: data.message || data.status_ext || 'Archive failed' };
  }

  return { ok: true, status: 'pending' };
}
