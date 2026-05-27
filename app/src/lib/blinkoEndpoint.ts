const DEFAULT_TAURI_ENDPOINT = 'https://bk.hax429.me';

function readSavedEndpoint(): string | null {
    const raw = window.localStorage.getItem('blinkoEndpoint');
    if (!raw) return null;
    const cleaned = raw.replace(/"/g, '').trim();
    return cleaned || null;
}

export function getBlinkoEndpoint(path: string = ''): string {
    try {
        const isTauri = !!(window as any).__TAURI__;
        if (isTauri) {
            const endpoint = readSavedEndpoint() ?? DEFAULT_TAURI_ENDPOINT;
            try {
                return new URL(path, endpoint).toString();
            } catch (error) {
                console.error(error);
                return new URL(path, DEFAULT_TAURI_ENDPOINT).toString();
            }
        }

        return new URL(path, window.location.origin).toString();
    } catch (error) {
        console.error(error);
        return new URL(path, window.location.origin).toString();
    }
}

export function isTauriAndEndpointUndefined(): boolean {
    return false;
}

export function saveBlinkoEndpoint(endpoint: string): void {
    if (endpoint) {
        window.localStorage.setItem('blinkoEndpoint', endpoint);
    }
}

export function getSavedEndpoint(): string {
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
    return readSavedEndpoint() ?? (isTauri ? DEFAULT_TAURI_ENDPOINT : '');
}
