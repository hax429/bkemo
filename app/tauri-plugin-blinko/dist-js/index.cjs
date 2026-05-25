'use strict';

var core = require('@tauri-apps/api/core');

async function setStatusBarColor(hexColor) {
    await core.invoke('plugin:blinko|setcolor', {
        payload: {
            hex: hexColor,
        },
    });
    return null;
}
async function openAppSettings() {
    await core.invoke('plugin:blinko|open_app_settings');
}
async function shareFile(url, filename) {
    await core.invoke('plugin:blinko|share_file', {
        payload: { url, filename },
    });
}

exports.openAppSettings = openAppSettings;
exports.setStatusBarColor = setStatusBarColor;
exports.shareFile = shareFile;
