# Use official Playwright base image with Python and Chromium
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Copy requirements and install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium browser ahead of time
RUN playwright install chromium

# Copy the rest of the code
COPY . .

# Expose the port (optional)
EXPOSE 10000

# Start server
CMD ["gunicorn", "webhook_server:app", "--bind", "0.0.0.0:10000"]
