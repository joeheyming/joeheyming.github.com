// Recovery / pseudo-tool-call parsing tests for chat/chat-client.js.
//
// These fixtures are every flavor of "tried to call a tool but didn't
// use the structured channel" that we've seen WebLLM + Hermes-3 emit
// in production logs. Each test pins one shape so a future tweak to
// the parser can't silently regress it.
//
// If you're adding a new fixture: copy the EXACT model output from
// the browser console (chat-client.js logs `contentPreview`) and
// drop it in. Don't paraphrase — the parser is shape-sensitive and
// paraphrased fixtures stop being a useful regression check.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __internals } from '../chat/chat-client.js';
import { TOOLS, getToolDefinitions } from '../chat/tools.js';

const {
  detectPartialToolCallAttempt,
  extractToolCallFromText,
  parseCallArgs,
  parsePositionalArgs,
  splitTopLevelArgs,
  unescapeJsString
} = __internals;

const codeIdeTools = getToolDefinitions(['readFile', 'createFile', 'applyEdit', 'listFiles']);
const desktopTools = getToolDefinitions(['launchApp', 'notify', 'listApps', 'webFetch']);

describe('parsePositionalArgs', () => {
  it('returns [] for empty', () => {
    assert.deepEqual(parsePositionalArgs(''), []);
  });

  it('handles a single quoted string', () => {
    assert.deepEqual(parsePositionalArgs('"hello"'), ['hello']);
  });

  it('handles two quoted args', () => {
    assert.deepEqual(parsePositionalArgs('"/foo.cpp", "int main(){}"'), [
      '/foo.cpp',
      'int main(){}'
    ]);
  });

  it('interprets JS escapes in quoted strings', () => {
    const r = parsePositionalArgs('"/x.sh", "#!/bin/bash\\n\\necho hi"');
    assert.equal(r[0], '/x.sh');
    assert.equal(r[1], '#!/bin/bash\n\necho hi');
  });

  it('parses JSON literals (numbers, arrays, objects)', () => {
    assert.deepEqual(parsePositionalArgs('1, true, [1,2], {"a":1}'), [1, true, [1, 2], { a: 1 }]);
  });

  it('respects nested brackets when splitting on commas', () => {
    assert.deepEqual(parsePositionalArgs('"/x", [{"search":"a,b","replace":"c,d"}]'), [
      '/x',
      [{ search: 'a,b', replace: 'c,d' }]
    ]);
  });

  it('returns null when the content looks like keyword args', () => {
    assert.equal(parsePositionalArgs('path="x", content="y"'), null);
    assert.equal(parsePositionalArgs('path: "x"'), null);
  });

  it('handles single-quoted strings', () => {
    assert.deepEqual(parsePositionalArgs("'/foo.py', 'print(1)'"), ['/foo.py', 'print(1)']);
  });
});

describe('unescapeJsString', () => {
  it('handles common escapes', () => {
    assert.equal(unescapeJsString('a\\nb'), 'a\nb');
    assert.equal(unescapeJsString('\\t'), '\t');
    assert.equal(unescapeJsString('\\\\'), '\\');
    assert.equal(unescapeJsString('\\"'), '"');
  });

  it('handles \\xNN', () => {
    assert.equal(unescapeJsString('\\x41'), 'A');
  });

  it('handles \\uNNNN', () => {
    assert.equal(unescapeJsString('\\u00e9'), 'é');
  });

  it('passes unknown escapes through as the next char', () => {
    assert.equal(unescapeJsString('\\q'), 'q');
  });
});

describe('splitTopLevelArgs', () => {
  it('returns [] for empty', () => {
    assert.deepEqual(splitTopLevelArgs(''), []);
  });

  it('respects strings and nested braces', () => {
    assert.deepEqual(
      splitTopLevelArgs('"/x", { content: "a, b" }, [1,2]'),
      ['"/x"', '{ content: "a, b" }', '[1,2]']
    );
  });
});

describe('parseCallArgs (call-args router)', () => {
  const createFileParams = ['path', 'content', 'dryRun'];
  const applyEditParams = ['path', 'edits', 'dryRun'];
  const launchAppParams = ['appId'];

  it('handles pure positional', () => {
    assert.deepEqual(parseCallArgs('"/x.cpp", "int main(){}"', createFileParams), {
      path: '/x.cpp',
      content: 'int main(){}'
    });
  });

  it('handles single positional', () => {
    assert.deepEqual(parseCallArgs('"paint"', launchAppParams), { appId: 'paint' });
  });

  it('handles pure kwargs object', () => {
    assert.deepEqual(
      parseCallArgs('{"path":"/x.cpp","content":"int main(){}"}', createFileParams),
      { path: '/x.cpp', content: 'int main(){}' }
    );
  });

  it('handles unquoted-key kwargs object', () => {
    assert.deepEqual(
      parseCallArgs('{path: "/x.cpp", content: "int main(){}"}', createFileParams),
      { path: '/x.cpp', content: 'int main(){}' }
    );
  });

  it('handles Python-style kwargs (key=value pairs)', () => {
    assert.deepEqual(parseCallArgs('path="/x.py", content="print(1)"', createFileParams), {
      path: '/x.py',
      content: 'print(1)'
    });
  });

  it('handles mixed: positional + trailing kwargs object', () => {
    // The 2026-05-19 prod log: tool_calls\ncreateFile("/src/main.js", { content: "/** ... */\n" })
    const r = parseCallArgs(
      '"/src/main.js", { content: "/** Entry point for the Code IDE application. */\\n" }',
      createFileParams
    );
    assert.deepEqual(r, {
      path: '/src/main.js',
      content: '/** Entry point for the Code IDE application. */\n'
    });
  });

  it('handles mixed: positional + trailing kwarg (key=value)', () => {
    const r = parseCallArgs('"/z.md", content="# hi"', createFileParams);
    assert.deepEqual(r, { path: '/z.md', content: '# hi' });
  });

  it('handles positional path + array of edits', () => {
    const r = parseCallArgs(
      '"/main.py", [{"search":"print(1)","replace":"print(42)"}]',
      applyEditParams
    );
    assert.deepEqual(r, {
      path: '/main.py',
      edits: [{ search: 'print(1)', replace: 'print(42)' }]
    });
  });

  it('kwargs override positional if both supplied for the same slot', () => {
    const r = parseCallArgs('"/wrong.cpp", path="/right.cpp", content="x"', createFileParams);
    assert.equal(r.path, '/right.cpp');
    assert.equal(r.content, 'x');
  });

  it('returns {} for empty args', () => {
    assert.deepEqual(parseCallArgs('', createFileParams), {});
  });
});

describe('extractToolCallFromText — production failure modes', () => {
  it('extracts the multi-arg positional createFile (the bash-hello-world log)', () => {
    // Pulled verbatim from the 2026-05-18 browser console:
    //   contentPreview: 'tool_calls\ncreateFile(...)'
    const text =
      'tool_calls\ncreateFile("/home/joe/Documents/bin/hello.sh", "#!/bin/bash\\n\\necho Hello World")';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r, 'expected a tool call to be extracted');
    assert.equal(r.name, 'createFile');
    const args = JSON.parse(r.arguments);
    assert.equal(args.path, '/home/joe/Documents/bin/hello.sh');
    assert.equal(args.content, '#!/bin/bash\n\necho Hello World');
  });

  it('extracts createFile with object-literal args', () => {
    const text = 'createFile({path: "/hello.cpp", content: "int main(){}"})';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'createFile');
    const args = JSON.parse(r.arguments);
    assert.equal(args.path, '/hello.cpp');
    assert.equal(args.content, 'int main(){}');
  });

  it('extracts createFile with kwarg style', () => {
    const text = 'createFile(path="/x.py", content="print(1)")';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r);
    const args = JSON.parse(r.arguments);
    assert.equal(args.path, '/x.py');
    assert.equal(args.content, 'print(1)');
  });

  it('extracts the mixed positional+kwargs-object createFile (the JSDoc-comment log)', () => {
    // Verbatim from 2026-05-19 browser console:
    //   contentPreview: 'tool_calls\ncreateFile("/src/main.js", { content: "...entry point for the Code IDE application. */\\n" })'
    const text =
      'tool_calls\ncreateFile("/src/main.js", { content: "/** Entry point for the Code IDE application. */\\n" })';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r, 'expected the mixed positional+kwargs call to be recovered');
    assert.equal(r.name, 'createFile');
    const args = JSON.parse(r.arguments);
    assert.equal(args.path, '/src/main.js');
    assert.equal(args.content, '/** Entry point for the Code IDE application. */\n');
  });

  it('extracts launchApp with positional single string', () => {
    const text = 'launchApp("paint")';
    const r = extractToolCallFromText(text, desktopTools);
    assert.ok(r);
    assert.equal(r.name, 'launchApp');
    assert.equal(JSON.parse(r.arguments).appId, 'paint');
  });

  it('extracts Hermes <tool_call>{...}</tool_call> format', () => {
    const text =
      '<tool_call>{"name":"createFile","arguments":{"path":"/x.cpp","content":"int main(){}"}}</tool_call>';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'createFile');
  });

  it('extracts an applyEdit with positional array of edits', () => {
    const text = 'applyEdit("/main.py", [{"search":"print(1)","replace":"print(42)"}])';
    const r = extractToolCallFromText(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'applyEdit');
    const args = JSON.parse(r.arguments);
    assert.equal(args.path, '/main.py');
    assert.deepEqual(args.edits, [{ search: 'print(1)', replace: 'print(42)' }]);
  });

  it('returns null on free-form prose with no tool name', () => {
    const text = "Sure, I'll write a hello world program for you.";
    assert.equal(extractToolCallFromText(text, codeIdeTools), null);
  });

  it('returns null on prose that mentions a tool but has no args', () => {
    const text = 'I would use createFile here.';
    assert.equal(extractToolCallFromText(text, codeIdeTools), null);
  });
});

describe('detectPartialToolCallAttempt', () => {
  it('flags createFile() with no args at all', () => {
    const text = 'createFile()';
    const r = detectPartialToolCallAttempt(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'createFile');
    assert.deepEqual(r.missing.sort(), ['content', 'path']);
  });

  it('flags createFile("path") with only path positionally', () => {
    const text = 'tool_calls\ncreateFile("/HelloWorld.java")';
    const r = detectPartialToolCallAttempt(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'createFile');
    assert.deepEqual(r.missing, ['content']);
  });

  it('does NOT flag createFile("path","content") as missing content', () => {
    // This is the false-positive bug from the 2026-05-18 prod log:
    // both args were present but detector said "missing: []" while
    // extractor still returned null because the parser didn't grok
    // positional args. Now the parser handles it AND the detector
    // counts positional args, so this should be treated as "well-
    // formed enough" and no retry is needed.
    const text =
      'tool_calls\ncreateFile("/home/joe/Documents/bin/hello.sh", "#!/bin/bash\\n\\necho Hello World")';
    const detected = detectPartialToolCallAttempt(text, codeIdeTools);
    if (detected) assert.deepEqual(detected.missing, []);
    const extracted = extractToolCallFromText(text, codeIdeTools);
    assert.ok(extracted, 'extractor must recover this case');
    assert.equal(extracted.name, 'createFile');
  });

  it('does NOT flag mixed createFile("path", {content: "..."}) as missing content', () => {
    // 2026-05-19 prod log — Python-style positional+kwargs object.
    const text =
      'tool_calls\ncreateFile("/src/main.js", { content: "/** Entry point for the Code IDE application. */\\n" })';
    const detected = detectPartialToolCallAttempt(text, codeIdeTools);
    if (detected) assert.deepEqual(detected.missing, []);
    const extracted = extractToolCallFromText(text, codeIdeTools);
    assert.ok(extracted, 'extractor must recover this case');
    assert.equal(extracted.name, 'createFile');
    const args = JSON.parse(extracted.arguments);
    assert.equal(args.path, '/src/main.js');
    assert.equal(args.content, '/** Entry point for the Code IDE application. */\n');
  });

  it('flags section/YAML form `tool_calls:\\n- call: createFile\\n  args:\\n    path: ...` with missing content', () => {
    const text =
      'tool_calls:\n- call: createFile\n  args:\n    path: /hello.py';
    const r = detectPartialToolCallAttempt(text, codeIdeTools);
    assert.ok(r);
    assert.equal(r.name, 'createFile');
    assert.ok(r.missing.includes('content'));
  });

  it('returns null on pure prose with no tool reference', () => {
    assert.equal(
      detectPartialToolCallAttempt('Sure! I can help with that.', codeIdeTools),
      null
    );
  });

  it('returns null on a structured-looking call that the extractor can already handle', () => {
    // detectPartialToolCallAttempt is the LAST resort; if the
    // extractor produces a valid call we shouldn't ALSO flag a
    // retry. The runChatTurn loop only consults detectPartial
    // when extractToolCallFromText returned null, but make sure
    // detectPartial itself isn't TOO eager for clean inputs.
    const xml = '<tool_call>{"name":"createFile","arguments":{"path":"/x.cpp","content":"int main(){}"}}</tool_call>';
    const r = detectPartialToolCallAttempt(xml, codeIdeTools);
    // Either null OR (if flagged) with empty missing list — never
    // claim that fully-supplied args are missing.
    if (r) assert.deepEqual(r.missing, []);
  });
});

describe('end-to-end: extract then validate against tool schemas', () => {
  const fixtures = [
    {
      label: 'multi-arg positional createFile',
      text:
        'tool_calls\ncreateFile("/x.sh", "#!/bin/bash\\necho hi\\n")',
      expected: { name: 'createFile', path: '/x.sh', content: '#!/bin/bash\necho hi\n' }
    },
    {
      label: 'object-literal createFile',
      text: 'createFile({"path":"/y.py","content":"print(1)"})',
      expected: { name: 'createFile', path: '/y.py', content: 'print(1)' }
    },
    {
      label: 'kwarg createFile',
      text: 'createFile(path="/z.md", content="# hi")',
      expected: { name: 'createFile', path: '/z.md', content: '# hi' }
    },
    {
      label: 'mixed positional+kwargs-object createFile',
      text:
        'tool_calls\ncreateFile("/src/main.js", { content: "/** Entry point. */\\n" })',
      expected: { name: 'createFile', path: '/src/main.js', content: '/** Entry point. */\n' }
    }
  ];

  for (const fx of fixtures) {
    it(`${fx.label}: produces args that satisfy schema`, () => {
      const r = extractToolCallFromText(fx.text, codeIdeTools);
      assert.ok(r, `extractor returned null for ${fx.label}`);
      assert.equal(r.name, fx.expected.name);
      const args = JSON.parse(r.arguments);
      assert.equal(args.path, fx.expected.path);
      assert.equal(args.content, fx.expected.content);
      const required = TOOLS[fx.expected.name].definition.function.parameters.required || [];
      for (const k of required) {
        assert.ok(args[k] != null && args[k] !== '', `${fx.label}: missing required ${k}`);
      }
    });
  }
});
