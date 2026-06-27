#!/usr/bin/env python3
"""Cortex Clash build step.

1. Bump the cache-busting version (the `?v=NN` query strings in index.html and
   the matching ones + `cortex-clash-vNN` CACHE name in sw.js) so installed PWAs
   and the service worker pick up changed game files.
2. Regenerate the single-file offline bundle (cortex-clash-standalone.html) from
   the current game/*.js, keeping the inlined fonts + peerjs from the existing
   bundle. The script set + load order are taken from index.html, so adding or
   removing a game script is handled automatically.

Run from anywhere: `python3 tools/build.py`. Used by .github/workflows/build.yml.
"""
import re, json, base64, gzip, os, sys, uuid as uuidlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
SW = os.path.join(ROOT, 'sw.js')
STANDALONE = os.path.join(ROOT, 'cortex-clash-standalone.html')
GAME = os.path.join(ROOT, 'game')
# stable namespace so a given game filename always maps to the same bundle UUID
NS = uuidlib.UUID('00000000-0000-0000-0000-0000cc0de000')


def read(p):
    return open(p, encoding='utf-8').read()


def write(p, s):
    open(p, 'w', encoding='utf-8').write(s)


def bump_version():
    idx = read(INDEX)
    cur = max(int(n) for n in re.findall(r'\?v=(\d+)', idx))
    nxt = cur + 1
    write(INDEX, re.sub(r'\?v=%d\b' % cur, '?v=%d' % nxt, idx))
    sw = read(SW)
    sw = re.sub(r'\?v=%d\b' % cur, '?v=%d' % nxt, sw)
    sw = re.sub(r'cortex-clash-v%d\b' % cur, 'cortex-clash-v%d' % nxt, sw)
    write(SW, sw)
    return cur, nxt


def _enc(text):
    return base64.b64encode(gzip.compress(text.encode('utf-8'), mtime=0)).decode('ascii')


def _dec(entry):
    raw = base64.b64decode(entry['data'])
    return gzip.decompress(raw) if entry.get('compressed') else raw


def rebuild_standalone():
    # ordered scripts from index.html: game/*.js (bundled) + the peerjs CDN one
    scripts = re.findall(r'<script src="([^"]+)"', read(INDEX))
    game_order = [re.sub(r'\?.*$', '', s).rsplit('/', 1)[-1] for s in scripts if s.startswith('game/')]
    first_lines = {fn: read(os.path.join(GAME, fn)).splitlines()[0] for fn in game_order}

    html = read(STANDALONE)
    man_m = re.search(r'(<script type="__bundler/manifest">\s*)(\{.*?\})(\s*</script>)', html, re.S)
    tpl_m = re.search(r'(<script type="__bundler/template">\s*)(".*?")(\s*</script>)', html, re.S)
    manifest = json.loads(man_m.group(2))
    template = json.loads(tpl_m.group(2))

    # classify existing JS assets: a game file (matched by its `// Cortex Clash —`
    # header) gets refreshed; the one minified JS with no match is peerjs
    file_uuid, peerjs_uuid = {}, None
    for uid, entry in manifest.items():
        if entry.get('mime') not in ('application/javascript', 'text/javascript'):
            continue
        head = _dec(entry).decode('utf-8', 'replace')[:160]
        fn = next((f for f in game_order if head.startswith(first_lines[f])), None)
        if fn:
            file_uuid[fn] = uid
            entry['data'] = _enc(read(os.path.join(GAME, fn)))
            entry['compressed'] = True
        else:
            peerjs_uuid = uid

    # bundle any game file not already present (stable, name-derived UUID)
    for fn in game_order:
        if fn not in file_uuid:
            uid = str(uuidlib.uuid5(NS, fn))
            file_uuid[fn] = uid
            manifest[uid] = {'mime': 'application/javascript', 'compressed': True,
                             'data': _enc(read(os.path.join(GAME, fn)))}

    # rebuild the template's <script> run to mirror index.html's order
    ordered, gi = [], 0
    for s in scripts:
        if s.startswith('game/'):
            ordered.append(file_uuid[game_order[gi]]); gi += 1
        elif peerjs_uuid and (s.startswith('http') or s.startswith('//')):
            ordered.append(peerjs_uuid)
    block = '\n'.join('<script src="%s"></script>' % u for u in ordered)
    template = re.sub(r'<script src="[0-9a-f-]{36}"></script>(?:\s*<script src="[0-9a-f-]{36}"></script>)*',
                      block, template, count=1)

    # drop orphaned JS assets no longer referenced (leave fonts alone)
    used = set(ordered)
    for uid in [u for u, e in manifest.items()
                if e.get('mime') in ('application/javascript', 'text/javascript') and u not in used]:
        del manifest[uid]

    new_man = json.dumps(manifest, separators=(',', ':')).replace('</', '<\\/')
    new_tpl = json.dumps(template).replace('</', '<\\/')
    html = html[:man_m.start(2)] + new_man + html[man_m.end(2):]
    tpl_m = re.search(r'(<script type="__bundler/template">\s*)(".*?")(\s*</script>)', html, re.S)
    html = html[:tpl_m.start(2)] + new_tpl + html[tpl_m.end(2):]
    write(STANDALONE, html)
    return game_order


def main():
    if not re.search(r'__bundler/manifest', read(STANDALONE)):
        print('standalone is not a recognised bundle — aborting', file=sys.stderr)
        return 1
    cur, nxt = bump_version()
    order = rebuild_standalone()
    print('bumped v%d -> v%d; standalone bundled: %s' % (cur, nxt, ', '.join(order)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
