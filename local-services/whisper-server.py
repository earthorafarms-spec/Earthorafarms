# Run with: pip install faster-whisper flask && python whisper-server.py

import base64
import tempfile
import os
from flask import Flask, request, jsonify
from faster_whisper import WhisperModel

app = Flask(__name__)

# Load model (large-v3)
print("Loading faster-whisper model (large-v3)...")
model = WhisperModel("large-v3", device="auto", compute_type="auto")
print("faster-whisper model loaded successfully!")

@app.route("/transcribe", methods=["POST"])
def transcribe():
    data = request.get_json() or {}
    audio_base64 = data.get("audio_base64")
    language = data.get("language")

    if not audio_base64:
        return jsonify({"error": "Missing audio_base64 payload"}), 400

    # Save temporary audio file
    audio_bytes = base64.b64decode(audio_base64)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_audio:
        temp_audio.write(audio_bytes)
        temp_path = temp_audio.name

    try:
        segments, info = model.transcribe(temp_path, language=language)
        text = " ".join([segment.text for segment in segments]).strip()
        detected_lang = info.language or language or "en"
        return jsonify({
            "text": text,
            "detectedLang": detected_lang
        })
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001)
