mod accounts;
mod transfer_entry;
mod alipan;
mod alist_auth;
mod aliyun_web;
mod ali_text_protocol;
mod ali_text;
mod guangya_text;
mod baidu;
mod boxplayer_account;
mod catalog;
mod artwork_cache;
mod file_artwork;
mod catalog_migration;
mod boxplayer;
mod trakt;
mod cloud139;
mod cloud189;
mod commands;
mod cookie_sessions;
mod drive115;
mod gateway;
mod guangya;
mod hls;
mod network_proxy;
mod network_share;
mod oauth;
mod oauth_route;
mod open_requests;
mod pikpak;
mod player;
mod plex_auth;
mod server_endpoints;
mod prepared_media;
mod provider_config;
mod quark;
mod server_playback;
mod settings;
mod speed_test;
mod storage;
mod file_manager;
mod local_identity;
mod local_journal;
mod remote_identity;
mod vault;
use open_requests::{OpenInbox, OpenRequest};

use serde::Serialize;
use settings::{AppError, Settings, SettingsPatch, SettingsStore, Theme};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct ShellState {
    store: Mutex<SettingsStore>,
    data_dir: PathBuf,
    pending: Mutex<OpenInbox>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    schema_version: u32,
    platform: &'static str,
    data_directory: String,
    version: &'static str,
    pending_open: Vec<OpenRequest>,
}
fn poisoned() -> AppError {
    AppError::new("STATE_LOCK", "Application state is unavailable", true)
}
fn platform_error(message: &'static str) -> AppError {
    AppError::new("PLATFORM_ERROR", message, true)
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        log::info!("Main window restored");
    }
}
fn theme(value: Theme) -> Option<tauri::Theme> {
    match value {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    }
}
fn accept_open(app: &tauri::AppHandle, values: impl IntoIterator<Item = String>) {
    let Some(state) = app.try_state::<ShellState>() else {
        return;
    };
    let public_values = values.into_iter().filter_map(|value| {
        if oauth::accept_custom_callback(&value){show_main(app);return None}
        let trakt_callback = url::Url::parse(&value).ok().is_some_and(|url| url.scheme()=="boxplayer-migration-dev" && url.host_str()==Some("trakt"));
        if trakt_callback {
            // Authorization callbacks stay native even if malformed or no login is pending.
            let handle=app.clone();
            tauri::async_runtime::spawn(async move { if let Some(trakt)=handle.try_state::<trakt::Trakt>() { let _=trakt.callback(&value).await; } });
            None
        } else { Some(value) }
    }).collect::<Vec<_>>();
    let incoming = match state.pending.lock() {
        Ok(mut inbox) => inbox.push(public_values, std::time::Instant::now()),
        Err(_) => {
            log::error!("Open request queue is unavailable");
            return;
        }
    };
    if incoming.is_empty() {
        return;
    }
    // Never log callback URLs or file paths (OAuth payloads may contain secrets).
    log::info!("Received {} development open request(s)", incoming.len());
    let _ = app.emit("shell:open", &incoming);
    show_main(app);
}
#[tauri::command]
fn settings_get(state: State<'_, ShellState>) -> Result<Settings, AppError> {
    Ok(state.store.lock().map_err(|_| poisoned())?.current.clone())
}
#[tauri::command]
fn settings_update(
    app: tauri::AppHandle,
    state: State<'_, ShellState>,
    expected_revision: u64,
    patch: SettingsPatch,
) -> Result<Settings, AppError> {
    let mut store = state.store.lock().map_err(|_| poisoned())?;
    let next = store.prepare(expected_revision, patch)?;
    let previous_autostart = store.current.launch_at_login;
    let changed_autostart = next.launch_at_login != previous_autostart;
    if changed_autostart {
        let launcher = app.autolaunch();
        let result = if next.launch_at_login {
            launcher.enable()
        } else {
            launcher.disable()
        };
        result.map_err(|_| platform_error("Unable to change launch-at-login registration"))?;
    }
    let saved = match store.commit(next) {
        Ok(saved) => saved,
        Err(error) => {
            if changed_autostart {
                let rollback = if previous_autostart {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                };
                if rollback.is_err() {
                    log::error!("Failed to restore launch-at-login registration after settings save failure");
                }
            }
            return Err(error);
        }
    };
    network_proxy::configure(saved.proxy.clone());
    for window in app.webview_windows().values() {
        if let Err(error) = window.set_theme(theme(saved.theme)) {
            log::warn!("Window theme update failed: {error}");
        }
    }
    // Emit while serialized by the settings lock so revisions are delivered in order.
    if let Err(error) = app.emit("settings:changed", &saved) {
        log::warn!("Settings event delivery failed: {error}");
    }
    Ok(saved)
}
#[tauri::command]
fn runtime_info(state: State<'_, ShellState>) -> Result<RuntimeInfo, AppError> {
    let pending_open = state
        .pending
        .lock()
        .map_err(|_| poisoned())?
        .pending
        .clone();
    Ok(RuntimeInfo {
        schema_version: 1,
        platform: std::env::consts::OS,
        data_directory: state.data_dir.to_string_lossy().into_owned(),
        version: env!("CARGO_PKG_VERSION"),
        pending_open,
    })
}
#[tauri::command]
fn window_open(app: tauri::AppHandle, kind: String) -> Result<(), AppError> {
    let (title, file, width, height) = match kind.as_str() {
        "settings" => ("BoxPlayer Dev · Settings", "settings.html", 1040.0, 780.0),
        "player" => ("BoxPlayer Dev · Player", "player.html", 960.0, 600.0),
        _ => return Err(AppError::new("WINDOW_INVALID", "Unknown window", false)),
    };
    if let Some(window) = app.get_webview_window(&kind) {
        window
            .show()
            .map_err(|_| platform_error("Unable to show window"))?;
        let _ = window.unminimize();
        return window
            .set_focus()
            .map_err(|_| platform_error("Unable to focus window"));
    }
    let state = app.state::<ShellState>();
    let selected_theme = state.store.lock().map_err(|_| poisoned())?.current.theme;
    let builder = WebviewWindowBuilder::new(&app, &kind, WebviewUrl::App(file.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(if kind=="settings"{760.0}else{600.0}, if kind=="settings"{540.0}else{440.0})
        .theme(theme(selected_theme))
        .transparent(kind == "player");
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);
    builder
        .build()
        .map_err(|_| platform_error("Unable to create window"))?;
    Ok(())
}
#[tauri::command]
async fn choose_file(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let selected =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
            .await
            .map_err(|_| platform_error("File dialog failed"))?;
    selected
        .map(|file| {
            file.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|_| platform_error("Selected file is not a local path"))
        })
        .transpose()
}
#[tauri::command]
fn reveal_data_directory(
    app: tauri::AppHandle,
    state: State<'_, ShellState>,
) -> Result<(), AppError> {
    app.opener()
        .open_path(state.data_dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| platform_error("Unable to open data directory"))
}
#[tauri::command]
fn open_website(app: tauri::AppHandle, target: String) -> Result<(), AppError> {
    let url = match target.as_str() {
        "help" => "https://github.com/gaozhangmin/boxplayer".to_string(),
        "feedback" => "https://github.com/gaozhangmin/boxplayer/issues".to_string(),
        "pro" => format!(
            "{}/login?next=%2Fpricing%2F&source=boxplayer-desktop",
            provider_config::site_url()?
        ),
        _ => return Err(AppError::new("URL_INVALID", "Unknown website", false)),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| platform_error("Unable to open browser"))
}
fn shell_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "Show BoxPlayer Dev", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit BoxPlayer Dev", true, None::<&str>)?,
        ],
    )
}
#[tauri::command]
async fn show_context_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), AppError> {
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
        return Err(AppError::new(
            "POSITION_INVALID",
            "Invalid menu position",
            false,
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let menu = shell_menu(&app).map_err(|_| platform_error("Unable to create context menu"))?;
        window
            .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
            .map_err(|_| platform_error("Unable to show context menu"))
    })
    .await
    .map_err(|_| platform_error("Unable to show context menu"))?
}

fn handle_menu(app: &tauri::AppHandle, id: &str) {
    match id {
        "show" => show_main(app),
        "settings" => {
            let _ = window_open(app.clone(), "settings".into());
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
pub fn run() {
    player::configure_vulkan();
    let builder = artwork_cache::register(tauri::Builder::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            accept_open(app, args.into_iter().skip(1));
            show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            boxplayer::boxplayer_request,
            settings_get,
            network_proxy::network_proxy_test,
            settings_update,
            runtime_info,
            window_open,
            choose_file,
            transfer_entry::choose_transfer_paths,
            reveal_data_directory,
            open_website,
            show_context_menu,
            commands::local_sources,
            commands::local_thumbnail,
            commands::source_thumbnail,
            commands::server_artwork,
            commands::local_remove_source,
            commands::local_rename_source,
            commands::local_add_source,
            commands::local_choose_folder,
            commands::local_save_chosen_source,
            commands::local_cancel_folder,
            commands::local_list,
            commands::local_operations_recover,
            commands::remote_operations_pending,
            commands::remote_identity_commit,
            commands::remote_operation_ack,
            commands::local_operation_preferences,
            commands::local_operation_ack,
            commands::player_open_local,
            commands::player_open_file,
            commands::player_open_remote,
            commands::player_open_source_queue,
            commands::player_open_catalog_queue,
            commands::player_state,
            commands::player_show_main,
            commands::player_control,
            commands::player_close,
            commands::accounts_list,
            commands::account_save,
            commands::account_remove,
            commands::account_update_metadata,
            commands::server_login,
            commands::oauth_login,
            commands::auth_cancel,
            commands::drive115_begin,
            commands::drive115_poll,
            commands::drive115_cancel,
            commands::aliyun_login,
            commands::alipan_begin,
            commands::aliyun_begin,
            commands::alipan_renew,
            commands::alipan_poll,
            commands::alipan_cancel,
            commands::quark_begin,
            commands::boxplayer_begin,
            commands::boxplayer_poll,
            commands::boxplayer_cancel,
            commands::boxplayer_subscription,
            commands::boxplayer_browser,
            commands::auto_sign_date,
            commands::choose_cover_image,
            commands::source_download,
            commands::server_download_collection,
            commands::open_media_link,
            commands::catalog_load,
            trakt::trakt_status,
            trakt::trakt_web_start,
            trakt::trakt_account,
            trakt::trakt_connect_device_auth,
            trakt::trakt_poll,
            trakt::trakt_cancel,
            trakt::trakt_disconnect,
            trakt::trakt_settings,
            trakt::trakt_sync,
            trakt::trakt_playback_progress,
            trakt::trakt_open,
            trakt::trakt_public_rating,
            trakt::trakt_personal_ratings,
            commands::catalog_save,
            commands::catalog_metadata,
            commands::quark_poll,
            commands::quark_cancel,
            commands::guangya_sms,
            commands::guangya_login,
            commands::guangya_cancel,
            commands::pikpak_login,
            commands::pikpak_create_share,
            commands::cloud139_login,
            commands::cloud189_begin,
            commands::cloud189_poll,
            commands::cloud189_cancel,
            commands::server_resolve,
            commands::server_bitrate_test,
            commands::server_speed_start,
            commands::server_speed_state,
            commands::server_speed_cancel,
            commands::resolve_protected_media,
            commands::pikpak_download_url,
            network_share::network_share_connect,
            network_share::network_share_connection_info,
            network_share::network_share_update_connection,
            network_share::network_share_list,
            network_share::network_share_resolve,
            commands::webdav_connection_info,
            commands::server_connection_info,
            commands::server_update_connection,
            commands::webdav_update_connection,
            commands::server_endpoints,
            commands::plex_login,
            commands::plex_save_resources,
            commands::plex_cancel_resources,
            commands::http_request,
            ali_text::ali_text_create,
            guangya_text::guangya_text_begin,
            guangya_text::guangya_text_step,
            guangya_text::guangya_text_close,
            ali_text::ali_text_cancel,
            commands::http_cancel,
            commands::media_refresh_complete,
            commands::migration_export,
            commands::migration_import,
            commands::migration_inspect
        ])
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "player" {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = commands::player_close(app).await;
                    });
                }
                if window.label() == "main" {
                    if let Some(state) = window.app_handle().try_state::<ShellState>() {
                        if let Ok(store) = state.store.lock() {
                            if store.current.close_to_tray {
                                api.prevent_close();
                                let _ = window.hide();
                                log::info!("Main window hidden to tray");
                            } else {
                                window.app_handle().exit(0);
                            }
                        }
                    }
                }
            }
        })
        .setup(|app| {
            let default_dir = app.path().app_data_dir()?;
            let directory = settings::resolve_data_dir(
                &default_dir,
                std::env::var_os("BOXPLAYER_DEV_DATA_DIR").map(PathBuf::from),
            )?;
            let store = SettingsStore::open(&directory)?;
            let saved = store.current.clone();
            network_proxy::configure(saved.proxy.clone());
            app.handle().plugin(
                tauri_plugin_log::Builder::new()
                    .level(log::LevelFilter::Info)
                    .targets([tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Folder {
                            path: directory.join("logs"),
                            file_name: Some("shell".into()),
                        },
                    )])
                    .build(),
            )?;
            app.manage(artwork_cache::ArtworkCache::new(directory.join("artwork-cache")));
            app.manage(ShellState {
                store: Mutex::new(store),
                data_dir: directory,
                pending: Mutex::new(OpenInbox::default()),
            });
            app.manage(commands::Backend::new(
                app.handle().clone(),
                &app.state::<ShellState>().data_dir,
            )?);
            let trakt_client = provider_config::client("trakt", String::new(), None).0;
            app.manage(trakt::Trakt::new(&app.state::<ShellState>().data_dir, app.state::<commands::Backend>().gateway.clone(), trakt_client)?);
            app.manage(boxplayer::BoxPlayer::new(&app.state::<ShellState>().data_dir)?);
            let menu = shell_menu(app.handle())?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
            tauri::tray::TrayIconBuilder::with_id("boxplayer-dev")
                .icon(icon)
                .tooltip("BoxPlayer Dev")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            #[cfg(target_os = "macos")]
            app.set_menu(tauri::menu::Menu::default(app.handle())?)?;
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            app.deep_link().register_all()?;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                accept_open(&handle, event.urls().into_iter().map(|url| url.to_string()));
            });
            if let Some(urls) = app.deep_link().get_current()? {
                accept_open(app.handle(), urls.into_iter().map(|url| url.to_string()));
            }
            accept_open(app.handle(), std::env::args().skip(1));
            let main = app
                .get_webview_window("main")
                .ok_or("Main window missing")?;
            main.set_theme(theme(saved.theme))?;
            if !saved.start_hidden || !std::env::args().any(|arg| arg == "--autostart") {
                main.show()?;
            } else {
                log::info!("Main window remains hidden on automatic startup");
            }
            log::info!("BoxPlayer Dev M2 started");
            Ok(())
        });
    builder
        .build(tauri::generate_context!())
        .expect("Unable to initialize BoxPlayer Dev; check development settings and logs")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if let Some(state) = app.try_state::<commands::Backend>() {
                    if !state
                        .exiting
                        .swap(true, std::sync::atomic::Ordering::SeqCst)
                    {
                        api.prevent_exit();
                        let player = state.player.clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(boxplayer)=app.try_state::<boxplayer::BoxPlayer>() { boxplayer.stop().await; }
                            let _ =
                                tauri::async_runtime::spawn_blocking(move || player.stop()).await;
                            app.exit(0);
                        });
                    }
                }
            }
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Reopen { .. } => show_main(app),
                tauri::RunEvent::Opened { urls } => accept_open(
                    app,
                    urls.into_iter().filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path()
                                .ok()
                                .map(|p| p.to_string_lossy().into_owned())
                        } else {
                            Some(url.to_string())
                        }
                    }),
                ),
                _ => {}
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
