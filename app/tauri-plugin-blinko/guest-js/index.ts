import { invoke } from '@tauri-apps/api/core'

export async function setStatusBarColor(hexColor: string): Promise<null> {
  await invoke<{value?: string}>('plugin:blinko|setcolor', {
    payload: {
      hex: hexColor,
    },
  })
  return null
}

export async function openAppSettings(): Promise<void> {
  await invoke('plugin:blinko|open_app_settings')
}

export async function shareFile(url: string, filename?: string): Promise<void> {
  await invoke('plugin:blinko|share_file', {
    payload: { url, filename },
  })
}