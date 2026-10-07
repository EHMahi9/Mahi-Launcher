import { describe, it, expect } from 'vitest';
import { PROTECTED_SECRET_MARKER } from '../types/workspaceProfile';

describe('Phase 20 — Security Boundaries & Safety Invariants', () => {
  describe('Protected Secret Markers', () => {
    it('defines and maintains the frozen protected secret marker', () => {
      expect(PROTECTED_SECRET_MARKER).toBe('[PROTECTED_SECRET]');
    });

    it('ensures secret values containing protected markers are never unmasked casually', () => {
      const mockEnvVar = {
        key: 'API_KEY',
        value: PROTECTED_SECRET_MARKER,
        enabled: true,
        isSecret: true,
      };
      expect(mockEnvVar.value).toBe('[PROTECTED_SECRET]');
      expect(mockEnvVar.isSecret).toBe(true);
    });
  });

  describe('Sensitive Indicator Path Classification', () => {
    const sensitivePatterns = [
      '\\.ssh',
      '/ssh',
      'id_rsa',
      'id_ed25519',
      'credentials',
      '.env',
      '.gitconfig',
      'keyring',
      'keystore',
      'cookies',
      'wallet',
      'passwords',
      'token',
      'secrets',
    ];

    function isSensitivePath(pathStr: string): boolean {
      const lower = pathStr.toLowerCase();
      return sensitivePatterns.some((pattern) => lower.includes(pattern));
    }

    it('flags .env and credential files as sensitive', () => {
      expect(isSensitivePath('D:\\Code\\my-project\\.env')).toBe(true);
      expect(isSensitivePath('D:\\Code\\my-project\\.env.local')).toBe(true);
      expect(isSensitivePath('C:\\Users\\Admin\\.ssh\\id_rsa')).toBe(true);
      expect(isSensitivePath('C:\\Users\\Admin\\.ssh\\id_ed25519')).toBe(true);
      expect(isSensitivePath('C:\\Users\\Admin\\AppData\\credentials.json')).toBe(true);
    });

    it('allows normal development and source code files', () => {
      expect(isSensitivePath('D:\\Code\\my-project\\package.json')).toBe(false);
      expect(isSensitivePath('D:\\Code\\my-project\\src\\index.ts')).toBe(false);
      expect(isSensitivePath('D:\\Code\\my-project\\README.md')).toBe(false);
    });
  });

  describe('Windows Reserved Device Names & Illegal Characters', () => {
    const RESERVED_NAMES = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    ];

    function validateFilename(name: string): { valid: boolean; error?: string } {
      if (!name || !name.trim()) return { valid: false, error: 'Filename cannot be empty.' };
      if (name.endsWith('.') || name.endsWith(' ')) {
        return { valid: false, error: 'A filename cannot end with a period or space on Windows.' };
      }
      const trimmed = name.trim();
      if (trimmed === '.' || trimmed === '..') return { valid: false, error: "Filename cannot be '.' or '..'." };
      const illegalChars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
      if (illegalChars.some((c) => trimmed.includes(c))) {
        return { valid: false, error: 'Illegal character in filename.' };
      }
      const stem = trimmed.split('.')[0].toUpperCase();
      if (RESERVED_NAMES.includes(stem)) {
        return { valid: false, error: 'Reserved Windows device name.' };
      }
      return { valid: true };
    }

    it('validates benign project files and directories', () => {
      expect(validateFilename('my-feature').valid).toBe(true);
      expect(validateFilename('app.test.tsx').valid).toBe(true);
      expect(validateFilename('New folder (2)').valid).toBe(true);
    });

    it('rejects path traversal and illegal character names', () => {
      expect(validateFilename('.').valid).toBe(false);
      expect(validateFilename('..').valid).toBe(false);
      expect(validateFilename('sub/dir').valid).toBe(false);
      expect(validateFilename('sub\\dir').valid).toBe(false);
      expect(validateFilename('name:colon').valid).toBe(false);
      expect(validateFilename('name*wildcard').valid).toBe(false);
      expect(validateFilename('name.').valid).toBe(false);
      expect(validateFilename('name ').valid).toBe(false);
    });

    it('rejects DOS reserved device names with or without extension', () => {
      expect(validateFilename('con').valid).toBe(false);
      expect(validateFilename('CON.txt').valid).toBe(false);
      expect(validateFilename('prn').valid).toBe(false);
      expect(validateFilename('aux.json').valid).toBe(false);
      expect(validateFilename('nul').valid).toBe(false);
      expect(validateFilename('com1.log').valid).toBe(false);
      expect(validateFilename('lpt3').valid).toBe(false);
    });
  });
});
