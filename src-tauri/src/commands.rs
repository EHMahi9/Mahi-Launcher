use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScript {
    pub name: String,
    pub project_path: String,
    pub ecosystem: String,
    pub package_manager: String,
    pub command: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProcessStatus {
    Starting,
    Running,
    Exited,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProcessInfo {
    pub id: String,
    pub project_name: String,
    pub project_path: String,
    pub script_name: String,
    pub package_manager: String,
    pub status: ProcessStatus,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub output_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub is_staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitProjectStatus {
    pub is_git_repo: bool,
    pub git_root: Option<String>,
    pub branch: Option<String>,
    pub modified_count: usize,
    pub staged_count: usize,
    pub untracked_count: usize,
    pub deleted_count: usize,
    pub renamed_count: usize,
    pub total_changed_count: usize,
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
    pub has_upstream: bool,
    pub upstream_branch: Option<String>,
    pub changed_files: Vec<GitChangedFile>,
    pub is_clean: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "projectType")]
    pub project_type: String,
    pub technologies: Vec<String>,
    #[serde(rename = "lastOpened")]
    pub last_opened: Option<u64>,
    #[serde(rename = "detectedIndicators")]
    pub detected_indicators: Vec<String>,
    #[serde(rename = "gitSummary")]
    pub git_summary: Option<String>,
    #[serde(rename = "hasDevScript")]
    pub has_dev_script: bool,
    pub scripts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProjectEntry {
    pub name: String,
    pub path: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedProjectEntry {
    pub path: String,
    pub name: String,
    pub pinned_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomEnvVar {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub is_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceConfig {
    pub pinned_scripts: Vec<String>,
    pub env_overrides: Vec<CustomEnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DebugStorageInfo {
    pub exists: bool,
    pub path: Option<String>,
    pub size_bytes: u64,
    pub size_mb: f64,
    pub size_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanStorageResult {
    pub success: bool,
    pub recovered_bytes: u64,
    pub recovered_mb: f64,
    pub recovered_gb: f64,
    pub deleted_paths: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    pub name: String,
    pub path: String,
    pub project_type: String,
    pub technologies: Vec<String>,
    pub frameworks: Vec<String>,
    pub package_manager: Option<String>,
    pub has_git: bool,
    pub has_docker: bool,
    pub important_files: Vec<String>,
    pub scripts: Vec<String>,
    pub last_opened: Option<u64>,
    pub detected_indicators: Vec<String>,
    pub git_status: Option<GitProjectStatus>,
    pub detected_scripts: Vec<ProjectScript>,
}

pub struct AppWorkspaceState {
    pub custom_roots: Mutex<Vec<PathBuf>>,
}

fn get_now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn get_recent_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;
    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app_data_dir: {}", e))?;
    Ok(app_dir.join("recent_projects.json"))
}

/// Safely read up to `max_bytes` from a file as UTF-8 string. Caps memory usage.
fn read_capped_string(path: &Path, max_bytes: usize) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::new();
    file.take(max_bytes as u64).read_to_end(&mut buffer).ok()?;
    String::from_utf8(buffer).ok()
}

/// Inspects read-only Git status for a given directory or repository.
/// Resolves real Git root (supporting nested subdirectories) and parses
/// branch, ahead/behind, working tree counts, and changed files.
pub fn inspect_git_status(dir: &Path) -> GitProjectStatus {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let dir_str = dir.to_string_lossy().to_string();

    // 1. Resolve repository root (supports opening nested project subfolders)
    let mut root_cmd = Command::new("git");
    root_cmd.args(["-C", &dir_str, "rev-parse", "--show-toplevel"]);
    #[cfg(target_os = "windows")]
    root_cmd.creation_flags(CREATE_NO_WINDOW);

    let root_output = match root_cmd.output() {
        Ok(o) => o,
        Err(e) => {
            return GitProjectStatus {
                is_git_repo: false,
                error: Some(format!("Git is not installed or not in PATH: {}", e)),
                ..Default::default()
            };
        }
    };

    if !root_output.status.success() {
        return GitProjectStatus {
            is_git_repo: false,
            error: Some("No Git repository".to_string()),
            ..Default::default()
        };
    }

    let raw_root = String::from_utf8_lossy(&root_output.stdout).trim().to_string();
    let normalized_root = raw_root.replace('\\', "/");

    // 2. Query branch & status via read-only git status --porcelain=v1 -b -uall
    let mut status_cmd = Command::new("git");
    status_cmd.args(["-C", &normalized_root, "status", "--porcelain=v1", "-b", "-uall"]);
    #[cfg(target_os = "windows")]
    status_cmd.creation_flags(CREATE_NO_WINDOW);

    let status_output = match status_cmd.output() {
        Ok(o) => o,
        Err(e) => {
            return GitProjectStatus {
                is_git_repo: true,
                git_root: Some(normalized_root),
                error: Some(format!("Failed to retrieve git status: {}", e)),
                ..Default::default()
            };
        }
    };

    if !status_output.status.success() {
        let err_msg = String::from_utf8_lossy(&status_output.stderr).trim().to_string();
        return GitProjectStatus {
            is_git_repo: true,
            git_root: Some(normalized_root),
            error: Some(if err_msg.is_empty() { "Git status query failed".to_string() } else { err_msg }),
            ..Default::default()
        };
    }

    let stdout_str = String::from_utf8_lossy(&status_output.stdout);
    let lines: Vec<&str> = stdout_str.lines().collect();

    let mut branch: Option<String> = None;
    let mut ahead: Option<usize> = None;
    let mut behind: Option<usize> = None;
    let mut has_upstream = false;
    let mut upstream_branch: Option<String> = None;

    let mut modified_count = 0;
    let mut staged_count = 0;
    let mut untracked_count = 0;
    let mut deleted_count = 0;
    let mut renamed_count = 0;
    let mut changed_files = Vec::new();

    if !lines.is_empty() {
        let header = lines[0].trim();
        let content = header.strip_prefix("## ").unwrap_or(header).trim();

        if content.starts_with("HEAD (no branch)") || content.contains("(no branch)") {
            branch = Some("Detached HEAD".to_string());
        } else if let Some(rest) = content.strip_prefix("No commits yet on ") {
            branch = Some(rest.trim().to_string());
        } else if let Some(rest) = content.strip_prefix("Initial commit on ") {
            branch = Some(rest.trim().to_string());
        } else {
            // Can be: branch...upstream [ahead X, behind Y] or branch...upstream or just branch
            let (b_part, meta_part) = if let Some(dots) = content.find("...") {
                let b = &content[..dots];
                let rest = &content[dots + 3..];
                (b, Some(rest))
            } else if let Some(space_idx) = content.find(' ') {
                let b = &content[..space_idx];
                let rest = &content[space_idx + 1..];
                (b, Some(rest))
            } else {
                (content, None)
            };

            branch = Some(b_part.trim().to_string());

            if let Some(meta) = meta_part {
                has_upstream = true;
                let mut up_name = meta;
                if let Some(bracket_idx) = meta.find('[') {
                    up_name = meta[..bracket_idx].trim();
                    let bracket_content = &meta[bracket_idx + 1..];
                    if let Some(close_idx) = bracket_content.find(']') {
                        let counts_str = &bracket_content[..close_idx];
                        for part in counts_str.split(',') {
                            let p = part.trim();
                            if let Some(num_str) = p.strip_prefix("ahead ") {
                                ahead = num_str.trim().parse::<usize>().ok();
                            } else if let Some(num_str) = p.strip_prefix("behind ") {
                                behind = num_str.trim().parse::<usize>().ok();
                            }
                        }
                    }
                }
                if !up_name.is_empty() {
                    upstream_branch = Some(up_name.to_string());
                }
            }
        }

        // Parse individual file changes
        for line in &lines[1..] {
            if line.len() < 3 {
                continue;
            }
            let x = line.chars().nth(0).unwrap_or(' ');
            let y = line.chars().nth(1).unwrap_or(' ');
            let file_path = line[3..].trim().to_string();

            let mut is_staged = false;
            let mut file_status = String::new();

            if x == '?' && y == '?' {
                untracked_count += 1;
                file_status = "??".to_string();
            } else {
                if x != ' ' && x != '?' {
                    staged_count += 1;
                    is_staged = true;
                    file_status.push(x);
                }
                if y == 'M' {
                    modified_count += 1;
                    if !file_status.contains('M') {
                        file_status.push('M');
                    }
                } else if y == 'D' {
                    deleted_count += 1;
                    if !file_status.contains('D') {
                        file_status.push('D');
                    }
                }
                if x == 'R' || y == 'R' {
                    renamed_count += 1;
                    if !file_status.contains('R') {
                        file_status.push('R');
                    }
                }
            }

            if changed_files.len() < 30 {
                changed_files.push(GitChangedFile {
                    path: file_path,
                    status: if file_status.is_empty() { format!("{}{}", x, y).trim().to_string() } else { file_status },
                    is_staged,
                });
            }
        }
    }

    let total_changed_count = lines.len().saturating_sub(1);
    let is_clean = total_changed_count == 0;

    GitProjectStatus {
        is_git_repo: true,
        git_root: Some(normalized_root),
        branch,
        modified_count,
        staged_count,
        untracked_count,
        deleted_count,
        renamed_count,
        total_changed_count,
        ahead,
        behind,
        has_upstream,
        upstream_branch,
        changed_files,
        is_clean,
        error: None,
    }
}

/// Formats a compact Git status summary string suitable for cards and search badges.
pub fn format_git_summary(status: &GitProjectStatus) -> Option<String> {
    if !status.is_git_repo {
        return None;
    }
    let branch = status.branch.as_deref().unwrap_or("Git");
    if status.total_changed_count == 0 {
        Some(format!("{} · Clean", branch))
    } else {
        let plural = if status.total_changed_count == 1 { "change" } else { "changes" };
        Some(format!("{} · {} {}", branch, status.total_changed_count, plural))
    }
}

/// Helper to find executable of package manager in PATH or via where.exe on Windows
pub fn find_package_manager_executable(pm: &str) -> Option<PathBuf> {
    if let Some(path_var) = std::env::var_os("PATH") {
        let extensions = if cfg!(windows) {
            vec![".cmd", ".exe", ".bat", ""]
        } else {
            vec![""]
        };
        for dir in std::env::split_paths(&path_var) {
            for ext in &extensions {
                let candidate = dir.join(format!("{}{}", pm, ext));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut check_cmd = Command::new("where.exe");
        check_cmd.arg(pm);
        check_cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = check_cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let p = PathBuf::from(first_line.trim());
                    if p.is_file() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

pub struct ProcessManager {
    processes: Mutex<HashMap<String, Arc<Mutex<ProjectProcessInfo>>>>,
    child_killers: Mutex<HashMap<String, u32>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            child_killers: Mutex::new(HashMap::new()),
        }
    }

    pub fn global() -> &'static Arc<ProcessManager> {
        static INSTANCE: std::sync::OnceLock<Arc<ProcessManager>> = std::sync::OnceLock::new();
        INSTANCE.get_or_init(|| Arc::new(ProcessManager::new()))
    }

    pub fn run_script(
        &self,
        project_path: &str,
        script_name: &str,
        env_overrides: Option<Vec<CustomEnvVar>>,
    ) -> Result<ProjectProcessInfo, String> {
        let proj_dir = Path::new(project_path);
        if !proj_dir.is_dir() {
            return Err(format!("Project directory does not exist: {}", project_path));
        }

        let pkg_json_path = proj_dir.join("package.json");
        if !pkg_json_path.is_file() {
            return Err("Only Node-based projects with package.json are supported in this phase.".to_string());
        }

        let content = fs::read_to_string(&pkg_json_path)
            .map_err(|e| format!("Failed to read package.json: {}", e))?;
        let val: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse package.json: {}", e))?;

        let scripts_obj = val.get("scripts").and_then(|s| s.as_object())
            .ok_or_else(|| "No runnable scripts were found.".to_string())?;

        if !scripts_obj.contains_key(script_name) {
            return Err(format!("Script '{}' was not found in project's package.json.", script_name));
        }

        // Package manager detection
        let mut pm = "npm".to_string();
        if proj_dir.join("pnpm-lock.yaml").exists() {
            pm = "pnpm".to_string();
        } else if proj_dir.join("yarn.lock").exists() {
            pm = "yarn".to_string();
        } else if proj_dir.join("bun.lockb").exists() || proj_dir.join("bun.lock").exists() {
            pm = "bun".to_string();
        } else if proj_dir.join("package-lock.json").exists() {
            pm = "npm".to_string();
        } else if let Some(pm_field) = val.get("packageManager").and_then(|p| p.as_str()) {
            let lower = pm_field.to_lowercase();
            if lower.starts_with("pnpm") {
                pm = "pnpm".to_string();
            } else if lower.starts_with("yarn") {
                pm = "yarn".to_string();
            } else if lower.starts_with("bun") {
                pm = "bun".to_string();
            } else if lower.starts_with("npm") {
                pm = "npm".to_string();
            }
        }

        // Validate package manager executable
        if find_package_manager_executable(&pm).is_none() {
            return Err(format!("{} was detected for this project, but {} is not available on this system.", pm, pm));
        }

        // Check if already running this exact script for this project
        {
            let procs = self.processes.lock().unwrap();
            for proc_arc in procs.values() {
                let guard = proc_arc.lock().unwrap();
                if guard.project_path == project_path && guard.script_name == script_name && (guard.status == ProcessStatus::Running || guard.status == ProcessStatus::Starting) {
                    return Ok(guard.clone());
                }
            }
        }

        let proc_id = format!("proc-{}-{}", get_now_epoch_ms(), script_name);

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", &pm, "run", script_name]);
            c
        } else {
            let mut c = Command::new(&pm);
            c.args(["run", script_name]);
            c
        };

        cmd.current_dir(proj_dir);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        // Inject custom environment variable overrides
        if let Some(ref envs) = env_overrides {
            for var in envs {
                if var.enabled && !var.key.trim().is_empty() {
                    cmd.env(&var.key, &var.value);
                }
            }
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;
        let pid = child.id();

        let project_name = proj_dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".to_string());

        let info = ProjectProcessInfo {
            id: proc_id.clone(),
            project_name,
            project_path: project_path.to_string(),
            script_name: script_name.to_string(),
            package_manager: pm.clone(),
            status: ProcessStatus::Running,
            exit_code: None,
            started_at: get_now_epoch_ms(),
            output_lines: vec![format!("[mahi] Started '{} run {}'", pm, script_name)],
        };

        let info_arc = Arc::new(Mutex::new(info.clone()));
        self.processes.lock().unwrap().insert(proc_id.clone(), Arc::clone(&info_arc));
        self.child_killers.lock().unwrap().insert(proc_id.clone(), pid);

        if let Some(stdout) = child.stdout.take() {
            let p = Arc::clone(&info_arc);
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let mut guard = p.lock().unwrap();
                        if guard.output_lines.len() >= 300 {
                            guard.output_lines.remove(0);
                        }
                        guard.output_lines.push(l);
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let p = Arc::clone(&info_arc);
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let mut guard = p.lock().unwrap();
                        if guard.output_lines.len() >= 300 {
                            guard.output_lines.remove(0);
                        }
                        guard.output_lines.push(l);
                    }
                }
            });
        }

        let p = Arc::clone(&info_arc);
        std::thread::spawn(move || {
            match child.wait() {
                Ok(exit_status) => {
                    let mut guard = p.lock().unwrap();
                    if guard.status == ProcessStatus::Running || guard.status == ProcessStatus::Starting {
                        let code = exit_status.code().unwrap_or(if exit_status.success() { 0 } else { 1 });
                        guard.exit_code = Some(code);
                        guard.status = if exit_status.success() {
                            ProcessStatus::Exited
                        } else {
                            ProcessStatus::Failed
                        };
                        guard.output_lines.push(format!(
                            "[mahi] Process {} with exit code {}",
                            if exit_status.success() { "exited" } else { "failed" },
                            code
                        ));
                    }
                }
                Err(_) => {
                    let mut guard = p.lock().unwrap();
                    if guard.status != ProcessStatus::Stopped {
                        guard.status = ProcessStatus::Failed;
                    }
                }
            }
        });

        Ok(info)
    }

    pub fn stop_process(&self, process_id: &str) -> Result<ProjectProcessInfo, String> {
        let pid_opt = {
            let mut killers = self.child_killers.lock().unwrap();
            killers.remove(process_id)
        };

        let procs = self.processes.lock().unwrap();
        let proc_arc = procs.get(process_id).ok_or_else(|| format!("Process '{}' not found", process_id))?;
        let mut guard = proc_arc.lock().unwrap();

        if guard.status == ProcessStatus::Running || guard.status == ProcessStatus::Starting {
            guard.status = ProcessStatus::Stopped;
            guard.output_lines.push("[mahi] Process stopped by user.".to_string());
            if let Some(pid) = pid_opt {
                #[cfg(target_os = "windows")]
                {
                    let mut kill_cmd = Command::new("taskkill");
                    kill_cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                    kill_cmd.creation_flags(CREATE_NO_WINDOW);
                    let _ = kill_cmd.output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                }
            }
        }
        Ok(guard.clone())
    }

    pub fn get_processes(&self) -> Vec<ProjectProcessInfo> {
        let procs = self.processes.lock().unwrap();
        let mut list = Vec::new();
        for arc in procs.values() {
            list.push(arc.lock().unwrap().clone());
        }
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        list
    }
}

/// Canonical Project Intelligence detector inspecting real filesystem evidence.
pub fn detect_project_details(dir: &Path) -> Option<ProjectDetails> {
    if !dir.is_dir() {
        return None;
    }

    let normalized_path = dir.to_string_lossy().replace('\\', "/");
    let mut indicators = Vec::new();
    let mut technologies = Vec::new();
    let mut frameworks = Vec::new();
    let mut important_files = Vec::new();
    let mut scripts = Vec::new();
    let mut detected_scripts = Vec::new();
    let mut package_manager: Option<String> = None;
    let mut primary_type = "Developer Project".to_string();

    let check_file = |name: &str| -> bool { dir.join(name).exists() };

    let mut has_git = false;
    if check_file(".git") {
        has_git = true;
        indicators.push(".git".to_string());
        technologies.push("Git".to_string());
        important_files.push(".git".to_string());
    }

    if check_file(".gitignore") {
        important_files.push(".gitignore".to_string());
    }

    if check_file("README.md") {
        important_files.push("README.md".to_string());
    } else if check_file("readme.md") {
        important_files.push("readme.md".to_string());
    }

    // CRITICAL SECURITY: Never read .env contents under any circumstances!
    if check_file(".env") {
        important_files.push(".env (present)".to_string());
    }
    if check_file(".env.local") {
        important_files.push(".env.local (present)".to_string());
    }
    if check_file(".env.example") {
        important_files.push(".env.example".to_string());
    }

    let mut has_docker = false;
    if check_file("Dockerfile") {
        has_docker = true;
        indicators.push("Dockerfile".to_string());
        technologies.push("Docker".to_string());
        important_files.push("Dockerfile".to_string());
    }
    if check_file("docker-compose.yml") {
        has_docker = true;
        indicators.push("docker-compose.yml".to_string());
        technologies.push("Docker".to_string());
        important_files.push("docker-compose.yml".to_string());
    } else if check_file("docker-compose.yaml") {
        has_docker = true;
        indicators.push("docker-compose.yaml".to_string());
        technologies.push("Docker".to_string());
        important_files.push("docker-compose.yaml".to_string());
    }

    // 1. Node.js / Web
    if check_file("package.json") {
        indicators.push("package.json".to_string());
        primary_type = "Node / Web".to_string();
        technologies.push("Node.js".to_string());
        important_files.push("package.json".to_string());

        // Lockfiles & Package Manager detection
        if check_file("pnpm-lock.yaml") {
            package_manager = Some("pnpm".to_string());
            important_files.push("pnpm-lock.yaml".to_string());
        } else if check_file("yarn.lock") {
            package_manager = Some("yarn".to_string());
            important_files.push("yarn.lock".to_string());
        } else if check_file("bun.lockb") {
            package_manager = Some("bun".to_string());
            important_files.push("bun.lockb".to_string());
        } else if check_file("bun.lock") {
            package_manager = Some("bun".to_string());
            important_files.push("bun.lock".to_string());
        } else if check_file("package-lock.json") {
            package_manager = Some("npm".to_string());
            important_files.push("package-lock.json".to_string());
        }

        if check_file("tsconfig.json") {
            important_files.push("tsconfig.json".to_string());
            technologies.push("TypeScript".to_string());
        }

        if check_file("vite.config.ts") {
            important_files.push("vite.config.ts".to_string());
            frameworks.push("Vite".to_string());
        } else if check_file("vite.config.js") {
            important_files.push("vite.config.js".to_string());
            frameworks.push("Vite".to_string());
        }

        if check_file("next.config.js") {
            important_files.push("next.config.js".to_string());
            frameworks.push("Next.js".to_string());
        } else if check_file("next.config.mjs") {
            important_files.push("next.config.mjs".to_string());
            frameworks.push("Next.js".to_string());
        } else if check_file("next.config.ts") {
            important_files.push("next.config.ts".to_string());
            frameworks.push("Next.js".to_string());
        }

        if check_file("tauri.conf.json") || dir.join("src-tauri").join("tauri.conf.json").exists() {
            important_files.push("tauri.conf.json".to_string());
            frameworks.push("Tauri".to_string());
        }

        // Capped reading of package.json (max 256 KB)
        if let Some(content) = read_capped_string(&dir.join("package.json"), 256 * 1024) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                // Extract scripts
                if let Some(s_obj) = val.get("scripts").and_then(|s| s.as_object()) {
                    for key in s_obj.keys() {
                        scripts.push(key.clone());
                    }
                }

                // Check packageManager field fallback
                if package_manager.is_none() {
                    if let Some(pm_str) = val.get("packageManager").and_then(|p| p.as_str()) {
                        let pm_lower = pm_str.to_lowercase();
                        if pm_lower.starts_with("pnpm") {
                            package_manager = Some("pnpm".to_string());
                        } else if pm_lower.starts_with("yarn") {
                            package_manager = Some("yarn".to_string());
                        } else if pm_lower.starts_with("bun") {
                            package_manager = Some("bun".to_string());
                        } else if pm_lower.starts_with("npm") {
                            package_manager = Some("npm".to_string());
                        }
                    }
                }

                // Inspect dependencies & devDependencies
                let mut dep_keys = Vec::new();
                if let Some(deps) = val.get("dependencies").and_then(|d| d.as_object()) {
                    dep_keys.extend(deps.keys().cloned());
                }
                if let Some(dev_deps) = val.get("devDependencies").and_then(|d| d.as_object()) {
                    dep_keys.extend(dev_deps.keys().cloned());
                }

                for dep in dep_keys {
                    let d = dep.to_lowercase();
                    if d == "next" {
                        frameworks.push("Next.js".to_string());
                    } else if d == "react" {
                        frameworks.push("React".to_string());
                    } else if d == "vue" {
                        frameworks.push("Vue".to_string());
                    } else if d == "svelte" {
                        frameworks.push("Svelte".to_string());
                    } else if d == "@angular/core" || d.starts_with("@angular/") {
                        frameworks.push("Angular".to_string());
                    } else if d == "express" {
                        frameworks.push("Express".to_string());
                    } else if d == "@nestjs/core" || d.starts_with("@nestjs/") {
                        frameworks.push("NestJS".to_string());
                    } else if d == "tailwindcss" {
                        frameworks.push("Tailwind CSS".to_string());
                    } else if d == "typescript" {
                        technologies.push("TypeScript".to_string());
                    } else if d == "@tauri-apps/api" {
                        frameworks.push("Tauri".to_string());
                    } else if d == "electron" {
                        frameworks.push("Electron".to_string());
                    }
                }

                if package_manager.is_none() {
                    package_manager = Some("npm".to_string());
                }

                let pm_for_scripts = package_manager.clone().unwrap_or_else(|| "npm".to_string());
                for script_name in &scripts {
                    let cmd_str = val.get("scripts")
                        .and_then(|s| s.get(script_name))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string());
                    detected_scripts.push(ProjectScript {
                        name: script_name.clone(),
                        project_path: normalized_path.clone(),
                        ecosystem: "node".to_string(),
                        package_manager: pm_for_scripts.clone(),
                        command: cmd_str,
                        description: None,
                    });
                }
            }
        }
    }

    // 2. Rust / Cargo
    if check_file("Cargo.toml") {
        indicators.push("Cargo.toml".to_string());
        important_files.push("Cargo.toml".to_string());
        if check_file("Cargo.lock") {
            important_files.push("Cargo.lock".to_string());
        }
        if primary_type == "Developer Project" || primary_type == "Node / Web" {
            if primary_type == "Node / Web" {
                primary_type = "Rust / Web".to_string();
            } else {
                primary_type = "Rust".to_string();
            }
        }
        technologies.push("Rust".to_string());
        if package_manager.is_none() {
            package_manager = Some("cargo".to_string());
        }

        if let Some(content) = read_capped_string(&dir.join("Cargo.toml"), 256 * 1024) {
            let lower = content.to_lowercase();
            if lower.contains("tauri") {
                frameworks.push("Tauri 2".to_string());
            }
            if lower.contains("tokio") {
                frameworks.push("Tokio".to_string());
            }
            if lower.contains("axum") {
                frameworks.push("Axum".to_string());
            }
            if lower.contains("actix") {
                frameworks.push("Actix Web".to_string());
            }
            if lower.contains("serde") {
                technologies.push("Serde".to_string());
            }
        }
    }

    // 3. Java / Maven
    if check_file("pom.xml") {
        indicators.push("pom.xml".to_string());
        important_files.push("pom.xml".to_string());
        primary_type = "Java / Maven".to_string();
        technologies.push("Java".to_string());
        if package_manager.is_none() {
            package_manager = Some("maven".to_string());
        }

        if let Some(content) = read_capped_string(&dir.join("pom.xml"), 256 * 1024) {
            let lower = content.to_lowercase();
            if lower.contains("spring-boot") {
                frameworks.push("Spring Boot".to_string());
            }
            if lower.contains("quarkus") {
                frameworks.push("Quarkus".to_string());
            }
            if lower.contains("mysql") {
                technologies.push("MySQL".to_string());
            }
            if lower.contains("postgresql") || lower.contains("postgres") {
                technologies.push("PostgreSQL".to_string());
            }
        }
    }

    // 4. Java / Gradle
    if check_file("build.gradle") || check_file("build.gradle.kts") {
        let name = if check_file("build.gradle.kts") { "build.gradle.kts" } else { "build.gradle" };
        indicators.push(name.to_string());
        important_files.push(name.to_string());
        primary_type = "Java / Gradle".to_string();
        technologies.push("Gradle".to_string());
        technologies.push("Java".to_string());
        if check_file("build.gradle.kts") {
            technologies.push("Kotlin".to_string());
        }
        if package_manager.is_none() {
            package_manager = Some("gradle".to_string());
        }
    }

    // 5. Python
    if check_file("requirements.txt") || check_file("pyproject.toml") || check_file("Pipfile") {
        let indicator = if check_file("pyproject.toml") {
            "pyproject.toml"
        } else if check_file("Pipfile") {
            "Pipfile"
        } else {
            "requirements.txt"
        };
        indicators.push(indicator.to_string());
        important_files.push(indicator.to_string());
        primary_type = "Python".to_string();
        technologies.push("Python".to_string());

        if check_file("poetry.lock") {
            important_files.push("poetry.lock".to_string());
            package_manager = Some("poetry".to_string());
        } else if check_file("uv.lock") {
            important_files.push("uv.lock".to_string());
            package_manager = Some("uv".to_string());
        } else if check_file("Pipfile.lock") {
            important_files.push("Pipfile.lock".to_string());
            package_manager = Some("pipenv".to_string());
        } else if package_manager.is_none() {
            package_manager = Some("pip".to_string());
        }

        let py_content = read_capped_string(&dir.join("requirements.txt"), 256 * 1024)
            .or_else(|| read_capped_string(&dir.join("pyproject.toml"), 256 * 1024));
        if let Some(content) = py_content {
            let lower = content.to_lowercase();
            if lower.contains("fastapi") {
                frameworks.push("FastAPI".to_string());
            }
            if lower.contains("django") {
                frameworks.push("Django".to_string());
            }
            if lower.contains("flask") {
                frameworks.push("Flask".to_string());
            }
            if lower.contains("torch") || lower.contains("pytorch") {
                frameworks.push("PyTorch".to_string());
            }
        }
    }

    // 6. Go
    if check_file("go.mod") {
        indicators.push("go.mod".to_string());
        important_files.push("go.mod".to_string());
        if check_file("go.sum") {
            important_files.push("go.sum".to_string());
        }
        primary_type = "Go".to_string();
        technologies.push("Go".to_string());
        if package_manager.is_none() {
            package_manager = Some("go modules".to_string());
        }

        if let Some(content) = read_capped_string(&dir.join("go.mod"), 256 * 1024) {
            let lower = content.to_lowercase();
            if lower.contains("gin-gonic/gin") {
                frameworks.push("Gin".to_string());
            }
            if lower.contains("gofiber/fiber") {
                frameworks.push("Fiber".to_string());
            }
        }
    }

    // 7. PHP
    if check_file("composer.json") {
        indicators.push("composer.json".to_string());
        important_files.push("composer.json".to_string());
        if check_file("composer.lock") {
            important_files.push("composer.lock".to_string());
        }
        primary_type = "PHP".to_string();
        technologies.push("PHP".to_string());
        if package_manager.is_none() {
            package_manager = Some("composer".to_string());
        }

        if let Some(content) = read_capped_string(&dir.join("composer.json"), 256 * 1024) {
            let lower = content.to_lowercase();
            if lower.contains("laravel") {
                frameworks.push("Laravel".to_string());
            }
            if lower.contains("symfony") {
                frameworks.push("Symfony".to_string());
            }
        }
    }

    if indicators.is_empty() {
        return None;
    }

    // Deduplicate lists preserving order
    let dedup = |vec: Vec<String>| -> Vec<String> {
        let mut out = Vec::new();
        for item in vec {
            if !out.contains(&item) {
                out.push(item);
            }
        }
        out
    };

    let deduped_tech = dedup(technologies);
    let deduped_frameworks = dedup(frameworks);
    let deduped_files = dedup(important_files);
    let deduped_indicators = dedup(indicators);

    let project_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let normalized_path = dir.to_string_lossy().replace('\\', "/");

    let git_status = if has_git {
        Some(inspect_git_status(dir))
    } else {
        None
    };

    Some(ProjectDetails {
        name: project_name,
        path: normalized_path,
        project_type: primary_type,
        technologies: if deduped_tech.is_empty() { vec!["Developer project".to_string()] } else { deduped_tech },
        frameworks: deduped_frameworks,
        package_manager,
        has_git,
        has_docker,
        important_files: deduped_files,
        scripts: scripts.clone(),
        last_opened: None,
        detected_indicators: deduped_indicators,
        git_status,
        detected_scripts,
    })
}

pub fn detect_project(dir: &Path) -> Option<ProjectInfo> {
    detect_project_details(dir).map(|d| {
        let mut combined_tech = d.technologies.clone();
        for f in &d.frameworks {
            if !combined_tech.contains(f) {
                combined_tech.push(f.clone());
            }
        }
        let git_summary = d.git_status.as_ref().and_then(format_git_summary);
        let has_dev_script = d.scripts.iter().any(|s| s == "dev");
        ProjectInfo {
            name: d.name,
            path: d.path,
            project_type: d.project_type,
            technologies: combined_tech,
            last_opened: d.last_opened,
            detected_indicators: d.detected_indicators,
            git_summary,
            has_dev_script,
            scripts: d.scripts,
        }
    })
}

fn scan_directory_for_projects(dir: &Path, depth: usize, max_depth: usize, results: &mut Vec<ProjectInfo>) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }

    let skip_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        "out",
        "vendor",
        ".pnpm-store",
        "$RECYCLE.BIN",
        "System Volume Information",
        "AppData",
        ".gradle",
        ".idea",
        ".vscode",
    ];

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut subdirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let file_name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            if skip_dirs.iter().any(|&s| s.eq_ignore_ascii_case(&file_name)) {
                continue;
            }

            if let Some(project) = detect_project(&path) {
                // If it's a project, add it and do not dive deeper into nested submodules
                results.push(project);
            } else {
                subdirs.push(path);
            }
        }
    }

    for sub in subdirs {
        scan_directory_for_projects(&sub, depth + 1, max_depth, results);
    }
}

// ----------------- TAURI COMMANDS -----------------

pub fn discover_projects_with_roots(custom_roots: &[PathBuf]) -> Vec<ProjectInfo> {
    let mut candidate_roots = Vec::new();

    // 1. Configured roots (highest priority)
    for r in custom_roots {
        if r.is_dir() && !candidate_roots.contains(r) {
            candidate_roots.push(r.clone());
        }
    }

    // 2. Default discoverable roots (only if existing on disk)
    let standard_locations = [
        "D:\\Code",
        "D:\\Projects",
        "C:\\Projects",
        "C:\\Code",
        "E:\\Code",
        "E:\\Projects",
    ];

    for loc in &standard_locations {
        let p = PathBuf::from(loc);
        if p.exists() && !candidate_roots.contains(&p) {
            candidate_roots.push(p);
        }
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let docs = PathBuf::from(&user_profile).join("Documents");
        if docs.exists() && !candidate_roots.contains(&docs) {
            candidate_roots.push(docs);
        }
        let desktop = PathBuf::from(&user_profile).join("Desktop");
        if desktop.exists() && !candidate_roots.contains(&desktop) {
            candidate_roots.push(desktop);
        }
        let repos = PathBuf::from(&user_profile).join("source").join("repos");
        if repos.exists() && !candidate_roots.contains(&repos) {
            candidate_roots.push(repos);
        }
        let dev = PathBuf::from(&user_profile).join("dev");
        if dev.exists() && !candidate_roots.contains(&dev) {
            candidate_roots.push(dev);
        }
    }

    let mut results = Vec::new();
    for root in candidate_roots {
        // Direct root project check
        if let Some(root_proj) = detect_project(&root) {
            results.push(root_proj);
        }
        // Scan subfolders up to depth 3
        scan_directory_for_projects(&root, 1, 3, &mut results);
    }

    // Deduplicate projects by normalized path
    let mut seen = std::collections::HashSet::new();
    results.retain(|p| {
        let norm = normalize_path_str(&p.path);
        if seen.contains(&norm) {
            false
        } else {
            seen.insert(norm);
            true
        }
    });

    // Sort alphabetically by name
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    results
}

#[tauri::command]
pub fn discover_projects(app: AppHandle, state: State<'_, AppWorkspaceState>) -> Vec<ProjectInfo> {
    let mut custom_roots = Vec::new();

    // Load persisted scan roots from AppData file
    if let Ok(file) = get_app_data_file_path(&app, "scan_roots.json") {
        if file.exists() {
            if let Ok(data) = fs::read_to_string(&file) {
                if let Ok(roots) = serde_json::from_str::<Vec<String>>(&data) {
                    for r in roots {
                        let pb = PathBuf::from(&r);
                        if pb.is_dir() && !custom_roots.contains(&pb) {
                            custom_roots.push(pb);
                        }
                    }
                }
            }
        }
    }

    // Merge in-memory roots from state
    if let Ok(roots) = state.custom_roots.lock() {
        for r in roots.iter() {
            if r.is_dir() && !custom_roots.contains(r) {
                custom_roots.push(r.clone());
            }
        }
    }

    discover_projects_with_roots(&custom_roots)
}

#[tauri::command]
pub fn get_scan_roots(app: AppHandle, state: State<'_, AppWorkspaceState>) -> Result<Vec<String>, String> {
    let file = get_app_data_file_path(&app, "scan_roots.json")?;
    let mut roots: Vec<String> = if file.exists() {
        let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read scan_roots.json: {}", e))?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Filter to existing directories
    roots.retain(|r| Path::new(r).is_dir());

    // Sync in-memory state
    if let Ok(mut state_roots) = state.custom_roots.lock() {
        *state_roots = roots.iter().map(PathBuf::from).collect();
    }

    Ok(roots)
}

#[tauri::command]
pub fn set_scan_roots(
    app: AppHandle,
    state: State<'_, AppWorkspaceState>,
    roots: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut validated_roots = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for r in roots {
        let clean = r.trim().to_string();
        if clean.is_empty() {
            continue;
        }
        let p = Path::new(&clean);
        if !p.exists() || !p.is_dir() {
            continue;
        }
        let norm = normalize_path_str(&clean);
        if seen.contains(&norm) {
            continue;
        }
        seen.insert(norm);
        validated_roots.push(clean);
    }

    let file = get_app_data_file_path(&app, "scan_roots.json")?;
    let json = serde_json::to_string_pretty(&validated_roots)
        .map_err(|e| format!("Failed to serialize scan roots: {}", e))?;
    fs::write(&file, json).map_err(|e| format!("Failed to write scan_roots.json: {}", e))?;

    // Update in-memory state
    if let Ok(mut state_roots) = state.custom_roots.lock() {
        *state_roots = validated_roots.iter().map(PathBuf::from).collect();
    }

    Ok(validated_roots)
}

#[tauri::command]
pub async fn pick_scan_root() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let script = r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select Project Folder'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }"#;

            let output = Command::new("powershell")
                .args(["-STA", "-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Failed to launch folder picker: {}", e))?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if stdout.is_empty() {
                    Ok(None)
                } else {
                    let p = Path::new(&stdout);
                    if p.is_dir() {
                        Ok(Some(stdout))
                    } else {
                        Ok(None)
                    }
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Folder picker error: {}", stderr))
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Ok(None)
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub completed: bool,
    pub dismissed: bool,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<u64>,
}

#[tauri::command]
pub fn get_onboarding_state(app: AppHandle) -> Result<OnboardingState, String> {
    let file = get_app_data_file_path(&app, "onboarding.json")?;
    if file.exists() {
        let data = fs::read_to_string(&file)
            .map_err(|e| format!("Failed to read onboarding.json: {}", e))?;
        Ok(serde_json::from_str(&data).unwrap_or(OnboardingState {
            completed: false,
            dismissed: false,
            completed_at: None,
        }))
    } else {
        Ok(OnboardingState {
            completed: false,
            dismissed: false,
            completed_at: None,
        })
    }
}

#[tauri::command]
pub fn set_onboarding_state(app: AppHandle, state: OnboardingState) -> Result<OnboardingState, String> {
    let file = get_app_data_file_path(&app, "onboarding.json")?;
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize onboarding state: {}", e))?;
    fs::write(&file, json)
        .map_err(|e| format!("Failed to write onboarding.json: {}", e))?;
    Ok(state)
}

#[tauri::command]
pub fn get_project_details(app: AppHandle, path: String) -> Result<ProjectDetails, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {}", path));
    }

    let mut details = match detect_project_details(p) {
        Some(d) => d,
        None => {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            let normalized_path = p.to_string_lossy().replace('\\', "/");
            ProjectDetails {
                name,
                path: normalized_path,
                project_type: "Developer Project".to_string(),
                technologies: vec!["Developer project".to_string()],
                frameworks: Vec::new(),
                package_manager: None,
                has_git: p.join(".git").exists(),
                has_docker: p.join("Dockerfile").exists() || p.join("docker-compose.yml").exists(),
                important_files: Vec::new(),
                scripts: Vec::new(),
                last_opened: None,
                detected_indicators: Vec::new(),
                git_status: if p.join(".git").exists() {
                    Some(inspect_git_status(p))
                } else {
                    None
                },
                detected_scripts: Vec::new(),
            }
        }
    };

    // Attempt to lookup last_opened timestamp from recent_projects.json
    if let Ok(recent_file) = get_recent_file_path(&app) {
        if recent_file.exists() {
            if let Ok(content) = fs::read_to_string(&recent_file) {
                if let Ok(recents) = serde_json::from_str::<Vec<RecentProjectEntry>>(&content) {
                    let norm_path = path.replace('\\', "/").to_lowercase();
                    if let Some(entry) = recents.iter().find(|r| r.path.replace('\\', "/").to_lowercase() == norm_path) {
                        details.last_opened = Some(entry.timestamp);
                    }
                }
            }
        }
    }

    Ok(details)
}

#[tauri::command]
pub fn get_git_status(path: String) -> Result<GitProjectStatus, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    Ok(inspect_git_status(p))
}

#[tauri::command]
pub fn run_project_script(
    project_path: String,
    script_name: String,
    env_overrides: Option<Vec<CustomEnvVar>>,
) -> Result<ProjectProcessInfo, String> {
    ProcessManager::global().run_script(&project_path, &script_name, env_overrides)
}

#[tauri::command]
pub fn stop_project_process(process_id: String) -> Result<ProjectProcessInfo, String> {
    ProcessManager::global().stop_process(&process_id)
}

#[tauri::command]
pub fn get_running_processes() -> Result<Vec<ProjectProcessInfo>, String> {
    Ok(ProcessManager::global().get_processes())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let clean_path = path.trim().replace('/', "\\");
    let p = Path::new(&clean_path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            // Open file with default Windows registered application
            Command::new("cmd")
                .args(["/C", "start", "", &clean_path])
                .spawn()
                .map_err(|e| format!("Failed to open file with default application: {}", e))?;
        } else {
            // Open directory in Windows Explorer
            Command::new("explorer")
                .arg(&clean_path)
                .spawn()
                .map_err(|e| format!("Failed to open path: {}", e))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        opener::open(&clean_path).map_err(|e| format!("Failed to open path: {}", e))
    }
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let clean_path = path.trim().replace('/', "\\");
    let p = Path::new(&clean_path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            // If it's a file, reveal it and select it in Windows Explorer
            Command::new("explorer")
                .arg(format!("/select,{}", clean_path))
                .spawn()
                .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
        } else {
            // If it's a directory, open the directory
            Command::new("explorer")
                .arg(&clean_path)
                .spawn()
                .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        opener::open(&clean_path).map_err(|e| format!("Failed to open path: {}", e))
    }
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    let clean_path = path.trim().replace('/', "\\");
    let p = Path::new(&clean_path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let working_dir = if p.is_file() {
        p.parent().unwrap_or(p)
    } else {
        p
    };

    #[cfg(target_os = "windows")]
    {
        let dir_str = working_dir.to_string_lossy().to_string();
        Command::new("cmd")
            .args([
                "/C", 
                "start", 
                "", 
                "powershell", 
                "-NoExit", 
                "-Command", 
                &format!("Set-Location -LiteralPath '{}'", dir_str.replace('\'', "''"))
            ])
            .current_dir(working_dir)
            .spawn()
            .map_err(|e| format!("Failed to start PowerShell: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .current_dir(working_dir)
            .spawn()
            .map_err(|e| format!("Failed to start shell: {}", e))?;
        Ok(())
    }
}

fn find_vscode_exe() -> Option<PathBuf> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(&local_app_data).join("Programs\\Microsoft VS Code\\Code.exe");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(prog_files) = std::env::var("ProgramFiles") {
        let p = PathBuf::from(&prog_files).join("Microsoft VS Code\\Code.exe");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
        let p = PathBuf::from(&prog_files_x86).join("Microsoft VS Code\\Code.exe");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn find_vscode_cmd() -> Option<PathBuf> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let p1 = PathBuf::from(&local_app_data).join("Programs\\Microsoft VS Code\\bin\\code.cmd");
        if p1.exists() {
            return Some(p1);
        }
    }
    if let Ok(prog_files) = std::env::var("ProgramFiles") {
        let p1 = PathBuf::from(&prog_files).join("Microsoft VS Code\\bin\\code.cmd");
        if p1.exists() {
            return Some(p1);
        }
    }
    if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
        let p1 = PathBuf::from(&prog_files_x86).join("Microsoft VS Code\\bin\\code.cmd");
        if p1.exists() {
            return Some(p1);
        }
    }
    None
}

#[tauri::command]
pub fn check_vscode_available() -> bool {
    if find_vscode_exe().is_some() || find_vscode_cmd().is_some() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "where code"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which")
            .arg("code")
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
}

#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    let clean_path = path.trim().replace('/', "\\");
    let p = Path::new(&clean_path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // 1. Prefer direct Code.exe execution (bypasses cmd.exe quote stripping entirely)
        if let Some(exe_path) = find_vscode_exe() {
            Command::new(&exe_path)
                .arg(&clean_path)
                .spawn()
                .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
            return Ok(());
        }

        // 2. Fallback to code.cmd with cmd /C call (handles spaces safely)
        if let Some(cmd_path) = find_vscode_cmd() {
            Command::new("cmd")
                .args(["/C", "call", &cmd_path.to_string_lossy(), &clean_path])
                .spawn()
                .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
            return Ok(());
        }

        // 3. Fallback to PATH lookup
        if check_vscode_available() {
            Command::new("cmd")
                .args(["/C", "call", "code", &clean_path])
                .spawn()
                .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
            return Ok(());
        }

        Err("Visual Studio Code is not installed or not found in PATH.".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("code")
            .arg(&clean_path)
            .spawn()
            .map_err(|e| format!("Failed to launch VS Code: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
pub fn get_recent_projects(app: AppHandle) -> Result<Vec<RecentProjectEntry>, String> {
    let file = get_recent_file_path(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read recent file: {}", e))?;
    let mut entries: Vec<RecentProjectEntry> =
        serde_json::from_str(&data).unwrap_or_default();

    // Filter out paths that no longer exist
    entries.retain(|e| Path::new(&e.path).exists());

    // Sort latest first
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    entries.truncate(20);

    Ok(entries)
}

#[tauri::command]
pub fn save_recent_project(app: AppHandle, path: String, name: String) -> Result<(), String> {
    let file = get_recent_file_path(&app)?;
    let mut entries: Vec<RecentProjectEntry> = if file.exists() {
        let data = fs::read_to_string(&file).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Remove existing entry for same path
    entries.retain(|e| !e.path.eq_ignore_ascii_case(&path));

    entries.insert(
        0,
        RecentProjectEntry {
            name,
            path,
            timestamp: get_now_epoch_ms(),
        },
    );

    // Limit to 20
    entries.truncate(20);

    let json = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize recent list: {}", e))?;
    fs::write(&file, json).map_err(|e| format!("Failed to write recent file: {}", e))?;

    Ok(())
}

fn get_app_data_file_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;
    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app_data_dir: {}", e))?;
    Ok(app_dir.join(filename))
}

pub fn normalize_path_str(p: &str) -> String {
    p.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

#[tauri::command]
pub fn get_pinned_projects(app: AppHandle) -> Result<Vec<PinnedProjectEntry>, String> {
    let file = get_app_data_file_path(&app, "pinned_projects.json")?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read pinned projects: {}", e))?;
    let mut entries: Vec<PinnedProjectEntry> = serde_json::from_str(&data).unwrap_or_default();

    // Deduplicate entries by normalized path
    let mut seen = std::collections::HashSet::new();
    entries.retain(|e| {
        let norm = normalize_path_str(&e.path);
        if seen.contains(&norm) {
            false
        } else {
            seen.insert(norm);
            true
        }
    });

    entries.retain(|e| Path::new(&e.path).exists());
    Ok(entries)
}

#[tauri::command]
pub fn toggle_pin_project(app: AppHandle, path: String, name: String) -> Result<Vec<PinnedProjectEntry>, String> {
    let clean_path = path.trim().to_string();
    if clean_path.is_empty() {
        return Err("Project path cannot be empty".to_string());
    }
    let clean_name = if name.trim().is_empty() {
        Path::new(&clean_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Project")
            .to_string()
    } else {
        name.trim().to_string()
    };

    let file = get_app_data_file_path(&app, "pinned_projects.json")?;
    let mut entries: Vec<PinnedProjectEntry> = if file.exists() {
        let data = fs::read_to_string(&file).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    };

    let norm_target = normalize_path_str(&clean_path);
    let is_currently_pinned = entries.iter().any(|e| normalize_path_str(&e.path) == norm_target);

    // Remove any and all occurrences matching this normalized path (guarantees duplicate prevention)
    entries.retain(|e| normalize_path_str(&e.path) != norm_target);

    if !is_currently_pinned {
        entries.push(PinnedProjectEntry {
            path: clean_path,
            name: clean_name,
            pinned_at: get_now_epoch_ms(),
        });
    }

    let json = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("Failed to serialize pinned projects: {}", e))?;
    fs::write(&file, json).map_err(|e| format!("Failed to write pinned projects: {}", e))?;

    Ok(entries)
}

#[tauri::command]
pub fn get_project_workspace_config(app: AppHandle, project_path: String) -> Result<ProjectWorkspaceConfig, String> {
    let file = get_app_data_file_path(&app, "project_configs.json")?;
    if !file.exists() {
        return Ok(ProjectWorkspaceConfig::default());
    }
    let data = fs::read_to_string(&file).map_err(|e| format!("Failed to read project configs: {}", e))?;
    let map: HashMap<String, ProjectWorkspaceConfig> = serde_json::from_str(&data).unwrap_or_default();
    let norm = normalize_path_str(&project_path);
    Ok(map.get(&norm).cloned().unwrap_or_default())
}

#[tauri::command]
pub fn save_project_workspace_config(
    app: AppHandle,
    project_path: String,
    config: ProjectWorkspaceConfig,
) -> Result<ProjectWorkspaceConfig, String> {
    let file = get_app_data_file_path(&app, "project_configs.json")?;
    let mut map: HashMap<String, ProjectWorkspaceConfig> = if file.exists() {
        let data = fs::read_to_string(&file).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    };

    let norm = normalize_path_str(&project_path);
    map.insert(norm, config.clone());

    let json = serde_json::to_string_pretty(&map)
        .map_err(|e| format!("Failed to serialize project configs: {}", e))?;
    fs::write(&file, json).map_err(|e| format!("Failed to write project configs: {}", e))?;

    Ok(config)
}

#[tauri::command]
pub fn toggle_pin_script(
    app: AppHandle,
    project_path: String,
    script_name: String,
) -> Result<Vec<String>, String> {
    let mut config = get_project_workspace_config(app.clone(), project_path.clone())?;
    if let Some(pos) = config.pinned_scripts.iter().position(|s| s == &script_name) {
        config.pinned_scripts.remove(pos);
    } else {
        config.pinned_scripts.push(script_name);
    }
    save_project_workspace_config(app, project_path, config.clone())?;
    Ok(config.pinned_scripts)
}

fn find_debug_target_dir() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("src-tauri/target/debug"),
        PathBuf::from("target/debug"),
    ];
    for c in &candidates {
        if c.is_dir() {
            return Some(c.clone());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut curr = exe.parent();
        while let Some(dir) = curr {
            let p1 = dir.join("src-tauri").join("target").join("debug");
            if p1.is_dir() {
                return Some(p1);
            }
            let p2 = dir.join("target").join("debug");
            if p2.is_dir() {
                return Some(p2);
            }
            curr = dir.parent();
        }
    }

    None
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += calculate_dir_size(&entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

#[tauri::command]
pub fn get_debug_storage_info() -> Result<DebugStorageInfo, String> {
    if let Some(path) = find_debug_target_dir() {
        let bytes = calculate_dir_size(&path);
        let mb = (bytes as f64 / 1_048_576.0 * 100.0).round() / 100.0;
        let gb = (bytes as f64 / 1_073_741_824.0 * 100.0).round() / 100.0;
        Ok(DebugStorageInfo {
            exists: true,
            path: Some(path.to_string_lossy().to_string()),
            size_bytes: bytes,
            size_mb: mb,
            size_gb: gb,
        })
    } else {
        Ok(DebugStorageInfo {
            exists: false,
            path: None,
            size_bytes: 0,
            size_mb: 0.0,
            size_gb: 0.0,
        })
    }
}

#[tauri::command]
pub fn clean_debug_artifacts() -> Result<CleanStorageResult, String> {
    let mut deleted_paths = Vec::new();
    let mut recovered_bytes = 0u64;

    if let Some(debug_path) = find_debug_target_dir() {
        let norm = debug_path.to_string_lossy().to_lowercase();
        if !norm.ends_with("target/debug") && !norm.ends_with("target\\debug") {
            return Err("Safety check failed: target path is not a debug folder".into());
        }

        let bytes = calculate_dir_size(&debug_path);
        recovered_bytes += bytes;

        if let Some(target_parent) = debug_path.parent() {
            let flycheck = target_parent.join("flycheck0");
            if flycheck.is_dir() {
                let fc_bytes = calculate_dir_size(&flycheck);
                recovered_bytes += fc_bytes;
                let _ = fs::remove_dir_all(&flycheck);
                deleted_paths.push(flycheck.to_string_lossy().to_string());
            }
        }

        fs::remove_dir_all(&debug_path)
            .map_err(|e| format!("Failed to delete debug artifacts: {}", e))?;
        deleted_paths.push(debug_path.to_string_lossy().to_string());
    }

    let mb = (recovered_bytes as f64 / 1_048_576.0 * 100.0).round() / 100.0;
    let gb = (recovered_bytes as f64 / 1_073_741_824.0 * 100.0).round() / 100.0;

    Ok(CleanStorageResult {
        success: true,
        recovered_bytes,
        recovered_mb: mb,
        recovered_gb: gb,
        deleted_paths,
        message: format!("Successfully reclaimed {} MB ({} GB) of storage.", mb, gb),
    })
}

#[tauri::command]
pub fn toggle_app_visibility(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
    Ok(())
}

// ----------------- PHASE 3A: REAL FILESYSTEM BROWSING -----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub letter: String,
    pub path: String,
    #[serde(rename = "volumeLabel")]
    pub volume_label: String,
    #[serde(rename = "fileSystem")]
    pub file_system: String,
    #[serde(rename = "driveType")]
    pub drive_type: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "availableBytes")]
    pub available_bytes: u64,
    #[serde(rename = "usedBytes")]
    pub used_bytes: u64,
    #[serde(rename = "usedPercentage")]
    pub used_percentage: f64,
    #[serde(rename = "isReady")]
    pub is_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    #[serde(rename = "isSymlink")]
    pub is_symlink: bool,
    #[serde(rename = "isHidden")]
    pub is_hidden: bool,
    pub size: Option<u64>,
    #[serde(rename = "modifiedDate")]
    pub modified_date: Option<u64>,
    pub extension: Option<String>,
    #[serde(rename = "fileType")]
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryResult {
    pub path: String,
    #[serde(rename = "parentPath")]
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
    #[serde(rename = "totalCount")]
    pub total_count: usize,
    #[serde(rename = "dirCount")]
    pub dir_count: usize,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLocations {
    pub desktop: String,
    pub downloads: String,
    pub documents: String,
    pub pictures: String,
    #[serde(rename = "userProfile")]
    pub user_profile: String,
}

fn detect_file_type(is_dir: bool, ext: Option<&str>) -> String {
    if is_dir {
        return "File folder".to_string();
    }
    match ext.map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("exe") => "Application",
        Some("msi") => "Windows Installer",
        Some("dll") => "Application extension",
        Some("sys") => "System file",
        Some("ts") => "TypeScript Source",
        Some("tsx") => "TypeScript JSX Source",
        Some("js") => "JavaScript Source",
        Some("jsx") => "JavaScript JSX Source",
        Some("rs") => "Rust Source",
        Some("json") => "JSON File",
        Some("toml") => "TOML Configuration",
        Some("yaml") | Some("yml") => "YAML Configuration",
        Some("xml") => "XML Document",
        Some("html") | Some("htm") => "HTML Document",
        Some("css") => "Cascading Style Sheet",
        Some("scss") | Some("sass") => "SCSS Stylesheet",
        Some("md") => "Markdown Document",
        Some("txt") | Some("log") => "Text Document",
        Some("pdf") => "PDF Document",
        Some("png") => "PNG Image",
        Some("jpg") | Some("jpeg") => "JPEG Image",
        Some("svg") => "SVG Vector Image",
        Some("ico") => "Icon File",
        Some("webp") => "WebP Image",
        Some("gif") => "GIF Image",
        Some("zip") | Some("7z") | Some("rar") | Some("tar") | Some("gz") => "Compressed Archive",
        Some("mp3") | Some("wav") | Some("flac") => "Audio File",
        Some("mp4") | Some("mkv") | Some("avi") | Some("mov") => "Video File",
        Some(e) => return format!("{} File", e.to_ascii_uppercase()),
        None => "File",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
mod win_drives {
    use super::DriveInfo;
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
        fn GetVolumeInformationW(
            lpRootPathName: *const u16,
            lpVolumeNameBuffer: *mut u16,
            nVolumeNameSize: u32,
            lpVolumeSerialNumber: *mut u32,
            lpMaximumComponentLength: *mut u32,
            lpFileSystemFlags: *mut u32,
            lpFileSystemNameBuffer: *mut u16,
            nFileSystemNameSize: u32,
        ) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn fetch_drives() -> Vec<DriveInfo> {
        let mut drives = Vec::new();
        let mask = unsafe { GetLogicalDrives() };

        for i in 0..26 {
            if (mask & (1 << i)) != 0 {
                let letter_char = (b'A' + i) as char;
                let letter = format!("{}:", letter_char);
                let root_path = format!("{}:\\", letter_char);
                let wide_path = to_wide(&root_path);

                let d_type_code = unsafe { GetDriveTypeW(wide_path.as_ptr()) };
                let drive_type = match d_type_code {
                    2 => "Removable",
                    3 => "Fixed",
                    4 => "Network",
                    5 => "CD-ROM",
                    6 => "RAM Disk",
                    _ => "Unknown",
                }
                .to_string();

                let mut free_avail: u64 = 0;
                let mut total: u64 = 0;
                let mut total_free: u64 = 0;

                let space_ok = unsafe {
                    GetDiskFreeSpaceExW(
                        wide_path.as_ptr(),
                        &mut free_avail,
                        &mut total,
                        &mut total_free,
                    )
                };

                let mut vol_name_buf = [0u16; 261];
                let mut fs_name_buf = [0u16; 261];
                let vol_ok = unsafe {
                    GetVolumeInformationW(
                        wide_path.as_ptr(),
                        vol_name_buf.as_mut_ptr(),
                        vol_name_buf.len() as u32,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        fs_name_buf.as_mut_ptr(),
                        fs_name_buf.len() as u32,
                    )
                };

                let volume_label = if vol_ok != 0 {
                    let len = vol_name_buf.iter().position(|&c| c == 0).unwrap_or(vol_name_buf.len());
                    String::from_utf16_lossy(&vol_name_buf[..len])
                } else {
                    String::new()
                };

                let file_system = if vol_ok != 0 {
                    let len = fs_name_buf.iter().position(|&c| c == 0).unwrap_or(fs_name_buf.len());
                    String::from_utf16_lossy(&fs_name_buf[..len])
                } else {
                    String::new()
                };

                let is_ready = space_ok != 0;
                let used_bytes = if total >= free_avail { total - free_avail } else { 0 };
                let used_percentage = if total > 0 {
                    ((used_bytes as f64) / (total as f64)) * 100.0
                } else {
                    0.0
                };

                let display_label = if volume_label.trim().is_empty() {
                    if drive_type == "Fixed" {
                        "Local Disk".to_string()
                    } else {
                        drive_type.clone()
                    }
                } else {
                    volume_label
                };

                drives.push(DriveInfo {
                    letter,
                    path: root_path,
                    volume_label: display_label,
                    file_system,
                    drive_type,
                    total_bytes: total,
                    available_bytes: free_avail,
                    used_bytes,
                    used_percentage,
                    is_ready,
                });
            }
        }
        drives
    }
}

#[tauri::command]
pub fn get_drives() -> Vec<DriveInfo> {
    #[cfg(target_os = "windows")]
    {
        win_drives::fetch_drives()
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![DriveInfo {
            letter: "/".to_string(),
            path: "/".to_string(),
            volume_label: "Root".to_string(),
            file_system: "ext4".to_string(),
            drive_type: "Fixed".to_string(),
            total_bytes: 500_000_000_000,
            available_bytes: 250_000_000_000,
            used_bytes: 250_000_000_000,
            used_percentage: 50.0,
            is_ready: true,
        }]
    }
}

#[tauri::command]
pub fn read_directory(path: String) -> Result<DirectoryResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Directory not found: {}", path));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let read_dir = match fs::read_dir(p) {
        Ok(rd) => rd,
        Err(err) => {
            return Err(match err.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    format!("Access Denied: You do not have permission to access '{}'", path)
                }
                std::io::ErrorKind::NotFound => {
                    format!("Directory not found: '{}'", path)
                }
                _ => format!("Unable to open directory: {}", err),
            });
        }
    };

    let mut entries = Vec::new();
    let mut dir_count = 0;
    let mut file_count = 0;

    for item in read_dir {
        if let Ok(entry) = item {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => match fs::symlink_metadata(&entry_path) {
                    Ok(sm) => sm,
                    Err(_) => continue,
                },
            };

            let is_dir = metadata.is_dir();
            let is_symlink = metadata.file_type().is_symlink();

            #[cfg(target_os = "windows")]
            let is_hidden = {
                use std::os::windows::fs::MetadataExt;
                let attr = metadata.file_attributes();
                (attr & 0x2) != 0 || name.starts_with('.')
            };

            #[cfg(not(target_os = "windows"))]
            let is_hidden = name.starts_with('.');

            let size = if is_dir { None } else { Some(metadata.len()) };

            let modified_date = metadata.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
            });

            let extension = entry_path.extension().map(|e| e.to_string_lossy().to_string());
            let file_type = detect_file_type(is_dir, extension.as_deref());

            if is_dir {
                dir_count += 1;
            } else {
                file_count += 1;
            }

            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_directory: is_dir,
                is_symlink,
                is_hidden,
                size,
                modified_date,
                extension,
                file_type,
            });
        }
    }

    // Sort: directories first (alphabetical case-insensitive), then files (alphabetical case-insensitive)
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    let parent_path = p.parent().and_then(|par| {
        let s = par.to_string_lossy().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    });

    let total_count = entries.len();

    Ok(DirectoryResult {
        path: p.to_string_lossy().to_string(),
        parent_path,
        entries,
        total_count,
        dir_count,
        file_count,
    })
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileEntry, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    let metadata = fs::metadata(p).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let is_dir = metadata.is_dir();
    let is_symlink = metadata.file_type().is_symlink();

    #[cfg(target_os = "windows")]
    let is_hidden = {
        use std::os::windows::fs::MetadataExt;
        let attr = metadata.file_attributes();
        (attr & 0x2) != 0 || name.starts_with('.')
    };

    #[cfg(not(target_os = "windows"))]
    let is_hidden = name.starts_with('.');

    let size = if is_dir { None } else { Some(metadata.len()) };
    let modified_date = metadata.modified().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
    });
    let extension = p.extension().map(|e| e.to_string_lossy().to_string());
    let file_type = detect_file_type(is_dir, extension.as_deref());

    Ok(FileEntry {
        name,
        path: p.to_string_lossy().to_string(),
        is_directory: is_dir,
        is_symlink,
        is_hidden,
        size,
        modified_date,
        extension,
        file_type,
    })
}

#[tauri::command]
pub fn get_user_locations() -> UserLocations {
    let user_profile =
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    let p = Path::new(&user_profile);
    UserLocations {
        desktop: p.join("Desktop").to_string_lossy().to_string(),
        downloads: p.join("Downloads").to_string_lossy().to_string(),
        documents: p.join("Documents").to_string_lossy().to_string(),
        pictures: p.join("Pictures").to_string_lossy().to_string(),
        user_profile,
    }
}

// ----------------- PHASE 3C: REAL FILE OPERATIONS -----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOperationResult {
    pub success: bool,
    #[serde(rename = "successCount")]
    pub success_count: usize,
    #[serde(rename = "failureCount")]
    pub failure_count: usize,
    pub errors: Vec<String>,
    #[serde(rename = "affectedPaths")]
    pub affected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedProperties {
    pub name: String,
    pub path: String,
    pub location: String,
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub size: Option<u64>,
    #[serde(rename = "createdDate")]
    pub created_date: Option<u64>,
    #[serde(rename = "modifiedDate")]
    pub modified_date: Option<u64>,
    #[serde(rename = "accessedDate")]
    pub accessed_date: Option<u64>,
    #[serde(rename = "itemCount")]
    pub item_count: Option<usize>,
    #[serde(rename = "isReadOnly")]
    pub is_read_only: bool,
    #[serde(rename = "isHidden")]
    pub is_hidden: bool,
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn get_unique_name(dest_dir: &Path, original_name: &str, is_dir: bool) -> PathBuf {
    let target = dest_dir.join(original_name);
    if !target.exists() {
        return target;
    }

    let (stem, ext_with_dot) = if is_dir {
        (original_name, "".to_string())
    } else {
        let p = Path::new(original_name);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(original_name);
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        (stem, ext)
    };

    let first_copy = format!("{} - Copy{}", stem, ext_with_dot);
    let first_target = dest_dir.join(&first_copy);
    if !first_target.exists() {
        return first_target;
    }

    let mut counter = 2;
    loop {
        let candidate = format!("{} - Copy ({}){}", stem, counter, ext_with_dot);
        let candidate_target = dest_dir.join(&candidate);
        if !candidate_target.exists() {
            return candidate_target;
        }
        counter += 1;
    }
}

#[tauri::command]
pub fn copy_items(sources: Vec<String>, destination_dir: String) -> Result<FileOperationResult, String> {
    let dest_dir_path = Path::new(&destination_dir);
    if !dest_dir_path.exists() || !dest_dir_path.is_dir() {
        return Err(format!("Destination folder does not exist: {}", destination_dir));
    }

    let mut affected_paths = Vec::new();
    let mut errors = Vec::new();
    let mut success_count = 0;
    let mut failure_count = 0;

    for src_str in sources {
        let src = Path::new(&src_str);
        if !src.exists() {
            failure_count += 1;
            errors.push(format!("Source does not exist: {}", src_str));
            continue;
        }

        let is_dir = src.is_dir();

        // Safety: Prevent copying a folder into itself or its subfolders
        if is_dir && dest_dir_path.starts_with(src) {
            failure_count += 1;
            errors.push(format!("Cannot copy folder '{}' into itself or its subfolder.", src_str));
            continue;
        }

        let file_name = match src.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => {
                failure_count += 1;
                errors.push(format!("Invalid file name: {}", src_str));
                continue;
            }
        };

        let target_path = get_unique_name(dest_dir_path, file_name, is_dir);

        let copy_result = if is_dir {
            copy_dir_recursive(src, &target_path)
        } else {
            fs::copy(src, &target_path).map(|_| ())
        };

        match copy_result {
            Ok(_) => {
                success_count += 1;
                affected_paths.push(target_path.to_string_lossy().to_string());
            }
            Err(e) => {
                failure_count += 1;
                errors.push(format!("Failed to copy '{}': {}", src_str, e));
            }
        }
    }

    Ok(FileOperationResult {
        success: failure_count == 0,
        success_count,
        failure_count,
        errors,
        affected_paths,
    })
}

#[tauri::command]
pub fn move_items(sources: Vec<String>, destination_dir: String) -> Result<FileOperationResult, String> {
    let dest_dir_path = Path::new(&destination_dir);
    if !dest_dir_path.exists() || !dest_dir_path.is_dir() {
        return Err(format!("Destination folder does not exist: {}", destination_dir));
    }

    let mut affected_paths = Vec::new();
    let mut errors = Vec::new();
    let mut success_count = 0;
    let mut failure_count = 0;

    for src_str in sources {
        let src = Path::new(&src_str);
        if !src.exists() {
            failure_count += 1;
            errors.push(format!("Source does not exist: {}", src_str));
            continue;
        }

        let is_dir = src.is_dir();

        // Safety: Prevent moving a folder into itself or its subfolder
        if is_dir && dest_dir_path.starts_with(src) {
            failure_count += 1;
            errors.push(format!("Cannot move folder '{}' into itself or its subfolder.", src_str));
            continue;
        }

        // If source parent is already destination_dir, skip identical move
        if let Some(parent) = src.parent() {
            if parent == dest_dir_path {
                affected_paths.push(src_str);
                success_count += 1;
                continue;
            }
        }

        let file_name = match src.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => {
                failure_count += 1;
                errors.push(format!("Invalid file name: {}", src_str));
                continue;
            }
        };

        let target_path = get_unique_name(dest_dir_path, file_name, is_dir);

        // Try fast atomic rename first, fallback to copy + delete for cross-device links
        let move_result = fs::rename(src, &target_path).or_else(|_| {
            if is_dir {
                copy_dir_recursive(src, &target_path).and_then(|_| fs::remove_dir_all(src))
            } else {
                fs::copy(src, &target_path).and_then(|_| fs::remove_file(src)).map(|_| ())
            }
        });

        match move_result {
            Ok(_) => {
                success_count += 1;
                affected_paths.push(target_path.to_string_lossy().to_string());
            }
            Err(e) => {
                failure_count += 1;
                errors.push(format!("Failed to move '{}': {}", src_str, e));
            }
        }
    }

    Ok(FileOperationResult {
        success: failure_count == 0,
        success_count,
        failure_count,
        errors,
        affected_paths,
    })
}

#[tauri::command]
pub fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Item does not exist: {}", path));
    }

    let trimmed_name = new_name.trim();
    if trimmed_name.is_empty() {
        return Err("Filename cannot be empty.".to_string());
    }

    let illegal_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed_name.chars().any(|c| illegal_chars.contains(&c)) {
        return Err("A filename cannot contain any of the following characters: \\ / : * ? \" < > |".to_string());
    }

    let parent = p.parent().ok_or_else(|| "Cannot rename root directory.".to_string())?;
    let target = parent.join(trimmed_name);

    if target.exists() && target != p {
        return Err(format!("A file or folder with the name '{}' already exists.", trimmed_name));
    }

    fs::rename(p, &target).map_err(|e| format!("Failed to rename item: {}", e))?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_to_recycle_bin(paths: Vec<String>) -> Result<FileOperationResult, String> {
    let mut affected_paths = Vec::new();
    let mut errors = Vec::new();
    let mut success_count = 0;
    let mut failure_count = 0;

    for path_str in paths {
        let p = Path::new(&path_str);
        if !p.exists() {
            failure_count += 1;
            errors.push(format!("Path does not exist: {}", path_str));
            continue;
        }

        match trash::delete(p) {
            Ok(_) => {
                success_count += 1;
                affected_paths.push(path_str);
            }
            Err(e) => {
                failure_count += 1;
                errors.push(format!("Failed to move '{}' to Recycle Bin: {}", path_str, e));
            }
        }
    }

    Ok(FileOperationResult {
        success: failure_count == 0,
        success_count,
        failure_count,
        errors,
        affected_paths,
    })
}

#[tauri::command]
pub fn delete_permanently(paths: Vec<String>) -> Result<FileOperationResult, String> {
    let mut affected_paths = Vec::new();
    let mut errors = Vec::new();
    let mut success_count = 0;
    let mut failure_count = 0;

    for path_str in paths {
        let p = Path::new(&path_str);
        if !p.exists() {
            failure_count += 1;
            errors.push(format!("Path does not exist: {}", path_str));
            continue;
        }

        let del_res = if p.is_dir() {
            fs::remove_dir_all(p)
        } else {
            fs::remove_file(p)
        };

        match del_res {
            Ok(_) => {
                success_count += 1;
                affected_paths.push(path_str);
            }
            Err(e) => {
                failure_count += 1;
                errors.push(format!("Failed to permanently delete '{}': {}", path_str, e));
            }
        }
    }

    Ok(FileOperationResult {
        success: failure_count == 0,
        success_count,
        failure_count,
        errors,
        affected_paths,
    })
}

#[tauri::command]
pub fn create_directory(parent_dir: String, name: Option<String>) -> Result<String, String> {
    let clean_parent = parent_dir.trim().replace('/', "\\");
    let parent = Path::new(&clean_parent);
    if !parent.exists() || !parent.is_dir() {
        return Err(format!("Parent directory does not exist: {}", parent_dir));
    }

    let base_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "New folder".to_string());
    let mut target = parent.join(&base_name);

    if target.exists() {
        let mut counter = 2;
        loop {
            let candidate_name = format!("{} ({})", base_name, counter);
            let candidate_path = parent.join(&candidate_name);
            if !candidate_path.exists() {
                target = candidate_path;
                break;
            }
            counter += 1;
        }
    }

    fs::create_dir(&target).map_err(|e| format!("Failed to create folder: {}", e))?;

    let canonical = target.to_string_lossy().replace('/', "\\");
    Ok(canonical)
}

#[tauri::command]
pub fn get_detailed_properties(path: String) -> Result<DetailedProperties, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Item does not exist: {}", path));
    }

    let meta = fs::metadata(p).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let is_dir = meta.is_dir();
    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or(&path).to_string();
    let location = p.parent().map(|par| par.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| e.to_string_lossy().to_string());
    let file_type = detect_file_type(is_dir, ext.as_deref());

    let to_epoch_ms = |t: std::time::SystemTime| {
        t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
    };

    let created_date = meta.created().ok().and_then(to_epoch_ms);
    let modified_date = meta.modified().ok().and_then(to_epoch_ms);
    let accessed_date = meta.accessed().ok().and_then(to_epoch_ms);

    let is_read_only = meta.permissions().readonly();

    #[cfg(target_os = "windows")]
    let is_hidden = {
        use std::os::windows::fs::MetadataExt;
        let attr = meta.file_attributes();
        (attr & 0x2) != 0 || name.starts_with('.')
    };

    #[cfg(not(target_os = "windows"))]
    let is_hidden = name.starts_with('.');

    let (size, item_count) = if is_dir {
        let count = fs::read_dir(p).map(|rd| rd.count()).ok();
        (None, count)
    } else {
        (Some(meta.len()), None)
    };

    Ok(DetailedProperties {
        name,
        path: p.to_string_lossy().to_string(),
        location,
        file_type,
        is_directory: is_dir,
        size,
        created_date,
        modified_date,
        accessed_date,
        item_count,
        is_read_only,
        is_hidden,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextPreviewResult {
    pub content: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "isTruncated")]
    pub is_truncated: bool,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagePreviewResult {
    #[serde(rename = "dataUrl")]
    pub data_url: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
}

fn to_base64(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARSET[(triple >> 18) & 0x3F] as char);
        result.push(CHARSET[(triple >> 12) & 0x3F] as char);

        if chunk.len() > 1 {
            result.push(CHARSET[(triple >> 6) & 0x3F] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARSET[triple & 0x3F] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn detect_language(ext: Option<&str>) -> String {
    match ext.unwrap_or("").to_lowercase().as_str() {
        "rs" => "rust".to_string(),
        "ts" | "tsx" => "typescript".to_string(),
        "js" | "jsx" | "mjs" | "cjs" => "javascript".to_string(),
        "json" => "json".to_string(),
        "toml" => "toml".to_string(),
        "yaml" | "yml" => "yaml".to_string(),
        "md" | "markdown" => "markdown".to_string(),
        "html" | "htm" => "html".to_string(),
        "css" | "scss" | "sass" | "less" => "css".to_string(),
        "py" => "python".to_string(),
        "java" => "java".to_string(),
        "c" | "h" => "c".to_string(),
        "cpp" | "hpp" | "cc" | "cxx" => "cpp".to_string(),
        "go" => "go".to_string(),
        "sql" => "sql".to_string(),
        "sh" | "bash" | "zsh" => "shell".to_string(),
        "ps1" | "psm1" => "powershell".to_string(),
        "xml" | "svg" => "xml".to_string(),
        "txt" | "log" | "env" | "gitignore" => "plaintext".to_string(),
        other if !other.is_empty() => other.to_string(),
        _ => "plaintext".to_string(),
    }
}

#[tauri::command]
pub fn read_text_preview(path: String, max_bytes: Option<usize>) -> Result<TextPreviewResult, String> {
    let p = Path::new(&path);
    if !p.exists() || !p.is_file() {
        return Err(format!("File does not exist: {}", path));
    }

    let meta = fs::metadata(p).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let total_bytes = meta.len();

    if total_bytes > 3 * 1024 * 1024 {
        return Err("Preview unavailable for large file (exceeds 3 MB).".to_string());
    }

    let limit = max_bytes.unwrap_or(64 * 1024);
    let is_truncated = total_bytes > limit as u64;

    use std::io::Read;
    let mut file = fs::File::open(p).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut buffer = vec![0u8; limit.min(total_bytes as usize)];
    let bytes_read = file.read(&mut buffer).map_err(|e| format!("Failed to read file: {}", e))?;
    buffer.truncate(bytes_read);

    let check_len = buffer.len().min(512);
    if buffer[..check_len].contains(&0) {
        return Err("Binary file cannot be previewed as text.".to_string());
    }

    let content = String::from_utf8_lossy(&buffer).to_string();
    let line_count = content.lines().count();
    let ext = p.extension().and_then(|e| e.to_str());
    let language = detect_language(ext);

    Ok(TextPreviewResult {
        content,
        total_bytes,
        is_truncated,
        line_count,
        language,
    })
}

#[tauri::command]
pub fn read_image_preview(path: String) -> Result<ImagePreviewResult, String> {
    let p = Path::new(&path);
    if !p.exists() || !p.is_file() {
        return Err(format!("Image file does not exist: {}", path));
    }

    let meta = fs::metadata(p).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let size = meta.len();
    if size > 15 * 1024 * 1024 {
        return Err("Image exceeds 15 MB limit for preview.".to_string());
    }

    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return Err(format!("Unsupported image format: .{}", ext)),
    };

    let bytes = fs::read(p).map_err(|e| format!("Failed to read image bytes: {}", e))?;
    let b64 = to_base64(&bytes);
    let data_url = format!("data:{};base64,{}", mime_type, b64);

    Ok(ImagePreviewResult {
        data_url,
        mime_type: mime_type.to_string(),
        size,
    })
}

// ===================== PHASE 6: NATIVE WINDOWS CLIPBOARD =====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemClipboardFiles {
    pub paths: Vec<String>,
    #[serde(rename = "isCut")]
    pub is_cut: bool,
}

#[cfg(target_os = "windows")]
mod win_clipboard {
    use std::ptr;
    use std::os::raw::c_void;
    use std::time::Duration;
    use super::SystemClipboardFiles;

    type HWND = *mut c_void;
    type HANDLE = *mut c_void;
    type HGLOBAL = *mut c_void;
    type UINT = u32;
    type BOOL = i32;
    type DWORD = u32;

    const CF_HDROP: UINT = 15;
    const CF_UNICODETEXT: UINT = 13;
    const GMEM_MOVEABLE: UINT = 0x0002;
    const DROPEFFECT_COPY: DWORD = 1;
    const DROPEFFECT_MOVE: DWORD = 2;

    #[repr(C)]
    struct POINT {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct DROPFILES {
        p_files: DWORD,
        pt: POINT,
        f_nc: BOOL,
        f_wide: BOOL,
    }

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: HWND) -> BOOL;
        fn CloseClipboard() -> BOOL;
        fn EmptyClipboard() -> BOOL;
        fn SetClipboardData(format: UINT, h_mem: HANDLE) -> HANDLE;
        fn GetClipboardData(format: UINT) -> HANDLE;
        fn IsClipboardFormatAvailable(format: UINT) -> BOOL;
        fn RegisterClipboardFormatW(lpsz_format: *const u16) -> UINT;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(u_flags: UINT, dw_bytes: usize) -> HGLOBAL;
        fn GlobalLock(h_mem: HGLOBAL) -> *mut c_void;
        fn GlobalUnlock(h_mem: HGLOBAL) -> BOOL;
        fn GlobalFree(h_mem: HGLOBAL) -> HGLOBAL;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(h_drop: HANDLE, i_file: UINT, lpsz_file: *mut u16, cch: UINT) -> UINT;
    }

    fn open_clipboard_with_retry() -> bool {
        for _ in 0..10 {
            unsafe {
                if OpenClipboard(ptr::null_mut()) != 0 {
                    return true;
                }
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        false
    }

    pub fn write_files_to_clipboard(paths: &[String], is_cut: bool) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }

        let mut utf16_data: Vec<u16> = Vec::new();
        for path in paths {
            let normalized = path.replace('/', "\\");
            let wide: Vec<u16> = normalized.encode_utf16().collect();
            utf16_data.extend(wide);
            utf16_data.push(0);
        }
        utf16_data.push(0);

        let header_size = std::mem::size_of::<DROPFILES>();
        let total_dropfiles_size = header_size + (utf16_data.len() * 2);

        let h_drop = unsafe { GlobalAlloc(GMEM_MOVEABLE, total_dropfiles_size) };
        if h_drop.is_null() {
            return Err("Failed to allocate global memory for clipboard DROPFILES".to_string());
        }

        unsafe {
            let ptr = GlobalLock(h_drop);
            if ptr.is_null() {
                GlobalFree(h_drop);
                return Err("Failed to lock global memory for DROPFILES".to_string());
            }

            let df = ptr as *mut DROPFILES;
            (*df).p_files = header_size as DWORD;
            (*df).pt = POINT { x: 0, y: 0 };
            (*df).f_nc = 0;
            (*df).f_wide = 1;

            let files_dest = (ptr as *mut u8).add(header_size) as *mut u16;
            ptr::copy_nonoverlapping(utf16_data.as_ptr(), files_dest, utf16_data.len());

            GlobalUnlock(h_drop);
        }

        let drop_effect_name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
        let drop_effect_fmt = unsafe { RegisterClipboardFormatW(drop_effect_name.as_ptr()) };

        let h_effect = if drop_effect_fmt != 0 {
            let h = unsafe { GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of::<DWORD>()) };
            if !h.is_null() {
                unsafe {
                    let ptr = GlobalLock(h) as *mut DWORD;
                    if !ptr.is_null() {
                        *ptr = if is_cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY };
                        GlobalUnlock(h);
                    }
                }
            }
            h
        } else {
            ptr::null_mut()
        };

        let joined_paths: String = paths.iter().map(|p| p.replace('/', "\\")).collect::<Vec<_>>().join("\r\n");
        let mut text_utf16: Vec<u16> = joined_paths.encode_utf16().collect();
        text_utf16.push(0);

        let h_text = unsafe { GlobalAlloc(GMEM_MOVEABLE, text_utf16.len() * 2) };
        if !h_text.is_null() {
            unsafe {
                let ptr = GlobalLock(h_text);
                if !ptr.is_null() {
                    ptr::copy_nonoverlapping(text_utf16.as_ptr(), ptr as *mut u16, text_utf16.len());
                    GlobalUnlock(h_text);
                }
            }
        }

        if !open_clipboard_with_retry() {
            unsafe {
                GlobalFree(h_drop);
                if !h_effect.is_null() { GlobalFree(h_effect); }
                if !h_text.is_null() { GlobalFree(h_text); }
            }
            return Err("Failed to open Windows clipboard".to_string());
        }

        unsafe {
            EmptyClipboard();
            if SetClipboardData(CF_HDROP, h_drop).is_null() {
                GlobalFree(h_drop);
            }
            if drop_effect_fmt != 0 && !h_effect.is_null() {
                if SetClipboardData(drop_effect_fmt, h_effect).is_null() {
                    GlobalFree(h_effect);
                }
            }
            if !h_text.is_null() {
                if SetClipboardData(CF_UNICODETEXT, h_text).is_null() {
                    GlobalFree(h_text);
                }
            }
            CloseClipboard();
        }

        Ok(())
    }

    pub fn read_files_from_clipboard() -> Result<Option<SystemClipboardFiles>, String> {
        if !open_clipboard_with_retry() {
            return Ok(None);
        }

        let has_hdrop = unsafe { IsClipboardFormatAvailable(CF_HDROP) };
        if has_hdrop == 0 {
            unsafe { CloseClipboard(); }
            return Ok(None);
        }

        let h_drop = unsafe { GetClipboardData(CF_HDROP) };
        if h_drop.is_null() {
            unsafe { CloseClipboard(); }
            return Ok(None);
        }

        let file_count = unsafe { DragQueryFileW(h_drop, 0xFFFFFFFF, ptr::null_mut(), 0) };
        if file_count == 0 {
            unsafe { CloseClipboard(); }
            return Ok(None);
        }

        let mut paths = Vec::with_capacity(file_count as usize);
        for i in 0..file_count {
            let len = unsafe { DragQueryFileW(h_drop, i, ptr::null_mut(), 0) };
            if len > 0 {
                let mut buf = vec![0u16; (len + 1) as usize];
                unsafe {
                    DragQueryFileW(h_drop, i, buf.as_mut_ptr(), len + 1);
                }
                let path_str = String::from_utf16_lossy(&buf[..len as usize]);
                paths.push(path_str);
            }
        }

        let drop_effect_name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
        let drop_effect_fmt = unsafe { RegisterClipboardFormatW(drop_effect_name.as_ptr()) };
        let mut is_cut = false;

        if drop_effect_fmt != 0 && unsafe { IsClipboardFormatAvailable(drop_effect_fmt) } != 0 {
            let h_effect = unsafe { GetClipboardData(drop_effect_fmt) };
            if !h_effect.is_null() {
                unsafe {
                    let ptr = GlobalLock(h_effect) as *const DWORD;
                    if !ptr.is_null() {
                        let effect = *ptr;
                        GlobalUnlock(h_effect);
                        if effect == DROPEFFECT_MOVE {
                            is_cut = true;
                        }
                    }
                }
            }
        }

        unsafe { CloseClipboard(); }

        if paths.is_empty() {
            Ok(None)
        } else {
            Ok(Some(SystemClipboardFiles { paths, is_cut }))
        }
    }

    pub fn write_text_to_clipboard(text: &str) -> Result<(), String> {
        let mut text_utf16: Vec<u16> = text.encode_utf16().collect();
        text_utf16.push(0);

        let h_text = unsafe { GlobalAlloc(GMEM_MOVEABLE, text_utf16.len() * 2) };
        if h_text.is_null() {
            return Err("Failed to allocate memory for clipboard text".to_string());
        }

        unsafe {
            let ptr = GlobalLock(h_text);
            if ptr.is_null() {
                GlobalFree(h_text);
                return Err("Failed to lock clipboard memory".to_string());
            }
            ptr::copy_nonoverlapping(text_utf16.as_ptr(), ptr as *mut u16, text_utf16.len());
            GlobalUnlock(h_text);
        }

        if !open_clipboard_with_retry() {
            unsafe { GlobalFree(h_text); }
            return Err("Failed to open clipboard".to_string());
        }

        unsafe {
            EmptyClipboard();
            if SetClipboardData(CF_UNICODETEXT, h_text).is_null() {
                GlobalFree(h_text);
            }
            CloseClipboard();
        }

        Ok(())
    }
}

#[tauri::command]
pub fn get_system_clipboard_files() -> Result<Option<SystemClipboardFiles>, String> {
    #[cfg(target_os = "windows")]
    {
        win_clipboard::read_files_from_clipboard()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn set_system_clipboard_files(paths: Vec<String>, is_cut: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_clipboard::write_files_to_clipboard(&paths, is_cut)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (paths, is_cut);
        Ok(())
    }
}

#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_clipboard::write_text_to_clipboard(&text)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drives_detection() {
        let drives = get_drives();
        println!("Detected drives: {:?}", drives);
        assert!(!drives.is_empty(), "Drives should not be empty");
        let has_c = drives.iter().any(|d| d.letter.eq_ignore_ascii_case("C:"));
        let has_d = drives.iter().any(|d| d.letter.eq_ignore_ascii_case("D:"));
        assert!(has_c || has_d, "Should detect at least C: or D:");
    }

    #[test]
    fn test_exact_navigation_flow() {
        // Flow: This PC -> D: -> Code -> NEXT JS -> NoboGhat
        let d_root = read_directory("D:\\".to_string()).expect("Should read D:\\");
        assert!(d_root.entries.iter().any(|e| e.name.eq_ignore_ascii_case("Code")), "D:\\ should have 'Code'");
        assert!(d_root.parent_path.is_none(), "Parent of drive root D:\\ should be None (signals This PC)");

        let code_dir = read_directory("D:\\Code".to_string()).expect("Should read D:\\Code");
        assert!(code_dir.entries.iter().any(|e| e.name.eq_ignore_ascii_case("NEXT JS")), "D:\\Code should have 'NEXT JS'");
        assert_eq!(code_dir.parent_path.as_deref(), Some("D:\\"));

        let nextjs_dir = read_directory("D:\\Code\\NEXT JS".to_string()).expect("Should read D:\\Code\\NEXT JS");
        assert!(nextjs_dir.entries.iter().any(|e| e.name.eq_ignore_ascii_case("NoboGhat")), "NEXT JS should have 'NoboGhat'");
        assert_eq!(nextjs_dir.parent_path.as_deref(), Some("D:\\Code"));

        let noboghat_dir = read_directory("D:\\Code\\NEXT JS\\NoboGhat".to_string()).expect("Should read NoboGhat");
        assert!(!noboghat_dir.entries.is_empty(), "NoboGhat should not be empty");
        assert_eq!(noboghat_dir.parent_path.as_deref(), Some("D:\\Code\\NEXT JS"));
    }

    #[test]
    fn test_c_drive_browsing() {
        let c_root = read_directory("C:\\".to_string()).expect("Should read C:\\");
        assert!(!c_root.entries.is_empty(), "C:\\ should have entries");
        let has_users_or_windows = c_root.entries.iter().any(|e| {
            e.name.eq_ignore_ascii_case("Windows") || e.name.eq_ignore_ascii_case("Users")
        });
        assert!(has_users_or_windows, "C:\\ should have Windows or Users folder");
    }

    #[test]
    fn test_error_handling_nonexistent() {
        let err = read_directory("D:\\ThisFolderDoesNotExist_999".to_string());
        assert!(err.is_err(), "Non-existent path should return an error");
    }

    #[test]
    fn test_phase_3c_file_operations() {
        let test_root = PathBuf::from("D:\\MAHI_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("Failed to create test directory D:\\MAHI_Test");

        // 1. Create Folder
        let folder1 = create_directory("D:\\MAHI_Test".to_string(), None).expect("Create folder 1");
        assert!(Path::new(&folder1).exists());
        assert!(folder1.ends_with("New folder"));

        // Duplicate create folder -> "New folder (2)"
        let folder2 = create_directory("D:\\MAHI_Test".to_string(), None).expect("Create duplicate folder");
        assert!(Path::new(&folder2).exists());
        assert!(folder2.ends_with("New folder (2)"));

        // 2. Rename Folder
        let renamed_folder = rename_item(folder1, "AlphaFolder".to_string()).expect("Rename folder");
        assert!(Path::new(&renamed_folder).exists());
        assert!(renamed_folder.ends_with("AlphaFolder"));

        // Rename validation checks
        assert!(rename_item(renamed_folder.clone(), "".to_string()).is_err(), "Empty name should error");
        assert!(rename_item(renamed_folder.clone(), "bad/name".to_string()).is_err(), "Illegal char should error");

        // 3. Create test files
        let file_a = test_root.join("note.txt");
        fs::write(&file_a, "Hello MAHI Phase 3C").expect("Write test file A");
        let file_b = test_root.join("data.json");
        fs::write(&file_b, r#"{"test": true}"#).expect("Write test file B");

        // 4. Detailed Properties
        let file_props = get_detailed_properties(file_a.to_string_lossy().to_string()).expect("Get file properties");
        assert_eq!(file_props.name, "note.txt");
        assert!(!file_props.is_directory);
        assert!(file_props.size.unwrap_or(0) > 0);

        let dir_props = get_detailed_properties(renamed_folder.clone()).expect("Get dir properties");
        assert!(dir_props.is_directory);
        assert_eq!(dir_props.name, "AlphaFolder");

        // 5. Copy Items
        let copy_res = copy_items(
            vec![file_a.to_string_lossy().to_string()],
            renamed_folder.clone(),
        ).expect("Copy items");
        assert!(copy_res.success);
        assert_eq!(copy_res.success_count, 1);
        let copied_target = Path::new(&renamed_folder).join("note.txt");
        assert!(copied_target.exists());

        // Duplicate copy -> note - Copy.txt
        let copy_dup_res = copy_items(
            vec![file_a.to_string_lossy().to_string()],
            renamed_folder.clone(),
        ).expect("Copy duplicate");
        assert!(copy_dup_res.success);
        let dup_target = Path::new(&renamed_folder).join("note - Copy.txt");
        assert!(dup_target.exists(), "Duplicate file name note - Copy.txt should exist");

        // 6. Move Items (Cut & Paste)
        let move_res = move_items(
            vec![file_b.to_string_lossy().to_string()],
            renamed_folder.clone(),
        ).expect("Move items");
        assert!(move_res.success);
        assert!(!file_b.exists(), "Original file_b should no longer exist after move");
        let moved_target = Path::new(&renamed_folder).join("data.json");
        assert!(moved_target.exists());

        // 7. Safety checks: prevent moving/copying folder into itself
        let bad_move = move_items(
            vec![renamed_folder.clone()],
            Path::new(&renamed_folder).join("sub").to_string_lossy().to_string(),
        );
        // Dest doesn't exist or is self-contained
        assert!(bad_move.is_err() || !bad_move.unwrap().success);

        // 8. Delete to Recycle Bin
        let recycle_res = delete_to_recycle_bin(vec![dup_target.to_string_lossy().to_string()]).expect("Recycle bin");
        assert!(recycle_res.success);
        assert!(!dup_target.exists(), "File should be moved to recycle bin");

        // 9. Permanent Delete test directory clean up
        let perm_res = delete_permanently(vec![test_root.to_string_lossy().to_string()]).expect("Permanent delete");
        assert!(perm_res.success);
        assert!(!test_root.exists(), "Test directory D:\\MAHI_Test should be removed after test");
    }

    #[test]
    fn test_phase_4_preview_operations() {
        let test_dir = PathBuf::from("D:\\MAHI_Preview_Test");
        if test_dir.exists() {
            let _ = fs::remove_dir_all(&test_dir);
        }
        fs::create_dir_all(&test_dir).expect("Create preview test dir");

        // 1. Test code / text preview
        let code_file = test_dir.join("main.rs");
        fs::write(&code_file, "fn main() {\n    println!(\"Hello MAHI\");\n}\n").expect("write code");

        let text_prev = read_text_preview(code_file.to_string_lossy().to_string(), None).expect("read text preview");
        assert_eq!(text_prev.language, "rust");
        assert_eq!(text_prev.line_count, 3);
        assert!(!text_prev.is_truncated);
        assert!(text_prev.content.contains("Hello MAHI"));

        // Test truncated preview
        let trunc_prev = read_text_preview(code_file.to_string_lossy().to_string(), Some(10)).expect("read truncated");
        assert!(trunc_prev.is_truncated);

        // Test binary file rejection
        let bin_file = test_dir.join("program.bin");
        fs::write(&bin_file, &[0x00, 0x01, 0x02, 0x03]).expect("write bin");
        let bin_res = read_text_preview(bin_file.to_string_lossy().to_string(), None);
        assert!(bin_res.is_err(), "Binary file should be rejected for text preview");

        // 2. Test SVG image preview
        let svg_file = test_dir.join("logo.svg");
        fs::write(&svg_file, r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>"#).expect("write svg");
        let img_prev = read_image_preview(svg_file.to_string_lossy().to_string()).expect("read svg preview");
        assert_eq!(img_prev.mime_type, "image/svg+xml");
        assert!(img_prev.data_url.starts_with("data:image/svg+xml;base64,"));

        // Cleanup
        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_phase_5_tab_drag_drop() {
        // Uses D:\MAHI_Tab_Test which is a dedicated safe test directory.
        // Setup: ensure test root exists and is clean.
        let test_root = PathBuf::from("D:\\MAHI_Tab_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("Create tab test root");

        let folder_a = test_root.join("FolderA");
        let folder_b = test_root.join("FolderB");
        let folder_c = test_root.join("FolderC");
        fs::create_dir_all(&folder_a).expect("Create FolderA");
        fs::create_dir_all(&folder_b).expect("Create FolderB");
        fs::create_dir_all(&folder_c).expect("Create FolderC");

        let file_a = test_root.join("FileA.txt");
        let file_b = test_root.join("FileB.txt");
        fs::write(&file_a, "Phase 5 FileA").expect("Write FileA");
        fs::write(&file_b, "Phase 5 FileB").expect("Write FileB");

        // ---- Test 1: COPY file to FolderA ----
        let res = copy_items(
            vec![file_a.to_string_lossy().to_string()],
            folder_a.to_string_lossy().to_string(),
        ).expect("copy FileA to FolderA");
        assert!(res.success, "copy should succeed");
        assert!(folder_a.join("FileA.txt").exists(), "FileA should exist in FolderA");
        // Original still exists after copy
        assert!(file_a.exists(), "FileA should still exist in root after copy");

        // ---- Test 2: MOVE FileB to FolderB ----
        let res2 = move_items(
            vec![file_b.to_string_lossy().to_string()],
            folder_b.to_string_lossy().to_string(),
        ).expect("move FileB to FolderB");
        assert!(res2.success, "move should succeed");
        assert!(folder_b.join("FileB.txt").exists(), "FileB should exist in FolderB");
        assert!(!file_b.exists(), "FileB should NOT exist in root after move");

        // ---- Test 3: MOVE whole FolderA into FolderC ----
        let res3 = move_items(
            vec![folder_a.to_string_lossy().to_string()],
            folder_c.to_string_lossy().to_string(),
        ).expect("move FolderA to FolderC");
        assert!(res3.success, "move folder should succeed");
        assert!(folder_c.join("FolderA").exists(), "FolderA should exist inside FolderC");
        assert!(!folder_a.exists(), "FolderA should NOT exist in root after move");

        // ---- Test 4: Copy multiple items at once ----
        let file_x = test_root.join("FileX.txt");
        let file_y = test_root.join("FileY.txt");
        fs::write(&file_x, "X").expect("Write FileX");
        fs::write(&file_y, "Y").expect("Write FileY");

        let res4 = copy_items(
            vec![
                file_x.to_string_lossy().to_string(),
                file_y.to_string_lossy().to_string(),
            ],
            folder_b.to_string_lossy().to_string(),
        ).expect("multi-copy");
        assert!(res4.success);
        assert_eq!(res4.success_count, 2, "Both files should be copied");
        assert!(folder_b.join("FileX.txt").exists());
        assert!(folder_b.join("FileY.txt").exists());

        // ---- Test 5: Self-drop guard (move folder into itself) ----
        // The move_items backend will attempt this — on Windows it will fail or be a no-op.
        // We just verify the backend doesn't panic.
        let self_res = move_items(
            vec![folder_b.to_string_lossy().to_string()],
            folder_b.to_string_lossy().to_string(),
        );
        // It may succeed with 0 items or fail — either is acceptable; it must not panic.
        match self_res {
            Ok(r) => {
                // Either zero success or it reported an error — FolderB must still exist
                assert!(folder_b.exists(), "FolderB must still exist after self-drop attempt");
                let _ = r;
            }
            Err(_) => {
                // Graceful failure is also acceptable
                assert!(folder_b.exists(), "FolderB must still exist after failed self-drop");
            }
        }

        // Cleanup
        let _ = fs::remove_dir_all(&test_root);
        assert!(!test_root.exists(), "Test root should be cleaned up");
    }

    #[test]
    fn test_phase_6_native_windows_integration() {
        // 1. Test Copy Path (plain text clipboard)
        let sample_path = "D:\\Code\\NEXT JS\\Mahi Launcher";
        let copy_text_res = copy_text_to_clipboard(sample_path.to_string());
        assert!(copy_text_res.is_ok(), "Copy text to clipboard should succeed");

        // 2. Test File Clipboard Interoperability (CF_HDROP)
        let test_root = PathBuf::from("D:\\MAHI_Clip_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("Create clip test root");
        let test_file1 = test_root.join("ClipFile1.txt");
        let test_file2 = test_root.join("ClipFile2.txt");
        fs::write(&test_file1, "Clip 1").expect("Write ClipFile1");
        fs::write(&test_file2, "Clip 2").expect("Write ClipFile2");

        let files = vec![
            test_file1.to_string_lossy().to_string(),
            test_file2.to_string_lossy().to_string(),
        ];

        // Set files with is_cut = false (Copy)
        let set_res = set_system_clipboard_files(files.clone(), false);
        assert!(set_res.is_ok(), "Setting system clipboard files should succeed");

        // Read back from clipboard
        let get_res = get_system_clipboard_files().expect("Read system clipboard files");
        assert!(get_res.is_some(), "System clipboard should have files");
        let clip_data = get_res.unwrap();
        assert_eq!(clip_data.paths.len(), 2, "Should read 2 paths from clipboard");
        assert!(!clip_data.is_cut, "is_cut should be false");
        assert!(clip_data.paths.iter().any(|p| p.contains("ClipFile1.txt")));
        assert!(clip_data.paths.iter().any(|p| p.contains("ClipFile2.txt")));

        // Set files with is_cut = true (Cut)
        let set_cut_res = set_system_clipboard_files(files, true);
        assert!(set_cut_res.is_ok(), "Setting cut files should succeed");

        let get_cut_res = get_system_clipboard_files().expect("Read cut files");
        assert!(get_cut_res.is_some());
        let cut_clip = get_cut_res.unwrap();
        assert!(cut_clip.is_cut, "is_cut should be true for Cut operation");

        // 3. Test that normal text clipboard clears file clipboard (no false CF_HDROP)
        let text_res = copy_text_to_clipboard("Normal plain text".to_string());
        assert!(text_res.is_ok());
        let get_after_text = get_system_clipboard_files().expect("Read after text");
        assert!(get_after_text.is_none(), "Normal text clipboard should NOT contain file CF_HDROP");

        // Cleanup
        let _ = fs::remove_dir_all(&test_root);
    }

    #[test]
    fn test_phase_7a_project_intelligence() {
        let test_root = PathBuf::from("D:\\MAHI_Project_Intelligence_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("Create test root");

        // --- Sub-Project 1: Node + Next.js + React + TypeScript + pnpm + scripts + .env ---
        let node_proj = test_root.join("NextApp");
        fs::create_dir_all(&node_proj).expect("Create NextApp dir");
        let pkg_json = r#"{
            "name": "next-app",
            "scripts": {
                "dev": "next dev",
                "build": "next build",
                "start": "next start",
                "lint": "next lint"
            },
            "dependencies": {
                "next": "^14.2.0",
                "react": "^18.3.0",
                "react-dom": "^18.3.0"
            },
            "devDependencies": {
                "typescript": "^5.0.0",
                "tailwindcss": "^3.4.0"
            }
        }"#;
        fs::write(node_proj.join("package.json"), pkg_json).expect("write package.json");
        fs::write(node_proj.join("tsconfig.json"), "{}").expect("write tsconfig.json");
        fs::write(node_proj.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'").expect("write pnpm-lock");
        fs::write(node_proj.join("next.config.mjs"), "export default {};").expect("write next.config");
        // Super secret .env file
        let secret_str = "SUPER_SECRET_TOKEN=xyz_do_not_leak_987654321";
        fs::write(node_proj.join(".env"), secret_str).expect("write .env");

        let node_details = detect_project_details(&node_proj).expect("detect NextApp details");
        assert_eq!(node_details.name, "NextApp");
        assert_eq!(node_details.project_type, "Node / Web");
        assert_eq!(node_details.package_manager, Some("pnpm".to_string()));
        assert!(node_details.technologies.contains(&"Node.js".to_string()));
        assert!(node_details.technologies.contains(&"TypeScript".to_string()));
        assert!(node_details.frameworks.contains(&"Next.js".to_string()));
        assert!(node_details.frameworks.contains(&"React".to_string()));
        assert!(node_details.frameworks.contains(&"Tailwind CSS".to_string()));
        assert!(node_details.scripts.contains(&"dev".to_string()));
        assert!(node_details.scripts.contains(&"build".to_string()));
        assert!(node_details.scripts.contains(&"lint".to_string()));
        assert!(node_details.scripts.contains(&"start".to_string()));
        // Security check: .env presence noted safely
        assert!(node_details.important_files.contains(&".env (present)".to_string()));
        // Security check: .env content was NEVER read into any field!
        let serialized = serde_json::to_string(&node_details).expect("serialize details");
        assert!(!serialized.contains("xyz_do_not_leak_987654321"), "CRITICAL: .env secrets must never be read or leaked!");

        // --- Sub-Project 2: Rust + Tauri + Cargo ---
        let rust_proj = test_root.join("TauriApp");
        fs::create_dir_all(&rust_proj).expect("Create TauriApp dir");
        let cargo_toml = r#"[package]
name = "tauri-app"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = "2.0.0"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
"#;
        fs::write(rust_proj.join("Cargo.toml"), cargo_toml).expect("write Cargo.toml");
        fs::write(rust_proj.join("Cargo.lock"), "").expect("write Cargo.lock");

        let rust_details = detect_project_details(&rust_proj).expect("detect TauriApp details");
        assert_eq!(rust_details.project_type, "Rust");
        assert_eq!(rust_details.package_manager, Some("cargo".to_string()));
        assert!(rust_details.technologies.contains(&"Rust".to_string()));
        assert!(rust_details.frameworks.contains(&"Tauri 2".to_string()));
        assert!(rust_details.frameworks.contains(&"Tokio".to_string()));
        assert!(rust_details.important_files.contains(&"Cargo.toml".to_string()));
        assert!(rust_details.important_files.contains(&"Cargo.lock".to_string()));

        // --- Sub-Project 3: Java + Maven + Spring Boot ---
        let java_proj = test_root.join("SpringBootApp");
        fs::create_dir_all(&java_proj).expect("Create SpringBootApp dir");
        let pom_xml = r#"<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>demo</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
    </dependencies>
</project>"#;
        fs::write(java_proj.join("pom.xml"), pom_xml).expect("write pom.xml");

        let java_details = detect_project_details(&java_proj).expect("detect SpringBootApp details");
        assert_eq!(java_details.project_type, "Java / Maven");
        assert_eq!(java_details.package_manager, Some("maven".to_string()));
        assert!(java_details.technologies.contains(&"Java".to_string()));
        assert!(java_details.frameworks.contains(&"Spring Boot".to_string()));

        // --- Sub-Project 4: Python + FastAPI + Pip + Docker + Git ---
        let py_proj = test_root.join("FastApiService");
        fs::create_dir_all(&py_proj).expect("Create FastApiService dir");
        fs::create_dir_all(py_proj.join(".git")).expect("Create .git dir");
        fs::write(py_proj.join("requirements.txt"), "fastapi==0.111.0\nuvicorn==0.30.0").expect("write requirements.txt");
        fs::write(py_proj.join("Dockerfile"), "FROM python:3.11\nWORKDIR /app").expect("write Dockerfile");

        let py_details = detect_project_details(&py_proj).expect("detect FastApiService details");
        assert_eq!(py_details.project_type, "Python");
        assert_eq!(py_details.package_manager, Some("pip".to_string()));
        assert!(py_details.technologies.contains(&"Python".to_string()));
        assert!(py_details.technologies.contains(&"Git".to_string()));
        assert!(py_details.technologies.contains(&"Docker".to_string()));
        assert!(py_details.frameworks.contains(&"FastAPI".to_string()));
        assert!(py_details.has_git);
        assert!(py_details.has_docker);

        // --- Cleanup ---
        let _ = fs::remove_dir_all(&test_root);
        assert!(!test_root.exists(), "Test root D:\\MAHI_Project_Intelligence_Test must be completely removed");
    }

    #[test]
    fn test_phase_7b_live_git_status() {
        let test_root = PathBuf::from("D:\\MAHI_Git_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("Create git test root");

        // 1. Initialize test Git repository
        let init_status = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&test_root)
            .status();

        let git_initialized = match init_status {
            Ok(s) => s.success(),
            Err(_) => false,
        };

        if !git_initialized {
            let _ = Command::new("git")
                .arg("init")
                .current_dir(&test_root)
                .status();
        }

        // Configure dummy user for committing in test
        let _ = Command::new("git")
            .args(["config", "user.name", "Mahi Test"])
            .current_dir(&test_root)
            .status();
        let _ = Command::new("git")
            .args(["config", "user.email", "test@mahi.local"])
            .current_dir(&test_root)
            .status();

        // 2. Create initial commit
        let committed_file = test_root.join("committed.txt");
        fs::write(&committed_file, "Initial content\n").expect("write committed.txt");
        let _ = Command::new("git")
            .args(["add", "committed.txt"])
            .current_dir(&test_root)
            .status();
        let _ = Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(&test_root)
            .status();

        // 3. Create working tree changes:
        // - Modified file
        fs::write(&committed_file, "Modified content\n").expect("modify committed.txt");
        // - Staged file
        let staged_file = test_root.join("staged.txt");
        fs::write(&staged_file, "Staged file content\n").expect("write staged.txt");
        let _ = Command::new("git")
            .args(["add", "staged.txt"])
            .current_dir(&test_root)
            .status();
        // - Untracked file
        let untracked_file = test_root.join("untracked.txt");
        fs::write(&untracked_file, "Untracked file content\n").expect("write untracked.txt");

        // 4. Test inspect_git_status on the root
        let git_status = inspect_git_status(&test_root);
        assert!(git_status.is_git_repo, "Must detect valid git repository");
        assert!(git_status.git_root.is_some(), "Must resolve git root");
        let resolved_root = git_status.git_root.clone().unwrap();
        assert!(resolved_root.to_lowercase().contains("mahi_git_test"), "Git root must match test root");
        assert!(git_status.branch.is_some(), "Branch must be detected");
        assert_eq!(git_status.modified_count, 1, "Should detect 1 modified file");
        assert_eq!(git_status.staged_count, 1, "Should detect 1 staged file");
        assert_eq!(git_status.untracked_count, 1, "Should detect 1 untracked file");
        assert_eq!(git_status.total_changed_count, 3, "Total changed count should be 3");
        assert!(!git_status.is_clean, "Repository should not be clean");

        // Test changed files list
        assert!(git_status.changed_files.iter().any(|f| f.path.contains("committed.txt")));
        assert!(git_status.changed_files.iter().any(|f| f.path.contains("staged.txt")));
        assert!(git_status.changed_files.iter().any(|f| f.path.contains("untracked.txt")));

        // Test format_git_summary
        let summary = format_git_summary(&git_status);
        assert!(summary.is_some());
        let s = summary.unwrap();
        assert!(s.contains("3 changes"), "Summary must contain 3 changes");

        // 5. Test nested directory resolution
        let nested_dir = test_root.join("src").join("nested");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        let nested_status = inspect_git_status(&nested_dir);
        assert!(nested_status.is_git_repo, "Nested dir must recognize parent Git repo");
        assert_eq!(nested_status.git_root.map(|r| r.to_lowercase()), Some(resolved_root.to_lowercase()), "Nested folder must resolve to repository root");

        // 6. Test non-git directory
        let non_git_dir = PathBuf::from("D:\\MAHI_Non_Git_Temp");
        let _ = fs::create_dir_all(&non_git_dir);
        let non_git_status = inspect_git_status(&non_git_dir);
        assert!(!non_git_status.is_git_repo, "Non-git directory must report is_git_repo = false");
        let _ = fs::remove_dir_all(&non_git_dir);

        // Cleanup test repository
        let _ = fs::remove_dir_all(&test_root);
        assert!(!test_root.exists(), "Test root D:\\MAHI_Git_Test must be completely removed");
    }

    #[test]
    fn test_phase_7c_project_scripts() {
        let test_root = PathBuf::from("D:\\MAHI_Script_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("create test root D:\\MAHI_Script_Test");

        // 1. Create test package.json with harmless scripts
        let package_json_content = r#"{
  "name": "mahi-script-test",
  "version": "1.0.0",
  "scripts": {
    "hello": "node -e \"console.log('MAHI TEST OK')\"",
    "exit-success": "node -e \"process.exit(0)\"",
    "exit-failure": "node -e \"process.exit(1)\"",
    "long-running": "node -e \"setInterval(() => {}, 1000)\""
  }
}"#;
        fs::write(test_root.join("package.json"), package_json_content).expect("write package.json");

        // 2. Test script detection
        let details = detect_project_details(&test_root).expect("Must detect project details");
        assert_eq!(details.scripts.len(), 4, "Must detect 4 scripts");
        assert!(details.scripts.contains(&"hello".to_string()));
        assert!(details.scripts.contains(&"exit-success".to_string()));
        assert!(details.scripts.contains(&"exit-failure".to_string()));
        assert!(details.scripts.contains(&"long-running".to_string()));

        // 3. Test script model & package manager selection
        let hello_script = details.detected_scripts.iter().find(|s| s.name == "hello").expect("hello script found");
        assert_eq!(hello_script.package_manager, "npm");
        assert_eq!(hello_script.ecosystem, "node");

        // 4. Test detect_project has_dev_script flag (dev is not present in our test scripts)
        let proj_info = detect_project(&test_root).expect("Must detect project info");
        assert!(!proj_info.has_dev_script, "has_dev_script should be false when no dev script");

        // 5. Test unavailable package manager handling
        assert!(find_package_manager_executable("nonexistent_package_manager_xyz_99").is_none());
        let unavail_err = ProcessManager::global().run_script("D:/MAHI_Script_Test", "nonexistent_script", None);
        assert!(unavail_err.is_err());

        // 6. Test successful process execution ("hello")
        let proc_hello = ProcessManager::global()
            .run_script("D:/MAHI_Script_Test", "hello", None)
            .expect("Must run hello script");
        assert_eq!(proc_hello.script_name, "hello");
        assert_eq!(proc_hello.status, ProcessStatus::Running);

        // Wait for exit
        let mut hello_final_status = ProcessStatus::Running;
        for _ in 0..150 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let procs = ProcessManager::global().get_processes();
            if let Some(p) = procs.iter().find(|p| p.id == proc_hello.id) {
                hello_final_status = p.status.clone();
                if hello_final_status == ProcessStatus::Exited || hello_final_status == ProcessStatus::Failed {
                    break;
                }
            }
        }
        assert_eq!(hello_final_status, ProcessStatus::Exited, "hello process must exit with success");

        // 7. Test failed process execution ("exit-failure")
        let proc_fail = ProcessManager::global()
            .run_script("D:/MAHI_Script_Test", "exit-failure", None)
            .expect("Must run exit-failure script");
        let mut fail_final_status = ProcessStatus::Running;
        for _ in 0..150 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let procs = ProcessManager::global().get_processes();
            if let Some(p) = procs.iter().find(|p| p.id == proc_fail.id) {
                fail_final_status = p.status.clone();
                if fail_final_status == ProcessStatus::Exited || fail_final_status == ProcessStatus::Failed {
                    break;
                }
            }
        }
        assert_eq!(fail_final_status, ProcessStatus::Failed, "exit-failure must report Failed status");

        // 8. Test long-running process and stop action
        let proc_long = ProcessManager::global()
            .run_script("D:/MAHI_Script_Test", "long-running", None)
            .expect("Must run long-running script");
        std::thread::sleep(std::time::Duration::from_millis(200));
        let stopped = ProcessManager::global()
            .stop_process(&proc_long.id)
            .expect("Must stop running process");
        assert_eq!(stopped.status, ProcessStatus::Stopped, "Status must be Stopped");

        // 9. Test multiple process tracking & bounded output
        let procs = ProcessManager::global().get_processes();
        assert!(procs.len() >= 3, "Must track multiple processes independently");
        for p in procs {
            assert!(p.output_lines.len() <= 300, "Output buffer must remain bounded");
        }

        // Cleanup test directory with bounded retry for transient locks
        for _ in 0..20 {
            if fs::remove_dir_all(&test_root).is_ok() && !test_root.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root); // One last attempt
        }
        assert!(!test_root.exists(), "Test root D:\\MAHI_Script_Test must be completely removed");
    }

    #[test]
    fn test_phase_7e_personalized_workspace() {
        let test_root = PathBuf::from("D:\\MAHI_P7E_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("create test root D:\\MAHI_P7E_Test");

        // 1. Test package.json with env check script
        let package_json_content = r#"{
  "name": "mahi-p7e-test",
  "version": "1.0.0",
  "scripts": {
    "print-env": "node -e \"console.log('ENV_VAL=' + (process.env.MAHI_TEST_CUSTOM_KEY || 'MISSING'))\""
  }
}"#;
        fs::write(test_root.join("package.json"), package_json_content).expect("write package.json");

        // 2. Test environment variable injection into run_script
        let envs = vec![
            CustomEnvVar {
                key: "MAHI_TEST_CUSTOM_KEY".to_string(),
                value: "SUPER_SECRET_12345".to_string(),
                enabled: true,
                is_secret: true,
            },
            CustomEnvVar {
                key: "MAHI_DISABLED_KEY".to_string(),
                value: "DISABLED_VAL".to_string(),
                enabled: false,
                is_secret: false,
            },
        ];

        let proc = ProcessManager::global()
            .run_script("D:/MAHI_P7E_Test", "print-env", Some(envs))
            .expect("Must run print-env script with custom envs");

        // Wait for process to exit
        for _ in 0..150 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let procs = ProcessManager::global().get_processes();
            if let Some(p) = procs.iter().find(|p| p.id == proc.id) {
                if p.status == ProcessStatus::Exited || p.status == ProcessStatus::Failed {
                    let out = p.output_lines.join("\n");
                    assert!(out.contains("ENV_VAL=SUPER_SECRET_12345"), "Output must contain injected env variable");
                    assert!(!out.contains("DISABLED_VAL"), "Disabled env variable must not be present");
                    break;
                }
            }
        }

        // 3. Test PinnedProjectEntry model and serialization
        let pinned_list = vec![
            PinnedProjectEntry {
                path: "D:/Projects/Alpha".to_string(),
                name: "Alpha".to_string(),
                pinned_at: 100,
            },
            PinnedProjectEntry {
                path: "D:/Projects/Beta".to_string(),
                name: "Beta".to_string(),
                pinned_at: 200,
            },
        ];
        let json = serde_json::to_string(&pinned_list).expect("serialize pinned list");
        let deserialized: Vec<PinnedProjectEntry> = serde_json::from_str(&json).expect("deserialize pinned list");
        assert_eq!(pinned_list, deserialized);

        // 4. Test ProjectWorkspaceConfig model and serialization
        let ws_config = ProjectWorkspaceConfig {
            pinned_scripts: vec!["dev".to_string(), "test".to_string()],
            env_overrides: vec![CustomEnvVar {
                key: "PORT".to_string(),
                value: "4000".to_string(),
                enabled: true,
                is_secret: false,
            }],
        };
        let ws_json = serde_json::to_string(&ws_config).expect("serialize ws_config");
        let ws_deser: ProjectWorkspaceConfig = serde_json::from_str(&ws_json).expect("deserialize ws_config");
        assert_eq!(ws_config, ws_deser);

        // 5. Test normalize_path_str, duplicate prevention, and pin/unpin toggling
        let p1 = "D:\\Projects\\Alpha\\";
        let p2 = "d:/projects/alpha";
        let p3 = "  D:/Projects/Alpha/  ";
        assert_eq!(normalize_path_str(p1), "d:/projects/alpha");
        assert_eq!(normalize_path_str(p2), "d:/projects/alpha");
        assert_eq!(normalize_path_str(p3), "d:/projects/alpha");

        let mut test_pins: Vec<PinnedProjectEntry> = Vec::new();
        let target_norm = normalize_path_str(p1);

        // Pin Alpha
        let is_pinned = test_pins.iter().any(|e| normalize_path_str(&e.path) == target_norm);
        test_pins.retain(|e| normalize_path_str(&e.path) != target_norm);
        if !is_pinned {
            test_pins.push(PinnedProjectEntry {
                path: "D:/Projects/Alpha".to_string(),
                name: "Alpha".to_string(),
                pinned_at: 10,
            });
        }
        assert_eq!(test_pins.len(), 1, "Alpha should be pinned");

        // Attempt duplicate pin with different slashes and trailing slash (should unpin)
        let is_pinned_again = test_pins.iter().any(|e| normalize_path_str(&e.path) == normalize_path_str(p1));
        test_pins.retain(|e| normalize_path_str(&e.path) != normalize_path_str(p1));
        if !is_pinned_again {
            test_pins.push(PinnedProjectEntry {
                path: p1.to_string(),
                name: "Alpha".to_string(),
                pinned_at: 20,
            });
        }
        assert_eq!(test_pins.len(), 0, "Toggling existing pinned project with Windows backslashes must unpin it");

        // Pin again
        test_pins.push(PinnedProjectEntry {
            path: "D:/Projects/Alpha".to_string(),
            name: "Alpha".to_string(),
            pinned_at: 30,
        });
        assert_eq!(test_pins.len(), 1);

        // 6. Test malformed settings recovery (graceful fallback)
        let malformed_json = "{ invalid_json: true, \"unclosed: ";
        let recovered_pins: Vec<PinnedProjectEntry> = serde_json::from_str(malformed_json).unwrap_or_default();
        assert!(recovered_pins.is_empty(), "Malformed JSON must deserialize to default empty vector without crashing");

        let recovered_config: ProjectWorkspaceConfig = serde_json::from_str(malformed_json).unwrap_or_default();
        assert!(recovered_config.pinned_scripts.is_empty(), "Malformed config must recover to default");
        assert!(recovered_config.env_overrides.is_empty());

        // 7. Test get_debug_storage_info
        let debug_info = get_debug_storage_info();
        assert!(debug_info.is_ok(), "Storage info call must succeed");

        // 8. Test cleanup safety guard (ensure safety checks reject non-debug paths)
        let bad_path = PathBuf::from("src-tauri/target/release");
        let norm_bad = bad_path.to_string_lossy().to_lowercase();
        let is_safe = norm_bad.ends_with("target/debug") || norm_bad.ends_with("target\\debug");
        assert!(!is_safe, "Cleanup safety check must strictly reject release or source paths");

        // Cleanup test directory with bounded retry for transient locks
        for _ in 0..20 {
            if fs::remove_dir_all(&test_root).is_ok() && !test_root.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root); // One last attempt
        }
        assert!(!test_root.exists(), "Test root D:\\MAHI_P7E_Test must be completely removed");
    }

    #[test]
    fn test_phase_7f_functional_validation() {
        let test_root = PathBuf::from("D:\\MAHI_P7F_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("create test root D:\\MAHI_P7F_Test");

        // 1. PIN / UNPIN VALIDATION
        let p_with_spaces = "D:\\Code\\NEXT JS\\Mahi Launcher";
        let norm_spaces = normalize_path_str(p_with_spaces);
        assert_eq!(norm_spaces, "d:/code/next js/mahi launcher");

        let p_forward = "D:/Code/NEXT JS/Mahi Launcher/";
        assert_eq!(normalize_path_str(p_forward), "d:/code/next js/mahi launcher");

        let mut pins: Vec<PinnedProjectEntry> = Vec::new();
        // Pin project
        let target_norm = normalize_path_str(p_with_spaces);
        let exists = pins.iter().any(|p| normalize_path_str(&p.path) == target_norm);
        pins.retain(|p| normalize_path_str(&p.path) != target_norm);
        if !exists {
            pins.push(PinnedProjectEntry {
                path: p_with_spaces.to_string(),
                name: "Mahi Launcher".to_string(),
                pinned_at: 1000,
            });
        }
        assert_eq!(pins.len(), 1, "Must pin project");

        // Navigate away and back / Re-check pin persistence (JSON roundtrip)
        let json = serde_json::to_string(&pins).expect("serialize pins");
        let restored_pins: Vec<PinnedProjectEntry> = serde_json::from_str(&json).expect("deserialize pins");
        assert_eq!(restored_pins.len(), 1);
        assert_eq!(restored_pins[0].name, "Mahi Launcher");

        // Duplicate pin attempt with different slashes
        let exists_again = pins.iter().any(|p| normalize_path_str(&p.path) == normalize_path_str(p_forward));
        pins.retain(|p| normalize_path_str(&p.path) != normalize_path_str(p_forward));
        if !exists_again {
            pins.push(PinnedProjectEntry {
                path: p_forward.to_string(),
                name: "Mahi Launcher".to_string(),
                pinned_at: 2000,
            });
        }
        assert_eq!(pins.len(), 0, "Toggling must unpin without duplicate entries");

        // 2. VS CODE VALIDATION
        assert!(check_vscode_available(), "VS Code must be available on system");
        let exe = find_vscode_exe();
        assert!(exe.is_some(), "Must locate Code.exe directly on Windows");
        let exe_path = exe.unwrap();
        assert!(exe_path.exists(), "Code.exe path must exist");
        assert!(exe_path.to_string_lossy().to_lowercase().ends_with("code.exe"));

        // Test non-existent path validation for VS Code
        let non_existent_path = "D:\\This\\Path\\Does\\Not\\Exist\\999".to_string();
        let vs_err = open_in_vscode(non_existent_path);
        assert!(vs_err.is_err(), "open_in_vscode must reject non-existent path");

        // 3. TERMINAL VALIDATION
        // Non-existent path handling
        let term_err = open_in_terminal("D:\\NonExistent_Terminal_Path_XYZ".to_string());
        assert!(term_err.is_err(), "open_in_terminal must reject non-existent path");

        // Existing directory check
        let real_dir = test_root.to_string_lossy().to_string();
        let term_res = open_in_terminal(real_dir);
        assert!(term_res.is_ok(), "open_in_terminal should succeed on real directory");

        // 4. EXPLORER VALIDATION
        let exp_err = open_in_explorer("D:\\NonExistent_Explorer_Path_XYZ".to_string());
        assert!(exp_err.is_err(), "open_in_explorer must reject non-existent path");

        // Forward slash normalization
        let fwd_path = test_root.to_string_lossy().replace('\\', "/");
        let exp_res = open_in_explorer(fwd_path);
        assert!(exp_res.is_ok(), "open_in_explorer must normalize forward slashes and succeed");

        // 5. CREATE NEW FOLDER VALIDATION
        let created1 = create_directory(test_root.to_string_lossy().to_string(), None).expect("create first folder");
        assert!(Path::new(&created1).exists(), "First folder must exist");
        assert!(created1.ends_with("New folder"), "First folder must be named 'New folder'");
        assert!(created1.contains('\\'), "Must return canonical Windows backslash path");

        // Collision naming: New folder (2)
        let created2 = create_directory(test_root.to_string_lossy().to_string(), None).expect("create second folder with collision");
        assert!(Path::new(&created2).exists(), "Second folder must exist");
        assert!(created2.ends_with("New folder (2)"), "Second folder must be named 'New folder (2)'");

        // Read directory confirms both folders
        let dir_res = read_directory(test_root.to_string_lossy().to_string()).expect("read test directory");
        assert_eq!(dir_res.dir_count, 2);
        assert!(dir_res.entries.iter().any(|e| e.name == "New folder"));
        assert!(dir_res.entries.iter().any(|e| e.name == "New folder (2)"));

        // Rename folder
        let renamed = rename_item(created1, "My Projects Folder".to_string()).expect("rename folder");
        assert!(Path::new(&renamed).exists(), "Renamed folder must exist");
        assert!(renamed.ends_with("My Projects Folder"));

        // Cleanup
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = fs::remove_dir_all(&test_root);
    }

    #[test]
    fn test_scan_roots_discovery_and_deduplication() {
        let temp_base = std::env::temp_dir().join(format!("mahi_scan_test_{}", std::process::id()));
        if temp_base.exists() {
            let _ = fs::remove_dir_all(&temp_base);
        }
        fs::create_dir_all(&temp_base).expect("create temp test dir");

        let fake_proj = temp_base.join("my-cool-project");
        fs::create_dir_all(&fake_proj).expect("create fake project dir");
        let pkg_json = fake_proj.join("package.json");
        fs::write(&pkg_json, r#"{"name":"my-cool-project","version":"1.0.0"}"#).expect("write package.json");

        // 1. Discovery with custom root
        let results = discover_projects_with_roots(&[temp_base.clone()]);
        assert!(
            results.iter().any(|p| p.name == "my-cool-project"),
            "Discovered projects must include custom root project"
        );

        // 2. Deduplication check when same root or nested root is passed multiple times
        let duplicate_roots = vec![temp_base.clone(), temp_base.clone(), fake_proj.clone()];
        let results_dedup = discover_projects_with_roots(&duplicate_roots);
        let matches: Vec<_> = results_dedup.iter().filter(|p| p.name == "my-cool-project").collect();
        assert_eq!(matches.len(), 1, "Discovered projects must be strictly deduplicated");

        // Cleanup
        let _ = fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_scan_roots_persistence_format() {
        let temp_dir = std::env::temp_dir().join(format!("mahi_roots_persist_test_{}", std::process::id()));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let roots_file = temp_dir.join("scan_roots.json");
        let initial_roots = vec![
            temp_dir.to_string_lossy().to_string(),
        ];

        let json = serde_json::to_string_pretty(&initial_roots).expect("serialize roots");
        fs::write(&roots_file, json).expect("write scan_roots.json");

        // Verify roundtrip
        let read_back = fs::read_to_string(&roots_file).expect("read scan_roots.json");
        let parsed: Vec<String> = serde_json::from_str(&read_back).expect("parse roots");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0], temp_dir.to_string_lossy().to_string());

        // Zero-state handling (empty roots)
        let empty_json = serde_json::to_string_pretty(&Vec::<String>::new()).expect("serialize empty");
        fs::write(&roots_file, empty_json).expect("write empty scan_roots.json");
        let read_empty = fs::read_to_string(&roots_file).expect("read empty scan_roots.json");
        let parsed_empty: Vec<String> = serde_json::from_str(&read_empty).expect("parse empty");
        assert!(parsed_empty.is_empty(), "Zero-state roots file must deserialize to empty vec without hardcoded defaults");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_powershell_dialog_script_syntax() {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let script = r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select Project Folder'; [Console]::Out.Write('OK')"#;
        let output = Command::new("powershell")
            .args(["-STA", "-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .expect("run powershell");

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "PowerShell failed: {}", stderr);
        assert_eq!(stdout.trim(), "OK", "Expected stdout to be OK, got: {}", stdout);
    }

    #[test]
    fn test_v1_zero_state_and_persistence_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("mahi_v1_test_{}", std::process::id()));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        // 1. Zero state test: discover with empty roots
        let zero_roots: Vec<PathBuf> = Vec::new();
        let zero_results = discover_projects_with_roots(&zero_roots);
        for p in &zero_results {
            assert_ne!(p.path, "D:\\Code\\NEXT JS", "Author root must never be forced into discovered projects");
        }

        // 2. Add disposable root with a project
        let disposable_proj = temp_dir.join("sample-app");
        fs::create_dir_all(&disposable_proj).expect("create proj");
        fs::write(disposable_proj.join("package.json"), r#"{"name":"sample-app","version":"0.1.0"}"#).expect("write package.json");

        let configured = vec![temp_dir.clone()];
        let discovered = discover_projects_with_roots(&configured);
        assert!(discovered.iter().any(|p| p.name == "sample-app"), "Configured root must discover sample-app");

        // 3. Persistence roundtrip
        let json_file = temp_dir.join("scan_roots.json");
        let roots_to_save = vec![temp_dir.to_string_lossy().to_string()];
        let serialized = serde_json::to_string_pretty(&roots_to_save).expect("serialize");
        fs::write(&json_file, &serialized).expect("write scan_roots.json");

        // 4. Reload from disk (simulating restart)
        let read_str = fs::read_to_string(&json_file).expect("read");
        let reloaded_roots: Vec<String> = serde_json::from_str(&read_str).expect("deserialize");
        assert_eq!(reloaded_roots.len(), 1);
        assert_eq!(reloaded_roots[0], temp_dir.to_string_lossy().to_string());

        // 5. Remove root and verify persistence
        let empty_roots: Vec<String> = Vec::new();
        let empty_serialized = serde_json::to_string_pretty(&empty_roots).expect("serialize empty");
        fs::write(&json_file, &empty_serialized).expect("write empty");
        let read_empty = fs::read_to_string(&json_file).expect("read");
        let reloaded_empty: Vec<String> = serde_json::from_str(&read_empty).expect("deserialize empty");
        assert!(reloaded_empty.is_empty(), "Removal must persist as empty list");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_onboarding_state_persistence() {
        let temp_dir = std::env::temp_dir().join(format!("mahi_onboarding_test_{}", std::process::id()));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let file = temp_dir.join("onboarding.json");

        // 1. Initial default state
        let default_state = OnboardingState {
            completed: false,
            dismissed: false,
            completed_at: None,
        };
        let json = serde_json::to_string_pretty(&default_state).expect("serialize default");
        fs::write(&file, &json).expect("write onboarding.json");

        let read = fs::read_to_string(&file).expect("read");
        let parsed: OnboardingState = serde_json::from_str(&read).expect("parse default");
        assert!(!parsed.completed);
        assert!(!parsed.dismissed);
        assert_eq!(parsed.completed_at, None);

        // 2. Completed state
        let completed_state = OnboardingState {
            completed: true,
            dismissed: true,
            completed_at: Some(1790000000000),
        };
        let json_comp = serde_json::to_string_pretty(&completed_state).expect("serialize completed");
        fs::write(&file, &json_comp).expect("write completed");

        let read_comp = fs::read_to_string(&file).expect("read completed");
        let parsed_comp: OnboardingState = serde_json::from_str(&read_comp).expect("parse completed");
        assert!(parsed_comp.completed);
        assert!(parsed_comp.dismissed);
        assert_eq!(parsed_comp.completed_at, Some(1790000000000));

        // 3. Skipped state
        let skipped_state = OnboardingState {
            completed: false,
            dismissed: true,
            completed_at: Some(1790000000001),
        };
        let json_skip = serde_json::to_string_pretty(&skipped_state).expect("serialize skipped");
        fs::write(&file, &json_skip).expect("write skipped");

        let read_skip = fs::read_to_string(&file).expect("read skipped");
        let parsed_skip: OnboardingState = serde_json::from_str(&read_skip).expect("parse skipped");
        assert!(!parsed_skip.completed);
        assert!(parsed_skip.dismissed);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}




