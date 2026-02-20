# Zero Proxy ⛓️

Zero Proxy is a Smart & Real-time Attendance Intelligence System designed to securely track student attendance over a local network (Wi-Fi/Hotspot) using dynamic, rotating QR codes. It stops proxy attendance through MAC address binding and provides an instant, auto-responsive scanning experience.

## ✨ Key Features
- **Dynamic Rotating QR Codes:** The QR code on the teacher's dashboard updates automatically every 10 seconds. Students cannot share old screenshots to bypass the system.
- **Hardware Fingerprint Binding (MAC Check):** A student's roll number gets bound to their mobile device's MAC address on their first login. Any future login attempts for that roll number from a different phone are instantly blocked! 🚫
- **Instant Live QR Camera:** Features a built-in blazing-fast Live Camera scanner for students to scan the QR instantly without even leaving their browsers.
- **Smart 4K Image Fallback:** It detects if the browser blocks live feeds and falls back to a Photo Snapshot tool, automatically shrinking and compressing 4K images on device, and using Android Native `BarcodeDetector` for zero failures!
- **Sleek Teacher Dashboard:** An administrative control panel that shows live class strength, attendance graphs in real-time, manual override buttons, and Light/Dark themes.
- **Export to CSV:** A one-click button to download the day's attendance sheet straight into Microsoft Excel.

## 🛠️ Technology Stack
- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** NeDB (Lightweight, NoSQL embedded database)
- **Frontend UI:** HTML5, CSS3, JS (Responsive & No-Framework Vanilla implementation)
- **QR Tech:** Html5Qrcode & HTML5 Canvas API
- **Charts:** Chart.js

## 🚀 How to Run Locally

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/en) installed on your system.

### Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/pateaditya518/Zero-Proxy.git
   ```
2. Navigate into the folder:
   ```bash
   cd "Zero-Proxy/zero proxy"
   ```
3. Install the required Node packages:
   ```bash
   npm install
   ```

### Start the Server
1. Connect your Laptop/PC to a Mobile Hotspot or Wi-Fi Router.
2. Run the Node.js Server:
   ```bash
   node server.js
   ```
3. The server will output multiple IP options in the console. Pick the one representing your Hotspot/Wi-Fi connection (for example: `192.168.137.1`).

### Access the Application
Ask your students to connect their phones to the **SAME Wi-Fi/Hotspot** as your laptop.

- **Teacher Console:** Open `http://YOUR_SERVER_IP:3000/teacher` on your Laptop.
  - Default Passkey: `admin` / `admin`
- **Student Scanner:** Open `http://YOUR_SERVER_IP:3000/` on the Student's Phone browser.

## 📋 Note on Firewalls
If phones cannot load the page:
1. Ensure your laptop's **Windows Defender Firewall** is allowing traffic through Port `3000`.
2. OR quickly disable the Private Firewall temporarily while testing.

---
*Built for fast, transparent, and un-cheatable classroom attendance.*
