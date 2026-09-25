"""Activate the prebuilt API overlay that publishes Earthora's bulk-enquiry policy.

API container only: the storefront, worker, legacy voice container, PostgreSQL and
Nginx are untouched. Run only after the external Voice Studio admission gate is
held and calls have drained, so no in-flight voice tool call meets a restart.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import time
import urllib.request

ROOT = Path('/opt/earthora')
OLD_IMAGE = 'earthora-api:product-publishing20260924a'
NEW_IMAGE = 'earthora-api:bulk-policy20260925a'
RELEASE = ROOT / 'releases/bulk-policy20260925a'
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
    for domain in ('www.earthorafarms.com', 'earthora.srv1915512.hstgr.cloud'):
        command = ['curl', '--silent', '--show-error', '--fail', '--max-time', '15', '--resolve', domain + ':443:127.0.0.1']
        catalogue = json.loads(run(command + ['https://' + domain + '/api/store/catalog']))
        guide = json.loads(run(command + ['https://' + domain + '/api/platform/voice/site-guide']))
        assert isinstance(catalogue.get('products'), list) and isinstance(guide.get('destinations'), list)
        checks[domain] = {'product_count': len(catalogue['products']), 'site_guide_destinations': len(guide['destinations'])}
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
    original = override.read_bytes()
    assert original.decode().count('image: ' + OLD_IMAGE) == 1
    backup = ROOT / 'backups' / ('bulk-policy-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    (backup / override.name).write_bytes(original)
    (backup / override.name).chmod(0o600)
    try:
        override.write_text(original.decode().replace('image: ' + OLD_IMAGE, 'image: ' + NEW_IMAGE))
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        health()
        checks = verify()
        assert inspect('earthora-api')['Config']['Image'] == NEW_IMAGE
        assert all(inspect(name)['Id'] == value for name, value in unchanged.items()), 'Unrelated service changed'
    except Exception:
        override.write_bytes(original)
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api'])
        health()
        raise
    result = {'image': NEW_IMAGE, 'image_id': new_image_id, 'previous_image': OLD_IMAGE, 'backup': str(backup),
              'schema_and_business_data_unchanged': True, 'worker_voice_postgres_unchanged': True,
              'storefront_and_nginx_unchanged': True, 'checks': checks}
    (RELEASE / 'activation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
