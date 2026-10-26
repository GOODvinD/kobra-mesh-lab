#!/usr/bin/env python3
"""Deterministic privacy-preserving standalone build with CSP SHA-256 hashes.

Usage: python build.py
Inputs: index.html, style.css, vendor/pako_inflate.min.js, surface3d.js, app.js.
Output: kobra-mesh-lab-v1.2.14-standalone.html
"""
from pathlib import Path
from html import escape
import base64, hashlib, re
ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'kobra-mesh-lab-v1.2.14-standalone.html'


def sha256_csp(value: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(value.encode('utf-8')).digest()).decode() + "'"


def main():
    from prepare_plate_asset import build as prepare_plate
    prepare_plate()
    text = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'style.css').read_text(encoding='utf-8')
    body_css = '\n' + css + '\n'
    orig = '<link rel="stylesheet" href="style.css">'
    assert text.count(orig) == 1
    text = text.replace(orig, '<style>' + body_css + '</style>', 1)
    script_hashes=[]
    for filename in ['vendor/pako_inflate.min.js','plate-assets.js','surface3d.js','app.js']:
        original = f'<script src="{filename}" defer></script>'
        assert text.count(original) == 1, f'Missing script reference {filename}'
        code = '\n' + (ROOT / filename).read_text(encoding='utf-8') + '\n'
        if '</script' in code.lower():
            raise RuntimeError('Cannot safely inline an embedded closing script element')
        text = text.replace(original,'<script>'+code+'</script>',1)
        script_hashes.append(sha256_csp(code))
    policy = (
        "default-src 'none'; "
        "script-src " + ' '.join(script_hashes) + '; '
        "style-src " + sha256_csp(body_css) + '; '
        "img-src data: blob:; connect-src 'none'; "
        "object-src 'none'; base-uri 'none'; form-action 'none'; "
        "frame-src 'none'; worker-src 'none'; font-src 'none'; "
        "media-src 'none'; manifest-src 'none'"
    )
    # Replace CSP only, preserve all other meta tags.
    csp_re=re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">')
    assert len(csp_re.findall(text))==1, 'Expected a single CSP meta tag'
    text=csp_re.sub(lambda _: f'<meta http-equiv="Content-Security-Policy" content="{escape(policy,quote=True)}">',text,count=1)
    OUT.write_text(text,encoding='utf-8')
    # Build integrity self-test using exact bytes from generated HTML.
    actual_style=re.findall(r'<style>(.*?)</style>',text,re.S)
    actual_scripts=re.findall(r'<script>(.*?)</script>',text,re.S)
    assert len(actual_style)==1 and len(actual_scripts)==4, f'Unexpected inline blocks: {len(actual_style)}, {len(actual_scripts)}'
    assert sha256_csp(actual_style[0]) in policy
    assert all(sha256_csp(s) in policy for s in actual_scripts)
    assert 'unsafe-inline' not in policy and "connect-src 'none'" in policy
    print(f'Built: {OUT} ({OUT.stat().st_size} bytes)')
    print('CSP: 4 JavaScript hashes + 1 CSS hash, connect-src none')

if __name__=='__main__':main()
