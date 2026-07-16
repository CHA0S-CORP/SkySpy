#!/usr/bin/env python3
"""Generate the Socket.IO request-type reference from source.

Introspects (via AST, no Django import) the MainNamespace dispatch table in
``socketio/namespaces/main.py`` and the handler docstrings across
``socketio/namespaces/mixins/``, and writes a Markdown table to
``docs/socketio/99-event-reference.md``.

Run via ``make docs-socketio``. A CI check regenerates this and diffs it
against the committed copy, so keep the output deterministic.
"""

from __future__ import annotations

import ast
from pathlib import Path

SKYSPY = Path(__file__).resolve().parent.parent / "skyspy"
MAIN = SKYSPY / "socketio" / "namespaces" / "main.py"
MIXINS_DIR = SKYSPY / "socketio" / "namespaces" / "mixins"
OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "socketio" / "99-event-reference.md"


def _dict_from_assignment(tree: ast.AST, name: str) -> dict[str, str]:
    """Return the {str_key: rendered_value} of a module/class-level dict or a
    dict assigned to ``name`` anywhere in the tree (first match wins)."""
    for node in ast.walk(tree):
        target_names = []
        if isinstance(node, ast.Assign):
            target_names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target_names = [node.target.id]
            value = node.value
        else:
            continue
        if name in target_names and isinstance(value, ast.Dict):
            out = {}
            for k, v in zip(value.keys, value.values, strict=False):
                if not isinstance(k, ast.Constant) or not isinstance(k.value, str):
                    continue
                if isinstance(v, ast.Constant):
                    out[k.value] = str(v.value)
                elif isinstance(v, ast.Attribute):
                    # e.g. self._handle_aircraft -> _handle_aircraft
                    out[k.value] = v.attr
                else:
                    out[k.value] = ast.unparse(v)
            return out
    return {}


def _handler_docs() -> dict[str, tuple[str, str]]:
    """Map handler method name -> (mixin filename, first docstring line)."""
    docs: dict[str, tuple[str, str]] = {}
    for path in sorted(MIXINS_DIR.glob("*.py")):
        if path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("_handle_"):
                doc = ast.get_docstring(node) or ""
                summary = doc.strip().splitlines()[0] if doc.strip() else ""
                docs[node.name] = (path.name, summary)
    return docs


def main() -> int:
    main_tree = ast.parse(MAIN.read_text())
    perms = _dict_from_assignment(main_tree, "REQUEST_PERMISSIONS")
    handlers = _dict_from_assignment(main_tree, "handlers")
    docs = _handler_docs()

    request_types = sorted(set(perms) | set(handlers))

    lines = [
        "# Socket.IO Request-Type Reference",
        "",
        "> Generated from source by `scripts/gen_socketio_events.py` (`make docs-socketio`). Do not edit by hand.",
        "",
        "Every request type reaches the client via `on_request` on the main "
        "namespace, is dispatched by `_handle_generic_request()`, and requires "
        "the listed permission. A request type present here but with no handler "
        "is served by a dedicated `on_*` method rather than the generic table.",
        "",
        "| Request type | Permission | Handler | Mixin | Description |",
        "| --- | --- | --- | --- | --- |",
    ]

    for rt in request_types:
        handler = handlers.get(rt, "")
        perm = perms.get(rt, "—")
        mixin, summary = docs.get(handler, ("", ""))
        handler_cell = f"`{handler}`" if handler else "—"
        mixin_cell = f"`{mixin}`" if mixin else "—"
        lines.append(f"| `{rt}` | `{perm}` | {handler_cell} | {mixin_cell} | {summary} |")

    lines.append("")
    lines.append(f"_Total request types: {len(request_types)}._")
    lines.append("")

    OUT.write_text("\n".join(lines))
    print(f"Wrote {OUT} ({len(request_types)} request types)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
