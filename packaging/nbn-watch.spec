# PyInstaller spec for NBN Watch.
#   uv run --extra desktop --with pyinstaller pyinstaller packaging/nbn-watch.spec
import sys

from PyInstaller.utils.hooks import collect_submodules

hidden = collect_submodules("pystray") + collect_submodules("PIL") + collect_submodules("nbn_watch")

a = Analysis(
    ["../nbn_watch/desktop/__main__.py"],
    pathex=[".."],
    hiddenimports=hidden,
    excludes=["tkinter", "pytest", "mypy", "ruff"],
)
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="NBN Watch", console=False)
    coll = COLLECT(exe, a.binaries, a.datas, name="NBN Watch")
    app = BUNDLE(
        coll,
        name="NBN Watch.app",
        bundle_identifier="au.nbnwatch.app",
        info_plist={"LSUIElement": True, "CFBundleShortVersionString": "0.3.0"},  # menu-bar only
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        name="NBN Watch" if sys.platform == "win32" else "nbn-watch",
        console=False,
        upx=False,
    )
