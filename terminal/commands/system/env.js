// env command — display environment (GNU-like subset; no command execution in jsh)
(function () {
  'use strict';

  registerCommand(
    'env',
    (terminal, args) => {
      const parsed = ShellUtils.parseEnvArgv(args);
      if (parsed.ok && parsed.help) {
        return {
          stdout: ShellUtils.ENV_HELP,
          stderr: '',
          exitCode: 0
        };
      }
      if (!parsed.ok) {
        return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
      }

      const rest = parsed.rest || [];
      const ignore = parsed.ignore === true;
      const unsetList = parsed.unset || [];

      /** @type {Record<string, string>} */
      let envVars = ignore ? {} : { ...terminal.getAllEnv() };

      for (const key of unsetList) {
        if (!key.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
          return {
            stdout: '',
            stderr: `env: '${key}': not a valid identifier\n`,
            exitCode: 1
          };
        }
        delete envVars[key];
      }

      for (const token of rest) {
        if (!token.includes('=')) {
          return {
            stdout: '',
            stderr: `env: cannot execute command in jsh: '${token}'\n`,
            exitCode: 127
          };
        }
        const eq = token.indexOf('=');
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (!key.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
          return {
            stdout: '',
            stderr: `env: '${key}': not a valid identifier\n`,
            exitCode: 1
          };
        }
        const cleanValue = value.replace(/^["']|["']$/g, '');
        envVars[key] = cleanValue;
      }

      const stdout = Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n');
      return { stdout, stderr: '', exitCode: 0 };
    },
    'display environment variables',
    'System'
  );
})();
