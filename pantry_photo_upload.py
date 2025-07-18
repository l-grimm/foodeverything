from flask import Blueprint, request, jsonify
import openai
import base64
import requests
import datetime
import os

# Create a Flask Blueprint so we can register this route later
pantry_bp = Blueprint("pantry_bp", __name__)

# Load secrets from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AIRTABLE_TOKEN = os.getenv("AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID")
AIRTABLE_TABLE_NAME = os.getenv("AIRTABLE_TABLE_NAME")

openai.api_key = OPENAI_API_KEY

AIRTABLE_URL = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_NAME}"
AIRTABLE_HEADERS = {
    "Authorization": f"Bearer {AIRTABLE_TOKEN}",
    "Content-Type": "application/json"
}

@pantry_bp.route('/api/v1/pantry-item-photo-upload', methods=['POST'])
def pantry_photo_upload():
    """Handle a photo of a pantry item, identify it using GPT-4o Vision, and send result to Airtable."""
    image = request.files.get("photo")
    if not image:
        return jsonify({"error": "No photo uploaded"}), 400

    try:
        # Encode the image as base64
        image_bytes = image.read()
        base64_image = base64.b64encode(image_bytes).decode("utf-8")

        # Ask GPT-4o to analyze the image
        response = openai.ChatCompletion.create(
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

        result = response.choices[0].message.content.strip()
        item_info = eval(result)
        item_name = item_info["item"].strip().title()
        is_perishable = item_info["perishable"]

        # Upload to Airtable
        payload = {
            "fields": {
                "Item Name": item_name,
                "Perishable": is_perishable,
                "Date Added": datetime.datetime.utcnow().isoformat()
            }
        }

        airtable_response = requests.post(AIRTABLE_URL, headers=AIRTABLE_HEADERS, json=payload)
        if airtable_response.status_code != 200:
            return jsonify({"error": "Failed to upload to Airtable", "details": airtable_response.text}), 500

        return jsonify({"status": "success", "item_name": item_name, "perishable": is_perishable})

    except Exception as e:
        return jsonify({"error": "Something went wrong", "details": str(e)}), 500
