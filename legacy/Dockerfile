FROM mcr.microsoft.com/playwright/python:v1.52.0-jammy

WORKDIR /app

# Install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY . .

# Ensure Chromium dependencies are present
RUN playwright install --with-deps chromium

# Use the production port Render expects
ENV PORT=10000

CMD ["gunicorn", "webhook_server:app", "--bind", "0.0.0.0:10000", "--timeout", "120"]
