from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
import requests
import os
import math

app = Flask(__name__)
CORS(app)

# Configuration - Get debug mode from environment (False for production)
DEBUG_MODE = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'

THINGSPEAK_URL = os.environ.get('THINGSPEAK_URL') or "https://api.thingspeak.com/channels/3104829/feeds/last.json?api_key=NYQKK6PS1ANTGD29"
LEAK_PRESSURE_THRESHOLD = float(os.environ.get('LEAK_PRESSURE_THRESHOLD', '1.0'))
LEAK_FLOW_THRESHOLD = float(os.environ.get('LEAK_FLOW_THRESHOLD', '1.0'))

# Constants for leak area calculation (Orifice Equation)
WATER_DENSITY = 1000  # kg/m³
DISCHARGE_COEFFICIENT = 0.7  # Cd (0.6-0.8)
GRAVITY = 9.81  # m/s²

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

def calculate_leak_area_mm2(flowDeltaLmin, pressureInBar, burialDepth, soilDensity):
    """
    Calculate leak area using Orifice Equation: A = Q / (Cd * sqrt(2 * DeltaPe / rho))
    Returns leak area in mm²
    """
    if flowDeltaLmin is None or pressureInBar is None or burialDepth is None or soilDensity is None:
        return None
    
    if flowDeltaLmin <= 0:
        return None
    
    try:
        # Convert flow delta from L/min to m³/s
        flowDeltaM3s = flowDeltaLmin / 60000.0
        
        # Calculate soil pressure in Pa: P_soil = ρ_soil * g * h
        soilPressurePa = float(soilDensity) * GRAVITY * float(burialDepth)
        
        # Effective pressure difference: ΔPe = Pin - P_soil (convert Pin from bar to Pa)
        pressureInPa = pressureInBar * 100000
        deltaPe = pressureInPa - soilPressurePa
        
        # Calculate leak area using Orifice Equation
        if deltaPe > 0:
            leakAreaM2 = flowDeltaM3s / (DISCHARGE_COEFFICIENT * math.sqrt(2 * deltaPe / WATER_DENSITY))
            # Convert to mm² (1 m² = 1,000,000 mm²)
            leakAreaMm2 = leakAreaM2 * 1000000
            return leakAreaMm2
    except Exception:
        pass
    
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
    
    import re
    
    for p in pipes:
        pipeId = p.get('pipeId')
        pFieldIn = p.get('pFieldIn')
        pFieldOut = p.get('pFieldOut')
        fFieldIn = p.get('fFieldIn')
        fFieldOut = p.get('fFieldOut')
        burialDepth = p.get('burialDepth')
        soilDensity = p.get('soilDensity')
        
        # Extract in/out values
        pressureIn = extract_field_value(latest, pFieldIn)
        pressureOut = extract_field_value(latest, pFieldOut)
        flowIn = extract_field_value(latest, fFieldIn)
        flowOut = extract_field_value(latest, fFieldOut)
        
        # Calculate deltas (in - out)
        pressureDelta = None
        flowDelta = None
        leakStatus = 'unknown'
        leakAreaMm2 = None
        
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
            
            # Calculate leak area if we have a leak
            if leakStatus == 'leak':
                leakAreaMm2 = calculate_leak_area_mm2(flowDelta, pressureIn, burialDepth, soilDensity)
        
        result.append({
            'pipeId': pipeId,
            'pressureIn': pressureIn,
            'pressureOut': pressureOut,
            'flowIn': flowIn,
            'flowOut': flowOut,
            'pressureDelta': pressureDelta,
            'flowDelta': flowDelta,
            'leakStatus': leakStatus,
            'leakAreaMm2': leakAreaMm2
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
