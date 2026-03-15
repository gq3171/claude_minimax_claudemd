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

  it('detects 3+ #[allow(dead_code)] as error', () => {
    const code = [
      '#[allow(dead_code)]',
      'struct A {}',
      '#[allow(dead_code)]',
      'struct B {}',
      '#[allow(dead_code)]',
      'struct C {}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'lib.rs');
    const deadCodeIssues = issues.filter(i => i.message.includes('#[allow(dead_code)]'));
    expect(deadCodeIssues.length).toBe(1);
    expect(deadCodeIssues[0].severity).toBe('error');
    expect(deadCodeIssues[0].message).toContain('3');
  });

  it('detects 1-2 #[allow(dead_code)] as warning', () => {
    const code = '#[allow(dead_code)]\nstruct A {}';
    const issues = analyzer.analyze(code, 'lib.rs');
    const deadCodeIssues = issues.filter(i => i.message.includes('#[allow(dead_code)]'));
    expect(deadCodeIssues.length).toBe(1);
    expect(deadCodeIssues[0].severity).toBe('warning');
  });

  it('detects .unwrap() after Result-producing operation as error', () => {
    const code = 'let x = something.map_err(|e| MyError(e)).unwrap();';
    const issues = analyzer.analyze(code, 'lib.rs');
    const unwrapIssues = issues.filter(i => i.message.includes('.unwrap() after'));
    expect(unwrapIssues.length).toBe(1);
    expect(unwrapIssues[0].severity).toBe('error');
  });

  it('detects .build().unwrap() as error', () => {
    const code = 'let req = RequestArgs::default().build().unwrap();';
    const issues = analyzer.analyze(code, 'src/client.rs');
    const unwrapIssues = issues.filter(i => i.message.includes('.unwrap() after'));
    expect(unwrapIssues.length).toBe(1);
    expect(unwrapIssues[0].severity).toBe('error');
  });

  it('detects plain .unwrap() as warning', () => {
    const code = 'let val = opt.unwrap();';
    const issues = analyzer.analyze(code, 'src/app.rs');
    const unwrapIssues = issues.filter(i => i.message.includes('will panic'));
    expect(unwrapIssues.length).toBe(1);
    expect(unwrapIssues[0].severity).toBe('warning');
  });

  it('does not flag .unwrap() inside test block', () => {
    const code = [
      'fn production_code() -> i32 { 42 }',
      '#[cfg(test)]',
      'mod tests {',
      '  #[test]',
      '  fn test_something() {',
      '    let x = Some(1).unwrap();',
      '    assert_eq!(x, 1);',
      '  }',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/lib.rs');
    const unwrapIssues = issues.filter(i => i.message.includes('will panic') || i.message.includes('.unwrap() after'));
    expect(unwrapIssues.length).toBe(0);
  });
});
