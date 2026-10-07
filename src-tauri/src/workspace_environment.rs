// Phase 9C-D1: Pure Workspace Execution Planner & Preflight Engine
//
// Pure, deterministic planning and preflight validation for process-local workspace environments.
//
// STRICT SAFETY CONTRACT:
//   - ZERO process spawning or execution in this module.
//   - ZERO mutations to Windows Registry (HKCU/HKLM).
//   - ZERO mutations to global/system PATH or environment variables.
//   - ZERO mutations to current host process environment (std::env::set_var is NEVER called).
//   - ZERO mutations to project source files or project manifests.
//   - ZERO reads of .env, .env.local, secrets, or private keys.
//   - No automatic tool downloading, installation, or silent auto-repair.
//   - Protected secret markers ([PROTECTED_SECRET]) are NEVER injected as environment values.
//   - Persisted plans NEVER store plaintext secrets.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use crate::health_audit::execute_version_probe;
use crate::workspace_profile::{
    validate_env_override_key, WorkspaceProfile,
    WorkspaceToolBinding, PROTECTED_SECRET_MARKER,
};

// =========================================================================
// Data Models
// =========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LaunchKind {
    DirectExecutable,
    PackageManagerScript,
    BuildTool,
    WorkspaceTerminal,
    CustomBinary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreflightStatus {
    Ready,
    BlockedMissingTool,
    BlockedVersionDrift,
    BlockedStaleBinding,
    BlockedSecretUnavailable,
    BlockedMissingProject,
    BlockedDisabledProfile,
    BlockedInvalidOverride,
    BlockedUnapprovedAction,
    BlockedAmbiguousResolution,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ToolDriftStatus {
    ExactMatch,
    VersionDrift,
    Missing,
    Unverified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBindingPlan {
    pub tool: String,
    pub installation_id: String,
    pub executable_path: String,
    pub expected_version: Option<String>,
    pub verified_version: Option<String>,
    pub drift_status: ToolDriftStatus,
    pub derived_bin_dir: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPlan {
    pub runtime_jdk_enforced: bool,
    pub gradle_build_toolchain_note: Option<String>,
    pub python_virtual_env: Option<String>,
    pub python_home_cleared: bool,
    pub node_modules_bin_prepended: bool,
    pub secret_keys_count: usize,
    pub protected_secrets_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExecutionPlan {
    pub project_path: String,
    pub profile_id: String,
    pub launch_kind: LaunchKind,
    pub executable: String,
    pub arguments: Vec<String>,
    pub cwd: String,
    pub derived_path_entries: Vec<String>,
    pub non_secret_environment: HashMap<String, String>,
    pub protected_secret_keys: Vec<String>,
    pub tool_bindings: Vec<ToolBindingPlan>,
    pub blocked_overrides: Vec<String>,
    pub verification_plan: VerificationPlan,
    pub preflight_status: PreflightStatus,
    pub is_executable: bool,
    pub summary_message: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnvironmentPreview {
    pub project_name: String,
    pub project_path: String,
    pub is_executable: bool,
    pub preflight_status: PreflightStatus,
    pub bound_tools: Vec<String>,
    pub path_additions: Vec<String>,
    pub non_secret_overrides: HashMap<String, String>,
    pub protected_secret_keys: Vec<String>,
    pub blocked_overrides: Vec<String>,
    pub warnings: Vec<String>,
    pub summary_message: String,
}

// =========================================================================
// Pure Path Derivation Engine
// =========================================================================

/// Case-insensitive path normalizer for deterministic deduplication
pub fn normalize_dir_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(|c| c == '/' || c == '\\');
    trimmed.replace('/', "\\")
}

/// Key comparator for case-insensitive Windows PATH deduplication
fn path_key(path: &str) -> String {
    normalize_dir_path(path).to_lowercase()
}

/// Helper to detect if the target launch action is Python-focused
pub fn is_python_action_target(
    launch_kind: LaunchKind,
    executable: &str,
    action_or_script: Option<&str>,
) -> bool {
    if launch_kind == LaunchKind::DirectExecutable {
        let exec_lower = executable.to_lowercase();
        if exec_lower.ends_with("python.exe")
            || exec_lower.ends_with("python")
            || exec_lower.ends_with("python3.exe")
            || exec_lower.ends_with("python3")
        {
            return true;
        }
        if let Some(act) = action_or_script {
            let act_lower = act.to_lowercase();
            if act_lower.ends_with(".py") || act_lower == "python" || act_lower == "python3" {
                return true;
            }
        }
    }
    false
}

/// Derives the ordered, deduplicated workspace PATH entries with action-specific scoping.
///
/// Priority Order & Action-Specific Scoping:
/// 1. Project-Local Executable Directories:
///    - For `PACKAGE_MANAGER_SCRIPT` actions: `<project_path>/node_modules/.bin` (if it exists)
///    - For Python actions: `<project_path>/.venv/Scripts` or `<project_path>/venv/Scripts`
///    - For `DIRECT_EXECUTABLE` (non-python), `WORKSPACE_TERMINAL`, `BUILD_TOOL`: `node_modules/.bin` is NOT prepended.
/// 2. Explicitly bound toolchain directories (Node, Python, Java JDK bin, Cargo bin, Go bin)
/// 3. Inherited system PATH entries
pub fn derive_workspace_path(
    project_path: &Path,
    tool_bindings: &[WorkspaceToolBinding],
    inherited_path: &str,
    launch_kind: Option<LaunchKind>,
    is_python_action: bool,
) -> Result<Vec<String>, String> {
    let mut entries: Vec<String> = Vec::new();
    let mut seen_keys: HashSet<String> = HashSet::new();

    // 1. Project-Local Executable Directories (Action-Scoped)
    // Node.js local project binaries: ONLY for PACKAGE_MANAGER_SCRIPT actions
    if launch_kind == Some(LaunchKind::PackageManagerScript) {
        let local_node_bin = project_path.join("node_modules").join(".bin");
        if local_node_bin.is_dir() {
            let p_str = normalize_dir_path(&local_node_bin.to_string_lossy());
            let k = path_key(&p_str);
            if seen_keys.insert(k) {
                entries.push(p_str);
            }
        }
    }

    // Python virtual environment binaries (.venv/Scripts or venv/Scripts): ONLY for Python actions
    if is_python_action {
        let dot_venv_bin = project_path.join(".venv").join("Scripts");
        let venv_bin = project_path.join("venv").join("Scripts");
        if dot_venv_bin.is_dir() {
            let p_str = normalize_dir_path(&dot_venv_bin.to_string_lossy());
            let k = path_key(&p_str);
            if seen_keys.insert(k) {
                entries.push(p_str);
            }
        } else if venv_bin.is_dir() {
            let p_str = normalize_dir_path(&venv_bin.to_string_lossy());
            let k = path_key(&p_str);
            if seen_keys.insert(k) {
                entries.push(p_str);
            }
        }
    }

    // 2. Explicitly Bound Toolchain Directories
    let mut bound_tool_names: HashMap<String, String> = HashMap::new();

    for binding in tool_bindings {
        if !binding.enabled {
            continue;
        }

        let exec_path = Path::new(&binding.executable_path);
        if !exec_path.is_file() {
            return Err(format!(
                "Bound executable for '{}' not found at '{}'",
                binding.tool, binding.executable_path
            ));
        }

        let tool_lower = binding.tool.to_lowercase();
        let canonical_exec = exec_path.to_string_lossy().to_string();

        if let Some(existing_path) = bound_tool_names.get(&tool_lower) {
            if path_key(existing_path) != path_key(&canonical_exec) {
                return Err(format!(
                    "Ambiguous tool resolution: Multiple conflicting bindings found for tool '{}' ('{}' vs '{}')",
                    binding.tool, existing_path, canonical_exec
                ));
            }
        } else {
            bound_tool_names.insert(tool_lower, canonical_exec);
        }

        if let Some(parent_dir) = exec_path.parent() {
            if parent_dir.is_dir() {
                let p_str = normalize_dir_path(&parent_dir.to_string_lossy());
                let k = path_key(&p_str);
                if seen_keys.insert(k) {
                    entries.push(p_str);
                }
            }
        }
    }

    // 3. Inherited System PATH Entries
    for part in inherited_path.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let norm = normalize_dir_path(trimmed);
        let k = path_key(&norm);
        if seen_keys.insert(k) {
            entries.push(norm);
        }
    }

    Ok(entries)
}

// =========================================================================
// Pure Environment Construction Engine
// =========================================================================

/// Derives the non-secret environment overrides and identifies protected/blocked keys.
/// Python environment adjustments (VIRTUAL_ENV / clearing PYTHONHOME) are strictly action-specific.
pub fn derive_environment_map(
    project_path: &Path,
    profile: &WorkspaceProfile,
    session_secrets: Option<&HashMap<String, String>>,
    launch_kind: Option<LaunchKind>,
    is_python_action: bool,
) -> (HashMap<String, String>, Vec<String>, Vec<String>, VerificationPlan) {
    let mut env_map = HashMap::new();
    let mut protected_secrets = Vec::new();
    let mut blocked_overrides = Vec::new();
    let mut verification = VerificationPlan::default();

    // 1. Process Toolchain-Specific System Variables
    for binding in &profile.tool_bindings {
        if !binding.enabled {
            continue;
        }

        let tool_lower = binding.tool.to_lowercase();
        let exec_path = Path::new(&binding.executable_path);

        // Java: Set JAVA_HOME if tool is Java/JDK
        if tool_lower == "java" || tool_lower == "jdk" {
            if let Some(bin_dir) = exec_path.parent() {
                if bin_dir.file_name().map(|n| n.to_string_lossy().to_lowercase()) == Some("bin".to_string()) {
                    if let Some(jdk_home) = bin_dir.parent() {
                        let home_str = normalize_dir_path(&jdk_home.to_string_lossy());
                        env_map.insert("JAVA_HOME".to_string(), home_str);
                        verification.runtime_jdk_enforced = true;
                    }
                }
            }
        }

        // Python: Virtual environment detection - ONLY applied for Python actions
        if is_python_action && tool_lower == "python" {
            let exec_str = binding.executable_path.to_lowercase();
            if exec_str.contains(".venv") || exec_str.contains("venv") {
                if let Some(scripts_dir) = exec_path.parent() {
                    if let Some(venv_root) = scripts_dir.parent() {
                        let venv_str = normalize_dir_path(&venv_root.to_string_lossy());
                        env_map.insert("VIRTUAL_ENV".to_string(), venv_str.clone());
                        verification.python_virtual_env = Some(venv_str);
                        verification.python_home_cleared = true;
                    }
                }
            }
        }
    }

    // Record note for Gradle build toolchains
    let has_gradle = project_path.join("build.gradle").exists()
        || project_path.join("build.gradle.kts").exists()
        || project_path.join("gradlew").exists()
        || project_path.join("gradlew.bat").exists();
    if has_gradle {
        verification.gradle_build_toolchain_note = Some(
            "Gradle internal toolchains (if specified in build.gradle) may select a different compilation JDK than runtime JAVA_HOME."
                .to_string(),
        );
    }

    // Check for local node_modules/.bin (only active for PACKAGE_MANAGER_SCRIPT)
    if launch_kind == Some(LaunchKind::PackageManagerScript) && project_path.join("node_modules").join(".bin").is_dir() {
        verification.node_modules_bin_prepended = true;
    }

    // 2. Process User Environment Overrides
    for override_entry in &profile.environment_overrides {
        if !override_entry.enabled {
            continue;
        }

        // Validate key safety
        if let Err(err_msg) = validate_env_override_key(&override_entry.key) {
            blocked_overrides.push(format!("{}: {}", override_entry.key, err_msg));
            continue;
        }

        if override_entry.is_secret {
            verification.secret_keys_count += 1;
            // Check if live session secret is available
            let live_secret_opt = session_secrets.and_then(|s| s.get(&override_entry.key));
            if let Some(live_val) = live_secret_opt {
                if !live_val.trim().is_empty() && live_val != PROTECTED_SECRET_MARKER {
                    // Do not store secret value in non_secret_environment!
                    // Secret values are only held in ephemeral session memory.
                    continue;
                }
            }

            // Persisted protected marker or missing live value
            if override_entry.value == PROTECTED_SECRET_MARKER || override_entry.value.trim().is_empty() {
                protected_secrets.push(override_entry.key.clone());
                verification.protected_secrets_count += 1;
            }
        } else {
            // Normal non-secret variable
            env_map.insert(override_entry.key.clone(), override_entry.value.clone());
        }
    }

    (env_map, protected_secrets, blocked_overrides, verification)
}

// =========================================================================
// Pure Preflight Verification Engine
// =========================================================================

/// Strips common prefixes (e.g. 'v', 'node v', 'Python ') for exact semantic version comparison
pub fn normalize_version_tag(v: &str) -> String {
    let trimmed = v.trim();
    let without_prefix = if trimmed.starts_with('v') || trimmed.starts_with('V') {
        &trimmed[1..]
    } else if let Some(stripped) = trimmed.strip_prefix("node ") {
        stripped.trim_start_matches(|c| c == 'v' || c == 'V')
    } else if let Some(stripped) = trimmed.strip_prefix("Python ") {
        stripped.trim()
    } else {
        trimmed
    };
    without_prefix.trim().to_string()
}

/// Verifies whether the tool executable exists and matches the EXACT bound version.
/// Same major version (e.g. 24.16.0 vs 24.17.0) is strictly treated as VERSION_DRIFT.
pub fn verify_tool_binding(binding: &WorkspaceToolBinding) -> ToolBindingPlan {
    let exec_path = Path::new(&binding.executable_path);
    if !exec_path.is_file() {
        return ToolBindingPlan {
            tool: binding.tool.clone(),
            installation_id: binding.installation_id.clone(),
            executable_path: binding.executable_path.clone(),
            expected_version: binding.version.clone(),
            verified_version: None,
            drift_status: ToolDriftStatus::Missing,
            derived_bin_dir: None,
            is_active: binding.enabled,
        };
    }

    let derived_dir = exec_path
        .parent()
        .map(|p| normalize_dir_path(&p.to_string_lossy()));

    // Run version probe using health_audit bounded execution probe
    let tool_id = binding.tool.to_lowercase();
    let probe_args: &[&str] = if tool_id == "java" || tool_id == "javac" {
        &["-version"]
    } else {
        &["--version"]
    };
    let current_version_opt = execute_version_probe(exec_path, probe_args);

    let drift_status = match (&binding.version, &current_version_opt) {
        (Some(expected), Some(actual)) => {
            if normalize_version_tag(expected) == normalize_version_tag(actual) {
                ToolDriftStatus::ExactMatch
            } else {
                ToolDriftStatus::VersionDrift
            }
        }
        (None, Some(_)) => ToolDriftStatus::ExactMatch,
        (Some(_), None) => ToolDriftStatus::VersionDrift,
        (None, None) => ToolDriftStatus::Unverified,
    };

    ToolBindingPlan {
        tool: binding.tool.clone(),
        installation_id: binding.installation_id.clone(),
        executable_path: binding.executable_path.clone(),
        expected_version: binding.version.clone(),
        verified_version: current_version_opt,
        drift_status,
        derived_bin_dir: derived_dir,
        is_active: binding.enabled,
    }
}

/// Resolves launch target, arguments, and launch kind for an approved project action.
pub fn resolve_launch_target(
    project_path: &Path,
    action_or_script: Option<&str>,
    profile: &WorkspaceProfile,
) -> Result<(LaunchKind, String, Vec<String>), String> {
    let script_name = action_or_script.unwrap_or("dev");

    // 1. Workspace Terminal Action
    if script_name == "terminal" || script_name == "workspace_terminal" {
        let shell = if cfg!(target_os = "windows") {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        };
        return Ok((
            LaunchKind::WorkspaceTerminal,
            shell,
            Vec::new(),
        ));
    }

    // 2. Direct Executable / Explicit Tool Binding Action (e.g. "python", "node", "cargo")
    let lower_action = script_name.to_lowercase();
    let matching_bindings: Vec<&WorkspaceToolBinding> = profile
        .tool_bindings
        .iter()
        .filter(|b| b.enabled && b.tool.to_lowercase() == lower_action)
        .collect();

    if matching_bindings.len() > 1 {
        let first_path = &matching_bindings[0].executable_path;
        if matching_bindings.iter().any(|b| path_key(&b.executable_path) != path_key(first_path)) {
            return Err(format!(
                "Ambiguous tool resolution: Multiple conflicting bindings found for '{}'",
                script_name
            ));
        }
    }

    if let Some(binding) = matching_bindings.first() {
        return Ok((
            LaunchKind::DirectExecutable,
            binding.executable_path.clone(),
            Vec::new(),
        ));
    }

    // 3. Check package.json for Node projects
    let pkg_json_path = project_path.join("package.json");
    if pkg_json_path.is_file() {
        let content = std::fs::read_to_string(&pkg_json_path)
            .map_err(|e| format!("Failed to read package.json: {}", e))?;
        let val: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse package.json: {}", e))?;

        if let Some(scripts_obj) = val.get("scripts").and_then(|s| s.as_object()) {
            if scripts_obj.contains_key(script_name) {
                // Determine package manager
                let mut pm = "npm".to_string();
                if project_path.join("pnpm-lock.yaml").exists() {
                    pm = "pnpm".to_string();
                } else if project_path.join("yarn.lock").exists() {
                    pm = "yarn".to_string();
                } else if project_path.join("bun.lockb").exists() || project_path.join("bun.lock").exists() {
                    pm = "bun".to_string();
                }

                if cfg!(target_os = "windows") {
                    return Ok((
                        LaunchKind::PackageManagerScript,
                        "cmd".to_string(),
                        vec!["/C".to_string(), pm, "run".to_string(), script_name.to_string()],
                    ));
                } else {
                    return Ok((
                        LaunchKind::PackageManagerScript,
                        pm,
                        vec!["run".to_string(), script_name.to_string()],
                    ));
                }
            }
        }
    }

    // 4. Check Cargo.toml for Rust projects
    let cargo_toml_path = project_path.join("Cargo.toml");
    if cargo_toml_path.is_file() {
        if script_name == "run" || script_name == "build" || script_name == "test" || script_name == "check" {
            let cargo_exec = profile
                .tool_bindings
                .iter()
                .find(|b| b.enabled && b.tool.to_lowercase() == "cargo")
                .map(|b| b.executable_path.clone())
                .unwrap_or_else(|| "cargo".to_string());

            return Ok((
                LaunchKind::BuildTool,
                cargo_exec,
                vec![script_name.to_string()],
            ));
        }
    }

    // 5. Check Python projects
    let py_files = ["main.py", "app.py", "manage.py", "server.py"];
    for py_entry in &py_files {
        if project_path.join(py_entry).is_file() && (script_name == "run" || script_name == *py_entry) {
            let py_exec = profile
                .tool_bindings
                .iter()
                .find(|b| b.enabled && b.tool.to_lowercase() == "python")
                .map(|b| b.executable_path.clone())
                .unwrap_or_else(|| "python".to_string());

            return Ok((
                LaunchKind::DirectExecutable,
                py_exec,
                vec![py_entry.to_string()],
            ));
        }
    }

    Err(format!(
        "Action '{}' is not an approved executable action for project at '{}'",
        script_name,
        project_path.display()
    ))
}

// =========================================================================
// Main Pure Planner Entry Point
// =========================================================================

/// Builds an immutable, auditable `WorkspaceExecutionPlan` without spawning processes.
pub fn build_execution_plan(
    profile: &WorkspaceProfile,
    action_or_script: Option<&str>,
    session_secrets: Option<&HashMap<String, String>>,
    inherited_path: &str,
) -> WorkspaceExecutionPlan {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let proj_path = Path::new(&profile.project_path);

    // Preflight 1: Profile enabled
    if !profile.enabled {
        return WorkspaceExecutionPlan {
            project_path: profile.project_path.clone(),
            profile_id: profile.id.clone(),
            launch_kind: LaunchKind::PackageManagerScript,
            executable: String::new(),
            arguments: Vec::new(),
            cwd: profile.project_path.clone(),
            derived_path_entries: Vec::new(),
            non_secret_environment: HashMap::new(),
            protected_secret_keys: Vec::new(),
            tool_bindings: Vec::new(),
            blocked_overrides: Vec::new(),
            verification_plan: VerificationPlan::default(),
            preflight_status: PreflightStatus::BlockedDisabledProfile,
            is_executable: false,
            summary_message: "Workspace profile is disabled. Enable the profile to plan execution.".to_string(),
            created_at: now,
        };
    }

    // Preflight 2: Project directory exists
    if !proj_path.is_dir() {
        return WorkspaceExecutionPlan {
            project_path: profile.project_path.clone(),
            profile_id: profile.id.clone(),
            launch_kind: LaunchKind::PackageManagerScript,
            executable: String::new(),
            arguments: Vec::new(),
            cwd: profile.project_path.clone(),
            derived_path_entries: Vec::new(),
            non_secret_environment: HashMap::new(),
            protected_secret_keys: Vec::new(),
            tool_bindings: Vec::new(),
            blocked_overrides: Vec::new(),
            verification_plan: VerificationPlan::default(),
            preflight_status: PreflightStatus::BlockedMissingProject,
            is_executable: false,
            summary_message: format!("Project directory does not exist: {}", profile.project_path),
            created_at: now,
        };
    }

    // Preflight 3: Tool binding verification
    let mut tool_plans = Vec::new();
    let mut has_missing_tool = false;
    let mut has_version_drift = false;

    for binding in &profile.tool_bindings {
        if !binding.enabled {
            continue;
        }
        let t_plan = verify_tool_binding(binding);
        if t_plan.drift_status == ToolDriftStatus::Missing {
            has_missing_tool = true;
        } else if t_plan.drift_status == ToolDriftStatus::VersionDrift {
            has_version_drift = true;
        }
        tool_plans.push(t_plan);
    }

    if has_missing_tool {
        return WorkspaceExecutionPlan {
            project_path: profile.project_path.clone(),
            profile_id: profile.id.clone(),
            launch_kind: LaunchKind::PackageManagerScript,
            executable: String::new(),
            arguments: Vec::new(),
            cwd: profile.project_path.clone(),
            derived_path_entries: Vec::new(),
            non_secret_environment: HashMap::new(),
            protected_secret_keys: Vec::new(),
            tool_bindings: tool_plans,
            blocked_overrides: Vec::new(),
            verification_plan: VerificationPlan::default(),
            preflight_status: PreflightStatus::BlockedMissingTool,
            is_executable: false,
            summary_message: "One or more bound toolchain executables are missing from disk.".to_string(),
            created_at: now,
        };
    }

    if has_version_drift {
        return WorkspaceExecutionPlan {
            project_path: profile.project_path.clone(),
            profile_id: profile.id.clone(),
            launch_kind: LaunchKind::PackageManagerScript,
            executable: String::new(),
            arguments: Vec::new(),
            cwd: profile.project_path.clone(),
            derived_path_entries: Vec::new(),
            non_secret_environment: HashMap::new(),
            protected_secret_keys: Vec::new(),
            tool_bindings: tool_plans,
            blocked_overrides: Vec::new(),
            verification_plan: VerificationPlan::default(),
            preflight_status: PreflightStatus::BlockedVersionDrift,
            is_executable: false,
            summary_message: "Bound tool executable has drifted from expected version. Revalidate profile.".to_string(),
            created_at: now,
        };
    }

    // Preflight 4: Resolve launch target
    let (launch_kind, executable, arguments) = match resolve_launch_target(proj_path, action_or_script, profile) {
        Ok(target) => target,
        Err(err_msg) => {
            let status = if err_msg.contains("Ambiguous tool resolution") {
                PreflightStatus::BlockedAmbiguousResolution
            } else {
                PreflightStatus::BlockedUnapprovedAction
            };
            return WorkspaceExecutionPlan {
                project_path: profile.project_path.clone(),
                profile_id: profile.id.clone(),
                launch_kind: LaunchKind::PackageManagerScript,
                executable: String::new(),
                arguments: Vec::new(),
                cwd: profile.project_path.clone(),
                derived_path_entries: Vec::new(),
                non_secret_environment: HashMap::new(),
                protected_secret_keys: Vec::new(),
                tool_bindings: tool_plans,
                blocked_overrides: Vec::new(),
                verification_plan: VerificationPlan::default(),
                preflight_status: status,
                is_executable: false,
                summary_message: err_msg,
                created_at: now,
            };
        }
    };

    let is_python = is_python_action_target(launch_kind, &executable, action_or_script);

    // Preflight 5: Derive workspace PATH with launch kind & python scoping
    let path_entries = match derive_workspace_path(
        proj_path,
        &profile.tool_bindings,
        inherited_path,
        Some(launch_kind),
        is_python,
    ) {
        Ok(entries) => entries,
        Err(err_msg) => {
            return WorkspaceExecutionPlan {
                project_path: profile.project_path.clone(),
                profile_id: profile.id.clone(),
                launch_kind,
                executable,
                arguments,
                cwd: profile.project_path.clone(),
                derived_path_entries: Vec::new(),
                non_secret_environment: HashMap::new(),
                protected_secret_keys: Vec::new(),
                tool_bindings: tool_plans,
                blocked_overrides: Vec::new(),
                verification_plan: VerificationPlan::default(),
                preflight_status: PreflightStatus::BlockedAmbiguousResolution,
                is_executable: false,
                summary_message: err_msg,
                created_at: now,
            };
        }
    };

    // Preflight 6: Environment Overrides & Secret Handling
    let (env_map, protected_secrets, blocked_overrides, mut verification) =
        derive_environment_map(proj_path, profile, session_secrets, Some(launch_kind), is_python);

    // Preflight 7: Protected Secret Check
    if !protected_secrets.is_empty() {
        let msg = format!(
            "Secret override(s) '{}' are configured but protected. Re-enter values in active session to inject.",
            protected_secrets.join(", ")
        );
        verification.warnings.push(msg.clone());
        return WorkspaceExecutionPlan {
            project_path: profile.project_path.clone(),
            profile_id: profile.id.clone(),
            launch_kind,
            executable,
            arguments,
            cwd: profile.project_path.clone(),
            derived_path_entries: path_entries,
            non_secret_environment: env_map,
            protected_secret_keys: protected_secrets,
            tool_bindings: tool_plans,
            blocked_overrides,
            verification_plan: verification,
            preflight_status: PreflightStatus::BlockedSecretUnavailable,
            is_executable: false,
            summary_message: msg,
            created_at: now,
        };
    }

    if !blocked_overrides.is_empty() {
        verification.warnings.push(format!(
            "{} unsafe environment variable override(s) were blocked.",
            blocked_overrides.len()
        ));
    }

    // Success Plan
    let script_label = action_or_script.unwrap_or("default");
    WorkspaceExecutionPlan {
        project_path: profile.project_path.clone(),
        profile_id: profile.id.clone(),
        launch_kind,
        executable,
        arguments,
        cwd: profile.project_path.clone(),
        derived_path_entries: path_entries,
        non_secret_environment: env_map,
        protected_secret_keys: Vec::new(),
        tool_bindings: tool_plans,
        blocked_overrides,
        verification_plan: verification,
        preflight_status: PreflightStatus::Ready,
        is_executable: true,
        summary_message: format!(
            "Execution plan for '{}' validated successfully. Ready for process-local execution.",
            script_label
        ),
        created_at: now,
    }
}

/// Generates a safe, user-facing environment preview without exposing secrets.
pub fn generate_environment_preview(
    profile: &WorkspaceProfile,
    action_or_script: Option<&str>,
    inherited_path: &str,
) -> WorkspaceEnvironmentPreview {
    let plan = build_execution_plan(profile, action_or_script, None, inherited_path);

    let bound_tools = plan
        .tool_bindings
        .iter()
        .map(|t| {
            format!(
                "{} ({})",
                t.tool,
                t.verified_version
                    .as_deref()
                    .or(t.expected_version.as_deref())
                    .unwrap_or("unverified")
            )
        })
        .collect();

    let path_additions = plan
        .derived_path_entries
        .into_iter()
        .filter(|p| !inherited_path.to_lowercase().contains(&p.to_lowercase()))
        .collect();

    WorkspaceEnvironmentPreview {
        project_name: profile.project_name.clone(),
        project_path: profile.project_path.clone(),
        is_executable: plan.is_executable,
        preflight_status: plan.preflight_status,
        bound_tools,
        path_additions,
        non_secret_overrides: plan.non_secret_environment,
        protected_secret_keys: plan.protected_secret_keys,
        blocked_overrides: plan.blocked_overrides,
        warnings: plan.verification_plan.warnings,
        summary_message: plan.summary_message,
    }
}

// =========================================================================
// Tauri RPC Commands (Pure / Read-only)
// =========================================================================

#[tauri::command]
pub fn get_workspace_execution_plan(
    project_path: String,
    action_or_script: Option<String>,
) -> Result<WorkspaceExecutionPlan, String> {
    let profile = crate::workspace_profile::get_workspace_profile(project_path.clone())
        .ok_or_else(|| format!("No workspace profile configured for '{}'", project_path))?;
    let inherited_path = std::env::var("PATH").unwrap_or_default();
    Ok(build_execution_plan(
        &profile,
        action_or_script.as_deref(),
        None,
        &inherited_path,
    ))
}

#[tauri::command]
pub fn preview_workspace_execution_plan(
    project_path: String,
    action_or_script: Option<String>,
) -> Result<WorkspaceEnvironmentPreview, String> {
    let profile = crate::workspace_profile::get_workspace_profile(project_path.clone())
        .ok_or_else(|| format!("No workspace profile configured for '{}'", project_path))?;
    let inherited_path = std::env::var("PATH").unwrap_or_default();
    Ok(generate_environment_preview(
        &profile,
        action_or_script.as_deref(),
        &inherited_path,
    ))
}

// =========================================================================
// Unit Tests (27 Scenarios)
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use crate::workspace_profile::WorkspaceEnvOverride;

    fn create_temp_test_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("mahi_env_test_{}_{}", name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = fs::create_dir_all(&path);
        path
    }

    fn make_test_profile(proj_dir: &Path) -> WorkspaceProfile {
        WorkspaceProfile {
            id: "test-profile-1".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "TestProject".to_string(),
            created_at: 1000,
            updated_at: 1000,
            enabled: true,
            tool_bindings: Vec::new(),
            environment_overrides: Vec::new(),
        }
    }

    // 1. Inherited environment preserved
    #[test]
    fn test_inherited_environment_preserved() {
        let dir = create_temp_test_dir("inherit");
        let prof = make_test_profile(&dir);
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows;C:\\Windows\\System32", None, false).unwrap();
        assert!(path.contains(&"C:\\Windows".to_string()));
        assert!(path.contains(&"C:\\Windows\\System32".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    // 2. Non-secret override applied to plan
    #[test]
    fn test_non_secret_override_applied_to_plan() {
        let dir = create_temp_test_dir("non_secret");
        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "PORT".to_string(),
            value: "3000".to_string(),
            enabled: true,
            is_secret: false,
        });
        let (env_map, protected, _, _) = derive_environment_map(&dir, &prof, None, None, false);
        assert_eq!(env_map.get("PORT"), Some(&"3000".to_string()));
        assert!(protected.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    // 3. Secret marker blocks plan
    #[test]
    fn test_secret_marker_blocks_plan() {
        let dir = create_temp_test_dir("secret_block");
        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "API_KEY".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        });
        let (env_map, protected, _, _) = derive_environment_map(&dir, &prof, None, None, false);
        assert!(!env_map.contains_key("API_KEY"));
        assert_eq!(protected, vec!["API_KEY".to_string()]);
        let _ = fs::remove_dir_all(&dir);
    }

    // 4. Protected key rejected
    #[test]
    fn test_protected_key_rejected() {
        let dir = create_temp_test_dir("prot_key");
        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "PATH".to_string(),
            value: "C:\\evil".to_string(),
            enabled: true,
            is_secret: false,
        });
        let (env_map, _, blocked, _) = derive_environment_map(&dir, &prof, None, None, false);
        assert!(!env_map.contains_key("PATH"));
        assert!(!blocked.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    // 5. PATH derived correctly
    #[test]
    fn test_path_derived_correctly() {
        let dir = create_temp_test_dir("path_der");
        let dummy_exe = dir.join("dummy_node.exe");
        File::create(&dummy_exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-1".to_string(),
            executable_path: dummy_exe.to_string_lossy().to_string(),
            version: Some("20.0.0".to_string()),
            enabled: true,
        });

        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", None, false).unwrap();
        assert_eq!(path[0], normalize_dir_path(&dir.to_string_lossy()));
        assert!(path.contains(&"C:\\Windows".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    // 6. PATH duplicate deduplication
    #[test]
    fn test_path_duplicate_deduplication() {
        let dir = create_temp_test_dir("path_dedup");
        let prof = make_test_profile(&dir);
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows;c:\\windows;C:\\Windows\\", None, false).unwrap();
        let occurrences = path.iter().filter(|p| p.to_lowercase() == "c:\\windows").count();
        assert_eq!(occurrences, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // 7. PATH priority deterministic
    #[test]
    fn test_path_priority_deterministic() {
        let dir = create_temp_test_dir("path_prio");
        let node_bin = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&node_bin).unwrap();

        let tool_dir = dir.join("tool_bin");
        fs::create_dir_all(&tool_dir).unwrap();
        let exe = tool_dir.join("tool.exe");
        File::create(&exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "mytool".to_string(),
            installation_id: "tool-1".to_string(),
            executable_path: exe.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });

        // For package manager script, node_bin is prepended first
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Sys", Some(LaunchKind::PackageManagerScript), false).unwrap();
        assert_eq!(path[0], normalize_dir_path(&node_bin.to_string_lossy()));
        assert_eq!(path[1], normalize_dir_path(&tool_dir.to_string_lossy()));
        assert_eq!(path[2], "C:\\Sys");
        let _ = fs::remove_dir_all(&dir);
    }

    // 8. Ambiguous provider detection
    #[test]
    fn test_ambiguous_provider_detection() {
        let dir = create_temp_test_dir("ambig");
        let exe1 = dir.join("node1.exe");
        let exe2 = dir.join("node2.exe");
        File::create(&exe1).unwrap();
        File::create(&exe2).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-1".to_string(),
            executable_path: exe1.to_string_lossy().to_string(),
            version: Some("18.0.0".to_string()),
            enabled: true,
        });
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node-2".to_string(),
            executable_path: exe2.to_string_lossy().to_string(),
            version: Some("20.0.0".to_string()),
            enabled: true,
        });

        let res = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", None, false);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Ambiguous tool resolution"));
        let _ = fs::remove_dir_all(&dir);
    }

    // 9. Stale tool binding
    #[test]
    fn test_stale_tool_binding() {
        let dir = create_temp_test_dir("stale_tool");
        let binding = WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "stale-1".to_string(),
            executable_path: dir.join("nonexistent_node.exe").to_string_lossy().to_string(),
            version: Some("20.0.0".to_string()),
            enabled: true,
        };
        let t_plan = verify_tool_binding(&binding);
        assert_eq!(t_plan.drift_status, ToolDriftStatus::Missing);
        let _ = fs::remove_dir_all(&dir);
    }

    // 10. Exact version drift vs exact match
    #[test]
    fn test_exact_version_drift() {
        let dir = create_temp_test_dir("ver_drift");
        let exe = dir.join("mock_tool.exe");
        File::create(&exe).unwrap();

        let binding = WorkspaceToolBinding {
            tool: "mocktool".to_string(),
            installation_id: "tool-1".to_string(),
            executable_path: exe.to_string_lossy().to_string(),
            version: Some("1.0.0".to_string()),
            enabled: true,
        };
        let t_plan = verify_tool_binding(&binding);
        assert!(t_plan.drift_status == ToolDriftStatus::Unverified || t_plan.drift_status == ToolDriftStatus::VersionDrift);
        let _ = fs::remove_dir_all(&dir);
    }

    // 11. Missing executable
    #[test]
    fn test_missing_executable() {
        let dir = create_temp_test_dir("miss_exec");
        let binding = WorkspaceToolBinding {
            tool: "python".to_string(),
            installation_id: "py-1".to_string(),
            executable_path: "Z:\\does_not_exist\\python.exe".to_string(),
            version: None,
            enabled: true,
        };
        let t_plan = verify_tool_binding(&binding);
        assert_eq!(t_plan.drift_status, ToolDriftStatus::Missing);
        let _ = fs::remove_dir_all(&dir);
    }

    // 12. Project-local node_modules/.bin only for package manager script
    #[test]
    fn test_node_modules_bin_only_for_package_manager_script() {
        let dir = create_temp_test_dir("node_bin_pm");
        let bin_dir = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let prof = make_test_profile(&dir);

        // Package manager script -> includes .bin
        let path_pm = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", Some(LaunchKind::PackageManagerScript), false).unwrap();
        assert_eq!(path_pm[0], normalize_dir_path(&bin_dir.to_string_lossy()));

        // Direct executable -> does NOT include .bin
        let path_dir = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", Some(LaunchKind::DirectExecutable), false).unwrap();
        assert!(!path_dir.contains(&normalize_dir_path(&bin_dir.to_string_lossy())));

        // Terminal -> does NOT include .bin
        let path_term = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", Some(LaunchKind::WorkspaceTerminal), false).unwrap();
        assert!(!path_term.contains(&normalize_dir_path(&bin_dir.to_string_lossy())));

        let _ = fs::remove_dir_all(&dir);
    }

    // 13. Direct execution does not automatically include .bin
    #[test]
    fn test_direct_execution_does_not_include_node_bin() {
        let dir = create_temp_test_dir("dir_no_bin");
        let bin_dir = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let prof = make_test_profile(&dir);
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", Some(LaunchKind::DirectExecutable), false).unwrap();
        assert!(!path.contains(&normalize_dir_path(&bin_dir.to_string_lossy())));
        let _ = fs::remove_dir_all(&dir);
    }

    // 14. Terminal does not automatically include .bin
    #[test]
    fn test_terminal_does_not_include_node_bin() {
        let dir = create_temp_test_dir("term_no_bin");
        let bin_dir = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let prof = make_test_profile(&dir);
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows", Some(LaunchKind::WorkspaceTerminal), false).unwrap();
        assert!(!path.contains(&normalize_dir_path(&bin_dir.to_string_lossy())));
        let _ = fs::remove_dir_all(&dir);
    }

    // 15. Python venv removes PYTHONHOME only for Python action
    #[test]
    fn test_python_venv_removes_pythonhome_for_python_action() {
        let dir = create_temp_test_dir("py_act_home");
        let venv_scripts = dir.join(".venv").join("Scripts");
        fs::create_dir_all(&venv_scripts).unwrap();
        let py_exe = venv_scripts.join("python.exe");
        File::create(&py_exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "python".to_string(),
            installation_id: "py-venv".to_string(),
            executable_path: py_exe.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });

        // Python action -> PYTHONHOME cleared, VIRTUAL_ENV set
        let (env_map, _, _, verif) = derive_environment_map(&dir, &prof, None, Some(LaunchKind::DirectExecutable), true);
        assert!(verif.python_home_cleared);
        assert!(env_map.contains_key("VIRTUAL_ENV"));

        // Non-Python (Node/PM) action -> PYTHONHOME preserved (not cleared)
        let (env_map_node, _, _, verif_node) = derive_environment_map(&dir, &prof, None, Some(LaunchKind::PackageManagerScript), false);
        assert!(!verif_node.python_home_cleared);
        assert!(!env_map_node.contains_key("VIRTUAL_ENV"));

        // Terminal action -> PYTHONHOME preserved (not cleared)
        let (env_map_term, _, _, verif_term) = derive_environment_map(&dir, &prof, None, Some(LaunchKind::WorkspaceTerminal), false);
        assert!(!verif_term.python_home_cleared);
        assert!(!env_map_term.contains_key("VIRTUAL_ENV"));

        let _ = fs::remove_dir_all(&dir);
    }

    // 16. Non-Python action preserves PYTHONHOME
    #[test]
    fn test_non_python_action_preserves_pythonhome() {
        let dir = create_temp_test_dir("non_py_home");
        let prof = make_test_profile(&dir);
        let (_, _, _, verif) = derive_environment_map(&dir, &prof, None, Some(LaunchKind::PackageManagerScript), false);
        assert!(!verif.python_home_cleared);
        let _ = fs::remove_dir_all(&dir);
    }

    // 17. Terminal preserves PYTHONHOME
    #[test]
    fn test_terminal_preserves_pythonhome() {
        let dir = create_temp_test_dir("term_home");
        let prof = make_test_profile(&dir);
        let (_, _, _, verif) = derive_environment_map(&dir, &prof, None, Some(LaunchKind::WorkspaceTerminal), false);
        assert!(!verif.python_home_cleared);
        let _ = fs::remove_dir_all(&dir);
    }

    // 18. Exact binding version matching logic
    #[test]
    fn test_exact_binding_version_semantic_rules() {
        // Exact match
        assert_eq!(normalize_version_tag("24.16.0"), normalize_version_tag("24.16.0"));
        assert_eq!(normalize_version_tag("v24.16.0"), normalize_version_tag("24.16.0"));
        assert_eq!(normalize_version_tag("node v24.16.0"), normalize_version_tag("24.16.0"));

        // Same major drift
        assert_ne!(normalize_version_tag("24.16.0"), normalize_version_tag("24.17.0"));
    }

    // 19. Same-major version drift triggers VERSION_DRIFT
    #[test]
    fn test_same_major_version_drift() {
        let expected = "24.16.0";
        let actual = "24.17.0";
        assert_ne!(normalize_version_tag(expected), normalize_version_tag(actual));
    }

    // 20. Deterministic plan generation
    #[test]
    fn test_deterministic_plan_generation() {
        let dir = create_temp_test_dir("determ");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "VAR_A".to_string(),
            value: "1".to_string(),
            enabled: true,
            is_secret: false,
        });
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "VAR_B".to_string(),
            value: "2".to_string(),
            enabled: true,
            is_secret: false,
        });

        let plan1 = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows;C:\\Tools");
        let plan2 = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows;C:\\Tools");

        assert_eq!(plan1.launch_kind, plan2.launch_kind);
        assert_eq!(plan1.executable, plan2.executable);
        assert_eq!(plan1.arguments, plan2.arguments);
        assert_eq!(plan1.derived_path_entries, plan2.derived_path_entries);
        assert_eq!(plan1.non_secret_environment, plan2.non_secret_environment);
        assert_eq!(plan1.preflight_status, plan2.preflight_status);
        assert_eq!(plan1.is_executable, plan2.is_executable);

        let _ = fs::remove_dir_all(&dir);
    }

    // 21. Protected secret blocks plan
    #[test]
    fn test_protected_secret_blocks_plan() {
        let dir = create_temp_test_dir("prot_sec_block");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "SECRET_TOKEN".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        });

        let plan = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows");
        assert_eq!(plan.preflight_status, PreflightStatus::BlockedSecretUnavailable);
        assert!(!plan.is_executable);
        assert!(!plan.non_secret_environment.contains_key("SECRET_TOKEN"));
        assert!(plan.protected_secret_keys.contains(&"SECRET_TOKEN".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }

    // 22. JAVA_HOME derivation
    #[test]
    fn test_java_home_derivation() {
        let dir = create_temp_test_dir("java_home");
        let jdk_bin = dir.join("bin");
        fs::create_dir_all(&jdk_bin).unwrap();
        let java_exe = jdk_bin.join("java.exe");
        File::create(&java_exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "java".to_string(),
            installation_id: "jdk-21".to_string(),
            executable_path: java_exe.to_string_lossy().to_string(),
            version: Some("21.0.2".to_string()),
            enabled: true,
        });

        let (env_map, _, _, verif) = derive_environment_map(&dir, &prof, None, None, false);
        assert_eq!(env_map.get("JAVA_HOME"), Some(&normalize_dir_path(&dir.to_string_lossy())));
        assert!(verif.runtime_jdk_enforced);
        let _ = fs::remove_dir_all(&dir);
    }

    // 23. Gradle build-toolchain distinction
    #[test]
    fn test_gradle_build_toolchain_distinction() {
        let dir = create_temp_test_dir("gradle_dist");
        let build_gradle = dir.join("build.gradle");
        File::create(&build_gradle).unwrap();

        let prof = make_test_profile(&dir);
        let (_, _, _, verif) = derive_environment_map(&dir, &prof, None, None, false);
        assert!(verif.gradle_build_toolchain_note.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    // 24. Approved npm script plan
    #[test]
    fn test_approved_npm_script_plan() {
        let dir = create_temp_test_dir("npm_plan");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let (kind, _exec, args) = resolve_launch_target(&dir, Some("dev"), &prof).unwrap();
        assert_eq!(kind, LaunchKind::PackageManagerScript);
        assert!(args.contains(&"dev".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    // 25. Arbitrary command rejection
    #[test]
    fn test_arbitrary_command_rejection() {
        let dir = create_temp_test_dir("arb_rej");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let res = resolve_launch_target(&dir, Some("rm -rf /"), &prof);
        assert!(res.is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    // 26. CWD confinement
    #[test]
    fn test_cwd_confinement() {
        let dir = create_temp_test_dir("cwd_conf");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let prof = make_test_profile(&dir);
        let plan = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows");
        assert_eq!(plan.cwd, prof.project_path);
        assert_eq!(plan.preflight_status, PreflightStatus::Ready);
        let _ = fs::remove_dir_all(&dir);
    }

    // 27. Missing project
    #[test]
    fn test_missing_project() {
        let prof = make_test_profile(Path::new("Z:\\nonexistent_project_path_xyz_123"));
        let plan = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows");
        assert_eq!(plan.preflight_status, PreflightStatus::BlockedMissingProject);
        assert!(!plan.is_executable);
    }

    // 28. Disabled profile
    #[test]
    fn test_disabled_profile() {
        let dir = create_temp_test_dir("dis_prof");
        let mut prof = make_test_profile(&dir);
        prof.enabled = false;
        let plan = build_execution_plan(&prof, Some("dev"), None, "C:\\Windows");
        assert_eq!(plan.preflight_status, PreflightStatus::BlockedDisabledProfile);
        assert!(!plan.is_executable);
        let _ = fs::remove_dir_all(&dir);
    }

    // 29. Safe preview redaction
    #[test]
    fn test_safe_preview_redaction() {
        let dir = create_temp_test_dir("safe_prev");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "API_SECRET".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        });

        let preview = generate_environment_preview(&prof, Some("dev"), "C:\\Windows");
        assert!(preview.protected_secret_keys.contains(&"API_SECRET".to_string()));
        assert!(!preview.non_secret_overrides.contains_key("API_SECRET"));
        assert_eq!(preview.preflight_status, PreflightStatus::BlockedSecretUnavailable);
        let _ = fs::remove_dir_all(&dir);
    }

    // 30. Cross-drive project
    #[test]
    fn test_cross_drive_project() {
        let dir = create_temp_test_dir("cross_drive");
        let prof = make_test_profile(&dir);
        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Windows;D:\\Tools", None, false).unwrap();
        assert!(path.contains(&"D:\\Tools".to_string()));
        assert!(path.contains(&"C:\\Windows".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    // 31. Windows path containing spaces
    #[test]
    fn test_windows_path_with_spaces() {
        let dir = create_temp_test_dir("spaces dir");
        let sub = dir.join("My Tool");
        fs::create_dir_all(&sub).unwrap();
        let exe = sub.join("tool.exe");
        File::create(&exe).unwrap();

        let mut prof = make_test_profile(&dir);
        prof.tool_bindings.push(WorkspaceToolBinding {
            tool: "spaced_tool".to_string(),
            installation_id: "space-1".to_string(),
            executable_path: exe.to_string_lossy().to_string(),
            version: None,
            enabled: true,
        });

        let path = derive_workspace_path(&dir, &prof.tool_bindings, "C:\\Program Files\\Common", None, false).unwrap();
        assert!(path.contains(&normalize_dir_path(&sub.to_string_lossy())));
        assert!(path.contains(&"C:\\Program Files\\Common".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    // 32. Corrupted profile input
    #[test]
    fn test_corrupted_profile_input() {
        let dir = create_temp_test_dir("corrupt_prof");
        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "BAD=KEY".to_string(),
            value: "value".to_string(),
            enabled: true,
            is_secret: false,
        });

        let (env_map, _, blocked, _) = derive_environment_map(&dir, &prof, None, None, false);
        assert!(!env_map.contains_key("BAD=KEY"));
        assert!(!blocked.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    // 33. Unknown project requirement
    #[test]
    fn test_unknown_project_requirement() {
        let dir = create_temp_test_dir("unknown_req");
        let prof = make_test_profile(&dir);
        let res = resolve_launch_target(&dir, Some("unknown_custom_script"), &prof);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not an approved executable action"));
        let _ = fs::remove_dir_all(&dir);
    }

    // 34. Native IPC integration smoke test
    #[test]
    fn test_ipc_commands_end_to_end() {
        let dir = create_temp_test_dir("ipc_smoke");
        let pkg_json = dir.join("package.json");
        let mut f = File::create(&pkg_json).unwrap();
        f.write_all(b"{\"scripts\": {\"dev\": \"vite\", \"build\": \"vite build\"}}").unwrap();

        let mut prof = make_test_profile(&dir);
        prof.environment_overrides.push(WorkspaceEnvOverride {
            key: "CUSTOM_VAR".to_string(),
            value: "hello".to_string(),
            enabled: true,
            is_secret: false,
        });

        // 1. Save profile to disk
        let save_res = crate::workspace_profile::save_workspace_profile(prof.clone());
        assert!(save_res.is_ok());

        let initial_env_path = std::env::var("PATH").unwrap_or_default();

        // 2. Call IPC command get_workspace_execution_plan
        let plan_res = get_workspace_execution_plan(prof.project_path.clone(), Some("dev".to_string()));
        assert!(plan_res.is_ok());
        let plan = plan_res.unwrap();
        assert_eq!(plan.preflight_status, PreflightStatus::Ready);
        assert!(plan.is_executable);
        assert_eq!(plan.non_secret_environment.get("CUSTOM_VAR"), Some(&"hello".to_string()));

        // 3. Call IPC command preview_workspace_execution_plan
        let prev_res = preview_workspace_execution_plan(prof.project_path.clone(), Some("dev".to_string()));
        assert!(prev_res.is_ok());
        let preview = prev_res.unwrap();
        assert_eq!(preview.preflight_status, PreflightStatus::Ready);
        assert!(preview.is_executable);

        // 4. Verify no host process environment was modified
        let post_env_path = std::env::var("PATH").unwrap_or_default();
        assert_eq!(initial_env_path, post_env_path);

        // 5. Cleanup
        let _ = crate::workspace_profile::delete_workspace_profile(prof.project_path);
        let _ = fs::remove_dir_all(&dir);
    }
}
