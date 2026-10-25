import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import open from 'open';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3334; // Different port from main app (3333)

// Resolve project root (one level up from this script directory)
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');

// Helper to Ensure .env exists
if (!fs.existsSync(ENV_PATH)) {
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
        fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
        console.log('Created .env from .env.example');
    } else {
        fs.writeFileSync(ENV_PATH, '');
        console.log('Created empty .env');
    }
}

// Helper function to validate environment variable names
function isValidEnvVarName(key) {
    return /^[A-Z][A-Z0-9_]*$/i.test(key);
}

// Serve static files from the config-ui directory
const configUiDir = path.join(__dirname, 'config-ui');
app.use(express.static(configUiDir));
app.use(express.json());

// API endpoint to get current .env values
app.get('/api/config', (req, res) => {
    try {
        const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
        const config = dotenv.parse(envContent);
        res.json({ config });
    } catch (error) {
        console.error('Error loading configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to update .env file
app.post('/api/config', (req, res) => {
    try {
        const { config } = req.body;

        if (!config) {
            return res.status(400).json({ error: "No configuration data provided" });
        }

        let lines = [];
        if (fs.existsSync(ENV_PATH)) {
            lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
        }

        const updatedKeys = new Set();
        const newLines = lines.map(line => {
            const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
            if (match) {
                const key = match[1];
                if (config.hasOwnProperty(key)) {
                    updatedKeys.add(key);
                    return `${key}=${config[key]}`;
                }
            }
            return line;
        });

        // Add missing keys
        Object.keys(config).forEach(key => {
            if (!updatedKeys.has(key) && isValidEnvVarName(key)) {
                newLines.push(`${key}=${config[key]}`);
            }
        });

        const newContent = newLines.join('\n');
        fs.writeFileSync(ENV_PATH, newContent);

        res.json({ success: true, message: 'Configuration saved successfully!' });
    } catch (error) {
        console.error('Error updating configuration:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`Voice Agent Config Server running at http://localhost:${PORT}`);
    await open(`http://localhost:${PORT}`);
});
