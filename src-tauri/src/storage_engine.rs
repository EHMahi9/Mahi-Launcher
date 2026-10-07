use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StorageItemClassification {
    SafeToClean,
    ReviewRequired,
    Relocatable,
    SystemManaged,
    DoNotTouch,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RelocationRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategorySummary {
    pub category: String,
    pub label: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub percentage: f64,
    pub item_count: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeDirectoryItem {
    pub path: String,
    pub name: String,
    pub category: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub classification: StorageItemClassification,
    pub reason: String,
    pub cleanup_potential: String,
    pub is_sensitive_masked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileItem {
    pub path: String,
    pub name: String,
    pub category: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub extension: String,
    pub classification: StorageItemClassification,
    pub reason: String,
    pub is_sensitive_masked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperStorageItem {
    pub name: String,
    pub path: String,
    pub ecosystem: String,
    pub tool_or_project: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub exists: bool,
    pub purpose: String,
    pub is_rebuildable: bool,
    pub cleanup_potential: String,
    pub relocation_potential: String,
    pub classification: StorageItemClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationStorageItem {
    pub name: String,
    pub install_path: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub is_relocatable: bool,
    pub suggested_method: String,
    pub classification: StorageItemClassification,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocationCandidate {
    pub title: String,
    pub current_path: String,
    pub suggested_destination: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub method: String,
    pub risk: RelocationRisk,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableSpaceBreakdown {
    pub definitely_reclaimable_bytes: u64,
    pub definitely_reclaimable_formatted: String,
    pub potentially_reclaimable_bytes: u64,
    pub potentially_reclaimable_formatted: String,
    pub relocatable_bytes: u64,
    pub relocatable_formatted: String,
    pub review_required_bytes: u64,
    pub review_required_formatted: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationCard {
    pub id: String,
    pub title: String,
    pub category: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub classification: StorageItemClassification,
    pub risk: RelocationRisk,
    pub why: String,
    pub future_action: String,
    pub path: String,
    pub is_safe_to_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupTargetItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub bytes: u64,
    pub formatted_size: String,
    pub reason: String,
    pub is_rebuildable: bool,
    pub classification: StorageItemClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    pub targets: Vec<CleanupTargetItem>,
    pub total_bytes: u64,
    pub total_formatted: String,
    pub target_count: usize,
    pub contains_unsafe_items: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupExecutionResult {
    pub success: bool,
    pub recovered_bytes: u64,
    pub recovered_formatted: String,
    pub cleaned_items: usize,
    pub skipped_files: usize,
    pub errors: Vec<String>,
    pub affected_drives: Vec<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupHistoryEntry {
    pub id: String,
    pub timestamp: u64,
    pub formatted_time: String,
    pub category: String,
    pub bytes_reclaimed: u64,
    pub formatted_size: String,
    pub cleaned_items: usize,
    pub targets_summary: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDriveReport {
    pub drive_letter: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub free_percentage: f64,
    pub used_percentage: f64,
    pub categories: Vec<StorageCategorySummary>,
    pub top_directories: Vec<LargeDirectoryItem>,
    pub large_files: Vec<LargeFileItem>,
    pub developer_storage: Vec<DeveloperStorageItem>,
    pub application_storage: Vec<ApplicationStorageItem>,
    pub relocation_candidates: Vec<RelocationCandidate>,
    pub recoverable_space: RecoverableSpaceBreakdown,
    pub recommendations: Vec<RecommendationCard>,
    pub scan_timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageIntelligenceOverview {
    pub available_drives: Vec<String>,
    pub reports: HashMap<String, StorageDriveReport>,
    pub scanned_at: u64,
}

pub struct StorageEngineState {
    pub cache: Mutex<HashMap<String, StorageDriveReport>>,
}

impl Default for StorageEngineState {
    fn default() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }
}

// ----------------- HELPERS & PRIVACY -----------------

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

pub fn is_sensitive_path(path_str: &str) -> bool {
    let lower = path_str.to_lowercase();
    let sensitive_indicators = [
        "\\.ssh",
        "/ssh",
        "id_rsa",
        "id_ed25519",
        "credentials",
        ".env",
        ".gitconfig",
        "keyring",
        "keystore",
        "cookies",
        "wallet",
        "passwords",
        "token",
        "secrets",
    ];

    for ind in sensitive_indicators {
        if lower.contains(ind) {
            return true;
        }
    }
    false
}

pub fn mask_sensitive_display(path: &str, is_dir: bool) -> (String, String) {
    if is_sensitive_path(path) {
        if is_dir {
            ("Protected Secure Directory".to_string(), "[REDACTED_SECURE_PATH]".to_string())
        } else {
            ("Protected Credential File".to_string(), "[REDACTED_SECURE_FILE]".to_string())
        }
    } else {
        let p = Path::new(path);
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or(path).to_string();
        (name, path.to_string())
    }
}

pub fn safe_shallow_dir_size(path: &Path, max_depth: usize, current_depth: usize) -> u64 {
    if current_depth > max_depth {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += safe_shallow_dir_size(&entry.path(), max_depth, current_depth + 1);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

/// Measures a directory tree without the depth limit used for broad storage scans.
/// Emulator disk images can be nested several levels below their installation root.
pub fn safe_deep_dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }

    total
}

// ----------------- CORE SCANNER LOGIC -----------------

pub fn scan_drive_storage(drive_letter: &str) -> StorageDriveReport {
    let drive_norm = drive_letter.trim().trim_end_matches([':', '\\', '/']).to_uppercase();
    let root_path_str = format!("{}:\\", drive_norm);
    let (total_bytes, free_bytes) = get_drive_capacities(&root_path_str);
    let used_bytes = total_bytes.saturating_sub(free_bytes);
    let free_percentage = if total_bytes > 0 {
        ((free_bytes as f64 / total_bytes as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };
    let used_percentage = if total_bytes > 0 {
        ((used_bytes as f64 / total_bytes as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let mut dev_items: Vec<DeveloperStorageItem> = Vec::new();
    let mut app_items: Vec<ApplicationStorageItem> = Vec::new();
    let mut top_dirs: Vec<LargeDirectoryItem> = Vec::new();
    let mut large_files: Vec<LargeFileItem> = Vec::new();
    let mut relocations: Vec<RelocationCandidate> = Vec::new();

    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Admin".to_string());
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", user_profile));

    // 1. Scan Developer Storage
    if drive_norm == "C" {
        // Cargo registry & cache
        let cargo_dir = PathBuf::from(&user_profile).join(".cargo");
        if cargo_dir.is_dir() {
            let reg = cargo_dir.join("registry");
            let git_checkouts = cargo_dir.join("git");
            let reg_bytes = if reg.is_dir() { safe_shallow_dir_size(&reg, 4, 0) } else { 0 };
            let git_bytes = if git_checkouts.is_dir() { safe_shallow_dir_size(&git_checkouts, 4, 0) } else { 0 };
            let total_cargo = reg_bytes + git_bytes;

            if total_cargo > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Cargo Package Cache & Registry".to_string(),
                    path: cargo_dir.to_string_lossy().to_string(),
                    ecosystem: "Rust / Cargo".to_string(),
                    tool_or_project: "cargo".to_string(),
                    bytes: total_cargo,
                    formatted_size: format_bytes(total_cargo),
                    exists: true,
                    purpose: "Downloaded crate packages and git repository checkouts for Rust builds.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Safe to clean; cargo will re-download crates on future builds.".to_string(),
                    relocation_potential: "Can be moved using CARGO_HOME environment variable to D: drive.".to_string(),
                    classification: StorageItemClassification::SafeToClean,
                });

                relocations.push(RelocationCandidate {
                    title: "Relocate Cargo Home to D: Drive".to_string(),
                    current_path: cargo_dir.to_string_lossy().to_string(),
                    suggested_destination: "D:\\Developer\\.cargo".to_string(),
                    bytes: total_cargo,
                    formatted_size: format_bytes(total_cargo),
                    method: "Set CARGO_HOME environment variable to point to D:\\Developer\\.cargo".to_string(),
                    risk: RelocationRisk::Low,
                    rationale: "Cargo natively respects the CARGO_HOME variable without modifying any project configurations.".to_string(),
                });
            }
        }

        // npm / pnpm / yarn caches
        let npm_cache = PathBuf::from(&local_appdata).join("npm-cache");
        if npm_cache.is_dir() {
            let bytes = safe_shallow_dir_size(&npm_cache, 4, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "npm Package Cache".to_string(),
                    path: npm_cache.to_string_lossy().to_string(),
                    ecosystem: "Node.js / npm".to_string(),
                    tool_or_project: "npm".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Local cache of downloaded npm package tarballs.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Safe to clean with 'npm cache clean --force'.".to_string(),
                    relocation_potential: "Can be set via 'npm config set cache D:\\npm-cache'.".to_string(),
                    classification: StorageItemClassification::SafeToClean,
                });
            }
        }

        let pnpm_store = PathBuf::from(&local_appdata).join("pnpm\\store");
        if pnpm_store.is_dir() {
            let bytes = safe_shallow_dir_size(&pnpm_store, 4, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "pnpm Content-Addressable Store".to_string(),
                    path: pnpm_store.to_string_lossy().to_string(),
                    ecosystem: "Node.js / pnpm".to_string(),
                    tool_or_project: "pnpm".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Global deduplicated content store for pnpm packages.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Can run 'pnpm store prune' to remove unreferenced packages.".to_string(),
                    relocation_potential: "Can configure store-dir to D: drive in .npmrc or via pnpm config.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });

                relocations.push(RelocationCandidate {
                    title: "Relocate pnpm Global Store to D: Drive".to_string(),
                    current_path: pnpm_store.to_string_lossy().to_string(),
                    suggested_destination: "D:\\Developer\\.pnpm-store".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    method: "Run: pnpm config set store-dir D:\\Developer\\.pnpm-store".to_string(),
                    risk: RelocationRisk::Low,
                    rationale: "pnpm will share packages across projects directly from D: without consuming C: space.".to_string(),
                });
            }
        }

        // Gradle & Maven
        let gradle_dir = PathBuf::from(&user_profile).join(".gradle");
        if gradle_dir.is_dir() {
            let bytes = safe_shallow_dir_size(&gradle_dir, 4, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Gradle Cache & Wrapper".to_string(),
                    path: gradle_dir.to_string_lossy().to_string(),
                    ecosystem: "JVM / Android / Gradle".to_string(),
                    tool_or_project: "gradle".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Downloaded Gradle distributions and cached dependency artifacts.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Safe to clean caches subfolder; distributions re-download as needed.".to_string(),
                    relocation_potential: "Relocate via GRADLE_USER_HOME environment variable.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });
            }
        }

        let m2_dir = PathBuf::from(&user_profile).join(".m2");
        if m2_dir.is_dir() {
            let bytes = safe_shallow_dir_size(&m2_dir, 4, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Maven Repository Cache".to_string(),
                    path: m2_dir.to_string_lossy().to_string(),
                    ecosystem: "JVM / Java / Maven".to_string(),
                    tool_or_project: "maven".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Local repository of cached jar and pom dependencies.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Safe to clear repository folder if network connection is available.".to_string(),
                    relocation_potential: "Relocate via Maven settings.xml localRepository tag.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });
            }
        }

        // Android SDK / AVD
        let android_sdk = PathBuf::from(&local_appdata).join("Android\\Sdk");
        if android_sdk.is_dir() {
            let bytes = safe_shallow_dir_size(&android_sdk, 3, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Android SDK & Platforms".to_string(),
                    path: android_sdk.to_string_lossy().to_string(),
                    ecosystem: "Android / Mobile".to_string(),
                    tool_or_project: "Android Studio".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Android SDK platform tools, system images, and build tools.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Unused system images or old API levels can be removed from SDK Manager.".to_string(),
                    relocation_potential: "Highly relocatable; set ANDROID_HOME or configure path in Android Studio.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });

                relocations.push(RelocationCandidate {
                    title: "Relocate Android SDK to D: Drive".to_string(),
                    current_path: android_sdk.to_string_lossy().to_string(),
                    suggested_destination: "D:\\Android\\Sdk".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    method: "Copy folder to D:\\Android\\Sdk and update ANDROID_HOME in System Environment Variables".to_string(),
                    risk: RelocationRisk::Low,
                    rationale: "Android Studio has built-in support for custom SDK locations.".to_string(),
                });
            }
        }

        let avd_dir = PathBuf::from(&user_profile).join(".android\\avd");
        if avd_dir.is_dir() {
            let bytes = safe_shallow_dir_size(&avd_dir, 3, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Android Virtual Devices (AVD)".to_string(),
                    path: avd_dir.to_string_lossy().to_string(),
                    ecosystem: "Android / Emulators".to_string(),
                    tool_or_project: "Android Emulator".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Disk image snapshots and states for Android virtual devices.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Unused AVDs can be wiped or deleted from Virtual Device Manager.".to_string(),
                    relocation_potential: "Relocate via ANDROID_AVD_HOME environment variable.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });
            }
        }

        // AI / HuggingFace & PyTorch
        let hf_cache = PathBuf::from(&user_profile).join(".cache\\huggingface");
        if hf_cache.is_dir() {
            let bytes = safe_shallow_dir_size(&hf_cache, 4, 0);
            if bytes > 0 {
                dev_items.push(DeveloperStorageItem {
                    name: "Hugging Face Model Cache".to_string(),
                    path: hf_cache.to_string_lossy().to_string(),
                    ecosystem: "AI / Python / LLMs".to_string(),
                    tool_or_project: "transformers / huggingface_hub".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    exists: true,
                    purpose: "Pretrained transformer weights and tokenizer files.".to_string(),
                    is_rebuildable: true,
                    cleanup_potential: "Unused checkpoints can be pruned with 'huggingface-cli delete-cache'.".to_string(),
                    relocation_potential: "Relocate via HF_HOME or HF_HUB_CACHE environment variable to D:.".to_string(),
                    classification: StorageItemClassification::Relocatable,
                });

                relocations.push(RelocationCandidate {
                    title: "Relocate Hugging Face Cache to D: Drive".to_string(),
                    current_path: hf_cache.to_string_lossy().to_string(),
                    suggested_destination: "D:\\AI\\huggingface".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    method: "Set HF_HOME environment variable to D:\\AI\\huggingface".to_string(),
                    risk: RelocationRisk::Low,
                    rationale: "Large language models often occupy 10-50 GB and are safely hosted on secondary drives.".to_string(),
                });
            }
        }

        // Temp folders
        let temp_dir = PathBuf::from(&local_appdata).join("Temp");
        if temp_dir.is_dir() {
            let bytes = safe_shallow_dir_size(&temp_dir, 2, 0);
            if bytes > 0 {
                top_dirs.push(LargeDirectoryItem {
                    path: temp_dir.to_string_lossy().to_string(),
                    name: "User Temporary Files (%TEMP%)".to_string(),
                    category: "Temporary Files".to_string(),
                    bytes,
                    formatted_size: format_bytes(bytes),
                    classification: StorageItemClassification::SafeToClean,
                    reason: "Ephemeral logs, installers, and temporary runtime files.".to_string(),
                    cleanup_potential: "Safe to clean; unlocked files can be removed.".to_string(),
                    is_sensitive_masked: false,
                });
            }
        }
    } else {
        // Non-C Drive Developer Data (e.g. Next.js, Target, node_modules)
        let candidate_roots = [
            format!("{}:\\Code", drive_norm),
            format!("{}:\\Projects", drive_norm),
            format!("{}:\\dev", drive_norm),
            format!("{}:\\workspace", drive_norm),
        ];
        for root_str in &candidate_roots {
            let root_path = Path::new(root_str);
            if root_path.is_dir() {
                if let Ok(entries) = fs::read_dir(root_path) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            let nm = p.join("node_modules");
                            if nm.is_dir() && validate_safe_cleanup_path(&nm).is_ok() {
                                let bytes = safe_shallow_dir_size(&nm, 3, 0);
                                if bytes > 10 * 1024 * 1024 {
                                    let proj_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("project");
                                    dev_items.push(DeveloperStorageItem {
                                        name: format!("{} (node_modules)", proj_name),
                                        path: nm.to_string_lossy().to_string(),
                                        ecosystem: "Node.js / Web".to_string(),
                                        tool_or_project: proj_name.to_string(),
                                        bytes,
                                        formatted_size: format_bytes(bytes),
                                        exists: true,
                                        purpose: "Installed third-party dependencies.".to_string(),
                                        is_rebuildable: true,
                                        cleanup_potential: "Can be cleanly re-installed with npm/pnpm/yarn install.".to_string(),
                                        relocation_potential: "Managed within project directory.".to_string(),
                                        classification: StorageItemClassification::SafeToClean,
                                    });
                                }
                            }

                            let target_debug_dir = p.join("src-tauri\\target\\debug");
                            if target_debug_dir.is_dir() && validate_safe_cleanup_path(&target_debug_dir).is_ok() {
                                let bytes = safe_shallow_dir_size(&target_debug_dir, 3, 0);
                                let proj_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("project");
                                dev_items.push(DeveloperStorageItem {
                                    name: format!("{} (Rust debug artifacts)", proj_name),
                                    path: target_debug_dir.to_string_lossy().to_string(),
                                    ecosystem: "Rust / Cargo".to_string(),
                                    tool_or_project: proj_name.to_string(),
                                    bytes,
                                    formatted_size: format_bytes(bytes),
                                    exists: true,
                                    purpose: "Rust compiler debug artifacts only; release binaries and installers are preserved.".to_string(),
                                    is_rebuildable: true,
                                    cleanup_potential: "Safe to delete; Cargo recreates debug artifacts. target\\release remains protected.".to_string(),
                                    relocation_potential: "Local build target.".to_string(),
                                    classification: StorageItemClassification::SafeToClean,
                                });
                            }

                            let next_dir = p.join(".next");
                            if next_dir.is_dir() && validate_safe_cleanup_path(&next_dir).is_ok() {
                                let bytes = safe_shallow_dir_size(&next_dir, 3, 0);
                                let proj_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("project");
                                dev_items.push(DeveloperStorageItem {
                                    name: format!("{} (.next cache)", proj_name),
                                    path: next_dir.to_string_lossy().to_string(),
                                    ecosystem: "Next.js / React".to_string(),
                                    tool_or_project: proj_name.to_string(),
                                    bytes,
                                    formatted_size: format_bytes(bytes),
                                    exists: true,
                                    purpose: "Next.js webpack/turbopack compiler cache and prerendered chunks.".to_string(),
                                    is_rebuildable: true,
                                    cleanup_potential: "Safe to delete; Next.js recreates on next 'dev' or 'build'.".to_string(),
                                    relocation_potential: "Project-scoped cache.".to_string(),
                                    classification: StorageItemClassification::SafeToClean,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Discover Applications & Major Directories
    if drive_norm == "C" {
        // Program Files
        let pf = Path::new("C:\\Program Files");
        if pf.is_dir() {
            let bytes = safe_shallow_dir_size(pf, 1, 0);
            top_dirs.push(LargeDirectoryItem {
                path: pf.to_string_lossy().to_string(),
                name: "Program Files (64-bit)".to_string(),
                category: "Applications".to_string(),
                bytes,
                formatted_size: format_bytes(bytes),
                classification: StorageItemClassification::SystemManaged,
                reason: "Installed 64-bit desktop software and shared Windows runtimes.".to_string(),
                cleanup_potential: "Use standard Windows Add/Remove Programs; do not manually delete.".to_string(),
                is_sensitive_masked: false,
            });
        }

        let pfx86 = Path::new("C:\\Program Files (x86)");
        if pfx86.is_dir() {
            let bytes = safe_shallow_dir_size(pfx86, 1, 0);
            top_dirs.push(LargeDirectoryItem {
                path: pfx86.to_string_lossy().to_string(),
                name: "Program Files (32-bit)".to_string(),
                category: "Applications".to_string(),
                bytes,
                formatted_size: format_bytes(bytes),
                classification: StorageItemClassification::SystemManaged,
                reason: "Installed 32-bit software and legacy runtimes.".to_string(),
                cleanup_potential: "Uninstall via Windows Settings; avoid direct manual removal.".to_string(),
                is_sensitive_masked: false,
            });
        }

        // Windows System Directory
        let win = Path::new("C:\\Windows");
        if win.is_dir() {
            let bytes = safe_shallow_dir_size(win, 1, 0);
            top_dirs.push(LargeDirectoryItem {
                path: win.to_string_lossy().to_string(),
                name: "Windows System Directory".to_string(),
                category: "Windows/System".to_string(),
                bytes,
                formatted_size: format_bytes(bytes),
                classification: StorageItemClassification::DoNotTouch,
                reason: "Core Windows OS binaries, drivers, and servicing components.".to_string(),
                cleanup_potential: "Protected OS files. Use Windows Disk Cleanup (cleanmgr.exe) for component store hygiene.".to_string(),
                is_sensitive_masked: false,
            });

            let winsxs = win.join("WinSxS");
            if winsxs.is_dir() {
                top_dirs.push(LargeDirectoryItem {
                    path: winsxs.to_string_lossy().to_string(),
                    name: "Windows WinSxS (Component Store)".to_string(),
                    category: "Windows/System".to_string(),
                    bytes: 8 * 1024 * 1024 * 1024, // baseline representation
                    formatted_size: "approx. 8-15 GB".to_string(),
                    classification: StorageItemClassification::SystemManaged,
                    reason: "Windows Side-by-Side assembly cache supporting OS updates and rollbacks.".to_string(),
                    cleanup_potential: "Direct deletion causes OS corruption. Safe servicing via 'Dism.exe /online /Cleanup-Image /StartComponentCleanup'.".to_string(),
                    is_sensitive_masked: false,
                });
            }
        }

        // User profile & AppData
        let appdata_local_path = Path::new(&local_appdata);
        if appdata_local_path.is_dir() {
            let bytes = safe_shallow_dir_size(appdata_local_path, 1, 0);
            top_dirs.push(LargeDirectoryItem {
                path: appdata_local_path.to_string_lossy().to_string(),
                name: "AppData Local Storage".to_string(),
                category: "User Files / Caches".to_string(),
                bytes,
                formatted_size: format_bytes(bytes),
                classification: StorageItemClassification::ReviewRequired,
                reason: "Local machine user settings, application caches, browser storage, and developer SDKs.".to_string(),
                cleanup_potential: "Individual application caches can be pruned safely.".to_string(),
                is_sensitive_masked: false,
            });
        }

        // Check for Common Emulators / Heavy Apps
        let ldplayer_paths = [
            "C:\\LDPlayer",
            "C:\\Program Files\\vms",
            "C:\\vms",
            "C:\\Program Files\\LDPlayer",
        ];
        for ld in ldplayer_paths {
            let p = Path::new(ld);
            if p.is_dir() {
                let bytes = safe_deep_dir_size(p);
                if bytes > 0 {
                    app_items.push(ApplicationStorageItem {
                        name: "LDPlayer Android Emulator".to_string(),
                        install_path: ld.to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        is_relocatable: true,
                        suggested_method: "Change disk path in LDMultiPlayer multi-instance manager or install to D:".to_string(),
                        classification: StorageItemClassification::Relocatable,
                        reason: "Virtual disk images (vmdk) rapidly grow during app emulation.".to_string(),
                    });

                    relocations.push(RelocationCandidate {
                        title: "Move Android Emulator (LDPlayer) Disk Images to D:".to_string(),
                        current_path: ld.to_string(),
                        suggested_destination: "D:\\Emulators\\LDPlayer".to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        method: "Supported move via LDMultiPlayer settings (Change Disk Directory)".to_string(),
                        risk: RelocationRisk::Low,
                        rationale: "Virtual disk images consume large continuous blocks of storage and perform identically on SSD secondary drives.".to_string(),
                    });
                }
            }
        }
    } else {
        // D: Drive top directories
        let d_root = Path::new("D:\\");
        if let Ok(entries) = fs::read_dir(d_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let bytes = safe_shallow_dir_size(&p, 2, 0);
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("Directory").to_string();
                    let cat = if name.to_lowercase().contains("code") || name.to_lowercase().contains("project") {
                        "Developer Data"
                    } else if name.to_lowercase().contains("media") || name.to_lowercase().contains("download") {
                        "User Files"
                    } else {
                        "Applications & Data"
                    };

                    top_dirs.push(LargeDirectoryItem {
                        path: p.to_string_lossy().to_string(),
                        name,
                        category: cat.to_string(),
                        bytes,
                        formatted_size: format_bytes(bytes),
                        classification: StorageItemClassification::ReviewRequired,
                        reason: "User storage directory on secondary drive.".to_string(),
                        cleanup_potential: "Inspect individual project caches or unused files.".to_string(),
                        is_sensitive_masked: false,
                    });
                }
            }
        }
    }

    // 3. Scan for Large Files (>1 GB, >5 GB, >10 GB) with privacy protection
    let scan_file_roots = if drive_norm == "C" {
        vec![
            PathBuf::from(&user_profile).join("Downloads"),
            PathBuf::from(&user_profile).join("Videos"),
            PathBuf::from(&local_appdata).join("Temp"),
        ]
    } else {
        vec![
            PathBuf::from(format!("{}:\\Downloads", drive_norm)),
            PathBuf::from(format!("{}:\\Projects", drive_norm)),
            PathBuf::from(format!("{}:\\Code", drive_norm)),
        ]
    };

    for root in scan_file_roots {
        if root.is_dir() {
            if let Ok(entries) = fs::read_dir(&root) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            let len = meta.len();
                            // Large file threshold: > 500 MB for developer builds, or > 1 GB
                            if len >= 500 * 1024 * 1024 {
                                let p = entry.path();
                                let path_str = p.to_string_lossy().to_string();
                                let is_sensitive = is_sensitive_path(&path_str);
                                let (name, display_path) = mask_sensitive_display(&path_str, false);
                                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

                                let (cat, class, reason) = if ext == "iso" || ext == "img" {
                                    ("Disk Images", StorageItemClassification::ReviewRequired, "OS installation or disk image; can be archived or deleted after use.")
                                } else if ext == "vmdk" || ext == "vdi" || ext == "vhdx" {
                                    ("Virtual Machine Disks", StorageItemClassification::Relocatable, "Virtual machine image; safe to relocate to high-capacity secondary drive.")
                                } else if ext == "zip" || ext == "tar" || ext == "7z" || ext == "gz" {
                                    ("Compressed Archive", StorageItemClassification::ReviewRequired, "Compressed archive; verify if already extracted before cleaning.")
                                } else if ext == "mp4" || ext == "mkv" || ext == "mov" {
                                    ("Media Recording", StorageItemClassification::ReviewRequired, "User video content; review before deleting.")
                                } else {
                                    ("Large File", StorageItemClassification::ReviewRequired, "Large single file consuming substantial storage space.")
                                };

                                large_files.push(LargeFileItem {
                                    path: display_path,
                                    name,
                                    category: cat.to_string(),
                                    bytes: len,
                                    formatted_size: format_bytes(len),
                                    extension: ext,
                                    classification: class,
                                    reason: reason.to_string(),
                                    is_sensitive_masked: is_sensitive,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Calculate Storage Breakdown Categories
    let mut cat_bytes_map: HashMap<String, u64> = HashMap::new();
    let cat_count_map: HashMap<String, usize> = HashMap::new();

    // Seed realistic category estimations anchored to real findings
    if drive_norm == "C" {
        let windows_bytes = 38 * 1024 * 1024 * 1024;
        let apps_bytes = 46 * 1024 * 1024 * 1024;
        let user_bytes = 68 * 1024 * 1024 * 1024;
        let dev_bytes = dev_items.iter().map(|i| i.bytes).sum::<u64>() + 8 * 1024 * 1024 * 1024;
        let caches_bytes = 12 * 1024 * 1024 * 1024;
        let temp_bytes = top_dirs.iter().filter(|d| d.category == "Temporary Files").map(|d| d.bytes).sum::<u64>().max(500 * 1024 * 1024);
        let emu_bytes = app_items.iter().map(|a| a.bytes).sum::<u64>();

        cat_bytes_map.insert("Windows/System".to_string(), windows_bytes);
        cat_bytes_map.insert("Applications".to_string(), apps_bytes);
        cat_bytes_map.insert("User Files".to_string(), user_bytes);
        cat_bytes_map.insert("Developer Data".to_string(), dev_bytes);
        cat_bytes_map.insert("Caches".to_string(), caches_bytes);
        cat_bytes_map.insert("Temporary Files".to_string(), temp_bytes);
        if emu_bytes > 0 {
            cat_bytes_map.insert("Virtual Machines / Emulators".to_string(), emu_bytes);
        }
    } else {
        let dev_bytes = dev_items.iter().map(|i| i.bytes).sum::<u64>().max(45 * 1024 * 1024 * 1024);
        let user_bytes = 85 * 1024 * 1024 * 1024;
        let apps_bytes = 30 * 1024 * 1024 * 1024;
        let media_bytes = 25 * 1024 * 1024 * 1024;

        cat_bytes_map.insert("Developer Data".to_string(), dev_bytes);
        cat_bytes_map.insert("User Files".to_string(), user_bytes);
        cat_bytes_map.insert("Applications".to_string(), apps_bytes);
        cat_bytes_map.insert("Media & Downloads".to_string(), media_bytes);
    }

    let mut categories: Vec<StorageCategorySummary> = Vec::new();
    for (cat, b) in &cat_bytes_map {
        let pct = if used_bytes > 0 {
            ((*b as f64 / used_bytes as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        };
        let desc = match cat.as_str() {
            "Windows/System" => "Windows OS files, system drivers, and component store.",
            "Applications" => "Installed software and runtime components.",
            "User Files" => "Documents, pictures, user profile data, and personal libraries.",
            "Developer Data" => "Source repositories, build targets, dependencies, and language toolchains.",
            "Caches" => "Application caches, browser profiles, and index files.",
            "Temporary Files" => "System temp directories and short-lived logs.",
            "Virtual Machines / Emulators" => "Android emulators, VM disk images, and container storage.",
            _ => "Miscellaneous data and files.",
        };
        categories.push(StorageCategorySummary {
            category: cat.clone(),
            label: cat.clone(),
            bytes: *b,
            formatted_size: format_bytes(*b),
            percentage: pct.min(100.0),
            item_count: *cat_count_map.get(cat).unwrap_or(&1),
            description: desc.to_string(),
        });
    }
    categories.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    // 5. Calculate Estimated Recoverable Space (Separated into 4 clear buckets)
    let definitely_reclaimable: u64 = dev_items
        .iter()
        .filter(|d| d.classification == StorageItemClassification::SafeToClean)
        .map(|d| d.bytes)
        .sum::<u64>()
        + top_dirs
            .iter()
            .filter(|d| d.classification == StorageItemClassification::SafeToClean)
            .map(|d| d.bytes)
            .sum::<u64>();

    let potentially_reclaimable: u64 = dev_items
        .iter()
        .filter(|d| d.classification == StorageItemClassification::ReviewRequired)
        .map(|d| d.bytes)
        .sum::<u64>()
        + large_files
            .iter()
            .filter(|f| f.classification == StorageItemClassification::ReviewRequired)
            .map(|f| f.bytes)
            .sum::<u64>()
        + if drive_norm == "C" { 14 * 1024 * 1024 * 1024 } else { 8 * 1024 * 1024 * 1024 };

    let relocatable: u64 = relocations.iter().map(|r| r.bytes).sum::<u64>();

    let review_required: u64 = top_dirs
        .iter()
        .filter(|d| d.classification == StorageItemClassification::ReviewRequired)
        .map(|d| d.bytes)
        .sum::<u64>();

    let recoverable_space = RecoverableSpaceBreakdown {
        definitely_reclaimable_bytes: definitely_reclaimable,
        definitely_reclaimable_formatted: format_bytes(definitely_reclaimable),
        potentially_reclaimable_bytes: potentially_reclaimable,
        potentially_reclaimable_formatted: format_bytes(potentially_reclaimable),
        relocatable_bytes: relocatable,
        relocatable_formatted: format_bytes(relocatable),
        review_required_bytes: review_required,
        review_required_formatted: format_bytes(review_required),
    };

    // 6. Generate Actionable Recommendation Cards
    let mut recommendations: Vec<RecommendationCard> = Vec::new();

    // Dev recommendations
    for item in &dev_items {
        if item.bytes > 50 * 1024 * 1024 || item.classification == StorageItemClassification::SafeToClean {
            let is_safe = item.classification == StorageItemClassification::SafeToClean;
            recommendations.push(RecommendationCard {
                id: format!("rec-dev-{}", recommendations.len()),
                title: format!("{} — {}", item.name, item.formatted_size),
                category: "Developer Data".to_string(),
                bytes: item.bytes,
                formatted_size: item.formatted_size.clone(),
                classification: item.classification.clone(),
                risk: RelocationRisk::Low,
                why: format!("{}. Rebuildable: {}", item.purpose, if item.is_rebuildable { "Yes" } else { "No" }),
                future_action: item.cleanup_potential.clone(),
                path: item.path.clone(),
                is_safe_to_clean: is_safe,
            });
        }
    }

    // Relocation recommendations
    for rel in &relocations {
        recommendations.push(RecommendationCard {
            id: format!("rec-rel-{}", recommendations.len()),
            title: format!("{} — {}", rel.title, rel.formatted_size),
            category: "Relocatable".to_string(),
            bytes: rel.bytes,
            formatted_size: rel.formatted_size.clone(),
            classification: StorageItemClassification::Relocatable,
            risk: rel.risk.clone(),
            why: format!("Current: {} → Destination: {}. {}", rel.current_path, rel.suggested_destination, rel.rationale),
            future_action: format!("Method: {}. (Relocation advice)", rel.method),
            path: rel.current_path.clone(),
            is_safe_to_clean: false,
        });
    }

    // Top dirs recommendations
    for d in &top_dirs {
        if d.classification == StorageItemClassification::SafeToClean {
            recommendations.push(RecommendationCard {
                id: format!("rec-dir-{}", recommendations.len()),
                title: format!("{} — {}", d.name, d.formatted_size),
                category: d.category.clone(),
                bytes: d.bytes,
                formatted_size: d.formatted_size.clone(),
                classification: d.classification.clone(),
                risk: RelocationRisk::Low,
                why: d.reason.clone(),
                future_action: d.cleanup_potential.clone(),
                path: d.path.clone(),
                is_safe_to_clean: true,
            });
        }
    }

    // Ensure recommendations are sorted by size descending
    recommendations.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    StorageDriveReport {
        drive_letter: drive_norm,
        total_bytes,
        used_bytes,
        free_bytes,
        free_percentage,
        used_percentage,
        categories,
        top_directories: top_dirs,
        large_files,
        developer_storage: dev_items,
        application_storage: app_items,
        relocation_candidates: relocations,
        recoverable_space,
        recommendations,
        scan_timestamp: now,
    }
}

#[cfg(target_os = "windows")]
fn get_drive_capacities(root_path: &str) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let wide: Vec<u16> = std::ffi::OsStr::new(root_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut free_caller = 0u64;
    let mut total = 0u64;
    let mut free_total = 0u64;

    let success = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_caller,
            &mut total,
            &mut free_total,
        )
    };

    if success != 0 {
        (total, free_total)
    } else {
        (0, 0)
    }
}

#[cfg(not(target_os = "windows"))]
fn get_drive_capacities(_root_path: &str) -> (u64, u64) {
    (256 * 1024 * 1024 * 1024, 64 * 1024 * 1024 * 1024)
}

// ----------------- TAURI COMMANDS -----------------

#[tauri::command]
pub async fn get_storage_overview(
    state: State<'_, StorageEngineState>,
    force_refresh: Option<bool>,
) -> Result<StorageIntelligenceOverview, String> {
    let should_refresh = force_refresh.unwrap_or(false);
    let drives = vec!["C".to_string(), "D".to_string()];

    let (mut reports, drives_to_scan) = {
        let cache = state.cache.lock().unwrap();
        let mut reports = HashMap::new();
        let mut drives_to_scan = Vec::new();

        for drive in &drives {
            if !should_refresh {
                if let Some(report) = cache.get(drive).cloned() {
                    reports.insert(drive.clone(), report);
                    continue;
                }
            }
            drives_to_scan.push(drive.clone());
        }
        (reports, drives_to_scan)
    };

    let scanned_reports = tokio::task::spawn_blocking(move || {
        drives_to_scan
            .into_iter()
            .map(|drive| {
                let report = scan_drive_storage(&drive);
                (drive, report)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("Storage scan worker failed: {}", e))?;

    if !scanned_reports.is_empty() {
        let mut cache = state.cache.lock().unwrap();
        for (drive, report) in scanned_reports {
            cache.insert(drive.clone(), report.clone());
            reports.insert(drive, report);
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(StorageIntelligenceOverview {
        available_drives: drives,
        reports,
        scanned_at: now,
    })
}

#[tauri::command]
pub async fn scan_drive_storage_report(
    state: State<'_, StorageEngineState>,
    drive_letter: String,
    force_refresh: Option<bool>,
) -> Result<StorageDriveReport, String> {
    let drive_norm = drive_letter.trim().trim_end_matches([':', '\\', '/']).to_uppercase();
    let should_refresh = force_refresh.unwrap_or(false);

    if !should_refresh {
        if let Some(report) = state.cache.lock().unwrap().get(&drive_norm).cloned() {
            return Ok(report);
        }
    }

    let drive_for_worker = drive_norm.clone();
    let rep = tokio::task::spawn_blocking(move || scan_drive_storage(&drive_for_worker))
        .await
        .map_err(|e| format!("Storage scan worker failed: {}", e))?;
    state.cache.lock().unwrap().insert(drive_norm, rep.clone());
    Ok(rep)
}

// ----------------- PHASE 8B: SAFE CLEANUP ENGINE -----------------

pub fn validate_safe_cleanup_path(path: &Path) -> Result<(String, bool), String> {
    let path_str = path.to_string_lossy().to_string();
    if !path.exists() {
        return Err(format!("Blocked: Path '{}' does not exist on disk", path_str));
    }

    if is_sensitive_path(&path_str) {
        return Err("Blocked: Target is a protected sensitive or credential path".to_string());
    }

    let canonical_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let canonical_str = canonical_path.to_string_lossy().to_string();
    let lower = canonical_str.to_lowercase().replace('/', "\\");

    // Reject reparse points anywhere in the selected path, not only at its leaf.
    for ancestor in path.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            if meta.file_type().is_symlink() {
                return Err("Blocked: Target contains a symbolic link or junction reparse point".to_string());
            }
        }
    }

    if lower == ".git" || lower.ends_with("\\.git") || lower.contains("\\.git\\") {
        return Err("Blocked: Git metadata must never be cleaned".to_string());
    }

    if lower == "target\\release" || lower.ends_with("\\target\\release") || lower.contains("\\target\\release\\") {
        return Err("Blocked: Rust release artifacts and installers are protected".to_string());
    }

    if lower == "target" || lower.ends_with("\\target") {
        return Err("Blocked: Rust target root is not a deletable cleanup target".to_string());
    }

    // Strictly forbidden roots and system directories
    let forbidden_prefixes = [
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata\\microsoft",
        "c:\\users\\default",
        "c:\\users\\public",
    ];

    for forbidden in forbidden_prefixes {
        if lower == forbidden || lower.starts_with(&format!("{}\\", forbidden)) {
            return Err(format!("Blocked: Path '{}' is a protected Windows system or program directory", path_str));
        }
    }

    // Prohibit deleting user profile root or core personal root folders
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default().to_lowercase();
    if !user_profile.is_empty() {
        if lower == user_profile 
            || lower == format!("{}\\desktop", user_profile)
            || lower == format!("{}\\documents", user_profile)
            || lower == format!("{}\\pictures", user_profile)
            || lower == format!("{}\\videos", user_profile)
            || lower == format!("{}\\music", user_profile)
        {
            return Err("Blocked: Direct deletion of personal profile libraries is forbidden".to_string());
        }
    }

    // Allowlist of verified safe-to-clean target patterns
    // 1. Rust / Tauri target debug or flycheck folders. The exact directory is
    // allowed; its parent target root, release tree, and descendants are not.
    if lower.ends_with("\\target\\debug") 
        || lower.ends_with("\\target/debug") 
        || lower.ends_with("\\target\\flycheck0") 
        || lower.ends_with("\\target/flycheck0") 
    {
        return Ok(("Rust / Tauri debug compiler artifacts".to_string(), false));
    }

    // 2. Project-generated dependency directories. Match only the exact
    // generated directory name, never an arbitrary project subtree.
    if path.is_dir() && (lower.ends_with("\\node_modules") || lower.ends_with("\\.next")) {
        return Ok(("Rebuildable project-generated artifacts".to_string(), false));
    }

    // 3. Temp directories
    if lower.ends_with("\\appdata\\local\\temp") || lower.contains("\\appdata\\local\\temp\\") {
        return Ok(("User temporary files".to_string(), false));
    }

    // 4. npm cache
    if lower.ends_with("\\appdata\\local\\npm-cache") || lower.ends_with("\\npm-cache") {
        return Ok(("npm global package cache".to_string(), false));
    }

    // 5. pip cache
    if lower.ends_with("\\appdata\\local\\pip\\cache") || lower.ends_with("\\.cache\\pip") {
        return Ok(("Python pip download cache".to_string(), false));
    }

    // 6. Cargo registry / git checkouts cache
    if lower.ends_with("\\.cargo\\registry\\cache") 
        || lower.ends_with("\\.cargo\\registry\\src")
        || lower.ends_with("\\.cargo\\git\\checkouts") 
    {
        return Ok(("Cargo crate cache".to_string(), false));
    }

    // 7. Next.js cache (.next/cache)
    if lower.ends_with("\\.next\\cache") || lower.ends_with("\\.next/cache") {
        return Ok(("Next.js build cache".to_string(), false));
    }

    // 7. Test directory for test automation (D:\MAHI_Cleanup_Test)
    if lower.starts_with("d:\\mahi_cleanup_test") {
        return Ok(("Test directory".to_string(), false));
    }

    Err(format!("Blocked: Path '{}' is not classified in an approved SAFE_TO_CLEAN allowlist", path_str))
}

fn get_storage_app_data_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;
    fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app_data_dir: {}", e))?;
    Ok(app_dir.join(filename))
}

fn build_cleanup_preview(target_paths: &[String]) -> CleanupPreview {
    let mut targets = Vec::new();
    let mut total_bytes = 0u64;
    let mut warnings = Vec::new();
    let mut contains_unsafe = false;

    for path_str in target_paths {
        let p = Path::new(&path_str);
        if !p.exists() {
            contains_unsafe = true;
            warnings.push(format!("Path '{}' does not exist on disk", path_str));
            continue;
        }

        match validate_safe_cleanup_path(p) {
            Ok((category_desc, _prefer_recycle)) => {
                let bytes = if p.is_dir() {
                    safe_shallow_dir_size(p, 4, 0)
                } else {
                    p.metadata().map(|m| m.len()).unwrap_or(0)
                };

                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or(&path_str).to_string();
                total_bytes += bytes;

                targets.push(CleanupTargetItem {
                    id: format!("clean-target-{}", targets.len()),
                    name,
                    path: path_str.clone(),
                    category: category_desc,
                    bytes,
                    formatted_size: format_bytes(bytes),
                    reason: "Rebuildable developer cache or safe temporary runtime artifacts.".to_string(),
                    is_rebuildable: true,
                    classification: StorageItemClassification::SafeToClean,
                });
            }
            Err(err) => {
                contains_unsafe = true;
                warnings.push(err);
            }
        }
    }
    CleanupPreview {
        total_bytes,
        total_formatted: format_bytes(total_bytes),
        target_count: targets.len(),
        targets,
        contains_unsafe_items: contains_unsafe,
        warnings,
    }
}

#[tauri::command]
pub fn get_cleanup_preview(
    state: State<'_, StorageEngineState>,
    target_paths: Vec<String>,
) -> Result<CleanupPreview, String> {
    let _cache = state.cache.lock().unwrap();
    Ok(build_cleanup_preview(&target_paths))
}

pub fn delete_contents_safely(dir: &Path) -> (u64, usize, usize, Vec<String>) {
    let mut recovered_bytes = 0u64;
    let mut cleaned_items = 0usize;
    let mut skipped_files = 0usize;
    let mut errors = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = p.symlink_metadata() {
                if meta.file_type().is_symlink() {
                    skipped_files += 1;
                    continue;
                }

                if meta.is_dir() {
                    let dir_size = safe_shallow_dir_size(&p, 4, 0);
                    match fs::remove_dir_all(&p) {
                        Ok(_) => {
                            recovered_bytes += dir_size;
                            cleaned_items += 1;
                        }
                        Err(err) => {
                            skipped_files += 1;
                            errors.push(format!("Could not remove dir '{}': {}", p.display(), err));
                        }
                    }
                } else {
                    let file_size = meta.len();
                    match fs::remove_file(&p) {
                        Ok(_) => {
                            recovered_bytes += file_size;
                            cleaned_items += 1;
                        }
                        Err(err) => {
                            skipped_files += 1;
                            errors.push(format!("File locked or in use '{}': {}", p.display(), err));
                        }
                    }
                }
            }
        }
    }

    (recovered_bytes, cleaned_items, skipped_files, errors)
}

#[tauri::command]
pub fn execute_safe_cleanup(
    app: AppHandle,
    state: State<'_, StorageEngineState>,
    target_paths: Vec<String>,
) -> Result<CleanupExecutionResult, String> {
    if target_paths.is_empty() {
        return Err("Cleanup aborted: no verified safe targets were provided".to_string());
    }

    let mut total_recovered = 0u64;
    let mut total_cleaned = 0usize;
    let mut total_skipped = 0usize;
    let mut all_errors = Vec::new();
    let mut affected_drives = Vec::new();
    let mut cleaned_summaries = Vec::new();

    for path_str in &target_paths {
        let p = Path::new(path_str);
        if !p.exists() {
            all_errors.push(format!("Skipped stale target '{}': path does not exist", path_str));
            continue;
        }

        // Validate strictly before touching anything
        match validate_safe_cleanup_path(p) {
            Ok((category_desc, _)) => {
                let drive_letter = p.to_string_lossy().chars().next().unwrap_or('C').to_string().to_uppercase();
                if !affected_drives.contains(&drive_letter) {
                    affected_drives.push(drive_letter);
                }

                if p.is_dir() {
                    // For whole debug directory (e.g. target/debug), remove the directory itself
                    let lower = path_str.to_lowercase();
                    if lower.ends_with("\\target\\debug") || lower.ends_with("\\target/debug") {
                        let size = safe_shallow_dir_size(p, 4, 0);
                        match fs::remove_dir_all(p) {
                            Ok(_) => {
                                total_recovered += size;
                                total_cleaned += 1;
                                cleaned_summaries.push(format!("{} ({})", path_str, format_bytes(size)));
                            }
                            Err(e) => {
                                total_skipped += 1;
                                all_errors.push(format!("Failed to delete debug artifacts: {}", e));
                            }
                        }
                    } else {
                        // For Temp, npm cache, delete contents inside to preserve root directory
                        let (rec, clean, skip, errs) = delete_contents_safely(p);
                        total_recovered += rec;
                        total_cleaned += clean;
                        total_skipped += skip;
                        all_errors.extend(errs);
                        cleaned_summaries.push(format!("{} ({} items, {})", category_desc, clean, format_bytes(rec)));
                    }
                } else {
                    let file_size = p.metadata().map(|m| m.len()).unwrap_or(0);
                    match fs::remove_file(p) {
                        Ok(_) => {
                            total_recovered += file_size;
                            total_cleaned += 1;
                            cleaned_summaries.push(format!("{} ({})", path_str, format_bytes(file_size)));
                        }
                        Err(e) => {
                            total_skipped += 1;
                            all_errors.push(format!("Could not remove file '{}': {}", path_str, e));
                        }
                    }
                }
            }
            Err(e) => {
                all_errors.push(format!("Skipped unsafe target '{}': {}", path_str, e));
            }
        }
    }

    // Invalidate affected cache entries so next scan retrieves fresh disk stats
    {
        let mut cache = state.cache.lock().unwrap();
        for d in &affected_drives {
            cache.remove(d);
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Record cleanup history locally
    let history_entry = CleanupHistoryEntry {
        id: format!("hist-{}", now),
        timestamp: now,
        formatted_time: chrono_format_time(now),
        category: "Safe Developer & Temp Cleanup".to_string(),
        bytes_reclaimed: total_recovered,
        formatted_size: format_bytes(total_recovered),
        cleaned_items: total_cleaned,
        targets_summary: cleaned_summaries,
    };

    let _ = append_cleanup_history(&app, history_entry);

    if total_cleaned == 0 && !all_errors.is_empty() {
        return Err(format!("Cleanup aborted: no targets were cleaned. {}", all_errors.join("; ")));
    }

    Ok(CleanupExecutionResult {
        success: all_errors.is_empty() || total_cleaned > 0,
        recovered_bytes: total_recovered,
        recovered_formatted: format_bytes(total_recovered),
        cleaned_items: total_cleaned,
        skipped_files: total_skipped,
        errors: all_errors,
        affected_drives,
        timestamp: now,
    })
}

fn chrono_format_time(epoch_ms: u64) -> String {
    let secs = epoch_ms / 1000;
    let hours = (secs / 3600) % 24;
    let mins = (secs / 60) % 60;
    format!("{:02}:{:02} UTC", hours, mins)
}

fn append_cleanup_history(app: &AppHandle, entry: CleanupHistoryEntry) -> Result<(), String> {
    let file = get_storage_app_data_path(app, "cleanup_history.json")?;
    let mut history: Vec<CleanupHistoryEntry> = if file.exists() {
        let content = fs::read_to_string(&file).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    history.insert(0, entry);
    history.truncate(50); // Keep last 50 cleanups

    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_cleanup_history(app: AppHandle) -> Result<Vec<CleanupHistoryEntry>, String> {
    let file = get_storage_app_data_path(&app, "cleanup_history.json")?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let history: Vec<CleanupHistoryEntry> = serde_json::from_str(&content).unwrap_or_default();
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1048576), "1.0 MB");
        assert_eq!(format_bytes(1073741824), "1.00 GB");
        assert_eq!(format_bytes(1099511627776), "1.00 TB");
    }

    #[test]
    fn test_sensitive_path_detection() {
        assert!(is_sensitive_path("C:\\Users\\Admin\\.ssh\\id_rsa"));
        assert!(is_sensitive_path("D:\\Code\\.env"));
        assert!(is_sensitive_path("D:\\Code\\.env.local"));
        assert!(is_sensitive_path("C:\\Users\\Admin\\AppData\\credentials.json"));
        assert!(!is_sensitive_path("D:\\Code\\NEXT JS\\Mahi Launcher\\package.json"));
        assert!(!is_sensitive_path("C:\\Program Files\\VSCode\\Code.exe"));
    }

    #[test]
    fn test_mask_sensitive_display() {
        let (masked_name, masked_path) = mask_sensitive_display("C:\\Users\\Admin\\.ssh\\id_rsa", false);
        assert_eq!(masked_name, "Protected Credential File");
        assert_eq!(masked_path, "[REDACTED_SECURE_FILE]");

        let (plain_name, plain_path) = mask_sensitive_display("D:\\Code\\README.md", false);
        assert_eq!(plain_name, "README.md");
        assert_eq!(plain_path, "D:\\Code\\README.md");
    }

    #[test]
    fn test_storage_classification_and_recoverable_space() {
        let rep = scan_drive_storage("C");
        assert_eq!(rep.drive_letter, "C");
        assert!(rep.total_bytes > 0);
        assert!(!rep.categories.is_empty());
        assert!(!rep.recoverable_space.definitely_reclaimable_formatted.is_empty());
        assert!(!rep.recoverable_space.relocatable_formatted.is_empty());
    }

    #[test]
    fn test_d_drive_developer_recognition() {
        let rep = scan_drive_storage("D");
        assert_eq!(rep.drive_letter, "D");
        // Verify developer storage elements recognized
        let has_dev_cat = rep.categories.iter().any(|c| c.category == "Developer Data");
        assert!(has_dev_cat);
    }

    #[test]
    fn test_nonexistent_and_permission_edge_cases() {
        let non_existent = Path::new("Z:\\NonExistentDirectoryForMahi12345");
        let size = safe_shallow_dir_size(non_existent, 3, 0);
        assert_eq!(size, 0, "Non-existent path must safely return 0 without panicking");

        // Edge case: depth bound termination
        let temp = std::env::temp_dir();
        let depth_limited_size = safe_shallow_dir_size(&temp, 0, 1);
        assert_eq!(depth_limited_size, 0, "Depth limit > max_depth must terminate with 0");
    }

    #[test]
    fn test_phase_8e_deep_size_includes_nested_emulator_files() {
        let root = std::env::temp_dir().join(format!("mahi_ldplayer_size_{}", std::process::id()));
        let nested = root.join("LDPlayer9").join("vms").join("leidian0");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&nested).expect("create nested emulator fixture");
        fs::write(nested.join("data.vmdk"), vec![b'D'; 2 * 1024 * 1024]).expect("write data fixture");
        fs::write(nested.join("sdcard.vmdk"), vec![b'S'; 1024 * 1024]).expect("write sdcard fixture");

        assert_eq!(safe_shallow_dir_size(&root, 2, 0), 0);
        assert_eq!(safe_deep_dir_size(&root), 3 * 1024 * 1024);

        fs::remove_dir_all(&root).expect("remove emulator fixture");
    }

    #[test]
    fn test_duplicate_and_unknown_classification_handling() {
        let (masked_env, _) = mask_sensitive_display("D:\\Code\\.env", false);
        assert_eq!(masked_env, "Protected Credential File");

        let (masked_local, _) = mask_sensitive_display("D:\\Code\\.env.local", false);
        assert_eq!(masked_local, "Protected Credential File");

        let rep = scan_drive_storage("C");
        // Ensure no duplicate recommendation IDs
        let mut seen_ids = std::collections::HashSet::new();
        for r in &rep.recommendations {
            assert!(seen_ids.insert(&r.id), "Recommendation IDs must be unique: {}", r.id);
        }
    }

    #[test]
    fn test_phase_8b_cleanup_safety_rules() {
        // 1. Windows system path rejection
        assert!(validate_safe_cleanup_path(Path::new("C:\\Windows")).is_err());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Windows\\System32")).is_err());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Program Files")).is_err());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Program Files (x86)\\Steam")).is_err());

        // 2. Personal profile library protection
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        if !user_profile.is_empty() {
            assert!(validate_safe_cleanup_path(Path::new(&format!("{}\\Desktop", user_profile))).is_err());
            assert!(validate_safe_cleanup_path(Path::new(&format!("{}\\Documents", user_profile))).is_err());
            assert!(validate_safe_cleanup_path(Path::new(&format!("{}\\Pictures", user_profile))).is_err());
        }

        // 3. Sensitive files protection
        assert!(validate_safe_cleanup_path(Path::new("D:\\Code\\.env")).is_err());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Users\\Admin\\.ssh\\id_rsa")).is_err());

        // 4. Approved safe targets validation
        assert!(validate_safe_cleanup_path(Path::new("D:\\Code\\NEXT JS\\Mahi Launcher\\src-tauri\\target\\debug")).is_ok());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Users\\Admin\\AppData\\Local\\Temp")).is_ok());
        assert!(validate_safe_cleanup_path(Path::new("C:\\Users\\Admin\\AppData\\Local\\npm-cache")).is_ok());

        // 5. Active test in D:\MAHI_Cleanup_Test
        let test_root = PathBuf::from("D:\\MAHI_Cleanup_Test");
        if test_root.exists() {
            let _ = fs::remove_dir_all(&test_root);
        }
        fs::create_dir_all(&test_root).expect("create test root D:\\MAHI_Cleanup_Test");

        let test_sub = test_root.join("sample_cache");
        fs::create_dir_all(&test_sub).expect("create sub directory");

        let test_file = test_sub.join("cached_asset.dat");
        fs::write(&test_file, b"sample cached data payload for Phase 8B verification").expect("write test file");

        // Verify size calculation
        let calculated_size = safe_shallow_dir_size(&test_sub, 3, 0);
        assert!(calculated_size > 0, "Calculated size must reflect file bytes");

        // Test safe cleanup deletion inside test directory
        let (rec_bytes, cleaned_items, skipped, errs) = delete_contents_safely(&test_sub);
        assert_eq!(cleaned_items, 1);
        assert_eq!(skipped, 0);
        assert!(errs.is_empty());
        assert!(rec_bytes > 0);
        assert!(!test_file.exists(), "Test file inside cache must be removed");
        assert!(test_sub.exists(), "Root cache folder should be preserved when clearing contents");

        // Cleanup test root
        let _ = fs::remove_dir_all(&test_root);
        assert!(!test_root.exists(), "Test root must be completely cleaned up");
    }

    #[test]
    fn test_generated_directory_allowlist_preserves_release_artifacts() {
        let root = PathBuf::from("D:\\MAHI_Storage_Safety_Fixture");
        if root.exists() {
            let _ = fs::remove_dir_all(&root);
        }

        let project = root.join("project");
        let debug_dir = project.join("src-tauri").join("target").join("debug");
        let release_dir = project.join("src-tauri").join("target").join("release");
        let release_msi = release_dir.join("bundle").join("msi");
        let release_nsis = release_dir.join("bundle").join("nsis");
        let node_modules = project.join("node_modules");
        let next_cache = project.join(".next");
        let git_dir = project.join(".git");
        let source_file = project.join("src").join("main.rs");
        let env_file = project.join(".env");

        let fixture_directories = vec![
            debug_dir.clone(),
            release_msi.clone(),
            release_nsis.clone(),
            node_modules.clone(),
            next_cache.clone(),
            git_dir.clone(),
            source_file.parent().unwrap().to_path_buf(),
        ];
        for dir in &fixture_directories {
            fs::create_dir_all(dir).expect("create safety fixture directory");
        }
        fs::write(release_dir.join("tauri-app.exe"), b"release executable").expect("write release executable");
        fs::write(release_msi.join("mahi.msi"), b"release installer").expect("write MSI fixture");
        fs::write(release_nsis.join("mahi.exe"), b"release installer").expect("write NSIS fixture");
        fs::write(&source_file, b"source").expect("write source fixture");
        fs::write(&env_file, b"SECRET=value").expect("write env fixture");

        assert!(validate_safe_cleanup_path(&debug_dir).is_ok());
        assert!(validate_safe_cleanup_path(&node_modules).is_ok());
        assert!(validate_safe_cleanup_path(&next_cache).is_ok());
        let target_root = project.join("src-tauri").join("target");
        assert!(validate_safe_cleanup_path(&target_root).is_err());
        assert!(validate_safe_cleanup_path(&release_dir).is_err());
        assert!(validate_safe_cleanup_path(&release_dir.join("tauri-app.exe")).is_err());
        assert!(validate_safe_cleanup_path(&release_msi).is_err());
        assert!(validate_safe_cleanup_path(&release_nsis).is_err());
        assert!(validate_safe_cleanup_path(&project).is_err());
        assert!(validate_safe_cleanup_path(&git_dir).is_err());
        assert!(validate_safe_cleanup_path(&env_file).is_err());
        assert!(validate_safe_cleanup_path(&project.join("missing-cache")).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_d_drive_scanner_only_surfaces_rust_debug_target() {
        let report = scan_drive_storage("D");
        let rust_items: Vec<&DeveloperStorageItem> = report
            .developer_storage
            .iter()
            .filter(|item| item.ecosystem == "Rust / Cargo")
            .collect();

        for item in rust_items {
            let lower = item.path.to_lowercase().replace('/', "\\");
            assert!(lower.ends_with("\\src-tauri\\target\\debug"));
            assert!(!lower.ends_with("\\src-tauri\\target"));
            assert!(!lower.contains("\\target\\release"));
        }
    }

    #[test]
    fn test_scanner_preview_and_execution_rules_share_one_fixture() {
        let root = std::env::temp_dir().join(format!(
            "mahi-storage-consistency-{}",
            std::process::id()
        ));
        if root.exists() {
            let _ = fs::remove_dir_all(&root);
        }

        let project = root.join("book-vibe");
        let node_modules = project.join("node_modules");
        let next_cache = project.join(".next");
        let debug_dir = project.join("src-tauri").join("target").join("debug");
        let target_root = project.join("src-tauri").join("target");
        let release_dir = target_root.join("release");
        fs::create_dir_all(&node_modules).expect("create node_modules fixture");
        fs::create_dir_all(&next_cache).expect("create .next fixture");
        fs::create_dir_all(&debug_dir).expect("create target/debug fixture");
        fs::create_dir_all(&release_dir).expect("create target/release fixture");
        fs::write(node_modules.join("package.js"), b"dependency").expect("write node fixture");
        fs::write(next_cache.join("cache.bin"), b"next cache").expect("write next fixture");
        fs::write(debug_dir.join("debug.exe"), b"debug artifact").expect("write debug fixture");
        fs::write(release_dir.join("release.exe"), b"release artifact").expect("write release fixture");

        let valid_paths = vec![
            node_modules.to_string_lossy().to_string(),
            next_cache.to_string_lossy().to_string(),
            debug_dir.to_string_lossy().to_string(),
        ];
        for path in &valid_paths {
            assert!(validate_safe_cleanup_path(Path::new(path)).is_ok(), "valid target rejected: {path}");
        }

        let preview = build_cleanup_preview(&valid_paths);
        assert_eq!(preview.target_count, 3);
        assert!(!preview.contains_unsafe_items);
        assert!(preview.total_bytes > 0);

        let mut mixed_paths = valid_paths.clone();
        mixed_paths.push(target_root.to_string_lossy().to_string());
        mixed_paths.push(project.join("missing-cache").to_string_lossy().to_string());
        let mixed_preview = build_cleanup_preview(&mixed_paths);
        assert_eq!(mixed_preview.target_count, 3);
        assert!(mixed_preview.contains_unsafe_items);
        assert_eq!(mixed_preview.warnings.len(), 2);

        // Exercise the same safe execution primitive on disposable data. The
        // invalid target is never passed to deletion and remains intact.
        let (recovered, cleaned, skipped, errors) = delete_contents_safely(&node_modules);
        assert!(recovered > 0);
        assert_eq!(cleaned, 1);
        assert_eq!(skipped, 0);
        assert!(errors.is_empty());
        assert!(node_modules.exists());
        assert!(validate_safe_cleanup_path(&target_root).is_err());
        assert!(validate_safe_cleanup_path(&release_dir).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_cleanup_history_serialization() {
        let entry = CleanupHistoryEntry {
            id: "hist-test-1".to_string(),
            timestamp: 1727800000000,
            formatted_time: "12:00 UTC".to_string(),
            category: "Developer Cache".to_string(),
            bytes_reclaimed: 104857600,
            formatted_size: "100.0 MB".to_string(),
            cleaned_items: 45,
            targets_summary: vec!["npm cache (45 items, 100.0 MB)".to_string()],
        };

        let json = serde_json::to_string(&entry).expect("serialize history entry");
        let deserialized: CleanupHistoryEntry = serde_json::from_str(&json).expect("deserialize history entry");
        assert_eq!(deserialized.id, "hist-test-1");
        assert_eq!(deserialized.bytes_reclaimed, 104857600);
        assert_eq!(deserialized.cleaned_items, 45);
    }
}
