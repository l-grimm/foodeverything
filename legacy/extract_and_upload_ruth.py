import openai
import requests
from bs4 import BeautifulSoup
import json

def format_time(time_val):
    if not time_val:
        return ""
    if isinstance(time_val, dict):
        # make a human-friendly single-line string
        parts = []
        for k in ["prep", "cook", "active", "total"]:
            if time_val.get(k):
                parts.append(f"{k.capitalize()}: {time_val[k]}")
        return " | ".join(parts) if parts else ""
    if isinstance(time_val, list):
        return " | ".join(str(x) for x in time_val)
    return str(time_val)


# --- CONFIGURATION ---
OPENAI_API_KEY = "REDACTED-2026-05-18"  # archived; rotate this key in OpenAI dashboard
AIRTABLE_TOKEN = "REDACTED-2026-05-18"  # archived; rotate this PAT in Airtable
BASE_ID = "app0GloGj3Fu5To0O"         
TABLE_NAME = "Digital Recipe Import"     

# --- STEP 1: FETCH AND CLEAN ARTICLE CONTENT ---
url = 'https://cjeatsrecipes.com/din-tai-fung-taiwanese-cabbage-with-garlic/'
headers = {'User-Agent': 'Mozilla/5.0'}
response = requests.get(url, headers=headers)
soup = BeautifulSoup(response.text, 'html.parser')

article = soup.find('article')

if article:
    for tag in article.select('.subscribe, footer, nav'):
        tag.decompose()
    clean_text = article.get_text(separator='\n\n').strip()
else:
    # Fallback for sites without <article> (e.g. James Beard Archive)
    for tag in soup.select('script, style, nav, header, footer, noscript'):
        tag.decompose()

    main = (
        soup.select_one('main')
        or soup.select_one('[role="main"]')
        or soup.body
    )

    clean_text = (
        main.get_text(separator='\n\n').strip()
        if main else soup.get_text(separator='\n\n').strip()
    )


# --- STEP 2: GPT RECIPE EXTRACTION ---
openai.api_key = OPENAI_API_KEY
prompt = f"""
You are a recipe extractor. From the Substack post below, extract any actual recipes. Ignore storytelling. 

Return the result as a JSON object with:
- title
- ingredients (list of strings)
- instructions (list of steps)
- yield (if mentioned)
- time (if mentioned)
- notes (optional)
- source_url: {url}

Post content:
\"\"\"
{clean_text}
\"\"\"
"""

# --- STEP 2: GPT RECIPE EXTRACTION (with formatting cleanup) ---
response = openai.ChatCompletion.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": prompt}],
    temperature=0
)

recipe_json = response['choices'][0]['message']['content']
print("🔍 GPT Output:")
print(recipe_json)  # Show raw response for inspection

# --- CLEAN GPT FORMATTING ---
import re

# Remove Markdown code block wrappers like ```json ... ```
cleaned_json = re.sub(r"^```json|```$", "", recipe_json.strip(), flags=re.MULTILINE).strip("` \n")

# --- SAFELY PARSE JSON ---
try:
    recipe = json.loads(cleaned_json)[0] if cleaned_json.startswith("[") else json.loads(cleaned_json)
except json.JSONDecodeError as e:
    print("❌ JSON parsing error:", e)
    print("🧾 Raw cleaned content:\n", cleaned_json)
    exit(1)

    exit(1)


# --- STEP 3: FORMAT & SEND TO AIRTABLE ---
fields = {
    "Name": recipe["title"],
    "Ingredients": "\n".join(recipe["ingredients"]),
    "Instructions": "\n".join(recipe["instructions"]),
    "Yield": recipe.get("yield", ""),
    "Time": format_time(recipe.get("time")),
    "Notes": "\n".join(recipe["notes"]) if isinstance(recipe.get("notes"), list) else recipe.get("notes", ""),
    "Author": "Ruth Reichl",
    "Source": recipe["source_url"]
}

airtable_url = f"https://api.airtable.com/v0/{BASE_ID}/{TABLE_NAME}"
headers = {
    "Authorization": f"Bearer {AIRTABLE_TOKEN}",
    "Content-Type": "application/json"
}
record = {"fields": fields}
upload_response = requests.post(airtable_url, headers=headers, json=record)

print("✅ Upload Status:", upload_response.status_code)
print("📎 Airtable Response:", upload_response.json())
