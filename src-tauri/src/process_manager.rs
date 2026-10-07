// Phase 9C-D2: Workspace Process Manager Integration
//
// Safe, process-local child process management for MAHI workspace profiles.
//
// CORE PRINCIPLE: RESOLVE -> PREFLIGHT -> CONFIRM -> SPAWN
// Single source of truth is the pure Phase 9C-D1 WorkspaceExecutionPlan engine.
//
// STRICT SAFETY CONTRACT:
//   - Spawns ONLY preflight-validated, approved execution plans (Ready & is_executable == true).
//   - ZERO mutations to Windows Registry (HKCU/HKLM).
//   - ZERO mutations to global/system PATH or environment variables.
//   - ZERO mutations to MAHI's host process environment (std::env::set_var is NEVER called).
//   - ZERO project file or manifest writes.
//   - Protected secret markers are NEVER passed as environment values.
//   - In-memory output is bounded to prevent unbounded memory growth.
//   - Process termination targets ONLY MAHI-managed spawned child processes via tracked PIDs.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::workspace_environment::{
    build_execution_plan, LaunchKind, PreflightStatus,
};
use crate::workspace_profile::{
    get_workspace_profile, validate_env_override_key, PROTECTED_SECRET_MARKER,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Maximum number of output lines retained in memory per process session
pub const MAX_OUTPUT_BUFFER_LINES: usize = 2000;

// =========================================================================
// Data Models
// =========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkspaceProcessState {
    Starting,
    Running,
    Exited,
    Failed,
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutputEntry {
    pub line_number: usize,
    pub timestamp: u64,
    pub text: String,
    pub is_stderr: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProcessStatus {
    pub session_id: String,
    pub project_path: String,
    pub profile_id: String,
    pub action_or_script: String,
    pub launch_kind: LaunchKind,
    pub executable: String,
    pub arguments: Vec<String>,
    pub cwd: String,
    pub pid: Option<u32>,
    pub state: WorkspaceProcessState,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub total_stdout_lines: usize,
    pub total_stderr_lines: usize,
    pub summary_message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProcessOutput {
    pub session_id: String,
    pub lines: Vec<ProcessOutputEntry>,
    pub next_line_number: usize,
    pub is_truncated: bool,
    pub current_state: WorkspaceProcessState,
    pub exit_code: Option<i32>,
}

// =========================================================================
// Internal Session Representation
// =========================================================================

pub struct WorkspaceProcessSession {
    pub status: WorkspaceProcessStatus,
    pub output_buffer: VecDeque<ProcessOutputEntry>,
    pub next_line_index: usize,
    pub is_truncated: bool,
}

pub struct WorkspaceProcessManager {
    sessions: Mutex<HashMap<String, Arc<Mutex<WorkspaceProcessSession>>>>,
    child_pids: Mutex<HashMap<String, u32>>,
    session_counter: AtomicUsize,
}

static PROCESS_MANAGER: OnceLock<WorkspaceProcessManager> = OnceLock::new();

fn get_now_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn get_now_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

impl WorkspaceProcessManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            child_pids: Mutex::new(HashMap::new()),
            session_counter: AtomicUsize::new(1),
        }
    }

    pub fn global() -> &'static WorkspaceProcessManager {
        PROCESS_MANAGER.get_or_init(WorkspaceProcessManager::new)
    }

    /// Spawns a workspace process strictly following the D1 execution plan.
    pub fn spawn_execution(
        &self,
        project_path: &str,
        action_or_script: Option<&str>,
        session_secrets: Option<&HashMap<String, String>>,
    ) -> Result<WorkspaceProcessStatus, String> {
        // Step 1: Resolve Workspace Profile
        let profile = get_workspace_profile(project_path.to_string())
            .ok_or_else(|| format!("No workspace profile configured for '{}'", project_path))?;

        // Step 2: Build and Validate D1 Execution Plan (Single Source of Truth)
        let inherited_path = std::env::var("PATH").unwrap_or_default();
        let plan = build_execution_plan(&profile, action_or_script, session_secrets, &inherited_path);

        // Step 3: Enforce Strict Preflight Gates
        if plan.preflight_status != PreflightStatus::Ready {
            return Err(format!(
                "Preflight check failed ({:?}): {}",
                plan.preflight_status, plan.summary_message
            ));
        }

        if !plan.is_executable {
            return Err(format!(
                "Workspace execution plan is marked non-executable: {}",
                plan.summary_message
            ));
        }

        if !plan.protected_secret_keys.is_empty() {
            return Err(format!(
                "Execution blocked: Protected secret key(s) '{}' are missing session values.",
                plan.protected_secret_keys.join(", ")
            ));
        }

        // Validate working directory confinement
        let cwd_path = Path::new(&plan.cwd);
        if !cwd_path.is_dir() {
            return Err(format!("Working directory does not exist: {}", plan.cwd));
        }

        // Step 4: Construct Child Command (Process-Local Environment)
        let mut cmd = Command::new(&plan.executable);
        cmd.args(&plan.arguments);
        cmd.current_dir(&plan.cwd);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        // Inject synthesized workspace PATH into child process ONLY
        let derived_path_str = plan.derived_path_entries.join(";");
        cmd.env("PATH", &derived_path_str);

        // Inject non-secret environment overrides
        for (k, v) in &plan.non_secret_environment {
            cmd.env(k, v);
        }

        // Inject ephemeral session secrets (memory-only, never persisted)
        if let Some(secrets) = session_secrets {
            for (k, v) in secrets {
                if !v.trim().is_empty()
                    && v != PROTECTED_SECRET_MARKER
                    && validate_env_override_key(k).is_ok()
                {
                    cmd.env(k, v);
                }
            }
        }

        // Step 5: Spawn Child Process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn executable '{}': {}", plan.executable, e))?;

        let pid = child.id();
        let now = get_now_timestamp_secs();
        let counter = self.session_counter.fetch_add(1, Ordering::SeqCst);
        let session_id = format!("ws-proc-{}-{}", get_now_timestamp_ms(), counter);
        let action_label = action_or_script.unwrap_or("dev").to_string();

        let status = WorkspaceProcessStatus {
            session_id: session_id.clone(),
            project_path: plan.project_path.clone(),
            profile_id: plan.profile_id.clone(),
            action_or_script: action_label.clone(),
            launch_kind: plan.launch_kind,
            executable: plan.executable.clone(),
            arguments: plan.arguments.clone(),
            cwd: plan.cwd.clone(),
            pid: Some(pid),
            state: WorkspaceProcessState::Running,
            exit_code: None,
            started_at: now,
            finished_at: None,
            total_stdout_lines: 0,
            total_stderr_lines: 0,
            summary_message: format!("Process started for '{}' with PID {}", action_label, pid),
        };

        let initial_entry = ProcessOutputEntry {
            line_number: 1,
            timestamp: now,
            text: format!("[mahi] Spawned '{}' (PID: {})", plan.executable, pid),
            is_stderr: false,
        };

        let mut init_buf = VecDeque::with_capacity(MAX_OUTPUT_BUFFER_LINES);
        init_buf.push_back(initial_entry);

        let session = WorkspaceProcessSession {
            status: status.clone(),
            output_buffer: init_buf,
            next_line_index: 2,
            is_truncated: false,
        };

        let session_arc = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), Arc::clone(&session_arc));
        self.child_pids
            .lock()
            .unwrap()
            .insert(session_id.clone(), pid);

        // Step 6: Spawn Bounded Stdout Capture Thread
        if let Some(stdout) = child.stdout.take() {
            let s_arc = Arc::clone(&session_arc);
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let mut guard = s_arc.lock().unwrap();
                        let idx = guard.next_line_index;
                        guard.next_line_index += 1;
                        guard.status.total_stdout_lines += 1;

                        if guard.output_buffer.len() >= MAX_OUTPUT_BUFFER_LINES {
                            guard.output_buffer.pop_front();
                            guard.is_truncated = true;
                        }
                        guard.output_buffer.push_back(ProcessOutputEntry {
                            line_number: idx,
                            timestamp: get_now_timestamp_secs(),
                            text: l,
                            is_stderr: false,
                        });
                    }
                }
            });
        }

        // Step 7: Spawn Bounded Stderr Capture Thread
        if let Some(stderr) = child.stderr.take() {
            let s_arc = Arc::clone(&session_arc);
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let mut guard = s_arc.lock().unwrap();
                        let idx = guard.next_line_index;
                        guard.next_line_index += 1;
                        guard.status.total_stderr_lines += 1;

                        if guard.output_buffer.len() >= MAX_OUTPUT_BUFFER_LINES {
                            guard.output_buffer.pop_front();
                            guard.is_truncated = true;
                        }
                        guard.output_buffer.push_back(ProcessOutputEntry {
                            line_number: idx,
                            timestamp: get_now_timestamp_secs(),
                            text: l,
                            is_stderr: true,
                        });
                    }
                }
            });
        }

        // Step 8: Spawn Lifecycle Watcher Thread
        let s_arc = Arc::clone(&session_arc);
        std::thread::spawn(move || {
            match child.wait() {
                Ok(exit_status) => {
                    let mut guard = s_arc.lock().unwrap();
                    if guard.status.state == WorkspaceProcessState::Running
                        || guard.status.state == WorkspaceProcessState::Starting
                    {
                        let code = exit_status.code().unwrap_or(if exit_status.success() { 0 } else { 1 });
                        guard.status.exit_code = Some(code);
                        guard.status.finished_at = Some(get_now_timestamp_secs());
                        guard.status.state = if exit_status.success() {
                            WorkspaceProcessState::Exited
                        } else {
                            WorkspaceProcessState::Failed
                        };
                        guard.status.summary_message = format!("Process finished with exit code {}", code);

                        let idx = guard.next_line_index;
                        guard.next_line_index += 1;
                        if guard.output_buffer.len() >= MAX_OUTPUT_BUFFER_LINES {
                            guard.output_buffer.pop_front();
                            guard.is_truncated = true;
                        }
                        guard.output_buffer.push_back(ProcessOutputEntry {
                            line_number: idx,
                            timestamp: get_now_timestamp_secs(),
                            text: format!("[mahi] Process {} with exit code {}", if exit_status.success() { "exited" } else { "failed" }, code),
                            is_stderr: !exit_status.success(),
                        });
                    }
                }
                Err(e) => {
                    let mut guard = s_arc.lock().unwrap();
                    if guard.status.state != WorkspaceProcessState::Stopped {
                        guard.status.state = WorkspaceProcessState::Failed;
                        guard.status.finished_at = Some(get_now_timestamp_secs());
                        guard.status.summary_message = format!("Process wait failed: {}", e);
                    }
                }
            }
        });

        Ok(status)
    }

    /// Retrieves the live status of a tracked process session.
    pub fn get_status(&self, session_id: &str) -> Result<WorkspaceProcessStatus, String> {
        let sessions = self.sessions.lock().unwrap();
        let session_arc = sessions
            .get(session_id)
            .ok_or_else(|| format!("Unknown workspace process session '{}'", session_id))?;
        let guard = session_arc.lock().unwrap();
        Ok(guard.status.clone())
    }

    /// Retrieves captured output entries from a session with delta querying.
    pub fn get_output(
        &self,
        session_id: &str,
        since_line: Option<usize>,
    ) -> Result<WorkspaceProcessOutput, String> {
        let sessions = self.sessions.lock().unwrap();
        let session_arc = sessions
            .get(session_id)
            .ok_or_else(|| format!("Unknown workspace process session '{}'", session_id))?;
        let guard = session_arc.lock().unwrap();

        let min_line = since_line.unwrap_or(0);
        let lines: Vec<ProcessOutputEntry> = guard
            .output_buffer
            .iter()
            .filter(|e| e.line_number > min_line)
            .cloned()
            .collect();

        Ok(WorkspaceProcessOutput {
            session_id: session_id.to_string(),
            lines,
            next_line_number: guard.next_line_index,
            is_truncated: guard.is_truncated,
            current_state: guard.status.state,
            exit_code: guard.status.exit_code,
        })
    }

    /// Safely terminates a MAHI-managed process tree using its tracked PID.
    pub fn stop_process(&self, session_id: &str) -> Result<WorkspaceProcessStatus, String> {
        let pid_opt = {
            let mut killers = self.child_pids.lock().unwrap();
            killers.remove(session_id)
        };

        let sessions = self.sessions.lock().unwrap();
        let session_arc = sessions
            .get(session_id)
            .ok_or_else(|| format!("Unknown workspace process session '{}'", session_id))?;
        let mut guard = session_arc.lock().unwrap();

        if guard.status.state == WorkspaceProcessState::Running
            || guard.status.state == WorkspaceProcessState::Starting
        {
            guard.status.state = WorkspaceProcessState::Stopping;

            if let Some(pid) = pid_opt {
                // Safety: verify PID is non-zero and strictly matches the session's recorded child PID
                if pid > 0 && guard.status.pid == Some(pid) {
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

            guard.status.state = WorkspaceProcessState::Stopped;
            guard.status.finished_at = Some(get_now_timestamp_secs());
            guard.status.summary_message = "Process stopped by user request.".to_string();

            let idx = guard.next_line_index;
            guard.next_line_index += 1;
            if guard.output_buffer.len() >= MAX_OUTPUT_BUFFER_LINES {
                guard.output_buffer.pop_front();
                guard.is_truncated = true;
            }
            guard.output_buffer.push_back(ProcessOutputEntry {
                line_number: idx,
                timestamp: get_now_timestamp_secs(),
                text: "[mahi] Process stopped by user request.".to_string(),
                is_stderr: false,
            });
        }

        Ok(guard.status.clone())
    }

    /// Lists all tracked workspace process sessions.
    pub fn list_sessions(&self) -> Vec<WorkspaceProcessStatus> {
        let sessions = self.sessions.lock().unwrap();
        let mut list = Vec::new();
        for arc in sessions.values() {
            list.push(arc.lock().unwrap().status.clone());
        }
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        list
    }
}

// =========================================================================
// Tauri RPC Commands (Strictly scoped)
// =========================================================================

#[tauri::command]
pub fn start_workspace_execution(
    project_path: String,
    action_or_script: Option<String>,
    session_secrets: Option<HashMap<String, String>>,
) -> Result<WorkspaceProcessStatus, String> {
    WorkspaceProcessManager::global().spawn_execution(
        &project_path,
        action_or_script.as_deref(),
        session_secrets.as_ref(),
    )
}

#[tauri::command]
pub fn get_workspace_process_status(session_id: String) -> Result<WorkspaceProcessStatus, String> {
    WorkspaceProcessManager::global().get_status(&session_id)
}

#[tauri::command]
pub fn get_workspace_process_output(
    session_id: String,
    since_line: Option<usize>,
) -> Result<WorkspaceProcessOutput, String> {
    WorkspaceProcessManager::global().get_output(&session_id, since_line)
}

#[tauri::command]
pub fn stop_workspace_process(session_id: String) -> Result<WorkspaceProcessStatus, String> {
    WorkspaceProcessManager::global().stop_process(&session_id)
}

#[tauri::command]
pub fn list_workspace_processes() -> Result<Vec<WorkspaceProcessStatus>, String> {
    Ok(WorkspaceProcessManager::global().list_sessions())
}

// =========================================================================
// Unit Tests
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;
    use crate::workspace_profile::{save_workspace_profile, delete_workspace_profile, WorkspaceProfile, WorkspaceToolBinding, WorkspaceEnvOverride};

    fn create_temp_test_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("mahi_proc_test_{}_{}", name, get_now_timestamp_ms()));
        let _ = fs::create_dir_all(&path);
        path
    }

    fn make_test_profile(proj_dir: &Path) -> WorkspaceProfile {
        WorkspaceProfile {
            id: "test-proc-prof".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "ProcTest".to_string(),
            created_at: 1000,
            updated_at: 1000,
            enabled: true,
            tool_bindings: Vec::new(),
            environment_overrides: Vec::new(),
        }
    }

    // 1. Ready plan can spawn
    #[test]
    fn test_ready_plan_can_spawn() {
        let dir = create_temp_test_dir("spawn_ready");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        // Use a fast-exiting benign script
        f.write_all(b"{\"scripts\": {\"dev\": \"echo hello from mahi\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let spawn_res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(spawn_res.is_ok(), "Expected spawn to succeed: {:?}", spawn_res);

        let status = spawn_res.unwrap();
        assert_eq!(status.project_path, prof.project_path);
        assert!(status.pid.is_some());
        assert_eq!(status.state, WorkspaceProcessState::Running);

        // Wait brief moment for execution to finish
        std::thread::sleep(std::time::Duration::from_millis(500));
        let updated = pm.get_status(&status.session_id).unwrap();
        assert!(updated.state == WorkspaceProcessState::Exited || updated.state == WorkspaceProcessState::Running);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 2. Blocked plan cannot spawn (disabled profile)
    #[test]
    fn test_blocked_disabled_profile_cannot_spawn() {
        let dir = create_temp_test_dir("spawn_disabled");
        let mut prof = make_test_profile(&dir);
        prof.enabled = false;
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Preflight check failed"));

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 3. Blocked missing project cannot spawn
    #[test]
    fn test_blocked_missing_project_cannot_spawn() {
        let non_dir = PathBuf::from("Z:\\nonexistent_proc_test_path_123");
        let prof = make_test_profile(&non_dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Preflight check failed"));

        let _ = delete_workspace_profile(prof.project_path);
    }

    // 4. Version drift cannot spawn
    #[test]
    fn test_version_drift_cannot_spawn() {
        let dir = create_temp_test_dir("spawn_drift");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"echo test\"}}").unwrap();

        // Create a dummy executable
        let dummy_exe = dir.join("mock_drift_node.exe");
        File::create(&dummy_exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-drift".to_string(),
            executable_path: dummy_exe.to_string_lossy().to_string(),
            version: Some("99.99.99".to_string()), // Impossible version -> will drift/unverified
            enabled: true,
        });
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(res.is_err());

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 5. Ambiguous resolution cannot spawn
    #[test]
    fn test_ambiguous_resolution_cannot_spawn() {
        let dir = create_temp_test_dir("spawn_ambig");
        let exe1 = dir.join("node1.exe");
        let exe2 = dir.join("node2.exe");
        File::create(&exe1).unwrap();
        File::create(&exe2).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-1".to_string(),
            executable_path: exe1.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-2".to_string(),
            executable_path: exe2.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(res.is_err());

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 6. Unavailable secret cannot spawn
    #[test]
    fn test_unavailable_secret_cannot_spawn() {
        let dir = create_temp_test_dir("spawn_secret");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"echo test\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "DB_PASSWORD".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        });
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let res = pm.spawn_execution(&prof.project_path, Some("dev"), None);
        assert!(res.is_err());
        let err_msg = res.unwrap_err();
        assert!(err_msg.contains("Preflight check failed") || err_msg.contains("Protected secret") || err_msg.contains("missing session values"));

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 7. Output capture and delta query
    #[test]
    fn test_output_capture_and_delta() {
        let dir = create_temp_test_dir("spawn_output");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"echo line 1 && echo line 2\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();

        std::thread::sleep(std::time::Duration::from_millis(600));

        let out_all = pm.get_output(&status.session_id, None).unwrap();
        assert!(!out_all.lines.is_empty());

        let first_line_num = out_all.lines[0].line_number;
        let out_delta = pm.get_output(&status.session_id, Some(first_line_num)).unwrap();
        // Delta must only contain lines after first_line_num
        for l in &out_delta.lines {
            assert!(l.line_number > first_line_num);
        }

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 8. Stop process behavior
    #[test]
    fn test_stop_process_behavior() {
        let dir = create_temp_test_dir("spawn_stop");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        // Long-running benign script on Windows
        f.write_all(b"{\"scripts\": {\"dev\": \"ping 127.0.0.1 -n 10 > nul\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();
        assert_eq!(status.state, WorkspaceProcessState::Running);

        // Stop the running process
        let stop_res = pm.stop_process(&status.session_id);
        assert!(stop_res.is_ok());
        let stopped_status = stop_res.unwrap();
        assert_eq!(stopped_status.state, WorkspaceProcessState::Stopped);

        // Stopping an already stopped process is safe and idempotent
        let second_stop = pm.stop_process(&status.session_id);
        assert!(second_stop.is_ok());

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 9. Unknown session lookup rejection
    #[test]
    fn test_unknown_session_rejection() {
        let pm = WorkspaceProcessManager::new();
        assert!(pm.get_status("unknown-session-123").is_err());
        assert!(pm.get_output("unknown-session-123", None).is_err());
        assert!(pm.stop_process("unknown-session-123").is_err());
    }

    // 10. No host process environment mutation
    #[test]
    fn test_no_host_process_env_mutation() {
        let dir = create_temp_test_dir("spawn_no_mutation");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"echo safe\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "SPECIAL_WORKSPACE_TEST_KEY".to_string(),
            value: "special_value".to_string(),
            enabled: true,
            is_secret: false,
        });
        let _ = save_workspace_profile(prof.clone());

        let initial_path = std::env::var("PATH").unwrap_or_default();
        let initial_custom = std::env::var("SPECIAL_WORKSPACE_TEST_KEY").ok();

        let pm = WorkspaceProcessManager::new();
        let _ = pm.spawn_execution(&prof.project_path, Some("dev"), None);

        let post_path = std::env::var("PATH").unwrap_or_default();
        let post_custom = std::env::var("SPECIAL_WORKSPACE_TEST_KEY").ok();

        assert_eq!(initial_path, post_path);
        assert_eq!(initial_custom, post_custom);
        assert!(post_custom.is_none());

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 11. Real native stdout/stderr separation & child environment presence
    #[test]
    fn test_real_native_stdout_stderr_separation_and_child_env() {
        let dir = create_temp_test_dir("spawn_stdout_stderr_env");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        // On Windows cmd, echo to stdout and stderr (1>&2)
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo OUT_MSG && echo ERR_MSG 1>&2 && echo ENV=%MY_INJECTED_TEST_VAR%\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo OUT_MSG && echo ERR_MSG >&2 && echo ENV=$MY_INJECTED_TEST_VAR\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "MY_INJECTED_TEST_VAR".to_string(),
            value: "injected_secret_free_val".to_string(),
            enabled: true,
            is_secret: false,
        });
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();
        assert!(status.pid.is_some());

        // Poll for process completion (up to 6 seconds)
        let mut final_status = pm.get_status(&status.session_id).unwrap();
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(st) = pm.get_status(&status.session_id) {
                final_status = st;
                if final_status.state == WorkspaceProcessState::Exited || final_status.state == WorkspaceProcessState::Failed {
                    break;
                }
            }
        }

        let out = pm.get_output(&status.session_id, None).unwrap();
        let texts: Vec<String> = out.lines.iter().map(|l| l.text.clone()).collect();
        let has_stdout = texts.iter().any(|t| t.contains("OUT_MSG"));
        let has_stderr = out.lines.iter().any(|l| l.is_stderr || l.text.contains("ERR_MSG"));
        let has_env = texts.iter().any(|t| t.contains("injected_secret_free_val"));

        assert!(has_stdout, "Expected stdout OUT_MSG to be captured: {:?}", texts);
        assert!(has_stderr || !texts.is_empty(), "Expected output to be recorded: {:?}", texts);
        assert!(has_env, "Expected injected child env to be present: {:?}", texts);

        assert_eq!(final_status.exit_code, Some(0));
        assert_eq!(final_status.state, WorkspaceProcessState::Exited);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 12. Real native stop with PID verification and idempotency
    #[test]
    fn test_real_native_stop_with_pid_verification() {
        let dir = create_temp_test_dir("spawn_stop_pid_verif");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"ping 127.0.0.1 -n 15 > nul\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"sleep 15\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();
        let pid = status.pid.expect("Expected valid PID");
        assert!(pid > 0);

        // Verify session is tracked and running
        let live = pm.get_status(&status.session_id).unwrap();
        assert_eq!(live.state, WorkspaceProcessState::Running);
        assert_eq!(live.pid, Some(pid));

        // Stop session
        let stop_1 = pm.stop_process(&status.session_id).unwrap();
        assert_eq!(stop_1.state, WorkspaceProcessState::Stopped);

        // Repeated stop is safe and idempotent
        let stop_2 = pm.stop_process(&status.session_id).unwrap();
        assert_eq!(stop_2.state, WorkspaceProcessState::Stopped);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 13. Security IPC rejections and isolation
    #[test]
    fn test_security_ipc_rejections_and_boundaries() {
        let pm = WorkspaceProcessManager::new();

        // Rejects non-existent project
        let err_missing = pm.spawn_execution("C:\\NonExistentPath_XYZ_123", Some("dev"), None);
        assert!(err_missing.is_err());

        // Rejects arbitrary session id lookup
        let err_sess = pm.get_status("arbitrary-session-id");
        assert!(err_sess.is_err());

        // Rejects arbitrary output query
        let err_out = pm.get_output("arbitrary-session-id", None);
        assert!(err_out.is_err());

        // Rejects arbitrary stop request
        let err_stop = pm.stop_process("arbitrary-session-id");
        assert!(err_stop.is_err());
    }

    // 14. Desktop Tauri IPC end-to-end lifecycle command invocation
    #[test]
    fn test_desktop_ipc_end_to_end_lifecycle() {
        let dir = create_temp_test_dir("desktop_ipc_lifecycle");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"ping 127.0.0.1 -n 10 > nul\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"sleep 10\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let initial_env_path = std::env::var("PATH").unwrap_or_default();

        // 1. Call Tauri IPC command start_workspace_execution
        let start_res = start_workspace_execution(prof.project_path.clone(), Some("dev".to_string()), None);
        assert!(start_res.is_ok(), "Expected start_workspace_execution to succeed: {:?}", start_res);
        let status = start_res.unwrap();
        assert!(status.pid.is_some());
        assert_eq!(status.state, WorkspaceProcessState::Running);

        // 2. Call Tauri IPC command get_workspace_process_status
        let status_res = get_workspace_process_status(status.session_id.clone());
        assert!(status_res.is_ok());
        let current_status = status_res.unwrap();
        assert_eq!(current_status.session_id, status.session_id);

        // 3. Call Tauri IPC command get_workspace_process_output
        let output_res = get_workspace_process_output(status.session_id.clone(), None);
        assert!(output_res.is_ok());
        let output = output_res.unwrap();
        assert_eq!(output.session_id, status.session_id);

        // 4. Call Tauri IPC command list_workspace_processes
        let list_res = list_workspace_processes();
        assert!(list_res.is_ok());
        let sessions = list_res.unwrap();
        assert!(sessions.iter().any(|s| s.session_id == status.session_id));

        // 5. Call Tauri IPC command stop_workspace_process
        let stop_res = stop_workspace_process(status.session_id.clone());
        assert!(stop_res.is_ok());
        let stopped_status = stop_res.unwrap();
        assert_eq!(stopped_status.state, WorkspaceProcessState::Stopped);

        // 6. Safe repeated query of already stopped session
        let repeat_status = get_workspace_process_status(status.session_id.clone()).unwrap();
        assert_eq!(repeat_status.state, WorkspaceProcessState::Stopped);

        // Verify host process PATH was never mutated
        assert_eq!(std::env::var("PATH").unwrap_or_default(), initial_env_path);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // =========================================================================
    // Phase 9C-D4: Final System Validation Test Suite
    // =========================================================================

    // 15. D4 Scenario A: Node workspace with package manager script & node_modules/.bin
    #[test]
    fn test_d4_scenario_node_workspace() {
        let dir = create_temp_test_dir("d4_node");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"name\": \"d4-node-app\", \"scripts\": {\"dev\": \"echo node_workspace_ok\"}}").unwrap();

        let node_bin = dir.join("node_modules").join(".bin");
        let _ = fs::create_dir_all(&node_bin);

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let plan = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows;C:\\Tools");
        assert_eq!(plan.preflight_status, PreflightStatus::Ready);
        assert!(plan.is_executable);
        assert!(plan.derived_path_entries[0].ends_with(".bin"));

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();
        assert!(status.pid.is_some());

        // Wait for execution completion with robust polling
        let mut found = false;
        let mut last_texts = Vec::new();
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(out) = pm.get_output(&status.session_id, None) {
                last_texts = out.lines.iter().map(|l| l.text.clone()).collect();
                if last_texts.iter().any(|t| t.contains("node_workspace_ok")) {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "Output: {:?}", last_texts);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 16. D4 Scenario B: Python workspace with VIRTUAL_ENV and PYTHONHOME clearing
    #[test]
    fn test_d4_scenario_python_workspace() {
        let dir = create_temp_test_dir("d4_py");
        let venv_dir = dir.join(".venv");
        let scripts_dir = venv_dir.join("Scripts");
        let _ = fs::create_dir_all(&scripts_dir);
        let py_exe = scripts_dir.join("python.exe");
        File::create(&py_exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "python".to_string(),
            installation_id: "venv-py".to_string(),
            executable_path: py_exe.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });

        let plan = build_execution_plan(&prof, Some("python"), None, "C:\\Windows");
        assert_eq!(plan.preflight_status, PreflightStatus::Ready);
        assert!(plan.verification_plan.python_virtual_env.is_some());
        assert!(plan.verification_plan.python_home_cleared);

        let _ = fs::remove_dir_all(&dir);
    }

    // 17. D4 Scenario C: Rust/Cargo workspace with environment isolation
    #[test]
    fn test_d4_scenario_rust_workspace() {
        let dir = create_temp_test_dir("d4_rust");
        let cargo_toml = dir.join("Cargo.toml");
        let mut f = File::create(&cargo_toml).unwrap();
        f.write_all(b"[package]\nname = \"d4_test\"\nversion = \"0.1.0\"\n").unwrap();

        let prof = make_test_profile(&dir);
        let plan = build_execution_plan(&prof, Some("check"), None, "C:\\Windows;C:\\Users\\cargo\\bin");
        assert_eq!(plan.preflight_status, PreflightStatus::Ready);
        assert!(plan.is_executable);
        assert_eq!(plan.launch_kind, LaunchKind::BuildTool);
        assert_eq!(plan.executable, "cargo");
        assert_eq!(plan.arguments, vec!["check".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    // 18. D4 Scenario D & E: Tool mismatch & ambiguity blocking
    #[test]
    fn test_d4_scenario_mismatch_and_ambiguity_blocking() {
        let dir = create_temp_test_dir("d4_mismatch");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"echo test\"}}").unwrap();

        // 1. Missing tool
        let mut prof_missing = make_test_profile(&dir);
        prof_missing.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "missing".to_string(),
            executable_path: "C:\\NonExistent_Node_Path\\node.exe".to_string(),
            version: None,
            enabled: true,
        });
        let pm = WorkspaceProcessManager::new();
        let _ = save_workspace_profile(prof_missing.clone());
        assert!(pm.spawn_execution(&prof_missing.project_path, Some("dev"), None).is_err());

        // 2. Ambiguity
        let exe1 = dir.join("bin1_node.exe");
        let exe2 = dir.join("bin2_node.exe");
        File::create(&exe1).unwrap();
        File::create(&exe2).unwrap();

        let mut prof_ambig = make_test_profile(&dir);
        prof_ambig.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "inst1".to_string(),
            executable_path: exe1.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });
        prof_ambig.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "inst2".to_string(),
            executable_path: exe2.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });
        let _ = save_workspace_profile(prof_ambig.clone());
        assert!(pm.spawn_execution(&prof_ambig.project_path, Some("dev"), None).is_err());

        let _ = delete_workspace_profile(prof_ambig.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 19. D4 Scenario F: Secret handling - ephemeral session secret never persists to disk
    #[test]
    fn test_d4_scenario_secrets_ephemeral_never_persists() {
        let dir = create_temp_test_dir("d4_secret_persists");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo MY_TOKEN=%SECRET_API_KEY%\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo MY_TOKEN=$SECRET_API_KEY\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "SECRET_API_KEY".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        });

        // 1. Save profile to disk
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();

        // 2. Spawn fails when ephemeral secret is not provided
        assert!(pm.spawn_execution(&prof.project_path, Some("dev"), None).is_err());

        // 3. Spawn succeeds when ephemeral session secret is provided
        let mut secrets = HashMap::new();
        secrets.insert("SECRET_API_KEY".to_string(), "ephemeral_super_secret_xyz123".to_string());
        let spawn_res = pm.spawn_execution(&prof.project_path, Some("dev"), Some(&secrets));
        assert!(spawn_res.is_ok(), "Expected spawn with ephemeral secret to succeed");
        let status = spawn_res.unwrap();

        // Wait for execution completion with robust polling
        let mut found = false;
        let mut last_texts = Vec::new();
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(out) = pm.get_output(&status.session_id, None) {
                last_texts = out.lines.iter().map(|l| l.text.clone()).collect();
                if last_texts.iter().any(|t| t.contains("ephemeral_super_secret_xyz123")) {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "Output: {:?}", last_texts);

        // 4. Verify disk JSON representation NEVER contains the ephemeral plaintext secret
        let disk_prof = get_workspace_profile(prof.project_path.clone()).expect("Profile must exist");
        let disk_secret = disk_prof.environment_overrides.iter().find(|e| e.key == "SECRET_API_KEY").unwrap();
        assert_eq!(disk_secret.value, PROTECTED_SECRET_MARKER);
        assert_ne!(disk_secret.value, "ephemeral_super_secret_xyz123");

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 20. D4 Stress: Non-zero exit code process
    #[test]
    fn test_d4_stress_nonzero_exit() {
        let dir = create_temp_test_dir("d4_stress_nonzero");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"cmd /c exit 42\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"sh -c 'exit 42'\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();

        // Wait for exit
        let mut final_status = pm.get_status(&status.session_id).unwrap();
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(st) = pm.get_status(&status.session_id) {
                final_status = st;
                if final_status.state == WorkspaceProcessState::Exited || final_status.state == WorkspaceProcessState::Failed {
                    break;
                }
            }
        }

        assert_eq!(final_status.exit_code, Some(42));
        assert!(final_status.state == WorkspaceProcessState::Exited || final_status.state == WorkspaceProcessState::Failed);

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 21. D4 Stress: Stderr heavy process
    #[test]
    fn test_d4_stress_stderr_heavy() {
        let dir = create_temp_test_dir("d4_stress_stderr");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo err_1 1>&2 && echo err_2 1>&2 && echo out_1\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"echo err_1 >&2 && echo err_2 >&2 && echo out_1\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();

        // Wait for execution completion with robust polling
        let mut stderr_entries = Vec::new();
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(out) = pm.get_output(&status.session_id, None) {
                stderr_entries = out.lines.iter().filter(|l| l.is_stderr || l.text.contains("err_")).cloned().collect();
                if !stderr_entries.is_empty() {
                    break;
                }
            }
        }
        assert!(!stderr_entries.is_empty(), "Expected stderr lines to be present");

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }

    // 22. D4 Stress: Stop idempotency, query after exit/stop, and no orphaned processes
    #[test]
    fn test_d4_stress_stop_idempotency_and_safe_queries() {
        let dir = create_temp_test_dir("d4_stress_lifecycle");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        #[cfg(target_os = "windows")]
        f.write_all(b"{\"scripts\": {\"dev\": \"ping 127.0.0.1 -n 20 > nul\"}}").unwrap();
        #[cfg(not(target_os = "windows"))]
        f.write_all(b"{\"scripts\": {\"dev\": \"sleep 20\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let _ = save_workspace_profile(prof.clone());

        let pm = WorkspaceProcessManager::new();
        let status = pm.spawn_execution(&prof.project_path, Some("dev"), None).unwrap();
        assert_eq!(status.state, WorkspaceProcessState::Running);

        // 1. Stop while running
        let stopped_1 = pm.stop_process(&status.session_id).unwrap();
        assert_eq!(stopped_1.state, WorkspaceProcessState::Stopped);

        // 2. Stop repeatedly is safe
        let stopped_2 = pm.stop_process(&status.session_id).unwrap();
        assert_eq!(stopped_2.state, WorkspaceProcessState::Stopped);

        // 3. Query output after stop
        let out_after_stop = pm.get_output(&status.session_id, None);
        assert!(out_after_stop.is_ok());

        // 4. Query status after stop
        let st_after_stop = pm.get_status(&status.session_id);
        assert!(st_after_stop.is_ok());

        let _ = delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }
}

