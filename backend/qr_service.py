import io
import base64
from typing import Optional
import qrcode

from backend import database
from backend.config import get_default_guest_url


def get_guest_url() -> str:
    """Get the current guest URL configured in database or default to LAN IP."""
    return database.get_setting("guest_base_url", get_default_guest_url())


def generate_qr_bytes(
    url: Optional[str] = None,
    box_size: int = 12,
    border: int = 2,
    dark_color: str = "#4a1521",
    light_color: str = "#FFFFFF",
) -> bytes:
    """Generate high-quality PNG bytes for event QR code."""
    target_url = url or get_guest_url()

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(target_url)
    qr.make(fit=True)

    img = qr.make_image(
        fill_color=dark_color,
        back_color=light_color,
    )

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def generate_qr_base64(url: Optional[str] = None) -> str:
    """Generate base64 data URI string for embedding directly into HTML."""
    png_bytes = generate_qr_bytes(url=url)
    encoded = base64.b64encode(png_bytes).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def generate_printable_card_html(url: Optional[str] = None, event_name: Optional[str] = None) -> str:
    """Generate a print-ready luxury wedding & event display card HTML in SUV Photography theme."""
    target_url = url or get_guest_url()
    name = event_name or database.get_setting("event_name", "SUV Photography Gallery")
    qr_b64 = generate_qr_base64(target_url)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Guest Gallery Display Card - {name} | SUV Photography</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Great+Vibes&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        @page {{ size: A5 portrait; margin: 0; }}
        * {{ box-sizing: border-box; }}
        body {{
            font-family: "Inter", -apple-system, sans-serif;
            background: #f8f5f0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
        }}
        .card {{
            background: #ffffff;
            width: 400px;
            padding: 44px 34px;
            border-radius: 20px;
            box-shadow: 0 20px 45px rgba(74, 21, 33, 0.08);
            text-align: center;
            border: 1px solid rgba(200, 164, 90, 0.4);
            position: relative;
        }}
        .card::before {{
            content: "";
            position: absolute;
            inset: 8px;
            border: 1px solid rgba(200, 164, 90, 0.25);
            border-radius: 14px;
            pointer-events: none;
        }}
        .logo-img {{
            height: 56px;
            max-width: 240px;
            width: auto;
            object-fit: contain;
            margin-bottom: 16px;
        }}
        .badge {{
            display: inline-block;
            background: rgba(200, 164, 90, 0.12);
            border: 1px solid rgba(200, 164, 90, 0.4);
            color: #9c782b;
            font-weight: 600;
            font-size: 11px;
            letter-spacing: 2px;
            text-transform: uppercase;
            padding: 4px 16px;
            border-radius: 999px;
            margin-bottom: 12px;
        }}
        .script-title {{
            font-family: "Great Vibes", cursive;
            color: #c8a45a;
            font-size: 2.1rem;
            line-height: 1;
            margin: 0 0 4px 0;
        }}
        h1 {{
            font-family: "Cormorant Garamond", Georgia, serif;
            font-size: 24px;
            color: #2e2320;
            margin: 0 0 6px 0;
            font-weight: 700;
            letter-spacing: -0.01em;
        }}
        p.subtitle {{
            color: #8a7a74;
            font-size: 13.5px;
            margin: 0 0 24px 0;
            font-weight: 300;
        }}
        .qr-wrapper {{
            background: #ffffff;
            padding: 14px;
            border-radius: 14px;
            display: inline-block;
            box-shadow: 0 8px 24px rgba(53, 10, 20, 0.06);
            border: 1px solid rgba(200, 164, 90, 0.4);
            margin-bottom: 22px;
        }}
        .qr-wrapper img {{
            display: block;
            width: 210px;
            height: 210px;
            border-radius: 8px;
        }}
        .steps {{
            text-align: left;
            background: #faf8f5;
            border: 1px solid #ebe7e0;
            padding: 16px 20px;
            border-radius: 12px;
            font-size: 13px;
            color: #5a4b47;
            margin-bottom: 20px;
        }}
        .step-item {{
            display: flex;
            align-items: center;
            margin-bottom: 8px;
        }}
        .step-item:last-child {{
            margin-bottom: 0;
        }}
        .step-num {{
            background: #4a1521;
            color: #dfc07b;
            border: 1px solid #c8a45a;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: bold;
            margin-right: 12px;
            flex-shrink: 0;
        }}
        .url-text {{
            font-size: 11.5px;
            color: #a89892;
            word-break: break-all;
            font-family: monospace;
        }}
        .no-print-btn {{
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4a1521;
            color: #f8f5f0;
            border: 1px solid rgba(200, 164, 90, 0.4);
            padding: 11px 22px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            cursor: pointer;
            box-shadow: 0 6px 18px rgba(53, 10, 20, 0.25);
            transition: all 0.2s;
        }}
        .no-print-btn:hover {{
            background: #330e16;
            color: #ffffff;
        }}
        @media print {{
            body {{ background: white; padding: 0; }}
            .card {{ box-shadow: none; border: 1px solid #ebe7e0; width: 100%; max-width: 480px; margin: 0 auto; }}
            .no-print-btn {{ display: none; }}
        }}
    </style>
</head>
<body>
    <button class="no-print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    <div class="card">
        <img src="/static/logo_dark.png" alt="SUV Photography Logo" class="logo-img">
        <div class="badge">Live AI Event Gallery</div>
        <div class="script-title">Cherished Memories</div>
        <h1>{name}</h1>
        <p class="subtitle">Scan to discover your photos instantly</p>
        
        <div class="qr-wrapper">
            <img src="{qr_b64}" alt="Event QR Code">
        </div>
        
        <div class="steps">
            <div class="step-item">
                <span class="step-num">1</span>
                <span>Scan this QR code with your phone camera</span>
            </div>
            <div class="step-item">
                <span class="step-num">2</span>
                <span>Snap a quick selfie</span>
            </div>
            <div class="step-item">
                <span class="step-num">3</span>
                <span>Download your high-resolution photos</span>
            </div>
        </div>
        
        <div class="url-text">{target_url}</div>
    </div>
</body>
</html>"""
