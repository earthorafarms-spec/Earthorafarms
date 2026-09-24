"""Activate a prebuilt product API overlay and storefront; preserve data/channels.

Run only after the external Voice Studio admission gate is held and calls drain.
The local operator stages the source/build manifest and verifies the base image.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import time
import urllib.request

ROOT = Path('/opt/earthora')
OLD_IMAGE = 'earthora-api:voice-actions20260922c'
NEW_IMAGE = 'earthora-api:product-publishing20260924a'
RELEASE = ROOT / 'releases/product-publishing20260924a'
OLD_STORE = ROOT / 'releases/voice-actions-store20260922b'
NEW_STORE = RELEASE / 'storefront'
COMPOSE = ['docker', 'compose', '--project-directory', str(ROOT / 'infra'),
           '-f', str(ROOT / 'infra/compose.yml'), '-f', str(ROOT / 'infra/compose.override.yml')]


def run(command, timeout=100):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + command[0])
    return result.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def health():
    for _ in range(45):
        try:
            with urllib.request.urlopen('http://127.0.0.1:4100/healthz', timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('API health check failed')


def verify():
    checks = {}
    expected = hashlib.sha256((NEW_STORE / 'index.html').read_bytes()).hexdigest()
    for domain in ('www.earthorafarms.com', 'earthora.srv1915512.hstgr.cloud'):
        # Keep certificate validation and Host/SNI, bypass only external routing.
        command = ['curl', '--silent', '--show-error', '--fail', '--max-time', '15',
                   '--resolve', domain + ':443:127.0.0.1']
        page = subprocess.run(command + ['https://' + domain + '/'], capture_output=True, timeout=20)
        assert page.returncode == 0 and hashlib.sha256(page.stdout).hexdigest() == expected, 'Storefront mismatch'
        headers = run(command + ['-D', '-', '-o', '/dev/null', 'https://' + domain + '/api/store/catalog'])
        assert 'cache-control: no-store' in headers.lower(), 'Catalogue freshness header missing'
        catalogue = json.loads(run(command + ['https://' + domain + '/api/store/catalog']))
        assert isinstance(catalogue.get('products'), list)
        widget = run(command + ['-D', '-', '-o', '/dev/null', 'https://' + domain + '/widget.js'])
        assert '200' in widget.splitlines()[0], 'Widget unavailable'
        checks[domain] = {'index_sha256': expected, 'catalogue_no_store': True,
                          'product_count': len(catalogue['products']), 'widget_http_200': True}
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio-calls-drained', action='store_true', required=True)
    args = parser.parse_args()
    assert args.studio_calls_drained
    assert inspect('earthora-api')['Config']['Image'] == OLD_IMAGE, 'Unexpected live API image'
    manifest = json.loads((RELEASE / 'manifest.json').read_text())
    for name, digest in manifest.items():
        target = (RELEASE / name).resolve()
        assert target.is_relative_to(RELEASE) and target.is_file()
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    new_image_id = inspect(NEW_IMAGE)['Id']
    unchanged = {name: inspect(name)['Id'] for name in ('earthora-worker', 'earthora-voice', 'earthora-postgres')}
    override = ROOT / 'infra/compose.override.yml'
    sites = [Path('/etc/nginx/sites-available') / name for name in ('earthora-store', 'earthora-real-domain')]
    originals = {path: path.read_bytes() for path in [override, *sites]}
    assert originals[override].decode().count('image: ' + OLD_IMAGE) == 1
    for site in sites:
        assert originals[site].decode().count('root ' + str(OLD_STORE) + ';') == 1
    # Old open tabs may still request the previous content-hashed lazy chunks.
    for source in (OLD_STORE / 'assets').rglob('*'):
        if source.is_file():
            destination = NEW_STORE / 'assets' / source.relative_to(OLD_STORE / 'assets')
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
    backup = ROOT / 'backups' / ('product-publishing-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    for path, content in originals.items():
        saved = backup / path.name
        saved.write_bytes(content)
        saved.chmod(0o600)
    try:
        override.write_text(originals[override].decode().replace('image: ' + OLD_IMAGE, 'image: ' + NEW_IMAGE))
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        health()
        for site in sites:
            site.write_text(originals[site].decode().replace('root ' + str(OLD_STORE) + ';', 'root ' + str(NEW_STORE) + ';'))
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        time.sleep(2)
        checks = verify()
        assert all(inspect(name)['Id'] == value for name, value in unchanged.items()), 'Unrelated service changed'
    except Exception:
        for path, content in originals.items():
            path.write_bytes(content)
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        health()
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        raise
    result = {'image': NEW_IMAGE, 'image_id': new_image_id, 'storefront': str(NEW_STORE),
              'backup': str(backup), 'schema_and_business_data_unchanged': True,
              'worker_voice_postgres_unchanged': True, 'checks': checks}
    (RELEASE / 'activation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
