#!/usr/bin/env python3
"""Combined native production-policy/SDK/Node HTTPS acceptance; local TLS only.
Uses production.py's scenario and run.py's isolated PTY and bounded cleanup.
"""
from production import main

if __name__ == "__main__":
    main(tls=True)
