// server.js

// --- Import required modules ---
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

require('dotenv').config(); // Load environment variables from .env file. Render handles these via Dashboard.

// --- Initialize Express app ---
const app = express();
// Use PORT provided by Render (process.env.PORT), fallback to 3000 for local dev
const PORT = process.env.PORT || 3000; 
const DB_PATH = path.join(__dirname, 'db.json');

// --- Middleware Setup ---
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- Session Middleware Setup ---
app.use(session({
    secret: process.env.SESSION_SECRET, // A secret key to sign the session ID cookie
    resave: false,                     // Don't save session if unmodified
    saveUninitialized: false,          // Don't create session until something stored
    // Set secure to true in production (HTTPS), false in development (HTTP)
    cookie: { secure: process.env.NODE_ENV === 'production' } 
}));

// Middleware to make session data available to all templates
app.use((req, res, next) => {
    res.locals.isAdmin = req.session.isAdmin || false;
    next();
});

// Middleware to protect admin routes
const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.redirect('/login');
    }
    next();
};


// --- Database Helper Functions ---
// Function to read data from our JSON database
const readDb = () => {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If the file doesn't exist or is empty, return an empty object with a requests array
        return { requests: [] };
    }
};

// Function to write data to our JSON database
const writeDb = (data) => {
    // IMPORTANT: db.json on Render is ephemeral storage. Data written here will be lost on app restart/redeployment.
    // Consider a persistent database (e.g., PostgreSQL, MongoDB) for production use.
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
};

// --- Email Transporter Setup (using Nodemailer) ---
let transporter;
async function setupEmail() {
    // For development, we use a test account from Ethereal.email if no EMAIL_HOST is set in env vars
    if (!process.env.EMAIL_HOST) {
        console.log("Setting up Ethereal test email account...");
        let testAccount = await nodemailer.createTestAccount();
        console.log(`\n--- --- --- --- ---\nEthereal Email Inbox: https://ethereal.email/login\nUser: ${testAccount.user}\nPass: ${testAccount.pass}\n--- --- --- --- ---\n`);
        
        transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: testAccount.user, // generated ethereal user
                pass: testAccount.pass, // generated ethereal password
            },
        });

    } else {
        // Use credentials from .env file (or Render's environment variables) for a real email service
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: true, // Use secure for real email services (usually 465 or 587 with STARTTLS)
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }
}
setupEmail().catch(console.error);


// --- Application Routes ---

// --- Admin Login and Logout Routes ---
app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (username === adminUsername && await bcrypt.compare(password, adminPasswordHash)) {
        // Password is correct
        req.session.isAdmin = true; // Set a session variable
        res.redirect('/status');
    } else {
        // Failed login
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/status');
        }
        res.redirect('/');
    });
});


// --- User and Status Routes ---

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/submit', (req, res) => {
    // Destructure form data from the request body
    const { name, phone, department, position, serviceType, details, assetID, softwareName, otherTopic } = req.body;
    const db = readDb();
    
    
    const maxOrder = db.requests.length > 0 ? Math.max(...db.requests.map(r => r.sort_order || 0)) : 0;

    // Add data to the database
    const newRequest = {
        id: db.requests.length > 0 ? Math.max(...db.requests.map(r => r.id)) + 1 : 1,
        sort_order: maxOrder + 1,
        // Change time format to 24 hours
        submittedAt: new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }),
        requesterName: name,
        requesterPhone: phone,
        department,
        position,
        serviceType,
        details,
        assetID: assetID || '',
        softwareName: softwareName || '',
        otherTopic: otherTopic || '',
        status: 'Pending Manager Approval',
        approvalToken: crypto.randomBytes(20).toString('hex')
    };

    db.requests.push(newRequest);
    writeDb(db);

    // --- Determine manager email based on department, fetched from .env ---
    let recipientManagerEmail;
    switch (department) {
        case 'HR_dep':
            recipientManagerEmail = process.env.HR_MANAGER_EMAIL;
            break;
        case 'IT_dep':
            recipientManagerEmail = process.env.IT_MANAGER_EMAIL;
            break;
        case 'GA_dep':
            recipientManagerEmail = process.env.GA_MANAGER_EMAIL;
            break;
        case 'FA_dep':
            recipientManagerEmail = process.env.FA_MANAGER_EMAIL;
            break;
        case 'FN_dep':
            recipientManagerEmail = process.env.FN_MANAGER_EMAI;
            break;
        case 'MC_dep':
            recipientManagerEmail = process.env.MC_MANAGER_EMAIL;
            break;
        case 'SL_dep':
            recipientManagerEmail = process.env.SL_MANAGER_EMAIL;
            break;
        case 'ST_dep':
            recipientManagerEmail = process.env.ST_MANAGER_EMAIL;
            break;
        case 'FT_dep':
            recipientManagerEmail = process.env.FT_MANAGER_EMAIL;
            break;
        case 'SV_dep':
            recipientManagerEmail = process.env.SV_MANAGER_EMAIL;
            break;
        case 'CC_dep':
            recipientManagerEmail = process.env.CC_MANAGER_EMAIL;
            break;
        case 'BP_dep':
            recipientManagerEmail = process.env.BP_MANAGER_EMAIL;
            break;
        case 'BW_dep':
            recipientManagerEmail = process.env.BW_MANAGER_EMAIL;
            break;
        case 'KR_dep':
            recipientManagerEmail = process.env.KR_MANAGER_EMAIL;
            break;
        case 'KK_dep':
            recipientManagerEmail = process.env.KK_MANAGER_EMAIL;
            break;
        case 'MP_dep':
            recipientManagerEmail = process.env.MP_MANAGER_EMAIL;
            break;
        case 'LC_dep':
            recipientManagerEmail = process.env.LC_MANAGER_EMAIL;
            break;
        case 'PK_dep':
            recipientManagerEmail = process.env.PK_MANAGER_EMAIL;
            break;
        case 'PY_dep':
            recipientManagerEmail = process.env.PY_MANAGER_EMAIL;
            break;
        

        default:
            console.warn(`Unknown department: ${department}. Sending email to default manager.`);
            recipientManagerEmail = process.env.MANAGER_EMAIL_DEFAULT || 'default.manager@example.com'; // Fallback to a generic default if no specific env var is found
            break;
    }

    // Check if recipientManagerEmail is still undefined or null, and use a safe default
    if (!recipientManagerEmail) {
        console.error(`Manager email not configured for department: ${department}. Using 'default.manager@example.com'.`);
        recipientManagerEmail = 'default.manager@example.com';
    }
    // ------------------------------------

    // Use RENDER_EXTERNAL_URL if available (Render's public URL), then APP_URL, then localhost
    const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `http://localhost:${PORT}`;
    const approvalLink = `${appUrl}/approve/${newRequest.approvalToken}`;
    const disapproveLink = `${appUrl}/disapprove/${newRequest.approvalToken}`;

    const mailOptions = {
        from: '"IT Request System" <no-reply@example.com>',
        to: recipientManagerEmail, // Use the determined manager email
        subject: `ฟอร์มคำร้องไอที ต้องการอนุมัติ IT Request for Approval จากคุณ: ${newRequest.requesterName} - แผนก: ${newRequest.department}`,
        html: `
            <h1>มีคำร้องใหม่ New IT Service Request</h1>
            <p>มีคำร้องที่ต้องขอการอนุมัติ</p>
            <p>จาก </p>
            <ul>
                <li><strong>ชื่อ-สกุล: </strong> ${newRequest.requesterName}</li>
                <li><strong>ตำแหน่ง:</strong> ${newRequest.position}</li>
                <li><strong>แผนก:</strong> ${newRequest.department}</li>
                <li><strong>ประเภทของคำร้อง: </strong> ${newRequest.serviceType}</li>
                <li><strong>รายละเอียด: </strong> ${newRequest.details}</li>
                ${newRequest.assetID ? `<li><strong>Asset ID:</strong> ${newRequest.assetID}</li>` : ''}
                ${newRequest.softwareName ? `<li><strong>Software Name:</strong> ${newRequest.softwareName}</li>` : ''}
                ${newRequest.otherTopic ? `<li><strong>Topic:</strong> ${newRequest.otherTopic}</li>` : ''}
            </ul>
            <p>ความคิดเห็นของหัวหน้าแผนก Please review and take action:</p>
            <br>
            <div style="display: inline-block; white-space: nowrap;">
                <a href="${approvalLink}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">Approve</a>
                <a href="${disapproveLink}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px; margin-left: 10px;">Disapprove</a>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) { return console.log(error); }
        console.log('Manager approval email sent to %s: %s', recipientManagerEmail, info.messageId);
        if (String(info.messageId).includes('ethereal.email')) {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
    });

    res.redirect('/status');
});

app.get('/status', (req, res) => {
    const db = readDb();
    const sortedRequests = db.requests.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    res.render('status', { requests: sortedRequests });
});

// --- Handle Approval and Disapproval ---
app.get('/approve/:token', (req, res) => {
    const { token } = req.params;
    const db = readDb();
    const request = db.requests.find(r => r.approvalToken === token && r.status === 'Pending Manager Approval');

    if (!request) {
        return res.status(404).render('message', { title: 'Error', message: '\nThis request was not found or has already been actioned.' });
    }

    request.status = 'Approved, Pending IT';
    writeDb(db);

    // Always send email to IT after approval
    const itManagerEmail = process.env.IT_EMAIL || 'it.department@example.com'; // Set fallback email for IT
    const mailOptions = {
        from: '"IT Request System" <no-reply@example.com>',
        to: itManagerEmail,
        subject: `[Approved] New IT Task Assigned จากคุณ ${request.requesterName} - แผนก: ${request.department}`,
        html: `
            <h1>A new IT task has been assigned to your department.</h1>
            <p>This request has been approved by the manager.</p>
            <h3>Request Details:</h3>
            <ul>
                <li><strong>Name:</strong> ${request.requesterName}</li>
                <li><strong>Phone:</strong> ${request.requesterPhone}</li>
                <li><strong>Department:</strong> ${request.department}</li>
                <li><strong>Service Type:</strong> ${request.serviceType}</li>
                <li><strong>Details:</strong> ${request.details}</li>
                ${request.assetID ? `<li><strong>Asset ID:</strong> ${request.assetID}</li>` : ''}
                ${request.softwareName ? `<li><strong>Software Name:</strong> ${request.softwareName}</li>` : ''}
                ${request.otherTopic ? `<li><strong>Topic:</strong> ${request.otherTopic}</li>` : ''}
            </ul>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) { return console.log(error); }
        console.log('IT Manager notification email sent to %s: %s', itManagerEmail, info.messageId);
    });

    res.render('message', { title: 'Request Approved', message: `Request ID ${request.id} has been approved. \nThe IT department has been notified.` });
});

app.get('/disapprove/:token', (req, res) => {
    const { token } = req.params;
    const db = readDb();
    const request = db.requests.find(r => r.approvalToken === token && r.status === 'Pending Manager Approval');
    
    if (!request) {
        return res.status(440).render('message', { title: 'Error', message: '\nThis request was not found or has already been actioned.' });
    }

    request.status = 'Disapproved';
    writeDb(db);
    
    res.render('message', { title: 'Request Disapproved', message: `\nRequest ID ${request.id} has been successfully disapproved.` });
});


// --- Admin Action Routes (Protected) ---
app.post('/delete/:id', requireAdmin, (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    const db = readDb();
    
    const requestIndex = db.requests.findIndex(r => r.id === requestId);
    
    if (requestIndex === -1) {
        return res.redirect('/status');
    }
    
    db.requests.splice(requestIndex, 1);

    db.requests.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    db.requests.forEach((request, index) => {
        request.sort_order = index + 1;
    });
    
    writeDb(db);
    res.redirect('/status');
});

app.post('/clear-all', requireAdmin, (req, res) => {
    const db = { requests: [] };
    writeDb(db);
    res.redirect('/status');
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});