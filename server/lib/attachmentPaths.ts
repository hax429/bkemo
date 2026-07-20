export const ATTACHMENT_DELIVERY_PREFIX = '/api/attachment/';

export function stableAttachmentPath(portableId: string): string {
  return `${ATTACHMENT_DELIVERY_PREFIX}${portableId}/file`;
}

export function attachmentPortableIdFromPath(value: string): string | null {
  const match = value.match(/^\/api\/attachment\/([0-9a-f-]{36})\/file(?:\?.*)?$/i);
  return match?.[1] ?? null;
}
