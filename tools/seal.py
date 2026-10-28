#!/usr/bin/env python3
"""Seals a file for the site board's sync folder, so it can travel through this public repository unreadable.

Only the site-board-api function holds the private key (it made the key pair itself and keeps it in the project
vault), so nobody can open a sealed file. Each file is also signed with the sealing tool's own signing key, which
stays with whoever runs this tool and is never in the repository; the function opens only files with a signature
from a key it knows. The sync workflow (on a push to main) asks the function to bring each new sync/*.sealed in.

    python3 tools/seal.py new-signing-key ../secret/sync_sign.pem      (once; prints the key id and public half)

    python3 tools/seal.py app board tools/out/board-data.json -o sync/board-data.sealed
    python3 tools/seal.py docs records.json [--replace] [--by-email someone@example.com] -o sync/records-2026-10-28.sealed
    python3 tools/seal.py asset <32-hex id> photo.jpg --type image/jpeg [--level 1] -o sync/asset-<id>.sealed
    python3 tools/seal.py file "uploads/drawings/S100.pdf" S100.pdf [--level 1] -o sync/file-s100.sealed
    python3 tools/seal.py owner katiso@example.com "Full Name" -o sync/owner.sealed
    python3 tools/seal.py test-users users.json [--remove] -o sync/test-users.sealed
Every sealing command takes --sign <signing key .pem> (default ../secret/sync_sign.pem next to the repository).
Levels: 1 everyone on the board, 2 Pump Group team (contributors and editors), 3 editors only.
"""
import argparse, base64, hashlib, json, mimetypes, os, struct, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HERE = os.path.dirname(os.path.abspath(__file__))
OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
DEFAULT_SIGN = os.path.join(HERE, '..', '..', 'secret', 'sync_sign.pem')

def raw_public(sk):
    return sk.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

def key_id(sk):
    return hashlib.sha256(raw_public(sk)).hexdigest()[:16]

def load_signer(path):
    return serialization.load_pem_private_key(open(path, 'rb').read(), password=None)

# PGSB2: magic, header length, header {sk, ek, iv}, AES-GCM(meta length + meta + payload) with the first part as
# additional data, then an Ed25519 signature over everything before it
def seal(meta, payload, sk, pub_path=os.path.join(HERE, 'sync_public.pem')):
    pub = serialization.load_pem_public_key(open(pub_path, 'rb').read())
    key, iv = AESGCM.generate_key(256), os.urandom(12)
    m = json.dumps(meta, separators=(',', ':')).encode()
    head = json.dumps({'sk': key_id(sk), 'ek': base64.b64encode(pub.encrypt(key, OAEP)).decode(), 'iv': base64.b64encode(iv).decode()}, separators=(',', ':')).encode()
    first = b'PGSB2\n' + struct.pack('>I', len(head)) + head
    body = first + AESGCM(key).encrypt(iv, struct.pack('>I', len(m)) + m + payload, first)
    return body + sk.sign(body)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('kind', choices=['app', 'docs', 'asset', 'file', 'owner', 'test-users', 'new-signing-key'])
    ap.add_argument('args', nargs='*')
    ap.add_argument('-o', '--out'); ap.add_argument('--level', type=int); ap.add_argument('--type')
    ap.add_argument('--replace', action='store_true'); ap.add_argument('--remove', action='store_true')
    ap.add_argument('--by-email'); ap.add_argument('--sign', default=DEFAULT_SIGN)
    ap.add_argument('--pub', default=os.path.join(HERE, 'sync_public.pem'), help='the public key the function made (sync_public.pem)')
    a = ap.parse_args()
    if a.kind == 'new-signing-key':
        out = a.args[0] if a.args else a.sign
        if os.path.exists(out): sys.exit(f'{out} already exists')
        sk = Ed25519PrivateKey.generate()
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as fh:
            fh.write(sk.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        print(json.dumps({key_id(sk): base64.b64encode(raw_public(sk)).decode()})); return
    sk = load_signer(a.sign)
    if a.kind == 'app':
        key, f = a.args; v = json.load(open(f)); meta = {'kind': 'app', 'key': key, 'level': a.level or 1}
        payload = json.dumps(v, separators=(',', ':'), ensure_ascii=False).encode()
    elif a.kind == 'docs':
        docs = json.load(open(a.args[0]))
        assert isinstance(docs, list) and all(isinstance(d, dict) and 'path' in d and isinstance(d.get('data'), dict) for d in docs), 'docs: a list of {path, data}'
        meta = {'kind': 'docs', 'replace': a.replace, **({'by_email': a.by_email} if a.by_email else {})}
        payload = json.dumps(docs, separators=(',', ':'), ensure_ascii=False).encode()
    elif a.kind == 'asset':
        aid, f = a.args; assert len(aid) == 32 and all(c in '0123456789abcdef' for c in aid), 'asset id: 32 lowercase hex'
        t = a.type or mimetypes.guess_type(f)[0] or 'application/octet-stream'
        meta = {'kind': 'asset', 'id': aid, 'type': t, 'level': a.level or 1}; payload = open(f, 'rb').read()
    elif a.kind == 'file':
        path, f = a.args; t = a.type or mimetypes.guess_type(f)[0] or 'application/octet-stream'
        import re
        assert re.fullmatch(r'[A-Za-z0-9 _.,()&+~-]+(/[A-Za-z0-9 _.,()&+~-]+)*', path) and '/.' not in '/' + path and len(path.encode()) <= 600, \
            'document names: letters, digits, spaces and - _ . , ( ) & + ~, no part starting with a dot'
        meta = {'kind': 'file', 'path': path, 'type': t, 'level': a.level or 3}; payload = open(f, 'rb').read()
    elif a.kind == 'owner':
        email, name = a.args; meta = {'kind': 'owner', 'email': email, 'name': name}; payload = b''
    else:
        meta = {'kind': 'test_users', 'users': json.load(open(a.args[0])), 'remove': a.remove}; payload = b''
    out = seal(meta, payload, sk, a.pub)
    if not a.out: sys.exit('give -o sync/<name>.sealed')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, 'wb').write(out)
    print(f'sealed {meta["kind"]} -> {a.out} ({len(out)} bytes)')

if __name__ == '__main__':
    main()
