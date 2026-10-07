// Phase 9C-B: Toolchain Resolution Engine — TypeScript types
// Mirrors src-tauri/src/toolchain.rs (serde camelCase + SCREAMING_SNAKE_CASE enums)

// ──────────────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────────────

/** How a toolchain executable was discovered on the machine. */
export type DetectionSource =
  | 'SYSTEM_PATH'
  | 'ENVIRONMENT_VARIABLE'
  | 'STANDARD_DIRECTORY'
  | 'VERSION_MANAGER'
  | 'PROJECT_LOCAL_ENV';

/**
 * Resolution status of a tool relative to a project requirement.
 *
 * - ACTIVE              — first/active installation satisfies the requirement
 * - COMPATIBLE          — a non-active installation satisfies the requirement
 * - MISMATCH            — installed but no installation satisfies the constraint
 * - MISSING             — no installation found at all
 * - UNKNOWN             — cannot determine (no constraint or probe failed)
 * - MULTIPLE_INSTALLATIONS — active satisfies + at least one more compatible
 */
export type ResolutionStatus =
  | 'ACTIVE'
  | 'COMPATIBLE'
  | 'MISMATCH'
  | 'MISSING'
  | 'UNKNOWN'
  | 'MULTIPLE_INSTALLATIONS';

/**
 * Strength/type of the evidence behind a ProjectRequirement.
 *
 * - EXPLICIT_PROJECT_TOOLCHAIN — declared in rust-toolchain.toml, .tool-versions, .nvmrc, etc.
 * - DECLARED_COMPATIBILITY     — declared compatibility range in manifest (Cargo rust-version, pyproject requires-python)
 * - ADVISORY                   — advisory hint only, not universally enforced (npm engines)
 * - HEURISTIC                  — inferred from lock file presence (pnpm-lock.yaml → pnpm preferred)
 * - UNKNOWN                    — source unknown or unparseable
 */
export type EvidenceType =
  | 'EXPLICIT_PROJECT_TOOLCHAIN'
  | 'DECLARED_COMPATIBILITY'
  | 'ADVISORY'
  | 'HEURISTIC'
  | 'UNKNOWN';

// ──────────────────────────────────────────────────────────────────────────
// Core structs
// ──────────────────────────────────────────────────────────────────────────

/** One concrete installation of a developer tool found on disk. */
export interface ToolInstallation {
  /** Stable unique ID: "{toolId}::{canonicalPath}" */
  id: string;
  /** Tool identifier, e.g. "node", "python", "java", "cargo" */
  tool: string;
  /** Cleaned version string (e.g. "20.11.0"). null if probe failed. */
  version: string | null;
  /** Absolute, canonical path to the executable. */
  executablePath: string;
  /** How this installation was discovered. */
  detectionSource: DetectionSource;
  /** Index in PATH if discovered via PATH (0-based). null otherwise. */
  pathIndex: number | null;
  /**
   * True if this is the first/active executable that would be used in a
   * plain shell invocation.
   */
  isActive: boolean;
  /** True if the executable exists and responded to a version probe. */
  isVerified: boolean;
  /** Human-readable description of how version was verified. */
  verificationMethod: string;
  /** Human-readable discovery evidence for UI display. */
  evidence: string;
}

/** A toolchain requirement extracted from a project manifest. */
export interface ProjectRequirement {
  /** Tool identifier (same namespace as ToolInstallation.tool). */
  tool: string;
  /** Human-readable version constraint as written in the manifest. */
  versionConstraint: string | null;
  /** Parsed lower bound [major, minor, patch]. null if unparseable. */
  minVersion: [number, number, number] | null;
  /** Source file that declared this requirement. */
  sourceFile: string;
  /** Raw excerpt from the source file for UI display. */
  rawEvidence: string;
  /** Strength of the evidence. */
  evidenceType: EvidenceType;
  /** For advisory requirements, a human-readable note. */
  advisoryNote: string | null;
  /**
   * For Java requirements, distinguishes runtime from build-system JDK.
   * "RUNTIME" | "BUILD_JDK" | null
   *
   * NOTE: Gradle toolchain and Maven compiler source/target are BUILD_JDK.
   * Changing JAVA_HOME does NOT necessarily change which JDK Gradle uses.
   */
  javaContext: string | null;
}

/** Human-readable explanation produced by the resolver. */
export interface ResolutionExplanation {
  /** One-line summary suitable for table display. */
  headline: string;
  /** Longer explanation for detail view. */
  detail: string;
  /** Optional actionable suggestion for MISMATCH / MISSING. */
  suggestion: string | null;
  /** True when the underlying requirement is ADVISORY (e.g. npm engines). */
  isAdvisoryOnly: boolean;
}

/** Resolution result for one tool relative to one project. */
export interface ToolResolutionResult {
  tool: string;
  status: ResolutionStatus;
  activeInstallation: ToolInstallation | null;
  compatibleInstallations: ToolInstallation[];
  allInstallations: ToolInstallation[];
  requirement: ProjectRequirement | null;
  explanation: ResolutionExplanation;
}

/** Full toolchain resolution report for one project directory. */
export interface ProjectToolchainReport {
  projectPath: string;
  /** Unix timestamp (seconds) when the report was generated. */
  generatedAt: number;
  results: ToolResolutionResult[];
  requirementsFound: number;
  missingCount: number;
  mismatchCount: number;
  compatibleCount: number;
}
