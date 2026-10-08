"""Compare the UI change's execution definitions and disposable component overlay."""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, xml.etree.ElementTree as ET

repo = Path(__file__).resolve().parents[3]
git = shutil.which('git')
if not git:
    raise RuntimeError('Git must be on PATH')
base = os.environ.get('POS_REFERENCE_BASE_REF', 'ba5143a3d1d5e97d2182ff7ba535f36862690a2f')
runtime = Path(os.environ['POS_REFERENCE_RUNTIME_ROOT']).resolve()
output = Path(os.environ['POS_REFERENCE_OUTPUT']).resolve()
output.mkdir(parents=True, exist_ok=True)

def git_read(*args):
    return subprocess.check_output([git, '-C', str(repo), *args])

screens = []
for rel in git_read('diff', '--name-only', base, '--', 'component').decode().splitlines():
    if not rel.endswith('.xml') or rel.endswith('/ZenithApp.xml'):
        continue
    old = ET.fromstring(git_read('show', base + ':' + rel))
    new = ET.parse(repo / rel).getroot()
    def execution(root):
        return [ET.tostring(e) for e in root if e.tag in
                ('parameter', 'always-actions', 'actions', 'transition', 'transition-include', 'subscreens')]
    assert execution(old) == execution(new), rel + ': execution definitions changed'
    if rel.endswith('/CashEntry.xml'):
        for form in old.iter('form-single'):
            if form.get('name') in ('CashInForm', 'CashOutForm'):
                for field in form.findall('field'):
                    if field.get('name') == 'amount':
                        field.find('default-field/text-line').attrib.pop('input-type', None)
    for tag in ('form-single', 'form-list'):
        assert [ET.tostring(e) for e in old.iter(tag)] == [ET.tostring(e) for e in new.iter(tag)], rel + ': unexpected native form changes'
    screens.append({'file': rel, 'executionDefinitionsUnchanged': True,
                    'formsUnchangedExceptDocumentedCashInputTypes': True})

paths = git_read('ls-files', '--cached', '--others', '--exclude-standard', 'component').decode().splitlines()
digest = hashlib.sha256()
mismatches = []
for rel in sorted(set(paths)):
    data = (repo / rel).read_bytes()
    target = runtime / rel
    if not target.is_file() or data != target.read_bytes():
        mismatches.append(rel)
    normalized = data.replace(b'\r\n', b'\n')
    digest.update(rel.encode() + b'\0' + hashlib.sha256(normalized).digest())
assert not mismatches, 'Runtime overlay differs: ' + ', '.join(mismatches)
result = {'baseCommit': base, 'screens': screens, 'componentFiles': len(set(paths)),
          'normalizedApplicationSha256': digest.hexdigest(), 'runtimeMismatches': mismatches,
          'productionAccess': False}
(output / 'source-checks.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({'screens': len(screens), 'componentFiles': len(set(paths)), 'runtimeMismatches': mismatches}))
