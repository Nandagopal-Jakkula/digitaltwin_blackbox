from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)

# Configuration - Get debug mode from environment (False for production)
DEBUG_MODE = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'

THINGSPEAK_URL = os.environ.get('THINGSPEAK_URL') or "https://api.thingspeak.com/channels/3104829/feeds/last.json?api_key=NYQKK6PS1ANTGD29"
LEAK_PRESSURE_THRESHOLD = float(os.environ.get('LEAK_PRESSURE_THRESHOLD', '1.0'))
LEAK_FLOW_THRESHOLD = float(os.environ.get('LEAK_FLOW_THRESHOLD', '1.0'))

def fetch_thingspeak():
    try:
        r = requests.get(THINGSPEAK_URL, timeout=6)
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                return {}
        return {}
    except Exception:
        return {}

def extract_field_value(latest, fieldId):
    if not fieldId or not latest:
        return None
    import re
    m = re.search(r"(\d+)", str(fieldId))
    if not m:
        return None
    key = 'field' + m.group(1)
    raw = latest.get(key)
    if raw is None:
        return None
    try:
        v = float(raw)
        return v
    except Exception:
        return None

@app.route('/api/latest')
def latest():
    data = fetch_thingspeak()
    return jsonify(data)

@app.route('/api/detect', methods=['POST'])
def detect():
    body = request.get_json(silent=True) or {}
    pipes = body.get('pipes', [])
    latest = fetch_thingspeak()
    result = []
    for p in pipes:
        pipeId = p.get('pipeId')
        pFieldIn = p.get('pFieldIn')
        pFieldOut = p.get('pFieldOut')
        fFieldIn = p.get('fFieldIn')
        fFieldOut = p.get('fFieldOut')
        
        # Extract in/out values
        pressureIn = extract_field_value(latest, pFieldIn)
        pressureOut = extract_field_value(latest, pFieldOut)
        flowIn = extract_field_value(latest, fFieldIn)
        flowOut = extract_field_value(latest, fFieldOut)
        
        # Calculate deltas (in - out)
        pressureDelta = None
        flowDelta = None
        leakStatus = 'unknown'
        
        # Only detect leaks for pipes with BOTH in and out pressure sensors
        if pressureIn is not None and pressureOut is not None:
            pressureDelta = pressureIn - pressureOut
            leakStatus = 'normal'  # Default to normal if we have data
            
            # Check for pressure leak (delta exceeds threshold)
            if pressureDelta > LEAK_PRESSURE_THRESHOLD:
                leakStatus = 'leak'
        
        # Also check flow delta if available, but pressure is the primary indicator
        if flowIn is not None and flowOut is not None:
            flowDelta = flowIn - flowOut
            
            # Override to leak if flow delta also exceeds threshold
            if leakStatus != 'unknown' and flowDelta > LEAK_FLOW_THRESHOLD:
                leakStatus = 'leak'
        
        result.append({
            'pipeId': pipeId,
            'pressureIn': pressureIn,
            'pressureOut': pressureOut,
            'flowIn': flowIn,
            'flowOut': flowOut,
            'pressureDelta': pressureDelta,
            'flowDelta': flowDelta,
            'leakStatus': leakStatus
        })
    return jsonify({ 'pipes': result, 'latestTS': latest })

@app.route('/')
def index():
    ROOT = os.path.abspath(os.path.dirname(__file__))
    return send_from_directory(ROOT, 'index.html')


@app.route('/<path:filename>')
def serve_file(filename):
    # Serve static files (css/, js/, img/, etc.) from project root.
    ROOT = os.path.abspath(os.path.dirname(__file__))
    # prevent directory traversal
    if '..' in filename or filename.startswith('/'):
        abort(404)
    file_path = os.path.join(ROOT, filename)
    if os.path.isfile(file_path):
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path))
    abort(404)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=DEBUG_MODE)
