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
  });

  it('ignores called functions', () => {
    const code = `
pub fn used_function() {}
pub fn main() { used_function(); }
    `;
    const issues = analyzer.analyze(code, 'test.rs');
    expect(issues.length).toBe(0);
  });
});
