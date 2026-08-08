import { Notice } from 'obsidian';
import { looksLikeAccessToken } from './credentialShape';
import { BKEMO_SECRET_NAME, type BkemoHost } from './settings';

export { looksLikeAccessToken };

async function storeCredential(plugin: BkemoHost, token: string, label: string): Promise<void> {
  const secretName = plugin.bkemoSettings.credentialSecretName || BKEMO_SECRET_NAME;
  plugin.app.secretStorage.setSecret(secretName, token);
  plugin.bkemoSettings.credentialSecretName = secretName;
  plugin.bkemoSettings.pairedDeviceLabel = label;
  await plugin.saveBkemoSettings();
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
  return token.replace(/\s+/g, '');
}

export async function pairWithAccessToken(plugin: BkemoHost, accessToken: string): Promise<boolean> {
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

/** Accept a platform-bound Obsidian access token from Settings → Security. */
export async function pairWithCredential(plugin: BkemoHost, raw: string): Promise<boolean> {
  const value = normalizeCredentialInput(raw);
  if (!value) {
    new Notice('Paste an Obsidian access token from the bkemo Mac/Web app → Settings → Security');
    return false;
  }
  if (looksLikeAccessToken(value) || value.length > 40) return pairWithAccessToken(plugin, value);
  new Notice('Pairing codes are retired — create an Obsidian access token in the bkemo Mac/Web app');
  return false;
}

export async function readCredential(plugin: BkemoHost): Promise<string | null> {
  const secretName = plugin.bkemoSettings.credentialSecretName || BKEMO_SECRET_NAME;
  return plugin.app.secretStorage.getSecret(secretName);
}

export async function clearCredential(plugin: BkemoHost): Promise<void> {
  const secretName = plugin.bkemoSettings.credentialSecretName || BKEMO_SECRET_NAME;
  plugin.app.secretStorage.setSecret(secretName, '');
  plugin.bkemoSettings.pairedDeviceLabel = '';
  await plugin.saveBkemoSettings();
}
