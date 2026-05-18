/**
 * Umbrella for the awk evaluator. Real implementations live in:
 *   - **awk-regex.js**    — slash-regex parsing, gsub/sub replacement engines
 *   - **awk-arith.js**    — numeric coercion, formatting, recursive-descent arith parser
 *   - **awk-builtins.js** — substr / index / split / gsub / sub / match
 *   - **awk-print.js**    — print-expression dispatcher, BEGIN ctx, printf, main loop
 *
 * Keep this file as a stable re-export surface for **awk-lib.js**.
 */

export {
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst,
  awkLiteralGsubAll,
  awkLiteralSubFirst
} from './awk-regex.js';

export {
  awkStrToNum,
  awkFormatArithResult,
  awkEvalArithmeticExpr
} from './awk-arith.js';

export {
  awkEvalSubstrExpr,
  awkEvalIndexExpr,
  awkEvalSplitExpr,
  awkEvalGsubExpr,
  awkEvalMatchExpr
} from './awk-builtins.js';

export {
  awkEvalPrintExpr,
  awkBeginCtx,
  awkRunPrintOnce,
  awkApplyPrintfFormat,
  awkRunPrintfOnce,
  awkRunPrintProgram
} from './awk-print.js';
