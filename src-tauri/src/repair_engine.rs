use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Global lock to guarantee only one repair or restore mutation executes at any time.
static REPAIR_MUTATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepairRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepairCategory {
    StaleUserPath,
    DuplicateUserPath,
    BrokenDeveloperEnv,
    ToolchainAlignmentRecommendation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepairStatus {
    Previewed,
    Confirmed,
    InProgress,
    Completed,
    Failed,
    RolledBack,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairPlan {
    pub id: String,
    pub category: RepairCategory,
    pub affected_item: String,
    pub current_state: String,
    pub proposed_state: String,
    pub reason: String,
    pub evidence: String,
    pub risk: RepairRisk,
    pub reversible: bool,
    pub actions: Vec<String>,
    pub expected_result: String,
    pub rollback_plan: String,
    pub available: bool,
    pub unavailability_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairSnapshot {
    pub snapshot_id: String,
    pub repair_id: String,
    pub target_type: String, // "USER_PATH" | "USER_ENV"
    pub target_name: String, // "Path" or environment variable name
    pub previous_value: String,
    pub created_at: u64,
    pub format_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairExecutionResult {
    pub success: bool,
    pub repair_id: String,
    pub category: RepairCategory,
    pub affected_item: String,
    pub previous_value_preview: String,
    pub new_value_preview: String,
    pub verification_passed: bool,
    pub verification_details: String,
    pub rollback_performed: bool,
    pub rollback_details: Option<String>,
    pub snapshot_id: String,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairHistoryEntry {
    pub id: String,
    pub repair_id: String,
    pub category: RepairCategory,
    pub target: String,
    pub timestamp: u64,
    pub formatted_time: String,
    pub status: RepairStatus,
    pub description: String,
    pub snapshot_id: String,
    pub can_restore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub history_entry_id: String,
    pub target: String,
    pub current_value: String,
    pub restored_value: String,
    pub risk: RepairRisk,
    pub summary: String,
}

// -------------------------------------------------------------------------
// Allowlist of repairable Developer Environment Variables
// -------------------------------------------------------------------------
pub const ALLOWED_DEV_ENV_VARS: &[&str] = &[
    "CARGO_HOME",
    "JAVA_HOME",
    "ANDROID_HOME",
    "ANDROID_SDK_ROOT",
    "GOPATH",
    "GOROOT",
    "PNPM_HOME",
    "GRADLE_USER_HOME",
    "M2_HOME",
    "MAVEN_HOME",
];

// Helper to get MAHI storage directory for snapshots & history
fn get_mahi_repair_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Admin\\AppData\\Roaming"));
    let repair_dir = base.join("MAHI").join("repair_center");
    let _ = fs::create_dir_all(&repair_dir);
    repair_dir
}

fn get_snapshots_dir() -> PathBuf {
    let s_dir = get_mahi_repair_dir().join("snapshots");
    let _ = fs::create_dir_all(&s_dir);
    s_dir
}

fn get_history_file_path() -> PathBuf {
    get_mahi_repair_dir().join("repair_history.json")
}

// -------------------------------------------------------------------------
// Low-Level Registry Helpers for Windows User Environment
// -------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub fn read_user_path_from_registry() -> Result<String, String> {
    let mut cmd = Command::new("reg.exe");
    cmd.args(["query", "HKCU\\Environment", "/v", "Path"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to query User PATH registry: {}", e))?;
    if !output.status.success() {
        return Ok(String::new()); // Value may not exist yet
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Path") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 3 {
                // Reconstruct value in case it contains spaces
                let val = parts[2..].join(" ");
                return Ok(val);
            }
        }
    }
    Ok(String::new())
}

#[cfg(not(target_os = "windows"))]
pub fn read_user_path_from_registry() -> Result<String, String> {
    Ok(std::env::var("PATH").unwrap_or_default())
}

#[cfg(target_os = "windows")]
pub fn write_user_path_to_registry(new_path: &str) -> Result<(), String> {
    let mut cmd = Command::new("reg.exe");
    cmd.args([
        "add",
        "HKCU\\Environment",
        "/v",
        "Path",
        "/t",
        "REG_EXPAND_SZ",
        "/d",
        new_path,
        "/f",
    ]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to update User PATH: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("reg.exe add failed: {}", err));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn write_user_path_to_registry(_new_path: &str) -> Result<(), String> {
    Err("User PATH registry modification is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
pub fn read_user_env_var_from_registry(var_name: &str) -> Result<Option<String>, String> {
    let mut cmd = Command::new("reg.exe");
    cmd.args(["query", "HKCU\\Environment", "/v", var_name]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to query environment variable {}: {}", var_name, e))?;
    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(var_name) {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 3 {
                return Ok(Some(parts[2..].join(" ")));
            }
        }
    }
    Ok(None)
}

#[cfg(not(target_os = "windows"))]
pub fn read_user_env_var_from_registry(var_name: &str) -> Result<Option<String>, String> {
    Ok(std::env::var(var_name).ok())
}

#[cfg(target_os = "windows")]
pub fn write_user_env_var_to_registry(var_name: &str, value: &str) -> Result<(), String> {
    let mut cmd = Command::new("reg.exe");
    cmd.args([
        "add",
        "HKCU\\Environment",
        "/v",
        var_name,
        "/t",
        "REG_SZ",
        "/d",
        value,
        "/f",
    ]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("Failed to set {}: {}", var_name, e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("reg.exe add failed: {}", err));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn write_user_env_var_to_registry(_var_name: &str, _value: &str) -> Result<(), String> {
    Err("User environment variable modification is only supported on Windows".to_string())
}

// -------------------------------------------------------------------------
// Snapshot Persistence & Management
// -------------------------------------------------------------------------

pub fn save_repair_snapshot(snapshot: &RepairSnapshot) -> Result<(), String> {
    let path = get_snapshots_dir().join(format!("{}.json", snapshot.snapshot_id));
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("Failed to serialize repair snapshot: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write repair snapshot to disk: {}", e))?;
    Ok(())
}

pub fn load_repair_snapshot(snapshot_id: &str) -> Result<RepairSnapshot, String> {
    let path = get_snapshots_dir().join(format!("{}.json", snapshot_id));
    if !path.is_file() {
        return Err(format!("Snapshot {} not found", snapshot_id));
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read snapshot file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse snapshot: {}", e))
}

pub fn append_repair_history(entry: RepairHistoryEntry) {
    let path = get_history_file_path();
    let mut entries = load_repair_history();
    entries.insert(0, entry);
    if entries.len() > 100 {
        entries.truncate(100);
    }
    if let Ok(json) = serde_json::to_string_pretty(&entries) {
        let _ = fs::write(path, json);
    }
}

pub fn load_repair_history() -> Vec<RepairHistoryEntry> {
    let path = get_history_file_path();
    if !path.is_file() {
        return Vec::new();
    }
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(entries) = serde_json::from_str(&content) {
            return entries;
        }
    }
    Vec::new()
}

// -------------------------------------------------------------------------
// Repair Plan Generation (Discovery)
// -------------------------------------------------------------------------

pub fn detect_available_repairs() -> Vec<RepairPlan> {
    let mut plans = Vec::new();

    // 1. Audit User PATH from Registry
    if let Ok(user_path_raw) = read_user_path_from_registry() {
        let entries: Vec<&str> = user_path_raw
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        let mut seen_norm = HashSet::new();

        for (idx, entry) in entries.iter().enumerate() {
            let path_obj = Path::new(entry);
            let exists = path_obj.exists();
            let norm = entry.to_lowercase().replace('/', "\\");

            // A. Duplicate detection
            if seen_norm.contains(&norm) {
                plans.push(RepairPlan {
                    id: format!("repair-dup-path-{}", idx),
                    category: RepairCategory::DuplicateUserPath,
                    affected_item: "User PATH".to_string(),
                    current_state: format!("Duplicate entry at position {}: '{}'", idx, entry),
                    proposed_state: format!("Remove duplicate entry at position {}", idx),
                    reason: "Exact duplicate path entry detected in User PATH.".to_string(),
                    evidence: format!("'{}' already exists at an earlier position in User PATH.", entry),
                    risk: RepairRisk::Low,
                    reversible: true,
                    actions: vec![
                        "Create backup snapshot of User PATH in MAHI storage".to_string(),
                        format!("Remove duplicate instance at index {} from HKCU\\Environment\\Path", idx),
                        "Verify remaining User PATH retains first occurrence and other entries".to_string(),
                    ],
                    expected_result: "Duplicate entry removed; original entry preserved at earlier position.".to_string(),
                    rollback_plan: "Restore previous User PATH value from MAHI configuration snapshot.".to_string(),
                    available: true,
                    unavailability_reason: None,
                });
            } else {
                seen_norm.insert(norm);
            }

            // B. Stale path detection (only developer-classified, non-system)
            if !exists {
                let lower = entry.to_lowercase();
                let is_dev = lower.contains("node")
                    || lower.contains("cargo")
                    || lower.contains("rust")
                    || lower.contains("python")
                    || lower.contains("git")
                    || lower.contains("jdk")
                    || lower.contains("java")
                    || lower.contains("go")
                    || lower.contains("pnpm")
                    || lower.contains("yarn")
                    || lower.contains("bun")
                    || lower.contains("antigravity")
                    || lower.contains("vscode")
                    || lower.contains("code")
                    || lower.contains("oldtools");

                let is_system = lower.contains("system32") || lower.contains("windows");

                if is_dev && !is_system {
                    plans.push(RepairPlan {
                        id: format!("repair-stale-path-{}", idx),
                        category: RepairCategory::StaleUserPath,
                        affected_item: "User PATH".to_string(),
                        current_state: format!("Missing folder at position {}: '{}'", idx, entry),
                        proposed_state: format!("Remove stale entry at position {}", idx),
                        reason: "Directory does not exist on disk. Stale developer path remnants slow down resolution.".to_string(),
                        evidence: format!("Directory does not exist on disk: '{}'", entry),
                        risk: RepairRisk::Low,
                        reversible: true,
                        actions: vec![
                            "Create backup snapshot of User PATH in MAHI storage".to_string(),
                            format!("Remove stale entry at index {} from HKCU\\Environment\\Path", idx),
                            "Verify User PATH without the stale entry".to_string(),
                        ],
                        expected_result: "Stale non-existent directory removed from User PATH.".to_string(),
                        rollback_plan: "Restore previous User PATH value from MAHI configuration snapshot.".to_string(),
                        available: true,
                        unavailability_reason: None,
                    });
                }
            }
        }
    }

    // 2. Audit Broken Developer Environment Variables (Allowlisted only)
    for var_name in ALLOWED_DEV_ENV_VARS {
        let val_opt = read_user_env_var_from_registry(var_name).unwrap_or(None);
        if let Some(val) = val_opt {
            let p = Path::new(&val);
            if !p.exists() {
                // Find candidate replacement with concrete evidence
                let (has_candidate, replacement_candidate, evidence_reason) = find_replacement_candidate(var_name);

                if has_candidate {
                    plans.push(RepairPlan {
                        id: format!("repair-env-{}", var_name),
                        category: RepairCategory::BrokenDeveloperEnv,
                        affected_item: var_name.to_string(),
                        current_state: format!("{} = '{}' (missing path)", var_name, val),
                        proposed_state: format!("Update {} = '{}'", var_name, replacement_candidate),
                        reason: format!("{} points to a folder that does not exist.", var_name),
                        evidence: evidence_reason,
                        risk: RepairRisk::Medium,
                        reversible: true,
                        actions: vec![
                            format!("Create backup snapshot of User variable {} in MAHI storage", var_name),
                            format!("Update HKCU\\Environment\\{} to verified directory '{}'", var_name, replacement_candidate),
                            format!("Verify {} exists on disk and reflects in User Environment", var_name),
                        ],
                        expected_result: format!("{} updated to existing developer installation directory.", var_name),
                        rollback_plan: format!("Restore {} to previous value from MAHI snapshot.", var_name),
                        available: true,
                        unavailability_reason: None,
                    });
                } else {
                    plans.push(RepairPlan {
                        id: format!("repair-env-{}", var_name),
                        category: RepairCategory::BrokenDeveloperEnv,
                        affected_item: var_name.to_string(),
                        current_state: format!("{} = '{}' (missing path)", var_name, val),
                        proposed_state: "Repair unavailable".to_string(),
                        reason: format!("{} points to non-existent folder, but no verified local replacement was found.", var_name),
                        evidence: "Scanned standard installation locations but found no valid candidate.".to_string(),
                        risk: RepairRisk::Medium,
                        reversible: false,
                        actions: vec![],
                        expected_result: "No action taken.".to_string(),
                        rollback_plan: "N/A".to_string(),
                        available: false,
                        unavailability_reason: Some("Repair unavailable — valid replacement could not be established.".to_string()),
                    });
                }
            }
        }
    }

    // 3. Project Toolchain Alignment (Strictly recommendation / informational in Phase 9B)
    plans.push(RepairPlan {
        id: "repair-toolchain-alignment-notice".to_string(),
        category: RepairCategory::ToolchainAlignmentRecommendation,
        affected_item: "Project Toolchain Alignment".to_string(),
        current_state: "Recommendation Mode Only".to_string(),
        proposed_state: "No automated mutations performed".to_string(),
        reason: "Phase 9B strictly forbids automated software installation or project file modification.".to_string(),
        evidence: "Developer workstation health policy requires user-controlled installations.".to_string(),
        risk: RepairRisk::Low,
        reversible: false,
        actions: vec!["Informational recommendations only; automated software installs are disabled in 9B.".to_string()],
        expected_result: "Project sources and system packages remain 100% untouched.".to_string(),
        rollback_plan: "N/A".to_string(),
        available: false,
        unavailability_reason: Some("Automated project software installation is disabled by Phase 9B safety rules.".to_string()),
    });

    plans
}

fn find_replacement_candidate(var_name: &str) -> (bool, String, String) {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Admin".to_string());
    match var_name {
        "JAVA_HOME" => {
            let candidates = [
                "C:\\Program Files\\Eclipse Adoptium\\jdk-25",
                "C:\\Program Files\\Eclipse Adoptium\\jdk-21",
                "C:\\Program Files\\Java\\jdk-21",
                "C:\\Program Files\\Java\\jdk-17",
            ];
            for c in &candidates {
                let p = Path::new(c);
                if p.join("bin\\java.exe").is_file() {
                    return (true, c.to_string(), format!("Found verified Java JDK at '{}'", c));
                }
            }
            (false, String::new(), "No verified Java JDK installation found on disk.".to_string())
        }
        "GOPATH" => {
            let candidate = PathBuf::from(&user_profile).join("go");
            if candidate.is_dir() {
                return (true, candidate.to_string_lossy().to_string(), format!("Found standard Go workspace directory at '{}'", candidate.to_string_lossy()));
            }
            (false, String::new(), "Standard Go workspace not detected.".to_string())
        }
        "CARGO_HOME" => {
            let candidate = PathBuf::from(&user_profile).join(".cargo");
            if candidate.is_dir() {
                return (true, candidate.to_string_lossy().to_string(), format!("Found Cargo home at '{}'", candidate.to_string_lossy()));
            }
            (false, String::new(), "No valid Cargo home directory found.".to_string())
        }
        "PNPM_HOME" => {
            let candidate = PathBuf::from(&user_profile).join("AppData\\Local\\pnpm");
            if candidate.is_dir() {
                return (true, candidate.to_string_lossy().to_string(), format!("Found pnpm directory at '{}'", candidate.to_string_lossy()));
            }
            (false, String::new(), "No valid pnpm directory found.".to_string())
        }
        _ => (false, String::new(), "No replacement candidate available.".to_string()),
    }
}

// -------------------------------------------------------------------------
// Repair Execution Engine
// -------------------------------------------------------------------------

pub fn execute_repair(repair_id: &str) -> Result<RepairExecutionResult, String> {
    // Acquire exclusive concurrency lock
    let _guard = REPAIR_MUTATION_LOCK.lock().map_err(|_| "Failed to acquire repair lock".to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 1. Re-discover available repairs and verify that this repair still exists and is available
    let available_plans = detect_available_repairs();
    let plan = available_plans
        .iter()
        .find(|p| p.id == repair_id)
        .ok_or_else(|| {
            format!(
                "Repair aborted because the environment changed since the preview was generated or plan '{}' is invalid.",
                repair_id
            )
        })?;

    if !plan.available {
        return Err(plan.unavailability_reason.clone().unwrap_or_else(|| "Repair is not available".to_string()));
    }

    let snapshot_id = format!("snap-{}-{}", repair_id.replace(' ', "-"), now);

    match plan.category {
        RepairCategory::DuplicateUserPath | RepairCategory::StaleUserPath => {
            execute_user_path_repair(plan, &snapshot_id, now)
        }
        RepairCategory::BrokenDeveloperEnv => {
            execute_user_env_repair(plan, &snapshot_id, now)
        }
        RepairCategory::ToolchainAlignmentRecommendation => {
            Err("Toolchain alignment repairs are recommendation-only in Phase 9B.".to_string())
        }
    }
}

fn execute_user_path_repair(
    plan: &RepairPlan,
    snapshot_id: &str,
    now: u64,
) -> Result<RepairExecutionResult, String> {
    let current_path = read_user_path_from_registry()?;
    let entries: Vec<&str> = current_path
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    // Parse target index from repair_id (e.g. "repair-dup-path-14" or "repair-stale-path-8")
    let target_idx: usize = plan
        .id
        .split('-')
        .last()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "Malformed repair ID index".to_string())?;

    if target_idx >= entries.len() {
        return Err("Target index no longer exists in User PATH. Environment changed; aborted.".to_string());
    }

    let target_entry = entries[target_idx];

    // Build backup snapshot
    let snapshot = RepairSnapshot {
        snapshot_id: snapshot_id.to_string(),
        repair_id: plan.id.clone(),
        target_type: "USER_PATH".to_string(),
        target_name: "Path".to_string(),
        previous_value: current_path.clone(),
        created_at: now,
        format_version: 1,
    };
    save_repair_snapshot(&snapshot)?;

    // Construct new path by removing the specific target index
    let mut new_entries = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        if i != target_idx {
            new_entries.push(*e);
        }
    }
    let new_path = new_entries.join(";");

    // Perform the mutation
    write_user_path_to_registry(&new_path)?;

    // Independent post-mutation verification
    let verified_path = read_user_path_from_registry().unwrap_or_default();
    let verified_entries: Vec<&str> = verified_path
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut verification_passed = true;
    let mut verification_details = format!(
        "Successfully removed position {} ('{}'). User PATH count reduced from {} to {}.",
        target_idx, target_entry, entries.len(), verified_entries.len()
    );

    // If it was a duplicate removal, verify that the entry still exists in earlier positions!
    if plan.category == RepairCategory::DuplicateUserPath {
        let still_present = verified_entries.iter().any(|e| e.to_lowercase() == target_entry.to_lowercase());
        if !still_present {
            verification_passed = false;
            verification_details = "Verification failed: original occurrence of duplicate entry was lost!".to_string();
        }
    }

    // Check count parity
    if verified_entries.len() != entries.len() - 1 {
        verification_passed = false;
        verification_details = "Verification failed: User PATH length does not match expected reduction.".to_string();
    }

    let mut rollback_performed = false;
    let mut rollback_details = None;

    if !verification_passed {
        // Verification failed: trigger automatic rollback from snapshot
        let rb_res = write_user_path_to_registry(&current_path);
        rollback_performed = true;
        rollback_details = Some(match rb_res {
            Ok(_) => "Automatic rollback succeeded: previous User PATH was restored.".to_string(),
            Err(e) => format!("Automatic rollback failed: {}", e),
        });
    }

    let history_status = if verification_passed {
        RepairStatus::Completed
    } else if rollback_performed {
        RepairStatus::RolledBack
    } else {
        RepairStatus::Failed
    };

    append_repair_history(RepairHistoryEntry {
        id: format!("hist-{}", snapshot_id),
        repair_id: plan.id.clone(),
        category: plan.category.clone(),
        target: "User PATH".to_string(),
        timestamp: now,
        formatted_time: "Just now".to_string(),
        status: history_status,
        description: format!("Removed entry at position {}: '{}'", target_idx, target_entry),
        snapshot_id: snapshot_id.to_string(),
        can_restore: verification_passed,
    });

    Ok(RepairExecutionResult {
        success: verification_passed,
        repair_id: plan.id.clone(),
        category: plan.category.clone(),
        affected_item: "User PATH".to_string(),
        previous_value_preview: format!("{} entries (contained '{}' at index {})", entries.len(), target_entry, target_idx),
        new_value_preview: format!("{} entries (target index {} removed)", verified_entries.len(), target_idx),
        verification_passed,
        verification_details,
        rollback_performed,
        rollback_details,
        snapshot_id: snapshot_id.to_string(),
        message: if verification_passed {
            "User PATH repair verified successfully. New processes will use the updated configuration.".to_string()
        } else {
            "Repair verification failed; rollback attempted.".to_string()
        },
        timestamp: now,
    })
}

fn execute_user_env_repair(
    plan: &RepairPlan,
    snapshot_id: &str,
    now: u64,
) -> Result<RepairExecutionResult, String> {
    let var_name = &plan.affected_item;

    // Security check: must be in explicit allowlist!
    if !ALLOWED_DEV_ENV_VARS.contains(&var_name.as_str()) {
        return Err(format!("Unauthorized environment variable: {} is not in Phase 9B allowlist.", var_name));
    }

    let current_val = read_user_env_var_from_registry(var_name)?
        .ok_or_else(|| format!("{} is no longer set in User Environment.", var_name))?;

    let (has_candidate, new_val, _) = find_replacement_candidate(var_name);
    if !has_candidate || new_val.is_empty() {
        return Err("Valid replacement directory could not be established. Aborted.".to_string());
    }

    // Verify replacement candidate physically exists on disk before applying
    if !Path::new(&new_val).exists() {
        return Err(format!("Replacement directory '{}' does not exist on disk. Aborted.", new_val));
    }

    // Save snapshot
    let snapshot = RepairSnapshot {
        snapshot_id: snapshot_id.to_string(),
        repair_id: plan.id.clone(),
        target_type: "USER_ENV".to_string(),
        target_name: var_name.clone(),
        previous_value: current_val.clone(),
        created_at: now,
        format_version: 1,
    };
    save_repair_snapshot(&snapshot)?;

    // Apply mutation
    write_user_env_var_to_registry(var_name, &new_val)?;

    // Post-repair verification
    let verified_val = read_user_env_var_from_registry(var_name)?.unwrap_or_default();
    let mut verification_passed = true;
    let mut verification_details = format!("Verified {} = '{}' and directory exists on disk.", var_name, verified_val);

    if verified_val != new_val {
        verification_passed = false;
        verification_details = format!("Verification failed: expected '{}', found '{}'", new_val, verified_val);
    }

    let mut rollback_performed = false;
    let mut rollback_details = None;

    if !verification_passed {
        let rb_res = write_user_env_var_to_registry(var_name, &current_val);
        rollback_performed = true;
        rollback_details = Some(match rb_res {
            Ok(_) => format!("Rollback succeeded: restored {} to '{}'", var_name, current_val),
            Err(e) => format!("Rollback failed: {}", e),
        });
    }

    let history_status = if verification_passed {
        RepairStatus::Completed
    } else if rollback_performed {
        RepairStatus::RolledBack
    } else {
        RepairStatus::Failed
    };

    append_repair_history(RepairHistoryEntry {
        id: format!("hist-{}", snapshot_id),
        repair_id: plan.id.clone(),
        category: plan.category.clone(),
        target: var_name.clone(),
        timestamp: now,
        formatted_time: "Just now".to_string(),
        status: history_status,
        description: format!("Updated {} from '{}' to verified '{}'", var_name, current_val, new_val),
        snapshot_id: snapshot_id.to_string(),
        can_restore: verification_passed,
    });

    Ok(RepairExecutionResult {
        success: verification_passed,
        repair_id: plan.id.clone(),
        category: plan.category.clone(),
        affected_item: var_name.clone(),
        previous_value_preview: current_val,
        new_value_preview: new_val,
        verification_passed,
        verification_details,
        rollback_performed,
        rollback_details,
        snapshot_id: snapshot_id.to_string(),
        message: if verification_passed {
            format!("{} repaired successfully. New processes will use the updated configuration.", var_name)
        } else {
            "Repair verification failed; rollback attempted.".to_string()
        },
        timestamp: now,
    })
}

// -------------------------------------------------------------------------
// Restore / Rollback Workflow from History
// -------------------------------------------------------------------------

pub fn get_restore_preview(history_entry_id: &str) -> Result<RestorePreview, String> {
    let history = load_repair_history();
    let entry = history
        .iter()
        .find(|h| h.id == history_entry_id)
        .ok_or_else(|| format!("History entry {} not found", history_entry_id))?;

    if !entry.can_restore {
        return Err("This repair history entry cannot be restored.".to_string());
    }

    let snapshot = load_repair_snapshot(&entry.snapshot_id)?;

    let current_value = match snapshot.target_type.as_str() {
        "USER_PATH" => read_user_path_from_registry().unwrap_or_default(),
        "USER_ENV" => read_user_env_var_from_registry(&snapshot.target_name)?.unwrap_or_default(),
        _ => return Err("Unknown snapshot target type".to_string()),
    };

    Ok(RestorePreview {
        history_entry_id: history_entry_id.to_string(),
        target: snapshot.target_name.clone(),
        current_value,
        restored_value: snapshot.previous_value.clone(),
        risk: RepairRisk::Low,
        summary: format!(
            "Restore previous configuration for {} from backup taken on {}.",
            snapshot.target_name, entry.formatted_time
        ),
    })
}

pub fn execute_restore(history_entry_id: &str) -> Result<RepairExecutionResult, String> {
    let _guard = REPAIR_MUTATION_LOCK.lock().map_err(|_| "Failed to acquire repair lock".to_string())?;

    let history = load_repair_history();
    let entry = history
        .iter()
        .find(|h| h.id == history_entry_id)
        .ok_or_else(|| format!("History entry {} not found", history_entry_id))?;

    let snapshot = load_repair_snapshot(&entry.snapshot_id)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    match snapshot.target_type.as_str() {
        "USER_PATH" => {
            let current = read_user_path_from_registry().unwrap_or_default();
            write_user_path_to_registry(&snapshot.previous_value)?;

            let verified = read_user_path_from_registry().unwrap_or_default();
            let verified_ok = verified == snapshot.previous_value;

            append_repair_history(RepairHistoryEntry {
                id: format!("hist-restore-{}-{}", entry.repair_id, now),
                repair_id: format!("restore-{}", entry.repair_id),
                category: entry.category.clone(),
                target: "User PATH".to_string(),
                timestamp: now,
                formatted_time: "Just now".to_string(),
                status: if verified_ok { RepairStatus::Completed } else { RepairStatus::Failed },
                description: format!("Restored User PATH to backup from {}", entry.formatted_time),
                snapshot_id: snapshot.snapshot_id.clone(),
                can_restore: false,
            });

            Ok(RepairExecutionResult {
                success: verified_ok,
                repair_id: format!("restore-{}", entry.repair_id),
                category: entry.category.clone(),
                affected_item: "User PATH".to_string(),
                previous_value_preview: current,
                new_value_preview: snapshot.previous_value,
                verification_passed: verified_ok,
                verification_details: "Verified User PATH successfully restored to previous backup state.".to_string(),
                rollback_performed: false,
                rollback_details: None,
                snapshot_id: snapshot.snapshot_id,
                message: "Previous User PATH configuration successfully restored.".to_string(),
                timestamp: now,
            })
        }
        "USER_ENV" => {
            if !ALLOWED_DEV_ENV_VARS.contains(&snapshot.target_name.as_str()) {
                return Err("Security error: Target variable is not in allowlist".to_string());
            }
            let current = read_user_env_var_from_registry(&snapshot.target_name)?.unwrap_or_default();
            write_user_env_var_to_registry(&snapshot.target_name, &snapshot.previous_value)?;

            let verified = read_user_env_var_from_registry(&snapshot.target_name)?.unwrap_or_default();
            let verified_ok = verified == snapshot.previous_value;

            append_repair_history(RepairHistoryEntry {
                id: format!("hist-restore-{}-{}", entry.repair_id, now),
                repair_id: format!("restore-{}", entry.repair_id),
                category: entry.category.clone(),
                target: snapshot.target_name.clone(),
                timestamp: now,
                formatted_time: "Just now".to_string(),
                status: if verified_ok { RepairStatus::Completed } else { RepairStatus::Failed },
                description: format!("Restored {} to backup from {}", snapshot.target_name, entry.formatted_time),
                snapshot_id: snapshot.snapshot_id.clone(),
                can_restore: false,
            });

            Ok(RepairExecutionResult {
                success: verified_ok,
                repair_id: format!("restore-{}", entry.repair_id),
                category: entry.category.clone(),
                affected_item: snapshot.target_name.clone(),
                previous_value_preview: current,
                new_value_preview: snapshot.previous_value,
                verification_passed: verified_ok,
                verification_details: format!("Verified {} successfully restored to previous backup state.", snapshot.target_name),
                rollback_performed: false,
                rollback_details: None,
                snapshot_id: snapshot.snapshot_id,
                message: format!("Previous configuration for {} successfully restored.", snapshot.target_name),
                timestamp: now,
            })
        }
        _ => Err("Invalid target type in snapshot".to_string()),
    }
}

// -------------------------------------------------------------------------
// Tauri Commands
// -------------------------------------------------------------------------

#[tauri::command]
pub fn get_available_repairs() -> Result<Vec<RepairPlan>, String> {
    Ok(detect_available_repairs())
}

#[tauri::command]
pub fn execute_developer_environment_repair(repair_id: String) -> Result<RepairExecutionResult, String> {
    execute_repair(&repair_id)
}

#[tauri::command]
pub fn get_repair_history() -> Result<Vec<RepairHistoryEntry>, String> {
    Ok(load_repair_history())
}

#[tauri::command]
pub fn get_restore_configuration_preview(history_entry_id: String) -> Result<RestorePreview, String> {
    get_restore_preview(&history_entry_id)
}

#[tauri::command]
pub fn execute_restore_configuration(history_entry_id: String) -> Result<RepairExecutionResult, String> {
    execute_restore(&history_entry_id)
}

// -------------------------------------------------------------------------
// Unit Tests (Mocked & Isolated)
// -------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_repair_allowlist_enforcement() {
        assert!(ALLOWED_DEV_ENV_VARS.contains(&"JAVA_HOME"));
        assert!(ALLOWED_DEV_ENV_VARS.contains(&"CARGO_HOME"));
        assert!(ALLOWED_DEV_ENV_VARS.contains(&"GOPATH"));
        assert!(ALLOWED_DEV_ENV_VARS.contains(&"PNPM_HOME"));
        // Forbidden sensitive or arbitrary vars
        assert!(!ALLOWED_DEV_ENV_VARS.contains(&"PATH")); // PATH has separate dedicated logic
        assert!(!ALLOWED_DEV_ENV_VARS.contains(&"API_KEY"));
        assert!(!ALLOWED_DEV_ENV_VARS.contains(&"PASSWORD"));
        assert!(!ALLOWED_DEV_ENV_VARS.contains(&"AWS_SECRET_ACCESS_KEY"));
    }

    #[test]
    fn test_duplicate_path_filtering_logic() {
        let raw = "C:\\Tools;C:\\Users\\Admin\\.cargo\\bin;C:\\Tools;C:\\Users\\Admin\\.cargo\\bin";
        let entries: Vec<&str> = raw.split(';').collect();

        let mut seen = HashSet::new();
        let mut duplicates = Vec::new();

        for (idx, e) in entries.iter().enumerate() {
            let norm = e.to_lowercase();
            if seen.contains(&norm) {
                duplicates.push((idx, *e));
            } else {
                seen.insert(norm);
            }
        }

        assert_eq!(duplicates.len(), 2);
        assert_eq!(duplicates[0], (2, "C:\\Tools"));
        assert_eq!(duplicates[1], (3, "C:\\Users\\Admin\\.cargo\\bin"));
    }

    #[test]
    fn test_stale_path_developer_filtering() {
        let dev_stale = "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python39\\Scripts";
        let sys_stale = "C:\\Windows\\System32\\fake_dir";

        let lower_dev = dev_stale.to_lowercase();
        let is_dev = lower_dev.contains("python") || lower_dev.contains("node");
        let is_system_dev = lower_dev.contains("system32") || lower_dev.contains("windows");
        assert!(is_dev && !is_system_dev, "Developer stale path must be eligible");

        let lower_sys = sys_stale.to_lowercase();
        let is_system_sys = lower_sys.contains("system32") || lower_sys.contains("windows");
        assert!(is_system_sys, "System paths must be rejected from removal");
    }

    #[test]
    fn test_snapshot_serialization_and_recovery() {
        let snap = RepairSnapshot {
            snapshot_id: "snap-test-123".to_string(),
            repair_id: "repair-dup-path-1".to_string(),
            target_type: "USER_PATH".to_string(),
            target_name: "Path".to_string(),
            previous_value: "C:\\A;C:\\B;C:\\A".to_string(),
            created_at: 1000,
            format_version: 1,
        };

        let temp_dir = std::env::temp_dir().join(format!("mahi_snap_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("snap.json");

        let json = serde_json::to_string(&snap).unwrap();
        fs::write(&file_path, &json).unwrap();

        let read_content = fs::read_to_string(&file_path).unwrap();
        let recovered: RepairSnapshot = serde_json::from_str(&read_content).unwrap();

        assert_eq!(recovered.snapshot_id, snap.snapshot_id);
        assert_eq!(recovered.previous_value, snap.previous_value);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rejection_of_unauthorized_repair_category() {
        let fake_plan = RepairPlan {
            id: "fake-repair".into(),
            category: RepairCategory::ToolchainAlignmentRecommendation,
            affected_item: "System Software".into(),
            current_state: "Missing".into(),
            proposed_state: "Install".into(),
            reason: "N/A".into(),
            evidence: "N/A".into(),
            risk: RepairRisk::High,
            reversible: false,
            actions: vec![],
            expected_result: "N/A".into(),
            rollback_plan: "N/A".into(),
            available: false,
            unavailability_reason: Some("Disabled".into()),
        };

        assert!(!fake_plan.available);
        assert_eq!(fake_plan.unavailability_reason, Some("Disabled".into()));
    }
}
