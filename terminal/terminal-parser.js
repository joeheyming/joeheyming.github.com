/**
 * Terminal pipeline parser/tokenizer mixin.
 *
 * Owns history expansion (`!!`, `!n`, `!str`), the pipe-segment splitter
 * (`parseCommand`), the per-segment redirection parser (`parseSegment`),
 * and the quote-aware tokenizer. Mixed into `TerminalPipelineMixin.prototype`
 * so consumers stay on the same `this` as the rest of the pipeline.
 */

import { ShellCore } from './lib/shell-core.js';

export const parserMethods = {
  expandHistory(command) {
    if (command.trim() === '!!') {
      if (this.commandHistory.length === 0) {
        throw new Error('jsh: !!: event not found');
      }
      return this.commandHistory[this.commandHistory.length - 1];
    }

    const historyMatch = command.match(/^!(\d+)$/);
    if (historyMatch) {
      const historyNumber = parseInt(historyMatch[1]);
      if (historyNumber < 1 || historyNumber > this.commandHistory.length) {
        throw new Error(`jsh: !${historyNumber}: event not found`);
      }
      return this.commandHistory[historyNumber - 1];
    }

    const stringMatch = command.match(/^!([a-zA-Z].*)$/);
    if (stringMatch) {
      const searchString = stringMatch[1];
      for (let i = this.commandHistory.length - 1; i >= 0; i--) {
        if (this.commandHistory[i].startsWith(searchString)) {
          return this.commandHistory[i];
        }
      }
      throw new Error(`jsh: !${searchString}: event not found`);
    }

    return command;
  },

  parseCommand(command) {
    const pipeSegments = command.split('|').map((seg) => seg.trim());

    const commandChain = [];

    for (let segment of pipeSegments) {
      const cmd = this.parseSegment(segment);
      commandChain.push(cmd);
    }

    return commandChain;
  },

  parseSegment(segment) {
    const tokens = ShellCore.mergeRedirectDupStderrTokens(this.tokenize(segment));
    const cmd = {
      name: '',
      args: [],
      redirections: {
        stdout: null,
        stderr: null,
        stdin: null,
        append: false,
        stderrToStdout: false
      }
    };

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdout = ShellCore.normalizeRedirectFilename(raw);
          cmd.redirections.append = false;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >');
        }
      } else if (token === '>>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdout = ShellCore.normalizeRedirectFilename(raw);
          cmd.redirections.append = true;
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after >>');
        }
      } else if (token === '2>') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stderr = ShellCore.normalizeRedirectFilename(raw);
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after 2>');
        }
      } else if (token === '2>&1') {
        cmd.redirections.stderrToStdout = true;
        i += 1;
      } else if (token === '<') {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1];
          if (ShellCore.isEmptyRedirectTarget(raw)) {
            throw new Error('Syntax error: empty redirect target');
          }
          cmd.redirections.stdin = ShellCore.normalizeRedirectFilename(raw);
          i += 2;
        } else {
          throw new Error('Syntax error: expected filename after <');
        }
      } else {
        if (cmd.name === '') {
          cmd.name = token;
        } else {
          cmd.args.push(token);
        }
        i++;
      }
    }

    return cmd;
  },

  tokenize(segment) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && /\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else if (!inQuotes && (char === '>' || char === '<')) {
        if (current) {
          tokens.push(current);
          current = '';
        }

        if (char === '>' && i + 1 < segment.length && segment[i + 1] === '>') {
          tokens.push('>>');
          i++;
        } else if (char === '>' && i > 0 && segment[i - 1] === '2') {
          if (tokens.length > 0 && tokens[tokens.length - 1].endsWith('2')) {
            const lastToken = tokens.pop();
            if (lastToken.length > 1) {
              tokens.push(lastToken.slice(0, -1));
            }
          }
          tokens.push('2>');
        } else {
          tokens.push(char);
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }
};
