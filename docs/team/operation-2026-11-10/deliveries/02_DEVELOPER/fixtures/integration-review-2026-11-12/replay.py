import os
import hashlib
import json
import pathlib
import subprocess
import tempfile

repo = pathlib.Path(os.environ.get('COSCODE_REVIEW_REPO', '.')).resolve()
proof = repo / 'docs/team/operation-2026-11-10/deliveries/02_DEVELOPER/fixtures/context-envelope-2026-11-12'
inputs = json.loads((proof / 'oci-input.json').read_text())
outputs = json.loads((proof / 'oci-output.json').read_text())
patch = (proof / 'oci-changes.patch').read_bytes()
sentinel = b'Keep owner file 00123 untouched.\n'

def git(root, *args, data=None, check=True):
    return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=root,
                          input=data, capture_output=True, check=check)

def prepare(root):
    for name, content in {**inputs, 'README.md': sentinel.decode()}.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode())
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, '-c', 'user.name=Review fixture', '-c', 'user.email=review@example.invalid',
        'commit', '-qm', 'review input')

def all_bytes(root):
    return {name: (root / name).read_bytes() for name in [*inputs, 'README.md']}

with tempfile.TemporaryDirectory(prefix='coscode-review-git-') as tmp:
    root = pathlib.Path(tmp)
    prepare(root)
    git(root, 'apply', '--check', '-', data=patch)
    git(root, 'apply', '--index', '-', data=patch)
    changed = git(root, 'diff', '--cached', '--name-only').stdout.decode().splitlines()
    assert sorted(changed) == sorted(inputs)
    for file in outputs:
        assert file['before'] == inputs[file['path']]
        assert git(root, 'show', ':' + file['path']).stdout == file['content'].encode()
        assert (root / file['path']).read_bytes() == file['content'].encode()
    assert (root / 'README.md').read_bytes() == sentinel
    before = all_bytes(root)
    assert git(root, 'apply', '--index', '-', data=patch, check=False).returncode != 0
    assert all_bytes(root) == before
    git(root, 'diff', '--cached', '--check')

with tempfile.TemporaryDirectory(prefix='coscode-review-stale-') as tmp:
    root = pathlib.Path(tmp)
    prepare(root)
    (root / 'src/add.js').write_bytes(b'// independent change\n')
    before = all_bytes(root)
    assert git(root, 'apply', '--index', '-', data=patch, check=False).returncode != 0
    assert all_bytes(root) == before
    assert git(root, 'diff', '--cached', '--name-only').stdout == b''

receipt = {
    'head_sha': git(repo, 'rev-parse', 'HEAD').stdout.decode().strip(),
    'kind': 'Independent artifact Git replay, not API/OCI/model execution',
    'patch_sha256': hashlib.sha256(patch).hexdigest(),
    'changed_files': sorted(inputs),
    'output_bytes_and_index_match': True,
    'untouched_readme_00123': True,
    'repeat_refused_without_changes': True,
    'stale_file_refused_without_changes': True,
    'model_called': False,
    'github_published': False,
}
out = pathlib.Path('/tmp/coscode-integration-review-2026-11-12')
out.mkdir(exist_ok=True)
(out / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(receipt, ensure_ascii=False, indent=2))
