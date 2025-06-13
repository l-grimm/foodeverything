# Dockerfile for deploying TikTok recipe webhook to Render

# Base image: includes Python and Playwright support
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files into container
COPY . .

# Expose port (Render ignores this but useful for local dev)
EXPOSE 10000

# Start the server using Gunicorn
CMD ["gunicorn", "webhook_server:app", "--bind", "0.0.0.0:10000"]
