import { describe, expect, test } from 'bun:test';
import { redactModelWithProvider, redactProviderSecrets } from '../../../lib/aiSecretRedaction';

describe('aiSecretRedaction', () => {
  test('masks apiKey on providers', () => {
    expect(redactProviderSecrets({ apiKey: 'sk-secret', title: 'x' })).toEqual({
      apiKey: '********',
      title: 'x',
    });
  });

  test('masks nested provider apiKey on models', () => {
    const model = redactModelWithProvider({
      id: 1,
      provider: { apiKey: 'sk-secret', title: 'p' },
    });
    expect(model.provider?.apiKey).toBe('********');
  });
});
