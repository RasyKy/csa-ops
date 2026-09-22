"""Asserts CLAUDE.md rule 5: engine.ai_explain imports nothing from
engine.response or backend.app.routers.agent, and commander.handle_incident
has no code path reading incident_triage.

The import-graph check is pure static AST parsing -- it never actually
imports the forbidden modules, so it can't produce a false pass or fail
based on what some other test happened to import earlier in the session.
"""
import ast
import inspect
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OWN_PACKAGE_PREFIXES = ("engine", "backend", "agent")
FORBIDDEN_PREFIXES = ("engine.response", "backend.app.routers.agent")

AI_EXPLAIN_ENTRY_MODULES = [
    "engine.ai_explain.llm_client",
    "engine.ai_explain.prompts",
    "engine.ai_explain.schemas",
    "engine.ai_explain.triage",
    "engine.ai_explain.explain",
]


def _module_to_path(module_name: str) -> Path | None:
    candidate = REPO_ROOT / Path(*module_name.split("."))
    init_file = candidate / "__init__.py"
    if init_file.exists():
        return init_file
    py_file = candidate.with_suffix(".py")
    if py_file.exists():
        return py_file
    return None


def _direct_imports(py_file: Path, package: str) -> set[str]:
    """Every module name this file imports, relative imports resolved to
    their absolute dotted name. For `from X import Y` (absolute or
    relative), both X and X.Y are added as candidates -- Y might be a
    submodule (e.g. `from . import llm_client`) or just a name/class from
    that module's namespace. `_module_to_path` resolves only real files, so
    treating both as candidates is a safe superset, not a false positive."""
    tree = ast.parse(py_file.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                base_module = node.module
            else:
                parts = package.split(".")
                base_parts = parts[: len(parts) - node.level + 1] if node.level <= len(parts) else []
                base_module = ".".join(base_parts + ([node.module] if node.module else []))

            if base_module:
                names.add(base_module)
                for alias in node.names:
                    names.add(f"{base_module}.{alias.name}")
    return names


def _walk_import_graph(entry_modules: list[str]) -> set[str]:
    """BFS over the repo's own modules reachable from entry_modules. Does
    not recurse into third-party/stdlib imports -- those aren't part of
    "our" import graph and can't reach engine.response either way."""
    seen: set[str] = set()
    queue = list(entry_modules)
    while queue:
        module_name = queue.pop()
        if module_name in seen:
            continue
        seen.add(module_name)

        if not module_name.startswith(OWN_PACKAGE_PREFIXES):
            continue

        path = _module_to_path(module_name)
        if path is None:
            continue

        package = module_name if path.name == "__init__.py" else module_name.rsplit(".", 1)[0]
        for imported in _direct_imports(path, package):
            if imported not in seen:
                queue.append(imported)
    return seen


def test_ai_explain_import_graph_never_reaches_response_or_agent_router():
    reached = _walk_import_graph(AI_EXPLAIN_ENTRY_MODULES)

    offending = [m for m in reached if m.startswith(FORBIDDEN_PREFIXES)]
    assert offending == [], f"engine.ai_explain's import graph reaches forbidden modules: {offending}"


def test_ai_explain_modules_exist_and_are_not_empty():
    # A green import-graph test is meaningless if the entry files are still
    # empty docstring stubs -- guard against that regression directly.
    for module_name in AI_EXPLAIN_ENTRY_MODULES:
        path = _module_to_path(module_name)
        assert path is not None, f"{module_name} has no source file"
        tree = ast.parse(path.read_text())
        has_code = any(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            for node in ast.iter_child_nodes(tree)
        )
        assert has_code, f"{module_name} has no function or class definitions -- still a stub"


def test_commander_handle_incident_never_reads_incident_triage():
    from engine.response import commander

    source = inspect.getsource(commander.handle_incident)
    assert "incident_triage" not in source
    assert "get_triage" not in source
    assert "ai_explain" not in source


def test_commander_module_never_imports_ai_explain():
    source = (REPO_ROOT / "engine" / "response" / "commander.py").read_text()
    tree = ast.parse(source)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)

    assert not any(name == "engine.ai_explain" or name.startswith("engine.ai_explain.") for name in imported)
