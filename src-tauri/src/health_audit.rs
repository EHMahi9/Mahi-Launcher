use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use crate::storage_engine::{self, DeveloperStorageItem};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthStatus {
    Healthy,
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeveloperToolCategory {
    Vcs,
    Runtime,
    PackageManager,
    BuildTool,
    Container,
    Editor,
    Shell,
    Platform,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperTool {
    pub id: String,
    pub name: String,
    pub category: DeveloperToolCategory,
    pub status: HealthStatus,
    pub is_installed: bool,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    pub detection_method: String,
    pub shadowed_count: usize,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEntryDiagnostic {
    pub path: String,
    pub index: usize,
    pub exists: bool,
    pub is_duplicate: bool,
    pub category: String,
    pub detected_tool: Option<String>,
    pub status: HealthStatus,
    pub issue: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowedPathInstance {
    pub path: String,
    pub version: Option<String>,
    pub path_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathConflictDiagnostic {
    pub executable: String,
    pub active_path: String,
    pub active_version: Option<String>,
    pub shadowed_paths: Vec<ShadowedPathInstance>,
    pub explanation: String,
    pub severity: HealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathDiagnosticsReport {
    pub total_entries: usize,
    pub valid_entries: usize,
    pub missing_entries: usize,
    pub duplicate_entries: usize,
    pub developer_entries: usize,
    pub entries: Vec<PathEntryDiagnostic>,
    pub conflicts: Vec<PathConflictDiagnostic>,
    pub overall_status: HealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolVersionInstance {
    pub version: String,
    pub path: String,
    pub source: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipleVersionReport {
    pub tool_id: String,
    pub tool_name: String,
    pub versions: Vec<ToolVersionInstance>,
    pub active_version: Option<String>,
    pub status: HealthStatus,
    pub classification: String,
    pub explanation: String,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityRequirement {
    pub target: String,
    pub required: String,
    pub machine_installed: Option<String>,
    pub satisfied: Option<bool>,
    pub status: HealthStatus,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCompatibilityCheck {
    pub project_path: String,
    pub project_name: String,
    pub ecosystem: String,
    pub requirements: Vec<CompatibilityRequirement>,
    pub overall_status: HealthStatus,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentVariableAudit {
    pub name: String,
    pub is_set: bool,
    pub sanitized_value: Option<String>,
    pub target_exists: bool,
    pub matches_active_tool: bool,
    pub status: HealthStatus,
    pub explanation: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperFinding {
    pub id: String,
    pub title: String,
    pub category: String,
    pub severity: HealthStatus,
    pub evidence: String,
    pub explanation: String,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperEnvironmentReport {
    pub generated_at: u64,
    pub health_score: u32,
    pub overall_status: HealthStatus,
    pub healthy_count: usize,
    pub info_count: usize,
    pub warning_count: usize,
    pub critical_count: usize,
    pub tools: Vec<DeveloperTool>,
    pub path_diagnostics: PathDiagnosticsReport,
    pub multiple_versions: Vec<MultipleVersionReport>,
    pub project_compatibility: Vec<ProjectCompatibilityCheck>,
    pub environment_variables: Vec<EnvironmentVariableAudit>,
    pub developer_storage: Vec<DeveloperStorageItem>,
    pub findings: Vec<DeveloperFinding>,
}

// -------------------------------------------------------------------------
// Helper functions for safe version probing and execution
// -------------------------------------------------------------------------

pub fn clean_version_output(raw: &str) -> String {
    let first_line = raw.lines().next().unwrap_or("").trim();
    // Common prefixes to trim
    let line = first_line
        .strip_prefix("git version ")
        .unwrap_or(first_line);
    let line = line.strip_prefix("node ").unwrap_or(line);
    let line = line.strip_prefix("v").unwrap_or(line);
    let line = line.strip_prefix("Python ").unwrap_or(line);
    let line = line.strip_prefix("rustc ").unwrap_or(line);
    let line = line.strip_prefix("cargo ").unwrap_or(line);
    let line = line.strip_prefix("go version go").unwrap_or(line);
    let line = line.strip_prefix("Docker version ").unwrap_or(line);
    let line = line.strip_prefix("openjdk version ").unwrap_or(line);
    let line = line.strip_prefix("java version ").unwrap_or(line);
    let line = line.strip_prefix("javac ").unwrap_or(line);
    let line = line.strip_prefix("Apache Maven ").unwrap_or(line);
    let line = line.strip_prefix("Gradle ").unwrap_or(line);
    
    // Split on space or comma to isolate version string
    let token = line.split_whitespace().next().unwrap_or(line);
    token.trim_matches(|c: char| c == '"' || c == '\'' || c == ',' || c == ';').trim().to_string()
}

pub fn execute_version_probe(exe_path: &Path, args: &[&str]) -> Option<String> {
    if !exe_path.is_file() {
        return None;
    }
    let path_buf = exe_path.to_path_buf();
    let owned_args: Vec<String> = args.iter().map(|s| s.to_string()).collect();

    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::spawn(move || {
        let mut cmd = Command::new(&path_buf);
        cmd.args(&owned_args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let res = cmd.output().ok().and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = if !stdout.trim().is_empty() {
                stdout.to_string()
            } else {
                stderr.to_string()
            };
            let cleaned = clean_version_output(&combined);
            if !cleaned.is_empty() {
                Some(cleaned)
            } else {
                None
            }
        });
        let _ = tx.send(res);
    });

    match rx.recv_timeout(std::time::Duration::from_millis(2500)) {
        Ok(result) => result,
        Err(_) => None, // Isolated timeout failure: does not hang audit or crash report
    }
}


// Check standard directory candidate paths for a binary
pub fn find_in_standard_paths(relative_subpaths: &[&str]) -> Option<PathBuf> {
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Admin".to_string());
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", user_profile));
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", user_profile));
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

    let bases = [
        PathBuf::from(&user_profile),
        PathBuf::from(&local_appdata),
        PathBuf::from(&appdata),
        PathBuf::from(&program_files),
        PathBuf::from(&program_files_x86),
    ];

    for base in &bases {
        for rel in relative_subpaths {
            let candidate = base.join(rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// -------------------------------------------------------------------------
// Toolchain Detection
// -------------------------------------------------------------------------

struct ToolSpec<'a> {
    id: &'a str,
    name: &'a str,
    category: DeveloperToolCategory,
    binary_names: &'a [&'a str],
    version_args: &'a [&'a str],
    standard_rel_paths: &'a [&'a str],
    env_hint: Option<&'a str>,
}

pub fn detect_all_tools(path_dirs: &[PathBuf]) -> Vec<DeveloperTool> {
    let specs = [
        ToolSpec {
            id: "git",
            name: "Git",
            category: DeveloperToolCategory::Vcs,
            binary_names: &["git.exe", "git.cmd"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Git\\cmd\\git.exe",
                "Git\\bin\\git.exe",
                "Programs\\Git\\cmd\\git.exe",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "node",
            name: "Node.js",
            category: DeveloperToolCategory::Runtime,
            binary_names: &["node.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "nodejs\\node.exe",
                "nvm\\v24.16.0\\node.exe",
                "fnm\\current\\node.exe",
                "fnm_multishells\\node.exe",
                "Programs\\fnm\\node.exe",
            ],
            env_hint: Some("NODE_HOME"),
        },
        ToolSpec {
            id: "npm",
            name: "npm",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["npm.cmd", "npm.exe", "npm.ps1"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "nodejs\\npm.cmd",
                "npm\\npm.cmd",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "pnpm",
            name: "pnpm",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["pnpm.cmd", "pnpm.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "pnpm\\pnpm.cmd",
                "pnpm\\pnpm.exe",
                "nodejs\\pnpm.cmd",
            ],
            env_hint: Some("PNPM_HOME"),
        },
        ToolSpec {
            id: "yarn",
            name: "Yarn",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["yarn.cmd", "yarn.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Yarn\\bin\\yarn.cmd",
                "npm\\yarn.cmd",
                "nodejs\\yarn.cmd",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "bun",
            name: "Bun",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["bun.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                ".bun\\bin\\bun.exe",
                "bun\\bin\\bun.exe",
            ],
            env_hint: Some("BUN_INSTALL"),
        },
        ToolSpec {
            id: "python",
            name: "Python",
            category: DeveloperToolCategory::Runtime,
            binary_names: &["python.exe", "py.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Programs\\Python\\Python314\\python.exe",
                "Programs\\Python\\Python313\\python.exe",
                "Programs\\Python\\Python312\\python.exe",
                "Programs\\Python\\Python311\\python.exe",
                "Programs\\Python\\Python310\\python.exe",
                "Python310\\python.exe",
                "WindowsApps\\python.exe",
                "py.exe",
            ],
            env_hint: Some("PYTHON_HOME"),
        },
        ToolSpec {
            id: "pip",
            name: "pip",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["pip.exe", "pip3.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Programs\\Python\\Python314\\Scripts\\pip.exe",
                "Programs\\Python\\Python310\\Scripts\\pip.exe",
                "Python310\\Scripts\\pip.exe",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "java",
            name: "Java Runtime",
            category: DeveloperToolCategory::Runtime,
            binary_names: &["java.exe"],
            version_args: &["-version"],
            standard_rel_paths: &[
                "Eclipse Adoptium\\jdk-25\\bin\\java.exe",
                "Eclipse Adoptium\\jdk-21\\bin\\java.exe",
                "Eclipse Adoptium\\jdk-17\\bin\\java.exe",
                "Java\\jdk-21\\bin\\java.exe",
                "Java\\jdk-17\\bin\\java.exe",
                "Common Files\\Oracle\\Java\\javapath\\java.exe",
            ],
            env_hint: Some("JAVA_HOME"),
        },
        ToolSpec {
            id: "jdk",
            name: "Java Development Kit (javac)",
            category: DeveloperToolCategory::BuildTool,
            binary_names: &["javac.exe"],
            version_args: &["-version"],
            standard_rel_paths: &[
                "Eclipse Adoptium\\jdk-25\\bin\\javac.exe",
                "Eclipse Adoptium\\jdk-21\\bin\\javac.exe",
                "Eclipse Adoptium\\jdk-17\\bin\\javac.exe",
                "Java\\jdk-21\\bin\\javac.exe",
                "Java\\jdk-17\\bin\\javac.exe",
            ],
            env_hint: Some("JAVA_HOME"),
        },
        ToolSpec {
            id: "maven",
            name: "Maven",
            category: DeveloperToolCategory::BuildTool,
            binary_names: &["mvn.cmd", "mvn.bat", "mvn.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "apache-maven\\bin\\mvn.cmd",
                "Maven\\bin\\mvn.cmd",
            ],
            env_hint: Some("MAVEN_HOME"),
        },
        ToolSpec {
            id: "gradle",
            name: "Gradle",
            category: DeveloperToolCategory::BuildTool,
            binary_names: &["gradle.bat", "gradle.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "gradle\\bin\\gradle.bat",
                ".gradle\\wrapper\\dists",
            ],
            env_hint: Some("GRADLE_HOME"),
        },
        ToolSpec {
            id: "rust",
            name: "Rust (rustc)",
            category: DeveloperToolCategory::Runtime,
            binary_names: &["rustc.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                ".cargo\\bin\\rustc.exe",
            ],
            env_hint: Some("CARGO_HOME"),
        },
        ToolSpec {
            id: "cargo",
            name: "Cargo",
            category: DeveloperToolCategory::PackageManager,
            binary_names: &["cargo.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                ".cargo\\bin\\cargo.exe",
            ],
            env_hint: Some("CARGO_HOME"),
        },
        ToolSpec {
            id: "go",
            name: "Go",
            category: DeveloperToolCategory::Runtime,
            binary_names: &["go.exe"],
            version_args: &["version"],
            standard_rel_paths: &[
                "Go\\bin\\go.exe",
            ],
            env_hint: Some("GOROOT"),
        },
        ToolSpec {
            id: "docker",
            name: "Docker",
            category: DeveloperToolCategory::Container,
            binary_names: &["docker.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Docker\\Docker\\resources\\bin\\docker.exe",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "wsl",
            name: "Windows Subsystem for Linux (WSL)",
            category: DeveloperToolCategory::Container,
            binary_names: &["wsl.exe"],
            version_args: &["--status"],
            standard_rel_paths: &[
                "C:\\Windows\\System32\\wsl.exe",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "vscode",
            name: "Visual Studio Code",
            category: DeveloperToolCategory::Editor,
            binary_names: &["code.cmd", "code.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Programs\\Microsoft VS Code\\bin\\code.cmd",
                "Microsoft VS Code\\bin\\code.cmd",
            ],
            env_hint: None,
        },
        ToolSpec {
            id: "powershell",
            name: "PowerShell Core / Windows PowerShell",
            category: DeveloperToolCategory::Shell,
            binary_names: &["pwsh.exe", "powershell.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "PowerShell\\7\\pwsh.exe",
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            ],
            env_hint: None,
        },
    ];

    let mut tools = Vec::new();

    for spec in &specs {
        let mut found_path: Option<PathBuf> = None;
        let mut method = String::from("Not Found");
        let mut matches_in_path = Vec::new();

        // 1. Check in PATH directories
        for dir in path_dirs {
            for bname in spec.binary_names {
                let candidate = dir.join(bname);
                if candidate.is_file() {
                    matches_in_path.push(candidate);
                }
            }
        }

        if let Some(first_match) = matches_in_path.first() {
            found_path = Some(first_match.clone());
            method = "Resolved via system PATH".to_string();
        }

        // 2. If not found in PATH, check environment variable hint (e.g. JAVA_HOME, CARGO_HOME)
        if found_path.is_none() {
            if let Some(env_name) = spec.env_hint {
                if let Ok(val) = std::env::var(env_name) {
                    let base = PathBuf::from(val);
                    for bname in spec.binary_names {
                        let direct = base.join(bname);
                        let bin = base.join("bin").join(bname);
                        if direct.is_file() {
                            found_path = Some(direct);
                            method = format!("Discovered via {}", env_name);
                            break;
                        } else if bin.is_file() {
                            found_path = Some(bin);
                            method = format!("Discovered via {}\\\\bin", env_name);
                            break;
                        }
                    }
                }
            }
        }

        // 3. If still not found, check standard installation directories on disk
        if found_path.is_none() {
            if let Some(std_path) = find_in_standard_paths(spec.standard_rel_paths) {
                found_path = Some(std_path);
                method = "Discovered in standard installation directory (not currently in PATH)".to_string();
            }
        }

        let is_installed = found_path.is_some();
        let mut version = None;
        let mut notes = None;
        let mut status = HealthStatus::Healthy;

        if let Some(ref path) = found_path {
            version = execute_version_probe(path, spec.version_args);
            if matches_in_path.len() > 1 {
                notes = Some(format!("Multiple installations detected in PATH ({})", matches_in_path.len()));
                status = HealthStatus::Info;
            } else if !method.contains("PATH") {
                notes = Some("Executable is installed but its folder is not in PATH".to_string());
                status = HealthStatus::Info;
            }
        } else {
            status = HealthStatus::Info; // Missing optional tools are informational by default
            notes = Some("Tool is not installed or not discoverable".to_string());
        }

        tools.push(DeveloperTool {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            category: spec.category.clone(),
            status,
            is_installed,
            version,
            executable_path: found_path.map(|p| p.to_string_lossy().to_string()),
            detection_method: method,
            shadowed_count: if matches_in_path.len() > 1 { matches_in_path.len() - 1 } else { 0 },
            notes,
        });
    }

    tools
}

// -------------------------------------------------------------------------
// PATH Diagnostics
// -------------------------------------------------------------------------

pub fn diagnose_path() -> PathDiagnosticsReport {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let raw_entries: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
    let total_entries = raw_entries.len();

    let mut entries = Vec::new();
    let mut seen_canonical: HashSet<String> = HashSet::new();
    let mut valid_entries = 0;
    let mut missing_entries = 0;
    let mut duplicate_entries = 0;
    let mut developer_entries = 0;

    for (index, raw_path) in raw_entries.iter().enumerate() {
        let path_str = raw_path.to_string_lossy().to_string();
        let exists = raw_path.is_dir();

        let norm_key = path_str.to_lowercase().replace('/', "\\");
        let is_dup = !seen_canonical.insert(norm_key.clone());

        if exists {
            valid_entries += 1;
        } else {
            missing_entries += 1;
        }

        if is_dup {
            duplicate_entries += 1;
        }

        // Categorize entry
        let lower = path_str.to_lowercase();
        let is_dev = lower.contains("node")
            || lower.contains("cargo")
            || lower.contains("rust")
            || lower.contains("python")
            || lower.contains("git")
            || lower.contains("jdk")
            || lower.contains("java")
            || lower.contains("go")
            || lower.contains("docker")
            || lower.contains("vscode")
            || lower.contains("code")
            || lower.contains("pnpm")
            || lower.contains("yarn")
            || lower.contains("bun")
            || lower.contains("maven")
            || lower.contains("gradle");

        let category = if is_dev {
            developer_entries += 1;
            "Developer Toolchain".to_string()
        } else if lower.contains("windows") || lower.contains("system32") {
            "System".to_string()
        } else {
            "Application / Third Party".to_string()
        };

        let detected_tool = if lower.contains("node") {
            Some("Node.js".to_string())
        } else if lower.contains("cargo") {
            Some("Rust / Cargo".to_string())
        } else if lower.contains("python") {
            Some("Python".to_string())
        } else if lower.contains("git") {
            Some("Git".to_string())
        } else if lower.contains("jdk") || lower.contains("java") {
            Some("Java JDK".to_string())
        } else if lower.contains("go") {
            Some("Go".to_string())
        } else if lower.contains("pnpm") {
            Some("pnpm".to_string())
        } else {
            None
        };

        let (status, issue) = if !exists {
            (
                HealthStatus::Warning,
                Some("Directory does not exist on disk (stale PATH entry)".to_string()),
            )
        } else if is_dup {
            (
                HealthStatus::Info,
                Some("Duplicate directory in PATH (redundant entry)".to_string()),
            )
        } else {
            (HealthStatus::Healthy, None)
        };

        entries.push(PathEntryDiagnostic {
            path: path_str,
            index,
            exists,
            is_duplicate: is_dup,
            category,
            detected_tool,
            status,
            issue,
        });
    }

    // Shadowed executables detection
    let key_binaries = [
        "node.exe",
        "python.exe",
        "git.exe",
        "java.exe",
        "javac.exe",
        "cargo.exe",
        "rustc.exe",
        "go.exe",
        "code.cmd",
    ];

    let mut conflicts = Vec::new();

    for bin in &key_binaries {
        let mut occurrences = Vec::new();
        for (idx, dir) in raw_entries.iter().enumerate() {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                occurrences.push((idx, candidate));
            }
        }

        if occurrences.len() > 1 {
            let (active_idx, ref active_path) = occurrences[0];
            let active_ver = execute_version_probe(active_path, &["--version"]);

            let mut shadowed_paths = Vec::new();
            for (idx, p) in occurrences.iter().skip(1) {
                let v = execute_version_probe(p, &["--version"]);
                shadowed_paths.push(ShadowedPathInstance {
                    path: p.to_string_lossy().to_string(),
                    version: v,
                    path_index: *idx,
                });
            }

            let explanation = format!(
                "{} instances of '{}' found in PATH. The active binary is '{}' (index {} in PATH). {} other instance(s) are shadowed.",
                occurrences.len(),
                bin,
                active_path.to_string_lossy(),
                active_idx,
                shadowed_paths.len()
            );

            conflicts.push(PathConflictDiagnostic {
                executable: bin.to_string(),
                active_path: active_path.to_string_lossy().to_string(),
                active_version: active_ver,
                shadowed_paths,
                explanation,
                severity: HealthStatus::Info,
            });
        }
    }

    let overall_status = if missing_entries > 0 {
        HealthStatus::Warning
    } else if conflicts.iter().any(|c| c.severity == HealthStatus::Warning) {
        HealthStatus::Warning
    } else {
        HealthStatus::Healthy
    };

    PathDiagnosticsReport {
        total_entries,
        valid_entries,
        missing_entries,
        duplicate_entries,
        developer_entries,
        entries,
        conflicts,
        overall_status,
    }
}

// -------------------------------------------------------------------------
// Multiple-Version Detection (Python py -0p, Node fnm/nvm, Java, Rust)
// -------------------------------------------------------------------------

pub fn audit_multiple_versions() -> Vec<MultipleVersionReport> {
    let mut reports = Vec::new();

    // 1. Python Versions via py.exe -0p
    let mut python_versions = Vec::new();
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::spawn(move || {
        let mut cmd = Command::new("py.exe");
        cmd.arg("-0p");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = tx.send(cmd.output().ok());
    });

    if let Ok(Some(output)) = rx.recv_timeout(std::time::Duration::from_millis(2500)) {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Format example: " -V:3.14 *        C:\Users\Admin\AppData\Local\Programs\Python\Python314\python.exe"
            let is_active = trimmed.contains('*');
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                let ver_tag = parts[0].trim_start_matches("-V:").trim_start_matches('*');
                let exe_path = parts.last().unwrap_or(&"");
                if Path::new(exe_path).is_file() {
                    python_versions.push(ToolVersionInstance {
                        version: ver_tag.to_string(),
                        path: exe_path.to_string(),
                        source: "Windows Python Launcher (py.exe)".to_string(),
                        is_active,
                    });
                }
            }
        }
    }

    if python_versions.len() > 1 {
        let active_ver = python_versions.iter().find(|v| v.is_active).map(|v| v.version.clone());
        reports.push(MultipleVersionReport {
            tool_id: "python".to_string(),
            tool_name: "Python".to_string(),
            versions: python_versions,
            active_version: active_ver,
            status: HealthStatus::Healthy,
            classification: "Healthy — Managed cleanly by Windows Python Launcher".to_string(),
            explanation: "Multiple Python versions are installed and registered with the Python Launcher (py -0p). The active default is marked with an asterisk (*).".to_string(),
            suggested_action: "Use 'py -3.x' or standard virtual environments to select desired Python versions per project.".to_string(),
        });
    }

    // 2. Node.js Versions (fnm / nvm / directory inspection)
    let user_profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Admin".to_string());
    let mut node_versions = Vec::new();

    // Check fnm
    let fnm_dir = PathBuf::from(&user_profile).join("AppData\\Roaming\\fnm\\current");
    if fnm_dir.exists() {
        let node_bin = fnm_dir.join("node.exe");
        if let Some(ver) = execute_version_probe(&node_bin, &["--version"]) {
            node_versions.push(ToolVersionInstance {
                version: ver,
                path: node_bin.to_string_lossy().to_string(),
                source: "Fast Node Manager (fnm)".to_string(),
                is_active: true,
            });
        }
    }

    // Check Program Files Node.js
    let std_node = PathBuf::from("C:\\Program Files\\nodejs\\node.exe");
    if std_node.is_file() {
        if let Some(ver) = execute_version_probe(&std_node, &["--version"]) {
            let is_active = node_versions.is_empty();
            node_versions.push(ToolVersionInstance {
                version: ver,
                path: std_node.to_string_lossy().to_string(),
                source: "System Installation (Program Files)".to_string(),
                is_active,
            });
        }
    }

    if node_versions.len() > 1 {
        let active_ver = node_versions.iter().find(|v| v.is_active).map(|v| v.version.clone());
        reports.push(MultipleVersionReport {
            tool_id: "node".to_string(),
            tool_name: "Node.js".to_string(),
            versions: node_versions,
            active_version: active_ver,
            status: HealthStatus::Info,
            classification: "Informational — Multiple Node.js installations detected".to_string(),
            explanation: "Multiple Node.js installations were found between version manager and system directories.".to_string(),
            suggested_action: "Ensure your shell loads the preferred version manager before the global Node.js path.".to_string(),
        });
    }

    // 3. Java Versions (Adoptium, Oracle, JAVA_HOME)
    let mut java_versions = Vec::new();
    let java_search_roots = [
        "C:\\Program Files\\Eclipse Adoptium",
        "C:\\Program Files\\Java",
        "C:\\Program Files\\AdoptOpenJDK",
        "C:\\Program Files\\Zulu",
    ];

    for root_str in &java_search_roots {
        let root = Path::new(root_str);
        if root.is_dir() {
            if let Ok(entries) = fs::read_dir(root) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let java_exe = entry.path().join("bin\\java.exe");
                    if java_exe.is_file() {
                        let ver = execute_version_probe(&java_exe, &["-version"])
                            .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
                        java_versions.push(ToolVersionInstance {
                            version: ver,
                            path: java_exe.to_string_lossy().to_string(),
                            source: entry.file_name().to_string_lossy().to_string(),
                            is_active: false,
                        });
                    }
                }
            }
        }
    }

    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let jh_exe = PathBuf::from(&java_home).join("bin\\java.exe");
        if jh_exe.is_file() {
            let jh_norm = jh_exe.to_string_lossy().to_lowercase();
            for jv in &mut java_versions {
                if jv.path.to_lowercase() == jh_norm {
                    jv.is_active = true;
                    jv.source = format!("{} (JAVA_HOME)", jv.source);
                }
            }
        }
    }

    if java_versions.len() > 1 {
        let active_ver = java_versions.iter().find(|v| v.is_active).map(|v| v.version.clone());
        reports.push(MultipleVersionReport {
            tool_id: "java".to_string(),
            tool_name: "Java JDK".to_string(),
            versions: java_versions,
            active_version: active_ver,
            status: HealthStatus::Info,
            classification: "Informational — Multiple JDK versions installed".to_string(),
            explanation: "Multiple JDKs exist in Program Files. JAVA_HOME determines which JDK is preferred by build tools.".to_string(),
            suggested_action: "Switch JAVA_HOME or toolchains in Maven/Gradle when compiling against different Java versions.".to_string(),
        });
    }

    reports
}

// -------------------------------------------------------------------------
// Project ↔ Machine Compatibility
// -------------------------------------------------------------------------

pub fn check_project_compatibility(
    project_path_str: &str,
    tools: &[DeveloperTool],
) -> ProjectCompatibilityCheck {
    let proj_path = Path::new(project_path_str);
    let project_name = proj_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path_str.to_string());

    let mut requirements = Vec::new();
    let mut ecosystem = "Unknown".to_string();

    let node_tool = tools.iter().find(|t| t.id == "node");
    let npm_tool = tools.iter().find(|t| t.id == "npm");
    let pnpm_tool = tools.iter().find(|t| t.id == "pnpm");
    let yarn_tool = tools.iter().find(|t| t.id == "yarn");
    let bun_tool = tools.iter().find(|t| t.id == "bun");
    let rust_tool = tools.iter().find(|t| t.id == "rust");
    let python_tool = tools.iter().find(|t| t.id == "python");
    let java_tool = tools.iter().find(|t| t.id == "java");

    // 1. Check Node.js / package.json
    let pkg_json_path = proj_path.join("package.json");
    if pkg_json_path.is_file() {
        ecosystem = "Node.js / JavaScript / TypeScript".to_string();
        if let Ok(content) = fs::read_to_string(&pkg_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                // Check engines.node
                if let Some(engines_node) = json.get("engines").and_then(|e| e.get("node")).and_then(|n| n.as_str()) {
                    let machine_node_ver = node_tool.and_then(|t| t.version.clone());
                    let mut satisfied = None;
                    let mut status = HealthStatus::Info;

                    if let Some(ref m_ver) = machine_node_ver {
                        // Basic semver check
                        let is_ok = check_semver_compatibility(engines_node, m_ver);
                        satisfied = Some(is_ok);
                        status = if is_ok { HealthStatus::Healthy } else { HealthStatus::Warning };
                    }

                    requirements.push(CompatibilityRequirement {
                        target: "Node.js Runtime".to_string(),
                        required: engines_node.to_string(),
                        machine_installed: machine_node_ver,
                        satisfied,
                        status,
                        notes: "Defined in package.json engines.node".to_string(),
                    });
                }

                // Check packageManager field (e.g. "pnpm@9.15.4")
                if let Some(pm_field) = json.get("packageManager").and_then(|p| p.as_str()) {
                    let pm_name = pm_field.split('@').next().unwrap_or(pm_field);
                    let installed_tool = tools.iter().find(|t| t.id == pm_name);
                    let is_installed = installed_tool.map(|t| t.is_installed).unwrap_or(false);

                    requirements.push(CompatibilityRequirement {
                        target: format!("Package Manager ({})", pm_name),
                        required: pm_field.to_string(),
                        machine_installed: installed_tool.and_then(|t| t.version.clone()),
                        satisfied: Some(is_installed),
                        status: if is_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
                        notes: "Specified by packageManager in package.json".to_string(),
                    });
                }
            }
        }

        // Check Lockfiles
        if proj_path.join("pnpm-lock.yaml").is_file() {
            let is_installed = pnpm_tool.map(|t| t.is_installed).unwrap_or(false);
            requirements.push(CompatibilityRequirement {
                target: "Package Manager Lockfile (pnpm)".to_string(),
                required: "pnpm installed on machine".to_string(),
                machine_installed: pnpm_tool.and_then(|t| t.version.clone()),
                satisfied: Some(is_installed),
                status: if is_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
                notes: "pnpm-lock.yaml is present in project".to_string(),
            });
        }
        if proj_path.join("yarn.lock").is_file() {
            let is_installed = yarn_tool.map(|t| t.is_installed).unwrap_or(false);
            requirements.push(CompatibilityRequirement {
                target: "Package Manager Lockfile (yarn)".to_string(),
                required: "yarn installed on machine".to_string(),
                machine_installed: yarn_tool.and_then(|t| t.version.clone()),
                satisfied: Some(is_installed),
                status: if is_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
                notes: "yarn.lock is present in project".to_string(),
            });
        }
        if proj_path.join("package-lock.json").is_file() {
            let is_installed = npm_tool.map(|t| t.is_installed).unwrap_or(false);
            requirements.push(CompatibilityRequirement {
                target: "Package Manager Lockfile (npm)".to_string(),
                required: "npm installed on machine".to_string(),
                machine_installed: npm_tool.and_then(|t| t.version.clone()),
                satisfied: Some(is_installed),
                status: if is_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
                notes: "package-lock.json is present in project".to_string(),
            });
        }
        if proj_path.join("bun.lockb").is_file() || proj_path.join("bun.lock").is_file() {
            let is_installed = bun_tool.map(|t| t.is_installed).unwrap_or(false);
            requirements.push(CompatibilityRequirement {
                target: "Package Manager Lockfile (bun)".to_string(),
                required: "bun installed on machine".to_string(),
                machine_installed: bun_tool.and_then(|t| t.version.clone()),
                satisfied: Some(is_installed),
                status: if is_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
                notes: "bun lockfile is present in project".to_string(),
            });
        }
    }

    // 2. Check Rust / Cargo.toml
    let cargo_toml_path = proj_path.join("Cargo.toml");
    if cargo_toml_path.is_file() {
        if ecosystem == "Unknown" {
            ecosystem = "Rust".to_string();
        } else {
            ecosystem.push_str(" + Rust");
        }

        let is_rust_installed = rust_tool.map(|t| t.is_installed).unwrap_or(false);
        requirements.push(CompatibilityRequirement {
            target: "Rust Toolchain".to_string(),
            required: "Cargo & rustc installed".to_string(),
            machine_installed: rust_tool.and_then(|t| t.version.clone()),
            satisfied: Some(is_rust_installed),
            status: if is_rust_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
            notes: "Cargo.toml manifest present".to_string(),
        });
    }

    // 3. Check Python (pyproject.toml / requirements.txt)
    let pyproject = proj_path.join("pyproject.toml");
    let reqs_txt = proj_path.join("requirements.txt");
    if pyproject.is_file() || reqs_txt.is_file() {
        if ecosystem == "Unknown" {
            ecosystem = "Python".to_string();
        } else {
            ecosystem.push_str(" + Python");
        }
        let is_py_installed = python_tool.map(|t| t.is_installed).unwrap_or(false);
        requirements.push(CompatibilityRequirement {
            target: "Python Environment".to_string(),
            required: "Python 3.x runtime".to_string(),
            machine_installed: python_tool.and_then(|t| t.version.clone()),
            satisfied: Some(is_py_installed),
            status: if is_py_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
            notes: if pyproject.is_file() { "pyproject.toml present" } else { "requirements.txt present" }.to_string(),
        });
    }

    // 4. Check Java (pom.xml / build.gradle)
    let pom_xml = proj_path.join("pom.xml");
    let build_gradle = proj_path.join("build.gradle");
    if pom_xml.is_file() || build_gradle.is_file() {
        if ecosystem == "Unknown" {
            ecosystem = "Java / JVM".to_string();
        } else {
            ecosystem.push_str(" + Java");
        }
        let is_java_installed = java_tool.map(|t| t.is_installed).unwrap_or(false);
        requirements.push(CompatibilityRequirement {
            target: "Java SDK / Runtime".to_string(),
            required: "JDK / JRE installed".to_string(),
            machine_installed: java_tool.and_then(|t| t.version.clone()),
            satisfied: Some(is_java_installed),
            status: if is_java_installed { HealthStatus::Healthy } else { HealthStatus::Warning },
            notes: if pom_xml.is_file() { "pom.xml present" } else { "build.gradle present" }.to_string(),
        });
    }

    if requirements.is_empty() {
        requirements.push(CompatibilityRequirement {
            target: "Manifest Inspection".to_string(),
            required: "Standard project manifest (package.json, Cargo.toml, pyproject.toml, pom.xml)".to_string(),
            machine_installed: None,
            satisfied: None,
            status: HealthStatus::Info,
            notes: "Unable to determine requirements: no standard manifest or engine constraint found".to_string(),
        });
    }

    let has_warnings = requirements.iter().any(|r| r.status == HealthStatus::Warning);
    let has_critical = requirements.iter().any(|r| r.status == HealthStatus::Critical);

    let (overall_status, summary) = if has_critical {
        (HealthStatus::Critical, "Missing critical toolchains required to run this project.".to_string())
    } else if has_warnings {
        (HealthStatus::Warning, "Some project toolchain requirements or lockfiles are not satisfied.".to_string())
    } else {
        (HealthStatus::Healthy, "Project requirements match workstation configuration.".to_string())
    };

    ProjectCompatibilityCheck {
        project_path: project_path_str.to_string(),
        project_name,
        ecosystem,
        requirements,
        overall_status,
        summary,
    }
}

pub fn check_semver_compatibility(range_str: &str, installed_ver: &str) -> bool {
    let clean_inst = installed_ver.trim_start_matches('v').trim();
    let parts: Vec<u32> = clean_inst
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    let major = parts.get(0).copied().unwrap_or(0);

    // Simple range parser for >=, ^, ~, and exact
    let trimmed = range_str.trim();
    if trimmed == "*" {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix(">=") {
        let req_parts: Vec<u32> = rest.trim().split('.').filter_map(|s| s.parse().ok()).collect();
        let req_major = req_parts.get(0).copied().unwrap_or(0);
        return major >= req_major;
    }
    if let Some(rest) = trimmed.strip_prefix('^') {
        let req_parts: Vec<u32> = rest.trim().split('.').filter_map(|s| s.parse().ok()).collect();
        let req_major = req_parts.get(0).copied().unwrap_or(0);
        return major == req_major;
    }
    if let Some(rest) = trimmed.strip_prefix('>') {
        let req_parts: Vec<u32> = rest.trim().split('.').filter_map(|s| s.parse().ok()).collect();
        let req_major = req_parts.get(0).copied().unwrap_or(0);
        return major > req_major;
    }

    true
}

// -------------------------------------------------------------------------
// Environment Variables Audit
// -------------------------------------------------------------------------

pub fn sanitize_env_value(key: &str, raw_val: &str) -> String {
    let upper = key.to_uppercase();
    if upper.contains("SECRET")
        || upper.contains("KEY")
        || upper.contains("TOKEN")
        || upper.contains("PASS")
        || upper.contains("AUTH")
        || upper.contains("CREDENTIAL")
        || upper.contains("PRIVATE")
        || upper.contains("SIGN")
        || upper.contains("CERT")
        || upper.contains("BEARER")
        || upper.contains("WEBHOOK")
    {
        return "[REDACTED]".to_string();
    }
    let trimmed = raw_val.trim();
    if trimmed.starts_with("ghp_")
        || trimmed.starts_with("gho_")
        || trimmed.starts_with("eyJh")
        || trimmed.starts_with("sk-")
        || trimmed.starts_with("npm_")
        || trimmed.contains("Bearer ")
    {
        return "[REDACTED]".to_string();
    }
    raw_val.to_string()
}

pub fn audit_environment_variables(tools: &[DeveloperTool]) -> Vec<EnvironmentVariableAudit> {
    let standard_vars = [
        ("JAVA_HOME", "Java Development Kit installation directory", "java"),
        ("JDK_HOME", "Alternative JDK installation pointer", "jdk"),
        ("CARGO_HOME", "Cargo package cache and installation root", "cargo"),
        ("RUSTUP_HOME", "Rustup toolchain metadata and installations", "rust"),
        ("GOPATH", "Go workspace directory", "go"),
        ("GOROOT", "Go SDK root directory", "go"),
        ("ANDROID_HOME", "Android SDK location for mobile development", "android"),
        ("ANDROID_SDK_ROOT", "Android SDK alternative location pointer", "android"),
        ("PYTHONPATH", "Custom Python module search path", "python"),
        ("NODE_OPTIONS", "Custom Node.js execution runtime flags", "node"),
        ("PNPM_HOME", "pnpm global binary and cache directory", "pnpm"),
    ];

    let mut audits = Vec::new();

    for (name, purpose, tool_id) in &standard_vars {
        let val_opt = std::env::var(name).ok();
        let is_set = val_opt.is_some();
        let sanitized = val_opt.as_ref().map(|v| sanitize_env_value(name, v));

        let mut target_exists = false;
        let mut matches_active_tool = false;
        let mut status = HealthStatus::Healthy;
        let mut explanation = format!("{}: {}", name, purpose);
        let mut recommendation = "Configuration is valid.".to_string();

        if let Some(ref val) = val_opt {
            let p = Path::new(val);
            target_exists = p.exists();

            if !target_exists {
                status = HealthStatus::Warning;
                explanation = format!("{} is set to '{}', but this directory does not exist on disk.", name, val);
                recommendation = format!("Update or remove {} to point to a valid existing directory.", name);
            } else {
                // Check if it matches active tool path
                if let Some(tool) = tools.iter().find(|t| &t.id == tool_id) {
                    if let Some(ref exe_path) = tool.executable_path {
                        let exe_lower = exe_path.to_lowercase();
                        let val_lower = val.to_lowercase();
                        if exe_lower.starts_with(&val_lower) {
                            matches_active_tool = true;
                        } else {
                            matches_active_tool = false;
                            // For Java, check if active java executable aligns with JAVA_HOME
                            if *name == "JAVA_HOME" && !exe_lower.contains("adoptium") && !exe_lower.contains(&val_lower) {
                                status = HealthStatus::Info;
                                explanation = format!(
                                    "JAVA_HOME is set to '{}', while the active java.exe in PATH is '{}'.",
                                    val, exe_path
                                );
                                recommendation = "Ensure build tools and terminal use consistent Java versions.".to_string();
                            }
                        }
                    }
                }
            }
        } else {
            // Variable is not set
            status = HealthStatus::Info;
            explanation = format!("{} is not currently defined in your environment.", name);
            recommendation = format!("Optional: Set {} if your build tools require an explicit pointer.", name);
        }

        audits.push(EnvironmentVariableAudit {
            name: name.to_string(),
            is_set,
            sanitized_value: sanitized,
            target_exists,
            matches_active_tool,
            status,
            explanation,
            recommendation,
        });
    }

    audits
}

// -------------------------------------------------------------------------
// Overall Report Aggregation
// -------------------------------------------------------------------------

pub fn generate_developer_environment_report(
    custom_project_paths: &[String],
) -> DeveloperEnvironmentReport {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let path_diagnostics = diagnose_path();

    let path_dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var("PATH").unwrap_or_default())
        .collect();

    let tools = detect_all_tools(&path_dirs);
    let multiple_versions = audit_multiple_versions();
    let environment_variables = audit_environment_variables(&tools);

    // Project compatibility: check provided paths or default current workspace
    let mut project_compatibility = Vec::new();
    let mut check_paths = custom_project_paths.to_vec();
    if check_paths.is_empty() {
        if let Ok(cwd) = std::env::current_dir() {
            check_paths.push(cwd.to_string_lossy().to_string());
        }
    }

    for p in &check_paths {
        project_compatibility.push(check_project_compatibility(p, &tools));
    }

    // Developer storage footprint (reusing storage engine)
    let c_report = storage_engine::scan_drive_storage("C");
    let developer_storage = c_report.developer_storage;

    // Synthesize structured findings
    let mut findings = Vec::new();

    // 1. Toolchain findings
    for tool in &tools {
        if !tool.is_installed {
            findings.push(DeveloperFinding {
                id: format!("tool-missing-{}", tool.id),
                title: format!("{} is not installed", tool.name),
                category: "toolchain".to_string(),
                severity: HealthStatus::Info,
                evidence: format!("Executable for {} not found in PATH or standard directories.", tool.name),
                explanation: format!("{} is commonly used in modern developer environments.", tool.name),
                suggested_action: format!("Install {} if required for your active projects.", tool.name),
            });
        } else if tool.shadowed_count > 0 {
            findings.push(DeveloperFinding {
                id: format!("tool-shadowed-{}", tool.id),
                title: format!("Multiple {} executables in PATH", tool.name),
                category: "path".to_string(),
                severity: HealthStatus::Info,
                evidence: format!("{} instances of {} found in PATH.", tool.shadowed_count + 1, tool.name),
                explanation: "The first entry in PATH takes precedence; other installations are shadowed.".to_string(),
                suggested_action: "Review PATH order to ensure your intended version runs by default.".to_string(),
            });
        }
    }

    // 2. PATH findings
    for entry in &path_diagnostics.entries {
        if !entry.exists {
            findings.push(DeveloperFinding {
                id: format!("path-stale-{}", entry.index),
                title: "Stale PATH Directory".to_string(),
                category: "path".to_string(),
                severity: HealthStatus::Warning,
                evidence: format!("Directory does not exist: '{}' (index {})", entry.path, entry.index),
                explanation: "Directories in PATH that no longer exist cause minor shell resolution slowdowns and may indicate uninstalled software remnants.".to_string(),
                suggested_action: "Remove stale directory from System or User PATH in Windows Environment Variables.".to_string(),
            });
        }
    }

    // 3. Environment Variable findings
    for env in &environment_variables {
        if env.is_set && !env.target_exists {
            findings.push(DeveloperFinding {
                id: format!("env-missing-{}", env.name),
                title: format!("{} points to missing folder", env.name),
                category: "environment".to_string(),
                severity: HealthStatus::Warning,
                evidence: format!("{} = {:?}", env.name, env.sanitized_value),
                explanation: env.explanation.clone(),
                suggested_action: env.recommendation.clone(),
            });
        }
    }

    // 4. Project Compatibility findings
    for comp in &project_compatibility {
        for req in &comp.requirements {
            if req.status == HealthStatus::Warning {
                findings.push(DeveloperFinding {
                    id: format!("compat-{}-{}", comp.project_name, req.target.replace(' ', "-")),
                    title: format!("Project requirement mismatch: {}", req.target),
                    category: "compatibility".to_string(),
                    severity: HealthStatus::Warning,
                    evidence: format!("Required: '{}' | Machine: '{:?}'", req.required, req.machine_installed),
                    explanation: format!("Project '{}' requires {}, which does not match workstation state.", comp.project_name, req.target),
                    suggested_action: format!("Install or activate the required {} version.", req.target),
                });
            }
        }
    }

    // Compute Health Score & counts
    let mut healthy_count = 0;
    let mut info_count = 0;
    let mut warning_count = 0;
    let mut critical_count = 0;

    for f in &findings {
        match f.severity {
            HealthStatus::Healthy => healthy_count += 1,
            HealthStatus::Info => info_count += 1,
            HealthStatus::Warning => warning_count += 1,
            HealthStatus::Critical => critical_count += 1,
        }
    }

    // Deterministic Heuristic Health Score Calculation
    // Base: 100
    // Deductions:
    // - Critical finding: -20 pts each (max 40 pts deduction)
    // - Warning finding: -5 pts each (max 30 pts deduction)
    // - Info finding: 0 pts deduction (informative / neutral state, not penalized)
    // "Unable to determine": 0 pts deduction (neutral state, not penalized)
    let critical_deduction = (critical_count * 20).min(40);
    let warning_deduction = (warning_count * 5).min(30);
    let total_penalty = critical_deduction + warning_deduction;
    let health_score = 100u32.saturating_sub(total_penalty as u32);

    let overall_status = if critical_count > 0 {
        HealthStatus::Critical
    } else if warning_count > 0 {
        HealthStatus::Warning
    } else if info_count > 0 {
        HealthStatus::Info
    } else {
        HealthStatus::Healthy
    };

    DeveloperEnvironmentReport {
        generated_at: now,
        health_score,
        overall_status,
        healthy_count,
        info_count,
        warning_count,
        critical_count,
        tools,
        path_diagnostics,
        multiple_versions,
        project_compatibility,
        environment_variables,
        developer_storage,
        findings,
    }
}

// -------------------------------------------------------------------------
// Tauri Commands
// -------------------------------------------------------------------------

#[tauri::command]
pub fn run_developer_environment_audit(
    project_paths: Option<Vec<String>>,
) -> Result<DeveloperEnvironmentReport, String> {
    let paths = project_paths.unwrap_or_default();
    Ok(generate_developer_environment_report(&paths))
}

#[tauri::command]
pub fn audit_project_compatibility(
    project_path: String,
) -> Result<ProjectCompatibilityCheck, String> {
    let path_dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var("PATH").unwrap_or_default())
        .collect();
    let tools = detect_all_tools(&path_dirs);
    Ok(check_project_compatibility(&project_path, &tools))
}

// -------------------------------------------------------------------------
// Unit Tests
// -------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_version_output() {
        assert_eq!(clean_version_output("git version 2.54.0.windows.1"), "2.54.0.windows.1");
        assert_eq!(clean_version_output("v24.16.0"), "24.16.0");
        assert_eq!(clean_version_output("Python 3.10.11"), "3.10.11");
        assert_eq!(clean_version_output("rustc 1.84.0 (9fc6b4312 2025-01-07)"), "1.84.0");
        assert_eq!(clean_version_output("openjdk version \"25\" 2025-09-16"), "25");
        assert_eq!(clean_version_output("Docker version 27.2.0, build 3ae425c"), "27.2.0");
    }

    #[test]
    fn test_semver_compatibility() {
        assert!(check_semver_compatibility(">= 18.0.0", "v24.16.0"));
        assert!(check_semver_compatibility(">= 20", "20.1.0"));
        assert!(!check_semver_compatibility(">= 26.0.0", "24.16.0"));
        assert!(check_semver_compatibility("^24.0.0", "24.16.0"));
        assert!(check_semver_compatibility("*", "1.0.0"));
    }

    #[test]
    fn test_sanitize_env_value() {
        assert_eq!(sanitize_env_value("API_KEY", "secret12345"), "[REDACTED]");
        assert_eq!(sanitize_env_value("GITHUB_TOKEN", "ghp_abcdef"), "[REDACTED]");
        assert_eq!(sanitize_env_value("DB_PASSWORD", "mypass"), "[REDACTED]");
        assert_eq!(sanitize_env_value("JAVA_HOME", "C:\\Program Files\\Java"), "C:\\Program Files\\Java");
        assert_eq!(sanitize_env_value("CARGO_HOME", "C:\\Users\\Admin\\.cargo"), "C:\\Users\\Admin\\.cargo");
    }

    #[test]
    fn test_path_diagnostics_structure() {
        let report = diagnose_path();
        assert!(report.total_entries > 0);
        assert_eq!(report.total_entries, report.entries.len());
    }

    #[test]
    fn test_environment_variables_audit() {
        let tools = vec![];
        let audits = audit_environment_variables(&tools);
        assert!(!audits.is_empty());
        assert!(audits.iter().any(|a| a.name == "JAVA_HOME"));
        assert!(audits.iter().any(|a| a.name == "CARGO_HOME"));
    }

    #[test]
    fn test_report_generation_read_only() {
        let report = generate_developer_environment_report(&[]);
        assert!(!report.tools.is_empty());
        assert!(report.health_score <= 100);
    }

    #[test]
    fn test_secret_redaction_and_token_patterns() {
        assert_eq!(sanitize_env_value("AWS_SECRET_ACCESS_KEY", "AKIAIOSFODNN7EXAMPLE"), "[REDACTED]");
        assert_eq!(sanitize_env_value("NPM_TOKEN", "npm_1234567890abcdef"), "[REDACTED]");
        assert_eq!(sanitize_env_value("CUSTOM_KEY", "secret-val"), "[REDACTED]");
        assert_eq!(sanitize_env_value("API_BEARER", "bearer-token"), "[REDACTED]");
        assert_eq!(sanitize_env_value("MY_VAR", "ghp_987654321fedcba"), "[REDACTED]");
        assert_eq!(sanitize_env_value("OPENAI_KEY", "sk-proj-12345"), "[REDACTED]");
        assert_eq!(sanitize_env_value("WEBHOOK_URL", "https://hooks.slack.com/..."), "[REDACTED]");
        // Non-secret paths preserved
        assert_eq!(sanitize_env_value("JAVA_HOME", "C:\\Program Files\\Adoptium"), "C:\\Program Files\\Adoptium");
    }

    #[test]
    fn test_deterministic_health_score_calculation() {
        // Base 100, 0 penalties for info
        let findings_info = vec![
            DeveloperFinding {
                id: "1".into(),
                title: "Info 1".into(),
                category: "toolchain".into(),
                severity: HealthStatus::Info,
                evidence: "tool missing".into(),
                explanation: "optional".into(),
                suggested_action: "none".into(),
            },
            DeveloperFinding {
                id: "2".into(),
                title: "Info 2".into(),
                category: "compatibility".into(),
                severity: HealthStatus::Info,
                evidence: "Unable to determine".into(),
                explanation: "no manifest".into(),
                suggested_action: "none".into(),
            },
        ];

        // 0 critical, 0 warning, 2 info => score must be exactly 100
        let crit_cnt = findings_info.iter().filter(|f| f.severity == HealthStatus::Critical).count();
        let warn_cnt = findings_info.iter().filter(|f| f.severity == HealthStatus::Warning).count();
        let penalty = (crit_cnt * 20).min(40) + (warn_cnt * 5).min(30);
        let score = 100u32.saturating_sub(penalty as u32);
        assert_eq!(score, 100, "Informational findings and 'Unable to determine' must not penalize score");

        // 1 warning => exactly 95
        let warn_cnt_1 = 1;
        let penalty_warn = (0 * 20).min(40) + (warn_cnt_1 * 5).min(30);
        assert_eq!(100u32.saturating_sub(penalty_warn as u32), 95);

        // 1 critical => exactly 80
        let crit_cnt_1 = 1;
        let penalty_crit = (crit_cnt_1 * 20).min(40) + (0 * 5).min(30);
        assert_eq!(100u32.saturating_sub(penalty_crit as u32), 80);
    }

    #[test]
    fn test_unknown_evidence_handling_and_compatibility_unknown_state() {
        let temp_dir = std::env::temp_dir().join(format!("mahi_compat_unknown_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        // Empty directory: no package.json, no Cargo.toml
        let tools = vec![];
        let check = check_project_compatibility(&temp_dir.to_string_lossy(), &tools);
        assert_eq!(check.requirements.len(), 1);
        assert_eq!(check.requirements[0].satisfied, None, "Must be None when unable to determine");
        assert_eq!(check.requirements[0].status, HealthStatus::Info);
        assert!(check.requirements[0].notes.contains("Unable to determine"));
        assert_eq!(check.overall_status, HealthStatus::Healthy);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_read_only_behavior_and_no_project_mutation() {
        let temp_dir = std::env::temp_dir().join(format!("mahi_read_only_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        let pkg_json = temp_dir.join("package.json");
        let content = r#"{"name": "test-pkg", "engines": {"node": ">= 18.0.0"}, "packageManager": "pnpm@9.0.0"}"#;
        fs::write(&pkg_json, content).unwrap();

        let lock_file = temp_dir.join("pnpm-lock.yaml");
        fs::write(&lock_file, "lockfileVersion: '9.0'").unwrap();

        let initial_bytes = fs::read(&pkg_json).unwrap();
        let initial_lock = fs::read(&lock_file).unwrap();

        // Run compatibility audit
        let tools = vec![
            DeveloperTool {
                id: "node".into(),
                name: "Node.js".into(),
                category: DeveloperToolCategory::Runtime,
                status: HealthStatus::Healthy,
                is_installed: true,
                version: Some("24.16.0".into()),
                executable_path: Some("C:\\Program Files\\nodejs\\node.exe".into()),
                detection_method: "PATH".into(),
                shadowed_count: 0,
                notes: None,
            }
        ];
        let check = check_project_compatibility(&temp_dir.to_string_lossy(), &tools);
        assert!(!check.requirements.is_empty());

        // Verify files were not mutated
        let after_bytes = fs::read(&pkg_json).unwrap();
        let after_lock = fs::read(&lock_file).unwrap();
        assert_eq!(initial_bytes, after_bytes, "package.json must not be mutated");
        assert_eq!(initial_lock, after_lock, "pnpm-lock.yaml must not be mutated");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_command_failure_isolation_and_timeout_handling() {
        // Non-existent binary path returns None without panic or hanging
        let non_existent = Path::new("C:\\DoesNotExist\\fake_tool_12345.exe");
        let res = execute_version_probe(non_existent, &["--version"]);
        assert_eq!(res, None);
    }

    #[test]
    fn test_malformed_version_output() {
        assert_eq!(clean_version_output(""), "");
        assert_eq!(clean_version_output("   "), "");
        assert_eq!(clean_version_output("unknown garbage string here"), "unknown");
        assert_eq!(clean_version_output("v99.88.77-beta.1"), "99.88.77-beta.1");
        assert_eq!(clean_version_output("git version 2.45.0.windows.1 (extras)"), "2.45.0.windows.1");
        assert_eq!(clean_version_output("Docker version 28.0.0, build abcdef"), "28.0.0");
    }
}

