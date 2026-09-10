"""Build a pinned, locally patched VTL copy; never mutate the submodule."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REVISION = "df30392f18dc5e175b577c3ba734caaa65a3927f"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sanitize", action="store_true")
    args = parser.parse_args()
    vendor = ROOT / "vendor/vocaltractlab"
    revision = subprocess.check_output(["git", "-C", str(vendor), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise SystemExit(f"Expected VTL {REVISION}, got {revision}")
    target = ROOT / ".build" / ("native-asan" if args.sanitize else "native")
    # A failed rebuild must not leave a manifest certifying an older library.
    (target / "manifest.json").unlink(missing_ok=True)
    source = target / "source"
    source.mkdir(parents=True, exist_ok=True)
    # Export only tracked source at the pin. Upstream tests write files into their tree.
    archive = subprocess.run(["git", "-C", str(vendor), "archive", REVISION], check=True, capture_output=True).stdout
    import io, tarfile
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source, filter="data")
    patch = ROOT / "patches/anatomy-tongue-bounds.patch"
    subprocess.run(["patch", "-p1", "-i", str(patch)], cwd=source, check=True)
    shutil.copyfile(ROOT / "tests/anatomy_lifecycle.cpp", source / "test/AnatomyLifecycle.cpp")
    with (source / "CMakeLists.txt").open("a") as cmake:
        cmake.write('''
add_executable(AnatomyLifecycle test/AnatomyLifecycle.cpp)
target_link_libraries(AnatomyLifecycle VocalTractLabApi)
add_test(NAME AnatomyLifecycle COMMAND AnatomyLifecycle ${CMAKE_SOURCE_DIR}/resources/JD3.speaker)
''')
    build = target / "build"
    mode = "Debug" if args.sanitize else "Release"
    options = ["-DCMAKE_POLICY_VERSION_MINIMUM=3.5", f"-DCMAKE_BUILD_TYPE={mode}"]
    if args.sanitize:
        options += ["-DCMAKE_CXX_FLAGS=-fsanitize=address -fno-omit-frame-pointer", "-DCMAKE_SHARED_LINKER_FLAGS=-fsanitize=address"]
    subprocess.run(["cmake", "-S", str(source), "-B", str(build), *options], check=True)
    subprocess.run(["cmake", "--build", str(build), "--parallel", "4"], check=True)
    subprocess.run(["ctest", "--test-dir", str(build), "--output-on-failure"], check=True)
    suffix = {"darwin": "dylib", "linux": "so"}.get(sys.platform)
    if suffix is None:
        raise SystemExit("Native manifest supports macOS and Linux only")
    library = source / f"lib/Release/libVocalTractLabApi.{suffix}"
    manifest = {
        "library_sha256": hashlib.sha256(library.read_bytes()).hexdigest(),
        "upstream_revision": revision,
        "patch_sha256": hashlib.sha256(patch.read_bytes()).hexdigest(),
        "speaker_sha256": hashlib.sha256((source / "resources/JD3.speaker").read_bytes()).hexdigest(),
        "build_type": mode,
        "sanitized": args.sanitize,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
