(function () {
  const results = [];

  function log(status, name, detail) {
    results.push({ status, name, detail: detail || '' });
  }

  function stringify(value) {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || 'Expected equal') + ` | actual=${stringify(actual)} expected=${stringify(expected)}`);
    }
  }

  async function runTests(definitions) {
    for (const testCase of definitions) {
      try {
        await testCase.run();
        log('PASS', testCase.name);
      } catch (error) {
        log('FAIL', testCase.name, error && error.message ? error.message : String(error));
      }
    }

    const output = document.getElementById('test-output') || document.body.appendChild(document.createElement('pre'));
    output.id = 'test-output';
    output.textContent = results
      .map((item) => `${item.status}: ${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
      .join('\n');

    const failed = results.filter((item) => item.status === 'FAIL');
    const summary = document.createElement('div');
    summary.id = 'test-summary';
    summary.textContent = failed.length === 0 ? 'TEST_PASS' : `TEST_FAIL (${failed.length})`;
    document.body.appendChild(summary);
  }

  window.TestHarness = {
    assert,
    assertEqual,
    runTests,
  };
})();
