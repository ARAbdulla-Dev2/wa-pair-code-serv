const fs = require('fs');
const pino = require('pino');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const express = require('express');
const { MongoClient } = require('mongodb'); // Import MongoDB client
const EventEmitter = require('events');

fs.unlinkSync('./sessions');

const app = express();
const PORT = process.env.PORT || '4545';
const mongoUri = 'mongodb+srv://user:321465@cluster0.7jcofhm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'; // Update with your MongoDB URI
const client = new MongoClient(mongoUri);
let db;

app.use(express.static('public'));
app.use(express.json());

const pairingCode = true;
const messageEmitter = new EventEmitter();

async function runProcess(github, number, cc) {
    let { version, isLatest } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${github}`);
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !pairingCode,
        browser: Browsers.macOS('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
    });

    if (pairingCode && !sock.authState.creds.registered) {
        let phoneNumber = cc + number;

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                messageEmitter.emit('message', [`${code}`]); // Emit the message
            } catch (err) {
                console.log('Error requesting pairing code:', err);
            }
        }, 3000);
    }

    sock.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        if (connection === "open") {
            await delay(10000);
            let sessionXeon = fs.readFileSync(`./sessions/${github}/creds.json`);
            const base64Creds = Buffer.from(sessionXeon).toString('base64'); // Base64 encode creds.json
            const userId = 'aradev_' + generateUserId(); // Generate alphanumerical user ID
            
            // Store userId and base64 in MongoDB
            await db.collection('userSessions').insertOne({ userId, creds: base64Creds });

            // Delete the session folder after storing
            fs.rmdirSync(`./sessions/${github}`, { recursive: true });

            // Notify user
            await sock.sendMessage(sock.user.id.replace(/:\d+@s\.whatsapp\.net$/, "@s.whatsapp.net"), { text: `> *CODE:- ${userId}*\n*POWERED BY ARABDULLA-DEV*` });
            sock.end;
            return;
        }
        if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
            runProcess(github, number, cc); // Pass parameters to restart
        }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on("messages.upsert", () => { });

    return "Process started";
}

function generateUserId() {
    return Math.random().toString(36).substr(2, 10); // Generate a random alphanumeric ID
}

process.on('uncaughtException', function (err) {
    const e = String(err);
    if (!["conflict", "not-authorized", "Socket connection timeout", "rate-overlimit", "Connection Closed", "Timed Out", "Value not found"].some(x => e.includes(x))) {
        console.log('Caught exception: ', err);
    }
});

app.post('/api/pair', async (req, res) => {
    const { phone, github, cc } = req.query;
    if (phone && github && cc) {
        const listener = (messages) => {
            res.json({ response: messages });
            messageEmitter.removeListener('message', listener); // Remove listener after responding
        };
        messageEmitter.on('message', listener);
        await runProcess(github, phone, cc); // Start the process after setting listener
    } else {
        res.json({
            error: 'Something went wrong! Please try again'
        });
    }
});

// Connect to MongoDB and start the server
async function startServer() {
    try {
        await client.connect();
        db = client.db('aradev'); // Update with your database name
        app.listen(PORT, () => {
            console.log(`SERVER RUNNING ON ${PORT}`);
        });
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

startServer();
