from dotenv import load_dotenv
load_dotenv()

from flask import Blueprint, request, jsonify
import base64
import requests
import os
from openai import OpenAI
import json

# Create Flask Blueprint
pantry_bp = Blueprint("pantry_bp", __name__)

# Load secrets from environment
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AIRTABLE_TOKEN = os.getenv("PANTRY_AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = os.getenv("PANTRY_AIRTABLE_BASE_ID")
AIRTABLE_TABLE_NAME = os.getenv("PANTRY_AIRTABLE_TABLE")

# Setup clients
openai_client = OpenAI(api_key=OPENAI_API_KEY)

AIRTABLE_URL = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_NAME}"
AIRTABLE_HEADERS = {
    "Authorization": f"Bearer {AIRTABLE_TOKEN}",
    "Content-Type": "application/json"
}

@pantry_bp.route('/api/v1/pantry-item-photo-upload', methods=['POST'])
def pantry_photo_upload():
    image = request.files.get("photo")
    if not image:
        return jsonify({"error": "No photo uploaded"}), 400

    try:
        # Convert image to base64
        image_bytes = image.read()
        base64_image = base64.b64encode(image_bytes).decode("utf-8")

        # Call GPT-4o Vision
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You extract pantry item names and perishability from photos."},
                {"role": "user", "content": [
                    {"type": "text", "text": "What pantry item is shown in this photo? Is it perishable? Return only this JSON: {\"item\": \"string\", \"perishable\": true/false}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]}
            ],
            max_tokens=150
        )

        import json
        result_text = response.choices[0].message.content.strip()
        print("🔍 GPT-4o raw result:", repr(result_text))  # shows escape characters, e.g. \n

        # Clean out Markdown formatting (```json ... ```)
        cleaned = result_text.strip("` \n")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

        try:
            item_data = json.loads(cleaned)
        except json.JSONDecodeError as decode_error:
            return jsonify({
                "error": "Failed to parse JSON from GPT",
                "details": str(decode_error),
                "raw_output": result_text
            }), 500


        item_name = item_data["item"].strip().title()
        is_perishable = item_data["perishable"]

        # Prepare payload
        airtable_payload = {
            "fields": {
                "Item Name": item_name,
                "Perishable": is_perishable

            }
        }

        print("🔗 Airtable URL:", AIRTABLE_URL)
        print("📤 Sending to Airtable:", airtable_payload)
        airtable_response = requests.post(AIRTABLE_URL, headers=AIRTABLE_HEADERS, json=airtable_payload)

        if airtable_response.status_code != 200:
            print("❌ Airtable response error:", airtable_response.text)
            return jsonify({"error": "Failed to upload to Airtable", "details": airtable_response.text}), 500

        return jsonify({
            "status": "success",
            "item_name": item_name,
            "perishable": is_perishable

        })

    except Exception as e:
        print("❌ Unexpected error:", str(e))
        return jsonify({"error": "Something went wrong", "details": str(e)}), 500
