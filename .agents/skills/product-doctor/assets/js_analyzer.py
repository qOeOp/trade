"""Pure-stdlib JS/TS/TSX/JSX/MJS/CJS stateful lexer, function extractor, Sonar/Campbell cognitive
complexity scorer, and normalized Type-2 clone hasher for product-doctor (v2.2).

Replaces naive line-regex scanning to eliminate:
- `https://` URLs split by `line.partition("//")` leaking closing braces.
- TypeScript optional properties (`foo?: T`), optional chaining (`a?.b`), nullish coalescing (`??`),
  regex quantifiers (`https?`, `*?`), string literals (`?raw`), and JSX text/comments inflating scores.
- File-density dilution hiding concentrated complex functions or over-scoring small clean files.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

SATD_RE = re.compile(r"\b(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)\b", re.IGNORECASE)
CLONE_MIN_TOKENS = 35
CLONE_MIN_BODY_LINES = 6

# Token kinds: KW, ID, NUM, STR, REGEX, OP, PUNC
KEYWORDS = frozenset({
    "if", "else", "for", "while", "do", "switch", "case", "default", "catch", "try", "finally",
    "function", "return", "throw", "break", "continue", "class", "extends", "implements",
    "const", "let", "var", "async", "await", "export", "import", "from", "new", "typeof",
    "instanceof", "in", "of", "void", "delete", "yield", "type", "interface", "enum", "as",
    "readonly", "declare", "namespace", "static", "public", "private", "protected", "get", "set",
})
REGEX_PREV_PUNC = frozenset({"(", "[", "{", ",", ";", ":", "!", "?", "=", "+", "-", "*", "%", "&", "|", "^", "~", "<", ">", "=>"})
REGEX_PREV_KW = frozenset({"return", "case", "throw", "typeof", "void", "delete", "in", "of", "new", "else", "do", "yield", "await"})
JSX_PREV_PUNC = frozenset({"(", "[", "{", ",", ";", ":", "!", "?", "=", "=>", "&&", "||", "??"})
JSX_PREV_KW = frozenset({"return", "case", "throw", "else", "yield", "await"})

Tok = tuple[str, str, int]  # (kind, value, line)


def _is_ident_start(ch: str) -> bool:
    return ch.isalpha() or ch in ("_", "$")


def _is_ident_part(ch: str) -> bool:
    return ch.isalnum() or ch in ("_", "$")


def _can_start_regex(prev: Tok | None) -> bool:
    if prev is None:
        return True
    kind, val, _ = prev
    if kind in ("PUNC", "OP"):
        return val in REGEX_PREV_PUNC or val.endswith("=")
    return kind == "KW" and val in REGEX_PREV_KW


def _can_start_jsx(prev: Tok | None) -> bool:
    if prev is None:
        return True
    kind, val, _ = prev
    if kind in ("PUNC", "OP"):
        return val in JSX_PREV_PUNC
    return kind == "KW" and val in JSX_PREV_KW


def _tokenize(source: str, *, is_jsx: bool) -> tuple[list[Tok], int]:
    """Single-pass JS/TS/TSX lexer returning (code_tokens, satd_comment_count)."""
    tokens: list[Tok] = []
    satd = 0
    n = len(source)
    i = 0
    line = 1
    # Stack for template literal `${ ... }` nesting: each entry is open brace depth inside that `${`.
    tpl_brace_stack: list[int] = []
    # JSX element stack when `is_jsx`: tracks nested JSX elements vs `{expr}` blocks.
    jsx_depth = 0
    jsx_expr_stack: list[int] = []  # open `{` depth inside a JSX `{...}` expression
    in_jsx_tag = False
    jsx_tag_expr_depth = 0  # `{...}` inside a JSX opening tag attribute like `foo={a > b}`
    jsx_tag_paren_depth = 0

    def prev_tok() -> Tok | None:
        return tokens[-1] if tokens else None

    def scan_string(quote: str) -> None:
        nonlocal i, line
        start_line = line
        i += 1
        while i < n:
            ch = source[i]
            if ch == "\\":
                if i + 1 < n and source[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "\n":
                line += 1
                i += 1
                break
            if ch == quote:
                i += 1
                break
            i += 1
        tokens.append(("STR", quote, start_line))

    def scan_template_piece() -> None:
        nonlocal i, line
        start_line = line
        while i < n:
            ch = source[i]
            if ch == "\\":
                if i + 1 < n and source[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == "\n":
                line += 1
                i += 1
                continue
            if ch == "`":
                i += 1
                tokens.append(("STR", "`", start_line))
                return
            if ch == "$" and i + 1 < n and source[i + 1] == "{":
                tokens.append(("STR", "`", start_line))
                i += 2
                tpl_brace_stack.append(1)
                return
            i += 1
        tokens.append(("STR", "`", start_line))

    while i < n:
        ch = source[i]

        # Inside JSX element body (not inside an opening tag or `{expr}`): skip plain JSX text.
        if is_jsx and jsx_depth > 0 and not in_jsx_tag and not jsx_expr_stack:
            if ch == "\n":
                line += 1
                i += 1
                continue
            if ch == "{":
                # Check for JSX comment `{/* ... */}`
                j = i + 1
                while j < n and source[j] in " \t":
                    j += 1
                if source[j:j + 2] == "/*":
                    end = source.find("*/", j + 2)
                    comment = source[j + 2:end] if end != -1 else source[j + 2:]
                    if SATD_RE.search(comment):
                        satd += 1
                    line += comment.count("\n")
                    i = (end + 2) if end != -1 else n
                    while i < n and source[i] in " \t\r\n":
                        if source[i] == "\n":
                            line += 1
                        i += 1
                    if i < n and source[i] == "}":
                        i += 1
                    continue
                jsx_expr_stack.append(1)
                tokens.append(("PUNC", "(", line))  # isolate JSX expr cleanly without adding a block `{}`
                i += 1
                continue
            if ch == "<":
                if i + 1 < n and source[i + 1] == "/":
                    # Closing tag `</...>`
                    end = source.find(">", i + 2)
                    if end != -1:
                        line += source[i:end].count("\n")
                        i = end + 1
                    else:
                        i = n
                    jsx_depth = max(0, jsx_depth - 1)
                    continue
                if i + 1 < n and (source[i + 1] == ">" or _is_ident_start(source[i + 1])):
                    # Nested opening tag or fragment `<>`
                    if source[i + 1] == ">":
                        jsx_depth += 1
                        i += 2
                        continue
                    in_jsx_tag = True
                    jsx_tag_expr_depth = 0
                    jsx_tag_paren_depth = 0
                    i += 1
                    continue
            i += 1
            continue

        # Inside a JSX opening tag `<Comp prop={expr} />`
        if is_jsx and in_jsx_tag and jsx_tag_expr_depth == 0:
            if ch == "\n":
                line += 1
                i += 1
                continue
            if ch in ('"', "'"):
                scan_string(ch)
                tokens.pop()  # drop JSX literal attribute string
                continue
            if ch == "{":
                jsx_tag_expr_depth = 1
                tokens.append(("PUNC", "(", line))
                i += 1
                continue
            if ch == "/" and i + 1 < n and source[i + 1] == ">":
                in_jsx_tag = False
                i += 2
                continue
            if ch == ">" and jsx_tag_paren_depth == 0:
                in_jsx_tag = False
                jsx_depth += 1
                i += 1
                continue
            if ch in ("(", "["):
                jsx_tag_paren_depth += 1
            elif ch in (")", "]"):
                jsx_tag_paren_depth = max(0, jsx_tag_paren_depth - 1)
            i += 1
            continue

        # Whitespace
        if ch in " \t\r":
            i += 1
            continue
        if ch == "\n":
            line += 1
            i += 1
            continue

        # Comments
        if ch == "/" and i + 1 < n and source[i + 1] == "/":
            end = source.find("\n", i + 2)
            comment = source[i + 2:end] if end != -1 else source[i + 2:]
            if SATD_RE.search(comment):
                satd += 1
            i = end if end != -1 else n
            continue
        if ch == "/" and i + 1 < n and source[i + 1] == "*":
            end = source.find("*/", i + 2)
            comment = source[i + 2:end] if end != -1 else source[i + 2:]
            if SATD_RE.search(comment):
                satd += 1
            line += comment.count("\n")
            i = (end + 2) if end != -1 else n
            continue

        # Strings & template literals
        if ch in ('"', "'"):
            scan_string(ch)
            continue
        if ch == "`":
            i += 1
            scan_template_piece()
            continue

        # Regex literal vs division
        if ch == "/" and _can_start_regex(prev_tok()):
            start_line = line
            i += 1
            in_class = False
            while i < n:
                rc = source[i]
                if rc == "\\":
                    i += 2
                    continue
                if rc == "[":
                    in_class = True
                elif rc == "]":
                    in_class = False
                elif rc == "/" and not in_class:
                    i += 1
                    while i < n and source[i].isalpha():
                        i += 1
                    break
                elif rc == "\n":
                    line += 1
                    i += 1
                    break
                i += 1
            tokens.append(("REGEX", "/", start_line))
            continue

        # JSX opening tag inside JS expression
        if is_jsx and ch == "<" and _can_start_jsx(prev_tok()):
            if i + 1 < n and source[i + 1] == ">":
                jsx_depth += 1
                i += 2
                continue
            if i + 1 < n and _is_ident_start(source[i + 1]):
                # Distinguish `<Tag ...>` from TS generic `<T>(...)` by peeking past identifier.
                j = i + 1
                while j < n and (_is_ident_part(source[j]) or source[j] == "."):
                    j += 1
                nxt = source[j] if j < n else ""
                if nxt in (" ", "\t", "\n", "\r", ">", "/"):
                    in_jsx_tag = True
                    jsx_tag_expr_depth = 0
                    jsx_tag_paren_depth = 0
                    i += 1
                    continue

        # Braces (track template `${...}`, JSX tag `{...}`, and JSX body `{...}` scopes)
        if ch == "{":
            if tpl_brace_stack:
                tpl_brace_stack[-1] += 1
            elif jsx_tag_expr_depth > 0:
                jsx_tag_expr_depth += 1
            elif jsx_expr_stack:
                jsx_expr_stack[-1] += 1
            tokens.append(("PUNC", "{", line))
            i += 1
            continue
        if ch == "}":
            if tpl_brace_stack:
                tpl_brace_stack[-1] -= 1
                if tpl_brace_stack[-1] == 0:
                    tpl_brace_stack.pop()
                    i += 1
                    scan_template_piece()
                    continue
            elif jsx_tag_expr_depth > 0:
                jsx_tag_expr_depth -= 1
                if jsx_tag_expr_depth == 0:
                    tokens.append(("PUNC", ")", line))
                    i += 1
                    continue
            elif jsx_expr_stack:
                jsx_expr_stack[-1] -= 1
                if jsx_expr_stack[-1] == 0:
                    jsx_expr_stack.pop()
                    tokens.append(("PUNC", ")", line))
                    i += 1
                    continue
            tokens.append(("PUNC", "}", line))
            i += 1
            continue

        # Numbers
        if ch.isdigit():
            start_line = line
            i += 1
            while i < n and (source[i].isalnum() or source[i] in (".", "_")):
                i += 1
            tokens.append(("NUM", "0", start_line))
            continue

        # Identifiers / Keywords
        if _is_ident_start(ch):
            start = i
            i += 1
            while i < n and _is_ident_part(source[i]):
                i += 1
            word = source[start:i]
            tokens.append(("KW" if word in KEYWORDS else "ID", word, line))
            continue

        # Multi-character operators
        tri = source[i:i + 3]
        if tri in ("===", "!==", "??=", "&&=", "||=", "..."):
            tokens.append(("OP", tri, line))
            i += 3
            continue
        duo = source[i:i + 2]
        if duo in ("??", "?.", "&&", "||", "=>", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "++", "--"):
            tokens.append(("OP", duo, line))
            i += 2
            continue

        tokens.append(("PUNC", ch, line))
        i += 1

    return tokens, satd


def _match_close(tokens: list[Tok], start: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    for idx in range(start, len(tokens)):
        val = tokens[idx][1]
        if val == open_ch:
            depth += 1
        elif val == close_ch:
            depth -= 1
            if depth == 0:
                return idx
    return len(tokens) - 1


def _skip_type_annotation(tokens: list[Tok], idx: int) -> int:
    """Skip a TypeScript return-type annotation `: ...` up to `{`, `=>`, `;`, or `=`."""
    if idx >= len(tokens) or tokens[idx][1] != ":":
        return idx
    i = idx + 1
    angle = paren = bracket = brace = 0
    while i < len(tokens):
        val = tokens[i][1]
        if val == "<":
            angle += 1
        elif val == ">" and angle > 0:
            angle -= 1
        elif val == "(":
            paren += 1
        elif val == ")" and paren > 0:
            paren -= 1
        elif val == "[":
            bracket += 1
        elif val == "]" and bracket > 0:
            bracket -= 1
        elif val == "{":
            if angle == 0 and paren == 0 and bracket == 0 and brace == 0:
                # Could be a function body `{` OR an object return type `{ a: T } {`.
                end_b = _match_close(tokens, i, "{", "}")
                if end_b + 1 < len(tokens) and tokens[end_b + 1][1] in ("{", "=>", "|", "&", "["):
                    i = end_b + 1
                    continue
                return i
            brace += 1
        elif val == "}" and brace > 0:
            brace -= 1
        elif angle == 0 and paren == 0 and bracket == 0 and brace == 0 and val in ("=>", ";", "="):
            return i
        i += 1
    return i


def _extract_functions(tokens: list[Tok]) -> list[tuple[str, int, int]]:
    """Extract (name, body_open_brace_idx, body_close_brace_idx) for top-level and class functions."""
    funcs: list[tuple[str, int, int]] = []
    n = len(tokens)
    i = 0
    while i < n:
        kind, val, _ = tokens[i]

        # Skip TypeScript `interface Foo { ... }` and `type Foo = ...;` declarations completely.
        if kind == "KW" and val == "interface" and i + 1 < n and tokens[i + 1][0] == "ID":
            j = i + 2
            while j < n and tokens[j][1] != "{":
                j += 1
            if j < n:
                i = _match_close(tokens, j, "{", "}") + 1
                continue
        if kind == "KW" and val == "type" and i + 1 < n and tokens[i + 1][0] == "ID":
            j = i + 2
            if j < n and tokens[j][1] == "<":
                j = _match_close(tokens, j, "<", ">") + 1
            if j < n and tokens[j][1] == "=":
                # Advance past top-level type alias to `;` or next statement keyword at brace 0.
                j += 1
                b_depth = p_depth = 0
                while j < n:
                    tv = tokens[j][1]
                    if tv == "{":
                        b_depth += 1
                    elif tv == "}":
                        b_depth = max(0, b_depth - 1)
                    elif tv in ("(", "["):
                        p_depth += 1
                    elif tv in (")", "]"):
                        p_depth = max(0, p_depth - 1)
                    elif b_depth == 0 and p_depth == 0 and tv == ";":
                        j += 1
                        break
                    elif b_depth == 0 and p_depth == 0 and tokens[j][0] == "KW" and tv in ("export", "import", "function", "const", "let", "var", "class", "type", "interface"):
                        break
                    j += 1
                i = j
                continue

        # 1. Named `function foo(...) [: Ret] { ... }`
        if kind == "KW" and val == "function":
            j = i + 1
            if j < n and tokens[j][1] == "*":
                j += 1
            name = "<anon>"
            if j < n and tokens[j][0] == "ID":
                name = tokens[j][1]
                j += 1
            if j < n and tokens[j][1] == "<":
                j = _match_close(tokens, j, "<", ">") + 1
            if j < n and tokens[j][1] == "(":
                j = _match_close(tokens, j, "(", ")") + 1
                j = _skip_type_annotation(tokens, j)
                if j < n and tokens[j][1] == "{":
                    end_b = _match_close(tokens, j, "{", "}")
                    funcs.append((name, j, end_b))
                    i = end_b + 1
                    continue

        # 2. `const/let/var foo = [async] (...) [: Ret] => { ... }`
        if kind == "KW" and val in ("const", "let", "var") and i + 2 < n and tokens[i + 1][0] == "ID":
            name = tokens[i + 1][1]
            j = i + 2
            j = _skip_type_annotation(tokens, j)
            if j < n and tokens[j][1] == "=":
                j += 1
                if j < n and tokens[j][1] == "async":
                    j += 1
                if j < n and tokens[j][1] == "<":
                    j = _match_close(tokens, j, "<", ">") + 1
                if j < n and tokens[j][1] == "(":
                    j = _match_close(tokens, j, "(", ")") + 1
                    j = _skip_type_annotation(tokens, j)
                    if j < n and tokens[j][1] == "=>":
                        j += 1
                        if j < n and tokens[j][1] == "{":
                            end_b = _match_close(tokens, j, "{", "}")
                            funcs.append((name, j, end_b))
                            i = end_b + 1
                            continue
                elif j < n and tokens[j][0] == "ID" and j + 1 < n and tokens[j + 1][1] == "=>":
                    j += 2
                    if j < n and tokens[j][1] == "{":
                        end_b = _match_close(tokens, j, "{", "}")
                        funcs.append((name, j, end_b))
                        i = end_b + 1
                        continue

        # 3. Class method `foo(...) [: Ret] { ... }`
        if kind == "ID" and i + 1 < n and tokens[i + 1][1] == "(" and (i == 0 or tokens[i - 1][1] not in (".", "new", "function")):
            prev_v = tokens[i - 1][1] if i > 0 else ""
            if prev_v in ("", "{", "}", ";", "async", "static", "public", "private", "protected", "get", "set"):
                j = _match_close(tokens, i + 1, "(", ")") + 1
                j = _skip_type_annotation(tokens, j)
                if j < n and tokens[j][1] == "{":
                    end_b = _match_close(tokens, j, "{", "}")
                    funcs.append((val, j, end_b))
                    i = end_b + 1
                    continue

        i += 1
    return funcs


def _function_cognitive(tokens: list[Tok], body_start: int, body_end: int, fn_name: str) -> int:
    """Sonar/Campbell cognitive complexity over a single JS/TS function body token slice."""
    score = 0
    # Each entry in `brace_stack` records whether that `{` incremented control/function nesting.
    brace_stack: list[bool] = []
    nesting = 0
    # Track pending control-flow `{` (set when we finish `if (...)`, `for (...)`, `while (...)`, etc.)
    pending_nest = False
    last_bool_op: str | None = None
    i = body_start + 1

    while i < body_end:
        kind, val, _ = tokens[i]
        prev_val = tokens[i - 1][1] if i > body_start else ""
        next_val = tokens[i + 1][1] if i + 1 < body_end else ""

        if kind not in ("ID", "NUM", "STR", "REGEX") and val not in ("&&", "||", ".", "?.", "[", "]", "(", ")", "!"):
            last_bool_op = None

        # Control flow keywords (ignore member access `.catch`, `.for`, etc.)
        if kind == "KW" and prev_val != ".":
            if val == "else":
                if next_val == "if":
                    score += 1  # `else if`: +1 flat, no nesting penalty
                    i += 2
                    if i < body_end and tokens[i][1] == "(":
                        cond_end = _match_close(tokens, i, "(", ")")
                        score += _expr_complexity(tokens, i + 1, cond_end, nesting)
                        i = cond_end + 1
                    pending_nest = i < body_end and tokens[i][1] == "{"
                    continue
                score += 1  # `else`: +1 flat
                i += 1
                pending_nest = i < body_end and tokens[i][1] == "{"
                continue
            if val in ("if", "for", "while", "switch", "catch"):
                score += 1 + nesting
                i += 1
                if i < body_end and tokens[i][1] == "(":
                    cond_end = _match_close(tokens, i, "(", ")")
                    score += _expr_complexity(tokens, i + 1, cond_end, nesting)
                    i = cond_end + 1
                pending_nest = i < body_end and tokens[i][1] == "{"
                continue
            if val == "do":
                score += 1 + nesting
                i += 1
                pending_nest = i < body_end and tokens[i][1] == "{"
                continue
            if val == "function":
                j = i + 1
                if j < body_end and tokens[j][1] == "*":
                    j += 1
                if j < body_end and tokens[j][0] == "ID":
                    j += 1
                if j < body_end and tokens[j][1] == "<":
                    j = _match_close(tokens, j, "<", ">") + 1
                if j < body_end and tokens[j][1] == "(":
                    j = _match_close(tokens, j, "(", ")") + 1
                    j = _skip_type_annotation(tokens, j)
                i = j
                pending_nest = i < body_end and tokens[i][1] == "{"
                continue

        # Nested arrow function `=> {` increases nesting for its body without adding +1 itself.
        if val == "=>" and next_val == "{":
            pending_nest = True
            i += 1
            continue

        # Boolean chains (`&&`, `||`): +1 per operator-kind transition (`??` nullish fallback = 0 per SonarJS).
        if val in ("&&", "||"):
            if val != last_bool_op:
                score += 1
                last_bool_op = val
            i += 1
            continue

        # True ternary `?`: exclude TS optional `?:`, `?)`, `?,` and optional chaining `?.` (already tokenized as `?.`).
        if val == "?" and next_val not in (":", ")", ",", ";", "=", "}"):
            score += 1 + nesting
            i += 1
            continue

        # Direct recursion
        if kind == "ID" and val == fn_name and next_val == "(" and prev_val != ".":
            score += 1

        if val == "{":
            brace_stack.append(pending_nest)
            if pending_nest:
                nesting += 1
                pending_nest = False
            i += 1
            continue
        if val == "}":
            if brace_stack:
                was_nest = brace_stack.pop()
                if was_nest:
                    nesting = max(0, nesting - 1)
            i += 1
            continue

        if val == ";":
            pending_nest = False

        i += 1
    return score


def _expr_complexity(tokens: list[Tok], start: int, end: int, nesting: int) -> int:
    """Count boolean transitions (`&&`/`||`) and nested ternaries inside a condition `(...)`."""
    score = 0
    last_op: str | None = None
    for idx in range(start, end):
        val = tokens[idx][1]
        nxt = tokens[idx + 1][1] if idx + 1 < end else ""
        if val in ("&&", "||"):
            if val != last_op:
                score += 1
                last_op = val
        elif val == "?" and nxt not in (":", ")", ",", ";", "=", "}"):
            score += 1 + nesting
            last_op = None
        elif val in (",", ";", "=>"):
            last_op = None
    return score


def _clone_fingerprint(tokens: list[Tok], body_start: int, body_end: int) -> tuple[str, int]:
    """Normalized Type-2 token fingerprint (identifiers -> ID, preserving `.member` names)."""
    norm: list[str] = []
    for idx in range(body_start + 1, body_end):
        kind, val, _ = tokens[idx]
        if kind == "ID":
            prev_val = tokens[idx - 1][1] if idx > body_start else ""
            norm.append(f".{val}" if prev_val in (".", "?.") else "ID")
        elif kind in ("NUM", "STR", "REGEX"):
            norm.append(kind)
        else:
            norm.append(val)
    return hashlib.sha1(" ".join(norm).encode()).hexdigest()[:12], len(norm)


def analyze_js_ts_source(source: str, *, is_jsx: bool = False) -> dict[str, Any]:
    """Analyze a JS/TS/TSX/JSX/MJS/CJS source file with function-level cognitive complexity & Type-2 clones."""
    lines = source.count("\n") + (1 if source and not source.endswith("\n") else 0)
    tokens, satd = _tokenize(source, is_jsx=is_jsx)
    funcs = _extract_functions(tokens)

    fn_scores: list[tuple[str, int, int]] = []
    clone_hashes: list[tuple[str, str, int, int]] = []
    for name, b_start, b_end in funcs:
        cog = _function_cognitive(tokens, b_start, b_end, name)
        start_line = tokens[b_start][2]
        end_line = tokens[b_end][2]
        span = max(1, end_line - start_line + 1)
        fn_scores.append((name, cog, span))
        digest, tok_count = _clone_fingerprint(tokens, b_start, b_end)
        if tok_count >= CLONE_MIN_TOKENS and span >= CLONE_MIN_BODY_LINES:
            clone_hashes.append((digest, name, span, tok_count))

    fn_scores.sort(key=lambda item: (-item[1], -item[2], item[0]))
    max_cog = fn_scores[0][1] if fn_scores else 0
    top3 = [c for _, c, _ in fn_scores[:3]]
    top3_mean = round(sum(top3) / len(top3), 2) if top3 else 0.0
    max_fn_lines = max((span for _, _, span in fn_scores), default=0)
    hot_fns = [{"name": n, "cognitive": c, "lines": s} for n, c, s in fn_scores[:5] if c >= 10]

    return {
        "lines": lines,
        "functions": len(fn_scores),
        "max_cognitive": max_cog,
        "top3_cognitive": top3_mean,
        "max_fn_lines": max_fn_lines,
        "hot_functions": hot_fns,
        "satd": satd,
        "clone_hashes": clone_hashes,
    }
