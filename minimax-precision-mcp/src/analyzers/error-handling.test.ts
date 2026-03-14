import { describe, it, expect } from 'vitest';
import { ErrorHandlingAnalyzer } from './error-handling.js';

describe('ErrorHandlingAnalyzer', () => {
  const analyzer = new ErrorHandlingAnalyzer();

  it('detects .unwrap_or_default()', () => {
    const code = 'let x = result.unwrap_or_default();';
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(1);
    expect(issues[0].type).toBe('error_handling');
    expect(issues[0].message).toContain('unwrap_or_default');
  });

  it('detects .unwrap_or("")', () => {
    const code = 'let x = result.unwrap_or("");';
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('unwrap_or("")');
  });

  it('returns empty array for clean code', () => {
    const code = 'let x = result?;';
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(0);
  });
});
