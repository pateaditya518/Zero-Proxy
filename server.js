const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
const { exec } = require("child_process");
const os = require("os");
const dns2 = require("dns2");
const path = require('path');
const { Student, Timetable, Attendance } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Function to get all valid IPs and select the current Laptop/Server IP dynamically
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    let hotspotIP = null;
    let wifiIP = null;
    let anyIP = null;
    const allIPv4s = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        for (const iface of addrs) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
                allIPv4s.push(`- ${name}: ${iface.address}`);
                // Prefer hotspot IP if available
                if (iface.address.startsWith('192.168.137.')) {
                    hotspotIP = iface.address;
                }
                // Then prefer Wi-Fi or regular network
                else if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wifi') || name.toLowerCase().includes('wlan')) {
                    wifiIP = iface.address;
                }
                // Any other valid IP
                else if (!anyIP) {
                    anyIP = iface.address;
                }
            }
        }
    }

    console.log(`\n📡 Available Network Interfaces:`);
    console.log(allIPv4s.join('\n'));
    console.log(``);

    const chosen = hotspotIP || wifiIP || anyIP || '127.0.0.1';
    console.log(`🌐 Automatically selected primary IP: ${chosen}`);
    return chosen;
}
const LOCAL_IP = getLocalIP();

app.use(express.json());
app.use(cors());

// Serve static files (for offline JS libraries)
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Student Web Scanner.html'));
});

app.get('/teacher', (req, res) => {
    res.sendFile(path.join(__dirname, 'QR teacher dashboard.html'));
});

// Simple health check for troubleshooting from phones
app.get('/ping', (req, res) => {
    res.type('text').send('OK');
});

// ==========================================
// 1. MAC ADDRESS EXTRACTION (Using Windows ARP)
// ==========================================
function getMacAddress(ip) {
    return new Promise((resolve) => {
        if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
            // Localhost testing
            resolve("00-11-22-33-44-55");
            return;
        }

        // Strip IPv6 prefix if present
        if (ip.includes("::ffff:")) ip = ip.split("::ffff:")[1];

        exec(`arp -a | findstr ${ip}`, (err, stdout, stderr) => {
            if (err || !stdout) {
                resolve(null);
                return;
            }
            // Parse MAC format e.g., 00-aa-bb-cc-dd-ee
            const match = stdout.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
            resolve(match ? match[0] : null);
        });
    });
}

// ==========================================
// 2. TIMETABLE AUTO-SYNC (The Brain)
// ==========================================
async function getCurrentSubject(classroom) {
    const now = new Date();
    const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday, etc

    // Format current time HH:MM
    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMins = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMins}`;

    // Find any subject currently happening for this classroom
    const ongoingClass = await Timetable.findOne({
        classroom: classroom,
        dayOfWeek: currentDay,
        startTime: { $lte: currentTimeStr },
        endTime: { $gte: currentTimeStr } // Time spans across current time
    });

    return ongoingClass ? ongoingClass.subject : null;
}

// ==========================================
// 3. WEBSOCKETS (Dynamic QR for Teacher)
// ==========================================
let activeQR = "";
let currentSession = { subject: null, classroom: null };

io.on('connection', (socket) => {
    console.log('🔗 Teacher Dashboard connected via WebSocket');

    socket.on('startSession', async (classroom) => {
        console.log(`📡 Classroom '${classroom}' session started by Teacher`);
        const subject = await getCurrentSubject(classroom);

        if (!subject) {
            socket.emit('sessionError', `No scheduled lecture for ${classroom} at this time.`);
            return;
        }

        currentSession = { subject, classroom };

        // Fetch Students and Their Status
        const allStudents = await Student.find({ classroom });
        const attendances = await Attendance.find({ subject });
        const markedRolls = attendances.map(a => a.rollNumber);

        const studentsList = allStudents.map(st => ({
            rollNumber: st.rollNumber,
            name: st.name,
            isPresent: markedRolls.includes(st.rollNumber)
        }));

        socket.emit('sessionStarted', { subject, studentsList });

        let qrInterval;
        const sendNewQR = () => {
            const shortCode = Math.floor(1000 + Math.random() * 9000);
            activeQR = `ZP-${shortCode}`;
            socket.emit('newQRCode', activeQR);
        };

        // Send first one instantly
        sendNewQR();

        // Then rotate every 10 seconds
        qrInterval = setInterval(sendNewQR, 10000);

        socket.on('disconnect', () => {
            if (qrInterval) clearInterval(qrInterval);
        });

        socket.on('markManual', async (rollNumber) => {
            if (!currentSession.subject) return;
            const exists = await Attendance.findOne({ rollNumber, subject: currentSession.subject });
            if (!exists) {
                await Attendance.insert({ rollNumber, subject: currentSession.subject });
                console.log(`✅ Teacher manually marked ${rollNumber} present`);
                io.emit('studentMarked', rollNumber);
            }
        });

        socket.on('disconnect', () => {
            clearInterval(qrInterval);
            activeQR = "";
            currentSession = { subject: null, classroom: null };
            console.log('❌ Session closed');
        });
    });
});

// ==========================================
// 4. API ROUTES (Student Access)
// ==========================================
app.post('/api/login', async (req, res) => {
    const { rollNumber } = req.body;
    let clientIp = req.socket.remoteAddress;

    // Get MAC address from ARP
    const macAddress = await getMacAddress(clientIp);

    if (!macAddress) {
        return res.status(400).json({ success: false, message: "Could not identify device MAC. Ensure you are on the college Wi-Fi network." });
    }

    try {
        let student = await Student.findOne({ rollNumber });

        if (!student) {
            // DUMMY: Auto-create student for testing
            student = await Student.insert({ rollNumber, name: `Student ${rollNumber}`, macAddress: macAddress });
            return res.json({ success: true, message: "First Login: MAC Bound Successfully." });
        }

        // STRICT MAC BINDING CHECK
        if (!student.macAddress) {
            // NeDB uses update to change a record
            await Student.update({ _id: student._id }, { $set: { macAddress: macAddress } });
            return res.json({ success: true, message: "First Login: MAC Bound Successfully." });
        } else if (student.macAddress !== macAddress) {
            console.log(`🚨 PROXY ATTEMPT: Roll ${rollNumber} from MAC ${macAddress}, expected ${student.macAddress}`);
            return res.status(403).json({ success: false, message: "ACCESS DENIED 🚫 MAC Mismatch! Registered device only." });
        }

        res.json({ success: true, message: "Login successful. Proceed to scan." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/scan', async (req, res) => {
    const { rollNumber, qrCode } = req.body;

    // Ensure we have an active session running
    if (!currentSession.subject) {
        return res.status(400).json({ success: false, message: "No active lecture session!" });
    }

    if (qrCode !== activeQR) {
        return res.status(400).json({ success: false, message: "Expired or Invalid QR Code." });
    }

    // Mark Attendance
    const exists = await Attendance.findOne({ rollNumber, subject: currentSession.subject });
    if (!exists) {
        await Attendance.insert({ rollNumber, subject: currentSession.subject });
        io.emit('studentMarked', rollNumber); // Update Teacher UI
        console.log(`✅ ${rollNumber} marked present via Scan for ${currentSession.subject}`);
    } else {
        console.log(`⚠️ ${rollNumber} already marked for ${currentSession.subject}`);
    }

    res.json({ success: true, message: `Attendance marked for ${currentSession.subject}` });
});

// DEFAULT FALLBACK ROUTE: Any undefined URL goes to student login
app.use((req, res, next) => {
    // We removed the LOCAL_IP forceful redirect here because it breaks
    // cloud hosting platforms like Render or Vercel which assign dynamic URLs.
    if (req.path === '/teacher') return next();
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/public')) return next();

    // Redirect unknown paths back to student scanner
    if (req.path !== '/') {
        res.redirect('/');
    } else {
        next();
    }
});

// ==========================================
// 5. CAptive Portal DNS Server (Tricks Phones!)
// ==========================================
const dnsServer = dns2.createServer({
    udp: true,
    handle: (request, send, rinfo) => {
        const response = dns2.Packet.createResponseFromRequest(request);
        const [question] = request.questions;
        const { name } = question;
        console.log(`[DNS] Asked for ${name} -> Giving: ${LOCAL_IP}`);

        response.answers.push({
            name,
            type: dns2.Packet.TYPE.A,
            class: dns2.Packet.CLASS.IN,
            ttl: 300,
            address: LOCAL_IP
        });
        send(response);
    }
});
dnsServer.on('error', (err) => {
    console.log(`[DNS Error] Port 53 maybe in use by Windows Internet Connection Sharing. If the portal doesn't pop up automatically, ask students to type http://${LOCAL_IP} manually.`);
});

// ==========================================
// 6. DB SEEDER & FINAL SERVER LAUNCH
// ==========================================
// Use Port 3000 to avoid Windows Firewall blocking Port 80
// Allow overriding via environment variable
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function startServer() {
    console.log(`📚 Local Database (NeDB) Initialized`);

    // Seed Dummy Timetable 
    await Timetable.remove({}, { multi: true });
    // Seed Dummy Students too
    await Student.remove({}, { multi: true });
    await Student.insert([
        { rollNumber: "101", name: "Rahul Verma", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "102", name: "Aman Shaikh", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "103", name: "Priya Raj", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "104", name: "Rohan Das", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "105", name: "Simran Kaur", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "106", name: "Arjun Singh", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "107", name: "Neha Gupta", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "108", name: "Karan Patel", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "109", name: "Pooja Sharma", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "110", name: "Vikram Malhotra", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "111", name: "Sneha Reddy", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "112", name: "Aditya Joshi", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "113", name: "Riya Mehta", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "114", name: "Sachin Tendulkar", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "115", name: "Ananya Pandey", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "116", name: "Rohit Sharma", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "117", name: "Virat Kohli", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "118", name: "MS Dhoni", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "119", name: "Hardik Pandya", macAddress: null, classroom: "SY-CS-A" },
        { rollNumber: "120", name: "Jasprit Bumrah", macAddress: null, classroom: "SY-CS-A" }
    ]);

    const today = new Date();
    const start = `${String(today.getHours()).padStart(2, '0')}:00`;
    const end = `${String(today.getHours() + 1).padStart(2, '0')}:59`;

    await Timetable.insert([
        { classroom: "SY-CS-A", dayOfWeek: today.getDay(), startTime: start, endTime: end, subject: "Java Programming", teacherName: "Prof. Smith" }
    ]);

    // Clear Previous Attendance
    await Attendance.remove({}, { multi: true });

    // Try starting DNS (Must run on 53). Disabled by default to avoid
    // hijacking external CDN requests during local testing. Enable with
    // `ENABLE_DNS=1` in the environment when you really want captive behavior.
    if (process.env.ENABLE_DNS === '1') {
        try {
            dnsServer.listen({ udp: 53 });
            console.log(`🔮 DNS Trick Active! Phones will think this is the whole internet.`);
        } catch (e) { }
    } else {
        console.log('ℹ️ DNS captive trick is disabled (set ENABLE_DNS=1 to enable).');
    }

    // Start Main Web Server
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Zero Proxy is LIVE!`);
        console.log(`============================================`);
        console.log(`👨‍🏫 TEACHER: Open http://${LOCAL_IP}:${PORT}/teacher`);
        console.log(`📱 STUDENT: Open http://${LOCAL_IP}:${PORT}/`);
        console.log(`============================================`);
    }).on('error', (e) => {
        if (e.code === 'EACCES') {
            console.log(`❌ Port ${PORT} blocked! Run as Administrator or choose another port.`);
        }
    });
}

startServer();
