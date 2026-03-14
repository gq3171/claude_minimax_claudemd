import { describe, it, expect } from 'vitest';
import { DeadCodeAnalyzer } from './dead-code.js';

describe('DeadCodeAnalyzer', () => {
  const analyzer = new DeadCodeAnalyzer();

  it('detects unused public function', () => {
    const code = `
pub fn unused_function() {}
pub fn main() {}
    `;
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('unused_function');
    expect(issues[0].type).toBe('dead_code');
    expect(issues[0].severity).toBe('warning');
  });

  it('ignores called functions', () => {
    const code = `
pub fn used_function() {}
pub fn main() { used_function(); }
    `;
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(0);
  });

  it('does not flag main or new as dead code', () => {
    const code = `
pub fn main() {}
pub fn new() {}
    `;
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(0);
  });

  it('detects unused TypeScript export function', () => {
    const code = `
export function helperFn() {}
export function main() {}
    `;
    const issues = analyzer.analyze(code, 'test.ts');
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('helperFn');
  });

  it('reports correct file path in issue location', () => {
    const code = `pub fn orphan() {}\npub fn main() {}\n`;
    const issues = analyzer.analyze(code, '/project/src/lib.rs');
    expect(issues.length).toBe(1);
    expect(issues[0].location.file).toBe('/project/src/lib.rs');
    expect(issues[0].location.line).toBeGreaterThan(0);
  });
});
