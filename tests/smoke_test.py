"""Smoke-test release in Chromium, including strict CSP, offline processing and exports.
Requires: pip install playwright; Chromium installed.
Usage: python tests/smoke_test.py [baseline.pack] [comparison.pack]
No real diagnostic logs are bundled with the public site.
"""
from pathlib import Path
import sys, shutil, time, struct
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
HTML=ROOT/'kobra-mesh-lab-v1.2.14-standalone.html'


def wait_until(predicate, timeout=30.0, step=0.1):
    end=time.time()+timeout
    while time.time()<end:
        if predicate(): return True
        time.sleep(step)
    return False


def run():
    assert HTML.exists(), 'Run python build.py first'
    from subprocess import check_call
    check_call([sys.executable,str(ROOT/'build.py')])
    argv=sys.argv[1:]
    logs=[Path(a).resolve() for a in argv]
    for log in logs:assert log.is_file(),log
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=shutil.which('chromium') or shutil.which('google-chrome') or None,args=['--no-sandbox','--disable-gpu'])
        for width in (1440,390):
            page=browser.new_page(viewport={'width':width,'height':950},accept_downloads=True)
            errors=[]; requests=[]
            page.on('pageerror',lambda exc:errors.append(str(exc)))
            page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
            page.on('request',lambda request:requests.append(request.url))
            # Chromium in some restricted environments blocks navigation, but
            # set_content still enforces the HTML's exact meta CSP.
            page.set_content(HTML.read_text(encoding='utf-8'),wait_until='load')
            assert page.locator('html').get_attribute('data-kobra-ready')=='true'
            assert not page.locator('#runtimeNotice').is_visible()
            assert page.locator('#showPlate2D').is_checked()
            assert page.locator('#showPlate3D').is_checked()
            assert 'Control → Smart assist → Calibration → Auto levelling' in page.locator('.notes-section').inner_text()
            assert '(2×)' not in page.locator('.controls-end').inner_text()
            assert wait_until(lambda: page.evaluate("KOBRA_PLATE.isReady('base') && KOBRA_PLATE.isReady('marks')"), timeout=10)
            assert page.evaluate('KOBRA_PLATE.worldRect[0] < 0 && KOBRA_PLATE.worldRect[1] < 0')
            page.locator('#demoBtn').click()
            assert 'SIMULATED DEMO' in page.locator('#status').inner_text()
            assert page.locator('#results').is_visible()
            page.locator('#surfaceSelect').select_option('D')
            page.locator('#showPlate2D').uncheck()
            page.locator('#showPlate3D').uncheck()
            page.locator('#showPlate2D').check()
            page.locator('#showPlate3D').check()
            page.locator('#deltaMode').select_option('detrended')
            if logs:
                page.locator('#fileA').set_input_files(str(logs[0]))
                assert wait_until(lambda: 'Loaded' in page.locator('#status').inner_text(), timeout=30)
                assert len(page.locator('#meshA option').all_inner_texts())>=1
            if len(logs)>1:
                page.locator('#fileB').set_input_files(str(logs[1]))
                assert wait_until(lambda: not page.locator('#downloadD').is_disabled(), timeout=30)
                page.locator('#surfaceSelect').select_option('D')
                assert not page.locator('#downloadD').is_disabled()
                for id in ('downloadA','downloadAPng','downloadB','downloadBPng','downloadD','downloadPng'):
                    with page.expect_download(timeout=10000) as d:page.locator('#'+id).click()
                    assert d.value.suggested_filename
                    if id in ('downloadAPng','downloadBPng','downloadPng'):
                        data=Path(d.value.path()).read_bytes()
                        assert data[:8]==b'\x89PNG\r\n\x1a\n', 'Invalid PNG export'
                        assert struct.unpack('>II',data[16:24])==(1120,960), 'PNG must be exactly 2x 560x480'
            assert not errors, errors
            assert not requests,requests
            print(f'PASS {width}px: CSP, JS, demo, plate toggles, comparison, file loading (if supplied), no network')
            page.close()
        browser.close()

if __name__=='__main__':run()
