from flask import Flask, request, jsonify
from pantry_photo_upload import pantry_bp
import openai
from pyairtable import Table
import os
import asyncio
from playwright.async_api import async_playwright

app = Flask(__name__)
app.register_blueprint(pantry_bp)

# Load secrets from environment variables
client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
airtable_key = os.environ["AIRTABLE_API_KEY"]
airtable_base = os.environ["AIRTABLE_BASE_ID"]
airtable_table = os.environ["AIRTABLE_TABLE_NAME"]

table = Table(airtable_key, airtable_base, airtable_table)

system_prompt = """You are a recipe parsing assistant. Given a recipe caption, you must extract a structured recipe in strict JSON format with this schema:

{
  "title": "...",
  "ingredients": [{"quantity": "...", "unit": "...", "ingredient": "..."}],
  "instructions": ["Step 1...", "Step 2...", ...]
}

Your response must be valid JSON only — no extra commentary, markdown, or trailing commas.
"""

async def fetch_caption(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
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
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": caption}
            ]
        )
        recipe = response.choices[0].message.content



        import json
        recipe_data = json.loads(recipe)


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
