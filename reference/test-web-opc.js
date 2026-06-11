/**
 * OPC UA Web Controller for Arena Direction
 *
 * Run with:  node test-web-opc.js
 */

const { OPCUAClient, AttributeIds, DataType } = require("node-opcua");
const http = require("http");

// ─── OPC UA CONFIGURATION ───────────────────────────────────────────────────
const ENDPOINT = "opc.tcp://10.0.2.2:4845";
const HTTP_PORT = 3000;

// Tag Definitions
const TAG_LU = "ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.LU_ARENA";
const TAG_ST = "ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.ST_ARENA";
const TAG_RU = "ns=7;s=S71500ET200MP station_1.Conveyor_ctrl.RU_ARENA";

let opcSession = null;

// ─── HTML FRONTEND ─────────────────────────────────────────────────────────
const HTML_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Arena Direction Controller</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background-color: #f4f4f9; }
        .btn { font-size: 24px; padding: 15px 30px; margin: 10px; cursor: pointer; border: none; border-radius: 8px; color: white; transition: 0.2s; }
        .btn-left { background-color: #e74c3c; }
        .btn-straight { background-color: #3498db; }
        .btn-right { background-color: #2ecc71; }
        .btn:hover { opacity: 0.8; }
        .btn:active { transform: scale(0.95); }
        #status { margin-top: 30px; font-size: 18px; font-weight: bold; color: #333; }
    </style>
</head>
<body>
    <h1>Select Arena Direction</h1>
    <div>
        <button class="btn btn-left" onclick="setDirection('left')">⬅ Left</button>
        <button class="btn btn-straight" onclick="setDirection('straight')">⬆ Straight</button>
        <button class="btn btn-right" onclick="setDirection('right')">➡ Right</button>
    </div>
    <p id="status">Ready.</p>

    <script>
        function setDirection(dir) {
            const statusEl = document.getElementById('status');
            statusEl.innerText = 'Sending command: ' + dir.toUpperCase() + '...';
            statusEl.style.color = '#f39c12';

            fetch('/api/direction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction: dir })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    statusEl.innerText = 'Success! Direction set to ' + dir.toUpperCase();
                    statusEl.style.color = '#27ae60';
                } else {
                    statusEl.innerText = 'Failed: ' + (data.error || 'Unknown error');
                    statusEl.style.color = '#c0392b';
                }
            })
            .catch(err => {
                statusEl.innerText = 'Network error: Could not reach server.';
                statusEl.style.color = '#c0392b';
            });
        }
    </script>
</body>
</html>
`;

// ─── HTTP SERVER ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    // Serve the HTML page on the root URL
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_PAGE);
        return;
    }

    // Handle the API request to change direction
    if (req.method === 'POST' && req.url === '/api/direction') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            res.setHeader('Content-Type', 'application/json');

            if (!opcSession) {
                res.writeHead(500);
                return res.end(JSON.stringify({ success: false, error: "OPC UA Not connected" }));
            }

            try {
                const data = JSON.parse(body);
                const dir = data.direction;

                // Determine boolean states based on selected direction
                let lu = false, st = false, ru = false;
                if (dir === 'left') lu = true;
                else if (dir === 'straight') st = true;
                else if (dir === 'right') ru = true;
                else throw new Error("Invalid direction");

                console.log(`\n[Web Request] Received direction: ${dir.toUpperCase()}`);
                console.log(` -> LU_ARENA: ${lu}, ST_ARENA: ${st}, RU_ARENA: ${ru}`);

                // Prepare multiple nodes for a single bulk write
                const nodesToWrite = [
                    {
                        nodeId: TAG_LU,
                        attributeId: AttributeIds.Value,
                        value: { value: { dataType: DataType.Boolean, value: lu } }
                    },
                    {
                        nodeId: TAG_ST,
                        attributeId: AttributeIds.Value,
                        value: { value: { dataType: DataType.Boolean, value: st } }
                    },
                    {
                        nodeId: TAG_RU,
                        attributeId: AttributeIds.Value,
                        value: { value: { dataType: DataType.Boolean, value: ru } }
                    }
                ];

                // Write to the PLC
                const statusCodes = await opcSession.write(nodesToWrite);
                
                // Check if all writes were successful
                const allGood = statusCodes.every(sc => sc.name === 'Good');

                if (allGood) {
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: "PLC Write failed for one or more tags" }));
                }

            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // Not found
    res.writeHead(404);
    res.end("Not Found");
});

// ─── INITIALIZATION ────────────────────────────────────────────────────────
async function main() {
    const client = OPCUAClient.create({
        endpointMustExist: false,
        connectionStrategy: { maxRetry: 3, initialDelay: 1000 },
    });

    console.log("Connecting to OPC UA Server...");
    await client.connect(ENDPOINT);
    console.log("✓ Connected to OPC UA!");

    opcSession = await client.createSession();
    console.log("✓ OPC Session created!");

    // Start HTTP Web Server
    // Listening on '0.0.0.0' allows connections from outside the Linux VM
    server.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`\n✓ Web Server running!`);
        console.log(`=========================================`);
        console.log(`Access the UI at: http://localhost:${HTTP_PORT}`);
        console.log(`=========================================`);
    });
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});