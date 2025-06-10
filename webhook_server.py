from flask import Flask, request, jsonify
import openai
from pyairtable import Table
import os
import asyncio
from playwright.async_api import async_playwright

app = Flask(__name__)

# Load secrets from environment variables
openai.api_key = os.environ["OPENAI_API_KEY"]
airtable_key = os.environ["AIRTABLE_API_KEY"]
airtable_base = os.environ["AIRTABLE_BASE_ID"]
airtable_table = os.environ["AIRTABLE_TABLE_NAME"]

table = Table(airtable_key, airtable_base, airtable_table)

system_prompt = """
You are a recipe parser. Extract structured recipes from TikTok captions.

Return JSON:
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

async def fetch_caption(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, timeout=60000)
        caption = await page.locator('[data-e2e="browse-video-desc"]').inner_text()
        await browser.close()
        return caption

@app.route("/webhook", methods=["POST"])
def webhook():
    url = request.form.get("url")

    print("📥 Received TikTok URL:", url)  # ← Add this line here

    if not url:
        return "Missing TikTok URL", 400

    try:
        caption = asyncio.run(fetch_caption(url))
    except Exception as e:
        return f"❌ Error fetching caption: {str(e)}", 500

    # GPT call
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": caption}
            ]
        )
        recipe = response["choices"][0]["message"]["content"]

        import ast
        recipe_data = ast.literal_eval(recipe)

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

        return jsonify({"status": "success", "title": title})

    except Exception as e:
        return f"❌ Error parsing or uploading recipe: {str(e)}", 500

if __name__ == "__main__":
    app.run(debug=True)
