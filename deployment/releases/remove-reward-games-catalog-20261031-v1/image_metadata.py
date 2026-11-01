"""Read exact OCI image identities without Docker layer-size traversal."""
import json, re, subprocess

def command(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()

def image(reference):
    if re.fullmatch(r'sha256:[a-f0-9]{64}', reference):
        command(['ctr', '--namespace', 'moby', 'content', 'get', reference])
        return reference
    ref = 'docker.io/library/' + reference
    rows = command(['ctr', '--namespace', 'moby', 'images', 'list', 'name==' + ref]).splitlines()[1:]
    matches = [row.split() for row in rows if row.split() and row.split()[0] == ref]
    if len(matches) != 1 or not re.fullmatch(r'sha256:[a-f0-9]{64}', matches[0][2]):
        raise RuntimeError('Uncertain image identity')
    return matches[0][2]

def inspect(reference):
    manifest = json.loads(command(['ctr', '--namespace', 'moby', 'content', 'get', image(reference)]))
    config = json.loads(command(['ctr', '--namespace', 'moby', 'content', 'get', manifest['config']['digest']]))
    return {'Config': config['config'], 'RootFS': {'Layers': config['rootfs']['diff_ids']}}
