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

  it('detects #![allow(dead_code)] crate-level suppressor as error', () => {
    const code = '#![allow(dead_code)]\npub fn foo() {}';
    const issues = analyzer.analyze(code, 'src/lib.rs');
    const crateIssues = issues.filter(i => i.message.includes('#![allow(dead_code)]'));
    expect(crateIssues.length).toBe(1);
    expect(crateIssues[0].severity).toBe('error');
    expect(crateIssues[0].location.line).toBe(1);
  });

  it('detects #![allow(unused_variables)] as error', () => {
    const code = '#![allow(unused_variables)]\nfn main() { let x = 1; }';
    const issues = analyzer.analyze(code, 'src/main.rs');
    const crateIssues = issues.filter(i => i.message.includes('unused_variables'));
    expect(crateIssues.length).toBe(1);
    expect(crateIssues[0].severity).toBe('error');
  });

  it('detects let _name = expr as error', () => {
    const code = [
      'async fn plan_tasks(&self) -> Result<Vec<Task>> {',
      '    let _response = provider.chat(messages).await?;',
      '    Ok(vec![])',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/agent.rs');
    const discardIssues = issues.filter(i => i.message.includes('discards the computed value'));
    expect(discardIssues.length).toBe(1);
    expect(discardIssues[0].severity).toBe('error');
    expect(discardIssues[0].message).toContain('_response');
  });

  it('does not flag let _name inside test block', () => {
    const code = [
      '#[cfg(test)]',
      'mod tests {',
      '  #[test]',
      '  fn test_foo() {',
      '    let _result = compute();',
      '  }',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/lib.rs');
    const discardIssues = issues.filter(i => i.message.includes('discards the computed value'));
    expect(discardIssues.length).toBe(0);
  });

  it('detects single-line None stub return as warning', () => {
    const code = [
      'fn get_agent(&self, task: TaskType) -> Option<&dyn SubAgent> {',
      '    None',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/executor.rs');
    const stubIssues = issues.filter(i => i.message.includes('stub return'));
    expect(stubIssues.length).toBe(1);
    expect(stubIssues[0].severity).toBe('warning');
  });

  it('detects single-line Ok(vec![]) stub return as warning', () => {
    const code = [
      'fn list_tasks(&self) -> Result<Vec<Task>> {',
      '    Ok(vec![])',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/runner.rs');
    const stubIssues = issues.filter(i => i.message.includes('stub return'));
    expect(stubIssues.length).toBe(1);
    expect(stubIssues[0].severity).toBe('warning');
  });

  it('detects .unwrap_or(StructLiteral { ... }) fake data fallback as error', () => {
    const code = [
      'let result: ReviewResult = serde_json::from_str(&response)',
      '    .unwrap_or(ReviewResult {',
      '        score: 5.0,',
      '        issues: vec!["parse failed".to_string()],',
      '    });',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/reviewer.rs');
    const fakeDataIssues = issues.filter(i => i.message.includes('fake data'));
    expect(fakeDataIssues.length).toBe(1);
    expect(fakeDataIssues[0].severity).toBe('error');
    expect(fakeDataIssues[0].message).toContain('StructLiteral');
  });

  it('detects .unwrap_or(TypeName::new()) fake fallback as error', () => {
    const code = 'let cfg = load_config().unwrap_or(Config::new());';
    const issues = analyzer.analyze(code, 'src/main.rs');
    const fakeDataIssues = issues.filter(i => i.message.includes('fake data'));
    expect(fakeDataIssues.length).toBe(1);
    expect(fakeDataIssues[0].severity).toBe('error');
  });

  it('does not flag .unwrap_or(5) as fake struct fallback', () => {
    const code = 'let x = opt.unwrap_or(5);';
    const issues = analyzer.analyze(code, 'src/lib.rs');
    const fakeDataIssues = issues.filter(i => i.message.includes('fake data'));
    expect(fakeDataIssues.length).toBe(0);
  });

  it('detects .unwrap_or(json!({ "approved": true })) as error', () => {
    const code = [
      'let result: Value = serde_json::from_str(&resp)',
      '    .unwrap_or(serde_json::json!({',
      '        "approved": true,',
      '        "score": 80',
      '    }));',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/reviewer.rs');
    const fakeDataIssues = issues.filter(i => i.message.includes('JSON object'));
    expect(fakeDataIssues.length).toBe(1);
    expect(fakeDataIssues[0].severity).toBe('error');
  });

  it('detects .unwrap_or(json!({ with shorthand macro', () => {
    const code = 'let v = parse().unwrap_or(json!({ "ok": true }));';
    const issues = analyzer.analyze(code, 'src/agent.rs');
    const fakeDataIssues = issues.filter(i => i.message.includes('JSON object'));
    expect(fakeDataIssues.length).toBe(1);
  });

  it('warns when test only checks assert!(result.is_ok()) without value assertions', () => {
    const code = [
      'fn generate_concept(s: &str) -> Result<String, ()> { Ok(s.to_string()) }',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '    #[test]',
      '    fn test_generate() {',
      '        let result = generate_concept("test");',
      '        assert!(result.is_ok());',
      '    }',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/agents.rs');
    const weakAsserts = issues.filter(i =>
      i.message.includes('assert!(x.is_ok())')
    );
    expect(weakAsserts.length).toBe(1);
    expect(weakAsserts[0].severity).toBe('warning');
  });

  it('does not warn when test checks is_ok() and also has assert_eq!', () => {
    const code = [
      'fn generate_concept(s: &str) -> Result<String, ()> { Ok(s.to_string()) }',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '    #[test]',
      '    fn test_generate() {',
      '        let result = generate_concept("test");',
      '        assert!(result.is_ok());',
      '        assert_eq!(result.unwrap(), "test");',
      '    }',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/agents.rs');
    const weakAsserts = issues.filter(i =>
      i.message.includes('assert!(x.is_ok())')
    );
    expect(weakAsserts.length).toBe(0);
  });

  it('warns when test only checks assert!(result.is_some()) without value assertions', () => {
    const code = [
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn test_find() {',
      '        let result = find_item(42);',
      '        assert!(result.is_some());',
      '    }',
      '}',
    ].join('\n');
    const issues = analyzer.analyze(code, 'src/lib.rs');
    const weakAsserts = issues.filter(i =>
      i.message.includes('assert!(x.is_ok())') || i.message.includes('assert!(x.is_some())')
    );
    expect(weakAsserts.length).toBe(1);
    expect(weakAsserts[0].severity).toBe('warning');
  });
});
