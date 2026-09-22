"""Activate the staged API and storefront only, after Studio admissions are drained."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import time
import urllib.request

ROOT = Path('/opt/earthora')
OLD_IMAGE = 'earthora-api:studio-flows20260921a'
NEW_IMAGE = 'earthora-api:voice-actions20260922a'
OLD_STORE = ROOT / 'releases/concierge-store-9380d85ef822'
NEW_STORE = ROOT / 'releases/voice-actions-store20260922a'
COMPOSE = ['docker', 'compose', '--project-directory', str(ROOT / 'infra'), '-f', str(ROOT / 'infra/compose.yml'), '-f', str(ROOT / 'infra/compose.override.yml')]

def run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + command[0])
    return result.stdout

def healthy():
    for _ in range(45):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4100/healthz', timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('API health check failed')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio-calls-drained', action='store_true', required=True)
    args = parser.parse_args()
    assert args.studio_calls_drained
    override = ROOT / 'infra/compose.override.yml'
    site = Path('/etc/nginx/sites-available/earthora-store')
    original_override, original_site = override.read_text(), site.read_text()
    assert original_override.count('image: ' + OLD_IMAGE) == 1
    assert original_site.count('root ' + str(OLD_STORE) + ';') == 1
    assert (NEW_STORE / 'index.html').is_file()
    image_id = json.loads(run(['docker', 'image', 'inspect', NEW_IMAGE]))[0]['Id']
    worker_before = json.loads(run(['docker', 'inspect', 'earthora-worker']))[0]['Id']
    backup = ROOT / 'backups' / ('voice-actions-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    for source in (override, site):
        shutil.copyfile(source, backup / source.name)
        (backup / source.name).chmod(0o600)
    try:
        override.write_text(original_override.replace('image: ' + OLD_IMAGE, 'image: ' + NEW_IMAGE))
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        healthy()
        site.write_text(original_site.replace('root ' + str(OLD_STORE) + ';', 'root ' + str(NEW_STORE) + ';'))
        run(['nginx', '-t']); run(['systemctl', 'reload', 'nginx'])
        assert json.loads(run(['docker', 'inspect', 'earthora-worker']))[0]['Id'] == worker_before
    except Exception:
        override.write_text(original_override); site.write_text(original_site)
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        run(['nginx', '-t']); run(['systemctl', 'reload', 'nginx'])
        raise
    print(json.dumps({'image': NEW_IMAGE, 'image_id': image_id, 'store': str(NEW_STORE),
                      'backup': str(backup), 'worker_unchanged': True, 'schema_unchanged': True}))

if __name__ == '__main__':
    main()
