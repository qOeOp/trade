"""Pure-stdlib JS/TS/TSX/JSX/MJS/CJS stateful lexer, function extractor, Sonar/Campbell cognitive
complexity scorer, and normalized Type-2 clone hasher for product-doctor (v2.8).

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
TYPE_DECL_STOPS = frozenset({"export", "import", "function", "const", "let", "var", "class", "type", "interface"})
METHOD_PREV_TOKENS = frozenset({"", "{", "}", ";", "async", "static", "public", "private", "protected", "get", "set"})
TRI_OPS = frozenset({"===", "!==", "??=", "&&=", "||=", "..."})
DUO_OPS = frozenset({"??", "?.", "&&", "||", "=>", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "++", "--"})

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


class _Lexer:
    """Single-pass JS/TS/TSX stateful lexer."""

    def __init__(self, source: str, *, is_jsx: bool) -> None:
        self.source = source
        self.is_jsx = is_jsx
        self.n = len(source)
        self.i = 0
        self.line = 1
        self.satd = 0
        self.tokens: list[Tok] = []
        self.tpl_brace_stack: list[int] = []
        self.jsx_depth = 0
        self.jsx_expr_stack: list[int] = []
        self.in_jsx_tag = False
        self.jsx_tag_expr_depth = 0
        self.jsx_tag_paren_depth = 0

    def _prev_tok(self) -> Tok | None:
        return self.tokens[-1] if self.tokens else None

    def _scan_string(self, quote: str) -> None:
        src, n = self.source, self.n
        start_line = self.line
        self.i += 1
        while self.i < n:
            ch = src[self.i]
            if ch == "\\":
                if self.i + 1 < n and src[self.i + 1] == "\n":
                    self.line += 1
                self.i += 2
                continue
            if ch == "\n":
                self.line += 1
                self.i += 1
                break
            if ch == quote:
                self.i += 1
                break
            self.i += 1
        self.tokens.append(("STR", quote, start_line))

    def _scan_template_piece(self) -> None:
        src, n = self.source, self.n
        start_line = self.line
        while self.i < n:
            ch = src[self.i]
            if ch == "\\":
                if self.i + 1 < n and src[self.i + 1] == "\n":
                    self.line += 1
                self.i += 2
                continue
            if ch == "\n":
                self.line += 1
                self.i += 1
                continue
            if ch == "`":
                self.i += 1
                self.tokens.append(("STR", "`", start_line))
                return
            if ch == "$" and self.i + 1 < n and src[self.i + 1] == "{":
                self.tokens.append(("STR", "`", start_line))
                self.i += 2
                self.tpl_brace_stack.append(1)
                return
            self.i += 1
        self.tokens.append(("STR", "`", start_line))

    def _scan_jsx_comment(self, j: int) -> None:
        src, n = self.source, self.n
        end = src.find("*/", j + 2)
        comment = src[j + 2:end] if end != -1 else src[j + 2:]
        if SATD_RE.search(comment):
            self.satd += 1
        self.line += comment.count("\n")
        self.i = (end + 2) if end != -1 else n
        while self.i < n and src[self.i] in " \t\r\n":
            if src[self.i] == "\n":
                self.line += 1
            self.i += 1
        if self.i < n and src[self.i] == "}":
            self.i += 1

    def _step_jsx_body(self, ch: str) -> None:
        src, n = self.source, self.n
        if ch == "\n":
            self.line += 1
            self.i += 1
            return
        if ch == "{":
            j = self.i + 1
            while j < n and src[j] in " \t":
                j += 1
            if src[j:j + 2] == "/*":
                self._scan_jsx_comment(j)
                return
            self.jsx_expr_stack.append(1)
            self.tokens.append(("PUNC", "(", self.line))
            self.i += 1
            return
        if ch == "<" and self.i + 1 < n:
            nxt = src[self.i + 1]
            if nxt == "/":
                end = src.find(">", self.i + 2)
                if end != -1:
                    self.line += src[self.i:end].count("\n")
                    self.i = end + 1
                else:
                    self.i = n
                self.jsx_depth = max(0, self.jsx_depth - 1)
                return
            if nxt == ">":
                self.jsx_depth += 1
                self.i += 2
                return
            if _is_ident_start(nxt):
                self.in_jsx_tag = True
                self.jsx_tag_expr_depth = 0
                self.jsx_tag_paren_depth = 0
                self.i += 1
                return
        self.i += 1

    def _step_jsx_tag(self, ch: str) -> None:
        src, n = self.source, self.n
        if ch == "\n":
            self.line += 1
            self.i += 1
            return
        if ch in ('"', "'"):
            self._scan_string(ch)
            self.tokens.pop()
            return
        if ch == "{":
            self.jsx_tag_expr_depth = 1
            self.tokens.append(("PUNC", "(", self.line))
            self.i += 1
            return
        if ch == "/" and self.i + 1 < n and src[self.i + 1] == ">":
            self.in_jsx_tag = False
            self.i += 2
            return
        if ch == ">" and self.jsx_tag_paren_depth == 0:
            self.in_jsx_tag = False
            self.jsx_depth += 1
            self.i += 1
            return
        if ch in ("(", "["):
            self.jsx_tag_paren_depth += 1
        elif ch in (")", "]"):
            self.jsx_tag_paren_depth = max(0, self.jsx_tag_paren_depth - 1)
        self.i += 1

    def _try_scan_comment(self) -> bool:
        src, n = self.source, self.n
        if self.i + 1 >= n:
            return False
        nxt = src[self.i + 1]
        if nxt == "/":
            end = src.find("\n", self.i + 2)
            comment = src[self.i + 2:end] if end != -1 else src[self.i + 2:]
            if SATD_RE.search(comment):
                self.satd += 1
            self.i = end if end != -1 else n
            return True
        if nxt == "*":
            end = src.find("*/", self.i + 2)
            comment = src[self.i + 2:end] if end != -1 else src[self.i + 2:]
            if SATD_RE.search(comment):
                self.satd += 1
            self.line += comment.count("\n")
            self.i = (end + 2) if end != -1 else n
            return True
        return False

    def _scan_regex(self) -> None:
        src, n = self.source, self.n
        start_line = self.line
        self.i += 1
        in_class = False
        while self.i < n:
            rc = src[self.i]
            if rc == "\\":
                self.i += 2
                continue
            if rc == "[":
                in_class = True
            elif rc == "]":
                in_class = False
            elif rc == "/" and not in_class:
                self.i += 1
                while self.i < n and src[self.i].isalpha():
                    self.i += 1
                break
            elif rc == "\n":
                self.line += 1
                self.i += 1
                break
            self.i += 1
        self.tokens.append(("REGEX", "/", start_line))

    def _try_start_jsx_expr(self) -> bool:
        src, n = self.source, self.n
        if self.i + 1 >= n or not _can_start_jsx(self._prev_tok()):
            return False
        nxt = src[self.i + 1]
        if nxt == ">":
            self.jsx_depth += 1
            self.i += 2
            return True
        if not _is_ident_start(nxt):
            return False
        j = self.i + 1
        while j < n and (_is_ident_part(src[j]) or src[j] == "."):
            j += 1
        if j < n and src[j] in (" ", "\t", "\n", "\r", ">", "/"):
            self.in_jsx_tag = True
            self.jsx_tag_expr_depth = 0
            self.jsx_tag_paren_depth = 0
            self.i += 1
            return True
        return False

    def _step_open_brace(self) -> None:
        if self.tpl_brace_stack:
            self.tpl_brace_stack[-1] += 1
        elif self.jsx_tag_expr_depth > 0:
            self.jsx_tag_expr_depth += 1
        elif self.jsx_expr_stack:
            self.jsx_expr_stack[-1] += 1
        self.tokens.append(("PUNC", "{", self.line))
        self.i += 1

    def _step_close_brace(self) -> None:
        if self.tpl_brace_stack:
            self.tpl_brace_stack[-1] -= 1
            if self.tpl_brace_stack[-1] == 0:
                self.tpl_brace_stack.pop()
                self.i += 1
                self._scan_template_piece()
                return
        elif self.jsx_tag_expr_depth > 0:
            self.jsx_tag_expr_depth -= 1
            if self.jsx_tag_expr_depth == 0:
                self.tokens.append(("PUNC", ")", self.line))
                self.i += 1
                return
        elif self.jsx_expr_stack:
            self.jsx_expr_stack[-1] -= 1
            if self.jsx_expr_stack[-1] == 0:
                self.jsx_expr_stack.pop()
                self.tokens.append(("PUNC", ")", self.line))
                self.i += 1
                return
        self.tokens.append(("PUNC", "}", self.line))
        self.i += 1

    def _step_code_token(self, ch: str) -> None:
        src, n = self.source, self.n
        if ch.isdigit():
            start_line = self.line
            self.i += 1
            while self.i < n and (src[self.i].isalnum() or src[self.i] in (".", "_")):
                self.i += 1
            self.tokens.append(("NUM", "0", start_line))
            return
        if _is_ident_start(ch):
            start = self.i
            self.i += 1
            while self.i < n and _is_ident_part(src[self.i]):
                self.i += 1
            word = src[start:self.i]
            self.tokens.append(("KW" if word in KEYWORDS else "ID", word, self.line))
            return
        tri = src[self.i:self.i + 3]
        if tri in TRI_OPS:
            self.tokens.append(("OP", tri, self.line))
            self.i += 3
            return
        duo = src[self.i:self.i + 2]
        if duo in DUO_OPS:
            self.tokens.append(("OP", duo, self.line))
            self.i += 2
            return
        self.tokens.append(("PUNC", ch, self.line))
        self.i += 1

    def tokenize(self) -> tuple[list[Tok], int]:
        src, n = self.source, self.n
        while self.i < n:
            ch = src[self.i]
            if self.is_jsx and self.jsx_depth > 0 and not self.in_jsx_tag and not self.jsx_expr_stack:
                self._step_jsx_body(ch)
                continue
            if self.is_jsx and self.in_jsx_tag and self.jsx_tag_expr_depth == 0:
                self._step_jsx_tag(ch)
                continue
            if ch in " \t\r":
                self.i += 1
            elif ch == "\n":
                self.line += 1
                self.i += 1
            elif ch == "/" and self._try_scan_comment():
                continue
            elif ch in ('"', "'"):
                self._scan_string(ch)
            elif ch == "`":
                self.i += 1
                self._scan_template_piece()
            elif ch == "/" and _can_start_regex(self._prev_tok()):
                self._scan_regex()
            elif self.is_jsx and ch == "<" and self._try_start_jsx_expr():
                continue
            elif ch == "{":
                self._step_open_brace()
            elif ch == "}":
                self._step_close_brace()
            else:
                self._step_code_token(ch)
        return self.tokens, self.satd


def _tokenize(source: str, *, is_jsx: bool) -> tuple[list[Tok], int]:
    """Single-pass JS/TS/TSX lexer returning (code_tokens, satd_comment_count)."""
    return _Lexer(source, is_jsx=is_jsx).tokenize()


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


def _skip_ts_declaration(tokens: list[Tok], i: int) -> int | None:
    """Skip TypeScript `interface Foo { ... }` or `type Foo = ...;` declarations."""
    n = len(tokens)
    kind, val, _ = tokens[i]
    if kind != "KW" or i + 1 >= n or tokens[i + 1][0] != "ID":
        return None
    if val == "interface":
        j = i + 2
        while j < n and tokens[j][1] != "{":
            j += 1
        return (_match_close(tokens, j, "{", "}") + 1) if j < n else None
    if val != "type":
        return None
    j = i + 2
    if j < n and tokens[j][1] == "<":
        j = _match_close(tokens, j, "<", ">") + 1
    if j >= n or tokens[j][1] != "=":
        return None
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
            return j + 1
        elif b_depth == 0 and p_depth == 0 and tokens[j][0] == "KW" and tv in TYPE_DECL_STOPS:
            return j
        j += 1
    return j


def _match_named_function(tokens: list[Tok], i: int) -> tuple[tuple[str, int, int], int] | None:
    n = len(tokens)
    if tokens[i][0] != "KW" or tokens[i][1] != "function":
        return None
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
        j = _skip_type_annotation(tokens, _match_close(tokens, j, "(", ")") + 1)
        if j < n and tokens[j][1] == "{":
            end_b = _match_close(tokens, j, "{", "}")
            return (name, j, end_b), end_b + 1
    return None


def _match_arrow_decl(tokens: list[Tok], i: int) -> tuple[tuple[str, int, int], int] | None:
    n = len(tokens)
    if tokens[i][0] != "KW" or tokens[i][1] not in ("const", "let", "var"):
        return None
    if i + 2 >= n or tokens[i + 1][0] != "ID":
        return None
    name = tokens[i + 1][1]
    j = _skip_type_annotation(tokens, i + 2)
    if j >= n or tokens[j][1] != "=":
        return None
    j += 1
    if j < n and tokens[j][1] == "async":
        j += 1
    if j < n and tokens[j][1] == "<":
        j = _match_close(tokens, j, "<", ">") + 1
    if j < n and tokens[j][1] == "(":
        j = _skip_type_annotation(tokens, _match_close(tokens, j, "(", ")") + 1)
        if j + 1 < n and tokens[j][1] == "=>" and tokens[j + 1][1] == "{":
            end_b = _match_close(tokens, j + 1, "{", "}")
            return (name, j + 1, end_b), end_b + 1
    elif j + 2 < n and tokens[j][0] == "ID" and tokens[j + 1][1] == "=>" and tokens[j + 2][1] == "{":
        end_b = _match_close(tokens, j + 2, "{", "}")
        return (name, j + 2, end_b), end_b + 1
    return None


def _match_class_method(tokens: list[Tok], i: int) -> tuple[tuple[str, int, int], int] | None:
    n = len(tokens)
    kind, val, _ = tokens[i]
    if kind != "ID" or i + 1 >= n or tokens[i + 1][1] != "(":
        return None
    prev_v = tokens[i - 1][1] if i > 0 else ""
    if prev_v not in METHOD_PREV_TOKENS:
        return None
    j = _skip_type_annotation(tokens, _match_close(tokens, i + 1, "(", ")") + 1)
    if j < n and tokens[j][1] == "{":
        end_b = _match_close(tokens, j, "{", "}")
        return (val, j, end_b), end_b + 1
    return None


def _extract_functions(tokens: list[Tok]) -> list[tuple[str, int, int]]:
    """Extract (name, body_open_brace_idx, body_close_brace_idx) for top-level and class functions."""
    funcs: list[tuple[str, int, int]] = []
    n, i = len(tokens), 0
    while i < n:
        skipped = _skip_ts_declaration(tokens, i)
        if skipped is not None:
            i = skipped
            continue
        matched = (
            _match_named_function(tokens, i)
            or _match_arrow_decl(tokens, i)
            or _match_class_method(tokens, i)
        )
        if matched is not None:
            fn_entry, i = matched
            funcs.append(fn_entry)
            continue
        i += 1
    return funcs


def _step_control_keyword(
    tokens: list[Tok], i: int, body_end: int, nesting: int, val: str, next_val: str,
) -> tuple[int, int, bool] | None:
    """Return (score_delta, next_idx, pending_nest) for control-flow/nested-function keywords."""
    if val == "else":
        if next_val == "if":
            j, delta = i + 2, 1
            if j < body_end and tokens[j][1] == "(":
                cond_end = _match_close(tokens, j, "(", ")")
                delta += _expr_complexity(tokens, j + 1, cond_end, nesting)
                j = cond_end + 1
            return delta, j, (j < body_end and tokens[j][1] == "{")
        return 1, i + 1, (i + 1 < body_end and tokens[i + 1][1] == "{")
    if val in ("if", "for", "while", "switch", "catch"):
        delta, j = 1 + nesting, i + 1
        if j < body_end and tokens[j][1] == "(":
            cond_end = _match_close(tokens, j, "(", ")")
            delta += _expr_complexity(tokens, j + 1, cond_end, nesting)
            j = cond_end + 1
        return delta, j, (j < body_end and tokens[j][1] == "{")
    if val == "do":
        return 1 + nesting, i + 1, (i + 1 < body_end and tokens[i + 1][1] == "{")
    if val == "function":
        j = i + 1
        if j < body_end and tokens[j][1] == "*":
            j += 1
        if j < body_end and tokens[j][0] == "ID":
            j += 1
        if j < body_end and tokens[j][1] == "<":
            j = _match_close(tokens, j, "<", ">") + 1
        if j < body_end and tokens[j][1] == "(":
            j = _skip_type_annotation(tokens, _match_close(tokens, j, "(", ")") + 1)
        return 0, j, (j < body_end and tokens[j][1] == "{")
    return None


def _function_cognitive(tokens: list[Tok], body_start: int, body_end: int, fn_name: str) -> int:
    """Sonar/Campbell cognitive complexity over a single JS/TS function body token slice."""
    score = nesting = 0
    brace_stack: list[bool] = []
    pending_nest = False
    last_bool_op: str | None = None
    i = body_start + 1

    while i < body_end:
        kind, val, _ = tokens[i]
        prev_val = tokens[i - 1][1] if i > body_start else ""
        next_val = tokens[i + 1][1] if i + 1 < body_end else ""

        if kind not in ("ID", "NUM", "STR", "REGEX") and val not in ("&&", "||", ".", "?.", "[", "]", "(", ")", "!"):
            last_bool_op = None

        if kind == "KW" and prev_val != ".":
            ctrl = _step_control_keyword(tokens, i, body_end, nesting, val, next_val)
            if ctrl is not None:
                delta, i, pending_nest = ctrl
                score += delta
                continue

        if val == "=>" and next_val == "{":
            pending_nest = True
        elif val in ("&&", "||"):
            if val != last_bool_op:
                score += 1
                last_bool_op = val
        elif val == "?" and next_val not in (":", ")", ",", ";", "=", "}"):
            score += 1 + nesting
        elif val == "{":
            brace_stack.append(pending_nest)
            if pending_nest:
                nesting += 1
                pending_nest = False
        elif val == "}":
            if brace_stack and brace_stack.pop():
                nesting = max(0, nesting - 1)
        else:
            if kind == "ID" and val == fn_name and next_val == "(" and prev_val != ".":
                score += 1
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
