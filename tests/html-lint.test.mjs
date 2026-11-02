import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintHtml } from '../scripts/html-lint.mjs';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Ok</title>
<style>
  b { color: red; }
</style>
</head>
<body>
<p class="my-class" style="color: red"><b>Hi</b></p>
<img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
<a href="https://example.com" target="_blank" rel="noopener noreferrer">Go</a>
</body>
</html>
`;

test('site markup that the stock preset rejects is allowed', async () => {
  const issues = await lintHtml(PAGE);
  assert.deepEqual(
    issues.map((issue) => issue.message),
    []
  );
});

test('obsolete frameborder is rejected', async () => {
  const issues = await lintHtml(
    PAGE.replace('<b>Hi</b>', '<iframe frameborder="0" title="Clip"></iframe>')
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'E001');
});
