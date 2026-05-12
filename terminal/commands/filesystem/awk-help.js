export const AWK_HELP = `Usage: awk [POSIX or GNU-style options]... 'program' [FILE]...
Pattern scanning and processing language (jsh subset).

  -F SEP, --field-separator=SEP   use SEP as field separator (default: whitespace)
  -h, --help                       display this help and exit
      --                           end of options

jsh:
  **program** may include optional **BEGIN {print ...}**, optional **{print ...}**,
  optional **END {print ...}** (that order). Each EXPR is **$0**, **$N**, **NR**,
  **NF**, **RSTART**, **RLENGTH**, a quoted string, **length** / **length()** / **length(EXPR)**,
  **substr(S, I [, L])** (1-based **I**, optional length **L**; **I** before **1** is
  treated as **1** like GNU awk),   **index(S, T)** (1-based start of first **T** in **S**,
  or **0**), **match(S, P [, ARRAY])** (literal substring **P** in **S** unless **P** is **slash-delimited**
  **/ERE/flags** — then **JavaScript RegExp**; sets **RSTART** / **RLENGTH**; returns start index or **0**;
  optional third arg must be an identifier — clears and fills **ARRAY[0]** (full match), **ARRAY[1]**… (regex
  capture groups only); read back with **ARRAY[EXPR]** — **EXPR** may be a number, **$N**, or nested **ARRAY[…]**),
  **split(STRING, ARRAY [, SEP])** (fills **ARRAY[1]**…; **SEP** defaults to current **-F** FS; returns field count),
  **gsub(PAT, REP [, $N])** / **sub(...)** (literal **PAT** unless **/ERE/flags**; mutates **$0** or **$N**;
  returns substitution count; in **regex** mode **REP** expands **&** to the match and **\\1**–**\\9** to groups). Arithmetic: **+**, **-**, ${'*'}, **/**, **%**, **^** (exponentiation is
  right-associative, e.g. **2^3^2** → **512**; **^** binds before unary **-**, so **-2^2** → **-4**),
  unary **-**, parentheses; operands are numeric literals, **$N**, **NR**, **NF**,
  **RSTART**, **RLENGTH**, quoted strings (coerced like awk), and **length(...)**. **print** with no expressions prints **$0**. **BEGIN** sees **NR=0**,
  **NF=0**, **$0** empty. **END** sees the last record (**NR=0** if no input). Default
  field splitting matches runs of whitespace; **-F** uses a literal separator string
  (often one character). **/ERE/** uses **JavaScript** syntax (not full POSIX ERE); invalid patterns fail the **print** expression. No patterns, user variables, or **-f** script files.
  **gsub** with empty **PAT**: GNU-style — inserts **REP** at each of **length($N)+1** positions (before
  each character and after the last). **sub** with empty **PAT**: one insertion before the first character only.

Full documentation: <https://www.gnu.org/software/gawk/manual/html_node/Getting-Started.html>
`;
