import { LessLib } from '../system/less-lib.js';
import {
  FMT_DEFAULT_WIDTH,
  FMT_FMT_GOAL_NUMERATOR,
  FMT_FMT_GOAL_DENOMINATOR,
  fmtFmtDefaultGoal,
  fmtInnerGoal,
  fmtFmtText,
  fmtPrefixMatchLine,
  fmtLeadingSpaceCount,
  fmtWrapWordsCrown
} from './fmt-text.js';
import { parseFmtArgv, parseFmtGoalValue, fmtOptionError } from './fmt-parse.js';

const { LESS_DEFAULT_TAB_STOPS } = LessLib;

const FMT_VERSION_LINE = 'fmt (jsh Heyming Terminal) 1.0\n';

const FMT_HELP = `Usage: fmt [OPTION]... [FILE]...
Reformat paragraphs from each FILE; write to standard output.

With no FILE, or when FILE is -, read standard input.

  -c, --crown-margin  first output line uses the first input line's indent; continuations use the second line's indent (GNU -c)
  -p, --prefix=STRING reformat only lines beginning with STRING (after optional leading spaces); reattach prefix to output lines (GNU -p)
  -s, --split-only    split long lines only; do not join short input lines
  -t, --tagged-paragraph  indentation of first line differs from second (GNU -t); with -s, same as -c per line
  -u, --uniform-spacing   one space between words (GNU -u; default uses two spaces after .?! like GNU without -u)
  -w, --width=WIDTH   maximum line width (default ${FMT_DEFAULT_WIDTH})
  -g, --goal=WIDTH    goal width (default ${FMT_DEFAULT_WIDTH}×187/200, GNU LEEWAY 7); if only **-g** is given, maximum width becomes goal+10
  -h, --help          display this help and exit
      --version       output version information and exit
  --                  end of options

jsh:
  Paragraphs are separated by blank lines; within a paragraph, non-empty lines are merged (whitespace-separated) then word-wrapped. Unicode width counts code points (not full POSIX locale width). Piped stdin requires stdin to be supplied (empty pipe works). Symlinks are followed to a regular file (like fold). Binary files show one [binary file] line.

  **-g (goal width):** plain merge mode uses a GNU-like cost-based line fill (short lines vs raggedness) toward **goal**; **-c**/**-t**/**-p** still use greedy wrap with a proportional inner goal (full GNU crown/tagged DP not implemented).

  **-c (crown margin):** lines after the second must share the **same leading space count** as the second line (GNU paragraph rules); otherwise a new paragraph starts. **-s -c:** each non-empty line is wrapped with its own leading indent preserved (plain **-s** still trims indents in jsh).

  **-t (tagged paragraph):** when the first two lines of a paragraph have **different** leading space counts, behavior matches **-c** for that paragraph. When they are **equal** and there are multiple lines, each input line is formatted as its own paragraph (GNU: no merge). A **single** tagged paragraph line uses first-line indent then **no** indent on wrapped continuations (GNU; differs from **-c** single-line wrap).

  **-p (prefix):** only lines matching optional leading spaces + PREFIX are reformatted; other lines pass through. Consecutive matching lines with the **same** prefix column merge unless **-s** (split-only). With **-c**/**-t**, prefix is stripped and inner text is formatted with an effective width of WIDTH minus the prefix length.

  **Tabs:** input **TAB** characters are expanded to spaces at **${LESS_DEFAULT_TAB_STOPS}**-column stops (same as **less -x** / **expand -t8**) before line wrapping and indent detection; output lines use spaces only. Not full GNU fmt: sentence punctuation costs / widow-orphan bonuses from GNU **fmt** are not modeled; **-c**/**-t** goal is approximate.

Full documentation: <https://www.gnu.org/software/coreutils/fmt>
`;

export const FmtLib = {
  FMT_HELP,
  FMT_VERSION_LINE,
  FMT_DEFAULT_WIDTH,
  FMT_FMT_GOAL_NUMERATOR,
  FMT_FMT_GOAL_DENOMINATOR,
  fmtFmtDefaultGoal,
  parseFmtGoalValue,
  fmtInnerGoal,
  parseFmtArgv,
  fmtFmtText,
  fmtPrefixMatchLine,
  fmtLeadingSpaceCount,
  fmtWrapWordsCrown,
  fmtOptionError
};
