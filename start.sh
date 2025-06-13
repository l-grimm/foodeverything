#!/bin/bash

# Install Chromium for Playwright (if not already installed)
npx playwright install chromium

# Run your Flask app via Gunicorn
gunicorn webhook_server:app
