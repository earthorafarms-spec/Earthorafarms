# Run with: pip install flask && python piper-server.py
#
# Download Piper binary + models from: https://github.com/rhasspy/piper/releases
# Hindi voice model: hi_IN-hemant-medium.onnx (+ .json config)
# Gujarati voice model: gu_IN-bhagat-medium.onnx (+ .json config)
#
# Download command examples:
# wget https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz
# tar -xvf piper_amd64.tar.gz
# wget https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/hemant/medium/hi_IN-hemant-medium.onnx

import subprocess
import tempfile
import os
from flask import Flask, request, Response

app = Flask(__name__)

PIPER_BINARY = os.environ.get("PIPER_BINARY_PATH", "./piper/piper")
VOICE_MODELS = {
    "hi": os.environ.get("PIPER_HI_MODEL", "./piper/hi_IN-hemant-medium.onnx"),
    "gu": os.environ.get("PIPER_GU_MODEL", "./piper/gu_IN-bhagat-medium.onnx"),
    "en": os.environ.get("PIPER_EN_MODEL", "./piper/en_US-lessac-medium.onnx"),
}

@app.route("/synthesize", methods=["POST"])
def synthesize():
    data = request.get_json() or {}
    text = data.get("text", "")
    language = data.get("language", "en")

    if not text:
        return Response("Missing text parameter", status=400)

    model_path = VOICE_MODELS.get(language, VOICE_MODELS["en"])
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_out:
        out_path = temp_out.name

    try:
        cmd = [
            PIPER_BINARY,
            "--model", model_path,
            "--output_file", out_path,
            "--output_raw"
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.communicate(input=text.encode("utf-8"))

        if os.path.exists(out_path):
            with open(out_path, "rb") as f:
                audio_bytes = f.read()
            return Response(audio_bytes, mimetype="audio/wav")
        else:
            return Response("TTS generation failed", status=500)
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8002)
