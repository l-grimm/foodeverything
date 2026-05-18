
import pandas as pd
import requests
from bs4 import BeautifulSoup
import openai
import time
import json

# --- CONFIG ---
openai.api_key = "your-openai-api-key-here"  # 🔁 Replace with your real key
input_csv = "part_000000.csv"
output_csv = "cleaned_recipes.csv"
max_recipes = 10  # Change to None to run all

# --- Load URLs ---
df = pd.read_csv(input_csv)
urls = df["url"].dropna().unique()
if max_recipes:
    urls = urls[:max_recipes]

results = []

def extract_html_sections(url):
    try:
        resp = requests.get(url, timeout=10)
        soup = BeautifulSoup(resp.text, "html.parser")
        title = soup.title.string.strip() if soup.title else "Unknown"
        article = soup.find("article")
        text = article.get_text(separator="\n") if article else soup.get_text()
        return title, text[:5000]  # limit text for token use
    except Exception as e:
        return "Error", f"Failed to fetch HTML: {str(e)}"

def ask_gpt_to_format(title, body_text, url):
    prompt = f"""
Extract a structured recipe from the following webpage content. Output as JSON with these fields:

- title
- ingredients (as a list of strings)
- instructions (as a list of numbered steps)
- yield (if available)
- time (prep, cook, total)
- notes (optional)
- author (if mentioned)
- source_url

Webpage title: {title}
Source URL: {url}

Content:
{body_text}
"""
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4
        )
        content = response["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        return {"error": str(e), "source_url": url}

# --- Process Each URL ---
for i, url in enumerate(urls):
    print(f"[{i+1}/{len(urls)}] Processing: {url}")
    title, body = extract_html_sections(url)
    recipe = ask_gpt_to_format(title, body, url)
    results.append(recipe)
    time.sleep(1.5)  # avoid hammering OpenAI

# --- Save Output ---
pd.DataFrame(results).to_csv(output_csv, index=False)
print(f"✅ Saved structured recipes to {output_csv}")
