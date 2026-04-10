import os
import fnmatch
import zipfile

def should_ignore(rel_path, ignore_patterns, is_dir=False):
    rel_path = rel_path.replace(os.sep, '/')
    for pattern in ignore_patterns:
        pattern = pattern.strip().replace(os.sep, '/')
        if not pattern or pattern.startswith('#'):
            continue
        
        pattern_is_dir = pattern.endswith('/')
        if pattern_is_dir and not is_dir:
            continue
        
        test_path = rel_path
        if pattern_is_dir:
            test_path += '/'
        
        if '/' in pattern:
            if pattern.startswith('/'):
                match_pattern = pattern.lstrip('/')
                if fnmatch.fnmatch(test_path, match_pattern):
                    return True
            else:
                if fnmatch.fnmatch(test_path, pattern) or fnmatch.fnmatch(test_path, '*/' + pattern):
                    return True
        else:
            if fnmatch.fnmatch(os.path.basename(test_path), pattern):
                return True
    return False

def zip_directory(dir_path='.', zip_path='archive.zip', additional_ignores=[]):
    gitignore_path = os.path.join(dir_path, '.gitignore')
    ignore_patterns = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            ignore_patterns = [l.strip() for l in f if l.strip() and not l.startswith('#')]
    ignore_patterns += ['.git/'] + additional_ignores

    files_to_add = []
    for root, dirs, files in os.walk(dir_path):
        rel_root = os.path.relpath(root, dir_path)
        dirs[:] = [d for d in dirs if not should_ignore(
            os.path.join(rel_root, d).replace(os.sep, '/'), ignore_patterns, is_dir=True)]
        for file in files:
            abs_path = os.path.join(root, file)
            arcname = os.path.relpath(abs_path, dir_path).replace(os.sep, '/')
            if not should_ignore(arcname, ignore_patterns):
                files_to_add.append((abs_path, arcname))

    print(f"Found {len(files_to_add)} files to archive.")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as zipf:
        for i, (abs_path, arcname) in enumerate(files_to_add):
            # Timestamp fijo → todos los bytes son ASCII válido → nunca se corrompe
            info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(abs_path, 'rb') as f:
                zipf.writestr(info, f.read())
            print(f"Adding {arcname} ({i+1}/{len(files_to_add)})")

    # Verificar que el zip sea legible
    print("\nVerifying archive...")
    with zipfile.ZipFile(zip_path) as z:
        bad = []
        for name in z.namelist():
            try:
                with z.open(name) as f: f.read(16)
            except Exception as e:
                bad.append(f"  BAD: {name} — {e}")
        if bad:
            print(f"WARNING: {len(bad)} corrupted entries!")
            for b in bad: print(b)
        else:
            print(f"OK — {len(z.namelist())} files, all readable.")

# ── tsuki-pkg package builder ─────────────────────────────────────────────────

def _remap_tsuki_pkg_path(arcname):
    """Remap monorepo pkg/ paths to tsuki-pkg libs/ layout."""
    parts = arcname.replace('\\', '/').split('/', 1)
    if parts[0] == 'pkg' and len(parts) == 2:
        remainder = parts[1]
        if remainder.startswith('.git') or remainder.startswith('keys/'):
            return None
        return 'libs/' + remainder
    return arcname

def build_tsuki_pkg_archive(repo_root=None, zip_path=None):
    if repo_root is None:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if zip_path is None:
        zip_path = os.path.join(repo_root, 'tsuki-pkg.zip')
    pkg_dir = os.path.join(repo_root, 'pkg')
    if not os.path.isdir(pkg_dir):
        raise FileNotFoundError(f"pkg/ not found at {pkg_dir} — submodule initialised?")
    SKIP_DIRS = {'.git', 'keys'}
    files_to_add = []
    for root, dirs, files in os.walk(pkg_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for file in files:
            abs_path = os.path.join(root, file)
            mono_arcname = os.path.relpath(abs_path, repo_root).replace(os.sep, '/')
            remapped = _remap_tsuki_pkg_path(mono_arcname)
            if remapped is not None:
                files_to_add.append((abs_path, remapped))
    print(f"Building tsuki-pkg archive: {len(files_to_add)} file(s) → {zip_path}")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as zipf:
        for i, (abs_path, arcname) in enumerate(files_to_add):
            info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(abs_path, 'rb') as f:
                zipf.writestr(info, f.read())
    print(f"OK — {zip_path}")
    return zip_path

if __name__ == '__main__':
    import argparse
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['repo', 'tsuki-pkg'], default='repo')
    parser.add_argument('--out', default=None)
    args = parser.parse_args()
    if args.mode == 'tsuki-pkg':
        build_tsuki_pkg_archive(_root, args.out or os.path.join(_root, 'tsuki-pkg.zip'))
    else:
        zip_directory(_root, args.out or os.path.join(_root, 'archive.zip'), [])