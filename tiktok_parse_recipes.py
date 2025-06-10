from pyairtable import Table

# Airtable config
AIRTABLE_API_KEY = "pat5L1fzRwBSQqG6W.8e47bd3d4fe97db8b3388889b522df8b068cb2f8ca8c749e3e031fb2b54ec1a2 "
AIRTABLE_BASE_ID = "app0GloGj3Fu5To0O"
AIRTABLE_TABLE_NAME = "Recipes"

table = Table(AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME)

import json
import openai
from playwright.sync_api import sync_playwright

import os
openai.api_key = os.environ["OPENAI_API_KEY"]

# 📂 Load the list of TikTok URLs
with open("tiktoks.json", "r") as f:
    video_urls = json.load(f)

# 🧠 GPT system prompt
system_prompt = """
You are a recipe parser. Your job is to extract structured recipes from TikTok video captions. 
Each caption may contain a list of ingredients and cooking steps. Return the result in this JSON format:

{
  "title": "...",
  "ingredients": [
    {"quantity": "1", "unit": "tbsp", "ingredient": "butter"},
    ...
  ],
  "instructions": [
    "Step 1...",
    "Step 2..."
  ]
}
"""

# 🚀 Open browser to scrape TikTok captions
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    for url in video_urls:
        print(f"\n🔗 Processing video: {url}")
        page.goto(url, timeout=15000)

        try:
            page.wait_for_selector('[data-e2e="browse-video-desc"]', timeout=8000)
            caption = page.locator('[data-e2e="browse-video-desc"]').inner_text()
            print(f"📝 Caption: {caption}")

            # 🧠 Send caption to GPT
            response = openai.ChatCompletion.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": caption}
                ]
            )

            recipe = response["choices"][0]["message"]["content"]
            # 🧼 Clean the GPT output — remove markdown formatting like ```json
            cleaned = recipe.strip().removeprefix("```json").removesuffix("```").strip()

            try:
                import ast
                recipe_data = ast.literal_eval(cleaned)

                title = recipe_data.get("title", "Untitled Recipe")
                ingredients = "\n".join(
                    [f'{i["quantity"]} {i["unit"]} {i["ingredient"]}' for i in recipe_data["ingredients"]]
                )
                instructions = "\n".join(recipe_data["instructions"])

                table.create({
                    "Name": title,
                    "Ingredients": ingredients,
                    "Instructions": instructions,
                    "TikTok URL": url
                })

                print(f"✅ Uploaded to Airtable: {title}")

            except Exception as e:
                print(f"⚠️ Error uploading recipe to Airtable: {e}")

            # Print raw recipe JSON just for reference
            print(recipe)

        except Exception as e:
            print(f"❌ Could not process {url}: {e}")

    browser.close()
