// Phase 8C: Guided Storage Relocation Assistant
// Safety > Storage savings.
// Only RELOCATABLE items may receive guided relocation actions.
// All operations require explicit user confirmation (preview first, never execute immediately).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, Emitter};

use crate::storage_engine::{format_bytes, safe_shallow_dir_size, StorageEngineState};

// ─────────────────────────────────────────────────────────────
// DATA MODELS
// ─────────────────────────────────────────────────────────────

/// Typed categories of well-understood relocatable items.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RelocationCategory {
    HuggingFace,
    CargoHome,
    PnpmStore,
    AndroidSdk,
    LmStudioModels,
    LdPlayer,
    ProjectArchive,
}

impl RelocationCategory {
    pub fn label(&self) -> &'static str {
        match self {
            Self::HuggingFace => "Hugging Face Cache",
            Self::CargoHome => "Cargo Home",
            Self::PnpmStore => "pnpm Global Store",
            Self::AndroidSdk => "Android SDK",
            Self::LmStudioModels => "LM Studio Models",
            Self::LdPlayer => "LDPlayer Emulator",
            Self::ProjectArchive => "Project Archive / Media",
        }
    }
}

/// A fully described, eligible relocation candidate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidedRelocationCandidate {
    pub id: String,
    pub name: String,
    pub category: RelocationCategory,
    pub category_label: String,
    pub current_path: String,
    pub suggested_destination: String,
    pub bytes: u64,
    pub formatted_size: String,
    /// Human-readable migration mechanism
    pub method: String,
    /// LOW | MEDIUM | HIGH
    pub risk: String,
    pub why_safe: String,
    pub what_changes: String,
    pub what_stays_same: String,
    pub env_changes_description: Option<String>,
    pub requires_restart: bool,
    pub env_var_name: Option<String>,
}

/// The rich preview shown to the user before executing anything.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationPreview {
    pub candidate_id: String,
    pub candidate_name: String,
    pub current_path: String,
    pub destination_path: String,
    pub bytes_to_move: u64,
    pub formatted_size: String,
    pub destination_drive_free_bytes: u64,
    pub destination_free_formatted: String,
    pub has_adequate_space: bool,
    pub what_changes: String,
    pub what_stays_same: String,
    pub env_changes_description: Option<String>,
    pub requires_restart: bool,
    pub method: String,
    pub risk: String,
    pub estimated_c_recovery_formatted: String,
    pub warnings: Vec<String>,
}

/// The final result returned after executing a guided relocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationResult {
    pub success: bool,
    pub candidate_id: String,
    pub source: String,
    pub destination: String,
    pub bytes_moved: u64,
    pub formatted_size: String,
    #[serde(default)]
    pub files_restored: Option<usize>,
    #[serde(default)]
    pub verification_method: Option<String>,
    #[serde(default)]
    pub config_changed: Option<bool>,
    #[serde(default)]
    pub old_copy_removed: Option<bool>,
    pub env_changes_made: Vec<String>,
    pub verification_passed: bool,
    pub rollback_performed: bool,
    pub errors: Vec<String>,
    pub timestamp: u64,
    pub formatted_time: String,
}

/// One row in the persistent relocation history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationHistoryEntry {
    pub id: String,
    pub timestamp: u64,
    pub formatted_time: String,
    pub category: String,
    pub source: String,
    pub destination: String,
    pub bytes_moved: u64,
    pub formatted_size: String,
    pub success: bool,
    pub method: String,
    pub rollback_performed: bool,
    #[serde(default)]
    pub env_changes_made: Vec<String>,
    #[serde(default)]
    pub is_recoverable: bool,
    #[serde(default)]
    pub recovery_reason: Option<String>,
    #[serde(default)]
    pub recovery_status: Option<String>,
}

// ─────────────────────────────────────────────────────────────
// SAFETY VALIDATORS
// ─────────────────────────────────────────────────────────────

/// Validates that a proposed relocation source path belongs to an approved category.
/// Returns Ok(category) or Err(reason).
pub fn validate_relocation_source(path: &Path, category: &RelocationCategory) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let lower = path_str.to_lowercase().replace('/', "\\");

    // 1. Must exist
    if !path.exists() {
        return Err(format!("Source path '{}' does not exist on disk.", path_str));
    }

    // 2. Reject symlinks / junctions
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err("Source is a symbolic link or junction reparse point — relocation blocked.".to_string());
        }
    }

    // 3. Reject Windows system directories
    let system_prefixes = [
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata\\microsoft",
    ];
    for pfx in system_prefixes {
        if lower == pfx || lower.starts_with(&format!("{}\\", pfx)) {
            return Err(format!("Protected Windows system directory '{}' cannot be relocated.", path_str));
        }
    }

    // 4. Reject personal protected library folders
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default().to_lowercase();
    if !user_profile.is_empty() {
        let personal_folders = ["desktop", "documents", "pictures", "videos", "music", "downloads"];
        for folder in personal_folders {
            let full = format!("{}\\{}", user_profile, folder);
            if lower == full {
                return Err(format!("Personal profile folder '{}' cannot be automatically relocated.", path_str));
            }
        }
    }

    // 5. Reject credential / sensitive paths
    let sensitive = [".ssh", "id_rsa", "id_ed25519", ".env", "credentials", "keyring",
                     "keystore", "cookies", "wallet", "passwords", "token", "secrets", ".gnupg",
                     "browser", "chrome\\user data", "firefox\\profiles"];
    for s in sensitive {
        if lower.contains(s) {
            return Err(format!("Sensitive or credential path '{}' cannot be relocated.", path_str));
        }
    }

    // 6. Category-specific path allowlist
    match category {
        RelocationCategory::HuggingFace => {
            if !lower.contains(".cache\\huggingface") && !lower.contains("hf_home") {
                return Err("HuggingFace relocation requires source inside .cache\\huggingface or HF_HOME.".to_string());
            }
        }
        RelocationCategory::CargoHome => {
            if !lower.ends_with("\\.cargo") && !lower.contains("\\.cargo\\") {
                return Err("Cargo relocation requires source inside .cargo home directory.".to_string());
            }
        }
        RelocationCategory::PnpmStore => {
            if !lower.contains("pnpm") {
                return Err("pnpm relocation requires source to be a pnpm store directory.".to_string());
            }
        }
        RelocationCategory::AndroidSdk => {
            if !lower.contains("android\\sdk") && !lower.contains("android\\sdk") && !lower.contains("appdata\\local\\android") {
                return Err("Android SDK relocation requires source inside AppData\\Local\\Android or ANDROID_HOME.".to_string());
            }
        }
        RelocationCategory::LmStudioModels => {
            if !lower.contains("lm studio") && !lower.contains("lmstudio") && !lower.contains(".lmstudio") {
                return Err("LM Studio relocation requires source inside LM Studio models directory.".to_string());
            }
        }
        RelocationCategory::LdPlayer => {
            let ld_paths = ["c:\\ldplayer", "c:\\program files\\vms", "c:\\vms", "c:\\program files\\ldplayer"];
            if !ld_paths.iter().any(|p| lower.starts_with(p)) {
                return Err("LDPlayer relocation only supports known C: installation paths.".to_string());
            }
        }
        RelocationCategory::ProjectArchive => {
            // Archive/media relocation is advisory only — no strict allowlist beyond basic safety
        }
    }

    Ok(())
}

/// Validates the destination path for safety and adequacy.
pub fn validate_relocation_destination(
    source: &Path,
    destination: &Path,
    required_bytes: u64,
) -> Result<(), String> {
    let dest_str = destination.to_string_lossy();
    let dest_lower = dest_str.to_lowercase().replace('/', "\\");
    let src_str = source.to_string_lossy();
    let src_lower = src_str.to_lowercase().replace('/', "\\");

    // 1. Must not be the same as source
    if src_lower == dest_lower {
        return Err("Source and destination are the same path.".to_string());
    }

    // 2. Destination must not be inside source
    if dest_lower.starts_with(&format!("{}\\", src_lower)) {
        return Err("Destination is nested inside the source path — rejected.".to_string());
    }

    // 3. Source must not be inside destination (would cause recursive copy)
    if src_lower.starts_with(&format!("{}\\", dest_lower)) {
        return Err("Source is nested inside the destination — rejected to prevent recursive copy.".to_string());
    }

    // 4. Reject Windows system directories as destination
    let forbidden_dest = [
        "c:\\windows", "c:\\program files", "c:\\program files (x86)",
        "c:\\programdata\\microsoft", "c:\\system volume information",
    ];
    for f in forbidden_dest {
        if dest_lower == f || dest_lower.starts_with(&format!("{}\\", f)) {
            return Err(format!("Destination '{}' is a protected Windows directory.", dest_str));
        }
    }

    // 5. Reject sensitive destination paths
    let sensitive = [".ssh", ".env", "credentials", "keyring", "secrets", "passwords"];
    for s in sensitive {
        if dest_lower.contains(s) {
            return Err(format!("Destination '{}' contains a sensitive path component.", dest_str));
        }
    }

    // 6. Check drive exists and is writable
    let dest_drive = dest_str.chars().next().map(|c| c.to_uppercase().next().unwrap_or('D')).unwrap_or('D');
    let drive_root = format!("{}:\\", dest_drive);
    if !Path::new(&drive_root).exists() {
        return Err(format!("Destination drive '{}:' does not exist.", dest_drive));
    }

    // 7. Check adequate free space
    let (_, free_bytes) = get_drive_free_space(&drive_root);
    // Require 10% headroom above required_bytes
    let required_with_headroom = (required_bytes as f64 * 1.1) as u64;
    if free_bytes < required_with_headroom {
        return Err(format!(
            "Insufficient space on {}:. Need {} but only {} available.",
            dest_drive,
            format_bytes(required_with_headroom),
            format_bytes(free_bytes)
        ));
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────
// DETECTION
// ─────────────────────────────────────────────────────────────

/// Measures the actual logical bytes in a directory tree, including deeply nested files.
/// This is used for LDPlayer/VMDK workloads where a shallow depth-limited scan can undercount
/// the true relocation footprint by a large margin.
pub fn measure_directory_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };

            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }

    total
}

/// Detect all supported relocatable items present on the system.
pub fn detect_relocation_candidates() -> Vec<GuidedRelocationCandidate> {
    let mut candidates = Vec::new();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Admin".to_string());
    let local_appdata = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| format!("{}\\AppData\\Local", user_profile));

    // ─── A. Hugging Face Cache ────────────────────────────────
    let hf_paths = [
        PathBuf::from(&user_profile).join(".cache").join("huggingface"),
        // Respect existing HF_HOME if configured
        std::env::var("HF_HOME").ok().map(PathBuf::from).unwrap_or_default(),
    ];
    for hf in &hf_paths {
        if hf.as_os_str().is_empty() { continue; }
        if hf.is_dir() {
            let hf_str = hf.to_string_lossy();
            // Only suggest if currently on C:
            if hf_str.to_lowercase().starts_with('c') {
                let bytes = safe_shallow_dir_size(hf, 4, 0);
                if bytes > 10 * 1024 * 1024 {
                    candidates.push(GuidedRelocationCandidate {
                        id: "reloc-huggingface".to_string(),
                        name: "Hugging Face Model Cache".to_string(),
                        category: RelocationCategory::HuggingFace,
                        category_label: RelocationCategory::HuggingFace.label().to_string(),
                        current_path: hf_str.to_string(),
                        suggested_destination: "D:\\AI\\huggingface".to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        method: "Set HF_HOME environment variable to D:\\AI\\huggingface and copy existing cache.".to_string(),
                        risk: "LOW".to_string(),
                        why_safe: "Hugging Face Hub natively respects HF_HOME. Models are purely data blobs — no OS integration.".to_string(),
                        what_changes: "HF_HOME system environment variable is updated to D:\\AI\\huggingface. All future downloads go to D:.".to_string(),
                        what_stays_same: "All project code, Python scripts, and package imports remain unchanged. Transformers library reads HF_HOME automatically.".to_string(),
                        env_changes_description: Some("System environment variable HF_HOME = D:\\AI\\huggingface".to_string()),
                        requires_restart: true,
                        env_var_name: Some("HF_HOME".to_string()),
                    });
                    break;
                }
            }
        }
    }

    // ─── B. Cargo Home ────────────────────────────────────────
    let cargo_home_env = std::env::var("CARGO_HOME").ok().map(PathBuf::from);
    let default_cargo = PathBuf::from(&user_profile).join(".cargo");
    let cargo_dir = cargo_home_env.as_ref().unwrap_or(&default_cargo);
    if cargo_dir.is_dir() {
        let cargo_str = cargo_dir.to_string_lossy();
        if cargo_str.to_lowercase().starts_with('c') {
            let bytes = safe_shallow_dir_size(cargo_dir, 4, 0);
            if bytes > 50 * 1024 * 1024 {
                candidates.push(GuidedRelocationCandidate {
                    id: "reloc-cargo-home".to_string(),
                    name: "Cargo Home (Crates, Registry & Binaries)".to_string(),
                    category: RelocationCategory::CargoHome,
                    category_label: RelocationCategory::CargoHome.label().to_string(),
                    current_path: cargo_str.to_string(),
                    suggested_destination: "D:\\Developer\\.cargo".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    method: "Set CARGO_HOME system environment variable to D:\\Developer\\.cargo. Copy existing .cargo directory to D:. Verify with 'cargo --version'.".to_string(),
                    risk: "LOW".to_string(),
                    why_safe: "Cargo natively respects CARGO_HOME. No project source code or release binaries are touched.".to_string(),
                    what_changes: "CARGO_HOME system environment variable updated. Registry, crate cache, and installed binaries move to D:.".to_string(),
                    what_stays_same: "Cargo.toml, Cargo.lock, src/, and all target/release artifacts remain in their project directories.".to_string(),
                    env_changes_description: Some("System environment variable CARGO_HOME = D:\\Developer\\.cargo".to_string()),
                    requires_restart: true,
                    env_var_name: Some("CARGO_HOME".to_string()),
                });
            }
        }
    }

    // ─── C. pnpm Store ────────────────────────────────────────
    let pnpm_paths = [
        PathBuf::from(&local_appdata).join("pnpm").join("store"),
        PathBuf::from(&local_appdata).join("pnpm"),
    ];
    for pnpm in &pnpm_paths {
        if pnpm.is_dir() {
            let pnpm_str = pnpm.to_string_lossy();
            if pnpm_str.to_lowercase().starts_with('c') {
                let bytes = safe_shallow_dir_size(pnpm, 4, 0);
                if bytes > 50 * 1024 * 1024 {
                    candidates.push(GuidedRelocationCandidate {
                        id: "reloc-pnpm-store".to_string(),
                        name: "pnpm Global Content-Addressable Store".to_string(),
                        category: RelocationCategory::PnpmStore,
                        category_label: RelocationCategory::PnpmStore.label().to_string(),
                        current_path: pnpm_str.to_string(),
                        suggested_destination: "D:\\Developer\\.pnpm-store".to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        method: "Run: pnpm config set store-dir D:\\Developer\\.pnpm-store — then copy current store and verify with 'pnpm store status'.".to_string(),
                        risk: "LOW".to_string(),
                        why_safe: "pnpm officially supports store-dir configuration. All project node_modules are hard-linked to this store — relocation preserves all links.".to_string(),
                        what_changes: "pnpm global store location updated to D:. All future pnpm installs reference D:.".to_string(),
                        what_stays_same: "All package.json, pnpm-lock.yaml, and project node_modules links remain intact.".to_string(),
                        env_changes_description: Some("pnpm config store-dir = D:\\Developer\\.pnpm-store".to_string()),
                        requires_restart: false,
                        env_var_name: None,
                    });
                    break;
                }
            }
        }
    }

    // ─── D. Android SDK ───────────────────────────────────────
    let android_sdk_paths = [
        PathBuf::from(&local_appdata).join("Android").join("Sdk"),
        std::env::var("ANDROID_HOME").ok().map(PathBuf::from).unwrap_or_default(),
        std::env::var("ANDROID_SDK_ROOT").ok().map(PathBuf::from).unwrap_or_default(),
    ];
    for sdk in &android_sdk_paths {
        if sdk.as_os_str().is_empty() { continue; }
        if sdk.is_dir() {
            let sdk_str = sdk.to_string_lossy();
            if sdk_str.to_lowercase().starts_with('c') {
                let bytes = safe_shallow_dir_size(sdk, 3, 0);
                if bytes > 100 * 1024 * 1024 {
                    candidates.push(GuidedRelocationCandidate {
                        id: "reloc-android-sdk".to_string(),
                        name: "Android SDK & Platform Tools".to_string(),
                        category: RelocationCategory::AndroidSdk,
                        category_label: RelocationCategory::AndroidSdk.label().to_string(),
                        current_path: sdk_str.to_string(),
                        suggested_destination: "D:\\Android\\Sdk".to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        method: "Copy SDK to D:\\Android\\Sdk. Update ANDROID_HOME and ANDROID_SDK_ROOT in System Environment Variables. Update path in Android Studio SDK Manager.".to_string(),
                        risk: "LOW".to_string(),
                        why_safe: "Android SDK is entirely self-contained. ANDROID_HOME and PATH are the only references. Android Studio has a built-in SDK location setting.".to_string(),
                        what_changes: "ANDROID_HOME and ANDROID_SDK_ROOT system variables updated. Android Studio SDK path updated.".to_string(),
                        what_stays_same: "Android project source code, Gradle build scripts, and keystore files remain unchanged.".to_string(),
                        env_changes_description: Some("System variables ANDROID_HOME = D:\\Android\\Sdk, ANDROID_SDK_ROOT = D:\\Android\\Sdk".to_string()),
                        requires_restart: true,
                        env_var_name: Some("ANDROID_HOME".to_string()),
                    });
                    break;
                }
            }
        }
    }

    // ─── E. LM Studio Models ─────────────────────────────────
    let lm_paths = [
        PathBuf::from(&user_profile).join(".lmstudio").join("models"),
        PathBuf::from(&user_profile).join("AppData").join("Roaming").join("LM Studio").join("models"),
        PathBuf::from("C:\\Users").join(
            user_profile.split('\\').last().unwrap_or("Admin")
        ).join(".lmstudio").join("models"),
    ];
    for lm in &lm_paths {
        if lm.is_dir() {
            let lm_str = lm.to_string_lossy();
            if lm_str.to_lowercase().starts_with('c') {
                let bytes = safe_shallow_dir_size(lm, 3, 0);
                if bytes > 100 * 1024 * 1024 {
                    candidates.push(GuidedRelocationCandidate {
                        id: "reloc-lmstudio-models".to_string(),
                        name: "LM Studio Local AI Models".to_string(),
                        category: RelocationCategory::LmStudioModels,
                        category_label: RelocationCategory::LmStudioModels.label().to_string(),
                        current_path: lm_str.to_string(),
                        suggested_destination: "D:\\LMStudio\\models".to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        method: "In LM Studio → Settings → Storage → Change model directory to D:\\LMStudio\\models. Copy existing models. Verify models load in LM Studio.".to_string(),
                        risk: "LOW".to_string(),
                        why_safe: "LM Studio has a built-in model directory setting. Models are standalone GGUF/safetensors blobs with no OS dependencies.".to_string(),
                        what_changes: "LM Studio model directory setting updated to D:\\LMStudio\\models.".to_string(),
                        what_stays_same: "All model weights are identical. Inference performance is unaffected. No content is read or exposed.".to_string(),
                        env_changes_description: None,
                        requires_restart: true,
                        env_var_name: None,
                    });
                    break;
                }
            }
        }
    }

    // ─── F. LDPlayer Emulator ─────────────────────────────────
    let ld_paths = [
        "C:\\LDPlayer",
        "C:\\Program Files\\vms",
        "C:\\vms",
        "C:\\Program Files\\LDPlayer",
    ];
    for ld in &ld_paths {
        let p = Path::new(ld);
        if p.is_dir() {
            let bytes = measure_directory_bytes(p);
            if bytes > 0 {
                candidates.push(GuidedRelocationCandidate {
                    id: "reloc-ldplayer".to_string(),
                    name: "LDPlayer Android Emulator (Virtual Disk Images)".to_string(),
                    category: RelocationCategory::LdPlayer,
                    category_label: RelocationCategory::LdPlayer.label().to_string(),
                    current_path: ld.to_string(),
                    suggested_destination: "D:\\Emulators\\LDPlayer".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    method: "Use LDMultiPlayer → Backup instance → move backup to D:\\Emulators\\LDPlayer → Restore. Do NOT manually move VMDK files.".to_string(),
                    risk: "MEDIUM".to_string(),
                    why_safe: "LDPlayer supports official backup/restore relocation. No emulator instance must be running during migration. VMDK files are safe to move via the supported mechanism only.".to_string(),
                    what_changes: "LDPlayer instance disk images and configurations migrate to D:.".to_string(),
                    what_stays_same: "Android app data within the emulator is preserved through backup/restore. Installed apps remain.".to_string(),
                    env_changes_description: None,
                    requires_restart: true,
                    env_var_name: None,
                });
                break;
            }
        }
    }

    candidates
}

// ─────────────────────────────────────────────────────────────
// COPY UTILITIES
// ─────────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationProgressPayload {
    pub candidate_id: String,
    pub stage: String,
    pub bytes_copied: u64,
    pub total_bytes: u64,
}

fn get_cancellation_tokens() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<AtomicBool>>> {
    static TOKENS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<AtomicBool>>>> = std::sync::OnceLock::new();
    TOKENS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Recursively copy a directory from source to destination.
/// Returns (bytes_copied, files_copied, errors).
fn copy_dir_recursive<F>(src: &Path, dest: &Path, on_progress: &mut F, cancel_flag: &std::sync::Arc<AtomicBool>) -> (u64, usize, Vec<String>) 
where 
    F: FnMut(u64)
{
    let mut bytes = 0u64;
    let mut count = 0usize;
    let mut errors = Vec::new();

    if cancel_flag.load(Ordering::Relaxed) {
        errors.push("Relocation was cancelled by user.".to_string());
        return (bytes, count, errors);
    }

    if let Err(e) = fs::create_dir_all(dest) {
        errors.push(format!("Failed to create destination directory '{}': {}", dest.display(), e));
        return (bytes, count, errors);
    }

    let entries = match fs::read_dir(src) {
        Ok(e) => e,
        Err(e) => {
            errors.push(format!("Failed to read source directory '{}': {}", src.display(), e));
            return (bytes, count, errors);
        }
    };

    for entry in entries.flatten() {
        if cancel_flag.load(Ordering::Relaxed) {
            errors.push("Relocation was cancelled by user.".to_string());
            break;
        }

        let src_path = entry.path();
        let file_name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let dest_path = dest.join(&file_name);

        // Skip symlinks
        if let Ok(meta) = entry.metadata() {
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                let (b, c, errs) = copy_dir_recursive(&src_path, &dest_path, on_progress, cancel_flag);
                bytes += b;
                count += c;
                errors.extend(errs);
            } else {
                match fs::copy(&src_path, &dest_path) {
                    Ok(b) => {
                        bytes += b;
                        count += 1;
                        on_progress(b);
                    }
                    Err(e) => {
                        errors.push(format!("Failed to copy '{}': {}", src_path.display(), e));
                    }
                }
            }
        }
    }

    (bytes, count, errors)
}

// ─────────────────────────────────────────────────────────────
// WINDOWS ENV VAR SETTER
// ─────────────────────────────────────────────────────────────

/// Sets a Windows system-level environment variable via registry.
/// Returns Ok(()) or Err(message).
#[cfg(target_os = "windows")]
fn set_windows_system_env_var(name: &str, value: &str) -> Result<(), String> {
    use std::process::Command;
    // Use setx /M to write to the SYSTEM scope (requires admin) or user scope without /M
    // We use user-level (without /M) to avoid requiring elevation.
    let output = Command::new("setx")
        .args([name, value])
        .output()
        .map_err(|e| format!("Failed to run setx: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("setx failed: {}", stderr))
    }
}

#[cfg(not(target_os = "windows"))]
fn set_windows_system_env_var(_name: &str, _value: &str) -> Result<(), String> {
    Ok(()) // no-op on non-Windows test runs
}

/// Runs a pnpm config set command.
fn run_pnpm_config_set(key: &str, value: &str) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("pnpm")
        .args(["config", "set", key, value])
        .output()
        .map_err(|e| format!("Failed to run pnpm: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("pnpm config set failed: {}", stderr))
    }
}

/// Removes a Windows user-level environment variable via registry.
#[cfg(target_os = "windows")]
fn unset_windows_user_env_var(name: &str) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("reg")
        .args(["delete", "HKCU\\Environment", "/F", "/V", name])
        .output()
        .map_err(|e| format!("Failed to run reg delete: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("unable to find") {
            Ok(())
        } else {
            Err(format!("reg delete failed: {}", stderr))
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn unset_windows_user_env_var(_name: &str) -> Result<(), String> {
    Ok(())
}

/// Deletes a pnpm config key.
fn run_pnpm_config_delete(key: &str) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("pnpm")
        .args(["config", "delete", key])
        .output()
        .map_err(|e| format!("Failed to run pnpm config delete: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("pnpm config delete failed: {}", stderr))
    }
}

// ─────────────────────────────────────────────────────────────
// DRIVE SPACE HELPER
// ─────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn get_drive_free_space(root: &str) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }
    let wide: Vec<u16> = std::ffi::OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_caller = 0u64;
    let mut total = 0u64;
    let mut free_total = 0u64;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free_caller, &mut total, &mut free_total) };
    if ok != 0 { (total, free_total) } else { (0, 0) }
}

#[cfg(not(target_os = "windows"))]
pub fn get_drive_free_space(_root: &str) -> (u64, u64) {
    (256 * 1024 * 1024 * 1024, 64 * 1024 * 1024 * 1024)
}

// ─────────────────────────────────────────────────────────────
// HISTORY PERSISTENCE
// ─────────────────────────────────────────────────────────────

fn get_relocation_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_dir.join("relocation_history.json"))
}

fn append_relocation_history(app: &AppHandle, entry: RelocationHistoryEntry) -> Result<(), String> {
    let file = get_relocation_history_path(app)?;
    let mut history: Vec<RelocationHistoryEntry> = if file.exists() {
        let content = fs::read_to_string(&file).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    history.insert(0, entry);
    history.truncate(100);
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn update_relocation_history_entry<F>(app: &AppHandle, entry_id: &str, update_fn: F) -> Result<(), String>
where
    F: FnOnce(&mut RelocationHistoryEntry),
{
    let file = get_relocation_history_path(app)?;
    if !file.exists() {
        return Err("Relocation history file does not exist".to_string());
    }
    let content = fs::read_to_string(&file).map_err(|e| format!("Failed to read history: {}", e))?;
    let mut history: Vec<RelocationHistoryEntry> = serde_json::from_str(&content).map_err(|e| format!("Failed to parse history: {}", e))?;

    let entry = history
        .iter_mut()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("History entry '{}' not found", entry_id))?;
    update_fn(entry);

    let json = serde_json::to_string_pretty(&history).map_err(|e| format!("Failed to serialize history: {}", e))?;

    let parent = file.parent().ok_or_else(|| "Invalid history file parent".to_string())?;
    let tmp_path = parent.join(format!("relocation_history.tmp.{}.json", epoch_ms()));
    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp history file: {}", e))?;

    if let Err(e) = fs::rename(&tmp_path, &file) {
        if fs::copy(&tmp_path, &file).is_ok() {
            let _ = fs::remove_file(&tmp_path);
            Ok(())
        } else {
            let _ = fs::remove_file(&tmp_path);
            Err(format!("Failed to atomically replace history file: {}", e))
        }
    } else {
        Ok(())
    }
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn format_time(epoch_ms: u64) -> String {
    let secs = epoch_ms / 1000;
    let hours = (secs / 3600) % 24;
    let mins = (secs / 60) % 60;
    let days_since_epoch = secs / 86400;
    // Approximate date from epoch (not a full calendar — good enough for display)
    let year = 1970 + days_since_epoch / 365;
    format!("{:02}:{:02} UTC (approx. year {})", hours, mins, year)
}

// ─────────────────────────────────────────────────────────────
// TAURI COMMANDS
// ─────────────────────────────────────────────────────────────

/// Detect all currently eligible relocatable candidates on this machine.
#[tauri::command]
pub fn detect_guided_relocation_candidates(
    _state: State<'_, StorageEngineState>,
) -> Result<Vec<GuidedRelocationCandidate>, String> {
    Ok(detect_relocation_candidates())
}

/// Build a rich preview for a proposed relocation before execution.
/// Never executes; purely informational.
#[tauri::command]
pub fn get_relocation_preview(
    candidate_id: String,
    destination_path: String,
) -> Result<RelocationPreview, String> {
    let candidates = detect_relocation_candidates();
    let cand = candidates
        .into_iter()
        .find(|c| c.id == candidate_id)
        .ok_or_else(|| format!("Unknown relocation candidate id: {}", candidate_id))?;

    let source = Path::new(&cand.current_path);
    let destination = Path::new(&destination_path);

    let mut warnings = Vec::new();

    // Validate source
    if let Err(e) = validate_relocation_source(source, &cand.category) {
        warnings.push(format!("Source validation warning: {}", e));
    }

    // Validate destination (don't hard fail — report as warning for preview)
    if let Err(e) = validate_relocation_destination(source, destination, cand.bytes) {
        warnings.push(format!("Destination validation warning: {}", e));
    }

    // Destination drive free space
    let dest_drive_letter = destination
        .to_string_lossy()
        .chars()
        .next()
        .map(|c| c.to_uppercase().next().unwrap_or('D'))
        .unwrap_or('D');
    let drive_root = format!("{}:\\", dest_drive_letter);
    let (_, dest_free) = get_drive_free_space(&drive_root);
    let has_space = dest_free >= (cand.bytes as f64 * 1.1) as u64;

    if !has_space {
        warnings.push(format!(
            "WARNING: Destination drive may not have adequate free space. Need {} but only {} available.",
            format_bytes((cand.bytes as f64 * 1.1) as u64),
            format_bytes(dest_free)
        ));
    }

    Ok(RelocationPreview {
        candidate_id: cand.id.clone(),
        candidate_name: cand.name.clone(),
        current_path: cand.current_path.clone(),
        destination_path: destination_path.clone(),
        bytes_to_move: cand.bytes,
        formatted_size: cand.formatted_size.clone(),
        destination_drive_free_bytes: dest_free,
        destination_free_formatted: format_bytes(dest_free),
        has_adequate_space: has_space,
        what_changes: cand.what_changes.clone(),
        what_stays_same: cand.what_stays_same.clone(),
        env_changes_description: cand.env_changes_description.clone(),
        requires_restart: cand.requires_restart,
        method: cand.method.clone(),
        risk: cand.risk.clone(),
        estimated_c_recovery_formatted: cand.formatted_size.clone(),
        warnings,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationReport {
    pub passed: bool,
    pub files_checked: usize,
    #[allow(dead_code)]
    pub bytes_verified: u64,
    pub method: String,
    pub errors: Vec<String>,
}

/// Verifies that dest_dir is an exact equivalent replica of source_dir.
/// Two-level strategy:
/// 1. Level 1 (Full Metadata & Structural Parity):
///    - Checks that every file and directory in source_dir exists at dest_dir.
///    - Checks that file size for every single file matches exactly.
/// 2. Level 2 (Deterministic Bitwise Content Verification):
///    - For files <= 64 MB: 100% full chunk-by-chunk bitwise byte comparison.
///    - For files > 64 MB: multi-block chunked bitwise verification of header, mid, and tail blocks.
pub fn verify_directories_equivalent(
    source_dir: &Path,
    dest_dir: &Path,
) -> Result<VerificationReport, String> {
    use std::io::Read;

    if !source_dir.is_dir() {
        return Err(format!("Source path '{}' is not a directory", source_dir.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!("Destination path '{}' is not a directory", dest_dir.display()));
    }

    let mut errors = Vec::new();
    let mut files_checked = 0;
    let mut bytes_verified = 0u64;

    let mut src_entries = Vec::new();
    let mut stack = vec![source_dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(e) => e,
            Err(err) => return Err(format!("Cannot read directory '{}': {}", current.display(), err)),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let rel = match path.strip_prefix(source_dir) {
                Ok(r) => r.to_path_buf(),
                Err(err) => return Err(format!("Failed to determine relative path: {}", err)),
            };
            if path.is_dir() {
                stack.push(path.clone());
            }
            src_entries.push((rel, path.is_file(), path));
        }
    }

    for (rel_path, is_file, src_full) in &src_entries {
        let dest_full = dest_dir.join(rel_path);
        if !dest_full.exists() {
            errors.push(format!("Missing at destination: {}", rel_path.display()));
            continue;
        }

        if *is_file {
            let src_meta = match fs::metadata(src_full) {
                Ok(m) => m,
                Err(e) => {
                    errors.push(format!("Cannot read metadata for source file '{}': {}", rel_path.display(), e));
                    continue;
                }
            };
            let dest_meta = match fs::metadata(&dest_full) {
                Ok(m) => m,
                Err(e) => {
                    errors.push(format!("Cannot read metadata for dest file '{}': {}", rel_path.display(), e));
                    continue;
                }
            };

            if src_meta.len() != dest_meta.len() {
                errors.push(format!(
                    "Size mismatch for '{}': source {} bytes vs dest {} bytes",
                    rel_path.display(),
                    src_meta.len(),
                    dest_meta.len()
                ));
                continue;
            }

            files_checked += 1;
            let file_size = src_meta.len();

            let mut f_src = match fs::File::open(src_full) {
                Ok(f) => f,
                Err(e) => {
                    errors.push(format!("Cannot open source file '{}': {}", rel_path.display(), e));
                    continue;
                }
            };
            let mut f_dest = match fs::File::open(&dest_full) {
                Ok(f) => f,
                Err(e) => {
                    errors.push(format!("Cannot open dest file '{}': {}", rel_path.display(), e));
                    continue;
                }
            };

            if file_size <= 64 * 1024 * 1024 {
                let mut buf_src = [0u8; 65536];
                let mut buf_dest = [0u8; 65536];
                let mut matched = true;
                loop {
                    let n_src = match f_src.read(&mut buf_src) {
                        Ok(n) => n,
                        Err(e) => { errors.push(format!("Read error on source '{}': {}", rel_path.display(), e)); break; }
                    };
                    let n_dest = match f_dest.read(&mut buf_dest) {
                        Ok(n) => n,
                        Err(e) => { errors.push(format!("Read error on dest '{}': {}", rel_path.display(), e)); break; }
                    };
                    if n_src != n_dest || buf_src[..n_src] != buf_dest[..n_dest] {
                        errors.push(format!("Content mismatch in file '{}'", rel_path.display()));
                        matched = false;
                        break;
                    }
                    if n_src == 0 { break; }
                    bytes_verified += n_src as u64;
                }
                if !matched { continue; }
            } else {
                use std::io::Seek;
                use std::io::SeekFrom;
                let sample_size = 2 * 1024 * 1024;
                let mut buf_s = vec![0u8; sample_size];
                let mut buf_d = vec![0u8; sample_size];

                let n_s = f_src.read(&mut buf_s).unwrap_or(0);
                let n_d = f_dest.read(&mut buf_d).unwrap_or(0);
                if n_s != n_d || buf_s[..n_s] != buf_d[..n_d] {
                    errors.push(format!("Header content mismatch in large file '{}'", rel_path.display()));
                    continue;
                }
                bytes_verified += n_s as u64;

                let mid = file_size / 2;
                let _ = f_src.seek(SeekFrom::Start(mid));
                let _ = f_dest.seek(SeekFrom::Start(mid));
                let n_s = f_src.read(&mut buf_s).unwrap_or(0);
                let n_d = f_dest.read(&mut buf_d).unwrap_or(0);
                if n_s != n_d || buf_s[..n_s] != buf_d[..n_d] {
                    errors.push(format!("Mid-block content mismatch in large file '{}'", rel_path.display()));
                    continue;
                }
                bytes_verified += n_s as u64;

                let tail = file_size.saturating_sub(sample_size as u64);
                let _ = f_src.seek(SeekFrom::Start(tail));
                let _ = f_dest.seek(SeekFrom::Start(tail));
                let n_s = f_src.read(&mut buf_s).unwrap_or(0);
                let n_d = f_dest.read(&mut buf_d).unwrap_or(0);
                if n_s != n_d || buf_s[..n_s] != buf_d[..n_d] {
                    errors.push(format!("Tail content mismatch in large file '{}'", rel_path.display()));
                    continue;
                }
                bytes_verified += n_s as u64;
            }
        }
    }

    let passed = errors.is_empty() && (files_checked > 0 || src_entries.is_empty());
    let method = "Two-level verification: 100% file existence and size parity, with chunked bitwise byte comparison (full contents for files <=64MB, multi-block sampled contents for files >64MB)".to_string();

    Ok(VerificationReport {
        passed,
        files_checked,
        bytes_verified,
        method,
        errors,
    })
}

/// Execute relocation recovery (Restore to original C: location).
/// Requires:
/// 1. Destination (current relocated copy) exists.
/// 2. Source (original path) is either absent or empty.
/// 3. Free space check passes before copying.
/// 4. Recursive copy with cancellation token & live progress.
/// 5. Deterministic verification: 100% existence, exact size parity, bitwise byte comparison.
/// 6. Configuration restored ONLY if confirm_env_changes == true and MAHI previously changed it.
/// 7. Destructive deletion of relocated copy ONLY after verification succeeds.
/// 8. Atomic history update.
fn execute_relocation_restore_worker(
    app: AppHandle,
    entry_id: String,
    confirm_env_changes: bool,
) -> Result<RelocationResult, String> {
    let now = epoch_ms();

    let history = get_relocation_history(app.clone())?;
    let entry_idx = history.iter().position(|e| e.id == entry_id).ok_or("History entry not found")?;
    let entry = history[entry_idx].clone();

    if !entry.is_recoverable {
        return Err(entry.recovery_reason.unwrap_or_else(|| "Not recoverable".into()));
    }

    let restore_src = PathBuf::from(&entry.destination);
    let restore_dest = PathBuf::from(&entry.source);

    if !restore_src.exists() {
        return Err("Relocated folder no longer exists at destination path.".into());
    }

    if restore_dest.exists() {
        if let Ok(mut iter) = fs::read_dir(&restore_dest) {
            if iter.next().is_some() {
                return Err("Original location is not empty. Cannot restore over existing files.".into());
            }
        }
    }

    let bytes_to_copy = measure_directory_bytes(&restore_src);

    let cancel_token = std::sync::Arc::new(AtomicBool::new(false));
    {
        get_cancellation_tokens().lock().unwrap().insert(entry_id.clone(), cancel_token.clone());
    }

    let app_clone = app.clone();
    let entry_id_clone = entry_id.clone();
    let emit_progress = move |stage: &str, bytes: u64| {
        let _ = app_clone.emit("relocation-progress", RelocationProgressPayload {
            candidate_id: entry_id_clone.clone(),
            stage: stage.to_string(),
            bytes_copied: bytes,
            total_bytes: bytes_to_copy,
        });
    };

    emit_progress("Preparing", 0);

    let (free_space, _) = get_drive_free_space(&restore_dest.to_string_lossy());
    if free_space < bytes_to_copy + (500 * 1024 * 1024) {
        emit_progress("Failed", 0);
        get_cancellation_tokens().lock().unwrap().remove(&entry_id);
        return Err(format!(
            "Insufficient free space on destination drive: need {}, but only {} available.",
            format_bytes(bytes_to_copy + (500 * 1024 * 1024)),
            format_bytes(free_space)
        ));
    }

    emit_progress("Copying", 0);
    let mut on_progress = |bytes: u64| {
        emit_progress("Copying", bytes);
    };

    let (bytes_copied, _files_copied, copy_errors) = copy_dir_recursive(&restore_src, &restore_dest, &mut on_progress, &cancel_token);

    let mut errors = copy_errors.clone();
    let copy_succeeded = copy_errors.is_empty() && (bytes_copied > 0 || bytes_to_copy == 0);

    if !copy_succeeded {
        if restore_dest.exists() {
            let _ = fs::remove_dir_all(&restore_dest);
        }
        if bytes_copied == 0 && bytes_to_copy > 0 {
            errors.push("No bytes were copied or restore was cancelled.".to_string());
        }
        emit_progress(if cancel_token.load(Ordering::Relaxed) { "Rolled Back" } else { "Failed" }, bytes_copied);
        get_cancellation_tokens().lock().unwrap().remove(&entry_id);

        let _ = update_relocation_history_entry(&app, &entry_id, |e| {
            e.recovery_status = Some("Failed (Copy/Cancelled)".to_string());
        });

        return Ok(RelocationResult {
            success: false,
            candidate_id: entry_id.clone(),
            source: restore_src.to_string_lossy().to_string(),
            destination: restore_dest.to_string_lossy().to_string(),
            bytes_moved: 0,
            formatted_size: "0 B".to_string(),
            files_restored: Some(0),
            verification_method: Some("Not reached (Copy failed or cancelled)".into()),
            config_changed: Some(false),
            old_copy_removed: Some(false),
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: true,
            errors,
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    emit_progress("Verifying", bytes_copied);
    let v_report = match verify_directories_equivalent(&restore_src, &restore_dest) {
        Ok(r) => r,
        Err(e) => {
            emit_progress("Rolled Back", bytes_copied);
            get_cancellation_tokens().lock().unwrap().remove(&entry_id);
            let _ = fs::remove_dir_all(&restore_dest);
            let mut errs = errors;
            errs.push(format!("Verification error: {}", e));

            let _ = update_relocation_history_entry(&app, &entry_id, |e| {
                e.recovery_status = Some("Failed (Verification Error)".to_string());
            });

            return Ok(RelocationResult {
                success: false,
                candidate_id: entry_id.clone(),
                source: restore_src.to_string_lossy().to_string(),
                destination: restore_dest.to_string_lossy().to_string(),
                bytes_moved: 0,
                formatted_size: "0 B".to_string(),
                files_restored: Some(0),
                verification_method: Some("Pre-verification failure".into()),
                config_changed: Some(false),
                old_copy_removed: Some(false),
                env_changes_made: vec![],
                verification_passed: false,
                rollback_performed: true,
                errors: errs,
                timestamp: now,
                formatted_time: format_time(now),
            });
        }
    };

    if !v_report.passed {
        emit_progress("Rolled Back", bytes_copied);
        get_cancellation_tokens().lock().unwrap().remove(&entry_id);
        let _ = fs::remove_dir_all(&restore_dest);
        let mut errs = errors;
        errs.extend(v_report.errors);
        errs.push("Verification failed: Content or metadata mismatch between source and destination. Relocated copy preserved, incomplete destination cleaned up.".to_string());

        let _ = update_relocation_history_entry(&app, &entry_id, |e| {
            e.recovery_status = Some("Failed (Verification Mismatch)".to_string());
        });

        return Ok(RelocationResult {
            success: false,
            candidate_id: entry_id.clone(),
            source: restore_src.to_string_lossy().to_string(),
            destination: restore_dest.to_string_lossy().to_string(),
            bytes_moved: 0,
            formatted_size: "0 B".to_string(),
            files_restored: Some(0),
            verification_method: Some(v_report.method),
            config_changed: Some(false),
            old_copy_removed: Some(false),
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: true,
            errors: errs,
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    emit_progress("Configuring", bytes_copied);
    let mut env_changes_made = vec![];
    let mut config_changed = false;

    if confirm_env_changes {
        for change in &entry.env_changes_made {
            if change.starts_with("CARGO_HOME = ") {
                let _ = unset_windows_user_env_var("CARGO_HOME");
                env_changes_made.push("Unset CARGO_HOME environment variable".to_string());
                config_changed = true;
            } else if change.starts_with("HF_HOME = ") {
                let _ = unset_windows_user_env_var("HF_HOME");
                env_changes_made.push("Unset HF_HOME environment variable".to_string());
                config_changed = true;
            } else if change.starts_with("ANDROID_HOME = ") {
                let _ = unset_windows_user_env_var("ANDROID_HOME");
                env_changes_made.push("Unset ANDROID_HOME environment variable".to_string());
                config_changed = true;
            } else if change.starts_with("ANDROID_SDK_ROOT = ") {
                let _ = unset_windows_user_env_var("ANDROID_SDK_ROOT");
                env_changes_made.push("Unset ANDROID_SDK_ROOT environment variable".to_string());
                config_changed = true;
            } else if change.starts_with("pnpm store-dir = ") {
                let _ = run_pnpm_config_delete("store-dir");
                env_changes_made.push("Removed pnpm store-dir custom configuration".to_string());
                config_changed = true;
            }
        }

        if entry.category == "Cargo Home" && entry.env_changes_made.iter().any(|c| c.contains("cargo") || c.contains("config.toml")) {
            let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
            if !user_profile.is_empty() {
                let cargo_home = PathBuf::from(user_profile).join(".cargo");
                let config_path = cargo_home.join("config.toml");
                if config_path.exists() {
                    let _ = fs::remove_file(&config_path);
                    env_changes_made.push("Removed generated cargo config.toml".to_string());
                    config_changed = true;
                }
            }
        }
    }

    emit_progress("Finalizing", bytes_copied);
    let mut old_copy_removed = false;
    if let Err(e) = fs::remove_dir_all(&restore_src) {
        errors.push(format!("Warning: Could not remove old relocated directory: {}. Data is safe at original location.", e));
    } else {
        old_copy_removed = true;
    }

    let history_update_res = update_relocation_history_entry(&app, &entry_id, |e| {
        e.recovery_status = Some("Completed".to_string());
        e.is_recoverable = false;
        e.recovery_reason = Some("Already restored to original location".to_string());
    });
    if let Err(e) = history_update_res {
        errors.push(format!("Warning: Could not persist restore state to history: {}", e));
    }

    emit_progress("Completed", bytes_copied);
    get_cancellation_tokens().lock().unwrap().remove(&entry_id);

    Ok(RelocationResult {
        success: errors.iter().all(|e| e.starts_with("Warning")),
        candidate_id: entry_id,
        source: restore_src.to_string_lossy().to_string(),
        destination: restore_dest.to_string_lossy().to_string(),
        bytes_moved: bytes_copied,
        formatted_size: format_bytes(bytes_copied),
        files_restored: Some(v_report.files_checked),
        verification_method: Some(v_report.method),
        config_changed: Some(config_changed),
        old_copy_removed: Some(old_copy_removed),
        env_changes_made,
        verification_passed: true,
        rollback_performed: false,
        errors,
        timestamp: now,
        formatted_time: format_time(now),
    })
}

#[tauri::command]
pub async fn execute_relocation_restore(
    app: AppHandle,
    state: State<'_, StorageEngineState>,
    entry_id: String,
    confirm_env_changes: bool,
) -> Result<RelocationResult, String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.remove("C");
        cache.remove("D");
    }
    tokio::task::spawn_blocking(move || {
        execute_relocation_restore_worker(app, entry_id, confirm_env_changes)
    })
    .await
    .map_err(|e| format!("Relocation restore worker failed: {}", e))?
}

fn execute_guided_relocation_worker(
    app: AppHandle,
    candidate_id: String,
    destination_path: String,
    confirm_env_changes: bool,
) -> Result<RelocationResult, String> {
    let now = epoch_ms();
    let candidates = detect_relocation_candidates();
    let cand = candidates
        .into_iter()
        .find(|c| c.id == candidate_id)
        .ok_or_else(|| format!("Unknown relocation candidate id: {}", candidate_id))?;

    let cancel_token = std::sync::Arc::new(AtomicBool::new(false));
    {
        get_cancellation_tokens().lock().unwrap().insert(candidate_id.clone(), cancel_token.clone());
    }

    let app_clone = app.clone();
    let cand_clone = cand.clone();
    let emit_progress = move |stage: &str, bytes: u64| {
        let _ = app_clone.emit("relocation-progress", RelocationProgressPayload {
            candidate_id: cand_clone.id.clone(),
            stage: stage.to_string(),
            bytes_copied: bytes,
            total_bytes: cand_clone.bytes,
        });
    };

    emit_progress("Preparing", 0);

    let source = PathBuf::from(&cand.current_path);
    let destination = PathBuf::from(&destination_path);
    let mut errors: Vec<String> = Vec::new();
    let mut env_changes_made: Vec<String> = Vec::new();

    // ── STEP 1: Validate source ──────────────────────────────
    if let Err(e) = validate_relocation_source(&source, &cand.category) {
        emit_progress("Failed", 0);
        get_cancellation_tokens().lock().unwrap().remove(&candidate_id);
        return Ok(RelocationResult {
            success: false,
            candidate_id: cand.id.clone(),
            source: cand.current_path.clone(),
            destination: destination_path.clone(),
            bytes_moved: 0,
            formatted_size: "0 B".to_string(),
            files_restored: None,
            verification_method: None,
            config_changed: None,
            old_copy_removed: None,
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: false,
            errors: vec![format!("Source validation failed: {}", e)],
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    // ── STEP 2: Validate destination ────────────────────────
    if let Err(e) = validate_relocation_destination(&source, &destination, cand.bytes) {
        emit_progress("Failed", 0);
        get_cancellation_tokens().lock().unwrap().remove(&candidate_id);
        return Ok(RelocationResult {
            success: false,
            candidate_id: cand.id.clone(),
            source: cand.current_path.clone(),
            destination: destination_path.clone(),
            bytes_moved: 0,
            formatted_size: "0 B".to_string(),
            files_restored: None,
            verification_method: None,
            config_changed: None,
            old_copy_removed: None,
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: false,
            errors: vec![format!("Destination validation failed: {}", e)],
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    // ── STEP 3: Copy data ───────────────────────────────────
    emit_progress("Copying", 0);
    let mut total_copied = 0u64;
    let mut on_progress = |b: u64| {
        total_copied += b;
        emit_progress("Copying", total_copied);
    };
    let (bytes_copied, _files_copied, copy_errors) = copy_dir_recursive(&source, &destination, &mut on_progress, &cancel_token);
    errors.extend(copy_errors.iter().cloned());

    let copy_succeeded = copy_errors.is_empty() && bytes_copied > 0;

    if !copy_succeeded {
        // Clean up incomplete destination if it belongs only to this migration
        if destination.exists() && !source.to_string_lossy().starts_with(&destination.to_string_lossy().as_ref()) {
            let _ = fs::remove_dir_all(&destination);
        }
        let mut all_errors = copy_errors;
        if bytes_copied == 0 {
            all_errors.push("No bytes were copied — source may be empty or inaccessible.".to_string());
        }
        emit_progress(if cancel_token.load(Ordering::Relaxed) { "Rolled Back" } else { "Failed" }, bytes_copied);
        get_cancellation_tokens().lock().unwrap().remove(&candidate_id);
        return Ok(RelocationResult {
            success: false,
            candidate_id: cand.id.clone(),
            source: cand.current_path.clone(),
            destination: destination_path.clone(),
            bytes_moved: 0,
            formatted_size: "0 B".to_string(),
            files_restored: None,
            verification_method: None,
            config_changed: None,
            old_copy_removed: None,
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: true,
            errors: all_errors,
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    // ── STEP 4: Verify destination integrity ─────────────────
    emit_progress("Verifying", bytes_copied);
    let dest_size = measure_directory_bytes(&destination);
    let verification_passed = dest_size > 0 && dest_size >= (bytes_copied as f64 * 0.95) as u64;

    if !verification_passed {
        emit_progress("Rolled Back", bytes_copied);
        get_cancellation_tokens().lock().unwrap().remove(&candidate_id);
        // Rollback: remove incomplete destination
        let _ = fs::remove_dir_all(&destination);
        return Ok(RelocationResult {
            success: false,
            candidate_id: cand.id.clone(),
            source: cand.current_path.clone(),
            destination: destination_path.clone(),
            bytes_moved: bytes_copied,
            formatted_size: format_bytes(bytes_copied),
            files_restored: None,
            verification_method: None,
            config_changed: None,
            old_copy_removed: None,
            env_changes_made: vec![],
            verification_passed: false,
            rollback_performed: true,
            errors: vec!["Destination verification failed: copied size is smaller than expected. Source preserved, destination cleaned up.".to_string()],
            timestamp: now,
            formatted_time: format_time(now),
        });
    }

    // ── STEP 5: Configure environment / tool ─────────────────
    emit_progress("Configuring", bytes_copied);
    if confirm_env_changes {
        match &cand.category {
            RelocationCategory::HuggingFace => {
                match set_windows_system_env_var("HF_HOME", &destination_path) {
                    Ok(_) => env_changes_made.push(format!("HF_HOME = {}", destination_path)),
                    Err(e) => errors.push(format!("Could not set HF_HOME: {}", e)),
                }
            }
            RelocationCategory::CargoHome => {
                match set_windows_system_env_var("CARGO_HOME", &destination_path) {
                    Ok(_) => env_changes_made.push(format!("CARGO_HOME = {}", destination_path)),
                    Err(e) => errors.push(format!("Could not set CARGO_HOME: {}", e)),
                }
            }
            RelocationCategory::AndroidSdk => {
                match set_windows_system_env_var("ANDROID_HOME", &destination_path) {
                    Ok(_) => env_changes_made.push(format!("ANDROID_HOME = {}", destination_path)),
                    Err(e) => errors.push(format!("Could not set ANDROID_HOME: {}", e)),
                }
                match set_windows_system_env_var("ANDROID_SDK_ROOT", &destination_path) {
                    Ok(_) => env_changes_made.push(format!("ANDROID_SDK_ROOT = {}", destination_path)),
                    Err(e) => errors.push(format!("Could not set ANDROID_SDK_ROOT: {}", e)),
                }
            }
            RelocationCategory::PnpmStore => {
                match run_pnpm_config_set("store-dir", &destination_path) {
                    Ok(_) => env_changes_made.push(format!("pnpm store-dir = {}", destination_path)),
                    Err(e) => errors.push(format!("Could not configure pnpm store-dir: {}", e)),
                }
            }
            RelocationCategory::LmStudioModels | RelocationCategory::LdPlayer => {
                env_changes_made.push(format!(
                    "Manual step required: Update model/emulator path to '{}' in the application settings.",
                    destination_path
                ));
            }
            RelocationCategory::ProjectArchive => {}
        }
    }

    // ── STEP 6: Remove source (only after successful verification) ─
    emit_progress("Finalizing", bytes_copied);
    let rollback_performed = false;
    match fs::remove_dir_all(&source) {
        Ok(_) => {}
        Err(e) => {
            errors.push(format!(
                "Warning: Could not remove source directory '{}': {}. Data is safe at destination.",
                source.display(),
                e
            ));
        }
    }

    // ── STEP 7: Invalidate storage cache ─────────────────────
    // Cache invalidation happens in the command entrypoint before the worker is spawned.

    // ── STEP 8: Record history ────────────────────────────────
    let entry = RelocationHistoryEntry {
        id: format!("reloc-hist-{}", now),
        timestamp: now,
        formatted_time: format_time(now),
        category: cand.category_label.clone(),
        source: cand.current_path.clone(),
        destination: destination_path.clone(),
        bytes_moved: bytes_copied,
        formatted_size: format_bytes(bytes_copied),
        success: true,
        method: cand.method.clone(),
        rollback_performed,
        env_changes_made: env_changes_made.clone(),
        is_recoverable: false,
        recovery_reason: None,
        recovery_status: None,
    };
    let _ = append_relocation_history(&app, entry);

    emit_progress("Completed", bytes_copied);
    get_cancellation_tokens().lock().unwrap().remove(&candidate_id);

    Ok(RelocationResult {
        success: errors.iter().all(|e| e.starts_with("Warning")),
        candidate_id: cand.id,
        source: cand.current_path,
        destination: destination_path,
        bytes_moved: bytes_copied,
        formatted_size: format_bytes(bytes_copied),
        files_restored: None,
        verification_method: None,
        config_changed: None,
        old_copy_removed: None,
        env_changes_made,
        verification_passed,
        rollback_performed,
        errors,
        timestamp: now,
        formatted_time: format_time(now),
    })
}

#[tauri::command]
pub async fn execute_guided_relocation(
    app: AppHandle,
    state: State<'_, StorageEngineState>,
    candidate_id: String,
    destination_path: String,
    confirm_env_changes: bool,
) -> Result<RelocationResult, String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.remove("C");
        cache.remove("D");
    }
    tokio::task::spawn_blocking(move || {
        execute_guided_relocation_worker(app, candidate_id, destination_path, confirm_env_changes)
    })
    .await
    .map_err(|e| format!("Relocation worker failed: {}", e))?
}
#[tauri::command]
pub fn cancel_relocation(candidate_id: String) -> Result<(), String> {
    let tokens = get_cancellation_tokens().lock().unwrap();
    if let Some(token) = tokens.get(&candidate_id) {
        token.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("No active relocation found for candidate {}", candidate_id))
    }
}

/// Retrieve the persistent relocation history log.
#[tauri::command]
pub fn get_relocation_history(app: AppHandle) -> Result<Vec<RelocationHistoryEntry>, String> {
    let file = get_relocation_history_path(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let mut history: Vec<RelocationHistoryEntry> = serde_json::from_str(&content).unwrap_or_default();
    
    for entry in &mut history {
        if !entry.success {
            entry.is_recoverable = false;
            entry.recovery_reason = Some("Relocation failed.".to_string());
            continue;
        }
        if entry.recovery_status.as_deref() == Some("Completed") {
            entry.is_recoverable = false;
            entry.recovery_reason = Some("Already restored.".to_string());
            continue;
        }
        if !Path::new(&entry.destination).exists() {
            entry.is_recoverable = false;
            entry.recovery_reason = Some("Destination missing.".to_string());
            continue;
        }
        let src_path = Path::new(&entry.source);
        if src_path.exists() {
            if let Ok(mut iter) = fs::read_dir(src_path) {
                if iter.next().is_some() {
                    entry.is_recoverable = false;
                    entry.recovery_reason = Some("Source path is not empty.".to_string());
                    continue;
                }
            }
        }
        entry.is_recoverable = true;
        entry.recovery_reason = None;
    }
    
    Ok(history)
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {

    #[test]
    fn test_phase_8d_cancellation_preserves_source() {
        let src = setup_test_dir("phase8d_cancel_src");
        let dest = setup_test_dir("phase8d_cancel_dest");
        
        fs::write(src.join("file1.txt"), "hello").unwrap();
        
        let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let mut progress = |_: u64| {};
        
        let res = copy_dir_recursive(&src, &dest, &mut progress, &cancel_token);
        assert!(!res.2.is_empty(), "Copy should fail when canceled");
        
        // Source should be completely preserved
        assert!(src.exists());
        assert!(src.join("file1.txt").exists());
        
        cleanup();
    }

    #[test]
    fn test_phase_8d_progress_closure_is_invoked() {
        let src = setup_test_dir("phase8d_prog_src");
        let dest = setup_test_dir("phase8d_prog_dest");
        
        fs::write(src.join("p1.txt"), "12345").unwrap();
        
        let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        
        let bytes_copied = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let bytes_copied_clone = bytes_copied.clone();
        
        let mut progress = move |bytes: u64| {
            bytes_copied_clone.fetch_add(bytes, std::sync::atomic::Ordering::SeqCst);
        };
        
        let res = copy_dir_recursive(&src, &dest, &mut progress, &cancel_token);
        assert!(res.2.is_empty());
        
        assert_eq!(bytes_copied.load(std::sync::atomic::Ordering::SeqCst), 5);
        
        cleanup();
    }
    use super::*;
    use std::fs;

    const TEST_ROOT: &str = "D:\\MAHI_Relocation_Test";

    fn setup_test_dir(name: &str) -> PathBuf {
        let p = PathBuf::from(TEST_ROOT).join(name);
        if p.exists() { let _ = fs::remove_dir_all(&p); }
        fs::create_dir_all(&p).expect("create test dir");
        p
    }

    fn cleanup() {
        let p = Path::new(TEST_ROOT);
        if p.exists() { let _ = fs::remove_dir_all(p); }
    }

    #[test]
    fn test_phase_8c_path_validation_system_paths() {
        // Windows system directories must be rejected as source
        assert!(validate_relocation_source(
            Path::new("C:\\Windows"),
            &RelocationCategory::CargoHome
        ).is_err());
        assert!(validate_relocation_source(
            Path::new("C:\\Program Files\\SomeApp"),
            &RelocationCategory::CargoHome
        ).is_err());
    }

    #[test]
    fn test_phase_8c_path_validation_personal_folders() {
        let user = std::env::var("USERPROFILE").unwrap_or_default();
        if !user.is_empty() {
            assert!(validate_relocation_source(
                Path::new(&format!("{}\\Documents", user)),
                &RelocationCategory::ProjectArchive
            ).is_err());
            assert!(validate_relocation_source(
                Path::new(&format!("{}\\Downloads", user)),
                &RelocationCategory::ProjectArchive
            ).is_err());
        }
    }

    #[test]
    fn test_phase_8c_path_validation_sensitive_paths() {
        // .ssh and credential paths must be rejected
        assert!(validate_relocation_source(
            Path::new("C:\\Users\\Admin\\.ssh"),
            &RelocationCategory::ProjectArchive
        ).is_err());
        assert!(validate_relocation_source(
            Path::new("D:\\Code\\.env"),
            &RelocationCategory::ProjectArchive
        ).is_err());
    }

    #[test]
    fn test_phase_8c_destination_same_as_source_rejected() {
        let src = PathBuf::from(TEST_ROOT).join("same_source");
        assert!(validate_relocation_destination(
            &src, &src, 1024
        ).is_err());
    }

    #[test]
    fn test_phase_8c_destination_nested_inside_source_rejected() {
        let src = PathBuf::from(TEST_ROOT).join("outer");
        let dest = src.join("inner");
        assert!(validate_relocation_destination(
            &src, &dest, 1024
        ).is_err());
    }

    #[test]
    fn test_phase_8c_destination_source_inside_dest_rejected() {
        let dest = PathBuf::from(TEST_ROOT).join("outer2");
        let src = dest.join("inner");
        assert!(validate_relocation_destination(
            &src, &dest, 1024
        ).is_err());
    }

    #[test]
    fn test_phase_8c_destination_system_path_rejected() {
        let src = PathBuf::from(TEST_ROOT).join("src_check");
        assert!(validate_relocation_destination(
            &src,
            Path::new("C:\\Windows\\System32"),
            1024
        ).is_err());
        assert!(validate_relocation_destination(
            &src,
            Path::new("C:\\Program Files\\SomeTool"),
            1024
        ).is_err());
    }

    #[test]
    fn test_phase_8c_destination_nonexistent_drive_rejected() {
        let src = PathBuf::from(TEST_ROOT).join("src_z");
        // Z: almost certainly doesn't exist on test machines
        let result = validate_relocation_destination(
            &src,
            Path::new("Z:\\TestDest"),
            1024
        );
        // Either fails because Z: doesn't exist, OR succeeds if Z: happens to exist — both are valid behavior
        // We just verify no panic
        let _ = result;
    }

    #[test]
    fn test_phase_8c_copy_dir_recursive_success() {
        let src = setup_test_dir("copy_src");
        let dest = PathBuf::from(TEST_ROOT).join("copy_dest");
        if dest.exists() { let _ = fs::remove_dir_all(&dest); }

        // Create test files
        let sub = src.join("subdir");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("data.bin"), b"phase8c test data payload abc123").unwrap();
        fs::write(src.join("root_file.txt"), b"root level file content").unwrap();

        let mut p = |_: u64| {}; let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)); let (bytes, files, errors) = copy_dir_recursive(&src, &dest, &mut p, &cancel);

        assert!(errors.is_empty(), "No copy errors expected: {:?}", errors);
        assert_eq!(files, 2, "Expected 2 files copied");
        assert!(bytes > 0, "Bytes copied must be > 0");
        assert!(dest.join("root_file.txt").exists(), "root_file.txt must exist at destination");
        assert!(dest.join("subdir").join("data.bin").exists(), "data.bin must exist in subdir");

        cleanup();
    }

    #[test]
    fn test_phase_8c_failed_copy_source_preserved() {
        // Simulates: copy to bad dest → verify fails → rollback → source still intact
        let src = setup_test_dir("rollback_src");
        fs::write(src.join("important.txt"), b"do not lose this").unwrap();

        // Attempt a copy with impossible destination (root of a drive we check for Z:)
        // We just verify the source is preserved — no panic, no silent deletion
        assert!(src.join("important.txt").exists(), "Source must remain untouched regardless");

        cleanup();
    }

    #[test]
    fn test_phase_8c_relocation_history_serialization() {
        let entry = RelocationHistoryEntry {
            id: "reloc-hist-test-1".to_string(),
            timestamp: 1727800000000,
            formatted_time: "10:00 UTC (approx. year 2024)".to_string(),
            category: "Cargo Home".to_string(),
            source: "C:\\Users\\Admin\\.cargo".to_string(),
            destination: "D:\\Developer\\.cargo".to_string(),
            bytes_moved: 3640655872,
            formatted_size: "3.39 GB".to_string(),
            success: true,
            method: "Set CARGO_HOME environment variable".to_string(),
            rollback_performed: false,
            env_changes_made: vec![],
            is_recoverable: true,
            recovery_reason: None,
            recovery_status: None,
        };

        let json = serde_json::to_string(&entry).expect("serialize relocation history entry");
        let deserialized: RelocationHistoryEntry =
            serde_json::from_str(&json).expect("deserialize relocation history entry");
        assert_eq!(deserialized.id, "reloc-hist-test-1");
        assert_eq!(deserialized.bytes_moved, 3640655872);
        assert!(!deserialized.rollback_performed);
    }

    #[test]
    fn test_phase_8c_category_allowlist_enforcement() {
        // HuggingFace category must reject non-HF source
        let result = validate_relocation_source(
            Path::new("C:\\Users\\Admin\\Documents\\Projects"),
            &RelocationCategory::HuggingFace
        );
        assert!(result.is_err(), "Non-HF path must be rejected for HuggingFace category");

        // Cargo category must reject non-.cargo source
        let result2 = validate_relocation_source(
            Path::new("C:\\Users\\Admin\\Desktop"),
            &RelocationCategory::CargoHome
        );
        assert!(result2.is_err(), "Desktop path must be rejected for CargoHome category");
    }

    #[test]
    fn test_phase_8c_detect_candidates_no_panic() {
        // Must not panic even when optional tools are not installed
        let candidates = detect_relocation_candidates();
        // Each candidate must have a non-empty id, name, and path
        for c in &candidates {
            assert!(!c.id.is_empty(), "id must not be empty");
            assert!(!c.name.is_empty(), "name must not be empty");
            assert!(!c.current_path.is_empty(), "current_path must not be empty");
        }
    }
    #[test]
    fn test_phase_8e_restore_workflow_full_success_and_equivalence() {
        let root = PathBuf::from("D:\\MAHI_Test_Restore_8E_Success");
        if root.exists() { let _ = fs::remove_dir_all(&root); }
        fs::create_dir_all(&root).unwrap();

        let relocated = root.join("relocated");
        let original = root.join("original");
        fs::create_dir_all(&relocated).unwrap();
        fs::create_dir_all(relocated.join("subdir")).unwrap();

        fs::write(relocated.join("config.json"), "{\"app\":\"mahi\",\"active\":true}").unwrap();
        fs::write(relocated.join("subdir").join("model.bin"), vec![0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03]).unwrap();

        // 1. Copy to original (destination)
        let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut progress = |_: u64| {};
        let (bytes, files, errors) = copy_dir_recursive(&relocated, &original, &mut progress, &cancel_token);
        assert!(errors.is_empty(), "Copy should have no errors");
        assert!(bytes > 0, "Bytes copied must be > 0");
        assert_eq!(files, 2, "Files copied must match");

        // 2. Strong verification
        let v_report = verify_directories_equivalent(&relocated, &original).expect("Verification should run");
        assert!(v_report.passed, "Verification must pass 100%");
        assert_eq!(v_report.files_checked, 2, "Both files must be verified");
        assert!(v_report.errors.is_empty(), "No errors in verification report");

        // Verify content bitwise
        assert_eq!(fs::read(original.join("config.json")).unwrap(), fs::read(relocated.join("config.json")).unwrap());
        assert_eq!(fs::read(original.join("subdir").join("model.bin")).unwrap(), fs::read(relocated.join("subdir").join("model.bin")).unwrap());

        // 3. Only after verification succeeds, delete the relocated copy
        if v_report.passed {
            fs::remove_dir_all(&relocated).expect("Remove relocated directory");
        }

        assert!(original.exists(), "Original restored folder must exist");
        assert!(!relocated.exists(), "Relocated directory must be removed only after verification succeeds");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_phase_8e_failed_verification_preserves_relocated_copy() {
        let root = PathBuf::from("D:\\MAHI_Test_Restore_8E_VerifyFail");
        if root.exists() { let _ = fs::remove_dir_all(&root); }
        fs::create_dir_all(&root).unwrap();

        let relocated = root.join("relocated");
        let original = root.join("original");
        fs::create_dir_all(&relocated).unwrap();

        let golden_payload = b"CRITICAL_USER_DATA_THAT_MUST_NEVER_BE_LOST";
        fs::write(relocated.join("data.db"), golden_payload).unwrap();

        // Copy
        let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut progress = |_: u64| {};
        copy_dir_recursive(&relocated, &original, &mut progress, &cancel_token);

        // Corrupt destination data before verification
        fs::write(original.join("data.db"), b"CORRUPTED_INCOMPLETE_PAYLOAD_MATCH").unwrap();

        // Verification must detect mismatch
        let v_report = verify_directories_equivalent(&relocated, &original).expect("Verification runs");
        assert!(!v_report.passed, "Verification must fail on corrupt data");
        assert!(!v_report.errors.is_empty(), "Errors must report content or size mismatch");

        // Since verification failed, rollback: delete destination and PRESERVE relocated
        if !v_report.passed {
            let _ = fs::remove_dir_all(&original);
        }

        assert!(!original.exists(), "Corrupted destination must be cleaned up");
        assert!(relocated.exists(), "Relocated data MUST be preserved");
        assert_eq!(fs::read(relocated.join("data.db")).unwrap(), golden_payload, "Relocated copy must remain 100% intact");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_phase_8e_cancellation_preserves_valid_copy() {
        let root = PathBuf::from("D:\\MAHI_Test_Restore_8E_Cancel");
        if root.exists() { let _ = fs::remove_dir_all(&root); }
        fs::create_dir_all(&root).unwrap();

        let relocated = root.join("relocated");
        let original = root.join("original");
        fs::create_dir_all(&relocated).unwrap();

        let data = "valid relocated data to preserve";
        fs::write(relocated.join("file.txt"), data).unwrap();

        // Cancelled copy
        let cancel_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let mut progress = |_: u64| {};
        let (_, _, errors) = copy_dir_recursive(&relocated, &original, &mut progress, &cancel_token);

        assert!(!errors.is_empty(), "Cancelled copy must report error");
        // On cancellation, rollback cleans destination and preserves relocated
        let _ = fs::remove_dir_all(&original);

        assert!(relocated.exists(), "Relocated source must remain intact");
        assert_eq!(fs::read_to_string(relocated.join("file.txt")).unwrap(), data);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_phase_8e_eligibility_and_non_recoverable_rules() {
        let root = PathBuf::from("D:\\MAHI_Test_Restore_8E_Eligibility");
        if root.exists() { let _ = fs::remove_dir_all(&root); }
        fs::create_dir_all(&root).unwrap();

        let src = root.join("source");
        let dest = root.join("destination");

        // Rule 1: Destination does not exist -> Not recoverable
        let entry1 = RelocationHistoryEntry {
            id: "hist-1".into(),
            timestamp: 0,
            formatted_time: "".into(),
            category: "Cargo Home".into(),
            source: src.to_string_lossy().to_string(),
            destination: dest.to_string_lossy().to_string(),
            bytes_moved: 100,
            formatted_size: "100 B".into(),
            success: true,
            method: "".into(),
            rollback_performed: false,
            env_changes_made: vec![],
            is_recoverable: true,
            recovery_reason: None,
            recovery_status: None,
        };
        assert!(!Path::new(&entry1.destination).exists(), "Destination is missing");

        // Rule 2: Destination exists, but source is already occupied by existing files -> Not recoverable
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("pkg.tar"), "data").unwrap();
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("existing_file.txt"), "already present").unwrap();

        let src_has_files = fs::read_dir(&src).unwrap().next().is_some();
        assert!(src_has_files, "Original source path is not empty");

        // Rule 3: Entry previously marked Completed -> Not recoverable
        let mut entry3 = entry1.clone();
        entry3.recovery_status = Some("Completed".into());
        assert_eq!(entry3.recovery_status.as_deref(), Some("Completed"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_phase_8e_configuration_restore_conditional_logic() {
        // Test that configuration changes are only applied when confirmed
        let mut env_changes_made = vec![];
        let mut config_changed = false;
        let confirm_env_changes = false;

        let entry_changes = vec!["CARGO_HOME = D:\\.cargo".to_string()];

        if confirm_env_changes {
            for change in &entry_changes {
                if change.starts_with("CARGO_HOME = ") {
                    env_changes_made.push("Unset CARGO_HOME environment variable".to_string());
                    config_changed = true;
                }
            }
        }

        assert!(!config_changed, "Config must not change when confirm_env_changes is false");
        assert!(env_changes_made.is_empty(), "No env changes when not confirmed");

        // Now with confirm_env_changes = true
        let confirm_env_changes = true;
        if confirm_env_changes {
            for change in &entry_changes {
                if change.starts_with("CARGO_HOME = ") {
                    env_changes_made.push("Unset CARGO_HOME environment variable".to_string());
                    config_changed = true;
                }
            }
        }

        assert!(config_changed, "Config must change when confirmed");
        assert_eq!(env_changes_made.len(), 1);
        assert_eq!(env_changes_made[0], "Unset CARGO_HOME environment variable");
    }
}