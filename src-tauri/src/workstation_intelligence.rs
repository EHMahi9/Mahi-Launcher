// Phase 10A: Workstation Intelligence & Findings Engine
//
// Read-only correlation layer that correlates information from existing MAHI engines:
//   - Storage Engine (storage_engine.rs)
//   - Developer Health Audit (health_audit.rs)
//   - Toolchain Resolver (toolchain.rs)
//   - Workspace Profiles (workspace_profile.rs)
//   - Workspace Environment Plans (workspace_environment.rs)
//   - Repair Engine (repair_engine.rs)
//
// SAFETY CONTRACT:
//   - Strictly read-only local correlation.
//   - ZERO file modifications, ZERO process spawns, ZERO registry/env mutations.
//   - ZERO network or external API / LLM calls.
//   - Deterministic finding output and sorting.

use serde::{Deserialize, Serialize};

use crate::health_audit::{self, HealthStatus};
use crate::repair_engine;
use crate::storage_engine;
use crate::workspace_profile;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FindingSeverity {
    Critical = 4,
    High = 3,
    Medium = 2,
    Low = 1,
    Info = 0,
}

impl FindingSeverity {
    pub fn rank(&self) -> u8 {
        match self {
            FindingSeverity::Critical => 4,
            FindingSeverity::High => 3,
            FindingSeverity::Medium => 2,
            FindingSeverity::Low => 1,
            FindingSeverity::Info => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FindingCategory {
    Storage,
    Toolchain,
    Environment,
    ProjectCompatibility,
    WorkspaceProfile,
    Security,
    Configuration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SafeActionKind {
    ReviewStorage,
    OpenStorageIntelligence,
    ReviewRepair,
    ReviewToolchain,
    ReviewWorkspaceProfile,
    OpenProjectWorkspace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingEvidenceItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationFinding {
    pub id: String,
    pub title: String,
    pub severity: FindingSeverity,
    pub category: FindingCategory,
    pub source_engine: String,
    pub summary: String,
    pub explanation: String,
    pub recommendation: String,
    pub safe_action_kind: Option<SafeActionKind>,
    pub target_id: Option<String>,
    pub evidence: Vec<FindingEvidenceItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeverityCounts {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationFindingsReport {
    pub generated_at: u64,
    pub total_findings: usize,
    pub counts: SeverityCounts,
    pub findings: Vec<WorkstationFinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationIntelligenceSummary {
    pub total_findings: usize,
    pub critical_count: usize,
    pub high_count: usize,
    pub medium_count: usize,
    pub low_count: usize,
    pub info_count: usize,
    pub top_findings: Vec<WorkstationFinding>,
}

// =========================================================================
// Correlation Engine Logic
// =========================================================================

pub fn generate_workstation_findings(
    optional_project_path: Option<&str>,
) -> WorkstationFindingsReport {
    let mut findings = Vec::new();

    // 1. Storage Correlations
    let mut total_recoverable = 0u64;
    let mut cat_count = 0;
    for drive in &["C", "D"] {
        let rep = storage_engine::scan_drive_storage(drive);
        total_recoverable += rep.recoverable_space.definitely_reclaimable_bytes;
        cat_count += rep.categories.len();
    }

        if total_recoverable > 5 * 1024 * 1024 * 1024 {
            // > 5 GB recoverable
            findings.push(WorkstationFinding {
                id: "storage-heavy-recoverable".to_string(),
                title: "Significant Reclaimable Developer Cache Space".to_string(),
                severity: FindingSeverity::Medium,
                category: FindingCategory::Storage,
                source_engine: "Storage Engine".to_string(),
                summary: format!(
                    "Over {} of safe reclaimable space identified across developer caches.",
                    storage_engine::format_bytes(total_recoverable)
                ),
                explanation: "Temporary build artifacts, package manager caches, and stale target folders accumulate over time and consume primary drive capacity.".to_string(),
                recommendation: "Review recoverable storage locations and run a clean-up preview to free up drive space.".to_string(),
                safe_action_kind: Some(SafeActionKind::OpenStorageIntelligence),
                target_id: None,
                evidence: vec![
                    FindingEvidenceItem {
                        label: "Total Recoverable".to_string(),
                        value: storage_engine::format_bytes(total_recoverable),
                    },
                    FindingEvidenceItem {
                        label: "Category Count".to_string(),
                        value: cat_count.to_string(),
                    },
                ],
            });
        }

    // 2. Health & Path Audit Correlations
    if let Ok(health_report) = health_audit::run_developer_environment_audit(None) {
        // Missing PATH entries
        if health_report.path_diagnostics.missing_entries > 0 {
            findings.push(WorkstationFinding {
                id: "path-missing-entries".to_string(),
                title: "Stale or Non-Existent User PATH Entries".to_string(),
                severity: FindingSeverity::Low,
                category: FindingCategory::Environment,
                source_engine: "Developer Health Audit".to_string(),
                summary: format!(
                    "Found {} missing or unresolvable directories in your user PATH environment variable.",
                    health_report.path_diagnostics.missing_entries
                ),
                explanation: "Directories that no longer exist on disk slow down path lookup routines and indicate leftover references from uninstalled developer tools.".to_string(),
                recommendation: "Use the Repair Center to preview and safely remove dead PATH entries.".to_string(),
                safe_action_kind: Some(SafeActionKind::ReviewRepair),
                target_id: Some("stale_user_path".to_string()),
                evidence: vec![
                    FindingEvidenceItem {
                        label: "Missing Path Entries".to_string(),
                        value: health_report.path_diagnostics.missing_entries.to_string(),
                    },
                    FindingEvidenceItem {
                        label: "Total Path Entries".to_string(),
                        value: health_report.path_diagnostics.total_entries.to_string(),
                    },
                ],
            });
        }

        // Shadowed path conflicts
        for conflict in &health_report.path_diagnostics.conflicts {
            if !conflict.shadowed_paths.is_empty() {
                findings.push(WorkstationFinding {
                    id: format!("path-shadowed-{}", conflict.executable.to_lowercase()),
                    title: format!("Shadowed Executable Collision: {}", conflict.executable),
                    severity: FindingSeverity::Medium,
                    category: FindingCategory::Environment,
                    source_engine: "Developer Health Audit".to_string(),
                    summary: format!(
                        "Active '{}' at path '{}' shadows {} lower-priority installation(s).",
                        conflict.executable,
                        conflict.active_path,
                        conflict.shadowed_paths.len()
                    ),
                    explanation: conflict.explanation.clone(),
                    recommendation: "Ensure the active binary is intended or use Workspace Profiles to lock explicit toolchain versions per project.".to_string(),
                    safe_action_kind: Some(SafeActionKind::ReviewToolchain),
                    target_id: Some(conflict.executable.clone()),
                    evidence: vec![
                        FindingEvidenceItem {
                            label: "Active Path".to_string(),
                            value: conflict.active_path.clone(),
                        },
                        FindingEvidenceItem {
                            label: "Active Version".to_string(),
                            value: conflict.active_version.clone().unwrap_or_else(|| "Unknown".to_string()),
                        },
                        FindingEvidenceItem {
                            label: "Shadowed Count".to_string(),
                            value: conflict.shadowed_paths.len().to_string(),
                        },
                    ],
                });
            }
        }

        // 3. Toolchain Multiple Versions / Ambiguity (Only if genuinely ambiguous or unmanaged)
        for mult in &health_report.multiple_versions {
            if mult.status == HealthStatus::Warning || mult.status == HealthStatus::Critical {
                findings.push(WorkstationFinding {
                    id: format!("toolchain-multiple-{}", mult.tool_id.to_lowercase()),
                    title: format!("Multiple Ambiguous Installs of {}", mult.tool_name),
                    severity: match mult.status {
                        HealthStatus::Critical => FindingSeverity::High,
                        _ => FindingSeverity::Medium,
                    },
                    category: FindingCategory::Toolchain,
                    source_engine: "Toolchain Resolver".to_string(),
                    summary: format!(
                        "Identified {} installations of {} without an active manager binding.",
                        mult.versions.len(),
                        mult.tool_name
                    ),
                    explanation: mult.explanation.clone(),
                    recommendation: mult.suggested_action.clone(),
                    safe_action_kind: Some(SafeActionKind::ReviewToolchain),
                    target_id: Some(mult.tool_id.clone()),
                    evidence: vec![
                        FindingEvidenceItem {
                            label: "Active Version".to_string(),
                            value: mult.active_version.clone().unwrap_or_else(|| "None".to_string()),
                        },
                        FindingEvidenceItem {
                            label: "Detected Candidates".to_string(),
                            value: mult.versions.len().to_string(),
                        },
                    ],
                });
            }
        }
    }

    // 4. Project Compatibility (If project path provided)
    if let Some(proj_path) = optional_project_path {
        if !proj_path.trim().is_empty() {
            if let Ok(comp_check) = health_audit::audit_project_compatibility(proj_path.to_string()) {
                if comp_check.overall_status != HealthStatus::Healthy {
                    for req in &comp_check.requirements {
                        if req.satisfied == Some(false) {
                            findings.push(WorkstationFinding {
                                id: format!("proj-compat-{}-{}", comp_check.ecosystem.to_lowercase(), req.target.to_lowercase()),
                                title: format!("Unsatisfied Requirement: {} for {}", req.target, comp_check.project_name),
                                severity: match req.status {
                                    HealthStatus::Critical => FindingSeverity::High,
                                    _ => FindingSeverity::Medium,
                                },
                                category: FindingCategory::ProjectCompatibility,
                                source_engine: "Project Compatibility Engine".to_string(),
                                summary: format!(
                                    "Project requires {} '{}', but machine has '{}'.",
                                    req.target,
                                    req.required,
                                    req.machine_installed.as_deref().unwrap_or("None")
                                ),
                                explanation: req.notes.clone(),
                                recommendation: "Bind a compatible toolchain candidate using a Workspace Profile or install the required tool version.".to_string(),
                                safe_action_kind: Some(SafeActionKind::ReviewWorkspaceProfile),
                                target_id: Some(proj_path.to_string()),
                                evidence: vec![
                                    FindingEvidenceItem {
                                        label: "Target Tool".to_string(),
                                        value: req.target.clone(),
                                    },
                                    FindingEvidenceItem {
                                        label: "Required Constraint".to_string(),
                                        value: req.required.clone(),
                                    },
                                    FindingEvidenceItem {
                                        label: "Machine Version".to_string(),
                                        value: req.machine_installed.clone().unwrap_or_else(|| "Not Found".to_string()),
                                    },
                                ],
                            });
                        }
                    }
                }
            }

            // Also check profile validation for this project
            if let Ok(validation) = workspace_profile::validate_workspace_profile(proj_path.to_string()) {
                if !validation.is_valid {
                    for issue in &validation.binding_issues {
                        findings.push(WorkstationFinding {
                            id: format!("profile-binding-issue-{}", issue.tool.to_lowercase()),
                            title: format!("Stale Profile Binding: {}", issue.tool),
                            severity: match issue.severity {
                                workspace_profile::IssueSeverity::Critical => FindingSeverity::High,
                                workspace_profile::IssueSeverity::Warning => FindingSeverity::Medium,
                            },
                            category: FindingCategory::WorkspaceProfile,
                            source_engine: "Workspace Profile Manager".to_string(),
                            summary: issue.message.clone(),
                            explanation: format!(
                                "The project profile binds '{}' at '{}' expecting version '{}', but current executable version is '{}'.",
                                issue.tool,
                                issue.executable_path,
                                issue.expected_version.as_deref().unwrap_or("Unknown"),
                                issue.actual_version.as_deref().unwrap_or("Missing")
                            ),
                            recommendation: "Re-bind the toolchain installation in project settings to update the profile.".to_string(),
                            safe_action_kind: Some(SafeActionKind::ReviewWorkspaceProfile),
                            target_id: Some(proj_path.to_string()),
                            evidence: vec![
                                FindingEvidenceItem {
                                    label: "Expected Version".to_string(),
                                    value: issue.expected_version.clone().unwrap_or_else(|| "Unknown".to_string()),
                                },
                                FindingEvidenceItem {
                                    label: "Actual Version".to_string(),
                                    value: issue.actual_version.clone().unwrap_or_else(|| "Missing/Unreachable".to_string()),
                                },
                            ],
                        });
                    }
                }
            }
        }
    }

    // 5. Available Repair Actions Correlations
    if let Ok(available_repairs) = repair_engine::get_available_repairs() {
        for repair in available_repairs {
            if repair.available && repair.category == repair_engine::RepairCategory::DuplicateUserPath {
                findings.push(WorkstationFinding {
                    id: format!("repair-duplicate-path-{}", repair.id),
                    title: "Duplicate User PATH Entries Detected".to_string(),
                    severity: FindingSeverity::Low,
                    category: FindingCategory::Configuration,
                    source_engine: "Repair Engine".to_string(),
                    summary: repair.reason.clone(),
                    explanation: "Redundant entries in PATH increase environment search time and may cause unexpected binary lookup order.".to_string(),
                    recommendation: "Deduplicate user PATH entries using the Repair Center.".to_string(),
                    safe_action_kind: Some(SafeActionKind::ReviewRepair),
                    target_id: Some(repair.id.clone()),
                    evidence: vec![
                        FindingEvidenceItem {
                            label: "Affected Directory".to_string(),
                            value: repair.affected_item.clone(),
                        },
                    ],
                });
            }
        }
    }

    // Sort findings deterministically by Severity Rank (descending), then Category, then ID
    findings.sort_by(|a, b| {
        b.severity.rank().cmp(&a.severity.rank())
            .then_with(|| format!("{:?}", a.category).cmp(&format!("{:?}", b.category)))
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut counts = SeverityCounts::default();
    for f in &findings {
        match f.severity {
            FindingSeverity::Critical => counts.critical += 1,
            FindingSeverity::High => counts.high += 1,
            FindingSeverity::Medium => counts.medium += 1,
            FindingSeverity::Low => counts.low += 1,
            FindingSeverity::Info => counts.info += 1,
        }
    }

    let total = findings.len();

    WorkstationFindingsReport {
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        total_findings: total,
        counts,
        findings,
    }
}

// Tauri IPC Command Handler
#[tauri::command]
pub fn get_workstation_findings(
    project_path: Option<String>,
) -> WorkstationFindingsReport {
    generate_workstation_findings(project_path.as_deref())
}

// Tauri IPC Command Handler for Dashboard / Quick View
#[tauri::command]
pub fn get_workstation_intelligence_summary(
    project_path: Option<String>,
) -> WorkstationIntelligenceSummary {
    let report = generate_workstation_findings(project_path.as_deref());
    let top_findings = report.findings.iter().take(5).cloned().collect();

    WorkstationIntelligenceSummary {
        total_findings: report.total_findings,
        critical_count: report.counts.critical,
        high_count: report.counts.high,
        medium_count: report.counts.medium,
        low_count: report.counts.low,
        info_count: report.counts.info,
        top_findings,
    }
}

// =========================================================================
// Unit Tests
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workstation_findings_generation_runs_without_panic() {
        let report = generate_workstation_findings(None);
        assert!(report.generated_at > 0);
        // Total findings count must equal sum of severity counts
        let count_sum = report.counts.critical
            + report.counts.high
            + report.counts.medium
            + report.counts.low
            + report.counts.info;
        assert_eq!(report.total_findings, count_sum);
    }

    #[test]
    fn test_findings_deterministic_sorting() {
        let report = generate_workstation_findings(None);
        // Verify sorted by rank descending
        for i in 1..report.findings.len() {
            assert!(report.findings[i - 1].severity.rank() >= report.findings[i].severity.rank());
        }
    }

    #[test]
    fn test_intelligence_summary_returns_top_5() {
        let summary = get_workstation_intelligence_summary(None);
        assert!(summary.top_findings.len() <= 5);
        assert_eq!(summary.total_findings, summary.critical_count + summary.high_count + summary.medium_count + summary.low_count + summary.info_count);
    }
}
