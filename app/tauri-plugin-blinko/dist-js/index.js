import { invoke } from '@tauri-apps/api/core';

async function setStatusBarColor(hexColor) {
    await invoke('plugin:blinko|setcolor', {
        payload: {
            hex: hexColor,
        },
    });
    return null;
}
async function openAppSettings() {
    await invoke('plugin:blinko|open_app_settings');
}
async function shareFile(url, filename) {
    await invoke('plugin:blinko|share_file', {
        payload: { url, filename },
    });
}

export { openAppSettings, setStatusBarColor, shareFile };
