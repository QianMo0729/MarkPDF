//! The macOS menu bar. Apple's Human Interface Guidelines ("The menu bar") ask
//! for the standard menus in the standard order, every command reachable from
//! the menu bar, and unavailable commands dimmed rather than hidden.
//!
//! Standard items (clipboard, window, app visibility) are the system's own.
//! Everything else is forwarded to the webview as [`EVT_COMMAND`] carrying the
//! item id; `src/platform/menu.ts` maps it onto the same code path the keyboard
//! shortcut takes. Item titles follow Apple's Simplified Chinese menus.
//!
//! Other platforms keep their window without a menu bar; `menu_sync` is then a no-op.

/// What the frontend reports so items can be dimmed and show/hide titles kept current.
#[derive(serde::Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct MenuContext {
    /// A deck or a recording is open (the session screen).
    session: bool,
    /// The open session can record.
    live: bool,
    recording: bool,
    rail_open: bool,
    dock_open: bool,
}

#[tauri::command]
pub fn menu_sync(app: tauri::AppHandle, context: MenuContext) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos::sync(&app, context).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, context);
    Ok(())
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(target_os = "macos")]
mod macos {
    use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, MenuItemBuilder, SubmenuBuilder};
    use tauri::{AppHandle, Emitter, Manager, Wry};
    use tauri_plugin_opener::OpenerExt;

    use super::MenuContext;

    /// Event sent to the webview with the id of the chosen menu item.
    const EVT_COMMAND: &str = "menu://command";

    const HELP_URL: &str = "https://github.com/QianMo0729/MarkPDF#readme";
    const RELEASES_URL: &str = "https://github.com/QianMo0729/MarkPDF/releases";
    const FEEDBACK_URL: &str = "https://github.com/QianMo0729/MarkPDF/issues";

    /// Items whose state follows the [`MenuContext`].
    pub struct Handles {
        session_only: Vec<MenuItem<Wry>>,
        record: MenuItem<Wry>,
        markers: Vec<MenuItem<Wry>>,
        rail: MenuItem<Wry>,
        dock: MenuItem<Wry>,
    }

    fn item(app: &AppHandle, id: &str, text: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
        let builder = MenuItemBuilder::with_id(id, text);
        match accelerator {
            Some(keys) => builder.accelerator(keys),
            None => builder,
        }
        .build(app)
    }

    pub fn install(app: &AppHandle) -> tauri::Result<()> {
        let name = app.package_info().name.clone();
        let about = AboutMetadataBuilder::new()
            .name(Some(name.clone()))
            .version(Some(app.package_info().version.to_string()))
            .website(Some(HELP_URL))
            .website_label(Some("github.com/QianMo0729/MarkPDF"))
            .build();

        let export_pdf = item(app, "export-pdf", "导出带标注的 PDF…", Some("Cmd+Shift+E"))?;
        let export_markdown = item(app, "export-markdown", "导出 Markdown…", None)?;
        let print = item(app, "print", "打印…", Some("Cmd+P"))?;
        let find = item(app, "find", "查找…", Some("Cmd+F"))?;
        let rail = item(app, "toggle-rail", "显示缩略图", Some("Cmd+Shift+\\"))?;
        let dock = item(app, "toggle-dock", "显示面板", Some("Cmd+\\"))?;
        let zoom_in = item(app, "zoom-in", "放大", Some("Cmd+="))?;
        let zoom_out = item(app, "zoom-out", "缩小", Some("Cmd+-"))?;
        let zoom_fit = item(app, "zoom-fit", "适合宽度", Some("Cmd+0"))?;
        let editor_mode = item(app, "editor-mode", "切换笔记显示模式", Some("Cmd+E"))?;
        let record = item(app, "record", "开始录音", Some("Cmd+Shift+R"))?;
        let mark_important = item(app, "mark-important", "标记重点", Some("F1"))?;
        let mark_confused = item(app, "mark-confused", "标记没听懂", Some("F2"))?;
        let mark_homework = item(app, "mark-homework", "标记作业", Some("F3"))?;

        let app_menu = SubmenuBuilder::new(app, &name)
            .about_with_text(format!("关于 {name}"), Some(about))
            .separator()
            .item(&item(app, "settings", "设置…", Some("Cmd+,"))?)
            .separator()
            .services_with_text("服务")
            .separator()
            .hide_with_text(format!("隐藏 {name}"))
            .hide_others_with_text("隐藏其他")
            .show_all_with_text("全部显示")
            .separator()
            .quit_with_text(format!("退出 {name}"))
            .build()?;
        let file_menu = SubmenuBuilder::new(app, "文件")
            .item(&item(app, "open", "打开…", Some("Cmd+O"))?)
            .separator()
            .close_window_with_text("关闭窗口")
            .separator()
            .item(&export_pdf)
            .item(&export_markdown)
            .separator()
            .item(&print)
            .build()?;
        // Undo / Redo are ours, not the system's: outside a text field they act on
        // the page's annotations, which the native `undo:` action knows nothing about.
        let edit_menu = SubmenuBuilder::new(app, "编辑")
            .item(&item(app, "undo", "撤销", Some("Cmd+Z"))?)
            .item(&item(app, "redo", "重做", Some("Cmd+Shift+Z"))?)
            .separator()
            .cut_with_text("剪切")
            .copy_with_text("拷贝")
            .paste_with_text("粘贴")
            .select_all_with_text("全选")
            .separator()
            .item(&find)
            .build()?;
        let view_menu = SubmenuBuilder::new(app, "显示")
            .item(&rail)
            .item(&dock)
            .separator()
            .item(&zoom_in)
            .item(&zoom_out)
            .item(&zoom_fit)
            .separator()
            .item(&editor_mode)
            .separator()
            .fullscreen_with_text("进入全屏幕")
            .build()?;
        let record_menu = SubmenuBuilder::new(app, "录音")
            .item(&record)
            .separator()
            .item(&mark_important)
            .item(&mark_confused)
            .item(&mark_homework)
            .build()?;
        let window_menu = SubmenuBuilder::new(app, "窗口")
            .minimize_with_text("最小化")
            .maximize_with_text("缩放")
            .separator()
            .bring_all_to_front_with_text("前置全部窗口")
            .build()?;
        let help_menu = SubmenuBuilder::new(app, "帮助")
            .item(&item(app, "help", &format!("{name} 帮助"), None)?)
            .separator()
            .item(&item(app, "release-notes", "更新说明", None)?)
            .item(&item(app, "feedback", "反馈问题…", None)?)
            .build()?;

        let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &record_menu, &window_menu, &help_menu])?;
        app.set_menu(menu)?;
        window_menu.set_as_windows_menu_for_nsapp()?;
        help_menu.set_as_help_menu_for_nsapp()?;

        app.manage(Handles {
            session_only: vec![export_pdf, export_markdown, print, find, rail.clone(), dock.clone(), zoom_in, zoom_out, zoom_fit, editor_mode],
            record,
            markers: vec![mark_important, mark_confused, mark_homework],
            rail,
            dock,
        });
        // Nothing is open until the frontend says otherwise.
        sync(app, MenuContext::default())?;

        app.on_menu_event(|app, event| {
            let url = match event.id().as_ref() {
                "help" => HELP_URL,
                "release-notes" => RELEASES_URL,
                "feedback" => FEEDBACK_URL,
                id => {
                    let _ = app.emit(EVT_COMMAND, id);
                    return;
                }
            };
            let _ = app.opener().open_url(url, None::<&str>);
        });
        Ok(())
    }

    pub fn sync(app: &AppHandle, context: MenuContext) -> tauri::Result<()> {
        let Some(handles) = app.try_state::<Handles>() else { return Ok(()) };
        for item in &handles.session_only {
            item.set_enabled(context.session)?;
        }
        handles.record.set_enabled(context.live)?;
        handles.record.set_text(if context.recording { "结束录音…" } else { "开始录音" })?;
        for item in &handles.markers {
            item.set_enabled(context.recording)?;
        }
        handles.rail.set_text(if context.rail_open { "隐藏缩略图" } else { "显示缩略图" })?;
        handles.dock.set_text(if context.dock_open { "隐藏面板" } else { "显示面板" })?;
        Ok(())
    }
}
