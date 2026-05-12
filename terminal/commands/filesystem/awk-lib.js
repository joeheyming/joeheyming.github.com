import { AWK_HELP } from './awk-help.js';
import { awkOptionError, parseAwkArgv } from './awk-argv.js';
import { awkSplitCommaListTopLevel, awkSplitTopLevelCommas } from './awk-comma.js';
import { awkSplitFields, awkRebuild0FromFields } from './awk-fields.js';
import { awkParseNamedCall, awkParseArrayAccess } from './awk-parse-expr.js';
import { parseAwkFullProgram, parseAwkPrintProgram } from './awk-parse-program.js';
import {
  awkEvalSplitExpr,
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst,
  awkLiteralGsubAll,
  awkLiteralSubFirst,
  awkStrToNum,
  awkFormatArithResult,
  awkEvalArithmeticExpr,
  awkEvalPrintExpr,
  awkBeginCtx,
  awkRunPrintOnce,
  awkRunPrintProgram
} from './awk-runtime.js';

export const AwkLib = {
  AWK_HELP,
  awkOptionError,
  parseAwkArgv,
  parseAwkFullProgram,
  parseAwkPrintProgram,
  awkBeginCtx,
  awkRunPrintOnce,
  awkRunPrintProgram,
  awkSplitFields,
  awkSplitCommaListTopLevel,
  awkSplitTopLevelCommas,
  awkParseNamedCall,
  awkEvalArithmeticExpr,
  awkStrToNum,
  awkFormatArithResult,
  awkEvalPrintExpr,
  awkParseArrayAccess,
  awkEvalSplitExpr,
  awkRebuild0FromFields,
  awkLiteralGsubAll,
  awkLiteralSubFirst,
  awkParseSlashDelimitedRegex,
  awkExpandRegexReplacement,
  awkRegexGsubAll,
  awkRegexSubFirst
};
