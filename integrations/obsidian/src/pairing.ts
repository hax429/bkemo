import { Notice } from 'obsidian';
import type BkemoPlugin from './main';
import { looksLikeAccessToken, looksLikePairingCode } from './credentialShape';
import { BKEMO_SECRET_NAME } from './settings';

export { looksLikeAccessToken, looksLikePairingCode };

async function storeCredential(plugin: BkemoPlugin, token: string, label: string): Promise<void> {
  const secretName = plugin.settings.credentialSecretName || BKEMO_SECRET_NAME;
  plugin.app.secretStorage.setSecret(secretName, token);
  plugin.settings.credentialSecretName = secretName;
  plugin.settings.pairedDeviceLabel = label;
  await plugin.saveSettings();
}

export async function pairWithCode(plugin: BkemoPlugin, code: string): Promise<boolean> {
  try {
    const result = await plugin.client.exchangePairingCode(code.trim(), 'Obsidian');
    await storeCredential(plugin, result.token, `device …${result.preview}`);
    new Notice('bkemo paired');
    return true;
  } catch (error: any) {
    new Notice(error?.message || 'Pairing failed');
    return false;
  }
}

function normalizeCredentialInput(raw: string): string {
  let token = raw.trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  // JWTs must not contain whitespace; pairing codes only have one hyphen.
  if (looksLikeAccessToken(token.replace(/\s+/g, '')) || token.replace(/\s+/g, '').split('.').length === 3) {
    return token.replace(/\s+/g, '');
  }
  return token;
}

export async function pairWithAccessToken(plugin: BkemoPlugin, accessToken: string): Promise<boolean> {
  try {
    const token = normalizeCredentialInput(accessToken);
    const result = await plugin.client.validateAccessToken(token);
    await storeCredential(plugin, token, `token …${result.preview}`);
    new Notice(`Connected as ${result.accountName}`);
    return true;
  } catch (error: any) {
    new Notice(error?.message || 'Access token was rejected');
    return false;
  }
}

/** Accept either a one-time pairing code or a scoped access token JWT. */
export async function pairWithCredential(plugin: BkemoPlugin, raw: string): Promise<boolean> {
  const value = normalizeCredentialInput(raw);
  if (!value) {
    new Notice('Paste a pairing code or access token from this same bkemo instance');
    return false;
  }
  if (looksLikeAccessToken(value)) return pairWithAccessToken(plugin, value);
  if (looksLikePairingCode(value)) return pairWithCode(plugin, value);
  // Prefer access-token validation when the shape is ambiguous / long.
  if (value.length > 40) return pairWithAccessToken(plugin, value);
  return pairWithCode(plugin, value);
}

export async function readCredential(plugin: BkemoPlugin): Promise<string | null> {
  const secretName = plugin.settings.credentialSecretName || BKEMO_SECRET_NAME;
  return plugin.app.secretStorage.getSecret(secretName);
}

export async function clearCredential(plugin: BkemoPlugin): Promise<void> {
  const secretName = plugin.settings.credentialSecretName || BKEMO_SECRET_NAME;
  plugin.app.secretStorage.setSecret(secretName, '');
  plugin.settings.pairedDeviceLabel = '';
  await plugin.saveSettings();
}
