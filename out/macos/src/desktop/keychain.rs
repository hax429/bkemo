const SERVICE: &str = "me.hax429.bk";
const ACCOUNT: &str = "bkemo-session";

#[cfg(target_os = "macos")]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_session_token(app: tauri::AppHandle, token: String, endpoint: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(endpoint) = endpoint { super::native_capture::save_endpoint(&endpoint)?; }
        entry()?.set_password(&token).map_err(|error| error.to_string())?;
        super::native_capture::send_session(&app);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = token;
        Err("Keychain sessions are only supported on macOS".to_string())
    }
}

#[tauri::command]
pub fn load_session_token() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        return match entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn clear_session_token(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {},
            Err(error) => return Err(error.to_string()),
        }
        super::native_capture::send_session(&app);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
