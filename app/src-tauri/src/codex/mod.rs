//! "Sign in with ChatGPT" through the Codex app-server (docs/SPEC.md 16.3).
//!
//! MarkPDF never touches OAuth tokens itself: it spawns `codex app-server`
//! (the same binary the Codex CLI / IDE extension ship) and speaks its JSON-RPC
//! protocol over stdio. Codex owns the login flow, the token cache in
//! `~/.codex/auth.json` and the ChatGPT-plan quota; MarkPDF only asks it for the
//! account, the model catalog (with reasoning-effort options) and one-shot
//! text turns. The process is started lazily and kept alive for the app's
//! lifetime; every turn runs in a fresh ephemeral read-only thread so nothing is
//! persisted in Codex's session history and no tool can touch the disk.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVT_LOGIN: &str = "codex://login";
pub const EVT_EXIT: &str = "codex://exit";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CHAT_TIMEOUT: Duration = Duration::from_secs(240);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Managed state: the (lazily started) app-server, shared with blocking workers.
#[derive(Default)]
pub struct CodexState(pub Arc<CodexInner>);

#[derive(Default)]
pub struct CodexInner {
    server: Mutex<Option<Arc<Server>>>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct CodexInfo {
    pub path: String,
    pub version: String,
}

#[derive(serde::Serialize, Clone)]
struct LoginPayload {
    login_id: String,
    success: bool,
    error: Option<String>,
}

/// How the reader thread tells the UI about login completion / process exit;
/// the app passes a Tauri emitter, tests pass a no-op.
type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

fn emitter_for(app: &AppHandle) -> Emit {
    let app = app.clone();
    Arc::new(move |event: &str, payload: Value| {
        let _ = app.emit(event, payload);
    })
}

// ----------------------------------------------------------------------------
// locating the binary
// ----------------------------------------------------------------------------

#[cfg(windows)]
const EXE: &str = "codex.exe";
#[cfg(not(windows))]
const EXE: &str = "codex";
#[cfg(all(windows, target_arch = "x86_64"))]
const TRIPLE: &str = "x86_64-pc-windows-msvc";
#[cfg(all(windows, target_arch = "aarch64"))]
const TRIPLE: &str = "aarch64-pc-windows-msvc";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const TRIPLE: &str = "x86_64-unknown-linux-musl";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const TRIPLE: &str = "aarch64-unknown-linux-musl";

/// The native binary inside an npm install of `@openai/codex` (its `bin/codex.js`
/// shim cannot be spawned directly on Windows and would add a Node hop elsewhere).
fn npm_vendor_candidates(node_modules: &Path) -> Vec<PathBuf> {
    let platform_pkg = format!("codex-{}", match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    });
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let codex_package = node_modules.join("@openai").join("codex");
    let platform_package = PathBuf::from("@openai").join(format!("{platform_pkg}-{arch}"));
    // npm may nest the optional platform package inside @openai/codex instead
    // of hoisting it next to that package. Match the CLI launcher's Node module
    // resolution order, then fall back to older releases with bundled vendors.
    [
        codex_package.join("node_modules").join(&platform_package),
        node_modules.join(&platform_package),
        codex_package,
    ]
    .into_iter()
    .flat_map(|package| {
        let vendor = package.join("vendor").join(TRIPLE);
        [vendor.join("bin").join(EXE), vendor.join("codex").join(EXE)]
    })
    .collect()
}

/// Everywhere a Codex binary is usually found, most specific first.
pub fn candidate_paths(override_path: Option<&str>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(p) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        if p.is_dir() {
            out.push(p.join(EXE));
        } else {
            out.push(p);
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        out.push(home.join(".codex").join("bin").join(EXE));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join(EXE));
            // npm global shim `codex.cmd` / `codex` next to a node_modules folder
            if dir.join("codex.cmd").is_file() || dir.join("codex").is_file() {
                out.extend(npm_vendor_candidates(&dir.join("node_modules")));
                if let Some(parent) = dir.parent() {
                    out.extend(npm_vendor_candidates(&parent.join("lib").join("node_modules")));
                }
            }
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        out.extend(npm_vendor_candidates(&PathBuf::from(appdata).join("npm").join("node_modules")));
    }
    for prefix in ["/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules"] {
        out.extend(npm_vendor_candidates(Path::new(prefix)));
    }
    out
}

fn command(path: &Path) -> Command {
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Runs `codex --version`; the binary must exist and answer within a few seconds.
fn probe_version(path: &Path) -> Result<String, String> {
    let out = command(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("cannot run {}: {e}", path.display()))?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || text.is_empty() {
        return Err(format!("{} did not report a version", path.display()));
    }
    // "codex-cli 0.154.0" → "0.154.0"
    Ok(text.split_whitespace().last().unwrap_or(&text).to_string())
}

pub fn locate(override_path: Option<&str>) -> Result<CodexInfo, String> {
    let mut seen = std::collections::HashSet::new();
    let mut last_err = String::from("codex_not_found");
    for p in candidate_paths(override_path) {
        if !seen.insert(p.clone()) || !p.is_file() {
            continue;
        }
        match probe_version(&p) {
            Ok(version) => return Ok(CodexInfo { path: p.to_string_lossy().into_owned(), version }),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

// ----------------------------------------------------------------------------
// JSON-RPC over stdio
// ----------------------------------------------------------------------------

struct Server {
    info: CodexInfo,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicI64,
    pending: Mutex<HashMap<i64, Sender<Value>>>,
    subscribers: Mutex<Vec<(u64, Sender<Value>)>>,
    next_sub: AtomicU64,
    alive: AtomicBool,
}

impl Server {
    fn spawn(emit: Emit, info: CodexInfo) -> Result<Arc<Self>, String> {
        let mut child = command(Path::new(&info.path))
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("cannot start codex app-server: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let server = Arc::new(Self {
            info,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next_id: AtomicI64::new(1),
            pending: Mutex::new(HashMap::new()),
            subscribers: Mutex::new(Vec::new()),
            next_sub: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        let reader_server = server.clone();
        std::thread::Builder::new()
            .name("markpdf-codex-reader".into())
            .spawn(move || reader_loop(emit, reader_server, stdout))
            .map_err(|e| e.to_string())?;
        server.initialize()?;
        Ok(server)
    }

    fn initialize(&self) -> Result<(), String> {
        let version = env!("CARGO_PKG_VERSION");
        self.request(
            "initialize",
            json!({ "clientInfo": { "name": "markpdf", "title": "MarkPDF", "version": version } }),
            REQUEST_TIMEOUT,
        )?;
        self.notify("initialized", json!({}))
    }

    fn write_line(&self, value: &Value) -> Result<(), String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("codex app-server exited".into());
        }
        let mut line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut stdin = self.stdin.lock().map_err(|_| "stdin poisoned")?;
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| format!("codex app-server write failed: {e}"))
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_line(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|_| "pending poisoned")?.insert(id, tx);
        if let Err(e) = self.write_line(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            self.pending.lock().ok().map(|mut p| p.remove(&id));
            return Err(e);
        }
        let msg = match rx.recv_timeout(timeout) {
            Ok(m) => m,
            Err(_) => {
                self.pending.lock().ok().map(|mut p| p.remove(&id));
                return Err(if self.alive.load(Ordering::SeqCst) { format!("codex app-server did not answer {method} in time") } else { "codex app-server exited".into() });
            }
        };
        response_result(msg)
    }

    fn subscribe(&self) -> (u64, Receiver<Value>) {
        let (tx, rx) = mpsc::channel();
        let key = self.next_sub.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut subs) = self.subscribers.lock() {
            subs.push((key, tx));
        }
        (key, rx)
    }

    fn unsubscribe(&self, key: u64) {
        if let Ok(mut subs) = self.subscribers.lock() {
            subs.retain(|(k, _)| *k != key);
        }
    }

    fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

/// A JSON-RPC response: `result` on success, the error's message otherwise.
pub fn response_result(msg: Value) -> Result<Value, String> {
    if let Some(err) = msg.get("error") {
        let text = err.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| err.to_string());
        return Err(text);
    }
    Ok(msg.get("result").cloned().unwrap_or(Value::Null))
}

/// What one line from the server is: a reply to us, a request to us, or a notification.
pub enum Incoming {
    Response(i64, Value),
    ServerRequest(Value, String),
    Notification(String, Value),
    Ignored,
}

pub fn classify(line: &str) -> Incoming {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Incoming::Ignored,
    };
    let method = msg.get("method").and_then(Value::as_str).map(str::to_string);
    match (msg.get("id").cloned(), method) {
        (Some(id), Some(method)) => Incoming::ServerRequest(id, method),
        (Some(id), None) => match id.as_i64() {
            Some(id) => Incoming::Response(id, msg),
            None => Incoming::Ignored,
        },
        (None, Some(method)) => Incoming::Notification(method, msg.get("params").cloned().unwrap_or(Value::Null)),
        (None, None) => Incoming::Ignored,
    }
}

fn reader_loop(emit: Emit, server: Arc<Server>, stdout: std::process::ChildStdout) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        match classify(&line) {
            Incoming::Response(id, msg) => {
                let tx = server.pending.lock().ok().and_then(|mut p| p.remove(&id));
                if let Some(tx) = tx {
                    let _ = tx.send(msg);
                }
            }
            Incoming::ServerRequest(id, method) => {
                // Approvals, user-input questions etc. cannot happen in a read-only
                // "never ask" thread; refuse anything that does so a turn never hangs.
                let _ = server.write_line(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("MarkPDF does not handle {method}") } }));
            }
            Incoming::Notification(method, params) => {
                if method == "account/login/completed" {
                    let payload = LoginPayload {
                        login_id: params.get("loginId").and_then(Value::as_str).unwrap_or("").to_string(),
                        success: params.get("success").and_then(Value::as_bool).unwrap_or(false),
                        error: params.get("error").and_then(Value::as_str).map(str::to_string),
                    };
                    emit(EVT_LOGIN, serde_json::to_value(payload).unwrap_or(Value::Null));
                }
                let note = json!({ "method": method, "params": params });
                if let Ok(mut subs) = server.subscribers.lock() {
                    subs.retain(|(_, tx)| tx.send(note.clone()).is_ok());
                }
            }
            Incoming::Ignored => {}
        }
    }
    server.alive.store(false, Ordering::SeqCst);
    if let Ok(mut pending) = server.pending.lock() {
        pending.clear();
    }
    emit(EVT_EXIT, Value::Null);
}

// ----------------------------------------------------------------------------
// state helpers
// ----------------------------------------------------------------------------

fn ensure_server(app: &AppHandle, state: &CodexInner, path_override: Option<&str>) -> Result<Arc<Server>, String> {
    ensure_server_with(emitter_for(app), state, path_override)
}

fn ensure_server_with(emit: Emit, state: &CodexInner, path_override: Option<&str>) -> Result<Arc<Server>, String> {
    let mut slot = state.server.lock().map_err(|_| "codex state poisoned")?;
    if let Some(s) = slot.as_ref() {
        if s.alive.load(Ordering::SeqCst) {
            return Ok(s.clone());
        }
    }
    let info = locate(path_override)?;
    let server = Server::spawn(emit, info)?;
    *slot = Some(server.clone());
    Ok(server)
}

fn account_of(result: &Value) -> Value {
    result.get("account").cloned().unwrap_or(Value::Null)
}

/// Text of the assistant's final message in a completed turn.
pub fn agent_text(turn: &Value) -> Option<String> {
    let items = turn.get("items")?.as_array()?;
    let mut text = String::new();
    for item in items {
        if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
            if let Some(t) = item.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(t);
            }
        }
    }
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

// ----------------------------------------------------------------------------
// commands
// ----------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct CodexStatus {
    pub info: CodexInfo,
    pub account: Value,
    pub requires_openai_auth: bool,
}

/// Where the binary is and which version it is; does not start the server.
#[tauri::command]
pub async fn codex_locate(path_override: Option<String>) -> Result<CodexInfo, String> {
    tauri::async_runtime::spawn_blocking(move || locate(path_override.as_deref())).await.map_err(|e| e.to_string())?
}

/// Binary info plus the account Codex currently has cached (null when logged out).
#[tauri::command]
pub async fn codex_status(app: AppHandle, state: State<'_, CodexState>, path_override: Option<String>) -> Result<CodexStatus, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, path_override.as_deref())?;
        let result = server.request("account/read", json!({}), REQUEST_TIMEOUT)?;
        Ok(CodexStatus {
            info: server.info.clone(),
            account: account_of(&result),
            requires_openai_auth: result.get("requiresOpenaiAuth").and_then(Value::as_bool).unwrap_or(true),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, Clone)]
pub struct LoginStart {
    pub login_id: String,
    pub auth_url: String,
}

/// Starts the browser OAuth flow; completion arrives as the `codex://login` event.
#[tauri::command]
pub async fn codex_login_start(app: AppHandle, state: State<'_, CodexState>, path_override: Option<String>) -> Result<LoginStart, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, path_override.as_deref())?;
        let result = server.request("account/login/start", json!({ "type": "chatgpt" }), REQUEST_TIMEOUT)?;
        Ok(LoginStart {
            login_id: result.get("loginId").and_then(Value::as_str).unwrap_or("").to_string(),
            auth_url: result.get("authUrl").and_then(Value::as_str).unwrap_or("").to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_login_cancel(app: AppHandle, state: State<'_, CodexState>, login_id: String) -> Result<(), String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, None)?;
        server.request("account/login/cancel", json!({ "loginId": login_id }), REQUEST_TIMEOUT).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_logout(app: AppHandle, state: State<'_, CodexState>) -> Result<(), String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, None)?;
        server.request("account/logout", json!({}), REQUEST_TIMEOUT).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The model catalog as Codex reports it (ids, display names, reasoning efforts, defaults).
#[tauri::command]
pub async fn codex_models(app: AppHandle, state: State<'_, CodexState>, path_override: Option<String>) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, path_override.as_deref())?;
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut params = json!({ "limit": 100 });
            if let Some(c) = &cursor {
                params["cursor"] = json!(c);
            }
            let result = server.request("model/list", params, REQUEST_TIMEOUT)?;
            if let Some(data) = result.get("data").and_then(Value::as_array) {
                all.extend(data.iter().cloned());
            }
            cursor = result.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(Value::Array(all))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Current plan usage (`account/rateLimits/read`), forwarded as-is.
#[tauri::command]
pub async fn codex_rate_limits(app: AppHandle, state: State<'_, CodexState>) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        let server = ensure_server(&app, state, None)?;
        server.request("account/rateLimits/read", json!({}), REQUEST_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
pub struct ChatRequest {
    pub system: Option<String>,
    pub user: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub path_override: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct ChatReply {
    pub text: String,
    pub model: String,
}

fn run_chat(app: &AppHandle, state: &CodexInner, req: ChatRequest) -> Result<ChatReply, String> {
    let server = ensure_server(app, state, req.path_override.as_deref())?;
    let cwd = app.path().app_data_dir().map_err(|e| e.to_string())?.join("codex-cwd");
    run_chat_with(&server, &cwd, req)
}

/// The stateless turn itself: a fresh ephemeral read-only thread, one text turn, its final message.
fn run_chat_with(server: &Server, cwd: &Path, req: ChatRequest) -> Result<ChatReply, String> {
    let _ = std::fs::create_dir_all(cwd);
    let mut start = json!({
        "cwd": cwd.to_string_lossy(),
        "sandbox": "read-only",
        "approvalPolicy": "never",
        "ephemeral": true,
        "baseInstructions": req.system.clone().unwrap_or_else(|| "You are a helpful assistant. Reply with plain text only. Never run commands or use tools.".into()),
        // Keep Codex's own memories out of a stateless request.
        "config": { "features": { "memories": false } },
    });
    if let Some(m) = req.model.as_deref().filter(|m| !m.is_empty()) {
        start["model"] = json!(m);
    }
    let started = server.request("thread/start", start, REQUEST_TIMEOUT)?;
    let thread_id = started
        .get("thread")
        .and_then(|t| t.get("id"))
        .and_then(Value::as_str)
        .ok_or("thread/start returned no thread id")?
        .to_string();
    let model_used = started.get("model").and_then(Value::as_str).unwrap_or("").to_string();

    let (key, rx) = server.subscribe();
    let mut turn = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": req.user }],
        "disabledPluginIds": Value::Array(Vec::new()),
    });
    if let Some(e) = req.effort.as_deref().filter(|e| !e.is_empty()) {
        turn["effort"] = json!(e);
    }
    let outcome = (|| {
        server.request("turn/start", turn, REQUEST_TIMEOUT)?;
        let deadline = Instant::now() + CHAT_TIMEOUT;
        let mut streamed = String::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("AI 请求超时".to_string());
            }
            let note = rx.recv_timeout(remaining).map_err(|_| if server.alive.load(Ordering::SeqCst) { "AI 请求超时".to_string() } else { "codex app-server exited".to_string() })?;
            let method = note.get("method").and_then(Value::as_str).unwrap_or("");
            let params = note.get("params").cloned().unwrap_or(Value::Null);
            let same_thread = params.get("threadId").and_then(Value::as_str) == Some(thread_id.as_str());
            if !same_thread {
                continue;
            }
            match method {
                "item/agentMessage/delta" => {
                    if let Some(d) = params.get("delta").and_then(Value::as_str) {
                        streamed.push_str(d);
                    }
                }
                "error" => {
                    let msg = params.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).or_else(|| params.get("message").and_then(Value::as_str));
                    if let Some(m) = msg {
                        return Err(m.to_string());
                    }
                }
                "turn/completed" => {
                    let t = params.get("turn").cloned().unwrap_or(Value::Null);
                    let status = t.get("status").and_then(Value::as_str).unwrap_or("");
                    if status == "failed" || status == "interrupted" {
                        let msg = t.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("Codex 未完成回复");
                        return Err(msg.to_string());
                    }
                    let text = agent_text(&t).or_else(|| if streamed.trim().is_empty() { None } else { Some(streamed.clone()) });
                    return text.ok_or_else(|| "接口没有返回文本内容".to_string());
                }
                _ => {}
            }
        }
    })();
    server.unsubscribe(key);
    outcome.map(|text| ChatReply { text, model: model_used })
}

/// One stateless text turn on the user's ChatGPT plan.
#[tauri::command]
pub async fn codex_chat(app: AppHandle, state: State<'_, CodexState>, request: ChatRequest) -> Result<ChatReply, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = &*inner;
        run_chat(&app, state, request)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the app-server (e.g. after the user changes the binary path).
#[tauri::command]
pub fn codex_shutdown(state: State<'_, CodexState>) {
    if let Ok(mut slot) = state.0.server.lock() {
        if let Some(s) = slot.take() {
            s.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_stdio_lines() {
        match classify(r#"{"id":3,"result":{"data":[]}}"#) {
            Incoming::Response(3, msg) => assert!(msg.get("result").is_some()),
            _ => panic!("response"),
        }
        match classify(r#"{"method":"turn/completed","params":{"threadId":"t"}}"#) {
            Incoming::Notification(m, p) => {
                assert_eq!(m, "turn/completed");
                assert_eq!(p["threadId"], "t");
            }
            _ => panic!("notification"),
        }
        match classify(r#"{"id":9,"method":"item/commandExecution/requestApproval","params":{}}"#) {
            Incoming::ServerRequest(id, m) => {
                assert_eq!(id, 9);
                assert_eq!(m, "item/commandExecution/requestApproval");
            }
            _ => panic!("server request"),
        }
        assert!(matches!(classify("not json"), Incoming::Ignored));
        assert!(matches!(classify(r#"{"jsonrpc":"2.0"}"#), Incoming::Ignored));
    }

    #[test]
    fn response_errors_surface_their_message() {
        assert_eq!(response_result(json!({"id":1,"result":{"ok":true}})).unwrap()["ok"], true);
        assert_eq!(response_result(json!({"id":1,"error":{"code":-1,"message":"nope"}})).unwrap_err(), "nope");
    }

    #[test]
    fn agent_text_joins_final_messages() {
        let turn = json!({ "items": [
            { "type": "userMessage", "text": "hi" },
            { "type": "agentMessage", "text": "first" },
            { "type": "reasoning", "text": "hidden" },
            { "type": "agentMessage", "text": "second" }
        ]});
        assert_eq!(agent_text(&turn).as_deref(), Some("first\nsecond"));
        assert_eq!(agent_text(&json!({ "items": [] })), None);
    }

    /// Opt-in end-to-end check against a real Codex binary and its saved login:
    /// MARKPDF_CODEX_BIN=<path to codex.exe> cargo test --lib codex::tests::live_roundtrip -- --ignored --nocapture
    /// Sends one tiny turn on the signed-in ChatGPT plan.
    #[test]
    #[ignore]
    fn live_roundtrip() {
        let bin = std::env::var("MARKPDF_CODEX_BIN").expect("set MARKPDF_CODEX_BIN");
        let info = locate(Some(&bin)).expect("locate");
        println!("codex {} at {}", info.version, info.path);
        let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let emit: Emit = Arc::new(move |e: &str, _v: Value| seen.lock().unwrap().push(e.to_string()));
        let server = Server::spawn(emit, info).expect("spawn app-server");
        let account = server.request("account/read", json!({}), REQUEST_TIMEOUT).expect("account/read");
        println!("account: {}", account_of(&account));
        assert!(account_of(&account).get("type").is_some(), "no saved login; run `codex login` first");
        let models = server.request("model/list", json!({ "limit": 100 }), REQUEST_TIMEOUT).expect("model/list");
        let data = models["data"].as_array().cloned().unwrap_or_default();
        assert!(!data.is_empty(), "empty model catalog");
        let cheapest = data.iter().find(|m| m["id"].as_str().map(|s| s.contains("sol") || s.contains("mini")).unwrap_or(false)).unwrap_or(&data[data.len() - 1]);
        println!("models: {:?}; using {}", data.iter().map(|m| m["id"].to_string()).collect::<Vec<_>>(), cheapest["id"]);
        let cwd = std::env::temp_dir().join("markpdf-codex-live");
        let reply = run_chat_with(&server, &cwd, ChatRequest {
            system: Some("You are a terse assistant. Reply with plain text only. Never run commands or tools.".into()),
            user: "Reply with the single word OK.".into(),
            model: cheapest["id"].as_str().map(str::to_string),
            effort: Some("low".into()),
            path_override: None,
        })
        .expect("chat");
        println!("reply: {:?} (model {})", reply.text, reply.model);
        assert!(reply.text.to_uppercase().contains("OK"));
        server.shutdown();
        assert!(!server.alive.load(Ordering::SeqCst));
        println!("events: {:?}", events.lock().unwrap());
    }

    #[test]
    fn candidates_include_override_first() {
        let list = candidate_paths(Some("C:/tools/codex.exe"));
        assert_eq!(list[0], PathBuf::from("C:/tools/codex.exe"));
        let dir = candidate_paths(Some("C:/tools"));
        assert!(dir[0].ends_with(EXE) || dir[0] == PathBuf::from("C:/tools"));
    }

    #[test]
    fn npm_discovery_finds_nested_hoisted_and_legacy_binaries() {
        let root = std::env::temp_dir().join(format!(
            "markpdf-codex-discovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
        ));
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
        }
        let _fixture = Fixture(root.clone());
        let platform = match std::env::consts::OS {
            "windows" => "win32",
            "macos" => "darwin",
            other => other,
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => other,
        };
        let package = format!("codex-{platform}-{arch}");
        // These are on-disk npm layouts, independent of the candidate builder.
        let layouts = [
            format!("@openai/codex/node_modules/@openai/{package}"),
            format!("@openai/{package}"),
            "@openai/codex".to_string(),
        ];
        for (index, layout) in layouts.iter().enumerate() {
            for bin_dir in ["bin", "codex"] {
                let node_modules = root.join(format!("{index}-{bin_dir}")).join("node_modules");
                let binary = node_modules.join(layout).join("vendor").join(TRIPLE).join(bin_dir).join(EXE);
                std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
                std::fs::write(&binary, []).unwrap();
                let found = npm_vendor_candidates(&node_modules).into_iter().find(|p| p.is_file());
                assert_eq!(found.as_ref(), Some(&binary), "missed npm layout {layout}/{bin_dir}");
            }
        }
        let node_modules = root.join("precedence").join("node_modules");
        let binaries: Vec<_> = layouts.iter().map(|layout| {
            let binary = node_modules.join(layout).join("vendor").join(TRIPLE).join("bin").join(EXE);
            std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
            std::fs::write(&binary, []).unwrap();
            binary
        }).collect();
        let found = npm_vendor_candidates(&node_modules).into_iter().find(|p| p.is_file());
        assert_eq!(found.as_ref(), Some(&binaries[0]), "the CLI resolves its own nested dependency first");
    }
}
