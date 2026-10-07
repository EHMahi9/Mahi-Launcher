// Phase 9C-B: Read-only Toolchain Resolution Engine
//
// Discovers all installed developer toolchains, determines which one is
// currently active, extracts project requirements from manifests, and
// matches requirements to installations with an explicit resolution result.
//
// SAFETY CONTRACT:
//   - This module is STRICTLY read-only.
//   - No registry writes.
//   - No PATH mutations.
//   - No environment variable mutations.
//   - No process spawning beyond version probing (bounded 2.5 s timeout).
//   - No .env / secrets / credentials files are read.
//   - No automatic remediation or workspace profile injection is performed.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// Re-use safe probing helpers from health_audit — do NOT duplicate them.
use crate::health_audit::{execute_version_probe, find_in_standard_paths};

// =========================================================================
// Public enums
// =========================================================================

/// How the executable path was discovered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DetectionSource {
    /// Found in a directory listed in the system or user PATH.
    SystemPath,
    /// Found via an environment variable hint (JAVA_HOME, CARGO_HOME, etc.)
    EnvironmentVariable,
    /// Found in a well-known installation directory (Program Files, AppData, …)
    StandardDirectory,
    /// Found because a version manager (fnm, nvm, pyenv, …) placed it on PATH.
    VersionManager,
    /// Found in a project-local virtual environment (.venv, venv, env).
    ProjectLocalEnv,
}

/// The resolved status of a single tool relative to a project requirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolutionStatus {
    /// Active installation satisfies the requirement (single candidate).
    Active,
    /// Active installation does not satisfy (or is absent), but compatible candidate(s) exist.
    Compatible,
    /// Installed but NO installation satisfies the declared version requirement.
    Mismatch,
    /// No installation found at all on the machine.
    Missing,
    /// Cannot determine compatibility (no requirement declared or undecidable).
    Unknown,
    /// Active installation satisfies requirement AND other compatible/installed candidates exist.
    MultipleInstallations,
}

/// Strength of the evidence behind a `ProjectRequirement`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceType {
    /// Explicitly declared in project toolchain config (rust-toolchain.toml, .tool-versions, .nvmrc, etc.)
    ExplicitProjectToolchain,
    /// Explicitly declared compatibility range (Cargo.toml rust-version, pyproject.toml requires-python)
    DeclaredCompatibility,
    /// Advisory hint only — not universally enforced (npm package.json engines field)
    Advisory,
    /// Inferred heuristically (presence of pnpm-lock.yaml implies pnpm preferred)
    Heuristic,
    /// Source unknown or unparseable
    Unknown,
}

// =========================================================================
// Core Domain Structs
// =========================================================================

/// One concrete installation of a developer tool found on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInstallation {
    /// Stable unique ID: "{tool_id}::{canonical_path}" — survives re-ordering.
    pub id: String,
    /// Tool identifier, e.g. "node", "python", "java", "cargo".
    pub tool: String,
    /// Cleaned version string (e.g. "20.11.0"). None if probe failed.
    pub version: Option<String>,
    /// Absolute, canonical path to the executable.
    pub executable_path: String,
    /// How this installation was discovered.
    pub detection_source: DetectionSource,
    /// Index in PATH if discovered via PATH (0-based). None otherwise.
    pub path_index: Option<usize>,
    /// True if this is the first/active executable that would be used in a
    /// plain shell invocation.
    pub is_active: bool,
    /// True if the executable file exists and responded to a version probe.
    pub is_verified: bool,
    /// How verification was attempted.
    pub verification_method: String,
    /// Human-readable discovery evidence for UI display.
    pub evidence: String,
}

/// A toolchain requirement extracted from a project manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRequirement {
    /// Tool identifier (same namespace as ToolInstallation::tool).
    pub tool: String,
    /// Human-readable version constraint as written in the manifest.
    /// Examples: ">=20 <22", "^20.10.0", "~3.11", ">=3.10,<3.13", "1.70", "21".
    pub version_constraint: Option<String>,
    /// Parsed lower bound for numeric comparison. None if unparseable.
    pub min_version: Option<[u32; 3]>,
    /// Source file that declared this requirement.
    pub source_file: String,
    /// Raw excerpt from the source file for UI display.
    pub raw_evidence: String,
    /// Strength of the evidence.
    pub evidence_type: EvidenceType,
    /// For advisory requirements, a human-readable note.
    pub advisory_note: Option<String>,
    /// For Java build-system requirements, distinguishes runtime from build-jdk.
    /// "RUNTIME" | "BUILD_JDK" | None
    pub java_context: Option<String>,
}

/// Resolution result for one tool relative to one project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResolutionResult {
    pub tool: String,
    pub status: ResolutionStatus,
    pub active_installation: Option<ToolInstallation>,
    pub compatible_installations: Vec<ToolInstallation>,
    pub all_installations: Vec<ToolInstallation>,
    pub requirement: Option<ProjectRequirement>,
    pub explanation: ResolutionExplanation,
}

/// Human-readable explanation produced by `explain_resolution`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionExplanation {
    pub headline: String,
    pub detail: String,
    pub suggestion: Option<String>,
    pub is_advisory_only: bool,
}

/// Full toolchain resolution report for one project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToolchainReport {
    pub project_path: String,
    pub generated_at: u64,
    pub results: Vec<ToolResolutionResult>,
    pub requirements_found: usize,
    pub missing_count: usize,
    pub mismatch_count: usize,
    pub compatible_count: usize,
}

// =========================================================================
// Internal helper types
// =========================================================================

struct ToolSpec<'a> {
    id: &'a str,
    binary_names: &'a [&'a str],
    version_args: &'a [&'a str],
    standard_rel_paths: &'a [&'a str],
    env_hint: Option<&'a str>,
    env_hint_takes_precedence: bool,
}

// =========================================================================
// Tool spec table (15 supported toolchains for 9C-B)
// =========================================================================

fn toolchain_specs() -> Vec<ToolSpec<'static>> {
    vec![
        ToolSpec {
            id: "node",
            binary_names: &["node.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "nodejs\\node.exe",
                "fnm\\current\\node.exe",
                "Programs\\fnm\\node.exe",
            ],
            env_hint: Some("NODE_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "npm",
            binary_names: &["npm.cmd", "npm.exe"],
            version_args: &["--version"],
            standard_rel_paths: &["nodejs\\npm.cmd"],
            env_hint: None,
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "pnpm",
            binary_names: &["pnpm.cmd", "pnpm.exe"],
            version_args: &["--version"],
            standard_rel_paths: &["pnpm\\pnpm.cmd", "nodejs\\pnpm.cmd"],
            env_hint: Some("PNPM_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "yarn",
            binary_names: &["yarn.cmd", "yarn.exe"],
            version_args: &["--version"],
            standard_rel_paths: &["Yarn\\bin\\yarn.cmd", "nodejs\\yarn.cmd"],
            env_hint: None,
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "bun",
            binary_names: &["bun.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[".bun\\bin\\bun.exe", "bun\\bin\\bun.exe"],
            env_hint: Some("BUN_INSTALL"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "python",
            binary_names: &["python.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Programs\\Python\\Python314\\python.exe",
                "Programs\\Python\\Python313\\python.exe",
                "Programs\\Python\\Python312\\python.exe",
                "Programs\\Python\\Python311\\python.exe",
                "Programs\\Python\\Python310\\python.exe",
                "Python310\\python.exe",
            ],
            env_hint: Some("PYTHON_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "pip",
            binary_names: &["pip.exe", "pip3.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[
                "Programs\\Python\\Python314\\Scripts\\pip.exe",
                "Programs\\Python\\Python310\\Scripts\\pip.exe",
                "Python310\\Scripts\\pip.exe",
            ],
            env_hint: None,
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "java",
            binary_names: &["java.exe"],
            version_args: &["-version"],
            standard_rel_paths: &[
                "Eclipse Adoptium\\jdk-25\\bin\\java.exe",
                "Eclipse Adoptium\\jdk-21\\bin\\java.exe",
                "Eclipse Adoptium\\jdk-17\\bin\\java.exe",
                "Java\\jdk-21\\bin\\java.exe",
                "Java\\jdk-17\\bin\\java.exe",
            ],
            env_hint: Some("JAVA_HOME"),
            env_hint_takes_precedence: true,
        },
        ToolSpec {
            id: "javac",
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
            env_hint_takes_precedence: true,
        },
        ToolSpec {
            id: "maven",
            binary_names: &["mvn.cmd", "mvn.bat", "mvn.exe"],
            version_args: &["--version"],
            standard_rel_paths: &["apache-maven\\bin\\mvn.cmd", "Maven\\bin\\mvn.cmd"],
            env_hint: Some("MAVEN_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "gradle",
            binary_names: &["gradle.bat", "gradle.exe"],
            version_args: &["--version"],
            standard_rel_paths: &["gradle\\bin\\gradle.bat"],
            env_hint: Some("GRADLE_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "rust",
            binary_names: &["rustc.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[".cargo\\bin\\rustc.exe"],
            env_hint: Some("CARGO_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "cargo",
            binary_names: &["cargo.exe"],
            version_args: &["--version"],
            standard_rel_paths: &[".cargo\\bin\\cargo.exe"],
            env_hint: Some("CARGO_HOME"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "go",
            binary_names: &["go.exe"],
            version_args: &["version"],
            standard_rel_paths: &["Go\\bin\\go.exe"],
            env_hint: Some("GOROOT"),
            env_hint_takes_precedence: false,
        },
        ToolSpec {
            id: "git",
            binary_names: &["git.exe", "git.cmd"],
            version_args: &["--version"],
            standard_rel_paths: &["Git\\cmd\\git.exe", "Git\\bin\\git.exe"],
            env_hint: None,
            env_hint_takes_precedence: false,
        },
    ]
}

// =========================================================================
// Advanced SemVer & Ecosystem Version Matching Engine
// =========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SemVer {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl SemVer {
    pub fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self { major, minor, patch }
    }

    pub fn to_array(&self) -> [u32; 3] {
        [self.major, self.minor, self.patch]
    }
}

/// Parse a raw version string into a canonical SemVer.
pub fn parse_semver(s: &str) -> Option<SemVer> {
    let s = s.trim();
    let s = s.strip_prefix('v').unwrap_or(s);
    let s = s.strip_prefix("node ").unwrap_or(s);
    let s = s.strip_prefix("Python ").unwrap_or(s);
    let s = s.strip_prefix("rustc ").unwrap_or(s);
    let s = s.strip_prefix("cargo ").unwrap_or(s);
    let s = s.strip_prefix("go version go").unwrap_or(s);
    let s = s.strip_prefix("openjdk version ").unwrap_or(s);
    let s = s.strip_prefix("java version ").unwrap_or(s);
    let s = s.strip_prefix("javac ").unwrap_or(s);
    let s = s.strip_prefix("Apache Maven ").unwrap_or(s);
    let s = s.strip_prefix("Gradle ").unwrap_or(s);

    let token = s.split_whitespace().next().unwrap_or(s);
    let token = token.trim_matches(|c: char| c == '"' || c == '\'' || c == ',' || c == ';').trim();

    // Java legacy version: 1.8 or 1.8.0_xxx -> major 8
    if token == "1.8" || token.starts_with("1.8.") || token.starts_with("1.8_") {
        let parts: Vec<&str> = token.split(|c: char| c == '.' || c == '_').collect();
        let patch = parts.get(2).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        return Some(SemVer::new(8, 0, patch));
    }

    // Java 1.7 legacy
    if token == "1.7" || token.starts_with("1.7.") || token.starts_with("1.7_") {
        return Some(SemVer::new(7, 0, 0));
    }

    // Extract leading numbers and dots
    let numeric: String = token
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let parts: Vec<&str> = numeric.split('.').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let major = parts[0].parse::<u32>().ok()?;
    let minor = parts.get(1).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
    let patch = parts.get(2).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
    Some(SemVer::new(major, minor, patch))
}

/// Backward-compatible tuple parser.
pub fn parse_version(s: &str) -> Option<[u32; 3]> {
    parse_semver(s).map(|v| v.to_array())
}

/// Compare two semver triples. Returns true if `installed >= required`.
#[allow(dead_code)]
pub fn version_satisfies_min(installed: [u32; 3], required: [u32; 3]) -> bool {
    let inst = SemVer::new(installed[0], installed[1], installed[2]);
    let req = SemVer::new(required[0], required[1], required[2]);
    inst >= req
}

/// Tokenize and evaluate compound version constraints across Node, Python, Rust, Go, Java.
/// Supports:
/// - Range/multi-comparator: `>=20 <22`, `>=3.10,<3.13`, `>=3.10 <3.13`
/// - Caret: `^20.10.0`
/// - Tilde: `~20.10.0`
/// - Python compatible release: `~=3.11`, `~=3.11.2`
/// - Wildcards: `20.x`, `20.*`, `3.11.x`, `3.11.*`
/// - Bounded: `<22`, `<=3.12`, `>1.70`, `>=1.70`
/// - Exact / Major: `=20.10.0`, `20.10.0`, `17`, `21`
pub fn eval_constraint(constraint_str: &str, version_str: &str, tool_id: &str) -> bool {
    let ver = match parse_semver(version_str) {
        Some(v) => v,
        None => return false,
    };

    let raw = constraint_str.trim();
    if raw.is_empty() {
        return true;
    }

    // Tokenize clauses separated by comma or whitespace (while keeping operators attached)
    let clauses = tokenize_constraints(raw);
    if clauses.is_empty() {
        return true;
    }

    for clause in &clauses {
        if !eval_single_clause(clause, ver, tool_id) {
            return false;
        }
    }
    true
}

fn tokenize_constraints(raw: &str) -> Vec<String> {
    let normalized = raw.replace(',', " ");
    let parts: Vec<&str> = normalized.split_whitespace().collect();
    let mut tokens = Vec::new();

    let mut i = 0;
    while i < parts.len() {
        let p = parts[i];
        if (p == ">=" || p == "<=" || p == "!=" || p == "==" || p == "=" || p == ">" || p == "<" || p == "^" || p == "~" || p == "~=")
            && i + 1 < parts.len()
        {
            tokens.push(format!("{}{}", p, parts[i + 1]));
            i += 2;
        } else {
            tokens.push(p.to_string());
            i += 1;
        }
    }
    tokens
}

fn eval_single_clause(clause: &str, ver: SemVer, tool_id: &str) -> bool {
    let c = clause.trim();

    // 1. Wildcard: 20.x, 20.*, 3.11.x, 3.11.*
    if c.ends_with(".x") || c.ends_with(".*") || c == "*" || c == "x" {
        if c == "*" || c == "x" {
            return true;
        }
        let prefix = c.trim_end_matches(".x").trim_end_matches(".*");
        let parts: Vec<&str> = prefix.split('.').collect();
        if parts.len() == 1 {
            if let Ok(maj) = parts[0].parse::<u32>() {
                return ver.major == maj;
            }
        } else if parts.len() == 2 {
            if let (Ok(maj), Ok(min)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                return ver.major == maj && ver.minor == min;
            }
        }
    }

    // 2. Caret: ^X.Y.Z
    if let Some(rest) = c.strip_prefix('^') {
        let parts: Vec<&str> = rest.split('.').collect();
        let maj = parts.first().and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let min = parts.get(1).and_then(|p| p.parse::<u32>().ok());
        let pat = parts.get(2).and_then(|p| p.parse::<u32>().ok());

        let min_val = min.unwrap_or(0);
        let pat_val = pat.unwrap_or(0);
        let lower = SemVer::new(maj, min_val, pat_val);

        let upper = if maj > 0 {
            SemVer::new(maj + 1, 0, 0)
        } else if min_val > 0 {
            SemVer::new(0, min_val + 1, 0)
        } else {
            SemVer::new(0, 0, pat_val + 1)
        };
        return ver >= lower && ver < upper;
    }

    // 3. Python Compatible release: ~=X.Y or ~=X.Y.Z
    if let Some(rest) = c.strip_prefix("~=") {
        let parts: Vec<&str> = rest.split('.').collect();
        let maj = parts.first().and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let min = parts.get(1).and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let pat = parts.get(2).and_then(|p| p.parse::<u32>().ok());

        if let Some(p) = pat {
            // ~=X.Y.Z -> >=X.Y.Z, <X.(Y+1).0
            let lower = SemVer::new(maj, min, p);
            let upper = SemVer::new(maj, min + 1, 0);
            return ver >= lower && ver < upper;
        } else {
            // ~=X.Y -> >=X.Y.0, <(X+1).0.0
            let lower = SemVer::new(maj, min, 0);
            let upper = SemVer::new(maj + 1, 0, 0);
            return ver >= lower && ver < upper;
        }
    }

    // 4. Tilde: ~X.Y.Z or ~X.Y or ~X
    if let Some(rest) = c.strip_prefix('~') {
        let parts: Vec<&str> = rest.split('.').collect();
        let maj = parts.first().and_then(|p| p.parse::<u32>().ok()).unwrap_or(0);
        let min = parts.get(1).and_then(|p| p.parse::<u32>().ok());
        let pat = parts.get(2).and_then(|p| p.parse::<u32>().ok());

        let min_val = min.unwrap_or(0);
        let pat_val = pat.unwrap_or(0);
        let lower = SemVer::new(maj, min_val, pat_val);

        let upper = if min.is_some() {
            SemVer::new(maj, min_val + 1, 0)
        } else {
            SemVer::new(maj + 1, 0, 0)
        };
        return ver >= lower && ver < upper;
    }

    // 5. Greater or equal: >=X.Y.Z
    if let Some(rest) = c.strip_prefix(">=") {
        if let Some(bound) = parse_semver(rest) {
            return ver >= bound;
        }
    }

    // 6. Greater: >X.Y.Z
    if let Some(rest) = c.strip_prefix('>') {
        let parts: Vec<&str> = rest.split('.').collect();
        if parts.len() == 1 {
            if let Ok(maj) = parts[0].parse::<u32>() {
                return ver.major > maj;
            }
        } else if let Some(bound) = parse_semver(rest) {
            return ver > bound;
        }
    }

    // 7. Less or equal: <=X.Y.Z
    if let Some(rest) = c.strip_prefix("<=") {
        let parts: Vec<&str> = rest.split('.').collect();
        if parts.len() == 1 {
            if let Ok(maj) = parts[0].parse::<u32>() {
                return ver.major <= maj;
            }
        } else if parts.len() == 2 {
            if let (Ok(maj), Ok(min)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                return ver < SemVer::new(maj, min + 1, 0);
            }
        } else if let Some(bound) = parse_semver(rest) {
            return ver <= bound;
        }
    }

    // 8. Less: <X.Y.Z
    if let Some(rest) = c.strip_prefix('<') {
        let parts: Vec<&str> = rest.split('.').collect();
        if parts.len() == 1 {
            if let Ok(maj) = parts[0].parse::<u32>() {
                return ver < SemVer::new(maj, 0, 0);
            }
        } else if parts.len() == 2 {
            if let (Ok(maj), Ok(min)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                return ver < SemVer::new(maj, min, 0);
            }
        } else if let Some(bound) = parse_semver(rest) {
            return ver < bound;
        }
    }

    // 9. Not equal: !=X.Y.Z
    if let Some(rest) = c.strip_prefix("!=") {
        let parts: Vec<&str> = rest.split('.').collect();
        if parts.len() == 1 {
            if let Ok(maj) = parts[0].parse::<u32>() {
                return ver.major != maj;
            }
        } else if let Some(bound) = parse_semver(rest) {
            return ver != bound;
        }
    }

    // 10. Exact or Major version: =X, ==X, X.Y.Z, X.Y, X
    let clean = c.strip_prefix("==").or_else(|| c.strip_prefix('=')).unwrap_or(c).trim();
    let parts: Vec<&str> = clean.split('.').collect();

    // Java major version (e.g. "17", "21", "1.8", "8")
    if tool_id == "java" || tool_id == "javac" {
        if let Some(target) = parse_semver(clean) {
            return ver.major == target.major || ver >= target;
        }
    }

    // Rust version in Cargo.toml (e.g. rust-version = "1.70" means minimum rustc 1.70.0)
    if tool_id == "rust" || tool_id == "cargo" {
        if let Some(bound) = parse_semver(clean) {
            return ver >= bound;
        }
    }

    // Go version in go.mod (e.g. go 1.21 means minimum go 1.21.0)
    if tool_id == "go" {
        if let Some(bound) = parse_semver(clean) {
            return ver >= bound;
        }
    }

    // If only major number given for any tool (e.g. "20")
    if parts.len() == 1 {
        if let Ok(maj) = parts[0].parse::<u32>() {
            return ver.major == maj;
        }
    }

    // If major.minor given (e.g. "3.11")
    if parts.len() == 2 {
        if let (Ok(maj), Ok(min)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
            return ver.major == maj && ver.minor == min;
        }
    }

    // Full exact match X.Y.Z
    if let Some(bound) = parse_semver(clean) {
        return ver == bound;
    }

    true
}

/// Helper to parse lower bound for UI display metadata.
fn parse_constraint_to_min(constraint: &str) -> Option<[u32; 3]> {
    let s = constraint.trim();
    let s = s
        .strip_prefix(">=")
        .or_else(|| s.strip_prefix('>'))
        .or_else(|| s.strip_prefix("~="))
        .or_else(|| s.strip_prefix('~'))
        .or_else(|| s.strip_prefix('^'))
        .or_else(|| s.strip_prefix("=="))
        .or_else(|| s.strip_prefix('='))
        .unwrap_or(s)
        .trim();
    let first_token = s.split(|c: char| c == ' ' || c == ',').next().unwrap_or(s);
    parse_version(first_token)
}

// =========================================================================
// Core: discover_installations
// =========================================================================

/// Discover ALL installations of a specific tool on this machine.
/// Pure, read-only. Deduplicates by canonical absolute executable path.
/// Stale non-existent executables are strictly omitted.
pub fn discover_installations(tool_id: &str) -> Vec<ToolInstallation> {
    let specs = toolchain_specs();
    let spec = match specs.iter().find(|s| s.id == tool_id) {
        Some(s) => s,
        None => return vec![],
    };

    let path_var = std::env::var("PATH").unwrap_or_default();
    let path_dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();

    let mut candidates: Vec<(PathBuf, DetectionSource, Option<usize>)> = Vec::new();
    let mut seen_canonical: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. Scan PATH
    for (idx, dir) in path_dirs.iter().enumerate() {
        for bname in spec.binary_names {
            let candidate = dir.join(bname);
            if candidate.is_file() {
                let key = canonical_key(&candidate);
                if seen_canonical.insert(key) {
                    candidates.push((candidate, DetectionSource::SystemPath, Some(idx)));
                }
            }
        }
    }

    // Detect version manager entries (fnm, nvm, volta paths in PATH)
    let path_lower = path_var.to_lowercase();
    let via_version_manager = path_lower.contains("fnm")
        || path_lower.contains("nvm")
        || path_lower.contains("volta")
        || path_lower.contains("pyenv")
        || path_lower.contains("asdf");

    // 2. Environment variable hint
    if let Some(env_name) = spec.env_hint {
        if let Ok(val) = std::env::var(env_name) {
            let base = PathBuf::from(&val);
            for bname in spec.binary_names {
                let direct = base.join(bname);
                let bin = base.join("bin").join(bname);
                for candidate in [direct, bin] {
                    if candidate.is_file() {
                        let key = canonical_key(&candidate);
                        if seen_canonical.insert(key) {
                            candidates.push((
                                candidate,
                                DetectionSource::EnvironmentVariable,
                                None,
                            ));
                        }
                        break;
                    }
                }
            }
        }
    }

    // 3. Standard installation directories
    if let Some(std_path) = find_in_standard_paths(spec.standard_rel_paths) {
        if std_path.is_file() {
            let key = canonical_key(&std_path);
            if seen_canonical.insert(key) {
                candidates.push((std_path, DetectionSource::StandardDirectory, None));
            }
        }
    }

    // Determine active key:
    // - For Java/javac, JAVA_HOME takes precedence if valid.
    // - Otherwise lowest index in PATH takes precedence.
    let env_hint_candidate_key: Option<String> = if spec.env_hint_takes_precedence {
        spec.env_hint.and_then(|env_name| {
            std::env::var(env_name).ok().and_then(|val| {
                let base = PathBuf::from(&val);
                for bname in spec.binary_names {
                    let direct = base.join(bname);
                    let bin = base.join("bin").join(bname);
                    for c in [&direct, &bin] {
                        if c.is_file() {
                            return Some(canonical_key(c));
                        }
                    }
                }
                None
            })
        })
    } else {
        None
    };

    let lowest_path_idx_key: Option<String> = candidates
        .iter()
        .filter(|(_, src, _)| *src == DetectionSource::SystemPath)
        .min_by_key(|(_, _, idx)| idx.unwrap_or(usize::MAX))
        .map(|(p, _, _)| canonical_key(p));

    let active_key = env_hint_candidate_key.or(lowest_path_idx_key);

    // Build ToolInstallation entries
    candidates
        .into_iter()
        .map(|(path, src, path_idx)| {
            let key = canonical_key(&path);
            let is_active = active_key.as_deref() == Some(key.as_str());
            let version = execute_version_probe(&path, spec.version_args);
            let is_verified = version.is_some();

            let evidence = match &src {
                DetectionSource::SystemPath => format!(
                    "Found in PATH[{}]: {}",
                    path_idx.unwrap_or(0),
                    path.parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
                DetectionSource::EnvironmentVariable => format!(
                    "Discovered via environment variable ({})",
                    spec.env_hint.unwrap_or("?")
                ),
                DetectionSource::StandardDirectory => format!(
                    "Found in standard installation directory: {}",
                    path.parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
                DetectionSource::VersionManager => "Discovered via version manager".to_string(),
                DetectionSource::ProjectLocalEnv => {
                    "Found in project-local virtual environment".to_string()
                }
            };

            let final_src = if src == DetectionSource::SystemPath && via_version_manager {
                let p_lower = path.to_string_lossy().to_lowercase();
                if p_lower.contains("fnm")
                    || p_lower.contains("nvm")
                    || p_lower.contains("volta")
                {
                    DetectionSource::VersionManager
                } else {
                    src
                }
            } else {
                src
            };

            ToolInstallation {
                id: format!("{}::{}", tool_id, key),
                tool: tool_id.to_string(),
                version,
                executable_path: path.to_string_lossy().to_string(),
                detection_source: final_src,
                path_index: path_idx,
                is_active,
                is_verified,
                verification_method: format!(
                    "{} {}",
                    path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    spec.version_args.join(" ")
                ),
                evidence,
            }
        })
        .collect()
}

/// Discover project-local Python venv installations.
/// Checks .venv/Scripts/python.exe, venv/Scripts/python.exe, env/Scripts/python.exe.
pub fn discover_project_local_python(project_path: &Path) -> Option<ToolInstallation> {
    let venv_dirs = [".venv", "venv", "env"];
    for venv in &venv_dirs {
        let candidate = project_path.join(venv).join("Scripts").join("python.exe");
        if candidate.is_file() {
            let version = execute_version_probe(&candidate, &["--version"]);
            let path_str = candidate.to_string_lossy().to_string();
            return Some(ToolInstallation {
                id: format!("python::{}", canonical_key(&candidate)),
                tool: "python".to_string(),
                version,
                executable_path: path_str,
                detection_source: DetectionSource::ProjectLocalEnv,
                path_index: None,
                is_active: false, // project-local venv is not the system active python
                is_verified: true,
                verification_method: "python.exe --version".to_string(),
                evidence: format!("Project-local venv at {}/Scripts/python.exe", venv),
            });
        }
    }
    None
}

/// Return the single installation that would be invoked in a plain shell.
/// Pure, read-only.
#[allow(dead_code)]
pub fn resolve_active_tool(tool_id: &str) -> Option<ToolInstallation> {
    discover_installations(tool_id)
        .into_iter()
        .find(|i| i.is_active)
}

// =========================================================================
// Core: extract_project_requirements
// =========================================================================

/// Extract all toolchain requirements declared in a project directory.
/// Reads only safe manifest files. Strictly avoids .env, secrets, or keys.
pub fn extract_project_requirements(project_path: &str) -> Vec<ProjectRequirement> {
    let root = Path::new(project_path);
    let mut requirements = Vec::new();

    // ── Node / npm package.json ──────────────────────────────────────────
    let pkg_json = root.join("package.json");
    if pkg_json.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            extract_package_json_requirements(&content, &pkg_json, &mut requirements);
        }
    }

    // ── .nvmrc / .node-version ───────────────────────────────────────────
    for fname in &[".nvmrc", ".node-version"] {
        let f = root.join(fname);
        if f.is_file() {
            if let Ok(content) = std::fs::read_to_string(&f) {
                let version_str = content.trim().to_string();
                if !version_str.is_empty() {
                    requirements.push(ProjectRequirement {
                        tool: "node".to_string(),
                        version_constraint: Some(version_str.clone()),
                        min_version: parse_constraint_to_min(&version_str),
                        source_file: f.to_string_lossy().to_string(),
                        raw_evidence: format!("{}: {}", fname, version_str),
                        evidence_type: EvidenceType::ExplicitProjectToolchain,
                        advisory_note: None,
                        java_context: None,
                    });
                }
            }
        }
    }

    // ── .tool-versions (asdf / mise) ─────────────────────────────────────
    let tool_versions = root.join(".tool-versions");
    if tool_versions.is_file() {
        if let Ok(content) = std::fs::read_to_string(&tool_versions) {
            extract_tool_versions_requirements(&content, &tool_versions, &mut requirements);
        }
    }

    // ── Python: pyproject.toml ───────────────────────────────────────────
    let pyproject = root.join("pyproject.toml");
    if pyproject.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pyproject) {
            extract_pyproject_requirements(&content, &pyproject, &mut requirements);
        }
    }

    // ── Python: Pipfile ──────────────────────────────────────────────────
    let pipfile = root.join("Pipfile");
    if pipfile.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pipfile) {
            extract_pipfile_requirements(&content, &pipfile, &mut requirements);
        }
    }

    // ── Python: .python-version ──────────────────────────────────────────
    let py_version = root.join(".python-version");
    if py_version.is_file() {
        if let Ok(content) = std::fs::read_to_string(&py_version) {
            let v = content.trim().to_string();
            if !v.is_empty() {
                requirements.push(ProjectRequirement {
                    tool: "python".to_string(),
                    version_constraint: Some(v.clone()),
                    min_version: parse_constraint_to_min(&v),
                    source_file: py_version.to_string_lossy().to_string(),
                    raw_evidence: format!(".python-version: {}", v),
                    evidence_type: EvidenceType::ExplicitProjectToolchain,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }

    // ── Rust: Cargo.toml ─────────────────────────────────────────────────
    let cargo_toml = root.join("Cargo.toml");
    if cargo_toml.is_file() {
        if let Ok(content) = std::fs::read_to_string(&cargo_toml) {
            extract_cargo_requirements(&content, &cargo_toml, &mut requirements);
        }
    }

    // ── Rust: rust-toolchain.toml ────────────────────────────────────────
    let rust_toolchain = root.join("rust-toolchain.toml");
    if rust_toolchain.is_file() {
        if let Ok(content) = std::fs::read_to_string(&rust_toolchain) {
            extract_rust_toolchain_requirements(&content, &rust_toolchain, &mut requirements);
        }
    }

    // ── Go: go.mod ───────────────────────────────────────────────────────
    let go_mod = root.join("go.mod");
    if go_mod.is_file() {
        if let Ok(content) = std::fs::read_to_string(&go_mod) {
            extract_go_mod_requirements(&content, &go_mod, &mut requirements);
        }
    }

    // ── Java / Maven: pom.xml ────────────────────────────────────────────
    let pom_xml = root.join("pom.xml");
    if pom_xml.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pom_xml) {
            extract_pom_xml_requirements(&content, &pom_xml, &mut requirements);
        }
    }

    // ── Java / Gradle: build.gradle / build.gradle.kts ───────────────────
    for fname in &["build.gradle", "build.gradle.kts"] {
        let f = root.join(fname);
        if f.is_file() {
            if let Ok(content) = std::fs::read_to_string(&f) {
                extract_gradle_requirements(&content, &f, &mut requirements);
            }
        }
    }

    requirements
}

fn extract_package_json_requirements(
    content: &str,
    source: &Path,
    out: &mut Vec<ProjectRequirement>,
) {
    let src = source.to_string_lossy().to_string();

    // Heuristic package manager preference from lockfiles
    let dir = source.parent().unwrap_or(Path::new("."));
    if dir.join("pnpm-lock.yaml").is_file() {
        out.push(ProjectRequirement {
            tool: "pnpm".to_string(),
            version_constraint: None,
            min_version: None,
            source_file: src.clone(),
            raw_evidence: "pnpm-lock.yaml present -> pnpm is the preferred package manager"
                .to_string(),
            evidence_type: EvidenceType::Heuristic,
            advisory_note: Some(
                "Lock file indicates pnpm was used; project should be built with pnpm.".to_string(),
            ),
            java_context: None,
        });
    } else if dir.join("yarn.lock").is_file() {
        out.push(ProjectRequirement {
            tool: "yarn".to_string(),
            version_constraint: None,
            min_version: None,
            source_file: src.clone(),
            raw_evidence: "yarn.lock present -> Yarn is the preferred package manager".to_string(),
            evidence_type: EvidenceType::Heuristic,
            advisory_note: None,
            java_context: None,
        });
    } else if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        out.push(ProjectRequirement {
            tool: "bun".to_string(),
            version_constraint: None,
            min_version: None,
            source_file: src.clone(),
            raw_evidence: "bun.lock present -> Bun is the preferred package manager".to_string(),
            evidence_type: EvidenceType::Heuristic,
            advisory_note: None,
            java_context: None,
        });
    }

    // Parse "engines" field — ADVISORY only
    let mut in_engines = false;
    let mut depth = 0i32;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("\"engines\"") || trimmed.contains("'engines'") {
            in_engines = true;
        }
        if in_engines {
            depth += trimmed.chars().filter(|&c| c == '{').count() as i32;
            depth -= trimmed.chars().filter(|&c| c == '}').count() as i32;
            if depth <= 0 && trimmed.contains('}') && !trimmed.contains("engines") {
                in_engines = false;
                depth = 0;
                continue;
            }
            for tool in &["node", "npm", "pnpm", "yarn"] {
                if trimmed.contains(&format!("\"{}\"", tool)) {
                    if let Some(constraint) = extract_json_string_value(trimmed) {
                        out.push(ProjectRequirement {
                            tool: tool.to_string(),
                            version_constraint: Some(constraint.clone()),
                            min_version: parse_constraint_to_min(&constraint),
                            source_file: src.clone(),
                            raw_evidence: format!("engines.{}: \"{}\"", tool, constraint),
                            evidence_type: EvidenceType::Advisory,
                            advisory_note: Some(
                                "npm engines field is advisory; it is not universally enforced by all package managers.".to_string(),
                            ),
                            java_context: None,
                        });
                    }
                }
            }
        }
    }

    // "packageManager" field (corepack)
    for line in content.lines() {
        let t = line.trim();
        if t.contains("\"packageManager\"") {
            if let Some(val) = extract_json_string_value(t) {
                let (pm, ver) = if let Some(at) = val.find('@') {
                    (&val[..at], Some(val[at + 1..].to_string()))
                } else {
                    (val.as_str(), None)
                };
                out.push(ProjectRequirement {
                    tool: pm.to_string(),
                    version_constraint: ver.clone(),
                    min_version: ver.as_deref().and_then(parse_constraint_to_min),
                    source_file: src.clone(),
                    raw_evidence: format!("packageManager: \"{}\"", val),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_tool_versions_requirements(
    content: &str,
    source: &Path,
    out: &mut Vec<ProjectRequirement>,
) {
    let src = source.to_string_lossy().to_string();
    let tool_map: HashMap<&str, &str> = [
        ("nodejs", "node"),
        ("node", "node"),
        ("python", "python"),
        ("rust", "rust"),
        ("go", "go"),
        ("java", "java"),
        ("maven", "maven"),
        ("gradle", "gradle"),
    ]
    .iter()
    .cloned()
    .collect();

    for line in content.lines() {
        let parts: Vec<&str> = line.trim().splitn(2, ' ').collect();
        if parts.len() == 2 {
            let tool_key = parts[0].trim();
            let ver = parts[1].trim();
            if let Some(&tool_id) = tool_map.get(tool_key) {
                out.push(ProjectRequirement {
                    tool: tool_id.to_string(),
                    version_constraint: Some(ver.to_string()),
                    min_version: parse_constraint_to_min(ver),
                    source_file: src.clone(),
                    raw_evidence: format!(".tool-versions: {} {}", tool_key, ver),
                    evidence_type: EvidenceType::ExplicitProjectToolchain,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_pyproject_requirements(
    content: &str,
    source: &Path,
    out: &mut Vec<ProjectRequirement>,
) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("requires-python") {
            if let Some(constraint) = extract_toml_string_value(t) {
                out.push(ProjectRequirement {
                    tool: "python".to_string(),
                    version_constraint: Some(constraint.clone()),
                    min_version: parse_constraint_to_min(&constraint),
                    source_file: src.clone(),
                    raw_evidence: format!("pyproject.toml requires-python = \"{}\"", constraint),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_pipfile_requirements(content: &str, source: &Path, out: &mut Vec<ProjectRequirement>) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("python_version") || t.starts_with("python_full_version") {
            if let Some(val) = extract_toml_string_value(t) {
                out.push(ProjectRequirement {
                    tool: "python".to_string(),
                    version_constraint: Some(val.clone()),
                    min_version: parse_constraint_to_min(&val),
                    source_file: src.clone(),
                    raw_evidence: format!("Pipfile {}", t),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_cargo_requirements(content: &str, source: &Path, out: &mut Vec<ProjectRequirement>) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("rust-version") {
            if let Some(constraint) = extract_toml_string_value(t) {
                out.push(ProjectRequirement {
                    tool: "rust".to_string(),
                    version_constraint: Some(constraint.clone()),
                    min_version: parse_constraint_to_min(&constraint),
                    source_file: src.clone(),
                    raw_evidence: format!("Cargo.toml rust-version = \"{}\"", constraint),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_rust_toolchain_requirements(
    content: &str,
    source: &Path,
    out: &mut Vec<ProjectRequirement>,
) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("channel") {
            if let Some(val) = extract_toml_string_value(t) {
                let min = if val == "stable" || val == "beta" || val == "nightly" {
                    None
                } else {
                    parse_constraint_to_min(&val)
                };
                out.push(ProjectRequirement {
                    tool: "rust".to_string(),
                    version_constraint: Some(val.clone()),
                    min_version: min,
                    source_file: src.clone(),
                    raw_evidence: format!("rust-toolchain.toml channel = \"{}\"", val),
                    evidence_type: EvidenceType::ExplicitProjectToolchain,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_go_mod_requirements(content: &str, source: &Path, out: &mut Vec<ProjectRequirement>) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("go ") {
            let ver = rest.split_whitespace().next().unwrap_or("").trim();
            if !ver.is_empty() {
                out.push(ProjectRequirement {
                    tool: "go".to_string(),
                    version_constraint: Some(ver.to_string()),
                    min_version: parse_constraint_to_min(ver),
                    source_file: src.clone(),
                    raw_evidence: format!("go.mod: go {}", ver),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: None,
                });
            }
        }
    }
}

fn extract_pom_xml_requirements(content: &str, source: &Path, out: &mut Vec<ProjectRequirement>) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        for tag in &["maven.compiler.source", "maven.compiler.target", "java.version"] {
            let open = format!("<{}>", tag);
            let close = format!("</{}>", tag);
            if t.contains(&open) && t.contains(&close) {
                if let Some(val) = extract_xml_tag_value(t, tag) {
                    out.push(ProjectRequirement {
                        tool: "java".to_string(),
                        version_constraint: Some(val.clone()),
                        min_version: parse_constraint_to_min(&val),
                        source_file: src.clone(),
                        raw_evidence: format!("pom.xml <{}>: {}", tag, val),
                        evidence_type: EvidenceType::DeclaredCompatibility,
                        advisory_note: None,
                        java_context: Some("BUILD_JDK".to_string()),
                    });
                }
            }
        }
        if t.contains("<maven.compiler.release>") {
            if let Some(val) = extract_xml_tag_value(t, "maven.compiler.release") {
                out.push(ProjectRequirement {
                    tool: "java".to_string(),
                    version_constraint: Some(val.clone()),
                    min_version: parse_constraint_to_min(&val),
                    source_file: src.clone(),
                    raw_evidence: format!("pom.xml <maven.compiler.release>: {}", val),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: Some("BUILD_JDK".to_string()),
                });
            }
        }
    }
}

fn extract_gradle_requirements(content: &str, source: &Path, out: &mut Vec<ProjectRequirement>) {
    let src = source.to_string_lossy().to_string();
    for line in content.lines() {
        let t = line.trim();
        if t.contains("JavaLanguageVersion.of(") || t.contains("languageVersion.set(JavaLanguageVersion.of(") {
            if let Some(start) = t.find(".of(") {
                let rest = &t[start + 4..];
                let ver_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !ver_str.is_empty() {
                    out.push(ProjectRequirement {
                        tool: "java".to_string(),
                        version_constraint: Some(ver_str.clone()),
                        min_version: parse_constraint_to_min(&ver_str),
                        source_file: src.clone(),
                        raw_evidence: format!(
                            "{}: JavaLanguageVersion.of({})",
                            source.file_name().unwrap_or_default().to_string_lossy(),
                            ver_str
                        ),
                        evidence_type: EvidenceType::ExplicitProjectToolchain,
                        advisory_note: Some(
                            "Gradle toolchain specifies the JDK for compilation. This is independent of the global JAVA_HOME environment variable.".to_string()
                        ),
                        java_context: Some("BUILD_JDK".to_string()),
                    });
                }
            }
        }
        if t.contains("sourceCompatibility") || t.contains("targetCompatibility") {
            if let Some(ver) = extract_gradle_java_version(t) {
                out.push(ProjectRequirement {
                    tool: "java".to_string(),
                    version_constraint: Some(ver.clone()),
                    min_version: parse_constraint_to_min(&ver),
                    source_file: src.clone(),
                    raw_evidence: format!("build.gradle {}", t),
                    evidence_type: EvidenceType::DeclaredCompatibility,
                    advisory_note: None,
                    java_context: Some("BUILD_JDK".to_string()),
                });
            }
        }
    }
}

// =========================================================================
// Core: match_requirement_to_installations
// =========================================================================

/// Match a single requirement against all known installations of that tool.
/// Pure, read-only.
/// Distinguishes:
/// - Active satisfies & single candidate -> `Active`
/// - Active satisfies & multiple candidates -> `MultipleInstallations`
/// - Active does not satisfy, but compatible candidate(s) exist -> `Compatible`
/// - Active & all candidates fail constraint -> `Mismatch`
/// - No candidate installed -> `Missing`
/// - Constraint absent or unparseable -> `Unknown` / `Active`
pub fn match_requirement_to_installations(
    req: &ProjectRequirement,
    installs: &[ToolInstallation],
) -> ResolutionStatus {
    if installs.is_empty() {
        return ResolutionStatus::Missing;
    }

    let active = installs.iter().find(|i| i.is_active);

    match &req.version_constraint {
        None => {
            if let Some(a) = active {
                if a.is_verified {
                    if installs.len() > 1 {
                        return ResolutionStatus::MultipleInstallations;
                    }
                    return ResolutionStatus::Active;
                }
            }
            if installs.iter().any(|i| i.is_verified) {
                return ResolutionStatus::Compatible;
            }
            ResolutionStatus::Unknown
        }
        Some(constraint) => {
            let active_matches = active
                .and_then(|a| a.version.as_deref())
                .map(|av| eval_constraint(constraint, av, &req.tool))
                .unwrap_or(false);

            let compatible_installs: Vec<&ToolInstallation> = installs
                .iter()
                .filter(|i| {
                    i.version
                        .as_deref()
                        .map(|v| eval_constraint(constraint, v, &req.tool))
                        .unwrap_or(false)
                })
                .collect();

            if active_matches {
                if installs.len() > 1 {
                    return ResolutionStatus::MultipleInstallations;
                }
                return ResolutionStatus::Active;
            }

            if !compatible_installs.is_empty() {
                // Active executable is a mismatch (or absent), but compatible installation(s) exist on disk!
                return ResolutionStatus::Compatible;
            }

            ResolutionStatus::Mismatch
        }
    }
}

// =========================================================================
// Core: explain_resolution
// =========================================================================

/// Generate a human-readable explanation for a resolution result.
/// Pure, no I/O.
pub fn explain_resolution(
    tool: &str,
    status: &ResolutionStatus,
    req: Option<&ProjectRequirement>,
    active: Option<&ToolInstallation>,
    compatible_installations: &[ToolInstallation],
) -> ResolutionExplanation {
    let is_advisory = req
        .map(|r| r.evidence_type == EvidenceType::Advisory)
        .unwrap_or(false);

    let constraint = req
        .and_then(|r| r.version_constraint.as_deref())
        .unwrap_or("(any)");

    let req_source = req
        .map(|r| r.source_file.as_str())
        .unwrap_or("project configuration");

    let active_ver = active.and_then(|a| a.version.as_deref()).unwrap_or("unknown");
    let active_path = active.map(|a| a.executable_path.as_str()).unwrap_or("not on PATH");

    match status {
        ResolutionStatus::Active => ResolutionExplanation {
            headline: format!("{} {} is active and satisfies '{}'", tool, active_ver, constraint),
            detail: format!(
                "The active {} executable at {} ({}) satisfies declared requirement '{}' in {}.",
                tool, active_path, active_ver, constraint, req_source
            ),
            suggestion: None,
            is_advisory_only: is_advisory,
        },
        ResolutionStatus::MultipleInstallations => {
            let other_count = compatible_installations
                .iter()
                .filter(|i| !i.is_active)
                .count();
            ResolutionExplanation {
                headline: format!(
                    "{} {} is active (satisfies '{}'); {} other compatible candidate(s) found",
                    tool, active_ver, constraint, other_count
                ),
                detail: format!(
                    "Multiple {} installations exist. Active executable ({}) at {} meets declared '{}' in {}. {} additional candidate(s) detected.",
                    tool, active_ver, active_path, constraint, req_source, other_count
                ),
                suggestion: None,
                is_advisory_only: is_advisory,
            }
        }
        ResolutionStatus::Compatible => {
            let comp_first = compatible_installations.first();
            let comp_ver = comp_first.and_then(|c| c.version.as_deref()).unwrap_or("installed");
            let comp_path = comp_first.map(|c| c.executable_path.as_str()).unwrap_or("");

            if active.is_some() {
                ResolutionExplanation {
                    headline: format!(
                        "{} {} is active (MISMATCH), but compatible version is available ({})",
                        tool, active_ver, comp_ver
                    ),
                    detail: format!(
                        "The active {} ({}) does not satisfy requirement '{}' (from {}). However, {} compatible installation(s) were found on workstation (e.g. {} at {}).",
                        tool, active_ver, constraint, req_source, compatible_installations.len(), comp_ver, comp_path
                    ),
                    suggestion: Some(format!(
                        "Use compatible installation at {} ({}) or switch active toolchain.",
                        comp_path, comp_ver
                    )),
                    is_advisory_only: is_advisory,
                }
            } else {
                ResolutionExplanation {
                    headline: format!(
                        "{} is not active on PATH, but compatible version is available ({})",
                        tool, comp_ver
                    ),
                    detail: format!(
                        "Compatible {} installation ({}) found at {}, satisfying '{}' in {}.",
                        tool, comp_ver, comp_path, constraint, req_source
                    ),
                    suggestion: Some(format!("Add {} to PATH or configure workspace environment.", comp_path)),
                    is_advisory_only: is_advisory,
                }
            }
        }
        ResolutionStatus::Mismatch => ResolutionExplanation {
            headline: format!(
                "{} {} is active but does not satisfy '{}'",
                tool, active_ver, constraint
            ),
            detail: format!(
                "The active {} executable ({}) at {} does not meet requirement '{}' declared in {}. No compatible installation was discovered on workstation.",
                tool, active_ver, active_path, constraint, req_source
            ),
            suggestion: Some(format!(
                "Install {} satisfying '{}' or update project configuration.",
                tool, constraint
            )),
            is_advisory_only: is_advisory,
        },
        ResolutionStatus::Missing => ResolutionExplanation {
            headline: format!("{} is not installed", tool),
            detail: format!(
                "No {} installation was found in PATH, environment variables, or standard directories to satisfy requirement '{}' in {}.",
                tool, constraint, req_source
            ),
            suggestion: Some(format!("Install {} to satisfy project requirements.", tool)),
            is_advisory_only: false,
        },
        ResolutionStatus::Unknown => ResolutionExplanation {
            headline: format!("{} — resolution undetermined", tool),
            detail: format!(
                "Could not determine compatibility for {} (no version constraint declared or version probe could not be verified).",
                tool
            ),
            suggestion: None,
            is_advisory_only: is_advisory,
        },
    }
}

// =========================================================================
// IPC Commands
// =========================================================================

/// Return all discovered installations for all 15 supported toolchains.
#[tauri::command]
pub fn get_toolchain_installations() -> Vec<ToolInstallation> {
    let tools = [
        "node", "npm", "pnpm", "yarn", "bun", "python", "pip",
        "java", "javac", "maven", "gradle", "rust", "cargo", "go", "git",
    ];
    let mut all = Vec::new();
    for tool in &tools {
        all.extend(discover_installations(tool));
    }
    all
}

/// Resolve toolchain requirements for a specific project directory.
/// Returns a full `ProjectToolchainReport`.
#[tauri::command]
pub fn resolve_project_toolchain(project_path: String) -> ProjectToolchainReport {
    let requirements = extract_project_requirements(&project_path);

    let all_tools = [
        "node", "npm", "pnpm", "yarn", "bun", "python", "pip",
        "java", "javac", "maven", "gradle", "rust", "cargo", "go", "git",
    ];

    // Pre-discover all installations (one pass)
    let mut installs_map: HashMap<String, Vec<ToolInstallation>> = HashMap::new();
    for tool in &all_tools {
        installs_map.insert(tool.to_string(), discover_installations(tool));
    }

    // Check project-local Python venv
    let root = Path::new(&project_path);
    if let Some(local_python) = discover_project_local_python(root) {
        installs_map
            .entry("python".to_string())
            .or_default()
            .push(local_python);
    }

    let mut results: Vec<ToolResolutionResult> = Vec::new();
    let mut missing_count = 0;
    let mut mismatch_count = 0;
    let mut compatible_count = 0;

    for tool in &all_tools {
        let tool_installs = installs_map.get(*tool).cloned().unwrap_or_default();
        let tool_req = requirements.iter().find(|r| r.tool == *tool);

        let active = tool_installs.iter().find(|i| i.is_active).cloned();
        let compatible: Vec<ToolInstallation> = if let Some(req) = tool_req {
            if let Some(ref constraint) = req.version_constraint {
                tool_installs
                    .iter()
                    .filter(|i| {
                        i.version
                            .as_deref()
                            .map(|v| eval_constraint(constraint, v, tool))
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect()
            } else {
                tool_installs.clone()
            }
        } else {
            vec![]
        };

        let status = match tool_req {
            Some(req) => match_requirement_to_installations(req, &tool_installs),
            None => {
                if tool_installs.is_empty() {
                    ResolutionStatus::Missing
                } else {
                    ResolutionStatus::Unknown
                }
            }
        };

        match &status {
            ResolutionStatus::Missing => missing_count += 1,
            ResolutionStatus::Mismatch => mismatch_count += 1,
            ResolutionStatus::Active | ResolutionStatus::Compatible | ResolutionStatus::MultipleInstallations => {
                compatible_count += 1
            }
            ResolutionStatus::Unknown => {}
        }

        let explanation = explain_resolution(
            tool,
            &status,
            tool_req,
            active.as_ref(),
            &compatible,
        );

        results.push(ToolResolutionResult {
            tool: tool.to_string(),
            status,
            active_installation: active,
            compatible_installations: compatible,
            all_installations: tool_installs,
            requirement: tool_req.cloned(),
            explanation,
        });
    }

    let generated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    ProjectToolchainReport {
        project_path,
        generated_at,
        requirements_found: requirements.len(),
        missing_count,
        mismatch_count,
        compatible_count,
        results,
    }
}

// =========================================================================
// Internal utilities
// =========================================================================

/// Compute a stable deduplication key from an executable path.
/// Lowercases and normalises slashes so `C:\foo\bar.exe` == `c:/foo/bar.exe`.
fn canonical_key(path: &Path) -> String {
    path.to_string_lossy()
        .to_lowercase()
        .replace('/', "\\")
}

/// Extract the string value from a JSON line like: "key": "value"
fn extract_json_string_value(line: &str) -> Option<String> {
    let mut iter = line.splitn(4, '"');
    iter.next();
    iter.next();
    iter.next();
    iter.next().map(|v| v.to_string())
}

/// Extract value from a TOML assignment line: key = "value"
fn extract_toml_string_value(line: &str) -> Option<String> {
    let after_eq = line.splitn(2, '=').nth(1)?.trim();
    let stripped = after_eq.trim_matches(|c| c == '"' || c == '\'');
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_string())
    }
}

/// Extract inner text from an XML tag on a single line.
fn extract_xml_tag_value(line: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = line.find(&open)? + open.len();
    let end = line.find(&close)?;
    if end > start {
        Some(line[start..end].trim().to_string())
    } else {
        None
    }
}

/// Extract Java version from a Gradle sourceCompatibility/targetCompatibility line.
fn extract_gradle_java_version(line: &str) -> Option<String> {
    if let Some(after) = line.split('=').nth(1) {
        let val = after.trim().trim_matches(|c| c == '"' || c == '\'');
        if let Some(rest) = val.strip_prefix("JavaVersion.VERSION_") {
            return Some(rest.split_whitespace().next()?.to_string());
        }
        if val.starts_with("1.") {
            return val.splitn(2, '.').nth(1).map(|s| s.trim().to_string());
        }
        let numeric: String = val.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !numeric.is_empty() {
            return Some(numeric);
        }
    }
    None
}

// =========================================================================
// Tests
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── 1. Full Node ranges ─────────────────────────────────────────────
    #[test]
    fn test_node_range_multi_comparator() {
        assert!(eval_constraint(">=20 <22", "20.10.0", "node"));
        assert!(eval_constraint(">=20 <22", "21.5.0", "node"));
        assert!(!eval_constraint(">=20 <22", "22.0.0", "node"));
        assert!(!eval_constraint(">=20 <22", "22.14.0", "node"));
        assert!(!eval_constraint(">=20 <22", "18.19.0", "node"));
    }

    #[test]
    fn test_node_caret_range() {
        assert!(eval_constraint("^20.10.0", "20.10.0", "node"));
        assert!(eval_constraint("^20.10.0", "20.19.1", "node"));
        assert!(!eval_constraint("^20.10.0", "21.0.0", "node"));
        assert!(!eval_constraint("^20.10.0", "20.9.0", "node"));
    }

    #[test]
    fn test_node_tilde_range() {
        assert!(eval_constraint("~20.10.0", "20.10.0", "node"));
        assert!(eval_constraint("~20.10.0", "20.10.5", "node"));
        assert!(!eval_constraint("~20.10.0", "20.11.0", "node"));
        assert!(!eval_constraint("~20.10.0", "20.9.0", "node"));
    }

    #[test]
    fn test_node_wildcard_range() {
        assert!(eval_constraint("20.x", "20.0.0", "node"));
        assert!(eval_constraint("20.x", "20.18.0", "node"));
        assert!(!eval_constraint("20.x", "21.0.0", "node"));
        assert!(eval_constraint("20.*", "20.12.0", "node"));
        assert!(!eval_constraint("20.*", "19.9.0", "node"));
    }

    #[test]
    fn test_node_less_than_range() {
        assert!(eval_constraint("<22", "20.19.1", "node"));
        assert!(eval_constraint("<22", "21.9.0", "node"));
        assert!(!eval_constraint("<22", "22.0.0", "node"));
        assert!(!eval_constraint("<22", "22.14.0", "node"));
    }

    #[test]
    fn test_node_exact_version() {
        assert!(eval_constraint("=20.10.0", "20.10.0", "node"));
        assert!(eval_constraint("20.10.0", "20.10.0", "node"));
        assert!(!eval_constraint("=20.10.0", "20.11.0", "node"));
    }

    // ── 2. Python specifiers ────────────────────────────────────────────
    #[test]
    fn test_python_multi_specifier() {
        assert!(eval_constraint(">=3.10,<3.13", "3.10.0", "python"));
        assert!(eval_constraint(">=3.10,<3.13", "3.11.8", "python"));
        assert!(eval_constraint(">=3.10,<3.13", "3.12.3", "python"));
        assert!(!eval_constraint(">=3.10,<3.13", "3.13.0", "python"));
        assert!(!eval_constraint(">=3.10,<3.13", "3.9.5", "python"));
    }

    #[test]
    fn test_python_lower_bound_and_tilde_compat() {
        assert!(eval_constraint(">=3.11", "3.11.0", "python"));
        assert!(eval_constraint(">=3.11", "3.12.2", "python"));
        assert!(!eval_constraint(">=3.11", "3.10.9", "python"));

        assert!(eval_constraint("~=3.11.0", "3.11.4", "python"));
        assert!(!eval_constraint("~=3.11.0", "3.12.0", "python"));
    }

    // ── 3. Rust requirements ────────────────────────────────────────────
    #[test]
    fn test_rust_version_matching() {
        assert!(eval_constraint("1.70", "1.70.0", "rust"));
        assert!(eval_constraint("1.70", "1.77.2", "rust"));
        assert!(!eval_constraint("1.70", "1.69.0", "rust"));
    }

    // ── 4. Java major version & separation ──────────────────────────────
    #[test]
    fn test_java_major_version() {
        assert!(eval_constraint("17", "17.0.8", "java"));
        assert!(eval_constraint("21", "21.0.2", "java"));
        assert!(eval_constraint("1.8", "1.8.0_381", "java"));
    }

    #[test]
    fn test_java_runtime_vs_build_separation() {
        let pom = "<properties><maven.compiler.source>17</maven.compiler.source></properties>";
        let mut reqs = Vec::new();
        extract_pom_xml_requirements(pom, Path::new("pom.xml"), &mut reqs);
        let req = reqs.iter().find(|r| r.tool == "java").unwrap();
        assert_eq!(req.java_context, Some("BUILD_JDK".to_string()));
        assert_eq!(req.evidence_type, EvidenceType::DeclaredCompatibility);

        let gradle = "java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }";
        let mut g_reqs = Vec::new();
        extract_gradle_requirements(gradle, Path::new("build.gradle"), &mut g_reqs);
        let g_req = g_reqs.iter().find(|r| r.tool == "java").unwrap();
        assert_eq!(g_req.java_context, Some("BUILD_JDK".to_string()));
        assert_eq!(g_req.version_constraint, Some("21".to_string()));
    }

    // ── 5. Go requirement ───────────────────────────────────────────────
    #[test]
    fn test_go_version_matching() {
        assert!(eval_constraint("1.21", "1.21.0", "go"));
        assert!(eval_constraint("1.21", "1.22.4", "go"));
        assert!(!eval_constraint("1.21", "1.20.0", "go"));
    }

    // ── 6. Multiple candidates & Active mismatch with compatible candidate
    #[test]
    fn test_active_mismatch_with_compatible_candidate() {
        let make = |path: &str, is_active: bool, ver: &str| ToolInstallation {
            id: format!("node::{}", path),
            tool: "node".to_string(),
            version: Some(ver.to_string()),
            executable_path: path.to_string(),
            detection_source: DetectionSource::SystemPath,
            path_index: if is_active { Some(0) } else { Some(1) },
            is_active,
            is_verified: true,
            verification_method: "node.exe --version".to_string(),
            evidence: "PATH".to_string(),
        };

        let installs = vec![
            make("C:\\nodejs\\node22\\node.exe", true, "22.14.0"),
            make("C:\\nodejs\\node20\\node.exe", false, "20.19.1"),
        ];

        let req = ProjectRequirement {
            tool: "node".to_string(),
            version_constraint: Some(">=20 <22".to_string()),
            min_version: Some([20, 0, 0]),
            source_file: "package.json".to_string(),
            raw_evidence: "engines.node: \">=20 <22\"".to_string(),
            evidence_type: EvidenceType::Advisory,
            advisory_note: None,
            java_context: None,
        };

        let status = match_requirement_to_installations(&req, &installs);
        assert_eq!(status, ResolutionStatus::Compatible);

        let active = installs.iter().find(|i| i.is_active);
        let compatible: Vec<ToolInstallation> = installs
            .iter()
            .filter(|i| eval_constraint(">=20 <22", i.version.as_deref().unwrap(), "node"))
            .cloned()
            .collect();

        assert_eq!(compatible.len(), 1);
        assert_eq!(compatible[0].version.as_deref(), Some("20.19.1"));

        let explanation = explain_resolution("node", &status, Some(&req), active, &compatible);
        assert!(explanation.headline.contains("MISMATCH"));
        assert!(explanation.headline.contains("compatible version is available"));
        assert!(explanation.detail.contains("22.14.0"));
        assert!(explanation.detail.contains("20.19.1"));
    }

    // ── 7. Active matches with multiple candidates ───────────────────────
    #[test]
    fn test_active_matches_with_multiple_candidates() {
        let make = |path: &str, is_active: bool, ver: &str| ToolInstallation {
            id: format!("node::{}", path),
            tool: "node".to_string(),
            version: Some(ver.to_string()),
            executable_path: path.to_string(),
            detection_source: DetectionSource::SystemPath,
            path_index: if is_active { Some(0) } else { Some(1) },
            is_active,
            is_verified: true,
            verification_method: "node.exe --version".to_string(),
            evidence: "PATH".to_string(),
        };

        let installs = vec![
            make("C:\\nvm\\v20\\node.exe", true, "20.19.1"),
            make("C:\\nodejs\\node.exe", false, "20.11.0"),
        ];

        let req = ProjectRequirement {
            tool: "node".to_string(),
            version_constraint: Some(">=20.0.0".to_string()),
            min_version: Some([20, 0, 0]),
            source_file: "package.json".to_string(),
            raw_evidence: "engines.node: \">=20.0.0\"".to_string(),
            evidence_type: EvidenceType::Advisory,
            advisory_note: None,
            java_context: None,
        };

        let status = match_requirement_to_installations(&req, &installs);
        assert_eq!(status, ResolutionStatus::MultipleInstallations);
    }

    // ── 8. Unknown requirement ──────────────────────────────────────────
    #[test]
    fn test_unknown_requirement() {
        let installs = vec![ToolInstallation {
            id: "git::c:\\git\\cmd\\git.exe".to_string(),
            tool: "git".to_string(),
            version: Some("2.44.0".to_string()),
            executable_path: "C:\\Git\\cmd\\git.exe".to_string(),
            detection_source: DetectionSource::SystemPath,
            path_index: Some(0),
            is_active: true,
            is_verified: true,
            verification_method: "git.exe --version".to_string(),
            evidence: "PATH[0]".to_string(),
        }];

        let req = ProjectRequirement {
            tool: "git".to_string(),
            version_constraint: None,
            min_version: None,
            source_file: ".tool-versions".to_string(),
            raw_evidence: "git latest".to_string(),
            evidence_type: EvidenceType::Unknown,
            advisory_note: None,
            java_context: None,
        };

        let status = match_requirement_to_installations(&req, &installs);
        assert_eq!(status, ResolutionStatus::Active);
    }

    // ── 9. Python local environment detection ───────────────────────────
    #[test]
    fn test_python_local_env_detection_none_when_nonexistent() {
        let fake_path = Path::new("C:\\NonexistentProject_12345");
        let local = discover_project_local_python(fake_path);
        assert!(local.is_none());
    }

    // ── 10. Stale executable handling ────────────────────────────────────
    #[test]
    fn test_stale_executable_returns_missing() {
        let fake_installs: Vec<ToolInstallation> = vec![];
        let req = ProjectRequirement {
            tool: "go".to_string(),
            version_constraint: Some(">=1.21".to_string()),
            min_version: Some([1, 21, 0]),
            source_file: "go.mod".to_string(),
            raw_evidence: "go 1.21".to_string(),
            evidence_type: EvidenceType::DeclaredCompatibility,
            advisory_note: None,
            java_context: None,
        };
        let status = match_requirement_to_installations(&req, &fake_installs);
        assert_eq!(status, ResolutionStatus::Missing);
    }

    // ── 11. Canonical duplicate detection ────────────────────────────────
    #[test]
    fn test_canonical_key_case_and_slashes() {
        let a = canonical_key(Path::new("C:\\Users\\Admin\\.cargo\\bin\\cargo.exe"));
        let b = canonical_key(Path::new("C:/Users/Admin/.cargo/bin/cargo.exe"));
        let c = canonical_key(Path::new("c:\\users\\admin\\.cargo\\bin\\cargo.exe"));
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    // ── 12. Evidence explanation formatting ──────────────────────────────
    #[test]
    fn test_explain_resolution_all_statuses() {
        for status in [
            ResolutionStatus::Active,
            ResolutionStatus::Compatible,
            ResolutionStatus::Mismatch,
            ResolutionStatus::Missing,
            ResolutionStatus::Unknown,
            ResolutionStatus::MultipleInstallations,
        ] {
            let explanation = explain_resolution("node", &status, None, None, &[]);
            assert!(!explanation.headline.is_empty());
            assert!(!explanation.detail.is_empty());
        }
    }

    // ── 13. Java HOME 17 vs Gradle Toolchain 21 & vice-versa ────────────
    #[test]
    fn test_java_runtime_17_with_gradle_toolchain_21() {
        // Runtime/Shell Java installation (JAVA_HOME=17)
        let java17 = ToolInstallation {
            id: "java::c:\\jdk17\\bin\\java.exe".to_string(),
            tool: "java".to_string(),
            version: Some("17.0.9".to_string()),
            executable_path: "C:\\jdk17\\bin\\java.exe".to_string(),
            detection_source: DetectionSource::EnvironmentVariable,
            path_index: None,
            is_active: true,
            is_verified: true,
            verification_method: "java.exe -version".to_string(),
            evidence: "JAVA_HOME".to_string(),
        };

        // Gradle build toolchain requirement (toolchain languageVersion 21)
        let gradle_req = ProjectRequirement {
            tool: "java".to_string(),
            version_constraint: Some("21".to_string()),
            min_version: Some([21, 0, 0]),
            source_file: "build.gradle".to_string(),
            raw_evidence: "JavaLanguageVersion.of(21)".to_string(),
            evidence_type: EvidenceType::ExplicitProjectToolchain,
            advisory_note: Some("Gradle toolchain specifies the JDK for compilation.".to_string()),
            java_context: Some("BUILD_JDK".to_string()),
        };

        let status = match_requirement_to_installations(&gradle_req, &[java17.clone()]);
        // Java 17 does not satisfy Gradle JDK 21 requirement
        assert_eq!(status, ResolutionStatus::Mismatch);
    }

    #[test]
    fn test_java_runtime_21_with_gradle_toolchain_17() {
        // Runtime/Shell Java installation (JAVA_HOME=21)
        let java21 = ToolInstallation {
            id: "java::c:\\jdk21\\bin\\java.exe".to_string(),
            tool: "java".to_string(),
            version: Some("21.0.2".to_string()),
            executable_path: "C:\\jdk21\\bin\\java.exe".to_string(),
            detection_source: DetectionSource::EnvironmentVariable,
            path_index: None,
            is_active: true,
            is_verified: true,
            verification_method: "java.exe -version".to_string(),
            evidence: "JAVA_HOME".to_string(),
        };

        // Gradle build toolchain requirement (toolchain languageVersion 17)
        let gradle_req = ProjectRequirement {
            tool: "java".to_string(),
            version_constraint: Some("17".to_string()),
            min_version: Some([17, 0, 0]),
            source_file: "build.gradle".to_string(),
            raw_evidence: "JavaLanguageVersion.of(17)".to_string(),
            evidence_type: EvidenceType::ExplicitProjectToolchain,
            advisory_note: Some("Gradle toolchain specifies the JDK for compilation.".to_string()),
            java_context: Some("BUILD_JDK".to_string()),
        };

        let status = match_requirement_to_installations(&gradle_req, &[java21]);
        // Java 21 is backwards compatible with JDK 17 compilation target
        assert_eq!(status, ResolutionStatus::Active);
    }

    // ── 14. Python local venv compatibility matching ─────────────────────
    #[test]
    fn test_python_local_venv_compatibility() {
        let global_py = ToolInstallation {
            id: "python::c:\\python39\\python.exe".to_string(),
            tool: "python".to_string(),
            version: Some("3.9.12".to_string()),
            executable_path: "C:\\python39\\python.exe".to_string(),
            detection_source: DetectionSource::SystemPath,
            path_index: Some(0),
            is_active: true,
            is_verified: true,
            verification_method: "python.exe --version".to_string(),
            evidence: "PATH[0]".to_string(),
        };

        let venv_py = ToolInstallation {
            id: "python::d:\\project\\.venv\\scripts\\python.exe".to_string(),
            tool: "python".to_string(),
            version: Some("3.11.8".to_string()),
            executable_path: "D:\\project\\.venv\\Scripts\\python.exe".to_string(),
            detection_source: DetectionSource::ProjectLocalEnv,
            path_index: None,
            is_active: false,
            is_verified: true,
            verification_method: "python.exe --version".to_string(),
            evidence: "Project-local venv at .venv/Scripts/python.exe".to_string(),
        };

        let req = ProjectRequirement {
            tool: "python".to_string(),
            version_constraint: Some(">=3.11".to_string()),
            min_version: Some([3, 11, 0]),
            source_file: "pyproject.toml".to_string(),
            raw_evidence: "requires-python = \">=3.11\"".to_string(),
            evidence_type: EvidenceType::DeclaredCompatibility,
            advisory_note: None,
            java_context: None,
        };

        // Active global Python 3.9 is mismatch, but local venv 3.11 is compatible!
        let status = match_requirement_to_installations(&req, &[global_py, venv_py]);
        assert_eq!(status, ResolutionStatus::Compatible);
    }
}
