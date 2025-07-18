from flask import Blueprint, request, jsonify
import base64
import requests
import datetime
import os
import openai

# Create Flask Blueprint
pantry_bp = Blueprint("pantry_bp", __name__)

# Load secrets from environment
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AIRTABLE_TOKEN = os.getenv("AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID")
AIRTABLE_TABLE_NAME = os.getenv("AIRTABLE_TABLE_NAME")

# Setup clients
openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

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

        # Call GPT-4o Vision using new SDK syntax
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You extract pantry item names and perishability from photos."},
                {"role": "user", "content": [
                    {"type": "text", "text": "What pantry item is shown in this photo? Is it perishable? Respond ONLY with valid JSON like this: {\"item\": \"milk\", \"perishable\": true}"}
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]}
            ],
            max_tokens=150
        )

        result_text = response.choices[0].message.content.strip()
        import json
        item_data = json.loads(result_text)
        item_name = item_data["item"].strip().title()
        is_perishable = item_data["perishable"]

        # Send to Airtable
        airtable_payload = {
            "fields": {
                "Item Name": item_name,
                "Perishable": is_perishable,
                "Date Added": datetime.datetime.utcnow().isoformat()
            }
        }

        airtable_response = requests.post(AIRTABLE_URL, headers=AIRTABLE_HEADERS, json=airtable_payload)

        if airtable_response.status_code != 200:
            return jsonify({"error": "Failed to upload to Airtable", "details": airtable_response.text}), 500

        return jsonify({"status": "success", "item_name": item_name, "perishable": is_perishable})

    except Exception as e:
        return jsonify({"error": "Something went wrong", "details": str(e)}), 500
