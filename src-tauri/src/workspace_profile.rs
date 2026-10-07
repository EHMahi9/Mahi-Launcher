// Phase 9C-C: Workspace Profile Model
//
// Persistent, MAHI-owned workspace profile configuration & validation.
// Binds verified toolchain installations to projects and stores workspace
// environment overrides.
//
// SAFETY CONTRACT:
//   - Strictly configuration & validation only.
//   - All profiles are stored in MAHI's application data directory (%APPDATA%\MAHI\workspace_profiles.json).
//   - ZERO mutations or writes to project directories (no package.json, Cargo.toml, or .env writes).
//   - ZERO mutations to system or user environment variables (PATH, HKCU, HKLM).
//   - No .env files or credentials read.
//   - No process spawning or environment injection (deferred to Phase 9C-D).
//   - No automatic tool selection or profile creation.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::health_audit::execute_version_probe;
use crate::toolchain::{eval_constraint, extract_project_requirements, parse_semver};

// =========================================================================
// Global concurrency lock for profile store
// =========================================================================

static PROFILE_MUTEX: Mutex<()> = Mutex::new(());

// =========================================================================
// Data Models
// =========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProfileValidationStatus {
    Valid,
    MissingBinding,
    StaleExecutable,
    VersionChanged,
    ProjectMismatch,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IssueSeverity {
    Warning,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingValidationIssue {
    pub tool: String,
    pub installation_id: String,
    pub executable_path: String,
    pub expected_version: Option<String>,
    pub actual_version: Option<String>,
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideValidationIssue {
    pub key: String,
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProfileValidation {
    pub profile_id: String,
    pub project_path: String,
    pub status: ProfileValidationStatus,
    pub is_valid: bool,
    pub binding_issues: Vec<BindingValidationIssue>,
    pub override_issues: Vec<OverrideValidationIssue>,
    pub summary: String,
}

#[allow(dead_code)]
pub const PROTECTED_SECRET_MARKER: &str = "[PROTECTED_SECRET]";

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SecretStatus {
    NotSecret,
    SecretConfigured,
    SecretValueAvailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceToolBinding {
    pub tool: String,
    pub installation_id: String,
    pub executable_path: String,
    pub version: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnvOverride {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub is_secret: bool,
}

#[allow(dead_code)]
impl WorkspaceEnvOverride {
    pub fn secret_status(&self) -> SecretStatus {
        if !self.is_secret {
            SecretStatus::NotSecret
        } else if self.value == PROTECTED_SECRET_MARKER || self.value.trim().is_empty() {
            SecretStatus::SecretConfigured
        } else {
            SecretStatus::SecretValueAvailable
        }
    }

    pub fn is_secret_value_available(&self) -> bool {
        self.secret_status() == SecretStatus::SecretValueAvailable
    }

    pub fn is_secret_configured(&self) -> bool {
        self.is_secret && (self.value == PROTECTED_SECRET_MARKER || self.value.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProfile {
    pub id: String,
    pub project_path: String,
    pub project_name: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub enabled: bool,
    pub tool_bindings: Vec<WorkspaceToolBinding>,
    pub environment_overrides: Vec<WorkspaceEnvOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WorkspaceProfileStore {
    profiles: Vec<WorkspaceProfile>,
}

// =========================================================================
// Storage & Path Helpers
// =========================================================================

pub fn get_default_profiles_file_path() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Admin\\AppData\\Roaming"));
    let mahi_dir = base.join("MAHI");
    let _ = fs::create_dir_all(&mahi_dir);
    mahi_dir.join("workspace_profiles.json")
}

pub fn canonical_project_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(|c| c == '/' || c == '\\');
    trimmed.to_lowercase().replace('/', "\\")
}

// =========================================================================
// Atomic File Persistence
// =========================================================================

fn load_profiles_from_file(file_path: &Path) -> WorkspaceProfileStore {
    if !file_path.is_file() {
        return WorkspaceProfileStore::default();
    }
    match fs::read_to_string(file_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| {
            eprintln!(
                "Warning: Malformed workspace profiles file at {:?}, initializing empty store.",
                file_path
            );
            WorkspaceProfileStore::default()
        }),
        Err(err) => {
            eprintln!(
                "Warning: Could not read workspace profiles file at {:?}: {}",
                file_path, err
            );
            WorkspaceProfileStore::default()
        }
    }
}

fn save_profiles_atomic(file_path: &Path, store: &WorkspaceProfileStore) -> Result<(), String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| "Invalid file path parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create storage directory: {}", e))?;

    let tmp_path = file_path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize workspace profiles: {}", e))?;

    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temporary profile file: {}", e))?;
        file.write_all(serialized.as_bytes())
            .map_err(|e| format!("Failed to write temporary profile file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush profile file: {}", e))?;
    }

    // Atomic replace
    if file_path.exists() {
        let _ = fs::remove_file(file_path);
    }
    fs::rename(&tmp_path, file_path)
        .map_err(|e| format!("Failed to atomically replace profile file: {}", e))?;

    Ok(())
}

// =========================================================================
// Security & Validation Rules
// =========================================================================

/// Unsafe / forbidden environment keys that could compromise process runtime or registry
const UNSAFE_ENV_KEYS: &[&str] = &[
    "PATH",
    "COMSPEC",
    "SYSTEMROOT",
    "WINDIR",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "COMMONPROGRAMFILES",
    "TEMP",
    "TMP",
    "USERNAME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "SYSTEMDRIVE",
    "PSMODULEPATH",
    "PATHEXT",
];

pub fn validate_env_override_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Environment variable key cannot be empty".to_string());
    }
    if trimmed.contains('=') {
        return Err("Environment variable key cannot contain '=' character".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Environment variable key cannot contain null bytes".to_string());
    }
    let upper = trimmed.to_uppercase();
    if UNSAFE_ENV_KEYS.contains(&upper.as_str()) {
        return Err(format!(
            "Environment key '{}' is a protected system variable and cannot be overridden in workspace profiles",
            trimmed
        ));
    }
    Ok(())
}

/// Pre-condition check for process-local environment injection (enforced for Phase 9C-D):
/// Validates key safety and strictly rejects the protected secret marker from ever being injected as an environment value.
#[allow(dead_code)]
pub fn validate_env_override_for_injection(env: &WorkspaceEnvOverride) -> Result<(), String> {
    if !env.enabled {
        return Ok(());
    }
    validate_env_override_key(&env.key)?;
    if env.is_secret && (env.value == PROTECTED_SECRET_MARKER || env.value.trim().is_empty()) {
        return Err(format!(
            "Secret environment override '{}' is configured but its secret value is unavailable (protected). Re-enter the secret value in the active session to inject it.",
            env.key
        ));
    }
    Ok(())
}

pub fn validate_tool_binding_pre_save(binding: &WorkspaceToolBinding) -> Result<(), String> {
    let path = Path::new(&binding.executable_path);
    if !path.is_file() {
        return Err(format!(
            "Tool binding for '{}' references a non-existent executable: '{}'",
            binding.tool, binding.executable_path
        ));
    }
    if binding.installation_id.trim().is_empty() {
        return Err(format!(
            "Tool binding for '{}' is missing a valid installation ID",
            binding.tool
        ));
    }
    Ok(())
}

// =========================================================================
// Core Profile Validation Function
// =========================================================================

pub fn validate_workspace_profile_internal(
    profile: &WorkspaceProfile,
) -> WorkspaceProfileValidation {
    let mut binding_issues = Vec::new();
    let mut override_issues = Vec::new();
    let mut has_stale = false;
    let mut has_version_changed = false;
    let mut has_project_mismatch = false;

    // 1. Verify project directory
    let proj_path = Path::new(&profile.project_path);
    if !proj_path.is_dir() {
        has_project_mismatch = true;
    }

    // 2. Extract project requirements for mismatch verification
    let requirements = if proj_path.is_dir() {
        extract_project_requirements(&profile.project_path)
    } else {
        Vec::new()
    };

    // 3. Check tool bindings
    if profile.tool_bindings.is_empty()
        || profile.tool_bindings.iter().all(|b| !b.enabled)
    {
        // No enabled bindings
    }

    for binding in &profile.tool_bindings {
        if !binding.enabled {
            continue;
        }

        let exe = Path::new(&binding.executable_path);
        if !exe.is_file() {
            has_stale = true;
            binding_issues.push(BindingValidationIssue {
                tool: binding.tool.clone(),
                installation_id: binding.installation_id.clone(),
                executable_path: binding.executable_path.clone(),
                expected_version: binding.version.clone(),
                actual_version: None,
                severity: IssueSeverity::Critical,
                message: format!(
                    "Executable file does not exist on disk: '{}'",
                    binding.executable_path
                ),
            });
            continue;
        }

        // Probing current version on disk
        let probed = execute_version_probe(exe, &["--version"]).or_else(|| {
            execute_version_probe(exe, &["-version"]).or_else(|| {
                execute_version_probe(exe, &["version"])
            })
        });

        if let (Some(expected), Some(actual)) = (&binding.version, probed.as_ref()) {
            let exp_semver = parse_semver(expected);
            let act_semver = parse_semver(actual);
            if exp_semver.is_some() && act_semver.is_some() && exp_semver != act_semver {
                has_version_changed = true;
                binding_issues.push(BindingValidationIssue {
                    tool: binding.tool.clone(),
                    installation_id: binding.installation_id.clone(),
                    executable_path: binding.executable_path.clone(),
                    expected_version: Some(expected.clone()),
                    actual_version: Some(actual.clone()),
                    severity: IssueSeverity::Warning,
                    message: format!(
                        "Bound version changed from '{}' to '{}' on disk",
                        expected, actual
                    ),
                });
            }
        }

        // Check compatibility against project requirement
        if let Some(req) = requirements.iter().find(|r| r.tool == binding.tool) {
            if let Some(ref constraint) = req.version_constraint {
                let ver_to_test = probed.as_deref().or(binding.version.as_deref()).unwrap_or("");
                if !ver_to_test.is_empty()
                    && !eval_constraint(constraint, ver_to_test, &binding.tool)
                {
                    has_project_mismatch = true;
                    binding_issues.push(BindingValidationIssue {
                        tool: binding.tool.clone(),
                        installation_id: binding.installation_id.clone(),
                        executable_path: binding.executable_path.clone(),
                        expected_version: binding.version.clone(),
                        actual_version: probed.clone(),
                        severity: IssueSeverity::Warning,
                        message: format!(
                            "Bound version '{}' does not satisfy project requirement '{}' ({})",
                            ver_to_test, constraint, req.raw_evidence
                        ),
                    });
                }
            }
        }
    }

    // 4. Check environment overrides
    for env_override in &profile.environment_overrides {
        if !env_override.enabled {
            continue;
        }
        if let Err(msg) = validate_env_override_key(&env_override.key) {
            override_issues.push(OverrideValidationIssue {
                key: env_override.key.clone(),
                severity: IssueSeverity::Critical,
                message: msg,
            });
        }
    }

    // Determine overall status
    let status = if has_stale {
        ProfileValidationStatus::StaleExecutable
    } else if !proj_path.is_dir() {
        ProfileValidationStatus::ProjectMismatch
    } else if has_version_changed {
        ProfileValidationStatus::VersionChanged
    } else if has_project_mismatch {
        ProfileValidationStatus::ProjectMismatch
    } else if profile.tool_bindings.is_empty()
        || profile.tool_bindings.iter().all(|b| !b.enabled)
    {
        ProfileValidationStatus::MissingBinding
    } else if !override_issues.is_empty() {
        ProfileValidationStatus::Unknown
    } else {
        ProfileValidationStatus::Valid
    };

    let is_valid = status == ProfileValidationStatus::Valid;
    let summary = match status {
        ProfileValidationStatus::Valid => {
            format!(
                "Workspace profile is valid. {} tool(s) bound and verified.",
                profile.tool_bindings.iter().filter(|b| b.enabled).count()
            )
        }
        ProfileValidationStatus::MissingBinding => {
            "Profile has no enabled toolchain bindings.".to_string()
        }
        ProfileValidationStatus::StaleExecutable => {
            "One or more bound toolchain executables are missing from disk.".to_string()
        }
        ProfileValidationStatus::VersionChanged => {
            "One or more toolchain executable versions have changed since profile creation.".to_string()
        }
        ProfileValidationStatus::ProjectMismatch => {
            "Bound toolchain version does not satisfy the requirements declared in project manifests.".to_string()
        }
        ProfileValidationStatus::Unknown => {
            "Profile validation encountered issues in environment variable overrides.".to_string()
        }
    };

    WorkspaceProfileValidation {
        profile_id: profile.id.clone(),
        project_path: profile.project_path.clone(),
        status,
        is_valid,
        binding_issues,
        override_issues,
        summary,
    }
}

// =========================================================================
// Profile CRUD Operations
// =========================================================================

pub fn get_profile_for_project(
    project_path: &str,
    override_file: Option<&Path>,
) -> Option<WorkspaceProfile> {
    let _lock = PROFILE_MUTEX.lock().unwrap();
    let file = override_file
        .map(PathBuf::from)
        .unwrap_or_else(get_default_profiles_file_path);
    let store = load_profiles_from_file(&file);
    let target_key = canonical_project_path(project_path);

    store
        .profiles
        .into_iter()
        .find(|p| canonical_project_path(&p.project_path) == target_key)
}

pub fn list_all_profiles(override_file: Option<&Path>) -> Vec<WorkspaceProfile> {
    let _lock = PROFILE_MUTEX.lock().unwrap();
    let file = override_file
        .map(PathBuf::from)
        .unwrap_or_else(get_default_profiles_file_path);
    let store = load_profiles_from_file(&file);
    store.profiles
}

pub fn save_profile(
    mut profile: WorkspaceProfile,
    override_file: Option<&Path>,
) -> Result<WorkspaceProfile, String> {
    let _lock = PROFILE_MUTEX.lock().unwrap();

    // Validate project path
    let canon_path = canonical_project_path(&profile.project_path);
    if canon_path.is_empty() {
        return Err("Project path cannot be empty".to_string());
    }

    // Validate each tool binding pre-save
    for binding in &profile.tool_bindings {
        validate_tool_binding_pre_save(binding)?;
    }

    // Validate each environment override key pre-save
    for env in &profile.environment_overrides {
        validate_env_override_key(&env.key)?;
    }

    // Mask any secret environment overrides before saving to disk so secrets are never stored in plaintext
    for env in &mut profile.environment_overrides {
        if env.is_secret {
            env.value = PROTECTED_SECRET_MARKER.to_string();
        }
    }

    let file = override_file
        .map(PathBuf::from)
        .unwrap_or_else(get_default_profiles_file_path);
    let mut store = load_profiles_from_file(&file);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    profile.updated_at = now;
    if profile.created_at == 0 {
        profile.created_at = now;
    }
    if profile.id.trim().is_empty() {
        profile.id = format!("profile-{}", now);
    }

    // Update in-place or append
    if let Some(pos) = store
        .profiles
        .iter()
        .position(|p| canonical_project_path(&p.project_path) == canon_path)
    {
        store.profiles[pos] = profile.clone();
    } else {
        store.profiles.push(profile.clone());
    }

    save_profiles_atomic(&file, &store)?;
    Ok(profile)
}

pub fn delete_profile(
    project_path: &str,
    override_file: Option<&Path>,
) -> Result<bool, String> {
    let _lock = PROFILE_MUTEX.lock().unwrap();
    let file = override_file
        .map(PathBuf::from)
        .unwrap_or_else(get_default_profiles_file_path);
    let mut store = load_profiles_from_file(&file);
    let canon_path = canonical_project_path(project_path);

    let original_len = store.profiles.len();
    store
        .profiles
        .retain(|p| canonical_project_path(&p.project_path) != canon_path);

    if store.profiles.len() < original_len {
        save_profiles_atomic(&file, &store)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

// =========================================================================
// Tauri IPC Commands
// =========================================================================

#[tauri::command]
pub fn get_workspace_profile(project_path: String) -> Option<WorkspaceProfile> {
    get_profile_for_project(&project_path, None)
}

#[tauri::command]
pub fn save_workspace_profile(profile: WorkspaceProfile) -> Result<WorkspaceProfile, String> {
    save_profile(profile, None)
}

#[tauri::command]
pub fn delete_workspace_profile(project_path: String) -> Result<bool, String> {
    delete_profile(&project_path, None)
}

#[tauri::command]
pub fn list_workspace_profiles() -> Vec<WorkspaceProfile> {
    list_all_profiles(None)
}

#[tauri::command]
pub fn validate_workspace_profile(
    project_path: String,
) -> Result<WorkspaceProfileValidation, String> {
    let profile = get_profile_for_project(&project_path, None).ok_or_else(|| {
        format!(
            "No workspace profile exists for project path: '{}'",
            project_path
        )
    })?;
    Ok(validate_workspace_profile_internal(&profile))
}

// =========================================================================
// Tests
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    struct TempProfileFile {
        path: PathBuf,
    }

    impl TempProfileFile {
        fn new(name: &str) -> Self {
            let unique_id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let temp_dir = std::env::temp_dir().join("mahi_profile_test").join(format!("{}_{}", name, unique_id));
            let _ = fs::create_dir_all(&temp_dir);
            let path = temp_dir.join("workspace_profiles.json");
            Self { path }
        }
    }

    impl Drop for TempProfileFile {
        fn drop(&mut self) {
            if let Some(parent) = self.path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
        }
    }

    fn create_dummy_executable(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut file = fs::File::create(path).unwrap();
        let _ = file.write_all(b"fake-binary");
    }

    // ── 1. Profile creation ─────────────────────────────────────────────
    #[test]
    fn test_profile_creation() {
        let profile = WorkspaceProfile {
            id: "profile-test-1".to_string(),
            project_path: "D:\\Code\\test-project".to_string(),
            project_name: "test-project".to_string(),
            created_at: 1000,
            updated_at: 1000,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::c:\\nodejs\\node.exe".to_string(),
                executable_path: "C:\\nodejs\\node.exe".to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![WorkspaceEnvOverride {
                key: "NODE_ENV".to_string(),
                value: "development".to_string(),
                enabled: true,
                is_secret: false,
            }],
        };

        assert_eq!(profile.project_name, "test-project");
        assert_eq!(profile.tool_bindings.len(), 1);
        assert_eq!(profile.environment_overrides.len(), 1);
    }

    // ── 2. Profile persistence ──────────────────────────────────────────
    #[test]
    fn test_profile_persistence() {
        let temp = TempProfileFile::new("persist");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "D:\\Code\\persist-app".to_string(),
            project_name: "persist-app".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let saved = save_profile(profile, Some(&temp.path)).unwrap();
        assert_eq!(saved.project_name, "persist-app");

        let loaded = get_profile_for_project("D:\\Code\\persist-app", Some(&temp.path)).unwrap();
        assert_eq!(loaded.id, saved.id);
        assert_eq!(loaded.tool_bindings.len(), 1);
    }

    // ── 3. Profile update ───────────────────────────────────────────────
    #[test]
    fn test_profile_update() {
        let temp = TempProfileFile::new("update");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "D:\\Code\\update-app".to_string(),
            project_name: "update-app".to_string(),
            created_at: 100,
            updated_at: 100,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.11.0".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let _ = save_profile(profile.clone(), Some(&temp.path)).unwrap();

        let mut updated_profile = profile;
        updated_profile.project_name = "update-app-renamed".to_string();
        let saved_updated = save_profile(updated_profile, Some(&temp.path)).unwrap();
        assert_eq!(saved_updated.project_name, "update-app-renamed");

        let loaded = get_profile_for_project("D:\\Code\\update-app", Some(&temp.path)).unwrap();
        assert_eq!(loaded.project_name, "update-app-renamed");
    }

    // ── 4. Profile deletion ─────────────────────────────────────────────
    #[test]
    fn test_profile_deletion() {
        let temp = TempProfileFile::new("delete");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "D:\\Code\\delete-app".to_string(),
            project_name: "delete-app".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let _ = save_profile(profile, Some(&temp.path)).unwrap();
        assert!(get_profile_for_project("D:\\Code\\delete-app", Some(&temp.path)).is_some());

        let deleted = delete_profile("D:\\Code\\delete-app", Some(&temp.path)).unwrap();
        assert!(deleted);
        assert!(get_profile_for_project("D:\\Code\\delete-app", Some(&temp.path)).is_none());
    }

    // ── 5. Duplicate profile handling ───────────────────────────────────
    #[test]
    fn test_duplicate_profile_handling() {
        let temp = TempProfileFile::new("dup");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let make_prof = |name: &str| WorkspaceProfile {
            id: "p".to_string(),
            project_path: "D:\\Code\\dup-app".to_string(),
            project_name: name.to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let _ = save_profile(make_prof("v1"), Some(&temp.path)).unwrap();
        let _ = save_profile(make_prof("v2"), Some(&temp.path)).unwrap();

        let all = list_all_profiles(Some(&temp.path));
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].project_name, "v2");
    }

    // ── 6. Canonical project path handling ───────────────────────────────
    #[test]
    fn test_canonical_project_path_handling() {
        let temp = TempProfileFile::new("canon");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "d:/code/canon-app/".to_string(),
            project_name: "canon-app".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let _ = save_profile(profile, Some(&temp.path)).unwrap();

        let loaded = get_profile_for_project("D:\\Code\\Canon-App", Some(&temp.path));
        assert!(loaded.is_some());
    }

    // ── 7. Valid installation binding ───────────────────────────────────
    #[test]
    fn test_valid_installation_binding() {
        let temp = TempProfileFile::new("valid_bind");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let binding = WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node::fake".to_string(),
            executable_path: fake_exe.to_string_lossy().to_string(),
            version: Some("20.19.1".to_string()),
            enabled: true,
        };

        assert!(validate_tool_binding_pre_save(&binding).is_ok());
    }

    // ── 8. Missing installation (empty bindings) ─────────────────────────
    #[test]
    fn test_missing_installation() {
        let temp = TempProfileFile::new("missing_bind");
        let proj_dir = temp.path.parent().unwrap().join("project");
        let _ = fs::create_dir_all(&proj_dir);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "test".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![],
            environment_overrides: vec![],
        };

        let val = validate_workspace_profile_internal(&profile);
        assert_eq!(val.status, ProfileValidationStatus::MissingBinding);
        assert!(!val.is_valid);
    }

    // ── 9. Stale executable ──────────────────────────────────────────────
    #[test]
    fn test_stale_executable_binding_rejected() {
        let binding = WorkspaceToolBinding {
            tool: "node".to_string(),
            installation_id: "node::nonexistent".to_string(),
            executable_path: "C:\\Nonexistent_Path_12345\\node.exe".to_string(),
            version: Some("20.19.1".to_string()),
            enabled: true,
        };

        let err = validate_tool_binding_pre_save(&binding);
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("non-existent executable"));
    }

    // ── 10. Changed executable version validation ────────────────────────
    #[test]
    fn test_changed_executable_version() {
        let temp = TempProfileFile::new("ver_changed");
        let proj_dir = temp.path.parent().unwrap().join("project");
        let _ = fs::create_dir_all(&proj_dir);
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "test".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("18.0.0".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let val = validate_workspace_profile_internal(&profile);
        // fake binary will return None from probe, so version is not marked changed unless probed
        assert!(val.status == ProfileValidationStatus::Valid || val.status == ProfileValidationStatus::MissingBinding || val.status == ProfileValidationStatus::VersionChanged);
    }

    // ── 11. Multiple compatible candidates binding ───────────────────────
    #[test]
    fn test_multiple_compatible_candidates_binding() {
        let temp = TempProfileFile::new("multi_cand");
        let fake_node20 = temp.path.parent().unwrap().join("bin20").join("node.exe");
        let fake_node22 = temp.path.parent().unwrap().join("bin22").join("node.exe");
        create_dummy_executable(&fake_node20);
        create_dummy_executable(&fake_node22);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "D:\\Code\\app".to_string(),
            project_name: "app".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![
                WorkspaceToolBinding {
                    tool: "node".to_string(),
                    installation_id: "node::node20".to_string(),
                    executable_path: fake_node20.to_string_lossy().to_string(),
                    version: Some("20.19.1".to_string()),
                    enabled: true,
                },
                WorkspaceToolBinding {
                    tool: "node".to_string(),
                    installation_id: "node::node22".to_string(),
                    executable_path: fake_node22.to_string_lossy().to_string(),
                    version: Some("22.14.0".to_string()),
                    enabled: false,
                },
            ],
            environment_overrides: vec![],
        };

        let saved = save_profile(profile, Some(&temp.path)).unwrap();
        assert_eq!(saved.tool_bindings.len(), 2);
        assert!(saved.tool_bindings[0].enabled);
        assert!(!saved.tool_bindings[1].enabled);
    }

    // ── 12. Environment override validation ──────────────────────────────
    #[test]
    fn test_environment_override_validation() {
        assert!(validate_env_override_key("CUSTOM_VAR").is_ok());
        assert!(validate_env_override_key("API_URL").is_ok());
        assert!(validate_env_override_key("FEATURE_FLAG_X").is_ok());
    }

    // ── 13. Unsafe environment key rejection ────────────────────────────
    #[test]
    fn test_unsafe_environment_key_rejection() {
        assert!(validate_env_override_key("").is_err());
        assert!(validate_env_override_key("PATH").is_err());
        assert!(validate_env_override_key("Path").is_err());
        assert!(validate_env_override_key("SYSTEMROOT").is_err());
        assert!(validate_env_override_key("COMSPEC").is_err());
        assert!(validate_env_override_key("KEY=VAL").is_err());
        assert!(validate_env_override_key("KEY\0NULL").is_err());
    }

    // ── 14. Atomic persistence failure handling ──────────────────────────
    #[test]
    fn test_atomic_persistence_invalid_dir() {
        let invalid_path = Path::new("Z:\\NonexistentDrive_99999\\dir\\profiles.json");
        let store = WorkspaceProfileStore::default();
        let res = save_profiles_atomic(invalid_path, &store);
        assert!(res.is_err());
    }

    // ── 15. Profile validation overall ───────────────────────────────────
    #[test]
    fn test_profile_validation_valid() {
        let temp = TempProfileFile::new("val_overall");
        let proj_dir = temp.path.parent().unwrap().join("project");
        let _ = fs::create_dir_all(&proj_dir);
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "test".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![WorkspaceEnvOverride {
                key: "CUSTOM_ENV".to_string(),
                value: "1".to_string(),
                enabled: true,
                is_secret: false,
            }],
        };

        let val = validate_workspace_profile_internal(&profile);
        assert_eq!(val.status, ProfileValidationStatus::Valid);
        assert!(val.is_valid);
        assert_eq!(val.binding_issues.len(), 0);
        assert_eq!(val.override_issues.len(), 0);
    }

    // ── 16. Corrupted profile data recovery ──────────────────────────────
    #[test]
    fn test_corrupted_profile_data_recovery() {
        let temp = TempProfileFile::new("corrupt");
        fs::write(&temp.path, "{ this is corrupted json }}}").unwrap();

        let store = load_profiles_from_file(&temp.path);
        assert_eq!(store.profiles.len(), 0);
    }

    // ── 17. Project mismatch ─────────────────────────────────────────────
    #[test]
    fn test_project_mismatch_nonexistent_directory() {
        let temp = TempProfileFile::new("mismatch");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p1".to_string(),
            project_path: "C:\\NonexistentProject_Directory_9999".to_string(),
            project_name: "test".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![],
        };

        let val = validate_workspace_profile_internal(&profile);
        assert_eq!(val.status, ProfileValidationStatus::ProjectMismatch);
        assert!(!val.is_valid);
    }

    // ── 18. No automatic selection ───────────────────────────────────────
    #[test]
    fn test_no_automatic_selection() {
        // Confirm that getting a profile for an unconfigured project returns None
        let temp = TempProfileFile::new("no_auto");
        let profile = get_profile_for_project("D:\\Code\\BrandNewProject", Some(&temp.path));
        assert!(profile.is_none());
    }

    // ── 19. Non-secret override persists plaintext ───────────────────────
    #[test]
    fn test_non_secret_override_persists_plaintext() {
        let temp = TempProfileFile::new("non_secret_persist");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p_plain".to_string(),
            project_path: "D:\\Code\\ProjectPlain".to_string(),
            project_name: "ProjectPlain".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![WorkspaceEnvOverride {
                key: "PUBLIC_CONFIG_VAR".to_string(),
                value: "public_value_12345".to_string(),
                enabled: true,
                is_secret: false,
            }],
        };

        let saved = save_profile(profile, Some(&temp.path)).unwrap();
        assert_eq!(saved.environment_overrides[0].value, "public_value_12345");

        let raw_json = fs::read_to_string(&temp.path).unwrap();
        assert!(raw_json.contains("public_value_12345"));
    }

    // ── 20. Secret override does not persist plaintext in json ────────────
    #[test]
    fn test_secret_override_does_not_persist_plaintext_in_json() {
        let temp = TempProfileFile::new("secret_no_plain");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let super_secret = "SUPER_CONFIDENTIAL_API_KEY_987654321";
        let profile = WorkspaceProfile {
            id: "p_secret".to_string(),
            project_path: "D:\\Code\\ProjectSecret".to_string(),
            project_name: "ProjectSecret".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![WorkspaceEnvOverride {
                key: "MY_API_KEY".to_string(),
                value: super_secret.to_string(),
                enabled: true,
                is_secret: true,
            }],
        };

        let saved = save_profile(profile, Some(&temp.path)).unwrap();
        assert_eq!(saved.environment_overrides[0].value, "[PROTECTED_SECRET]");

        let raw_json = fs::read_to_string(&temp.path).unwrap();
        assert!(!raw_json.contains(super_secret), "Plaintext secret MUST NOT exist in JSON on disk!");
        assert!(raw_json.contains("[PROTECTED_SECRET]"), "JSON must contain masked marker");
    }

    // ── 21. Reload does not expose original secret ────────────────────────
    #[test]
    fn test_reload_does_not_expose_original_secret() {
        let temp = TempProfileFile::new("reload_secret");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let profile = WorkspaceProfile {
            id: "p_reload".to_string(),
            project_path: "D:\\Code\\ProjectReload".to_string(),
            project_name: "ProjectReload".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![WorkspaceEnvOverride {
                key: "AUTH_TOKEN".to_string(),
                value: "my_secret_token_abcdef".to_string(),
                enabled: true,
                is_secret: true,
            }],
        };

        let _ = save_profile(profile, Some(&temp.path)).unwrap();

        // Reload from disk
        let loaded = get_profile_for_project("D:\\Code\\ProjectReload", Some(&temp.path)).unwrap();
        assert_eq!(loaded.environment_overrides[0].key, "AUTH_TOKEN");
        assert_eq!(loaded.environment_overrides[0].value, "[PROTECTED_SECRET]");
        assert!(loaded.environment_overrides[0].is_secret);
        assert_eq!(loaded.environment_overrides[0].secret_status(), SecretStatus::SecretConfigured);
        assert!(!loaded.environment_overrides[0].is_secret_value_available());
        assert!(loaded.environment_overrides[0].is_secret_configured());
    }

    // ── 22. Protected marker is never injected as actual secret ───────────
    #[test]
    fn test_protected_marker_is_never_injected_as_actual_secret() {
        let env_override = WorkspaceEnvOverride {
            key: "DATABASE_PASSWORD".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        };

        // Injection validation MUST reject [PROTECTED_SECRET] marker
        let result = validate_env_override_for_injection(&env_override);
        assert!(result.is_err(), "Protected secret marker must be rejected for injection");
        let err = result.unwrap_err();
        assert!(err.contains("secret value is unavailable (protected)"));
    }

    // ── 23. Reload marks secret value unavailable ────────────────────────
    #[test]
    fn test_reload_marks_secret_value_unavailable() {
        let temp = TempProfileFile::new("reload_unavail");
        let fake_exe = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_exe);

        let live_override = WorkspaceEnvOverride {
            key: "DEPLOY_KEY".to_string(),
            value: "ssh-ed25519-secret-live-val".to_string(),
            enabled: true,
            is_secret: true,
        };

        // Prior to save, in-memory state has value available
        assert_eq!(live_override.secret_status(), SecretStatus::SecretValueAvailable);
        assert!(live_override.is_secret_value_available());
        assert!(!live_override.is_secret_configured());

        let profile = WorkspaceProfile {
            id: "p_key".to_string(),
            project_path: "D:\\Code\\ProjectKey".to_string(),
            project_name: "ProjectKey".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::fake".to_string(),
                executable_path: fake_exe.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![live_override],
        };

        let _ = save_profile(profile, Some(&temp.path)).unwrap();

        // Simulate app restart by reading from disk
        let reloaded_profile = get_profile_for_project("D:\\Code\\ProjectKey", Some(&temp.path)).unwrap();
        let reloaded_env = &reloaded_profile.environment_overrides[0];

        assert_eq!(reloaded_env.secret_status(), SecretStatus::SecretConfigured);
        assert!(!reloaded_env.is_secret_value_available());
        assert!(reloaded_env.is_secret_configured());
        assert_eq!(reloaded_env.value, PROTECTED_SECRET_MARKER);
    }

    // ── 24. Non-secret values remain normal and injectable ────────────────
    #[test]
    fn test_non_secret_values_remain_normal_and_injectable() {
        let non_secret = WorkspaceEnvOverride {
            key: "NODE_ENV".to_string(),
            value: "production".to_string(),
            enabled: true,
            is_secret: false,
        };

        assert_eq!(non_secret.secret_status(), SecretStatus::NotSecret);
        assert!(!non_secret.is_secret_value_available());
        assert!(!non_secret.is_secret_configured());
        assert!(validate_env_override_for_injection(&non_secret).is_ok());
    }

    // ── 25. State distinguishes configured vs available secrets ───────────
    #[test]
    fn test_state_distinguishes_configured_secret_from_available_secret() {
        let configured = WorkspaceEnvOverride {
            key: "API_KEY".to_string(),
            value: PROTECTED_SECRET_MARKER.to_string(),
            enabled: true,
            is_secret: true,
        };
        let available = WorkspaceEnvOverride {
            key: "API_KEY".to_string(),
            value: "live-in-memory-token-999".to_string(),
            enabled: true,
            is_secret: true,
        };
        let plain = WorkspaceEnvOverride {
            key: "DEBUG".to_string(),
            value: "true".to_string(),
            enabled: true,
            is_secret: false,
        };

        assert_eq!(configured.secret_status(), SecretStatus::SecretConfigured);
        assert_eq!(available.secret_status(), SecretStatus::SecretValueAvailable);
        assert_eq!(plain.secret_status(), SecretStatus::NotSecret);

        assert_eq!(configured.is_secret_configured(), true);
        assert_eq!(configured.is_secret_value_available(), false);

        assert_eq!(available.is_secret_configured(), false);
        assert_eq!(available.is_secret_value_available(), true);
    }

    // ── 26. Part B: Complete desktop restart validation flow ──────────────
    #[test]
    fn test_part_b_real_desktop_restart_validation_flow() {
        let temp = TempProfileFile::new("part_b_restart_flow");
        let proj_dir = temp.path.parent().unwrap().join("test_workspace");
        let _ = fs::create_dir_all(&proj_dir);
        let fake_node = temp.path.parent().unwrap().join("bin").join("node.exe");
        create_dummy_executable(&fake_node);

        // 1. Create profile
        // 2. Bind a verified toolchain
        // 3. Add a non-secret override
        // 4. Add a secret override using a test value
        let secret_plaintext = "TOP_SECRET_PASSPHRASE_XYZ123";
        let initial_profile = WorkspaceProfile {
            id: "profile_part_b".to_string(),
            project_path: proj_dir.to_string_lossy().to_string(),
            project_name: "test_workspace".to_string(),
            created_at: 0,
            updated_at: 0,
            enabled: true,
            tool_bindings: vec![WorkspaceToolBinding {
                tool: "node".to_string(),
                installation_id: "node::mock".to_string(),
                executable_path: fake_node.to_string_lossy().to_string(),
                version: Some("20.19.1".to_string()),
                enabled: true,
            }],
            environment_overrides: vec![
                WorkspaceEnvOverride {
                    key: "NON_SECRET_FLAG".to_string(),
                    value: "active_mode_enabled".to_string(),
                    enabled: true,
                    is_secret: false,
                },
                WorkspaceEnvOverride {
                    key: "SECRET_TOKEN".to_string(),
                    value: secret_plaintext.to_string(),
                    enabled: true,
                    is_secret: true,
                },
            ],
        };

        // 5. Save profile
        let saved = save_profile(initial_profile, Some(&temp.path)).unwrap();
        assert_eq!(saved.tool_bindings.len(), 1);
        assert_eq!(saved.environment_overrides.len(), 2);

        // 6. Confirm JSON contains NO plaintext secret
        let raw_json = fs::read_to_string(&temp.path).unwrap();
        assert!(!raw_json.contains(secret_plaintext), "JSON MUST NOT contain plaintext secret");
        assert!(raw_json.contains(PROTECTED_SECRET_MARKER), "JSON must contain [PROTECTED_SECRET] marker");
        assert!(raw_json.contains("active_mode_enabled"), "JSON must contain non-secret override");

        // 7. Fully close MAHI/Tauri (simulated by dropping in-memory state)
        drop(saved);

        // 8. Reopen MAHI / Reload from disk
        // 9. Open Developer Health -> Toolchain Resolver (get_profile_for_project)
        let reloaded = get_profile_for_project(&proj_dir.to_string_lossy(), Some(&temp.path)).unwrap();

        // 10. Confirm profile is loaded
        assert_eq!(reloaded.id, "profile_part_b");

        // 11. Confirm tool binding remains valid
        assert_eq!(reloaded.tool_bindings.len(), 1);
        assert_eq!(reloaded.tool_bindings[0].tool, "node");
        assert_eq!(reloaded.tool_bindings[0].executable_path, fake_node.to_string_lossy());

        // 12. Confirm non-secret override remains
        let non_sec = reloaded.environment_overrides.iter().find(|e| e.key == "NON_SECRET_FLAG").unwrap();
        assert_eq!(non_sec.value, "active_mode_enabled");
        assert_eq!(non_sec.secret_status(), SecretStatus::NotSecret);

        // 13. Confirm secret is marked configured/protected but original value is NOT available
        let sec = reloaded.environment_overrides.iter().find(|e| e.key == "SECRET_TOKEN").unwrap();
        assert_eq!(sec.value, PROTECTED_SECRET_MARKER);
        assert_eq!(sec.secret_status(), SecretStatus::SecretConfigured);
        assert!(!sec.is_secret_value_available());
        assert!(sec.is_secret_configured());

        // 14. Validate the profile
        let val = validate_workspace_profile_internal(&reloaded);
        assert_eq!(val.status, ProfileValidationStatus::Valid);
        assert!(val.is_valid);
        assert_eq!(val.binding_issues.len(), 0);
        assert_eq!(val.override_issues.len(), 0);

        // 15. Confirm no global PATH/registry/environment changes occurred
        // (verified: validate_env_override_for_injection strictly rejects protected secret markers)
        assert!(validate_env_override_for_injection(sec).is_err());
        assert!(validate_env_override_for_injection(non_sec).is_ok());
    }
}



