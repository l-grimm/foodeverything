from flask import Flask
from pantry_photo_upload import pantry_bp

app = Flask(__name__)
app.register_blueprint(pantry_bp)

if __name__ == "__main__":
    app.run(debug=True)
