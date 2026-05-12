import { SED_HELP, sedOptionError, parseSedArgv } from './sed-help.js';
import {
  parseSedSubstituteScript,
  parseSedScript,
  parseSedAddressedDelete,
  parseSedSlashPatternDelete,
  parseSedSlashPatternRangeDelete,
  parseSedSlashPatternToLineDelete,
  parseSedLineToPatternDelete,
  splitSedScriptIntoCommands
} from './sed-parse.js';
import {
  sedLineMatchesDeleteAddress,
  sedApplySubstituteLine,
  sedProcessContent
} from './sed-runtime.js';

export const SedLib = {
  SED_HELP,
  sedOptionError,
  parseSedArgv,
  parseSedSubstituteScript,
  parseSedScript,
  parseSedAddressedDelete,
  parseSedSlashPatternDelete,
  parseSedSlashPatternRangeDelete,
  parseSedSlashPatternToLineDelete,
  parseSedLineToPatternDelete,
  sedLineMatchesDeleteAddress,
  sedApplySubstituteLine,
  sedProcessContent,
  splitSedScriptIntoCommands
};
