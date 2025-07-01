// server.js

// --- Import required modules ---
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs'); // ยังคงเก็บไว้เผื่อมีใช้ในอนาคต แต่ readDb/writeDb จะถูกแทนที่
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise'); // เพิ่ม import สำหรับ mysql2/promise

require('dotenv').config(); // Load environment variables from .env file.

// --- Initialize Express app ---
const app = express();
const PORT = process.env.PORT || 3000;
// const DB_PATH = path.join(__dirname, 'db.json'); // คอมเมนต์/ลบบรรทัดนี้

// --- Database Connection Pool Setup ---
let pool; // ใช้ Connection Pool เพื่อประสิทธิภาพที่ดีกว่า
async function connectDb() {
    try {
        // ตรวจสอบว่า Environment Variables สำหรับ MySQL พร้อมหรือไม่
        if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
            console.error("MySQL database environment variables are not fully set. Please check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME.");
            // ใน Local Dev อาจจะให้แอปทำงานต่อโดยไม่ใช้ DB หรือหยุดแอปก็ได้
            // ใน Production แนะนำให้หยุดแอปถ้าเชื่อมต่อ DB ไม่ได้
            process.exit(1); // ออกจากแอปถ้าเชื่อมต่อ DB ไม่ได้
            return;
        }

        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10, // กำหนดจำนวน Connection สูงสุดใน Pool
            queueLimit: 0,
            // ssl: { // เปิดใช้งานถ้า MySQL Provider ของคุณบังคับใช้ SSL (แนะนำสำหรับ Production)
            //     rejectUnauthorized: false // อาจจะต้องตั้งเป็น true หากใช้ Cert ที่ถูกต้อง
            // }
        });

        // ทดสอบการเชื่อมต่อ
        const connection = await pool.getConnection();
        connection.release(); // คืน connection กลับ Pool ทันที
        console.log("Connected to MySQL database via connection pool.");

        // สร้างตารางถ้ายังไม่มี (Migration)
        // ใช้ SQL Syntax สำหรับ MySQL (AUTO_INCREMENT PRIMARY KEY)
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sort_order INT,
                submittedAt VARCHAR(255),
                requesterName VARCHAR(255),
                requesterPhone VARCHAR(255),
                department VARCHAR(255),
                position VARCHAR(255),
                serviceType VARCHAR(255),
                details TEXT,
                assetID VARCHAR(255),
                softwareName VARCHAR(255),
                otherTopic VARCHAR(255),
                status VARCHAR(255),
                approvalToken VARCHAR(255) UNIQUE
            );
        `);
        console.log("Requests table ensured.");

    } catch (err) {
        console.error("Database connection error:", err);
        process.exit(1); // ออกจากแอปถ้าเชื่อมต่อ DB ไม่ได้
    }
}
// เรียกใช้ตอนเริ่มต้นแอป
connectDb();

// --- Middleware Setup ---
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- Session Middleware Setup ---
app.use(session({
    secret: process.env.SESSION_SECRET, 
    resave: false,                     
    saveUninitialized: false,          
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


// --- Email Transporter Setup (using Nodemailer) ---
let transporter;
async function setupEmail() {
    if (!process.env.EMAIL_HOST) {
        console.log("Setting up Ethereal test email account...");
        let testAccount = await nodemailer.createTestAccount();
        console.log(`\n--- --- --- --- ---\nEthereal Email Inbox: https://ethereal.email/login\nUser: ${testAccount.user}\nPass: ${testAccount.pass}\n--- --- --- --- ---\n`);

        transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false, 
            auth: {
                user: testAccount.user, 
                pass: testAccount.pass, 
            },
        });

    } else {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            secure: true, 
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
        req.session.isAdmin = true;
        res.redirect('/status');
    } else {
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

app.post('/submit', async (req, res) => {
    const { name, phone, department, position, serviceType, details, assetID, softwareName, otherTopic } = req.body;

    try {
        // ดึงค่า max_sort_order ปัจจุบัน
        const [rows] = await pool.execute('SELECT MAX(sort_order) AS max_order FROM requests');
        const maxOrder = rows[0].max_order || 0;

        const newRequest = {
            sort_order: maxOrder + 1,
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

        // บันทึกข้อมูลลงฐานข้อมูลจริง
        const insertQuery = `
            INSERT INTO requests (sort_order, submittedAt, requesterName, requesterPhone, department, position, serviceType, details, assetID, softwareName, otherTopic, status, approvalToken)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
            newRequest.sort_order,
            newRequest.submittedAt,
            newRequest.requesterName,
            newRequest.requesterPhone,
            newRequest.department,
            newRequest.position,
            newRequest.serviceType,
            newRequest.details,
            newRequest.assetID,
            newRequest.softwareName,
            newRequest.otherTopic,
            newRequest.status,
            newRequest.approvalToken
        ];
        const [insertResult] = await pool.execute(insertQuery, values);
        newRequest.id = insertResult.insertId; // ได้ ID ที่ Auto-increment จาก DB มาใช้

        // --- ส่วนการส่งอีเมลยังคงเดิม ---
        let recipientManagerEmail;
        switch (department) {
            case 'HR_dep': recipientManagerEmail = process.env.HR_MANAGER_EMAIL; break;
            case 'IT_dep': recipientManagerEmail = process.env.IT_MANAGER_EMAIL; break; 
            case 'GA_dep': recipientManagerEmail = process.env.GA_MANAGER_EMAIL; break; 
            case 'FA_dep': recipientManagerEmail = process.env.FA_MANAGER_EMAIL; break; 
            case 'FN_dep': recipientManagerEmail = process.env.FN_MANAGER_EMAI; break; 
            case 'MC_dep': recipientManagerEmail = process.env.MC_MANAGER_EMAIL; break; 
            case 'SL_dep': recipientManagerEmail = process.env.SL_MANAGER_EMAIL; break; 
            case 'ST_dep': recipientManagerEmail = process.env.ST_MANAGER_EMAIL; break; 
            case 'FT_dep': recipientManagerEmail = process.env.FT_MANAGER_EMAIL; break; 
            case 'SV_dep': recipientManagerEmail = process.env.SV_MANAGER_EMAIL; break; 
            case 'CC_dep': recipientManagerEmail = process.env.CC_MANAGER_EMAIL; break; 
            case 'BP_dep': recipientManagerEmail = process.env.BP_MANAGER_EMAIL; break; 
            case 'BW_dep': recipientManagerEmail = process.env.BW_MANAGER_EMAIL; break; 
            case 'KR_dep': recipientManagerEmail = process.env.KR_MANAGER_EMAIL; break; 
            case 'KK_dep': recipientManagerEmail = process.env.KK_MANAGER_EMAIL; break; 
            case 'MP_dep': recipientManagerEmail = process.env.MP_MANAGER_EMAIL; break; 
            case 'LC_dep': recipientManagerEmail = process.env.LC_MANAGER_EMAIL; break; 
            case 'PK_dep': recipientManagerEmail = process.env.PK_MANAGER_EMAIL; break; 
            case 'PY_dep': recipientManagerEmail = process.env.PY_MANAGER_EMAIL; break; 

            default:
                console.warn(`Unknown department: ${department}. Sending email to default manager.`);
                recipientManagerEmail = process.env.MANAGER_EMAIL_DEFAULT || 'default.manager@example.com';
                break;
        }

        if (!recipientManagerEmail) {
            console.error(`Manager email not configured for department: ${department}. Using 'default.manager@example.com'.`);
            recipientManagerEmail = 'default.manager@example.com';
        }

        const appUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || `http://localhost:${PORT}`;
        const approvalLink = `${appUrl}/approve/${newRequest.approvalToken}`;
        const disapproveLink = `${appUrl}/disapprove/${newRequest.approvalToken}`;

        const mailOptions = {
            from: '"IT Request System" <no-reply@example.com>',
            to: recipientManagerEmail,
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

    } catch (error) {
        console.error("Error submitting request to database:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to submit request.' });
    }
});

app.get('/status', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM requests ORDER BY sort_order ASC'); // ดึงข้อมูลจาก DB
        const requests = rows; // ข้อมูลที่ได้จาก DB
        res.render('status', { requests: requests });
    } catch (error) {
        console.error("Error fetching requests from database:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to load requests.' });
    }
});

// --- Handle Approval and Disapproval ---
app.get('/approve/:token', async (req, res) => {
    const { token } = req.params;
    try {
        const [rows] = await pool.execute('SELECT * FROM requests WHERE approvalToken = ? AND status = ?', [token, 'Pending Manager Approval']);
        const request = rows[0];

        if (!request) {
            return res.status(404).render('message', { title: 'Error', message: '\nThis request was not found or has already been actioned.' });
        }

        await pool.execute('UPDATE requests SET status = ? WHERE id = ?', ['Approved, Pending IT', request.id]);

        const itManagerEmail = process.env.IT_EMAIL || 'it.department@example.com';
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
    } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to approve request.' });
    }
});

app.get('/disapprove/:token', async (req, res) => {
    const { token } = req.params;
    try {
        const [rows] = await pool.execute('SELECT * FROM requests WHERE approvalToken = ? AND status = ?', [token, 'Pending Manager Approval']);
        const request = rows[0];

        if (!request) {
            return res.status(440).render('message', { title: 'Error', message: '\nThis request was not found or has already been actioned.' });
        }

        await pool.execute('UPDATE requests SET status = ? WHERE approvalToken = ?', ['Disapproved', token]);

        res.render('message', { title: 'Request Disapproved', message: `\nRequest ID ${request.id} has been successfully disapproved.` });
    } catch (error) {
        console.error("Error disapproving request:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to disapprove request.' });
    }
});


// --- Admin Action Routes (Protected) ---
app.post('/delete/:id', requireAdmin, async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    try {
        await pool.execute('DELETE FROM requests WHERE id = ?', [requestId]);
        res.redirect('/status');
    } catch (error) {
        console.error("Error deleting request:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to delete request.' });
    }
});

app.post('/clear-all', requireAdmin, async (req, res) => {
    try {
        await pool.execute('TRUNCATE TABLE requests'); // TRUNCATE เพื่อล้างข้อมูลทั้งหมดและรีเซ็ต AUTO_INCREMENT
        res.redirect('/status');
    } catch (error) {
        console.error("Error clearing all requests:", error);
        res.status(500).render('message', { title: 'Error', message: 'Failed to clear all requests.' });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

//กล้วย