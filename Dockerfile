FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Set Playwright cache to a writable path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install Chromium to that path
RUN playwright install chromium

COPY . .

EXPOSE 10000

CMD ["gunicorn", "webhook_server:app", "--bind", "0.0.0.0:10000"]
