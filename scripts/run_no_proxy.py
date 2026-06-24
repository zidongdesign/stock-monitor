#!/usr/bin/env python3
"""Wrapper: disable macOS system proxy before running daily_analysis.py"""
import os
import sys

# Clear proxy env vars
for k in ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']:
    os.environ.pop(k, None)
os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'

# Monkey-patch requests.Session to ignore system proxy (macOS networksetup)
import requests
_orig_init = requests.Session.__init__
def _patched_init(self, *a, **kw):
    _orig_init(self, *a, **kw)
    self.trust_env = False
requests.Session.__init__ = _patched_init

# Now run the actual script
import runpy
sys.argv = ['daily_analysis.py']
os.chdir(os.path.dirname(os.path.abspath(__file__)))
runpy.run_path('daily_analysis.py', run_name='__main__')
