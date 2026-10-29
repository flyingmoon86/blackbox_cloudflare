"""Archive one reviewed documentation task; never use for website data backups."""
import argparse
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError("Corrupt ZIP")
        key = "_archive-manifest.json" if "_archive-manifest.json" in archive.namelist() else "manifest.json"
        manifest = json.loads(archive.read(key))
        for item in manifest["files"]:
            if digest(archive.read(item["path"])) != item["sha256"]:
                raise ValueError("Hash mismatch: " + item["path"])
    sidecar = path.with_name(path.name + ".sha256")
    if not sidecar.is_file() or sidecar.read_text().split()[0] != digest(path.read_bytes()):
        raise ValueError("Missing or mismatched ZIP checksum")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task")
    parser.add_argument("--backup-dir")
    parser.add_argument("--verify")
    args = parser.parse_args()
    if args.verify:
        manifest = verify(Path(args.verify).resolve())
        print("Verified", len(manifest["files"]), "files")
        return
    if not args.task or not args.backup_dir:
        parser.error("Supply --task and --backup-dir, or --verify")
    task = ROOT / args.task
    if task.is_symlink() or task.resolve().parent != (ROOT / "artifacts").resolve() or not task.is_dir():
        raise ValueError("Task must be one immediate child directory of artifacts/")
    destination = Path(args.backup_dir).resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError("Backup directory must be outside the repository")
    files = []
    for path in sorted(task.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed")
        if not path.is_file():
            continue
        name = path.name.lower()
        if name.startswith((".env", ".dev.vars")) or path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".sql", ".pem", ".key"} or any(word in name for word in ("secret", "credential", "password", "旧密码")):
            raise ValueError("Not a documentation artifact: " + path.name)
        files.append({"path": path.relative_to(task).as_posix(), "bytes": path.stat().st_size, "sha256": digest(path.read_bytes())})
    if not files:
        raise ValueError("Empty task")
    if any(item["path"] == "_archive-manifest.json" for item in files):
        raise ValueError("Reserved manifest filename")
    destination.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = destination / f"{task.name}-{stamp}.zip"
    manifest = {"task": task.name, "files": files}
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as archive:
        for item in files:
            archive.write(task / item["path"], item["path"])
        archive.writestr("_archive-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    checksum = digest(output.read_bytes())
    output.with_name(output.name + ".sha256").write_text(checksum + "  " + output.name + "\n", encoding="utf-8")
    verify(output)
    index_path = ROOT / "scripts/document-archives.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"archives": []}
    index["archives"].append({"date": stamp, "task": task.name, "local_directory": task.relative_to(ROOT).as_posix(), "backup_directory": str(destination), "zip": output.name, "zip_sha256": checksum, "files": files, "off_device_copy_verified": False})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Verified archive:", output, "files:", len(files))


if __name__ == "__main__":
    main()
