"""Activate the prebuilt API/worker overlay that keeps the knowledge base's product documents in sync.

API and worker containers only (both run the same image with different ROLE): the
storefront, legacy voice container, PostgreSQL and Nginx are untouched. Run only
after the external Voice Studio admission gate is held and calls have drained, so
no in-flight voice tool call meets the API restart.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.request

ROOT = Path('/opt/earthora')
OLD_API = 'earthora-api:bulk-policy20260925a'
OLD_WORKER = 'earthora-worker:studio-flows20260921a'
NEW_IMAGE = 'earthora-api:kb-sync20260928a'
RELEASE = ROOT / 'releases/kb-sync20260928a'
COMPOSE = ['docker', 'compose', '--project-directory', str(ROOT / 'infra'),
           '-f', str(ROOT / 'infra/compose.yml'), '-f', str(ROOT / 'infra/compose.override.yml')]


def run(command, timeout=100):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + command[0] + ' ' + result.stderr[-300:])
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


def worker_ready():
    """The worker must come up and advertise the sync job kind."""
    for _ in range(60):
        state = inspect('earthora-worker')['State']
        logs = subprocess.run(['docker', 'logs', '--since', '3m', 'earthora-worker'], capture_output=True, text=True).stdout
        if state['Status'] == 'running' and 'job worker starting' in logs and 'kb_sync_products' in logs:
            return
        time.sleep(1)
    raise RuntimeError('Worker did not start with the sync job registered')


def psql(query):
    env = dict(line.split('=', 1) for line in (ROOT / 'infra/api.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    match = re.match(r'postgres(?:ql)?://([^:]+):[^@]+@[^/]+/([^?]+)', env['DATABASE_URL'])
    return run(['docker', 'exec', 'earthora-postgres', 'psql', '-U', match.group(1), '-d', match.group(2), '-At', '-F', '|', '-c', query]).strip().splitlines()


def first_sync():
    """The schedule enqueues a sync on the worker's first loop; wait for it to finish."""
    for _ in range(90):
        rows = psql("SELECT status, coalesce(result::text,''), coalesce(last_error,'') FROM jobs WHERE kind='kb_sync_products' ORDER BY created_at DESC LIMIT 1")
        if rows and rows[0].startswith('succeeded'):
            return rows[0]
        if rows and rows[0].startswith('failed'):
            raise RuntimeError('First product sync failed: ' + rows[0][-200:])
        time.sleep(2)
    raise RuntimeError('No product sync completed after activation')


def verify():
    checks = {}
    for domain in ('www.earthorafarms.com', 'earthora.srv1915512.hstgr.cloud'):
        command = ['curl', '--silent', '--show-error', '--fail', '--max-time', '15', '--resolve', domain + ':443:127.0.0.1']
        catalogue = json.loads(run(command + ['https://' + domain + '/api/store/catalog']))
        guide = json.loads(run(command + ['https://' + domain + '/api/platform/voice/site-guide']))
        assert isinstance(catalogue.get('products'), list) and isinstance(guide.get('destinations'), list)
        checks[domain] = {'product_count': len(catalogue['products']), 'site_guide_destinations': len(guide['destinations'])}
    checks['first_sync'] = first_sync()
    checks['product_documents'] = psql("SELECT title, status, updated_at::timestamp(0) FROM kb_documents WHERE uri LIKE 'product:%' ORDER BY title")
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--studio-calls-drained', action='store_true', required=True)
    args = parser.parse_args()
    assert args.studio_calls_drained
    assert inspect('earthora-api')['Config']['Image'] == OLD_API, 'Unexpected live API image'
    assert inspect('earthora-worker')['Config']['Image'] == OLD_WORKER, 'Unexpected live worker image'
    manifest = json.loads((RELEASE / 'manifest.json').read_text())
    for name, digest in manifest.items():
        target = (RELEASE / name).resolve()
        assert target.is_relative_to(RELEASE) and target.is_file()
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    new_image_id = inspect(NEW_IMAGE)['Id']
    unchanged = {name: inspect(name)['Id'] for name in ('earthora-voice', 'earthora-postgres')}
    override = ROOT / 'infra/compose.override.yml'
    original = override.read_bytes()
    text = original.decode()
    assert text.count('image: ' + OLD_API) == 1 and text.count('image: ' + OLD_WORKER) == 1
    backup = ROOT / 'backups' / ('kb-sync-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    (backup / override.name).write_bytes(original)
    (backup / override.name).chmod(0o600)
    try:
        override.write_text(text.replace('image: ' + OLD_API, 'image: ' + NEW_IMAGE).replace('image: ' + OLD_WORKER, 'image: ' + NEW_IMAGE))
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api', 'worker'], timeout=180)
        health()
        worker_ready()
        checks = verify()
        assert inspect('earthora-api')['Config']['Image'] == NEW_IMAGE and inspect('earthora-worker')['Config']['Image'] == NEW_IMAGE
        assert all(inspect(name)['Id'] == value for name, value in unchanged.items()), 'Unrelated service changed'
    except Exception:
        override.write_bytes(original)
        run(COMPOSE + ['up', '-d', '--no-build', '--no-deps', 'api', 'worker'], timeout=180)
        health()
        raise
    result = {'image': NEW_IMAGE, 'image_id': new_image_id, 'previous_api_image': OLD_API, 'previous_worker_image': OLD_WORKER,
              'backup': str(backup), 'schema_and_business_data_unchanged': True, 'voice_postgres_unchanged': True,
              'storefront_and_nginx_unchanged': True, 'checks': checks}
    (RELEASE / 'activation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
