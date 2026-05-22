/** @typedef {{ type: string, [key: string]: unknown }} AstNode */

const FUNS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'ln',
  'log',
  'abs',
  'exp'
]);

/**
 * @param {string} source
 * @returns {{ evaluate: (x: number) => number } | { error: string }}
 */
export function compileExpression(source) {
  const raw = source.trim();
  if (!raw) {
    return { error: 'Empty expression' };
  }
  try {
    const tokens = tokenize(raw);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return {
      evaluate: (x) => evalAst(ast, x)
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid expression';
    return { error: message };
  }
}

/**
 * @param {string} input
 * @returns {{ type: string, value: string | number }[]}
 */
function tokenize(input) {
  /** @type {{ type: string, value: string | number }[]} */
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = ch;
      i += 1;
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i += 1;
      }
      const value = Number(num);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number: ${num}`);
      }
      tokens.push({ type: 'number', value });
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      let name = ch;
      i += 1;
      while (i < input.length && /[a-z0-9]/i.test(input[i])) {
        name += input[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value: name.toLowerCase() });
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      if (ch === '*' && input[i + 1] === '*') {
        tokens.push({ type: 'op', value: '^' });
        i += 2;
        continue;
      }
      tokens.push({ type: ch === ',' ? 'comma' : 'op', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

class Parser {
  /**
   * @param {{ type: string, value: string | number }[]} tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  parse() {
    const node = this.parseExpr();
    if (this.peek().type !== 'eof') {
      throw new Error('Unexpected token after expression');
    }
    return node;
  }

  peek() {
    return this.tokens[this.pos];
  }

  consume() {
    return this.tokens[this.pos++];
  }

  parseExpr() {
    return this.parseAdd();
  }

  parseAdd() {
    let node = this.parseMul();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = /** @type {string} */ (this.consume().value);
      const right = this.parseMul();
      node = { type: 'binary', op, left: node, right };
    }
    return node;
  }

  parseMul() {
    let node = this.parsePow();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = /** @type {string} */ (this.consume().value);
      const right = this.parsePow();
      node = { type: 'binary', op, left: node, right };
    }
    return node;
  }

  parsePow() {
    let node = this.parseUnary();
    if (this.peek().type === 'op' && this.peek().value === '^') {
      this.consume();
      const right = this.parsePow();
      node = { type: 'binary', op: '^', left: node, right };
    }
    return node;
  }

  parseUnary() {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.consume();
      return { type: 'unary', op: '-', arg: this.parseUnary() };
    }
    if (this.peek().type === 'op' && this.peek().value === '+') {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();
    if (tok.type === 'number') {
      this.consume();
      return { type: 'number', value: tok.value };
    }
    if (tok.type === 'ident') {
      const name = /** @type {string} */ (this.consume().value);
      if (FUNS.has(name)) {
        if (this.peek().type !== 'op' || this.peek().value !== '(') {
          throw new Error(`Function ${name} requires parentheses`);
        }
        this.consume();
        const arg = this.parseExpr();
        if (this.peek().type !== 'op' || this.peek().value !== ')') {
          throw new Error('Missing closing parenthesis');
        }
        this.consume();
        return { type: 'call', name, arg };
      }
      if (name === 'x') {
        return { type: 'var' };
      }
      if (name === 'pi') {
        return { type: 'number', value: Math.PI };
      }
      if (name === 'e') {
        return { type: 'number', value: Math.E };
      }
      throw new Error(`Unknown identifier: ${name}`);
    }
    if (tok.type === 'op' && tok.value === '(') {
      this.consume();
      const node = this.parseExpr();
      if (this.peek().type !== 'op' || this.peek().value !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      this.consume();
      return node;
    }
    throw new Error('Unexpected token in expression');
  }
}

/**
 * @param {AstNode} node
 * @param {number} x
 * @returns {number}
 */
function evalAst(node, x) {
  switch (node.type) {
    case 'number':
      return /** @type {number} */ (node.value);
    case 'var':
      return x;
    case 'unary': {
      const v = evalAst(/** @type {AstNode} */ (node.arg), x);
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const left = evalAst(/** @type {AstNode} */ (node.left), x);
      const right = evalAst(/** @type {AstNode} */ (node.right), x);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '^':
          return Math.pow(left, right);
        default:
          throw new Error('Unknown operator');
      }
    }
    case 'call': {
      const arg = evalAst(/** @type {AstNode} */ (node.arg), x);
      switch (node.name) {
        case 'sin':
          return Math.sin(arg);
        case 'cos':
          return Math.cos(arg);
        case 'tan':
          return Math.tan(arg);
        case 'asin':
          return Math.asin(arg);
        case 'acos':
          return Math.acos(arg);
        case 'atan':
          return Math.atan(arg);
        case 'sqrt':
          return Math.sqrt(arg);
        case 'ln':
          return Math.log(arg);
        case 'log':
          return Math.log10(arg);
        case 'abs':
          return Math.abs(arg);
        case 'exp':
          return Math.exp(arg);
        default:
          throw new Error('Unknown function');
      }
    }
    default:
      throw new Error('Invalid AST');
  }
}
