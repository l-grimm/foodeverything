import openai
import requests
from bs4 import BeautifulSoup
import json
import time
import re

# --- CONFIGURATION ---
OPENAI_API_KEY = "sk-..."       # Replace with your OpenAI API key
AIRTABLE_TOKEN = "pat..."       # Replace with your Airtable API token
BASE_ID = "app..."              # Replace with your Airtable base ID
TABLE_NAME = "Recipes"          # Replace with your Airtable table name

openai.api_key = OPENAI_API_KEY

# --- READ URL LIST ---
with open("substack_urls.txt", "r") as f:
    urls = [line.strip() for line in f if line.strip()]

# --- PROCESS EACH URL ---
for url in urls:
    print(f"\n🔗 Processing: {url}")
    try:
        # STEP 1: SCRAPE
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        soup = BeautifulSoup(response.text, 'html.parser')
        article = soup.find('article')
        for tag in article.select('.subscribe, footer, nav'):
            tag.decompose()
        clean_text = article.get_text(separator='\n\n').strip()

        # STEP 2: GPT RECIPE EXTRACTION
        prompt = f"""
        You are a recipe extractor. From the article below, extract actual recipes only.
        Return a JSON object (or array) with fields:
        - title
        - ingredients (list)
        - instructions (list)
        - yield (if mentioned)
        - time (if mentioned)
        - notes (optional)
        - source_url (set as {url})
        Ignore all narrative or commentary.

        \"\"\"
        {clean_text}
        \"\"\"
        """
        chat_response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )
        raw = chat_response['choices'][0]['message']['content']

        # STEP 3: CLEAN JSON
        cleaned_json = re.sub(r"^```json|```$", "", raw.strip(), flags=re.MULTILINE).strip("` \n")
        recipe = json.loads(cleaned_json)[0] if cleaned_json.startswith("[") else json.loads(cleaned_json)

        # STEP 4: PREP FIELDS FOR AIRTABLE
        fields = {
            "Name": recipe["title"],
            "Ingredients": "\n".join(recipe["ingredients"]),
            "Instructions": "\n".join(recipe["instructions"]),
            "Yield": recipe.get("yield", ""),
            "Time": recipe.get("time", ""),
            "Notes": recipe.get("notes", ""),
            "Author": "Ruth Reichl",
            "Source URL": recipe["source_url"]
        }

        # STEP 5: UPLOAD TO AIRTABLE
        airtable_url = f"https://api.airtable.com/v0/{BASE_ID}/{TABLE_NAME}"
        headers = {
            "Authorization": f"Bearer {AIRTABLE_TOKEN}",
            "Content-Type": "application/json"
        }
        upload_response = requests.post(airtable_url, headers=headers, json={"fields": fields})

        if upload_response.status_code in [200, 201]:
            print(f"✅ Uploaded: {recipe['title']}")
        else:
            print(f"❌ Airtable error ({upload_response.status_code}):", upload_response.json())

        time.sleep(2)  # avoid hitting GPT rate limits

    except Exception as e:
        print("❌ Skipped due to error:", e)
